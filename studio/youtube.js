// Upload, agendamento, thumbnail, legendas e estatísticas via YouTube Data API v3.
import { google } from 'googleapis';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { ROOT, VIDEOS_DIR, db, getVideo, updateVideo, setStatus, logEvent } from './db.js';

const SECRETS = join(ROOT, 'secrets');
const CLIENT_FILE = join(SECRETS, 'client_secret.json');
const TOKEN_FILE = join(SECRETS, 'token.json');
const PORT = 5858;
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

function oauthClient() {
  if (!existsSync(CLIENT_FILE)) {
    throw new Error(`Falta ${CLIENT_FILE}. Baixe o JSON do OAuth Client (tipo "Desktop app") no Google Cloud e salve com esse nome.`);
  }
  const raw = JSON.parse(readFileSync(CLIENT_FILE, 'utf8'));
  const c = raw.installed || raw.web;
  return new google.auth.OAuth2(c.client_id, c.client_secret, `http://localhost:${PORT}/oauth2callback`);
}

export async function authorize() {
  mkdirSync(SECRETS, { recursive: true });
  const client = oauthClient();
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
  const code = new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== '/oauth2callback') return res.end();
      res.end('<h2>Autorizado. Pode fechar esta aba.</h2>');
      srv.close();
      u.searchParams.get('code') ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error')));
    }).listen(PORT);
  });
  console.log('Abrindo o navegador para autorizar o canal...');
  exec(`open "${url}"`);
  const { tokens } = await client.getToken(await code);
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log('Token salvo em secrets/token.json');
}

function api() {
  if (!existsSync(TOKEN_FILE)) throw new Error('Canal não autorizado. Rode: npm run cli -- yt-auth');
  const client = oauthClient();
  client.setCredentials(JSON.parse(readFileSync(TOKEN_FILE, 'utf8')));
  client.on('tokens', (t) => {
    const cur = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    writeFileSync(TOKEN_FILE, JSON.stringify({ ...cur, ...t }, null, 2));
  });
  return google.youtube({ version: 'v3', auth: client });
}

export const isAuthorized = () => existsSync(TOKEN_FILE);

function buildDescription(dir, seo) {
  let desc = seo.description.trim();
  const chFile = join(dir, 'chapters.json');
  if (existsSync(chFile)) {
    const chapters = JSON.parse(readFileSync(chFile, 'utf8'));
    if (chapters.length >= 3 && chapters[0].start === 0) {
      const fmt = (s) => { s = Math.floor(s); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
      desc += '\n\nChapters:\n' + chapters.map((c) => `${fmt(c.start)} ${c.title}`).join('\n');
    }
  }
  // Créditos obrigatórios das imagens de arquivo (licenças CC BY etc.)
  try {
    const { scenes } = JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8'));
    const credits = [...new Set(scenes.filter((s) => s.credit).map((s) => `${s.caption || s.image} — ${s.credit}`))];
    if (credits.length) desc += '\n\nImage credits:\n' + credits.map((c) => `- ${c}`).join('\n');
  } catch {}
  if (seo.hashtags?.length) desc += '\n\n' + seo.hashtags.map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ');
  return desc.slice(0, 4900);
}

export async function upload(slug, { publishAt } = {}) {
  const v = getVideo(slug);
  const dir = join(VIDEOS_DIR, slug);
  const file = join(dir, 'final.mp4');
  if (!existsSync(file)) throw new Error('final.mp4 não existe. Renderize primeiro.');
  const seo = JSON.parse(readFileSync(join(dir, 'seo.json'), 'utf8'));
  const yt = api();
  const when = publishAt || v.scheduled_at;
  if (!when || new Date(when) <= new Date()) throw new Error('Defina uma data futura de publicação (scheduled_at) antes do upload.');

  const size = statSync(file).size;
  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: seo.title.slice(0, 100),
        description: buildDescription(dir, seo),
        tags: seo.tags,
        categoryId: seo.categoryId || '27',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      },
      status: {
        privacyStatus: 'private',
        publishAt: new Date(when).toISOString(),
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    },
    media: { body: createReadStream(file) },
  }, {
    onUploadProgress: (e) => process.stdout.write(`\r  upload ${Math.round((e.bytesRead / size) * 100)}%`),
  });
  process.stdout.write('\n');
  const id = res.data.id;
  updateVideo(slug, { youtube_id: id, scheduled_at: when ?? null });
  logEvent(v.id, 'upload', `https://youtu.be/${id}`);

  const thumb = ['thumbnail.jpg', 'thumbnail.png'].map((f) => join(dir, f)).find(existsSync);
  if (thumb) {
    try {
      await yt.thumbnails.set({ videoId: id, media: { body: createReadStream(thumb) } });
    } catch (e) {
      logEvent(v.id, 'warn', `Thumbnail falhou (o canal precisa estar verificado por telefone): ${e.message}`);
    }
  }
  const srt = join(dir, 'captions.srt');
  if (existsSync(srt)) {
    try {
      await yt.captions.insert({
        part: ['snippet'],
        requestBody: { snippet: { videoId: id, language: 'en', name: 'English', isDraft: false } },
        media: { body: createReadStream(srt) },
      });
    } catch (e) {
      logEvent(v.id, 'warn', `Legenda falhou: ${e.message}`);
    }
  }
  setStatus(slug, 'scheduled', `youtu.be/${id} · vai ao ar ${new Date(when).toLocaleString('pt-BR')}`);
  return id;
}

// Puxa números do canal + de cada vídeo publicado e marca como publicados os agendados que já foram ao ar.
export async function syncStats() {
  const yt = api();
  const ch = await yt.channels.list({ part: ['statistics', 'snippet'], mine: true });
  const s = ch.data.items?.[0]?.statistics;
  if (s) {
    db.prepare("INSERT OR REPLACE INTO channel_stats (ts, subscribers, views, videos) VALUES (datetime('now'), ?, ?, ?)")
      .run(Number(s.subscriberCount), Number(s.viewCount), Number(s.videoCount));
  }
  const rows = db.prepare('SELECT slug, youtube_id, status FROM videos WHERE youtube_id IS NOT NULL').all();
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const r = await yt.videos.list({ part: ['statistics', 'status', 'snippet'], id: batch.map((b) => b.youtube_id) });
    for (const item of r.data.items || []) {
      const row = batch.find((b) => b.youtube_id === item.id);
      updateVideo(row.slug, {
        views: Number(item.statistics.viewCount || 0),
        likes: Number(item.statistics.likeCount || 0),
        comments: Number(item.statistics.commentCount || 0),
      });
      if (row.status === 'scheduled' && item.status.privacyStatus === 'public') {
        updateVideo(row.slug, { published_at: item.snippet.publishedAt });
        setStatus(row.slug, 'published', 'foi ao ar');
      }
    }
  }
  return { channel: ch.data.items?.[0]?.snippet?.title, ...s };
}

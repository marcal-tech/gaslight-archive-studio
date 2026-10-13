// Painel local: http://localhost:4400
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream, readdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { ROOT, VIDEOS_DIR, STAGES, db, getVideo, setStatus, updateVideo, addIdea, getSetting, logEvent } from './db.js';
import { nextSlot, slotConfig } from './schedule.js';

const PORT = Number(process.env.PORT || 4400);
const MIME = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.srt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.json': 'application/json' };

const json = (res, data, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b ? JSON.parse(b) : {})); });

function isoWeekStart(d) {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function state() {
  const videos = db.prepare('SELECT * FROM videos ORDER BY updated_at DESC').all().map((v) => {
    const dir = join(VIDEOS_DIR, v.slug);
    const thumb = ['thumbnail.jpg', 'thumbnail.png'].find((f) => existsSync(join(dir, f)));
    return { ...v, thumb: thumb ? `/media/${v.slug}/${thumb}` : null };
  });
  const credits = db.prepare('SELECT video_id, kind, SUM(amount) AS total FROM credits GROUP BY video_id, kind').all();
  const creditByVideo = {};
  for (const c of credits) creditByVideo[c.video_id] = (creditByVideo[c.video_id] || 0) + c.total;
  for (const v of videos) v.credits = creditByVideo[v.id] || 0;

  const goal = Number(getSetting('weekly_goal', 3));
  const now = new Date();
  const thisWeek = isoWeekStart(now);
  // Últimas 12 semanas: quantos foram ao ar (publicados ou com data de estreia na semana).
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(thisWeek.getTime() - i * 7 * 864e5);
    const end = new Date(start.getTime() + 7 * 864e5);
    const n = videos.filter((v) => {
      const at = v.published_at || (['scheduled', 'published'].includes(v.status) ? v.scheduled_at : null);
      return at && new Date(at) >= start && new Date(at) < end && new Date(at) <= now;
    }).length;
    const produced = db.prepare("SELECT COUNT(DISTINCT video_id) AS n FROM events WHERE type='status' AND message LIKE '%→ final_review%' AND ts >= ? AND ts < ?")
      .get(start.toISOString().replace('T', ' ').slice(0, 19), end.toISOString().replace('T', ' ').slice(0, 19)).n;
    weeks.push({ week: start.toISOString().slice(0, 10), published: n, produced });
  }

  const finishedCredits = videos.filter((v) => ['final_review', 'scheduled', 'published'].includes(v.status) && v.credits > 0);
  const countBy = (s) => videos.filter((v) => s.includes(v.status)).length;
  const kpis = {
    inProduction: countBy(['approved', 'scripting', 'script_review', 'producing', 'rendering', 'final_review', 'ready']),
    awaitingYou: countBy(['idea', 'script_review', 'final_review']),
    scheduled: countBy(['scheduled']),
    published: countBy(['published']),
    thisWeek: weeks.at(-1).published + videos.filter((v) => v.status === 'scheduled' && v.scheduled_at && new Date(v.scheduled_at) > now && isoWeekStart(v.scheduled_at).getTime() === thisWeek.getTime()).length,
    goal,
    creditsTotal: db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM credits').get().t,
    avgCreditsPerVideo: finishedCredits.length ? finishedCredits.reduce((a, v) => a + v.credits, 0) / finishedCredits.length : null,
    totalViews: videos.reduce((a, v) => a + (v.views || 0), 0),
  };
  const channel = db.prepare('SELECT * FROM channel_stats ORDER BY ts').all();
  const events = db.prepare(`SELECT e.*, v.title, v.slug FROM events e LEFT JOIN videos v ON v.id = e.video_id ORDER BY e.id DESC LIMIT 40`).all();
  let ytAuth = existsSync(join(ROOT, 'secrets', 'token.json'));
  return { stages: STAGES, videos, kpis, weeks, channel, events, nextSlot: nextSlot(), slots: slotConfig(), ytAuth };
}

function videoDetail(slug) {
  const v = getVideo(slug);
  const dir = join(VIDEOS_DIR, slug);
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  let scenes = null;
  try { scenes = JSON.parse(read('scenes.json'))?.scenes ?? null; } catch {}
  const imgs = scenes ? scenes.filter((s) => s.image && existsSync(join(dir, s.image))).length : 0;
  const auds = scenes ? scenes.filter((s) => s.audio && existsSync(join(dir, s.audio))).length : 0;
  return {
    ...v,
    research: read('research.md'),
    script: read('script.md'),
    seo: read('seo.json') ? JSON.parse(read('seo.json')) : null,
    hasFinal: files.includes('final.mp4'),
    thumb: ['thumbnail.jpg', 'thumbnail.png'].find((f) => files.includes(f)) ?? null,
    assets: scenes ? { scenes: scenes.length, images: imgs, audio: auds } : null,
    events: db.prepare('SELECT * FROM events WHERE video_id = ? ORDER BY id DESC').all(v.id),
    credits: db.prepare('SELECT kind, SUM(amount) AS total FROM credits WHERE video_id = ? GROUP BY kind').all(v.id),
  };
}

function serveFile(req, res, file) {
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p === '/' ) return serveFile(req, res, join(ROOT, 'dashboard', 'index.html'));
    if (p === '/api/state') return json(res, state());
    // O YouTube Studio (aberto no Chrome) busca o vídeo daqui pra fazer o upload — a extensão só aceita arquivos < 10 MB.
    // Libera CORS + Private Network Access apenas para a origem do Studio.
    if (p.startsWith('/media/') && req.headers.origin === 'https://studio.youtube.com') {
      res.setHeader('Access-Control-Allow-Origin', 'https://studio.youtube.com');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'range');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    if (p.startsWith('/media/')) {
      const rel = normalize(decodeURIComponent(p.slice(7)));
      if (rel.startsWith('..')) { res.writeHead(403); return res.end(); }
      return serveFile(req, res, join(VIDEOS_DIR, rel));
    }
    let m;
    if ((m = p.match(/^\/api\/video\/([\w-]+)$/)) && req.method === 'GET') return json(res, videoDetail(m[1]));
    if ((m = p.match(/^\/api\/video\/([\w-]+)\/status$/)) && req.method === 'POST') {
      const { status, note } = await body(req);
      setStatus(m[1], status, note ? `você: ${note}` : 'pelo painel');
      return json(res, { ok: true });
    }
    if ((m = p.match(/^\/api\/video\/([\w-]+)\/schedule$/)) && req.method === 'POST') {
      const { when } = await body(req);
      updateVideo(m[1], { scheduled_at: when ? new Date(when).toISOString() : nextSlot() });
      return json(res, { ok: true });
    }
    // Aprovação final: sobe pro YouTube agendado no slot definido (roda em segundo plano).
    if ((m = p.match(/^\/api\/video\/([\w-]+)\/publish$/)) && req.method === 'POST') {
      const slug = m[1];
      const v = getVideo(slug);
      if (v.status !== 'final_review') return json(res, { error: 'Só vídeos em "Revisar vídeo" podem ser publicados' }, 400);
      if (!v.scheduled_at || new Date(v.scheduled_at) <= new Date()) updateVideo(slug, { scheduled_at: nextSlot() });
      if (!existsSync(join(ROOT, 'secrets', 'token.json'))) {
        // Sem API: o Trevor publica pelo YouTube Studio no Chrome.
        setStatus(slug, 'ready', `aprovado · estreia ${new Date(getVideo(slug).scheduled_at).toLocaleString('pt-BR')}`);
        return json(res, { ok: true, via: 'studio' });
      }
      const { upload } = await import('./youtube.js');
      logEvent(v.id, 'note', 'Aprovado — enviando ao YouTube...');
      upload(slug).catch((e) => logEvent(v.id, 'error', `Upload falhou: ${e.message}`));
      return json(res, { ok: true });
    }
    if (p === '/api/idea' && req.method === 'POST') {
      const { title, angle } = await body(req);
      if (!title?.trim()) return json(res, { error: 'título vazio' }, 400);
      return json(res, { slug: addIdea(title.trim(), angle?.trim() ?? '') });
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}).listen(PORT, () => console.log(`Painel: http://localhost:${PORT}`));

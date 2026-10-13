#!/usr/bin/env node
// Uso: npm run cli -- <comando> [args]
import { db, STAGE_IDS, addIdea, setStatus, updateVideo, addCredits, getVideo, setSetting, logEvent } from './db.js';
import { render } from './render.js';
import { nextSlot } from './schedule.js';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const commands = {
  // idea "Title" --angle "por que é interessante"
  idea: () => console.log(addIdea(args[0], flag('angle') ?? '')),

  // status <slug> <status> --note "..."
  status: () => { setStatus(args[0], args[1], flag('note')); console.log(`${args[0]} → ${args[1]}`); },

  // credits <slug> <valor> <tipo: image|voice|video|thumb> --note "..."
  credits: () => { addCredits(args[0] === '-' ? null : args[0], Number(args[1]), args[2], flag('note')); console.log('ok'); },

  // log <slug> "mensagem"
  log: () => { logEvent(getVideo(args[0]).id, 'note', args[1]); console.log('ok'); },

  render: async () => {
    const slug = args[0];
    setStatus(slug, 'rendering');
    try {
      const r = await render(slug);
      updateVideo(slug, { duration_sec: r.duration, word_count: r.words });
      setStatus(slug, 'final_review', `${(r.duration / 60).toFixed(1)} min, ${r.scenes} cenas`);
      console.log(`Pronto: ${r.file} (${(r.duration / 60).toFixed(1)} min)`);
    } catch (e) {
      setStatus(slug, 'producing', 'render falhou');
      throw e;
    }
  },

  // compile "Title" <slug1> <slug2> ... — compilação dos vídeos já renderizados
  compile: async () => {
    const { compile } = await import('./compile.js');
    const r = compile(args[0], args.slice(1));
    console.log(`Pronto: videos/${r.slug}/final.mp4 (${(r.duration / 60).toFixed(1)} min)`);
  },

  // schedule <slug> [ISO] — sem data, pega o próximo slot livre da grade
  schedule: () => {
    const when = args[1] || nextSlot();
    updateVideo(args[0], { scheduled_at: when });
    console.log(`${args[0]} agendado para ${new Date(when).toLocaleString('pt-BR')}`);
  },

  upload: async () => {
    const { upload } = await import('./youtube.js');
    const v = getVideo(args[0]);
    if (!v.scheduled_at) updateVideo(args[0], { scheduled_at: nextSlot() });
    const id = await upload(args[0]);
    console.log(`https://youtu.be/${id}`);
  },

  // Publicação feita pelo YouTube Studio (Chrome): registra o resultado no painel.
  // uploaded <slug> <videoId> [ISO da estreia]
  uploaded: () => {
    const v = getVideo(args[0]);
    const when = args[2] || v.scheduled_at;
    updateVideo(args[0], { youtube_id: args[1], scheduled_at: when });
    const live = when && new Date(when) <= new Date();
    if (live) updateVideo(args[0], { published_at: when });
    setStatus(args[0], live ? 'published' : 'scheduled', `youtu.be/${args[1]} · via Studio`);
    console.log('ok');
  },
  // video-stats <slug> <views> <likes> <comments> — números lidos no Studio
  'video-stats': () => {
    updateVideo(args[0], { views: Number(args[1]), likes: Number(args[2] || 0), comments: Number(args[3] || 0) });
    const v = getVideo(args[0]);
    if (v.status === 'scheduled' && v.scheduled_at && new Date(v.scheduled_at) <= new Date()) {
      updateVideo(args[0], { published_at: v.scheduled_at });
      setStatus(args[0], 'published', 'foi ao ar');
    }
    console.log('ok');
  },
  // channel-stats <inscritos> <views> <vídeos>
  'channel-stats': () => {
    db.prepare("INSERT OR REPLACE INTO channel_stats (ts, subscribers, views, videos) VALUES (datetime('now'), ?, ?, ?)").run(Number(args[0]), Number(args[1]), Number(args[2]));
    console.log('ok');
  },

  'yt-auth': async () => (await import('./youtube.js')).authorize(),
  stats: async () => console.log(await (await import('./youtube.js')).syncStats()),

  // fetch <slug> <images|audio|clips> 01=<url> 02=<url> ... — baixa resultados do Higgsfield na pasta do vídeo
  fetch: async () => {
    const [slug, kind, ...pairs] = args;
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { VIDEOS_DIR } = await import('./db.js');
    const dir = join(VIDEOS_DIR, getVideo(slug).slug, kind);
    mkdirSync(dir, { recursive: true });
    await Promise.all(pairs.map(async (p) => {
      const [id, url] = p.split(/=(.+)/);
      const ext = url.split('?')[0].split('.').pop();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
      writeFileSync(join(dir, `${id}.${ext}`), Buffer.from(await res.arrayBuffer()));
      console.log(`  ${kind}/${id}.${ext}`);
    }));
  },

  set: () => { setSetting(args[0], args[1]); console.log('ok'); },

  list: () => {
    const rows = db.prepare("SELECT slug, status, scheduled_at, title FROM videos ORDER BY CASE status WHEN 'rejected' THEN 1 ELSE 0 END, id").all();
    for (const r of rows) console.log(`${r.status.padEnd(14)} ${(r.scheduled_at ?? '').slice(0, 16).padEnd(17)} ${r.slug}`);
  },
};

if (!commands[cmd]) {
  console.log(`Comandos: ${Object.keys(commands).join(', ')}\nStatus válidos: ${STAGE_IDS.join(', ')}`);
  process.exit(cmd ? 1 : 0);
}
try {
  await commands[cmd]();
} catch (e) {
  console.error('Erro:', e.message);
  process.exit(1);
}

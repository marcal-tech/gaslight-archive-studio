// Compilação: junta vídeos já renderizados num vídeo longo (custo zero de créditos).
// Cada vídeo ganha um cartão de título antes, vira um capítulo, e as legendas são reaproveitadas com offset.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { VIDEOS_DIR, ROOT, addIdea, getVideo, setStatus, updateVideo, logEvent } from './db.js';
import { probeDuration } from './render.js';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} falhou:\n${(r.stderr || '').slice(-1500)}`);
}

const parseTime = (t) => { const [h, m, s] = t.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +s; };
const fmtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};

export function compile(title, sources, { log = console.log } = {}) {
  if (sources.length < 2) throw new Error('Uma compilação precisa de pelo menos 2 vídeos.');
  const vids = sources.map((s) => {
    const v = getVideo(s);
    const file = join(VIDEOS_DIR, s, 'final.mp4');
    if (!existsSync(file)) throw new Error(`${s} não tem final.mp4`);
    const seoFile = join(VIDEOS_DIR, s, 'seo.json');
    const seo = existsSync(seoFile) ? JSON.parse(readFileSync(seoFile, 'utf8')) : null;
    return { ...v, file, seo, cardTitle: v.title };
  });

  const slug = addIdea(title, `Compilação de: ${sources.join(', ')}`);
  const dir = join(VIDEOS_DIR, slug);
  const build = join(dir, 'build');
  mkdirSync(build, { recursive: true });

  const parts = [], chapters = [], cues = [];
  let t = 0;
  vids.forEach((v, i) => {
    const png = join(build, `card_${i}.png`);
    const seg = join(build, `card_${i}.mp4`);
    run('python3', [join(ROOT, 'studio', 'cards.py'), 'card', png, v.cardTitle, `Part ${i + 1}`]);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-t', '3', '-i', png,
      '-f', 'lavfi', '-t', '3', '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', 'scale=1920:1080,fade=t=in:d=0.4,fade=t=out:st=2.6:d=0.4,format=yuv420p', '-r', '30',
      '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-c:a', 'aac', '-b:a', '192k', '-shortest', seg]);
    chapters.push({ start: t, title: v.cardTitle });
    t += 3;
    parts.push(seg, v.file);
    const srt = join(VIDEOS_DIR, v.slug, 'captions.srt');
    if (existsSync(srt)) {
      for (const block of readFileSync(srt, 'utf8').trim().split(/\n\s*\n/)) {
        const lines = block.split('\n');
        const [a, b] = lines[1].split(' --> ');
        cues.push({ start: parseTime(a) + t, end: parseTime(b) + t, text: lines.slice(2).join('\n') });
      }
    }
    t += probeDuration(v.file);
    log(`  + ${v.slug}`);
  });

  // Filtro concat (não o demuxer): normaliza vídeo e áudio de cada parte, então fontes com encodes diferentes juntam sem erro.
  const norm = parts.map((_, i) =>
    `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v${i}];` +
    `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}];`).join('');
  const chain = parts.map((_, i) => `[v${i}][a${i}]`).join('');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...parts.flatMap((p) => ['-i', p]),
    '-filter_complex', `${norm}${chain}concat=n=${parts.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(dir, 'final.mp4')]);

  writeFileSync(join(dir, 'chapters.json'), JSON.stringify(chapters, null, 2));
  writeFileSync(join(dir, 'captions.srt'), cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}\n`).join('\n'));
  const tags = [...new Set(vids.flatMap((v) => v.seo?.tags ?? []))].slice(0, 25);
  writeFileSync(join(dir, 'seo.json'), JSON.stringify({
    title,
    description: `${vids.length} true stories from history's darkest chapters, in one place.\n\n` +
      vids.map((v, i) => `${i + 1}. ${v.seo?.title ?? v.title}`).join('\n'),
    tags,
    hashtags: ['DarkHistory', 'History', 'Documentary'],
    categoryId: '27',
  }, null, 2));
  // Reaproveita os créditos de imagem das fontes na descrição.
  const scenes = vids.flatMap((v) => {
    const f = join(VIDEOS_DIR, v.slug, 'scenes.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).scenes.filter((s) => s.credit) : [];
  });
  writeFileSync(join(dir, 'scenes.json'), JSON.stringify({ compilation: sources, scenes }, null, 2));

  updateVideo(slug, { duration_sec: t, word_count: vids.reduce((a, v) => a + (v.word_count || 0), 0) });
  setStatus(slug, 'final_review', `compilação de ${vids.length} vídeos, ${(t / 60).toFixed(1)} min`);
  logEvent(getVideo(slug).id, 'note', 'Falta: thumbnail.jpg (gerar com o personagem/estilo do canal)');
  return { slug, duration: t };
}

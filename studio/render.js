// Monta o vídeo final a partir de videos/<slug>/scenes.json:
// cada cena = imagem (com movimento de câmera) ou clipe de vídeo + trecho de narração.
// Gera final.mp4 (1080p, -14 LUFS) e captions.srt sincronizado com a narração.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { VIDEOS_DIR, ROOT } from './db.js';

const FPS = 30;
const W = 1920, H = 1080;
const PAD = 0.35; // respiro após cada fala
const MOTIONS = ['in', 'out', 'left', 'right', 'up', 'still', 'drift'];
const AUTO_MOTIONS = ['in', 'out', 'left', 'right', 'up'];

export function probeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = parseFloat(r.stdout);
  if (!Number.isFinite(d)) throw new Error(`Não consegui ler a duração de ${file}`);
  return d;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg falhou (${code}):\n${err.slice(-2000)}`))));
  });
}

function zoompanExpr(motion, frames) {
  const t = `on/${frames}`;
  const cx = 'iw/2-(iw/zoom/2)', cy = 'ih/2-(ih/zoom/2)';
  switch (motion) {
    case 'still': return { z: '1', x: '0', y: '0' };
    case 'drift': return { z: `1+0.04*${t}`, x: cx, y: cy }; // quase parado — cartões e fotos de arquivo
    case 'out': return { z: `1.10-0.10*${t}`, x: cx, y: cy };
    case 'left': return { z: '1.10', x: `(iw-iw/zoom)*${t}`, y: cy };
    case 'right': return { z: '1.10', x: `(iw-iw/zoom)*(1-${t})`, y: cy };
    case 'up': return { z: '1.10', x: cx, y: `(ih-ih/zoom)*(1-${t})` };
    default: return { z: `1+0.10*${t}`, x: cx, y: cy };
  }
}

const isStale = (out, inputs) => !existsSync(out) || inputs.some((i) => statSync(i).mtimeMs > statSync(out).mtimeMs);
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

function python(args) {
  const r = spawnSync('python3', [join(ROOT, 'studio', 'cards.py'), ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cards.py falhou: ${r.stderr}`);
}

// Resolve a imagem da cena: arquivo gerado por IA, cartão de texto ou foto de arquivo emoldurada.
function sceneImage(dir, scene) {
  const build = join(dir, 'build');
  if (scene.card) {
    const out = join(build, `card_${hash(scene.card + '|' + (scene.sub || ''))}.png`);
    if (!existsSync(out)) python(['card', out, scene.card, scene.sub || '']);
    return out;
  }
  const src = join(dir, scene.image);
  if (scene.archival) {
    const out = join(build, `arch_${hash(scene.image + '|' + (scene.caption || ''))}.png`);
    if (isStale(out, [src])) python(['archive', out, src, scene.caption || '']);
    return out;
  }
  return src;
}

const speechDuration = (dir, scene) => (scene.audio ? probeDuration(join(dir, scene.audio)) : 0);
const sceneDuration = (dir, scene) => (scene.audio ? speechDuration(dir, scene) + PAD : scene.duration || 3);

async function renderSegment(dir, scene, i, outFile) {
  const dur = sceneDuration(dir, scene);
  const inputs = [];
  let audioIn;
  if (scene.audio) {
    const audio = join(dir, scene.audio);
    inputs.push(audio);
    audioIn = ['-i', audio];
  } else {
    audioIn = ['-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'];
  }
  const audioFilter = `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${dur.toFixed(3)}[a]`;
  const enc = ['-map', '[v]', '-map', '[a]', '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-t', dur.toFixed(3), outFile];
  const scenesFile = join(dir, 'scenes.json');

  if (scene.clip) {
    const clip = join(dir, scene.clip);
    inputs.push(clip);
    if (!isStale(outFile, inputs)) return dur;
    await ffmpeg(['-i', clip, ...audioIn, '-filter_complex',
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,` +
      `tpad=stop_mode=clone:stop_duration=600,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[v];${audioFilter}`,
      ...enc]);
  } else {
    const img = sceneImage(dir, scene);
    inputs.push(img, scenesFile); // mudar motion/duração no scenes.json re-renderiza
    if (!isStale(outFile, inputs)) return dur;
    const frames = Math.ceil(dur * FPS);
    const fallback = scene.card || scene.archival ? 'drift' : AUTO_MOTIONS[i % AUTO_MOTIONS.length];
    const motion = MOTIONS.includes(scene.motion) ? scene.motion : fallback;
    const { z, x, y } = zoompanExpr(motion, frames);
    // Escala pra 4K antes do zoompan pra evitar o "tremido" do movimento.
    await ffmpeg(['-i', img, ...audioIn, '-filter_complex',
      `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,` +
      `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p[v];${audioFilter}`,
      ...enc]);
  }
  return dur;
}

function srtTime(s) {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

// Quebra a fala da cena em blocos curtos e distribui o tempo proporcional ao nº de caracteres.
function sceneCaptions(text, start, speechDur) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 10 || (/[.!?;:]$/.test(w) && cur.length >= 4)) { chunks.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) chunks.push(cur.join(' '));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let t = start;
  return chunks.map((c) => {
    const d = (c.length / total) * speechDur;
    const cue = { start: t, end: t + d, text: c };
    t += d;
    return cue;
  });
}

function findMusic(dir) {
  const local = join(dir, 'music.mp3');
  if (existsSync(local)) return local;
  const lib = join(ROOT, 'assets', 'music');
  if (!existsSync(lib)) return null;
  const tracks = readdirSync(lib).filter((f) => /\.(mp3|wav|m4a)$/i.test(f));
  if (!tracks.length) return null;
  // Escolha determinística por vídeo, pra re-render dar o mesmo resultado.
  const h = [...dir].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return join(lib, tracks[h % tracks.length]);
}

export async function render(slug, { concurrency = 3, log = console.log } = {}) {
  const dir = join(VIDEOS_DIR, slug);
  const { scenes } = JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8'));
  const missing = scenes.flatMap((s) => [s.audio, s.card ? null : (s.clip || s.image || '(sem imagem)')]
    .filter((f) => f && !existsSync(join(dir, f))).map((f) => `cena ${s.id}: ${f}`));
  if (missing.length) throw new Error(`Arquivos faltando:\n  ${missing.join('\n  ')}`);

  const segDir = join(dir, 'build');
  mkdirSync(segDir, { recursive: true });
  const durations = new Array(scenes.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < scenes.length) {
      const i = next++;
      durations[i] = await renderSegment(dir, scenes[i], i, join(segDir, `seg_${String(i).padStart(3, '0')}.mp4`));
      log(`  cena ${++done}/${scenes.length} ok`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const list = scenes.map((_, i) => `file 'seg_${String(i).padStart(3, '0')}.mp4'`).join('\n');
  writeFileSync(join(segDir, 'list.txt'), list);
  const body = join(segDir, 'body.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(segDir, 'list.txt'), '-c', 'copy', body]);

  const total = durations.reduce((a, b) => a + b, 0);
  const music = findMusic(dir);
  const out = join(dir, 'final.mp4');
  const fade = `afade=t=in:d=0.5,afade=t=out:st=${(total - 2).toFixed(2)}:d=2`;
  const vfade = `fade=t=in:d=0.6,fade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5`;
  if (music) {
    log(`  trilha: ${music}`);
    await ffmpeg(['-i', body, '-stream_loop', '-1', '-i', music, '-filter_complex',
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.11[m];` +
      `[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,${fade}[a];[0:v]${vfade}[v]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', out]);
  } else {
    log('  sem trilha (coloque .mp3 em assets/music/)');
    await ffmpeg(['-i', body, '-filter_complex', `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,${fade}[a];[0:v]${vfade}[v]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', out]);
  }

  let t = 0, n = 1;
  const cues = [], chapters = [];
  scenes.forEach((s, i) => {
    if (s.chapter) chapters.push({ start: t, title: s.chapter });
    if (s.audio && s.text) cues.push(...sceneCaptions(s.text, t, durations[i] - PAD));
    t += durations[i];
  });
  writeFileSync(join(dir, 'chapters.json'), JSON.stringify(chapters, null, 2));
  writeFileSync(join(dir, 'captions.srt'), cues.map((c) => `${n++}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'));

  const words = scenes.reduce((a, s) => a + (s.audio && s.text ? s.text.split(/\s+/).filter(Boolean).length : 0), 0);
  return { file: out, duration: total, words, scenes: scenes.length };
}

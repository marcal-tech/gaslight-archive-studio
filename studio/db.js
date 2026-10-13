import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VIDEOS_DIR = join(ROOT, 'videos');
mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(VIDEOS_DIR, { recursive: true });

// Ordem do pipeline. Cada vídeo anda da esquerda pra direita.
// Os três *_review são portões de aprovação humana (proteção contra a política de "inauthentic content").
export const STAGES = [
  { id: 'idea', label: 'Ideia' },
  { id: 'approved', label: 'Pauta aprovada' },
  { id: 'scripting', label: 'Roteirizando' },
  { id: 'script_review', label: 'Revisar roteiro' },
  { id: 'producing', label: 'Voz + imagens' },
  { id: 'rendering', label: 'Renderizando' },
  { id: 'final_review', label: 'Revisar vídeo' },
  { id: 'ready', label: 'Pronto p/ publicar' },
  { id: 'scheduled', label: 'Agendado' },
  { id: 'published', label: 'Publicado' },
];
export const STAGE_IDS = [...STAGES.map((s) => s.id), 'rejected'];

export const db = new DatabaseSync(join(ROOT, 'data', 'studio.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  angle TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea',
  duration_sec REAL,
  word_count INTEGER,
  scheduled_at TEXT,
  published_at TEXT,
  youtube_id TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  video_id INTEGER,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  message TEXT
);
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY,
  video_id INTEGER,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS channel_stats (
  ts TEXT PRIMARY KEY DEFAULT (datetime('now')),
  subscribers INTEGER,
  views INTEGER,
  videos INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

export function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function getVideo(slug) {
  const v = db.prepare('SELECT * FROM videos WHERE slug = ?').get(slug);
  if (!v) throw new Error(`Vídeo não encontrado: ${slug}`);
  return v;
}

export function logEvent(videoId, type, message) {
  db.prepare('INSERT INTO events (video_id, type, message) VALUES (?, ?, ?)').run(videoId ?? null, type, message ?? null);
}

export function addIdea(title, angle = '') {
  let slug = slugify(title);
  if (db.prepare('SELECT 1 FROM videos WHERE slug = ?').get(slug)) slug += '-' + Date.now().toString(36);
  const r = db.prepare('INSERT INTO videos (slug, title, angle) VALUES (?, ?, ?)').run(slug, title, angle);
  mkdirSync(join(VIDEOS_DIR, slug), { recursive: true });
  logEvent(r.lastInsertRowid, 'created', title);
  return slug;
}

export function setStatus(slug, status, note) {
  if (!STAGE_IDS.includes(status)) throw new Error(`Status inválido: ${status}. Use: ${STAGE_IDS.join(', ')}`);
  const v = getVideo(slug);
  db.prepare("UPDATE videos SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, v.id);
  logEvent(v.id, 'status', `${v.status} → ${status}${note ? ' · ' + note : ''}`);
}

export function updateVideo(slug, fields) {
  const v = getVideo(slug);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE videos SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), v.id);
}

export function addCredits(slug, amount, kind, note) {
  const v = slug ? getVideo(slug) : null;
  db.prepare('INSERT INTO credits (video_id, kind, amount, note) VALUES (?, ?, ?, ?)').run(v?.id ?? null, kind, amount, note ?? null);
}

export function getSetting(key, fallback) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

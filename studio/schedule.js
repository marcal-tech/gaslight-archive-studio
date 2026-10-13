import { db, getSetting } from './db.js';

// Grade padrão: seg/qua/sex às 15:00 UTC (11h em Nova York — pico do público americano).
// Ajustável: npm run cli -- set slots '{"days":[1,3,5],"hourUTC":15}'
export function slotConfig() {
  return JSON.parse(getSetting('slots', '{"days":[1,3,5],"hourUTC":15}'));
}

// Próximo horário livre da grade, com pelo menos 24h de folga.
export function nextSlot(from = new Date()) {
  const { days, hourUTC } = slotConfig();
  const taken = new Set(db.prepare("SELECT scheduled_at FROM videos WHERE scheduled_at IS NOT NULL AND status != 'rejected'")
    .all().map((r) => r.scheduled_at.slice(0, 10)));
  const d = new Date(from.getTime() + 24 * 3600e3);
  d.setUTCHours(hourUTC, 0, 0, 0);
  for (let i = 0; i < 365; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    if (d <= from) continue;
    if (days.includes(d.getUTCDay()) && !taken.has(d.toISOString().slice(0, 10))) return d.toISOString();
  }
  throw new Error('Nenhum slot livre no próximo ano');
}

// Calendar file with shopping-day and thaw reminders — works with Apple/Google Calendar, no server needed.
import { state } from './store.js';
import { addDays, planTotal, shopDate, thawFor } from './planner.js';

const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
const stamp = (iso, hhmm) => iso.replace(/-/g, '') + 'T' + hhmm + '00';

function event(uid, iso, hhmm, title, desc) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const [h, m] = [hhmm.slice(0, 2), hhmm.slice(2)];
  const endH = String(Math.min(23, Number(h) + 1)).padStart(2, '0');
  return [
    'BEGIN:VEVENT', `UID:${uid}@supperplan`, `DTSTAMP:${now}`,
    `DTSTART:${stamp(iso, hhmm)}`, `DTEND:${stamp(iso, endH + m)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

export function buildIcs(plan) {
  const events = [];
  const shopIso = shopDate(plan);
  const store = state.settings.store ? ` at ${state.settings.store}` : '';
  events.push(event(`shop-${shopIso}`, shopIso, '1000', `🛒 Grocery shopping${store}`, `Estimated total: $${planTotal(plan).toFixed(2)}. Open SupperPlan for the list.`));
  plan.days.forEach((d, i) => {
    const frozen = thawFor(plan, i);
    if (!frozen.length) return;
    const iso = addDays(plan.start, i - 1);
    const names = frozen.map((f) => f.name).join(', ');
    const meals = [...new Set(frozen.map((f) => f.forRecipe))].join(' and ');
    events.push(event(`thaw-${plan.start}-${i}`, iso, '1900', `🧊 Thaw for tomorrow: ${names}`, `Move to the fridge tonight for ${meals}.`));
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SupperPlan//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}

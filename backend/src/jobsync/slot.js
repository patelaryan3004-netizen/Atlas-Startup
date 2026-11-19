// Which of the day's two refreshes a moment belongs to, by Melbourne's own wall clock (Australia/Melbourne, daylight saving included): the label a refresh carries in the health record ("2026-11-20 AM").
//
// The timer no longer needs this to pick its firing: the workflow's schedule takes the time zone itself (`cron: '10 8,20 * * *'` with `timezone: 'Australia/Melbourne'`). What is left is the label, and `decide`,
// which answers "is a refresh due for this slot?" for a person re-running it by hand, or a timer that was ever moved back to UTC:
//   - a moment belongs to a SLOT when Melbourne's wall clock is in the slot's window: [8:00, 12:00) is "AM", [20:00, 24:00) is "PM" (a run GitHub starts up to four hours late still answers its slot);
//   - a slot that already has a completed refresh in the health record is not run again;
//   - outside the windows nothing runs.
export const TIME_ZONE = 'Australia/Melbourne';
export const SLOTS = [{ name: 'AM', from: 8, to: 12 }, { name: 'PM', from: 20, to: 24 }];

const FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Melbourne's wall clock at an instant: { date: 'YYYY-MM-DD', hour, minute }.
export function melbourne(ms) {
  const p = Object.fromEntries(FORMAT.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

// The slot an instant belongs to, or null: { id: '2026-11-20 AM', name, date }.
export function slotAt(ms) {
  const m = melbourne(ms);
  const slot = SLOTS.find((s) => m.hour >= s.from && m.hour < s.to);
  return slot ? { id: `${m.date} ${slot.name}`, name: slot.name, date: m.date } : null;
}

// Should this firing run a refresh? `done`: the slot ids that already have one. `force`: a person asked.
export function decide({ now, done = [], force = false }) {
  const local = melbourne(now);
  const where = `${local.date} ${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')} Melbourne time`;
  const slot = slotAt(now);
  if (force) return { run: true, slot: slot?.id ?? `${local.date} manual`, reason: `asked for by hand (${where})` };
  if (!slot) return { run: false, slot: null, reason: `${where} is outside the morning (8:00 to 12:00) and evening (20:00 to 24:00) windows: nothing to do` };
  if (done.includes(slot.id)) return { run: false, slot: slot.id, reason: `the ${slot.id} refresh has already run (${where})` };
  return { run: true, slot: slot.id, reason: `${where}: the ${slot.id} refresh is due` };
}

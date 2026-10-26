// Budget-Sollbeträge mit Verlauf (gelten ab einem Monat) und «Automatisch buchen».
// Automatisch gebuchte Positionen erzeugen monatlich eine Buchung in Höhe des Sollbetrags; sobald im Monat in derselben
// Kategorie manuell etwas erfasst wird, ersetzt es die automatische Buchung dieses Monats.
import { db } from './store.js';

export const monthOf = date => date.slice(0, 7);
export const nextMonth = m => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export function monthsBetween(from, to) {
  const out = [];
  for (let m = from, i = 0; m <= to && i < 1200; m = nextMonth(m), i++) out.push(m);
  return out;
}

/** Sollbetrag einer Position für einen Monat (YYYY-MM). */
export function sollAt(name, month) {
  const s = db().settings, hist = s.budgetHist?.[name];
  if (hist?.length) {
    let a = hist[0].amount;
    for (const h of hist) if (h.from <= month) a = h.amount;
    return a;
  }
  return Number(s.budget?.[name]) || 0;
}

/** Sollbetrag ab einem Monat ändern (frühere Monate behalten ihren Betrag). */
export function setSoll(name, month, amount) {
  const s = db().settings;
  s.budget ||= {}; s.budgetHist ||= {};
  const had = s.budgetHist[name] || (s.budget[name] ? [{ from: '0000-01', amount: Number(s.budget[name]) }] : []);
  const hist = had.filter(h => h.from !== month);
  hist.push({ from: month, amount });
  hist.sort((a, b) => a.from.localeCompare(b.from));
  s.budgetHist[name] = hist;
  const latest = hist.at(-1).amount;
  if (latest > 0) s.budget[name] = latest; else delete s.budget[name];
}

/** Sollbetrag ohne Verlauf setzen (Excel-Import). */
export function setSollFlat(name, amount) {
  const s = db().settings;
  s.budget ||= {};
  if (s.budgetHist) delete s.budgetHist[name];
  if (amount > 0) s.budget[name] = amount; else delete s.budget[name];
}

export const autoCfg = () => (db().settings.budgetAuto ||= {});
export function setAuto(name, on, fromMonth, kind) {
  const a = autoCfg();
  if (on) a[name] = { from: fromMonth, kind }; else delete a[name];
}
export const skipBudget = (category, date) => {
  const s = db().settings;
  (s.budgetSkip ||= []).push(`${category}|${monthOf(date)}`);
};

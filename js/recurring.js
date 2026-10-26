// Wiederkehrende Einträge (Daueraufträge): Rhythmus 1–12 Monate, Stichtag-Anpassungen (Lohn-/Prämienerhöhung),
// 13. Monatslohn. Aus jeder Regel werden die fälligen Buchungen automatisch erzeugt (feste IDs, daher geräteübergreifend eindeutig).
import { db } from './store.js';
import { today, fmtDate } from './util.js';
import * as fx from './fx.js';
import { txChf, inRange } from './calc.js';
import { isSavings, groupOf } from './categories.js';

export const INTERVAL_OPTIONS = [
  ['0', 'Einmalig'], ['1', 'Jeden Monat'], ...Array.from({ length: 10 }, (_, i) => [String(i + 2), `Alle ${i + 2} Monate`]),
  ['12', 'Jährlich'], ['24', 'Alle 2 Jahre'], ['36', 'Alle 3 Jahre'], ['60', 'Alle 5 Jahre'],
];
export const MAX_INTERVAL = 60;
export const intervalLabel = n => (n === 1 ? 'monatlich' : n === 12 ? 'jährlich' : n % 12 === 0 ? `alle ${n / 12} Jahre` : `alle ${n} Monate`);
export const isSalary = (kind, category) => kind === 'income' && /lohn/i.test(category || '');
const round2 = n => Math.round(n * 100) / 100;

/** Grundbetrag (ohne 13. Monatslohn) an einem Stichtag. */
export function baseAt(rule, date) {
  let a = rule.amounts[0].amount;
  for (const c of rule.amounts) if (c.from <= date) a = c.amount;
  return a;
}
/** Betrag je Buchung: bei 13. Monatslohn wird ein zusätzlicher Monatslohn auf 12 Monate verteilt (×13/12). */
export const effectiveAt = (rule, date) => round2(baseAt(rule, date) * (rule.thirteenth ? 13 / 12 : 1));

/** Fälligkeitsdaten ab Start bis und mit `until`. Monatsende wird berücksichtigt (31. -> 28./30.). */
export function occurrences(rule, until) {
  const out = [];
  const [y, m, d] = rule.start.split('-').map(Number);
  const last = rule.end && rule.end < until ? rule.end : until;
  for (let k = 0; k < 1200; k++) {
    const first = new Date(y, m - 1 + k * rule.interval, 1);
    const day = Math.min(d, new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate());
    const date = fmtDate(new Date(first.getFullYear(), first.getMonth(), day));
    if (date > last) break;
    out.push(date);
  }
  return out;
}

const txId = (rule, date) => `r:${rule.id}:${date}`;
const fields = (rule, date) => ({
  date, category: rule.category, description: rule.description || '', amount: effectiveAt(rule, date),
  currency: rule.currency, account: rule.account || '',
});

/** Erzeugt/aktualisiert/entfernt automatische Buchungen. true = Daten haben sich geändert (danach speichern). */
export function materialize(now = today()) {
  const d = db();
  if (!d) return false;
  d.recurring ||= [];
  let changed = false;
  const rules = new Map(d.recurring.map(r => [r.id, r]));

  for (const kind of ['income', 'expense']) {
    const existing = new Map(d[kind].filter(t => t.recId).map(t => [t.id, t]));
    const valid = new Set();
    for (const rule of d.recurring.filter(r => r.kind === kind)) {
      for (const date of occurrences(rule, now)) {
        if (rule.skip?.includes(date)) continue;
        const id = txId(rule, date);
        valid.add(id);
        const want = fields(rule, date), t = existing.get(id);
        if (!t) {
          d[kind].push({ id, recId: rule.id, ...want, ...(rule.shared ? { shared: true } : {}) });
          changed = true;
        } else if (!t.manual) {
          for (const [k, v] of Object.entries(want)) if (t[k] !== v) { t[k] = v; changed = true; }
          if (!!t.shared !== !!rule.shared) { if (rule.shared) t.shared = true; else delete t.shared; changed = true; }
        }
      }
    }
    // Automatische Buchungen, die nicht mehr zur Regel passen (Ende vorverlegt, Start geändert, übersprungen)
    const keep = d[kind].filter(t => !(t.recId && rules.has(t.recId) && !t.manual && !valid.has(t.id)));
    if (keep.length !== d[kind].length) { d[kind] = keep; changed = true; }
  }
  return changed;
}

export function newRule(kind, v) {
  return {
    id: crypto.randomUUID(), kind, category: v.category, description: v.description || '', currency: v.currency || 'CHF',
    account: v.account || '', interval: v.interval, start: v.start, end: v.end || '',
    thirteenth: !!v.thirteenth && isSalary(kind, v.category) && v.interval === 1,
    amounts: [{ from: v.start, amount: v.amount }], skip: [],
    ...(v.shared ? { shared: true } : {}),
  };
}

/** Anpassung ab Stichtag (neuer Betrag oder Prozentänderung auf den dann gültigen Betrag). */
export function addChange(rule, from, { amount, percent }) {
  const base = baseAt(rule, from);
  const next = amount != null ? amount : round2(base * (1 + percent / 100));
  const i = rule.amounts.findIndex(c => c.from === from);
  if (i === 0 || (i < 0 && from < rule.amounts[0].from)) {
    // Änderung vor/auf dem Startdatum: Startbetrag ersetzen
    rule.amounts[0] = { from: rule.amounts[0].from, amount: next };
  } else if (i > 0) rule.amounts[i] = { from, amount: next };
  else rule.amounts.push({ from, amount: next });
  rule.amounts.sort((a, b) => a.from.localeCompare(b.from));
  return next;
}

/** Regel löschen. withEntries: auch bereits erzeugte Buchungen löschen, sonst als normale Einträge behalten. */
export function deleteRule(rule, withEntries) {
  const d = db();
  d.recurring = d.recurring.filter(r => r.id !== rule.id);
  for (const kind of ['income', 'expense']) {
    if (withEntries) d[kind] = d[kind].filter(t => t.recId !== rule.id);
    else for (const t of d[kind]) if (t.recId === rule.id) { delete t.recId; delete t.manual; }
  }
}

/** Mehrjahresplanung: laufendes Jahr = Ist-Buchungen + noch fällige Planbuchungen, Folgejahre = Planung aus wiederkehrenden Einträgen
 *  (inkl. Stichtag-Anpassungen) und zukünftig datierten Einzelbuchungen. Alle Beträge in CHF. */
export function projection(nYears, now = today()) {
  const d = db(), y0 = +now.slice(0, 4);
  let missingFx = false;
  const out = [];
  for (let i = 0; i < nYears; i++) {
    const Y = y0 + i, span = [`${Y}-01-01`, `${Y}-12-31`];
    const y = { year: Y, income: 0, expense: 0, savings: 0, groups: { income: new Map(), expense: new Map() } };
    const add = (kind, category, chf) => {
      const sav = kind === 'expense' && isSavings(category);
      if (sav) y.savings += chf; else y[kind] += chf;
      const bucket = sav ? 'Vorsorge & Vermögensaufbau' : groupOf(category);
      const m = y.groups[kind];
      m.set(bucket, (m.get(bucket) || 0) + chf);
    };
    for (const kind of ['income', 'expense']) for (const t of d[kind]) if (inRange(t, span)) add(kind, t.category, txChf(t));
    for (const rule of d.recurring || []) {
      const rate = fx.latest(rule.currency);
      if (rate == null) missingFx = true;
      for (const date of occurrences(rule, span[1])) {
        if (date < span[0] || date <= now || rule.skip?.includes(date)) continue;
        add(rule.kind, rule.category, effectiveAt(rule, date) * (rate ?? 0));
      }
    }
    y.free = y.income - y.expense;
    y.rest = y.free - y.savings;
    out.push(y);
  }
  let cum = 0;
  for (const y of out) { cum += y.rest; y.cum = cum; }
  return { years: out, missingFx };
}

// Wiederkehrende Einträge (Daueraufträge): Rhythmus 1–12 Monate, Stichtag-Anpassungen (Lohn-/Prämienerhöhung),
// 13. Monatslohn. Aus jeder Regel werden die fälligen Buchungen automatisch erzeugt (feste IDs, daher geräteübergreifend eindeutig).
import { db } from './store.js';
import { today, fmtDate } from './util.js';
import * as fx from './fx.js';
import { txChf, inRange } from './calc.js';
import { isSavings, groupOf, lookup, canonical } from './categories.js';
import { sollAt, monthsBetween, monthOf } from './budget.js';

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
/** 13. Monatslohn: 'none' | 'monthly' (anteilig ×13/12) | 'half' (2 × 50 %, zwei Monate) | 'once' (1 × 100 %, ein Monat). */
export const thirteenthMode = r => (r.thirteenth === true ? 'monthly' : r.thirteenth || 'none');
export const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const thirteenthLabel = r => {
  const m = thirteenthMode(r), t = r.t13 || [];
  return m === 'monthly' ? '13. ML anteilig' : m === 'half' ? `13. ML 50 % ${MONTH_NAMES[t[0] - 1]?.slice(0, 3)} + ${MONTH_NAMES[t[1] - 1]?.slice(0, 3)}` : m === 'once' ? `13. ML ${MONTH_NAMES[t[0] - 1]}` : '';
};
export const effectiveAt = (rule, date) => round2(baseAt(rule, date) * (thirteenthMode(rule) === 'monthly' ? 13 / 12 : 1));

/** Zusatzzahlungen des 13. Monatslohns (halbjährlich 2 × 50 % bzw. einmalig 100 %) bis und mit `until`. */
export function extras(rule, until) {
  const mode = thirteenthMode(rule), months = mode === 'half' ? (rule.t13 || []).slice(0, 2) : mode === 'once' ? (rule.t13 || []).slice(0, 1) : [];
  if (!months.length || rule.interval !== 1) return [];
  const out = [], [y0, , d0] = rule.start.split('-').map(Number), yEnd = +until.slice(0, 4);
  const last = rule.end && rule.end < until ? rule.end : until;
  for (let y = y0; y <= yEnd; y++) for (const m of months) {
    const day = Math.min(d0, new Date(y, m, 0).getDate());
    const date = fmtDate(new Date(y, m - 1, day));
    if (date < rule.start || date > last) continue;
    out.push({ date, amount: round2(baseAt(rule, date) * (mode === 'half' ? 0.5 : 1)) });
  }
  return out;
}

/** Alle Buchungen einer Regel: reguläre Fälligkeiten und Zusatzzahlungen (13. Monatslohn). */
export function entries(rule, until) {
  const out = occurrences(rule, until).map(date => ({ date, amount: effectiveAt(rule, date), id: `r:${rule.id}:${date}`, skipKey: date, extra: false }));
  for (const x of extras(rule, until)) out.push({ date: x.date, amount: x.amount, id: `r:${rule.id}:13:${x.date}`, skipKey: `13:${x.date}`, extra: true });
  return out;
}

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
  ...(rule.assetId ? { assetId: rule.assetId } : {}),
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
      for (const e of entries(rule, now)) {
        const { date, id } = e;
        if (rule.skip?.includes(e.skipKey)) continue;
        valid.add(id);
        const want = { ...fields(rule, date), amount: e.amount, ...(e.extra ? { description: `${rule.description ? `${rule.description} – ` : ''}13. Monatslohn`, extra13: true } : {}) };
        const t = existing.get(id);
        if (!t) {
          d[kind].push({ id, recId: rule.id, ...want, ...(rule.shared ? { shared: true } : {}) });
          changed = true;
        } else if (!t.manual) {
          for (const [k, v] of Object.entries(want)) if (t[k] !== v) { t[k] = v; changed = true; }
          if (!rule.assetId && t.assetId) { delete t.assetId; changed = true; }
          if (!!t.shared !== !!rule.shared) { if (rule.shared) t.shared = true; else delete t.shared; changed = true; }
        }
      }
    }
    // Automatische Buchungen, die nicht mehr zur Regel passen (Ende vorverlegt, Start geändert, übersprungen)
    const keep = d[kind].filter(t => !(t.recId && rules.has(t.recId) && !t.manual && !valid.has(t.id)));
    if (keep.length !== d[kind].length) { d[kind] = keep; changed = true; }
  }
  if (materializeBudget(now)) changed = true;
  return changed;
}

/** «Automatisch buchen» im Budgetplan: Sollbetrag je Monat als Buchung, ausser es wurde manuell etwas erfasst. */
function materializeBudget(now) {
  const d = db(), s = d.settings, auto = s.budgetAuto || {}, skip = new Set(s.budgetSkip || []);
  const nowMonth = monthOf(now);
  let changed = false;
  const isAutoTx = t => t.auto === 'budget' && !t.manual;
  const present = new Set();
  for (const kind of ['income', 'expense']) for (const t of d[kind]) if (!isAutoTx(t)) present.add(`${kind}|${canonical(t.category)}|${monthOf(t.date)}`);
  const valid = new Set();
  for (const [name, cfg] of Object.entries(auto)) {
    const kind = lookup(name)?.kind ?? cfg.kind ?? 'expense';
    if (kind === 'income') continue; // Einnahmen werden nur als Ist geführt (kein Soll/Automatik)
    const byId = new Map(d[kind].filter(t => t.auto === 'budget').map(t => [t.id, t]));
    for (const m of monthsBetween(cfg.from, nowMonth)) {
      const id = `b:${name}:${m}`, amt = sollAt(name, m);
      if (skip.has(`${name}|${m}`) || amt <= 0 || present.has(`${kind}|${name}|${m}`)) continue;
      valid.add(id);
      const t = byId.get(id);
      if (!t) { d[kind].push({ id, auto: 'budget', date: `${m}-01`, category: name, description: 'Budget (automatisch)', amount: amt, currency: 'CHF', account: '' }); changed = true; }
      else if (t.amount !== amt || t.category !== name) { t.amount = amt; t.category = name; changed = true; }
    }
  }
  for (const kind of ['income', 'expense']) {
    const keep = d[kind].filter(t => !isAutoTx(t) || valid.has(t.id));
    if (keep.length !== d[kind].length) { d[kind] = keep; changed = true; }
  }
  return changed;
}

/** Normalisiert die 13.-Monatslohn-Angaben (nur bei Lohn und monatlichem Rhythmus). */
export function thirteenthFields(kind, v) {
  const mode = isSalary(kind, v.category) && v.interval === 1 ? (v.thirteenth === true ? 'monthly' : v.thirteenth || 'none') : 'none';
  if (mode === 'half') {
    const t = [...new Set([+v.t13a, +v.t13b])].filter(m => m >= 1 && m <= 12).sort((a, b) => a - b);
    if (t.length !== 2) throw new Error('Halbjährlich: zwei verschiedene Auszahlungsmonate wählen.');
    return { thirteenth: 'half', t13: t };
  }
  if (mode === 'once') {
    const m = +v.t13a;
    if (!(m >= 1 && m <= 12)) throw new Error('Einmalig: Auszahlungsmonat wählen.');
    return { thirteenth: 'once', t13: [m] };
  }
  return { thirteenth: mode === 'monthly' ? 'monthly' : 'none' };
}

export function newRule(kind, v) {
  return {
    id: crypto.randomUUID(), kind, category: v.category, description: v.description || '', currency: v.currency || 'CHF',
    account: v.account || '', interval: v.interval, start: v.start, end: v.end || '',
    ...thirteenthFields(kind, v),
    amounts: [{ from: v.start, amount: v.amount }], skip: [],
    ...(v.shared ? { shared: true } : {}),
    ...(v.assetId ? { assetId: v.assetId } : {}),
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
      for (const e of entries(rule, span[1])) {
        if (e.date < span[0] || e.date <= now || rule.skip?.includes(e.skipKey)) continue;
        add(rule.kind, rule.category, e.amount * (rate ?? 0));
      }
    }
    // Automatisch gebuchte Budgetpositionen für noch nicht angebrochene Monate
    const auto = d.settings.budgetAuto || {}, skip = new Set(d.settings.budgetSkip || []);
    for (const [name, cfg] of Object.entries(auto)) {
      const kind = lookup(name)?.kind ?? cfg.kind ?? 'expense';
      if (kind === 'income') continue;
      for (const m of monthsBetween(`${Y}-01`, `${Y}-12`)) {
        if (m < cfg.from || `${m}-01` <= now || skip.has(`${name}|${m}`)) continue;
        const amt = sollAt(name, m);
        const manual = d[kind].some(t => canonical(t.category) === name && monthOf(t.date) === m);
        if (amt > 0 && !manual) add(kind, name, amt);
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

/** Noch nicht gebuchte, geplante Beträge je Monat (Kategorie -> CHF): Fälligkeiten wiederkehrender Einträge nach heute
 *  und automatisch zu buchende Budgetpositionen künftiger Monate. */
export function plannedByMonth(months, now = today()) {
  const d = db();
  const out = { income: new Map(months.map(m => [m, new Map()])), expense: new Map(months.map(m => [m, new Map()])) };
  const add = (kind, m, cat, chf) => { const mm = out[kind].get(m); mm.set(cat, (mm.get(cat) || 0) + chf); };
  const last = `${months.at(-1)}-31`;
  for (const rule of d.recurring || []) {
    const rate = fx.latest(rule.currency) ?? 0, cat = canonical(rule.category);
    for (const e of entries(rule, last)) {
      const m = monthOf(e.date);
      if (e.date <= now || rule.skip?.includes(e.skipKey) || !out[rule.kind].has(m)) continue;
      add(rule.kind, m, cat, e.amount * rate);
    }
  }
  const skip = new Set(d.settings.budgetSkip || []);
  for (const [name, cfg] of Object.entries(d.settings.budgetAuto || {})) {
    if ((lookup(name)?.kind ?? cfg.kind ?? 'expense') === 'income') continue;
    for (const m of months) {
      if (m < cfg.from || `${m}-01` <= now || skip.has(`${name}|${m}`)) continue;
      const amt = sollAt(name, m);
      const present = d.expense.some(t => canonical(t.category) === name && monthOf(t.date) === m) || out.expense.get(m).has(name);
      if (amt > 0 && !present) add('expense', m, name, amt);
    }
  }
  return out;
}

export const futureIncomeByMonth = (months, now) => plannedByMonth(months, now).income;

// Excel-Export, leere Vorlage und Import (SheetJS, lokal gebündelt: window.XLSX).
import { CURRENCIES } from './fx.js';
import { TYPE_LABELS } from './calc.js';
import { METAL_SYMBOLS } from './market.js';
import { uid, today } from './util.js';
import { isSalary } from './recurring.js';
import { hasHousehold } from './store.js';
import { INCOME_GROUPS, EXPENSE_GROUPS, SAVINGS_GROUPS, canonical, isKnown } from './categories.js';

const TX_COLS = ['Datum', 'Kategorie', 'Beschreibung', 'Betrag', 'Währung', 'Konto', 'Gemeinsam'];
const AS_COLS = ['Typ', 'Name', 'Symbol', 'Börse', 'Menge', 'Einheit', 'Einstandspreis', 'Währung', 'Wechselkurs bei Kauf', 'Manueller Kurs', 'Gemeinsam'];
const TYPE_BY_LABEL = Object.fromEntries(
  Object.entries(TYPE_LABELS).flatMap(([k, v]) => [[v.toLowerCase(), k], [k, k]]).concat([['etf', 'etf'], ['fonds', 'etf']])
);
const METAL_BY_NAME = { gold: 'XAU', silber: 'XAG', platin: 'XPT', palladium: 'XPD' };

const sheet = (cols, rows, widths) => {
  const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
  ws['!cols'] = widths.map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
};

function help() {
  const rows = [
    ['Anleitung – Umfassendes Budget'],
    [''],
    ['Blatt «Einnahmen» / «Ausgaben»: je Zeile eine Buchung.'],
    ['  Datum: TT.MM.JJJJ oder JJJJ-MM-TT.  Betrag: positive Zahl.  Währung: siehe unten (leer = CHF).'],
    ['  Kategorie: Position aus dem Blatt «Budgetplan» (z. B. «Miete inkl. Nebenkosten (Heizung, Wasser)»); eigene Kategorien sind erlaubt.'],
    ['Blatt «Wiederkehrend»: Art (Einnahme/Ausgabe), Betrag je Zahlung, Start, optional Ende, Intervall in Monaten (1–60; 12 = jährlich, 24 = alle 2 Jahre).'],
    ['  «13. Monatslohn» = ja (nur Kategorien mit «Lohn», Intervall 1): Betrag wird × 13/12 gebucht.'],
    ['  «Anpassungen»: Erhöhungen ab Stichtag als «JJJJ-MM-TT:Betrag; JJJJ-MM-TT:Betrag» (Lohn-/Prämienerhöhung).'],
    ['  «Automatisch buchen» = ja: der Sollbetrag wird ab «Ab Monat» (JJJJ-MM) jeden Monat automatisch als Buchung übernommen; manuell erfasste Buchungen in dieser Kategorie ersetzen den Automatik-Betrag des Monats.'],
    ['Blatt «Budgetplan»: Spalte «Betrag monatlich (CHF)» ausfüllen = geplanter Monatsbetrag je Position (Soll). Leer = kein Budget.'],
    ['Blatt «Vermögen»: je Zeile eine Position.'],
    ['  Typ: Konto, Aktie, ETF, Edelmetall oder Andere.'],
    ['  Konto: Menge = Kontostand, Währung = Kontowährung.'],
    ['  Aktie/ETF: Symbol (z. B. NESN, AAPL), Börse (z. B. SIX, NASDAQ), Menge, Einstandspreis je Stück, Währung des Einstandspreises.'],
    ['  Edelmetall: Symbol XAU (Gold), XAG (Silber), XPT (Platin), XPD (Palladium) oder Name «Gold»/«Silber»; Einheit oz, g oder kg;'],
    ['    Einstandspreis je Einheit.'],
    ['  Wechselkurs bei Kauf (optional): CHF je 1 Einheit Fremdwährung zum Kaufzeitpunkt – für exakten Gewinn/Verlust in CHF.'],
    ['  Andere: «Manueller Kurs» = aktueller Wert je Einheit.'],
    ['Spalte «Gemeinsam»: «ja» = mit dem Haushalt teilen (nur wirksam, wenn du einem Haushalt angehörst).'],
    ['Nach dem Import wird automatisch eine Plausibilitätsprüfung durchgeführt.'],
    [''],
    ['Gültige Währungen:'],
    [CURRENCIES.join(', ')],
    ['Gültige Typen:'],
    [Object.values(TYPE_LABELS).join(', ')],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 130 }];
  return ws;
}

const BUDGET_COLS = ['Bereich', 'Gruppe', 'Position', 'Betrag monatlich (CHF)', 'Hinweis', 'Automatisch buchen', 'Ab Monat'];
function budgetRows(settings = {}) {
  const budget = settings.budget || {}, auto = settings.budgetAuto || {};
  const rows = [];
  const row = (bereich, group, name, hint) => [bereich, group, name, budget[name] ?? '', hint || '', auto[name] ? 'ja' : '', auto[name]?.from || ''];
  const add = (bereich, groups) => groups.forEach(g => g.positions.forEach(p => rows.push(row(bereich, g.name, p.name, p.hint))));
  add('Einnahmen', INCOME_GROUPS); add('Ausgaben', EXPENSE_GROUPS); add('Vorsorge', SAVINGS_GROUPS);
  for (const name of new Set([...Object.keys(budget), ...Object.keys(auto)])) if (!isKnown(name)) rows.push(row('Ausgaben', 'Weitere Positionen', name, ''));
  return rows;
}

const REC_COLS = ['Art', 'Kategorie', 'Beschreibung', 'Betrag', 'Währung', 'Konto', 'Start', 'Ende', 'Intervall (Monate)', '13. Monatslohn', 'Gemeinsam', 'Anpassungen'];
const recRows = (list = []) => list.map(r => [
  r.kind === 'income' ? 'Einnahme' : 'Ausgabe', r.category, r.description || '', r.amounts[0].amount, r.currency, r.account || '', r.start, r.end || '',
  r.interval, r.thirteenth ? 'ja' : '', r.shared ? 'ja' : '', r.amounts.slice(1).map(c => `${c.from}:${c.amount}`).join('; '),
]);

function workbook(d) {
  const tx = l => l.map(t => [t.date, t.category, t.description || '', t.amount, t.currency, t.account || '', t.shared ? 'ja' : '']);
  const as = l => l.map(a => [
    TYPE_LABELS[a.type], a.name, a.symbol || '', a.exchange || '', a.qty, a.unit || '',
    a.costPrice ?? '', a.currency, a.costFx ?? '', a.manualPrice ?? '', a.shared ? 'ja' : '',
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(TX_COLS, tx(d.income), [12, 20, 36, 12, 9, 18, 11]), 'Einnahmen');
  XLSX.utils.book_append_sheet(wb, sheet(TX_COLS, tx(d.expense), [12, 20, 36, 12, 9, 18, 11]), 'Ausgaben');
  XLSX.utils.book_append_sheet(wb, sheet(AS_COLS, as(d.assets), [12, 28, 12, 10, 12, 8, 15, 9, 20, 14, 11]), 'Vermögen');
  XLSX.utils.book_append_sheet(wb, sheet(BUDGET_COLS, budgetRows(d.settings), [12, 38, 52, 22, 40, 18, 12]), 'Budgetplan');
  XLSX.utils.book_append_sheet(wb, sheet(REC_COLS, recRows(d.recurring), [10, 34, 30, 12, 9, 16, 12, 12, 18, 14, 11, 40]), 'Wiederkehrend');
  XLSX.utils.book_append_sheet(wb, help(), 'Anleitung');
  return wb;
}

const toBytes = wb => XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
// Automatisch erzeugte Buchungen werden nicht exportiert; sie entstehen beim Import aus «Wiederkehrend» neu.
export const exportData = d => toBytes(workbook({ ...d, income: d.income.filter(t => !t.recId && !(t.auto && !t.manual)), expense: d.expense.filter(t => !t.recId && !(t.auto && !t.manual)), settings: d.settings }));
export const exportTemplate = () => toBytes(workbook({ income: [], expense: [], assets: [] }));

// ---------- Import ----------
const norm = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toString().trim().toLowerCase(), v]));
const str = v => (v == null ? '' : String(v).trim());
const isYes = v => /^(ja|j|1|x|true|yes)$/i.test(str(v));
const pad = n => String(n).padStart(2, '0');

function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(+v)) {
    const d = new Date(+v + 12 * 3600e3); // robust gegen SheetJS-Zeitzonenversatz
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
  }
  const s = str(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function valid(y, mo, d) {
  const t = new Date(y, mo - 1, d);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}
function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = str(v).replace(/[’'\s]/g, '').replace(',', '.');
  return s !== '' && /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

function parseTx(rows) {
  return rows.map((raw, i) => {
    const r = norm(raw);
    const errors = [];
    const date = parseDate(r.datum);
    if (!date) errors.push(`Ungültiges Datum «${str(r.datum)}»`);
    let amount = parseNum(r.betrag);
    if (Number.isNaN(amount)) errors.push(`Ungültiger Betrag «${str(r.betrag)}»`);
    const currency = str(r['währung']).toUpperCase() || 'CHF';
    if (!CURRENCIES.includes(currency)) errors.push(`Unbekannte Währung «${currency}»`);
    const negated = amount < 0;
    if (negated) amount = -amount;
    return {
      id: uid(), _row: i + 2, _errors: errors, _negated: negated, _noCategory: !str(r.kategorie),
      date, category: canonical(str(r.kategorie)) || 'Unkategorisiert', description: str(r.beschreibung),
      amount, currency, account: str(r.konto), ...(isYes(r.gemeinsam) && hasHousehold() ? { shared: true } : {}),
    };
  }).filter(r => !(r.date === null && Number.isNaN(r.amount) && !r.description && r._noCategory)); // Leerzeilen
}

function parseAssets(rows) {
  return rows.map((raw, i) => {
    const r = norm(raw);
    const errors = [];
    const name = str(r.name);
    const type = TYPE_BY_LABEL[str(r.typ).toLowerCase()];
    if (!type) errors.push(`Unbekannter Typ «${str(r.typ)}»`);
    if (!name) errors.push('Name fehlt');
    const qty = parseNum(r.menge);
    if (Number.isNaN(qty)) errors.push(`Ungültige Menge «${str(r.menge)}»`);
    const currency = str(r['währung']).toUpperCase() || 'CHF';
    if (!CURRENCIES.includes(currency)) errors.push(`Unbekannte Währung «${currency}»`);
    let symbol = str(r.symbol).toUpperCase();
    if (type === 'edelmetall') {
      symbol = symbol || METAL_BY_NAME[name.toLowerCase()] || '';
      if (!METAL_SYMBOLS[symbol]) errors.push('Edelmetall braucht Symbol XAU, XAG, XPT oder XPD');
    }
    const unit = type === 'edelmetall' ? (str(r.einheit).toLowerCase() || 'oz') : '';
    if (unit && !['oz', 'g', 'kg'].includes(unit)) errors.push(`Unbekannte Einheit «${unit}»`);
    const opt = v => { const n = parseNum(v); return str(v) === '' || Number.isNaN(n) ? '' : n; };
    return {
      id: uid(), _row: i + 2, _errors: errors, type, name, symbol, exchange: str(r['börse']).toUpperCase(),
      qty, unit, currency, costPrice: opt(r.einstandspreis), costFx: opt(r['wechselkurs bei kauf']) || undefined,
      manualPrice: opt(r['manueller kurs']), ...(isYes(r.gemeinsam) && hasHousehold() ? { shared: true } : {}),
    };
  }).filter(r => r.name || r._errors.length > 1);
}

function parseRecurring(rows) {
  const out = [];
  rows.forEach((raw, i) => {
    const r = norm(raw), errors = [];
    if (!str(r.art) && !str(r.kategorie) && str(r.betrag) === '') return;
    const art = str(r.art).toLowerCase();
    const kind = art.startsWith('einn') ? 'income' : art.startsWith('ausg') ? 'expense' : null;
    if (!kind) errors.push(`Art muss «Einnahme» oder «Ausgabe» sein («${str(r.art)}»)`);
    const start = parseDate(r.start); if (!start) errors.push(`Ungültiges Startdatum «${str(r.start)}»`);
    const end = str(r.ende) === '' ? '' : parseDate(r.ende); if (end === null) errors.push(`Ungültiges Enddatum «${str(r.ende)}»`);
    if (start && end && end < start) errors.push('Ende liegt vor dem Start');
    const amount = parseNum(r.betrag); if (Number.isNaN(amount) || amount < 0) errors.push(`Ungültiger Betrag «${str(r.betrag)}»`);
    const interval = parseNum(r['intervall (monate)']); if (!Number.isInteger(interval) || interval < 1 || interval > 60) errors.push('Intervall muss 1–60 Monate sein (12 = jährlich)');
    const currency = str(r['währung']).toUpperCase() || 'CHF'; if (!CURRENCIES.includes(currency)) errors.push(`Unbekannte Währung «${currency}»`);
    if (!str(r.kategorie)) errors.push('Kategorie fehlt');
    const changes = [];
    for (const part of str(r.anpassungen).split(';').map(s => s.trim()).filter(Boolean)) {
      const [dt, amt] = part.split(':'), d = parseDate(dt), a = parseNum(amt);
      if (!d || Number.isNaN(a) || a < 0) errors.push(`Ungültige Anpassung «${part}» (Format JJJJ-MM-TT:Betrag)`); else changes.push({ from: d, amount: a });
    }
    const category = canonical(str(r.kategorie));
    const interv = errors.length ? 1 : interval;
    out.push({
      _row: i + 2, _errors: errors, id: uid(), kind, category, description: str(r.beschreibung), currency, account: str(r.konto),
      interval: interv, start, end: end || '', thirteenth: isYes(r['13. monatslohn']) && isSalary(kind, category) && interv === 1,
      amounts: [{ from: start, amount }, ...changes.filter(c => c.from > start).sort((a, b) => a.from.localeCompare(b.from))], skip: [],
      ...(isYes(r.gemeinsam) && hasHousehold() ? { shared: true } : {}),
    });
  });
  return out;
}

function parseBudget(rows) {
  const out = [];
  const hasAuto = rows.some(r => Object.keys(r).some(k => k.trim().toLowerCase() === 'automatisch buchen'));
  rows.forEach((raw, i) => {
    const r = norm(raw), name = canonical(str(r.position)), v = parseNum(r['betrag monatlich (chf)']);
    if (!name || str(r['betrag monatlich (chf)']) === '') return;
    const errors = Number.isNaN(v) || v < 0 ? [`Ungültiger Budgetbetrag «${str(r['betrag monatlich (chf)'])}»`] : [];
    const fromRaw = str(r['ab monat']);
    let from = /^\d{4}-\d{2}$/.test(fromRaw) ? fromRaw : (parseDate(r['ab monat'])?.slice(0, 7) || '');
    if (isYes(r['automatisch buchen']) && fromRaw && !from) errors.push(`Ungültiger Monat «${fromRaw}» (Format JJJJ-MM)`);
    out.push({ _row: i + 2, name, amount: v, _errors: errors, auto: hasAuto ? isYes(r['automatisch buchen']) : undefined, from: from || today().slice(0, 7), kind: str(r.bereich).toLowerCase().startsWith('einn') ? 'income' : 'expense' });
  });
  return out;
}

export function parse(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const get = name => {
    const ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }) : null;
  };
  const inc = get('Einnahmen'), exp = get('Ausgaben'), ass = get('Vermögen');
  if (!inc && !exp && !ass && !get('Budgetplan') && !get('Wiederkehrend')) throw new Error('Keine Blätter «Einnahmen», «Ausgaben» oder «Vermögen» gefunden');
  return { income: parseTx(inc || []), expense: parseTx(exp || []), assets: parseAssets(ass || []), budget: parseBudget(get('Budgetplan') || []), recurring: parseRecurring(get('Wiederkehrend') || []) };
}

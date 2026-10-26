// Excel-Export, leere Vorlage und Import (SheetJS, lokal gebündelt: window.XLSX).
import { CURRENCIES } from './fx.js';
import { TYPE_LABELS } from './calc.js';
import { METAL_SYMBOLS } from './market.js';
import { uid } from './util.js';

const TX_COLS = ['Datum', 'Kategorie', 'Beschreibung', 'Betrag', 'Währung', 'Konto'];
const AS_COLS = ['Typ', 'Name', 'Symbol', 'Börse', 'Menge', 'Einheit', 'Einstandspreis', 'Währung', 'Wechselkurs bei Kauf', 'Manueller Kurs'];
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
    ['Blatt «Vermögen»: je Zeile eine Position.'],
    ['  Typ: Konto, Aktie, ETF, Edelmetall oder Andere.'],
    ['  Konto: Menge = Kontostand, Währung = Kontowährung.'],
    ['  Aktie/ETF: Symbol (z. B. NESN, AAPL), Börse (z. B. SIX, NASDAQ), Menge, Einstandspreis je Stück, Währung des Einstandspreises.'],
    ['  Edelmetall: Symbol XAU (Gold), XAG (Silber), XPT (Platin), XPD (Palladium) oder Name «Gold»/«Silber»; Einheit oz, g oder kg;'],
    ['    Einstandspreis je Einheit.'],
    ['  Wechselkurs bei Kauf (optional): CHF je 1 Einheit Fremdwährung zum Kaufzeitpunkt – für exakten Gewinn/Verlust in CHF.'],
    ['  Andere: «Manueller Kurs» = aktueller Wert je Einheit.'],
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

function workbook(d) {
  const tx = l => l.map(t => [t.date, t.category, t.description || '', t.amount, t.currency, t.account || '']);
  const as = l => l.map(a => [
    TYPE_LABELS[a.type], a.name, a.symbol || '', a.exchange || '', a.qty, a.unit || '',
    a.costPrice ?? '', a.currency, a.costFx ?? '', a.manualPrice ?? '',
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(TX_COLS, tx(d.income), [12, 20, 36, 12, 9, 18]), 'Einnahmen');
  XLSX.utils.book_append_sheet(wb, sheet(TX_COLS, tx(d.expense), [12, 20, 36, 12, 9, 18]), 'Ausgaben');
  XLSX.utils.book_append_sheet(wb, sheet(AS_COLS, as(d.assets), [12, 28, 12, 10, 12, 8, 15, 9, 20, 14]), 'Vermögen');
  XLSX.utils.book_append_sheet(wb, help(), 'Anleitung');
  return wb;
}

const toBytes = wb => XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
export const exportData = d => toBytes(workbook(d));
export const exportTemplate = () => toBytes(workbook({ income: [], expense: [], assets: [] }));

// ---------- Import ----------
const norm = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toString().trim().toLowerCase(), v]));
const str = v => (v == null ? '' : String(v).trim());
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
      date, category: str(r.kategorie) || 'Unkategorisiert', description: str(r.beschreibung),
      amount, currency, account: str(r.konto),
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
      manualPrice: opt(r['manueller kurs']),
    };
  }).filter(r => r.name || r._errors.length > 1);
}

export function parse(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const get = name => {
    const ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }) : null;
  };
  const inc = get('Einnahmen'), exp = get('Ausgaben'), ass = get('Vermögen');
  if (!inc && !exp && !ass) throw new Error('Keine Blätter «Einnahmen», «Ausgaben» oder «Vermögen» gefunden');
  return { income: parseTx(inc || []), expense: parseTx(exp || []), assets: parseAssets(ass || []) };
}

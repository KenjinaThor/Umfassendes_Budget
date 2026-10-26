// Berechnungen: Perioden, Summen, Positionsbewertung (Gewinn/Verlust).
import { db } from './store.js';
import * as fx from './fx.js';
import { OZ_PER_UNIT } from './market.js';
import { fmtDate, monthKey, sum } from './util.js';

export const PERIODS = {
  m0: 'Dieser Monat',
  m1: 'Letzter Monat',
  ytd: 'Laufendes Jahr',
  y1: 'Letztes Jahr',
  l12: 'Letzte 12 Monate',
  all: 'Gesamter Zeitraum',
};

export function range(p, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = (Y, M, D) => fmtDate(new Date(Y, M, D));
  switch (p) {
    case 'm0': return [d(y, m, 1), d(y, m + 1, 0)];
    case 'm1': return [d(y, m - 1, 1), d(y, m, 0)];
    case 'ytd': return [d(y, 0, 1), d(y, m, now.getDate())];
    case 'y1': return [d(y - 1, 0, 1), d(y - 1, 11, 31)];
    case 'l12': return [d(y, m - 11, 1), d(y, m + 1, 0)];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

/** Vergleichszeitraum (unmittelbar davor bzw. Vorjahr). */
export function prevRange(p, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = (Y, M, D) => fmtDate(new Date(Y, M, D));
  switch (p) {
    case 'm0': return range('m1', now);
    case 'm1': return [d(y, m - 2, 1), d(y, m - 1, 0)];
    case 'ytd': return [d(y - 1, 0, 1), d(y - 1, m, now.getDate())];
    case 'y1': return [d(y - 2, 0, 1), d(y - 2, 11, 31)];
    case 'l12': return [d(y, m - 23, 1), d(y, m - 11, 0)];
    default: return null;
  }
}

/** CHF-Wert einer Buchung (Kurs zum Buchungsdatum, sonst letzter bekannter Kurs). */
export const txChf = t => t.amount * (t.currency === 'CHF' ? 1 : (t.rate ?? fx.latest(t.currency) ?? 0));

export const inRange = (t, [from, to]) => t.date >= from && t.date <= to;
export const totalIn = (list, r) => sum(list.filter(t => inRange(t, r)), txChf);

export function byCategory(list, r) {
  const m = new Map();
  for (const t of list) if (inRange(t, r)) m.set(t.category || 'Unkategorisiert', (m.get(t.category || 'Unkategorisiert') || 0) + txChf(t));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function lastMonths(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(fmtDate(new Date(now.getFullYear(), now.getMonth() - i, 1))));
  return out;
}

export function monthlySeries(n) {
  const keys = lastMonths(n);
  const agg = list => keys.map(k => sum(list.filter(t => monthKey(t.date) === k), txChf));
  return { keys, income: agg(db().income), expense: agg(db().expense) };
}

/** Bewertung einer Vermögensposition. Alle Werte in CHF und in der jeweiligen Währung. */
export function valuate(a) {
  const qty = Number(a.qty) || 0;
  const cur = a.currency || 'CHF';
  let price = null, priceCur = cur, prev = null;

  if (a.type === 'konto') {
    price = 1;
  } else if (a.type === 'edelmetall' && a.quote) {
    const f = OZ_PER_UNIT[a.unit || 'oz'];
    price = a.quote.price * f;
    priceCur = a.quote.currency;
    const p = a.quote.prev ?? (a.prevClose?.date < a.quote.date ? a.prevClose.price : null);
    prev = p != null ? p * f : null;
  } else if (a.quote) {
    price = a.quote.price;
    priceCur = a.quote.currency || cur;
    prev = a.quote.prev ?? (a.prevClose && a.prevClose.date < a.quote.date ? a.prevClose.price : null);
  } else if (a.manualPrice != null && a.manualPrice !== '') {
    price = Number(a.manualPrice);
  }

  const rPrice = fx.latest(priceCur);
  const rCost = a.costFx || fx.latest(cur);
  const hasValue = price != null && rPrice != null;
  const valueChf = hasValue ? qty * price * rPrice : null;
  const hasCost = a.type !== 'konto' && a.costPrice !== '' && a.costPrice != null && rCost != null;
  const costChf = hasCost ? qty * Number(a.costPrice) * rCost : null;
  const pnlChf = valueChf != null && costChf != null ? valueChf - costChf : null;
  const pnlPct = pnlChf != null && costChf > 0 ? (pnlChf / costChf) * 100 : null;
  const dayChf = hasValue && prev != null ? qty * (price - prev) * rPrice : null;
  const dayPct = price != null && prev ? ((price - prev) / prev) * 100 : null;

  return {
    a, qty, price, priceCur, valueCur: price != null ? qty * price : null,
    valueChf, costChf, pnlChf, pnlPct, dayChf, dayPct,
    needsFx: price != null && rPrice == null,
    stale: a.quote ? a.quote.date : null,
  };
}

export function portfolio() {
  const rows = db().assets.map(valuate);
  const total = sum(rows, r => r.valueChf);
  const invested = rows.filter(r => r.pnlChf != null);
  const cost = sum(invested, r => r.costChf);
  const pnl = sum(invested, r => r.pnlChf);
  return {
    rows, total, cost, pnl,
    pnlPct: cost > 0 ? (pnl / cost) * 100 : null,
    day: sum(rows, r => r.dayChf),
    needsFx: rows.some(r => r.needsFx),
  };
}

export const TYPE_LABELS = { konto: 'Konto', aktie: 'Aktie', etf: 'ETF/Fonds', edelmetall: 'Edelmetall', andere: 'Andere' };

export function allocationByType() {
  const m = new Map();
  for (const r of portfolio().rows) if (r.valueChf != null) m.set(TYPE_LABELS[r.a.type] || r.a.type, (m.get(TYPE_LABELS[r.a.type] || r.a.type) || 0) + r.valueChf);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Tages-Schnappschuss des Gesamtvermögens für den Verlaufs-Chart. */
export function takeSnapshot() {
  const p = portfolio();
  if (!p.rows.length || p.needsFx) return;
  const date = fmtDate(new Date());
  const snaps = db().snapshots.filter(s => s.date !== date);
  snaps.push({ date, total: Math.round(p.total * 100) / 100, cost: Math.round(p.cost * 100) / 100 });
  db().snapshots = snaps.sort((a, b) => a.date.localeCompare(b.date)).slice(-3650);
}

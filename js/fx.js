// Wechselkurse (EZB-Referenzkurse via frankfurter.dev, kostenlos, ohne Schlüssel). Zielwährung: CHF.
export const CURRENCIES = [
  'CHF', 'EUR', 'USD', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
  'CNY', 'HKD', 'SGD', 'KRW', 'INR', 'BRL', 'MXN', 'ZAR', 'TRY', 'ILS', 'THB', 'MYR', 'IDR', 'PHP', 'RON', 'ISK',
];
const API = 'https://api.frankfurter.dev/v1';
const KEY = 'fx-cache-v1';

let cache = { latest: {}, hist: {} }; // latest[cur] = {rate, date}; hist["USD@2026-01-05"] = rate (cur -> CHF)
try { cache = { ...cache, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* leer */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* voll/gesperrt */ } };

/** Letzter bekannter Kurs (synchron, aus dem Cache). 1 CHF = ? -> hier: 1 cur = x CHF */
export function latest(cur) {
  if (!cur || cur === 'CHF') return 1;
  return cache.latest[cur]?.rate ?? null;
}
export const latestDate = () => Object.values(cache.latest)[0]?.date ?? null;

/** Alle benötigten Währungen mit einem Aufruf aktualisieren. */
export async function refresh(currencies) {
  const need = [...new Set(currencies)].filter(c => c && c !== 'CHF');
  if (!need.length) return;
  const r = await fetch(`${API}/latest?base=CHF&symbols=${need.join(',')}`);
  if (!r.ok) throw new Error(`Wechselkurse: HTTP ${r.status}`);
  const j = await r.json();
  for (const [cur, perChf] of Object.entries(j.rates)) cache.latest[cur] = { rate: 1 / perChf, date: j.date };
  persist();
}

/** Historischer Kurs zum Buchungsdatum (für korrekte CHF-Werte alter Buchungen). */
export async function rateAt(cur, date) {
  if (cur === 'CHF') return 1;
  const k = `${cur}@${date}`;
  if (cache.hist[k]) return cache.hist[k];
  const r = await fetch(`${API}/${date}?base=${cur}&symbols=CHF`);
  if (!r.ok) throw new Error(`Wechselkurs ${cur}: HTTP ${r.status}`);
  const rate = (await r.json()).rates.CHF;
  cache.hist[k] = rate;
  persist();
  return rate;
}

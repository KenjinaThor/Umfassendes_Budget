// Börsen- und Metallkurse. Anbieter sind austauschbar gekapselt.
//  - Aktien/ETFs: Twelve Data (twelvedata.com), eigener kostenloser API-Schlüssel in den Einstellungen.
//  - Edelmetalle: gold-api.com (ohne Schlüssel, Preis je Feinunze in USD).
import { today, sleep } from './util.js';

export const OZ_PER_UNIT = { oz: 1, g: 1 / 31.1034768, kg: 1000 / 31.1034768 };
export const METAL_SYMBOLS = { XAU: 'Gold', XAG: 'Silber', XPT: 'Platin', XPD: 'Palladium' };

async function twelveData(a, apiKey) {
  const p = new URLSearchParams({ symbol: a.symbol, apikey: apiKey });
  if (a.exchange) p.set('exchange', a.exchange);
  const r = await fetch(`https://api.twelvedata.com/quote?${p}`);
  const j = await r.json();
  if (j.status === 'error' || j.code) throw new Error(j.message || `Twelve Data HTTP ${r.status}`);
  return { price: +j.close, prev: +j.previous_close || null, currency: j.currency || a.currency };
}

async function metal(a) {
  const r = await fetch(`https://api.gold-api.com/price/${encodeURIComponent(a.symbol)}`);
  if (!r.ok) throw new Error(`gold-api HTTP ${r.status}`);
  const j = await r.json();
  if (!Number.isFinite(+j.price)) throw new Error('Kein Preis erhalten');
  return { price: +j.price, prev: null, currency: 'USD' };
}

/** Aktualisiert asset.quote für alle Positionen mit Börsenkurs. Gibt Fehlerliste zurück. */
export async function refreshQuotes(assets, apiKey) {
  const errors = [];
  const t = today();
  const list = assets.filter(a => ['aktie', 'etf', 'edelmetall'].includes(a.type) && a.symbol);
  let calls = 0;
  for (const a of list) {
    try {
      let q;
      if (a.type === 'edelmetall') q = await metal(a);
      else if (!apiKey) throw new Error('Kein Twelve-Data-Schlüssel hinterlegt');
      else {
        if (calls++ >= 8) await sleep(7500); // Gratis-Kontingent: 8 Abfragen/Minute
        q = await twelveData(a, apiKey);
      }
      // Vortageskurs: vom Anbieter, sonst letzter Kurs eines früheren Tages
      if (a.quote && a.quote.date !== t) a.prevClose = { date: a.quote.date, price: a.quote.price };
      a.quote = { ...q, date: t, ts: Date.now() };
    } catch (e) {
      errors.push(`${a.name}: ${e.message}`);
    }
  }
  return errors;
}

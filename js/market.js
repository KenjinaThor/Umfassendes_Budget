// Börsen- und Metallkurse. Anbieter sind austauschbar gekapselt.
//  - Aktien/ETFs: Twelve Data (twelvedata.com), eigener kostenloser API-Schlüssel in den Einstellungen.
//  - Edelmetalle: gold-api.com (ohne Schlüssel, Preis je Feinunze in USD).
import { today, sleep } from './util.js';
import * as store from './store.js';

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

/** Kurse über die Supabase-Funktion «quotes» (alle Börsen, inkl. SIX). Gibt {assetId: {price, prev, currency} | {error}} zurück. */
async function viaSupabase(stocks) {
  if (!store.isCloud || !stocks.length) return {};
  try {
    const r = await store.callFunction('quotes', { items: stocks.map(a => ({ id: a.id, symbol: a.symbol, exchange: a.exchange })) });
    return r?.quotes || {};
  } catch (e) {
    return { __error: e.message };
  }
}

/** Aktualisiert asset.quote für alle Positionen mit Börsenkurs. Gibt Fehlerliste zurück. */
export async function refreshQuotes(assets, apiKey) {
  const errors = [];
  const t = today();
  const list = assets.filter(a => ['aktie', 'etf', 'edelmetall'].includes(a.type) && a.symbol && !a.valueMode);
  const fn = await viaSupabase(list.filter(a => a.type !== 'edelmetall'));
  let calls = 0;
  for (const a of list) {
    try {
      let q;
      if (a.type === 'edelmetall') q = await metal(a);
      else if (fn[a.id]?.price != null) q = { price: fn[a.id].price, prev: fn[a.id].prev ?? null, currency: fn[a.id].currency || a.currency };
      else if (apiKey) {
        if (calls++ >= 8) await sleep(7500); // Gratis-Kontingent: 8 Abfragen/Minute
        q = await twelveData(a, apiKey);
      } else throw new Error(fn[a.id]?.error || fn.__error || 'Kein Kurs: Kurs-Funktion (Supabase) oder Twelve-Data-Schlüssel nötig');
      // Vortageskurs: vom Anbieter, sonst letzter Kurs eines früheren Tages
      if (a.quote && a.quote.date !== t) a.prevClose = { date: a.quote.date, price: a.quote.price };
      a.quote = { ...q, date: t, ts: Date.now() };
      delete a.quoteError;
    } catch (e) {
      errors.push(`${a.name}: ${e.message}`);
      a.quoteError = e.message;
    }
  }
  return errors;
}

/** Prüft Symbol/Börse über die Supabase-Funktion, ohne etwas zu speichern. Gibt {ok, text} zurück. */
export async function checkSymbol(symbol, exchange) {
  if (!store.isCloud) return { ok: false, text: 'Die Kursprüfung braucht den Cloud-Modus (Supabase-Funktion «quotes»).' };
  if (!String(symbol || '').trim()) return { ok: false, text: 'Bitte zuerst ein Symbol eintragen.' };
  try {
    const r = await store.callFunction('quotes', { items: [{ id: 'check', symbol, exchange }] });
    const q = r?.quotes?.check;
    if (q?.price != null) return { ok: true, text: `✓ Gefunden: ${q.name || q.symbol || symbol} – ${q.currency || ''} ${q.price.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${q.symbol ? ` (Yahoo: ${q.symbol})` : ''}` };
    return { ok: false, text: `✗ ${q?.error || 'Kein Kurs gefunden'} – Symbol und Börse prüfen (z. B. NESN + SIX oder NESN.SW)` };
  } catch (e) {
    return { ok: false, text: `✗ ${e.message}` };
  }
}

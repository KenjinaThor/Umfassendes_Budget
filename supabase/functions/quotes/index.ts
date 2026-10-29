// Supabase Edge Function «quotes»: liefert aktuelle Börsenkurse (Yahoo Finance, inoffiziell, kostenlos) für Aktien/ETFs
// aller wichtigen Börsen, auch SIX (Schweiz). Die App ruft sie mit der Anmeldung des Benutzers auf; Beträge/Mengen werden nie übertragen,
// nur Symbol und Börse. Deployment: siehe docs/KURSE.md
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Börsenkürzel der App -> Yahoo-Suffix
const SUFFIX = {
  SIX: '.SW', XSWX: '.SW', XETR: '.DE', XFRA: '.F', FWB: '.F', LSE: '.L', XLON: '.L', XPAR: '.PA', EURONEXT: '.PA', XAMS: '.AS',
  XMIL: '.MI', XMAD: '.MC', XSTO: '.ST', XCSE: '.CO', XHEL: '.HE', XOSL: '.OL', TSX: '.TO', HKEX: '.HK', SSE: '.SS', SZSE: '.SZ',
  NSE: '.NS', TSE: '.T', ASX: '.AX',
};
const cache = new Map(); // yahoo-Symbol -> { at, q }
const TTL = 5 * 60 * 1000;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function yahooSymbol(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-=^]{0,19}$/.test(s)) return null;
  if (s.includes('.')) return s; // Yahoo-Symbol direkt angegeben, z. B. NESN.SW
  return s + (SUFFIX[String(exchange || '').trim().toUpperCase()] || '');
}

async function quote(ysym) {
  const hit = cache.get(ysym);
  if (hit && Date.now() - hit.at < TTL) return hit.q;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?range=5d&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BudgetApp/1.0)', Accept: 'application/json' }, signal: ctl.signal,
    });
    if (r.status === 404) return { error: 'Symbol nicht gefunden' };
    if (!r.ok) return { error: `Kursdienst HTTP ${r.status}` };
    const res = (await r.json())?.chart?.result?.[0];
    const meta = res?.meta;
    if (!meta || !Number.isFinite(meta.regularMarketPrice)) return { error: 'Kein Kurs verfügbar' };
    const closes = (res.indicators?.quote?.[0]?.close || []).filter(v => Number.isFinite(v));
    let price = meta.regularMarketPrice;
    let prev = closes.length >= 2 ? closes[closes.length - 2] : (Number.isFinite(meta.previousClose) ? meta.previousClose : null);
    let currency = meta.currency || '';
    if (currency === 'GBp' || currency === 'GBX') { price /= 100; prev = prev == null ? null : prev / 100; currency = 'GBP'; } // London: Pence
    const q = { price, prev, currency, name: meta.shortName || meta.longName || '', symbol: ysym };
    cache.set(ysym, { at: Date.now(), q });
    return q;
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'Zeitüberschreitung beim Kursdienst' : 'Kursdienst nicht erreichbar' };
  } finally {
    clearTimeout(timer);
  }
}

export async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  let items;
  try { items = (await req.json()).items; } catch { return json({ error: 'Ungültige Anfrage' }, 400); }
  if (!Array.isArray(items) || items.length === 0 || items.length > 40) return json({ error: 'Ungültige Anfrage (1–40 Positionen)' }, 400);
  const quotes = {}, pending = new Map(); // gleiche Symbole nur einmal abfragen
  await Promise.all(items.map(async it => {
    const ysym = yahooSymbol(it?.symbol, it?.exchange);
    if (!ysym) { quotes[String(it?.id)] = { error: 'Ungültiges Symbol' }; return; }
    if (!pending.has(ysym)) pending.set(ysym, quote(ysym));
    quotes[String(it?.id)] = await pending.get(ysym);
  }));
  return json({ quotes });
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(handler);

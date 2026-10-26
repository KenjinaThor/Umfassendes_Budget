export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const uid = () => crypto.randomUUID();

const nf = d => new Intl.NumberFormat('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d });
const nf2 = nf(2);
export const fmt = (n, d = 2) => (d === 2 ? nf2 : nf(d)).format(n);
export const chf = n => (n == null || Number.isNaN(n) ? '–' : `CHF ${fmt(n)}`);
export const money = (n, cur) => `${cur} ${fmt(n)}`;
export const pct = n => (n == null || !Number.isFinite(n) ? '–' : `${n > 0 ? '+' : ''}${fmt(n)} %`);
export const signed = n => (n == null ? '–' : `${n > 0 ? '+' : ''}${fmt(n)}`);
export const tone = n => (n > 0.005 ? 'pos' : n < -0.005 ? 'neg' : '');
export const arrow = n => (n > 0.005 ? '▲' : n < -0.005 ? '▼' : '■');

const pad = n => String(n).padStart(2, '0');
export const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => fmtDate(new Date());
export const monthKey = s => s.slice(0, 7);
export const dispDate = s => (s ? s.split('-').reverse().join('.') : '');
export const monthLabel = k => {
  const [y, m] = k.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('de-CH', { month: 'short', year: '2-digit' });
};

export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
export const median = arr => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function download(filename, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

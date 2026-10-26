// Anpassbares Dashboard: Widgets hinzufügen/entfernen/sortieren, Zeitraum und Breite wählen.
import { db, save } from './store.js';
import * as calc from './calc.js';
import { $, $$, esc, chf, pct, signed, tone, arrow, fmt, uid, monthLabel, dispDate } from './util.js';
import { formDialog, confirmBox } from './ui.js';

const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#65a30d', '#0891b2', '#dc2626', '#64748b'];
const INCOME = '#2563eb', EXPENSE = '#ea580c';
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const P = calc.PERIODS;
const cmpText = (cur, prev) => (prev ? `${signed(cur - prev)} ggü. Vergleichszeitraum` : '');

export const WIDGETS = {
  'kpi-networth': {
    label: 'Gesamtvermögen',
    kpi: () => { const p = calc.portfolio(); return { main: chf(p.total), sub: p.needsFx ? 'Wechselkurse fehlen – Werte unvollständig' : `${p.rows.length} Positionen` }; },
  },
  'kpi-pnl': {
    label: 'Gewinn/Verlust Vermögen',
    kpi: () => {
      const p = calc.portfolio();
      return { main: `${arrow(p.pnl)} ${chf(p.pnl)}`, sub: `${pct(p.pnlPct)} auf Einstand CHF ${fmt(p.cost)}`, tone: tone(p.pnl) };
    },
  },
  'kpi-day': {
    label: 'Tagesveränderung Vermögen',
    kpi: () => { const p = calc.portfolio(); return { main: `${arrow(p.day)} ${chf(p.day)}`, sub: 'Seit Vortagesschluss', tone: tone(p.day) }; },
  },
  'kpi-cashflow': {
    label: 'Sparbetrag (Einnahmen – Ausgaben)', period: true,
    kpi: w => {
      const r = calc.range(w.period), pr = calc.prevRange(w.period);
      const i = calc.totalIn(db().income, r), e = calc.totalIn(db().expense, r);
      const prev = pr ? calc.totalIn(db().income, pr) - calc.totalIn(db().expense, pr) : null;
      return { main: chf(i - e), sub: `${P[w.period]} · ${cmpText(i - e, prev)}`.replace(/ · $/, ''), tone: tone(i - e) };
    },
  },
  'kpi-savings-rate': {
    label: 'Sparquote', period: true,
    kpi: w => {
      const r = calc.range(w.period);
      const i = calc.totalIn(db().income, r), e = calc.totalIn(db().expense, r);
      return { main: i > 0 ? pct(((i - e) / i) * 100).replace('+', '') : '–', sub: `${P[w.period]} · Einnahmen ${chf(i)}` };
    },
  },
  'chart-cashflow': { label: 'Einnahmen vs. Ausgaben (12 Monate)', chart: 'bar', wide: true },
  'chart-expense-cat': { label: 'Ausgaben nach Kategorie', chart: 'doughnut', period: true },
  'chart-income-cat': { label: 'Einnahmen nach Kategorie', chart: 'doughnut', period: true },
  'chart-allocation': { label: 'Vermögensverteilung', chart: 'doughnut' },
  'chart-pnl': { label: 'Gewinn/Verlust je Position', chart: 'hbar' },
  'chart-networth': { label: 'Vermögensentwicklung', chart: 'line', wide: true },
  'table-compare': { label: 'Periodenvergleich', table: true, period: true, wide: true },
  'table-positions': { label: 'Positionen: Gewinn/Verlust', table: true, wide: true },
};

export const DEFAULT_WIDGETS = () => [
  { id: uid(), type: 'kpi-networth', size: 1 },
  { id: uid(), type: 'kpi-pnl', size: 1 },
  { id: uid(), type: 'kpi-day', size: 1 },
  { id: uid(), type: 'kpi-cashflow', size: 1, period: 'm0' },
  { id: uid(), type: 'chart-cashflow', size: 2 },
  { id: uid(), type: 'chart-expense-cat', size: 1, period: 'm0' },
  { id: uid(), type: 'chart-allocation', size: 1 },
  { id: uid(), type: 'chart-networth', size: 2 },
  { id: uid(), type: 'table-positions', size: 2 },
  { id: uid(), type: 'table-compare', size: 2, period: 'm0' },
];

const widgets = () => (db().settings.widgets ||= DEFAULT_WIDGETS());
const charts = [];

function chartCfg(w) {
  const text = cssVar('--text-2'), grid = cssVar('--border');
  const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: text, boxWidth: 12 } } } };
  const axes = { ticks: { color: text }, grid: { color: grid } };
  const money = v => `CHF ${fmt(v, 0)}`;
  const tooltip = { callbacks: { label: c => `${c.dataset.label || c.label}: CHF ${fmt(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } };

  switch (w.type) {
    case 'chart-cashflow': {
      const s = calc.monthlySeries(12);
      return { type: 'bar', data: { labels: s.keys.map(monthLabel), datasets: [
        { label: 'Einnahmen', data: s.income, backgroundColor: INCOME },
        { label: 'Ausgaben', data: s.expense, backgroundColor: EXPENSE },
      ] }, options: { ...base, plugins: { ...base.plugins, tooltip }, scales: { x: axes, y: { ...axes, ticks: { ...axes.ticks, callback: money } } } } };
    }
    case 'chart-expense-cat':
    case 'chart-income-cat': {
      const list = w.type === 'chart-expense-cat' ? db().expense : db().income;
      const cats = calc.byCategory(list, calc.range(w.period));
      return { type: 'doughnut', data: { labels: cats.map(c => c[0]), datasets: [{ data: cats.map(c => c[1]), backgroundColor: PALETTE, borderColor: cssVar('--surface') }] },
        options: { ...base, plugins: { ...base.plugins, tooltip } } };
    }
    case 'chart-allocation': {
      const a = calc.allocationByType();
      return { type: 'doughnut', data: { labels: a.map(c => c[0]), datasets: [{ data: a.map(c => c[1]), backgroundColor: PALETTE, borderColor: cssVar('--surface') }] },
        options: { ...base, plugins: { ...base.plugins, tooltip } } };
    }
    case 'chart-pnl': {
      const rows = calc.portfolio().rows.filter(r => r.pnlChf != null).sort((a, b) => b.pnlChf - a.pnlChf);
      return { type: 'bar', data: { labels: rows.map(r => r.a.name), datasets: [{ label: 'Gewinn/Verlust', data: rows.map(r => r.pnlChf),
        backgroundColor: rows.map(r => (r.pnlChf >= 0 ? '#15803d' : '#b91c1c')) }] },
        options: { ...base, indexAxis: 'y', plugins: { legend: { display: false }, tooltip }, scales: { x: { ...axes, ticks: { ...axes.ticks, callback: money } }, y: axes } } };
    }
    case 'chart-networth': {
      const s = db().snapshots;
      return { type: 'line', data: { labels: s.map(x => dispDate(x.date)), datasets: [
        { label: 'Vermögen', data: s.map(x => x.total), borderColor: '#0f766e', backgroundColor: '#0f766e33', fill: true, tension: .25, pointRadius: 2 },
        { label: 'Einstand', data: s.map(x => x.cost), borderColor: '#64748b', borderDash: [5, 4], pointRadius: 0 },
      ] }, options: { ...base, plugins: { ...base.plugins, tooltip }, scales: { x: axes, y: { ...axes, ticks: { ...axes.ticks, callback: money } } } } };
    }
  }
}

function tableHtml(w) {
  if (w.type === 'table-compare') {
    const r = calc.range(w.period), pr = calc.prevRange(w.period);
    if (!pr) return '<p class="muted">Für «Gesamter Zeitraum» gibt es keinen Vergleich.</p>';
    const row = (label, list, goodUp) => {
      const a = calc.totalIn(list, r), b = calc.totalIn(list, pr), d = a - b;
      const t = tone(goodUp ? d : -d);
      return `<tr><td>${label}</td><td class="num">${chf(a)}</td><td class="num">${chf(b)}</td><td class="num ${t}">${arrow(goodUp ? d : -d)} ${signed(d)}</td></tr>`;
    };
    const sav = (calc.totalIn(db().income, r) - calc.totalIn(db().expense, r));
    const savP = (calc.totalIn(db().income, pr) - calc.totalIn(db().expense, pr));
    return `<div class="tablewrap"><table><thead><tr><th></th><th class="num">${P[w.period]}</th><th class="num">Vorperiode</th><th class="num">Δ CHF</th></tr></thead><tbody>
      ${row('Einnahmen', db().income, true)}${row('Ausgaben', db().expense, false)}
      <tr><td><b>Saldo</b></td><td class="num"><b>${chf(sav)}</b></td><td class="num">${chf(savP)}</td><td class="num ${tone(sav - savP)}">${arrow(sav - savP)} ${signed(sav - savP)}</td></tr></tbody></table></div>`;
  }
  const rows = calc.portfolio().rows.filter(r => r.valueChf != null).sort((a, b) => (b.pnlChf ?? -Infinity) - (a.pnlChf ?? -Infinity));
  if (!rows.length) return '<p class="muted">Noch keine bewerteten Positionen.</p>';
  return `<div class="tablewrap"><table><thead><tr><th>Position</th><th class="num">Wert CHF</th><th class="num">Gewinn/Verlust CHF</th><th class="num">%</th><th class="num">Heute %</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.a.name)}</td><td class="num">${chf(r.valueChf)}</td>
      <td class="num ${tone(r.pnlChf)}">${r.pnlChf == null ? '–' : `${arrow(r.pnlChf)} ${signed(r.pnlChf)}`}</td>
      <td class="num ${tone(r.pnlPct)}">${pct(r.pnlPct)}</td><td class="num ${tone(r.dayPct)}">${pct(r.dayPct)}</td></tr>`).join('')}</tbody></table></div>`;
}

function widgetHtml(w, i, n, edit) {
  const def = WIDGETS[w.type];
  if (!def) return '';
  const title = `<h3>${esc(def.label)}${def.period ? `<small> · ${esc(P[w.period] || '')}</small>` : ''}</h3>`;
  const tools = edit ? `<div class="wtools">
      <button class="icon" data-act="up" data-id="${w.id}" ${i === 0 ? 'disabled' : ''} aria-label="Nach vorne">↑</button>
      <button class="icon" data-act="down" data-id="${w.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="Nach hinten">↓</button>
      <button class="icon" data-act="size" data-id="${w.id}" aria-label="Breite ändern">↔</button>
      <button class="icon" data-act="cfg" data-id="${w.id}" aria-label="Einstellungen">⚙</button>
      <button class="icon" data-act="del" data-id="${w.id}" aria-label="Entfernen">✕</button></div>` : '';
  let body;
  if (def.kpi) {
    const k = def.kpi(w);
    body = `<div class="kpi ${k.tone || ''}">${esc(k.main)}</div><div class="muted">${esc(k.sub || '')}</div>`;
  } else if (def.table) body = tableHtml(w);
  else if (w.type === 'chart-networth' && db().snapshots.length < 2) body = '<p class="muted">Der Verlauf entsteht automatisch: bei jeder Kursaktualisierung wird ein Tageswert gespeichert (ab 2 Tagen sichtbar).</p>';
  else body = `<div class="chartbox"><canvas data-w="${w.id}"></canvas></div>`;
  return `<section class="card w${w.size === 2 ? ' w2' : ''}" data-id="${w.id}">${tools}${title}${body}</section>`;
}

export function render(el) {
  charts.splice(0).forEach(c => c.destroy());
  const ws = widgets();
  const edit = el.dataset.edit === '1';
  const backupOld = !db().settings.lastBackup || Date.now() - db().settings.lastBackup > 30 * 864e5;
  el.innerHTML = `
    <div class="pagehead"><h1>Dashboard</h1>
      <div class="row">
        ${edit ? '<button class="btn" id="w-add">+ Widget</button><button class="btn ghost" id="w-reset">Zurücksetzen</button>' : ''}
        <button class="btn ${edit ? 'primary' : ''}" id="w-edit">${edit ? 'Fertig' : 'Anpassen'}</button>
      </div></div>
    ${backupOld && (db().income.length || db().assets.length) ? '<div class="banner">Letztes Backup ist älter als 30 Tage oder fehlt. Unter «Einstellungen» ein verschlüsseltes Backup oder einen Excel-Export sichern.</div>' : ''}
    <div class="grid">${ws.map((w, i) => widgetHtml(w, i, ws.length, edit)).join('') || '<p class="muted">Keine Widgets. «Anpassen» → «+ Widget».</p>'}</div>`;

  for (const cv of $$('canvas[data-w]', el)) {
    const w = ws.find(x => x.id === cv.dataset.w);
    const cfg = chartCfg(w);
    if (cfg) charts.push(new Chart(cv, cfg));
  }

  $('#w-edit', el).onclick = () => { el.dataset.edit = edit ? '0' : '1'; render(el); };
  $('#w-add', el)?.addEventListener('click', async () => {
    const v = await formDialog({ title: 'Widget hinzufügen', fields: [
      { name: 'type', label: 'Widget', type: 'select', options: Object.entries(WIDGETS).map(([k, d]) => [k, d.label]) },
      { name: 'period', label: 'Zeitraum (falls zutreffend)', type: 'select', options: Object.entries(P), value: 'm0' },
    ], submit: 'Hinzufügen' });
    if (!v) return;
    ws.push({ id: uid(), type: v.type, size: WIDGETS[v.type].wide ? 2 : 1, period: v.period });
    await save(); render(el);
  });
  $('#w-reset', el)?.addEventListener('click', async () => {
    if (!(await confirmBox('Dashboard zurücksetzen', 'Alle Widgets durch das Standard-Dashboard ersetzen?', 'Zurücksetzen'))) return;
    db().settings.widgets = null; await save(); render(el);
  });
  el.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = ws.findIndex(x => x.id === b.dataset.id), w = ws[i];
    switch (b.dataset.act) {
      case 'up': [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]]; break;
      case 'down': [ws[i + 1], ws[i]] = [ws[i], ws[i + 1]]; break;
      case 'size': w.size = w.size === 2 ? 1 : 2; break;
      case 'del': ws.splice(i, 1); break;
      case 'cfg': {
        const v = await formDialog({ title: WIDGETS[w.type].label, fields: [
          { name: 'period', label: 'Zeitraum', type: 'select', options: Object.entries(P), value: w.period || 'm0' },
        ] });
        if (!v) return;
        w.period = v.period; break;
      }
    }
    await save(); render(el);
  };
}

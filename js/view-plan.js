// Reiter «Planung»: Mehrjahresplanung aus Ist-Buchungen, wiederkehrenden Einträgen (inkl. Stichtag-Anpassungen) und zukünftigen Einzelbuchungen.
import { projection } from './recurring.js';
import { $, esc, chf, fmt, signed, tone, arrow } from './util.js';

let years = 5;
let chart = null;

export function render(el) {
  chart?.destroy(); chart = null;
  const { years: ys, missingFx } = projection(years);
  const cell = v => `<td class="num">${fmt(v, 0)}</td>`;
  const dcell = v => `<td class="num ${tone(v)}">${v === 0 ? '0' : `${arrow(v)} ${fmt(v, 0)}`}</td>`;
  const head = `<tr><th></th>${ys.map((y, i) => `<th class="num">${y.year}${i === 0 ? '<div class="small muted">laufend</div>' : ''}</th>`).join('')}</tr>`;
  const groupTable = kind => {
    const names = [...new Set(ys.flatMap(y => [...y.groups[kind].keys()]))].sort();
    if (!names.length) return '<p class="muted">Keine Daten.</p>';
    return `<div class="tablewrap"><table><thead>${head}</thead><tbody>${names.map(n => `<tr><td>${esc(n)}</td>${ys.map(y => cell(y.groups[kind].get(n) || 0)).join('')}</tr>`).join('')}</tbody></table></div>`;
  };

  el.innerHTML = `
    <div class="pagehead"><h1>Mehrjahresplanung</h1>
      <div class="row"><select id="years">${[3, 5, 10, 15, 20].map(n => `<option value="${n}"${n === years ? ' selected' : ''}>${n} Jahre</option>`).join('')}</select></div></div>
    <p class="muted">Basis: erfasste Buchungen, wiederkehrende Einträge (jährlich, alle 2–5 Jahre usw.) inkl. Anpassungen per Stichtag sowie zukünftig datierte Einzelbuchungen. Keine Teuerung. Beträge in CHF.</p>
    ${missingFx ? '<div class="banner">Für einige Fremdwährungen fehlt der Wechselkurs – Werte unvollständig (Vermögen → Kurse aktualisieren).</div>' : ''}
    <div class="card"><div class="chartbox"><canvas id="planchart"></canvas></div></div>
    <div class="card tablewrap"><table><thead>${head}</thead><tbody>
      <tr><td>Einnahmen</td>${ys.map(y => cell(y.income)).join('')}</tr>
      <tr><td>Ausgaben</td>${ys.map(y => cell(y.expense)).join('')}</tr>
      <tr class="total"><td>Freies Einkommen</td>${ys.map(y => dcell(y.free)).join('')}</tr>
      <tr><td>Vorsorge &amp; Sparen</td>${ys.map(y => cell(y.savings)).join('')}</tr>
      <tr class="total"><td>Saldo nach Vorsorge</td>${ys.map(y => dcell(y.rest)).join('')}</tr>
      <tr><td>Kumuliert</td>${ys.map(y => dcell(y.cum)).join('')}</tr>
    </tbody></table></div>
    <details class="card recur"><summary><b>Einnahmen nach Gruppe</b></summary>${groupTable('income')}</details>
    <details class="card recur"><summary><b>Ausgaben nach Hauptgruppe</b></summary>${groupTable('expense')}</details>`;

  $('#years', el).onchange = e => { years = +e.target.value; render(el); };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const text = css('--text-2'), grid = css('--border');
  chart = new Chart($('#planchart', el), {
    data: {
      labels: ys.map(y => String(y.year)),
      datasets: [
        { type: 'bar', label: 'Einnahmen', data: ys.map(y => y.income), backgroundColor: '#2563eb', stack: 'cash' },
        // Ausgaben (und Vorsorge) werden nach unten, ins Negative, gezeichnet
        { type: 'bar', label: 'Ausgaben', data: ys.map(y => -y.expense), backgroundColor: '#ea580c', stack: 'cash' },
        ...(ys.some(y => y.savings) ? [{ type: 'bar', label: 'Vorsorge & Sparen', data: ys.map(y => -y.savings), backgroundColor: '#7c3aed', stack: 'cash' }] : []),
        { type: 'line', label: 'Kumulierter Saldo', data: ys.map(y => y.cum), borderColor: '#0f766e', backgroundColor: '#0f766e', tension: .2, pointRadius: 3, stack: 'saldo' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: text, boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.dataset.type === 'line' || c.parsed.y >= 0 ? '' : '–'}CHF ${fmt(Math.abs(c.parsed.y), 0)}` } } },
      scales: { x: { stacked: true, ticks: { color: text }, grid: { color: grid } }, y: { stacked: true, ticks: { color: text, callback: v => `CHF ${fmt(v, 0)}` }, grid: { color: c => (c.tick && c.tick.value === 0 ? text : grid), lineWidth: c => (c.tick && c.tick.value === 0 ? 2 : 1) } } },
    },
  });
}

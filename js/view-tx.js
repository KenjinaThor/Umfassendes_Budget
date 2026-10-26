// Reiter «Einnahmen» und «Ausgaben» (identische Logik, unterschiedliche Liste).
import { db, save } from './store.js';
import * as calc from './calc.js';
import * as fx from './fx.js';
import { $, esc, chf, fmt, uid, today, dispDate } from './util.js';
import { formDialog, confirmBox, toast } from './ui.js';

const CFG = {
  income: { title: 'Einnahmen', cats: ['Lohn', 'Nebenverdienst', 'Zinsen/Dividenden', 'Rückerstattung', 'Geschenk', 'Sonstiges'] },
  expense: { title: 'Ausgaben', cats: ['Wohnen', 'Nebenkosten', 'Krankenkasse', 'Versicherungen', 'Steuern', 'Lebensmittel', 'Mobilität', 'Freizeit', 'Ferien', 'Kleidung', 'Gesundheit', 'Bildung', 'Sonstiges'] },
};
const PAGE = 150;
const state = { income: { period: 'm0', q: '', shown: PAGE }, expense: { period: 'm0', q: '', shown: PAGE } };

async function edit(kind, t) {
  const cats = [...new Set([...CFG[kind].cats, ...db()[kind].map(x => x.category)])].sort();
  const v = await formDialog({
    title: `${CFG[kind].title}: ${t ? 'Bearbeiten' : 'Neue Buchung'}`,
    values: t || { date: today(), currency: 'CHF' },
    fields: [
      { name: 'date', label: 'Datum', type: 'date', required: true },
      { name: 'category', label: 'Kategorie', list: cats, required: true },
      { name: 'description', label: 'Beschreibung' },
      { name: 'amount', label: 'Betrag', type: 'number', step: '0.01', required: true },
      { name: 'currency', label: 'Währung', type: 'select', options: fx.CURRENCIES.map(c => [c, c]) },
      { name: 'account', label: 'Konto (optional)' },
    ],
  });
  if (!v) return false;
  const rec = { ...(t || { id: uid() }), date: v.date, category: v.category.trim(), description: v.description.trim(), amount: Math.abs(+v.amount), currency: v.currency, account: v.account.trim() };
  delete rec.rate;
  if (rec.currency !== 'CHF') {
    try { rec.rate = await fx.rateAt(rec.currency, rec.date); } catch { toast('Wechselkurs nicht abrufbar – es wird der letzte bekannte Kurs verwendet.'); }
  }
  const list = db()[kind];
  const i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  await save();
  return true;
}

export function render(el, kind) {
  const s = state[kind], list = db()[kind];
  const r = calc.range(s.period);
  const q = s.q.toLowerCase();
  const rows = list.filter(t => calc.inRange(t, r) && (!q || `${t.category} ${t.description} ${t.account}`.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((a, t) => a + calc.txChf(t), 0);
  const missingFx = rows.some(t => t.currency !== 'CHF' && (t.rate ?? fx.latest(t.currency)) == null);

  el.innerHTML = `
    <div class="pagehead"><h1>${CFG[kind].title}</h1><button class="btn primary" id="add">+ Neu</button></div>
    <div class="toolbar">
      <select id="period">${Object.entries(calc.PERIODS).map(([k, l]) => `<option value="${k}"${k === s.period ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="q" type="search" placeholder="Suchen…" value="${esc(s.q)}">
      <div class="total">Summe: <b>${chf(total)}</b> · ${rows.length} Buchungen</div>
    </div>
    ${missingFx ? '<div class="banner">Für einige Fremdwährungen fehlt der Wechselkurs – Summe unvollständig.</div>' : ''}
    <div class="card tablewrap"><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th>Konto</th><th class="num">Betrag</th><th class="num">CHF</th><th></th></tr></thead><tbody>
    ${rows.slice(0, s.shown).map(t => `<tr><td>${dispDate(t.date)}</td><td>${esc(t.category)}</td><td>${esc(t.description)}</td><td>${esc(t.account)}</td>
      <td class="num">${t.currency !== 'CHF' ? `${t.currency} ${fmt(t.amount)}` : ''}</td><td class="num">${chf(calc.txChf(t))}</td>
      <td class="num nowrap"><button class="icon" data-act="edit" data-id="${t.id}" aria-label="Bearbeiten">✎</button><button class="icon" data-act="del" data-id="${t.id}" aria-label="Löschen">✕</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">Keine Buchungen im gewählten Zeitraum.</td></tr>'}
    </tbody></table></div>
    ${rows.length > s.shown ? `<button class="btn" id="more">Mehr anzeigen (${rows.length - s.shown})</button>` : ''}`;

  const redraw = () => render(el, kind);
  $('#period', el).onchange = e => { s.period = e.target.value; s.shown = PAGE; redraw(); };
  $('#q', el).oninput = e => {
    s.q = e.target.value; s.shown = PAGE; redraw();
    const q2 = $('#q', el); q2.focus(); q2.setSelectionRange(s.q.length, s.q.length);
  };
  $('#add', el).onclick = async () => { if (await edit(kind)) redraw(); };
  $('#more', el)?.addEventListener('click', () => { s.shown += PAGE; redraw(); });
  el.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = list.find(x => x.id === b.dataset.id);
    if (b.dataset.act === 'edit') { if (await edit(kind, t)) redraw(); }
    else if (await confirmBox('Buchung löschen', `${dispDate(t.date)} · ${t.category} · ${chf(calc.txChf(t))}`, 'Löschen', true)) {
      db()[kind] = list.filter(x => x.id !== t.id); await save(); redraw();
    }
  };
}

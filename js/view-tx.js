// Reiter «Einnahmen» und «Ausgaben» (identische Logik, unterschiedliche Liste).
import { db, save, hasHousehold } from './store.js';
import * as calc from './calc.js';
import * as fx from './fx.js';
import { groupsFor, isKnown, canonical, isSavings } from './categories.js';
import { $, esc, chf, fmt, uid, today, dispDate } from './util.js';
import { formDialog, confirmBox, toast } from './ui.js';
import * as RV from './view-recurring.js';

const groups = (kind, extra, current) => {
  const g = groupsFor(kind).map(x => [x.name, x.positions.map(p => p.name)]);
  const own = [...new Set([...extra, ...(current && !isKnown(current) ? [current] : [])])];
  return own.length ? [...g, ['Eigene Kategorien', own]] : g;
};
const CFG = { income: { title: 'Einnahmen' }, expense: { title: 'Ausgaben' } };
const PAGE = 150;
const state = { income: { period: 'm0', q: '', shown: PAGE }, expense: { period: 'm0', q: '', shown: PAGE } };

async function edit(kind, t) {
  const cats = [...new Set(db()[kind].map(x => x.category))].filter(c => !isKnown(c)).sort();
  const v = await formDialog({
    title: `${CFG[kind].title}: ${t ? (t.recId ? 'Automatische Buchung (nur dieser Eintrag)' : 'Bearbeiten') : 'Neue Buchung'}`,
    values: t ? { ...t, category: isKnown(t.category) ? canonical(t.category) : t.category } : { date: today(), currency: 'CHF' },
    fields: [
      { name: 'date', label: 'Datum', type: 'date', required: true },
      { name: 'category', label: 'Kategorie (Budgetplan)', type: 'select', groups: groups(kind, cats, t?.category), required: true },
      { name: 'custom', label: 'oder eigene Kategorie', hint: 'Leer lassen, um die Auswahl oben zu verwenden' },
      { name: 'description', label: 'Beschreibung' },
      { name: 'amount', label: 'Betrag', type: 'number', step: '0.01', required: true },
      { name: 'currency', label: 'Währung', type: 'select', options: fx.CURRENCIES.map(c => [c, c]) },
      { name: 'account', label: 'Konto (optional)' },
      ...(hasHousehold() ? [{ name: 'shared', label: 'Gemeinsam mit Haushalt', type: 'checkbox' }] : []),
      ...(t?.recId ? [] : RV.repeatFields(kind)),
    ],
  });
  if (!v) return false;
  if (!t?.recId && v.repeat && v.repeat !== '0') {
    try { await RV.createFromForm(kind, v, t); toast(t ? 'Buchung in wiederkehrenden Eintrag umgewandelt' : 'Wiederkehrender Eintrag erstellt'); return true; } catch (err) { toast(err.message); return false; }
  }
  const rec = { ...(t || { id: uid() }), date: v.date, category: (v.custom || '').trim() || v.category, description: v.description.trim(), amount: Math.abs(+v.amount), currency: v.currency, account: v.account.trim() };
  delete rec.rate;
  if (t?.recId) rec.manual = true; // Einzelanpassung einer automatischen Buchung bleibt bestehen
  if (v.shared) rec.shared = true; else delete rec.shared;
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
  const sav = kind === 'expense' ? rows.filter(t => isSavings(t.category)) : [];
  const total = rows.reduce((a, t) => a + (sav.includes(t) ? 0 : calc.txChf(t)), 0);
  const savTotal = sav.reduce((a, t) => a + calc.txChf(t), 0);
  const missingFx = rows.some(t => t.currency !== 'CHF' && (t.rate ?? fx.latest(t.currency)) == null);

  el.innerHTML = `
    <div class="pagehead"><h1>${CFG[kind].title}</h1><button class="btn primary" id="add">+ Neu</button></div>
    <div class="toolbar">
      <select id="period">${Object.entries(calc.PERIODS).map(([k, l]) => `<option value="${k}"${k === s.period ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="q" type="search" placeholder="Suchen…" value="${esc(s.q)}">
      <div class="total">Summe: <b>${chf(total)}</b>${sav.length ? ` · Vorsorge/Sparen: <b>${chf(savTotal)}</b>` : ''} · ${rows.length} Buchungen</div>
    </div>
    ${RV.panelHtml(kind)}
    ${missingFx ? '<div class="banner">Für einige Fremdwährungen fehlt der Wechselkurs – Summe unvollständig.</div>' : ''}
    <div class="card tablewrap"><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th>Konto</th><th class="num">Betrag</th><th class="num">CHF</th><th></th></tr></thead><tbody>
    ${rows.slice(0, s.shown).map(t => `<tr><td>${dispDate(t.date)}</td><td>${esc(t.category)}${t.recId ? '<span class="badge" title="Automatisch aus wiederkehrendem Eintrag">🔁</span>' : ''}${t.shared ? '<span class="badge">Haushalt</span>' : ''}</td><td>${esc(t.description)}</td><td>${esc(t.account)}</td>
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
    const handled = await RV.handleClick(e);
    if (handled !== null) { if (handled) redraw(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = db()[kind].find(x => x.id === b.dataset.id);
    if (b.dataset.act === 'edit') { if (await edit(kind, t)) redraw(); }
    else if (await confirmBox('Buchung löschen', `${dispDate(t.date)} · ${t.category} · ${chf(calc.txChf(t))}${t.recId ? ' – nur dieser Eintrag, der wiederkehrende Eintrag bleibt bestehen.' : ''}`, 'Löschen', true)) {
      const rule = t.recId && db().recurring.find(r => r.id === t.recId);
      if (rule) (rule.skip ||= []).push(t.date);
      db()[kind] = db()[kind].filter(x => x.id !== t.id); await save(); redraw();
    }
  };
}

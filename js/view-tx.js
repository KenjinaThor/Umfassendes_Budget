// Reiter «Einnahmen» und «Ausgaben» (identische Logik, unterschiedliche Liste).
import { db, save, hasHousehold } from './store.js';
import * as calc from './calc.js';
import * as fx from './fx.js';
import { groupsFor, isKnown, canonical, isSavings } from './categories.js';
import { $, esc, chf, fmt, uid, today, dispDate } from './util.js';
import { formDialog, confirmBox, toast } from './ui.js';
import * as RV from './view-recurring.js';
import * as Docs from './docs.js';
import { openDialog, closeDialog } from './ui.js';
import { intervalLabel } from './recurring.js';
import { download } from './util.js';
import { skipBudget as skipBudgetEntry } from './budget.js';

const groups = (kind, extra, current) => {
  const g = groupsFor(kind).map(x => [x.name, x.positions.map(p => p.name)]);
  const own = [...new Set([...extra, ...(current && !isKnown(current) ? [current] : [])])];
  return own.length ? [...g, ['Eigene Kategorien', own]] : g;
};
const CFG = { income: { title: 'Einnahmen' }, expense: { title: 'Ausgaben' } };
const PAGE = 150;
const state = { income: { period: 'm0', q: '', shown: PAGE, per: 'all', sort: 'date-desc' }, expense: { period: 'm0', q: '', shown: PAGE, per: 'all', sort: 'date-desc' } };

// Periodizität einer Buchung: einmalig, Budget-Automatik oder Rhythmus des wiederkehrenden Eintrags (in Monaten)
const perOf = t => {
  if (t.recId) { const r = db().recurring.find(x => x.id === t.recId); return r ? { key: `m${r.interval}`, months: r.interval } : { key: 'rec', months: 0.7 }; }
  if (t.auto === 'budget' && !t.manual) return { key: 'budget', months: 0.5 };
  return { key: 'once', months: 0 };
};
const perLabel = key => key === 'once' ? 'Einmalig' : key === 'budget' ? 'Budget-Automatik (monatlich)' : key === 'rec' ? 'Wiederkehrend' : intervalLabel(+key.slice(1))[0].toUpperCase() + intervalLabel(+key.slice(1)).slice(1);
const SORTS = {
  'date-desc': ['Datum: neueste zuerst', (a, b) => b.date.localeCompare(a.date)],
  'date-asc': ['Datum: älteste zuerst', (a, b) => a.date.localeCompare(b.date)],
  'amount-desc': ['Betrag: hoch → tief', (a, b) => calc.txChf(b) - calc.txChf(a)],
  'amount-asc': ['Betrag: tief → hoch', (a, b) => calc.txChf(a) - calc.txChf(b)],
  'cat': ['Kategorie A–Z', (a, b) => a.category.localeCompare(b.category, 'de') || b.date.localeCompare(a.date)],
  'per-asc': ['Periodizität: einmalig → selten', (a, b) => perOf(a).months - perOf(b).months || b.date.localeCompare(a.date)],
  'per-desc': ['Periodizität: selten → einmalig', (a, b) => perOf(b).months - perOf(a).months || b.date.localeCompare(a.date)],
};

const docBoxHtml = t => `<div class="docbox"><b>📎 Dokumente</b> <span class="muted small">(optional, max. ${Docs.MAX_DOCS}, je max. ${Docs.MAX_BYTES / 1048576} MB – verschlüsselt gespeichert)</span>
  ${(t?.docs || []).map(d => `<label class="check"><input type="checkbox" name="rmdoc_${esc(d.id)}"><span>${esc(d.name)} (${Docs.sizeLabel(d.size)}) entfernen</span></label>`).join('')}
  <input type="file" name="newdocs" multiple accept="${Docs.ACCEPT}"></div>`;

async function showDocs(t) {
  const urls = [];
  const d = openDialog(`<div class="form"><h2>Dokumente</h2><ul class="doclist">${t.docs.map(x => `<li><span>📎 ${esc(x.name)} <span class="muted small">(${Docs.sizeLabel(x.size)})</span></span>
    <span class="row">${x.mime.startsWith('image/') ? `<button class="btn" data-dact="view" data-did="${esc(x.id)}">Ansehen</button>` : ''}<button class="btn" data-dact="dl" data-did="${esc(x.id)}">Herunterladen</button></span></li>`).join('')}</ul>
    <div id="docview"></div><div class="actions"><button class="btn primary" id="doc-close">Schliessen</button></div></div>`);
  d.querySelector('#doc-close').onclick = closeDialog;
  d.addEventListener('close', () => urls.forEach(u => URL.revokeObjectURL(u)), { once: true });
  d.onclick = async e => {
    const b = e.target.closest('[data-dact]');
    if (!b) return;
    const meta = t.docs.find(x => x.id === b.dataset.did);
    b.disabled = true;
    try {
      const blob = await Docs.get(meta);
      if (b.dataset.dact === 'dl') download(meta.name, blob, meta.mime);
      else { const u = URL.createObjectURL(blob); urls.push(u); d.querySelector('#docview').innerHTML = `<img class="docimg" alt="${esc(meta.name)}" src="${u}">`; }
    } catch (err) { toast(err.message); }
    b.disabled = false;
  };
}

async function edit(kind, t) {
  const cats = [...new Set(db()[kind].map(x => x.category))].filter(c => !isKnown(c)).sort();
  const v = await formDialog({
    title: `${CFG[kind].title}: ${t ? (t.recId || t.auto ? 'Automatische Buchung (nur dieser Eintrag)' : 'Bearbeiten') : 'Neue Buchung'}`,
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
      { name: 'docbox', type: 'html', html: docBoxHtml(t), when: x => !x.repeat || x.repeat === '0' },
      ...(t?.recId || t?.auto ? [] : RV.repeatFields(kind)),
    ],
  });
  if (!v) return false;
  if (!t?.recId && !t?.auto && v.repeat && v.repeat !== '0') {
    try { await RV.createFromForm(kind, v, t); toast(t ? 'Buchung in wiederkehrenden Eintrag umgewandelt' : 'Wiederkehrender Eintrag erstellt'); return true; } catch (err) { toast(err.message); return false; }
  }
  const rec = { ...(t || { id: uid() }), date: v.date, category: (v.custom || '').trim() || v.category, description: v.description.trim(), amount: Math.abs(+v.amount), currency: v.currency, account: v.account.trim() };
  delete rec.rate;
  if (t?.recId || t?.auto) rec.manual = true; // Einzelanpassung einer automatischen Buchung bleibt bestehen
  if (v.shared) rec.shared = true; else delete rec.shared;
  if (rec.currency !== 'CHF') {
    try { rec.rate = await fx.rateAt(rec.currency, rec.date); } catch { toast('Wechselkurs nicht abrufbar – es wird der letzte bekannte Kurs verwendet.'); }
  }
  // Dokumente: Entfernte löschen, neue verschlüsselt hochladen
  const removed = (t?.docs || []).filter(d => v[`rmdoc_${d.id}`]);
  const kept = (t?.docs || []).filter(d => !v[`rmdoc_${d.id}`]);
  const files = (v.newdocs || []).filter(f => f.size > 0);
  if (kept.length + files.length > Docs.MAX_DOCS) { toast(`Maximal ${Docs.MAX_DOCS} Dokumente pro Buchung.`); return false; }
  const added = [];
  if (files.length) {
    toast('Dokumente werden verschlüsselt und hochgeladen…', 8000);
    try { for (const f of files) added.push(await Docs.put(f)); }
    catch (err) { for (const m of added) await Docs.remove(m); toast(err.message); return false; }
  }
  const all = [...kept, ...added];
  if (all.length) rec.docs = all; else delete rec.docs;
  for (const m of removed) await Docs.remove(m);
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
  const inPeriod = list.filter(t => calc.inRange(t, r) && (!q || `${t.category} ${t.description} ${t.account}`.toLowerCase().includes(q)));
  // verfügbare Rhythmen im gewählten Zeitraum (für den Filter)
  const perKeys = new Map();
  for (const t of inPeriod) { const { key, months } = perOf(t); perKeys.set(key, months); }
  if (s.per !== 'all' && s.per !== 'recAll' && !perKeys.has(s.per)) perKeys.set(s.per, 0);
  const perOptions = [...perKeys.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  const matchPer = t => s.per === 'all' || (s.per === 'recAll' ? perOf(t).key !== 'once' : perOf(t).key === s.per);
  const rows = inPeriod.filter(matchPer).sort(SORTS[s.sort][1]);
  const sav = kind === 'expense' ? rows.filter(t => isSavings(t.category)) : [];
  const total = rows.reduce((a, t) => a + (sav.includes(t) ? 0 : calc.txChf(t)), 0);
  const savTotal = sav.reduce((a, t) => a + calc.txChf(t), 0);
  const missingFx = rows.some(t => t.currency !== 'CHF' && (t.rate ?? fx.latest(t.currency)) == null);

  el.innerHTML = `
    <div class="pagehead"><h1>${CFG[kind].title}</h1><button class="btn primary" id="add">+ Neu</button></div>
    <div class="toolbar">
      <select id="period">${Object.entries(calc.PERIODS).map(([k, l]) => `<option value="${k}"${k === s.period ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select id="per" aria-label="Periodizität"><option value="all">Alle Rhythmen</option><option value="recAll"${s.per === 'recAll' ? ' selected' : ''}>Nur wiederkehrende</option>${perOptions.map(k => `<option value="${k}"${k === s.per ? ' selected' : ''}>${perLabel(k)}</option>`).join('')}</select>
      <select id="sort" aria-label="Sortierung">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${k === s.sort ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="q" type="search" placeholder="Suchen…" value="${esc(s.q)}">
      <div class="total">Summe: <b>${chf(total)}</b>${sav.length ? ` · Vorsorge/Sparen: <b>${chf(savTotal)}</b>` : ''} · ${rows.length} Buchungen</div>
    </div>
    ${RV.panelHtml(kind, s.per === 'all' || s.per === 'recAll' ? null : (s.per === 'once' || s.per === 'budget' ? () => false : r => `m${r.interval}` === s.per))}
    ${missingFx ? '<div class="banner">Für einige Fremdwährungen fehlt der Wechselkurs – Summe unvollständig.</div>' : ''}
    <div class="card tablewrap"><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Rhythmus</th><th>Beschreibung</th><th>Konto</th><th class="num">Betrag</th><th class="num">CHF</th><th></th></tr></thead><tbody>
    ${rows.slice(0, s.shown).map(t => `<tr><td>${dispDate(t.date)}</td><td>${esc(t.category)}${t.recId ? '<span class="badge" title="Automatisch aus wiederkehrendem Eintrag">🔁</span>' : ''}${t.auto && !t.manual ? '<span class="badge" title="Automatisch aus dem Budgetplan">Budget</span>' : ''}${t.shared ? '<span class="badge">Haushalt</span>' : ''}</td><td class="small">${esc(perLabel(perOf(t).key))}</td><td>${esc(t.description)}</td><td>${esc(t.account)}</td>
      <td class="num">${t.currency !== 'CHF' ? `${t.currency} ${fmt(t.amount)}` : ''}</td><td class="num">${chf(calc.txChf(t))}</td>
      <td class="num nowrap">${t.docs?.length ? `<button class="icon" data-act="docs" data-id="${t.id}" title="Dokumente" aria-label="Dokumente">📎${t.docs.length}</button>` : ''}<button class="icon" data-act="edit" data-id="${t.id}" aria-label="Bearbeiten">✎</button><button class="icon" data-act="del" data-id="${t.id}" aria-label="Löschen">✕</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="muted">Keine Buchungen im gewählten Zeitraum.</td></tr>'}
    </tbody></table></div>
    ${rows.length > s.shown ? `<button class="btn" id="more">Mehr anzeigen (${rows.length - s.shown})</button>` : ''}`;

  const redraw = () => render(el, kind);
  $('#per', el).onchange = e => { s.per = e.target.value; s.shown = PAGE; redraw(); };
  $('#sort', el).onchange = e => { s.sort = e.target.value; s.shown = PAGE; redraw(); };
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
    if (b.dataset.act === 'docs') { await showDocs(t); return; }
    if (b.dataset.act === 'edit') { if (await edit(kind, t)) redraw(); }
    else if (await confirmBox('Buchung löschen', `${dispDate(t.date)} · ${t.category} · ${chf(calc.txChf(t))}${t.recId ? ' – nur dieser Eintrag, der wiederkehrende Eintrag bleibt bestehen.' : ''}${t.auto ? ' – nur dieser Monat, die Budget-Automatik bleibt bestehen.' : ''}`, 'Löschen', true)) {
      for (const m of t.docs || []) await Docs.remove(m);
      if (t.auto === 'budget') skipBudgetEntry(t.category, t.date);
      const rule = t.recId && db().recurring.find(r => r.id === t.recId);
      if (rule) (rule.skip ||= []).push(t.extra13 ? `13:${t.date}` : t.date);
      db()[kind] = db()[kind].filter(x => x.id !== t.id); await save(); redraw();
    }
  };
}

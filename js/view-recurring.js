// Verwaltung wiederkehrender Einträge in den Reitern «Einnahmen» / «Ausgaben».
import { db, save, hasHousehold } from './store.js';
import * as R from './recurring.js';
import { groupsFor, isKnown, canonical } from './categories.js';
import { CURRENCIES } from './fx.js';
import { esc, chf, fmt, dispDate, today, signed } from './util.js';
import { formDialog, confirmBox, openDialog, closeDialog, toast } from './ui.js';

const catGroups = (kind, current) => {
  const g = groupsFor(kind).map(x => [x.name, x.positions.map(p => p.name)]);
  return current && !isKnown(current) ? [...g, ['Eigene Kategorien', [current]]] : g;
};

/** Zusätzliche Formularfelder beim Erfassen einer Buchung. */
export const repeatFields = kind => [
  { name: 'repeat', label: 'Wiederholung', type: 'select', options: R.INTERVAL_OPTIONS, value: '0' },
  { name: 'until', label: 'Wiederholen bis (optional)', type: 'date', when: v => v.repeat && v.repeat !== '0' },
  ...(kind === 'income' ? [{
    name: 'thirteenth', label: '13. Monatslohn (Lohn wird anteilig auf 12 Monate verteilt: Betrag × 13/12)', type: 'checkbox',
    when: v => v.repeat === '1' && R.isSalary('income', (v.custom || '').trim() || v.category),
  }] : []),
];

export async function createFromForm(kind, v, original) {
  const rule = R.newRule(kind, {
    category: (v.custom || '').trim() || v.category, description: v.description.trim(), amount: Math.abs(+v.amount), currency: v.currency,
    account: v.account.trim(), interval: +v.repeat, start: v.date, end: v.until || '', thirteenth: !!v.thirteenth, shared: !!v.shared,
  });
  if (rule.end && rule.end < rule.start) throw new Error('«Wiederholen bis» liegt vor dem Startdatum.');
  db().recurring.push(rule);
  if (original) db()[kind] = db()[kind].filter(t => t.id !== original.id); // wird als erste Fälligkeit neu erzeugt
  R.materialize();
  await save();
}

const describeHistory = rule => rule.amounts.map(c => `ab ${dispDate(c.from)}: ${fmt(c.amount)}`).join(' → ');

export function panelHtml(kind, pred) {
  const rules = (db().recurring || []).filter(r => r.kind === kind && (!pred || pred(r))).sort((a, b) => a.interval - b.interval || a.category.localeCompare(b.category, 'de'));
  if (!rules.length) return '';
  const now = today();
  return `<details class="card recur" open><summary><b>🔁 Wiederkehrende Einträge</b> (${rules.length})</summary>
    <div class="tablewrap"><table><thead><tr><th>Kategorie</th><th class="num">Betrag aktuell</th><th>Rhythmus</th><th>Zeitraum</th><th></th></tr></thead><tbody>
    ${rules.map(r => {
      const ended = r.end && r.end < now;
      return `<tr${ended ? ' class="muted"' : ''}><td>${esc(r.category)}${r.shared ? '<span class="badge">Haushalt</span>' : ''}${r.thirteenth ? '<span class="badge">13. ML</span>' : ''}
        <div class="muted small">${esc(r.description)}${r.amounts.length > 1 ? `${r.description ? ' · ' : ''}${esc(describeHistory(r))}` : ''}</div></td>
        <td class="num">${r.currency !== 'CHF' ? `${r.currency} ` : 'CHF '}${fmt(R.effectiveAt(r, ended ? r.end : now))}</td>
        <td>${R.intervalLabel(r.interval)}</td><td class="nowrap">${dispDate(r.start)} – ${r.end ? dispDate(r.end) : 'offen'}</td>
        <td class="num nowrap"><button class="icon" title="Anpassung ab Stichtag (Lohn-/Prämienerhöhung)" data-ract="adjust" data-rid="${r.id}">±</button>
          <button class="icon" title="Bearbeiten" data-ract="edit" data-rid="${r.id}">✎</button>
          <button class="icon" title="Löschen" data-ract="del" data-rid="${r.id}">✕</button></td></tr>`;
    }).join('')}</tbody></table></div></details>`;
}

async function adjust(rule) {
  const hist = describeHistory(rule);
  const v = await formDialog({
    title: `Anpassung ab Stichtag: ${rule.category}`,
    submit: 'Anpassung speichern',
    extra: `<p class="muted small">Bisher: ${esc(hist)}. Beispiel: Lohnerhöhung oder Prämienerhöhung der Krankenkasse. Die Buchungen ab dem Stichtag werden automatisch angepasst, frühere bleiben unverändert (ausser sie liegen vor dem Startdatum).</p>`,
    values: { from: today() },
    fields: [
      { name: 'from', label: 'Gültig ab (Stichtag)', type: 'date', required: true },
      { name: 'amount', label: `Neuer Betrag je Monat/Zahlung${rule.thirteenth ? ' (ohne 13. Monatslohn-Anteil)' : ''}`, type: 'number', step: '0.01', hint: 'ODER Änderung in Prozent' },
      { name: 'percent', label: 'Änderung in % (z. B. 2.5 oder -3)', type: 'number', step: '0.01' },
      ...(rule.amounts.length > 1 ? [{ name: 'removeLast', label: `Stattdessen die letzte Anpassung (ab ${dispDate(rule.amounts.at(-1).from)}) entfernen`, type: 'checkbox' }] : []),
    ],
  });
  if (!v) return false;
  if (v.removeLast) { rule.amounts.pop(); R.materialize(); await save(); toast('Letzte Anpassung entfernt'); return true; }
  const hasA = v.amount !== '', hasP = v.percent !== '';
  if (hasA === hasP) { toast('Bitte entweder neuen Betrag oder Prozent angeben.'); return false; }
  const next = R.addChange(rule, v.from, hasA ? { amount: Math.abs(+v.amount) } : { percent: +v.percent });
  R.materialize(); await save();
  toast(`Ab ${dispDate(v.from)}: ${fmt(next)}`);
  return true;
}

async function editRule(rule) {
  const kind = rule.kind;
  const v = await formDialog({
    title: 'Wiederkehrenden Eintrag bearbeiten',
    values: { ...rule, category: isKnown(rule.category) ? canonical(rule.category) : rule.category, amount: rule.amounts[0].amount, interval: String(rule.interval), start: rule.start, until: rule.end },
    extra: '<p class="muted small">Der Betrag gilt ab Startdatum. Spätere Erhöhungen erfasst du mit «±». Manuell geänderte Einzelbuchungen bleiben unverändert.</p>',
    fields: [
      { name: 'category', label: 'Kategorie', type: 'select', groups: catGroups(kind, rule.category), required: true },
      { name: 'custom', label: 'oder eigene Kategorie' },
      { name: 'description', label: 'Beschreibung' },
      { name: 'amount', label: 'Betrag (ab Startdatum)', type: 'number', step: '0.01', required: true },
      { name: 'currency', label: 'Währung', type: 'select', options: CURRENCIES.map(c => [c, c]) },
      { name: 'account', label: 'Konto (optional)' },
      { name: 'interval', label: 'Rhythmus', type: 'select', options: R.INTERVAL_OPTIONS.slice(1).some(o => o[0] === String(rule.interval)) ? R.INTERVAL_OPTIONS.slice(1) : [...R.INTERVAL_OPTIONS.slice(1), [String(rule.interval), R.intervalLabel(rule.interval)]] },
      { name: 'start', label: 'Startdatum', type: 'date', required: true },
      { name: 'until', label: 'Ende (optional)', type: 'date' },
      ...(kind === 'income' ? [{ name: 'thirteenth', label: '13. Monatslohn (Betrag × 13/12)', type: 'checkbox', when: x => x.interval === '1' && R.isSalary('income', (x.custom || '').trim() || x.category) }] : []),
      ...(hasHousehold() ? [{ name: 'shared', label: 'Gemeinsam mit Haushalt', type: 'checkbox' }] : []),
    ],
  });
  if (!v) return false;
  if (v.until && v.until < v.start) { toast('Ende liegt vor dem Startdatum.'); return false; }
  const oldStart = rule.start;
  Object.assign(rule, {
    category: (v.custom || '').trim() || v.category, description: v.description.trim(), currency: v.currency, account: v.account.trim(),
    interval: +v.interval, start: v.start, end: v.until || '',
    thirteenth: !!v.thirteenth && R.isSalary(kind, (v.custom || '').trim() || v.category) && +v.interval === 1,
  });
  if (v.shared) rule.shared = true; else delete rule.shared;
  rule.amounts[0] = { from: v.start, amount: Math.abs(+v.amount) };
  rule.amounts = rule.amounts.filter((c, i) => i === 0 || c.from > v.start);
  if (oldStart !== v.start) rule.skip = [];
  R.materialize(); await save();
  return true;
}

async function remove(rule) {
  const d = db();
  const n = [...d.income, ...d.expense].filter(t => t.recId === rule.id).length;
  const ok = await confirmBox('Wiederkehrenden Eintrag löschen', `«${rule.category}» wird nicht mehr automatisch gebucht. ${n} bereits erzeugte Buchungen als normale Einträge behalten?`, 'Ja, behalten', false);
  if (ok) { R.deleteRule(rule, false); await save(); return true; }
  const all = await confirmBox('Erzeugte Buchungen auch löschen?', `Alle ${n} automatisch erzeugten Buchungen dieses Eintrags werden ebenfalls gelöscht.`, 'Alles löschen', true);
  if (!all) return false;
  R.deleteRule(rule, true); await save();
  return true;
}

/** Klick-Handler für das Panel. Gibt true zurück, wenn der Klick verarbeitet wurde (danach neu zeichnen). */
export async function handleClick(e) {
  const b = e.target.closest('[data-ract]');
  if (!b) return null;
  const rule = db().recurring.find(r => r.id === b.dataset.rid);
  if (!rule) return false;
  try {
    if (b.dataset.ract === 'adjust') return await adjust(rule);
    if (b.dataset.ract === 'edit') return await editRule(rule);
    return await remove(rule);
  } catch (err) { toast(err.message); return false; }
}

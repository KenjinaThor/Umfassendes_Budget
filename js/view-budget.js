// Reiter «Budgetplan»: Soll (monatlich) je Position gegen Ist-Buchungen, nach Vorlage «Budgetplan Schweiz».
import { db, save } from './store.js';
import * as calc from './calc.js';
import { INCOME_GROUPS, EXPENSE_GROUPS, SAVINGS_GROUPS, isKnown, canonical } from './categories.js';
import { sollAt, setSoll, setAuto, autoCfg } from './budget.js';
import { materialize } from './recurring.js';
import { lookup } from './categories.js';
import { $, esc, chf, fmt, signed, tone, arrow, monthKey, monthLabel, sum } from './util.js';

let month = monthKey(new Date().toISOString());

const monthsList = () => {
  const keys = new Set(calc.lastMonths(12));
  for (const t of [...db().income, ...db().expense]) keys.add(monthKey(t.date));
  keys.add(month);
  return [...keys].sort().reverse();
};
const rangeOf = m => { const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`]; };

export function render(el) {
  const r = rangeOf(month);
  const actual = list => {
    const m = new Map();
    for (const t of list) if (calc.inRange(t, r)) { const k = canonical(t.category); m.set(k, (m.get(k) || 0) + calc.txChf(t)); }
    return m;
  };
  const inc = actual(db().income), exp = actual(db().expense);
  const auto = autoCfg();
  const soll = n => sollAt(n, month);

  // Gruppe -> Zeilen und Summen. Nicht im Plan enthaltene Kategorien erscheinen unter «Weitere Positionen».
  const build = (groups, act, kind) => {
    const known = new Set(groups.flatMap(g => g.positions.map(p => p.name)));
    const out = groups.map(g => ({ name: g.name, savings: g.savings, rows: g.positions.map(p => ({ name: p.name, hint: p.hint, soll: soll(p.name), ist: act.get(p.name) || 0 })) }));
    const extra = [...act.entries()].filter(([k]) => !known.has(k) && !(kind === 'expense' && SAVINGS_GROUPS.some(g => g.positions.some(p => p.name === k))));
    if (extra.length && kind !== 'savings') out.push({ name: 'Weitere Positionen', rows: extra.map(([k, v]) => ({ name: k, soll: soll(k), ist: v, custom: true, kind })) });
    for (const g of out) { g.soll = sum(g.rows, x => x.soll); g.ist = sum(g.rows, x => x.ist); }
    return out;
  };
  const incG = build(INCOME_GROUPS, inc, 'income');
  const expG = build(EXPENSE_GROUPS, exp, 'expense');
  const savG = build(SAVINGS_GROUPS, exp, 'savings');

  const tot = gs => ({ soll: sum(gs, g => g.soll), ist: sum(gs, g => g.ist) });
  const tI = tot(incG), tE = tot(expG), tS = tot(savG);
  const free = { soll: tI.soll - tE.soll, ist: tI.ist - tE.ist };
  const rest = { soll: free.soll - tS.soll, ist: free.ist - tS.ist };

  // Ausgaben: Ist über Soll = schlecht; Einnahmen/Vorsorge: Ist unter Soll = schlecht
  const diff = (s, i, goodWhenHigher) => {
    if (!s && !i) return '<td class="num"></td>';
    const d = i - s;
    return `<td class="num ${tone(goodWhenHigher ? d : -d)}">${arrow(goodWhenHigher ? d : -d)} ${signed(d)}</td>`;
  };
  const num = v => (v ? fmt(v) : '');
  const posRow = (p, hi, kind) => {
    const a = auto[p.name];
    const k = lookup(p.name)?.kind ?? p.kind ?? kind;
    return `<tr><td>${esc(p.name)}${p.hint ? `<div class="muted small">${esc(p.hint)}</div>` : ''}</td>
    <td class="num"><input class="soll" type="number" inputmode="decimal" step="0.05" min="0" data-name="${esc(p.name)}" value="${p.soll || ''}" aria-label="Soll ${esc(p.name)}"></td>
    <td class="auto"><label title="Sollbetrag jeden Monat automatisch buchen"><input type="checkbox" class="autochk" data-name="${esc(p.name)}" data-kind="${k}"${a ? ' checked' : ''}>${a ? `<span class="small muted">ab ${monthLabel(a.from)}</span>` : ''}</label></td>
    <td class="num">${num(p.ist)}</td>${diff(p.soll, p.ist, hi)}</tr>`;
  };
  const sumRow = (label, s, i, hi, cls = 'sub') => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${fmt(s.soll ?? s)}</td><td></td><td class="num">${fmt(s.ist ?? i)}</td>${diff(s.soll ?? s, s.ist ?? i, hi)}</tr>`;
  const section = (title, gs, hi, totalLabel, t, kindOf = 'expense') => `<tr class="head"><td colspan="5">${esc(title)}</td></tr>
    ${gs.map((g, n) => `<tr class="group"><td colspan="5">${title === 'AUSGABEN' ? `${n + 1}. ` : ''}${esc(g.name)}</td></tr>${g.rows.map(p => posRow(p, hi, kindOf)).join('')}
      ${gs.length > 1 || title === 'EINNAHMEN' ? sumRow(`Zwischentotal ${g.name}`, g, 0, hi) : ''}`).join('')}
    ${sumRow(totalLabel, t, 0, hi, 'total')}`;

  el.innerHTML = `
    <div class="pagehead"><h1>Budgetplan</h1>
      <div class="row"><select id="month">${monthsList().map(m => `<option value="${m}"${m === month ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div></div>
    <p class="muted">«Soll» = geplanter Monatsbetrag in CHF; eine Änderung gilt ab dem gewählten Monat, frühere Monate bleiben unverändert. «Ist» = erfasste Buchungen im gewählten Monat.</p>
    <p class="muted"><b>Auto:</b> Häkchen setzen = der Sollbetrag wird ab dem gewählten Monat jeden Monat automatisch als Buchung übernommen. Erfasst du in einem Monat selbst etwas in dieser Kategorie, ersetzt es die automatische Buchung dieses Monats.</p>
    <div class="card tablewrap budget"><table>
      <thead><tr><th>Position</th><th class="num">Soll / Monat</th><th>Auto</th><th class="num">Ist</th><th class="num">Abweichung</th></tr></thead>
      <tbody>
      ${section('EINNAHMEN', incG, true, 'Total Einnahmen', tI, 'income')}
      ${section('AUSGABEN', expG, false, 'TOTAL AUSGABEN', tE)}
      ${sumRow('FREIES EINKOMMEN (Einnahmen – Ausgaben)', free, 0, true, 'total big')}
      ${section('VORSORGE & VERMÖGENSAUFBAU', savG, true, 'Total Spar- & Vorsorgerate', tS)}
      ${sumRow('RESTBETRAG / PUFFER NACH SPARRATE', rest, 0, true, 'total big')}
      </tbody></table></div>
    <p class="muted small">Beträge in CHF. Die Excel-Vorlage enthält dasselbe Blatt «Budgetplan» zum Ausfüllen und Importieren.</p>`;

  $('#month', el).onchange = e => { month = e.target.value; render(el); };
  el.onchange = async e => {
    const inp = e.target.closest('input.soll');
    if (inp) {
      const v = parseFloat(inp.value);
      setSoll(inp.dataset.name, month, Number.isFinite(v) && v > 0 ? v : 0);
      materialize(); await save(); render(el);
      return;
    }
    const chk = e.target.closest('input.autochk');
    if (chk) {
      setAuto(chk.dataset.name, chk.checked, month, chk.dataset.kind);
      materialize(); await save(); render(el);
    }
  };
}

export const isKnownPosition = isKnown;

// Reiter «Budgetplan»: Soll (monatlich) je Position gegen Ist-Buchungen, nach Vorlage «Budgetplan Schweiz».
import { db, save } from './store.js';
import * as calc from './calc.js';
import { INCOME_GROUPS, EXPENSE_GROUPS, SAVINGS_GROUPS, isKnown, canonical } from './categories.js';
import { sollAt, setSoll, setAuto, autoCfg } from './budget.js';
import { materialize, plannedByMonth } from './recurring.js';
import { lookup } from './categories.js';
import { $, esc, chf, fmt, signed, tone, arrow, monthKey, monthLabel, sum, today } from './util.js';

// Zusatzeinkommen (neben dem normalen Lohn); wird mit dem Lohn zum Total Einnahmen addiert
const EXTRA_INCOME = new Set(['Alimenten / Unterhaltszahlungen', 'Renditen / Dividenden aus Anlagen', 'Nebeneinkünfte / Geschenke / Sonstiges']);

let month = monthKey(new Date().toISOString());
let mode = 'month';           // 'month' | 'year'
let year = +month.slice(0, 4);
let yview = 'prognose';      // 'prognose' | 'soll' | 'ist' | 'diff'
let showEmpty = false;

const monthsList = () => {
  const keys = new Set(calc.lastMonths(12));
  const y = +monthKey(new Date().toISOString()).slice(0, 4);
  for (let m = 1; m <= 12; m++) { keys.add(`${y}-${String(m).padStart(2, '0')}`); keys.add(`${y + 1}-${String(m).padStart(2, '0')}`); }
  for (const t of [...db().income, ...db().expense]) keys.add(monthKey(t.date));
  keys.add(month);
  return [...keys].sort().reverse();
};
const rangeOf = m => { const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`]; };

const modeTabs = () => `<div class="tabs seg"><button class="btn ${mode === 'month' ? 'primary' : ''}" data-mode="month">Monat</button><button class="btn ${mode === 'year' ? 'primary' : ''}" data-mode="year">Jahresbudget</button></div>`;
const wireTabs = el => el.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { mode = b.dataset.mode; render(el); }; });

export function render(el) {
  if (mode === 'year') renderYear(el); else renderMonth(el);
}

function renderYear(el) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const actualBy = list => {
    const byM = new Map(months.map(m => [m, new Map()]));
    for (const t of list) { const m = monthKey(t.date); if (byM.has(m)) { const k = canonical(t.category); byM.get(m).set(k, (byM.get(m).get(k) || 0) + calc.txChf(t)); } }
    return byM;
  };
  const inc = actualBy(db().income), exp = actualBy(db().expense);
  const savNames = new Set(SAVINGS_GROUPS.flatMap(g => g.positions.map(p => p.name)));
  const pl = plannedByMonth(months);
  const merge = (act, planned) => new Map(months.map(m => { const mm = new Map(act.get(m)); for (const [k, v] of planned.get(m)) mm.set(k, (mm.get(k) || 0) + v); return [m, mm]; }));
  const incP = merge(inc, pl.income), expP = merge(exp, pl.expense);
  const none = new Map(months.map(m => [m, new Map()]));
  const val = (name, m, act, kind) => {
    if (kind === 'income') return act.get(m).get(name) || 0; // Einnahmen: kein Soll
    const sl = sollAt(name, m), is = exp.get(m).get(name) || 0, ip = expP.get(m).get(name) || 0;
    return yview === 'soll' ? sl : yview === 'ist' ? is : yview === 'prognose' ? (m >= today().slice(0, 7) ? Math.max(ip, sl) : ip) : ip - sl;
  };
  // Zeilen je Gruppe (Positionen mit Daten, bei «leere anzeigen» alle)
  const build = (groups, act, kind) => {
    const known = new Set(groups.flatMap(g => g.positions.map(p => p.name)));
    const extraNames = new Set();
    for (const m of months) for (const k of act.get(m).keys()) if (!known.has(k) && !(kind === 'expense' && savNames.has(k)) && !(kind === 'expense' && isKnown(k) && lookup(k).kind === 'income')) extraNames.add(k);
    for (const k of Object.keys(db().settings.budget || {})) if (!isKnown(k) && kind === 'expense') extraNames.add(k);
    const all = kind === 'savings' ? groups : [...groups, ...(extraNames.size ? [{ name: 'Weitere Positionen', positions: [...extraNames].map(name => ({ name })) }] : [])];
    return all.map(g => {
      const rows = g.positions.map(p => ({ name: p.name, v: months.map(m => val(p.name, m, act, kind)) }))
        .filter(r => showEmpty || r.v.some(x => Math.abs(x) > 0.004));
      return { name: g.name, rows, v: months.map((_, i) => sum(rows, r => r.v[i])) };
    }).filter(g => showEmpty || g.rows.length);
  };
  // Einnahmen haben kein Soll: «Prognose» = Buchungen + geplante wiederkehrende Einnahmen, «Ist» = nur Buchungen
  const incAct = yview === 'ist' ? inc : yview === 'diff' ? none : incP;
  const incG = build(INCOME_GROUPS, incAct, 'income'), expG = build(EXPENSE_GROUPS, expP, 'expense'), savG = build(SAVINGS_GROUPS, expP, 'savings');
  const colSum = gs => months.map((_, i) => sum(gs, g => g.v[i]));
  const tI = colSum(incG), tE = colSum(expG), tS = colSum(savG);
  const free = tI.map((v, i) => v - tE[i]);
  const rest = free.map((v, i) => v - tS[i]);

  const diffView = yview === 'diff';
  const cellOf = (v, good) => {
    if (!v || Math.abs(v) < 0.005) return '<td class="num"></td>';
    return `<td class="num${diffView ? ` ${tone(good ? v : -v)}` : ''}">${diffView ? signed(v) : fmt(v, 0)}</td>`;
  };
  const line = (label, v, good, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td>${v.map(x => cellOf(x, good)).join('')}${cellOf(sum(v), good).replace('<td class="num', '<td class="num yr')}</tr>`;
  const sec = (title, gs, total, good, totalLabel) => `<tr class="head"><td colspan="14">${esc(title)}</td></tr>
    ${gs.map((g, n) => `<tr class="group"><td colspan="14">${title === 'AUSGABEN' ? `${n + 1}. ` : ''}${esc(g.name)}</td></tr>${g.rows.map(r => line(r.name, r.v, good)).join('')}`).join('')}
    ${line(totalLabel, total, good, 'total')}`;
  const years = [...new Set([year - 1, year, year + 1, year + 2, year + 3, +monthKey(new Date().toISOString()).slice(0, 4)])].sort();
  const label = { prognose: 'Prognose = erfasste Buchungen + geplante Einträge; in laufenden/künftigen Monaten zählt das Budget als Ausgabe, soweit nicht höher gebucht', soll: 'Soll (Budget)', ist: 'Ist (nur erfasste Buchungen)', diff: 'Abweichung Prognose – Soll' }[yview];

  el.innerHTML = `
    <div class="pagehead"><h1>Budgetplan</h1>${modeTabs()}</div>
    <div class="toolbar">
      <select id="year">${years.map(y => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
      <select id="yview"><option value="prognose"${yview === 'prognose' ? ' selected' : ''}>Prognose (Buchungen + geplant)</option><option value="soll"${yview === 'soll' ? ' selected' : ''}>Soll (Budget)</option><option value="ist"${yview === 'ist' ? ' selected' : ''}>Ist (Buchungen)</option><option value="diff"${yview === 'diff' ? ' selected' : ''}>Abweichung</option></select>
      <label class="row small"><input type="checkbox" id="empty"${showEmpty ? ' checked' : ''}> leere Positionen anzeigen</label>
    </div>
    <p class="muted">Jahresbudget ${year} – ${esc(label)}, Beträge in CHF. Einnahmen haben kein Soll. Soll-Änderungen bei den Ausgaben nimmst du in der Monatsansicht vor.</p>
    <div class="card tablewrap budget yearly"><table>
      <thead><tr><th>Position</th>${months.map(m => `<th class="num">${monthLabel(m).replace(/ \d+$/, '')}</th>`).join('')}<th class="num yr">Jahr</th></tr></thead>
      <tbody>
      ${sec('EINNAHMEN', incG, tI, true, 'Total Einnahmen')}
      ${sec('AUSGABEN', expG, tE, false, 'TOTAL AUSGABEN')}
      ${line('FREIES EINKOMMEN', free, true, 'total big')}
      ${sec('VORSORGE & VERMÖGENSAUFBAU', savG, tS, true, 'Total Spar- & Vorsorgerate')}
      ${line('RESTBETRAG / PUFFER NACH SPARRATE', rest, true, 'total big')}
      </tbody></table></div>`;
  wireTabs(el);
  $('#year', el).onchange = e => { year = +e.target.value; render(el); };
  $('#yview', el).onchange = e => { yview = e.target.value; render(el); };
  $('#empty', el).onchange = e => { showEmpty = e.target.checked; render(el); };
  el.onchange = null;
}

function renderMonth(el) {
  const r = rangeOf(month);
  const actual = list => {
    const m = new Map();
    for (const t of list) if (calc.inRange(t, r)) { const k = canonical(t.category); m.set(k, (m.get(k) || 0) + calc.txChf(t)); }
    return m;
  };
  const inc = actual(db().income), exp = actual(db().expense);
  const planned = plannedByMonth([month]);
  const incPlan = planned.income.get(month), expPlan = planned.expense.get(month); // noch nicht gebucht (wiederkehrend / Budget-Automatik)
  const auto = autoCfg();
  const soll = n => sollAt(n, month);
  const isPast = month < today().slice(0, 7);

  // Gruppe -> Zeilen und Summen. Nicht im Plan enthaltene Kategorien erscheinen unter «Weitere Positionen».
  const build = (groups, act, kind) => {
    const pm = kind === 'income' ? incPlan : expPlan;
    const known = new Set(groups.flatMap(g => g.positions.map(p => p.name)));
    // «wirksam»: laufender/künftiger Monat = höherer Wert aus Ist und Soll (offenes Budget gilt als Ausgabe), vergangener Monat = Ist
    const eff = (ist, sl) => (kind === 'income' || isPast ? ist : Math.max(ist, sl));
    const row = p => { const ist = (act.get(p.name) || 0) + (pm.get(p.name) || 0), sl = soll(p.name); return { name: p.name, hint: p.hint, soll: sl, ist, plan: pm.get(p.name) || 0, eff: eff(ist, sl) }; };
    const out = groups.map(g => ({ name: g.name, savings: g.savings, rows: g.positions.map(row) }));
    const keys = new Set([...act.keys(), ...pm.keys()]);
    const extra = [...keys].filter(k => !known.has(k) && !(kind === 'expense' && SAVINGS_GROUPS.some(g => g.positions.some(p => p.name === k))));
    if (extra.length && kind !== 'savings') out.push({ name: 'Weitere Positionen', rows: extra.map(k => { const ist = (act.get(k) || 0) + (pm.get(k) || 0), sl = soll(k); return { name: k, soll: sl, ist, plan: pm.get(k) || 0, custom: true, kind, eff: eff(ist, sl) }; }) });
    for (const g of out) { g.soll = sum(g.rows, x => x.soll); g.ist = sum(g.rows, x => x.ist); g.eff = sum(g.rows, x => x.eff); }
    return out;
  };
  const incG = build(INCOME_GROUPS, inc, 'income');
  const expG = build(EXPENSE_GROUPS, exp, 'expense');
  const savG = build(SAVINGS_GROUPS, exp, 'savings');

  const tot = gs => ({ soll: sum(gs, g => g.soll), ist: sum(gs, g => g.ist), eff: sum(gs, g => g.eff) });
  const tI = tot(incG), tE = tot(expG), tS = tot(savG);
  // Freies Einkommen / Restbetrag: Einnahmen (Ist, inkl. Zusatzeinkommen) abzüglich Ausgaben bzw. Sparrate
  const free = { soll: tI.ist - tE.soll, ist: tI.ist - tE.ist, eff: tI.ist - tE.eff };
  const rest = { soll: free.soll - tS.soll, ist: free.ist - tS.ist, eff: free.eff - tS.eff };
  const extraIncome = sum(incG.flatMap(g => g.rows).filter(r => EXTRA_INCOME.has(r.name) || r.custom), r => r.ist);
  const incNote = extraIncome ? `davon Lohn ${fmt(tI.ist - extraIncome)} + Zusatzeinkommen ${fmt(extraIncome)} (Dividenden, Nebeneinkünfte …)` : '';

  // Ausgaben: Ist über Soll = schlecht; Einnahmen/Vorsorge: Ist unter Soll = schlecht
  const diff = (s, i, goodWhenHigher) => {
    if (!s && !i) return '<td class="num"></td>';
    const d = i - s;
    return `<td class="num ${tone(goodWhenHigher ? d : -d)}">${arrow(goodWhenHigher ? d : -d)} ${signed(d)}</td>`;
  };
  const num = v => (v ? fmt(v) : '');
  const planNote = p => (p.plan ? `<div class="small muted">davon geplant ${fmt(p.plan)}</div>` : '');
  const posRow = (p, hi, kind) => {
    const a = auto[p.name];
    const k = lookup(p.name)?.kind ?? p.kind ?? kind;
    if (k === 'income') {
      // Einnahmen (inkl. Dividenden/Zusatzeinkommen): nur Ist, kein Soll und keine Abweichung
      return `<tr><td>${esc(p.name)}${p.hint ? `<div class="muted small">${esc(p.hint)}</div>` : ''}</td><td></td><td></td><td class="num">${num(p.ist)}${planNote(p)}</td><td></td></tr>`;
    }
    return `<tr><td>${esc(p.name)}${p.hint ? `<div class="muted small">${esc(p.hint)}</div>` : ''}</td>
    <td class="num"><input class="soll" type="number" inputmode="decimal" step="0.05" min="0" data-name="${esc(p.name)}" value="${p.soll || ''}" aria-label="Soll ${esc(p.name)}"></td>
    <td class="auto"><label title="Sollbetrag jeden Monat automatisch buchen"><input type="checkbox" class="autochk" data-name="${esc(p.name)}" data-kind="${k}"${a ? ' checked' : ''}>${a ? `<span class="small muted">ab ${monthLabel(a.from)}</span>` : ''}</label></td>
    <td class="num">${num(p.ist)}${planNote(p)}</td>${diff(p.soll, p.ist, hi)}</tr>`;
  };
  const sumRow = (label, s, i, hi, cls = 'sub') => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${fmt(s.soll ?? s)}</td><td></td><td class="num">${fmt(s.ist ?? i)}</td>${diff(s.soll ?? s, s.ist ?? i, hi)}</tr>`;
  const incRow = (label, v, cls = 'sub', note = '') => `<tr class="${cls}"><td>${esc(label)}${note ? `<div class="small muted">${esc(note)}</div>` : ''}</td><td></td><td></td><td class="num">${fmt(v)}</td><td></td></tr>`;
  const calcRow = (label, s, i, cls, note = '') => `<tr class="${cls}"><td>${esc(label)}${note ? `<div class="small muted">${esc(note)}</div>` : ''}</td><td class="num">${fmt(s)}</td><td></td><td class="num">${fmt(i)}</td>${diff(s, i, true)}</tr>`;
  const section = (title, gs, hi, totalLabel, t, kindOf = 'expense') => `<tr class="head"><td colspan="5">${esc(title)}</td></tr>
    ${gs.map((g, n) => `<tr class="group"><td colspan="5">${title === 'AUSGABEN' ? `${n + 1}. ` : ''}${esc(g.name)}</td></tr>${g.rows.map(p => posRow(p, hi, kindOf)).join('')}
      ${gs.length > 1 || title === 'EINNAHMEN' ? (kindOf === 'income' ? incRow(`Zwischentotal ${g.name}`, g.ist) : sumRow(`Zwischentotal ${g.name}`, g, 0, hi)) : ''}`).join('')}
    ${kindOf === 'income' ? incRow(totalLabel, t.ist, 'total', incNote) : sumRow(totalLabel, t, 0, hi, 'total')}`;

  el.innerHTML = `
    <div class="pagehead"><h1>Budgetplan</h1>${modeTabs()}
      <div class="row"><select id="month">${monthsList().map(m => `<option value="${m}"${m === month ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div></div>
    <p class="muted">Einnahmen (auch Dividenden und Zusatzeinkommen) werden nur als <b>Ist</b> geführt, ohne Soll. «Soll» bei den Ausgaben = geplanter Monatsbetrag in CHF; eine Änderung gilt ab dem gewählten Monat, frühere Monate bleiben unverändert. «Ist» = erfasste Buchungen im gewählten Monat <b>plus noch geplante</b> Buchungen aus wiederkehrenden Einträgen und der Budget-Automatik (als «davon geplant» markiert).</p>
    <p class="muted"><b>Auto:</b> Häkchen setzen = der Sollbetrag wird ab dem gewählten Monat jeden Monat automatisch als Buchung übernommen. Erfasst du in einem Monat selbst etwas in dieser Kategorie, ersetzt es die automatische Buchung dieses Monats.</p>
    <div class="card tablewrap budget"><table>
      <thead><tr><th>Position</th><th class="num">Soll / Monat</th><th>Auto</th><th class="num">Ist</th><th class="num">Abweichung</th></tr></thead>
      <tbody>
      ${section('EINNAHMEN', incG, true, 'Total Einnahmen', tI, 'income')}
      ${section('AUSGABEN', expG, false, 'TOTAL AUSGABEN', tE)}
      ${calcRow('FREIES EINKOMMEN (Einnahmen – Ausgaben)', free.soll, free.ist, 'total big', 'Soll = Einnahmen – Soll-Ausgaben · Ist = Einnahmen – erfasste Ausgaben')}
      ${isPast ? '' : incRow('PROGNOSE FREIES EINKOMMEN', free.eff, 'total big', 'Einnahmen – Ausgaben, wobei noch nicht gebuchtes Budget als Ausgabe zählt')}
      ${section('VORSORGE & VERMÖGENSAUFBAU', savG, true, 'Total Spar- & Vorsorgerate', tS)}
      ${calcRow('RESTBETRAG / PUFFER NACH SPARRATE', rest.soll, rest.ist, 'total big', 'nach Abzug der Ausgaben und der Spar- & Vorsorgerate')}
      ${isPast ? '' : incRow('PROGNOSE RESTBETRAG', rest.eff, 'total big', 'inkl. offenem Budget für Ausgaben und Sparrate')}
      </tbody></table></div>
    <p class="muted small">Beträge in CHF. Die Excel-Vorlage enthält dasselbe Blatt «Budgetplan» zum Ausfüllen und Importieren.</p>`;

  wireTabs(el);
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

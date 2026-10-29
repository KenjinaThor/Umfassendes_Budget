// Reiter «Vermögen»: Konten, Aktien/ETFs, Edelmetalle mit Einstandspreis und Gewinn/Verlust.
import { db, save, hasHousehold } from './store.js';
import * as calc from './calc.js';
import * as fx from './fx.js';
import { refreshQuotes } from './market.js';
import { $, esc, chf, fmt, pct, signed, tone, arrow, uid, today, dispDate } from './util.js';
import { formDialog, confirmBox, toast, openDialog, closeDialog } from './ui.js';

const LIQ = ['konto'];
const INV = ['aktie', 'etf', 'edelmetall'];

async function edit(a) {
  const v = await formDialog({
    title: a ? 'Position bearbeiten' : 'Neue Vermögensposition',
    // Beim Bearbeiten eines Kontos wird der aktuelle Stand (inkl. verknüpfter Sparbeiträge) neu als Ausgangsstand per heute gesetzt
    values: a ? (a.type === 'konto' ? { ...a, qty: Math.round(calc.valuate(a).qty * 100) / 100, balanceDate: today() } : a.valueMode ? { ...a, mode: 'value', valueNow: a.manualPrice, costValue: a.costPrice } : { ...a, mode: 'units' }) : { type: 'konto', currency: 'CHF', unit: 'oz', balanceDate: today(), mode: 'units' },
    fields: [
      { name: 'type', label: 'Typ', type: 'select', options: Object.entries(calc.TYPE_LABELS) },
      { name: 'name', label: 'Name', required: true },
      { name: 'mode', label: 'Erfassung', type: 'select', only: ['aktie', 'etf', 'andere'], options: [['units', 'Stückzahl × Kurs (Börsenkurs wird abgerufen)'], ['value', 'Nur Wert in Währung (z. B. Fonds, Vorsorge) – Menge nicht nötig']] },
      { name: 'valueNow', label: 'Aktueller Wert', type: 'number', step: 'any', required: true, only: ['aktie', 'etf', 'andere'], when: x => x.mode === 'value', hint: 'Gesamtwert der Position in der gewählten Währung. Zum Aktualisieren hier den neuen Wert eintragen.' },
      { name: 'costValue', label: 'Einstandswert (Kaufbetrag gesamt)', type: 'number', step: 'any', only: ['aktie', 'etf', 'andere'], when: x => x.mode === 'value', hint: 'Daraus ergibt sich Gewinn/Verlust in CHF und Prozent.' },
      { name: 'symbol', label: 'Symbol', only: ['aktie', 'etf', 'edelmetall'], when: x => x.mode !== 'value', list: ['XAU', 'XAG', 'XPT', 'XPD'], hint: 'Aktie/ETF z. B. NESN, AAPL · Metall: XAU Gold, XAG Silber, XPT Platin, XPD Palladium' },
      { name: 'exchange', label: 'Börse (optional)', only: ['aktie', 'etf'], when: x => x.mode !== 'value', list: ['SIX', 'XETR', 'NYSE', 'NASDAQ', 'LSE', 'XPAR', 'TSX', 'HKEX', 'SSE', 'SZSE', 'NSE', 'TSE'], hint: 'Börsenkürzel wie bei Twelve Data; Freitext möglich' },
      { name: 'qty', label: 'Menge / Kontostand', type: 'number', step: 'any', required: true, when: x => !(x.mode === 'value' && ['aktie', 'etf', 'andere'].includes(x.type)) },
      { name: 'balanceDate', label: 'Kontostand gilt per', type: 'date', only: ['konto'], hint: 'Verknüpfte Sparbeiträge ab dem Folgetag erhöhen den Stand automatisch.' },
      { name: 'unit', label: 'Einheit', type: 'select', only: ['edelmetall'], options: [['oz', 'Feinunze (oz)'], ['g', 'Gramm'], ['kg', 'Kilogramm']] },
      { name: 'currency', label: 'Währung (Konto / Einstandspreis)', type: 'select', options: fx.CURRENCIES.map(c => [c, c]) },
      { name: 'costPrice', label: 'Einstandspreis je Einheit', type: 'number', step: 'any', only: ['aktie', 'etf', 'edelmetall', 'andere'], when: x => x.mode !== 'value' },
      { name: 'costTotal', label: 'oder Einstandswert gesamt', type: 'number', step: 'any', only: ['aktie', 'etf', 'edelmetall', 'andere'], when: x => x.mode !== 'value', hint: 'Gesamter Kaufbetrag; wird in den Preis je Einheit umgerechnet.' },
      { name: 'costFx', label: 'Wechselkurs bei Kauf → CHF (optional)', type: 'number', step: 'any', only: ['aktie', 'etf', 'edelmetall'], hint: 'CHF je 1 Fremdwährung beim Kauf. Leer = heutiger Kurs.' },
      { name: 'manualPrice', label: 'Aktueller Kurs je Einheit (manuell)', type: 'number', step: 'any', only: ['aktie', 'etf', 'edelmetall', 'andere'], when: x => x.mode !== 'value', hint: 'Gilt nur, wenn kein Börsenkurs abrufbar ist.' },
      ...(hasHousehold() ? [{ name: 'shared', label: 'Gemeinsam mit Haushalt', type: 'checkbox' }] : []),
    ],
  });
  if (!v) return false;
  const num = x => (x === undefined || x === '' ? '' : +x);
  const rec = {
    ...(a || { id: uid() }), type: v.type, name: v.name.trim(), symbol: (v.symbol || '').trim().toUpperCase(),
    exchange: (v.exchange || '').trim().toUpperCase(), qty: +v.qty, ...(v.type === 'konto' ? { balanceDate: v.balanceDate || today() } : {}), unit: v.unit || '', currency: v.currency,
    costPrice: v.costTotal !== undefined && v.costTotal !== '' && +v.qty > 0 ? Math.round((+v.costTotal / +v.qty) * 1e8) / 1e8 : num(v.costPrice), costFx: num(v.costFx) || undefined, manualPrice: num(v.manualPrice),
  };
  if (v.mode === 'value' && ['aktie', 'etf', 'andere'].includes(v.type)) {
    // «Nur Wert»: Menge 1, aktueller Wert als Kurs, Einstandswert als Einstandspreis – Gewinn/Verlust ergibt sich daraus
    Object.assign(rec, { valueMode: true, qty: 1, manualPrice: +v.valueNow, costPrice: v.costValue === '' || v.costValue === undefined ? '' : +v.costValue, symbol: '', exchange: '', unit: '', valueDate: today() });
    delete rec.quote; delete rec.prevClose;
  } else { delete rec.valueMode; delete rec.valueDate; }
  if (v.shared) rec.shared = true; else delete rec.shared;
  if (a && (a.symbol !== rec.symbol || a.exchange !== rec.exchange)) { delete rec.quote; delete rec.prevClose; }
  const list = db().assets, i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  await save();
  return true;
}

/** Sammelerfassung: aktuelle Kurse bzw. Werte aller Positionen (ausser Konten) auf einen Blick nachtragen. */
function manualValues(done) {
  const list = db().assets.filter(a => a.type !== 'konto');
  if (!list.length) { toast('Noch keine Wertschriften erfasst.'); return; }
  const d = openDialog(`<form method="dialog" class="form"><h2>Aktuelle Kurse / Werte nachtragen</h2>
    <p class="muted small">Pro Position den aktuellen Kurs je Einheit (bei «Nur Wert»: den aktuellen Gesamtwert) eintragen. Daraus werden Wert sowie Gewinn/Verlust gegenüber dem Einstand berechnet. Ein abrufbarer Börsenkurs hat Vorrang; leer lassen = kein manueller Wert.</p>
    <div class="tablewrap"><table><thead><tr><th>Position</th><th class="num">Einstand</th><th class="num">Aktuell</th></tr></thead><tbody>
    ${list.map(a => `<tr><td><b>${esc(a.name)}</b><div class="muted small">${a.valueMode ? 'Gesamtwert' : `Kurs je Einheit · ${fmt(+a.qty, 4)} Stück`}</div></td>
      <td class="num">${a.costPrice === '' || a.costPrice == null ? '–' : `${a.currency} ${fmt(a.valueMode ? +a.costPrice : +a.costPrice)}${a.valueMode ? '' : ' / Stk.'}`}</td>
      <td class="num"><input type="number" step="any" name="p_${esc(a.id)}" value="${a.manualPrice === '' || a.manualPrice == null ? '' : esc(String(a.manualPrice))}" placeholder="${a.quote ? `Börse ${fmt(a.quote.price)}` : ''}" aria-label="Aktuell ${esc(a.name)}" style="width:8.5rem;text-align:right"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="actions"><button type="button" class="btn ghost" data-cancel>Abbrechen</button><button value="ok" class="btn primary">Speichern</button></div></form>`, { wide: true });
  const form = d.querySelector('form');
  form.querySelector('[data-cancel]').onclick = closeDialog;
  form.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'ok') return;
    let n = 0;
    for (const a of list) {
      const raw = new FormData(form).get(`p_${a.id}`);
      const v = raw === null || raw === '' ? '' : +raw;
      if (String(v) === String(a.manualPrice ?? '')) continue;
      a.manualPrice = v;
      if (v === '') { delete a.manualDate; if (a.valueMode) delete a.valueDate; } else if (a.valueMode) a.valueDate = today(); else a.manualDate = today();
      n++;
    }
    if (n) { await save(); toast(`${n} Wert${n === 1 ? '' : 'e'} gespeichert`); }
    done();
  });
}

export async function refreshAll({ silent = false } = {}) {
  const d = db();
  const curs = d.assets.flatMap(a => [a.currency, a.quote?.currency]).concat(d.expense.map(t => t.currency), d.income.map(t => t.currency));
  const errs = [];
  try { await fx.refresh(curs); } catch (e) { errs.push(e.message); }
  errs.push(...await refreshQuotes(d.assets, d.settings.twelveDataKey));
  // Währungen der frisch geladenen Kurse nachladen
  try { await fx.refresh(d.assets.map(a => a.quote?.currency)); } catch (e) { errs.push(e.message); }
  calc.takeSnapshot();
  await save();
  if (!silent) toast(errs.length ? `Teilweise aktualisiert: ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1})` : ''}` : 'Kurse aktualisiert');
  return errs;
}

export function render(el) {
  const p = calc.portfolio();
  const groups = [['Konten & Bargeld', LIQ], ['Aktien & ETFs', ['aktie', 'etf']], ['Edelmetalle', ['edelmetall']], ['Andere', ['andere']]];
  const price = r => {
    if (r.price == null) return '<span class="muted">kein Kurs</span>';
    const mt = r.a.type === 'edelmetall' ? `/${r.a.unit}` : '';
    const note = r.priceSource === 'cost' ? '<div class="small warnc">Einstand – kein Kurs</div>' : r.priceSource === 'manual' ? `<div class="small muted">manuell${r.a.manualDate ? ` · ${dispDate(r.a.manualDate)}` : ''}</div>` : '';
    return `${r.priceCur} ${fmt(r.price, r.price < 10 ? 4 : 2)}${mt}${note}`;
  };
  const row = r => {
    const a = r.a, foreign = a.currency !== 'CHF' || (r.priceCur && r.priceCur !== 'CHF');
    return `<tr>
      <td><b>${esc(a.name)}</b>${a.shared ? '<span class="badge">Haushalt</span>' : ''}<div class="muted small">${a.valueMode ? 'Nur Wert' : esc(a.symbol || '')}${a.exchange ? ` · ${esc(a.exchange)}` : ''}</div></td>
      <td class="num">${a.valueMode ? '' : fmt(r.qty, a.type === 'konto' ? 2 : 4)}${a.type === 'edelmetall' ? ` ${a.unit}` : ''}${r.flow?.count ? `<div class="small pos">inkl. +${fmt(r.flow.amount)} aus ${r.flow.count} Sparbeitr${r.flow.count === 1 ? 'ag' : 'ägen'}</div>` : ''}</td>
      <td class="num">${INV.includes(a.type) || a.type === 'andere' ? (a.costPrice === '' ? '–' : `${a.currency} ${fmt(+a.costPrice)}`) : ''}</td>
      <td class="num">${LIQ.includes(a.type) ? '' : a.valueMode ? `<span class="muted">Wert manuell</span>${a.valueDate ? `<div class="small muted">Stand ${dispDate(a.valueDate)}</div>` : ''}` : price(r)}</td>
      <td class="num">${foreign && r.valueCur != null ? `<div class="muted small">${r.priceCur} ${fmt(r.valueCur)}</div>` : ''}${chf(r.valueChf)}</td>
      <td class="num ${tone(r.pnlChf)}">${r.pnlChf == null ? '' : `<b>${arrow(r.pnlChf)} ${signed(r.pnlChf)}</b><div class="small">${pct(r.pnlPct)}</div>`}</td>
      <td class="num ${tone(r.dayChf)}">${r.dayChf == null ? '' : `${signed(r.dayChf)}<div class="small">${pct(r.dayPct)}</div>`}</td>
      <td class="num nowrap"><button class="icon" data-act="edit" data-id="${a.id}" aria-label="Bearbeiten">✎</button><button class="icon" data-act="del" data-id="${a.id}" aria-label="Löschen">✕</button></td></tr>`;
  };
  const rate = (c) => (fx.latest(c) != null ? `${c} ${fmt(fx.latest(c), 4)}` : null);
  const usedCur = [...new Set(db().assets.flatMap(a => [a.currency, a.quote?.currency]).filter(c => c && c !== 'CHF'))];

  el.innerHTML = `
    <div class="pagehead"><h1>Vermögen</h1><div class="row"><button class="btn" id="refresh">↻ Kurse aktualisieren</button><button class="btn" id="manual">✎ Kurse/Werte nachtragen</button><button class="btn primary" id="add">+ Position</button></div></div>
    <div class="grid kpis">
      <section class="card"><h3>Gesamtvermögen</h3><div class="kpi">${chf(p.total)}</div></section>
      <section class="card"><h3>Gewinn/Verlust gesamt</h3><div class="kpi ${tone(p.pnl)}">${arrow(p.pnl)} ${chf(p.pnl)}</div><div class="muted">${pct(p.pnlPct)} auf Einstand</div></section>
      <section class="card"><h3>Heute</h3><div class="kpi ${tone(p.day)}">${arrow(p.day)} ${chf(p.day)}</div></section>
    </div>
    ${p.rows.some(r => r.priceSource === 'cost') ? `<div class="banner">${p.rows.filter(r => r.priceSource === 'cost').map(r => esc(r.a.name)).join(', ')}: kein Kurs verfügbar – die Position ist zum <b>Einstandswert</b> im Vermögen enthalten (Gewinn/Verlust 0). Aktuellen Kurs mit ✎ manuell eintragen oder Symbol/Twelve-Data-Schlüssel prüfen.</div>` : ''}
    ${p.needsFx ? '<div class="banner">Wechselkurse fehlen – bitte «Kurse aktualisieren» (Internet nötig).</div>' : ''}
    ${usedCur.length ? `<p class="muted small">Wechselkurse (EZB): ${usedCur.map(c => rate(c) || `${c} –`).join(' · ')} → CHF${fx.latestDate() ? `, Stand ${fx.latestDate()}` : ''}</p>` : ''}
    ${groups.map(([label, types]) => {
      const rows = p.rows.filter(r => types.includes(r.a.type));
      if (!rows.length) return '';
      return `<h2>${label} <small>${chf(rows.reduce((a, r) => a + (r.valueChf || 0), 0))}</small></h2>
      <div class="card tablewrap"><table><thead><tr><th>Name</th><th class="num">Menge</th><th class="num">Einstand</th><th class="num">Kurs</th><th class="num">Wert</th><th class="num">Gewinn/Verlust</th><th class="num">Heute</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`;
    }).join('') || '<p class="muted">Noch keine Positionen. «+ Position» oder Excel-Import verwenden.</p>'}`;

  $('#add', el).onclick = async () => { if (await edit()) { render(el); } };
  $('#manual', el).onclick = () => manualValues(() => render(el));
  $('#refresh', el).onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Lade…';
    await refreshAll(); render(el);
  };
  el.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = db().assets.find(x => x.id === b.dataset.id);
    if (b.dataset.act === 'edit') { if (await edit(a)) render(el); }
    else if (await confirmBox('Position löschen', a.name, 'Löschen', true)) {
      db().assets = db().assets.filter(x => x.id !== a.id);
      for (const t of db().expense) if (t.assetId === a.id) delete t.assetId;
      for (const r of db().recurring || []) if (r.assetId === a.id) delete r.assetId;
      await save(); render(el);
    }
  };
}

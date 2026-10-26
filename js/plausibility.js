// Plausibilitätsprüfung für Importdaten (Einnahmen/Ausgaben/Vermögen).
import { CURRENCIES } from './fx.js';
import * as fx from './fx.js';
import { txChf } from './calc.js';
import { median, monthKey, today, fmt } from './util.js';

const dupKey = t => [t.date, (+t.amount).toFixed(2), t.currency, (t.description || '').toLowerCase().trim()].join('|');
const chfOf = t => txChf({ ...t, rate: t.rate ?? fx.latest(t.currency) ?? 1 });

/** rows: {income, expense, assets} aus excel.parse; existing: db(). Gibt Liste von Hinweisen zurück. */
export function check(rows, existing) {
  const issues = [];
  const add = (sheet, r, level, msg) => issues.push({ sheet, row: r?._row ?? null, level, msg });
  const now = today();

  for (const [sheet, list, ex] of [['Einnahmen', rows.income, existing.income], ['Ausgaben', rows.expense, existing.expense]]) {
    const seen = new Set();
    const exKeys = new Set(ex.map(dupKey));
    const valid = list.filter(r => !r._errors.length);

    for (const r of list) for (const e of r._errors) add(sheet, r, 'error', e);

    for (const r of valid) {
      if (r.date > now) add(sheet, r, 'warn', `Datum ${r.date} liegt in der Zukunft`);
      if (r.date < `${new Date().getFullYear() - 10}-01-01`) add(sheet, r, 'warn', `Datum ${r.date} liegt über 10 Jahre zurück`);
      if (r._negated) add(sheet, r, 'warn', 'Negativer Betrag – wird als positiver Betrag übernommen');
      if (r.amount === 0) add(sheet, r, 'warn', 'Betrag ist 0');
      if (r._noCategory) add(sheet, r, 'warn', 'Keine Kategorie – wird als «Unkategorisiert» übernommen');
      const k = dupKey(r);
      if (exKeys.has(k)) { r._dup = true; add(sheet, r, 'warn', 'Duplikat: identische Buchung existiert bereits'); }
      else if (seen.has(k)) { r._dup = true; add(sheet, r, 'warn', 'Duplikat innerhalb der Importdatei'); }
      seen.add(k);
    }

    // Ausreisser je Kategorie (robust: Median + MAD)
    const byCat = new Map();
    for (const t of [...ex, ...valid]) {
      const c = t.category || 'Unkategorisiert';
      byCat.set(c, [...(byCat.get(c) || []), chfOf(t)]);
    }
    for (const r of valid) {
      const vals = byCat.get(r.category || 'Unkategorisiert') || [];
      if (vals.length < 5) continue;
      const med = median(vals);
      const mad = median(vals.map(v => Math.abs(v - med))) * 1.4826 || med * 0.1 || 1;
      const x = chfOf(r);
      if ((x - med) / mad > 4 && x > 1.5 * med) {
        add(sheet, r, 'warn', `Ungewöhnlich hoher Betrag für «${r.category}»: CHF ${fmt(x)} (typisch ca. CHF ${fmt(med)})`);
      }
    }

    // Monatssummen-Abweichung und fehlende Dauerposten (nur abgeschlossene Monate)
    const all = [...ex, ...valid];
    const months = {};
    for (const t of all) (months[monthKey(t.date)] ||= []).push(t);
    const curMonth = monthKey(now);
    const importedMonths = [...new Set(valid.map(r => monthKey(r.date)))].filter(m => m < curMonth).sort();
    const totals = Object.fromEntries(Object.entries(months).map(([m, l]) => [m, l.reduce((a, t) => a + chfOf(t), 0)]));
    for (const m of importedMonths) {
      const others = Object.entries(totals).filter(([k]) => k !== m && k < curMonth).map(([, v]) => v);
      if (others.length >= 3) {
        const avg = others.reduce((a, b) => a + b, 0) / others.length;
        const dev = ((totals[m] - avg) / avg) * 100;
        if (avg > 0 && Math.abs(dev) > 40) {
          add(sheet, null, 'warn', `Monat ${m}: Summe CHF ${fmt(totals[m])} weicht ${dev > 0 ? '+' : ''}${fmt(dev, 0)} % vom Durchschnitt (CHF ${fmt(avg)}) ab`);
        }
      }
      const prior = Object.keys(months).filter(k => k < m).sort().slice(-3);
      if (prior.length === 3) {
        const catsOf = k => new Set(months[k].map(t => t.category || 'Unkategorisiert'));
        const here = catsOf(m);
        for (const c of catsOf(prior[0])) {
          if (prior.every(k => catsOf(k).has(c)) && !here.has(c)) {
            add(sheet, null, 'info', `Monat ${m}: Regelmässige Kategorie «${c}» fehlt (kam in den 3 Vormonaten jeweils vor)`);
          }
        }
      }
    }
  }

  for (const r of rows.assets) {
    for (const e of r._errors) add('Vermögen', r, 'error', e);
    if (r._errors.length) continue;
    if (r.type !== 'konto' && r.qty <= 0) add('Vermögen', r, 'warn', 'Menge ist 0 oder negativ');
    if (['aktie', 'etf', 'edelmetall'].includes(r.type) && (r.costPrice === '' || r.costPrice == null)) {
      add('Vermögen', r, 'warn', 'Kein Einstandspreis – Gewinn/Verlust kann nicht berechnet werden');
    }
    if (['aktie', 'etf'].includes(r.type) && !r.symbol) add('Vermögen', r, 'warn', 'Kein Symbol – Kurs kann nicht automatisch abgerufen werden');
    if (r.type === 'andere' && (r.manualPrice === '' || r.manualPrice == null)) add('Vermögen', r, 'info', 'Kein manueller Kurs – Wert ist unbekannt');
  }
  return issues;
}

export const validCurrency = c => CURRENCIES.includes(c);

// Reiter «Einstellungen»: Excel Import/Export, Sicherheit, Marktdaten, Version.
import * as store from './store.js';
import { db, save } from './store.js';
import * as excel from './excel.js';
import * as fx from './fx.js';
import { check } from './plausibility.js';
import { $, esc, download, today, dispDate, uid, fmtDate } from './util.js';
import { openDialog, closeDialog, confirmBox, toast } from './ui.js';
import { currentVersion, showWhatsNew } from './update.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------- Import mit Plausibilitätsprüfung ----------
async function importFile(file, onDone) {
  let rows;
  try { rows = excel.parse(await file.arrayBuffer()); } catch (e) { toast(`Import nicht möglich: ${e.message}`); return; }
  // Kurse für Fremdwährungen der Importdatei laden, damit CHF-Vergleiche stimmen
  try { await fx.refresh([...rows.income, ...rows.expense, ...rows.assets].map(r => r.currency)); } catch { /* offline: Prüfung nutzt Näherung */ }
  const issues = check(rows, db());
  const count = k => rows[k].filter(r => !r._errors.length).length;
  const errs = issues.filter(i => i.level === 'error'), warns = issues.filter(i => i.level === 'warn'), infos = issues.filter(i => i.level === 'info');
  const li = i => `<li class="${i.level}"><b>${i.sheet}${i.row ? ` · Zeile ${i.row}` : ''}:</b> ${esc(i.msg)}</li>`;
  const sect = (title, list, cls) => list.length ? `<h3 class="${cls}">${title} (${list.length})</h3><ul class="issues">${list.slice(0, 200).map(li).join('')}${list.length > 200 ? `<li>… und ${list.length - 200} weitere</li>` : ''}</ul>` : '';

  const dupCount = ['income', 'expense'].reduce((n, k) => n + rows[k].filter(r => r._dup && !r._errors.length).length, 0);
  const d = openDialog(`<div class="form"><h2>Import prüfen</h2>
    <p>Gefunden: <b>${count('income')}</b> Einnahmen, <b>${count('expense')}</b> Ausgaben, <b>${count('assets')}</b> Vermögenspositionen gültig.
    ${errs.length ? `<br><span class="neg">${errs.length} fehlerhafte Zeilen werden nie importiert.</span>` : ''}</p>
    ${!issues.length ? '<p class="pos">✓ Keine Auffälligkeiten gefunden.</p>' : ''}
    ${sect('Fehler', errs, 'neg')}${sect('Auffälligkeiten', warns, 'warnc')}${sect('Hinweise', infos, 'muted')}
    <div class="actions"><button class="btn ghost" id="i-cancel">Abbrechen</button>
    ${dupCount ? `<button class="btn" id="i-nodup">Ohne ${dupCount} Duplikate importieren</button>` : ''}
    <button class="btn primary" id="i-all">Gültige Zeilen importieren</button></div></div>`, { wide: true });

  const run = async skipDup => {
    const keep = r => !r._errors.length && !(skipDup && r._dup);
    const clean = r => { const o = { ...r }; for (const k of Object.keys(o)) if (k.startsWith('_')) delete o[k]; return o; };
    const dbx = db();
    for (const k of ['income', 'expense']) {
      for (const r of rows[k].filter(keep)) {
        const o = clean(r);
        try { if (o.currency !== 'CHF') o.rate = await fx.rateAt(o.currency, o.date); } catch { /* letzter Kurs als Fallback */ }
        dbx[k].push(o);
      }
    }
    for (const r of rows.assets.filter(keep)) {
      const o = clean(r);
      const ex = dbx.assets.find(a => a.type === o.type && a.name.toLowerCase() === o.name.toLowerCase() && (a.symbol || '') === o.symbol);
      if (ex) Object.assign(ex, { ...o, id: ex.id, quote: ex.quote, prevClose: ex.prevClose }); else dbx.assets.push(o);
    }
    await save(); closeDialog(); toast('Import abgeschlossen'); onDone();
  };
  $('#i-cancel', d).onclick = closeDialog;
  $('#i-all', d).onclick = () => run(false);
  $('#i-nodup', d)?.addEventListener('click', () => run(true));
}

// ---------- Demo-Daten ----------
function demo() {
  const d = db(), now = new Date();
  const cats = [['Wohnen', 1800, 1800], ['Krankenkasse', 420, 420], ['Lebensmittel', 450, 700], ['Mobilität', 120, 260], ['Freizeit', 100, 400]];
  for (let m = 5; m >= 0; m--) {
    const dt = day => fmtDate(new Date(now.getFullYear(), now.getMonth() - m, day));
    d.income.push({ id: uid(), date: dt(25), category: 'Lohn', description: 'Monatslohn', amount: 6200, currency: 'CHF', account: 'Lohnkonto' });
    cats.forEach(([c, lo, hi], i) => d.expense.push({ id: uid(), date: dt(3 + i * 4), category: c, description: '', amount: Math.round(lo + (hi - lo) * ((m * 37 + i * 17) % 100) / 100), currency: 'CHF', account: 'Lohnkonto' }));
  }
  d.assets.push(
    { id: uid(), type: 'konto', name: 'Lohnkonto', qty: 8400, currency: 'CHF', costPrice: '' },
    { id: uid(), type: 'konto', name: 'USD-Konto', qty: 3000, currency: 'USD', costPrice: '' },
    { id: uid(), type: 'aktie', name: 'Nestlé', symbol: 'NESN', exchange: 'SIX', qty: 50, currency: 'CHF', costPrice: 92, manualPrice: '', quote: { price: 96.4, prev: 95.7, currency: 'CHF', date: today() } },
    { id: uid(), type: 'edelmetall', name: 'Gold', symbol: 'XAU', qty: 20, unit: 'g', currency: 'CHF', costPrice: 62, quote: { price: 2650, prev: null, currency: 'USD', date: today() } },
  );
}

// ---------- Ansicht ----------
export async function render(el, { lock, rerender }) {
  const s = db().settings;
  const ver = await currentVersion();
  el.innerHTML = `
    <div class="pagehead"><h1>Einstellungen</h1></div>

    <section class="card"><h2>Excel</h2>
      <p class="muted">Export enthält alle Daten im gleichen Format wie die Vorlage – so ist ein Re-Import möglich.</p>
      <div class="row wrap">
        <button class="btn" id="x-export">Excel exportieren</button>
        <button class="btn" id="x-template">Leere Vorlage</button>
        <label class="btn primary">Excel importieren<input type="file" id="x-import" accept=".xlsx,.xls,.xlsm" hidden></label>
      </div></section>

    <section class="card"><h2>Marktdaten</h2>
      <p class="muted">Aktien/ETFs: kostenloser API-Schlüssel von <b>twelvedata.com</b>. Edelmetalle und Wechselkurse benötigen keinen Schlüssel. Der Schlüssel wird nur verschlüsselt auf diesem Gerät gespeichert.</p>
      <label class="field"><span>Twelve-Data-API-Schlüssel</span><input id="s-key" type="password" autocomplete="off" value="${esc(s.twelveDataKey)}"></label></section>

    <section class="card"><h2>Sicherheit & Backup</h2>
      <label class="field"><span>Automatisch sperren nach (Minuten Inaktivität)</span>
        <select id="s-lock">${[1, 2, 5, 10, 30].map(m => `<option value="${m}"${m === s.autoLockMin ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <div class="row wrap">
        <button class="btn" id="b-lock">Jetzt sperren</button>
        <button class="btn" id="b-backup">Verschlüsseltes Backup</button>
        <label class="btn">Backup wiederherstellen<input type="file" id="b-restore" hidden></label>
      </div>
      <p class="muted small">Letztes Backup: ${s.lastBackup ? dispDate(fmtDate(new Date(s.lastBackup))) : 'noch nie'}. Ohne Passwort gibt es keine Wiederherstellung.</p></section>

    <section class="card"><h2>Daten</h2>
      <div class="row wrap"><button class="btn" id="d-demo">Demodaten laden</button><button class="btn danger" id="d-wipe">Alle Daten löschen</button></div></section>

    <section class="card"><h2>Über die App</h2>
      <p>Version <b>${esc(ver)}</b></p>
      <div class="row wrap"><button class="btn" id="u-log">Versionshistorie</button><button class="btn" id="u-check">Nach Update suchen</button></div></section>`;

  $('#x-export', el).onclick = () => download(`Budget_${today()}.xlsx`, excel.exportData(db()), XLSX_MIME);
  $('#x-template', el).onclick = () => download('Budget_Vorlage.xlsx', excel.exportTemplate(), XLSX_MIME);
  $('#x-import', el).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f, rerender); };

  $('#s-key', el).onchange = async e => { s.twelveDataKey = e.target.value.trim(); await save(); toast('Gespeichert'); };
  $('#s-lock', el).onchange = async e => { s.autoLockMin = +e.target.value; await save(); };
  $('#b-lock', el).onclick = lock;
  $('#b-backup', el).onclick = async () => {
    download(`Budget_Backup_${today()}.budget`, await store.backupFile(), 'application/json');
    s.lastBackup = Date.now(); await save(); rerender();
  };
  $('#b-restore', el).onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const text = await f.text();
    const d = openDialog(`<form method="dialog" class="form"><h2>Backup wiederherstellen</h2>
      <p>Ersetzt <b>alle aktuellen Daten</b>. Passwort des Backups eingeben (danach gilt dieses Passwort).</p>
      <label class="field"><span>Passwort</span><input type="password" name="pw" required autocomplete="off"></label>
      <div class="actions"><button value="cancel" class="btn ghost" formnovalidate>Abbrechen</button><button value="ok" class="btn danger">Wiederherstellen</button></div></form>`);
    d.querySelector('form').addEventListener('submit', async ev => {
      if (ev.submitter?.value !== 'ok') return;
      try { await store.restoreBackup(text, new FormData(ev.target).get('pw')); toast('Backup wiederhergestellt'); rerender(); }
      catch (err) { toast(err.message); }
    });
  };
  $('#d-demo', el).onclick = async () => { if (await confirmBox('Demodaten', 'Beispieldaten zu den bestehenden Daten hinzufügen?', 'Hinzufügen')) { demo(); await save(); toast('Demodaten geladen'); } };
  $('#d-wipe', el).onclick = async () => {
    if (await confirmBox('Alle Daten löschen', 'Alle Daten auf diesem Gerät werden unwiderruflich gelöscht. Vorher ein Backup erstellen!', 'Endgültig löschen', true)) {
      await store.wipe(); location.reload();
    }
  };
  $('#u-log', el).onclick = () => showWhatsNew({ force: true });
  $('#u-check', el).onclick = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update().catch(() => {});
    toast('Suche abgeschlossen – bei einer neuen Version lädt die App automatisch neu.');
  };
}

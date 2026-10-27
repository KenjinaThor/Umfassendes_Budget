// Reiter «Einstellungen»: Excel Import/Export, Sicherheit, Marktdaten, Version.
import * as store from './store.js';
import { db, save } from './store.js';
import * as excel from './excel.js';
import * as fx from './fx.js';
import { check } from './plausibility.js';
import { $, esc, download, today, dispDate, uid, fmtDate } from './util.js';
import { openDialog, closeDialog, confirmBox, toast, formDialog } from './ui.js';
import { currentVersion, showWhatsNew } from './update.js';
import * as passkey from './passkey.js';
import * as recurring from './recurring.js';
import * as budgetLib from './budget.js';

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
    <p>Gefunden: <b>${count('income')}</b> Einnahmen, <b>${count('expense')}</b> Ausgaben, <b>${count('assets')}</b> Vermögenspositionen und <b>${(rows.budget || []).filter(b => !b._errors.length).length}</b> Budgetbeträge und <b>${(rows.recurring || []).filter(b => !b._errors.length).length}</b> wiederkehrende Einträge gültig.
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
    for (const r of rows.assets.filter(keep)) {
      const o = clean(r);
      const ex = dbx.assets.find(a => a.type === o.type && a.name.toLowerCase() === o.name.toLowerCase() && (a.symbol || '') === o.symbol);
      if (ex) Object.assign(ex, { ...o, id: ex.id, quote: ex.quote, prevClose: ex.prevClose });
      else { if (o.type === 'konto' && !o.balanceDate) o.balanceDate = today(); dbx.assets.push(o); }
    }
    const idOf = n => (n ? dbx.assets.find(a => a.type === 'konto' && a.name.toLowerCase() === n.toLowerCase())?.id : undefined);
    for (const k of ['income', 'expense']) {
      for (const r of rows[k].filter(keep)) {
        const o = clean(r);
        if (k === 'expense' && idOf(r._assetName)) o.assetId = idOf(r._assetName);
        try { if (o.currency !== 'CHF') o.rate = await fx.rateAt(o.currency, o.date); } catch { /* letzter Kurs als Fallback */ }
        dbx[k].push(o);
      }
    }
    dbx.recurring ||= [];
    for (const r of (rows.recurring || []).filter(keep)) {
      const o = clean(r);
      if (o.kind === 'expense' && idOf(r._assetName)) o.assetId = idOf(r._assetName);
      const ex = dbx.recurring.find(x => x.kind === o.kind && x.category === o.category && x.description === o.description && x.start === o.start);
      if (ex) Object.assign(ex, { ...o, id: ex.id, skip: ex.skip }); else dbx.recurring.push(o);
    }
    const bp = (dbx.settings.budget ||= {});
    for (const b of (rows.budget || []).filter(b => !b._errors.length)) {
      budgetLib.setSollFlat(b.name, b.amount);
      if (b.auto === true && b.amount > 0 && b.kind !== 'income') budgetLib.setAuto(b.name, true, b.from, b.kind); else if (b.auto === false) budgetLib.setAuto(b.name, false);
    }
    recurring.materialize();
    await save(); closeDialog(); toast('Import abgeschlossen'); onDone();
  };
  $('#i-cancel', d).onclick = closeDialog;
  $('#i-all', d).onclick = () => run(false);
  $('#i-nodup', d)?.addEventListener('click', () => run(true));
}

// ---------- Demo-Daten ----------
function demo() {
  const d = db(), now = new Date();
  const cats = [['Miete inkl. Nebenkosten (Heizung, Wasser)', 1800, 1800], ['Krankenkasse Grundversicherung (KVG)', 420, 420], ['Lebensmittel & Supermarkt (Migros, Coop, Aldi, Lidl)', 450, 700], ['Treibstoff (Benzin / Diesel / Strom)', 120, 260], ['Kultur, Kino, Events & Hobbys', 100, 400], ['Säule 3a (Gebundene Vorsorge)', 605, 605]];
  for (let m = 5; m >= 0; m--) {
    const dt = day => fmtDate(new Date(now.getFullYear(), now.getMonth() - m, day));
    d.income.push({ id: uid(), date: dt(25), category: 'Nettolohn Haupterwerb (inkl. 13. Monatslohn / 12)', description: 'Monatslohn', amount: 6200, currency: 'CHF', account: 'Lohnkonto' });
    cats.forEach(([c, lo, hi], i) => d.expense.push({ id: uid(), date: dt(2 + i * 4), category: c, description: '', amount: Math.round(lo + (hi - lo) * ((m * 37 + i * 17) % 100) / 100), currency: 'CHF', account: 'Lohnkonto' }));
  }
  d.assets.push(
    { id: uid(), type: 'konto', name: 'Lohnkonto', qty: 8400, currency: 'CHF', costPrice: '' },
    { id: uid(), type: 'konto', name: 'USD-Konto', qty: 3000, currency: 'USD', costPrice: '' },
    { id: uid(), type: 'aktie', name: 'Nestlé', symbol: 'NESN', exchange: 'SIX', qty: 50, currency: 'CHF', costPrice: 92, manualPrice: '', quote: { price: 96.4, prev: 95.7, currency: 'CHF', date: today() } },
    { id: uid(), type: 'edelmetall', name: 'Gold', symbol: 'XAU', qty: 20, unit: 'g', currency: 'CHF', costPrice: 62, quote: { price: 2650, prev: null, currency: 'USD', date: today() } },
  );
}

// ---------- Ansicht ----------
export async function render(el, { lock, rerender, applyName }) {
  const s = db().settings;
  const ver = await currentVersion();
  const bioSupported = store.isCloud && passkey.supported();
  const bioOn = bioSupported && await passkey.isEnrolled();
  const hh = store.householdInfo();
  el.innerHTML = `
    <div class="pagehead"><h1>Einstellungen</h1></div>

    ${store.isCloud ? `
    <section class="card"><h2>Konto</h2>
      <p><b>${esc(store.account().email)}</b></p>
      <label class="field"><span>Anzeigename (sichtbar für Haushaltsmitglieder)</span><input id="a-name" maxlength="60" value="${esc(store.account().displayName)}"></label>
      <div class="row wrap"><button class="btn" id="a-pw">Passwort ändern</button>
        ${bioSupported ? `<button class="btn" id="a-bio">${bioOn ? 'Biometrie deaktivieren' : 'Biometrie aktivieren'}</button>` : ''}
        <button class="btn" id="a-out">Abmelden</button><button class="btn danger" id="a-del">Konto löschen</button></div>
      <p class="muted small">Alle Daten sind Ende-zu-Ende-verschlüsselt; der Server sieht nur Chiffretext.</p></section>

    <section class="card"><h2>Haushalt</h2>
      ${hh ? `<p>Mitglieder: <b>${hh.members.map(esc).join(', ') || '–'}</b></p>
        <p class="muted small">Einträge mit «Gemeinsam» sehen und bearbeiten alle Mitglieder. Alles andere bleibt privat.</p>
        <div class="row wrap"><button class="btn primary" id="h-invite">Einladungscode erzeugen</button><button class="btn danger" id="h-leave">Haushalt verlassen</button></div>
        <div id="h-code"></div>`
      : `<p class="muted">Verknüpfe dich mit Partner/in oder Familie, um ausgewählte Einträge gemeinsam zu führen.</p>
        <div class="row wrap"><button class="btn primary" id="h-create">Haushalt erstellen</button></div>
        <div class="row" style="margin-top:.8rem"><input id="h-codein" placeholder="Einladungscode (XXXX-XXXX-…)" autocomplete="off"><button class="btn" id="h-join">Beitreten</button></div>`}
    </section>` : ''}

    <section class="card"><h2>Allgemein</h2>
      <label class="field"><span>App-Name</span><input id="s-name" maxlength="40" value="${esc(s.appName || 'Umfassendes Budget')}"></label></section>

    <section class="card"><h2>Excel</h2>
      <p class="muted">Export enthält alle Daten im gleichen Format wie die Vorlage – so ist ein Re-Import möglich.</p>
      <div class="row wrap">
        <button class="btn" id="x-export">Excel exportieren</button>
        <button class="btn" id="x-template">Leere Vorlage</button>
        <label class="btn primary">Excel importieren<input type="file" id="x-import" accept=".xlsx,.xls,.xlsm" hidden></label>
      </div></section>

    <section class="card"><h2>Marktdaten</h2>
      <p class="muted">Aktien/ETFs: kostenloser API-Schlüssel von <b>twelvedata.com</b>. Edelmetalle und Wechselkurse benötigen keinen Schlüssel. Der Schlüssel wird nur verschlüsselt gespeichert.</p>
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
      <div class="row wrap"><button class="btn" id="d-demo">Demodaten laden</button><button class="btn danger" id="d-wipe">${store.isCloud ? 'Lokale Daten entfernen' : 'Alle Daten löschen'}</button></div></section>

    <section class="card"><h2>Über die App</h2>
      <p>Version <b>${esc(ver)}</b></p>
      <div class="row wrap"><button class="btn" id="u-log">Versionshistorie</button><button class="btn" id="u-check">Nach Update suchen</button></div></section>`;


  if (store.isCloud) {
    const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
    $('#a-name', el).onchange = guard(async e => { await store.setDisplayName(e.target.value.trim()); toast('Gespeichert'); });
    $('#a-pw', el).onclick = guard(async () => {
      const v = await formDialog({ title: 'Passwort ändern', submit: 'Ändern', fields: [
        { name: 'old', label: 'Aktuelles Passwort', type: 'password', required: true },
        { name: 'new', label: 'Neues Passwort (min. 10 Zeichen)', type: 'password', required: true },
      ] });
      if (!v) return;
      if (v.new.length < 10) throw new Error('Neues Passwort ist zu kurz.');
      await store.changePassword(v.old, v.new); toast('Passwort geändert');
    });
    $('#a-bio', el)?.addEventListener('click', guard(async () => {
      if (bioOn) await passkey.remove(); else await passkey.enroll(store.masterKey(), store.account().email);
      rerender();
    }));
    $('#a-out', el).onclick = guard(async () => {
      if (await confirmBox('Abmelden', 'Die lokale Kopie wird von diesem Gerät entfernt (die Daten bleiben im Konto). Nicht synchronisierte Änderungen gehen verloren.', 'Abmelden', true)) { await store.wipe(); location.reload(); }
    });
    $('#a-del', el).onclick = guard(async () => {
      if (await confirmBox('Konto löschen', 'Konto und ALLE Daten werden unwiderruflich gelöscht – auch für den Haushalt, falls du das letzte Mitglied bist.', 'Endgültig löschen', true)) { await store.deleteAccount(); location.reload(); }
    });
    $('#h-create', el)?.addEventListener('click', guard(async () => { await store.createHousehold(); toast('Haushalt erstellt'); rerender(); }));
    $('#h-join', el)?.addEventListener('click', guard(async () => {
      const code = $('#h-codein', el).value.trim();
      if (!code) return;
      await store.joinHousehold(code); toast('Haushalt beigetreten'); rerender();
    }));
    $('#h-invite', el)?.addEventListener('click', guard(async () => {
      const code = await store.createInvite();
      $('#h-code', el).innerHTML = `<p class="muted small" style="margin-top:.8rem">Einmalig gültig, 7 Tage. Sicher weitergeben (z. B. persönlich oder per Signal):</p><div class="codebox">${esc(code)}</div>`;
    }));
    $('#h-leave', el)?.addEventListener('click', guard(async () => {
      if (await confirmBox('Haushalt verlassen', 'Du verlierst den Zugriff auf neue gemeinsame Einträge. Eine Kopie der bisher gemeinsamen Einträge bleibt bei dir als privater Bestand.', 'Verlassen', true)) { await store.leaveHousehold(); rerender(); }
    }));
  }

  $('#x-export', el).onclick = async () => download(`Budget_${today()}.xlsx`, await excel.exportData(db()), XLSX_MIME);
  $('#x-template', el).onclick = async () => download('Budget_Vorlage.xlsx', await excel.exportTemplate(), XLSX_MIME);
  $('#x-import', el).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f, rerender); };

  $('#s-name', el).onchange = async e => { s.appName = e.target.value.trim() || 'Umfassendes Budget'; applyName(s.appName); await save(); toast('Gespeichert'); };
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
    if (store.isCloud) {
      if (!(await confirmBox('Backup wiederherstellen', 'Die Daten im Backup überschreiben gleiche Einträge; nicht enthaltene Einträge werden gelöscht.', 'Wiederherstellen', true))) return;
      try { await store.restoreBackup(text); toast('Backup wiederhergestellt'); rerender(); } catch (err) { toast(err.message); }
      return;
    }
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

import * as store from './store.js';
import * as dashboard from './dashboard.js';
import * as tx from './view-tx.js';
import * as assets from './view-assets.js';
import * as budget from './view-budget.js';
import * as settings from './view-settings.js';
import { registerSW, showWhatsNew } from './update.js';
import { $, esc } from './util.js';
import { toast, confirmBox } from './ui.js';
import * as passkey from './passkey.js';

const app = $('#app');
const getName = () => { try { return localStorage.getItem('app-name') || 'Umfassendes Budget'; } catch { return 'Umfassendes Budget'; } };
export function applyName(n) { try { localStorage.setItem('app-name', n); } catch { /* ignorieren */ } document.title = n; const b = document.querySelector('.brand span'); if (b) b.textContent = n; }
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  income: '<path d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  expense: '<path d="M12 20V8m0 0l-5 5m5-5l5 5M5 4h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  budget: '<path d="M4 5h16M4 12h10M4 19h16M17 10l3 2-3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  assets: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.4 5.5l1.6 1.2-2 3.4-1.9-.6a7 7 0 01-1.7 1l-.4 2h-4l-.4-2a7 7 0 01-1.7-1l-1.9.6-2-3.4 1.6-1.2a7 7 0 010-2L2 10.3l2-3.4 1.9.6a7 7 0 011.7-1l.4-2h4l.4 2a7 7 0 011.7 1l1.9-.6 2 3.4-1.6 1.2a7 7 0 010 2z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};
const ROUTES = [
  ['dashboard', 'Dashboard'], ['income', 'Einnahmen'], ['expense', 'Ausgaben'], ['budget', 'Budgetplan'], ['assets', 'Vermögen'], ['settings', 'Einstellungen'],
];

// ---------- Anmeldung / Sperrbildschirm ----------
const shell = inner => { app.innerHTML = `<main class="lock"><div class="card"><img src="icons/icon.svg" alt="" width="64" height="64"><h1>${esc(getName())}</h1>${inner}</div></main>`; };
const field = (label, name, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" required ${extra}></label>`;

async function showLock() {
  if (!store.isCloud) return showLocalLock();
  const email = await store.cachedEmail();
  return email ? showUnlock(email) : showLogin();
}

async function showLocalLock() {
  const exists = await store.hasVault();
  shell(`<form id="lockf">
    <p class="muted">${exists ? 'Passwort eingeben, um die Daten zu entschlüsseln.' : 'Passwort festlegen. Die Daten werden damit auf diesem Gerät verschlüsselt. <b>Es gibt keine Wiederherstellung bei vergessenem Passwort.</b>'}</p>
    ${field('Passwort', 'pw', 'password', `minlength="${exists ? 1 : 10}" autocomplete="${exists ? 'current-password' : 'new-password'}" autofocus`)}
    ${exists ? '' : field('Passwort wiederholen', 'pw2', 'password', 'autocomplete="new-password"')}
    <button class="btn primary wide" type="submit">${exists ? 'Entsperren' : 'Tresor erstellen'}</button><p class="neg" id="lockerr" role="alert"></p></form>`);
  $('#lockf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), pw = f.get('pw'), err = $('#lockerr'), btn = e.submitter;
    err.textContent = '';
    if (!exists && pw !== f.get('pw2')) { err.textContent = 'Passwörter stimmen nicht überein.'; return; }
    btn.disabled = true; btn.textContent = 'Bitte warten…';
    try { await (exists ? store.unlock(pw) : store.create(pw)); start(); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = exists ? 'Entsperren' : 'Tresor erstellen'; }
  };
}

function showLogin(mode = 'login', note = '') {
  const reg = mode === 'register';
  shell(`<div class="tabs"><button class="btn ${reg ? '' : 'primary'}" data-m="login">Anmelden</button><button class="btn ${reg ? 'primary' : ''}" data-m="register">Registrieren</button></div>
    ${note ? `<p class="pos">${esc(note)}</p>` : ''}
    <form id="authf">
      ${reg ? field('Name (für den Haushalt sichtbar)', 'name', 'text', 'maxlength="60" autocomplete="name"') : ''}
      ${field('E-Mail', 'email', 'email', 'autocomplete="email"')}
      ${field('Passwort', 'pw', 'password', `minlength="${reg ? 10 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"`)}
      ${reg ? field('Passwort wiederholen', 'pw2', 'password', 'autocomplete="new-password"') + '<p class="muted small">Mindestens 10 Zeichen. Das Passwort verschlüsselt deine Daten und verlässt dieses Gerät nie. Ohne Passwort <b>und</b> Wiederherstellungscode sind die Daten nicht wiederherstellbar.</p>' : ''}
      <button class="btn primary wide" type="submit">${reg ? 'Konto erstellen' : 'Anmelden'}</button>
      <p class="neg" id="lockerr" role="alert"></p>
      ${reg ? '' : '<button type="button" class="linkbtn" id="forgot">Passwort vergessen?</button>'}
    </form>`);
  app.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => showLogin(b.dataset.m); });
  $('#forgot')?.addEventListener('click', async () => {
    const email = $('#authf input[name=email]').value;
    if (!email) { $('#lockerr').textContent = 'Bitte zuerst die E-Mail-Adresse eingeben.'; return; }
    try { await store.sendPasswordReset(email); showLogin('login', 'Wenn das Konto existiert, wurde eine E-Mail mit Reset-Link gesendet. Den Wiederherstellungscode bereithalten.'); }
    catch (ex) { $('#lockerr').textContent = ex.message; }
  });
  $('#authf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), err = $('#lockerr'), btn = e.submitter, label = btn.textContent;
    err.textContent = '';
    if (reg && f.get('pw') !== f.get('pw2')) { err.textContent = 'Passwörter stimmen nicht überein.'; return; }
    btn.disabled = true; btn.textContent = 'Bitte warten…';
    try {
      if (reg) {
        const r = await store.register(f.get('email'), f.get('pw'), f.get('name'));
        if (r.needsConfirm) { showLogin('login', 'Bestätigungs-E-Mail gesendet. Link öffnen, danach hier anmelden.'); return; }
      }
      const { recoveryCode } = await store.login(f.get('email'), f.get('pw'));
      if (recoveryCode) showRecoveryCode(recoveryCode); else start();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = label; }
  };
}

function showRecoveryCode(code) {
  shell(`<h2>Wiederherstellungscode</h2>
    <p>Dieser Code ist die <b>einzige</b> Möglichkeit, deine Daten bei vergessenem Passwort zu retten. Jetzt notieren und sicher aufbewahren (nicht auf dem Handy allein). Er wird nie wieder angezeigt.</p>
    <div class="codebox">${esc(code)}</div>
    <label class="field check" style="margin-top:1rem"><input type="checkbox" id="rc-ok"><span>Ich habe den Code sicher aufbewahrt.</span></label>
    <button class="btn primary wide" id="rc-go" disabled>Weiter</button>`);
  $('#rc-ok').onchange = e => { $('#rc-go').disabled = !e.target.checked; };
  $('#rc-go').onclick = start;
}

async function showUnlock(email) {
  const bio = passkey.supported() && await passkey.isEnrolled();
  shell(`<form id="lockf"><p class="muted">${esc(email)}</p>
    ${field('Passwort', 'pw', 'password', 'autocomplete="current-password" autofocus')}
    <button class="btn primary wide" type="submit">Entsperren</button>
    ${bio ? '<button type="button" class="btn wide" id="bio" style="margin-top:.5rem">🔓 Mit Biometrie entsperren</button>' : ''}
    <p class="neg" id="lockerr" role="alert"></p>
    <button type="button" class="linkbtn" id="other">Abmelden / anderes Konto</button></form>`);
  $('#lockf').onsubmit = async e => {
    e.preventDefault();
    const pw = new FormData(e.target).get('pw'), err = $('#lockerr'), btn = e.submitter;
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Bitte warten…';
    try { await store.unlockCached(pw); start({ password: pw }); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Entsperren'; }
  };
  $('#bio')?.addEventListener('click', async () => {
    try { await store.unlockWithKey(await passkey.unlockKey()); start(); } catch (ex) { $('#lockerr').textContent = ex.message; }
  });
  $('#other').onclick = async () => {
    if (await confirmBox('Abmelden', 'Die lokale Kopie wird von diesem Gerät entfernt. Nicht synchronisierte Änderungen gehen verloren.', 'Abmelden', true)) { await store.wipe(); showLogin(); }
  };
}

function showRecoveryReset() {
  shell(`<h2>Neues Passwort setzen</h2><form id="rf">
    ${field('Wiederherstellungscode', 'code', 'text', 'autocomplete="off"')}
    ${field('Neues Passwort (min. 10 Zeichen)', 'pw', 'password', 'minlength="10" autocomplete="new-password"')}
    <button class="btn primary wide" type="submit">Passwort ändern</button><p class="neg" id="lockerr"></p></form>`);
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await store.completeRecovery(f.get('code'), f.get('pw')); showLogin('login', 'Passwort geändert. Bitte mit dem neuen Passwort anmelden.'); }
    catch (ex) { $('#lockerr').textContent = ex.message; }
  };
}

// ---------- Hauptansicht ----------
let idleTimer;
function armIdle() {
  clearTimeout(idleTimer);
  if (!store.isUnlocked()) return;
  idleTimer = setTimeout(lock, store.db().settings.autoLockMin * 60_000);
}
function lock() {
  clearTimeout(idleTimer);
  store.lock();
  $('#dlg').open && $('#dlg').close();
  showLock();
}
['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(ev => addEventListener(ev, armIdle, { passive: true }));

function route() {
  const name = (location.hash.replace('#/', '') || 'dashboard');
  const key = ROUTES.some(r => r[0] === name) ? name : 'dashboard';
  const view = $('#view');
  view.onclick = null; view.dataset.edit = '0';
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.r === key);
  const rerender = route;
  ({
    dashboard: () => dashboard.render(view),
    income: () => tx.render(view, 'income'),
    expense: () => tx.render(view, 'expense'),
    budget: () => budget.render(view),
    assets: () => assets.render(view),
    settings: () => settings.render(view, { lock, rerender, applyName }),
  })[key]();
  scrollTo(0, 0);
}

async function start({ password } = {}) {
  app.innerHTML = `<div class="shell">
    <nav aria-label="Hauptnavigation"><div class="brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span>${esc(getName())}</span></div>
      ${ROUTES.map(([k, l]) => `<a href="#/${k}" data-r="${k}"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${ICONS[k]}</svg><span>${esc(l)}</span></a>`).join('')}
      <button class="syncpill" id="syncpill" hidden></button>
      <button class="navlock" id="navlock">🔒 Sperren</button></nav>
    <main id="view"></main></div>`;
  $('#navlock').onclick = lock;
  if (store.isCloud) wireSync(password);
  armIdle();
  route();
  showWhatsNew();
  // Kurse im Hintergrund aktualisieren, wenn älter als 15 Min.
  const d = store.db();
  if (store.isCloud) return;
  const stale = !d.assets.length ? false : !d.assets.some(a => a.quote && Date.now() - a.quote.ts < 15 * 60_000);
  if (stale || d.income.concat(d.expense).some(t => t.currency !== 'CHF')) {
    assets.refreshAll({ silent: true }).then(errs => { if (store.isUnlocked() && !$('#dlg').open) route(); if (errs.length) toast(`Kurse: ${errs[0]}`); });
  }
}

function wireSync(password) {
  const pill = $('#syncpill');
  pill.hidden = false;
  const label = { idle: '☁ …', syncing: '☁ Synchronisiere…', synced: '☁ Synchronisiert', offline: '☁ Offline – wird nachgeholt', error: '☁ Sync-Fehler', login: '☁ Neu entsperren nötig' };
  const paint = st => { pill.textContent = label[st.state] || ''; pill.title = st.error; pill.classList.toggle('bad', ['error', 'login'].includes(st.state)); };
  store.onStatus(paint);
  pill.onclick = () => { if (store.syncStatus().state === 'login') lock(); else toast(store.syncStatus().error || label[store.syncStatus().state]); };
  store.sync(password).then(() => { fetchRates(); });
}
let wired = false;
function globalSync() {
  if (wired) return; wired = true;
  store.onRemoteChange(() => { if (store.isUnlocked() && !$('#dlg').open && !document.activeElement?.matches?.('input,select,textarea')) route(); });
  const go = () => { if (store.isUnlocked() && !document.hidden) store.sync().then(() => {}); };
  addEventListener('online', go);
  document.addEventListener('visibilitychange', go);
  setInterval(go, 60_000);
}
function fetchRates() {
  const d = store.db(); if (!d) return;
  assets.refreshAll({ silent: true }).then(errs => { if (store.isUnlocked() && !$('#dlg').open) route(); if (errs.length) toast(`Kurse: ${errs[0]}`); });
}
addEventListener('hashchange', () => { if (store.isUnlocked()) route(); });
document.title = getName();
registerSW();
if (store.isCloud) { globalSync(); store.onPasswordRecovery(showRecoveryReset); }
showLock();

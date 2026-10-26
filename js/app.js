import * as store from './store.js';
import * as dashboard from './dashboard.js';
import * as tx from './view-tx.js';
import * as assets from './view-assets.js';
import * as settings from './view-settings.js';
import { registerSW, showWhatsNew } from './update.js';
import { $, esc } from './util.js';
import { toast } from './ui.js';

const app = $('#app');
const getName = () => { try { return localStorage.getItem('app-name') || 'Umfassendes Budget'; } catch { return 'Umfassendes Budget'; } };
export function applyName(n) { try { localStorage.setItem('app-name', n); } catch { /* ignorieren */ } document.title = n; const b = document.querySelector('.brand span'); if (b) b.textContent = n; }
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  income: '<path d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  expense: '<path d="M12 20V8m0 0l-5 5m5-5l5 5M5 4h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  assets: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.4 5.5l1.6 1.2-2 3.4-1.9-.6a7 7 0 01-1.7 1l-.4 2h-4l-.4-2a7 7 0 01-1.7-1l-1.9.6-2-3.4 1.6-1.2a7 7 0 010-2L2 10.3l2-3.4 1.9.6a7 7 0 011.7-1l.4-2h4l.4 2a7 7 0 011.7 1l1.9-.6 2 3.4-1.6 1.2a7 7 0 010 2z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};
const ROUTES = [
  ['dashboard', 'Dashboard'], ['income', 'Einnahmen'], ['expense', 'Ausgaben'], ['assets', 'Vermögen'], ['settings', 'Einstellungen'],
];

// ---------- Sperrbildschirm ----------
async function showLock() {
  const exists = await store.hasVault();
  app.innerHTML = `<main class="lock"><form id="lockf" class="card">
    <img src="icons/icon.svg" alt="" width="64" height="64">
    <h1>${esc(getName())}</h1>
    <p class="muted">${exists ? 'Passwort eingeben, um die Daten zu entschlüsseln.' : 'Passwort festlegen. Die Daten werden damit auf diesem Gerät verschlüsselt. <b>Es gibt keine Wiederherstellung bei vergessenem Passwort.</b>'}</p>
    <label class="field"><span>Passwort</span><input type="password" name="pw" required minlength="${exists ? 1 : 10}" autocomplete="${exists ? 'current-password' : 'new-password'}" autofocus></label>
    ${exists ? '' : '<label class="field"><span>Passwort wiederholen</span><input type="password" name="pw2" required autocomplete="new-password"><small>Mindestens 10 Zeichen, am besten ein Satz.</small></label>'}
    <button class="btn primary wide" type="submit">${exists ? 'Entsperren' : 'Tresor erstellen'}</button>
    <p class="neg" id="lockerr" role="alert"></p></form></main>`;
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
    assets: () => assets.render(view),
    settings: () => settings.render(view, { lock, rerender, applyName }),
  })[key]();
  scrollTo(0, 0);
}

async function start() {
  app.innerHTML = `<div class="shell">
    <nav aria-label="Hauptnavigation"><div class="brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span>${esc(getName())}</span></div>
      ${ROUTES.map(([k, l]) => `<a href="#/${k}" data-r="${k}"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${ICONS[k]}</svg><span>${esc(l)}</span></a>`).join('')}
      <button class="navlock" id="navlock">🔒 Sperren</button></nav>
    <main id="view"></main></div>`;
  $('#navlock').onclick = lock;
  armIdle();
  route();
  showWhatsNew();
  // Kurse im Hintergrund aktualisieren, wenn älter als 15 Min.
  const d = store.db();
  const stale = !d.assets.length ? false : !d.assets.some(a => a.quote && Date.now() - a.quote.ts < 15 * 60_000);
  if (stale || d.income.concat(d.expense).some(t => t.currency !== 'CHF')) {
    assets.refreshAll({ silent: true }).then(errs => { if (store.isUnlocked() && !$('#dlg').open) route(); if (errs.length) toast(`Kurse: ${errs[0]}`); });
  }
}

addEventListener('hashchange', () => { if (store.isUnlocked()) route(); });
document.title = getName();
registerSW();
showLock();

// Auto-Update: Service Worker holt immer die neueste Version; beim Start wird «Neuigkeiten» angezeigt.
import { esc } from './util.js';
import { openDialog, closeDialog } from './ui.js';

const SEEN = 'seen-version';
const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

let reloading = false;
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return; // Erstinstallation: kein Reload
      reloading = true;
      location.reload();
    });
    // Beim Zurückkehren in die App nach Updates suchen
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    reg.update().catch(() => {});
  } catch { /* z. B. file:// oder Privatmodus */ }
}

export async function loadChangelog() {
  const r = await fetch('changelog.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('changelog.json nicht erreichbar');
  return r.json();
}

export async function currentVersion() {
  try { return (await loadChangelog())[0].version; } catch { return '–'; }
}

/** Zeigt beim Start die Neuerungen seit der zuletzt gesehenen Version. */
export async function showWhatsNew({ force = false } = {}) {
  let log;
  try { log = await loadChangelog(); } catch { return; }
  const cur = log[0].version;
  let seen = null;
  try { seen = localStorage.getItem(SEEN); } catch { /* ignorieren */ }
  const entries = force ? log.slice(0, 5) : log.filter(e => seen && cmp(e.version, seen) > 0);
  try { localStorage.setItem(SEEN, cur); } catch { /* ignorieren */ }
  if (!entries.length) return;
  const d = openDialog(`<div class="form"><h2>${force ? 'Versionshistorie' : `Neu in Version ${esc(cur)}`}</h2>
    ${entries.map(e => `<h3>${esc(e.version)} <small>${esc(e.date)}</small></h3><ul>${e.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    <div class="actions"><button class="btn primary" id="wn-ok">Verstanden</button></div></div>`);
  d.querySelector('#wn-ok').onclick = closeDialog;
}

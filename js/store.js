// Lokaler, verschlüsselter Datenspeicher (IndexedDB). Klartext existiert nur im Arbeitsspeicher.
import * as C from './crypto.js';

const ITERATIONS = 600_000;
const DB_NAME = 'umfassendes-budget';
let key = null;
let vault = null;
let data = null;

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const idb = async (mode, fn) => {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => { d.close(); res(req.result); };
    t.onerror = () => { d.close(); rej(t.error); };
  });
};
const get = k => idb('readonly', s => s.get(k));
const put = (k, v) => idb('readwrite', s => s.put(v, k));

export const defaultData = () => ({
  version: 1,
  settings: {
    baseCurrency: 'CHF',
    twelveDataKey: '',
    autoLockMin: 5,
    lastBackup: null,
    widgets: null, // null = Standard-Dashboard (siehe dashboard.js)
  },
  income: [],
  expense: [],
  assets: [],
  snapshots: [],
});

function migrate(d) {
  const base = defaultData();
  const out = { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  return out;
}

export const hasVault = async () => !!(await get('vault'));
export const isUnlocked = () => !!data;
export const db = () => data;

export async function create(password) {
  const salt = C.randomBytes(16);
  key = await C.deriveKey(password, salt, ITERATIONS);
  vault = { v: 1, salt: C.toB64(salt), iter: ITERATIONS };
  data = defaultData();
  await save();
  navigator.storage?.persist?.().catch(() => {});
}

export async function unlock(password) {
  const v = await get('vault');
  if (!v) throw new Error('Kein Tresor vorhanden');
  const k = await C.deriveKey(password, C.fromB64(v.salt), v.iter);
  let d;
  try { d = await C.decrypt(k, v); } catch { throw new Error('Falsches Passwort'); }
  vault = { v: v.v, salt: v.salt, iter: v.iter };
  key = k;
  data = migrate(d);
  navigator.storage?.persist?.().catch(() => {});
}

export async function save() {
  if (!key) throw new Error('Gesperrt');
  const rec = await C.encrypt(key, data);
  await put('vault', { ...vault, ...rec });
}

export function lock() { key = null; data = null; }

export async function wipe() {
  lock();
  await idb('readwrite', s => s.delete('vault'));
}

// Verschlüsseltes Backup = der Tresor selbst (nur mit dem Passwort lesbar).
export async function backupFile() {
  await save();
  return JSON.stringify(await get('vault'));
}

export async function restoreBackup(text, password) {
  const v = JSON.parse(text);
  if (!v?.salt || !v?.ct || !v?.iv) throw new Error('Ungültige Backup-Datei');
  const k = await C.deriveKey(password, C.fromB64(v.salt), v.iter);
  let d;
  try { d = await C.decrypt(k, v); } catch { throw new Error('Falsches Passwort für dieses Backup'); }
  vault = { v: v.v, salt: v.salt, iter: v.iter };
  key = k;
  data = migrate(d);
  await save();
}

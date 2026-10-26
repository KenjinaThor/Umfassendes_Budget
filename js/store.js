// Datenspeicher.
//  - Lokal-Modus (config.js leer): ein Gerät, Passwort-Tresor in IndexedDB.
//  - Cloud-Modus (Supabase): Konto-Login, Ende-zu-Ende-verschlüsselte Synchronisation, Haushalte.
//    Der Server sieht nur Chiffretext. Das Gerät behält eine verschlüsselte Offline-Kopie.
import * as C from './crypto.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isCloud = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const ITERATIONS = 600_000;
const DB_NAME = 'umfassendes-budget';
const LISTS = ['income', 'expense', 'assets'];
const TRANSIENT = new Set(['quote', 'prevClose']); // Kurse lösen keine Änderungsversion aus
const TOMBSTONE_TTL = 180 * 864e5;

let data = null;
let localKey = null, localVault = null; // Lokal-Modus
const st = { mk: null, email: '', userId: '', profile: null, displayName: '', personal: { version: 0, hash: null, iv: '', ct: '' }, hh: null };
let sb = null;
const getSb = () => (sb ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));

// ---------- IndexedDB ----------
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
export const kvGet = k => idb('readonly', s => s.get(k));
export const kvPut = (k, v) => idb('readwrite', s => s.put(v, k));
export const kvDel = k => idb('readwrite', s => s.delete(k));

// ---------- Datenmodell ----------
export const defaultData = () => ({
  version: 1,
  settings: { appName: 'Umfassendes Budget', baseCurrency: 'CHF', twelveDataKey: '', autoLockMin: 5, lastBackup: null, widgets: null, budget: {} },
  income: [], expense: [], assets: [], snapshots: [],
  meta: {}, settingsU: 0, settingsH: '',
});
const normalize = d => {
  const base = defaultData();
  return { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) }, meta: d.meta || {} };
};

export const db = () => data;
export const isUnlocked = () => !!data;
export const hasHousehold = () => !!st.hh;
export const householdInfo = () => (st.hh ? { id: st.hh.id, members: st.hh.members } : null);
export const account = () => ({ email: st.email, displayName: st.displayName });

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const recHash = r => stable(Object.fromEntries(Object.entries(r).filter(([k]) => !TRANSIENT.has(k))));

/** Änderungsverfolgung: pro Datensatz Zeitstempel und Löschmarken (für verlustfreies Zusammenführen). */
function touchMeta() {
  const now = Date.now(), live = new Set(), meta = data.meta;
  for (const L of LISTS) for (const r of data[L]) {
    live.add(r.id);
    const h = recHash(r), m = meta[r.id], code = r.shared ? 'h' : 'p';
    const bl = addCode(m?.bl, code);
    if (!m || m.del || m.h !== h) meta[r.id] = { u: now, h, bl };
    else m.bl = bl;
  }
  for (const id of Object.keys(meta)) {
    if (!live.has(id) && !meta[id].del) meta[id] = { u: now, del: true, bl: meta[id].bl };
    else if (meta[id].del && now - meta[id].u > TOMBSTONE_TTL) delete meta[id];
  }
  const sh = stable(data.settings);
  if (data.settingsH !== sh) { data.settingsH = sh; data.settingsU = now; }
}

const addCode = (bl = '', c) => (bl.includes(c) ? bl : bl + c);
const inBlob = (kind, r) => (kind === 'household' ? !!r.shared : !r.shared);

function buildBlob(kind) {
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const lists = {}, meta = {};
  for (const L of LISTS) lists[L] = data[L].filter(r => inBlob(kind, r)).sort(byId);
  const live = new Set(LISTS.flatMap(L => lists[L].map(r => r.id)));
  const code = kind === 'household' ? 'h' : 'p';
  for (const [id, m] of Object.entries(data.meta)) {
    if (live.has(id)) meta[id] = { u: m.u };
    else if ((m.bl || '').includes(code)) meta[id] = { u: m.u, del: true }; // Löschmarke nur dort, wo der Datensatz je lag
  }
  const blob = { v: 1, lists, meta };
  if (kind === 'personal') Object.assign(blob, { settings: data.settings, settingsU: data.settingsU, snapshots: data.snapshots });
  return blob;
}

/** Fremden Datenstand in den lokalen einarbeiten (neuerer Zeitstempel gewinnt; Gleichstand: lebender Datensatz). */
function mergeBlob(remote, kind = 'personal') {
  let changed = false;
  const code = kind === 'household' ? 'h' : 'p';
  for (const [id, rm] of Object.entries(remote.meta || {})) {
    const lm = data.meta[id];
    const adopt = !lm || rm.u > lm.u || (rm.u === lm.u && lm.del && !rm.del);
    if (!adopt) continue;
    changed = true;
    for (const L of LISTS) data[L] = data[L].filter(r => r.id !== id);
    const bl = addCode(lm?.bl, code);
    if (rm.del) { data.meta[id] = { u: rm.u, del: true, bl }; continue; }
    for (const L of LISTS) {
      const rec = (remote.lists?.[L] || []).find(r => r.id === id);
      if (rec) { data[L].push(rec); data.meta[id] = { u: rm.u, h: recHash(rec), bl }; break; }
    }
  }
  if (remote.settings && (remote.settingsU || 0) > data.settingsU) {
    data.settings = { ...defaultData().settings, ...remote.settings };
    data.settingsU = remote.settingsU; data.settingsH = stable(data.settings); changed = true;
  }
  if (remote.snapshots) {
    const m = new Map(remote.snapshots.map(s => [s.date, s]));
    for (const s of data.snapshots) m.set(s.date, s);
    const merged = [...m.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-3650);
    if (merged.length !== data.snapshots.length) changed = true;
    data.snapshots = merged;
  }
  return changed;
}

// =====================================================================
//  Lokal-Modus
// =====================================================================
export async function hasVault() { return !!(await kvGet(isCloud ? 'cloud' : 'vault')); }

export async function create(password) {
  const salt = C.randomBytes(16);
  localKey = await C.deriveKey(password, salt, ITERATIONS);
  localVault = { v: 1, salt: C.toB64(salt), iter: ITERATIONS };
  data = defaultData();
  await save();
  navigator.storage?.persist?.().catch(() => {});
}

export async function unlock(password) {
  const v = await kvGet('vault');
  if (!v) throw new Error('Kein Tresor vorhanden');
  const k = await C.deriveKey(password, C.fromB64(v.salt), v.iter);
  let d;
  try { d = await C.decrypt(k, v); } catch { throw new Error('Falsches Passwort'); }
  localVault = { v: v.v, salt: v.salt, iter: v.iter };
  localKey = k;
  data = normalize(d);
  navigator.storage?.persist?.().catch(() => {});
}

// =====================================================================
//  Speichern (beide Modi)
// =====================================================================
export async function save() {
  if (!data) throw new Error('Gesperrt');
  if (!isCloud) {
    const rec = await C.encrypt(localKey, data);
    await kvPut('vault', { ...localVault, ...rec });
    return;
  }
  touchMeta();
  await writeCache();
  scheduleSync();
}

export function lock() { localKey = null; data = null; st.mk = null; st.hh = null; clearTimeout(syncTimer); }

export async function wipe() {
  const wasCloud = isCloud;
  lock();
  await kvDel(isCloud ? 'cloud' : 'vault');
  await kvDel('passkey');
  if (wasCloud) { try { await getSb().auth.signOut({ scope: 'local' }); } catch { /* offline */ } }
}

// =====================================================================
//  Cloud: Cache, Anmeldung, Synchronisation
// =====================================================================
async function writeCache() {
  const personal = await C.encrypt(st.mk, buildBlob('personal'));
  st.personal.iv = personal.iv; st.personal.ct = personal.ct;
  let hh = null;
  if (st.hh) {
    const e = await C.encrypt(st.hh.key, buildBlob('household'));
    st.hh.iv = e.iv; st.hh.ct = e.ct;
    hh = { id: st.hh.id, version: st.hh.version, hash: st.hh.hash, iv: e.iv, ct: e.ct, wrapped_hk: await C.wrapKey(st.mk, st.hh.key), members: st.hh.members };
  }
  await kvPut('cloud', {
    email: st.email, userId: st.userId, displayName: st.displayName, profile: st.profile,
    personal: { version: st.personal.version, hash: st.personal.hash, iv: personal.iv, ct: personal.ct }, hh,
  });
}

async function openCache(c, mk) {
  Object.assign(st, { mk, email: c.email, userId: c.userId, profile: c.profile, displayName: c.displayName || '', hh: null });
  st.personal = { ...c.personal };
  data = defaultData();
  mergeBlob(await C.decrypt(mk, c.personal));
  if (c.hh) {
    const key = await C.unwrapKey(mk, c.hh.wrapped_hk);
    st.hh = { id: c.hh.id, key, version: c.hh.version, hash: c.hh.hash, members: c.hh.members || [] };
    mergeBlob(await C.decrypt(key, c.hh), 'household');
  }
}

/** Entsperren mit Passwort (Offline-fähig, nutzt die lokale Kopie). */
export async function unlockCached(password) {
  const c = await kvGet('cloud');
  if (!c) throw new Error('Keine lokale Kopie vorhanden');
  const kek = await C.deriveKey(password, C.fromB64(c.profile.kdf_salt), ITERATIONS);
  let mk;
  try { mk = await C.unwrapKey(kek, c.profile.wrapped_mk); } catch { throw new Error('Falsches Passwort'); }
  await openCache(c, mk);
  navigator.storage?.persist?.().catch(() => {});
  return { email: c.email };
}
export const cachedEmail = async () => (await kvGet('cloud'))?.email || null;

/** Entsperren mit einem bereits vorhandenen Hauptschlüssel (Biometrie). */
export async function unlockWithKey(mk) {
  const c = await kvGet('cloud');
  if (!c) throw new Error('Keine lokale Kopie vorhanden');
  try { await openCache(c, mk); } catch { throw new Error('Schlüssel passt nicht zur lokalen Kopie'); }
}
export const masterKey = () => st.mk;

async function rpc(name, args = {}) {
  const { data: d, error } = await getSb().rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return d;
}

export async function register(email, password, displayName) {
  const secret = await C.deriveLoginSecret(password, email);
  const { data: d, error } = await getSb().auth.signUp({
    email: email.trim(), password: secret,
    options: { data: { display_name: displayName.trim() }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(error.message);
  return { needsConfirm: !d.session };
}

export async function login(email, password) {
  email = email.trim().toLowerCase();
  const secret = await C.deriveLoginSecret(password, email);
  const { data: d, error } = await getSb().auth.signInWithPassword({ email, password: secret });
  if (error) {
    if (/confirm/i.test(error.message)) throw new Error('E-Mail-Adresse noch nicht bestätigt – bitte den Link in der Bestätigungsmail öffnen.');
    throw new Error('E-Mail oder Passwort falsch.');
  }
  const remote = await rpc('get_my_data');
  let recoveryCode = null;

  if (!remote.profile) {
    // Erstanmeldung: Hauptschlüssel erzeugen, mit Passwort und Wiederherstellungscode sichern
    const mk = await C.generateKey();
    const salt = C.toB64(C.randomBytes(16)), rsalt = C.toB64(C.randomBytes(16));
    recoveryCode = C.randomCode();
    const kek = await C.deriveKey(password, C.fromB64(salt), ITERATIONS);
    const rkek = await C.deriveKey(C.normalizeCode(recoveryCode), C.fromB64(rsalt), ITERATIONS);
    const name = d.user.user_metadata?.display_name || email.split('@')[0];
    const profile = { kdf_salt: salt, wrapped_mk: await C.wrapKey(kek, mk) };
    await rpc('create_profile', { p_display_name: name, p_kdf_salt: salt, p_wrapped_mk: profile.wrapped_mk, p_recovery_salt: rsalt, p_recovery_wrapped_mk: await C.wrapKey(rkek, mk) });
    Object.assign(st, { mk, email, userId: d.user.id, profile, displayName: name, hh: null });
    st.personal = { version: 0, hash: null, iv: '', ct: '' };
    data = defaultData();
    await save();
  } else {
    const kek = await C.deriveKey(password, C.fromB64(remote.profile.kdf_salt), ITERATIONS);
    let mk;
    try { mk = await C.unwrapKey(kek, remote.profile.wrapped_mk); } catch { throw new Error('Schlüssel konnte nicht entschlüsselt werden.'); }
    const cached = await kvGet('cloud');
    const profile = { kdf_salt: remote.profile.kdf_salt, wrapped_mk: remote.profile.wrapped_mk };
    if (cached && cached.userId === d.user.id) await openCache({ ...cached, profile }, mk); // Offline-Änderungen behalten
    else {
      Object.assign(st, { mk, email, userId: d.user.id, profile, displayName: remote.profile.display_name, hh: null });
      st.personal = { version: 0, hash: null, iv: '', ct: '' };
      data = defaultData();
    }
    st.displayName = remote.profile.display_name;
    await applyRemote(remote);
    touchMeta();
    await writeCache();
  }
  navigator.storage?.persist?.().catch(() => {});
  scheduleSync(100);
  return { recoveryCode };
}

// ---------- Synchronisation ----------
const status = { state: 'idle', last: null, error: '' };
const statusListeners = new Set();
const setStatus = (state, error = '') => { status.state = state; status.error = error; if (state === 'synced') status.last = Date.now(); statusListeners.forEach(f => f(status)); };
export const onStatus = f => { statusListeners.add(f); return () => statusListeners.delete(f); };
export const syncStatus = () => status;
const changeListeners = new Set();
export const onRemoteChange = f => { changeListeners.add(f); };

let syncTimer = null, syncing = false, resync = false;
export function scheduleSync(ms = 1500) {
  if (!isCloud || !data) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(() => {}), ms);
}

async function ensureSession(password) {
  try {
    const { data: { session } } = await getSb().auth.getSession();
    if (session && session.user.id === st.userId) return true;
  } catch { /* offline */ }
  if (!password) return false;
  const { error } = await getSb().auth.signInWithPassword({ email: st.email, password: await C.deriveLoginSecret(password, st.email) });
  return !error;
}

async function applyRemote(remote) {
  let changed = false;
  if (remote.vault) {
    const plain = await C.decrypt(st.mk, remote.vault);
    changed = mergeBlob(plain) || changed;
    st.personal.version = remote.vault.version;
    st.personal.hash = await C.sha256b64(stable(plain));
  } else { st.personal.version = 0; st.personal.hash = null; }

  const h = remote.households?.[0];
  if (h && h.wrapped_hk) {
    if (!st.hh || st.hh.id !== h.id) st.hh = { id: h.id, key: await C.unwrapKey(st.mk, h.wrapped_hk), members: [], version: 0, hash: null };
    const plain = await C.decrypt(st.hh.key, h);
    changed = mergeBlob(plain, 'household') || changed;
    Object.assign(st.hh, { version: h.version, hash: await C.sha256b64(stable(plain)), members: h.members || [] });
  } else if (!h && st.hh) {
    st.hh = null; // Haushalt existiert nicht mehr / wir sind nicht mehr Mitglied
    for (const L of LISTS) for (const r of data[L]) delete r.shared;
    changed = true;
  }
  return changed;
}

/** Zusammenführen und hochladen. Mit Passwort, falls die Anmeldung erneuert werden muss. */
export async function sync(password) {
  if (!isCloud || !data || !st.mk) return false;
  if (syncing) { resync = true; return false; }
  syncing = true; setStatus('syncing');
  let anyChange = false;
  try {
    if (!(await ensureSession(password))) { setStatus('login', 'Anmeldung abgelaufen – zum Synchronisieren Passwort-Login nötig.'); return false; }
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await rpc('get_my_data');
      if (!remote.profile) throw new Error('Konto-Profil fehlt');
      if (await applyRemote(remote)) anyChange = true;
      touchMeta();
      if (await pushBlobs()) { setStatus('synced'); break; }
      if (attempt === 3) throw new Error('Synchronisationskonflikt – bitte erneut versuchen');
    }
    await writeCache();
    if (anyChange) changeListeners.forEach(f => f());
    return anyChange;
  } catch (e) {
    const offline = !navigator.onLine || /fetch|network|Failed/i.test(e.message);
    setStatus(offline ? 'offline' : 'error', e.message);
    return false;
  } finally {
    syncing = false;
    if (resync) { resync = false; scheduleSync(300); }
  }
}

/** true = alles hochgeladen, false = Versionskonflikt (neu laden und erneut versuchen). */
async function pushBlobs() {
  const jobs = [['personal', st.personal, st.mk]];
  if (st.hh) jobs.push(['household', st.hh, st.hh.key]);
  for (const [kind, slot, key] of jobs) {
    const blob = buildBlob(kind);
    const hash = await C.sha256b64(stable(blob));
    if (hash === slot.hash) continue;
    const e = await C.encrypt(key, blob);
    const v = kind === 'personal'
      ? await rpc('put_vault', { p_expected: slot.version, p_iv: e.iv, p_ct: e.ct })
      : await rpc('put_household', { p_id: st.hh.id, p_expected: slot.version, p_iv: e.iv, p_ct: e.ct });
    if (v === -1) return false;
    slot.version = v; slot.hash = hash;
  }
  return true;
}

// ---------- Konto ----------
export async function setDisplayName(name) {
  await rpc('set_display_name', { p_name: name });
  st.displayName = name.trim();
  await writeCache();
}

export async function changePassword(oldPw, newPw) {
  const kek = await C.deriveKey(oldPw, C.fromB64(st.profile.kdf_salt), ITERATIONS);
  try { await C.unwrapKey(kek, st.profile.wrapped_mk); } catch { throw new Error('Aktuelles Passwort ist falsch.'); }
  const remote = await rpc('get_my_data');
  const salt = C.toB64(C.randomBytes(16));
  const nkek = await C.deriveKey(newPw, C.fromB64(salt), ITERATIONS);
  const wrapped = await C.wrapKey(nkek, st.mk);
  const { error } = await getSb().auth.updateUser({ password: await C.deriveLoginSecret(newPw, st.email) });
  if (error) throw new Error(error.message);
  await rpc('update_profile_keys', { p_kdf_salt: salt, p_wrapped_mk: wrapped, p_recovery_salt: remote.profile.recovery_salt, p_recovery_wrapped_mk: remote.profile.recovery_wrapped_mk });
  st.profile = { kdf_salt: salt, wrapped_mk: wrapped };
  await writeCache();
}

export async function sendPasswordReset(email) {
  const { error } = await getSb().auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(error.message);
}
export function onPasswordRecovery(cb) {
  getSb().auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') cb(); });
}
/** Passwort-Reset: mit Wiederherstellungscode den Hauptschlüssel entpacken und unter neuem Passwort sichern. */
export async function completeRecovery(recoveryCode, newPw) {
  const { data: { session } } = await getSb().auth.getSession();
  if (!session) throw new Error('Kein gültiger Reset-Link. Bitte den Link aus der E-Mail erneut öffnen.');
  const remote = await rpc('get_my_data');
  if (!remote.profile) throw new Error('Kein Profil vorhanden.');
  const rkek = await C.deriveKey(C.normalizeCode(recoveryCode), C.fromB64(remote.profile.recovery_salt), ITERATIONS);
  let mk;
  try { mk = await C.unwrapKey(rkek, remote.profile.recovery_wrapped_mk); } catch { throw new Error('Wiederherstellungscode ist falsch.'); }
  const salt = C.toB64(C.randomBytes(16));
  const wrapped = await C.wrapKey(await C.deriveKey(newPw, C.fromB64(salt), ITERATIONS), mk);
  const { error } = await getSb().auth.updateUser({ password: await C.deriveLoginSecret(newPw, session.user.email) });
  if (error) throw new Error(error.message);
  await rpc('update_profile_keys', { p_kdf_salt: salt, p_wrapped_mk: wrapped, p_recovery_salt: remote.profile.recovery_salt, p_recovery_wrapped_mk: remote.profile.recovery_wrapped_mk });
  await kvDel('cloud'); await kvDel('passkey');
  await getSb().auth.signOut({ scope: 'local' });
}

export async function deleteAccount() {
  await rpc('delete_account');
  await wipe();
}

// ---------- Haushalt ----------
const INVITE_SALT = C.fromB64(btoa('umfassendes-budget:invite'));
const inviteKey = code => C.deriveKey(C.normalizeCode(code), INVITE_SALT, 200_000);
const inviteHash = code => C.sha256b64(`lookup:${C.normalizeCode(code)}`);

export async function createHousehold() {
  if (st.hh) throw new Error('Du gehörst bereits zu einem Haushalt.');
  if (!(await ensureSession())) throw new Error('Nicht angemeldet / offline.');
  const key = await C.generateKey();
  touchMeta();
  const blob = buildBlob('household');
  const e = await C.encrypt(key, blob);
  const id = await rpc('create_household', { p_iv: e.iv, p_ct: e.ct, p_wrapped_hk: await C.wrapKey(st.mk, key) });
  st.hh = { id, key, version: 1, hash: await C.sha256b64(stable(blob)), members: [st.displayName] };
  await writeCache();
}

export async function createInvite() {
  if (!st.hh) throw new Error('Kein Haushalt vorhanden.');
  const code = C.randomCode();
  await rpc('create_invite', { p_household: st.hh.id, p_code_hash: await inviteHash(code), p_wrapped_hk: await C.wrapKey(await inviteKey(code), st.hh.key) });
  return code;
}

export async function joinHousehold(code) {
  if (st.hh) throw new Error('Du gehörst bereits zu einem Haushalt. Zuerst verlassen.');
  if (!(await ensureSession())) throw new Error('Nicht angemeldet / offline.');
  let res;
  try { res = await rpc('join_household', { p_code_hash: await inviteHash(code) }); }
  catch { throw new Error('Einladungscode ungültig, abgelaufen oder bereits verwendet.'); }
  const key = await C.unwrapKey(await inviteKey(code), res.wrapped_hk);
  await rpc('set_member_key', { p_household: res.household_id, p_wrapped_hk: await C.wrapKey(st.mk, key) });
  await sync();
}

export async function leaveHousehold() {
  if (!st.hh) return;
  await rpc('leave_household', { p_household: st.hh.id });
  for (const L of LISTS) for (const r of data[L]) delete r.shared; // Kopie bleibt als privater Bestand
  st.hh = null;
  await save();
}

// ---------- Backup (beide Modi) ----------
export async function backupFile() {
  if (isCloud) {
    const payload = { income: data.income, expense: data.expense, assets: data.assets, settings: data.settings, snapshots: data.snapshots };
    return JSON.stringify({ v: 2, cloud: true, ...(await C.encrypt(st.mk, payload)) });
  }
  await save();
  return JSON.stringify(await kvGet('vault'));
}

export async function restoreBackup(text, password) {
  const v = JSON.parse(text);
  if (isCloud) {
    if (!v?.cloud || !v.ct) throw new Error('Ungültige Backup-Datei');
    let p;
    try { p = await C.decrypt(st.mk, v); } catch { throw new Error('Backup gehört zu einem anderen Konto.'); }
    Object.assign(data, normalize({ ...data, ...p, meta: data.meta }));
    if (!st.hh) for (const L of LISTS) for (const r of data[L]) delete r.shared;
    await save();
    return;
  }
  if (!v?.salt || !v?.ct || !v?.iv) throw new Error('Ungültige Backup-Datei');
  const k = await C.deriveKey(password, C.fromB64(v.salt), v.iter);
  let d;
  try { d = await C.decrypt(k, v); } catch { throw new Error('Falsches Passwort für dieses Backup'); }
  localVault = { v: v.v, salt: v.salt, iter: v.iter };
  localKey = k;
  data = normalize(d);
  await save();
}

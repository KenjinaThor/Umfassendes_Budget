// Dokumente zu Buchungen (Belege, Rechnungen). Ende-zu-Ende-verschlüsselt: pro Dokument ein eigener AES-256-Schlüssel,
// der nur im (ebenfalls verschlüsselten) Buchungseintrag steht. Cloud: Supabase Storage, Lokal: IndexedDB.
import * as C from './crypto.js';
import * as store from './store.js';
import { uid } from './util.js';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS = 5;
export const ACCEPT = 'application/pdf,image/*,text/plain,.csv,.doc,.docx,.xls,.xlsx';
const ALLOWED = /^(application\/pdf|image\/|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel))/;
const key = id => `doc:${id}`;

/** Grosse Fotos verkleinern (max. 2000 px, JPEG), um Speicher zu sparen. Andere Dateien unverändert. */
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 400 * 1024) return { blob: file, mime: file.type, name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) return { blob, mime: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch { /* Format nicht dekodierbar: Original behalten */ }
  return { blob: file, mime: file.type, name: file.name };
}

export function validate(file) {
  if (!ALLOWED.test(file.type || '')) return `«${file.name}»: Dateityp nicht erlaubt (PDF, Bilder, Text, Word/Excel).`;
  if (file.size > MAX_BYTES * 3) return `«${file.name}»: Datei ist zu gross (max. ${MAX_BYTES / 1048576} MB).`;
  return null;
}

/** Verschlüsselt und speichert ein Dokument. Gibt die Metadaten für den Buchungseintrag zurück. */
export async function put(file) {
  const bad = validate(file);
  if (bad) throw new Error(bad);
  const { blob, mime, name } = await prepare(file);
  if (blob.size > MAX_BYTES) throw new Error(`«${name}»: Datei ist zu gross (max. ${MAX_BYTES / 1048576} MB).`);
  const dk = await C.generateKey();
  const iv = C.randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dk, await blob.arrayBuffer()));
  const packed = new Uint8Array(12 + ct.length);
  packed.set(iv); packed.set(ct, 12);
  const meta = { id: uid(), name, mime, size: blob.size, k: C.toB64(await C.exportKey(dk)) };
  if (store.isCloud) {
    if (!(await store.ensureOnline())) throw new Error('Für den Dokument-Upload ist eine Internetverbindung und Anmeldung nötig.');
    meta.o = store.account().userId;
    const { error } = await store.storageApi().upload(`${meta.o}/${meta.id}`, new Blob([packed], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false });
    if (error) throw new Error(`Upload fehlgeschlagen: ${error.message}`);
  }
  await store.kvPut(key(meta.id), packed.buffer); // lokale (verschlüsselte) Kopie, auch für Offline-Ansicht
  return meta;
}

/** Entschlüsseltes Dokument als Blob. */
export async function get(meta) {
  let packed = await store.kvGet(key(meta.id));
  if (!packed) {
    if (!store.isCloud) throw new Error('Dokument ist auf diesem Gerät nicht vorhanden.');
    if (!(await store.ensureOnline())) throw new Error('Zum Laden des Dokuments ist eine Internetverbindung nötig.');
    const { data, error } = await store.storageApi().download(`${meta.o}/${meta.id}`);
    if (error) throw new Error('Dokument konnte nicht geladen werden.');
    packed = await data.arrayBuffer();
    await store.kvPut(key(meta.id), packed);
  }
  const u8 = new Uint8Array(packed);
  const dk = await C.importKey(C.fromB64(meta.k));
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, dk, u8.slice(12));
    return new Blob([pt], { type: meta.mime });
  } catch { throw new Error('Dokument konnte nicht entschlüsselt werden.'); }
}

/** Löscht ein Dokument (Cloud: nur im eigenen Ordner möglich; Fehler werden ignoriert). */
export async function remove(meta) {
  await store.kvDel(key(meta.id)).catch(() => {});
  if (store.isCloud && meta.o === store.account().userId) {
    try { await store.storageApi().remove([`${meta.o}/${meta.id}`]); } catch { /* offline: bleibt als Waise */ }
  }
}

export const sizeLabel = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Verschlüsselung: PBKDF2-SHA256 (Passwort -> Schlüssel) + AES-256-GCM (authentifiziert).
const enc = new TextEncoder();
const dec = new TextDecoder();

export const toB64 = u8 => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
export const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(key, obj) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decrypt(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
  return JSON.parse(dec.decode(pt));
}

// ---------- Schlüsselhierarchie für den Cloud-Modus ----------
// Passwort -> (a) Login-Geheimnis für Supabase (Server sieht nie das echte Passwort)
//          -> (b) Schlüssel zum Entpacken des Hauptschlüssels (MK). MK verschlüsselt alle Daten.
export async function deriveLoginSecret(password, email, iterations = 600_000) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(`umfassendes-budget:login:${email.trim().toLowerCase()}`), iterations, hash: 'SHA-256' },
    material, 256);
  return toB64(new Uint8Array(bits));
}

export const generateKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
export const importKey = raw => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
export const exportKey = async k => new Uint8Array(await crypto.subtle.exportKey('raw', k));
export const wrapKey = async (kek, key) => encrypt(kek, toB64(await exportKey(key)));
export const unwrapKey = async (kek, wrapped) => importKey(fromB64(await decrypt(kek, wrapped)));

export const sha256b64 = async str => toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str))));

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I
export function randomCode(bytes = 20) {
  const r = randomBytes(bytes);
  let s = '';
  for (const b of r) s += ALPHA[b % 32];
  return s.match(/.{1,4}/g).join('-');
}
export const normalizeCode = c => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

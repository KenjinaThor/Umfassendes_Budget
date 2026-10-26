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

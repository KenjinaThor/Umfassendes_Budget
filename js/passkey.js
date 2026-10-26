// Biometrische Entsperrung (Face ID, Fingerabdruck, Windows Hello) über WebAuthn-Passkeys mit PRF-Erweiterung.
// Der Passkey liefert ein gerätegebundenes Geheimnis, mit dem der Hauptschlüssel lokal verpackt wird.
// Kostenlos, aber benötigt PRF-Unterstützung (aktuelles Chrome/Edge/Android, Safari/iOS 18+).
import * as C from './crypto.js';
import { kvGet, kvPut, kvDel } from './store.js';

const PRF_SALT = new TextEncoder().encode('umfassendes-budget:passkey-prf:v1');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));

export const supported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
export const isEnrolled = async () => !!(await kvGet('passkey'));

async function wrapKeyFromPrf(prfBytes) {
  const m = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode('umfassendes-budget:passkey-wrap') },
    m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function evalPrf(credId) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rnd(32), allowCredentials: credId ? [{ type: 'public-key', id: credId }] : [], userVerification: 'required',
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } });
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error('Dieses Gerät unterstützt keine Biometrie-Schlüssel (PRF).');
  return { prf: new Uint8Array(out), id: new Uint8Array(a.rawId) };
}

export async function enroll(mk, label) {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Umfassendes Budget' },
    user: { id: rnd(16), name: label, displayName: label },
    challenge: rnd(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    extensions: { prf: {} },
  } });
  if (!cred.getClientExtensionResults().prf?.enabled) throw new Error('Dieses Gerät unterstützt keine Biometrie-Schlüssel (PRF).');
  const { prf } = await evalPrf(new Uint8Array(cred.rawId));
  const wrapped = await C.wrapKey(await wrapKeyFromPrf(prf), mk);
  await kvPut('passkey', { id: C.toB64(new Uint8Array(cred.rawId)), wrapped });
}

export async function unlockKey() {
  const rec = await kvGet('passkey');
  if (!rec) throw new Error('Biometrie nicht eingerichtet.');
  const { prf } = await evalPrf(C.fromB64(rec.id));
  try { return await C.unwrapKey(await wrapKeyFromPrf(prf), rec.wrapped); }
  catch { throw new Error('Biometrie-Entsperrung fehlgeschlagen.'); }
}

export const remove = () => kvDel('passkey');

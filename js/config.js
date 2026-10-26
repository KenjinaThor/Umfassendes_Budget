// Supabase-Verbindung. Beide Werte sind öffentlich (Anon-Key ist für Browser gedacht; der Schutz kommt aus
// Login + Ende-zu-Ende-Verschlüsselung + Funktionen in supabase/schema.sql). NIEMALS den service_role-Key eintragen.
// Leer lassen = reiner Lokal-Modus (nur ein Gerät, kein Login).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

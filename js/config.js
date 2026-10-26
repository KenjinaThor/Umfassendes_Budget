// Supabase-Verbindung. Beide Werte sind öffentlich (der Publishable-Key ist für Browser gedacht; der Schutz kommt aus
// Login + Ende-zu-Ende-Verschlüsselung + Funktionen in supabase/schema.sql). NIEMALS den secret/service_role-Key eintragen.
// Leer lassen = reiner Lokal-Modus (nur ein Gerät, kein Login).
export const SUPABASE_URL = 'https://efbdvcatmsmimbbmsgcx.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Hbs_ur1Y68ka4EEkFRAWfQ_D57UBpWd';

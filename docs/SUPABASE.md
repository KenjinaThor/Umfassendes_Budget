# Supabase einrichten (einmalig, kostenlos)

1. Auf <https://supabase.com> ein Konto und ein **neues Projekt** erstellen (Region: Zürich oder Frankfurt). Der Gratis-Tarif genügt. Gratis-Projekte werden nach 7 Tagen ohne Aktivität pausiert (im Dashboard mit einem Klick wieder aktivierbar).
2. **SQL Editor** → neue Abfrage → Inhalt von `supabase/schema.sql` einfügen → *Run*. Das legt alle Tabellen (komplett gesperrt) und die Zugriffsfunktionen an.
2b. **Dokumente (optional):** Im SQL Editor zusätzlich den Inhalt von `supabase/storage.sql` ausführen. Das legt den privaten Speicher «docs» an (max. 15 MB je Datei; Gratis-Tarif: 1 GB gesamt). Ohne diesen Schritt funktioniert der Dokument-Upload in der Cloud nicht.
3. **Authentication → Providers → Email**: aktiviert lassen, «Confirm email» eingeschaltet lassen.
4. **Authentication → URL Configuration**: *Site URL* = `https://<user>.github.io/<repo>/` und dieselbe URL unter *Redirect URLs* (für Bestätigungs- und Reset-Mails).
5. **Project Settings → API**: *Project URL* und *anon public key* kopieren und in `js/config.js` eintragen. **Nie** den `service_role`-Key verwenden oder committen.
6. Committen/mergen. Die App zeigt nun Registrieren/Anmelden.

## Hinweise
- Der eingebaute Mailversand von Supabase ist im Gratis-Tarif stark limitiert (wenige Mails pro Stunde). Für einen Kollegenkreis reicht das meist; sonst unter *Authentication → SMTP* einen eigenen Anbieter hinterlegen.
- Wer Passwort **und** Wiederherstellungscode verliert, verliert die Daten – technisch bedingt (Ende-zu-Ende-Verschlüsselung).
- Andere Mitglieder aus einem Haushalt entfernen ist (noch) nicht möglich; Mitglieder verlassen ihn selbst. Wer ausgetreten ist, kennt den alten Haushaltsschlüssel weiterhin (hat aber keinen Serverzugriff mehr).

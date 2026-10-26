# Umfassendes Budget

Persönliche Budget- und Vermögens-App (Einnahmen · Ausgaben · Vermögen) für den Kollegenkreis.
Läuft als **PWA** auf Android, iOS und Windows – ohne App-Store, direkt aus GitHub Pages, ohne Server und ohne Build-Schritt.

## Datenschutz
- Alle Daten bleiben **lokal auf dem Gerät** (IndexedDB) und sind mit **AES-256-GCM** verschlüsselt; der Schlüssel wird per PBKDF2 (600 000 Iterationen) aus dem Passwort abgeleitet. Klartext existiert nur im Arbeitsspeicher.
- Automatische Sperre nach Inaktivität. **Kein Passwort-Reset möglich** – bei Verlust sind die Daten weg.
- Es gibt kein Backend, kein Tracking. Die App kontaktiert nur: `api.frankfurter.dev` (Wechselkurse), `api.gold-api.com` (Metalle), `api.twelvedata.com` (Aktien, nur mit eigenem Schlüssel). Dabei werden Symbole/Währungen, aber **keine Beträge** übertragen.
- Strikte Content-Security-Policy, alle Bibliotheken liegen lokal in `vendor/`.
- Das Repository enthält nur Code, nie Nutzerdaten. Excel-Dateien mit echten Daten **nicht committen**.

## Installation (einmalig)
1. Auf GitHub: *Settings → Pages → Source: GitHub Actions*; Änderungen in `main` mergen → App erscheint unter `https://<user>.github.io/<repo>/`.
2. **Android (Chrome):** Menü → «App installieren». **iOS (Safari):** Teilen → «Zum Home-Bildschirm» (wichtig: nur installierte Apps behalten ihre Daten dauerhaft). **Windows (Edge/Chrome):** Adressleiste → «Installieren».

## Updates
Ein Push auf `main` deployt automatisch. Die App holt beim Start immer die neueste Version (Service Worker, Netzwerk zuerst) und lädt sich selbst neu. Danach erscheint ein Dialog mit den Neuerungen aus `changelog.json` – **bei jedem Release dort oben einen Eintrag mit neuer Versionsnummer ergänzen.**

## Excel
*Einstellungen → Excel*: Export (alle Daten), **leere Vorlage**, Import. Beim Import läuft eine Plausibilitätsprüfung (Formatfehler, Duplikate, Ausreisser je Kategorie, Monatsabweichungen, fehlende Dauerposten, Zukunftsdaten …) mit Bestätigungsdialog.

## Kursdaten
- Wechselkurse: EZB via frankfurter.dev (CHF-Wert zum Buchungsdatum, bei Vermögen tagesaktuell).
- Aktien/ETFs: kostenloser Schlüssel von twelvedata.com in den Einstellungen eintragen (Gratis-Kontingent: 8 Abfragen/Minute).
- Edelmetalle: gold-api.com (XAU, XAG, XPT, XPD).

## Entwicklung
Keine Abhängigkeiten, kein Build. Lokal: `python3 -m http.server` und `http://localhost:8000` öffnen.
Struktur: `js/` (ES-Module), `vendor/` (Chart.js 4.4.4, SheetJS 0.18.5), `sw.js`, `changelog.json`.

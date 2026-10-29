# Automatische Börsenkurse (Supabase-Funktion «quotes»)

Die App holt Kurse für Aktien und ETFs über eine kleine Supabase-Funktion. Sie fragt (kostenlos, inoffiziell) Yahoo Finance ab und
unterstützt die wichtigen Börsen, auch die SIX (Schweiz). Es werden nur **Symbol und Börse** übertragen, nie Mengen oder Beträge.

## Einmalig einrichten (im Browser, auch am iPad)
1. In Supabase dein Projekt öffnen → Menü **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name der Funktion: `quotes` (genau so).
3. Den Beispielcode im Editor komplett ersetzen durch den Inhalt von `supabase/functions/quotes/index.ts` (aus dem Repository kopieren).
4. **Deploy** tippen. «Verify JWT» eingeschaltet lassen (Standard): so können nur angemeldete Benutzer die Funktion aufrufen.
   Falls die App danach «401» meldet, die Option «Verify JWT» in den Funktionseinstellungen ausschalten.
5. In der App: Vermögen → «Kurse aktualisieren».

## Eingabe in der App
- **Symbol** + **Börse** wie bisher, z. B. `NESN` + `SIX`, `AAPL` + `NASDAQ`, `SAP` + `XETR`.
- Alternativ das Yahoo-Symbol direkt angeben, z. B. `NESN.SW`, `CSSMI.SW` (Börse leer lassen).
- Nicht börsenkotierte Fonds (z. B. UBS-Anlagefonds) haben keinen Börsenkurs: Erfassung «Nur Wert» verwenden.

## Hinweise
- Quelle ist inoffiziell und kann ausfallen oder sich ändern. Dann springt, falls hinterlegt, Twelve Data als Ersatz ein; sonst bleibt der letzte Wert bzw. der manuell eingetragene.
- Kurse sind meist leicht verzögert (rund 15 Minuten) und für private Nutzung gedacht.
- Die Funktion speichert nichts; Abfragen werden 5 Minuten zwischengespeichert.

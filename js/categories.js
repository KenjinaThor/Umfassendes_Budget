// Standard-Kategorien nach «Budgetplan Schweiz». Position = Kategorie einer Buchung; Gruppe = Hauptkategorie.
// «savings»-Gruppen (Vorsorge) zählen nicht als Ausgaben, sondern als Sparen/Vorsorge.
export const INCOME_GROUPS = [
 {
  "name": "Einnahmen",
  "positions": [
   {
    "name": "Nettolohn Haupterwerb (inkl. 13. Monatslohn / 12)",
    "hint": "Monatsdurchschnitt"
   },
   {
    "name": "Nettolohn Nebenerwerb / Freiberuf"
   },
   {
    "name": "Alimenten / Unterhaltszahlungen"
   },
   {
    "name": "Renditen / Dividenden aus Anlagen"
   },
   {
    "name": "Nebeneinkünfte / Geschenke / Sonstiges"
   }
  ]
 }
];
export const EXPENSE_GROUPS = [
 {
  "name": "Wohnen & Haushalt (Fixkosten)",
  "positions": [
   {
    "name": "Miete inkl. Nebenkosten (Heizung, Wasser)",
    "hint": "Kaltmiete + HK/NK"
   },
   {
    "name": "Hypothekarzins / Eigenheimkosten",
    "hint": "Falls Wohneigentum"
   },
   {
    "name": "Überweisung gemeinsames Konto",
    "hint": "Haushaltskonto Anteil"
   },
   {
    "name": "Elektrizität / Strom",
    "hint": "Elektrizitätswerk / Netz"
   },
   {
    "name": "Serafe (Radio- & TV-Abgabe)",
    "hint": "CHF 335.– / Jahr (~27.90/Mt.)"
   },
   {
    "name": "Internet, TV & Festnetz",
    "hint": "Heimnetz / Provider"
   },
   {
    "name": "Sicherheitsleiste / Möblierung / Reparaturen"
   },
   {
    "name": "Pflanzen, Garten & Balkon"
   },
   {
    "name": "Bettwäsche, Kissen & Heimtextilien"
   },
   {
    "name": "Haustiere (Futter, Tierarzt, Versicherung)"
   }
  ]
 },
 {
  "name": "Steuern & Recht (Schweizer Pflicht)",
  "positions": [
   {
    "name": "Einkommens- & Vermögenssteuern (Rückstellung)",
    "hint": "Kanton, Gemeinde, Bund"
   },
   {
    "name": "Kirchensteuer (falls pflichtig)"
   },
   {
    "name": "Feuerwehrersatzabgabe (falls zutreffend)",
    "hint": "Gemeindeabhängig"
   }
  ]
 },
 {
  "name": "Gesundheit & Krankenkasse",
  "positions": [
   {
    "name": "Krankenkasse Grundversicherung (KVG)",
    "hint": "Obligatorische Prämien"
   },
   {
    "name": "Krankenkasse Zusatzversicherung (VVG)",
    "hint": "LCA / VV / Zahn etc."
   },
   {
    "name": "Franchise & Selbstbehalt (Rückstellung)",
    "hint": "Jahresfranchise + max 700.– SB"
   },
   {
    "name": "Zahnarzt & Optiker / Brillen (nicht gedeckt)",
    "hint": "Eigenbehalt"
   },
   {
    "name": "Medikamente & Apotheke"
   },
   {
    "name": "Arztrechnungen (Selbstbehalt)"
   },
   {
    "name": "Wellness, Sauna, Massage & Therapie"
   },
   {
    "name": "Akupunktur / Komplementärmedizin"
   },
   {
    "name": "Fitnesssupplements & Gesundheitsprodukte"
   }
  ]
 },
 {
  "name": "Sach- & Personenversicherungen",
  "positions": [
   {
    "name": "Privathaftpflicht- & Hausratversicherung",
    "hint": "Kombi-Police (dringend empfohlen)"
   },
   {
    "name": "Rechtsschutzversicherung (Privat & Verkehr)",
    "hint": "Schweiz / Weltweit"
   },
   {
    "name": "Reise- & Annullationsversicherung",
    "hint": "ETI / TCS / Allianz etc."
   },
   {
    "name": "Todesfall- & Erwerbsunfähigkeitsversicherung",
    "hint": "Private Vorsorge 3b"
   }
  ]
 },
 {
  "name": "Mobilität & Fahrzeug",
  "positions": [
   {
    "name": "Treibstoff (Benzin / Diesel / Strom)"
   },
   {
    "name": "Autoversicherung (Haftpflicht & Kasko)",
    "hint": "Motorfahrzeugversicherung"
   },
   {
    "name": "Strassenverkehrssteuer (Motorfahrzeugsteuer)",
    "hint": "Kantonale Jahressteuer"
   },
   {
    "name": "Parkplatz / Einstellhallenmiete / Anwohnerkarte"
   },
   {
    "name": "ÖV Abonnements (GA / Halbtax / Libero / ZVV)",
    "hint": "Schweizweit oder regional"
   },
   {
    "name": "Autoservice, Inspektion & Fahrzeugservice"
   },
   {
    "name": "Reifen (Pneu), MFK & Autowäsche",
    "hint": "Wechsel, Einlagerung, MFK"
   },
   {
    "name": "Autobahnvignette (CHF 40.– / Jahr)",
    "hint": "Monatseffektiv CHF 3.35"
   }
  ]
 },
 {
  "name": "Verträge, Kommunikation & Abos",
  "positions": [
   {
    "name": "Mobileabo (Handy)"
   },
   {
    "name": "Fitnesscenter Abo / Gym"
   },
   {
    "name": "Golf-Mitgliedschaft & Matchgebühren"
   },
   {
    "name": "Schwimmbad-Abo / Hallenbad"
   },
   {
    "name": "Streaming-Dienste (Netflix, Spotify, Apple, Disney)"
   },
   {
    "name": "Kreditkarten-Gebühren / Jahresgebühr"
   },
   {
    "name": "Sonstige Abonnemente & Mitgliedschaften"
   }
  ]
 },
 {
  "name": "Verpflegung & Haushalt",
  "positions": [
   {
    "name": "Lebensmittel & Supermarkt (Migros, Coop, Aldi, Lidl)",
    "hint": "Wocheneinkauf"
   },
   {
    "name": "Restaurants, Ausgang & Delivery / Take-away",
    "hint": "Auswärts essen"
   },
   {
    "name": "Kaffee, Snacks & Zwischenverpflegung"
   },
   {
    "name": "Rauchen / Tabak / Vapes"
   }
  ]
 },
 {
  "name": "Personal Appearance & Körperpflege",
  "positions": [
   {
    "name": "Arbeitskleidung & Alltagsbekleidung"
   },
   {
    "name": "Coiffeur / Friseur & Barbershop"
   },
   {
    "name": "Hygiene- & Kosmetikartikel",
    "hint": "Drogerie / Parfümerie"
   },
   {
    "name": "Massage & Spa"
   },
   {
    "name": "Maniküre, Pediküre & Nägel"
   },
   {
    "name": "Waschservice & Textilreinigung"
   },
   {
    "name": "Schmuck & Uhren"
   },
   {
    "name": "Make-up & Pflegeprodukte"
   }
  ]
 },
 {
  "name": "Bildung & Entwicklung (Education)",
  "positions": [
   {
    "name": "Bücher, E-Books & Fachzeitschriften"
   },
   {
    "name": "Hardware, Software & Apps (Abos, Cloud)"
   },
   {
    "name": "Kurse, Weiterbildungen & Seminare",
    "hint": "Eigenanteil Ausbildungs- & Kurskosten"
   }
  ]
 },
 {
  "name": "Freizeit, Ferien & Diverses",
  "positions": [
   {
    "name": "Ferien & Hauptreisen (Rückstellung)",
    "hint": "Jahresurlaub / Flüge / Hotels"
   },
   {
    "name": "Wochenendausflüge & Kurztrips"
   },
   {
    "name": "Kultur, Kino, Events & Hobbys"
   },
   {
    "name": "Geschenke (Geburtstage, Weihnachten, Hochzeiten)"
   },
   {
    "name": "Spenden / Gönnerbeiträge (TCS, Rega, Hilfswerke)",
    "hint": "Rega CHF 40.–/Jahr, TCS"
   },
   {
    "name": "Unvorhergesehenes & Puffer (Misc 10%)",
    "hint": "Ungeplante Kleinausgaben"
   }
  ]
 }
];
export const SAVINGS_GROUPS = [
 {
  "name": "Vorsorge & Vermögensaufbau",
  "savings": true,
  "positions": [
   {
    "name": "Säule 3a (Gebundene Vorsorge)",
    "hint": "Max. CHF 7'258.– / Jahr (~604.85/Mt.)"
   },
   {
    "name": "Pensionskasse Einkauf (Säule 2 freiwillig)",
    "hint": "Falls Lücke vorhanden & steuerwirksam"
   },
   {
    "name": "Freies Sparen / Notgroschen (Tagesgeld)",
    "hint": "Ziel: 3-6 Monatseinkommen"
   },
   {
    "name": "Direktinvestitionen (ETFs, Aktien, Fonds - Säule 3b)",
    "hint": "Vermögensaufbau"
   }
  ]
 }
];

const all = [...INCOME_GROUPS.map(g => ['income', g]), ...EXPENSE_GROUPS.map(g => ['expense', g]), ...SAVINGS_GROUPS.map(g => ['expense', g])];
const byPos = new Map();
for (const [kind, g] of all) for (const p of g.positions) byPos.set(p.name.toLowerCase(), { kind, group: g.name, savings: !!g.savings, hint: p.hint || '', name: p.name });

export const lookup = name => byPos.get(String(name || '').toLowerCase().trim()) || null;
export const isKnown = name => byPos.has(String(name || '').toLowerCase().trim());
export const canonical = name => lookup(name)?.name || String(name || '').trim();
export const isSavings = name => !!lookup(name)?.savings;
export const groupOf = name => lookup(name)?.group || 'Weitere Positionen';
export const groupsFor = kind => (kind === 'income' ? INCOME_GROUPS : [...EXPENSE_GROUPS, ...SAVINGS_GROUPS]);

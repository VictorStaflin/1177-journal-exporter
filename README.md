# 1177 Journal Exporter

Ett integritetsfokuserat verktyg för att säkert exportera patientjournaler från det svenska patientgränssnittet (1177.se) till , strukturerad Markdown, CSV, JSON eller rena textfiler.

<img width="339" height="596" alt="image" src="https://github.com/user-attachments/assets/1f73c68f-e115-487b-b944-432e98f94222" />

Utvecklat av [Victor Staflin](https://github.com/VictorStaflin).
---

## Funktioner

* **Stöd för flera format:** Exportera dina journaler som Markdown (.md), interaktiv webbrapport (.html), ren text (.txt), kalkylvänlig CSV (.csv) eller strukturerad JSON (.json).
* **Parallell expansionsmotor (5-kanals pool):** Snabb inläsning som automatiskt expanderar över 300 dolda journalanteckningar på ett fåtal sekunder (cirka 5 gånger snabbare än sekventiell laddning). Använder en parallell kö som är begränsad till exakt 5 samtidiga anslutningar för att respektera webbläsarens gränser och förhindra plattformsbegränsningar.
* **Interaktiv offline-instrumentpanel (HTML):**
  * **Sökning i realtid:** Sök och filtrera direkt på termer, datum, vårdgivare eller kliniska fynd medan du skriver.
  * **Kategorifiltrering:** Gruppera automatiskt anteckningar efter anteckningstyp.
  * **Kronologisk sortering:** Snabbreglage för att sortera efter nyast eller äldst först.
  * **Spara färgtema:** Fullt stöd för mörkt läge som sparas lokalt i webbläsaren.
  * **Tidslinjenavigering:** En klickbar tidslinje i sidofältet som mjukt scrollar ner till vald anteckning och markerar den med en kort animation.
* **Integritet i fokus:** Körs till 100 % lokalt i din webbläsare. Inga externa skript, spårningsverktyg eller CDN-tjänster används. Innehåller inbyggda råd för att förhindra att känslig hälsoinformation delas med publika molnbaserade AI-tjänster, och rekommenderar istället helt lokala AI-modeller (t.ex. Ollama eller LM Studio).
* **Utskrifts- och PDF-optimerad:** Särskilda stilregler döljer sidofält och sökfält vid utskrift eller PDF-export, samt förhindrar att en anteckning bryts mitt i en sida.

---

## Installation

Eftersom detta är ett utvecklarverktyg laddar du enkelt in det direkt i valfri Chromium-baserad webbläsare (Chrome, Brave, Edge, Opera, Vivaldi):

1. Ladda ned eller klona detta kodarkiv till din dator.
2. Öppna webbläsaren och navigera till sidan för tillägg:
   * Chrome: `chrome://extensions`
   * Brave: `brave://extensions`
   * Edge: `edge://extensions`
3. Aktivera "Utvecklarläge" (Developer mode) uppe till höger.
4. Klicka på "Läs in opackat" (Load unpacked) uppe till vänster.
5. Välj mappen som innehåller projektets filer (där filen `manifest.json` ligger).
6. Tilläggets ikon visas nu i verktygsfältet och är redo att användas.

---

## Användning

1. Logga in säkert på 1177.se och navigera till din journal.
2. Gå till Journalen -> Journalanteckningar (webbadressen måste matcha `https://journalen.1177.se/JournalCategories/CareDocumentation`).
3. Klicka på tilläggets ikon i webbläsarens verktygsfält för att öppna menyn.
4. Steg 1: Välj ditt önskade exportformat (t.ex. Markdown för lokal AI-analys eller HTML för enkel läsning).
5. Steg 2: Klicka på "Öppna dolda poster" för att expandera alla anteckningar. Den parallella expansionsmotorn öppnar säkert alla stängda kort.
6. Steg 3: Klicka på "Spara journal" för att ladda ned den färdigställda exporten direkt till din dators hämtade filer.

---

## Licens

Distribueras under MIT-licensen. Se `LICENSE` för mer information.

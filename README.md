# AI Support Workflow Assistant

Ein kleines Support Tool, das zeigt, wie eingehende Kundenanfragen automatisch eingeordnet und als Tickets verarbeitet werden können.

Die App läuft im Browser, nutzt aber im Hintergrund einen Node.js Server für die Logik und optionale KI Unterstützung.

## Idee

Statt Support Anfragen manuell zu sortieren, übernimmt das System den ersten Schritt.

- Anfrage analysieren
- Kategorie erkennen
- Priorität einschätzen
- passendes Team vorschlagen

Ziel war es, den Support Workflow übersichtlicher und strukturierter darzustellen.

## Funktionen

- Eingabe von Kundenanfragen oder Nutzung von Beispieltexten
- Automatische Einordnung nach Kategorie, Stimmung und Dringlichkeit
- Priorisierung von Low bis Critical
- Vorschlag für zuständiges Team
- Erstellung und Verwaltung von Tickets
- Status: Open, In Progress, Resolved
- Such und Filterfunktion für bessere Übersicht
- Interne Notizen pro Ticket
- Timeline mit allen Änderungen
- Kleines Dashboard mit Kennzahlen
- KI Analyse und Antwortvorschläge optional
- Funktioniert auch komplett ohne KI im Fallback Modus

## Wie es funktioniert

Du gibst eine Nachricht ein und daraus wird ein Ticket erstellt.

Mit API Key wird die Anfrage an Claude geschickt und strukturiert analysiert, zum Beispiel Kategorie, Priorität oder Stimmung.

Ohne API Key nutzt das System einfache Regeln und Keywords zur Einordnung.

Beide Varianten führen zum gleichen Ergebnis, ein nutzbares Ticket im System.

## Starten

Voraussetzung ist Node.js ab Version 18.

Installation:

```bash
npm install
```

Start:

```bash
node server.js
```

Danach im Browser öffnen:
`http://localhost:3000`

## Optional KI aktivieren

Erstelle eine `.env` Datei im Projektordner:

```
ANTHROPIC_API_KEY=dein_api_key
```

Ohne API Key läuft die Anwendung automatisch im Fallback Modus.

## Projektstruktur

- `index.html` → Aufbau der Oberfläche
- `style.css` → Design und Layout
- `app.js` → Frontend Logik
- `server.js` → Backend und API
- `package.json` → Abhängigkeiten

## Hinweis zur KI Nutzung

Bei der Entwicklung wurde Claude unterstützend genutzt, zum Beispiel für Ideen, Struktur und einzelne Implementierungen.

Die Logik, Anpassungen und Integration in das System wurden eigenständig umgesetzt.

## Hinweis

Die Anwendung läuft lokal auf deinem Rechner.
`index.html` alleine funktioniert nicht, da ein Server benötigt wird.

## Kurz gesagt

Das Projekt zeigt, wie ein einfaches Support System mit automatischer Ticket Einordnung aufgebaut sein kann, inklusive optionaler KI Integration.

---
title: So verfolgst du deine Ausgaben automatisch
description: Verbinde deine Bank, lass Zahlungsempfänger, Regeln und KI jede Transaktion sortieren und behalte deine Ausgaben mit fünf Minuten Prüfung pro Woche im Blick.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/automation-rules
  - /features/ai-categorization
docs:
  - label: Bankverbindungen
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Zahlungsempfänger
    href: https://docs.moneymatter.app/transactions/payees/
  - label: KI-Funktionen
    href: https://docs.moneymatter.app/ai/ai-features/
---

Die meisten Menschen hören aus demselben Grund auf, ihre Ausgaben zu erfassen: Jeden Kaffee einzutippen wird nach einem Monat lästig. Automatisches Tracking nimmt dir das Tippen ab. Deine Transaktionen kommen von selbst an, jede bekommt einen Zahlungsempfänger und eine Kategorie, und dein Anteil schrumpft auf eine kurze Prüfung einmal pro Woche.

MoneyMatter macht das in drei Schichten. Die Banksynchronisierung holt die Transaktionen herein. Zahlungsempfänger und Regeln sortieren die, die dir jeden Monat begegnen. Die KI sortiert den Rest.

## Verbinde deine Bank

Die Banksynchronisierung gehört zum Plus-Tarif, und die kostenlose Testphase von 40 Tagen enthält sie, ohne dass du eine Karte brauchst. MoneyMatter verbindet sich über mehrere Anbieter, je nachdem, wo deine Bank sitzt:

- **Lunch Flow** deckt über 20.000 Banken in den USA, Kanada, der EU, Großbritannien, Australien und Neuseeland ab.
- **SimpleFIN** deckt die USA und Kanada ab.
- **Akahu** deckt die meisten neuseeländischen Banken ab, und **Monobank** verbindet sich direkt in der Ukraine.

Lunch Flow und SimpleFIN berechnen ihren eigenen Dienst separat von deinem MoneyMatter-Tarif. Akahu und Monobank verursachen keine zusätzlichen Kosten.

So verbindest du dich:

1. Öffne in der Seitenleiste **Konten** → **Alle Konten**.
2. Klicke im Bereich **Bankverbindungen** auf **Bank verbinden**.
3. Wähle deine Region und deinen Anbieter, füge den Schlüssel deines Anbieters ein und klicke auf **Verbinden**.
4. Wähle die gewünschten Konten aus.

Die Verbindung ist schreibgeschützt. MoneyMatter sieht Konten, Salden und Transaktionen, kann aber kein Geld bewegen, und dein Bankpasswort wird nie gespeichert.

![Eine Seite einer Bankverbindung mit Gesamtsaldo, Anzahl der verbundenen Konten, automatischer Synchronisierung alle 12 Stunden, Zeitpunkt der letzten Synchronisierung, einem Button „Sync now“ und geöffnetem Menü „Manage“](/img/landing/screenshots/features/import/bank-connection-details@2x.webp)

Wenn du ein Konto schon von Hand führst, musst du nicht von vorn anfangen. Verbinde die Bank ohne dieses Konto, öffne dann das Konto und verknüpfe es im Tab **Datenverbindung**. Dein Verlauf bleibt erhalten, und die Synchronisierung läuft von dort aus weiter.

## Lege fest, wann synchronisiert wird

MoneyMatter synchronisiert deine verbundenen Konten zweimal am Tag, zu zwei Uhrzeiten, die du unter **Einstellungen** → **Allgemein** wählst. Lege eine auf den frühen Morgen, dann sind die Ausgaben von gestern da, wenn du dein Budget prüfst. Auch das Öffnen der App kann eine Synchronisierung starten, und mit dem Wolken-Button in der Kopfzeile synchronisierst du sofort.

## Überlass Zahlungsempfängern die Läden, die du jede Woche besuchst

MoneyMatter liest den Händlernamen jeder synchronisierten Transaktion und verknüpft ihn mit einem Zahlungsempfänger. Standardmäßig legt es den Zahlungsempfänger für dich an, sobald zwei Transaktionen einen neuen Namen teilen. Ähnliche Schreibweisen wie „LIDL 1234“ und „LIDL SAGT DANKE“ werden als Aliasse desselben Zahlungsempfängers gespeichert.

Gib einem Zahlungsempfänger einmal eine **Standardkategorie**, und jede neue Transaktion von ihm bekommt diese Kategorie. Wie streng das gilt, bestimmt die Einstellung **KI-Kategorisierung**:

- **Immer Kategorie des Zahlungsempfängers verwenden** passt zu einem Laden, in dem du immer dieselbe Art von Dingen kaufst, etwa deinem Supermarkt.
- **Als Hinweis verwenden** passt zu einem Laden, der alles verkauft, etwa einem großen Onlineshop. Die Kategorie des Zahlungsempfängers wird zuerst gesetzt, und die KI kann sie anhand der Transaktionsdetails ersetzen.

Ein Zahlungsempfänger kann seinen Transaktionen auch Tags hinzufügen, etwa ein Tag **Haushalt** für deine gemeinsamen Lebensmitteleinkäufe.

![Die Seite eines Zahlungsempfängers mit Anzahl der Transaktionen, Nettofluss und Top-Kategorie, dem Bereich „Categorization“ mit einer Standardkategorie und der auf „Always use payee category“ gestellten KI-Kategorisierung sowie zwei Aliassen](/img/landing/screenshots/features/transactions/payee-detail-page@2x.webp)

## Schreibe Regeln für alles, was du genau beschreiben kannst

Zahlungsempfänger arbeiten nach Händler. Eine Regel funktioniert mit allem, was du beschreiben kannst: dem Händlertext, dem Betrag, dem Konto oder dem Tag des Monats. Zum Beispiel:

- Der Händlertext enthält „uber“ oder „bolt“: Setze die Kategorie auf Transport.
- Der Betrag ist genau 1.200 und der Tag liegt zwischen 1 und 5: Setze die Kategorie auf Miete und den Zahlungsempfänger auf deine Vermieterin oder deinen Vermieter.
- Das Konto ist deine gemeinsame Karte: Füge das Tag Haushalt hinzu.

Um eine Regel anzulegen, öffne in der Seitenleiste **Transaktionen** → **Automatisierungen**. Eine Regel kann Kategorie, Tags, Zahlungsempfänger oder Notiz setzen und läuft bei jeder neuen Transaktion aus der Banksynchronisierung und aus Dateiimporten. Regeln sind in jedem Tarif enthalten.

![Das Formular „Edit automation“ für eine Regel „Monthly rent“ mit Bedingungen zu Notiz, Transaktionstyp, Betrag und Konto, den Aktionen „Set category“ und „Set payee“ sowie einem Bereich „Preview“](/img/landing/screenshots/features/automations/automation-form@2x.webp)

Eine neue Regel ändert deine bisherigen Transaktionen nicht von selbst. Um sie aufzuräumen, wende die gespeicherte Regel an, hake in der Prüfliste die Treffer an, die du willst, und bestätige.

## Überlass der KI alles andere

Neue Transaktionen aus der Banksynchronisierung, die ohne Kategorie ankommen, gehen wenige Sekunden nach ihrem Eingang an die KI. Sie wählt aus deiner eigenen Kategorienliste, sodass das Ergebnis zu der Art passt, wie du ohnehin budgetierst.

Die KI sieht von jeder Transaktion Betrag, Währung, Datum, Kontoname, Notiz und Zahlungsempfänger, dazu deine Kategorienamen. Deine Salden werden nicht gesendet. Sie überschreibt nie eine Kategorie, die du von Hand oder per Regel gesetzt hast.

Die KI lernt nicht aus deinen Korrekturen. Wenn du denselben Fehler zweimal korrigierst, lege für diesen Zahlungsempfänger eine Standardkategorie fest oder schreibe eine Regel, dann tritt der Fehler nicht mehr auf.

Plus enthält die KI von MoneyMatter mit einem monatlichen Kontingent, und die Testphase ebenso. Im Tarif Essential läuft die KI-Kategorisierung mit deinem eigenen OpenAI-, Anthropic- oder Gemini-Schlüssel.

![Der Tab „AI Features“ der KI-Einstellungen mit der Anzeige „Included AI usage“ oben und der Liste der Funktionen, jeweils mit dem Modell, das sie antreibt](/img/landing/screenshots/features/ai/ai-features-tab@2x.webp)

## Was Vorrang hat

Wenn mehr als eine Schicht eine Kategorie setzen könnte, verwendet MoneyMatter diese Reihenfolge:

1. Eine zugeordnete wiederkehrende Zahlung setzt die Kategorie zuerst.
2. Danach kommt eine Regel, die sich gegen die Standardkategorie eines Zahlungsempfängers durchsetzt.
3. Die KI kategorisiert alles, was dann noch übrig ist.

Stecke dein genauestes Wissen in Regeln und Zahlungsempfänger und überlass der KI den langen Rest.

## Umbuchungen zwischen deinen Konten sind keine Ausgaben

Wenn du Geld von deinem Girokonto auf dein Sparkonto verschiebst, kommen beide Seiten von deiner Bank. Würden sie als Ausgabe und Einnahme zählen, sähen beide Summen größer aus, als sie sind.

MoneyMatter verknüpft sie für dich. Hat eine synchronisierte Transaktion genau einen Treffer auf einem anderen verbundenen Konto, mit gleichem Betrag und gleicher Währung in Gegenrichtung innerhalb von 3 Tagen, wird das Paar zu einer Umbuchung und fällt aus deinen Ausgabenstatistiken heraus. Bei einem Umtausch zwischen zwei Währungen musst du meist selbst nachhelfen: Öffne die Transaktion, wähle den Tab **Umbuchung** und verknüpfe die Gegenseite selbst.

## Prüfe deine Woche in fünf Minuten

Automatisch heißt nicht, dass du nie hinschaust. Öffne einmal pro Woche **Transaktionen** und geh die neuen durch:

- Korrigiere alles, was in der falschen Kategorie gelandet ist.
- Sieh nach, was noch in deiner Standardkategorie liegt, meist **Sonstiges**.
- Wenn du dieselbe Korrektur ein zweites Mal machst, mach daraus einen Standard für den Zahlungsempfänger oder eine Regel.

Jede Korrektur, die du in eine Regel verwandelst, musst du nie wieder machen, deshalb wird die Liste jede Woche kürzer.

## Wenn deine Bank nicht unterstützt wird

Auch dann kannst du dir das Tippen sparen. Importiere eine CSV-, OFX- oder QFX-Datei deiner Bank oder lade einen PDF-Kontoauszug hoch und lass die KI die Transaktionen herausziehen. Zahlungsempfänger und Regeln funktionieren auch bei importierten Transaktionen. Transaktionen aus einem PDF-Kontoauszug gehen außerdem an die KI-Kategorisierung, und bei einer CSV-Datei kannst du sie selbst unter **Transaktionen** → **Optimierungen** starten. Im Tarif Essential, der keine Banksynchronisierung hat, bekommen Regeln ihre Transaktionen auf diesem Weg.

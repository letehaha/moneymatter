---
title: So erfasst du Geld in mehreren Währungen
description: Konten pro Währung anlegen, Umtausch und Kartenzahlungen im Ausland richtig erfassen und sehen, warum sich dein Nettovermögen bewegt, deine Berichte aber nicht.
published: 2026-10-31
related:
  - /features/multi-currency
  - /features/transfers-and-refunds
  - /features/net-worth-tracker
docs:
  - label: Basiswährung und Währungen
    href: https://docs.moneymatter.app/settings/base-currency-and-currencies/
  - label: So funktionieren Umbuchungen
    href: https://docs.moneymatter.app/transfers-and-refunds/how-transfers-work/
  - label: So werden Statistiken berechnet
    href: https://docs.moneymatter.app/stats/how-stats-are-calculated/
---

Angenommen, du verdienst in EUR, sparst in USD und zahlst deine Miete in PLN. Jeden Saldo kannst du einzeln ablesen, trotzdem willst du wissen, wie viel du insgesamt hast – und warum sich diese Summe an einem Tag geändert hat, an dem du nichts gemacht hast.

MoneyMatter beantwortet beides, wenn du deine Konten so einrichtest und Umtausche so erfasst, wie es dieser Ratgeber zeigt.

## Wähle deine Basiswährung bei der Registrierung

MoneyMatter zeigt jede Summe in deiner Basiswährung an: im Dashboard, in den Statistiken, in Berichten und bei den Summen von Kontogruppen. Wähle die Währung, in der du Preise vergleichst – meist die, in der du am meisten ausgibst.

Der Bildschirm **Basiswährung auswählen** erscheint direkt nach der Registrierung. Voreingestellt ist USD, also prüfe die Auswahl, bevor du auf **Währung bestätigen** klickst.

Bei der Registrierung kannst du jede Währung wählen. Später kannst du nur noch zu einer Währung mit langer Kurshistorie wechseln, etwa USD, EUR, GBP, PLN, UAH, CHF, JPY, CAD oder AUD.

## Lege ein Konto pro Währung an

Lege für jedes echte Konto ein MoneyMatter-Konto in der Währung an, die es führt. Das Feld **Währung** listet nur die Währungen auf, die du hinzugefügt hast. Für eine weitere scrollst du ans Ende der Liste und klickst auf **Neue Währung hinzufügen +**.

Prüfe die Währung, bevor du speicherst. Du kannst sie später nicht ändern – bei einer falschen Währung musst du also ein neues Konto anlegen.

Für ein Bankkonto mit mehreren Währungen, etwa bei Revolut, legst du ein Konto pro Währung an: „Revolut EUR“ und „Revolut USD“. Fasse sie in einer Kontogruppe zusammen, dann zeigt die Seitenleiste ihre gemeinsame Summe in deiner Basiswährung.

Für CSV-Importe gilt dieselbe Regel. Hat ein Kontoname Zeilen in zwei Währungen, bricht der Import mit einem Fehler ab. Teile diese Zeilen also vorher in der Datei auf getrennte Kontonamen auf.

## Erfasse den Betrag, der vom Konto abging

Jede Transaktion verwendet die Währung ihres Kontos. Gib den Betrag ein, der von diesem Konto abging, und MoneyMatter rechnet ihn in deine Basiswährung um.

- **Du zahlst 50 USD von deinem USD-Konto.** Gib in diesem Konto 50 ein.
- **Du zahlst 50 USD mit deiner EUR-Karte.** Gib im EUR-Konto den EUR-Betrag ein, den deine Bank belastet hat. Wenn du die 50 USD festhalten willst, trag sie unter **Originalbetrag** ein. Dieses Feld wirkt sich nicht auf deine Statistiken aus.

Um die Umrechnungen zu prüfen, stell die Transaktionsseite auf **Tabellenansicht** um und sieh dir die Spalte **Basisbetrag** an.

## Erfasse Währungsumtausch als Umbuchung

Angenommen, du überweist 500 USD auf eine EUR-Karte und es kommen 460 EUR an. Erfasst du das als Ausgabe und als Einnahme, blähst du deine Summen für Ausgaben und Einnahmen auf. Erfasse stattdessen eine Umbuchung:

1. Klicke auf **Transaktion hinzufügen** und wähle den Tab **Umbuchung**.
2. Gib unter **Betrag** 500 ein und wähle unter **Von Konto** das USD-Konto.
3. Wähle unter **Auf Konto** die EUR-Karte und gib unter **Zielbetrag** 460 ein.
4. Klicke auf **Erstellen**.

MoneyMatter schlägt hier keinen Kurs vor. Deine beiden Beträge legen ihn fest, sodass der Eintrag genau dem entspricht, was deine Bank oder Wechselstube berechnet hat.

Bei Bankverbindungen (Plus-Tarif) ist ein zusätzlicher Schritt nötig. MoneyMatter kann Umbuchungen in derselben Währung zwischen verbundenen Konten für dich verknüpfen, Umtausche zwischen Währungen verknüpfst du aber selbst. Bis dahin zählen die beiden Seiten als Ausgabe und Einnahme. Öffne die importierte Transaktion und wähle den Tab **Umbuchung**. Ist die Gegenseite schon erfasst, nutze **Gegenbuchung verknüpfen**. Wenn nicht, wähle das andere Konto.

## Warum sich dein Nettovermögen ändert, obwohl du nichts ausgibst

MoneyMatter verwendet für jede Art von Zahl einen anderen Kurs:

- **Transaktionen behalten den Kurs ihres eigenen Datums.** Zahlst du am 3. März 50 USD und ist EUR deine Basiswährung, speichert MoneyMatter den Basisbetrag zum Kurs dieses Tages. Der Bericht des Vormonats zeigt heute dieselben Zahlen wie im letzten Monat.
- **Aktuelle Salden verwenden den neuesten Kurs.** Die Kurse werden einmal täglich um 18:00 UTC aktualisiert.
- **Saldo-Diagramme verwenden den Kurs des jeweiligen Tages.** Das Diagramm bewertet, was du an einem bestimmten Tag hattest, zum Kurs dieses Tages.

Angenommen, deine Basiswährung ist EUR und du hältst 1.000 USD. Fällt der Kurs von 0,92 auf 0,90, sinkt dein Nettovermögen um 20 EUR, ohne dass eine Transaktion dahintersteht.

Aus demselben Grund passt bei Fremdwährungsbeständen die Differenz aus Einnahmen und Ausgaben eines Monats meist nicht zur Veränderung deines Nettovermögens. Der Bericht zeigt, was du damals ausgegeben hast. Das Diagramm zeigt, was dein Geld an diesem Tag wert war.

## Nutze einen eigenen Kurs nur, wenn du einen festen Kurs willst

Der Kurs deiner Bank entspricht selten dem Marktkurs, daher willst du vielleicht deinen eigenen eingeben. Geh zu **Einstellungen** → **Währungen**, klapp die Zeile der Währung auf, deaktiviere **Live-Aktualisierung**, gib den Kurs in eines der beiden Felder ein und klicke auf **Speichern**.

![Eine aufgeklappte PLN-Zeile auf der Seite „Currencies“ mit deaktiviertem „Live update“, einem eingegebenen eigenen Kurs von 0.25 und dem Button „Save“](/img/landing/screenshots/features/settings/custom-exchange-rate@2x.webp)

Du bekommst einen Kurs pro Währung, ohne Datum:

- Neue Transaktionen und jede Transaktion, die du bearbeitest und speicherst, verwenden ihn – auch wenn sie aus dem letzten Jahr stammen. Bereits gespeicherte Transaktionen behalten ihre Basisbeträge, bis du sie bearbeitest.
- Salden wechseln sofort nach dem Speichern zu diesem Kurs. Bei manuell geführten Konten berechnet MoneyMatter außerdem den gesamten Saldoverlauf mit diesem Kurs neu, sodass das Diagramm für diese Währung nicht mehr dem Markt folgt.

Ich würde **Live-Aktualisierung** für die meisten Währungen eingeschaltet lassen. Du kannst keinen Kurs pro Zahlung festlegen, und eine Umbuchung erfasst ohnehin den tatsächlichen Kurs jedes Umtauschs. Um zurückzuwechseln, aktiviere **Live-Aktualisierung** wieder und klicke auf **Speichern**.

## Wenn du in ein anderes Land ziehst

Wenn sich die Währung ändert, in der du denkst, wechselst du deine Basiswährung und behältst deine Daten. Geh zu **Einstellungen** → **Währungen** und füge die neue Währung hinzu, falls sie nicht aufgeführt ist. Klapp dann ihre Zeile auf, klicke auf **Als Basiswährung festlegen** und bestätige.

MoneyMatter berechnet jede Transaktion zum Marktkurs ihres Datums neu und rechnet Salden zum heutigen Kurs um. Deine ursprünglichen Beträge bleiben so, wie du sie eingegeben hast. Bevor du anfängst:

- **Plane ein paar Minuten ein.** Lass den Tab geöffnet. Bis der Vorgang abgeschlossen ist, kannst du auf keinem Gerät etwas hinzufügen oder ändern, das Beträge betrifft.
- **Beende vorher die Freigaben.** MoneyMatter blockiert den Wechsel, solange du Konten freigibst oder zu einem Haushalt gehörst.
- **Richte eigene Kurse neu ein.** Du hast sie gegenüber deiner alten Basiswährung festgelegt, deshalb springen die meisten dieser Währungen auf **Live** zurück. Leg deinen Kurs erneut fest, wenn du ihn weiterhin willst.
- **Wechsle möglichst nur einmal.** Wenn du hin und her wechselst, können umgerechnete Summen ein paar Cent vom Ausgangswert abweichen.

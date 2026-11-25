---
title: So nutzt du Open Banking mit einer Budget-App in Großbritannien und der EU
description: Verbinde britische und europäische Banken über Open Banking mit MoneyMatter, wähle zwischen Lunch Flow und Enable Banking und halte die Verbindung am Laufen.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/security-and-privacy
  - /features/multi-currency
docs:
  - label: Bankverbindungen
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Allgemeine Einstellungen
    href: https://docs.moneymatter.app/settings/general-settings/
  - label: Tarife und Abrechnung
    href: https://docs.moneymatter.app/settings/plans-and-billing/
---

In Großbritannien und der EU müssen Banken dir erlauben, deine Kontodaten mit Apps zu teilen, die du auswählst. Das ist Open Banking. Du bestätigst den Zugriff auf der Website oder in der App deiner Bank, der Zugriff ist schreibgeschützt, und er läuft nach einer festgelegten Zeit ab, wenn du ihn nicht erneuerst.

Für eine Budget-App heißt das: Deine Transaktionen kommen von selbst an, ohne CSV-Exporte und ohne Tippen. Dieser Ratgeber zeigt, wie du das in MoneyMatter einrichtest und was danach auf dich zukommt.

## Was Open Banking einer App gibt und was nicht

- **Sie kann lesen:** deine Konten, Salden und Transaktionen.
- **Sie kann kein Geld bewegen.** Die Bankverbindungen von MoneyMatter sind schreibgeschützt.
- **Sie sieht nie dein Bankpasswort.** Du meldest dich bei deiner Bank an, und MoneyMatter speichert nur die Zugriffstoken und Schlüssel, verschlüsselt mit AES-256-GCM.

## Zwei Wege, sich aus Großbritannien und der EU zu verbinden

Die Banksynchronisierung gehört zum Plus-Tarif, und die kostenlose Testphase von 40 Tagen enthält sie, ohne dass du eine Karte brauchst. In Großbritannien und der EU kannst du dich über zwei Anbieter verbinden.

**Lunch Flow** ist der einfache Weg. Es deckt über 20.000 Banken in Großbritannien, der EU und darüber hinaus ab. Du eröffnest ein Lunch-Flow-Konto, verknüpfst dort deine Banken und fügst seinen API-Schlüssel in MoneyMatter ein. Lunch Flow berechnet seinen eigenen Dienst separat von deinem MoneyMatter-Tarif.

**Enable Banking** deckt über 6.000 Banken in der EU und Großbritannien ab und kostet nichts extra. Der Haken ist die Einrichtung: Du registrierst eine eigene Entwickleranwendung bei Enable Banking und gibst MoneyMatter deren Application ID und privaten Schlüssel. Es befindet sich in der Beta und passt zu Leuten, die mit technischer Einrichtung vertraut sind.

In Polen kann sich MoneyMatter außerdem direkt mit deinen Walutomat-Währungswallets verbinden, ohne zusätzliche Kosten.

![Der Dialog „Add integration“ mit Regionsfiltern und einer Liste von Anbietern, darunter Lunch Flow, SimpleFIN, Akahu und Monobank, jeweils mit Preis und Einrichtungsaufwand](/img/landing/screenshots/bank-providers@2x.webp)

## Verbinde deine Bank

1. Öffne in der Seitenleiste **Konten** → **Alle Konten**.
2. Klicke im Bereich **Bankverbindungen** auf **Bank verbinden**.
3. Wähle die Region **EU & GB** und deinen Anbieter.
4. Bei Lunch Flow fügst du deinen API-Schlüssel ein und klickst auf **Verbinden**. Bei Enable Banking gibst du deine Application ID und deinen privaten Schlüssel ein, wählst dein Land und deine Bank und bestätigst den Zugriff bei deiner Bank.
5. Wähle die gewünschten Konten aus.

Schließe die Verbindung bei Enable Banking im selben Browser ab, in dem du angefangen hast, denn MoneyMatter merkt sich die ausstehende Verbindung dort.

Du führst ein Konto schon von Hand? Verbinde die Bank ohne dieses Konto, öffne dann das Konto und verknüpfe es im Tab **Datenverbindung**. Dein Verlauf bleibt erhalten, und die Synchronisierung läuft von dort aus weiter.

## Wie viel Verlauf du bekommst

Bei Enable Banking lädt die erste Synchronisierung so viel, wie deine Bank erlaubt, je nach Bank von 90 Tagen bis zu etwa 3 Jahren. Bei Lunch Flow bekommst du das, was Lunch Flow für das Konto hat. Danach setzt jede Synchronisierung bei deiner neuesten Transaktion an.

## Ausstehende Kartenzahlungen

Manche Banken melden eine Kartenzahlung als ausstehend, bevor sie gebucht ist. Bei Enable Banking überspringt MoneyMatter ausstehende Zahlungen, solange du nicht unter **Einstellungen** → **Allgemein** die Option **Ausstehende Banktransaktionen importieren** einschaltest. Bucht die Bank eine Zahlung, wird die ausstehende Kopie mit ihr zusammengeführt, sodass sie nicht doppelt erscheint.

## Erneuere den Zugriff, bevor er abläuft

Der Open-Banking-Zugriff gilt nur begrenzte Zeit. Bei Enable Banking fragt MoneyMatter den längsten Zeitraum an, den deine Bank erlaubt, oder 90 Tage, wenn die Bank keinen nennt. Die Seite der Verbindung zeigt, wie viele Tage der Einwilligung noch übrig sind.

Bei 7 Tagen oder weniger zeigt die Verbindung **Läuft bald ab**. Sobald sie abgelaufen ist, zeigt sie **Abgelaufen** und synchronisiert nicht mehr. Zum Erneuern öffnest du die Seite der Verbindung, klickst auf **Jetzt neu verbinden** und bestätigst den Zugriff erneut bei deiner Bank. Deine Konten werden weiter in dieselben MoneyMatter-Konten synchronisiert, mit unverändertem Verlauf.

## Konten in mehreren Währungen

Viele Menschen in Europa haben Konten in mehr als einer Währung, etwa ein Girokonto in Euro und ein Konto in Pfund oder Dollar. MoneyMatter führt jedes Konto in seiner eigenen Währung und zeigt deine Summen in deiner Basiswährung.

Wenn du Geld zwischen zwei deiner verbundenen Konten in derselben Währung verschiebst, kommen beide Seiten von deinen Banken. MoneyMatter verknüpft sie als Umbuchung, wenn es genau einen Treffer mit gleichem Betrag in Gegenrichtung innerhalb von 3 Tagen findet, damit die Verschiebung nicht als Ausgabe zählt. Bei einem Umtausch zwischen zwei Währungen musst du meist selbst nachhelfen: Öffne die Transaktion, wähle den Tab **Umbuchung** und verknüpfe die Gegenseite selbst.

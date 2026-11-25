---
title: So wählst du eine datenschutzfreundliche Finanz-App
description: Acht Fragen, die du jeder Finanz-App zu deinen Daten stellen solltest, mit den Antworten von MoneyMatter, auch dort, wo es Schwächen hat.
published: 2026-11-25
related:
  - /features/security-and-privacy
  - /features/export-and-backup
  - /features/ai-categorization
docs:
  - label: Sicherheit und Konto
    href: https://docs.moneymatter.app/settings/security-and-account/
  - label: KI-Funktionen
    href: https://docs.moneymatter.app/ai/ai-features/
  - label: Bankverbindungen
    href: https://docs.moneymatter.app/import/bank-connections/
---

Eine Finanz-App weiß mehr über dich als die meisten Apps: wo du einkaufst, was du verdienst, an wen du Miete zahlst. „Wir nehmen deine Privatsphäre ernst“ auf einer Startseite sagt dir nichts. Die Fragen unten schon.

Zu jeder gibt es die Antwort von MoneyMatter, auch dort, wo es Schwächen hat, damit du es fair mit jeder anderen App vergleichen kannst.

## 1. Womit verdient die App Geld?

Server kosten Geld, und irgendwie wird die Rechnung bezahlt. Ist eine App kostenlos und zeigt Werbung oder verdient eine Provision, wenn du die empfohlene Karte oder den empfohlenen Kredit abschließt, dann sind deine Ausgabendaten Teil ihrer Bezahlung.

MoneyMatter wird über Abonnements bezahlt. Es zeigt keine Werbung und nutzt keine Tracker von Google oder Facebook.

## 2. Wie verbindet sie sich mit deiner Bank?

Achte auf eine schreibgeschützte Verbindung, bei der du dich auf der Website oder in der App deiner Bank selbst anmeldest. Sei vorsichtig bei jeder App, die nach deinem Bankpasswort fragt.

Die Bankverbindungen von MoneyMatter sind schreibgeschützt: Sie sehen Konten, Salden und Transaktionen, können aber kein Geld bewegen. Dein Bankpasswort wird nie gespeichert. Die Schlüssel und Tokens deiner Verbindungen sind mit AES-256-GCM verschlüsselt, sodass eine Kopie der Datenbank allein sie nicht preisgibt. Du kannst die Banksynchronisierung auch ganz weglassen und Transaktionen von Hand oder aus Dateien hinzufügen.

## 3. Wer kann deine Transaktionen lesen?

Frag, ob die App Ende-zu-Ende-verschlüsselt ist. Wenn ja, kann das Unternehmen deine Daten nicht lesen, und seine Server können daraus auch keine Berichte erstellen oder KI darauf anwenden.

MoneyMatter ist nicht Ende-zu-Ende-verschlüsselt. Der gesamte Datenverkehr läuft über HTTPS, aber Transaktionen und Salden werden so gespeichert, dass der Server sie lesen und deine Berichte erstellen kann. Wer den Server betreibt, kann also darauf zugreifen, und bei MoneyMatter Cloud ist das MoneyMatter.

## 4. Welche anderen Unternehmen sehen deine Daten?

Jede App stützt sich auf externe Dienste. Eine vertrauenswürdige App nennt sie und sagt, was jeder bekommt. Die wichtigsten bei MoneyMatter:

- **Stripe** wickelt Zahlungen ab. Stripe nimmt deine Kartendaten entgegen, und MoneyMatter erhält die Kartennummer nie.
- **Resend** verschickt Anmelde- und Konto-E-Mails.
- **Sentry** erhält Absturzberichte, die deine E-Mail-Adresse enthalten. Eine Sitzung mit einem Fehler kann eine Aufzeichnung enthalten, bei der jeder Text maskiert und Medien blockiert sind.
- **PostHog** erhält Produktanalysen, die mit deinem Konto und deiner E-Mail-Adresse verknüpft sind. Echte Konten haben keine Sitzungsaufzeichnung. Schalte in deinem Browser Do Not Track ein, um die Analysen zu stoppen, die dein Browser sendet. Der Server erfasst weiterhin Ereignisse wie Anmeldungen.
- **Dein Anbieter für Bankdaten und dein KI-Anbieter**, wenn du Banksynchronisierung oder KI nutzt.

Die [Datenschutzerklärung](/privacy-policy) nennt auch die kleineren, etwa logo.dev für die Logos von Zahlungsempfängern, und was jeder davon bekommt.

## 5. Was schickt sie an die KI?

KI-Kategorisierung spart viel Tipparbeit, bedeutet aber, dass Transaktionsdetails die App verlassen. Frag, was gesendet wird, an wen und ob du deinen eigenen Anbieter nutzen kannst.

Mit Plus und während der Testphase schickt MoneyMatter jede neue Banktransaktion an die KI, mit Betrag, Währung, Datum, Kontoname, Notiz und Zahlungsempfänger, dazu deine Kategorienamen. Deine Salden werden nicht gesendet. Transaktionen, die du von Hand hinzufügst, werden nicht automatisch zur Kategorisierung gesendet. In Plus gibt es keinen einzelnen Schalter, der die automatische Kategorisierung ausschaltet.

Füge in den KI-Einstellungen deinen eigenen OpenAI-, Anthropic- oder Gemini-Schlüssel hinzu, dann nutzen die KI-Funktionen ihn stattdessen. Budgetvorschläge nutzen immer die eigene KI von MoneyMatter.

Wenn du Claude, ChatGPT oder einen anderen Assistenten mit deinen Daten verbindest, wählst du vor der Freigabe, ob er nur lesen oder auch Einträge erstellen, bearbeiten oder löschen darf. Du kannst den Zugriff jederzeit in den Einstellungen widerrufen.

## 6. Kannst du prüfen, was sie tut?

Eine geschlossene App verlangt, dass du ihrer Datenschutzerklärung vertraust. Bei einer Open-Source-App kann jeder den Code lesen und sehen, wie mit deinen Daten umgegangen wird.

MoneyMatter ist Open Source unter der Lizenz AGPL-3.0, und sein Code ist öffentlich auf GitHub. Es gibt kein veröffentlichtes Sicherheitsaudit oder Zertifikat von Dritten.

## 7. Wie meldest du dich an, und siehst du, wer angemeldet ist?

Eine sichere Anmeldung zählt mehr als Versprechen zur Verschlüsselung, denn die meisten Kontoübernahmen beginnen mit einem gestohlenen Passwort.

Bei MoneyMatter meldest du dich mit einem Passkey, Google, GitHub, Apple oder einem Passwort an und kannst mehrere davon gleichzeitig als Reserve behalten. Eine Zwei-Faktor-Authentifizierung gibt es nicht. Um dein Konto ohne sie zu schützen, melde dich mit einem Passkey an oder mit Google oder GitHub, wo deine eigenen Zwei-Faktor-Einstellungen gelten. Hat dein Konto zusätzlich ein Passwort, funktioniert dieses Passwort weiterhin.

Der Tab **Aktive Sitzungen** listet jeden angemeldeten Browser und jedes angemeldete Gerät mit IP-Adresse und dem Zeitpunkt der letzten Aktivität. Melde eine Sitzung ab, die dir verdächtig vorkommt, oder alle anderen Sitzungen auf einmal. Ein Zurücksetzen des Passworts meldet dich überall ab und trennt verbundene Apps, auch KI-Assistenten.

![Der Tab „Active Sessions“ mit der aktuellen Sitzung, markiert als „Current“, den anderen Geräten darunter und dem Button „Sign out of all other sessions“](/img/landing/screenshots/features/settings/active-sessions@2x.webp)

## 8. Kannst du deine Daten mitnehmen und gehen?

Eine App, die das Gehen schwer macht, hat weniger Grund, gut mit deinen Daten umzugehen. Prüfe, ob du alles exportieren und dein Konto löschen kannst, ohne jemandem eine E-Mail zu schreiben.

In MoneyMatter kannst du unter **Einstellungen**:

- **Export**: Transaktionen, Budgets, Abos und Investments als CSV, Excel oder JSON exportieren.
- **Sicherung herunterladen**: eine einzige ZIP-Datei mit einer vollständigen Kopie deiner Daten.
- **Alle Daten löschen** und mit demselben Login neu anfangen oder mit **Konto löschen** dein Konto samt allen Daten entfernen, beides im Tab **Gefahrenzone**. Beides ist endgültig.

Nachdem du dein Konto gelöscht hast, behält MoneyMatter einen Einweg-Hash deiner E-Mail-Adresse, damit ein neues Konto die kostenlose Testphase nicht erneut starten kann. Daten, die schon an Sentry und PostHog gesendet wurden, werden nicht automatisch entfernt, und du kannst ihre Löschung per E-Mail anfragen.

Wenn eine Testphase oder ein Abo endet, wird nichts gelöscht. Dein Konto wird schreibgeschützt, und du kannst dich weiterhin anmelden und einen Export herunterladen.

![Der Tab „Danger Zone“ mit dem Bereich „Wipe all data“ und dem Bereich „Delete your account“](/img/landing/screenshots/features/settings/danger-zone@2x.webp)

## Die Checkliste

| Frage                                   | Worauf du achten solltest                       | MoneyMatter                                     |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Womit verdient sie Geld?                | Du zahlst, nicht Werbekunden                    | Abonnements, keine Werbung                      |
| Wie verbindet sie sich mit deiner Bank? | Schreibgeschützt, kein Bankpasswort             | Schreibgeschützt, Zugangsdaten verschlüsselt    |
| Wer kann deine Transaktionen lesen?     | Eine klare Antwort                              | Der Server, keine Ende-zu-Ende-Verschlüsselung  |
| Welche Unternehmen sehen deine Daten?   | Eine Liste mit Namen                            | In der Datenschutzerklärung genannt             |
| Was geht an die KI?                     | Die Felder und dein eigener Anbieter als Option | Aufgelistet, eigener Schlüssel möglich          |
| Kannst du den Code prüfen?              | Open Source                                     | AGPL-3.0, kein Audit durch Dritte               |
| Wie meldest du dich an?                 | Passkeys oder Zwei-Faktor                       | Passkeys, kein Zwei-Faktor                      |
| Kannst du gehen?                        | Vollständiger Export, Löschung in Eigenregie    | Export, Sicherung, Löschen in den Einstellungen |

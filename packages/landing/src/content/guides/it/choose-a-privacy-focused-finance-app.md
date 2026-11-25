---
title: Come scegliere un'app di finanza personale attenta alla privacy
description: Otto domande da fare a qualsiasi app di finanza sui tuoi dati, con le risposte di MoneyMatter, compresi i punti in cui è carente.
published: 2026-11-25
related:
  - /features/security-and-privacy
  - /features/export-and-backup
  - /features/ai-categorization
docs:
  - label: Sicurezza e account
    href: https://docs.moneymatter.app/settings/security-and-account/
  - label: Funzioni IA
    href: https://docs.moneymatter.app/ai/ai-features/
  - label: Connessioni bancarie
    href: https://docs.moneymatter.app/import/bank-connections/
---

Un'app di finanza sa di te più della maggior parte delle app: dove fai acquisti, quanto guadagni, a chi paghi l'affitto. «Prendiamo sul serio la tua privacy» su una homepage non ti dice nulla. Le domande qui sotto sì.

Ognuna ha la risposta di MoneyMatter, comprese quelle in cui è carente, così puoi confrontarla in modo equo con qualsiasi altra app.

## 1. Come guadagna l'app?

I server costano, e in qualche modo il conto va pagato. Se un'app è gratuita e mostra pubblicità, o guadagna una commissione quando apri la carta o il prestito che ti consiglia, i dati delle tue spese fanno parte del modo in cui viene pagata.

MoneyMatter è pagato dagli abbonamenti. Non mostra pubblicità e non usa tracker di Google o Facebook.

## 2. Come si collega alla tua banca?

Cerca una connessione di sola lettura in cui accedi sul sito o sull'app della tua banca. Diffida di qualsiasi app che ti chiede la password della banca.

Le connessioni bancarie di MoneyMatter sono di sola lettura: possono vedere conti, saldi e transazioni, e non possono spostare denaro. La password della tua banca non viene mai salvata. Le chiavi e i token delle tue connessioni sono cifrati con AES-256-GCM, quindi una copia del solo database non li rivela. Puoi anche fare del tutto a meno della sincronizzazione bancaria e aggiungere le transazioni a mano o da file.

## 3. Chi può leggere le tue transazioni?

Chiedi se l'app usa la crittografia end-to-end. Se la usa, l'azienda non può leggere i tuoi dati, e i suoi server non possono nemmeno generare report o usare l'IA su di essi.

MoneyMatter non usa la crittografia end-to-end. Tutto il traffico passa per HTTPS, ma transazioni e saldi sono salvati in modo che il server possa leggerli e generare i tuoi report. Questo significa che chi gestisce il server può accedervi, e per MoneyMatter Cloud è MoneyMatter.

## 4. Quali altre aziende vedono i tuoi dati?

Ogni app si appoggia a qualche servizio esterno. Un'app affidabile li nomina e dice cosa riceve ciascuno. I principali di MoneyMatter:

- **Stripe** gestisce i pagamenti. Riceve i dati della tua carta, e MoneyMatter non riceve mai il numero della carta.
- **Resend** invia le email di accesso e quelle relative all'account.
- **Sentry** riceve le segnalazioni di crash, che includono la tua email. Una sessione con un errore può includere una riproduzione, con tutto il testo mascherato e i contenuti multimediali bloccati.
- **PostHog** riceve dati di analisi del prodotto collegati al tuo account e alla tua email. Gli account reali non hanno registrazione delle sessioni. Attiva Do Not Track nel browser per fermare i dati di analisi inviati dal browser. Il server registra comunque eventi come gli accessi.
- **Il tuo fornitore di dati bancari e il tuo fornitore di IA**, se usi la sincronizzazione bancaria o l'IA.

L'[informativa sulla privacy](/privacy-policy) elenca anche quelli minori, come logo.dev per i loghi dei beneficiari, con ciò che riceve ciascuno.

## 5. Cosa invia all'IA?

La classificazione IA ti risparmia molto lavoro di digitazione, ma significa che i dettagli delle transazioni escono dall'app. Chiedi cosa viene inviato, a chi, e se puoi usare un tuo fornitore.

Con Plus e durante la prova, MoneyMatter invia all'IA ogni nuova transazione bancaria con importo, valuta, data, nome del conto, nota e beneficiario, più i nomi delle tue categorie. I tuoi saldi non vengono inviati. Le transazioni che aggiungi a mano non vengono inviate automaticamente per la classificazione. Con Plus, nessun singolo interruttore disattiva la classificazione automatica.

Aggiungi la tua chiave OpenAI, Anthropic o Gemini nelle impostazioni IA, e le funzioni IA useranno quella. I suggerimenti per il budget usano sempre l'IA di MoneyMatter.

Se colleghi Claude, ChatGPT o un altro assistente ai tuoi dati, prima di approvare scegli se può solo leggere o anche creare, modificare o eliminare record. Puoi revocare l'accesso nelle impostazioni in qualsiasi momento.

## 6. Puoi verificare cosa fa?

Un'app chiusa ti chiede di fidarti della sua informativa sulla privacy. Con un'app open source, chiunque può leggere il codice e vedere come vengono trattati i tuoi dati.

MoneyMatter è open source con licenza AGPL-3.0, e il suo codice è pubblico su GitHub. Non ha un audit di sicurezza di terze parti pubblicato né una certificazione.

## 7. Come accedi, e puoi vedere chi ha effettuato l'accesso?

Un accesso sicuro conta più delle promesse sulla crittografia, perché la maggior parte dei furti di account inizia con una password rubata.

MoneyMatter ti permette di accedere con una passkey, Google, GitHub, Apple o una password, e di tenerne attivi diversi insieme come riserva. Non ha l'autenticazione a due fattori. Per proteggere il tuo account senza di essa, accedi con una passkey, oppure con Google o GitHub, dove valgono le tue impostazioni a due fattori. Se il tuo account ha anche una password, quella password continua a funzionare.

La scheda **Sessioni attive** elenca ogni browser e dispositivo collegato, con il suo indirizzo IP e l'ultima attività. Disconnetti quello che non ti convince, oppure tutte le altre sessioni insieme. Reimpostare la password ti disconnette ovunque e scollega le app connesse, compresi gli assistenti IA.

![La scheda Active Sessions con la sessione attuale contrassegnata come Current, gli altri dispositivi sotto e il pulsante Sign out of all other sessions](/img/landing/screenshots/features/settings/active-sessions@2x.webp)

## 8. Puoi portare via i tuoi dati e andartene?

Un'app che rende difficile andarsene ha meno motivi per trattare bene i tuoi dati. Verifica di poter esportare tutto ed eliminare il tuo account senza scrivere email a nessuno.

In MoneyMatter, in **Impostazioni** trovi:

- **Esportazione**: transazioni, budget, abbonamenti e investimenti in CSV, Excel o JSON.
- **Scarica backup**: un unico zip con una copia completa dei tuoi dati.
- **Cancella tutti i dati** per ricominciare con lo stesso accesso, o **Elimina il profilo** per eliminare l'account e tutti i suoi dati, dalla scheda **Zona pericolosa**. Entrambe le azioni sono definitive.

Dopo che hai eliminato l'account, MoneyMatter conserva un hash unidirezionale della tua email, così un nuovo account non può far ripartire la prova gratuita. I dati già inviati a Sentry e PostHog non vengono rimossi automaticamente, e puoi chiederne la rimozione via email.

Quando una prova o un abbonamento finisce non viene eliminato nulla. Il tuo account passa in sola lettura, e puoi comunque accedere e scaricare un'esportazione.

![La scheda Danger Zone con la sezione Wipe all data e la sezione Delete your account](/img/landing/screenshots/features/settings/danger-zone@2x.webp)

## La checklist

| Domanda                             | Cosa cercare                                     | MoneyMatter                                           |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Come guadagna?                      | Paghi tu, non gli inserzionisti                  | Abbonamenti, niente pubblicità                        |
| Come si collega alla tua banca?     | Sola lettura, nessuna password della banca       | Sola lettura, credenziali cifrate                     |
| Chi può leggere le tue transazioni? | Una risposta chiara                              | Il server sì, niente crittografia end-to-end          |
| Quali aziende vedono i tuoi dati?   | Un elenco con i nomi                             | Nominate nell'informativa sulla privacy               |
| Cosa va all'IA?                     | I campi, e un tuo fornitore come opzione         | Elencati, chiave propria supportata                   |
| Puoi verificare il codice?          | Open source                                      | AGPL-3.0, nessun audit di terze parti                 |
| Come accedi?                        | Passkey o due fattori                            | Passkey, niente due fattori                           |
| Puoi andartene?                     | Esportazione completa, eliminazione in autonomia | Esportazione, backup, eliminazione dalle impostazioni |

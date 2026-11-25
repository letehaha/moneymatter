---
title: Come usare l'open banking con un'app di budget nel Regno Unito e nell'UE
description: Collega banche britanniche ed europee a MoneyMatter con l'open banking, scegli tra Lunch Flow ed Enable Banking e mantieni attiva la connessione.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/security-and-privacy
  - /features/multi-currency
docs:
  - label: Connessioni bancarie
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Impostazioni generali
    href: https://docs.moneymatter.app/settings/general-settings/
  - label: Piani e fatturazione
    href: https://docs.moneymatter.app/settings/plans-and-billing/
---

Nel Regno Unito e nell'UE le banche devono permetterti di condividere i dati del tuo conto con le app che scegli. Questo è l'open banking. Approvi l'accesso sul sito o nell'app della tua banca, l'accesso è di sola lettura e scade dopo un periodo stabilito, a meno che tu non lo rinnovi.

Per un'app di budget significa che le transazioni arrivano da sole, senza esportazioni CSV né inserimenti a mano. Questa guida mostra come configurarlo in MoneyMatter e cosa aspettarti dopo.

## Cosa dà l'open banking a un'app, e cosa no

- **Può leggere** i tuoi conti, saldi e transazioni.
- **Non può spostare denaro.** Le connessioni bancarie di MoneyMatter sono di sola lettura.
- **Non vede mai la password della tua banca.** Accedi dalla tua banca, e MoneyMatter conserva solo i token di accesso e le chiavi, cifrati con AES-256-GCM.

## Due modi per collegarsi dal Regno Unito e dall'UE

La sincronizzazione bancaria fa parte del piano Plus, e la prova gratuita di 40 giorni la include, senza carta. Nel Regno Unito e nell'UE puoi collegarti tramite due fornitori.

**Lunch Flow** è la strada facile. Copre più di 20.000 banche nel Regno Unito, nell'UE e oltre. Apri un account Lunch Flow, ci colleghi le tue banche e incolli la sua chiave API in MoneyMatter. Lunch Flow fa pagare il proprio servizio, a parte rispetto al tuo piano MoneyMatter.

**Enable Banking** copre più di 6.000 banche nell'UE e nel Regno Unito e non costa nulla in più. Il problema è la configurazione: registri una tua applicazione per sviluppatori su Enable Banking e dai a MoneyMatter l'ID applicazione e la chiave privata. È in beta e va bene per chi si sente a proprio agio con le configurazioni tecniche.

In Polonia MoneyMatter può anche collegarsi direttamente ai tuoi portafogli valutari Walutomat, senza costi aggiuntivi.

![La finestra Add integration con i filtri per regione e un elenco di fornitori tra cui Lunch Flow, SimpleFIN, Akahu e Monobank, ciascuno con il proprio prezzo e la difficoltà di configurazione](/img/landing/screenshots/bank-providers@2x.webp)

## Collega la tua banca

1. Nella barra laterale apri **Conti** → **Tutti i conti**.
2. Nella sezione **Connessioni bancarie** clicca **Collega banca**.
3. Scegli la regione **EU & UK** e il tuo fornitore.
4. Con Lunch Flow, incolla la tua chiave API e clicca **Connetti**. Con Enable Banking, inserisci l'ID applicazione e la chiave privata, scegli il tuo paese e la tua banca e approva l'accesso presso la banca.
5. Scegli i conti che vuoi.

Con Enable Banking, completa la procedura nello stesso browser da cui l'hai iniziata, perché MoneyMatter ricorda lì la connessione in sospeso.

Hai già un conto che tieni a mano? Collega la banca senza quel conto, poi apri il conto e collegalo dalla sua scheda **Connessione dati**. Lo storico resta e la sincronizzazione prosegue da lì.

## Quanto storico ottieni

Con Enable Banking, la prima sincronizzazione carica tutto ciò che la tua banca consente, da 90 giorni fino a circa 3 anni a seconda della banca. Con Lunch Flow ottieni quello che Lunch Flow ha per il conto. Dopo di che, ogni sincronizzazione riparte dalla tua transazione più recente.

## Pagamenti con carta in sospeso

Alcune banche segnalano un pagamento con carta come in sospeso prima di registrarlo. Con Enable Banking, MoneyMatter salta i pagamenti in sospeso a meno che tu non attivi **Importazione delle transazioni bancarie in sospeso** in **Impostazioni** → **Generale**. Quando la banca registra il pagamento, la copia in sospeso viene unita a esso, così non compare due volte.

## Rinnova l'accesso prima che scada

L'accesso open banking dura un tempo limitato. Con Enable Banking, MoneyMatter chiede il periodo più lungo che la tua banca consente, oppure 90 giorni se la banca non lo indica. La pagina della connessione mostra quanti giorni di consenso restano.

Quando mancano 7 giorni o meno, la connessione mostra **In scadenza**. Una volta scaduta, mostra **Scaduta** e smette di sincronizzare. Per rinnovarla, apri la pagina della connessione, clicca **Ricollega ora** e approva di nuovo l'accesso presso la banca. I tuoi conti continuano a sincronizzarsi negli stessi conti MoneyMatter, con lo storico intatto.

## Conti in più valute

Molte persone in Europa hanno conti in più di una valuta, come un conto corrente in euro e un conto in sterline o dollari. MoneyMatter tiene ogni conto nella sua valuta e mostra i tuoi totali nella valuta base.

Quando sposti denaro tra due tuoi conti connessi nella stessa valuta, entrambi i lati arrivano dalle tue banche. MoneyMatter li collega come trasferimento quando trova esattamente una corrispondenza con lo stesso importo in direzione opposta entro 3 giorni, così lo spostamento non conta come spesa. Un cambio tra due valute di solito richiede il tuo aiuto: apri la transazione, seleziona la scheda **Trasferimento** e collega tu l'altro lato.

---
title: Come gestire il denaro in più valute
description: Configura conti in più valute, registra bene cambi e pagamenti con carta in valuta estera e scopri perché il patrimonio netto cambia anche se i report no.
published: 2026-10-31
related:
  - /features/multi-currency
  - /features/transfers-and-refunds
  - /features/net-worth-tracker
docs:
  - label: Valuta base e valute
    href: https://docs.moneymatter.app/settings/base-currency-and-currencies/
  - label: Come funzionano i trasferimenti
    href: https://docs.moneymatter.app/transfers-and-refunds/how-transfers-work/
  - label: Come si calcolano le statistiche
    href: https://docs.moneymatter.app/stats/how-stats-are-calculated/
---

Mettiamo che tu guadagni in EUR, tenga i risparmi in USD e paghi l'affitto in PLN. Puoi leggere ogni saldo per conto suo, ma vuoi comunque sapere quanto hai in totale e perché quel totale è cambiato in un giorno in cui non hai fatto nulla.

MoneyMatter risponde a entrambe le domande se configuri i conti e registri i cambi di valuta come mostra questa guida.

## Scegli la valuta base al momento della registrazione

MoneyMatter mostra ogni totale nella tua valuta base: la bacheca, le statistiche, i report e i totali dei gruppi di conti. Scegli la valuta in cui confronti i prezzi, di solito quella in cui spendi di più.

La schermata **Selezionare la valuta di base** compare subito dopo la registrazione. Parte da USD, quindi controllala prima di cliccare **Conferma valuta**.

Alla registrazione puoi scegliere qualsiasi valuta. In seguito potrai passare solo a una valuta con uno storico dei tassi di lungo periodo, come USD, EUR, GBP, PLN, UAH, CHF, JPY, CAD o AUD.

## Crea un conto per ogni valuta

Crea un conto MoneyMatter per ogni conto reale, nella valuta che contiene. Il campo **Valuta** elenca solo le valute che hai aggiunto. Per aggiungerne un'altra, scorri fino in fondo all'elenco e clicca **Aggiungi nuova valuta +**.

Controlla la valuta prima di salvare. Non potrai cambiarla in seguito, quindi se è sbagliata dovrai creare un nuovo conto.

Per un conto bancario che contiene più valute, come Revolut, crea un conto per valuta: «Revolut EUR» e «Revolut USD». Mettili in un gruppo di conti e la barra laterale mostrerà il loro totale combinato nella tua valuta base.

Le importazioni CSV seguono la stessa regola. Se un nome di conto ha righe in due valute, l'importazione si interrompe con un errore, quindi prima separa quelle righe in nomi di conto diversi nel file.

## Inserisci l'importo uscito dal conto

Ogni transazione usa la valuta del suo conto. Inserisci l'importo uscito da quel conto e MoneyMatter lo converte nella tua valuta base.

- **Paghi 50 USD dal tuo conto in USD.** Inserisci 50 in quel conto.
- **Paghi 50 USD con la tua carta in EUR.** Inserisci nel conto in EUR l'importo in EUR che ti ha addebitato la banca. Per tenere nota dei 50 USD, scrivili in **Importo originale**. Quel campo non influisce sulle statistiche.

Per controllare le conversioni, passa la pagina delle transazioni a **Vista tabella** e guarda la colonna **Importo in valuta di base**.

## Registra i cambi di valuta come trasferimenti

Mettiamo che tu sposti 500 USD su una carta in EUR e arrivino 460 EUR. Se lo registri come una spesa e un'entrata, gonfi sia il totale delle spese sia quello delle entrate. Registra invece un trasferimento:

1. Clicca **Aggiungi transazione** e seleziona la scheda **Trasferimento**.
2. Inserisci 500 in **Importo** e scegli il conto in USD in **Conto di origine**.
3. Scegli la carta in EUR in **Conto di destinazione** e inserisci 460 in **Importo di destinazione**.
4. Clicca **Crea**.

Qui MoneyMatter non suggerisce un tasso. Lo determinano i tuoi due importi, così la registrazione corrisponde a quanto ti hanno applicato la banca o il servizio di cambio.

Le connessioni bancarie (piano Plus) richiedono un passaggio in più. MoneyMatter può collegare per te i trasferimenti nella stessa valuta tra conti connessi, ma i cambi tra valute diverse li colleghi tu. Finché non lo fai, i due lati contano come spesa ed entrata. Apri la transazione importata e seleziona la scheda **Trasferimento**. Se l'altro lato è già registrato, usa **Collega l'altro lato**. Se non lo è, scegli l'altro conto.

## Perché il patrimonio netto cambia anche se non spendi nulla

MoneyMatter usa un tasso diverso per ogni tipo di numero:

- **Le transazioni mantengono il tasso della loro data.** Se paghi 50 USD il 3 marzo con EUR come valuta base, MoneyMatter salva l'importo base al tasso di quel giorno. Il report del mese scorso mostra oggi gli stessi numeri che mostrava il mese scorso.
- **I saldi attuali usano il tasso più recente.** I tassi si aggiornano una volta al giorno, alle 18:00 UTC.
- **I grafici dei saldi usano il tasso di ogni giorno.** Il grafico calcola il valore di ciò che avevi in un dato giorno al tasso di quel giorno.

Mettiamo che la tua valuta base sia EUR e che tu abbia 1.000 USD. Se il tasso scende da 0,92 a 0,90, il tuo patrimonio netto cala di 20 EUR senza alcuna transazione dietro.

Per lo stesso motivo, se hai valuta estera, le entrate meno le spese di un mese di solito non corrispondono alla variazione del patrimonio netto. Il report mostra quanto hai speso in quel momento. Il grafico mostra quanto valeva il tuo denaro quel giorno.

## Usa un tasso personalizzato solo se vuoi un tasso fisso

Il tasso della tua banca raramente coincide con quello di mercato, quindi potresti voler inserire il tuo. Vai in **Impostazioni** → **Valute**, espandi la riga della valuta, deseleziona **Aggiornamento in tempo reale**, scrivi il tasso in uno dei due campi e clicca **Salva**.

![Una riga PLN espansa nella pagina Currencies, con Live update deselezionato, un tasso personalizzato di 0.25 inserito e il pulsante Save](/img/landing/screenshots/features/settings/custom-exchange-rate@2x.webp)

Hai un solo tasso per valuta, senza alcuna data associata:

- Le nuove transazioni e ogni transazione che modifichi e salvi lo usano, anche se datate l'anno scorso. Le transazioni già salvate mantengono i loro importi base finché non le modifichi.
- I saldi passano a questo tasso appena salvi. Per i conti gestiti manualmente, MoneyMatter ridisegna anche l'intero storico del saldo a quel tasso, quindi il grafico smette di seguire il mercato per quella valuta.

Io lascerei **Aggiornamento in tempo reale** attivo per la maggior parte delle valute. Non puoi impostare un tasso per singolo pagamento, e un trasferimento registra già il tasso reale di ogni cambio. Per tornare indietro, seleziona di nuovo **Aggiornamento in tempo reale** e clicca **Salva**.

## Se cambi paese

Quando cambia la valuta in cui ragioni, cambia la valuta base e mantieni i tuoi dati. Vai in **Impostazioni** → **Valute** e aggiungi la nuova valuta se non è in elenco. Poi espandi la sua riga, clicca **Imposta come valuta di base** e conferma.

MoneyMatter ricalcola ogni transazione al tasso di mercato della sua data e converte i saldi al tasso di oggi. Gli importi originali restano come li hai inseriti. Prima di iniziare:

- **Metti in conto qualche minuto.** Tieni aperta la scheda. Finché non termina, non puoi aggiungere né modificare nulla che riguardi gli importi, da nessun dispositivo.
- **Interrompi prima la condivisione.** MoneyMatter blocca la modifica finché condividi dei conti o fai parte di un nucleo familiare.
- **Preparati a reimpostare i tassi personalizzati.** Li hai impostati rispetto alla vecchia valuta base, quindi la maggior parte di quelle valute torna su **In tempo reale**. Reimposta il tuo tasso se lo vuoi ancora.
- **Fallo una volta sola, se puoi.** Passare avanti e indietro può lasciare i totali convertiti diversi di qualche centesimo rispetto a quelli di partenza.

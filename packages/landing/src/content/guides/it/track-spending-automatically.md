---
title: Come tracciare le tue spese in automatico
description: Collega la banca, lascia che beneficiari, regole e IA classifichino ogni transazione e tieni traccia delle spese con cinque minuti di revisione a settimana.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/automation-rules
  - /features/ai-categorization
docs:
  - label: Connessioni bancarie
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Beneficiari
    href: https://docs.moneymatter.app/transactions/payees/
  - label: Funzioni IA
    href: https://docs.moneymatter.app/ai/ai-features/
---

Molte persone smettono di tracciare le spese per lo stesso motivo: dopo un mese stanca dover inserire ogni caffè a mano. Il tracciamento automatico elimina questa fatica. Le transazioni arrivano da sole, ognuna riceve un beneficiario e una categoria, e a te resta solo una breve revisione una volta a settimana.

MoneyMatter lo fa su tre livelli. La sincronizzazione bancaria porta dentro le transazioni. I beneficiari e le regole classificano quelle che vedi ogni mese. L'IA classifica tutte le altre.

## Collega la tua banca

La sincronizzazione bancaria fa parte del piano Plus, e la prova gratuita di 40 giorni la include, senza carta. MoneyMatter si collega tramite alcuni fornitori, a seconda di dove hai la banca:

- **Lunch Flow** copre più di 20.000 banche in USA, Canada, UE, Regno Unito, Australia e Nuova Zelanda.
- **SimpleFIN** copre USA e Canada.
- **Akahu** copre la maggior parte delle banche neozelandesi, e **Monobank** si collega direttamente in Ucraina.

Lunch Flow e SimpleFIN fanno pagare il proprio servizio, a parte rispetto al tuo piano MoneyMatter. Akahu e Monobank non hanno costi aggiuntivi.

Per collegare la banca:

1. Nella barra laterale apri **Conti** → **Tutti i conti**.
2. Nella sezione **Connessioni bancarie** clicca **Collega banca**.
3. Scegli la tua regione e il fornitore, incolla la chiave del fornitore e clicca **Connetti**.
4. Scegli i conti che vuoi.

La connessione è di sola lettura. MoneyMatter può vedere conti, saldi e transazioni, ma non può spostare denaro, e la password della tua banca non viene mai salvata.

![Una pagina di connessione bancaria con il saldo totale, il numero di conti collegati, la sincronizzazione automatica ogni 12 ore, l'ora dell'ultima sincronizzazione, il pulsante Sync now e il menu Manage aperto](/img/landing/screenshots/features/import/bank-connection-details@2x.webp)

Se tieni già traccia di un conto a mano, non devi ricominciare da capo. Collega la banca senza quel conto, poi apri il conto e collegalo dalla sua scheda **Connessione dati**. Lo storico resta e la sincronizzazione prosegue da lì.

## Scegli quando sincronizzare

MoneyMatter sincronizza i tuoi conti collegati due volte al giorno, a due orari che scegli tu in **Impostazioni** → **Generale**. Imposta un orario al mattino presto e la spesa di ieri sarà già lì quando controlli il budget. Anche aprire l'app può avviare una sincronizzazione, e il pulsante con la nuvola nell'intestazione ti permette di sincronizzare subito.

## Lascia che i beneficiari gestiscano i negozi che frequenti ogni settimana

MoneyMatter legge il nome dell'esercente su ogni transazione sincronizzata e lo collega a un beneficiario. Per impostazione predefinita, quando due transazioni condividono un nuovo nome, crea il beneficiario per te. Grafie simili come «LIDL 1234» e «LIDL SAGT DANKE» vengono salvate come alias dello stesso beneficiario.

Dai a un beneficiario una **Categoria predefinita** una volta sola, e ogni nuova transazione che lo riguarda riceve quella categoria. L'impostazione **Classificazione IA** decide quanto è rigido questo comportamento:

- **Usa sempre la categoria del beneficiario** va bene per un negozio in cui compri sempre lo stesso tipo di cose, come il supermercato.
- **Usa come suggerimento** va bene per un negozio che vende di tutto, come un grande negozio online. Prima viene inserita la categoria del beneficiario, e l'IA può sostituirla in base ai dettagli della transazione.

Un beneficiario può anche aggiungere etichette alle sue transazioni, come un'etichetta **Household** per la spesa condivisa.

![La pagina di un beneficiario con il numero di transazioni, il flusso netto e la categoria principale, la sezione Categorization con una categoria predefinita e la classificazione IA impostata su Always use payee category, e due alias](/img/landing/screenshots/features/transactions/payee-detail-page@2x.webp)

## Scrivi regole per ciò che puoi descrivere con precisione

I beneficiari funzionano per esercente. Una regola funziona su tutto ciò che puoi descrivere: il testo dell'esercente, l'importo, il conto o il giorno del mese. Per esempio:

- Il testo dell'esercente contiene «uber» o «bolt»: imposta la categoria su Trasporti.
- L'importo è esattamente 1.200 e il giorno va dall'1 al 5: imposta la categoria su Affitto e il beneficiario sul tuo padrone di casa.
- Il conto è la tua carta condivisa: aggiungi l'etichetta Household.

Per crearne una, apri **Transazioni** → **Automazioni** nella barra laterale. Una regola può impostare categoria, etichette, beneficiario o nota, e viene eseguita su ogni nuova transazione che arriva dalla sincronizzazione bancaria e dalle importazioni di file. Le regole sono incluse in ogni piano.

![Il modulo Edit automation per una regola Monthly rent, con le condizioni su nota, tipo di transazione, importo e conto, le azioni imposta categoria e imposta beneficiario e una sezione Preview](/img/landing/screenshots/features/automations/automation-form@2x.webp)

Una nuova regola non modifica da sola le transazioni passate. Per sistemare anche quelle, applica la regola salvata, spunta nell'elenco di revisione le corrispondenze che vuoi e conferma.

## Lascia che l'IA classifichi tutto il resto

Le nuove transazioni che escono dalla sincronizzazione bancaria senza categoria vanno all'IA pochi secondi dopo il loro arrivo. L'IA sceglie dal tuo elenco di categorie, quindi il risultato si adatta al modo in cui già gestisci il budget.

L'IA vede importo, valuta, data, nome del conto, nota e beneficiario di ogni transazione, più i nomi delle tue categorie. I tuoi saldi non vengono inviati. Non sovrascrive mai una categoria che hai impostato a mano o che è stata impostata da una regola.

L'IA non impara dalle tue correzioni. Quando correggi lo stesso errore due volte, imposta una categoria predefinita su quel beneficiario o scrivi una regola, e l'errore non si ripresenta più.

Plus include l'IA di MoneyMatter con un limite mensile, e lo stesso vale per la prova gratuita. Con Essential, la classificazione IA funziona con la tua chiave OpenAI, Anthropic o Gemini.

![La scheda AI Features delle impostazioni IA, con il contatore Included AI usage in alto e l'elenco delle funzioni, ciascuna con il modello che la alimenta](/img/landing/screenshots/features/ai/ai-features-tab@2x.webp)

## Quale prevale

Quando più di un livello potrebbe impostare una categoria, MoneyMatter segue quest'ordine:

1. Un abbonamento corrispondente imposta la categoria per primo.
2. Poi viene una regola, che prevale sulla categoria predefinita di un beneficiario.
3. L'IA classifica ciò che resta.

Metti la tua conoscenza più specifica nelle regole e nei beneficiari, e lascia all'IA i casi rari.

## I trasferimenti tra i tuoi conti non sono spesa

Quando sposti denaro dal conto corrente ai risparmi, entrambi i lati arrivano dalla banca. Se contassero come spesa ed entrata, i due totali sembrerebbero più grandi di quello che sono.

MoneyMatter li collega per te. Quando una transazione sincronizzata ha esattamente una corrispondenza su un altro conto collegato, con lo stesso importo e la stessa valuta in direzione opposta entro 3 giorni, la coppia diventa un trasferimento ed esce dalle statistiche di spesa. Un cambio tra due valute di solito richiede il tuo aiuto: apri la transazione, seleziona la scheda **Trasferimento** e collega tu l'altro lato.

## Rivedi la tua settimana in cinque minuti

Automatico non significa che non guardi mai. Una volta a settimana apri **Transazioni** e dai un'occhiata alle nuove:

- Correggi tutto ciò che è finito nella categoria sbagliata.
- Guarda cosa è ancora nella tua categoria predefinita, di solito **Altro**.
- Quando fai la stessa correzione una seconda volta, trasformala in una categoria predefinita del beneficiario o in una regola.

Ogni correzione che trasformi in regola è una che non farai mai più, quindi l'elenco si accorcia ogni settimana.

## Se la tua banca non è supportata

Puoi comunque evitare di inserire tutto a mano. Importa un file CSV, OFX o QFX dalla tua banca, oppure carica un estratto conto in PDF e lascia che l'IA ne estragga le transazioni. Beneficiari e regole funzionano anche sulle transazioni importate. Anche le transazioni di un estratto conto in PDF passano alla classificazione IA, mentre per un file CSV puoi avviarla tu da **Transazioni** → **Ottimizzazioni**. Con Essential, che non ha la sincronizzazione bancaria, è così che le regole ricevono le loro transazioni.

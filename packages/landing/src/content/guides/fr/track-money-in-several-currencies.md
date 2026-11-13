---
title: Comment suivre votre argent dans plusieurs devises
description: Créez un compte par devise, enregistrez bien le change et les paiements à l'étranger, et voyez pourquoi votre patrimoine net varie alors que vos rapports, non.
published: 2026-10-31
related:
  - /features/multi-currency
  - /features/transfers-and-refunds
  - /features/net-worth-tracker
docs:
  - label: Devise principale et devises
    href: https://docs.moneymatter.app/settings/base-currency-and-currencies/
  - label: Fonctionnement des virements
    href: https://docs.moneymatter.app/transfers-and-refunds/how-transfers-work/
  - label: Calcul des statistiques
    href: https://docs.moneymatter.app/stats/how-stats-are-calculated/
---

Imaginons que vous soyez payé en EUR, que votre épargne soit en USD et votre loyer en PLN. Vous pouvez lire chaque solde séparément, mais vous voulez quand même savoir combien vous avez au total, et pourquoi ce total a changé un jour où vous n'avez rien fait.

MoneyMatter répond à ces deux questions si vous configurez vos comptes et enregistrez vos opérations de change comme le montre ce guide.

## Choisissez votre devise principale à l'inscription

MoneyMatter affiche tous les totaux dans votre devise principale : le tableau de bord, les statistiques, les rapports et les totaux des groupes de comptes. Choisissez la devise dans laquelle vous comparez les prix, en général celle dans laquelle vous dépensez le plus.

L'écran **Sélectionner la devise principale** s'affiche juste après l'inscription. Il propose USD par défaut : vérifiez-le avant de cliquer sur **Confirmer la devise**.

À l'inscription, vous pouvez choisir n'importe quelle devise. Par la suite, vous ne pourrez passer qu'à une devise disposant d'un long historique de taux, comme USD, EUR, GBP, PLN, UAH, CHF, JPY, CAD ou AUD.

## Créez un compte par devise

Créez un compte MoneyMatter pour chaque compte réel, dans la devise qu'il détient. Le champ **Devise** ne liste que les devises que vous avez ajoutées. Pour en ajouter une, faites défiler la liste jusqu'en bas et cliquez sur **Ajouter une devise +**.

Vérifiez la devise avant d'enregistrer. Vous ne pourrez plus la modifier ensuite : une erreur vous obligera à créer un nouveau compte.

Pour un compte bancaire multidevise, comme Revolut, créez un compte par devise : « Revolut EUR » et « Revolut USD ». Placez-les dans un groupe de comptes, et la barre latérale affichera leur total cumulé dans votre devise principale.

Les imports CSV suivent la même règle. Si un même nom de compte comporte des lignes dans deux devises, l'import s'arrête sur une erreur : répartissez d'abord ces lignes sous des noms de compte distincts dans le fichier.

## Saisissez ce qui est sorti du compte

Chaque opération utilise la devise de son compte. Saisissez le montant qui est sorti de ce compte, et MoneyMatter le convertit dans votre devise principale.

- **Vous payez 50 USD depuis votre compte en USD.** Saisissez 50 dans ce compte.
- **Vous payez 50 USD avec votre carte en EUR.** Saisissez le montant en EUR débité par votre banque, dans le compte en EUR. Pour garder une trace des 50 USD, indiquez-les dans **Montant d'origine**. Ce champ n'a aucun effet sur vos statistiques.

Pour vérifier les conversions, passez la page des opérations en **Vue tableau** et regardez la colonne **Montant de base**.

## Enregistrez les opérations de change comme des virements

Imaginons que vous transfériez 500 USD vers une carte en EUR et que 460 EUR arrivent. Si vous enregistrez cela comme une dépense et un revenu, vous gonflez à la fois vos totaux de dépenses et de revenus. Enregistrez plutôt un virement :

1. Cliquez sur **Ajouter une opération** et sélectionnez l'onglet **Virement**.
2. Saisissez 500 dans **Montant** et choisissez le compte en USD dans **Depuis le compte**.
3. Choisissez la carte en EUR dans **Vers le compte** et saisissez 460 dans **Montant cible**.
4. Cliquez sur **Créer**.

MoneyMatter ne propose pas de taux ici. Ce sont vos deux montants qui le fixent, si bien que l'enregistrement correspond à ce que votre banque ou votre bureau de change a facturé.

Les connexions bancaires (offre Plus) demandent une étape de plus. MoneyMatter peut lier pour vous les virements dans une même devise entre comptes connectés, mais les opérations de change entre devises, c'est à vous de les lier. Tant que vous ne l'avez pas fait, les deux côtés comptent comme une dépense et un revenu. Ouvrez l'opération importée et sélectionnez l'onglet **Virement**. Si l'autre côté est déjà enregistré, utilisez **Lier l'autre opération**. Sinon, choisissez l'autre compte.

## Pourquoi votre patrimoine net bouge alors que vous ne dépensez rien

MoneyMatter utilise un taux différent pour chaque type de chiffre :

- **Les opérations gardent le taux de leur propre date.** Payez 50 USD le 3 mars avec l'EUR comme devise principale, et MoneyMatter enregistre le montant de base au taux de ce jour-là. Le rapport du mois dernier affiche aujourd'hui les mêmes chiffres que le mois dernier.
- **Les soldes actuels utilisent le dernier taux.** Les taux sont mis à jour une fois par jour, à 18 h 00 UTC.
- **Les graphiques de solde utilisent le taux de chaque jour.** Le graphique valorise ce que vous déteniez un jour donné au taux de ce jour-là.

Imaginons que votre devise principale soit l'EUR et que vous déteniez 1 000 USD. Si le taux passe de 0,92 à 0,90, votre patrimoine net baisse de 20 EUR sans aucune opération derrière.

Pour la même raison, quand vous détenez des devises étrangères, les revenus moins les dépenses d'un mois ne correspondent généralement pas à la variation de votre patrimoine net. Le rapport montre ce que vous avez dépensé à ce moment-là. Le graphique montre ce que valait votre argent ce jour-là.

## N'utilisez un taux personnalisé que si vous voulez un taux fixe

Le taux de votre banque correspond rarement au taux du marché, et vous voudrez peut-être saisir le vôtre. Allez dans **Paramètres** → **Devises**, dépliez la ligne de la devise, décochez **Actualisation en direct**, saisissez le taux dans l'un ou l'autre champ et cliquez sur **Enregistrer**.

![Une ligne PLN dépliée sur la page « Currencies », avec « Live update » décoché, un taux personnalisé de 0.25 saisi et le bouton « Save »](/img/landing/screenshots/features/settings/custom-exchange-rate@2x.webp)

Vous obtenez un seul taux par devise, sans date associée :

- Les nouvelles opérations, ainsi que toute opération que vous modifiez et enregistrez, l'utilisent, même si elles datent de l'an dernier. Les opérations déjà enregistrées gardent leur montant de base jusqu'à ce que vous les modifiiez.
- Les soldes passent à ce taux dès que vous enregistrez. Pour les comptes suivis manuellement, MoneyMatter recalcule aussi tout l'historique du solde à ce taux, si bien que le graphique cesse de suivre le marché pour cette devise.

Je vous conseille de laisser **Actualisation en direct** activé pour la plupart des devises. Vous ne pouvez pas définir de taux par paiement, et un virement enregistre déjà le taux réel de chaque opération de change. Pour revenir en arrière, cochez à nouveau **Actualisation en direct** et cliquez sur **Enregistrer**.

## Si vous changez de pays

Quand la devise dans laquelle vous raisonnez change, changez votre devise principale et conservez vos données. Allez dans **Paramètres** → **Devises** et ajoutez la nouvelle devise si elle n'est pas dans la liste. Dépliez ensuite sa ligne, cliquez sur **Définir comme devise principale** et confirmez.

MoneyMatter recalcule chaque opération au taux du marché de sa date et convertit les soldes au taux du jour. Vos montants d'origine restent tels que vous les avez saisis. Avant de commencer :

- **Prévoyez quelques minutes.** Gardez l'onglet ouvert. Tant que l'opération n'est pas terminée, vous ne pouvez rien ajouter ni modifier qui implique des montants, sur aucun appareil.
- **Arrêtez d'abord le partage.** MoneyMatter bloque le changement tant que vous partagez des comptes ou faites partie d'un foyer.
- **Attendez-vous à refaire vos taux personnalisés.** Vous les avez définis par rapport à votre ancienne devise principale, donc la plupart de ces devises repassent en **En direct**. Redéfinissez votre taux si vous le voulez toujours.
- **Faites-le une seule fois si possible.** Des changements dans un sens puis dans l'autre peuvent décaler les totaux convertis de quelques centimes par rapport à leur valeur de départ.

---
title: Comment suivre vos dépenses automatiquement
description: Connectez votre banque, laissez les tiers, les règles et l'IA trier chaque opération, et suivez vos dépenses avec cinq minutes de revue par semaine.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/automation-rules
  - /features/ai-categorization
docs:
  - label: Connexions bancaires
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Tiers
    href: https://docs.moneymatter.app/transactions/payees/
  - label: Fonctions d'IA
    href: https://docs.moneymatter.app/ai/ai-features/
---

La plupart des gens arrêtent de suivre leurs dépenses pour la même raison : saisir chaque café finit par lasser en moins d'un mois. Le suivi automatique supprime la saisie. Vos opérations arrivent toutes seules, chacune reçoit un tiers et une catégorie, et votre part se réduit à une courte revue par semaine.

MoneyMatter procède en trois couches. La synchronisation bancaire fait entrer les opérations. Les tiers et les règles trient celles que vous voyez chaque mois. L'IA trie le reste.

## Connectez votre banque

La synchronisation bancaire fait partie de l'offre Plus, et l'essai gratuit de 40 jours l'inclut, sans carte bancaire. MoneyMatter se connecte via plusieurs fournisseurs, selon l'endroit où vous avez votre banque :

- **Lunch Flow** couvre plus de 20 000 banques aux États-Unis, au Canada, dans l'UE, au Royaume-Uni, en Australie et en Nouvelle-Zélande.
- **SimpleFIN** couvre les États-Unis et le Canada.
- **Akahu** couvre la plupart des banques néo-zélandaises, et **Monobank** se connecte directement en Ukraine.

Lunch Flow et SimpleFIN facturent leur propre service, séparément de votre offre MoneyMatter. Akahu et Monobank n'ajoutent aucun coût.

Pour vous connecter :

1. Dans la barre latérale, ouvrez **Comptes** → **Tous les comptes**.
2. Dans la section **Connexions bancaires**, cliquez sur **Connecter une banque**.
3. Choisissez votre région et votre fournisseur, collez la clé fournie par votre fournisseur et cliquez sur **Connecter**.
4. Choisissez les comptes que vous voulez.

La connexion est en lecture seule. MoneyMatter peut voir les comptes, les soldes et les opérations, mais il ne peut pas déplacer d'argent, et le mot de passe de votre banque n'est jamais stocké.

![Une page de connexion bancaire avec le solde total, le nombre de comptes connectés, la synchronisation automatique toutes les 12 heures, l'heure de la dernière synchronisation, un bouton « Sync now » et le menu « Manage » ouvert](/img/landing/screenshots/features/import/bank-connection-details@2x.webp)

Si vous suivez déjà un compte à la main, inutile de repartir de zéro. Connectez la banque sans ce compte, puis ouvrez le compte et liez-le depuis son onglet **Connexion bancaire**. Votre historique reste en place, et la synchronisation continue à partir de là.

## Choisissez quand synchroniser

MoneyMatter synchronise vos comptes connectés deux fois par jour, aux deux heures que vous choisissez dans **Paramètres** → **Général**. Réglez-en une tôt le matin, et les dépenses de la veille sont là quand vous consultez votre budget. Ouvrir l'application peut aussi lancer une synchronisation, et le bouton en forme de nuage dans l'en-tête permet de synchroniser tout de suite.

## Laissez les tiers gérer les commerces que vous fréquentez chaque semaine

MoneyMatter lit le nom du commerçant sur chaque opération synchronisée et le relie à un tiers. Par défaut, dès que deux opérations partagent un nouveau nom, il crée le tiers pour vous. Les graphies proches, comme « LIDL 1234 » et « LIDL SAGT DANKE », sont enregistrées comme alias du même tiers.

Donnez une **Catégorie par défaut** à un tiers une fois, et chaque nouvelle opération qui en provient reçoit cette catégorie. Son paramètre **Catégorisation par IA** détermine le degré de rigueur :

- **Toujours utiliser la catégorie du tiers** convient à un commerce où vous achetez toujours le même type de chose, comme votre supermarché.
- **Utiliser comme suggestion** convient à un commerce qui vend de tout, comme une grande boutique en ligne. La catégorie du tiers est appliquée en premier, et l'IA peut la remplacer d'après les détails de l'opération.

Un tiers peut aussi ajouter des étiquettes à ses opérations, par exemple une étiquette **Foyer** pour vos courses partagées.

![La page d'un tiers avec son nombre d'opérations, son flux net et sa catégorie principale, la section « Categorization » avec une catégorie par défaut et la catégorisation par IA réglée sur « Always use payee category », et deux alias](/img/landing/screenshots/features/transactions/payee-detail-page@2x.webp)

## Écrivez des règles pour ce que vous pouvez décrire précisément

Les tiers fonctionnent par commerçant. Une règle s'applique à tout ce que vous pouvez décrire : le texte du commerçant, le montant, le compte ou le jour du mois. Par exemple :

- Le texte du commerçant contient « uber » ou « bolt » : définir la catégorie sur Transport.
- Le montant est exactement 1 200 et le jour est compris entre 1 et 5 : définir la catégorie sur Loyer et le tiers sur votre propriétaire.
- Le compte est votre carte partagée : ajouter l'étiquette Foyer.

Pour en créer une, ouvrez **Opérations** → **Automatisations** dans la barre latérale. Une règle peut définir la catégorie, les étiquettes, le tiers ou la note, et elle s'exécute sur chaque nouvelle opération issue de la synchronisation bancaire et des imports de fichiers. Les règles sont incluses dans toutes les offres.

![Le formulaire « Edit automation » d'une règle « Monthly rent », avec des conditions sur la note, le type d'opération, le montant et le compte, des actions pour définir la catégorie et le tiers, et une section « Preview »](/img/landing/screenshots/features/automations/automation-form@2x.webp)

Une nouvelle règle ne modifie pas d'elle-même vos opérations passées. Pour les mettre à jour, appliquez la règle enregistrée, cochez les correspondances voulues dans la liste de revue et confirmez.

## Laissez l'IA catégoriser tout le reste

Les nouvelles opérations issues de la synchronisation bancaire qui n'ont pas de catégorie sont envoyées à l'IA quelques secondes après leur arrivée. Elle choisit dans votre propre liste de catégories, si bien que le résultat colle à votre façon de budgéter.

L'IA voit le montant, la devise, la date, le nom du compte, la note et le tiers de chaque opération, ainsi que les noms de vos catégories. Vos soldes ne sont pas envoyés. Elle n'écrase jamais une catégorie que vous avez définie à la main, ni une catégorie définie par une règle.

L'IA n'apprend pas de vos corrections. Quand vous corrigez deux fois la même erreur, définissez une catégorie par défaut sur ce tiers ou écrivez une règle, et l'erreur disparaît définitivement.

L'offre Plus inclut l'IA de MoneyMatter avec un quota mensuel, et l'essai aussi. Avec Essential, la catégorisation par IA fonctionne avec votre propre clé OpenAI, Anthropic ou Gemini.

![L'onglet « AI Features » des paramètres d'IA, avec la jauge « Included AI usage » en haut et la liste des fonctions, chacune avec le modèle qui l'alimente](/img/landing/screenshots/features/ai/ai-features-tab@2x.webp)

## Qui l'emporte

Quand plusieurs couches peuvent définir une catégorie, MoneyMatter applique cet ordre :

1. Un paiement récurrent correspondant définit la catégorie en premier.
2. Une règle vient ensuite, et l'emporte sur la catégorie par défaut d'un tiers.
3. L'IA catégorise tout ce qui reste.

Mettez vos connaissances les plus précises dans les règles et les tiers, et laissez la longue traîne à l'IA.

## Les virements entre vos comptes ne sont pas des dépenses

Quand vous déplacez de l'argent de votre compte courant vers votre épargne, les deux côtés arrivent de votre banque. S'ils comptaient comme une dépense et un revenu, les deux totaux paraîtraient plus élevés qu'ils ne le sont.

MoneyMatter les lie pour vous. Quand une opération synchronisée a exactement une correspondance sur un autre compte connecté, avec le même montant et la même devise en sens inverse à moins de 3 jours d'écart, la paire devient un virement et sort de vos statistiques de dépenses. Un change entre deux devises demande généralement votre aide : ouvrez l'opération, sélectionnez l'onglet **Virement** et liez vous-même l'autre côté.

## Passez votre semaine en revue en cinq minutes

Automatique ne veut pas dire que vous ne regardez jamais. Une fois par semaine, ouvrez **Opérations** et parcourez les nouvelles :

- Corrigez tout ce qui est tombé dans la mauvaise catégorie.
- Regardez ce qui est encore dans votre catégorie par défaut, en général **Autre**.
- Quand vous faites une deuxième fois la même correction, transformez-la en catégorie par défaut d'un tiers ou en règle.

Chaque correction transformée en règle est une correction que vous ne referez plus, donc la liste raccourcit chaque semaine.

## Si votre banque n'est pas prise en charge

Vous pouvez quand même vous passer de la saisie. Importez un fichier CSV, OFX ou QFX de votre banque, ou chargez un relevé PDF et laissez l'IA en extraire les opérations. Les tiers et les règles fonctionnent aussi sur les opérations importées. Les opérations d'un relevé PDF passent aussi par la catégorisation par IA, et pour un fichier CSV vous pouvez la lancer vous-même depuis **Opérations** → **Optimisations**. Avec Essential, qui n'inclut pas la synchronisation bancaire, c'est ainsi que les règles reçoivent leurs opérations.

---
title: Comment utiliser l'open banking avec une appli de budget au Royaume-Uni et dans l'UE
description: Connectez des banques britanniques et européennes à MoneyMatter via l'open banking, choisissez entre Lunch Flow et Enable Banking et gardez la connexion active.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/security-and-privacy
  - /features/multi-currency
docs:
  - label: Connexions bancaires
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Paramètres généraux
    href: https://docs.moneymatter.app/settings/general-settings/
  - label: Offres et facturation
    href: https://docs.moneymatter.app/settings/plans-and-billing/
---

Au Royaume-Uni et dans l'UE, les banques doivent vous laisser partager les données de vos comptes avec les applications de votre choix. C'est l'open banking. Vous approuvez l'accès sur le site ou l'appli de votre banque, l'accès est en lecture seule, et il expire au bout d'un certain temps si vous ne le renouvelez pas.

Pour une appli de budget, cela signifie que vos opérations arrivent toutes seules, sans export CSV ni saisie. Ce guide montre comment le configurer dans MoneyMatter et à quoi vous attendre ensuite.

## Ce que l'open banking donne à une appli, et ce qu'il ne donne pas

- **Elle peut lire** vos comptes, vos soldes et vos opérations.
- **Elle ne peut pas déplacer d'argent.** Les connexions bancaires de MoneyMatter sont en lecture seule.
- **Elle ne voit jamais le mot de passe de votre banque.** Vous vous connectez chez votre banque, et MoneyMatter ne conserve que les jetons d'accès et les clés, chiffrés avec AES-256-GCM.

## Deux façons de se connecter depuis le Royaume-Uni et l'UE

La synchronisation bancaire fait partie de l'offre Plus, et l'essai gratuit de 40 jours l'inclut, sans carte bancaire. Au Royaume-Uni et dans l'UE, vous pouvez vous connecter via deux fournisseurs.

**Lunch Flow** est la voie facile. Il couvre plus de 20 000 banques au Royaume-Uni, dans l'UE et ailleurs. Vous ouvrez un compte Lunch Flow, vous y reliez vos banques et vous collez sa clé d'API dans MoneyMatter. Lunch Flow facture son propre service, séparément de votre offre MoneyMatter.

**Enable Banking** couvre plus de 6 000 banques dans l'UE et au Royaume-Uni, sans aucun coût supplémentaire. Le revers, c'est la configuration : vous enregistrez votre propre application de développeur chez Enable Banking et vous donnez à MoneyMatter son identifiant d'application et sa clé privée. Il est en version bêta et convient aux personnes à l'aise avec une configuration technique.

En Pologne, MoneyMatter peut aussi se connecter directement à vos portefeuilles de devises Walutomat, sans coût supplémentaire.

![La boîte de dialogue Ajouter une intégration avec des filtres par région et une liste de fournisseurs dont Lunch Flow, SimpleFIN, Akahu et Monobank, chacun avec son prix et sa difficulté de configuration](/img/landing/screenshots/bank-providers@2x.webp)

## Connectez votre banque

1. Dans la barre latérale, ouvrez **Comptes** → **Tous les comptes**.
2. Dans la section **Connexions bancaires**, cliquez sur **Connecter une banque**.
3. Choisissez la région **UE et Royaume-Uni** et sélectionnez votre fournisseur.
4. Avec Lunch Flow, collez votre clé d'API et cliquez sur **Connecter**. Avec Enable Banking, saisissez votre identifiant d'application et votre clé privée, choisissez votre pays et votre banque, puis approuvez l'accès chez votre banque.
5. Choisissez les comptes que vous voulez.

Avec Enable Banking, terminez dans le même navigateur que celui où vous avez commencé, car MoneyMatter y garde en mémoire la connexion en attente.

Vous suivez déjà un compte à la main ? Connectez la banque sans ce compte, puis ouvrez le compte et liez-le depuis son onglet **Connexion bancaire**. Votre historique reste en place, et la synchronisation continue à partir de là.

## Quelle profondeur d'historique vous obtenez

Avec Enable Banking, la première synchronisation charge autant que votre banque le permet, de 90 jours jusqu'à environ 3 ans selon la banque. Avec Lunch Flow, vous obtenez ce que Lunch Flow détient pour le compte. Ensuite, chaque synchronisation reprend à partir de votre opération la plus récente.

## Les paiements par carte en attente

Certaines banques signalent un paiement par carte comme étant en attente avant qu'il ne soit comptabilisé. Avec Enable Banking, MoneyMatter ignore les paiements en attente, sauf si vous activez **Importer les opérations bancaires en attente** dans **Paramètres** → **Général**. Quand la banque comptabilise un paiement, la copie en attente est fusionnée avec lui, pour qu'il n'apparaisse pas en double.

## Renouvelez l'accès avant qu'il n'expire

L'accès open banking dure un temps limité. Avec Enable Banking, MoneyMatter demande la plus longue période que votre banque autorise, ou 90 jours si la banque ne le précise pas. La page de la connexion indique combien de jours de consentement il reste.

Quand il reste 7 jours ou moins, la connexion affiche **Expire bientôt**. Une fois expirée, elle affiche **Expirée** et cesse de se synchroniser. Pour la renouveler, ouvrez la page de la connexion, cliquez sur **Reconnecter maintenant** et approuvez de nouveau l'accès chez votre banque. Vos comptes continuent à se synchroniser dans les mêmes comptes MoneyMatter, avec leur historique intact.

## Des comptes dans plusieurs devises

Beaucoup de gens en Europe détiennent des comptes dans plusieurs devises, par exemple un compte courant en euros et un compte en livres ou en dollars. MoneyMatter garde chaque compte dans sa propre devise et affiche vos totaux dans votre devise principale.

Quand vous déplacez de l'argent entre deux de vos comptes connectés dans la même devise, les deux côtés arrivent de vos banques. MoneyMatter les lie comme un virement quand il trouve exactement une correspondance avec le même montant en sens inverse à moins de 3 jours d'écart, si bien que ce mouvement ne compte pas comme une dépense. Un change entre deux devises demande généralement votre aide : ouvrez l'opération, sélectionnez l'onglet **Virement** et liez vous-même l'autre côté.

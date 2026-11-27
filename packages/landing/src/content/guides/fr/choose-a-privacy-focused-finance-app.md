---
title: Comment choisir une appli de finances personnelles respectueuse de la vie privée
description: Huit questions à poser à toute appli de finances sur vos données, avec les réponses de MoneyMatter, y compris là où il a ses limites.
published: 2026-11-25
related:
  - /features/security-and-privacy
  - /features/export-and-backup
  - /features/ai-categorization
docs:
  - label: Sécurité et compte
    href: https://docs.moneymatter.app/settings/security-and-account/
  - label: Fonctions d'IA
    href: https://docs.moneymatter.app/ai/ai-features/
  - label: Connexions bancaires
    href: https://docs.moneymatter.app/import/bank-connections/
---

Une appli de finances en sait plus sur vous que la plupart des applis : où vous faites vos achats, ce que vous gagnez, à qui vous payez votre loyer. « Nous prenons votre vie privée au sérieux » sur une page d'accueil ne vous apprend rien. Les questions ci-dessous, si.

Chacune est accompagnée de la réponse de MoneyMatter, y compris celles où il a ses limites, pour que vous puissiez le comparer honnêtement à n'importe quelle autre appli.

## 1. Comment l'appli gagne-t-elle de l'argent ?

Les serveurs coûtent de l'argent, et la facture est payée d'une manière ou d'une autre. Si une appli est gratuite et affiche des publicités, ou touche une commission quand vous ouvrez la carte ou le prêt qu'elle recommande, vos données de dépenses font partie de ce qui la rémunère.

MoneyMatter est financé par les abonnements. Il n'affiche aucune publicité et n'utilise aucun traceur Google ou Facebook.

## 2. Comment se connecte-t-elle à votre banque ?

Cherchez une connexion en lecture seule où vous vous identifiez sur le site ou l'appli de votre banque. Méfiez-vous de toute appli qui demande le mot de passe de votre banque.

Les connexions bancaires de MoneyMatter sont en lecture seule : elles peuvent voir les comptes, les soldes et les opérations, et ne peuvent pas déplacer d'argent. Le mot de passe de votre banque n'est jamais stocké. Les clés et les jetons de vos connexions sont chiffrés avec AES-256-GCM, donc une simple copie de la base de données ne les révèle pas. Vous pouvez aussi vous passer complètement de la synchronisation bancaire et ajouter les opérations à la main ou depuis des fichiers.

## 3. Qui peut lire vos opérations ?

Demandez si l'appli est chiffrée de bout en bout. Si c'est le cas, l'entreprise ne peut pas lire vos données, et ses serveurs ne peuvent pas non plus produire de rapports ni faire tourner l'IA dessus.

MoneyMatter n'est pas chiffré de bout en bout. Tout le trafic passe par HTTPS, mais les opérations et les soldes sont stockés de façon à ce que le serveur puisse les lire et produire vos rapports. Cela signifie que celui qui gère le serveur peut y accéder, et pour MoneyMatter Cloud, c'est MoneyMatter.

## 4. Quelles autres entreprises voient vos données ?

Toute appli s'appuie sur des services externes. Une appli digne de confiance les nomme et dit ce que chacun reçoit. Les principaux de MoneyMatter :

- **Stripe** gère les paiements. Il reçoit les données de votre carte, et MoneyMatter ne reçoit jamais le numéro de carte.
- **Resend** envoie les e-mails de connexion et de compte.
- **Sentry** reçoit les rapports de plantage, qui incluent votre e-mail. Une session avec une erreur peut inclure un replay, avec tout le texte masqué et les médias bloqués.
- **PostHog** reçoit des statistiques d'usage liées à votre compte et à votre e-mail. Les vrais comptes n'ont pas d'enregistrement de session. Activez Do Not Track dans votre navigateur pour arrêter les statistiques que votre navigateur envoie. Le serveur enregistre quand même des événements comme les connexions.
- **Votre fournisseur de données bancaires et votre fournisseur d'IA**, si vous utilisez la synchronisation bancaire ou l'IA.

La [politique de confidentialité](/privacy-policy) liste aussi les plus petits, comme logo.dev pour les logos des tiers, avec ce que chacun reçoit.

## 5. Qu'envoie-t-elle à l'IA ?

La catégorisation par IA évite beaucoup de saisie, mais elle implique que les détails des opérations quittent l'appli. Demandez ce qui est envoyé, à qui, et si vous pouvez utiliser votre propre fournisseur.

Avec Plus et pendant l'essai, MoneyMatter envoie chaque nouvelle opération bancaire à l'IA avec son montant, sa devise, sa date, le nom du compte, la note et le tiers, ainsi que les noms de vos catégories. Vos soldes ne sont pas envoyés. Les opérations que vous ajoutez à la main ne sont pas envoyées automatiquement pour être catégorisées. Avec Plus, aucun réglage unique ne désactive la catégorisation automatique.

Ajoutez votre propre clé OpenAI, Anthropic ou Gemini dans les paramètres de l'IA, et les fonctions d'IA l'utilisent à la place. Les suggestions de budget utilisent toujours l'IA de MoneyMatter.

Si vous connectez Claude, ChatGPT ou un autre assistant à vos données, vous choisissez avant d'approuver s'il peut seulement lire, ou aussi créer, modifier ou supprimer des enregistrements. Vous pouvez révoquer son accès dans les paramètres à tout moment.

## 6. Pouvez-vous vérifier ce qu'elle fait ?

Une appli fermée vous demande de faire confiance à sa politique de confidentialité. Avec une appli open source, n'importe qui peut lire le code et voir comment vos données sont traitées.

MoneyMatter est open source sous licence AGPL-3.0, et son code est public sur GitHub. Il n'a publié aucun audit de sécurité ni aucune certification par un tiers.

## 7. Comment vous connectez-vous, et pouvez-vous voir qui est connecté ?

Une connexion solide compte plus que les promesses de chiffrement, car la plupart des prises de contrôle de compte commencent par un mot de passe volé.

MoneyMatter vous permet de vous connecter avec une clé d'accès, Google, GitHub, Apple ou un mot de passe, et d'en garder plusieurs à la fois en secours. Il n'a pas d'authentification à deux facteurs. Pour protéger votre compte sans elle, connectez-vous avec une clé d'accès, ou avec Google ou GitHub, où vos propres réglages d'authentification à deux facteurs s'appliquent. Si votre compte a aussi un mot de passe, ce mot de passe fonctionne toujours.

L'onglet **Sessions actives** liste chaque navigateur et chaque appareil connecté, avec son adresse IP et sa dernière activité. Déconnectez celui qui vous semble suspect, ou toutes les autres sessions d'un coup. Une réinitialisation du mot de passe vous déconnecte partout et déconnecte les applis connectées, y compris les assistants IA.

![L'onglet « Active sessions » avec la session actuelle marquée « Current », les autres appareils en dessous et le bouton « Sign out of all other sessions »](/img/landing/screenshots/features/settings/active-sessions@2x.webp)

## 8. Pouvez-vous récupérer vos données et partir ?

Une appli qui rend le départ difficile a moins de raisons de bien traiter vos données. Vérifiez que vous pouvez tout exporter et supprimer votre compte sans écrire à personne.

Dans MoneyMatter, depuis **Paramètres**, vous pouvez :

- **Exporter** les opérations, les budgets, les abonnements et les investissements en CSV, Excel ou JSON.
- **Télécharger une sauvegarde**, un seul fichier zip contenant une copie complète de vos données.
- **Effacer toutes les données** et repartir de zéro avec le même identifiant, ou **Supprimer votre compte** et toutes ses données, depuis l'onglet **Zone de danger**. Ces deux actions sont définitives.

Après la suppression de votre compte, MoneyMatter conserve une empreinte irréversible de votre e-mail pour qu'un nouveau compte ne puisse pas relancer l'essai gratuit. Les données déjà envoyées à Sentry et PostHog ne sont pas supprimées automatiquement, et vous pouvez demander leur suppression par e-mail.

Rien n'est supprimé à la fin d'un essai ou d'un abonnement. Votre compte passe en lecture seule, et vous pouvez toujours vous connecter et télécharger un export.

![L'onglet « Danger zone » avec la section « Wipe all data » et la section « Delete your account »](/img/landing/screenshots/features/settings/danger-zone@2x.webp)

## La liste de vérification

| Question                                    | Ce qu'il faut chercher                            | MoneyMatter                                           |
| ------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Comment gagne-t-elle de l'argent ?          | Vous payez, pas les annonceurs                    | Abonnements, pas de publicité                         |
| Comment se connecte-t-elle à votre banque ? | Lecture seule, sans mot de passe bancaire         | Lecture seule, identifiants chiffrés                  |
| Qui peut lire vos opérations ?              | Une réponse claire                                | Le serveur, pas de chiffrement de bout en bout        |
| Quelles entreprises voient vos données ?    | Une liste nominative                              | Nommées dans la politique de confidentialité          |
| Qu'est-ce qui part vers l'IA ?              | Les champs, et votre propre fournisseur en option | Listés, clé personnelle prise en charge               |
| Pouvez-vous vérifier le code ?              | Open source                                       | AGPL-3.0, pas d'audit tiers                           |
| Comment vous connectez-vous ?               | Clés d'accès ou authentification à deux facteurs  | Clés d'accès, pas d'authentification à deux facteurs  |
| Pouvez-vous partir ?                        | Export complet, suppression en libre-service      | Export, sauvegarde, suppression depuis les paramètres |

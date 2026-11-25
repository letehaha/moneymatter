---
title: Como usar o open banking com um app de orçamento no Reino Unido e na UE
description: Conecte bancos do Reino Unido e da Europa ao MoneyMatter pelo open banking, escolha entre Lunch Flow e Enable Banking e mantenha a conexão ativa.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/security-and-privacy
  - /features/multi-currency
docs:
  - label: Conexões bancárias
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Configurações gerais
    href: https://docs.moneymatter.app/settings/general-settings/
  - label: Planos e cobrança
    href: https://docs.moneymatter.app/settings/plans-and-billing/
---

No Reino Unido e na UE, os bancos precisam permitir que você compartilhe os dados da sua conta com os apps que escolher. Isso é o open banking. Você aprova o acesso no site ou no app do próprio banco, o acesso é somente leitura e expira depois de um tempo definido, a menos que você o renove.

Para um app de orçamento, isso significa que suas transações chegam sozinhas, sem exportar CSV nem digitar. Este guia mostra como configurar isso no MoneyMatter e o que esperar depois.

## O que o open banking dá a um app, e o que não dá

- **Ele pode ler** suas contas, saldos e transações.
- **Ele não pode movimentar dinheiro.** As conexões bancárias do MoneyMatter são somente leitura.
- **Ele nunca vê a senha do seu banco.** Você faz login no seu banco, e o MoneyMatter guarda apenas os tokens de acesso e as chaves, criptografados com AES-256-GCM.

## Duas formas de conectar no Reino Unido e na UE

A sincronização bancária faz parte do plano Plus, e o teste grátis de 40 dias a inclui, sem precisar de cartão. No Reino Unido e na UE, você pode se conectar por dois provedores.

O **Lunch Flow** é o caminho mais fácil. Ele cobre mais de 20.000 bancos no Reino Unido, na UE e em outras regiões. Você abre uma conta no Lunch Flow, vincula seus bancos lá e cola a chave de API dele no MoneyMatter. O Lunch Flow cobra pelo próprio serviço, separadamente do seu plano do MoneyMatter.

O **Enable Banking** cobre mais de 6.000 bancos na UE e no Reino Unido e não tem custo extra. O porém é a configuração: você registra seu próprio aplicativo de desenvolvedor no Enable Banking e fornece ao MoneyMatter o ID do aplicativo e a chave privada. Ele está em beta e serve para quem se sente à vontade com configurações técnicas.

Na Polônia, o MoneyMatter também pode se conectar diretamente às suas carteiras de moedas do Walutomat, sem custo extra.

![A caixa de diálogo Adicionar integração com filtros de região e uma lista de provedores, incluindo Lunch Flow, SimpleFIN, Akahu e Monobank, cada um com o preço e a dificuldade de configuração](/img/landing/screenshots/bank-providers@2x.webp)

## Conecte seu banco

1. Na barra lateral, abra **Contas** → **Todas as contas**.
2. Na seção **Conexões bancárias**, clique em **Conectar banco**.
3. Escolha a região **UE e Reino Unido** e o seu provedor.
4. Com o Lunch Flow, cole sua chave de API e clique em **Conectar**. Com o Enable Banking, digite o ID do aplicativo e a chave privada, escolha seu país e seu banco e aprove o acesso no banco.
5. Escolha as contas que você quer.

Com o Enable Banking, termine no mesmo navegador em que começou, porque o MoneyMatter lembra da conexão pendente nele.

Já controla uma conta manualmente? Conecte o banco sem essa conta, depois abra a conta e vincule-a na aba **Conexão de dados**. Seu histórico continua, e a sincronização segue a partir dele.

## Quanto histórico você recebe

Com o Enable Banking, a primeira sincronização carrega o máximo que seu banco permitir, de 90 dias a cerca de 3 anos, dependendo do banco. Com o Lunch Flow, você recebe o que o Lunch Flow tiver da conta. Depois disso, cada sincronização continua a partir da sua transação mais recente.

## Pagamentos pendentes no cartão

Alguns bancos informam um pagamento no cartão como pendente antes de ele ser lançado. Com o Enable Banking, o MoneyMatter ignora pagamentos pendentes, a menos que você ative **Importar transações bancárias pendentes** em **Configurações** → **Geral**. Quando o banco lança o pagamento, a cópia pendente é mesclada a ele, então ele não aparece duas vezes.

## Renove o acesso antes que ele expire

O acesso do open banking dura um tempo limitado. Com o Enable Banking, o MoneyMatter pede o maior período que seu banco permitir, ou 90 dias se o banco não informar. A página da conexão mostra quantos dias de consentimento restam.

Quando faltam 7 dias ou menos, a conexão mostra **Expira em breve**. Depois que ela expira, mostra **Expirada** e para de sincronizar. Para renovar, abra a página da conexão, clique em **Reconectar agora** e aprove o acesso no banco de novo. Suas contas continuam sincronizando nas mesmas contas do MoneyMatter, com o histórico intacto.

## Contas em várias moedas

Muita gente na Europa tem contas em mais de uma moeda, como uma conta corrente em euros e outra em libras ou dólares. O MoneyMatter mantém cada conta na própria moeda e mostra seus totais na sua moeda base.

Quando você move dinheiro entre duas contas conectadas na mesma moeda, os dois lados chegam dos seus bancos. O MoneyMatter os vincula como uma transferência quando encontra exatamente uma correspondência com o mesmo valor em sentido oposto dentro de 3 dias, para que a movimentação não conte como gasto. Um câmbio entre duas moedas geralmente precisa da sua ajuda: abra a transação, selecione a aba **Transferência** e vincule você mesmo o outro lado.

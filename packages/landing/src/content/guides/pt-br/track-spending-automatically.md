---
title: Como controlar seus gastos automaticamente
description: Conecte seu banco, deixe favorecidos, regras e IA classificarem cada transação e controle seus gastos com cinco minutos de revisão por semana, sem digitar.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/automation-rules
  - /features/ai-categorization
docs:
  - label: Conexões bancárias
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Favorecidos
    href: https://docs.moneymatter.app/transactions/payees/
  - label: Recursos de IA
    href: https://docs.moneymatter.app/ai/ai-features/
---

A maioria das pessoas para de controlar os gastos pelo mesmo motivo: digitar cada cafezinho cansa em menos de um mês. O controle automático elimina a digitação. Suas transações chegam sozinhas, cada uma recebe um favorecido e uma categoria, e a sua parte se resume a uma revisão rápida uma vez por semana.

O MoneyMatter faz isso em três camadas. A sincronização bancária traz as transações. Favorecidos e regras classificam as que aparecem todo mês. A IA classifica o restante.

## Conecte seu banco

A sincronização bancária faz parte do plano Plus, e o teste grátis de 40 dias a inclui, sem precisar de cartão. O MoneyMatter se conecta por meio de alguns provedores, dependendo de onde você tem conta:

- **Lunch Flow** cobre mais de 20.000 bancos nos EUA, no Canadá, na UE, no Reino Unido, na Austrália e na Nova Zelândia.
- **SimpleFIN** cobre os EUA e o Canadá.
- **Akahu** cobre a maioria dos bancos da Nova Zelândia, e o **Monobank** se conecta diretamente na Ucrânia.

O Lunch Flow e o SimpleFIN cobram pelo próprio serviço, separadamente do seu plano do MoneyMatter. O Akahu e o Monobank não têm custo extra.

Para conectar:

1. Na barra lateral, abra **Contas** → **Todas as contas**.
2. Na seção **Conexões bancárias**, clique em **Conectar banco**.
3. Escolha sua região e o provedor, cole a chave do seu provedor e clique em **Conectar**.
4. Escolha as contas que você quer.

A conexão é somente leitura. O MoneyMatter consegue ver contas, saldos e transações, mas não consegue movimentar dinheiro, e a senha do seu banco nunca é armazenada.

![Página de uma conexão bancária com o saldo total, o número de contas conectadas, a sincronização automática a cada 12 horas, o horário da última sincronização, um botão “Sync now” e o menu “Manage” aberto](/img/landing/screenshots/features/import/bank-connection-details@2x.webp)

Se você já controla uma conta manualmente, não precisa recomeçar. Conecte o banco sem essa conta, depois abra a conta e vincule-a na aba **Conexão de dados**. Seu histórico continua, e a sincronização segue a partir dele.

## Escolha quando sincronizar

O MoneyMatter sincroniza suas contas conectadas duas vezes por dia, nos dois horários que você escolhe em **Configurações** → **Geral**. Defina um para o início da manhã, e os gastos de ontem já estarão lá quando você olhar seu orçamento. Abrir o app também pode iniciar uma sincronização, e o botão de nuvem no cabeçalho permite sincronizar na hora.

## Deixe os favorecidos cuidarem das lojas que você visita toda semana

O MoneyMatter lê o nome do estabelecimento em cada transação sincronizada e o vincula a um favorecido. Por padrão, quando duas transações compartilham um nome novo, ele cria o favorecido para você. Grafias parecidas, como “LIDL 1234” e “LIDL SAGT DANKE”, são salvas como nomes alternativos do mesmo favorecido.

Defina uma **Categoria padrão** para um favorecido uma única vez, e toda nova transação dele recebe essa categoria. A configuração **Categorização por IA** dele decide o quanto isso é rígido:

- **Sempre usar a categoria do favorecido** serve para uma loja em que você sempre compra o mesmo tipo de coisa, como o seu supermercado.
- **Usar como sugestão** serve para uma loja que vende de tudo, como uma grande loja online. A categoria do favorecido entra primeiro, e a IA pode trocá-la com base nos detalhes da transação.

Um favorecido também pode adicionar tags às suas transações, como uma tag **Casa** para as compras de mercado compartilhadas.

![Página de um favorecido com o número de transações, o fluxo líquido e a categoria mais usada, a seção “Categorization” com uma categoria padrão e “AI categorization” definida como “Always use payee category”, e dois nomes alternativos](/img/landing/screenshots/features/transactions/payee-detail-page@2x.webp)

## Crie regras para o que você consegue descrever com exatidão

Os favorecidos funcionam por estabelecimento. Uma regra funciona com qualquer coisa que você consiga descrever: o texto do estabelecimento, o valor, a conta ou o dia do mês. Por exemplo:

- O texto do estabelecimento contém “uber” ou “bolt”: defina a categoria como Transporte.
- O valor é exatamente 1.200 e o dia é de 1 a 5: defina a categoria como Aluguel e o favorecido como seu locador.
- A conta é o seu cartão compartilhado: adicione a tag Casa.

Para criar uma, abra **Transações** → **Automações** na barra lateral. Uma regra pode definir a categoria, as tags, o favorecido ou a anotação, e roda em cada nova transação vinda da sincronização bancária e das importações de arquivo. As regras estão incluídas em todos os planos.

![O formulário “Edit automation” de uma regra “Monthly rent”, com condições de anotação, tipo de transação, valor e conta, ações de definir categoria e definir favorecido, e uma seção “Preview”](/img/landing/screenshots/features/automations/automation-form@2x.webp)

Uma regra nova não altera suas transações passadas por conta própria. Para organizá-las, aplique a regra salva, marque as correspondências que você quer na lista de revisão e confirme.

## Deixe a IA categorizar todo o resto

As novas transações que saem da sincronização bancária sem categoria vão para a IA alguns segundos depois de chegarem. Ela escolhe na sua própria lista de categorias, então o resultado se encaixa na forma como você já faz seu orçamento.

A IA vê o valor, a moeda, a data, o nome da conta, a anotação e o favorecido de cada transação, além dos nomes das suas categorias. Seus saldos não são enviados. Ela nunca sobrescreve uma categoria que você definiu manualmente nem uma definida por uma regra.

A IA não aprende com as suas correções. Quando você corrigir o mesmo erro duas vezes, defina uma categoria padrão para esse favorecido ou crie uma regra, e o erro deixa de acontecer de vez.

O Plus inclui a IA do MoneyMatter com uma cota mensal, e o teste grátis também. No Essential, a categorização por IA roda com a sua própria chave da OpenAI, da Anthropic ou do Gemini.

![A aba “AI Features” de “AI Settings”, com o medidor “Included AI usage” no topo e a lista de recursos, cada um com o modelo que o alimenta](/img/landing/screenshots/features/ai/ai-features-tab@2x.webp)

## Qual camada vence

Quando mais de uma camada puder definir uma categoria, o MoneyMatter usa esta ordem:

1. Uma assinatura correspondente define a categoria primeiro.
2. Uma regra vem em seguida e prevalece sobre a categoria padrão de um favorecido.
3. A IA categoriza tudo o que ainda sobrar.

Coloque o seu conhecimento mais específico em regras e favorecidos, e deixe para a IA a cauda longa.

## Transferências entre suas contas não são gasto

Quando você move dinheiro da conta corrente para a poupança, os dois lados chegam do seu banco. Se eles contassem como gasto e receita, os dois totais pareceriam maiores do que realmente são.

O MoneyMatter vincula os dois lados para você. Quando uma transação sincronizada tem exatamente uma correspondência em outra conta conectada, com o mesmo valor e a mesma moeda em sentido oposto dentro de 3 dias, o par vira uma transferência e sai das suas estatísticas de gastos. Um câmbio entre duas moedas geralmente precisa da sua ajuda: abra a transação, selecione a aba **Transferência** e vincule você mesmo o outro lado.

## Revise sua semana em cinco minutos

Automático não significa que você nunca olha. Uma vez por semana, abra **Transações** e dê uma olhada nas novas:

- Corrija o que caiu na categoria errada.
- Veja o que ainda está na sua categoria padrão, geralmente **Outros**.
- Quando fizer a mesma correção pela segunda vez, transforme-a em um padrão de favorecido ou em uma regra.

Cada correção que você transforma em regra é uma que você nunca mais faz, então a lista fica mais curta a cada semana.

## Se o seu banco não for compatível

Você ainda pode pular a digitação. Importe um arquivo CSV, OFX ou QFX do seu banco, ou envie um extrato em PDF e deixe a IA extrair as transações. Favorecidos e regras também funcionam em transações importadas. As transações de um extrato em PDF também vão para a categorização por IA, e, em um arquivo CSV, você pode executá-la por conta própria em **Transações** → **Otimizações**. No Essential, que não tem sincronização bancária, é assim que as regras recebem as transações.

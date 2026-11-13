---
title: Como controlar seu dinheiro em várias moedas
description: Crie contas em várias moedas, registre câmbios e compras no cartão em moeda estrangeira e entenda por que o patrimônio muda quando os relatórios não mudam.
published: 2026-10-31
related:
  - /features/multi-currency
  - /features/transfers-and-refunds
  - /features/net-worth-tracker
docs:
  - label: Moeda base e moedas
    href: https://docs.moneymatter.app/settings/base-currency-and-currencies/
  - label: Como funcionam as transferências
    href: https://docs.moneymatter.app/transfers-and-refunds/how-transfers-work/
  - label: Como as estatísticas são calculadas
    href: https://docs.moneymatter.app/stats/how-stats-are-calculated/
---

Digamos que você receba em EUR, guarde suas economias em USD e pague o aluguel em PLN. Dá para ver cada saldo separadamente, mas você ainda quer saber quanto tem no total — e por que esse total mudou num dia em que você não fez nada.

O MoneyMatter responde às duas perguntas se você configurar suas contas e registrar os câmbios do jeito que este guia mostra.

## Escolha sua moeda base no cadastro

O MoneyMatter mostra todos os totais na sua moeda base: o painel, as estatísticas, os relatórios e os totais dos grupos de contas. Escolha a moeda em que você compara preços, geralmente aquela em que você mais gasta.

A tela **Escolha a moeda base** aparece logo depois do cadastro. Ela começa em USD, então confira antes de clicar em **Confirmar moeda**.

No cadastro, você pode escolher qualquer moeda. Depois, só é possível mudar para uma moeda com histórico de taxas de câmbio de longo prazo, como USD, EUR, GBP, PLN, UAH, CHF, JPY, CAD ou AUD.

## Crie uma conta por moeda

Crie uma conta no MoneyMatter para cada conta real, na moeda que ela guarda. O campo **Moeda** lista só as moedas que você adicionou. Para adicionar outra, role até o fim da lista e clique em **Adicionar nova moeda +**.

Confira a moeda antes de salvar. Não é possível alterá-la depois, então uma moeda errada significa criar uma conta nova.

Para uma conta bancária que guarda várias moedas, como a Revolut, crie uma conta por moeda: “Revolut EUR” e “Revolut USD”. Coloque as duas em um grupo de contas, e a barra lateral mostra o total combinado delas na sua moeda base.

Importações de CSV seguem a mesma regra. Se um nome de conta tiver linhas em duas moedas, a importação é interrompida com um erro. Por isso, separe antes essas linhas em nomes de conta diferentes no arquivo.

## Informe o que saiu da conta

Cada transação usa a moeda da sua conta. Informe o valor que saiu daquela conta, e o MoneyMatter o converte para sua moeda base.

- **Você paga 50 USD com sua conta em USD.** Informe 50 nessa conta.
- **Você paga 50 USD com seu cartão em EUR.** Informe o valor em EUR que o banco cobrou, na conta em EUR. Para guardar uma anotação dos 50 USD, coloque-os em **Valor original**. Esse campo não afeta suas estatísticas.

Para conferir as conversões, mude a página de transações para **Visualização em tabela** e veja a coluna **Valor na moeda base**.

## Registre câmbios como transferências

Digamos que você envie 500 USD para um cartão em EUR e cheguem 460 EUR. Se registrar isso como uma despesa e uma receita, você infla tanto o total de gastos quanto o de receitas. Registre uma transferência:

1. Clique em **Adicionar transação** e selecione a aba **Transferência**.
2. Informe 500 em **Valor** e escolha a conta em USD em **Conta de origem**.
3. Escolha o cartão em EUR em **Conta de destino** e informe 460 em **Valor de destino**.
4. Clique em **Criar**.

O MoneyMatter não sugere uma taxa aqui. Seus dois valores a definem, então o registro corresponde ao que seu banco ou casa de câmbio cobrou.

Conexões bancárias (plano Plus) exigem um passo a mais. O MoneyMatter pode vincular para você as transferências na mesma moeda entre contas conectadas, mas os câmbios entre moedas você mesmo vincula. Até fazer isso, os dois lados contam como gasto e receita. Abra a transação importada e selecione a aba **Transferência**. Se o outro lado já estiver registrado, use **Vincular o outro lado**. Se não estiver, escolha a outra conta.

## Por que seu patrimônio líquido muda quando você não gasta nada

O MoneyMatter usa uma taxa diferente para cada tipo de número:

- **Transações mantêm a taxa da própria data.** Pague 50 USD em 3 de março com EUR como moeda base, e o MoneyMatter salva o valor na moeda base pela taxa daquele dia. O relatório do mês passado mostra hoje os mesmos números que mostrava no mês passado.
- **Saldos atuais usam a taxa mais recente.** As taxas são atualizadas uma vez por dia, às 18:00 UTC.
- **Gráficos de saldo usam a taxa de cada dia.** O gráfico avalia o que você tinha em determinado dia pela taxa daquele dia.

Digamos que sua moeda base seja EUR e você tenha 1.000 USD. Se a taxa cair de 0,92 para 0,90, seu patrimônio líquido cai 20 EUR sem nenhuma transação por trás.

Pelo mesmo motivo, quando você tem moeda estrangeira, a receita menos os gastos de um mês geralmente não bate com a variação do seu patrimônio líquido. O relatório mostra o que você gastou no momento. O gráfico mostra quanto seu dinheiro valia naquele dia.

## Use uma taxa personalizada só se quiser uma taxa fixa

A taxa do seu banco raramente bate com a taxa de mercado, então talvez você queira informar a sua. Vá em **Configurações** → **Moedas**, expanda a linha da moeda, desmarque **Atualização ao vivo**, digite a taxa em qualquer um dos campos e clique em **Salvar**.

![Linha de PLN expandida na página “Currencies”, com “Live update” desmarcado, uma taxa personalizada de 0.25 digitada e o botão “Save”](/img/landing/screenshots/features/settings/custom-exchange-rate@2x.webp)

Você tem uma taxa por moeda, sem data associada:

- Novas transações, e qualquer transação que você editar e salvar, usam essa taxa, mesmo com data do ano passado. As transações já salvas mantêm seus valores na moeda base até você editá-las.
- Os saldos passam a usá-la assim que você salva. Nas contas acompanhadas manualmente, o MoneyMatter também redesenha todo o histórico de saldo com essa taxa, e o gráfico deixa de acompanhar o mercado para essa moeda.

Eu deixaria **Atualização ao vivo** ligada para a maioria das moedas. Não dá para definir uma taxa por pagamento, e uma transferência já registra a taxa real de cada câmbio. Para voltar, marque **Atualização ao vivo** de novo e clique em **Salvar**.

## Se você mudar de país

Quando a moeda que você usa como referência mudar, mude sua moeda base e mantenha seus dados. Vá em **Configurações** → **Moedas** e adicione a nova moeda se ela não estiver na lista. Depois, expanda a linha dela, clique em **Definir como moeda base** e confirme.

O MoneyMatter recalcula cada transação pela taxa de mercado da data dela e converte os saldos pela taxa de hoje. Seus valores originais ficam como você os informou. Antes de começar:

- **Reserve alguns minutos.** Mantenha a aba aberta. Até terminar, você não pode adicionar nem alterar nada que envolva valores, em nenhum dispositivo.
- **Pare de compartilhar antes.** O MoneyMatter bloqueia a mudança enquanto você compartilha contas ou faz parte de uma família.
- **Prepare-se para refazer as taxas personalizadas.** Você as definiu em relação à moeda base antiga, então a maioria dessas moedas volta para **Ao vivo**. Defina sua taxa de novo se ainda quiser usá-la.
- **Faça isso uma vez só, se puder.** Alternar várias vezes pode deixar os totais convertidos alguns centavos diferentes de onde começaram.

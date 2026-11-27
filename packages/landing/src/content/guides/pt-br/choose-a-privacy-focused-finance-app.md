---
title: Como escolher um app de finanças pessoais focado em privacidade
description: Oito perguntas para fazer a qualquer app de finanças sobre seus dados, com as respostas do próprio MoneyMatter, inclusive onde ele deixa a desejar.
published: 2026-11-25
related:
  - /features/security-and-privacy
  - /features/export-and-backup
  - /features/ai-categorization
docs:
  - label: Segurança e conta
    href: https://docs.moneymatter.app/settings/security-and-account/
  - label: Recursos de IA
    href: https://docs.moneymatter.app/ai/ai-features/
  - label: Conexões bancárias
    href: https://docs.moneymatter.app/import/bank-connections/
---

Um app de finanças sabe mais sobre você do que a maioria dos apps: onde você compra, quanto ganha, para quem paga o aluguel. Um “Levamos sua privacidade a sério” na página inicial não diz nada. As perguntas abaixo dizem.

Cada uma vem com a resposta do próprio MoneyMatter, inclusive aquelas em que ele deixa a desejar, para você compará-lo de forma justa com qualquer outro app.

## 1. Como o app ganha dinheiro?

Servidores custam dinheiro, e essa conta é paga de algum jeito. Se um app é grátis e mostra anúncios, ou ganha uma comissão quando você abre o cartão ou contrata o empréstimo que ele recomenda, seus dados de gastos fazem parte de como ele é pago.

O MoneyMatter é pago por assinaturas. Ele não mostra anúncios e não usa rastreadores do Google nem do Facebook.

## 2. Como ele se conecta ao seu banco?

Procure uma conexão somente leitura em que você faz login no próprio site ou app do seu banco. Tome cuidado com qualquer app que peça a senha do seu banco.

As conexões bancárias do MoneyMatter são somente leitura: elas veem contas, saldos e transações, e não conseguem movimentar dinheiro. A senha do seu banco nunca é armazenada. As chaves e os tokens das suas conexões são criptografados com AES-256-GCM, então uma cópia do banco de dados, sozinha, não os revela. Você também pode dispensar a sincronização bancária e adicionar transações manualmente ou por arquivos.

## 3. Quem pode ler suas transações?

Pergunte se o app tem criptografia de ponta a ponta. Se tiver, a empresa não consegue ler seus dados, e os servidores dela também não conseguem gerar relatórios nem rodar IA sobre eles.

O MoneyMatter não tem criptografia de ponta a ponta. Todo o tráfego usa HTTPS, mas as transações e os saldos são armazenados de forma que o servidor consiga lê-los e gerar seus relatórios. Isso significa que quem administra o servidor tem acesso a eles e, no MoneyMatter Cloud, quem administra é o MoneyMatter.

## 4. Quais outras empresas veem seus dados?

Todo app depende de alguns serviços externos. Um app confiável diz quais são e o que cada um recebe. Os principais do MoneyMatter:

- **Stripe** cuida dos pagamentos. Ele recebe os dados do seu cartão, e o MoneyMatter nunca recebe o número do cartão.
- **Resend** envia os e-mails de login e da conta.
- **Sentry** recebe relatórios de falhas, que incluem seu e-mail. Uma sessão com erro pode incluir uma gravação, com todo o texto mascarado e as mídias bloqueadas.
- **PostHog** recebe análises de uso do produto vinculadas à sua conta e ao seu e-mail. Contas reais não têm gravação de sessão. Ative o Do Not Track no seu navegador para interromper as análises que o navegador envia. O servidor continua registrando eventos como logins.
- **Seu provedor de dados bancários e seu provedor de IA**, se você usar sincronização bancária ou IA.

A [política de privacidade](/privacy-policy) também lista os menores, como o logo.dev para os logos dos favorecidos, com o que cada um recebe.

## 5. O que ele envia para a IA?

A categorização por IA poupa muita digitação, mas significa que os detalhes das transações saem do app. Pergunte o que é enviado, para quem e se você pode usar o seu próprio provedor.

No Plus e durante o teste grátis, o MoneyMatter envia cada nova transação bancária para a IA com o valor, a moeda, a data, o nome da conta, a anotação e o favorecido, além dos nomes das suas categorias. Seus saldos não são enviados. As transações que você adiciona manualmente não são enviadas para categorização automaticamente. No Plus, não existe uma opção única que desative a categorização automática.

Adicione sua própria chave da OpenAI, da Anthropic ou do Gemini nas configurações de IA, e os recursos de IA passam a usá-la. As sugestões de orçamento sempre usam a IA do próprio MoneyMatter.

Se você conectar o Claude, o ChatGPT ou outro assistente aos seus dados, você escolhe antes de aprovar se ele só pode ler ou se também pode criar, editar ou excluir registros. Você pode revogar o acesso nas configurações a qualquer momento.

## 6. Dá para verificar o que ele faz?

Um app fechado pede que você confie na política de privacidade dele. Com um app de código aberto, qualquer pessoa pode ler o código e ver como seus dados são tratados.

O MoneyMatter tem código aberto sob a licença AGPL-3.0, e o código dele é público no GitHub. Ele não tem auditoria de segurança nem certificação de terceiros publicada.

## 7. Como você faz login, e dá para ver quem está conectado?

Um login forte importa mais do que promessas de criptografia, porque a maioria das invasões de conta começa com uma senha roubada.

O MoneyMatter permite fazer login com uma chave de acesso, Google, GitHub, Apple ou senha, e manter várias formas ao mesmo tempo como reserva. Ele não tem autenticação em dois fatores. Para proteger sua conta sem ela, faça login com uma chave de acesso, ou com Google ou GitHub, onde valem as suas próprias configurações de dois fatores. Se sua conta também tiver senha, essa senha continua funcionando.

A aba **Sessões ativas** lista cada navegador e dispositivo conectado, com o endereço IP e a última atividade. Encerre uma sessão que pareça estranha, ou todas as outras sessões de uma vez. Uma redefinição de senha desconecta você de todos os lugares e desconecta os apps conectados, inclusive os assistentes de IA.

![A aba “Active Sessions” com a sessão atual marcada como “Current”, outros dispositivos abaixo dela e o botão “Sign out of all other sessions”](/img/landing/screenshots/features/settings/active-sessions@2x.webp)

## 8. Dá para levar seus dados e ir embora?

Um app que dificulta a saída tem menos motivo para tratar bem seus dados. Verifique se você consegue exportar tudo e excluir sua conta sem mandar e-mail para ninguém.

No MoneyMatter, em **Configurações**, você pode:

- **Exportar** transações, orçamentos, assinaturas e investimentos em CSV, Excel ou JSON.
- **Baixar backup**, um único zip com uma cópia completa dos seus dados.
- **Apagar todos os dados** e recomeçar com o mesmo login, ou **excluir sua conta** e todos os dados dela, na aba **Zona de perigo**. As duas ações são permanentes.

Depois que você exclui sua conta, o MoneyMatter guarda um hash irreversível do seu e-mail para que uma conta nova não possa reiniciar o teste grátis. Os registros já enviados ao Sentry e ao PostHog não são removidos automaticamente, e você pode pedir a remoção deles por e-mail.

Nada é excluído quando um teste ou uma assinatura termina. Sua conta passa a ser somente leitura, e você ainda pode fazer login e baixar uma exportação.

![A aba “Danger Zone” com a seção “Wipe all data” e a seção “Delete your account”](/img/landing/screenshots/features/settings/danger-zone@2x.webp)

## A lista de verificação

| Pergunta                          | O que procurar                                  | MoneyMatter                                        |
| --------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Como ele ganha dinheiro?          | Você paga, não os anunciantes                   | Assinaturas, sem anúncios                          |
| Como ele se conecta ao seu banco? | Somente leitura, sem a senha do banco           | Somente leitura, credenciais criptografadas        |
| Quem pode ler suas transações?    | Uma resposta clara                              | O servidor pode, sem criptografia de ponta a ponta |
| Quais empresas veem seus dados?   | Uma lista com nomes                             | Citadas na política de privacidade                 |
| O que vai para a IA?              | Os campos, e seu próprio provedor como opção    | Listados, aceita chave própria                     |
| Dá para verificar o código?       | Código aberto                                   | AGPL-3.0, sem auditoria de terceiros               |
| Como você faz login?              | Chaves de acesso ou dois fatores                | Chaves de acesso, sem dois fatores                 |
| Dá para sair?                     | Exportação completa, exclusão por conta própria | Exportação, backup, exclusão pelas configurações   |

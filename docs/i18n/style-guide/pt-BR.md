# MoneyMatter style guide: Brazilian Portuguese (pt-BR)

Adds to the shared guide and wins where they differ. The tone follows Brazilian finance apps: friendly and direct, never slangy.

## 1. Register and verb forms

- Address the user as você/seu/sua. Never tu, o senhor or a senhora, and never vocês for one user.
- Buttons and CTAs, including empty-state CTAs, use the infinitive: `Salvar`, `Cancelar`, `Tentar de novo`, `Criar a primeira automação`.
- Select placeholders use the imperative `Escolha …`: `Escolha uma categoria`. Never `Selecione …` or `Escolher …` in a placeholder. A select button or action stays infinitive: `Escolher transação`.
- Text placeholders say what to type: `Digite o nome do favorecido`, `DD/MM/AAAA`.
- Sentences that tell the user what to do use the você-imperative: `Tente de novo`, `Confira sua conexão`.
- Errors: `Não foi possível …`, then the next step: `Não foi possível carregar as automações. Confira sua conexão e tente de novo.`
- Validation: `Digite um nome para esta automação.`
- Success toasts: noun + participle, no period: `Tag criada`, `Categoria excluída`, `Alterações salvas`.
- A confirmation title that is a question: `Excluir tag?`. All three English "cannot be undone" variants: `Não é possível desfazer esta ação.`
- Optional fields: `(opcional)`.

## 2. Capitalization and punctuation

- Sentence case: `Create Portfolio` → `Criar carteira`, `Select Base Currency` → `Escolha a moeda base`.
- Months, weekdays and common nouns stay lowercase mid-sentence: `em março`, `toda segunda-feira`, `seu favorecido`.
- Quotes: curly “” around names, UI labels, user data, menu paths and name placeholders: `Excluir “{name}”?`, `Toque em “Register”`, `Adicione a moeda em “Configurações → Moedas”.` Straight "" only around code identifiers, API field names and env vars.
- Dash in a sentence: spaced em dash `—`. Ranges: en dash without spaces, `1–31`.
- Abbreviations keep their period: `máx.`, `mín.`, `/mês`, `/ano`.

## 3. Plurals

- The shared §7 positions apply: 2 forms are [exactly 1 | other]; 3 forms are [0 | exactly 1 | other]. Zero always reads as plural or as a "nenhum" phrase, never singular: `Nenhuma conta | 1 conta | {count} contas`.
- Every non-zero form contains the source's count token ({count} or {n}).
- Backend strings have one form. Put the number after a colon when the noun would need to agree: `Transações carregadas: {{count}}.`

## 4. Placeholders and agreement

- Portuguese nouns and adjectives have gender. When grammar must agree with user data, add your own noun and agree with it: `Criar o favorecido “{name}”`, `A conta “{name}” será criada…`. {from} and {to} can be an account or a portfolio: add no noun and phrase so nothing agrees (`de “{from}” para “{to}”`).
- Phrase inserted words so every value fits. {action} is transferência, saque or depósito, all feminine-safe only if you avoid articles: `Será criado um lançamento de {action} de {amount}`.
- {date} arrives already formatted: build around it with a preposition, `até {date}`, `cotação de {date}`.
- {amount} arrives formatted with its currency in the user's number format. Never add a currency symbol, a sign or a "R$" of your own.

## 5. Terms

- account (financial) = conta. account (login, "Delete your account") = conta MoneyMatter where both senses could meet; plain `sua conta` in settings and auth screens.
- balance = saldo. A loan's outstanding balance = saldo devedor.
- income = receita; expense = despesa; transaction = transação; category = categoria; tag = tag; budget = orçamento.
- net worth = patrimônio líquido. cash flow = fluxo de caixa. money flow = fluxo do dinheiro.
- transfer = transferência. out of wallet = fora da carteira.
- refund = reembolso (noun) / reembolsar (verb). Investment return = rentabilidade (`Rentabilidade anual (%)`); Total return = rentabilidade total. Never retorno or receita for an investment return.
- payee = favorecido, for both directions, also on income. merchant (raw bank text) = estabelecimento.
- bank connection = conexão bancária. A network connection stays conexão: `Confira sua conexão`.
- base currency = moeda base; base amount = valor na moeda base; original amount = valor original.
- security (instrument) = ativo; Security settings = segurança. holding = posição; portfolio = carteira.
- Shares (units held, crypto too) = quantidade; per share = por unidade. ações only where the text means stock.
- cost basis = custo de aquisição, in investments and venture alike. average cost = preço médio.
- dividend = dividendo; fee = taxa; interest = juros; APR = taxa de juros anual.
- subscription (the Subscription type) = assinatura; the user's MoneyMatter plan = assinatura or plano (billing.\*); plan = plano. Where "subscription" means any recurring item (`Couldn't load your subscriptions`), write pagamento recorrente.
- bill (payment type) = conta a pagar, next to assinatura and parcelamento (`Assinaturas e contas a pagar`). Never just conta, which already means account.
- installment = parcelamento (the type); one installment = parcela (`parcela 3 de 10`).
- The recurring-payments feature ("Recurring Payments", "Scheduled payments") = pagamentos recorrentes, everywhere; one item = pagamento recorrente. Never despesas recorrentes: it tracks income too.
- pending (not yet booked) = pendente. planned (scheduled transaction) = agendado.
- venture deal = participação; Venture section = Participações; platform = plataforma. Never Investimentos.
- vehicle = veículo; loan = empréstimo; depreciation = depreciação.
- tracker / Trackers = acompanhamento / Acompanhamentos. Never rastreador or monitor.
- household = família (`Compartilhado pela família de {handle}`).
- Assets / Liabilities (net-worth sides) = Bens / Dívidas. Never Ativos / Passivos: ativo already means a security.
- Dashboard = Painel. overdraft = cheque especial. mortgage = financiamento imobiliário.
- note (transaction field) = observação. view (saved filter set, list/table view) = visualização.
- Plan names stay in Latin script and English: `plano Plus`.

## 6. Payment methods

- Pix stays `Pix` (brand, capital P, never PIX in copy). Boleto = boleto (lowercase mid-sentence).
- credit card = cartão de crédito; debit card = cartão de débito; cash = dinheiro; bank transfer = transferência bancária; web payment = pagamento online; mobile payment = pagamento por celular; voucher = vale.

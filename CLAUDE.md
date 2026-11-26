# CLAUDE.md — Sisto (LTD.2026.2-006)

Sistema de gestão de ocorrências de alunos para a EE José Carlos Nogueira Reverendo – Professor.
Dev responsável: **Rafael Vendramini**. Orientador: Prof. Kesede Julio.

Repositório: **https://github.com/RafaelVendramini/sisto** (público; dados fictícios). Desde 24/11/2026 o projeto não faz mais parte da organização da disciplina (STATURETECH/LTD.2026.2.006, mantido só como registro).

## Fontes de verdade (ler antes de qualquer trabalho)

1. [docs/SSD.md](docs/SSD.md) — **define o produto** (escopo, RNs, RFs, modelo de dados, API).
2. A **Issue** do GitHub — **define o trabalho**. Execute somente o objetivo da Issue.
3. [.github/AIP.md](.github/AIP.md) — protocolo obrigatório de desenvolvimento com IA.

Nunca invente requisitos, regras ou funcionalidades. Se algo não está no SSD ou na Issue, ou é ambíguo, **pare e pergunte ao Rafael**. Itens "Fora do escopo" do SSD não são implementados.

## Regras invioláveis

- Mudanças em `.github/` (workflows de CI, templates) só dentro de uma Issue e com aprovação do Rafael.
- **Nunca** fazer commit, push, criar branch remota, Issue ou Pull Request sem autorização explícita do Rafael.
  - **Exceção (Issue #33):** os dois agentes agendados descritos em [docs/agentes-agendados.md](docs/agentes-agendados.md) têm autorização permanente para abrir Issues e, quando a correção for simples e segura, PRs para a `developer`. Eles **nunca** mergeiam. Nas sessões interativas, a regra acima continua valendo.
  - O merge automático, na `developer`, dos PRs do Dependabot de versões minor e patch (Issue #32) é feito pelo GitHub, não pela IA.
- Merge na `main` publica em produção (Render, depois do CI verde): só com autorização explícita do Rafael.
- Nunca declarar testes executados sem executá-los; se não executou, escreva **"não executado"**.
- Somente **dados fictícios** em seeds, testes e exemplos (RN05 / LGPD). Nenhum dado real de estudante no repositório ou em prompts.
- Usar apenas a stack definida abaixo; nova dependência só com justificativa no relatório.

## Stack

- JavaScript (ES Modules) — **sem TypeScript**
- Back-end: Node.js + Express, Prisma ORM, PostgreSQL, JWT, bcrypt
- Front-end: React + Vite
- Testes: Vitest (+ Supertest no back-end, + Testing Library no front-end)
- Gerenciador: npm

## Estrutura

```text
src/
├── backend/
│   ├── prisma/          # schema.prisma, migrations, seed (dados fictícios)
│   ├── src/
│   │   ├── routes/      # endpoints (Seção 12 do SSD)
│   │   ├── middlewares/ # auth JWT, permissão por perfil (RN01/RF14), erros
│   │   ├── controllers/ # entrada/saída HTTP, sem regra de negócio
│   │   ├── services/    # regras de negócio (RN01–RN11), histórico, auditoria
│   │   └── app.js
│   └── tests/
└── frontend/
    ├── src/
    │   ├── pages/
    │   ├── components/
    │   ├── services/    # chamadas à API
    │   └── main.jsx
    └── tests/
```

## Fluxo Git e CI/CD

- Branch: `feature|task|bugfix|spike/<nº-da-issue>-<slug-minusculo>` — ex.: `feature/12-registrar-ocorrencia`
- Partir de e abrir PR para **`developer`** (nunca direto para `main`).
- Corpo do PR com `Closes #<nº>` seguindo [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md). O `Closes` só fecha a Issue no merge na `main`; ao mergear na `developer`, feche a Issue à mão.
- Commits em português, no imperativo, citando a Issue: `feat(ocorrencias): registra ocorrência com múltiplos estudantes (#12)`.
- O CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) roda em todo PR para `developer` e `main` os jobs **API**, **Front-end** e **E2E** (PostgreSQL descartável); `main` e `developer` só aceitam merge com os três verdes.
- Deploy: o Render publica a **`main`** depois do CI verde (ver [docs/deploy.md](docs/deploy.md)). Para publicar, abre-se um PR `developer` → `main`.

## Equipe de agentes

A sessão principal atua como **Tech Lead**: lê a Issue, delega aos agentes de [.claude/agents/](.claude/agents/), integra o resultado e entrega o relatório final ao Rafael.

| Agente          | Papel | Quando usar |
| --------------- | ----- | ----------- |
| `analista-ssd`  | Product Owner / Analista | Transformar o SSD em Issues (Story/Task/Spike/Subtask), checar escopo, manter o SSD atualizado |
| `dev-backend`   | Dev back-end | Implementar Issues em `src/backend` (API, Prisma, regras de negócio) |
| `dev-frontend`  | Dev front-end | Implementar Issues em `src/frontend` (telas React responsivas) |
| `qa`            | Testes / Qualidade | Criar e executar testes, validar critérios de aceite e RNs |
| `revisor`       | Code review, segurança e LGPD | Revisar o diff antes do PR (somente leitura) |

Fluxo padrão de uma Issue: `analista-ssd` (se a Issue precisar de refinamento) → `dev-backend` e/ou `dev-frontend` → `qa` → `revisor` → relatório ao Rafael → Rafael autoriza commit/PR.

## Relatório obrigatório ao concluir uma Issue (AIP, regra 9)

1. O que foi realizado
2. Arquivos modificados
3. Testes criados ou alterados
4. Testes executados e resultados (ou "não executado")
5. Limitações ou pendências
6. Passo a passo do que o Rafael deve executar na máquina dele

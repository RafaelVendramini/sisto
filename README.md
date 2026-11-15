# Sisto: um sistema de gestão de ocorrências de alunos

---

## Equipe

| Campo           | Valor          |
| --------------- | -------------- |
| **Equipe**      | LTD.2026.2-006 |
| **Repositório** | [STATURETECH/LTD.2026.2.006](https://github.com/STATURETECH/LTD.2026.2.006) |
| **Turma**       | Quinta-feira   |


### Integrantes

| Nome              | Função |
| ----------------- | ------ |
| Rafael Vendramini | Dev    |
| Gabriel Luna      | Dev    |

**Professor Orientador:** Kesede Julio

---

## Cliente

| Campo                           | Valor |
| ------------------------------- | ----- |
| **Cliente (Nome/Razão Social)** | Escola Estadual José Carlos Nogueira Reverendo – Professor |
| **CPF/CNPJ**                    | Não informado (unidade da rede estadual de ensino de São Paulo) |
| **Contato**                     | Suzany Sturaro (Diretora de Escola) e Anderson (Professor) |
| **E-mail**                      | [e-mail fornecido à equipe] (Prof. Anderson) |

---

## Objetivo

Desenvolver uma aplicação web responsiva para registro, encaminhamento, acompanhamento e geração de relatórios das ocorrências escolares da EE José Carlos Nogueira, que hoje registra cerca de 50 ocorrências por dia em formulários de papel. O sistema substitui o preenchimento em papel, reduz o retrabalho de transcrição para a Plataforma Conviva e mantém um histórico digital seguro, com acesso restrito por perfil e em conformidade com a LGPD.

---

## Tecnologias

* **Linguagem:** JavaScript (Node.js e navegador)
* **Framework:** Express (API REST) e React + Vite (front-end web responsivo)
* **Banco de Dados:** PostgreSQL, com acesso via Prisma ORM
* **Autenticação:** JWT, com senhas armazenadas com hash (bcrypt)
* **Testes:** Vitest (com Supertest no back-end e Testing Library no front-end)
* **Gerenciador de Dependências:** npm
* **Ferramenta(s) de IA:** Claude Code (CLI, com equipe de agentes definida em `CLAUDE.md`) e IA conversacional

---

## Estrutura do Projeto

> *Esta estrutura é padrão do LTD e não deve ser alterada.*

```text
.
├── .github/
│   ├── AIP-LTD.md
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── docs/
│   └── SSD.md
├── src/
├── .gitignore
└── README.md
```

### Descrição

- **README.md:** apresentação do projeto.
- **docs/SSD.md:** especificação oficial do sistema.
- **.github/:** não altere nenhum arquivo desta pasta, sob o risco de perder a nota da Sprint.
- **.github/AIP-LTD.md:** protocolo de desenvolvimento com IA.
- **src/:** código-fonte da aplicação (`src/backend` e `src/frontend`).

Arquivos complementares da equipe:

- **CLAUDE.md** e **.claude/agents/:** regras do projeto e equipe de agentes de IA.
- **docs/PLANO-SPRINTS.md:** planejamento das Sprints do MVP.
- **docs/apresentacao/:** slides do SeNAS e logo do Sisto.

---

## Status do Projeto

| Item             | Valor                               |
| ---------------- | ----------------------------------- |
| **Sprint Atual** | Sprint 3 (03/11/2026 a 16/11/2026)  |
| **Versão**       | MVP 1.0                             |
| **Situação**     | MVP 1.0 entregue na `main` (#96); homologação publicada no Render e no Neon (#79) |

### Sprint 3

| Situação | Issues |
| -------- | ------ |
| **Entregues (Done)** | #56, #77, #78, #79, #80, #81, #82, #83, #84, #85, #86, #87, #88, #89, #90, #91, #92, #93, #94, #96, #113, #115, #122 e #123 (58 pontos; a #113, a #115, a #122 e a #123 foram criadas durante a sprint) |
| **Em andamento** | — |
| **Em espera** | #95: homologação com a escola (data a definir) |
| **Cortadas** | #71 e #72 (exceto o item D1, entregue na Subtask #115), pela ordem de corte da Sprint 3 (ver [Limitações conhecidas](#limitações-conhecidas)) |

---

## Links do Projeto

| Recurso        | Link |
| -------------- | ---- |
| GitHub Project | A definir |
| Swagger        | [docs/openapi.yaml](docs/openapi.yaml) (OpenAPI 3, sem Swagger UI exposta) |
| Deploy         | Front-end: <https://sisto.onrender.com> · API: <https://sisto-api.onrender.com> (homologação, somente dados fictícios — RN05) |
| Guia de deploy | [docs/deploy.md](docs/deploy.md): deploy no Render e no Neon, variáveis (sem valores), backup e script de recuperação da Gestão (RN11) |

---

## Como rodar localmente

### Pré-requisitos

- **Node.js 22.12 ou mais recente** (com o npm).
- **PostgreSQL** rodando na máquina, com um banco para o desenvolvimento (ex.: `sisto`).

### Back-end (API)

Na pasta `src/backend`:

1. Copie o arquivo `.env.example` para `.env` e preencha os valores **da sua máquina**. O próprio `.env.example` explica as variáveis: `PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET` (gere um segredo novo, com o comando indicado no arquivo), `CORS_ORIGIN` e as variáveis do seed (`SEED_GESTAO_EMAIL`, `SEED_GESTAO_SENHA` e `SEED_SENHA_USUARIOS`). O `.env` não vai para o repositório. Não reaproveite os valores de exemplo (senhas começando com `TROQUE_` são recusadas pelo seed) nem senhas pessoais ou de produção.
2. Instale as dependências: `npm ci`.
3. Crie as tabelas: `npm run db:migrate` (desenvolvimento) ou `npm run db:deploy` (só aplica as migrations existentes).
4. Carregue os dados fictícios: `npm run db:seed`. Fora de produção, o seed cria um usuário por perfil, turmas, estudantes e tutores fictícios e as categorias de exemplo (RN05). Rodar de novo não altera o que já existe.
5. Suba a API: `npm run dev` (por padrão, em `http://localhost:3000`).

### Front-end

Na pasta `src/frontend`:

1. Copie o arquivo `.env.example` para `.env`. Ele tem só `VITE_API_URL`, o endereço da API (por padrão, `http://localhost:3000`). Essa variável fica visível no navegador, por isso nunca deve conter segredos.
2. Instale as dependências: `npm ci`.
3. Suba o front-end: `npm run dev` e abra o endereço mostrado no terminal (por padrão, `http://localhost:5173`).

### Testes

- Em `src/backend` e em `src/frontend`: `npm test`.
- Banco de testes, usado pelos testes de ponta a ponta (#93); o `npm test` não precisa dele: crie o arquivo `src/backend/.env.test` (também fora do repositório) só com a `DATABASE_URL` apontando para um banco separado, `sisto_test`, e rode `npm run db:test:reset` para recriá-lo e aplicar as migrations. Depois, rode os testes de ponta a ponta com `npm run test:e2e`. Assim o banco de desenvolvimento não é afetado (o `db:test:reset` recusa qualquer banco cujo nome não termine em `_test`).

---

## Perfis e permissões

Resumo da matriz de permissões da Seção 4 do [SSD](docs/SSD.md) (versão 1.10). **A matriz ainda é uma proposta e será validada com a escola na homologação (#95).**

| Ação | Professor | Tutor | Gestão | Pedagógico | Técnico-adm. |
| ---- | :-------: | :---: | :----: | :--------: | :----------: |
| Registrar ocorrência | Sim | Sim | Sim | Sim | Sim |
| Ver as ocorrências que registrou | Sim | Sim | Sim | Sim | Sim |
| Ver as ocorrências encaminhadas a si | Sim | Sim | Sim | Sim | Sim |
| Ver as ocorrências dos seus tutorados | — | Sim | Sim | Sim | — |
| Ver todas as ocorrências | — | — | Sim | Sim | — |
| Encaminhar ocorrência | — | — | Sim | Sim | — |
| Registrar providência e encerrar ocorrência | — | Só se for o responsável pelo acompanhamento | Sim | Sim | — |
| Registrar comunicação (contato feito fora do sistema) | — | Só nas ocorrências que vê | Sim | Sim | — |
| Gerar relatórios | — | — | Sim | Sim | — |
| Gerenciar categorias | — | — | Sim | Sim | — |
| Gerenciar usuários, turmas e estudantes | — | — | Sim | — | — |
| Redefinir a senha de outro usuário | — | — | Sim | — | — |
| Trocar a própria senha | Sim | Sim | Sim | Sim | Sim |

Observações:

- O Tutor também vê as ocorrências que acompanha como responsável (RN19).
- Professor e Técnico-administrativo não recebem encaminhamentos no MVP (RN03): na prática, a linha "encaminhadas a si" não vale para eles. É um ponto a validar com a escola (#95).
- Todos os perfis consultam turmas, estudantes e categorias, porque todos registram ocorrências; quem não é Gestão recebe dados reduzidos (sem código escolar dos estudantes, por exemplo — RN20).
- Enquanto a troca da senha temporária estiver pendente, o usuário só consegue trocar a senha ou sair (RN10).
- O menu de cada tela mostra só o que o perfil pode usar, mas quem garante as permissões é a API.

---

## Limitações conhecidas

### Issues cortadas da Sprint 3

| Issue | O que fica sem implementar |
| ----- | -------------------------- |
| #71 | Melhorias de qualidade de código e de testes (código repetido entre telas e services, apoio comum aos testes). Não muda o que o usuário vê. |
| #72 | O item D1 (campo `codigo` estável nas respostas 409 e no 403 de troca de senha pendente) **foi entregue** na Subtask #115. Ficam de fora: tutor dos estudantes no detalhe da ocorrência (D3); lista reduzida de usuários (`GET /usuarios`) também para a Gestão nas telas de ocorrência (D5); demais ajustes de robustez e de mensagens da Issue. O SSD 1.9 marca o D3 e o D5 como previstos, fora desta entrega. |

### Pendências para depois da homologação

- Um usuário Gestão com a troca de senha ainda pendente é contado entre os dois usuários Gestão ativos exigidos pela RN11.
- O seed cria a Gestão inicial **sem** troca obrigatória de senha no primeiro login.
- `PUT /ocorrencias/{id}` (editar uma ocorrência já registrada) fica fora do MVP.
- Os textos da Política de privacidade e dos Termos de uso são provisórios e ainda serão validados com a escola.
- Os prints de evidência das telas da Sprint 3 ainda estão pendentes.
- O script de recuperação da Gestão (#80) ainda não foi testado contra o banco do Neon; o teste fica para antes da homologação com a escola (#95).
- No plano gratuito do Render, a API dorme depois de 15 minutos sem uso; o primeiro acesso seguinte leva cerca de 1 minuto.

---

## Licença

Projeto desenvolvido no **LTD — Laboratório de Transformação Digital** para fins acadêmicos de Engenharia de Software.

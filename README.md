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

| Item             | Valor              |
| ---------------- | ------------------ |
| **Sprint Atual** | Sprint 1           |
| **Versão**       | MVP 1.0            |
| **Situação**     | Em desenvolvimento |

---

## Links do Projeto

| Recurso        | Link |
| -------------- | ---- |
| GitHub Project | A definir |
| Swagger        | A definir |
| Deploy         | A definir |

---

## Licença

Projeto desenvolvido no **LTD — Laboratório de Transformação Digital** para fins acadêmicos de Engenharia de Software.

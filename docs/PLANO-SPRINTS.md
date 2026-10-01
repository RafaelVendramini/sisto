# Plano de Sprints — Sisto MVP 1.0

> **Status: provisório.** As datas serão ajustadas às entregas parciais da disciplina (a confirmar após a apresentação de 01/10/2026).
> Meta: MVP concluído até **31/10/2026**. Método: Scrum enxuto, sprints de 1 semana, quadro no GitHub Projects.

| Sprint | Período       | Objetivo | Requisitos |
| ------ | ------------- | -------- | ---------- |
| 1      | 02/10 – 08/10 | Fundação: estrutura `src/backend` + `src/frontend`, banco e Prisma (modelo da Seção 11), autenticação e usuários | RF01, RF02, RF03, RF04, RNF03 |
| 2      | 09/10 – 15/10 | Cadastros de apoio e registro da ocorrência | RF07, RF15, RF16, RF05, RF06 |
| 3      | 16/10 – 22/10 | Fluxo da ocorrência: encaminhar, comunicar, providências, status, histórico e permissões por perfil | RF08, RF09, RF10, RF12, RF14 |
| 4      | 23/10 – 29/10 | Consultas, relatórios, auditoria, testes de ponta a ponta e homologação com o cliente | RF11, RF13, RNF04 |
| —      | 30/10 – 31/10 | Reserva técnica: correções, documentação (README, Swagger) e entrega | — |

## Cerimônias (enxutas)

- **Planejamento** (início da sprint): o `analista-ssd` gera os rascunhos de Issues. O Rafael aprova e as Issues são criadas no GitHub Projects.
- **Execução**: uma Issue por vez, em uma branch própria, com PR para `developer`.
- **Revisão** (fim da sprint): demonstrar ao orientador/cliente, fazer o merge de `developer` em `main` e atualizar o "Status do Projeto" no README.

## Riscos

- **Prazo apertado** (4 semanas para 16 RFs): manter as Issues pequenas e não aceitar nada "Fora do escopo".
- **Matriz de permissões** ainda a validar com a escola: precisa ser confirmada até a Sprint 3.
- **Hospedagem/deploy** não definida: abrir uma Spike na Sprint 1.

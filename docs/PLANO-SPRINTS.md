# Plano de Sprints — Sisto MVP 1.0

> Datas definidas pelo professor no GitHub Project da disciplina (sprints de 2 semanas). Data final do MVP: **a confirmar com o orientador** (o calendário do Project vai até 16/11/2026).
> Método: Scrum enxuto, quadro no [GitHub Project](https://github.com/orgs/STATURETECH/projects/54), auditado pela Stature.

| Sprint | Período       | Objetivo | Requisitos |
| ------ | ------------- | -------- | ---------- |
| 1      | 05/10 – 19/10 | Fundação: estrutura `src/backend` + `src/frontend`, banco e Prisma (modelo da Seção 11), autenticação e usuários; Spikes de recuperação de acesso e de hospedagem | RF01, RF02, RF03, RF04, RNF03 |
| 2      | 20/10 – 02/11 | Cadastros de apoio, registro da ocorrência e encaminhamento/comunicação | RF07, RF15, RF16, RF05, RF06, RF08, RF09 |
| 3      | 03/11 – 16/11 | Status, histórico e permissões por perfil; consultas, relatórios, auditoria, testes de ponta a ponta, homologação com o cliente e entrega (README, Swagger) | RF10, RF12, RF14, RF11, RF13, RNF04 |

## Cerimônias (enxutas)

- **Planejamento** (início da sprint): o `analista-ssd` gera os rascunhos de Issues. O Rafael aprova, as Issues são criadas e adicionadas ao GitHub Project (campo **Sprint**).
- **Execução**: uma Issue por vez, em uma branch própria, com PR para `developer`.
- **Revisão** (fim da sprint): demonstrar ao orientador/cliente, fazer o merge de `developer` em `main` e atualizar o "Status do Projeto" no README.

## Riscos

- **Prazo apertado** (3 sprints para 16 RFs): manter as Issues pequenas e não aceitar nada "Fora do escopo".
- **Matriz de permissões** ainda a validar com a escola: precisa ser confirmada até a Sprint 3.
- **Hospedagem/deploy:** definida no Spike #19 (Render + Neon, SSD 1.5). O deploy, com o script de recuperação da Gestão (RN11), entra na Sprint 3.
- **Sem limite de tentativas** no login (`POST /auth/login`) e na troca de senha (`PUT /conta/senha`): permite tentar senhas sem parar. Issue na Sprint 3; a solução (dependência `express-rate-limit` ou implementação própria) será decidida nela.
- **Data final do MVP:** vale este plano (Sprint 3 até 16/11/2026) até a confirmação com o orientador. A Issue #19 citava 31/10/2026.

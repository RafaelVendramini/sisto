# SSD — Software Specification Document

> **Objetivo:** Este documento é a fonte oficial de especificação do sistema. Toda Story, Task, Bug, Spike ou Subtask deve estar alinhada ao seu conteúdo.

---

# 1. Identificação do Projeto

| Campo           | Valor          |
| --------------- | -------------- |
| Nome do Sistema | Sistema de gestão de ocorrências de alunos |
| Nome Curto      | Sisto |
| Equipe          | LTD.2026.2-006 |
| Versão          | MVP 1.0        |
| Semestre        | 2026.2         |

## Cliente

| Campo                       | Valor |
| --------------------------- | ----- |
| Cliente (Nome/Razão Social) | Escola Estadual José Carlos Nogueira Reverendo – Professor |
| CPF/CNPJ                    | Não informado (unidade da rede estadual de ensino de São Paulo) |
| Nome do Contato             | Suzany Sturaro (Diretora de Escola) e Anderson (Professor) |
| E-mail do Contato           | [e-mail fornecido à equipe] (Prof. Anderson) |

---

# 2. Problema

A EE José Carlos Nogueira registra atualmente cerca de 50 ocorrências escolares por dia (indisciplina, conflitos, bullying, agressões, evasão, situações de sofrimento emocional, entre outras), utilizando formulários impressos preenchidos por professores, equipe gestora e equipe técnico-administrativa.

Após o preenchimento manual, a equipe pedagógica precisa organizar as informações e transcrevê-las para a Plataforma Conviva, da rede estadual. Esse fluxo gera elevado consumo de papel, risco de perda ou extravio dos registros, retrabalho, possibilidade de erros de transcrição, demora no encaminhamento das informações, dificuldade para localizar registros anteriores, ausência de histórico digital integrado e limitação na geração de relatórios — reduzindo a agilidade no acompanhamento e na proteção dos estudantes envolvidos.

---

# 3. Objetivo do Sistema

Desenvolver um sistema digital para registro, organização, encaminhamento, acompanhamento e geração de relatórios das ocorrências escolares da EE José Carlos Nogueira, substituindo o preenchimento inicial em papel e reduzindo o retrabalho de transcrição para a Plataforma Conviva.

---

# 4. Usuários do Sistema

| Usuário                        | Responsabilidade                                                        |
| ------------------------------- | ------------------------------------------------------------------------ |
| Professor                       | Registra ocorrências observadas em sala de aula ou no ambiente escolar   |
| Professor Tutor                 | Acompanha ocorrências dos estudantes sob sua tutoria e recebe encaminhamentos |
| Equipe Gestora (Diretor/Vice)   | Analisa ocorrências, define e registra providências, autoriza encaminhamentos |
| Equipe Pedagógica               | Acompanha ocorrências, apoia encaminhamentos e providências               |
| Equipe Técnico-administrativa   | Acessa o sistema quando autorizada pela gestão                           |

## Partes interessadas (não acessam o sistema no MVP)

| Parte interessada    | Relação com o sistema |
| -------------------- | --------------------- |
| Família/Responsável  | Recebe comunicações sobre ocorrências, feitas pela escola fora do sistema e registradas nele (RF09) |
| Estudante            | Pode ser informado sobre a ocorrência, quando apropriado e autorizado |

O acesso deve observar o princípio da necessidade: cada usuário visualiza apenas as informações pertinentes às suas funções.

## Matriz de permissões (proposta — validar com a escola)

| Ação                                   | Professor | Tutor | Gestão | Pedagógico | Técnico-adm. |
| -------------------------------------- | :-------: | :---: | :----: | :--------: | :----------: |
| Registrar ocorrência                   | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ver ocorrências que registrou          | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ver ocorrências dos seus tutorados     | — | ✔ | ✔ | ✔ | — |
| Ver ocorrências encaminhadas a si      | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ver todas as ocorrências               | — | — | ✔ | ✔ | — |
| Encaminhar ocorrência                  | — | — | ✔ | ✔ | — |
| Atualizar/encerrar ocorrência          | — | ✔ (se responsável) | ✔ | ✔ | — |
| Registrar comunicação                  | — | ✔ | ✔ | ✔ | — |
| Gerar relatórios                       | — | — | ✔ | ✔ | — |
| Gerenciar categorias                   | — | — | ✔ | ✔ | — |
| Gerenciar usuários, turmas e estudantes| — | — | ✔ | — | — |
| Redefinir senha de usuário             | — | — | ✔ | — | — |
| Trocar a própria senha                 | ✔ | ✔ | ✔ | ✔ | ✔ |

---

# 5. Escopo do MVP

## Funcionalidades incluídas

* Cadastro de usuários autorizados com definição de perfil (Professor, Tutor, Gestão, Pedagógico, Técnico-administrativo)
* Autenticação individual (usuário e senha) e recuperação de acesso
* Cadastro de turmas e estudantes, com vínculo do estudante ao seu professor tutor
* Registro digital de ocorrências, com todos os campos do Apêndice A da proposta (estudante(s) envolvido(s), categoria, descrição, local, data/horário, providências imediatas, testemunhas, encaminhamentos)
* Cadastro e edição de categorias de ocorrência
* Encaminhamento de ocorrências para tutor, equipe pedagógica ou gestão
* Registro de comunicações realizadas (ex.: contato com a família, rede de proteção) associadas a uma ocorrência
* Consulta de ocorrências por estudante, turma, categoria, período e profissional responsável
* Acompanhamento de status (aberto, em acompanhamento, encerrado) e histórico de atualizações
* Geração de relatórios básicos (quantidade de ocorrências por período, turma e categoria)

## Fora do escopo

* Aplicativo móvel nativo (apenas web responsivo no MVP)
* Notificações automáticas (push, SMS ou e-mail) às famílias
* Painel de indicadores / dashboard analítico
* Assinatura ou validação eletrônica dos registros
* Integração com a Plataforma Conviva ou outros sistemas da SEDUC-SP
* Importação automática de turmas/estudantes de sistemas da SEDUC-SP
* Exportação de relatórios em PDF ou planilha eletrônica
* Módulo de mediação de conflitos
* Banco de orientações e procedimentos institucionais
* Recursos avançados de acessibilidade além da usabilidade básica exigida em RNF

> **Regra:** tudo o que estiver fora do escopo não deve ser implementado no MVP.

---

# 6. Regras de Negócio

| Código | Regra |
| ------ | ----- |
| RN01   | Cada usuário só visualiza as informações pertinentes às suas funções e responsabilidades (princípio da necessidade), conforme a matriz de permissões da Seção 4. |
| RN02   | Toda ocorrência deve ter, no mínimo, um estudante envolvido e um profissional responsável pelo registro identificado. |
| RN03   | Toda ocorrência registrada deve ser encaminhada a pelo menos um responsável interno (tutor, equipe pedagógica ou gestão). |
| RN04   | O status de uma ocorrência segue o fluxo aberto → em acompanhamento → encerrado, sem retorno a status anterior e sem pular etapas. Uma ocorrência só pode ser encerrada se houver ao menos uma providência adotada registrada durante o acompanhamento. |
| RN05   | Dados de estudantes utilizados em ambiente de desenvolvimento e testes devem ser fictícios ou anonimizados. |
| RN06   | Os registros devem ser redigidos de forma objetiva e descritiva, sem linguagem ofensiva ou classificações que estigmatizem os estudantes. |
| RN07   | Um usuário que deixa de pertencer à unidade escolar deve ser bloqueado/desativado, mantendo-se o histórico dos registros que criou. O status do usuário assume os valores **ativo**, **bloqueado** ou **desativado**; usuários nunca são excluídos, e a Gestão pode reativá-los (voltar para **ativo**). |
| RN08   | Toda alteração em uma ocorrência (status, providências, encaminhamentos, comunicações) deve gerar um registro no histórico, com usuário, data/hora e descrição da alteração. |
| RN09   | Somente usuários com status **ativo** podem autenticar-se e acessar o sistema. O bloqueio ou a desativação corta o acesso imediatamente, inclusive de sessões já abertas (o status é verificado a cada requisição autenticada). |
| RN10   | Senhas devem ter no mínimo 8 caracteres. No cadastro, a Gestão define uma senha temporária para o novo usuário; não há troca obrigatória no primeiro acesso. Quando a Gestão redefine a senha de um usuário (RF03), a nova senha também é temporária e o usuário é obrigado a trocá-la no próximo login; enquanto não troca, a API nega o acesso às demais rotas (HTTP 403). Na troca da própria senha, a nova senha não pode ser igual à senha atual. A Gestão pode redefinir a senha de um usuário bloqueado ou desativado, que continua sem acesso até ser reativado (RN09). |
| RN11   | O sistema deve manter sempre ao menos um usuário com perfil Gestão e status **ativo**. A Gestão não pode bloquear, desativar ou alterar o próprio perfil, e nenhuma edição pode deixar o sistema sem um usuário Gestão ativo; nesses casos a operação é recusada (HTTP 409). |
| RN12   | Qualquer troca de senha (redefinição pela Gestão ou troca pelo próprio usuário) encerra as sessões abertas do usuário: os tokens emitidos antes da troca deixam de valer, inclusive o token usado na própria troca. Um token só vale se tiver sido emitido depois da última troca de senha; após trocar a senha, o usuário precisa fazer login novamente. |

---

# 7. Casos de Uso

| Código | Caso de Uso |
| ------ | ----------- |
| UC01   | Registrar Ocorrência |
| UC02   | Encaminhar Ocorrência |
| UC03   | Consultar Ocorrências |
| UC04   | Atualizar/Encerrar Ocorrência |
| UC05   | Gerar Relatório |

### UC01 — Registrar Ocorrência

1. Usuário autentica-se no sistema.
2. Seleciona a turma.
3. Identifica o(s) estudante(s) envolvido(s).
4. Seleciona a categoria da ocorrência.
5. Descreve o fato e informa data, horário e local.
6. Informa demais envolvidos, testemunhas e providências imediatas.
7. Seleciona ao menos um destinatário interno (tutor, equipe pedagógica ou gestão) e envia o registro (RN03).
8. O sistema registra a ocorrência com status "aberto".

### UC02 — Encaminhar Ocorrência

1. Usuário responsável (gestão ou equipe pedagógica) abre uma ocorrência pendente.
2. Define o destinatário interno do encaminhamento (tutor, equipe pedagógica ou gestão) e o responsável pelo acompanhamento.
3. Quando houver contato externo (família, rede de proteção etc.), registra a comunicação realizada.
4. O sistema altera o status para "em acompanhamento" e registra a alteração no histórico.

### UC03 — Consultar Ocorrências

1. Usuário acessa a área de consulta.
2. Filtra por estudante, turma, categoria, período ou profissional responsável.
3. Visualiza status e histórico de atualizações da ocorrência, limitado às ocorrências permitidas pelo seu perfil (RN01).

### UC04 — Atualizar/Encerrar Ocorrência

1. Responsável pelo acompanhamento acessa a ocorrência.
2. Registra providências adotadas e novas observações.
3. Encerra a ocorrência, quando aplicável (RN04).
4. O sistema registra as alterações no histórico (RN08).

### UC05 — Gerar Relatório

1. Usuário autorizado seleciona o tipo de relatório (por período, turma ou categoria).
2. O sistema exibe o relatório, respeitando os níveis de acesso e as regras de sigilo do usuário.

---

# 8. Requisitos Funcionais

| Código | Descrição |
| ------ | --------- |
| RF01   | O sistema deve permitir o cadastro de usuários autorizados, com definição de perfil (Professor, Tutor, Gestão, Pedagógico, Técnico-administrativo) e de senha temporária inicial (RN10). |
| RF02   | O sistema deve permitir autenticação individual por usuário e senha, sendo o e-mail (único) o identificador de login, e o encerramento da sessão (logout). |
| RF03   | O sistema deve permitir a recuperação de acesso: a Gestão redefine a senha de outro usuário, definindo uma nova senha temporária (RN10), e não redefine a própria senha por esse caminho; o usuário logado troca a própria senha, informando a senha atual e a nova. Após redefinição pela Gestão, a troca é obrigatória no próximo login (RN10). Toda troca encerra as sessões abertas (RN12) e é registrada no log de auditoria, sem a senha (RNF04). |
| RF04   | O sistema deve permitir o bloqueio, a desativação e a reativação de usuários (RN07, RN09, RN11). |
| RF05   | O sistema deve permitir o registro de ocorrências com os campos: profissional responsável, data e horário, local, turma, estudante(s) envolvido(s), categoria, descrição, demais envolvidos, testemunhas, providências imediatas, encaminhamentos e observações. |
| RF06   | O sistema deve permitir o registro de mais de um estudante envolvido em uma mesma ocorrência. |
| RF07   | O sistema deve permitir a criação e a edição de categorias de ocorrência. |
| RF08   | O sistema deve permitir o encaminhamento de uma ocorrência para tutor, equipe pedagógica ou gestão. |
| RF09   | O sistema deve permitir o registro de comunicações realizadas (ex.: contato com a família, rede de proteção) associadas a uma ocorrência. |
| RF10   | O sistema deve permitir a atualização do status de uma ocorrência (aberto, em acompanhamento, encerrado). |
| RF11   | O sistema deve permitir a consulta de ocorrências por estudante, turma, período, categoria e profissional responsável. |
| RF12   | O sistema deve exibir o histórico de alterações de uma ocorrência. |
| RF13   | O sistema deve permitir a geração de relatórios de quantidade de ocorrências por período, turma e categoria. |
| RF14   | O sistema deve respeitar os níveis de acesso definidos por perfil na exibição de registros e relatórios. |
| RF15   | O sistema deve permitir o cadastro e a edição de turmas e estudantes. |
| RF16   | O sistema deve permitir vincular cada estudante a um professor tutor. |

> Cada **Story** deverá atender um ou mais requisitos funcionais.

---

# 9. Requisitos Não Funcionais

| Código | Descrição                 |
| ------ | -------------------------- |
| RNF01  | Interface responsiva, utilizável em computadores, tablets e celulares. |
| RNF02  | Navegação simples e linguagem clara, adequada a usuários com diferentes níveis de familiaridade tecnológica. |
| RNF03  | Controle de acesso por usuário e senha, com perfis de permissão; senhas armazenadas com hash. A sessão (token JWT) expira em 8 horas, sem renovação automática (refresh). |
| RNF04  | Registro de atividades realizadas no sistema (log/auditoria básica). |
| RNF05  | Cópias de segurança e proteção dos dados armazenados. |
| RNF06  | Tratamento de dados pessoais em conformidade com a LGPD (finalidade definida, acesso restrito, prevenção de exposição indevida). |

---

# 10. Arquitetura do Sistema

## Tecnologias

* Linguagem: **JavaScript** (Node.js no back-end, navegador no front-end)
* Framework: **Express** (API REST) e **React + Vite** (front-end web responsivo)
* Banco de Dados: **PostgreSQL**, com acesso via **Prisma ORM**
* Autenticação: **JWT**, senhas armazenadas com hash
* Testes: **Vitest** (com Supertest no back-end e Testing Library no front-end)
* Gerenciador de Dependências: **npm**
* Ferramentas de IA: **Claude Code** (CLI, com equipe de agentes definida em `CLAUDE.md`) e IA conversacional

## Padrão Arquitetural

Cliente-servidor com API REST (JSON). O front-end React consome a API Node.js/Express, que acessa o PostgreSQL via Prisma.

O back-end segue arquitetura em camadas:

* **Routes** — definição dos endpoints
* **Middlewares** — autenticação (incluindo a verificação, a cada requisição, de que o usuário está ativo — RN09) e verificação de permissão por perfil (RN01, RF14)
* **Controllers** — recebem as requisições e devolvem as respostas
* **Services** — regras de negócio (RN01–RN12), histórico e auditoria
* **Prisma (camada de dados)** — acesso ao banco de dados

## Hospedagem (homologação)

Definida no Spike #19 para a homologação com a escola, com custo zero:

* **Front-end:** site estático no **Render** (build do Vite), com HTTPS automático.
* **API:** serviço web no **Render**, com HTTPS automático. No plano gratuito, a API é suspensa após 15 minutos sem acesso, e o primeiro acesso seguinte leva cerca de 1 minuto.
* **Banco de dados:** PostgreSQL no **Neon**, preferencialmente na região São Paulo (`aws-sa-east-1`) (RNF06).
* **Deploy:** automático a partir da branch `main`, sem alterações em `.github/`. As migrations rodam com `prisma migrate deploy`, e o seed cria apenas o usuário Gestão inicial (`NODE_ENV=production`).
* **Segredos:** `DATABASE_URL`, `JWT_SECRET` e credenciais do seed ficam somente nas variáveis de ambiente dos serviços, nunca no repositório.
* **Backup (RNF05):** além da restauração do Neon (até 6 horas), a equipe faz uma cópia semanal com `pg_dump`, criptografada e guardada fora do repositório, com acesso restrito.
* **Dados (RN05):** o ambiente hospedado usa somente dados fictícios até a autorização formal da escola. O acesso às contas do Render e do Neon é restrito à equipe, com verificação em duas etapas.
* **Uso real:** a contratação de um plano pago (API sem suspensão e backup automático) é decisão a ser levada ao orientador e à escola.

---

# 11. Modelo de Dados

> Todos os identificadores (`id`) e chaves estrangeiras (`*_id`) são do tipo **Int** com autoincremento.

## Entidade: Usuário

| Campo    | Tipo   | Obrigatório |
| -------- | ------ | ----------- |
| id       | Int   | Sim         |
| nome     | String | Sim         |
| email    | String | Sim (único; identificador de login) |
| senha_hash | String | Sim       |
| perfil   | String | Sim (Professor, Tutor, Gestão, Pedagógico, Técnico-administrativo) |
| status   | String | Sim (ativo, bloqueado, desativado) |
| troca_senha_obrigatoria | Boolean | Sim (padrão `false`; `true` após redefinição pela Gestão — RN10) |
| senha_alterada_em | DateTime | Não (data/hora da última troca de senha; tokens emitidos antes deixam de valer — RN12) |

> Valores técnicos armazenados e trafegados na API: `perfil` ∈ `PROFESSOR`, `TUTOR`, `GESTAO`, `PEDAGOGICO`, `TECNICO_ADMINISTRATIVO`; `status` ∈ `ATIVO`, `BLOQUEADO`, `DESATIVADO`. O front-end exibe os rótulos amigáveis correspondentes (ex.: "Gestão", "Bloqueado").

## Entidade: Turma

| Campo  | Tipo   | Obrigatório |
| ------ | ------ | ----------- |
| id     | Int   | Sim         |
| nome   | String | Sim         |
| etapa  | String | Sim         |

## Entidade: Estudante

| Campo          | Tipo   | Obrigatório |
| -------------- | ------ | ----------- |
| id             | Int   | Sim         |
| nome_completo  | String | Sim         |
| codigo_escolar | String | Não         |
| turma_id       | Int   | Sim         |
| tutor_id       | Int   | Não         |

## Entidade: Categoria

| Campo     | Tipo   | Obrigatório |
| --------- | ------ | ----------- |
| id        | Int   | Sim         |
| nome      | String | Sim         |
| descricao | String | Não         |

## Entidade: Ocorrência

| Campo                       | Tipo     | Obrigatório |
| --------------------------- | -------- | ----------- |
| id                          | Int     | Sim         |
| data_hora                   | DateTime | Sim         |
| local                       | String   | Sim         |
| turma_id                    | Int     | Sim         |
| categoria_id                | Int     | Sim         |
| descricao                   | String   | Sim         |
| demais_envolvidos           | String   | Não         |
| testemunhas                 | String   | Não         |
| providencias_imediatas      | String   | Não         |
| observacoes                 | String   | Não         |
| profissional_responsavel_id | Int     | Sim         |
| responsavel_acompanhamento_id | Int   | Não         |
| status                      | String   | Sim         |
| data_encerramento           | DateTime | Não         |

## Entidade: OcorrenciaEstudante (associativa)

| Campo         | Tipo | Obrigatório |
| ------------- | ---- | ----------- |
| ocorrencia_id | Int | Sim         |
| estudante_id  | Int | Sim         |

## Entidade: Encaminhamento

| Campo                  | Tipo     | Obrigatório |
| ---------------------- | -------- | ----------- |
| id                     | Int     | Sim         |
| ocorrencia_id          | Int     | Sim         |
| destinatario_perfil    | String   | Sim         |
| destinatario_usuario_id| Int     | Não         |
| registrado_por_id      | Int     | Sim         |
| data_hora              | DateTime | Sim         |
| observacao             | String   | Não         |

## Entidade: Providência

| Campo             | Tipo     | Obrigatório |
| ----------------- | -------- | ----------- |
| id                | Int     | Sim         |
| ocorrencia_id     | Int     | Sim         |
| descricao         | String   | Sim         |
| registrado_por_id | Int     | Sim         |
| data_hora         | DateTime | Sim         |

## Entidade: Comunicação

| Campo             | Tipo     | Obrigatório |
| ----------------- | -------- | ----------- |
| id                | Int     | Sim         |
| ocorrencia_id     | Int     | Sim         |
| destinatario      | String   | Sim         |
| meio              | String   | Sim         |
| descricao         | String   | Sim         |
| registrado_por_id | Int     | Sim         |
| data_hora         | DateTime | Sim         |

## Entidade: HistóricoOcorrência

| Campo         | Tipo     | Obrigatório |
| ------------- | -------- | ----------- |
| id            | Int     | Sim         |
| ocorrencia_id | Int     | Sim         |
| usuario_id    | Int     | Sim         |
| acao          | String   | Sim         |
| descricao     | String   | Não         |
| data_hora     | DateTime | Sim         |

## Entidade: LogAuditoria

| Campo      | Tipo     | Obrigatório |
| ---------- | -------- | ----------- |
| id         | Int     | Sim         |
| usuario_id | Int     | Não         |
| acao       | String   | Sim         |
| recurso    | String   | Sim         |
| data_hora  | DateTime | Sim         |

### Relacionamentos

* Uma Turma possui vários Estudantes.
* Um Estudante pode ter um Usuário com perfil Tutor como tutor.
* Uma Ocorrência envolve um ou mais Estudantes (relação N:N, via OcorrenciaEstudante).
* Uma Ocorrência pertence a uma Categoria.
* Uma Ocorrência é registrada por um Usuário (profissional responsável).
* Uma Ocorrência pode possuir vários Encaminhamentos, Providências, Comunicações e registros de Histórico.

---

# 12. Especificação da API

API REST (JSON) implementada em Node.js + Express. Endpoints previstos para o MVP, protegidos por JWT (exceto `/auth/*`):

| Método | Endpoint                             | Descrição |
| ------ | ------------------------------------ | --------- |
| POST   | /auth/login                          | Autenticar usuário |
| POST   | /auth/recuperar-senha                | *Reservado para etapa futura* (redefinição por link enviado ao e-mail; depende do Spike #19 e de nova decisão; não implementado no MVP atual) |
| GET    | /usuarios                            | Listar usuários |
| POST   | /usuarios                            | Cadastrar usuário |
| PUT    | /usuarios/{id}                       | Editar usuário (inclui bloqueio/desativação) |
| PUT    | /usuarios/{id}/senha                 | Redefinir a senha de outro usuário (somente Gestão — RF03, RN10) |
| PUT    | /conta/senha                         | Trocar a própria senha, informando a senha atual (RF03) |
| GET    | /turmas                              | Listar turmas |
| POST   | /turmas                              | Cadastrar turma |
| PUT    | /turmas/{id}                         | Editar turma |
| GET    | /estudantes                          | Listar estudantes (filtro por turma) |
| POST   | /estudantes                          | Cadastrar estudante |
| PUT    | /estudantes/{id}                     | Editar estudante (inclui vínculo com tutor) |
| GET    | /categorias                          | Listar categorias |
| POST   | /categorias                          | Criar categoria |
| PUT    | /categorias/{id}                     | Editar categoria |
| POST   | /ocorrencias                         | Registrar nova ocorrência |
| GET    | /ocorrencias                         | Consultar ocorrências (com filtros) |
| GET    | /ocorrencias/{id}                    | Consultar detalhe de uma ocorrência |
| PUT    | /ocorrencias/{id}                    | Atualizar ocorrência |
| PATCH  | /ocorrencias/{id}/status             | Alterar status (inclui encerramento) |
| POST   | /ocorrencias/{id}/encaminhamentos    | Registrar encaminhamento |
| POST   | /ocorrencias/{id}/providencias       | Registrar providência adotada |
| POST   | /ocorrencias/{id}/comunicacoes       | Registrar comunicação |
| GET    | /ocorrencias/{id}/historico          | Consultar histórico da ocorrência |
| GET    | /relatorios                          | Gerar relatórios (por período, turma, categoria) |

Observações sobre autenticação:

* `POST /auth/login` recebe e-mail e senha e devolve um token JWT com validade de 8 horas, sem refresh (RNF03). Somente usuários com status **ativo** autenticam (RN09).
* O logout (RF02) é feito no front-end, descartando o token; não há endpoint de logout no MVP.
* O middleware de autenticação consulta o status do usuário no banco a cada requisição; usuário bloqueado ou desativado tem o acesso negado imediatamente (RN09).
* `POST /usuarios` recebe a senha temporária definida pela Gestão (mínimo de 8 caracteres — RN10). `PUT /usuarios/{id}` permite alterar o status entre `ATIVO`, `BLOQUEADO` e `DESATIVADO` (RF04, RN07), usando os valores técnicos da Seção 11.
* `PUT /usuarios/{id}` responde **409** quando a Gestão tenta bloquear, desativar ou alterar o próprio perfil, ou quando a edição deixaria o sistema sem um usuário Gestão ativo (RN11).
* A resposta do `POST /auth/login` inclui o campo `trocaSenhaObrigatoria` (boolean). Quando for `true`, o front-end leva o usuário direto para a tela de troca de senha (RN10).
* `PUT /usuarios/{id}/senha` é restrito à Gestão e recebe a nova senha temporária (mínimo de 8 caracteres — RN10). Responde **409** quando a Gestão tenta redefinir a própria senha por esse caminho, no mesmo padrão da RN11; para isso ela usa `PUT /conta/senha`. Após a redefinição, `troca_senha_obrigatoria` passa a `true`. A regra de nova senha diferente da atual não se aplica a esta redefinição. A redefinição é permitida para usuário bloqueado ou desativado, que continua sem acesso até ser reativado (RN09).
* `PUT /conta/senha` recebe a senha atual e a nova (mínimo de 8 caracteres — RN10); senha atual incorreta ou nova senha igual à atual são rejeitadas com **400** e mensagem clara (não 401, que o front-end trata como sessão expirada). Após a troca, `troca_senha_obrigatoria` volta a `false`. O endpoint não devolve token novo: o token usado na troca também deixa de valer, e o usuário precisa fazer login novamente (RN12).
* Enquanto `troca_senha_obrigatoria` for `true`, as rotas protegidas respondem **403** com mensagem clara, exceto `PUT /conta/senha` (RN10).
* Toda troca de senha atualiza `senha_alterada_em`. Um token só vale se tiver sido emitido depois de `senha_alterada_em`; o middleware de autenticação rejeita os demais (RN12). O tratamento de tokens emitidos no mesmo segundo da troca fica a cargo da implementação.
* As trocas de senha ("senha redefinida pela Gestão" e "senha alterada pelo usuário") são registradas no `LogAuditoria` (RNF04), nunca com a senha.
* `POST /auth/recuperar-senha` permanece reservado para uma etapa futura (redefinição por link enviado ao e-mail), dependente do Spike #19 e de nova decisão; não é requisito no momento.

---

# 13. Critérios Gerais de Aceite

Uma implementação somente poderá ser considerada concluída quando atender aos itens abaixo.

* [ ] Atende aos requisitos funcionais.
* [ ] Respeita as regras de negócio.
* [ ] Modelo de dados atualizado.
* [ ] API documentada.
* [ ] Testes criados ou atualizados.
* [ ] Validação funcional realizada pelo Dev.

---

# 14. Histórico de Versões

| Versão | Data       | Descrição      |
| ------ | ---------- | -------------- |
| 1.0    | 17/09/2026 | Criação do SSD com base na proposta de solicitação da EE José Carlos Nogueira Reverendo – Professor |
| 1.1    | 30/09/2026 | Ajuste do contato; matriz de permissões; cadastro de turmas/estudantes e tutoria (RF15, RF16); RN04 revisada e RN08; modelo de dados completado (campos do RF05, associativa, providências, comunicações, histórico, auditoria); endpoints da API ampliados; arquitetura definida (React + Node.js/Express + PostgreSQL/Prisma) |
| 1.2    | 30/09/2026 | Decisões do planejamento da Sprint 1: e-mail único como identificador de login e logout no front-end (RF02); senha temporária definida pela Gestão no cadastro (RF01, RN10); bloqueio, desativação e reativação (RF04, RN07); status do usuário ativo/bloqueado/desativado (RN07, Seção 11); bloqueio com corte imediato de acesso (nova RN09); senha com mínimo de 8 caracteres (nova RN10); JWT com expiração de 8h sem refresh (RNF03); ids do tipo Int autoincremento (Seção 11); observações de autenticação na Seção 12 |
| 1.3    | 12/10/2026 | Decisão da Issue #13: garantia de ao menos um usuário Gestão ativo, com recusa (HTTP 409) de autobloqueio, autodesativação, alteração do próprio perfil e de edições que deixem o sistema sem Gestão ativa (nova RN11; RF04 e Seção 10 atualizados); valores técnicos de `perfil` e `status` do usuário com rótulos amigáveis no front-end (Seção 11); observações do `PUT /usuarios/{id}` na Seção 12 |
| 1.4    | 15/10/2026 | Decisão do Spike #17 (recuperação de acesso, Etapa 1): RF03 reescrito — redefinição da senha de outro usuário pela Gestão e troca da própria senha pelo usuário logado, com auditoria sem a senha; RN10 ampliada com troca obrigatória no próximo login após redefinição pela Gestão (cadastro segue sem troca obrigatória); nova RN12 (troca de senha encerra as sessões abertas); campos `troca_senha_obrigatoria` e `senha_alterada_em` em `Usuario` (Seção 11); novos endpoints `PUT /usuarios/{id}/senha` e `PUT /conta/senha`, observações de autenticação e `POST /auth/recuperar-senha` reservado para etapa futura dependente do Spike #19 (Seção 12); referência às RNs na Seção 10. Respostas aos pontos em aberto do Spike #17: após trocar a senha o usuário faz login novamente, sem token novo, e o token usado na troca também deixa de valer (RN12); campo `trocaSenhaObrigatoria` na resposta do login; HTTP 403 nas rotas protegidas enquanto a troca está pendente e HTTP 409 quando a Gestão tenta redefinir a própria senha por `PUT /usuarios/{id}/senha`; token só vale se emitido depois de `senha_alterada_em`; nova senha diferente da atual; redefinição permitida para usuário bloqueado ou desativado, sem liberar o acesso (RN09); linhas "Redefinir senha de usuário" e "Trocar a própria senha" na matriz de permissões (Seção 4); senha atual incorreta ou nova senha igual à atual em `PUT /conta/senha` respondem 400, e a regra de senha diferente não vale para a redefinição pela Gestão |
| 1.5    | 15/10/2026 | Decisão do Spike #19: hospedagem da homologação no Render (front-end estático e API) e no Neon (PostgreSQL, região São Paulo), com deploy a partir da `main`, segredos em variáveis de ambiente, backup semanal com `pg_dump` (RNF05) e somente dados fictícios até autorização da escola (RN05, RNF06) — Seção 10 |

---

## Princípio

> **Este SSD é a única fonte de verdade do sistema.** Toda implementação, revisão e validação deve estar fundamentada neste documento.

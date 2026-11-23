# SSD — Software Specification Document

> **Objetivo:** Este documento é a fonte oficial de especificação do sistema. Toda Story, Task, Bug, Spike ou Subtask deve estar alinhada ao seu conteúdo.

---

# 1. Identificação do Projeto

| Campo           | Valor          |
| --------------- | -------------- |
| Nome do Sistema | Sistema de gestão de ocorrências de alunos |
| Nome Curto      | Sisto |
| Equipe          | LTD.2026.2-006 |
| Versão do produto | MVP 1.0 (a versão deste documento está na Seção 14) |
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

Observações sobre a matriz (v1.6):

* A visibilidade das ocorrências por perfil está detalhada na RN19.
* O Tutor registra comunicação apenas nas ocorrências que pode visualizar (RN16).
* Todos os perfis consultam turmas, estudantes, categorias e os destinatários possíveis, porque todos registram ocorrências, mas com dados reduzidos para quem não é Gestão (RN20).
* Turmas, estudantes e categorias não são excluídos (RN21).
* A linha "Atualizar/encerrar ocorrência" (registro de providência e encerramento) está detalhada na RN22 (v1.8).

> **Ponto a validar com a escola:** a linha "Ver ocorrências encaminhadas a si" está marcada para Professor e Técnico-administrativo, mas o destinatário de um encaminhamento só pode ser tutor, equipe pedagógica ou gestão (RN03). Assim, no MVP esses dois perfis não recebem encaminhamentos. A matriz foi mantida como está até a validação.

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
| RN02   | Toda ocorrência deve ter, no mínimo, um estudante envolvido e um profissional responsável pelo registro identificado. O profissional responsável é sempre o usuário logado que registra a ocorrência; não é possível registrar em nome de outro usuário. |
| RN03   | Toda ocorrência registrada deve ser encaminhada a pelo menos um responsável interno (tutor, equipe pedagógica ou gestão). O encaminhamento inicial é informado no próprio registro e gravado na mesma operação (tudo ou nada); sem ele, o registro é recusado (HTTP 400). Um encaminhamento para tutor exige um usuário com perfil Tutor e status **ativo**. Para equipe pedagógica ou gestão, o usuário destinatário é opcional (o encaminhamento vai para a equipe); se for informado, precisa ter o perfil correspondente (Pedagógico ou Gestão) e status **ativo**. O encaminhamento inicial não altera o status: a ocorrência nasce "aberto". |
| RN04   | O status de uma ocorrência segue o fluxo aberto → em acompanhamento → encerrado, sem retorno a status anterior e sem pular etapas. Uma ocorrência só pode ser encerrada se houver ao menos uma providência adotada registrada durante o acompanhamento. A providência adotada só é registrada com a ocorrência em "em acompanhamento"; em "aberto" ou "encerrado", o registro é recusado (HTTP 409). O encerramento é feito pelo `PATCH /ocorrencias/{id}/status`, que aceita somente `ENCERRADO`, e não exige justificativa; sem providência registrada, é recusado (HTTP 409). Ao encerrar, o sistema preenche a `data_encerramento` com o momento do registro (RN17). Não há reabertura. Quem registra providência e encerra está definido na RN22. |
| RN05   | Dados de estudantes utilizados em ambiente de desenvolvimento e testes devem ser fictícios ou anonimizados. |
| RN06   | Os registros devem ser redigidos de forma objetiva e descritiva, sem linguagem ofensiva ou classificações que estigmatizem os estudantes. O sistema não filtra o texto automaticamente; o formulário de registro mostra uma orientação sobre redação objetiva. |
| RN07   | Um usuário que deixa de pertencer à unidade escolar deve ser bloqueado/desativado, mantendo-se o histórico dos registros que criou. O status do usuário assume os valores **ativo**, **bloqueado** ou **desativado**; usuários nunca são excluídos, e a Gestão pode reativá-los (voltar para **ativo**). |
| RN08   | O registro da ocorrência e toda alteração nela (status, responsável pelo acompanhamento, providências, encaminhamentos, comunicações) devem gerar um registro no histórico, com usuário, data/hora e descrição da alteração. A ação do histórico é um texto fixo, sem dados pessoais nem o conteúdo das comunicações. |
| RN09   | Somente usuários com status **ativo** podem autenticar-se e acessar o sistema. O bloqueio ou a desativação corta o acesso imediatamente, inclusive de sessões já abertas (o status é verificado a cada requisição autenticada). |
| RN10   | Senhas devem ter no mínimo 8 caracteres. No cadastro (RF01), a Gestão define uma senha temporária para o novo usuário, que é obrigado a trocá-la no primeiro login. Quando a Gestão redefine a senha de um usuário (RF03), a nova senha também é temporária e o usuário é obrigado a trocá-la no próximo login. Assim, a Gestão nunca conhece a senha definitiva de outro usuário. Enquanto a troca estiver pendente, a API nega o acesso às demais rotas (HTTP 403). Na troca da própria senha, a nova senha não pode ser igual à senha atual. A Gestão pode redefinir a senha de um usuário bloqueado ou desativado, que continua sem acesso até ser reativado (RN09). |
| RN11   | O sistema deve manter ao menos **dois** usuários com perfil Gestão e status **ativo**, para que um possa redefinir a senha do outro (RF03). A Gestão não pode bloquear, desativar ou alterar o próprio perfil, e nenhuma edição pode reduzir a menos de dois o número de usuários Gestão ativos; nesses casos a operação é recusada (HTTP 409). Enquanto houver um único usuário Gestão ativo (por exemplo, logo após a instalação), ele não pode deixar de ser Gestão ativa, e a escola deve cadastrar o segundo. Se nenhum usuário Gestão conseguir entrar, a equipe técnica usa o script de recuperação, executado fora da API (Seção 10). |
| RN12   | Qualquer troca de senha (redefinição pela Gestão ou troca pelo próprio usuário) encerra as sessões abertas do usuário: os tokens emitidos antes da troca deixam de valer, inclusive o token usado na própria troca. Um token só vale se tiver sido emitido depois da última troca de senha; após trocar a senha, o usuário precisa fazer login novamente. |
| RN13   | Só pode ser vinculado como tutor de um estudante um usuário com perfil Tutor e status **ativo** no momento do vínculo; caso contrário, a operação é recusada (HTTP 400). Se o tutor for bloqueado ou desativado depois, o vínculo é mantido (RN07) e o status do tutor é exibido à Gestão, que pode trocar o tutor ou desvincular o estudante. A alteração do perfil de um usuário Tutor que tenha estudantes vinculados é recusada (HTTP 409) até que os estudantes sejam desvinculados. |
| RN14   | A turma da ocorrência é a turma de referência escolhida no registro e fica gravada como foto do momento: não muda quando um estudante troca de turma. A ocorrência pode envolver estudantes de outras turmas (por exemplo, um conflito entre turmas); o sistema valida apenas que a turma e os estudantes existem. |
| RN15   | Somente a Gestão e a Equipe Pedagógica encaminham ocorrências já registradas (UC02). Em uma ocorrência "aberto", o encaminhamento exige a definição do responsável pelo acompanhamento (usuário **ativo** com perfil Tutor, Pedagógico ou Gestão) e muda o status para "em acompanhamento" (RN04). Em uma ocorrência "em acompanhamento", um novo encaminhamento não altera o status, e a troca do responsável é opcional; informar como responsável o mesmo usuário que já acompanha a ocorrência não é troca (o responsável é mantido, sem nova validação e sem registro de troca no histórico). Encaminhar de novo a um destinatário que já recebeu a ocorrência é permitido. Uma ocorrência "encerrado" não recebe encaminhamentos (HTTP 409). |
| RN16   | A comunicação (RF09) registra um contato feito fora do sistema; o sistema não envia notificações. A Gestão e a Equipe Pedagógica registram comunicações em qualquer ocorrência; o Tutor, apenas nas ocorrências que pode visualizar (RN19). Uma ocorrência "encerrado" não recebe comunicações (HTTP 409); nas ocorrências "aberto" e "em acompanhamento", o registro da comunicação não altera o status. Destinatário e meio da comunicação são texto livre. |
| RN17   | A data/hora da ocorrência e a da comunicação são informadas pelo usuário (momento do fato ou do contato) e não podem ser futuras (HTTP 400). Para absorver diferenças entre o relógio do aparelho e o do servidor, a API aceita uma data até **5 minutos** à frente do horário do servidor; acima disso, recusa. A data/hora do encaminhamento, a da providência e a data de encerramento da ocorrência (`data_encerramento` — RN04) são o momento do registro, preenchido pelo sistema. As datas são gravadas em UTC e exibidas no horário de São Paulo (`America/Sao_Paulo`). |
| RN18   | Não pode haver duas categorias com o mesmo nome nem duas turmas com o mesmo trio (nome, etapa, ano letivo); a comparação de textos ignora maiúsculas/minúsculas e espaços nas pontas. O código escolar do estudante, quando informado, é único; a comparação ignora os espaços nas pontas, mas diferencia maiúsculas de minúsculas; vários estudantes podem ficar sem código (texto vazio equivale a não informado). Nomes de estudantes podem se repetir. A duplicidade é recusada com HTTP 409. |
| RN19   | Visibilidade das ocorrências (RN01): a Gestão e a Equipe Pedagógica visualizam todas. Professor e Técnico-administrativo visualizam as que registraram e as encaminhadas a eles como usuário destinatário (esta segunda condição hoje não ocorre, porque eles não podem ser destinatários pela RN03; ver o ponto a validar na Seção 4). O Tutor visualiza as que registrou, as encaminhadas a ele, as que acompanha como responsável e as que envolvem estudantes sob sua tutoria. Vale o vínculo de tutoria **atual** do estudante: se o estudante trocar de tutor, o novo tutor passa a ver as ocorrências dele, inclusive as antigas, e o anterior deixa de vê-las, salvo se outra das condições acima ainda valer para ele. Uma ocorrência fora da visibilidade do usuário é tratada como inexistente (HTTP 404). |
| RN20   | Todos os perfis autenticados consultam turmas, categorias e estudantes, necessários para registrar ocorrências. Para quem não é Gestão, os dados de estudantes se limitam a identificador, nome completo, turma e tutor (só identificador e nome do tutor, sem e-mail e sem status), sem código escolar, e a lista de usuários se limita a identificador, nome e perfil dos usuários **ativos** que podem ser destinatários de encaminhamento ou responsáveis pelo acompanhamento (Tutor, Pedagógico, Gestão), sem e-mail e sem status. |
| RN21   | Turmas, estudantes e categorias não são excluídos nem inativados no MVP: são apenas cadastrados e editados. A troca de turma de um estudante não altera as ocorrências já registradas (RN14). |
| RN22   | Registram providência adotada e encerram a ocorrência (RN04) a Gestão, a Equipe Pedagógica e o usuário que é o **responsável pelo acompanhamento** da ocorrência (`responsavel_acompanhamento_id` — RN15). O Tutor que vê a ocorrência (RN19), mas não é o responsável pelo acompanhamento, recebe HTTP 403. Professor e Técnico-administrativo recebem HTTP 403. |
| RN23   | Só podem ser responsáveis pelo acompanhamento de uma ocorrência os perfis Tutor, Pedagógico e Gestão (RN15, RN22). A alteração do perfil de um usuário que é o **responsável pelo acompanhamento** (`responsavel_acompanhamento_id`) de ocorrências **não encerradas** é recusada (HTTP 409) quando o novo perfil é Professor ou Técnico-administrativo, até que a Gestão ou a Equipe Pedagógica troque o responsável dessas ocorrências (por um novo encaminhamento — RN15). A mudança entre Tutor, Pedagógico e Gestão não é recusada por esta regra. As ocorrências encerradas não impedem a alteração, e o responsável gravado nelas é mantido. |

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
2. Registra providências adotadas (RN22).
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
| RF04   | O sistema deve permitir o bloqueio, a desativação e a reativação de usuários (RN07, RN09, RN11), com as restrições à alteração de perfil das RN13 e RN23. |
| RF05   | O sistema deve permitir o registro de ocorrências com os campos: profissional responsável, data e horário, local, turma, estudante(s) envolvido(s), categoria, descrição, demais envolvidos, testemunhas, providências imediatas, encaminhamentos e observações (RN02, RN03, RN14, RN17). |
| RF06   | O sistema deve permitir o registro de mais de um estudante envolvido em uma mesma ocorrência. |
| RF07   | O sistema deve permitir a criação e a edição de categorias de ocorrência (RN18, RN21). |
| RF08   | O sistema deve permitir o encaminhamento de uma ocorrência para tutor, equipe pedagógica ou gestão (RN03, RN15). |
| RF09   | O sistema deve permitir o registro de comunicações realizadas (ex.: contato com a família, rede de proteção) associadas a uma ocorrência (RN16, RN17). |
| RF10   | O sistema deve permitir a atualização do status de uma ocorrência (aberto, em acompanhamento, encerrado) (RN04, RN15, RN22). |
| RF11   | O sistema deve permitir a consulta de ocorrências por estudante, turma, período, categoria e profissional responsável (RN02, RN14, RN19). |
| RF12   | O sistema deve exibir o histórico de alterações de uma ocorrência (RN08, RN19). |
| RF13   | O sistema deve permitir a geração de relatórios de quantidade de ocorrências por período, turma e categoria (RN14). |
| RF14   | O sistema deve respeitar os níveis de acesso definidos por perfil na exibição de registros e relatórios. |
| RF15   | O sistema deve permitir o cadastro e a edição de turmas e estudantes (RN18, RN21). |
| RF16   | O sistema deve permitir vincular cada estudante a um professor tutor (RN13). |

> Cada **Story** deverá atender um ou mais requisitos funcionais.

---

# 9. Requisitos Não Funcionais

| Código | Descrição                 |
| ------ | -------------------------- |
| RNF01  | Interface responsiva, utilizável em computadores, tablets e celulares. |
| RNF02  | Navegação simples e linguagem clara, adequada a usuários com diferentes níveis de familiaridade tecnológica. |
| RNF03  | Controle de acesso por usuário e senha, com perfis de permissão; senhas armazenadas com hash. A sessão (token JWT) expira em até 8 horas, com tolerância técnica de alguns segundos, sem renovação automática (refresh). |
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
* Limite de tentativas: **express-rate-limit** (v1.8), dependência justificada pelo limite de tentativas com falha no login e na troca de senha (Seção 12)
* Documentação da API: arquivo **OpenAPI** em `docs/openapi.yaml` (v1.8), sem Swagger UI exposta
* Dependências (v1.11 — Issue #127): `body-parser` atualizado (correção de vulnerabilidade de negação de serviço) e Prisma **7.10.1**. **Risco aceito:** alerta alto no pacote `effect`, dependência da configuração do Prisma; ele só roda na linha de comando (migrations e deploy), nunca na API, e a correção oferecida pelo npm rebaixaria o Prisma para a versão 6.
* Ferramentas de IA: **Claude Code** (CLI, com equipe de agentes definida em `CLAUDE.md`) e IA conversacional

## Padrão Arquitetural

Cliente-servidor com API REST (JSON). O front-end React consome a API Node.js/Express, que acessa o PostgreSQL via Prisma.

O back-end segue arquitetura em camadas:

* **Routes** — definição dos endpoints
* **Middlewares** — autenticação (incluindo a verificação, a cada requisição, de que o usuário está ativo — RN09) e verificação de permissão por perfil (RN01, RF14)
* **Controllers** — recebem as requisições e devolvem as respostas
* **Services** — regras de negócio (RN01–RN23), histórico e auditoria
* **Prisma (camada de dados)** — acesso ao banco de dados

## Front-end (v1.9, atualizada na v1.13)

Itens de front-end entregues na Sprint 3 e decididos depois do MVP (v1.13):

* **Página 404:** endereço inexistente mostra uma página de "não encontrada", com o usuário logado ou não (Issue #78).
* **Título por tela:** a aba do navegador mostra o nome da tela no formato `<tela> · Sisto`, sem dados pessoais (Issue #78, RNF06).
* **Bloqueio de buscadores:** `robots.txt` com `Disallow: /` e `<meta name="robots" content="noindex, nofollow">` no `index.html` (Issue #78).
* **Favicons:** ícones do Sisto para a aba do navegador e para a tela inicial do celular (Issue #78).
* **Privacidade e termos:** páginas públicas `/privacidade` e `/termos`, com texto provisório, a validar com a escola (Issue #92).
* **Rodapé:** mostra o telefone da escola (Issue #92).
* **Turmas do ano letivo atual (v1.13 — Spike #130):** no registro de ocorrência e na tela de estudantes, as listas de turmas aparecem filtradas, por padrão, pelo **ano letivo atual e pelos anos seguintes** (ex.: em dezembro, as turmas já cadastradas para o ano seguinte), com a opção de ver também as turmas dos anos anteriores. Na edição de um estudante cuja turma é de um ano anterior, essa turma continua aparecendo selecionada (decisão do Rafael, 23/11/2026). O ano atual é o ano da data de hoje no horário de São Paulo (`America/Sao_Paulo` — RN17), e não no fuso do aparelho. O filtro é feito só no front-end: a API (`GET /turmas`) não muda e continua devolvendo todas as turmas (Seção 12).

## Hospedagem (homologação)

Definida no Spike #19 para a homologação com a escola, com custo zero:

* **Front-end:** site estático no **Render** (build do Vite), com HTTPS automático.
* **API:** serviço web no **Render**, com HTTPS automático. No plano gratuito, a API é suspensa após 15 minutos sem acesso, e o primeiro acesso seguinte leva cerca de 1 minuto.
* **Banco de dados:** PostgreSQL no **Neon**, preferencialmente na região São Paulo (`aws-sa-east-1`) (RNF06).
* **Deploy:** o deploy da homologação está configurado para ser automático a partir da branch `developer` (ver "Situação na entrega do MVP") (decisão de 11/11/2026), sem alterações em `.github/`. O merge `developer` → `main` só acontece na entrega do MVP (#96). As migrations rodam com `prisma migrate deploy`, e o seed cria apenas o usuário Gestão inicial (`NODE_ENV=production`).
* **Situação na entrega do MVP (v1.9):** a homologação ainda não foi publicada; o projeto roda localmente (decisão do Rafael, 13/11/2026).
* **Situação após a entrega do MVP (v1.10):** o merge `developer` → `main` foi feito em 15/11/2026 (PR #121, Issue #96), e os testes de ponta a ponta (#93) passaram contra banco real (350/350). A homologação foi publicada em 15/11/2026 (Issue #79):
  * **Front-end:** https://sisto.onrender.com (Static Site no Render, com regra de reescrita para as rotas do React).
  * **API:** https://sisto-api.onrender.com (Web Service no Render, plano Free).
  * **Banco de dados:** projeto Neon `sisto`, na região `aws-sa-east-1` (São Paulo), PostgreSQL 18 (RNF06).
  * **Deploy:** automático a partir da branch `developer`. O build da API é `npm ci && npm run db:deploy`; o seed rodou só no primeiro deploy, para criar a Gestão inicial, e depois foi retirado do build, e as variáveis `SEED_GESTAO_*` foram removidas.
  * **Gestão (RN11):** a senha da Gestão inicial foi trocada e uma segunda Gestão foi cadastrada.
  * **Dados (RN05):** somente dados fictícios.
  * **Pendências (registradas em `docs/deploy.md`):** o teste do script de recuperação da Gestão (#80) contra o Neon **não foi executado** e fica para antes da homologação com a escola (#95); a conferência do `trust proxy` no Render **não foi executada**.
* **Proxy (v1.12 — Issue #127):** a API considera **três** saltos de proxy à frente dela no Render (`trust proxy` = `3`): o cliente passa pela borda Cloudflare e pelo balanceador interno do Render antes de chegar à API. Conferido em 23/11/2026 com o diagnóstico (`DIAGNOSTICO_PROXY`): o `X-Forwarded-For` chega com três endereços (cliente, borda, balanceador), e com o valor anterior (`1`, v1.9) a API identificava o balanceador interno como cliente no limite de tentativas (Seção 12). Como os proxies acrescentam endereços ao fim, um `X-Forwarded-For` forjado pelo cliente não altera o IP identificado.
* **Testes no build (v1.13 — Spike #130):** o Build Command da API e o do front-end no Render passam a rodar os testes automatizados (`npm test`) antes de publicar; se algum teste falhar, o build falha e o deploy não acontece, e a versão anterior continua no ar. Na API, como o serviço roda com `NODE_ENV=production`, o build instala também as dependências de desenvolvimento para testar e as remove antes de publicar (`npm ci --include=dev && npm test && npm prune --omit=dev && npm run db:deploy` — decisão do Rafael, 23/11/2026). Os testes de ponta a ponta continuam sendo executados localmente, porque precisam de um banco de dados próprio. Não há integração contínua no GitHub (GitHub Actions), porque a pasta `.github/` não pode ser alterada. Os novos Build Commands e o passo a passo no painel ficam em `docs/deploy.md`.
* **Diagnóstico do proxy (v1.11 — Issue #127):** a variável opcional `DIAGNOSTICO_PROXY=1` na API serve só para conferir o `trust proxy`: registra no log o IP identificado e o cabeçalho `X-Forwarded-For` de cada `POST /auth/login`, sem e-mail nem senha. Como o IP é dado pessoal (RNF06), a variável fica desligada fora da conferência.
* **Cabeçalhos de segurança do front-end (v1.11 — Issue #127):** o Static Site do Render envia Content-Security-Policy restrita, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer`, configurados no painel do Render e documentados em `docs/deploy.md`.
* **Variáveis de ambiente:** a API usa `DATABASE_URL` (conexão com o Neon), `JWT_SECRET` (assinatura dos tokens), `CORS_ORIGIN` (endereço do front-end autorizado), `NODE_ENV=production` e, no seed, `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA` (na homologação, removidas depois do primeiro deploy — v1.10). O front-end usa `VITE_API_URL` (endereço da API), definida no build e visível no navegador, por isso nunca contém segredo.
* **Segredos:** `DATABASE_URL`, `JWT_SECRET` e as credenciais do seed ficam somente nas variáveis de ambiente dos serviços, nunca no repositório.
* **Recuperação da Gestão (RN11):** um script de linha de comando, executado pela equipe técnica fora da API e com acesso ao banco, redefine a senha de um usuário Gestão com troca obrigatória no próximo login (RN10) e registra a ação no `LogAuditoria`, sem a senha. A senha temporária é recebida por variável de ambiente, e o usuário Gestão é identificado pelo e-mail. Se a Gestão identificada não estiver ativa, o script a reativa (RN07, RN09). É o último recurso, para quando nenhum usuário Gestão consegue entrar. Entregue na Issue #80 (v1.9): a senha temporária é recebida **somente** pela variável `RECUPERACAO_SENHA_TEMPORARIA`; a `DATABASE_URL` é definida no próprio terminal, e o script não lê o `.env`; a redefinição encerra as sessões abertas do usuário (RN12); a auditoria é gravada com `usuario_id` nulo, porque a ação é feita fora da API (Seção 12).
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
| troca_senha_obrigatoria | Boolean | Sim (`true` no cadastro e após redefinição pela Gestão; volta a `false` quando o usuário troca a senha — RN10) |
| senha_alterada_em | DateTime | Não (data/hora da última troca de senha; tokens emitidos antes deixam de valer — RN12) |

> Valores técnicos armazenados e trafegados na API: `perfil` ∈ `PROFESSOR`, `TUTOR`, `GESTAO`, `PEDAGOGICO`, `TECNICO_ADMINISTRATIVO`; `status` ∈ `ATIVO`, `BLOQUEADO`, `DESATIVADO`. O front-end exibe os rótulos amigáveis correspondentes (ex.: "Gestão", "Bloqueado").

## Entidade: Turma

| Campo  | Tipo   | Obrigatório |
| ------ | ------ | ----------- |
| id     | Int   | Sim         |
| nome   | String | Sim (único em conjunto com `etapa` e `ano_letivo` — RN18) |
| etapa  | String | Sim (texto livre) |
| ano_letivo | Int | Sim (ano com 4 dígitos, ex.: 2026) |

> O ano letivo permite que a escola cadastre de novo, a cada ano, turmas com o mesmo nome e a mesma etapa (ex.: "1º A" do Ensino Médio em 2026 e em 2027), já que turmas não são excluídas (RN21).

## Entidade: Estudante

| Campo          | Tipo   | Obrigatório |
| -------------- | ------ | ----------- |
| id             | Int   | Sim         |
| nome_completo  | String | Sim (pode se repetir — RN18) |
| codigo_escolar | String | Não (único quando informado; texto vazio é gravado como nulo — RN18) |
| turma_id       | Int   | Sim (turma atual do estudante) |
| tutor_id       | Int   | Não (usuário com perfil Tutor e status ativo no momento do vínculo — RN13) |

## Entidade: Categoria

| Campo     | Tipo   | Obrigatório |
| --------- | ------ | ----------- |
| id        | Int   | Sim         |
| nome      | String | Sim (único — RN18) |
| descricao | String | Não         |

## Entidade: Ocorrência

| Campo                       | Tipo     | Obrigatório |
| --------------------------- | -------- | ----------- |
| id                          | Int     | Sim         |
| data_hora                   | DateTime | Sim (momento do fato, informado; não pode ser futuro — RN17) |
| local                       | String   | Sim         |
| turma_id                    | Int     | Sim (turma de referência escolhida no registro; não muda depois — RN14) |
| categoria_id                | Int     | Sim         |
| descricao                   | String   | Sim         |
| demais_envolvidos           | String   | Não         |
| testemunhas                 | String   | Não         |
| providencias_imediatas      | String   | Não         |
| observacoes                 | String   | Não         |
| profissional_responsavel_id | Int     | Sim (usuário logado que registrou — RN02) |
| responsavel_acompanhamento_id | Int   | Não (definido no primeiro encaminhamento pela Gestão ou pela Equipe Pedagógica — RN15) |
| status                      | String   | Sim (`ABERTO` no registro — RN03, RN04) |
| data_encerramento           | DateTime | Não (momento do encerramento, preenchido pelo sistema — RN04, RN17) |

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
| destinatario_usuario_id| Int     | Não (obrigatório quando o destinatário é tutor — RN03) |
| registrado_por_id      | Int     | Sim (usuário logado) |
| data_hora              | DateTime | Sim (momento do registro, preenchido pelo sistema — RN17) |
| observacao             | String   | Não         |

## Entidade: Providência

| Campo             | Tipo     | Obrigatório |
| ----------------- | -------- | ----------- |
| id                | Int     | Sim         |
| ocorrencia_id     | Int     | Sim         |
| descricao         | String   | Sim         |
| registrado_por_id | Int     | Sim (usuário logado) |
| data_hora         | DateTime | Sim (momento do registro, preenchido pelo sistema — RN17) |

## Entidade: Comunicação

| Campo             | Tipo     | Obrigatório |
| ----------------- | -------- | ----------- |
| id                | Int     | Sim         |
| ocorrencia_id     | Int     | Sim         |
| destinatario      | String   | Sim (texto livre — RN16) |
| meio              | String   | Sim (texto livre — RN16) |
| descricao         | String   | Sim         |
| registrado_por_id | Int     | Sim (usuário logado) |
| data_hora         | DateTime | Sim (momento do contato, informado; não pode ser futuro — RN17) |

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
* Um Estudante pode ter um Usuário com perfil Tutor como tutor (RN13).
* Uma Ocorrência envolve um ou mais Estudantes (relação N:N, via OcorrenciaEstudante), que podem ser de turmas diferentes da turma de referência (RN14). O mesmo estudante não se repete na mesma ocorrência.
* Uma Ocorrência pertence a uma Categoria.
* Uma Ocorrência é registrada por um Usuário (profissional responsável).
* Uma Ocorrência pode possuir vários Encaminhamentos, Providências, Comunicações e registros de Histórico.
* Turmas, Estudantes e Categorias não são excluídos (RN21).

> Valores técnicos (v1.6): o `status` da ocorrência assume `ABERTO`, `EM_ACOMPANHAMENTO` ou `ENCERRADO`, e o `destinatario_perfil` do encaminhamento assume `TUTOR`, `EQUIPE_PEDAGOGICA` ou `GESTAO`. O front-end exibe os rótulos amigáveis ("Aberto", "Equipe pedagógica").
>
> Seeds (RN05): o seed de desenvolvimento cria apenas turmas, estudantes e tutores **fictícios**, um usuário fictício por perfil (v1.9) e categorias de exemplo (indisciplina, conflitos, bullying, agressões, evasão, sofrimento emocional — Seção 2). O seed de produção cria apenas o usuário Gestão inicial (Seção 10); essa Gestão cadastra o segundo usuário Gestão (RN11) e as categorias, turmas e estudantes reais.
>
> **Pendências reservadas para depois da homologação (v1.9, sem mudança de regra):** (1) o seed cria a Gestão inicial sem troca obrigatória de senha (`troca_senha_obrigatoria` = `false`); (2) um usuário Gestão ativo com troca de senha pendente conta como Gestão ativa na RN11. As regras atuais continuam valendo até decisão do Rafael.

## Limites de tamanho e quantidade (v1.8)

Limites técnicos defensivos adotados nas Issues da Sprint 1 e da Sprint 2 e no planejamento da Sprint 3, contra entradas abusivas. A API recusa o que passar deles com HTTP 400 e mensagem clara. Os textos (exceto a senha) são medidos **depois** de retirar os espaços das pontas, em unidades UTF-16, a mesma contagem do `maxLength` do navegador (um emoji conta 2). Texto opcional vazio ou só com espaços é gravado como nulo. A senha não tem os espaços retirados.

| Entidade | Campo | Limite |
| -------- | ----- | ------ |
| Usuário | nome | até 150 caracteres |
| Usuário | email | até 254 caracteres |
| Usuário | senha | mínimo de 8 caracteres (RN10) e máximo de 72 bytes em UTF-8 (limite do bcrypt; letras acentuadas contam 2 bytes) |
| Categoria | nome | até 150 caracteres |
| Categoria | descricao | até 1000 caracteres |
| Turma | nome, etapa | até 150 caracteres cada |
| Turma | ano_letivo | inteiro de 1000 a 9999 |
| Estudante | nome_completo, codigo_escolar | até 150 caracteres cada |
| Ocorrência | local | até 150 caracteres |
| Ocorrência | descricao, demais_envolvidos, testemunhas, providencias_imediatas, observacoes | até 5000 caracteres cada |
| Ocorrência | estudantes envolvidos | de 1 a 50 estudantes distintos por ocorrência (ids repetidos contam uma vez) |
| Ocorrência | encaminhamentos no registro (UC01) | de 1 a 10 |
| Encaminhamento | observacao | até 5000 caracteres |
| Providência | descricao | até 5000 caracteres |
| Comunicação | destinatario, meio | até 150 caracteres cada |
| Comunicação | descricao | até 5000 caracteres |

> Nos textos da ocorrência, do encaminhamento, da comunicação e da providência, o caractere nulo (U+0000), que o PostgreSQL não grava, é recusado com HTTP 400. Na v1.11 (Issue #127), a recusa, com HTTP 400 e a mesma mensagem, vale também para: usuário (`nome` e `email`, no cadastro e na edição), turma (`nome` e `etapa`), categoria (`nome` e `descricao`), estudante (`nome_completo` e `codigo_escolar`) e o e-mail do login (Seção 12). A data/hora informada (RN17) aceita os anos de 0001 a 9999 em UTC, limite técnico do tipo de data do banco; não há data mínima de negócio.

---

# 12. Especificação da API

API REST (JSON) implementada em Node.js + Express. A documentação da API fica em `docs/openapi.yaml`, sem Swagger UI exposta (v1.8 — Seção 10). Endpoints previstos para o MVP, protegidos por JWT (exceto `/auth/*`):

| Método | Endpoint                             | Descrição |
| ------ | ------------------------------------ | --------- |
| POST   | /auth/login                          | Autenticar usuário |
| POST   | /auth/recuperar-senha                | *Reservado para etapa futura* (redefinição por link enviado ao e-mail; depende do Spike #19 e de nova decisão; não implementado no MVP atual) |
| GET    | /usuarios                            | Listar usuários (lista completa para a Gestão; reduzida para os demais perfis — RN20) |
| POST   | /usuarios                            | Cadastrar usuário |
| PUT    | /usuarios/{id}                       | Editar usuário (inclui bloqueio/desativação) |
| PUT    | /usuarios/{id}/senha                 | Redefinir a senha de outro usuário (somente Gestão — RF03, RN10) |
| PUT    | /conta/senha                         | Trocar a própria senha, informando a senha atual (RF03) |
| GET    | /turmas                              | Listar turmas (todos os perfis — RN20) |
| POST   | /turmas                              | Cadastrar turma (somente Gestão) |
| PUT    | /turmas/{id}                         | Editar turma (somente Gestão) |
| GET    | /estudantes                          | Listar estudantes, com filtro por turma (todos os perfis, dados reduzidos para quem não é Gestão — RN20) |
| POST   | /estudantes                          | Cadastrar estudante (somente Gestão) |
| PUT    | /estudantes/{id}                     | Editar estudante, inclusive o vínculo com o tutor (somente Gestão — RN13) |
| GET    | /categorias                          | Listar categorias (todos os perfis — RN20) |
| POST   | /categorias                          | Criar categoria (Gestão e Pedagógico) |
| PUT    | /categorias/{id}                     | Editar categoria (Gestão e Pedagógico) |
| POST   | /ocorrencias                         | Registrar nova ocorrência, com o encaminhamento inicial (todos os perfis — RN03) |
| GET    | /ocorrencias                         | Consultar ocorrências, com filtros e paginação, sempre limitadas à visibilidade do perfil (todos os perfis — RN19) |
| GET    | /ocorrencias/{id}                    | Consultar detalhe de uma ocorrência (RN19) |
| PUT    | /ocorrencias/{id}                    | *Reservado* — fora do MVP (atualizar ocorrência; não implementado no MVP atual) |
| PATCH  | /ocorrencias/{id}/status             | Encerrar a ocorrência; aceita somente `ENCERRADO` (Gestão, Pedagógico e o responsável pelo acompanhamento — RN04, RN22) |
| POST   | /ocorrencias/{id}/encaminhamentos    | Registrar encaminhamento (Gestão e Pedagógico — RN15) |
| POST   | /ocorrencias/{id}/providencias       | Registrar providência adotada, com a ocorrência em "em acompanhamento" (Gestão, Pedagógico e o responsável pelo acompanhamento — RN04, RN22) |
| POST   | /ocorrencias/{id}/comunicacoes       | Registrar comunicação (Tutor, Gestão e Pedagógico — RN16) |
| GET    | /ocorrencias/{id}/historico          | Consultar histórico da ocorrência (quem vê a ocorrência — RN19) |
| GET    | /relatorios                          | Gerar relatórios por período, turma ou categoria (somente Gestão e Pedagógico — UC05) |

Observações sobre autenticação:

* `POST /auth/login` recebe e-mail e senha e devolve um token JWT com validade de 8 horas, sem refresh (RNF03). Somente usuários com status **ativo** autenticam (RN09).
* O logout (RF02) é feito no front-end, descartando o token; não há endpoint de logout no MVP.
* O middleware de autenticação consulta o status do usuário no banco a cada requisição; usuário bloqueado ou desativado tem o acesso negado imediatamente (RN09).
* `POST /usuarios` recebe a senha temporária definida pela Gestão (mínimo de 8 caracteres — RN10), e o usuário é criado com `troca_senha_obrigatoria` igual a `true`. `PUT /usuarios/{id}` permite alterar o status entre `ATIVO`, `BLOQUEADO` e `DESATIVADO` (RF04, RN07), usando os valores técnicos da Seção 11.
* `PUT /usuarios/{id}` responde **409** quando a Gestão tenta bloquear, desativar ou alterar o próprio perfil, ou quando a edição deixaria o sistema com menos de dois usuários Gestão ativos (RN11).
* A resposta do `POST /auth/login` inclui o campo `trocaSenhaObrigatoria` (boolean). Quando for `true`, o front-end leva o usuário direto para a tela de troca de senha (RN10).
* `PUT /usuarios/{id}/senha` é restrito à Gestão e recebe a nova senha temporária (mínimo de 8 caracteres — RN10). Responde **409** quando a Gestão tenta redefinir a própria senha por esse caminho, no mesmo padrão da RN11; para isso ela usa `PUT /conta/senha`. Após a redefinição, `troca_senha_obrigatoria` passa a `true`. A regra de nova senha diferente da atual não se aplica a esta redefinição. A redefinição é permitida para usuário bloqueado ou desativado, que continua sem acesso até ser reativado (RN09).
* `PUT /conta/senha` recebe a senha atual e a nova (mínimo de 8 caracteres — RN10); senha atual incorreta ou nova senha igual à atual são rejeitadas com **400** e mensagem clara (não 401, que o front-end trata como sessão expirada). Após a troca, `troca_senha_obrigatoria` volta a `false`. O endpoint não devolve token novo: o token usado na troca também deixa de valer, e o usuário precisa fazer login novamente (RN12).
* Enquanto `troca_senha_obrigatoria` for `true`, as rotas protegidas respondem **403** com mensagem clara, exceto `PUT /conta/senha` (RN10). Esse 403 traz também `codigo: "TROCA_SENHA_OBRIGATORIA"` (v1.8 — Issue #72).
* **Limite de tentativas (v1.8):** `POST /auth/login` e `PUT /conta/senha` aceitam até **5 tentativas com falha em 15 minutos**, contadas por chave: no login, IP + e-mail informado; na troca de senha (`PUT /conta/senha`), IP + usuário logado. Acima disso, respondem **429** com o cabeçalho `Retry-After`. O contador fica em memória (dependência `express-rate-limit` — Seção 10). O limite não bloqueia a conta: o status do usuário não muda (RN07). Detalhes implementados (v1.9 — Issue #90): além do `Retry-After`, as respostas desses endpoints trazem os cabeçalhos `RateLimit` e `RateLimit-Policy`; o corpo do 429 é o mesmo para qualquer e-mail (não revela se a conta existe); só contam as tentativas com falha — **401** no login e **400** na troca de senha —, e as demais respostas não somam.
* **Limite por IP no login (v1.13 — Spike #130):** além do limite por IP + e-mail, o `POST /auth/login` tem um segundo limite, contado **só pelo IP**: até **100 tentativas com falha em 15 minutos**. Vale o mesmo critério de falha (só o **401** conta), a mesma mensagem no corpo do **429** e o cabeçalho `Retry-After`; o contador também fica em memória e também não bloqueia a conta (RN07). O primeiro dos dois limites que for atingido recusa a tentativa. Motivo: o limite por IP + e-mail não impede que alguém teste uma mesma senha em muitos e-mails diferentes; o limite por IP fecha essa brecha. O valor é alto porque, na escola, todos os aparelhos saem para a internet por um único IP público, e um limite baixo bloquearia a escola inteira por causa dos erros de digitação de vários usuários. A troca da própria senha (`PUT /conta/senha`) continua só com o limite por IP + usuário logado.
* **Caractere nulo no login (v1.11 — Issue #127):** e-mail com o caractere nulo (U+0000) no `POST /auth/login` responde **400** com mensagem genérica, sem revelar se o e-mail existe, e não conta no limite de tentativas, que só conta o **401** (Seção 11).
* Toda troca de senha atualiza `senha_alterada_em`. Um token só vale se tiver sido emitido depois de `senha_alterada_em`; o middleware de autenticação rejeita os demais (RN12). O tratamento de tokens emitidos no mesmo segundo da troca fica a cargo da implementação.
* As trocas de senha ("senha redefinida pela Gestão" e "senha alterada pelo usuário") são registradas no `LogAuditoria` (RNF04), nunca com a senha.
* `POST /auth/recuperar-senha` permanece reservado para uma etapa futura (redefinição por link enviado ao e-mail), dependente do Spike #19 e de nova decisão; não é requisito no momento.
* Corpos das trocas de senha (adotados na Issue #18): `PUT /usuarios/{id}/senha` recebe `{ novaSenha }` e `PUT /conta/senha` recebe `{ senhaAtual, novaSenha }`. Ambos respondem **204**, sem corpo, quando a troca é feita.
* `PUT /usuarios/{id}`, `PUT /usuarios/{id}/senha` e `PUT /conta/senha` respondem **409**, com mensagem para tentar de novo, quando uma alteração concorrente do mesmo usuário impede concluir a operação (transação repetida sem sucesso).
* **Troca da própria senha concorrente com a redefinição pela Gestão (v1.11 — Issue #127):** se a senha do usuário mudar entre a conferência da senha atual e a gravação (ex.: redefinição pela Gestão em `PUT /usuarios/{id}/senha`), o `PUT /conta/senha` é recusado com **409** e `codigo: "CONFLITO_CONCORRENTE"`, sem gravar nada. Assim, a senha temporária e a troca obrigatória definidas pela Gestão são preservadas (RN10).
* O campo `recurso` do `LogAuditoria` segue o formato `<recurso-da-API>/<id>` (ex.: `usuarios/6`). `acao` e `recurso` nunca contêm senha, hash, token ou dados pessoais, apenas textos fixos e identificadores numéricos (RNF04, RNF06).

Observações sobre cadastros e ocorrências (v1.6, atualizadas na v1.8 e na v1.9):

* **Convenção de campos:** os corpos JSON da API usam camelCase (ex.: `nomeCompleto`, `codigoEscolar`, `turmaId`, `tutorId`, `dataHora`, `senhaAtual`), e o banco usa snake_case (Seção 11). Identificadores e números no corpo chegam como número JSON (texto, como `"3"`, é recusado com **400**). Campos fora do contrato são ignorados (ex.: `status` ou `profissionalResponsavelId` no registro da ocorrência).
* **Limites (v1.7, atualizados na v1.8):** tamanhos de texto e quantidades seguem a tabela "Limites de tamanho e quantidade" da Seção 11; acima deles, a resposta é **400**.
* **Datas informadas (RN17):** `dataHora` segue o formato ISO 8601 com fuso horário obrigatório (`Z` ou `±hh:mm`, ex.: `2026-10-20T14:30:00-03:00`); sem fuso, data inexistente (ex.: 30 de fevereiro) ou fora da faixa técnica da Seção 11, a resposta é **400**.
* **Conflito concorrente:** os cadastros de categorias, turmas e estudantes e as gravações de ocorrências (registro, encaminhamento, comunicação, providência e encerramento) rodam em transação serializável; quando uma operação simultânea impede concluir e as novas tentativas se esgotam, a resposta é **409**, com mensagem para tentar de novo (mesmo padrão dos usuários).
* **Códigos de resposta:** **400** para entrada inválida, inclusive referência inexistente no corpo (turma, estudante, categoria ou usuário); **404** para o recurso da URL inexistente ou fora da visibilidade do usuário (RN19); **403** para perfil sem permissão (ex.: RN22); **409** para duplicidade (RN18) e para operações recusadas pelo estado da ocorrência ou pelo vínculo de tutoria (RN04, RN13, RN15, RN16) ou pelo acompanhamento de ocorrências (RN23 — v1.13). Todas as respostas **409** trazem, além da mensagem, um campo `codigo` estável (v1.8 — Issue #72, D1). **429** quando o limite de tentativas do login ou da troca de senha é excedido (ver as observações de autenticação). Não há `DELETE` para turmas, estudantes nem categorias (RN21).
* **Formato dos erros (v1.9):** as respostas de erro trazem o corpo `{ erro }`, com mensagem clara e sem detalhes internos; nos 409 e no 403 de troca de senha pendente, trazem também o campo `codigo` (Issue #72, D1). Os demais erros não trazem `codigo`. Valores (catálogo único, nomes aprovados pelo Rafael em 15/11/2026):

| `codigo` | Situação | Endpoints | Regra |
| ---------- | -------- | --------- | ----- |
| `CONFLITO_CONCORRENTE` (409) | Outra operação simultânea impediu concluir (novas tentativas esgotadas) | Gravações de categorias, turmas, estudantes, usuários, senhas e ocorrências | Conflito concorrente |
| `EMAIL_DUPLICADO` (409) | E-mail já usado por outro usuário | `POST /usuarios`, `PUT /usuarios/{id}` | RF02 |
| `CATEGORIA_DUPLICADA` (409) | Categoria com o mesmo nome | `POST`/`PUT /categorias` | RN18 |
| `TURMA_DUPLICADA` (409) | Turma com o mesmo nome, etapa e ano letivo | `POST`/`PUT /turmas` | RN18 |
| `CODIGO_ESCOLAR_DUPLICADO` (409) | Código escolar já usado | `POST`/`PUT /estudantes` | RN18 |
| `GESTAO_ATIVA_MINIMA` (409) | A edição deixaria menos de dois usuários Gestão ativos | `PUT /usuarios/{id}` | RN11 |
| `ALTERAR_PROPRIO_ACESSO` (409) | A Gestão tenta bloquear, desativar ou mudar o perfil da própria conta | `PUT /usuarios/{id}` | RN11 |
| `REDEFINIR_PROPRIA_SENHA` (409) | Redefinir a própria senha pela rota de administração | `PUT /usuarios/{id}/senha` | RF03 |
| `TUTOR_COM_TUTORADOS` (409) | Mudar o perfil de um Tutor com estudantes vinculados | `PUT /usuarios/{id}` | RN13 |
| `RESPONSAVEL_COM_OCORRENCIAS` (409) | Mudar para Professor ou Técnico-administrativo o perfil do responsável pelo acompanhamento de ocorrências não encerradas (v1.13) | `PUT /usuarios/{id}` | RN23 |
| `OCORRENCIA_ENCERRADA` (409) | Ocorrência encerrada: não recebe encaminhamento, comunicação, providência nem novo encerramento | encaminhamentos, comunicações, providências, `PATCH /status` | RN04, RN15, RN16 |
| `OCORRENCIA_ABERTA` (409) | Providência ou encerramento com a ocorrência ainda aberta | providências, `PATCH /status` | RN04 |
| `ENCERRAMENTO_SEM_PROVIDENCIA` (409) | Encerrar sem nenhuma providência registrada | `PATCH /ocorrencias/{id}/status` | RN04 |
| `TROCA_SENHA_OBRIGATORIA` (403) | Troca de senha obrigatória pendente | Rotas protegidas, exceto `PUT /conta/senha` | RN10 |

* **Cabeçalho do 401 e rota inexistente (v1.9):** as respostas **401** das rotas protegidas (token ausente, inválido ou expirado, ou sessão encerrada — RN09, RN12) trazem o cabeçalho `WWW-Authenticate: Bearer`; o 401 de credenciais inválidas do `POST /auth/login` não traz. Um caminho inexistente fora de `/auth` responde **404** com token válido, **401** sem token e **403** com a troca de senha pendente (RN10).
* **Cache das respostas (v1.11 — Issue #127):** todas as respostas da API trazem o cabeçalho `Cache-Control: no-store`, para que dados pessoais não fiquem no cache do navegador (RNF06).
* **Permissões:** seguem a matriz da Seção 4 (`permitirPerfis`), com as restrições de visibilidade da RN19 e de dados da RN20.
* `GET /usuarios`: para a Gestão, a resposta é completa. Para os demais perfis, traz apenas `id`, `nome` e `perfil` dos usuários com status `ATIVO` e perfil `TUTOR`, `PEDAGOGICO` ou `GESTAO`, e aceita o filtro `?perfil=` (RN20). Para a Gestão, o filtro `?perfil=` é ignorado e a lista completa é devolvida (decisão da Issue #44). Nas telas de ocorrência, a lista de usuários usada é a reduzida (v1.8 — Issue #72, D5; **previsto, fora desta entrega** — v1.9).
* `PUT /usuarios/{id}` responde **409** quando a edição muda o perfil de um usuário Tutor que tem estudantes vinculados (RN13).
* `PUT /usuarios/{id}` responde **409** com `codigo: "RESPONSAVEL_COM_OCORRENCIAS"` quando a edição muda para Professor ou Técnico-administrativo o perfil de um usuário que é o responsável pelo acompanhamento de ocorrências não encerradas (v1.13 — RN23). A mudança entre `TUTOR`, `PEDAGOGICO` e `GESTAO` não é recusada por essa regra. Quando a RN13 (`TUTOR_COM_TUTORADOS`) e a RN23 se aplicam ao mesmo tempo, a RN13 é verificada primeiro (decisão do Rafael, 23/11/2026).
* `POST /turmas` e `PUT /turmas/{id}` recebem `{ nome, etapa, anoLetivo }` (obrigatórios também no `PUT`; `anoLetivo` inteiro de 4 dígitos, de 1000 a 9999, enviado como número). Turma duplicada no mesmo ano letivo responde **409** (RN18).
* `GET /estudantes` aceita `?turmaId=`. Para quem não é Gestão, devolve apenas `id`, `nomeCompleto`, `turma` e `tutor` (`{ id, nome }` ou `null`, sem e-mail e sem status) (RN20). `POST /estudantes` e `PUT /estudantes/{id}` recebem `{ nomeCompleto, codigoEscolar?, turmaId, tutorId? }`; `tutorId: null` no `PUT` desvincula o tutor; `codigoEscolar` ou `tutorId` ausentes no `PUT` mantêm o valor atual (decisão da Issue #42). Tutor que não tem perfil Tutor ou não está ativo responde **400** (RN13); código escolar duplicado responde **409** (RN18).
* `POST /categorias` e `PUT /categorias/{id}` recebem `{ nome, descricao? }`. No `PUT`, `descricao` ausente mantém a descrição atual, e `null` ou texto vazio a apaga (decisão da Issue #38). Nome duplicado responde **409** (RN18).
* `POST /ocorrencias` recebe `{ dataHora, local, turmaId, categoriaId, descricao, estudanteIds[], demaisEnvolvidos?, testemunhas?, providenciasImediatas?, observacoes?, encaminhamentos[] }`, com ao menos um estudante (RN02) e ao menos um encaminhamento `{ destinatarioPerfil, destinatarioUsuarioId?, observacao? }` (RN03). O profissional responsável é o usuário logado, nunca um valor do corpo (RN02). A ocorrência, os estudantes, os encaminhamentos e o histórico são gravados em uma única transação, e a ocorrência nasce com status `ABERTO`. No registro, encaminhamentos repetidos (mesmo `destinatarioPerfil` e mesmo `destinatarioUsuarioId`, inclusive ambos sem usuário) são recusados com **400** (decisão da Issue #45). Responde **201** com a ocorrência registrada, no formato do detalhe sem comunicações, sem providências e sem código escolar dos estudantes.
* `GET /ocorrencias` devolve, de forma **resumida**, as ocorrências visíveis ao usuário (RN19), da mais recente para a mais antiga (data/hora do fato e, no empate, o identificador, decrescentes). Cada item traz `id`, `dataHora`, `local`, `status`, `turma`, `categoria`, `profissionalResponsavel` e `estudantes` (`id` e `nomeCompleto`); descrição, demais textos, encaminhamentos, comunicações e providências ficam só no detalhe (decisão da Issue #47). Na v1.8, a resposta deixa de ser uma lista e passa a ser paginada, no formato `{ itens, total, pagina, tamanhoPagina }`, com os itens nesse mesmo formato resumido (muda o contrato da Issue #47; ver "Filtros e paginação" abaixo).
* **Filtros e paginação do `GET /ocorrencias` (v1.8 — RF11, UC03):** aceita os filtros `estudanteId`, `turmaId` (turma **da ocorrência** — RN14), `categoriaId`, `status`, `dataInicio` e `dataFim` (formato `AAAA-MM-DD`, dias inteiros no fuso `America/Sao_Paulo`, com as duas pontas incluídas, aplicados sobre a data/hora do fato), `profissionalResponsavelId` (quem registrou a ocorrência — RN02) e `pagina`. Os filtros são combinados com E lógico e **sempre** limitados pela visibilidade do usuário (RN19). A paginação é de **20 itens por página**. Na tela, o filtro por profissional aparece só para a Gestão. Detalhes implementados (v1.9 — Issue #86): `pagina` tem padrão 1; uma página além da última responde **200** com `itens: []`; ids dos filtros e `pagina` inválidos respondem **400**; parâmetros desconhecidos são ignorados; um id válido de registro inexistente não é erro (apenas não encontra ocorrências).
* **Datas dos filtros e dos relatórios (v1.9 — Issues #86 e #88):** em `GET /ocorrencias` e `GET /relatorios`, `dataInicio` posterior a `dataFim`, data inválida (fora do formato `AAAA-MM-DD` ou inexistente), vazia ou repetida na query responde **400**. Em `GET /ocorrencias`, as datas são opcionais e independentes (pode-se informar só uma delas); em `GET /relatorios`, as duas são obrigatórias.
* `GET /ocorrencias/{id}` devolve a ocorrência com todos os campos do registro, profissional responsável, responsável pelo acompanhamento, estudantes, categoria, turma, encaminhamentos, comunicações e providências adotadas (decisão da Issue #47). Para quem não é Gestão, os estudantes vêm sem o código escolar (RN20). Na v1.8, o detalhe passa a trazer também o tutor dos estudantes (Issue #72, D3; **previsto, fora desta entrega** — v1.9).
* `POST /ocorrencias/{id}/encaminhamentos` recebe `{ destinatarioPerfil, destinatarioUsuarioId?, observacao?, responsavelAcompanhamentoId? }`, com as regras de destinatário da RN03 e de status e responsável da RN15. Responde **201** com o **detalhe completo** da ocorrência já atualizada, no mesmo formato do `GET /ocorrencias/{id}` (código escolar só para a Gestão — RN20), e não apenas o encaminhamento criado (decisão da Issue #49).
* `POST /ocorrencias/{id}/comunicacoes` recebe `{ destinatario, meio, descricao, dataHora }`, todos obrigatórios, com as regras da RN16 e da RN17. Responde **201** com o **detalhe completo** da ocorrência, já com a nova comunicação, no mesmo formato do `GET /ocorrencias/{id}` (decisão da Issue #51).
* `POST /ocorrencias/{id}/providencias` (v1.8) recebe `{ descricao }` (até 5000 caracteres — Seção 11), com as regras da RN04 e da RN22. Responde **201** com o **detalhe completo** da ocorrência, no mesmo formato do `GET /ocorrencias/{id}`.
* `PATCH /ocorrencias/{id}/status` (v1.8) recebe `{ status: "ENCERRADO" }`, com as regras da RN04 e da RN22. Responde **200** com o **detalhe completo** da ocorrência, no mesmo formato do `GET /ocorrencias/{id}`. Detalhes implementados (v1.9 — Issue #82): `status` ausente ou fora do enum responde **400**; `ABERTO` ou `EM_ACOMPANHAMENTO` no corpo responde **400**; ocorrência `ABERTO`, ocorrência já `ENCERRADO` ou sem providência registrada responde **409**.
* **Ordem dos erros na providência e no encerramento (v1.9 — Issues #81 e #82):** **400** (entrada inválida) → **404** (inexistente ou fora da visibilidade — RN19) → **403** (Tutor que não é o responsável pelo acompanhamento — RN22) → **409** (estado da ocorrência — RN04). Professor e Técnico-administrativo recebem **403** já na rota, antes dessas verificações (decisão do Rafael, 12/11/2026).
* `PUT /ocorrencias/{id}` fica fora do MVP (v1.8); a linha da tabela acima é mantida apenas como reservada.
* `GET /ocorrencias/{id}/historico` (v1.8 — RF12) devolve os registros do histórico do mais antigo para o mais novo, cada um no formato `{ id, acao, descricao, dataHora, usuario: { id, nome } }`, para quem vê a ocorrência (RN19).
* `GET /relatorios` (v1.8 — RF13, UC05) é restrito à Gestão e à Equipe Pedagógica. Parâmetros: `tipo` ∈ `periodo`, `turma`, `categoria`, e `dataInicio`/`dataFim`, todos **obrigatórios**. O relatório traz o total de ocorrências do intervalo e, conforme o tipo, linhas por turma da ocorrência (RN14) ou por categoria, **sem linhas com zero**. Entram ocorrências de todos os status, e cada ocorrência conta uma vez. A tela exibe o relatório em tabela, com impressão pelo navegador; não há exportação (Seção 5). Formato da resposta (v1.9 — Issue #88): `{ tipo, dataInicio, dataFim, total, linhas: [{ id, rotulo, quantidade }] }`; no tipo `periodo`, `linhas` vem vazio; o rótulo da turma segue o formato "nome — etapa (ano)"; as linhas seguem a ordem alfabética natural do rótulo (números comparados pelo valor, ex.: "6º A" antes de "10º A" — decisão do Rafael, 12/11/2026) e, no empate, o `id`.
* **Histórico (RN08):** o registro da ocorrência, cada encaminhamento, a mudança de status, a definição ou troca do responsável pelo acompanhamento, cada comunicação e cada providência geram um registro em `HistoricoOcorrencia`, com ação em texto fixo: "ocorrência registrada", "encaminhamento registrado" (descrição com o tipo de destinatário, ex.: "Destinatário: tutor"), "status alterado" (ex.: "De aberto para em acompanhamento"; no encerramento, "De em acompanhamento para encerrado" — v1.8), "responsável pelo acompanhamento definido", "responsável pelo acompanhamento alterado", "comunicação registrada" (sem o destinatário, o meio ou a descrição da comunicação) e "providência registrada" (v1.8).
* **Auditoria (RNF04):** a criação e a edição de turmas, estudantes, categorias e ocorrências, o registro de encaminhamento e o registro de comunicação são registrados no `LogAuditoria`, com `recurso` no formato `<recurso-da-API>/<id>` (ex.: `turmas/3`, `ocorrencias/12`), sem nomes de estudantes nem outros dados pessoais. Na v1.8, também são registrados "providência registrada", "ocorrência encerrada", "usuário criado" e "usuário editado". Na v1.9, o script de recuperação da Gestão (Seção 10, Issue #80) registra "senha redefinida pelo script de recuperação" e, quando reativa o usuário, "usuário reativado pelo script de recuperação", com `usuario_id` nulo. Não há tela nem endpoint de consulta do `LogAuditoria`.

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
| 1.6    | 25/10/2026 | Decisões do planejamento da Sprint 2 (D1 a D9), de 15/10/2026, e correções da auditoria pré-Sprint 2, aprovadas na mesma data: RN11 passa a exigir dois usuários Gestão ativos, com script de recuperação fora da API (Seção 10); RN10 com troca obrigatória de senha também no cadastro (Seções 11 e 12); campo `ano_letivo` na Turma, com unicidade (nome, etapa, ano letivo) (RN18, Seções 11 e 12); tutor (identificador e nome) visível a todos os perfis na lista de estudantes (RN20, Seção 12); nota na RN19 sobre a condição que hoje não ocorre para Professor e Técnico-administrativo; tolerância de 5 minutos na RN17; "até 8 horas, com tolerância técnica de segundos" na RNF03; variáveis de ambiente na Seção 10; "Versão do produto" no cabeçalho (Seção 1). Decisões do planejamento: RN02 (profissional responsável é o usuário logado), RN03 (encaminhamento inicial no registro, na mesma operação, com regras de destinatário), RN06 (orientação no formulário, sem filtro automático) e RN08 (histórico também no registro e na troca do responsável, com ação em texto fixo) ajustadas. Novas RNs: RN13 (quem pode ser tutor e o que acontece com o vínculo; 409 na troca de perfil de um tutor com tutorados), RN14 (turma de referência da ocorrência), RN15 (encaminhamento pela Gestão/Pedagógico e passagem para "em acompanhamento"), RN16 (registro de comunicação), RN17 (datas informadas e datas do sistema; UTC e horário de São Paulo), RN18 (unicidade de categoria, turma e código escolar), RN19 (visibilidade de ocorrências por perfil), RN20 (consulta de dados de apoio por todos os perfis, com dados reduzidos) e RN21 (sem exclusão de turmas, estudantes e categorias). Referências às RNs nos RF05, RF07, RF08, RF09, RF15 e RF16 (Seção 8) e na Seção 10. Observações e ponto a validar com a escola na matriz (Seção 4), que foi mantida. Seção 11: unicidades, origem das datas, turma de referência, regra do tutor, valores técnicos de status da ocorrência e de destinatário e seeds. Seção 12: permissões por endpoint, contratos de `/turmas`, `/estudantes`, `/categorias`, `/ocorrencias`, encaminhamentos e comunicações, convenção camelCase, códigos 400/404/409, histórico e auditoria dos cadastros. Pendências da Issue #18 registradas: corpos `{ novaSenha }` e `{ senhaAtual, novaSenha }`, resposta 204 nas trocas de senha, 409 em alteração concorrente e formato `<recurso>/<id>` do `LogAuditoria` |
| 1.7    | 01/11/2026 | Registro das decisões da Sprint 2 (Issues #38–#52) já implementadas, sem regra nova. RN15: o mesmo responsável em "em acompanhamento" não é troca, e encaminhar de novo ao mesmo destinatário é permitido (#49). RN16: a comunicação não altera o status (#51). RN18: o código escolar diferencia maiúsculas de minúsculas (#42). RN19: a visibilidade do Tutor usa o vínculo de tutoria atual do estudante (#47). Seção 11: nova tabela "Limites de tamanho e quantidade" (usuário, categoria, turma, estudante, ocorrência com até 50 estudantes e 10 encaminhamentos no registro, encaminhamento e comunicação), recusa do caractere nulo (U+0000) nos textos de ocorrência, encaminhamento e comunicação e faixa técnica de anos 0001–9999 da data/hora, sem data mínima de negócio. Seção 12: ids no corpo como número JSON e campos fora do contrato ignorados; formato ISO 8601 com fuso obrigatório para `dataHora`; 409 em conflito concorrente nos cadastros e nas gravações de ocorrências; `?perfil=` ignorado para a Gestão no `GET /usuarios` (#44); `PUT /categorias` sem `descricao` mantém a atual (#38); `PUT /estudantes` sem `codigoEscolar`/`tutorId` mantém os valores (#42); faixa 1000–9999 do `anoLetivo` (#40); encaminhamentos repetidos recusados no `POST /ocorrencias` (#45) e corpo do 201 desse endpoint; lista resumida do `GET /ocorrencias` e providências e responsáveis no detalhe (#47); 201 com o detalhe completo da ocorrência no `POST /ocorrencias/{id}/encaminhamentos` (#49) e no `POST /ocorrencias/{id}/comunicacoes` (#51); ações fixas do histórico; auditoria também do encaminhamento e da comunicação |
| 1.8    | 11/11/2026 | Decisões do planejamento da Sprint 3, de 03/11/2026, e decisão de 11/11/2026 sobre o deploy pela `developer` (Issue #77). RN04: providência só em "em acompanhamento" (409 em "aberto" ou "encerrado"); encerramento pelo `PATCH /ocorrencias/{id}/status`, que aceita somente `ENCERRADO`, sem justificativa, com 409 sem providência registrada e `data_encerramento` preenchida pelo sistema; sem reabertura. Nova RN22: providência e encerramento pela Gestão, pela Equipe Pedagógica e pelo responsável pelo acompanhamento; 403 para o Tutor que vê a ocorrência mas não é o responsável e para Professor e Técnico-administrativo. RN17: `data_encerramento` é o momento do registro. Referências às RNs nos RF10, RF11, RF12 e RF13 (Seção 8). Observação na matriz (Seção 4) apontando a RN22; a matriz foi mantida como proposta até a homologação (#95). Seção 10: deploy da homologação automático a partir da `developer`, com merge `developer` → `main` só na entrega do MVP (#96); dependência `express-rate-limit`; script de recuperação da Gestão com senha temporária por variável de ambiente, Gestão identificada pelo e-mail e reativação da Gestão que não estiver ativa; documentação da API em `docs/openapi.yaml`, sem Swagger UI; RN01–RN22 nos services. Seção 11: limite de 5000 caracteres na `descricao` da providência e origem da `data_encerramento`. Seção 12: filtros (`estudanteId`, `turmaId`, `categoriaId`, `status`, `dataInicio`/`dataFim`, `profissionalResponsavelId`, `pagina`) e paginação de 20 itens no `GET /ocorrencias`, com resposta `{ itens, total, pagina, tamanhoPagina }` (muda o contrato da #47); contratos do `POST /ocorrencias/{id}/providencias` (201), do `PATCH /ocorrencias/{id}/status` (200), do `GET /ocorrencias/{id}/historico` e do `GET /relatorios` (só Gestão e Pedagógico, tabela com impressão pelo navegador, sem exportação); `PUT /ocorrencias/{id}` reservado, fora do MVP; ações "providência registrada" e "status alterado" (encerramento) no histórico; auditoria de providência, encerramento e criação e edição de usuários, sem tela nem endpoint de consulta; limite de 5 tentativas com falha em 15 minutos (IP + e-mail, 429 com `Retry-After`) no login e na troca de senha; itens da #72: `codigo` estável em todos os 409 (D1), tutor no detalhe da ocorrência (D3), `GET /usuarios` reduzido nas telas de ocorrência (D5) e `codigo: "TROCA_SENHA_OBRIGATORIA"` no 403 de troca de senha pendente |
| 1.9    | 14/11/2026 | Registro, para a entrega do MVP (#96), do que foi decidido e implementado na Sprint 3 e ainda não estava no SSD, sem regra nova (Issue #113). UC04: passo 2 sem "e novas observações" (o `PUT /ocorrencias/{id}` está fora do MVP), com referência à RN22 (decisão do Rafael, 14/11/2026) — Seção 7. Seção 10: nova subseção "Front-end" com a página 404, o título por tela, o bloqueio de buscadores e os favicons (#78) e as páginas de privacidade e termos com texto provisório e o telefone da escola no rodapé (#92); `trust proxy` = `1` (um proxy à frente da API no Render); script de recuperação da Gestão entregue na #80 (senha só por `RECUPERACAO_SENHA_TEMPORARIA`, `DATABASE_URL` do terminal, sem ler o `.env`, encerramento das sessões — RN12 — e auditoria com `usuario_id` nulo); homologação ainda não publicada, com o projeto rodando localmente (decisão do Rafael, 13/11/2026). Seção 11: o seed de desenvolvimento também cria um usuário fictício por perfil; pendências reservadas para depois da homologação, sem mudança de regra (seed da Gestão inicial sem troca obrigatória; Gestão com troca pendente contando na RN11). Seção 12: formato `{ tipo, dataInicio, dataFim, total, linhas }` do `GET /relatorios`, com `linhas` vazio no tipo `periodo`, rótulo da turma "nome — etapa (ano)" e ordem alfabética natural (decisão do Rafael, 12/11/2026) com desempate pelo `id` (#88); validação das datas em `/ocorrencias` (opcionais e independentes) e em `/relatorios` (obrigatórias) (#86, #88); padrão de `pagina`, página além da última, ids inválidos, parâmetros desconhecidos e id inexistente no `GET /ocorrencias` (#86); respostas 400 e 409 do `PATCH /ocorrencias/{id}/status` (#82); ordem dos erros 400 → 404 → 403 → 409 na providência e no encerramento, com 403 na rota para Professor e Técnico-administrativo (decisão do Rafael, 12/11/2026) (#81, #82); cabeçalhos `RateLimit` e `RateLimit-Policy`, corpo do 429 igual para qualquer e-mail e contagem só das falhas (#90); formato `{ erro }` dos erros, `WWW-Authenticate: Bearer` no 401 e respostas a caminho inexistente; ações de auditoria do script de recuperação; itens da #72: `codigo` (D1) implementado (Issue #72, D1), com o catálogo de 13 valores de `codigo` registrado na Seção 12 (nomes aprovados pelo Rafael em 15/11/2026), e tutor no detalhe (D3) e `GET /usuarios` reduzido nas telas de ocorrência (D5) marcados como previstos, fora desta entrega. A matriz da Seção 4 continua como proposta até a homologação (#95) |
| 1.10   | 15/11/2026 | Registro do que mudou depois da v1.9, sem regra nova (Issue #122). Seção 10: nova linha "Situação após a entrega do MVP", mantida a situação da v1.9 (decisão de 13/11/2026): merge `developer` → `main` feito em 15/11/2026 (PR #121, Issue #96) e testes de ponta a ponta (#93) aprovados contra banco real (350/350); homologação publicada em 15/11/2026 (#79), com front-end em https://sisto.onrender.com (Static Site no Render, com reescrita para as rotas do React), API em https://sisto-api.onrender.com (Web Service no Render, plano Free) e banco no projeto Neon `sisto` (`aws-sa-east-1`, PostgreSQL 18); deploy automático a partir da `developer`, com build da API `npm ci && npm run db:deploy`, seed só no primeiro deploy para criar a Gestão inicial e variáveis `SEED_GESTAO_*` removidas; senha da Gestão inicial trocada e segunda Gestão cadastrada (RN11); somente dados fictícios (RN05). Pendências registradas em `docs/deploy.md`: teste do script de recuperação (#80) contra o Neon não executado, previsto para antes da homologação com a escola (#95), e conferência do `trust proxy` no Render não executada |
| 1.11   | 23/11/2026 | Registro da revisão de segurança antes da homologação com a escola, sem regra de negócio nova (Issue #127). Seção 10: dependências `body-parser` atualizada (negação de serviço) e Prisma 7.10.1, com risco aceito do alerta alto no pacote `effect` (só na linha de comando, nunca na API; a correção do npm rebaixaria o Prisma para a versão 6); variável opcional `DIAGNOSTICO_PROXY=1` para conferir o `trust proxy` (IP e `X-Forwarded-For` no `POST /auth/login`, sem e-mail nem senha, desligada fora da conferência — RNF06); cabeçalhos de segurança no Static Site do front-end (CSP restrita, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`), configurados no painel do Render e documentados em `docs/deploy.md`. Seção 11: recusa do caractere nulo (U+0000), com 400 e a mesma mensagem, também no nome e no e-mail do usuário (cadastro e edição), no nome e na etapa da turma, no nome e na descrição da categoria, no nome completo e no código escolar do estudante e no e-mail do login. Seção 12: no login, o caractere nulo responde 400 com mensagem genérica, sem revelar se o e-mail existe e sem contar no limite de tentativas; `PUT /conta/senha` recusado com 409 `CONFLITO_CONCORRENTE`, sem gravar, quando a senha muda entre a conferência da senha atual e a gravação, preservando a redefinição pela Gestão (RN10); `Cache-Control: no-store` em todas as respostas da API (RNF06). RFs e modelo de dados sem alteração |
| 1.12   | 23/11/2026 | Resultado da conferência do `trust proxy` no Render (Issue #127): o `X-Forwarded-For` chega com três endereços (cliente, borda Cloudflare e balanceador interno do Render), e o `trust proxy` passa de `1` para `3` para que o limite de tentativas use o IP real do cliente — Seção 10. Sem regra de negócio nova |
| 1.13   | 23/11/2026 | Decisões do Rafael na Spike #130 (pós-MVP). Nova RN23: a alteração do perfil do responsável pelo acompanhamento de ocorrências não encerradas para Professor ou Técnico-administrativo é recusada (HTTP 409) até a Gestão ou a Equipe Pedagógica trocar o responsável; a mudança entre Tutor, Pedagógico e Gestão continua permitida (RN15, RN22). RF04 passa a citar as restrições de perfil das RN13 e RN23 (Seção 8). Seção 10: RN01–RN23 nos services; turmas filtradas por padrão pelo ano letivo atual (horário de São Paulo) no registro de ocorrência e na tela de estudantes, com opção de ver os anos anteriores, sem mudança na API; Build Commands da API e do front-end no Render passam a rodar `npm test` antes de publicar (teste com falha impede o deploy), com os testes de ponta a ponta mantidos locais e sem CI no GitHub (a `.github/` não pode ser alterada). Seção 12: segundo limite de tentativas no `POST /auth/login`, só por IP (100 falhas em 15 minutos, mesmo critério do 401, mesma mensagem do 429 e `Retry-After`), contra o teste de uma senha em muitos e-mails, com valor alto porque a escola sai por um único IP público; a troca da própria senha mantém só o limite atual; 409 no `PUT /usuarios/{id}` pela RN23 e novo valor `RESPONSAVEL_COM_OCORRENCIAS` no catálogo de `codigo` (14 valores). Modelo de dados sem alteração |

---

## Princípio

> **Este SSD é a única fonte de verdade do sistema.** Toda implementação, revisão e validação deve estar fundamentada neste documento.

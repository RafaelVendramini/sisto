# Roteiro de fala — MINT 2026.2 (Sisto)

Apresentação de **10 minutos** + 5 minutos de arguição. O apresentador é **sorteado na hora**: Rafael e Gabriel precisam ensaiar o roteiro inteiro.

Slides: [slides-mint.html](slides-mint.html) (abrir no navegador, em tela cheia com F11) ou [Sisto-MINT.pdf](Sisto-MINT.pdf). Vídeo: [demo-mint.webm](demo-mint.webm) (sem áudio, gravado em ambiente local com os dados fictícios do seed, já embutido no slide 8).

## Tempo por slide

| Slide | Tema | Tempo | Acumulado |
| ----- | ---- | ----- | --------- |
| 1 | Capa | 0:30 | 0:30 |
| 2 | Problema | 1:00 | 1:30 |
| 3 | Escopo entregue | 0:50 | 2:20 |
| 4 | Requisitos implementados | 0:45 | 3:05 |
| 5 | Arquitetura | 1:15 | 4:20 |
| 6 | Diferencial: segurança e LGPD | 1:30 | 5:50 |
| 7 | IA: metodologia | 1:15 | 7:05 |
| 8 | Vídeo (narrado) | 2:00 | 9:05 |
| 9 | Melhorias futuras | 0:45 | 9:50 |

Se o tempo apertar, encurte os slides 3 e 4 (os números falam sozinhos). Não corte o 6 (diferencial) nem o 8 (vídeo): cada um vale 1 ponto.

## Fala sugerida

Use como guia, não leia. O importante são as ideias em **negrito**.

### 1. Capa (0:30)

"Boa noite. Somos a equipe LTD.2026.2-006, Rafael Vendramini e Gabriel Luna, com orientação do Prof. Kesede. Vamos apresentar o **Sisto**, um sistema de gestão de ocorrências de alunos, feito para a **Escola Estadual José Carlos Nogueira Reverendo – Professor**."

### 2. Problema (1:00)

- A escola registra **cerca de 50 ocorrências por dia** — indisciplina, conflitos, bullying, evasão, sofrimento emocional.
- Hoje tudo é **papel**: o professor preenche à mão, a equipe pedagógica organiza e depois **digita de novo** na Plataforma Conviva.
- Resultado: papel, retrabalho, risco de perder registros, demora no encaminhamento e **dados sensíveis de menores sem controle de quem vê**.

### 3. Escopo entregue (0:50)

- Em **3 Sprints**, entregamos o MVP 1.0, já **publicado na nuvem** para homologação.
- Mostre os números: **3 Sprints**, **16 de 16 requisitos**, **60 Pull Requests aprovados** e **3.613 testes automatizados**.
- O que ficou fora foi decidido com a escola desde o início: integração com o Conviva, avisos automáticos às famílias, exportação em PDF.

### 4. Requisitos implementados (0:45)

- Os **16 requisitos funcionais do SSD estão implementados**, em 4 módulos: acesso, cadastros, ocorrências e relatórios.
- Além deles, **22 regras de negócio** — por exemplo: toda ocorrência precisa de um estudante e de um destinatário; uma ocorrência encerrada não pode ser reaberta.

### 5. Arquitetura (1:15)

Siga o desenho da esquerda para a direita:

- O usuário usa o **navegador** — computador, tablet ou celular. Não precisa instalar nada.
- O **front-end em React** é um site estático no **Render**, com HTTPS.
- Ele conversa com a **API em Node.js e Express**, também no Render, sempre com **HTTPS e token JWT**.
- A API é organizada em **camadas**: rotas, middlewares (login e permissão), controllers e services, onde ficam as 22 regras.
- Os dados ficam num **PostgreSQL no Neon, em São Paulo**, acessado pelo Prisma.
- Cada mudança entra por **Pull Request aprovado pelo Dev**, com os testes rodados antes do merge, e o deploy é **automático**.

### 6. Diferencial: segurança e LGPD (1:30)

"Nosso diferencial é **segurança e LGPD desde a primeira linha**, porque estamos falando de **dados de crianças e adolescentes**."

- **Cada perfil vê só o que precisa**: são 5 perfis, e a regra é garantida **pela API, não só pela tela** — mesmo que alguém tente acessar direto, a API recusa.
- **Tudo fica registrado**: histórico de cada ocorrência (quem fez, o quê, quando) e auditoria de cadastros e senhas. **Nada é apagado.**
- **Acesso protegido**: senha com hash, sessão de até 8 horas, bloqueio que corta o acesso na hora, limite de tentativas de login.
- **Cuidado com os dados**: banco no Brasil, **só dados fictícios** até a autorização formal da escola, site fora dos buscadores e política de privacidade.
- Feche com a prova: **350 testes de ponta a ponta** contra um banco real, incluindo a matriz de permissões inteira (cada perfil em cada rota).

### 7. IA: metodologia (1:15)

- Usamos o **Claude Code** com uma **equipe de agentes de IA**: analista, dev back-end, dev front-end, QA e revisor. O Dev atua como Tech Lead: **decide e aprova**.
- **Benefícios**: velocidade (agentes em paralelo), todo código chega com testes e revisão, tudo rastreado até o requisito.
- **Problemas reais e como resolvemos**:
  - a IA pode inventar requisito → **o SSD é a única fonte de verdade**;
  - agentes em paralelo geram conflito → **uma branch por Issue**;
  - limite de uso da IA → trabalho em lotes menores;
  - risco com senhas → uma **regra de permissão bloqueia a IA de ler o arquivo de segredos** (`.env`), e ela só usa dados fictícios.
- Regra de ouro: **a IA propõe, o Dev decide** — nenhum commit ou merge sem aprovação humana.

### 8. Vídeo (2:00) — narrar enquanto passa

Dê play e narre pelos tempos (o vídeo não tem áudio):

| Tempo | O que aparece | O que falar |
| ----- | ------------- | ----------- |
| 0:00 | Professor entra | "O professor entra com o próprio e-mail e senha." |
| 0:07 | Registro | "Ele registra uma ocorrência com **dois estudantes de uma vez**, escolhe a categoria e descreve o fato. O sistema orienta a escrever **sem estigmatizar**. Já encaminha ao **tutor** dos alunos." |
| 0:32 | Lista do professor | "Na lista, o professor **só vê o que registrou**." |
| 0:37 | Gestão | "Agora a Gestão abre a ocorrência e **encaminha**, definindo quem acompanha o caso." |
| 0:59 | Comunicação | "Registra o **contato com a família**, que foi feito por telefone." |
| 1:12 | Providência e encerramento | "Registra a **providência** e **encerra**. O sistema avisa que não dá para reabrir." |
| 1:27 | Histórico | "Todo o caminho fica no **histórico**: quem fez cada passo e quando." |
| 1:34 | Relatório | "E a Gestão tira o **relatório por categoria** do período, pronto para imprimir." |

### 9. Melhorias futuras (0:45)

- **Agora**: homologação com a escola — validar a matriz de permissões e a política de privacidade, e obter a autorização para dados reais.
- **Curto prazo**: plano pago para uso real (API sempre ligada e backup automático), recuperação de senha por e-mail, editar ocorrência registrada.
- **Médio prazo**: integração com o Conviva — que acaba com a redigitação —, exportação em PDF e planilha, indicadores e avisos às famílias.
- "Obrigado! Ficamos à disposição para perguntas."

## Perguntas prováveis da arguição

**1. Como vocês garantem que um professor não vê ocorrências de outros?**
A regra está na **API** (middleware de permissão e services), não só na tela. Mesmo chamando a API direto, o professor recebe só as ocorrências que registrou. A matriz inteira (cada perfil em cada rota) é coberta pelos **testes de ponta a ponta** contra banco real (RN01, RN19, RF14).

**2. E a LGPD?**
Finalidade definida (gestão de ocorrências), acesso restrito por perfil, dados reduzidos para quem não é Gestão (por exemplo, sem código escolar — RN20), histórico e auditoria, banco no Brasil, senhas com hash, nenhum dado real até a autorização formal da escola (RN05), site fora dos buscadores e política de privacidade (ainda a validar com a escola).

**3. Se a Gestão esquecer a senha, o sistema trava?**
Não. A regra RN11 exige **dois usuários Gestão ativos**: um redefine a senha do outro. Se os dois perderem o acesso, existe um **script de recuperação** que a equipe técnica roda direto no banco, com registro na auditoria. Ele tem testes automatizados; o teste contra o banco da homologação está marcado para antes da homologação com a escola.

**4. Por que não um aplicativo de celular?**
Escopo do MVP: o sistema web é **responsivo** e funciona no celular sem instalação, o que reduz custo e manutenção. App nativo ficou fora do escopo.

**5. Quanto custa manter isso no ar?**
A homologação usa planos **gratuitos** do Render e do Neon. No plano gratuito a API "dorme" depois de 15 minutos sem uso (o primeiro acesso demora cerca de 1 minuto). Para o uso real, recomendamos um plano pago — decisão a levar à escola.

**6. Por que não dá para apagar ou reabrir uma ocorrência?**
Para preservar o **histórico** e a confiança no registro: a API não tem exclusão de ocorrência, e toda mudança fica registrada (RN04, RN08). Encerrar exige pelo menos uma providência registrada.

**7. Quanto do código a IA escreveu? Vocês entendem o código?**
A IA escreveu a maior parte do código, mas **guiada pelo SSD e pelas Issues** que nós definimos, e **cada entrega passou por revisão, testes e aprovação nossa** antes do merge. As decisões de produto e de arquitetura são da equipe (protocolo AIP).

**8. Quais problemas vocês tiveram com a IA?**
Tendência a ir além do pedido (resolvido com o SSD como fonte única), conflitos entre agentes trabalhando em paralelo (uma branch por Issue), limite de uso (lotes menores) e cuidado com segredos (regra de permissão que bloqueia a leitura do `.env`). No deploy, configurações erradas no painel do Render que precisaram de correção manual.

**9. O que ficou de fora e por quê?**
As Issues #71 (qualidade interna de código e testes) e parte da #72 (melhorias de mensagens e o tutor no detalhe da ocorrência) foram cortadas pela **ordem de corte** planejada da Sprint 3, para garantir a entrega do MVP. Estão documentadas no README.

**10. Por que essa stack (JavaScript, React, Node, PostgreSQL)?**
Uma só linguagem do front ao back, ecossistema grande e gratuito, PostgreSQL relacional para dados com muitas relações (ocorrência, estudantes, encaminhamentos, histórico), e hospedagem gratuita disponível.

**11. Como foi testado?**
Três níveis: **2.245 testes no back-end**, **1.018 no front-end** e **350 de ponta a ponta** contra um PostgreSQL real — 3.613 no total. Rodamos os testes antes de cada merge. Não temos CI rodando os testes no GitHub: o único workflow é o auditor da disciplina; CI é uma melhoria futura.

**12. O sistema aguenta 50 ocorrências por dia?**
Sim, com folga: é um volume pequeno para PostgreSQL. A consulta é paginada (20 por página) e com filtros por estudante, turma, período, categoria e responsável.

**13. A escola já usou?**
Ainda não com dados reais. A **homologação com a escola (#95)** é o próximo passo: validar a matriz de permissões e obter a autorização formal para os dados.

**14. Como funciona o backup?**
O Neon permite restaurar o banco das últimas 6 horas, e a equipe faz uma **cópia semanal criptografada** com `pg_dump`, guardada fora do repositório (RNF05).

## Checklist do dia

- [ ] Ensaiar um dia antes (os dois, porque o apresentador é sorteado).
- [ ] Abrir os slides no navegador **antes** de começar e testar o vídeo do slide 8.
- [ ] Levar os slides também em PDF e o vídeo em pen drive, se a internet falhar.
- [ ] Se for mostrar o site ao vivo, abrir https://sisto.onrender.com uns 2 minutos antes (a API demora cerca de 1 minuto para acordar).
- [ ] Roupa esporte social; falar olhando para todo o público; não ficar de costas para a tela.

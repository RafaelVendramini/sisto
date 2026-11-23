# Deploy da homologação — Sisto

Guia de operação do ambiente de homologação (SSD, Seção 10; Issues #79 e #80): front-end e API no **Render**, banco PostgreSQL no **Neon**, com deploy automático a partir da branch `developer`. O merge `developer` → `main` só acontece na entrega do MVP (#96).

> **Segredos nunca vão para o repositório.** `DATABASE_URL`, `JWT_SECRET`, senhas do seed e a senha temporária da recuperação ficam somente nos painéis do Render/Neon ou no terminal, na hora do uso (SSD, Seção 10; RNF06).
>
> **Dados (RN05):** o ambiente hospedado usa **somente dados fictícios** até a autorização formal da escola.

---

## 1. Contas e acesso

- Contas do **Neon** e do **Render** com acesso restrito à equipe (Rafael e Gabriel) e **verificação em duas etapas** ativada nas duas (RNF06).
- Ninguém fora da equipe recebe acesso aos painéis.

## 2. Banco de dados — Neon

1. Crie um projeto no Neon na região **AWS São Paulo (`aws-sa-east-1`)** (RNF06).
2. Crie o banco (ex.: `sisto`). O Neon mostra a **Connection string** no formato `postgresql://<usuario>:<senha>@<host>/<banco>?sslmode=require`.
3. Use a connection string **direta** (sem `-pooler` no host): o `prisma migrate deploy` precisa de conexão direta.
4. Guarde a connection string só no painel do Render (variável `DATABASE_URL` da API). Não a cole em arquivos do repositório nem em mensagens.
5. Evidência: print do painel do Neon mostrando a região, sem a connection string e sem dados ([evidencias/issue-79/neon-regiao-sao-paulo.png](evidencias/issue-79/neon-regiao-sao-paulo.png)).

## 3. API — Render (serviço web)

Crie um **Web Service** ligado ao repositório `STATURETECH/LTD.2026.2.006`:

| Campo | Valor |
| ----- | ----- |
| Branch | `developer` |
| Root Directory | `src/backend` |
| Runtime | Node |
| Build Command (primeiro deploy) | `npm ci && npm run db:deploy && npm run db:seed` (sem testes: só para criar um serviço do zero; o deploy da homologação já foi feito) |
| Build Command (depois do primeiro deploy) | `npm ci --include=dev && npm test && npm prune --omit=dev && npm run db:deploy` (testes no build — #134) |
| Start Command | `npm start` |
| Auto-Deploy | ligado (cada merge na `developer` publica) |
| Plano | Free |

- O build aplica as migrations (`prisma migrate deploy`). No **primeiro** deploy ele também roda o seed, que, com `NODE_ENV=production`, cria **só** o usuário Gestão inicial.
- Depois do primeiro deploy bem-sucedido, **tire o `&& npm run db:seed` do Build Command e apague `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA` do painel** (seção 5, passo 6). O seed identifica a Gestão pelo e-mail: se ele continuasse no build e a Gestão inicial mudasse o próprio e-mail, o deploy seguinte recriaria uma Gestão ativa com a senha do painel. Sem as variáveis, um seed no build falharia o deploy.
- No plano gratuito a API dorme depois de 15 minutos sem acesso; o primeiro acesso seguinte leva cerca de 1 minuto.
- **Testes no build (SSD 1.13, #134):** o Build Command roda os testes automatizados antes de aplicar as migrations e publicar. Como a API usa `NODE_ENV=production`, o `npm ci` normal não instalaria o `vitest` e o `supertest` (dependências de desenvolvimento); por isso o build usa `--include=dev`, roda `npm test` e remove essas dependências com `npm prune --omit=dev` antes de publicar. Se algum teste falhar, o build falha, as migrations **não** são aplicadas e a versão anterior continua no ar (veja a seção 10). Os testes de ponta a ponta (`npm run test:e2e`) continuam locais, porque precisam de banco próprio.
- Depois do primeiro deploy, anote o endereço da API (ex.: `https://sisto-api.onrender.com`).

**Variáveis de ambiente da API** (Environment, no painel; nunca no repositório):

| Variável | Conteúdo |
| -------- | -------- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` (o projeto exige Node 22.12 ou mais novo) |
| `DATABASE_URL` | connection string direta do Neon |
| `JWT_SECRET` | segredo forte e exclusivo, com 32 caracteres ou mais. Gerar com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGIN` | endereço do front-end, sem barra no fim (ex.: `https://sisto.onrender.com`) |
| `SEED_GESTAO_EMAIL` | e-mail da Gestão inicial (só no primeiro deploy; não use os e-mails fictícios `*@sisto.exemplo` do seed de desenvolvimento) |
| `SEED_GESTAO_SENHA` | senha da Gestão inicial (só no primeiro deploy; mínimo 8 caracteres e máximo 72 bytes; não pode começar com `TROQUE_`) |

> **Limitação conhecida:** o seed cria a Gestão inicial **sem** troca obrigatória de senha, e quem tem acesso ao painel conhece essa senha. Isso será revisto depois da homologação e fica registrado na entrega (#96). Por isso, logo depois do primeiro login: (1) a Gestão inicial **troca a própria senha** (Alterar minha senha — RF03); (2) cadastra a **segunda Gestão** (RN11).

## 4. Front-end — Render (site estático)

Crie um **Static Site** ligado ao mesmo repositório:

| Campo | Valor |
| ----- | ----- |
| Branch | `developer` |
| Root Directory | `src/frontend` |
| Build Command | `npm ci && npm test && npm run build` (testes no build — #134) |
| Publish Directory | `dist` |
| Auto-Deploy | ligado |

**Variáveis:**

| Variável | Conteúdo |
| -------- | -------- |
| `NODE_VERSION` | `22` |
| `VITE_API_URL` | endereço da API (ex.: `https://sisto-api.onrender.com`), sem barra no fim |

`VITE_API_URL` entra no build e fica visível no navegador; por isso **nunca** contém segredo.

**Não** defina `NODE_ENV=production` no Static Site: o `vite` está nas dependências de desenvolvimento, e o `npm ci` deixaria de instalá-lo, quebrando o build.

**Regra de reescrita** (Redirects/Rewrites): Source `/*`, Destination `/index.html`, Action **Rewrite**. Ela faz endereços abertos diretamente (ex.: `/ocorrencias/12`) e a página 404 (#78) chegarem ao React. O Render serve primeiro os arquivos que existem (`robots.txt`, ícones, `manifest.webmanifest`), então eles não são afetados.

**Cabeçalhos de segurança** (Headers, #127): em **Settings → Headers** do Static Site, adicione as regras abaixo, todas com Path `/*`. Elas impedem que o Sisto seja aberto dentro de outro site (clickjacking) e limitam de onde a página pode carregar scripts e para onde pode enviar dados. O front não carrega nada externo (fontes, scripts ou imagens), por isso a política pode ser restrita.

| Name | Value |
| ---- | ----- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://sisto-api.onrender.com; manifest-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

- Se a API mudar de endereço, troque também o `connect-src`; caso contrário, o login para de funcionar (o navegador bloqueia a chamada e mostra o erro no console).
- Se um dia o front passar a usar um recurso externo (ex.: fonte do Google), ele precisa entrar na política.
- O `Strict-Transport-Security` (HSTS) não precisa ser configurado: o Render já o envia em todos os sites (conferido em 23/11/2026).
- Conferência: `curl -sI https://sisto.onrender.com/ | grep -iE "content-security|x-frame|nosniff|referrer"` mostra os 4 cabeçalhos, e o login e as telas funcionam sem erro de "Content Security Policy" no console do navegador (F12).

## 5. Ordem do primeiro deploy

1. Neon pronto (seção 2).
2. Crie a API com todas as variáveis, exceto `CORS_ORIGIN` se ainda não souber o endereço do front-end. Aguarde o build e anote o endereço da API.
3. Crie o front-end com `VITE_API_URL` = endereço da API. Anote o endereço do front-end.
4. Na API, defina `CORS_ORIGIN` = endereço do front-end e faça um novo deploy (Manual Deploy).
5. Entre com a Gestão inicial, troque a senha dela e cadastre a segunda Gestão (seção 3, limitação conhecida).
6. Na API, troque o Build Command para `npm ci --include=dev && npm test && npm prune --omit=dev && npm run db:deploy` e apague `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA`.
7. Faça as conferências da seção 6.

Sem `CORS_ORIGIN` em produção, a API não libera nenhuma origem (falha fechada) e registra um aviso no log.

**Cuidados aprendidos no primeiro deploy (15/11/2026):**

- **Conexão com o GitHub:** o repositório é privado da organização STATURETECH. Conecte o GitHub ao Render pelo navegador do dia a dia; navegadores automatizados são bloqueados pelo GitHub.
- **Valores padrão do Render:** ao criar o Web Service, o Render pode sugerir `Ruby`, branch `main`, Root Directory vazio e Build Command `yarn`. Troque todos: `Node`, `developer`, `src/backend` e o Build Command da tabela acima. Sem o Root Directory, o deploy falha com `Could not read package.json` (código 254).
- **`DATABASE_URL`:** use a do **Neon**, nunca a do `.env` local (com `localhost`, o build falha com `P1001: Can't reach database server`).
- **`NODE_ENV`:** tem que ser `production`. Com `development`, o seed criaria usuários fictícios no banco da homologação.
- **`JWT_SECRET`:** gere um novo para a homologação; não reaproveite o do `.env` local.
- **Plano:** confira o Instance Type **Free** antes de confirmar (o padrão pode ser pago).

Serviços criados em 15/11/2026: API `sisto-api` (<https://sisto-api.onrender.com>) e front-end `sisto` (<https://sisto.onrender.com>); banco no projeto Neon `sisto`, região AWS São Paulo (`aws-sa-east-1`), Postgres 18.

## 6. Conferências depois do deploy

- [x] Front-end e API abrem com **HTTPS**.
- [x] Login da Gestão inicial funciona; ela trocou a própria senha e cadastrou a segunda Gestão (RN11).
- [x] O log do primeiro build da API mostra as migrations aplicadas e o seed criando só o perfil Gestão.
- [x] Seed fora do Build Command e `SEED_GESTAO_*` apagadas do painel.
- [x] A API só libera o endereço do front-end (CORS). Conferência: `curl -s -D - -o /dev/null -X OPTIONS -H "Origin: https://exemplo.invalid" -H "Access-Control-Request-Method: POST" <api>/auth/login` **não** traz `Access-Control-Allow-Origin`; com `-H "Origin: <front>"` traz.
- [x] Um endereço inexistente aberto diretamente (ex.: `/qualquer-coisa`) mostra "Página não encontrada".
- [x] `/robots.txt` abre como arquivo de texto (`curl -I <front>/robots.txt` mostra `content-type: text/plain`).
- [x] Nenhum segredo no repositório nem no build do front-end (conferido em 15/11/2026: busca no repositório e nos arquivos `.js` publicados em https://sisto.onrender.com, que só contêm o endereço da API).
- [ ] Script de recuperação (#80) testado contra o banco do Neon (seção 9), com uma Gestão fictícia. **Pendente:** não executado no primeiro deploy (15/11/2026); o script tem testes automatizados com banco simulado e deve ser testado no Neon antes da homologação com a escola (#95).
- [x] `trust proxy` conferido no Render em 23/11/2026 (#127): o `X-Forwarded-For` chega com três endereços (cliente, borda Cloudflare, balanceador interno do Render), e o valor foi ajustado de `1` para `3`. Repetir a conferência abaixo se o Render mudar a infraestrutura ou se a API mudar de hospedagem.

**Conferência do `trust proxy` (#127):** a API usa `trust proxy` = `3` (cliente → borda Cloudflare → balanceador interno do Render → API). Para confirmar no Render:

1. No Web Service da API, em **Environment**, crie `DIAGNOSTICO_PROXY` com o valor `1` e salve (o serviço reinicia).
2. Descubra o seu IP público (ex.: pesquisando "qual é o meu IP") e faça um login em https://sisto.onrender.com.
3. Em **Logs**, procure a linha `[diagnostico-proxy]`. Ela traz `ip`, `quantidadeEnderecos` e `xForwardedFor`, sem e-mail nem senha.
   - Se `ip` for o **seu IP público**, o valor atual está certo.
   - Se `ip` for um endereço interno (ex.: `10.x.x.x`) e o seu IP aparecer antes em `xForwardedFor`, há mais de um proxy: ajuste `trust proxy` em `src/backend/src/app.js` para a posição do seu IP contada a partir do fim da lista (último = 1, penúltimo = 2) e registre a mudança no SSD.
4. **Apague a variável** `DIAGNOSTICO_PROXY` e salve. O IP é dado pessoal (RNF06): o diagnóstico só pode ficar ligado durante a conferência.
5. Marque este item e anote a data.
6. Depois da conferência, o código do diagnóstico (`middlewares/diagnostico-proxy.js`) pode ser removido numa Issue futura; enquanto existir, fica desligado sem a variável.
- [x] Cabeçalhos de segurança do front-end (seção 4) configurados e conferidos com `curl -I` em 23/11/2026 (#127): os 4 cabeçalhos chegam, e o login em produção funciona sem bloqueio da CSP.
- [x] Endereços registrados no README (Links do Projeto, linha "Deploy").

## 7. Lista de variáveis (resumo, sem valores)

| Serviço | Variáveis |
| ------- | --------- |
| API (Render) | `NODE_ENV`, `NODE_VERSION`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`; `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA` só no primeiro deploy; `DIAGNOSTICO_PROXY` só durante a conferência do `trust proxy` (seção 6) |
| Front-end (Render) | `NODE_VERSION`, `VITE_API_URL` |
| Terminal da equipe (só na hora do uso) | `DATABASE_URL`, `RECUPERACAO_SENHA_TEMPORARIA` (recuperação, seção 9); `DATABASE_URL` (backup, seção 8) |

## 8. Backup semanal (RNF05)

Além da restauração do próprio Neon (até 6 horas), a equipe faz **uma cópia por semana** com `pg_dump`, criptografada e guardada **fora do repositório**, com acesso restrito à equipe.

Pré-requisitos: `pg_dump` da mesma versão principal do PostgreSQL do Neon (18) ou mais nova (o `pg_dump` 17 recusa um servidor 18), que vem com o PostgreSQL instalado (pasta `bin`, ex.: `C:\Program Files\PostgreSQL\18\bin`), e o `gpg`, que já vem com o Git for Windows. Rode no **Git Bash**. Se o `pg_dump` não estiver no PATH, chame pelo caminho completo (ex.: `"/c/Program Files/PostgreSQL/18/bin/pg_dump"`).

**Git Bash** (numa pasta **fora** do repositório, para o arquivo nunca entrar num commit):

```bash
mkdir -p ~/sisto-backup && cd ~/sisto-backup
IFS= read -rsp "DATABASE_URL do Neon: " DATABASE_URL; echo
ARQ="sisto-$(date +%Y-%m-%d).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$ARQ"
gpg --symmetric --cipher-algo AES256 "$ARQ"   # pede uma frase-senha; gera $ARQ.gpg
rm "$ARQ"; unset DATABASE_URL
```

Se o `gpg` falhar com "Inappropriate ioctl for device", acrescente `--pinentry-mode loopback`.

- Guarde o `.gpg` num local com acesso só da equipe, **nunca** no repositório.
- A frase-senha do `gpg` fica com a equipe, separada do arquivo.
- Quantas cópias manter e onde guardá-las é decisão da equipe (sugestão: as últimas 4 semanas).

**Restauração** (num banco vazio, também fora do repositório):

```bash
cd ~/sisto-backup
gpg --output sisto.dump --decrypt sisto-AAAA-MM-DD.dump.gpg
IFS= read -rsp "DATABASE_URL do banco de destino: " DATABASE_URL; echo
pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" sisto.dump
rm sisto.dump; unset DATABASE_URL
```

Como o backup contém dados pessoais quando houver uso real, trate o arquivo e a frase-senha como dados sensíveis (LGPD, RNF06).

---

## 9. Recuperação da Gestão (RN11) — último recurso

Script de linha de comando da Issue #80. Ele redefine a senha de um usuário **Gestão** quando **nenhum** usuário Gestão consegue entrar no sistema. Em qualquer outra situação, use o próprio Sisto: uma Gestão redefine a senha da outra (RF03), e por isso a RN11 exige duas Gestões ativas.

### O que o script faz

Numa única transação, para o usuário Gestão identificado pelo e-mail:

1. grava a nova **senha temporária** (só o hash bcrypt);
2. marca a **troca obrigatória** no próximo login (RN10);
3. encerra as sessões abertas desse usuário (RN12);
4. se ele estiver bloqueado ou desativado, **reativa** (RN07, RN09);
5. registra no `LogAuditoria` "senha redefinida pelo script de recuperação" e, se houve reativação, "usuário reativado pelo script de recuperação", sem a senha e com `usuario_id` nulo (ação fora da API).

Recusa, sem alterar nada e com código de saída 1: e-mail inexistente, usuário que não é Gestão, senha ausente, senha com menos de 8 caracteres ou mais de 72 bytes.

### Regras de uso

- A senha temporária vem **somente** da variável de ambiente `RECUPERACAO_SENHA_TEMPORARIA`, nunca como argumento.
- Use `npm run --silent`: sem o `--silent`, o npm repete a linha do comando no terminal, com o e-mail.
- No **PowerShell**, chame `npm.cmd` em vez de `npm`: o `npm` do PowerShell (`npm.ps1`) descarta o `--` da linha de comando, e o script recebe o e-mail sem o `--email` (e recusa).
- O script **não** lê o `.env`: a `DATABASE_URL` precisa estar definida no próprio terminal. Assim não há risco de alterar o banco local achando que é o do Neon.
- No plano gratuito do Render não há terminal no servidor: o script roda **na máquina da equipe**, apontando para o banco do Neon.
- Ao terminar, apague as variáveis do terminal (ou feche o terminal) e entregue a senha temporária à pessoa por um canal seguro. Ela troca a senha no primeiro login.

### Como executar contra o banco do Neon

Pré-requisito: o repositório clonado e `npm ci` executado em `src/backend`. A `DATABASE_URL` do Neon fica no painel do Neon (Connection string). A hora gravada para encerrar as sessões (RN12) vem do relógio do banco, não do computador.

**PowerShell** (os valores são digitados sem aparecer na tela nem no histórico):

```powershell
cd src/backend
$s = Read-Host "DATABASE_URL do Neon" -AsSecureString
$env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$s = Read-Host "Senha temporária" -AsSecureString
$env:RECUPERACAO_SENHA_TEMPORARIA = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
Remove-Variable s
npm.cmd run --silent recuperar-gestao -- --email <e-mail-da-gestao>
Remove-Item Env:RECUPERACAO_SENHA_TEMPORARIA, Env:DATABASE_URL -ErrorAction SilentlyContinue
```

**Git Bash** (`IFS=` preserva os espaços das pontas da senha, que o sistema não retira):

```bash
cd src/backend
IFS= read -rsp "DATABASE_URL do Neon: " DATABASE_URL; echo; export DATABASE_URL
IFS= read -rsp "Senha temporária: " RECUPERACAO_SENHA_TEMPORARIA; echo; export RECUPERACAO_SENHA_TEMPORARIA
npm run --silent recuperar-gestao -- --email <e-mail-da-gestao>
unset RECUPERACAO_SENHA_TEMPORARIA DATABASE_URL
```

Se a `DATABASE_URL` ou a senha ficarem vazias (Enter sem digitar), o script recusa sem conectar em nenhum banco.

Saída esperada em caso de sucesso: a confirmação com o número (id) do usuário, a informação de reativação (se houve) e o lembrete para remover a variável. O script nunca mostra a senha, o hash, o e-mail nem a `DATABASE_URL`. Com a URL do Neon (`sslmode=require`), o Node pode mostrar antes um aviso "SECURITY WARNING" sobre os modos de SSL; ele é da biblioteca de conexão, não expõe dados e não impede a execução.

### Depois de executar

1. A pessoa entra com a senha temporária e o sistema exige a troca (RN10).
2. Se o problema foi falta de Gestão ativa, cadastre ou reative a segunda Gestão (RN11).

## 10. Testes no build do Render (SSD 1.13, #134)

Os Build Commands da API e do front-end rodam os testes automatizados antes de publicar. Não há CI no GitHub, porque a pasta `.github/` não pode ser alterada.

| Serviço | Build Command |
| ------- | ------------- |
| API (`sisto-api`) | `npm ci --include=dev && npm test && npm prune --omit=dev && npm run db:deploy` |
| Front-end (`sisto`) | `npm ci && npm test && npm run build` |

**Como trocar no painel** (uma vez):

1. Abra o serviço (`sisto-api` ou `sisto`) → **Settings** → **Build & Deploy** → **Build Command** → **Edit**.
2. Cole o comando da tabela e clique em **Save Changes**.
3. Dispare um deploy (**Manual Deploy → Deploy latest commit**) e acompanhe o log: devem aparecer o resumo do Vitest (`Test Files … passed`) e, na API, as migrations depois dos testes.

**Se um teste falhar no build:** o log mostra o teste com falha, o deploy é cancelado e a versão anterior continua no ar. Corrija na máquina (rode `npm test` na pasta do serviço), faça o PR e o merge; o próximo deploy roda os testes de novo. Na API, as migrations só são aplicadas depois que todos os testes passam.

**Com que variáveis os testes rodam:** no Render, o build herda as variáveis do serviço. Na API, o `npm test` roda com `NODE_ENV=production`, o `CORS_ORIGIN`, o `JWT_SECRET` e a `DATABASE_URL` do Neon do painel. Isso foi simulado localmente numa cópia limpa (sem `.env`), com valores fictícios para essas variáveis, e todos os testes passaram. Para nenhum teste alcançar o banco de produção, o `npm test` troca a `DATABASE_URL` por um endereço fictício e inacessível antes de rodar (`src/backend/tests/setup-unitarios.js`): os testes usam o Prisma simulado e não precisam de banco. Os testes de ponta a ponta não usam essa troca, porque rodam só na máquina, contra o `sisto_test`.

**Tempo de build:** estimativa de cerca de 1 minuto a mais por build no plano Free (na simulação local de 23/11/2026, o `npm test` levou 11 segundos na API e 33 segundos no front-end; no Render, que tem menos CPU, deve demorar mais, e a instalação das dependências de teste acrescenta alguns segundos).

## 11. Migrations que criam restrições (ex.: unicidade da RN18, #129)

Uma migration que cria um índice único falha se o banco já tiver dados que o violam. Por isso, **antes do merge na `developer`** (que publica sozinho):

1. **Conferir o banco de produção.** No Neon, abra o projeto `sisto` → **SQL Editor**, cole o conteúdo de `src/backend/prisma/conferencias/conferir-duplicatas-rn18.sql` e clique em **Run**. O script é só leitura (`BEGIN TRANSACTION READ ONLY` … `ROLLBACK`). As consultas 1 e 2 precisam voltar **vazias**; se tiverem linhas, renomeie as categorias ou turmas duplicadas pela tela da Gestão e confira de novo.
2. Só então faça o merge.

**Se a migration falhar no build mesmo assim:** o build falha e a versão anterior continua no ar, mas a migration fica marcada como falha na tabela `_prisma_migrations`, e todo deploy seguinte é recusado (erro P3009). Para destravar:

1. Corrija as duplicatas pela tela da Gestão e rode a conferência de novo.
2. Na sua máquina, em `src/backend`, com a `DATABASE_URL` do Neon definida **só no terminal** (como na seção 9), rode:
   ```
   npx prisma migrate resolve --rolled-back 20261123120000_unicidade_rn18_turma_categoria
   ```
   e apague a variável do terminal em seguida.
3. No Render, **Manual Deploy → Deploy latest commit**: o build aplica a migration de novo.

Nada é criado pela metade: o PostgreSQL executa a migration inteira numa transação.

## 12. Manter a API acordada no plano gratuito (cron externo, #138)

No plano gratuito do Render, a API dorme depois de **15 minutos sem uso**, e o primeiro acesso seguinte leva de 30 a 60 segundos. O front-end (site estático) não dorme, e o Neon volta em menos de 1 segundo. Para a homologação, um **cron externo gratuito** chama `GET /saude` a cada 10 minutos no horário de uso da escola. A rota não acessa o banco, então não gasta as horas do Neon. O plano pago (Render Starter, sempre ligado) fica para a implantação com a escola (#95).

**Conta das horas:** o plano gratuito dá **750 horas por mês para o workspace inteiro**. Com o cron de segunda a sexta, das 6h às 23h, a API fica acordada cerca de 17 horas por dia útil, ou seja, cerca de **400 horas por mês**, com folga para acessos fora do horário. **Não** deixe o cron 24 horas por dia, 7 dias por semana: seriam cerca de 744 horas, praticamente todo o limite, e se ele acabar o Render suspende os serviços gratuitos até o mês seguinte.

**Configuração no cron-job.org** (uma vez):

1. Crie uma conta gratuita em https://cron-job.org e entre.
2. Clique em **Create cronjob**:
   - **Title:** `Sisto — manter API acordada`
   - **URL:** `https://sisto-api.onrender.com/saude`
   - **Execution schedule:** escolha **Custom** e marque: minutos `0, 10, 20, 30, 40, 50`; horas `6` a `22`; dias da semana **segunda a sexta**; todos os dias do mês e todos os meses.
   - **Time zone** do cronjob: `America/Sao_Paulo`.
3. Em **Notifications**, ative o aviso por e-mail quando o cronjob falhar várias vezes seguidas (serve de alerta de que a API caiu).
4. Salve e clique em **Run now** (ou espere o próximo horário): o histórico do cronjob deve mostrar **200**.

**Conferência:** num dia útil, abra `https://sisto.onrender.com` às 10h. A tela de login deve responder na hora, sem a espera de cerca de 1 minuto. No Render (`sisto-api` → **Logs**), não devem aparecer reinícios por inatividade durante o horário do cron.

**Ao contratar o plano pago:** pause ou apague o cronjob no cron-job.org. Ele deixa de ser necessário, mas pode continuar como monitoramento: o aviso de falha avisa se a API cair.

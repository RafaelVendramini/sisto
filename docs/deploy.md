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
| Build Command (primeiro deploy) | `npm ci && npm run db:deploy && npm run db:seed` |
| Build Command (depois do primeiro deploy) | `npm ci && npm run db:deploy` |
| Start Command | `npm start` |
| Auto-Deploy | ligado (cada merge na `developer` publica) |
| Plano | Free |

- O build aplica as migrations (`prisma migrate deploy`). No **primeiro** deploy ele também roda o seed, que, com `NODE_ENV=production`, cria **só** o usuário Gestão inicial.
- Depois do primeiro deploy bem-sucedido, **tire o `&& npm run db:seed` do Build Command e apague `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA` do painel** (seção 5, passo 6). O seed identifica a Gestão pelo e-mail: se ele continuasse no build e a Gestão inicial mudasse o próprio e-mail, o deploy seguinte recriaria uma Gestão ativa com a senha do painel. Sem as variáveis, um seed no build falharia o deploy.
- No plano gratuito a API dorme depois de 15 minutos sem acesso; o primeiro acesso seguinte leva cerca de 1 minuto.
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
| Build Command | `npm ci && npm run build` |
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

## 5. Ordem do primeiro deploy

1. Neon pronto (seção 2).
2. Crie a API com todas as variáveis, exceto `CORS_ORIGIN` se ainda não souber o endereço do front-end. Aguarde o build e anote o endereço da API.
3. Crie o front-end com `VITE_API_URL` = endereço da API. Anote o endereço do front-end.
4. Na API, defina `CORS_ORIGIN` = endereço do front-end e faça um novo deploy (Manual Deploy).
5. Entre com a Gestão inicial, troque a senha dela e cadastre a segunda Gestão (seção 3, limitação conhecida).
6. Na API, troque o Build Command para `npm ci && npm run db:deploy` e apague `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA`.
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
- [x] Endereços registrados no README (Links do Projeto, linha "Deploy").

## 7. Lista de variáveis (resumo, sem valores)

| Serviço | Variáveis |
| ------- | --------- |
| API (Render) | `NODE_ENV`, `NODE_VERSION`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`; `SEED_GESTAO_EMAIL` e `SEED_GESTAO_SENHA` só no primeiro deploy |
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

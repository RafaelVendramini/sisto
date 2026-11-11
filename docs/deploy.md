# Deploy da homologação — Sisto

Guia de operação do ambiente de homologação (SSD, Seção 10). O passo a passo do deploy no Render e no Neon, a lista de variáveis e o procedimento de backup entram na Issue #79.

> **Segredos nunca vão para o repositório.** `DATABASE_URL`, `JWT_SECRET`, senhas do seed e a senha temporária da recuperação ficam somente nos painéis do Render/Neon ou no terminal, na hora do uso (SSD, Seção 10; RNF06).

---

## Recuperação da Gestão (RN11) — último recurso

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

// Ponto de entrada do script de recuperação da Gestão — Sisto (Issue #80).
// Executado por `npm run --silent recuperar-gestao -- --email <e-mail>`, com a
// senha temporária na variável de ambiente RECUPERACAO_SENHA_TEMPORARIA.
// O .env NÃO é carregado (de propósito): a DATABASE_URL precisa estar definida
// no próprio terminal, para não alterar o banco local achando que é o de
// produção. No PowerShell, use npm.cmd (o npm.ps1 descarta o `--`); passo a
// passo em docs/deploy.md.
// A lógica fica em recuperar-gestao.js (testável sem subprocesso).
// Observação: sem o --silent, o próprio npm repete a linha de comando (com o
// e-mail) antes de executar.
import { executarRecuperacaoGestao } from './recuperar-gestao.js';

process.exitCode = await executarRecuperacaoGestao();

// Confere o resultado do `npm audit --json` no CI (Issue #17).
//
// Uso: node conferir-auditoria.mjs <arquivo.json> [pacote-aceito ...]
//
// Falha (código 1) quando:
// - a auditoria não rodou (arquivo vazio, JSON inválido ou erro do npm, por
//   exemplo sem acesso ao registro); ou
// - há vulnerabilidade alta ou crítica em algum pacote que NÃO está na lista
//   de riscos aceitos passada na linha de comando.
//
// Os riscos aceitos ficam registrados no SSD (Seção 10). Hoje, na API, é a
// cadeia do `effect` (prisma → @prisma/config → effect), que só roda na linha
// de comando do Prisma (SSD v1.11 e v1.21). Quando o alerta sumir, o script
// avisa para tirar a exceção do workflow.
import { readFileSync } from 'node:fs';

const SEVERIDADES_GRAVES = new Set(['high', 'critical']);

const [arquivo, ...pacotesAceitos] = process.argv.slice(2);
const riscosAceitos = new Set(pacotesAceitos);

function falhar(mensagem) {
  console.error(`Auditoria de dependências: ${mensagem}`);
  process.exit(1);
}

if (!arquivo) falhar('informe o arquivo JSON gerado por `npm audit --json`.');

let resultado;
try {
  resultado = JSON.parse(readFileSync(arquivo, 'utf8'));
} catch (erro) {
  falhar(`não foi possível ler o resultado (${erro.message}). A auditoria rodou?`);
}

if (resultado.error || typeof resultado.vulnerabilities !== 'object' || resultado.vulnerabilities === null) {
  const detalhe = resultado.error?.summary ?? resultado.error?.code ?? 'resposta sem a lista de vulnerabilidades';
  falhar(`a auditoria não rodou corretamente (${detalhe}).`);
}

const graves = Object.entries(resultado.vulnerabilities).filter(([, vulnerabilidade]) =>
  SEVERIDADES_GRAVES.has(vulnerabilidade.severity),
);
const aceitas = graves.filter(([pacote]) => riscosAceitos.has(pacote));
const novas = graves.filter(([pacote]) => !riscosAceitos.has(pacote));

for (const [pacote, vulnerabilidade] of aceitas) {
  console.log(`Risco aceito (SSD, Seção 10): ${pacote} (${vulnerabilidade.severity}).`);
}

const aceitosResolvidos = [...riscosAceitos].filter((pacote) => !aceitas.some(([nome]) => nome === pacote));
for (const pacote of aceitosResolvidos) {
  console.log(`O risco aceito de ${pacote} não aparece mais: tire a exceção do workflow e atualize o SSD.`);
}

if (novas.length > 0) {
  for (const [pacote, vulnerabilidade] of novas) {
    console.error(`Vulnerabilidade ${vulnerabilidade.severity} sem risco aceito: ${pacote}`);
  }
  falhar(`${novas.length} pacote(s) com vulnerabilidade alta ou crítica. Corrija ou registre o risco aceito no SSD.`);
}

console.log(`Auditoria de dependências ok: nenhuma vulnerabilidade alta ou crítica fora dos riscos aceitos (${aceitas.length} aceita(s)).`);

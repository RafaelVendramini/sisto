# AIP v1.1 — AI Implementation Protocol

## Objetivo

Padronizar o desenvolvimento de software com Inteligência Artificial no LTD, mantendo o SSD como fonte de verdade do sistema e a Issue como única unidade de trabalho.

## Fluxo de Desenvolvimento

```text
SSD (Sistema)
      ↓
Issue (GitHub Project)
      ↓
IA
      ↓
Código + Testes + Documentação (quando aplicável)
      ↓
Validação do Dev
      ↓
Pull Request
      ↓
Code Review
```

> **O SSD define o produto. A Issue define o trabalho.**

## Modalidades de Uso

### Modalidade A — IA CLI (Recomendada)

A IA possui acesso aos arquivos do repositório.

O Dev deve solicitar que a IA:

1. Leia o `SSD.md`;
2. Analise e execute a Issue #numero da issue;


### Modalidade B — IA Conversacional

Cada conversa corresponde a uma Sprint.

Ao iniciar a conversa da Sprint, o Dev deve copiar integralmente para a IA:

.github/AIP.md;
docs/SSD.md.

Durante a Sprint, basta enviar a Issue que será executada.

Ao iniciar uma nova Sprint, uma nova conversa deve ser criada.

A IA deve manter esse contexto durante toda a Sprint e, em cada resposta, orientar o Dev sobre **quais ações executar em sua máquina** (criar arquivos, editar classes, executar comandos, rodar testes, realizar commit etc.).

Ao iniciar uma nova Sprint, uma nova conversa deve ser criada.

## Regras para a IA

1. Considere o SSD como a fonte oficial das regras do sistema.
2. Execute exclusivamente o objetivo definido na Issue.
3. Nem toda Issue gera código: Tasks, Bugs, Spikes, Stories e Subtasks podem produzir artefatos diferentes.
4. Não invente requisitos, regras de negócio ou funcionalidades.
5. Se houver ambiguidade, solicite esclarecimento antes de prosseguir.
6. Utilize apenas as tecnologias, arquitetura e padrões definidos no projeto.
7. Crie ou atualize testes quando a Issue envolver implementação.
8. Nunca declare testes executados sem executá-los. Quando não houver execução, informe **"não executado"**.
9. Ao concluir cada Issue, informe obrigatoriamente:

   * o que foi realizado;
   * arquivos modificados;
   * testes criados ou alterados;
   * testes executados e seus resultados;
   * limitações ou pendências;
   * **passo a passo das ações que o Dev deve executar em sua máquina.**
10. Nunca realize commit, push ou Pull Request sem autorização do Dev.

## Responsabilidades do Dev

O Dev é responsável por:

1. Revisar toda saída produzida pela IA.
2. Validar a implementação contra o SSD e a Issue.
3. Executar e conferir os testes.
4. Realizar testes funcionais quando aplicável.
5. Decidir se a Issue está pronta para o Pull Request.

## Princípio

**A IA executa a Issue. O Dev assume a responsabilidade técnica pela entrega.**


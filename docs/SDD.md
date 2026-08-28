# SSD — Software Specification Document

> **Objetivo:** Este documento é a fonte oficial de especificação do sistema. Toda Story, Task, Bug, Spike ou Subtask deve estar alinhada ao seu conteúdo.

---

# 1. Identificação do Projeto

Preencha as informações gerais do sistema.

| Campo           | Valor          |
| --------------- | -------------- |
| Nome do Sistema |                |
| Nome Curto      |                |
| Equipe          | LTD.2026.2-XXX |
| Versão          | MVP 1.0        |
| Semestre        | 2026.2         |

## Cliente

Identifique o cliente ou empresa para quem o sistema está sendo desenvolvido.

| Campo                       | Valor |
| --------------------------- | ----- |
| Cliente (Nome/Razão Social) |       |
| CPF/CNPJ                    |       |
| Nome do Contato             |       |
| E-mail do Contato           |       |

---

# 2. Problema

**Descreva a dor do cliente que o sistema pretende resolver.**

> **Exemplo:** A empresa controla seus atendimentos em planilhas, gerando retrabalho e dificuldade na consulta das informações.

---

# 3. Objetivo do Sistema

**Explique o propósito principal do software em um único parágrafo.**

> **Exemplo:** Desenvolver um sistema web para gerenciar clientes, atendimentos e histórico de serviços realizados.

---

# 4. Usuários do Sistema

Liste os perfis de usuários e suas responsabilidades.

| Usuário       | Responsabilidade                      |
| ------------- | ------------------------------------- |
| Cliente       | Utiliza as funcionalidades do sistema |
| Administrador | Gerencia usuários e configurações     |

---

# 5. Escopo do MVP

## Funcionalidades incluídas

* Funcionalidade 1
* Funcionalidade 2
* Funcionalidade 3

## Fora do escopo

* Funcionalidade futura 1
* Funcionalidade futura 2

> **Regra:** tudo o que estiver fora do escopo não deve ser implementado no MVP.

---

# 6. Regras de Negócio

Descreva as regras obrigatórias do sistema.

| Código | Regra |
| ------ | ----- |
| RN01   |       |
| RN02   |       |
| RN03   |       |

### Exemplo

**RN01 — CPF único**

Um CPF já cadastrado não poderá ser utilizado por outro cliente.

---

# 7. Casos de Uso

Relacione as principais ações realizadas pelos usuários.

| Código | Caso de Uso |
| ------ | ----------- |
| UC01   |             |
| UC02   |             |
| UC03   |             |

### Exemplo

**UC01 — Cadastrar Cliente**

1. Informar nome.
2. Informar CPF.
3. Informar telefone.
4. Confirmar cadastro.

---

# 8. Requisitos Funcionais

Numere todas as funcionalidades obrigatórias.

| Código | Descrição |
| ------ | --------- |
| RF01   |           |
| RF02   |           |
| RF03   |           |

> Cada **Story** deverá atender um ou mais requisitos funcionais.

---

# 9. Requisitos Não Funcionais

Registre os requisitos técnicos e de qualidade.

| Código | Descrição                 |
| ------ | ------------------------- |
| RNF01  | API REST                  |
| RNF02  | Banco de dados relacional |
| RNF03  | Comunicação em JSON       |

---

# 10. Arquitetura do Sistema

Documente apenas decisões arquiteturais.

## Tecnologias

* Linguagem:
* Framework:
* Banco de Dados:
* Gerenciador de Dependências:

## Padrão Arquitetural

> Exemplo: REST em camadas (Controller → Service → Repository)

---

# 11. Modelo de Dados

Documente as entidades do sistema.

## Entidade: Cliente

| Campo    | Tipo   | Obrigatório |
| -------- | ------ | ----------- |
| id       | Long   | Sim         |
| nome     | String | Sim         |
| cpf      | String | Sim         |
| telefone | String | Sim         |

### Relacionamentos

> Exemplo: Um Cliente pode possuir vários Atendimentos.

---

# 12. Especificação da API

Registre todos os endpoints do sistema.

| Método | Endpoint       | Descrição |
| ------ | -------------- | --------- |
| GET    | /clientes      |           |
| POST   | /clientes      |           |
| PUT    | /clientes/{id} |           |
| DELETE | /clientes/{id} |           |

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
| 1.0    | DD/MM/AAAA | Criação do SSD |

---

## Princípio

> **Este SSD é a única fonte de verdade do sistema.** Toda implementação, revisão e validação deve estar fundamentada neste documento.

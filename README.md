# 💈 BarberPro — Sistema de Agendamento e Gestão para Barbearia

**UNIVERSIDADE FEDERAL DE ITAJUBÁ – UNIFEI**  
**Disciplina:** ECOT11A – Laboratório de Engenharia de Software I  
**Professor:** Edvard  
**Autor:** Gabriel Lazarini de Lima Ribeiro  
**Matrícula:** 2024006783  
**Repositório Oficial (Entrega 2):** [https://github.com/LazariniGab/sistema-barbearia-ecot11a](https://github.com/LazariniGab/sistema-barbearia-ecot11a)  

---

## 📌 1. Proposta do Software

O **BarberPro** é uma aplicação web completa (SPA + API REST transacional) projetada para eliminar o agendamento manual via WhatsApp/papel em barbearias, evitando choques de horários, reservas duplicadas e perda de tempo durante os atendimentos.

A solução implementa **todos os 3 níveis de complexidade funcional** previstos no Roteiro do Projeto Final (Básico, Intermediário e Avançado) e segue estritamente a Especificação de Requisitos de Software (Sommerville, Cap. 4) entregue na Etapa 1:

### ✅ Requisitos e Regras de Negócio Implementados

| Código | Descrição | Implementação no MVP |
| :--- | :--- | :--- |
| **RU01 / RN02** | **Catálogo Público & Lazy Registration** | Visualização pública de serviços (preços, fotos, duração) e profissionais sem login; identificação/cadastro exigido apenas no momento de confirmar a reserva, preservando o rascunho. |
| **RU02 / CS001** | **Agendamento Autônomo (incl. 2A)** | Seleção de serviço, profissional específico ou *"Qualquer Profissional"* (grade consolidada da equipe), data/horário e emissão de comprovante (`BRB-XXXXX`). |
| **RN01 / CS002** | **Antecedência Mínima de 2 Horas** | Cancelamento e remarcação pelo cliente permitidos somente com $\ge 2\text{h}$ de antecedência; caso contrário, a API bloqueia (`HTTP 422`) e exibe a mensagem oficial orientando contato telefônico. |
| **RN03** | **Pagamento Exclusivamente Presencial** | O sistema apenas reserva e gerencia as vagas na agenda, sem cobrança online ou retenção de cartão. |
| **RU05 / RF02** | **Painel Administrativo & Bloqueios** | Gestão de profissionais e turnos de funcionamento, cadastro de serviços, bloqueio de horários de almoço/folga (`BloqueioAgenda`) e calendário diário/semanal. |
| **RNF01.1** | **Desempenho na Consulta ($\le 500\text{ ms}$)** | Endpoint `/api/horarios-disponiveis` otimizado com índices no banco e validado sob carga de **100 requisições simultâneas** (`CT14`). |
| **RNF01.2 / 02.2**| **Segurança (bcrypt + JWT 60 min)** | Senhas armazenadas com hash `bcrypt` e autenticação por token JWT com expiração de 60 minutos e renovação automática via cabeçalho `X-Renewed-Token`. |
| **RNF01.3** | **Confiabilidade (`sessionStorage`)** | O rascunho da escolha do cliente (serviço, profissional, data e horário) é mantido em `sessionStorage` por até 10 minutos contra quedas de conexão/recarregamento. |
| **RNF01.4 / 02.4**| **Usabilidade & Cores no Calendário** | Alto contraste (WCAG AA), alertas textuais claros e blocos do calendário diferenciados por código de cores e rótulos textuais (`Confirmado`, `Bloqueado`, `Atendido`, `Cancelado`). |
| **RNF02.3** | **Atomicidade Anti-Duplicidade** | Transação ACID combinada com restrição `UNIQUE` no banco (`slotAtivoKey`) e lock transacional, impedindo agendamentos duplos sob concorrência (`CT05`). |
| **RE01 (LGPD)** | **Conformidade com a Lei nº 13.709/2018** | Coleta obrigatória de consentimento explícito no cadastro, disparo de notificações de reserva e **exclusão definitiva de dados pessoais** sob solicitação do titular (`CT13`). |

---

## 🏗️ 2. Arquitetura e Tecnologias Utilizadas

Conforme especificado nas Seções 7 e 9 do Documento de Software:

* **Frontend (Apresentação SPA):** React 18, Vite, HTML5 e CSS3 responsivo de alto contraste (`frontend/`).
* **Backend (API REST e Regras de Negócio):** Node.js, Express, JWT (`jsonwebtoken`), `bcryptjs` (`backend/`).
* **Persistência e ORM:** Prisma ORM (`backend/prisma/schema.prisma`) com **SQLite embarcado por padrão** (para execução imediata com zero configuração externa pelo avaliador) e suporte pronto a **PostgreSQL via Docker Compose** (`docker-compose.yml`).
* **Garantia de Qualidade e CI:** Jest + Supertest cobrindo os Casos de Teste **CT01 a CT14** (`backend/tests/barbearia.test.js`), script de carga de 100 requisições (`backend/tests/load-test.js`) e pipeline de Integração Contínua no **GitHub Actions** (`.github/workflows/ci.yml`).

---

## 🚀 3. Passo a Passo para Compilar e Executar Localmente

### Pré-requisitos
* **Node.js** (versão 18+ ou LTS) e **npm** instalados.

### 1º Passo: Clonar o repositório e instalar as dependências
No terminal, clone o repositório oficial e instale os pacotes (raiz, backend e frontend):

```bash
git clone https://github.com/LazariniGab/sistema-barbearia-ecot11a.git
cd sistema-barbearia-ecot11a
npm run install:all
```

### 2º Passo: Criar o banco de dados e popular dados iniciais (Seed)
Este comando cria automaticamente as tabelas a partir do Diagrama de Classes no Prisma e popula serviços, barbeiros, bloqueios de almoço e agendamentos de exemplo:

```bash
npm run db:setup
```

### 3º Passo: Iniciar o Sistema (Backend + Frontend simultaneamente)
```bash
npm run dev
```

* **Aplicação Web (Frontend React):** acesse [http://localhost:5173](http://localhost:5173)
* **API REST (Backend Express):** rodando em [http://localhost:3001/api/health](http://localhost:3001/api/health)

---

## 🔑 4. Credenciais de Teste (Pré-cadastradas pelo Seed)

Na própria interface web há botões de **Acesso Rápido de Demonstração**, ou você pode utilizar as credenciais abaixo na aba **Entrar / Equipe**:

| Perfil de Usuário | E-mail | Senha | O que testar |
| :--- | :--- | :--- | :--- |
| **Cliente Final** | `gabriel@cliente.com` | `123456` | Agendar horário, ver comprovante, cancelar/remarcar em *Meus Agendamentos* (regra de 2h) e excluir dados (LGPD). |
| **Administrador (Dono)** | `admin@barbearia.com` | `123456` | Acessar *Painel Administrativo*, ver calendário com cores por status, bloquear horário de almoço/folga, cadastrar barbeiros/serviços e ver logs de notificações. |
| **Profissional Barbeiro** | `rafael@barbearia.com` | `123456` | Visualizar agenda diária/semanal, marcar atendimento como *Atendido (Concluído)* e gerir bloqueios. |
| **Novo Cliente (Sem Login)** | *(Qualquer e-mail novo)* | *(Criada na hora)* | Escolher serviço e horário no catálogo sem login e testar o **Lazy Registration** com termo **LGPD** na confirmação. |

---

## 🧪 5. Executando os Testes Automatizados (CT01 a CT14) e Teste de Carga

Para executar a suíte completa de testes de unidade, integração, segurança, concorrência e desempenho descrita na **Seção 10 (Planos de Teste)** do Documento de Software:

```bash
npm test
```

Para rodar isoladamente o **Teste de Carga (CT14 / RNF01.1)** com 100 requisições simultâneas na consulta de horários:

```bash
npm run test:load
```

---

## 📂 6. Estrutura de Diretórios do Repositório

```text
sistema-barbearia/
├── .github/workflows/ci.yml      # Pipeline de Integração Contínua (GitHub Actions)
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # Modelagem fiel ao Diagrama de Classes (Usuario, Servico, Agendamento, BloqueioAgenda)
│   │   └── seed.js               # Massa de dados inicial para avaliação
│   ├── src/
│   │   ├── app.js                # Rotas REST, Regras RN01-RN03, Reserva Atômica, JWT 60m e LGPD
│   │   └── server.js             # Inicialização do servidor HTTP
│   └── tests/
│       ├── barbearia.test.js     # Suíte automatizada Jest + Supertest (Casos de Teste CT01 a CT14)
│       └── load-test.js          # Teste de carga para 100 requisições simultâneas (RNF01.1)
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # SPA completa (Catálogo, Lazy Registration, Meus Agendamentos, Painel Admin, LGPD)
│   │   ├── main.jsx              # Ponto de entrada React
│   │   └── styles.css            # Estilização com alto contraste WCAG AA e cores por status (RNF01.4 e RNF02.4)
│   ├── index.html
│   └── vite.config.js
├── docker-compose.yml            # Container opcional PostgreSQL
├── package.json                  # Scripts unificados do monorepo
└── README.md                     # Documentação oficial da Entrega 2
```

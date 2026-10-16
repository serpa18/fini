<div align="center">

# 💰 Fini

![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-yellow)

**Dashboard pessoal de finanças com Open Finance Brasil**

Sincronize contas, cartões, faturas e investimentos automaticamente via Pluggy — tudo em um dashboard moderno, rápido e com tema escuro.

</div>

---

## 📋 Sobre o projeto

O **Fini** é um aplicativo web de gestão financeira pessoal, projetado para rodar 24/7 em um servidor doméstico (ZimaOS + Docker). Ele se conecta às suas instituições bancárias por meio do **Pluggy** (Open Finance Brasil), sincroniza os dados automaticamente e os transforma em métricas, gráficos e insights acionáveis.

Além das finanças pessoais, inclui um módulo independente de **cobranças de clientes**, com controle de contratos, status de pagamento mensal e visão anual de recebimentos.

## ✨ Funcionalidades

### Visão Geral
- Cards de saldo total, entradas, saídas e investimentos do mês
- Comparação com o mês anterior (variação %)
- Gráfico de fluxo mensal (entradas vs. saídas) com médias do ano
- Rosca de despesas por categoria
- Recordes: maior ganho, pico de gastos e poupança do ano
- Mini-gráfico de poupança mensal (sparkline)

### Transações
- Lista completa com busca por descrição, categoria ou valor
- Filtros por tipo (entradas/saídas) e por período (mês, 3 meses, ano)

### Faturas
- Próximas faturas em aberto com valor e data de vencimento
- Compras parceladas ativas com número de parcelas

### Investimentos
- Patrimônio investido consolidado
- Classificação automática por classe de ativo (FIIs, ações, fundos, ETFs, Tesouro, CDB, cripto)
- Distribuição da carteira em pizza com legenda detalhada
- Evolução do patrimônio mês a mês (saldo + investimentos)
- Montante investido por instituição

### Categorias
- Orçamento mensal por categoria com barras de progresso
- Alertas visuais ao aproximar ou estourar o limite
- Ranking de gastos do mês

### Cobranças (módulo independente)
- Cadastro de clientes com valor de contrato, dia da cobrança e vencimento (ou indeterminado)
- Status de pagamento mensal: pago, pendente e atrasado (calculado automaticamente)
- Soma de valores extras ao contrato, com histórico e motivo
- Visão geral do ano: esperado vs. recebido, mês a mês
- Seletor de anos para consultar períodos anteriores
- Filtro por status com contadores ao vivo

### Gerais
- Sincronização automática diária (3h) via cron + botão manual
- Tema escuro, responsivo (menu inferior no mobile)
- Perfil personalizável por instância (variável de ambiente)
- Aviso de expiração de consentimento Open Finance

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Fastify |
| Banco de dados | SQLite |
| Frontend | HTML, CSS e JavaScript (SPA, sem framework) |
| Gráficos | Chart.js 4 |
| Agendamento | node-cron |
| Open Finance | Pluggy API |
| Infra | Docker, Git |

## 🚀 Instalação

### Pré-requisitos
- Node.js 20+ (ou Docker)
- Conta no [Pluggy](https://pluggy.ai) com `clientId` e `clientSecret`
- Git

### 1. Clone o repositório

```bash
git clone https://github.com/serpa18/fine.git
cd fine
```

### 2. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
PLUGGY_CLIENT_ID=seu_client_id
PLUGGY_CLIENT_SECRET=seu_client_secret
PORT=8181
APP_USER_NAME=Seu Nome
```

### 3. Instale as dependências e inicie

```bash
npm install
npm start
```

### Alternativa: Docker

```bash
docker build -t fini .
docker run -d --name fini \
  -p 8181:8181 \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  --restart=always \
  fini
```

## 💻 Uso

Acesse **http://localhost:8181** no navegador.

| Ação | Como fazer |
|---|---|
| Primeira sincronização | Conecte suas contas no dashboard do Pluggy e clique em **Sincronizar agora** |
| Sincronização automática | Ocorre diariamente às 3h (configurável em `src/server.js`) |
| Orçamentos | Aba **Categorias** → "+ Definir orçamento" |
| Cobranças | Aba **Cobranças** → "+ Novo cliente" |

> 💡 O banco de dados SQLite é criado e migrado automaticamente na primeira execução.

### Atualização em produção (servidor doméstico)

```bash
cd /caminho/do/projeto && git pull && docker restart fini
```

## 📁 Estrutura do projeto

```
fine/
├── src/
│   ├── server.js        # Servidor Fastify, rotas da API e cron
│   ├── db.js            # Conexão e schema do SQLite
│   ├── sync.js          # Sincronização com o Pluggy (Open Finance)
│   ├── analyze.js       # Métricas e consultas (mensal, ranking, insights…)
│   ├── features.js      # Orçamento por categoria + histórico de patrimônio
│   └── cobrancas.js     # Módulo de cobranças de clientes
├── public/
│   ├── index.html       # Interface completa (SPA)
│   └── favicon.svg
├── .env                 # Variáveis de ambiente (não versionar)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🤝 Contribuição

Projeto de uso pessoal, mas sugestões são bem-vindas!

1. Faça um fork do projeto
2. Crie uma branch: `git checkout -b minha-feature`
3. Commit das alterações: `git commit -m "feat: minha feature"`
4. Push para a branch: `git push origin minha-feature`
5. Abra um Pull Request

## 📄 Licença

Distribuído sob a licença **MIT**. Veja o arquivo `LICENSE` para mais detalhes.

<!-- Se preferir outra licença (Apache-2.0, GPL-3.0 etc.), ajuste o texto acima e o badge do topo. -->

## 📬 Contato

**Gabriel Serpa**

- GitHub: [serpa18](https://github.com/serpa18)

---

<div align="center">

Feito com ☕ e Node.js

</div>

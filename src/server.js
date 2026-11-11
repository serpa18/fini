require("dotenv").config();
const path = require("path");
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const cron = require("node-cron");
const fastifyStatic = require("@fastify/static");
const { sync, aplicarCorrecaoHistoricaCategorias } = require("./sync");
const { monthly, ranking, assinaturas, insights, melhores, saldoTotal, transacoesRecentes, investimentos, investimentosPorInstituicao, faturas, parcelas, syncInfo } = require("./analyze");
const db = require("./db");
const registerFeatures = require("./features");
const registerCobrancas = require("./cobrancas");
const registerCarteira = require("./carteira");
const { registerProventos } = require("./proventos");
const registerBackup = require("./backup");

const app = Fastify();
app.register(cors, { origin: true });

app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
});

app.get("/api/health", () => ({ ok: true }));
app.get("/api/monthly", (req) => monthly(req.query.ano));
app.get("/api/ranking/:mes", (req) => ranking(req.params.mes));
app.get("/api/assinaturas", () => assinaturas());
app.get("/api/insights", (req) => insights(req.query.mes));
app.get("/api/melhores", () => melhores());
app.get("/api/saldo", () => saldoTotal());
app.get("/api/transactions", (req) => transacoesRecentes(Number(req.query.limit) || 8));
app.get("/api/investimentos", () => investimentos());
app.get("/api/investimentos/instituicoes", () => investimentosPorInstituicao());
app.get("/api/faturas", () => faturas());
app.get("/api/parcelas", () => parcelas());
app.get("/api/syncinfo", () => syncInfo());
app.post("/api/sync", async () => {
  await sync();
  proventos.importarDeTransacoes();
  await registrarSnapshot();
  return { ok: true };
});

// ===== Perfil: nome e avatar por instância (variáveis de ambiente) =====
app.get("/api/perfil", () => {
  const nome = (process.env.APP_USER_NAME || "Usuário").trim();
  return {
    nome,
    inicial: nome.charAt(0).toUpperCase() || "U",
  };
});

// Migração idempotente única de categorias antigas (cartão / transferências internas)
aplicarCorrecaoHistoricaCategorias();

// ===== Features: orçamento por categoria + histórico de patrimônio + regras manuais =====
const registrarSnapshot = registerFeatures(app, db, { saldoTotal, investimentos });

// ===== Cobranças: aba independente de controle de clientes =====
registerCobrancas(app, db);

// ===== Carteira: operações (compra/venda), preço médio e simulador de venda =====
const carteira = registerCarteira(app, db);

// ===== Proventos: dividendos, FIIs, JCP e aluguel BTC =====
const proventos = registerProventos(app, db, carteira);

// ===== Backup em 2 ambientes (HD Local + Google Drive) e Exportação CSV =====
const backup = registerBackup(app, db, carteira);

async function runSync() {
  try {
    await sync();
    proventos.importarDeTransacoes();
    await registrarSnapshot(); // grava o snapshot de patrimônio após cada sync
  } catch (err) {
    console.error("Erro na sincronização:", err.message);
  }
  backup.executarBackupAutomatico();
}

runSync();
cron.schedule("0 3 * * *", runSync);

const porta = process.env.PORT || 8181;
app.listen({ port: porta, host: "0.0.0.0" })
  .then(() => console.log(`Fini rodando na porta ${porta}`));

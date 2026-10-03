require("dotenv").config();
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const cron = require("node-cron");
const { sync } = require("./sync");
const { monthly, ranking, assinaturas, insights } = require("./analyze");

const app = Fastify();
app.register(cors, { origin: true });

app.get("/api/health", () => ({ ok: true }));
app.get("/api/monthly", () => monthly());
app.get("/api/ranking/:mes", (req) => ranking(req.params.mes));
app.get("/api/assinaturas", () => assinaturas());
app.get("/api/insights", () => insights());
app.post("/api/sync", async () => { await sync(); return { ok: true }; });

// Se a sincronização falhar, mostra o motivo sem derrubar o servidor
async function runSync() {
  try {
    await sync();
  } catch (err) {
    console.error("Erro na sincronização:", err.message);
  }
}

runSync();
cron.schedule("0 3 * * *", runSync);

app.listen({ port: process.env.PORT || 8181, host: "0.0.0.0" })
  .then(() => console.log("Fini rodando na porta 8181"));
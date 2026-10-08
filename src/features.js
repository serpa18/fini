// ============================================================
// src/features.js
// Features: Orçamento por categoria + Histórico de patrimônio
// Uso no server.js:
//   const registrarSnapshot = require("./features")(app, db, { saldoTotal, investimentos });
//   // chame await registrarSnapshot() ao final de cada sincronização
// ============================================================

module.exports = function registerFeatures(app, db, helpers = {}) {
  // ---- Tabelas (criadas automaticamente) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      limit_value REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wealth_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      saldo_total REAL NOT NULL,
      investimentos REAL NOT NULL,
      patrimonio REAL NOT NULL
    );
  `);

  // ===== ORÇAMENTO POR CATEGORIA =====

  // GET /api/budgets?mes=YYYY-MM -> orçamentos com o gasto atual do mês
  app.get("/api/budgets", async (req, reply) => {
    const mes = req.query.mes;
    const budgets = db.prepare("SELECT category, limit_value FROM budgets").all();
    const limites = {};
    for (const b of budgets) limites[b.category] = b.limit_value;

    const gastoPorCat = {};
    if (mes) {
      const rows = db.prepare(`
        SELECT category, SUM(ABS(amount)) as total
        FROM transactions
        WHERE strftime('%Y-%m', date) = ? AND amount < 0
        GROUP BY category
      `).all(mes);
      for (const r of rows) gastoPorCat[r.category] = r.total;
    }

    return Object.keys(limites).map((cat) => {
      const spent = gastoPorCat[cat] || 0;
      const limit = limites[cat];
      return {
        category: cat,
        limit,
        spent,
        remaining: limit - spent,
        pct: limit > 0 ? Math.round((spent / limit) * 100) : 0,
      };
    });
  });

  // POST /api/budgets -> cria/atualiza um orçamento
  app.post("/api/budgets", async (req, reply) => {
    const category = ((req.body && req.body.category) || "").trim();
    const limit = Number(req.body && req.body.limit);
    if (!category || !Number.isFinite(limit) || limit < 0) {
      return reply.code(400).send({ error: "category e limit (número >= 0) são obrigatórios" });
    }
    db.prepare(`
      INSERT INTO budgets (category, limit_value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(category) DO UPDATE SET
        limit_value = excluded.limit_value,
        updated_at = datetime('now')
    `).run(category, limit);
    return { ok: true, category, limit };
  });

  // DELETE /api/budgets/:category -> remove um orçamento
  app.delete("/api/budgets/:category", async (req, reply) => {
    db.prepare("DELETE FROM budgets WHERE category = ?").run(req.params.category);
    return { ok: true };
  });

  // ===== HISTÓRICO DE PATRIMÔNIO =====

  // GET /api/wealth -> evolução de saldo + investimentos ao longo do tempo
  app.get("/api/wealth", async () => {
    const rows = db.prepare(`
      SELECT recorded_at, saldo_total, investimentos, patrimonio
      FROM wealth_history
      ORDER BY recorded_at ASC
    `).all();
    return rows.map((r) => ({
      date: r.recorded_at,
      saldo: r.saldo_total,
      investimentos: r.investimentos,
      patrimonio: r.patrimonio,
    }));
  });

  // Grava um snapshot de patrimônio (chamado ao final de cada sync).
  // Evita duplicados: no máximo 1 snapshot a cada 30 minutos.
  return async function registrarSnapshot() {
    try {
      const ultimo = db.prepare("SELECT recorded_at FROM wealth_history ORDER BY recorded_at DESC LIMIT 1").get();
      if (ultimo) {
        const decorrido = Date.now() - new Date(ultimo.recorded_at.replace(" ", "T") + "Z").getTime();
        if (decorrido < 30 * 60 * 1000) return;
      }

      let saldo = 0;
      if (typeof helpers.saldoTotal === "function") {
        const s = await Promise.resolve(helpers.saldoTotal());
        saldo = s && typeof s === "object" ? (s.total || 0) : Number(s) || 0;
      }
      let inv = 0;
      if (typeof helpers.investimentos === "function") {
        const lista = await Promise.resolve(helpers.investimentos());
        inv = Array.isArray(lista) ? lista.reduce((a, i) => a + (i.balance || 0), 0) : 0;
      }

      db.prepare(`
        INSERT INTO wealth_history (recorded_at, saldo_total, investimentos, patrimonio)
        VALUES (datetime('now'), ?, ?, ?)
      `).run(saldo, inv, saldo + inv);
    } catch (e) {
      console.error("Erro ao gravar snapshot de patrimônio:", e.message);
    }
  };
};

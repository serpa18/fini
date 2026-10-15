// ============================================================
// src/cobrancas.js
// Aba de Cobranças: cadastro de clientes, valores de contrato,
// status de pagamento mensal e visão geral por ano.
// Independente das demais features — usa apenas tabelas cob_*.
// Uso no server.js:
//   const registerCobrancas = require("./cobrancas");
//   registerCobrancas(app, db);
// ============================================================

module.exports = function registerCobrancas(app, db) {
  // ---- Tabelas (criadas automaticamente) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS cob_clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      valor_mensal REAL NOT NULL DEFAULT 0,
      dia_cobranca INTEGER NOT NULL DEFAULT 1,
      data_vencimento TEXT,
      observacoes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cob_pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      pago_em TEXT,
      UNIQUE(cliente_id, mes)
    );
    CREATE TABLE IF NOT EXISTS cob_ajustes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      valor REAL NOT NULL,
      motivo TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ===== CLIENTES =====

  // GET /api/cobrancas/clientes -> lista todos
  app.get("/api/cobrancas/clientes", async () => {
    return db.prepare(`
      SELECT id, nome, valor_mensal, dia_cobranca, data_vencimento, observacoes, created_at
      FROM cob_clientes
      ORDER BY nome COLLATE NOCASE
    `).all();
  });

  // POST /api/cobrancas/clientes -> cria (data_vencimento null = indeterminado)
  app.post("/api/cobrancas/clientes", async (req, reply) => {
    const b = req.body || {};
    const nome = String(b.nome || "").trim();
    const valor = Number(b.valor_mensal);
    const dia = Math.min(31, Math.max(1, parseInt(b.dia_cobranca, 10) || 1));
    if (!nome || !Number.isFinite(valor) || valor < 0) {
      return reply.code(400).send({ error: "nome e valor_mensal (>= 0) são obrigatórios" });
    }
    const venc = b.data_vencimento || null;
    const info = db.prepare(`
      INSERT INTO cob_clientes (nome, valor_mensal, dia_cobranca, data_vencimento, observacoes)
      VALUES (?, ?, ?, ?, ?)
    `).run(nome, valor, dia, venc, b.observacoes || null);
    return { ok: true, id: info.lastInsertRowid };
  });

  // PUT /api/cobrancas/clientes/:id -> edita
  app.put("/api/cobrancas/clientes/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const atual = db.prepare(`SELECT * FROM cob_clientes WHERE id = ?`).get(id);
    if (!atual) return reply.code(404).send({ error: "cliente não encontrado" });
    const b = req.body || {};
    const nome = b.nome !== undefined ? String(b.nome).trim() : atual.nome;
    const valor = b.valor_mensal !== undefined ? Number(b.valor_mensal) : atual.valor_mensal;
    const dia = b.dia_cobranca !== undefined
      ? Math.min(31, Math.max(1, parseInt(b.dia_cobranca, 10) || 1))
      : atual.dia_cobranca;
    const venc = b.data_vencimento !== undefined ? (b.data_vencimento || null) : atual.data_vencimento;
    const obs = b.observacoes !== undefined ? b.observacoes : atual.observacoes;
    if (!nome || !Number.isFinite(valor) || valor < 0) {
      return reply.code(400).send({ error: "dados inválidos" });
    }
    db.prepare(`
      UPDATE cob_clientes
      SET nome = ?, valor_mensal = ?, dia_cobranca = ?, data_vencimento = ?, observacoes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nome, valor, dia, venc, obs, id);
    return { ok: true };
  });

  // POST /api/cobrancas/clientes/:id/adicionar -> soma (ou reduz) valor ao contrato
  app.post("/api/cobrancas/clientes/:id/adicionar", async (req, reply) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const valor = Number(b.valor);
    if (!Number.isFinite(valor) || valor === 0) {
      return reply.code(400).send({ error: "informe um valor diferente de zero" });
    }
    const atual = db.prepare(`SELECT * FROM cob_clientes WHERE id = ?`).get(id);
    if (!atual) return reply.code(404).send({ error: "cliente não encontrado" });
    const novo = atual.valor_mensal + valor;
    if (novo < 0) return reply.code(400).send({ error: "o valor mensal não pode ficar negativo" });
    db.prepare(`UPDATE cob_clientes SET valor_mensal = ?, updated_at = datetime('now') WHERE id = ?`).run(novo, id);
    db.prepare(`INSERT INTO cob_ajustes (cliente_id, valor, motivo) VALUES (?, ?, ?)`)
      .run(id, valor, b.motivo || null);
    return { ok: true, valor_mensal: novo };
  });

  // DELETE /api/cobrancas/clientes/:id -> remove cliente e registros ligados
  app.delete("/api/cobrancas/clientes/:id", async (req, reply) => {
    const id = Number(req.params.id);
    db.prepare(`DELETE FROM cob_pagamentos WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_ajustes WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_clientes WHERE id = ?`).run(id);
    return { ok: true };
  });

  // ===== STATUS DE PAGAMENTO =====

  // GET /api/cobrancas/status?mes=YYYY-MM -> status de todos os clientes no mês
  app.get("/api/cobrancas/status", async (req) => {
    const mes = String(req.query.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) return [];
    const clientes = db.prepare(`SELECT * FROM cob_clientes ORDER BY nome COLLATE NOCASE`).all();
    const regs = db.prepare(`SELECT cliente_id, status, pago_em FROM cob_pagamentos WHERE mes = ?`).all(mes);
    const porCliente = {};
    for (const r of regs) porCliente[r.cliente_id] = r;

    const hoje = new Date();
    const [ano, m] = mes.split("-").map(Number);
    const mesAtual = hoje.getFullYear() === ano && hoje.getMonth() + 1 === m;
    const mesPassado = new Date(ano, m, 1) < new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const diaHoje = hoje.getDate();

    return clientes.map((c) => {
      const reg = porCliente[c.id];
      let status = reg ? reg.status : "pendente";
      if (status !== "pago") {
        if (mesPassado) status = "atrasado";
        else if (mesAtual && c.dia_cobranca <= diaHoje) status = "atrasado";
      }
      return {
        cliente_id: c.id,
        nome: c.nome,
        valor_mensal: c.valor_mensal,
        dia_cobranca: c.dia_cobranca,
        data_vencimento: c.data_vencimento,
        status,
        pago_em: reg ? reg.pago_em : null,
      };
    });
  });

  // POST /api/cobrancas/status -> marca/desmarca pagamento (status: pago | pendente)
  app.post("/api/cobrancas/status", async (req, reply) => {
    const b = req.body || {};
    const clienteId = Number(b.cliente_id);
    const mes = String(b.mes || "");
    const status = String(b.status || "");
    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes) || !["pago", "pendente"].includes(status)) {
      return reply.code(400).send({ error: "cliente_id, mes (YYYY-MM) e status (pago|pendente) são obrigatórios" });
    }
    db.prepare(`
      INSERT INTO cob_pagamentos (cliente_id, mes, status, pago_em)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cliente_id, mes) DO UPDATE SET
        status = excluded.status,
        pago_em = excluded.pago_em
    `).run(clienteId, mes, status, status === "pago" ? new Date().toISOString() : null);
    return { ok: true };
  });

  // ===== VISÃO GERAL DO ANO =====

  // GET /api/cobrancas/resumo?ano=YYYY -> totais por mês + seletor de anos
  app.get("/api/cobrancas/resumo", async (req) => {
    const ano = parseInt(req.query.ano, 10) || new Date().getFullYear();
    const clientes = db.prepare(`SELECT id, valor_mensal, created_at FROM cob_clientes`).all();
    const clientesMap = {};
    for (const c of clientes) clientesMap[c.id] = c;

    const pagosRows = db.prepare(`
      SELECT mes, cliente_id FROM cob_pagamentos
      WHERE status = 'pago' AND mes LIKE ?
    `).all(ano + "-%");
    const valorPagoPorMes = {};
    for (const p of pagosRows) {
      const c = clientesMap[p.cliente_id];
      if (c) valorPagoPorMes[p.mes] = (valorPagoPorMes[p.mes] || 0) + (c.valor_mensal || 0);
    }

    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const mes = ano + "-" + String(m).padStart(2, "0");
      // clientes que já existiam até o fim daquele mês
      const fimMes = new Date(ano, m, 0, 23, 59, 59).toISOString().slice(0, 19);
      const esperado = clientes
        .filter((c) => (c.created_at || "") <= fimMes)
        .reduce((s, c) => s + (c.valor_mensal || 0), 0);
      const pago = valorPagoPorMes[mes] || 0;
      meses.push({ mes, esperado, pago, pendente: Math.max(0, esperado - pago) });
    }

    const totalEsperado = meses.reduce((s, x) => s + x.esperado, 0);
    const totalPago = meses.reduce((s, x) => s + x.pago, 0);

    // anos disponíveis para o seletor: ano atual + anos com clientes ou pagamentos
    const anosPagos = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) as ano FROM cob_pagamentos`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosCriacao = clientes
      .map((c) => Number((c.created_at || "").slice(0, 4)))
      .filter(Number.isFinite);
    const anos = [...new Set([new Date().getFullYear(), ...anosPagos, ...anosCriacao])].sort((a, b) => b - a);

    return {
      ano,
      anos,
      meses,
      totalEsperado,
      totalPago,
      totalPendente: Math.max(0, totalEsperado - totalPago),
      clientesAtivos: clientes.length,
      contratoMensal: clientes.reduce((s, c) => s + (c.valor_mensal || 0), 0),
    };
  });
};

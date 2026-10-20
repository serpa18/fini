// ============================================================
// src/cobrancas.js
// Aba de Cobranças: clientes, valores por mês, serviços extras,
// status de pagamento mensal e visão geral por ano.
//
// REGRA DE VALORES
//   valor do mês = valor vigente do contrato + serviços extras do mês
//   valor vigente = pontual do mês > último reajuste <= mês > valor base
// ============================================================

module.exports = function registerCobrancas(app, db) {
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
    CREATE TABLE IF NOT EXISTS cob_valores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      valor REAL NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'pontual',
      motivo TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(cliente_id, mes, tipo)
    );
    -- NOVO: serviços extras lançados em um mês específico
    CREATE TABLE IF NOT EXISTS cob_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      descricao TEXT,
      valor REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  try { db.exec(`ALTER TABLE cob_ajustes ADD COLUMN mes TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE cob_ajustes ADD COLUMN tipo TEXT`); } catch (e) {}

  // ===== Helpers =====

  function overridesDoCliente(clienteId) {
    return db.prepare(`
      SELECT mes, valor, tipo FROM cob_valores
      WHERE cliente_id = ? ORDER BY mes ASC
    `).all(clienteId);
  }

  function overridesDeTodos() {
    const linhas = db.prepare(`
      SELECT cliente_id, mes, valor, tipo FROM cob_valores ORDER BY mes ASC
    `).all();
    const mapa = {};
    for (const o of linhas) {
      if (!mapa[o.cliente_id]) mapa[o.cliente_id] = [];
      mapa[o.cliente_id].push(o);
    }
    return mapa;
  }

  // Valor do contrato vigente no mês (sem extras)
  function valorBaseNoMes(cliente, overrides, mes) {
    const pontual = overrides.find((o) => o.tipo === "pontual" && o.mes === mes);
    if (pontual) return pontual.valor;

    let reajuste = null;
    for (const o of overrides) {
      if (o.tipo === "reajuste" && o.mes <= mes) reajuste = o.valor;
    }
    return reajuste !== null ? reajuste : (cliente.valor_mensal || 0);
  }

  // Total de extras por cliente/mês: mapa[cliente_id][mes] = valor
  function extrasDeTodos() {
    const linhas = db.prepare(`
      SELECT cliente_id, mes, SUM(valor) AS total
      FROM cob_extras GROUP BY cliente_id, mes
    `).all();
    const mapa = {};
    for (const l of linhas) {
      if (!mapa[l.cliente_id]) mapa[l.cliente_id] = {};
      mapa[l.cliente_id][l.mes] = l.total;
    }
    return mapa;
  }

  const mesAtualStr = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  };

  // ===== CLIENTES =====

  app.get("/api/cobrancas/clientes", async () => {
    return db.prepare(`
      SELECT id, nome, valor_mensal, dia_cobranca, data_vencimento, observacoes, created_at
      FROM cob_clientes ORDER BY nome COLLATE NOCASE
    `).all();
  });

  app.post("/api/cobrancas/clientes", async (req, reply) => {
    const b = req.body || {};
    const nome = String(b.nome || "").trim();
    const valor = Number(b.valor_mensal);
    const dia = Math.min(31, Math.max(1, parseInt(b.dia_cobranca, 10) || 1));
    if (!nome || !Number.isFinite(valor) || valor < 0) {
      return reply.code(400).send({ error: "nome e valor_mensal (>= 0) são obrigatórios" });
    }
    const info = db.prepare(`
      INSERT INTO cob_clientes (nome, valor_mensal, dia_cobranca, data_vencimento, observacoes)
      VALUES (?, ?, ?, ?, ?)
    `).run(nome, valor, dia, b.data_vencimento || null, b.observacoes || null);
    return { ok: true, id: info.lastInsertRowid };
  });

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

  app.delete("/api/cobrancas/clientes/:id", async (req) => {
    const id = Number(req.params.id);
    db.prepare(`DELETE FROM cob_pagamentos WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_ajustes WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_extras WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_clientes WHERE id = ?`).run(id);
    return { ok: true };
  });

  // ===== VALORES DO CONTRATO POR MÊS =====

  app.post("/api/cobrancas/valores", async (req, reply) => {
    const b = req.body || {};
    const clienteId = Number(b.cliente_id);
    const mes = String(b.mes || "");
    const valor = Number(b.valor);
    const tipo = b.tipo === "reajuste" ? "reajuste" : "pontual";
    const motivo = b.motivo ? String(b.motivo).trim() : null;

    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes) || !Number.isFinite(valor) || valor < 0) {
      return reply.code(400).send({ error: "cliente_id, mes (YYYY-MM) e valor (>= 0) são obrigatórios" });
    }
    const cliente = db.prepare(`SELECT * FROM cob_clientes WHERE id = ?`).get(clienteId);
    if (!cliente) return reply.code(404).send({ error: "cliente não encontrado" });

    const overrides = overridesDoCliente(clienteId);
    const anterior = valorBaseNoMes(cliente, overrides, mes);

    db.prepare(`
      INSERT INTO cob_valores (cliente_id, mes, valor, tipo, motivo)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cliente_id, mes, tipo) DO UPDATE SET
        valor = excluded.valor, motivo = excluded.motivo
    `).run(clienteId, mes, valor, tipo, motivo);

    const delta = valor - anterior;
    if (Math.abs(delta) > 0.004) {
      db.prepare(`
        INSERT INTO cob_ajustes (cliente_id, valor, motivo, mes, tipo)
        VALUES (?, ?, ?, ?, ?)
      `).run(clienteId, delta, motivo, mes, tipo);
    }
    return { ok: true, mes, valor, tipo, anterior };
  });

  app.delete("/api/cobrancas/valores/:clienteId/:mes", async (req, reply) => {
    const clienteId = Number(req.params.clienteId);
    const mes = String(req.params.mes || "");
    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes)) {
      return reply.code(400).send({ error: "clienteId e mes (YYYY-MM) são obrigatórios" });
    }
    db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ? AND mes = ?`).run(clienteId, mes);
    return { ok: true };
  });

  // ===== SERVIÇOS EXTRAS DO MÊS =====

  // GET /api/cobrancas/extras?cliente_id=1&mes=YYYY-MM
  app.get("/api/cobrancas/extras", async (req) => {
    const clienteId = Number(req.query.cliente_id);
    const mes = String(req.query.mes || "");
    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes)) return [];
    return db.prepare(`
      SELECT id, descricao, valor, created_at
      FROM cob_extras WHERE cliente_id = ? AND mes = ?
      ORDER BY id ASC
    `).all(clienteId, mes);
  });

  // POST /api/cobrancas/extras -> soma um serviço ao mês
  app.post("/api/cobrancas/extras", async (req, reply) => {
    const b = req.body || {};
    const clienteId = Number(b.cliente_id);
    const mes = String(b.mes || "");
    const valor = Number(b.valor);
    const descricao = b.descricao ? String(b.descricao).trim() : null;

    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes) || !Number.isFinite(valor) || valor <= 0) {
      return reply.code(400).send({ error: "cliente_id, mes (YYYY-MM) e valor (> 0) são obrigatórios" });
    }
    const cliente = db.prepare(`SELECT id FROM cob_clientes WHERE id = ?`).get(clienteId);
    if (!cliente) return reply.code(404).send({ error: "cliente não encontrado" });

    const info = db.prepare(`
      INSERT INTO cob_extras (cliente_id, mes, descricao, valor)
      VALUES (?, ?, ?, ?)
    `).run(clienteId, mes, descricao, valor);

    return { ok: true, id: info.lastInsertRowid, mes, valor };
  });

  // DELETE /api/cobrancas/extras/:id -> remove um serviço lançado
  app.delete("/api/cobrancas/extras/:id", async (req) => {
    db.prepare(`DELETE FROM cob_extras WHERE id = ?`).run(Number(req.params.id));
    return { ok: true };
  });

  // ===== STATUS DE PAGAMENTO =====

  app.get("/api/cobrancas/status", async (req) => {
    const mes = String(req.query.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) return [];

    const clientes = db.prepare(`SELECT * FROM cob_clientes ORDER BY nome COLLATE NOCASE`).all();
    const regs = db.prepare(`SELECT cliente_id, status, pago_em FROM cob_pagamentos WHERE mes = ?`).all(mes);
    const porCliente = {};
    for (const r of regs) porCliente[r.cliente_id] = r;
    const ovMapa = overridesDeTodos();
    const exMapa = extrasDeTodos();

    const hoje = new Date();
    const [ano, m] = mes.split("-").map(Number);
    const ehMesAtual = hoje.getFullYear() === ano && hoje.getMonth() + 1 === m;
    const mesPassado = new Date(ano, m, 1) < new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const diaHoje = hoje.getDate();

    return clientes.map((c) => {
      const overrides = ovMapa[c.id] || [];
      const reg = porCliente[c.id];

      let status = reg ? reg.status : "pendente";
      if (status !== "pago") {
        if (mesPassado) status = "atrasado";
        else if (ehMesAtual && c.dia_cobranca <= diaHoje) status = "atrasado";
      }

      const base = valorBaseNoMes(c, overrides, mes);
      const extras = (exMapa[c.id] && exMapa[c.id][mes]) || 0;

      const temPontual = overrides.some((o) => o.tipo === "pontual" && o.mes === mes);
      const temReajuste = overrides.some((o) => o.tipo === "reajuste" && o.mes === mes);

      return {
        cliente_id: c.id,
        nome: c.nome,
        valor_mensal: base,          // valor do contrato vigente no mês
        valor_base: c.valor_mensal,  // valor base cadastrado
        extras_total: extras,        // soma dos serviços extras do mês
        valor_total: base + extras,  // o que deve ser cobrado no mês
        dia_cobranca: c.dia_cobranca,
        data_vencimento: c.data_vencimento,
        ajustado: temPontual || temReajuste,
        tipo_ajuste: temPontual ? "pontual" : (temReajuste ? "reajuste" : null),
        status,
        pago_em: reg ? reg.pago_em : null,
      };
    });
  });

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
        status = excluded.status, pago_em = excluded.pago_em
    `).run(clienteId, mes, status, status === "pago" ? new Date().toISOString() : null);
    return { ok: true };
  });

  // ===== VISÃO GERAL DO ANO =====

  app.get("/api/cobrancas/resumo", async (req) => {
    const ano = parseInt(req.query.ano, 10) || new Date().getFullYear();
    const clientes = db.prepare(`SELECT id, nome, valor_mensal, created_at FROM cob_clientes`).all();
    const clienteMapa = {};
    for (const c of clientes) clienteMapa[c.id] = c;
    const ovMapa = overridesDeTodos();
    const exMapa = extrasDeTodos();

    const totalDoMes = (cliente, mes) => {
      const base = valorBaseNoMes(cliente, ovMapa[cliente.id] || [], mes);
      const extras = (exMapa[cliente.id] && exMapa[cliente.id][mes]) || 0;
      return base + extras;
    };

    const pagos = db.prepare(`
      SELECT mes, cliente_id FROM cob_pagamentos
      WHERE status = 'pago' AND mes LIKE ?
    `).all(ano + "-%");
    const pagoPorMes = {};
    for (const p of pagos) {
      const c = clienteMapa[p.cliente_id];
      if (!c) continue;
      pagoPorMes[p.mes] = (pagoPorMes[p.mes] || 0) + totalDoMes(c, p.mes);
    }

    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const mes = ano + "-" + String(m).padStart(2, "0");
      const fimMes = new Date(Date.UTC(ano, m, 0, 23, 59, 59)).toISOString().slice(0, 19).replace("T", " ");

      const esperado = clientes
        .filter((c) => (c.created_at || "") <= fimMes)
        .reduce((s, c) => s + totalDoMes(c, mes), 0);

      const pago = pagoPorMes[mes] || 0;
      meses.push({ mes, esperado, pago, pendente: Math.max(0, esperado - pago) });
    }

    const totalEsperado = meses.reduce((s, x) => s + x.esperado, 0);
    const totalPago = meses.reduce((s, x) => s + x.pago, 0);

    const now = mesAtualStr();
    const contratoMensal = clientes.reduce(
      (s, c) => s + valorBaseNoMes(c, ovMapa[c.id] || [], now), 0
    );
    const extrasAno = db.prepare(`SELECT COALESCE(SUM(valor), 0) AS t FROM cob_extras WHERE mes LIKE ?`)
      .get(ano + "-%").t;

    const anosPagos = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_pagamentos`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosValores = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_valores`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosExtras = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_extras`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosCriacao = clientes.map((c) => Number((c.created_at || "").slice(0, 4))).filter(Number.isFinite);
    const anos = [...new Set([new Date().getFullYear(), ...anosPagos, ...anosValores, ...anosExtras, ...anosCriacao])]
      .sort((a, b) => b - a);

    return {
      ano, anos, meses,
      totalEsperado, totalPago,
      totalPendente: Math.max(0, totalEsperado - totalPago),
      clientesAtivos: clientes.length,
      contratoMensal,
      extrasAno,
    };
  });

  // ===== LEGADO =====
  // Soma um serviço extra ao mês CORRENTE (nunca a todos os meses).
  app.post("/api/cobrancas/clientes/:id/adicionar", async (req, reply) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const valor = Number(b.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return reply.code(400).send({ error: "informe um valor maior que zero" });
    }
    const cliente = db.prepare(`SELECT id FROM cob_clientes WHERE id = ?`).get(id);
    if (!cliente) return reply.code(404).send({ error: "cliente não encontrado" });

    const mes = mesAtualStr();
    db.prepare(`INSERT INTO cob_extras (cliente_id, mes, descricao, valor) VALUES (?, ?, ?, ?)`)
      .run(id, mes, b.motivo || null, valor);
    return { ok: true, mes, valor };
  });
};

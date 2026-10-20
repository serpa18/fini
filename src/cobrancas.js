// ============================================================
// src/cobrancas.js
// Aba de Cobranças: cadastro de clientes, valores por mês,
// status de pagamento mensal e visão geral por ano.
// Independente das demais features — usa apenas tabelas cob_*.
//
// Uso no server.js:
//   const registerCobrancas = require("./cobrancas");
//   registerCobrancas(app, db);
//
// REGRA DE VALORES POR MÊS
//   valor pontual do mês  >  último reajuste <= mês  >  valor base do contrato
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
    -- NOVO: valores específicos por mês (pontual) ou reajustes (recorrentes)
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
  `);

  // Colunas extras no histórico (ignora silenciosamente se já existirem)
  try { db.exec(`ALTER TABLE cob_ajustes ADD COLUMN mes TEXT`); } catch (e) { /* já existe */ }
  try { db.exec(`ALTER TABLE cob_ajustes ADD COLUMN tipo TEXT`); } catch (e) { /* já existe */ }

  // ===== Helpers de valor vigente =====

  // Todos os override do cliente, ordenados por mês ascendente
  function overridesDoCliente(clienteId) {
    return db.prepare(`
      SELECT mes, valor, tipo FROM cob_valores
      WHERE cliente_id = ? ORDER BY mes ASC
    `).all(clienteId);
  }

  // Mapa cliente_id -> array de overrides (evita N+1 consultas em loops)
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

  // Valor vigente do cliente em um mês:
  //   1) valor pontual daquele mês, se existir
  //   2) valor do último reajuste com mês <= mês consultado
  //   3) valor base do contrato
  function valorNoMes(cliente, overrides, mes) {
    const pontual = overrides.find((o) => o.tipo === "pontual" && o.mes === mes);
    if (pontual) return pontual.valor;

    let reajuste = null; // percorre em ordem crescente: fica com o mais recente
    for (const o of overrides) {
      if (o.tipo === "reajuste" && o.mes <= mes) reajuste = o.valor;
    }
    return reajuste !== null ? reajuste : (cliente.valor_mensal || 0);
  }

  const mesAtualStr = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  };

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
    const info = db.prepare(`
      INSERT INTO cob_clientes (nome, valor_mensal, dia_cobranca, data_vencimento, observacoes)
      VALUES (?, ?, ?, ?, ?)
    `).run(nome, valor, dia, b.data_vencimento || null, b.observacoes || null);
    return { ok: true, id: info.lastInsertRowid };
  });

  // PUT /api/cobrancas/clientes/:id -> edita (valor_mensal = valor BASE do contrato)
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

  // DELETE /api/cobrancas/clientes/:id -> remove cliente e registros ligados
  app.delete("/api/cobrancas/clientes/:id", async (req) => {
    const id = Number(req.params.id);
    db.prepare(`DELETE FROM cob_pagamentos WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_ajustes WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_clientes WHERE id = ?`).run(id);
    return { ok: true };
  });

  // ===== VALORES POR MÊS (o coração da correção) =====

  // POST /api/cobrancas/valores
  // body: { cliente_id, mes: "YYYY-MM", valor, tipo: "pontual"|"reajuste", motivo }
  //   tipo "pontual"  -> vale SOMENTE para aquele mês
  //   tipo "reajuste" -> vale daquele mês EM DIANTE (meses anteriores intactos)
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
    const anterior = valorNoMes(cliente, overrides, mes);

    db.prepare(`
      INSERT INTO cob_valores (cliente_id, mes, valor, tipo, motivo)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cliente_id, mes, tipo) DO UPDATE SET
        valor = excluded.valor,
        motivo = excluded.motivo
    `).run(clienteId, mes, valor, tipo, motivo);

    // Histórico: registra a diferença aplicada
    const delta = valor - anterior;
    if (Math.abs(delta) > 0.004) {
      db.prepare(`
        INSERT INTO cob_ajustes (cliente_id, valor, motivo, mes, tipo)
        VALUES (?, ?, ?, ?, ?)
      `).run(clienteId, delta, motivo, mes, tipo);
    }

    // IMPORTANTE: o valor base NÃO é alterado por reajuste.
    // Se fosse, os meses anteriores (que usam o base) também mudariam.
    return { ok: true, mes, valor, tipo, anterior };
  });

  // DELETE /api/cobrancas/valores/:clienteId/:mes -> remove o override do mês
  // (volta ao reajuste vigente ou ao valor base)
  app.delete("/api/cobrancas/valores/:clienteId/:mes", async (req, reply) => {
    const clienteId = Number(req.params.clienteId);
    const mes = String(req.params.mes || "");
    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes)) {
      return reply.code(400).send({ error: "clienteId e mes (YYYY-MM) são obrigatórios" });
    }
    db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ? AND mes = ?`).run(clienteId, mes);
    return { ok: true };
  });

  // ===== STATUS DE PAGAMENTO =====

  // GET /api/cobrancas/status?mes=YYYY-MM -> status + valor vigente no mês
  app.get("/api/cobrancas/status", async (req) => {
    const mes = String(req.query.mes || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) return [];

    const clientes = db.prepare(`SELECT * FROM cob_clientes ORDER BY nome COLLATE NOCASE`).all();
    const regs = db.prepare(`SELECT cliente_id, status, pago_em FROM cob_pagamentos WHERE mes = ?`).all(mes);
    const porCliente = {};
    for (const r of regs) porCliente[r.cliente_id] = r;
    const ovMapa = overridesDeTodos();

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

      const temPontual = overrides.some((o) => o.tipo === "pontual" && o.mes === mes);
      const temReajuste = overrides.some((o) => o.tipo === "reajuste" && o.mes === mes);

      return {
        cliente_id: c.id,
        nome: c.nome,
        valor_mensal: valorNoMes(c, overrides, mes), // valor vigente NESTE mês
        valor_base: c.valor_mensal,
        dia_cobranca: c.dia_cobranca,
        data_vencimento: c.data_vencimento,
        ajustado: temPontual || temReajuste,
        tipo_ajuste: temPontual ? "pontual" : (temReajuste ? "reajuste" : null),
        status,
        pago_em: reg ? reg.pago_em : null,
      };
    });
  });

  // POST /api/cobrancas/status -> marca/desmarca pagamento (pago | pendente)
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

  // GET /api/cobrancas/resumo?ano=YYYY
  // O "esperado" de cada mês usa o valor VIGENTE naquele mês — não o valor de hoje.
  app.get("/api/cobrancas/resumo", async (req) => {
    const ano = parseInt(req.query.ano, 10) || new Date().getFullYear();
    const clientes = db.prepare(`SELECT id, nome, valor_mensal, created_at FROM cob_clientes`).all();
    const clienteMapa = {};
    for (const c of clientes) clienteMapa[c.id] = c;
    const ovMapa = overridesDeTodos();

    // Quanto foi efetivamente recebido, mês a mês (com o valor vigente de cada mês)
    const pagos = db.prepare(`
      SELECT mes, cliente_id FROM cob_pagamentos
      WHERE status = 'pago' AND mes LIKE ?
    `).all(ano + "-%");
    const pagoPorMes = {};
    for (const p of pagos) {
      const c = clienteMapa[p.cliente_id];
      if (!c) continue;
      const v = valorNoMes(c, ovMapa[c.id] || [], p.mes);
      pagoPorMes[p.mes] = (pagoPorMes[p.mes] || 0) + v;
    }

    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const mes = ano + "-" + String(m).padStart(2, "0");
      // limite do mês em UTC (o created_at do SQLite é gravado em UTC)
      const fimMes = new Date(Date.UTC(ano, m, 0, 23, 59, 59)).toISOString().slice(0, 19).replace("T", " ");

      const esperado = clientes
        .filter((c) => (c.created_at || "") <= fimMes)
        .reduce((s, c) => s + valorNoMes(c, ovMapa[c.id] || [], mes), 0);

      const pago = pagoPorMes[mes] || 0;
      meses.push({ mes, esperado, pago, pendente: Math.max(0, esperado - pago) });
    }

    const totalEsperado = meses.reduce((s, x) => s + x.esperado, 0);
    const totalPago = meses.reduce((s, x) => s + x.pago, 0);

    // Contrato vigente hoje (soma dos valores do mês corrente)
    const now = mesAtualStr();
    const contratoMensal = clientes.reduce((s, c) => s + valorNoMes(c, ovMapa[c.id] || [], now), 0);

    // Anos disponíveis para o seletor
    const anosPagos = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_pagamentos`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosValores = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_valores`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosCriacao = clientes.map((c) => Number((c.created_at || "").slice(0, 4))).filter(Number.isFinite);
    const anos = [...new Set([new Date().getFullYear(), ...anosPagos, ...anosValores, ...anosCriacao])]
      .sort((a, b) => b - a);

    return {
      ano,
      anos,
      meses,
      totalEsperado,
      totalPago,
      totalPendente: Math.max(0, totalEsperado - totalPago),
      clientesAtivos: clientes.length,
      contratoMensal,
    };
  });

  // ===== LEGADO (compatibilidade com frontend antigo em cache) =====
  // Soma o valor ao mês CORRENTE como ajuste pontual — nunca a todos os meses.
  app.post("/api/cobrancas/clientes/:id/adicionar", async (req, reply) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const delta = Number(b.valor);
    if (!Number.isFinite(delta) || delta === 0) {
      return reply.code(400).send({ error: "informe um valor diferente de zero" });
    }
    const cliente = db.prepare(`SELECT * FROM cob_clientes WHERE id = ?`).get(id);
    if (!cliente) return reply.code(404).send({ error: "cliente não encontrado" });

    const mes = mesAtualStr();
    const overrides = overridesDoCliente(id);
    const anterior = valorNoMes(cliente, overrides, mes);
    const novo = Math.max(0, anterior + delta);

    db.prepare(`
      INSERT INTO cob_valores (cliente_id, mes, valor, tipo, motivo)
      VALUES (?, ?, ?, 'pontual', ?)
      ON CONFLICT(cliente_id, mes, tipo) DO UPDATE SET
        valor = excluded.valor, motivo = excluded.motivo
    `).run(id, mes, novo, b.motivo || null);

    db.prepare(`INSERT INTO cob_ajustes (cliente_id, valor, motivo, mes, tipo) VALUES (?, ?, ?, ?, 'pontual')`)
      .run(id, novo - anterior, b.motivo || null, mes);

    return { ok: true, mes, valor: novo, anterior };
  });
};

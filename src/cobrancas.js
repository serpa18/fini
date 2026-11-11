// ============================================================
// src/cobrancas.js
// Aba de Cobranças: clientes (contrato recorrente ou avulso),
// valores por mês, serviços extras, exclusão mensal/encerramento,
// status de pagamento mensal e visão geral por ano.
//
// REGRA DE VALORES
//   valor do mês = valor vigente do contrato/avulso + serviços extras do mês
//   valor vigente = pontual do mês > último reajuste <= mês > valor base
// ============================================================

module.exports = function registerCobrancas(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cob_clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      tipo_cobranca TEXT NOT NULL DEFAULT 'contrato',
      valor_mensal REAL NOT NULL DEFAULT 0,
      dia_cobranca INTEGER NOT NULL DEFAULT 1,
      mes_inicio TEXT,
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
    CREATE TABLE IF NOT EXISTS cob_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      descricao TEXT,
      valor REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cob_exclusoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(cliente_id, mes)
    );
  `);

  try { db.exec(`ALTER TABLE cob_clientes ADD COLUMN tipo_cobranca TEXT NOT NULL DEFAULT 'contrato'`); } catch (e) {}
  try { db.exec(`ALTER TABLE cob_clientes ADD COLUMN mes_inicio TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE cob_ajustes ADD COLUMN mes TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE cob_ajustes ADD COLUMN tipo TEXT`); } catch (e) {}

  // ===== Helpers =====

  const mesAtualStr = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  };

  function mesAnteriorStr(mes) {
    const [ano, m] = String(mes).split("-").map(Number);
    if (!ano || !m) return null;
    if (m === 1) return `${ano - 1}-12`;
    return `${ano}-${String(m - 1).padStart(2, "0")}`;
  }

  function ultimoDiaDoMes(mes) {
    const [ano, m] = String(mes).split("-").map(Number);
    if (!ano || !m) return null;
    const ultimo = new Date(ano, m, 0).getDate();
    return `${ano}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
  }

  function mesInicioEfetivo(cliente) {
    if (cliente.mes_inicio && /^\d{4}-\d{2}$/.test(cliente.mes_inicio)) {
      return cliente.mes_inicio;
    }
    const criado = String(cliente.created_at || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(criado)) return criado;
    return null;
  }

  function mesFimEfetivo(cliente) {
    if (cliente.tipo_cobranca === "avulso") {
      return mesInicioEfetivo(cliente);
    }
    const venc = String(cliente.data_vencimento || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(venc)) return venc;
    return null;
  }

  function exclusoesSet() {
    const rows = db.prepare(`SELECT cliente_id, mes FROM cob_exclusoes`).all();
    return new Set(rows.map((r) => `${r.cliente_id}:${r.mes}`));
  }

  function pagamentosRegistradosSet() {
    const rows = db.prepare(`SELECT cliente_id, mes FROM cob_pagamentos`).all();
    return new Set(rows.map((r) => `${r.cliente_id}:${r.mes}`));
  }

  function clienteAtivoNoMes(cliente, mes, ctx = {}) {
    if (!/^\d{4}-\d{2}$/.test(mes)) return false;

    // 1) Se foi removido/dispensado especificamente neste mês
    if (ctx.exclusoes && ctx.exclusoes.has(`${cliente.id}:${mes}`)) {
      return false;
    }

    const tipo = cliente.tipo_cobranca === "avulso" ? "avulso" : "contrato";
    const inicio = mesInicioEfetivo(cliente);
    const fim = mesFimEfetivo(cliente);

    // 2) Cliente avulso: aparece somente no mês da cobrança
    if (tipo === "avulso") {
      return inicio ? mes === inicio : false;
    }

    // 3) Contrato com prazo determinado: encerra após o mês de vencimento
    if (fim && mes > fim) {
      return false;
    }

    // 4) Antes do mês de início do contrato: só exibe se já houver lançamento explícito naquele mês
    if (inicio && mes < inicio) {
      const temPagamento = ctx.pagosReg && ctx.pagosReg.has(`${cliente.id}:${mes}`);
      const temOverride = ctx.ovMapa && (ctx.ovMapa[cliente.id] || []).some((o) => o.mes === mes);
      const temExtra = ctx.exMapa && ctx.exMapa[cliente.id] && ctx.exMapa[cliente.id][mes] > 0;
      return Boolean(temPagamento || temOverride || temExtra);
    }

    return true;
  }

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

  // ===== CLIENTES =====

  app.get("/api/cobrancas/clientes", async () => {
    return db.prepare(`
      SELECT id, nome, tipo_cobranca, valor_mensal, dia_cobranca, mes_inicio, data_vencimento, observacoes, created_at
      FROM cob_clientes ORDER BY nome COLLATE NOCASE
    `).all();
  });

  app.post("/api/cobrancas/clientes", async (req, reply) => {
    const b = req.body || {};
    const nome = String(b.nome || "").trim();
    const tipoCobranca = b.tipo_cobranca === "avulso" ? "avulso" : "contrato";
    const valor = Number(b.valor_mensal);
    const dia = Math.min(31, Math.max(1, parseInt(b.dia_cobranca, 10) || 1));
    const mesInicio = b.mes_inicio && /^\d{4}-\d{2}$/.test(String(b.mes_inicio))
      ? String(b.mes_inicio)
      : mesAtualStr();

    if (!nome || !Number.isFinite(valor) || valor < 0) {
      return reply.code(400).send({ error: "nome e valor_mensal (>= 0) são obrigatórios" });
    }

    let dataVencimento = b.data_vencimento || null;
    if (tipoCobranca === "avulso") {
      dataVencimento = `${mesInicio}-${String(dia).padStart(2, "0")}`;
    } else if (dataVencimento && /^\d{4}-\d{2}$/.test(dataVencimento)) {
      dataVencimento = ultimoDiaDoMes(dataVencimento);
    }

    const info = db.prepare(`
      INSERT INTO cob_clientes (nome, tipo_cobranca, valor_mensal, dia_cobranca, mes_inicio, data_vencimento, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nome, tipoCobranca, valor, dia, mesInicio, dataVencimento, b.observacoes || null);

    return { ok: true, id: info.lastInsertRowid };
  });

  app.put("/api/cobrancas/clientes/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const atual = db.prepare(`SELECT * FROM cob_clientes WHERE id = ?`).get(id);
    if (!atual) return reply.code(404).send({ error: "cliente não encontrado" });

    const b = req.body || {};
    const nome = b.nome !== undefined ? String(b.nome).trim() : atual.nome;
    const tipoCobranca = b.tipo_cobranca !== undefined
      ? (b.tipo_cobranca === "avulso" ? "avulso" : "contrato")
      : (atual.tipo_cobranca || "contrato");
    const valor = b.valor_mensal !== undefined ? Number(b.valor_mensal) : atual.valor_mensal;
    const dia = b.dia_cobranca !== undefined
      ? Math.min(31, Math.max(1, parseInt(b.dia_cobranca, 10) || 1))
      : atual.dia_cobranca;
    const mesInicio = b.mes_inicio !== undefined
      ? (b.mes_inicio && /^\d{4}-\d{2}$/.test(String(b.mes_inicio)) ? String(b.mes_inicio) : mesInicioEfetivo(atual))
      : mesInicioEfetivo(atual);

    let venc = b.data_vencimento !== undefined ? (b.data_vencimento || null) : atual.data_vencimento;
    if (tipoCobranca === "avulso") {
      venc = `${mesInicio || mesAtualStr()}-${String(dia).padStart(2, "0")}`;
    } else if (venc && /^\d{4}-\d{2}$/.test(venc)) {
      venc = ultimoDiaDoMes(venc);
    }

    const obs = b.observacoes !== undefined ? (b.observacoes || null) : atual.observacoes;

    if (!nome || !Number.isFinite(valor) || valor < 0) {
      return reply.code(400).send({ error: "dados inválidos" });
    }

    db.prepare(`
      UPDATE cob_clientes
      SET nome = ?, tipo_cobranca = ?, valor_mensal = ?, dia_cobranca = ?, mes_inicio = ?, data_vencimento = ?, observacoes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nome, tipoCobranca, valor, dia, mesInicio, venc, obs, id);

    return { ok: true };
  });

  function excluirClienteCompleto(id) {
    db.prepare(`DELETE FROM cob_pagamentos WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_ajustes WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_extras WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_exclusoes WHERE cliente_id = ?`).run(id);
    db.prepare(`DELETE FROM cob_clientes WHERE id = ?`).run(id);
  }

  app.delete("/api/cobrancas/clientes/:id", async (req) => {
    const id = Number(req.params.id);
    excluirClienteCompleto(id);
    return { ok: true };
  });

  // Remove a cobrança apenas de um mês, encerra o contrato a partir daquele mês ou apaga tudo
  app.delete("/api/cobrancas/mes/:clienteId/:mes", async (req, reply) => {
    const clienteId = Number(req.params.clienteId);
    const mes = String(req.params.mes || "");
    const modo = String((req.query && req.query.modo) || "mes");

    if (!clienteId || !/^\d{4}-\d{2}$/.test(mes)) {
      return reply.code(400).send({ error: "clienteId e mes (YYYY-MM) são obrigatórios" });
    }

    const cliente = db.prepare(`SELECT * FROM cob_clientes WHERE id = ?`).get(clienteId);
    if (!cliente) return reply.code(404).send({ error: "cliente não encontrado" });

    // Se pediu exclusão completa ou se o cliente é avulso (só existe naquele mês)
    if (modo === "tudo" || cliente.tipo_cobranca === "avulso") {
      excluirClienteCompleto(clienteId);
      return { ok: true, acao: "excluido_completo" };
    }

    // Se pediu para encerrar o contrato a partir deste mês (preservando meses anteriores)
    if (modo === "encerrar") {
      const ant = mesAnteriorStr(mes);
      const inicio = mesInicioEfetivo(cliente);
      if (!ant || (inicio && ant < inicio)) {
        // Contrato não tinha meses anteriores válidos
        excluirClienteCompleto(clienteId);
        return { ok: true, acao: "excluido_completo" };
      }
      const dataFim = ultimoDiaDoMes(ant);
      db.prepare(`
        UPDATE cob_clientes
        SET data_vencimento = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(dataFim, clienteId);
      db.prepare(`DELETE FROM cob_pagamentos WHERE cliente_id = ? AND mes >= ?`).run(clienteId, mes);
      db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ? AND mes >= ?`).run(clienteId, mes);
      db.prepare(`DELETE FROM cob_extras WHERE cliente_id = ? AND mes >= ?`).run(clienteId, mes);
      return { ok: true, acao: "contrato_encerrado", encerrado_em: dataFim };
    }

    // Padrão (modo === "mes"): dispensa/remove apenas a cobrança do mês selecionado
    db.prepare(`
      INSERT OR IGNORE INTO cob_exclusoes (cliente_id, mes)
      VALUES (?, ?)
    `).run(clienteId, mes);
    db.prepare(`DELETE FROM cob_pagamentos WHERE cliente_id = ? AND mes = ?`).run(clienteId, mes);
    db.prepare(`DELETE FROM cob_valores WHERE cliente_id = ? AND mes = ? AND tipo = 'pontual'`).run(clienteId, mes);
    db.prepare(`DELETE FROM cob_extras WHERE cliente_id = ? AND mes = ?`).run(clienteId, mes);

    return { ok: true, acao: "removido_do_mes", mes };
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
    const ctx = {
      exclusoes: exclusoesSet(),
      pagosReg: pagamentosRegistradosSet(),
      ovMapa,
      exMapa,
    };

    const hoje = new Date();
    const mesCorrente = mesAtualStr();
    const ehMesAtual = mes === mesCorrente;
    const mesPassado = mes < mesCorrente;
    const diaHoje = hoje.getDate();

    return clientes
      .filter((c) => clienteAtivoNoMes(c, mes, ctx))
      .map((c) => {
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
          tipo_cobranca: c.tipo_cobranca || "contrato",
          mes_inicio: mesInicioEfetivo(c),
          valor_mensal: base,          // valor do contrato vigente no mês
          valor_base: c.valor_mensal,  // valor base cadastrado no contrato
          extras_total: extras,        // soma dos serviços extras do mês
          valor_total: base + extras,  // o que deve ser cobrado no mês
          dia_cobranca: c.dia_cobranca,
          data_vencimento: c.data_vencimento,
          observacoes: c.observacoes || "",
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
    const mesRefQuery = String(req.query.mes || "");
    const clientes = db.prepare(`SELECT * FROM cob_clientes`).all();
    const ovMapa = overridesDeTodos();
    const exMapa = extrasDeTodos();
    const ctx = {
      exclusoes: exclusoesSet(),
      pagosReg: pagamentosRegistradosSet(),
      ovMapa,
      exMapa,
    };

    const totalDoMes = (cliente, mes) => {
      const base = valorBaseNoMes(cliente, ovMapa[cliente.id] || [], mes);
      const extras = (exMapa[cliente.id] && exMapa[cliente.id][mes]) || 0;
      return base + extras;
    };

    const pagosRows = db.prepare(`
      SELECT mes, cliente_id FROM cob_pagamentos
      WHERE status = 'pago' AND mes LIKE ?
    `).all(ano + "-%");
    const pagosNoAnoSet = new Set(pagosRows.map((p) => `${p.cliente_id}:${p.mes}`));

    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const mes = ano + "-" + String(m).padStart(2, "0");
      const ativosNoMes = clientes.filter((c) => clienteAtivoNoMes(c, mes, ctx));

      const esperado = ativosNoMes.reduce((s, c) => s + totalDoMes(c, mes), 0);
      const pago = ativosNoMes
        .filter((c) => pagosNoAnoSet.has(`${c.id}:${mes}`))
        .reduce((s, c) => s + totalDoMes(c, mes), 0);

      meses.push({ mes, esperado, pago, pendente: Math.max(0, esperado - pago) });
    }

    const totalEsperado = meses.reduce((s, x) => s + x.esperado, 0);
    const totalPago = meses.reduce((s, x) => s + x.pago, 0);

    const now = mesAtualStr();
    const mesRef = /^\d{4}-\d{2}$/.test(mesRefQuery)
      ? mesRefQuery
      : (now.startsWith(String(ano)) ? now : `${ano}-12`);

    const ativosNoMesRef = clientes.filter((c) => clienteAtivoNoMes(c, mesRef, ctx));
    const contratoMensal = ativosNoMesRef
      .filter((c) => (c.tipo_cobranca || "contrato") === "contrato")
      .reduce((s, c) => s + valorBaseNoMes(c, ovMapa[c.id] || [], mesRef), 0);

    const extrasAno = db.prepare(`SELECT COALESCE(SUM(valor), 0) AS t FROM cob_extras WHERE mes LIKE ?`)
      .get(ano + "-%").t;

    const anosPagos = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_pagamentos`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosValores = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_valores`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosExtras = db.prepare(`SELECT DISTINCT substr(mes, 1, 4) AS ano FROM cob_extras`).all()
      .map((r) => Number(r.ano)).filter(Number.isFinite);
    const anosInicio = clientes.map((c) => Number((mesInicioEfetivo(c) || "").slice(0, 4))).filter(Number.isFinite);
    const anosFim = clientes.map((c) => Number((mesFimEfetivo(c) || "").slice(0, 4))).filter(Number.isFinite);
    const anos = [...new Set([new Date().getFullYear(), ...anosPagos, ...anosValores, ...anosExtras, ...anosInicio, ...anosFim])]
      .sort((a, b) => b - a);

    return {
      ano,
      anos,
      meses,
      totalEsperado,
      totalPago,
      totalPendente: Math.max(0, totalEsperado - totalPago),
      clientesAtivos: ativosNoMesRef.length,
      contratoMensal,
      extrasAno,
    };
  });

  // ===== LEGADO =====
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

// ============================================================
// src/proventos.js
// Módulo de Proventos (Dividendos, Rendimentos de FII, JCP,
// Amortizações, Cupom Tesouro e Aluguel de Ações / BTC)
// - Auto-importa lançamentos da XP/Pluggy presentes em transactions
// - Permite cadastro manual, edição, exclusão e cálculo de Yield on Cost
// ============================================================

const { classificarAtivoB3 } = require("./carteira");

function parseNumeroBR(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extrairProventoDeTransacao(tx, knownTickers = []) {
  const amount = Number(tx.amount) || 0;
  if (amount <= 0) return null;
  const desc = String(tx.description || "").trim();
  const upper = desc.toUpperCase();

  let m;
  if ((m = upper.match(/DIVIDENDOS DE CLIENTES\s+([A-Z0-9]+)\s+S\/\s*([\d.,]+)/))) {
    const info = classificarAtivoB3(m[1]);
    return {
      ativo: info.ativo,
      classe: info.classe,
      tipo: "Dividendo",
      cotas_base: parseNumeroBR(m[2]),
    };
  }
  if ((m = upper.match(/RENDIMENTOS DE CLIENTES\s+([A-Z0-9]+)\s+S\/\s*([\d.,]+)/))) {
    const info = classificarAtivoB3(m[1]);
    return {
      ativo: info.ativo,
      classe: info.classe,
      tipo: "Rendimento",
      cotas_base: parseNumeroBR(m[2]),
    };
  }
  if ((m = upper.match(/JUROS S\/\s*CAPITAL DE CLIENTES\s+([A-Z0-9]+)\s+S\/\s*([\d.,]+)/))) {
    const info = classificarAtivoB3(m[1]);
    return {
      ativo: info.ativo,
      classe: info.classe,
      tipo: "JCP",
      cotas_base: parseNumeroBR(m[2]),
    };
  }
  if ((m = upper.match(/AMORTIZA[ÇC][ÃA]O\s+BR([A-Z]{4})[A-Z0-9]*\s+S\/\s*([\d.,]+)/))) {
    const prefix = m[1];
    const tickerMatch = knownTickers.find((t) => t.startsWith(prefix)) || (prefix + "11");
    const info = classificarAtivoB3(tickerMatch);
    return {
      ativo: info.ativo,
      classe: info.classe,
      tipo: "Amortização",
      cotas_base: parseNumeroBR(m[2]),
    };
  }
  if (upper.includes("TESOURO DIRETO") && (upper.includes("JUROS") || upper.includes("REPASSE") || upper.includes("CUPOM"))) {
    return {
      ativo: "Tesouro Direto",
      classe: "Tesouro",
      tipo: "Cupom Tesouro",
      cotas_base: null,
    };
  }
  if ((m = upper.match(/TAXA DE REMUNERA[ÇC][ÃA]O BTC\s+([A-Z0-9]+)/))) {
    const prefix = m[1];
    const tickerMatch = knownTickers.find((t) => t.startsWith(prefix)) || prefix;
    const info = classificarAtivoB3(tickerMatch);
    return {
      ativo: info.ativo,
      classe: info.classe,
      tipo: "Aluguel BTC",
      cotas_base: null,
    };
  }
  return null;
}

function registerProventos(app, db, carteiraHelpers = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inv_proventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_id TEXT UNIQUE,
      ativo TEXT NOT NULL,
      classe TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'Dividendo',
      valor REAL NOT NULL,
      cotas_base REAL,
      valor_por_cota REAL,
      data_pagamento TEXT NOT NULL,
      mes_ano TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'manual',
      descricao TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS inv_proventos_ignorados (
      tx_id TEXT PRIMARY KEY
    );
  `);

  function obterTickersConhecidos() {
    const set = new Set();
    try {
      db.prepare("SELECT DISTINCT ativo FROM inv_operacoes").all().forEach((r) => {
        if (r.ativo) set.add(String(r.ativo).toUpperCase());
      });
    } catch (_) {}
    try {
      db.prepare("SELECT DISTINCT code, name FROM investments WHERE COALESCE(balance, 0) > 0").all().forEach((r) => {
        if (r.code) set.add(String(r.code).toUpperCase());
        if (r.name) set.add(String(r.name).toUpperCase());
      });
    } catch (_) {}
    return [...set];
  }

  function importarDeTransacoes() {
    const knownTickers = obterTickersConhecidos();
    const ignorados = new Set(
      db.prepare("SELECT tx_id FROM inv_proventos_ignorados").all().map((r) => r.tx_id)
    );
    const txs = db.prepare(
      "SELECT id, date, amount, description FROM transactions WHERE amount > 0 ORDER BY date ASC"
    ).all();

    const ins = db.prepare(`
      INSERT OR IGNORE INTO inv_proventos
        (tx_id, ativo, classe, tipo, valor, cotas_base, valor_por_cota, data_pagamento, mes_ano, origem, descricao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pluggy', ?)
    `);

    let inseridos = 0;
    for (const tx of txs) {
      if (ignorados.has(tx.id)) continue;
      const parsed = extrairProventoDeTransacao(tx, knownTickers);
      if (!parsed) continue;
      const dataPag = String(tx.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      const mesAno = dataPag.slice(0, 7);
      const valor = Number(tx.amount) || 0;
      const vpc = parsed.cotas_base ? Number((valor / parsed.cotas_base).toFixed(6)) : null;

      const r = ins.run(
        tx.id,
        parsed.ativo,
        parsed.classe,
        parsed.tipo,
        valor,
        parsed.cotas_base,
        vpc,
        dataPag,
        mesAno,
        tx.description || null
      );
      if (r.changes > 0) inseridos++;
    }
    return inseridos;
  }

  // Importa automaticamente ao subir o servidor
  importarDeTransacoes();

  function calcularProventos(anoFiltro = null) {
    const todos = db.prepare(`
      SELECT * FROM inv_proventos
      ORDER BY data_pagamento DESC, id DESC
    `).all();

    const hoje = new Date();
    const anoAtual = String(hoje.getFullYear());
    const mesAtual = `${anoAtual}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const d12m = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
    const mes12mInicio = `${d12m.getFullYear()}-${String(d12m.getMonth() + 1).padStart(2, "0")}`;

    // Posições atuais da carteira para cálculo de Yield on Cost
    let posicoes = [];
    let custoTotalCarteira = 0;
    if (typeof carteiraHelpers.calcularCarteira === "function") {
      try {
        const cart = carteiraHelpers.calcularCarteira(true);
        posicoes = cart.posicoes || [];
        custoTotalCarteira = cart.resumo?.custoTotalCarteira || 0;
      } catch (_) {}
    }

    const posMap = {};
    for (const p of posicoes) {
      posMap[String(p.ativo || "").toUpperCase()] = p;
    }

    const listaFiltrada = anoFiltro && anoFiltro !== "todos"
      ? todos.filter((p) => (p.mes_ano || "").startsWith(String(anoFiltro)))
      : todos;

    let totalGeral = 0;
    let totalAno = 0;
    let total12m = 0;
    let mesAtualValor = 0;
    const porMesMap = {};
    const porAtivoMap = {};
    const porTipoMap = {};

    for (const p of todos) {
      const val = Number(p.valor) || 0;
      totalGeral += val;
      if ((p.mes_ano || "").startsWith(anoAtual)) totalAno += val;
      if (p.mes_ano >= mes12mInicio) total12m += val;
      if (p.mes_ano === mesAtual) mesAtualValor += val;
    }

    for (const p of listaFiltrada) {
      const val = Number(p.valor) || 0;
      const m = p.mes_ano || String(p.data_pagamento || "").slice(0, 7);
      if (m) {
        if (!porMesMap[m]) {
          porMesMap[m] = { mes: m, total: 0, Rendimento: 0, Dividendo: 0, JCP: 0, Outros: 0 };
        }
        porMesMap[m].total += val;
        if (porMesMap[m][p.tipo] !== undefined) porMesMap[m][p.tipo] += val;
        else porMesMap[m].Outros += val;
      }

      const k = String(p.ativo || "").toUpperCase();
      if (!porAtivoMap[k]) {
        const pos = posMap[k];
        porAtivoMap[k] = {
          ativo: p.ativo,
          classe: pos?.classe || p.classe,
          totalRecebido: 0,
          recebido12m: 0,
          qtdPagamentos: 0,
          ultimoPagamento: p.data_pagamento,
          ultimoValor: val,
          custoAtual: pos && pos.emCarteira ? pos.custoTotal : 0,
          cotasAtuais: pos && pos.emCarteira ? pos.cotas : 0,
          precoMedio: pos ? pos.precoMedio : 0,
          emCarteira: !!(pos && pos.emCarteira),
        };
      }
      porAtivoMap[k].totalRecebido += val;
      if (p.mes_ano >= mes12mInicio) porAtivoMap[k].recebido12m += val;
      porAtivoMap[k].qtdPagamentos += 1;
      if (p.data_pagamento > porAtivoMap[k].ultimoPagamento) {
        porAtivoMap[k].ultimoPagamento = p.data_pagamento;
        porAtivoMap[k].ultimoValor = val;
      }

      porTipoMap[p.tipo] = (porTipoMap[p.tipo] || 0) + val;
    }

    const porMes = Object.values(porMesMap).sort((a, b) => a.mes.localeCompare(b.mes));
    const porAtivo = Object.values(porAtivoMap)
      .map((a) => ({
        ...a,
        yocPeriodoPct: a.custoAtual > 0 ? (a.totalRecebido / a.custoAtual) * 100 : null,
        yoc12mPct: a.custoAtual > 0 ? (a.recebido12m / a.custoAtual) * 100 : null,
      }))
      .sort((a, b) => b.totalRecebido - a.totalRecebido);

    const totalFiltrado = listaFiltrada.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const mesesComProvento = porMes.length || 1;
    const mediaMensalPeriodo = totalFiltrado / mesesComProvento;
    const ultimoMes = porMes.length ? porMes[porMes.length - 1] : null;
    const yocCarteira12mPct = custoTotalCarteira > 0 ? (total12m / custoTotalCarteira) * 100 : 0;

    const anosDisponiveis = [...new Set(todos.map((p) => (p.mes_ano || "").slice(0, 4)).filter(Boolean))]
      .sort()
      .reverse();
    const ativosDisponiveis = [...new Set([
      ...todos.map((p) => p.ativo),
      ...posicoes.map((p) => p.ativo),
    ])].sort((a, b) => a.localeCompare(b, "pt-BR"));

    return {
      anoFiltro: anoFiltro || "todos",
      resumo: {
        totalGeral,
        totalFiltrado,
        totalAno,
        total12m,
        mesAtualValor,
        mediaMensalPeriodo,
        ultimoMes,
        custoTotalCarteira,
        yocCarteira12mPct,
        qtdAtivosPagantes: porAtivo.length,
        totalRegistros: listaFiltrada.length,
      },
      porTipo: Object.entries(porTipoMap).map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total),
      porMes,
      porAtivo,
      lancamentos: listaFiltrada,
      anosDisponiveis,
      ativosDisponiveis,
    };
  }

  function mapaTotalPorAtivo() {
    const rows = db.prepare("SELECT UPPER(ativo) AS k, SUM(valor) AS total FROM inv_proventos GROUP BY k").all();
    const m = {};
    for (const r of rows) m[r.k] = r.total || 0;
    return m;
  }

  // GET /api/proventos?ano=todos|2026
  app.get("/api/proventos", async (req) => {
    return calcularProventos(req.query.ano || "todos");
  });

  // POST /api/proventos/sincronizar -> re-escaneia transactions do Pluggy
  app.post("/api/proventos/sincronizar", async () => {
    const novos = importarDeTransacoes();
    return { ok: true, novos };
  });

  // POST /api/proventos -> cria provento manual
  app.post("/api/proventos", async (req, reply) => {
    const body = req.body || {};
    const rawAtivo = String(body.ativo || "").trim();
    const valor = Number(body.valor);
    const dataPag = String(body.data_pagamento || "").trim();
    const tipo = String(body.tipo || "Dividendo").trim() || "Dividendo";

    if (!rawAtivo) return reply.code(400).send({ error: "Informe o ativo (ex: MXRF11, PETR4)." });
    if (!Number.isFinite(valor) || valor <= 0) return reply.code(400).send({ error: "Informe um valor maior que zero." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPag)) return reply.code(400).send({ error: "Data inválida (YYYY-MM-DD)." });

    const info = classificarAtivoB3(rawAtivo, body.classe || null);
    const cotasBase = body.cotas_base !== undefined && body.cotas_base !== "" && Number(body.cotas_base) > 0
      ? Number(body.cotas_base)
      : null;
    const vpc = cotasBase ? Number((valor / cotasBase).toFixed(6)) : null;
    const mesAno = dataPag.slice(0, 7);
    const desc = (body.descricao || "").trim() || null;

    const r = db.prepare(`
      INSERT INTO inv_proventos
        (ativo, classe, tipo, valor, cotas_base, valor_por_cota, data_pagamento, mes_ano, origem, descricao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
    `).run(info.ativo, info.classe, tipo, valor, cotasBase, vpc, dataPag, mesAno, desc);

    return { ok: true, id: Number(r.lastInsertRowid) };
  });

  // PUT /api/proventos/:id -> edita provento
  app.put("/api/proventos/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const atual = db.prepare("SELECT * FROM inv_proventos WHERE id = ?").get(id);
    if (!atual) return reply.code(404).send({ error: "Provento não encontrado." });

    const body = req.body || {};
    const rawAtivo = body.ativo !== undefined ? String(body.ativo).trim() : atual.ativo;
    const valor = body.valor !== undefined ? Number(body.valor) : atual.valor;
    const dataPag = body.data_pagamento !== undefined ? String(body.data_pagamento).trim() : atual.data_pagamento;
    const tipo = body.tipo !== undefined ? String(body.tipo).trim() : atual.tipo;

    if (!rawAtivo || !Number.isFinite(valor) || valor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dataPag)) {
      return reply.code(400).send({ error: "Dados inválidos para atualizar provento." });
    }

    const info = classificarAtivoB3(rawAtivo, body.classe || atual.classe);
    const cotasBase = body.cotas_base !== undefined
      ? (body.cotas_base !== "" && Number(body.cotas_base) > 0 ? Number(body.cotas_base) : null)
      : atual.cotas_base;
    const vpc = cotasBase ? Number((valor / cotasBase).toFixed(6)) : null;
    const mesAno = dataPag.slice(0, 7);
    const desc = body.descricao !== undefined ? (String(body.descricao).trim() || null) : atual.descricao;

    db.prepare(`
      UPDATE inv_proventos
      SET ativo = ?, classe = ?, tipo = ?, valor = ?, cotas_base = ?, valor_por_cota = ?,
          data_pagamento = ?, mes_ano = ?, descricao = ?
      WHERE id = ?
    `).run(info.ativo, info.classe, tipo, valor, cotasBase, vpc, dataPag, mesAno, desc, id);

    return { ok: true, id };
  });

  // DELETE /api/proventos/:id -> exclui provento (e se veio do Pluggy, evita re-importar)
  app.delete("/api/proventos/:id", async (req) => {
    const id = Number(req.params.id);
    const atual = db.prepare("SELECT tx_id FROM inv_proventos WHERE id = ?").get(id);
    if (atual && atual.tx_id) {
      db.prepare("INSERT OR IGNORE INTO inv_proventos_ignorados (tx_id) VALUES (?)").run(atual.tx_id);
    }
    db.prepare("DELETE FROM inv_proventos WHERE id = ?").run(id);
    return { ok: true };
  });

  return {
    importarDeTransacoes,
    calcularProventos,
    mapaTotalPorAtivo,
  };
}

module.exports = { registerProventos, extrairProventoDeTransacao };

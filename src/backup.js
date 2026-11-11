// ============================================================
// src/backup.js
// Backup seguro do SQLite em 2 ambientes (HD Local + Google Drive)
// + Download do banco (.db) e exportação CSV de todos os dados
// ============================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  // BOM UTF-8 garante acentuação correta ao abrir no Excel/Numbers
  return "\uFEFF" + lines.join("\r\n");
}

function formatTimestampFile(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function hojeISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function listarArquivosBackup(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /^fini-backup-.*\.db$/i.test(f))
      .map((name) => {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        return { name, sizeBytes: st.size, mtimeMs: st.mtimeMs, mtimeIso: new Date(st.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

function limparAntigos(dir, keep = 15) {
  const arqs = listarArquivosBackup(dir);
  for (let i = keep; i < arqs.length; i++) {
    try {
      fs.unlinkSync(path.join(dir, arqs[i].name));
    } catch { /* ignorar erro de remoção */ }
  }
}

module.exports = function registerBackup(app, db, helpers = {}) {
  const defaultLocal = path.join(__dirname, "..", "backups", "local");
  const defaultCloudPath = "/app/backups/gdrive";

  function getEnvConfig() {
    const localDir = (process.env.BACKUP_DIR_LOCAL || defaultLocal).trim();
    const cloudDirEnv = (process.env.BACKUP_DIR_CLOUD || "").trim();
    const cloudDir = cloudDirEnv || (fs.existsSync(defaultCloudPath) ? defaultCloudPath : "");
    const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || "15", 10) || 15);
    return { localDir, cloudDir, keep };
  }

  function gerarSnapshotTemporario() {
    const fname = `fini-backup-${formatTimestampFile()}.db`;
    const tmpPath = path.join(os.tmpdir(), fname);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    // VACUUM INTO gera uma cópia íntegra, consistente e desfragmentada mesmo em modo WAL
    const escaped = tmpPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    return { fname, tmpPath };
  }

  function salvarEmDestino(tmpPath, fname, dir, keep, label) {
    if (!dir) {
      return {
        label,
        configured: false,
        ok: false,
        dir: null,
        error: "Pasta não configurada no ambiente",
      };
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      const destPath = path.join(dir, fname);
      fs.copyFileSync(tmpPath, destPath);
      const st = fs.statSync(destPath);
      limparAntigos(dir, keep);
      const files = listarArquivosBackup(dir);
      return {
        label,
        configured: true,
        ok: true,
        dir,
        file: fname,
        sizeBytes: st.size,
        filesCount: files.length,
        lastAt: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      return {
        label,
        configured: true,
        ok: false,
        dir,
        error: err.message,
      };
    }
  }

  function executarBackup(origem = "manual") {
    const { localDir, cloudDir, keep } = getEnvConfig();
    let tmp = null;
    try {
      tmp = gerarSnapshotTemporario();
      const localRes = salvarEmDestino(tmp.tmpPath, tmp.fname, localDir, keep, "HD Local");
      const cloudRes = salvarEmDestino(tmp.tmpPath, tmp.fname, cloudDir, keep, "Google Drive");

      const status = {
        origem,
        executedAt: new Date().toISOString(),
        keep,
        local: localRes,
        cloud: cloudRes,
      };
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('backup_last_status', ?)").run(JSON.stringify(status));
      if (localRes.ok || cloudRes.ok) {
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('backup_last_date', ?)").run(hojeISO());
      }
      return status;
    } finally {
      if (tmp && tmp.tmpPath && fs.existsSync(tmp.tmpPath)) {
        try { fs.unlinkSync(tmp.tmpPath); } catch { /* noop */ }
      }
    }
  }

  function executarBackupAutomatico() {
    try {
      const ultimaData = db.prepare("SELECT value FROM meta WHERE key = 'backup_last_date'").get()?.value;
      if (ultimaData === hojeISO()) return null;
      const res = executarBackup("automatico");
      console.log(`Backup automático executado: Local=${res.local.ok ? "OK" : res.local.error} | Google Drive=${res.cloud.ok ? "OK" : res.cloud.error}`);
      return res;
    } catch (err) {
      console.error("Erro no backup automático:", err.message);
      return null;
    }
  }

  // GET /api/backup/status -> configuração dos 2 ambientes + histórico recente
  app.get("/api/backup/status", async () => {
    const { localDir, cloudDir, keep } = getEnvConfig();
    let lastStatus = null;
    try {
      const raw = db.prepare("SELECT value FROM meta WHERE key = 'backup_last_status'").get()?.value;
      if (raw) lastStatus = JSON.parse(raw);
    } catch { /* ignorar JSON inválido */ }

    const inspecionarDir = (dir) => {
      if (!dir) return { configured: false, writable: false, dir: null, files: [] };
      let writable = false;
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        writable = true;
      } catch { writable = false; }
      return {
        configured: true,
        writable,
        dir,
        files: listarArquivosBackup(dir).slice(0, 10),
      };
    };

    return {
      keep,
      local: inspecionarDir(localDir),
      cloud: inspecionarDir(cloudDir),
      lastStatus,
    };
  });

  // POST /api/backup/run -> dispara backup imediato nos 2 ambientes
  app.post("/api/backup/run", async () => {
    const res = executarBackup("manual");
    return res;
  });

  // GET /api/backup/download-db -> baixa cópia íntegra atual do SQLite
  app.get("/api/backup/download-db", async (_req, reply) => {
    let tmp = null;
    try {
      tmp = gerarSnapshotTemporario();
      const buf = fs.readFileSync(tmp.tmpPath);
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", `attachment; filename="${tmp.fname}"`);
      return reply.send(buf);
    } finally {
      if (tmp && tmp.tmpPath && fs.existsSync(tmp.tmpPath)) {
        try { fs.unlinkSync(tmp.tmpPath); } catch { /* noop */ }
      }
    }
  });

  // GET /api/export/:tipo -> exportação CSV
  app.get("/api/export/:tipo", async (req, reply) => {
    const tipo = String(req.params.tipo || "").toLowerCase();
    const tag = hojeISO();
    let csv = "";
    let filename = `fini-${tipo}-${tag}.csv`;

    if (tipo === "transacoes") {
      const rows = db.prepare(`
        SELECT t.date, a.name AS conta, a.institution, t.category, COALESCE(t.manual_category, 0) AS manual,
               t.merchant, t.description, t.amount, t.installment_number, t.total_installments, t.status
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        ORDER BY t.date DESC
      `).all();
      csv = toCSV(
        ["Data", "Conta", "Instituição", "Categoria", "Edição Manual", "Estabelecimento", "Descrição", "Valor", "Parcela", "Total Parcelas", "Status"],
        rows.map((r) => [
          r.date,
          r.conta || "",
          r.institution || "",
          r.category,
          r.manual ? "Sim" : "Não",
          r.merchant || "",
          r.description || "",
          r.amount,
          r.installment_number ?? "",
          r.total_installments ?? "",
          r.status || "",
        ])
      );
    } else if (tipo === "operacoes") {
      const rows = db.prepare(`
        SELECT id, mes_ano, ativo, ticker_original, classe, tipo, cotas, preco_unitario, valor_bruto, taxa_corretagem, observacoes
        FROM inv_operacoes
        ORDER BY mes_ano DESC, id DESC
      `).all();
      csv = toCSV(
        ["ID", "Mês", "Ativo", "Ticker Original", "Classe", "Tipo", "Cotas", "Preço Unitário", "Valor Bruto", "Taxa Corretagem", "Observações"],
        rows.map((r) => [
          r.id, r.mes_ano, r.ativo, r.ticker_original || "", r.classe, r.tipo, r.cotas, r.preco_unitario, r.valor_bruto, r.taxa_corretagem, r.observacoes || "",
        ])
      );
    } else if (tipo === "posicoes") {
      const data = typeof helpers.calcularCarteira === "function"
        ? helpers.calcularCarteira(true)
        : { posicoes: [] };
      csv = toCSV(
        ["Ativo", "Classe", "Em Carteira", "Cotas", "Preço Médio (c/ taxas)", "Custo Total", "Valor Mercado", "Resultado", "Resultado %", "Proventos Totais", "YoC %"],
        (data.posicoes || []).map((p) => [
          p.ativo,
          p.classe,
          p.emCarteira ? "Sim" : "Encerrada",
          p.cotas,
          Number(p.precoMedio || 0).toFixed(4),
          Number(p.custoTotal || 0).toFixed(2),
          Number(p.valorMercadoAtual || 0).toFixed(2),
          p.resultadoAtual !== null ? Number(p.resultadoAtual).toFixed(2) : "",
          p.resultadoAtualPct !== null ? Number(p.resultadoAtualPct).toFixed(2) : "",
          Number(p.proventosTotal || 0).toFixed(2),
          p.yocPct !== null ? Number(p.yocPct).toFixed(2) : "",
        ])
      );
    } else if (tipo === "proventos") {
      const rows = db.prepare(`
        SELECT id, data_pagamento, ativo, classe, tipo, valor, cotas_base, origem, descricao
        FROM inv_proventos
        ORDER BY data_pagamento DESC, id DESC
      `).all();
      csv = toCSV(
        ["ID", "Data Pagamento", "Ativo", "Classe", "Tipo", "Valor Líquido", "Cotas Base", "Origem", "Descrição"],
        rows.map((r) => [
          r.id, r.data_pagamento, r.ativo, r.classe, r.tipo, r.valor, r.cotas_base ?? "", r.origem || "", r.descricao || "",
        ])
      );
    } else if (tipo === "cobrancas") {
      const rows = db.prepare(`
        SELECT c.id, c.nome, c.tipo_cobranca, c.valor_mensal, c.dia_cobranca, c.mes_inicio, c.data_vencimento,
               p.mes AS mes_referencia, p.status AS status_pagamento, p.pago_em, c.observacoes
        FROM cob_clientes c
        LEFT JOIN cob_pagamentos p ON p.cliente_id = c.id
        ORDER BY c.nome ASC, p.mes DESC
      `).all();
      csv = toCSV(
        ["ID Cliente", "Cliente", "Tipo", "Valor Base", "Dia Cobrança", "Início", "Vencimento Contrato", "Mês Ref", "Status", "Pago Em", "Observações"],
        rows.map((r) => [
          r.id, r.nome || "", r.tipo_cobranca || "", r.valor_mensal ?? "", r.dia_cobranca ?? "", r.mes_inicio || "", r.data_vencimento || "", r.mes_referencia || "", r.status_pagamento || "", r.pago_em || "", r.observacoes || "",
        ])
      );
    } else if (tipo === "faturas") {
      const rows = db.prepare(`
        SELECT b.due_date, b.close_date, a.name AS cartao, a.institution, b.total_amount, b.minimum_payment, b.status
        FROM bills b
        LEFT JOIN accounts a ON a.id = b.card_id
        ORDER BY b.due_date DESC
      `).all();
      csv = toCSV(
        ["Vencimento", "Fechamento", "Cartão", "Instituição", "Valor Total", "Pagamento Mínimo", "Status"],
        rows.map((r) => [
          r.due_date || "", r.close_date || "", r.cartao || "", r.institution || "", r.total_amount ?? "", r.minimum_payment ?? "", r.status || "",
        ])
      );
    } else {
      reply.code(400);
      return { error: "Tipo de exportação inválido. Use: transacoes, operacoes, posicoes, proventos ou cobrancas." };
    }

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csv);
  });

  return { executarBackup, executarBackupAutomatico };
};

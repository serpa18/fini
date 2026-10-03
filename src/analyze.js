const db = require("./db");

function monthly(ano) {
  let rows;
  if (ano) {
    rows = db.prepare(
      `SELECT strftime('%Y-%m', date) AS mes,
              SUM(CASE WHEN amount > 0 AND category <> 'Transferências' THEN amount ELSE 0 END) AS ganhos,
              SUM(CASE WHEN amount < 0 AND category <> 'Transferências' THEN -amount ELSE 0 END) AS gastos
       FROM transactions
       WHERE strftime('%Y', date) = ?
       GROUP BY mes ORDER BY mes DESC`
    ).all(String(ano));
  } else {
    rows = db.prepare(
      `SELECT strftime('%Y-%m', date) AS mes,
              SUM(CASE WHEN amount > 0 AND category <> 'Transferências' THEN amount ELSE 0 END) AS ganhos,
              SUM(CASE WHEN amount < 0 AND category <> 'Transferências' THEN -amount ELSE 0 END) AS gastos
       FROM transactions GROUP BY mes ORDER BY mes DESC`
    ).all();
  }
  return rows.map((r) => ({ ...r, saldo: r.ganhos - r.gastos }));
}

function ranking(mes) {
  return db.prepare(
    `SELECT category, SUM(-amount) AS total
     FROM transactions
     WHERE amount < 0 AND category <> 'Transferências' AND strftime('%Y-%m', date) = ?
     GROUP BY category ORDER BY total DESC`
  ).all(mes);
}

function assinaturas() {
  return db.prepare(
    `SELECT description, COUNT(*) AS vezes, SUM(-amount) AS total
     FROM transactions
     WHERE amount < 0 AND category = 'Assinaturas'
     GROUP BY description HAVING vezes >= 2`
  ).all();
}

function insights(mes) {
  const lista = monthly();
  const m = mes ? lista.find((r) => r.mes === mes) : lista[0];
  if (!m) return [];
  const rank = ranking(m.mes);
  const top = rank[0];
  const taxaPoupanca = m.ganhos > 0 ? Math.round((m.saldo / m.ganhos) * 100) : 0;
  return {
    mes: m.mes,
    ganhos: m.ganhos,
    gastos: m.gastos,
    saldo: m.saldo,
    taxaPoupanca,
    maiorGasto: top ? { categoria: top.category, total: top.total } : null,
  };
}

function melhores() {
  const lista = monthly();
  if (!lista.length) {
    return { maiorGanho: null, picoGastos: null, poupancaAno: 0, ano: new Date().getFullYear() };
  }
  const maiorGanho = lista.reduce((a, b) => (b.ganhos > a.ganhos ? b : a));
  const picoGastos = lista.reduce((a, b) => (b.gastos > a.gastos ? b : a));
  const anoAtual = new Date().getFullYear();
  const doAno = lista.filter((m) => m.mes.startsWith(String(anoAtual)));
  const poupancaAno = doAno.reduce((s, m) => s + m.saldo, 0);
  return {
    maiorGanho: { mes: maiorGanho.mes, valor: maiorGanho.ganhos },
    picoGastos: { mes: picoGastos.mes, valor: picoGastos.gastos },
    poupancaAno,
    ano: anoAtual,
  };
}

function saldoPorInstituicao() {
  return db.prepare(
    `SELECT COALESCE(institution, name) AS instituicao,
            SUM(balance) AS total,
            COUNT(*) AS contas
     FROM accounts
     GROUP BY instituicao
     ORDER BY total DESC`
  ).all();
}

function saldoTotal() {
  const row = db.prepare("SELECT SUM(balance) AS total FROM accounts").get();
  const tipos = db.prepare(
    "SELECT subtype, COUNT(*) AS n FROM accounts GROUP BY subtype"
  ).all();
  return { total: row.total || 0, contas: tipos, instituicoes: saldoPorInstituicao() };
}

function investimentosPorInstituicao() {
  return db.prepare(
    `SELECT COALESCE(institution, name) AS instituicao,
            SUM(balance) AS total,
            COUNT(*) AS ativos
     FROM investments
     GROUP BY instituicao
     ORDER BY total DESC`
  ).all();
}

function transacoesRecentes(limit = 8) {
  return db.prepare(
    `SELECT date, amount, description, category, merchant
     FROM transactions
     ORDER BY date DESC
     LIMIT ?`
  ).all(limit);
}

function investimentos() {
  return db.prepare("SELECT id, name, type, subtype, code, balance FROM investments").all();
}

function faturas() {
  return db.prepare(
    `SELECT b.id, b.card_id, ac.name AS cartao, b.due_date, b.total_amount, b.minimum_payment, b.status
     FROM bills b
     LEFT JOIN accounts ac ON ac.id = b.card_id
     WHERE b.due_date IS NULL OR date(b.due_date) >= date('now')
     ORDER BY b.due_date ASC`
  ).all();
}

function parcelas() {
  return db.prepare(
    `SELECT date, amount, description, merchant, category, installment_number, total_installments, status
     FROM transactions
     WHERE total_installments IS NOT NULL AND total_installments > 1
     ORDER BY date DESC
     LIMIT 200`
  ).all();
}

function syncInfo() {
  const rows = db.prepare("SELECT key, value FROM meta").all();
  const meta = {};
  for (const r of rows) meta[r.key] = r.value;

  const consents = Object.keys(meta).filter((k) => k.startsWith("consent_")).map((k) => meta[k]).sort();
  const statuses = Object.keys(meta).filter((k) => k.startsWith("status_")).map((k) => meta[k]);

  return {
    lastSyncAt: meta.last_sync_at || null,
    consentExpiresAt: consents.length ? consents[0] : null,
    statuses,
    itens: consents.length,
  };
}

module.exports = { monthly, ranking, assinaturas, insights, melhores, saldoTotal, transacoesRecentes, investimentos, investimentosPorInstituicao, faturas, parcelas, syncInfo };
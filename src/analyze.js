const db = require("./db");

function monthly() {
  const rows = db.prepare(
    `SELECT strftime('%Y-%m', date) AS mes,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS ganhos,
            SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS gastos
     FROM transactions GROUP BY mes ORDER BY mes DESC`
  ).all();
  return rows.map((r) => ({ ...r, saldo: r.ganhos - r.gastos }));
}

function ranking(mes) {
  return db.prepare(
    `SELECT category, SUM(-amount) AS total
     FROM transactions
     WHERE amount < 0 AND strftime('%Y-%m', date) = ?
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

function insights() {
  const m = monthly()[0];
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

module.exports = { monthly, ranking, assinaturas, insights };
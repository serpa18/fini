const pluggy = require("./pluggy");
const db = require("./db");
const { categorize } = require("./categorizer");

async function sync() {
  const upAcc = db.prepare(
    "INSERT OR REPLACE INTO accounts (id, name, type, balance) VALUES (?,?,?,?)"
  );
  const upTx = db.prepare(
    `INSERT OR REPLACE INTO transactions (id, account_id, date, amount, description, category, merchant)
     VALUES (?,?,?,?,?,?,?)`
  );
  const upCard = db.prepare("INSERT OR REPLACE INTO credit_cards (id, name, brand, balance) VALUES (?,?,?,?)");
  const upInv = db.prepare("INSERT OR REPLACE INTO investments (id, name, type, balance) VALUES (?,?,?,?)");

  let totalAccounts = 0;
  let txCount = 0;
  const notices = [];

  for (const itemId of pluggy.getItemIds()) {
    const accounts = await pluggy.getAccountsByItem(itemId);
    totalAccounts += accounts.length;

    for (const a of accounts) {
      upAcc.run(a.id, a.name, a.type, a.balance ?? null);

      try {
        const txs = await pluggy.getTransactions(a.id);
        for (const t of txs) {
          upTx.run(
            t.id,
            a.id,
            t.date,
            t.amount ?? 0,
            t.description || "",
            categorize(t.description),
            t.merchant?.name || null
          );
          txCount++;
        }
      } catch (err) {
        notices.push("transações da conta " + a.id + ": " + err.message);
      }
    }

    // Cartões e investimentos são opcionais: se o banco não expõe, avisa e segue
    try {
      const cards = await pluggy.getCreditCards(itemId);
      for (const c of cards) upCard.run(c.id, c.name || "", c.brand || "", c.balance ?? null);
    } catch (err) {
      notices.push("cartões: " + err.message);
    }

    try {
      const inv = await pluggy.getInvestments(itemId);
      for (const i of inv) upInv.run(i.id, i.name || "", i.type || "", i.balance ?? null);
    } catch (err) {
      notices.push("investimentos: " + err.message);
    }
  }

  console.log(`Sincronizado: ${totalAccounts} contas, ${txCount} transações`);
  for (const n of notices) console.log("Observação:", n);
}

module.exports = { sync };
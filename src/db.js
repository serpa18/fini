const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const candidatos = [
  path.join(__dirname, "..", "fini.db"),
  path.join(__dirname, "..", "data", "fini.db"),
];
let dbPath = candidatos.find((p) => fs.existsSync(p));
if (!dbPath) {
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, "fini.db");
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      subtype TEXT,
      balance REAL,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      date TEXT,
      amount REAL,
      description TEXT,
      category TEXT,
      merchant TEXT
    );
    CREATE TABLE IF NOT EXISTS credit_cards (
      id TEXT PRIMARY KEY,
      name TEXT,
      brand TEXT,
      balance REAL
    );
    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      balance REAL
    );
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      due_date TEXT,
      close_date TEXT,
      total_amount REAL,
      minimum_payment REAL,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const cols = db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name);
  if (!cols.includes("subtype")) db.exec("ALTER TABLE accounts ADD COLUMN subtype TEXT");
  if (!cols.includes("status")) db.exec("ALTER TABLE accounts ADD COLUMN status TEXT");
  if (!cols.includes("item_id")) db.exec("ALTER TABLE accounts ADD COLUMN item_id TEXT");
  if (!cols.includes("institution")) db.exec("ALTER TABLE accounts ADD COLUMN institution TEXT");

  const colsInv = db.prepare("PRAGMA table_info(investments)").all().map((c) => c.name);
  if (!colsInv.includes("item_id")) db.exec("ALTER TABLE investments ADD COLUMN item_id TEXT");
  if (!colsInv.includes("institution")) db.exec("ALTER TABLE investments ADD COLUMN institution TEXT");
  if (!colsInv.includes("subtype")) db.exec("ALTER TABLE investments ADD COLUMN subtype TEXT");
  if (!colsInv.includes("code")) db.exec("ALTER TABLE investments ADD COLUMN code TEXT");

  const colTx = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
  if (!colTx.includes("installment_number")) db.exec("ALTER TABLE transactions ADD COLUMN installment_number INTEGER");
  if (!colTx.includes("total_installments")) db.exec("ALTER TABLE transactions ADD COLUMN total_installments INTEGER");
  if (!colTx.includes("status")) db.exec("ALTER TABLE transactions ADD COLUMN status TEXT");
}

init();

module.exports = db;
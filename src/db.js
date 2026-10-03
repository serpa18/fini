const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// cria a pasta data automaticamente, se não existir
fs.mkdirSync(path.join(__dirname, "..", "data"), { recursive: true });

const db = new Database(path.join(__dirname, "..", "data", "fini.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, balance REAL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, account_id TEXT, date TEXT, amount REAL,
    description TEXT, category TEXT, merchant TEXT
  );
  CREATE TABLE IF NOT EXISTS credit_cards (
    id TEXT PRIMARY KEY, name TEXT, brand TEXT, balance REAL
  );
  CREATE TABLE IF NOT EXISTS investments (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, balance REAL
  );
`);

module.exports = db;
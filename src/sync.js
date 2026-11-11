const pluggy = require("./pluggy");
const db = require("./db");
const { categorize } = require("./categorizer");

// Categorias do Pluggy (inglês) → categorias do Fini (português)
const CAT_PLUGGY = {
  // Alimentação
  "food and drink": "Alimentação", "food": "Alimentação", "groceries": "Alimentação",
  "restaurants": "Alimentação", "eating out": "Alimentação", "bakery": "Alimentação",
  "bars": "Lazer", "coffee shops": "Alimentação", "fast food": "Alimentação",
  "meal delivery": "Alimentação", "supermarkets": "Alimentação", "convenience stores": "Alimentação",
  "drinks": "Alimentação", "cafe": "Alimentação", "cafeteria": "Alimentação",
  // Compras
  "shopping": "Compras", "online shopping": "Compras", "retail": "Compras",
  "clothing": "Compras", "electronics": "Compras", "department stores": "Compras",
  "home goods": "Compras", "furniture": "Compras", "appliances": "Compras",
  "sports equipment": "Compras", "toys": "Compras", "gifts": "Compras",
  "jewelry": "Compras", "cosmetics": "Compras", "personal care": "Compras",
  "books": "Educação", "stationery": "Educação",
  // Transporte
  "transportation": "Transporte", "transport": "Transporte",
  "public transportation": "Transporte", "vehicle": "Transporte",
  "vehicle maintenance": "Transporte", "fuel": "Transporte", "gasoline": "Transporte",
  "gas": "Transporte", "parking": "Transporte", "toll": "Transporte",
  "taxi": "Transporte", "rideshare": "Transporte", "uber": "Transporte",
  "car rental": "Transporte", "airport and airlines": "Transporte",
  "airlines": "Transporte", "airline": "Transporte", "flights": "Transporte",
  "train": "Transporte", "bus": "Transporte", "ferry": "Transporte",
  // Moradia
  "housing": "Moradia", "home": "Moradia", "rent": "Moradia",
  "utilities": "Moradia", "water": "Moradia", "electricity": "Moradia",
  "energy": "Moradia", "gas bill": "Moradia", "home improvement": "Moradia",
  "repairs": "Moradia", "property": "Moradia", "maintenance": "Moradia",
  "insurance": "Moradia",
  // Assinaturas
  "subscription": "Assinaturas", "subscriptions": "Assinaturas",
  "streaming": "Assinaturas", "digital services": "Assinaturas",
  "software": "Assinaturas", "apps": "Assinaturas",
  "telecommunication": "Assinaturas", "internet": "Assinaturas",
  "phone": "Assinaturas", "cable": "Assinaturas", "tv": "Assinaturas",
  "gym": "Saúde", "membership": "Assinaturas", "club membership": "Assinaturas",
  // Lazer
  "entertainment": "Lazer", "leisure": "Lazer", "travel": "Lazer",
  "vacation": "Lazer", "hotel": "Lazer", "lodging": "Lazer",
  "tourism": "Lazer", "cinema": "Lazer", "games": "Lazer",
  "concerts": "Lazer", "nightlife": "Lazer", "parties": "Lazer",
  // Saúde
  "health": "Saúde", "health & fitness": "Saúde", "fitness": "Saúde",
  "pharmacy": "Saúde", "optometry": "Saúde", "optical": "Saúde",
  "hospital": "Saúde", "doctor": "Saúde", "dental": "Saúde",
  "medicine": "Saúde", "clinic": "Saúde",
  // Educação
  "education": "Educação", "tuition": "Educação", "school": "Educação",
  "university": "Educação", "course": "Educação", "courses": "Educação",
  // Serviços
  "services": "Serviços", "service": "Serviços", "professional services": "Serviços",
  "legal": "Serviços", "tax": "Serviços", "fees": "Serviços",
  "loans": "Serviços", "interest": "Serviços", "bank fees": "Serviços",
  // Entradas / outros
  "income": "Outros", "salary": "Outros", "wages": "Outros",
  "transfer": "Outros", "other": "Outros", "miscellaneous": "Outros",
};

// Normaliza + remove acentos (ex.: "Cartão" vira "cartao")
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizarPadraoRegra(merchant, description) {
  const m = norm(merchant || "");
  if (m && m.length >= 2) return m;
  let d = norm(description || "");
  d = d
    .replace(/^(compra no debito|compra cartao|pag\*|pg \*|pix enviado|pix recebido|transferencia enviada pelo pix|transferencia recebida pelo pix)\s*[:|-]?\s*/g, "")
    .replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?.*$/, "")
    .trim();
  return d || norm(description || "");
}

function isInternalInvestmentMovement(texto) {
  return (
    texto.includes("aplicacao fundo") ||
    texto.includes("aplicacao rdb") ||
    texto.includes("resgate fundo") ||
    texto.includes("resgate rdb") ||
    texto.includes("transferencia recebida da conta investimento") ||
    texto.includes("transferencia enviada para a conta digital") ||
    texto.includes("entre contas") ||
    texto.includes("mesma titularidade")
  );
}

// Detecta pagamento de fatura / movimentação interna entre contas/aplicações:
// o gasto já é contado item a item nas compras; o pagamento do total NÃO deve somar de novo.
function isFaturaPayment(t, account = null) {
  const texto = norm((t.merchant?.name || "") + " " + (t.description || ""));
  if (texto.includes("fatura")) return true;
  const pagou = texto.includes("pagamento") || texto.includes("pgto") || texto.includes("pagto") || texto.includes("pago ");
  const cartao = texto.includes("cartao");
  if (pagou && cartao) return true;

  const isCreditAcc = Boolean(
    account &&
      ((account.type || "").toUpperCase().includes("CREDIT") ||
        (account.subtype || "").toUpperCase() === "CREDIT_CARD")
  );
  if (
    isCreditAcc &&
    (texto === "pagamento recebido" ||
      texto.startsWith("pagamento efetuado") ||
      texto.includes("pagamento de fatura"))
  ) {
    return true;
  }

  if (isInternalInvestmentMovement(texto)) return true;

  return false;
}

function resolveCategoryWithMeta(t, account = null, rulesCtx = null) {
  // 0a) Override manual salvo pelo usuário para este ID
  if (rulesCtx?.overrides && rulesCtx.overrides.has(t.id)) {
    return { category: rulesCtx.overrides.get(t.id), manual: 1 };
  }

  // 0b) Regra aprendida pelo usuário ("Aplicar sempre")
  const merchantName = t.merchant?.name || (typeof t.merchant === "string" ? t.merchant : "");
  const padrao = normalizarPadraoRegra(merchantName, t.description);
  const texto = norm(merchantName + " " + (t.description || ""));
  if (rulesCtx?.rules && rulesCtx.rules.length) {
    for (const r of rulesCtx.rules) {
      if (padrao === r.pattern || (r.pattern.length >= 3 && texto.includes(r.pattern))) {
        return { category: r.category, manual: 0 };
      }
    }
  }

  // 0c) Pagamento de fatura / transferência entre contas → não é despesa/receita
  if (isFaturaPayment(t, account)) return { category: "Transferências", manual: 0 };
  // 1) Categoria enviada pelo Pluggy
  if (t.category && typeof t.category === "string") {
    const cat = norm(t.category);
    if (CAT_PLUGGY[cat]) return { category: CAT_PLUGGY[cat], manual: 0 };
    // Match parcial: cobre subcategorias como "Food and drink - Groceries"
    for (const chave of Object.keys(CAT_PLUGGY)) {
      if (chave.length >= 3 && (cat.includes(chave) || chave.includes(cat))) {
        return { category: CAT_PLUGGY[chave], manual: 0 };
      }
    }
  }
  // 2) Fallback por palavras-chave na descrição (cobre categorias vazias)
  const KW = [
    ["Alimentação", ["mercado", "supermercado", "padaria", "acougue", "hortifruti", "restaurante", "lanchonete", "pizza", "ifood", "uber eats", "rappi", "mc donald", "subway", "habib", "barbecue", "grill"]],
    ["Compras", ["amazon", "mercado livre", "magalu", "magazine luiza", "casas bahia", "shein", "shopee", "americanas", "roupa", "calcado", "eletronico"]],
    ["Transporte", ["posto", "combustivel", "gasolina", "uber", "99taxi", "99 taxi", "estacionamento", "pedagio", "peagio"]],
    ["Assinaturas", ["netflix", "spotify", "youtube", "prime video", "disney", "hbo", "max", "apple tv", "google play", "microsoft", "adobe", "assinatura", "mensalidade", "internet", "vivo", "claro", "tim", "oi fibra"]],
    ["Saúde", ["farmacia", "drogasil", "droga raia", "drogaria", "pague menos", "consultorio", "clinica", "dentista", "hospital", "laboratorio", "exame"]],
    ["Lazer", ["cinema", "cinemark", "ingresso", "show", "bar", "pub", "viagem", "hotel", "passagem", "aereo", "azul", "latam", "gol linhas"]],
    ["Moradia", ["condominio", "aluguel", "agua", "luz", "energia", "celesc", "copel", "enel", "sabesp", "gas", "petrobras"]],
    ["Educação", ["escola", "faculdade", "curso", "colegio", "matricula", "kumon", "wizard", "ccaa"]],
    ["Serviços", ["seguro", "cartorio", "advogado", "contador", "imposto", "boleto banco", "taxa", "tarifa", "anuidade"]],
  ];
  for (const [cat, palavras] of KW) {
    for (const p of palavras) {
      if (texto.includes(p)) return { category: cat, manual: 0 };
    }
  }
  // 3) Último recurso: categorizador antigo
  return { category: categorize(t.description || "") || "Outros", manual: 0 };
}

function resolveCategory(t, account = null, rulesCtx = null) {
  return resolveCategoryWithMeta(t, account, rulesCtx).category;
}

function carregarContextoRegras() {
  const overrides = new Map();
  try {
    const manualRows = db.prepare("SELECT id, category FROM transactions WHERE COALESCE(manual_category, 0) = 1").all();
    for (const r of manualRows) overrides.set(r.id, r.category);
    const overRows = db.prepare("SELECT tx_id, category FROM tx_manual_overrides").all();
    for (const r of overRows) overrides.set(r.tx_id, r.category);
  } catch { /* tabelas ainda em boot */ }

  let rules = [];
  try {
    rules = db.prepare("SELECT pattern, category FROM tx_category_rules").all()
      .sort((a, b) => b.pattern.length - a.pattern.length);
  } catch { /* ignorar */ }

  return { overrides, rules };
}

// Corrige lançamentos já salvos em versões anteriores (ex.: Pagamento recebido no cartão como 'Outros')
function aplicarCorrecaoHistoricaCategorias() {
  try {
    const ja = db.prepare("SELECT value FROM meta WHERE key = 'fix_transfer_cats_v2'").get();
    if (ja) return 0;

    const rows = db.prepare(`
      SELECT t.id, t.description, t.merchant, t.category, t.manual_category, a.type AS acc_type, a.subtype AS acc_subtype
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE COALESCE(t.manual_category, 0) = 0
    `).all();

    const upd = db.prepare("UPDATE transactions SET category = 'Transferências' WHERE id = ?");
    let corrigidos = 0;
    for (const r of rows) {
      if (r.category === "Transferências") continue;
      const fakeTx = { id: r.id, description: r.description, merchant: { name: r.merchant } };
      const fakeAcc = { type: r.acc_type, subtype: r.acc_subtype };
      if (isFaturaPayment(fakeTx, fakeAcc)) {
        upd.run(r.id);
        corrigidos++;
      }
    }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('fix_transfer_cats_v2', ?)").run(new Date().toISOString());
    if (corrigidos > 0) console.log(`Migração de categorias: ${corrigidos} transações internas marcadas como Transferências`);
    return corrigidos;
  } catch (e) {
    console.error("Aviso na migração de categorias:", e.message);
    return 0;
  }
}

async function sync() {
  const rulesCtx = carregarContextoRegras();
  const upAcc = db.prepare(
    "INSERT OR REPLACE INTO accounts (id, name, type, subtype, balance, status, item_id, institution) VALUES (?,?,?,?,?,?,?,?)"
  );
  const upTx = db.prepare(
    `INSERT OR REPLACE INTO transactions (id, account_id, date, amount, description, category, merchant, installment_number, total_installments, status, manual_category)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const upCard = db.prepare("INSERT OR REPLACE INTO credit_cards (id, name, brand, balance) VALUES (?,?,?,?)");
  const upInv = db.prepare("INSERT OR REPLACE INTO investments (id, name, type, subtype, code, balance, item_id, institution) VALUES (?,?,?,?,?,?,?,?)");
  const upBill = db.prepare(
    "INSERT OR REPLACE INTO bills (id, card_id, due_date, close_date, total_amount, minimum_payment, status) VALUES (?,?,?,?,?,?,?)"
  );
  const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)");

  let totalAccounts = 0;
  let txCount = 0;
  const notices = [];

  const itemIds = pluggy.getItemIds();
  const nomes = (process.env.PLUGGY_ITEM_NAMES || "").split(",").map((s) => s.trim()).filter(Boolean);

  for (const [idx, itemId] of itemIds.entries()) {
    let produtos = [];
    let institution = nomes[idx] || null;
    try {
      const det = await pluggy.getItemDetails(itemId);
      produtos = det.products || [];
      if (!institution) institution = det.connector?.name || null;
      if (det.consentExpiresAt) setMeta.run(`consent_${itemId}`, det.consentExpiresAt);
      if (det.lastUpdatedAt) setMeta.run(`last_update_${itemId}`, det.lastUpdatedAt);
      if (det.status) setMeta.run(`status_${itemId}`, det.status);
    } catch (err) {
      notices.push("detalhes da conexão " + itemId + ": " + err.message);
    }

    const accounts = await pluggy.getAccountsByItem(itemId);
    totalAccounts += accounts.length;

    for (const a of accounts) {
      upAcc.run(a.id, a.name, a.type, a.subtype || null, a.balance ?? null, a.status || "UPDATED", itemId, institution);

      if (!produtos.length || produtos.includes("TRANSACTIONS")) {
        try {
          const hoje = new Date();
          const anoAtual = hoje.getFullYear();
          const dateFrom = `${anoAtual - 1}-01-01`;
          const dateTo = `${anoAtual}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

          const txs = await pluggy.getTransactions(a.id, { dateFrom, dateTo });
          for (const t of txs) {
            let amount = t.amount ?? 0;
            // Compras de cartão chegam com amount positivo; o campo type indica
            // a direção real (DEBIT = dinheiro saiu). Normaliza o sinal.
            if (t.type === "CREDIT") amount = Math.abs(amount);
            else if (t.type === "DEBIT") amount = -Math.abs(amount);

            const resolved = resolveCategoryWithMeta(t, a, rulesCtx);
            upTx.run(
              t.id,
              a.id,
              t.date,
              amount,
              t.description || "",
              resolved.category,
              t.merchant?.name || null,
              t.installmentNumber ?? null,
              t.totalInstallments ?? null,
              t.status || null,
              resolved.manual
            );
            txCount++;
          }
        } catch (err) {
          notices.push("transações da conta " + a.id + ": " + err.message);
        }
      }

      // Faturas de cartão de crédito
      if ((a.type || "").toUpperCase().includes("CREDIT") || (a.subtype || "").toUpperCase() === "CREDIT_CARD") {
        try {
          const bills = await pluggy.getBills(a.id);
          for (const b of bills) {
            upBill.run(
              b.id,
              a.id,
              b.dueDate || null,
              b.closeDate || b.billClosingDate || null,
              b.totalAmount ?? null,
              b.minimumPaymentAmount ?? null,
              b.status || null
            );
          }
        } catch (err) {
          notices.push("faturas da conta " + a.id + ": " + err.message);
        }
      }
    }

    if (!produtos.length || produtos.includes("CREDIT_CARDS")) {
      try {
        const cards = await pluggy.getCreditCards(itemId);
        for (const c of cards) upCard.run(c.id, c.name || "", c.brand || "", c.balance ?? null);
      } catch (err) {
        notices.push("cartões: " + err.message);
      }
    }

    if (!produtos.length || produtos.includes("INVESTMENTS")) {
      try {
        const inv = await pluggy.getInvestments(itemId);
        if (Array.isArray(inv) && inv.length > 0) {
          db.prepare("DELETE FROM investments WHERE item_id = ?").run(itemId);
          for (const i of inv) {
            upInv.run(i.id, i.name || "", i.type || "", i.subtype || "", i.code || "", i.balance ?? null, itemId, institution);
          }
        }
      } catch (err) {
        notices.push("investimentos: " + err.message);
      }
    }
  }

  setMeta.run("last_sync_at", new Date().toISOString());

  console.log(`Sincronizado: ${totalAccounts} contas, ${txCount} transações`);
  for (const n of notices) console.log("Observação:", n);
}

module.exports = {
  sync,
  norm,
  normalizarPadraoRegra,
  isFaturaPayment,
  resolveCategory,
  resolveCategoryWithMeta,
  carregarContextoRegras,
  aplicarCorrecaoHistoricaCategorias,
};
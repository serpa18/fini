const PLUGGY_API = "https://api.pluggy.ai";

let cachedToken = null;
let tokenExpiresAt = 0;

function getItemIds() {
  const raw = process.env.PLUGGY_ITEM_ID || "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("PLUGGY_ITEM_ID está vazio no .env. Coloque o ID da sua conexão (itemId) e rode de novo.");
  }
  return ids;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;

  const res = await fetch(`${PLUGGY_API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.apiKey) {
    throw new Error(
      "Falha na autenticação do Pluggy (HTTP " + res.status + "): " + JSON.stringify(data) +
      ". Confira se o .env tem o Client ID e o Client Secret reais."
    );
  }

  cachedToken = data.apiKey;
  tokenExpiresAt = Date.now() + (data.expiresIn || 7200) * 1000;
  return cachedToken;
}

async function api(path) {
  const token = await getToken();
  const res = await fetch(`${PLUGGY_API}${path}`, {
    headers: { "x-api-key": token },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Erro na API do Pluggy (HTTP ${res.status}) em ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getAccountsByItem(itemId) {
  const data = await api(`/accounts?itemId=${itemId}`);
  return data.results || [];
}

// Endpoint atual de transações: /v2/transactions, com paginação por cursor
async function getTransactions(accountId) {
  const all = [];
  let next = null;
  do {
    const path = next
      ? `/v2/transactions${next}`
      : `/v2/transactions?accountId=${accountId}`;
    const data = await api(path);
    all.push(...(data.results || []));
    next = data.next || null;
  } while (next);
  return all;
}

async function getCreditCards(itemId) {
  const data = await api(`/credit-cards?itemId=${itemId}`);
  return data.results || [];
}

async function getInvestments(itemId) {
  const data = await api(`/investments?itemId=${itemId}`);
  return data.results || [];
}

module.exports = { getItemIds, getAccountsByItem, getTransactions, getCreditCards, getInvestments };
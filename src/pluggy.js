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

async function getItemDetails(itemId) {
  return api(`/items/${itemId}`);
}

async function getAccountsByItem(itemId) {
  const data = await api(`/accounts?itemId=${itemId}`);
  return data.results || [];
}

async function getTransactions(accountId, { dateFrom, dateTo } = {}) {
  const all = [];
  let next = null;

  const params = new URLSearchParams();
  params.set("accountId", accountId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  do {
    const path = next
      ? `/v2/transactions${next}`
      : `/v2/transactions?${params.toString()}`;
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

async function getBills(accountId) {
  // Endpoint atual: faturas vinculadas à conta de crédito
  try {
    const data = await api(`/bills?accountId=${accountId}`);
    if (data.results) return data.results;
  } catch (e) {
    // tenta o endpoint legado (cartão)
  }
  const legacy = await api(`/credit-cards/${accountId}/bills`);
  return legacy.results || legacy.bills || [];
}

module.exports = { getItemIds, getItemDetails, getAccountsByItem, getTransactions, getCreditCards, getInvestments, getBills };
const RULES = [
  { cat: "Moradia",        words: ["aluguel", "condominio", "iptu", "luz", "agua", "energia"] },
  { cat: "Alimentação",    words: ["mercado", "supermercado", "restaurante", "delivery", "ifood", "padaria"] },
  { cat: "Transporte",     words: ["uber", "combustivel", "posto", "pedagio", "99", "gasolina"] },
  { cat: "Assinaturas",    words: ["netflix", "spotify", "streaming", "internet", "telefone", "assinatura"] },
  { cat: "Saúde",          words: ["farmacia", "plano de saude", "consulta", "medico", "drogasil"] },
  { cat: "Lazer",          words: ["cinema", "jogo", "viagem", "evento", "show", "steam"] },
  { cat: "Educação",       words: ["curso", "mensalidade", "faculdade", "escola"] },
  { cat: "Compras",        words: ["amazon", "magalu", "shopee", "mercado livre", "varejo"] },
];

function categorize(description) {
  const text = (description || "").toLowerCase();
  for (const rule of RULES) {
    if (rule.words.some((w) => text.includes(w))) return rule.cat;
  }
  return "Outros";
}

module.exports = { categorize };
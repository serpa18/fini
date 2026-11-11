// ============================================================
// src/carteira.js
// Módulo de Operações (Compra/Venda), Preço Médio e Simulador
// Com regras de corretagem da XP Investimentos:
//   - FII / Fiagro / Tesouro Direto / Renda Fixa / Cripto: R$ 0,00
//   - Ações (incluindo Units), ETFs e BDRs: R$ 4,90 por ordem
// ============================================================

const ETFS_CONHECIDOS = new Set([
  "BOVA11", "IVVB11", "SMAL11", "HASH11", "NASD11", "XINA11",
  "DIVO11", "SPXI11", "GOLD11", "BITH11", "ETHE11", "QBTC11",
  "SOLH11", "DEFI11", "WEB311", "FIND11", "GOVE11", "MATB11",
  "ISUS11", "BRAX11", "ECOO11", "SMAC11", "TECK11", "SHOT11",
  "CHIP11", "EURP11", "ASIA11", "ACWI11", "WRLD11", "USAL11"
]);

// Units na B3 terminam em 11, mas são Ações (pagam corretagem de Ações na XP)
const UNITS_ACOES = new Set([
  "TAEE11", "ALUP11", "BRBI11", "SANB11", "KLBN11", "ENGI11",
  "SAPR11", "BPAC11", "IGTI11", "TIET11", "AESB11", "BIDI11",
  "SULA11", "PPLA11", "MODL11", "RNEW11"
]);

// Mapeamento de ISIN do Tesouro Direto no Pluggy para o nome do título
const TESOURO_ISIN_MAP = {
  "BRSTNCNTB6A3": "TESOURO IPCA+ 2029",
  "BRSTNCNTB0O7": "TESOURO IPCA+ 2035",
  "BRSTNCNTB476": "TESOURO IPCA+ 2050",
};

const TAXA_CORRETAGEM_XP_PADRAO = 4.90;

function normalizarAtivo(rawTicker) {
  const limpo = String(rawTicker || "").trim().replace(/\s+/g, " ");
  if (!limpo) return { ativo: "", tickerOriginal: "" };
  const upper = limpo.toUpperCase();
  if (upper.startsWith("TESOURO")) {
    // Padroniza capitalização ex: "Tesouro IPCA+ 2050"
    const formatado = limpo.replace(/^tesouro\s+/i, "Tesouro ").replace(/ipca\+/i, "IPCA+");
    return { ativo: formatado, tickerOriginal: formatado };
  }
  // Remove sufixo F do mercado fracionário (ex: TAEE11F -> TAEE11, SAPR4F -> SAPR4)
  const base = upper.replace(/^([A-Z]{4}\d{1,2})F$/, "$1");
  return { ativo: base, tickerOriginal: upper };
}

function classificarAtivoB3(rawTicker, classeForcada = null) {
  const { ativo, tickerOriginal } = normalizarAtivo(rawTicker);
  const upper = ativo.toUpperCase();

  let classe = classeForcada;
  if (!classe) {
    if (upper.startsWith("TESOURO")) {
      classe = "Tesouro";
    } else if (["BTC", "ETH", "SOL", "USDT", "USDC", "BITCOIN", "ETHEREUM"].includes(upper)) {
      classe = "Criptoativos";
    } else if (ETFS_CONHECIDOS.has(upper)) {
      classe = "ETF";
    } else if (UNITS_ACOES.has(upper)) {
      classe = "Ações";
    } else if (/^[A-Z]{4}3[12345]$/.test(upper)) {
      classe = "BDR";
    } else if (/^[A-Z]{4}1[12]$/.test(upper)) {
      classe = "Fundo Imobiliário";
    } else if (/^[A-Z]{4}[345678]$/.test(upper)) {
      classe = "Ações";
    } else if (upper.startsWith("CDB") || upper.startsWith("LCI") || upper.startsWith("LCA")) {
      classe = "CDB";
    } else {
      classe = "Ações";
    }
  }

  // Regra XP Investimentos:
  // - Ações (lote padrão ou fracionário/Units), ETFs e BDRs: R$ 4,90 por ordem
  // - FIIs/Fiagros, Tesouro Direto, CDB e Criptoativos: Taxa Zero (R$ 0,00)
  const cobraCorretagemXP = ["Ações", "ETF", "BDR"].includes(classe);
  const taxaXP = cobraCorretagemXP ? TAXA_CORRETAGEM_XP_PADRAO : 0;

  return { ativo, tickerOriginal, classe, taxaXP };
}

// Dados históricos importados da planilha Investimentos.gsheet (outubro/2023 a outubro/2026)
const SEED_OPERACOES = [{"t":"compra","a":"Tesouro IPCA+ 2029","q":0.07,"p":3049.77,"v":213.48,"m":"2023-10"},{"t":"compra","a":"VGHF11","q":4,"p":9.51,"v":38.04,"m":"2023-10"},{"t":"compra","a":"GALG11","q":4,"p":9.25,"v":37,"m":"2023-10"},{"t":"compra","a":"KISU11","q":5,"p":8.27,"v":41.35,"m":"2023-10"},{"t":"compra","a":"IRDM11","q":2,"p":79.34,"v":158.68,"m":"2023-10"},{"t":"compra","a":"MALL11","q":2,"p":116.32,"v":232.64,"m":"2023-10"},{"t":"compra","a":"CPTS11","q":22,"p":8.77,"v":192.94,"m":"2023-10"},{"t":"compra","a":"HGLG11","q":1,"p":159.25,"v":159.25,"m":"2023-10"},{"t":"compra","a":"HASH11","q":13,"p":22.58,"v":293.54,"m":"2023-10"},{"t":"compra","a":"IVVB11","q":2,"p":243.97,"v":487.94,"m":"2023-10"},{"t":"compra","a":"PETR4","q":3,"p":32.64,"v":97.92,"m":"2023-10"},{"t":"compra","a":"ITSA4","q":12,"p":8.85,"v":106.2,"m":"2023-10"},{"t":"compra","a":"RRRP3","q":3,"p":28.13,"v":84.39,"m":"2023-10"},{"t":"compra","a":"TAEE11","q":3,"p":33.96,"v":101.88,"m":"2023-10"},{"t":"compra","a":"ALUP11","q":3,"p":28.03,"v":84.09,"m":"2023-10"},{"t":"venda","a":"VGHF11","q":4,"p":9.34,"v":37.36,"m":"2023-10"},{"t":"venda","a":"KISU11","q":5,"p":8.42,"v":42.1,"m":"2023-10"},{"t":"venda","a":"CPTS11","q":22,"p":8.53,"v":187.66,"m":"2023-10"},{"t":"compra","a":"ALUP11","q":5,"p":29.15,"v":145.75,"m":"2023-11"},{"t":"compra","a":"TAEE11","q":4,"p":35.14,"v":140.56,"m":"2023-11"},{"t":"compra","a":"EGIE3","q":4,"p":40.88,"v":163.52,"m":"2023-11"},{"t":"compra","a":"GALG12","q":3,"p":9.17,"v":27.51,"m":"2023-11"},{"t":"compra","a":"XPIN11","q":3,"p":83,"v":249,"m":"2023-11"},{"t":"venda","a":"GALG12","q":3,"p":9.17,"v":27.51,"m":"2023-11"},{"t":"compra","a":"ALUP11","q":8,"p":29.4,"v":235.2,"m":"2023-12"},{"t":"compra","a":"XPIN11","q":8,"p":82.31,"v":658.48,"m":"2023-12"},{"t":"compra","a":"SNAG11","q":5,"p":10.13,"v":50.65,"m":"2023-12"},{"t":"compra","a":"MXRF11","q":5,"p":10.47,"v":52.35,"m":"2023-12"},{"t":"compra","a":"HASH11","q":5,"p":33.2,"v":166,"m":"2023-12"},{"t":"compra","a":"HTMX11","q":2,"p":176.91,"v":353.82,"m":"2023-12"},{"t":"compra","a":"AAPL34","q":5,"p":47.66,"v":238.3,"m":"2023-12"},{"t":"compra","a":"PETR4","q":5,"p":33.56,"v":167.8,"m":"2023-12"},{"t":"compra","a":"GALG11","q":5,"p":9.17,"v":45.85,"m":"2023-12"},{"t":"venda","a":"GALG11","q":4,"p":9.17,"v":36.68,"m":"2023-12"},{"t":"venda","a":"GALG11","q":5,"p":9.17,"v":45.85,"m":"2023-12"},{"t":"compra","a":"BTC","q":0.00045721,"p":216749.14,"v":99.1,"m":"2024-01"},{"t":"compra","a":"BTC","q":0.00043304,"p":228847.21,"v":99.1,"m":"2024-01"},{"t":"compra","a":"XPIN11","q":2,"p":80.31,"v":160.62,"m":"2024-01"},{"t":"compra","a":"BCFF11","q":3,"p":9.22,"v":27.66,"m":"2024-01"},{"t":"compra","a":"HGLG11","q":1,"p":162.11,"v":162.11,"m":"2024-01"},{"t":"compra","a":"HASH11","q":3,"p":35.1,"v":105.3,"m":"2024-01"},{"t":"compra","a":"IRDM11","q":2,"p":82.88,"v":165.76,"m":"2024-01"},{"t":"venda","a":"IRDM11","q":2,"p":69.98,"v":139.96,"m":"2024-01"},{"t":"venda","a":"BCFF11","q":19,"p":9.08,"v":172.52,"m":"2024-01"},{"t":"venda","a":"IRDM11","q":2,"p":69.98,"v":139.96,"m":"2024-01"},{"t":"compra","a":"ALUP11F","q":5,"p":28.91,"v":144.55,"m":"2024-02"},{"t":"compra","a":"TAEE11F","q":5,"p":35.62,"v":178.1,"m":"2024-02"},{"t":"compra","a":"XPIN11","q":5,"p":81.1,"v":405.5,"m":"2024-02"},{"t":"compra","a":"MALL11","q":3,"p":118.09,"v":354.27,"m":"2024-02"},{"t":"compra","a":"HASH11","q":9,"p":39.89,"v":359.01,"m":"2024-02"},{"t":"compra","a":"MXRF11","q":6,"p":10.5,"v":63,"m":"2024-02"},{"t":"compra","a":"XPML11","q":2,"p":118.36,"v":236.72,"m":"2024-03"},{"t":"compra","a":"TRXF11","q":2,"p":110.96,"v":221.92,"m":"2024-03"},{"t":"compra","a":"RZAG11","q":20,"p":8.87,"v":177.4,"m":"2024-03"},{"t":"compra","a":"VIVA3F","q":6,"p":25.59,"v":153.54,"m":"2024-03"},{"t":"compra","a":"HGBS11","q":2,"p":229.66,"v":459.32,"m":"2024-04"},{"t":"compra","a":"VALE3","q":2,"p":62.97,"v":125.94,"m":"2024-04"},{"t":"compra","a":"MXRF11","q":3,"p":10.47,"v":31.41,"m":"2024-04"},{"t":"compra","a":"VALE3","q":4,"p":63.99,"v":255.96,"m":"2024-05"},{"t":"compra","a":"HGBS11","q":2,"p":221.56,"v":443.12,"m":"2024-05"},{"t":"compra","a":"VIVA3F","q":5,"p":22.87,"v":114.35,"m":"2024-05"},{"t":"compra","a":"MXRF11","q":2,"p":10.22,"v":20.44,"m":"2024-05"},{"t":"compra","a":"RZAG11","q":20,"p":8.44,"v":168.8,"m":"2024-05"},{"t":"compra","a":"SMAL11","q":3,"p":96.8,"v":290.4,"m":"2024-06"},{"t":"compra","a":"HGBS11","q":2,"p":212.16,"v":424.32,"m":"2024-06"},{"t":"compra","a":"SNAG11","q":5,"p":10.04,"v":50.2,"m":"2024-06"},{"t":"compra","a":"Tesouro IPCA+ 2035","q":0.12,"p":4179.67,"v":501.56,"m":"2024-07"},{"t":"compra","a":"CXSE3","q":30,"p":14.68,"v":440.4,"m":"2024-07"},{"t":"compra","a":"VALE3","q":10,"p":63.91,"v":639.1,"m":"2024-07"},{"t":"compra","a":"TAEE11","q":20,"p":34.6,"v":692,"m":"2024-07"},{"t":"compra","a":"ITSA4","q":30,"p":9.99,"v":299.7,"m":"2024-07"},{"t":"compra","a":"SNAG11","q":30,"p":10.02,"v":300.6,"m":"2024-07"},{"t":"compra","a":"HGLG11","q":15,"p":160.03,"v":2400.45,"m":"2024-07"},{"t":"compra","a":"HGBS11","q":13,"p":214,"v":2782,"m":"2024-07"},{"t":"compra","a":"MXRF11","q":2,"p":10.16,"v":20.32,"m":"2024-07"},{"t":"compra","a":"BBAS3","q":15,"p":26.41,"v":396.15,"m":"2024-08"},{"t":"compra","a":"CXSE3","q":15,"p":14.13,"v":211.95,"m":"2024-08"},{"t":"compra","a":"PETR4","q":5,"p":35.53,"v":177.65,"m":"2024-08"},{"t":"compra","a":"MXRF11","q":7,"p":10.05,"v":70.35,"m":"2024-08"},{"t":"compra","a":"VALE3","q":11,"p":56.05,"v":616.55,"m":"2024-09"},{"t":"compra","a":"MALL11","q":5,"p":106.5,"v":532.5,"m":"2024-09"},{"t":"compra","a":"XPML11","q":5,"p":112.23,"v":561.15,"m":"2024-09"},{"t":"compra","a":"BRBI11","q":30,"p":15.71,"v":471.3,"m":"2024-09"},{"t":"compra","a":"XPML11","q":5,"p":112.14,"v":560.7,"m":"2024-09"},{"t":"compra","a":"BRBI11","q":18,"p":15.91,"v":286.38,"m":"2024-09"},{"t":"compra","a":"MXRF11","q":10,"p":10.01,"v":100.1,"m":"2024-09"},{"t":"venda","a":"MALL11","q":2,"p":106.1,"v":212.2,"m":"2024-09"},{"t":"venda","a":"MALL11","q":3,"p":106.1,"v":318.3,"m":"2024-09"},{"t":"venda","a":"MALL11","q":5,"p":106.1,"v":530.5,"m":"2024-09"},{"t":"compra","a":"IVVB11","q":5,"p":369,"v":1845,"m":"2024-10"},{"t":"compra","a":"EGIE3","q":15,"p":41.51,"v":622.65,"m":"2024-10"},{"t":"compra","a":"BBAS3","q":15,"p":26.88,"v":403.2,"m":"2024-10"},{"t":"compra","a":"BBSE3","q":18,"p":34.3,"v":617.4,"m":"2024-10"},{"t":"compra","a":"HTMX11","q":7,"p":189.69,"v":1327.83,"m":"2024-10"},{"t":"compra","a":"MXRF11","q":8,"p":9.73,"v":77.84,"m":"2024-10"},{"t":"compra","a":"SAPR4F","q":30,"p":5.21,"v":156.3,"m":"2024-11"},{"t":"compra","a":"HTMX11","q":6,"p":154.96,"v":929.76,"m":"2024-11"},{"t":"compra","a":"XPIN11","q":5,"p":70.14,"v":350.7,"m":"2024-11"},{"t":"venda","a":"HTMX11","q":2,"p":155.5,"v":311,"m":"2024-11"},{"t":"compra","a":"TRXF11","q":3,"p":97.54,"v":292.62,"m":"2024-12"},{"t":"compra","a":"RZAG11","q":20,"p":7.75,"v":155,"m":"2024-12"},{"t":"compra","a":"HGBS11","q":2,"p":181.84,"v":363.68,"m":"2024-12"},{"t":"compra","a":"XPML11","q":3,"p":93.5,"v":280.5,"m":"2024-12"},{"t":"compra","a":"KNCR11","q":11,"p":98.59,"v":1084.49,"m":"2024-12"},{"t":"compra","a":"SAPR4F","q":20,"p":5.09,"v":101.8,"m":"2025-01"},{"t":"compra","a":"ALUP11F","q":10,"p":27.34,"v":273.4,"m":"2025-01"},{"t":"compra","a":"BRBI11F","q":10,"p":13.08,"v":130.8,"m":"2025-01"},{"t":"compra","a":"HGBS11","q":2,"p":182.21,"v":364.42,"m":"2025-01"},{"t":"compra","a":"TAEE11","q":7,"p":32.52,"v":227.64,"m":"2025-01"},{"t":"compra","a":"XPML11","q":2,"p":99.63,"v":199.26,"m":"2025-01"},{"t":"compra","a":"SNAG11","q":30,"p":9.23,"v":276.9,"m":"2025-02"},{"t":"compra","a":"RZAG11","q":70,"p":7.9,"v":553,"m":"2025-02"},{"t":"compra","a":"TRXF11","q":3,"p":99.14,"v":297.42,"m":"2025-02"},{"t":"compra","a":"XPIN11","q":5,"p":65.17,"v":325.85,"m":"2025-02"},{"t":"compra","a":"SAPR4","q":75,"p":5.39,"v":404.25,"m":"2025-02"},{"t":"compra","a":"TAEE11","q":8,"p":33.13,"v":265.04,"m":"2025-02"},{"t":"compra","a":"ITSA4","q":40,"p":8.92,"v":356.8,"m":"2025-03"},{"t":"compra","a":"XPML11","q":5,"p":96.84,"v":484.2,"m":"2025-03"},{"t":"compra","a":"XPIN11","q":10,"p":67.43,"v":674.3,"m":"2025-03"},{"t":"compra","a":"SNAG11","q":39,"p":9.17,"v":357.63,"m":"2025-03"},{"t":"compra","a":"RZAG11","q":40,"p":8.23,"v":329.2,"m":"2025-03"},{"t":"compra","a":"BTCI11","q":100,"p":8.67,"v":867,"m":"2025-04"},{"t":"compra","a":"RZAG11","q":100,"p":8.39,"v":839,"m":"2025-04"},{"t":"compra","a":"SAPR4","q":100,"p":5.46,"v":546,"m":"2025-04"},{"t":"compra","a":"VISA34","q":5,"p":91.5,"v":457.5,"m":"2025-04"},{"t":"compra","a":"PETR4","q":9,"p":32,"v":288,"m":"2025-04"},{"t":"compra","a":"PETR4","q":12,"p":31.8,"v":381.6,"m":"2025-05"},{"t":"compra","a":"SAPR4","q":100,"p":5.99,"v":599,"m":"2025-05"},{"t":"compra","a":"CXSE3","q":50,"p":15.05,"v":752.5,"m":"2025-05"},{"t":"compra","a":"BBSE3","q":25,"p":37.98,"v":949.5,"m":"2025-05"},{"t":"compra","a":"MXRF11","q":3,"p":9.3,"v":27.9,"m":"2025-05"},{"t":"compra","a":"BBAS3","q":100,"p":21.35,"v":2135,"m":"2025-06"},{"t":"compra","a":"MXRF11","q":16,"p":9.29,"v":148.64,"m":"2025-06"},{"t":"compra","a":"BBSE3","q":38,"p":35.16,"v":1336.08,"m":"2025-06"},{"t":"compra","a":"RZAG11","q":2,"p":8.78,"v":17.56,"m":"2025-06"},{"t":"compra","a":"Tesouro IPCA+ 2050","q":1.15,"p":874.03,"v":1005.13,"m":"2025-07"},{"t":"compra","a":"HTMX11","q":10,"p":144.65,"v":1446.5,"m":"2025-07"},{"t":"compra","a":"HGBS11","q":65,"p":19.48,"v":1266.2,"m":"2025-07"},{"t":"compra","a":"MXRF11","q":3,"p":9.53,"v":28.59,"m":"2025-07"},{"t":"compra","a":"BBAS3","q":20,"p":18.85,"v":377,"m":"2025-08"},{"t":"compra","a":"VALE3","q":10,"p":53.8,"v":538,"m":"2025-08"},{"t":"compra","a":"TRXF11","q":10,"p":98.26,"v":982.6,"m":"2025-08"},{"t":"compra","a":"HGLG11","q":10,"p":152.28,"v":1522.8,"m":"2025-08"},{"t":"compra","a":"MXRF11","q":7,"p":9.41,"v":65.87,"m":"2025-08"},{"t":"compra","a":"HTMX11","q":10,"p":138.84,"v":1388.4,"m":"2025-09"},{"t":"compra","a":"TRXF11","q":10,"p":97.51,"v":975.1,"m":"2025-09"},{"t":"compra","a":"AAPL34","q":5,"p":63.17,"v":315.85,"m":"2025-09"},{"t":"compra","a":"RZAG11","q":100,"p":9.09,"v":909,"m":"2025-09"},{"t":"compra","a":"HGBS11","q":31,"p":19.72,"v":611.32,"m":"2025-09"},{"t":"compra","a":"BTCI11","q":100,"p":9.29,"v":929,"m":"2025-10"},{"t":"compra","a":"SNAG11","q":100,"p":9.57,"v":957,"m":"2025-10"},{"t":"compra","a":"KNCR11","q":10,"p":104.39,"v":1043.9,"m":"2025-10"},{"t":"compra","a":"PETR4","q":20,"p":30.03,"v":600.6,"m":"2025-10"},{"t":"compra","a":"MXRF11","q":14,"p":9.6,"v":134.4,"m":"2025-10"},{"t":"compra","a":"VALE3","q":12,"p":64.67,"v":776.04,"m":"2025-11"},{"t":"compra","a":"BTCI11","q":100,"p":9.41,"v":941,"m":"2025-11"},{"t":"compra","a":"SNAG11","q":100,"p":9.79,"v":979,"m":"2025-11"},{"t":"compra","a":"XPML11","q":11,"p":106.99,"v":1176.89,"m":"2025-11"},{"t":"compra","a":"MXRF11","q":4,"p":9.64,"v":38.56,"m":"2025-11"},{"t":"compra","a":"VISA34","q":10,"p":88.69,"v":886.9,"m":"2025-12"},{"t":"compra","a":"SMAL11","q":5,"p":113.44,"v":567.2,"m":"2025-12"},{"t":"compra","a":"TRXF11","q":7,"p":100.16,"v":701.12,"m":"2025-12"},{"t":"compra","a":"KNCR11","q":10,"p":104.81,"v":1048.1,"m":"2025-12"},{"t":"compra","a":"BTCI11","q":100,"p":9.25,"v":925,"m":"2025-12"},{"t":"compra","a":"MXRF11","q":7,"p":9.49,"v":66.43,"m":"2025-12"},{"t":"compra","a":"PETR4","q":50,"p":32.28,"v":1614,"m":"2026-01"},{"t":"compra","a":"XPIN11","q":2,"p":81.98,"v":163.96,"m":"2026-01"},{"t":"compra","a":"BBSE3","q":50,"p":34.56,"v":1728,"m":"2026-01"},{"t":"compra","a":"MXRF11","q":8,"p":9.48,"v":75.84,"m":"2026-01"},{"t":"compra","a":"XPIN11","q":15,"p":70.23,"v":1053.45,"m":"2026-03"},{"t":"compra","a":"TRXF11","q":15,"p":91.95,"v":1379.25,"m":"2026-03"},{"t":"compra","a":"SNAG11","q":100,"p":10.75,"v":1075,"m":"2026-03"},{"t":"compra","a":"MXRF11","q":8,"p":9.71,"v":77.68,"m":"2026-03"},{"t":"compra","a":"HGLG11","q":2,"p":157.1,"v":314.2,"m":"2026-04"},{"t":"compra","a":"MXRF11","q":5,"p":9.81,"v":49.05,"m":"2026-04"},{"t":"compra","a":"HGLG11","q":5,"p":149.44,"v":747.2,"m":"2026-07"},{"t":"compra","a":"XPML11","q":5,"p":105.75,"v":528.75,"m":"2026-07"},{"t":"compra","a":"RZAG11","q":26,"p":8.45,"v":219.7,"m":"2026-07"},{"t":"compra","a":"BOVA11","q":5,"p":174.31,"v":871.55,"m":"2026-10"},{"t":"compra","a":"IVVB11","q":1,"p":465.41,"v":465.41,"m":"2026-10"},{"t":"compra","a":"TAEE11","q":16,"p":40.53,"v":648.48,"m":"2026-10"}];

module.exports = function registerCarteira(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inv_operacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo TEXT NOT NULL,
      ticker_original TEXT,
      classe TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'compra',
      cotas REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      taxa_corretagem REAL NOT NULL DEFAULT 0,
      valor_bruto REAL NOT NULL,
      mes_ano TEXT NOT NULL,
      ordem_cronologica INTEGER DEFAULT 0,
      observacoes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  function popularSeedSeVazio(forcar = false) {
    if (forcar) {
      db.prepare("DELETE FROM inv_operacoes").run();
    } else {
      const count = db.prepare("SELECT COUNT(*) AS n FROM inv_operacoes").get().n;
      if (count > 0) return false;
    }

    const ins = db.prepare(`
      INSERT INTO inv_operacoes
        (ativo, ticker_original, classe, tipo, cotas, preco_unitario, taxa_corretagem, valor_bruto, mes_ano, ordem_cronologica, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    SEED_OPERACOES.forEach((op, idx) => {
      const info = classificarAtivoB3(op.a);
      const obs = info.tickerOriginal !== info.ativo ? `Mercado fracionário (${info.tickerOriginal})` : null;
      ins.run(
        info.ativo,
        info.tickerOriginal,
        info.classe,
        op.t,
        op.q,
        op.p,
        info.taxaXP,
        op.v,
        op.m,
        idx + 1,
        obs
      );
    });
    return true;
  }

  popularSeedSeVazio(false);

  // Calcula a carteira consolidada + preço médio + cruzamento com Pluggy
  function calcularCarteira(incluirTaxas = true) {
    const ops = db.prepare(`
      SELECT *
      FROM inv_operacoes
      ORDER BY mes_ano ASC, CASE WHEN tipo = 'compra' THEN 0 ELSE 1 END ASC, ordem_cronologica ASC, id ASC
    `).all();

    // Busca saldos atuais sincronizados via Pluggy (se houver)
    let pluggyRows = [];
    try {
      pluggyRows = db.prepare("SELECT name, code, type, subtype, balance FROM investments WHERE COALESCE(balance, 0) > 0").all();
    } catch (_) {}

    const saldoPorTicker = {};
    for (const inv of pluggyRows) {
      const code = String(inv.code || "").trim().toUpperCase();
      const name = String(inv.name || "").trim().toUpperCase();
      if (TESOURO_ISIN_MAP[code]) {
        const chaveTesouro = TESOURO_ISIN_MAP[code];
        saldoPorTicker[chaveTesouro] = (saldoPorTicker[chaveTesouro] || 0) + (inv.balance || 0);
      }
      if (code) saldoPorTicker[code] = (saldoPorTicker[code] || 0) + (inv.balance || 0);
      if (name && name !== code) saldoPorTicker[name] = (saldoPorTicker[name] || 0) + (inv.balance || 0);
    }

    const ativosMap = {};
    const opsEnriquecidas = [];

    let totalComprasBruto = 0;
    let totalVendasBruto = 0;
    let totalTaxasXP = 0;

    for (const op of ops) {
      const chave = op.ativo.toUpperCase();
      if (!ativosMap[chave]) {
        const padrao = classificarAtivoB3(op.ativo, op.classe);
        ativosMap[chave] = {
          ativo: op.ativo,
          classe: op.classe || padrao.classe,
          taxaPadraoXP: padrao.taxaXP,
          cotas: 0,
          cotasCompradas: 0,
          cotasVendidas: 0,
          custoSemTaxas: 0,
          custoComTaxas: 0,
          comprasBrutoHistorico: 0,
          comprasComTaxasHistorico: 0,
          totalVendidoBruto: 0,
          totalVendidoLiquido: 0,
          taxasAcumuladas: 0,
          taxasCompra: 0,
          taxasVenda: 0,
          lucroRealizadoComTaxas: 0,
          lucroRealizadoSemTaxas: 0,
          qtdOperacoes: 0,
          qtdCompras: 0,
          qtdVendas: 0,
          primeiraOperacaoMes: op.mes_ano,
          ultimaOperacaoMes: op.mes_ano,
          ultimoPrecoCompra: op.preco_unitario,
        };
      }

      const st = ativosMap[chave];
      const qtd = Number(op.cotas) || 0;
      const preco = Number(op.preco_unitario) || 0;
      const bruto = Number(op.valor_bruto) || Number((qtd * preco).toFixed(2));
      const taxa = Number(op.taxa_corretagem) || 0;

      st.qtdOperacoes += 1;
      if (op.mes_ano > st.ultimaOperacaoMes) st.ultimaOperacaoMes = op.mes_ano;
      if (op.mes_ano < st.primeiraOperacaoMes) st.primeiraOperacaoMes = op.mes_ano;
      st.taxasAcumuladas += taxa;
      totalTaxasXP += taxa;

      let pmMomentoComTaxas = st.cotas > 0 ? st.custoComTaxas / st.cotas : 0;
      let pmMomentoSemTaxas = st.cotas > 0 ? st.custoSemTaxas / st.cotas : 0;
      let resultadoOpComTaxas = null;
      let resultadoOpSemTaxas = null;

      if (op.tipo === "compra") {
        st.qtdCompras += 1;
        st.cotas = Number((st.cotas + qtd).toFixed(8));
        st.cotasCompradas = Number((st.cotasCompradas + qtd).toFixed(8));
        st.custoSemTaxas += bruto;
        st.custoComTaxas += bruto + taxa;
        st.comprasBrutoHistorico += bruto;
        st.comprasComTaxasHistorico += bruto + taxa;
        st.taxasCompra += taxa;
        st.ultimoPrecoCompra = preco;
        totalComprasBruto += bruto;

        pmMomentoComTaxas = st.cotas > 0 ? st.custoComTaxas / st.cotas : preco;
        pmMomentoSemTaxas = st.cotas > 0 ? st.custoSemTaxas / st.cotas : preco;
      } else {
        // Venda: o Preço Médio NÃO se altera; reduz-se proporcionalmente o custo das cotas vendidas
        st.qtdVendas += 1;
        const pmBaseCom = st.cotas > 0
          ? (st.custoComTaxas / st.cotas)
          : (st.cotasCompradas > 0 ? st.comprasComTaxasHistorico / st.cotasCompradas : preco);
        const pmBaseSem = st.cotas > 0
          ? (st.custoSemTaxas / st.cotas)
          : (st.cotasCompradas > 0 ? st.comprasBrutoHistorico / st.cotasCompradas : preco);

        const liquidoVenda = bruto - taxa;
        resultadoOpComTaxas = liquidoVenda - (qtd * pmBaseCom);
        resultadoOpSemTaxas = bruto - (qtd * pmBaseSem);

        st.lucroRealizadoComTaxas += resultadoOpComTaxas;
        st.lucroRealizadoSemTaxas += resultadoOpSemTaxas;
        st.cotasVendidas = Number((st.cotasVendidas + qtd).toFixed(8));
        st.totalVendidoBruto += bruto;
        st.totalVendidoLiquido += liquidoVenda;
        st.taxasVenda += taxa;
        totalVendasBruto += bruto;

        st.cotas = Math.max(0, Number((st.cotas - qtd).toFixed(8)));
        st.custoComTaxas = st.cotas * pmBaseCom;
        st.custoSemTaxas = st.cotas * pmBaseSem;
        pmMomentoComTaxas = pmBaseCom;
        pmMomentoSemTaxas = pmBaseSem;
      }

      opsEnriquecidas.push({
        ...op,
        valor_liquido: op.tipo === "compra" ? (bruto + taxa) : (bruto - taxa),
        pm_apos_com_taxas: pmMomentoComTaxas,
        pm_apos_sem_taxas: pmMomentoSemTaxas,
        pm_apos: incluirTaxas ? pmMomentoComTaxas : pmMomentoSemTaxas,
        resultado_venda: incluirTaxas ? resultadoOpComTaxas : resultadoOpSemTaxas,
        resultado_venda_com_taxas: resultadoOpComTaxas,
        resultado_venda_sem_taxas: resultadoOpSemTaxas,
      });
    }

    const posicoes = Object.values(ativosMap).map((st) => {
      const emCarteira = st.cotas > 0.00000001;
      const pmComTaxas = emCarteira
        ? (st.custoComTaxas / st.cotas)
        : (st.cotasCompradas > 0 ? st.comprasComTaxasHistorico / st.cotasCompradas : 0);
      const pmSemTaxas = emCarteira
        ? (st.custoSemTaxas / st.cotas)
        : (st.cotasCompradas > 0 ? st.comprasBrutoHistorico / st.cotasCompradas : 0);

      const precoMedio = incluirTaxas ? pmComTaxas : pmSemTaxas;
      const custoTotal = incluirTaxas ? st.custoComTaxas : st.custoSemTaxas;

      const saldoPluggy = saldoPorTicker[st.ativo.toUpperCase()] || 0;
      const temCotacaoPluggy = emCarteira && saldoPluggy > 0;
      const precoAtual = temCotacaoPluggy ? (saldoPluggy / st.cotas) : null;
      const valorMercadoAtual = temCotacaoPluggy ? saldoPluggy : custoTotal;
      const resultadoAtual = temCotacaoPluggy ? (saldoPluggy - custoTotal) : null;
      const resultadoAtualPct = (temCotacaoPluggy && custoTotal > 0)
        ? ((saldoPluggy - custoTotal) / custoTotal) * 100
        : null;

      // Preço de venda de equilíbrio (break-even) já descontando a taxa de venda da XP
      const precoEquilibrioVenda = emCarteira
        ? ((custoTotal + st.taxaPadraoXP) / st.cotas)
        : pmComTaxas;

      const pmVenda = st.cotasVendidas > 0 ? (st.totalVendidoBruto / st.cotasVendidas) : null;
      const lucroRealizado = incluirTaxas ? st.lucroRealizadoComTaxas : st.lucroRealizadoSemTaxas;

      return {
        ativo: st.ativo,
        classe: st.classe,
        emCarteira,
        cotas: st.cotas,
        cotasCompradas: st.cotasCompradas,
        cotasVendidas: st.cotasVendidas,
        precoMedio,
        precoMedioComTaxas: pmComTaxas,
        precoMedioSemTaxas: pmSemTaxas,
        custoTotal,
        custoTotalComTaxas: st.custoComTaxas,
        custoTotalSemTaxas: st.custoSemTaxas,
        comprasBrutoHistorico: st.comprasBrutoHistorico,
        taxasAcumuladas: st.taxasAcumuladas,
        taxaPadraoXP: st.taxaPadraoXP,
        temCotacaoPluggy,
        saldoPluggy: temCotacaoPluggy ? saldoPluggy : null,
        precoAtual,
        valorMercadoAtual,
        resultadoAtual,
        resultadoAtualPct,
        precoEquilibrioVenda,
        ultimoPrecoCompra: st.ultimoPrecoCompra,
        precoMedioVenda: pmVenda,
        totalVendidoBruto: st.totalVendidoBruto,
        lucroRealizado,
        lucroRealizadoComTaxas: st.lucroRealizadoComTaxas,
        lucroRealizadoSemTaxas: st.lucroRealizadoSemTaxas,
        qtdOperacoes: st.qtdOperacoes,
        qtdCompras: st.qtdCompras,
        qtdVendas: st.qtdVendas,
        primeiraOperacaoMes: st.primeiraOperacaoMes,
        ultimaOperacaoMes: st.ultimaOperacaoMes,
      };
    });

    // Ordena: ativos em carteira primeiro (por maior custo investido), depois encerrados
    posicoes.sort((a, b) => {
      if (a.emCarteira !== b.emCarteira) return a.emCarteira ? -1 : 1;
      if (a.emCarteira) return b.custoTotal - a.custoTotal;
      return b.ultimaOperacaoMes.localeCompare(a.ultimaOperacaoMes);
    });

    const ativas = posicoes.filter((p) => p.emCarteira);
    const encerradas = posicoes.filter((p) => !p.emCarteira);

    const custoTotalComTaxas = ativas.reduce((s, p) => s + p.custoTotalComTaxas, 0);
    const custoTotalSemTaxas = ativas.reduce((s, p) => s + p.custoTotalSemTaxas, 0);
    const custoTotalCarteira = incluirTaxas ? custoTotalComTaxas : custoTotalSemTaxas;

    const lucroRealizadoTotal = posicoes.reduce(
      (s, p) => s + (incluirTaxas ? p.lucroRealizadoComTaxas : p.lucroRealizadoSemTaxas),
      0
    );

    // Soma de rentabilidade sobre ativos que possuem cotação Pluggy
    const ativasComPluggy = ativas.filter((p) => p.temCotacaoPluggy);
    const custoAtivasComPluggy = ativasComPluggy.reduce((s, p) => s + p.custoTotal, 0);
    const mercadoAtivasComPluggy = ativasComPluggy.reduce((s, p) => s + p.saldoPluggy, 0);
    const lucroNaoRealizado = mercadoAtivasComPluggy - custoAtivasComPluggy;
    const rentabilidadeCarteiraPct = custoAtivasComPluggy > 0
      ? (lucroNaoRealizado / custoAtivasComPluggy) * 100
      : 0;

    // Resumo por classe de ativo em carteira
    const porClasseMap = {};
    for (const p of ativas) {
      if (!porClasseMap[p.classe]) {
        porClasseMap[p.classe] = { classe: p.classe, custoTotal: 0, ativos: 0 };
      }
      porClasseMap[p.classe].custoTotal += p.custoTotal;
      porClasseMap[p.classe].ativos += 1;
    }
    const porClasse = Object.values(porClasseMap)
      .map((c) => ({
        ...c,
        pct: custoTotalCarteira > 0 ? (c.custoTotal / custoTotalCarteira) * 100 : 0,
      }))
      .sort((a, b) => b.custoTotal - a.custoTotal);

    const mesesDisponiveis = [...new Set(ops.map((o) => o.mes_ano))].sort().reverse();
    const anosDisponiveis = [...new Set(mesesDisponiveis.map((m) => m.slice(0, 4)))].sort().reverse();
    const ativosDisponiveis = posicoes.map((p) => p.ativo).sort((a, b) => a.localeCompare(b, "pt-BR"));

    return {
      incluirTaxas,
      resumo: {
        custoTotalCarteira,
        custoTotalComTaxas,
        custoTotalSemTaxas,
        totalComprasBruto,
        totalComprasComTaxas: totalComprasBruto + ops.filter((o) => o.tipo === "compra").reduce((s, o) => s + (o.taxa_corretagem || 0), 0),
        totalVendasBruto,
        lucroRealizadoTotal,
        totalTaxasXP,
        qtdOrdensComTaxa: ops.filter((o) => (o.taxa_corretagem || 0) > 0).length,
        totalOperacoes: ops.length,
        ativosEmCarteira: ativas.length,
        ativosEncerrados: encerradas.length,
        custoAtivasComPluggy,
        mercadoAtivasComPluggy,
        lucroNaoRealizado,
        rentabilidadeCarteiraPct,
      },
      porClasse,
      posicoes,
      operacoes: opsEnriquecidas.reverse(), // Mais recentes primeiro para exibição
      mesesDisponiveis,
      anosDisponiveis,
      ativosDisponiveis,
    };
  }

  // GET /api/carteira?incluirTaxas=1
  app.get("/api/carteira", async (req) => {
    const incluirTaxas = req.query.incluirTaxas !== "0" && req.query.incluirTaxas !== "false";
    return calcularCarteira(incluirTaxas);
  });

  // GET /api/carteira/classificar?ativo=TAEE11
  app.get("/api/carteira/classificar", async (req) => {
    const raw = (req.query.ativo || "").trim();
    return classificarAtivoB3(raw, req.query.classe || null);
  });

  // POST /api/carteira/operacoes -> adiciona nova compra ou venda
  app.post("/api/carteira/operacoes", async (req, reply) => {
    const body = req.body || {};
    const rawAtivo = String(body.ativo || "").trim();
    const tipo = body.tipo === "venda" ? "venda" : "compra";
    const cotas = Number(body.cotas);
    const precoUnitario = Number(body.preco_unitario);
    const mesAno = String(body.mes_ano || "").trim();

    if (!rawAtivo) return reply.code(400).send({ error: "Informe o código do ativo (ex: PETR4, MXRF11)." });
    if (!Number.isFinite(cotas) || cotas <= 0) return reply.code(400).send({ error: "Informe uma quantidade de cotas válida (> 0)." });
    if (!Number.isFinite(precoUnitario) || precoUnitario < 0) return reply.code(400).send({ error: "Informe um preço unitário válido." });
    if (!/^\d{4}-\d{2}$/.test(mesAno)) return reply.code(400).send({ error: "Informe o mês/ano no formato YYYY-MM." });

    const info = classificarAtivoB3(rawAtivo, body.classe || null);
    const taxa = body.taxa_corretagem !== undefined && body.taxa_corretagem !== "" && body.taxa_corretagem !== null
      ? Math.max(0, Number(body.taxa_corretagem) || 0)
      : info.taxaXP;
    const valorBruto = body.valor_bruto !== undefined && Number(body.valor_bruto) > 0
      ? Number(body.valor_bruto)
      : Number((cotas * precoUnitario).toFixed(2));

    const maxOrd = db.prepare("SELECT COALESCE(MAX(ordem_cronologica), 0) AS m FROM inv_operacoes").get().m;
    const obs = (body.observacoes || "").trim() || (info.tickerOriginal !== info.ativo ? `Mercado fracionário (${info.tickerOriginal})` : null);

    const res = db.prepare(`
      INSERT INTO inv_operacoes
        (ativo, ticker_original, classe, tipo, cotas, preco_unitario, taxa_corretagem, valor_bruto, mes_ano, ordem_cronologica, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      info.ativo,
      info.tickerOriginal,
      info.classe,
      tipo,
      cotas,
      precoUnitario,
      taxa,
      valorBruto,
      mesAno,
      maxOrd + 1,
      obs
    );

    return { ok: true, id: Number(res.lastInsertRowid), ativo: info.ativo, classe: info.classe, taxa_corretagem: taxa };
  });

  // PUT /api/carteira/operacoes/:id -> edita operação existente
  app.put("/api/carteira/operacoes/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const atual = db.prepare("SELECT * FROM inv_operacoes WHERE id = ?").get(id);
    if (!atual) return reply.code(404).send({ error: "Operação não encontrada." });

    const body = req.body || {};
    const rawAtivo = body.ativo !== undefined ? String(body.ativo).trim() : atual.ativo;
    const tipo = body.tipo === "venda" ? "venda" : (body.tipo === "compra" ? "compra" : atual.tipo);
    const cotas = body.cotas !== undefined ? Number(body.cotas) : atual.cotas;
    const precoUnitario = body.preco_unitario !== undefined ? Number(body.preco_unitario) : atual.preco_unitario;
    const mesAno = body.mes_ano !== undefined ? String(body.mes_ano).trim() : atual.mes_ano;

    if (!rawAtivo || !Number.isFinite(cotas) || cotas <= 0 || !Number.isFinite(precoUnitario) || precoUnitario < 0 || !/^\d{4}-\d{2}$/.test(mesAno)) {
      return reply.code(400).send({ error: "Dados inválidos para atualizar a operação." });
    }

    const info = classificarAtivoB3(rawAtivo, body.classe || atual.classe);
    const taxa = body.taxa_corretagem !== undefined && body.taxa_corretagem !== "" && body.taxa_corretagem !== null
      ? Math.max(0, Number(body.taxa_corretagem) || 0)
      : atual.taxa_corretagem;
    const valorBruto = Number((cotas * precoUnitario).toFixed(2));
    const obs = body.observacoes !== undefined ? (String(body.observacoes).trim() || null) : atual.observacoes;

    db.prepare(`
      UPDATE inv_operacoes
      SET ativo = ?, ticker_original = ?, classe = ?, tipo = ?, cotas = ?, preco_unitario = ?,
          taxa_corretagem = ?, valor_bruto = ?, mes_ano = ?, observacoes = ?
      WHERE id = ?
    `).run(
      info.ativo,
      info.tickerOriginal,
      info.classe,
      tipo,
      cotas,
      precoUnitario,
      taxa,
      valorBruto,
      mesAno,
      obs,
      id
    );

    return { ok: true, id };
  });

  // DELETE /api/carteira/operacoes/:id -> remove uma operação
  app.delete("/api/carteira/operacoes/:id", async (req) => {
    const id = Number(req.params.id);
    db.prepare("DELETE FROM inv_operacoes WHERE id = ?").run(id);
    return { ok: true };
  });

  // POST /api/carteira/restaurar-planilha -> restaura os 181 lançamentos originais da planilha
  app.post("/api/carteira/restaurar-planilha", async () => {
    popularSeedSeVazio(true);
    return { ok: true };
  });
};

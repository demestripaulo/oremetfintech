// Internationalization — English (default) and Brazilian Portuguese.
// Load this script BEFORE all other JS files.

const I18N = {
  en: {
    // Header
    alerts: 'Alerts',
    // Section titles
    mainChart: 'Main Chart',
    predictionRange: 'Range Forecast',
    historyLog: 'Analysis History & Log',
    externalIntelligence: 'External Intelligence',
    marketNews: 'Market Intelligence — News',
    technicalIndicators: 'Technical Indicators',
    supportResistance: 'Support & Resistance',
    decisionConnectors: 'Decision Connectors',
    marketStructure: 'Market Structure',
    learnMarket: 'Learn the Market',
    // Badges
    buy: 'BUY', sell: 'SELL', neutral: 'NEUTRAL',
    bullish: 'BULLISH', bearish: 'BEARISH',
    // Indicators
    loadingIndicators: 'Loading indicators...',
    rsiName: 'RSI (14)', macdName: 'MACD (12,26,9)',
    bollingerName: 'Bollinger Bands', volumeName: 'Volume (vs avg 20)',
    atrName: 'ATR (14)', patternDetected: 'Detected Pattern',
    // S/R table
    srLevel: 'Level', srPrice: 'Price', srDistance: 'Distance',
    // Predictions
    next15min: 'Next 15 minutes',
    nextHour: 'Next hour',
    dailyClose: '5PM ET Close',
    midpoint: 'Midpoint', confidence: 'Confidence',
    generatingPredictions: 'Generating educational forecasts...',
    // History
    histTime: 'Window', histInterval: 'Interval',
    histRange: 'Projected Range', histResult: 'Result',
    histActual: 'Actual', histAccuracy: 'Accuracy',
    histPending: 'pending', histHit: 'correct', histMiss: 'missed',
    noHistory: 'No analysis history yet.',
    // Connectors
    bearSignal: 'Bear Signal', attentionZone: 'Attention Zone', bullEntry: 'Bull Entry Criteria',
    triggerLabel: 'Trigger', currentPrice: 'Current price',
    noBear: 'No strong bearish condition active at the moment.',
    noBull: 'Bull conditions not yet met: wait for RSI < 30 or positive MACD crossover with rising volume.',
    bearActive: (rsi, macd, pattern) => `RSI at ${rsi} and MACD ${macd.toLowerCase()} suggest selling pressure. Most recent candle pattern: "${pattern}".`,
    bullActive: (rsi, macd) => `RSI at ${rsi} and MACD ${macd.toLowerCase()} favor a bullish bias. Additional confirmation from above-average volume would strengthen the signal.`,
    attnBody: (r, s) => `Key level to watch: ${r} (resistance) and ${s} (support). A confirmed breakout with above-average volume validates continuation; rejection with a long wick negates the move.`,
    breakBelow: 'Trigger: break below',
    breakAbove: 'Trigger: break above',
    // Chart
    initializingChart: 'Initializing chart...',
    loadingCandles: 'Loading real candles for',
    chartUnavailable: 'Chart unavailable',
    candlesUnavailable: 'Could not load real candles right now',
    indicatorsUnavailable: 'Indicators unavailable',
    srUnavailable: 'Support & resistance unavailable until indicators load.',
    connectorsUnavailable: 'Decision connectors unavailable until indicators load.',
    predictionsUnavailable: 'Forecasts unavailable',
    historyUnavailable: 'History unavailable',
    // Legend tooltips
    candleUpTip: 'Bullish candle (green): close above open — buyers dominated the period.',
    candleDownTip: 'Bearish candle (red): close below open — sellers dominated the period.',
    ema9Tip: 'EMA 9 (gold): Short-term EMA. Price above = immediate buying strength.',
    ema21Tip: 'EMA 21 (blue): Medium-term EMA. Crossover with EMA 9 signals trend change.',
    sma50Tip: 'SMA 50 (cream): 50-period SMA. Long-term trend — price above = bull territory.',
    legendUp: 'Bullish', legendDown: 'Bearish',
    // Footer
    disclaimer: '⚠️ This tool is for educational purposes. Projections are based on historical technical analysis and do not constitute financial advice. Always trade with proper risk management.',
    // Glossary
    learnSummary: 'Learn the Market',
    // Connectors / external
    socialSentiment: 'Social Sentiment',
    sentimentSrc: 'Positive votes (CoinGecko)',
    onChain: 'On-chain (Glassnode)',
    activeAddresses: 'Active addresses',
    exchangeNetflow: 'Exchange Netflow',
    exchangeSrc: 'BTC (Glassnode)',
    externalUnavailable: 'External intelligence unavailable: ',
    noNews: 'No relevant news in the last 2 hours.',
    newsUnavailable: 'News feed unavailable: ',
    kalshiTitle: 'Kalshi 15-min Targets',
    kalshiOnlyBtcEth: 'Kalshi targets are available for BTC and ETH only.',
    kalshiUnavailable: 'Kalshi targets unavailable: ',
    kalshiWindow: 'Window closes',
    kalshiMarkets: 'markets',
    kalshiStrike: 'Target', kalshiProb: 'Implied prob.',
    kalshiMarket: 'Market', kalshiModel: 'Model', kalshiVerdict: 'Cross',
    kxAgree: 'Agree', kxAgreeNo: 'Agree (no)', kxDiverge: 'Diverge', kxModelOnly: 'model',
    kxCalibTitle: 'Calibration (15-min)', kxCalibPending: 'collecting data — needs resolved windows',
    kxCalibModel: 'Model Brier', kxCalibMarket: 'Market Brier', kxCalibSkill: 'Model skill',
    kxPaperTitle: 'Paper P&L (sim, 15-min)', kxPaperPending: 'no qualifying trades yet',
    kxPaperTrades: 'trades', kxPaperPnl: 'net', kxPaperHit: 'hit',
    kxPaperNote: 'Simulated only, after fees — not real orders, not advice.',
    kalshiH15: '15-min', kalshiH1: 'Hourly',
    // Trade Filter
    tradeFilterTitle: 'Kalshi Trade Filter',
    tfBullScore: 'Bull', tfBearScore: 'Bear', tfNoTradeScore: 'No-Trade',
    tfVolume: 'Volume', tfCandleBody: 'Candle body',
    tfStructure: 'Structure', tfATR: 'ATR',
    tfDistR1: 'Dist. to R1', tfDistS1: 'Dist. to S1',
    tfDisclaimer: 'Educational signal only. Not financial advice.',
    tfAvg: 'avg',
  },

  pt: {
    // Header
    alerts: 'Alertas',
    // Section titles
    mainChart: 'Gráfico Principal',
    predictionRange: 'Previsão de Range',
    historyLog: 'Histórico e Log de Análises',
    externalIntelligence: 'Inteligência Externa',
    marketNews: 'Market Intelligence — Notícias',
    technicalIndicators: 'Indicadores Técnicos',
    supportResistance: 'Suporte & Resistência',
    decisionConnectors: 'Conectores de Decisão',
    marketStructure: 'Estrutura de Mercado',
    learnMarket: 'Aprenda o mercado',
    // Badges
    buy: 'COMPRA', sell: 'VENDA', neutral: 'NEUTRO',
    bullish: 'BULLISH', bearish: 'BEARISH',
    // Indicators
    loadingIndicators: 'Carregando indicadores...',
    rsiName: 'RSI (14)', macdName: 'MACD (12,26,9)',
    bollingerName: 'Bollinger Bands', volumeName: 'Volume (vs média 20)',
    atrName: 'ATR (14)', patternDetected: 'Padrão detectado',
    // S/R table
    srLevel: 'Nível', srPrice: 'Preço', srDistance: 'Distância',
    // Predictions
    next15min: 'Próximos 15 minutos',
    nextHour: 'Próxima hora',
    dailyClose: 'Fechamento 17h ET',
    midpoint: 'Ponto médio', confidence: 'Confiança',
    generatingPredictions: 'Gerando previsões educacionais...',
    // History
    histTime: 'Janela', histInterval: 'Intervalo',
    histRange: 'Range previsto', histResult: 'Resultado',
    histActual: 'Real', histAccuracy: 'Acerto',
    histPending: 'pendente', histHit: 'acertou', histMiss: 'errou',
    noHistory: 'Sem histórico de análises ainda.',
    // Connectors
    bearSignal: 'Sinal Bear', attentionZone: 'Zona de Atenção', bullEntry: 'Critério de Entrada Bull',
    triggerLabel: 'Gatilho', currentPrice: 'Preço atual',
    noBear: 'Nenhuma condição bearish forte ativa no momento.',
    noBull: 'Condições de alta ainda não satisfeitas: aguardar RSI < 30 ou cruzamento positivo do MACD com volume crescente.',
    bearActive: (rsi, macd, pattern) => `RSI em ${rsi} e MACD em ${macd.toLowerCase()} sugerem pressão vendedora. O padrão de candle mais recente foi "${pattern}".`,
    bullActive: (rsi, macd) => `RSI em ${rsi} e MACD em ${macd.toLowerCase()} favorecem viés comprador. Confirmação adicional viria de volume acima da média.`,
    attnBody: (r, s) => `Nível crítico a monitorar: ${r} (resistência) e ${s} (suporte). Rompimento confirmado com volume acima da média valida a continuação; rejeição com pavio longo nega o movimento.`,
    breakBelow: 'Gatilho: rompimento abaixo de',
    breakAbove: 'Gatilho: rompimento acima de',
    // Chart
    initializingChart: 'Inicializando gráfico...',
    loadingCandles: 'Carregando candles reais de',
    chartUnavailable: 'Gráfico indisponível',
    candlesUnavailable: 'Não foi possível carregar candles reais agora',
    indicatorsUnavailable: 'Indicadores indisponíveis',
    srUnavailable: 'Suporte e resistência indisponíveis até os indicadores carregarem.',
    connectorsUnavailable: 'Conectores de decisão indisponíveis até os indicadores carregarem.',
    predictionsUnavailable: 'Previsões indisponíveis',
    historyUnavailable: 'Histórico indisponível',
    // Legend tooltips
    candleUpTip: 'Vela de Alta (verde): fechamento acima da abertura — compradores dominaram o período.',
    candleDownTip: 'Vela de Baixa (vermelha): fechamento abaixo da abertura — vendedores dominaram o período.',
    ema9Tip: 'EMA 9 (dourada): Média Móvel Exponencial de curto prazo. Preço acima = força compradora imediata.',
    ema21Tip: 'EMA 21 (azul): Média Móvel de médio prazo. Cruzamento com EMA 9 sinaliza mudança de tendência.',
    sma50Tip: 'SMA 50 (creme): Média de 50 períodos. Referência de longo prazo — preço acima = território bull.',
    legendUp: 'Alta', legendDown: 'Baixa',
    // Footer
    disclaimer: '⚠️ Esta ferramenta é educacional. Projeções são baseadas em análise técnica histórica e não constituem conselho financeiro. Opere sempre com gestão de risco adequada.',
    // Glossary
    learnSummary: 'Aprenda o mercado',
    // Connectors / external
    socialSentiment: 'Sentimento social',
    sentimentSrc: 'Votos positivos (CoinGecko)',
    onChain: 'On-chain (Glassnode)',
    activeAddresses: 'Endereços ativos',
    exchangeNetflow: 'Exchange netflow',
    exchangeSrc: 'BTC (Glassnode)',
    externalUnavailable: 'Inteligência externa indisponível: ',
    noNews: 'Nenhuma notícia relevante nas últimas 2 horas.',
    newsUnavailable: 'Feed de notícias indisponível: ',
    kalshiTitle: 'Targets Kalshi 15min',
    kalshiOnlyBtcEth: 'Targets Kalshi disponíveis apenas para BTC e ETH.',
    kalshiUnavailable: 'Targets Kalshi indisponíveis: ',
    kalshiWindow: 'Janela fecha',
    kalshiMarkets: 'mercados',
    kalshiStrike: 'Target', kalshiProb: 'Prob. implícita',
    kalshiMarket: 'Mercado', kalshiModel: 'Modelo', kalshiVerdict: 'Cruzam.',
    kxAgree: 'Concorda', kxAgreeNo: 'Concorda (não)', kxDiverge: 'Diverge', kxModelOnly: 'modelo',
    kxCalibTitle: 'Calibração (15min)', kxCalibPending: 'coletando dados — precisa de janelas resolvidas',
    kxCalibModel: 'Brier Modelo', kxCalibMarket: 'Brier Mercado', kxCalibSkill: 'Skill do modelo',
    kxPaperTitle: 'P&L Simulado (15min)', kxPaperPending: 'nenhum trade qualificado ainda',
    kxPaperTrades: 'trades', kxPaperPnl: 'líquido', kxPaperHit: 'acerto',
    kxPaperNote: 'Apenas simulação, pós-fee — não são ordens reais nem recomendação.',
    kalshiH15: '15min', kalshiH1: 'Horário',
    // Trade Filter
    tradeFilterTitle: 'Kalshi Trade Filter',
    tfBullScore: 'Bull', tfBearScore: 'Bear', tfNoTradeScore: 'No-Trade',
    tfVolume: 'Volume', tfCandleBody: 'Corpo do candle',
    tfStructure: 'Estrutura', tfATR: 'ATR',
    tfDistR1: 'Dist. até R1', tfDistS1: 'Dist. até S1',
    tfDisclaimer: 'Sinal educacional. Não constitui conselho financeiro.',
    tfAvg: 'média',
  },
};

// ---- Runtime ----
window.LANG = localStorage.getItem('md_lang') || 'en';

function t(key) {
  const val = I18N[window.LANG]?.[key];
  if (val !== undefined) return val;
  return I18N.en[key] ?? key;
}

function setLang(lang) {
  window.LANG = lang;
  localStorage.setItem('md_lang', lang);
  applyStaticI18n();
  // Re-render dynamic panels
  if (typeof loadAll === 'function') loadAll();
  if (typeof renderGlossary === 'function') renderGlossary();
  if (typeof loadIntelligencePanel === 'function') loadIntelligencePanel();
  if (typeof loadNewsFeed === 'function') loadNewsFeed();
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

// Updates elements with data-i18n attribute
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (typeof val === 'string') el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // Legend tooltips (written in HTML as data-i18n-tip)
  document.querySelectorAll('[data-i18n-tip]').forEach((el) => {
    const tip = el.querySelector('.tip');
    if (tip) tip.textContent = t(el.dataset.i18nTip);
  });
  // Legend swatches text nodes
  document.querySelectorAll('[data-i18n-legend]').forEach((el) => {
    const key = el.dataset.i18nLegend;
    const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (textNode) textNode.textContent = t(key);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyStaticI18n();
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === window.LANG);
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  // Render flag emoji via Twemoji for cross-platform support
  if (typeof twemoji !== 'undefined') {
    twemoji.parse(document.querySelector('.lang-switcher'), { folder: 'svg', ext: '.svg' });
  }
});

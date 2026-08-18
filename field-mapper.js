// Shared B2B/B2C advertising-report field mapping. It keeps importer-facing
// legacy keys stable while normalising many human and Meta Ads Manager headers
// into canonical metrics for preview and confirmation.

const CURRENCY_WORDS = /\b(?:usd|eur|gbp|cny|rmb|jpy|cad|aud|hkd|sgd|krw|inr|brl|mxn)\b|(?:美元|美金|欧元|英镑|人民币|日元|加元|澳元|港币|新加坡元|韩元|卢比|雷亚尔|比索)/gi;
const TRAILING_UNITS = /(?:\b(?:count|counts|times?|quantity|qty|number|amount)\b|(?:金额|数量|次数|人次))$/gi;
const PUNCTUATION = /[\s_\-–—/\\.,:;|·•()[\]{}<>（），、。！？!？%％$￥€£¥]+/g;
const MARKS = /[\u0300-\u036f]/g;

export function normalizeHeader(value = '') {
  return String(value ?? '')
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(CURRENCY_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Strip only trailing display units. Core terms such as "Amount Spent"
    // and "Average Order Value" must remain intact for alias matching.
    .replace(TRAILING_UNITS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value = '') { return normalizeHeader(value).replace(/\s/g, ''); }

const field = (canonicalMetric, internalKey, label, aliases, semantic, extra = {}) => ({
  canonicalMetric, internalKey, label, aliases, semantic, ...extra
});

// Order matters: the more specific variants must precede broad metrics such as
// clicks, CTR, conversion value and checkout.
export const METRIC_DEFINITIONS = Object.freeze([
  field('date', 'date', '日期 Date', ['date', 'day', '日期', '报告日期', 'report date', 'reporting date'], /(?:^|\s)(?:date|day)(?:\s|$)|日期|报告日期/),
  field('dateStart', 'dateStart', '报告起始日期', ['date start', 'reporting starts', 'reporting start', '报告起始日期', '报告开始日期', '开始日期'], /date\s*(?:start|from)|报告\s*(?:起始|开始)日期/),
  field('dateEnd', 'dateEnd', '报告截止日期', ['date stop', 'date end', 'reporting ends', 'reporting end', '报告截止日期', '报告结束日期', '结束日期'], /date\s*(?:end|stop|to)|报告\s*(?:截止|结束)日期/),
  field('country', 'country', '国家 / 地区 Country', ['country', 'country region', 'country or region', '国家', '国家地区', '地区', '地域', '国家 地区'], /country|国家\s*地区|国家|地域/),
  field('region', 'region', '地区 / 大区 Region', ['region', 'state', 'province', '地区 大区', '省份', '州'], /region|state|province|大区|省份|州/),
  field('account', 'accountName', '广告账户 Account', ['account', 'account name', 'ad account', '广告账户', '广告账户名称'], /(?:ad\s*)?account(?:\s*name)?|广告账户(?:名称)?/),
  field('accountId', 'accountId', '广告账户 ID', ['account id', 'accountid', 'ad account id', '广告账户 id'], /(?:ad\s*)?account\s*id|广告账户\s*id/),
  field('campaignId', 'campaignId', 'Campaign ID', ['campaign id', 'campaignid', '广告系列 id'], /campaign\s*id|广告系列\s*id/),
  field('campaign', 'campaign', 'Campaign', ['campaign', 'campaign name', '广告系列', '广告系列名称'], /campaign(?:\s*name)?|广告系列(?:名称)?/),
  field('adSetId', 'adSetId', 'Ad Set ID', ['ad set id', 'adset id', 'adsetid', '广告组 id'], /ad\s*set\s*id|adset\s*id|广告组\s*id/),
  field('adSet', 'adSet', 'Ad Set', ['ad set', 'adset', 'ad set name', '广告组', '广告组名称'], /ad\s*set(?:\s*name)?|adset|广告组(?:名称)?/),
  field('adId', 'adId', 'Ad ID', ['ad id', 'adid', '广告 id'], /(?:^|\s)ad\s*id(?:\s|$)|广告\s*id/),
  field('ad', 'ad', '广告 Ad', ['ad', 'ad name', '广告', '广告名称'], /(?:^|\s)ad(?:\s*name)?(?:\s|$)|广告名称/),
  field('creativeType', 'creativeType', '素材类型 Creative Type', ['creative type', 'ad creative type', '素材类型'], /creative\s*type|素材类型/),
  field('creative', 'creative', '素材 Creative', ['creative', 'creative name', 'ad creative', '素材', '素材名称'], /creative(?:\s*name)?|素材(?:名称)?/),
  field('placement', 'placement', '版位 Placement', ['placement', 'placements', '版位', '投放位置'], /placements?|版位|投放位置/),
  field('spend', 'spend', '广告花费 Spend', [
    'spend', 'amount spent', 'ad spend', 'media spend', 'cost spend', '广告花费', '广告消耗', '投放花费', '投放金额', '消耗金额', '花费', '已花费', '已花费金额', 'dépenses', 'depenses', 'ausgaben', 'gasto', 'gastos', 'खर्च'
  ], /(?:amount\s*)?spent|(?:ad|media)\s*spend|广告\s*(?:花费|消耗)|投放\s*(?:花费|金额)|消耗\s*金额|^已?花费$|d[eé]penses|ausgaben|gastos?|खर्च/),
  field('impressions', 'impressions', '展示次数 Impressions', ['impressions', 'impression', 'ad impressions', '展示', '展示次数', '曝光', '曝光次数'], /ad\s*impressions?|^impressions?$|展示\s*次数?|曝光\s*次数?/),
  field('reach', 'reach', '覆盖人数 Reach', ['reach', 'people reached', 'unique reach', 'unique people', '覆盖人数', '触达人数', '覆盖用户', '独立触达'], /unique\s*(?:reach|people)|people\s*reached|^reach$|覆盖(?:人数|用户)|触达人数|独立触达/),
  field('frequency', 'frequency', '平均频次 Frequency', ['frequency', 'avg frequency', 'average frequency', 'ad frequency', '平均频次', '频次', '平均展示频次', '人均曝光次数'], /(?:avg|average|ad)?\s*frequency|平均\s*(?:展示)?频次|人均曝光次数|^频次$/),
  field('linkClicks', 'clicks', '链接点击 Link Clicks', ['link clicks', 'link click', 'outbound clicks', 'website clicks', '链接点击', '链接点击量', '网站点击', '外链点击'], /(?:link|outbound|website)\s*clicks?|链接\s*点击(?:量)?|(?:网站|外链)\s*点击/),
  field('clicks', 'allClicks', '全部点击 Clicks', ['all clicks', 'total clicks', 'clicks', '点击', '点击量', '所有点击', '全部点击量'], /(?:all|total)\s*clicks?|^clicks?$|^(?:所有|全部)?点击(?:量)?$/),
  field('linkCtr', 'ctr', '链接点击率 Link CTR', ['link ctr', 'link click ctr', 'outbound ctr', '链接点击率', '链接 ctr'], /(?:link|outbound)\s*(?:click\s*)?ctr|链接\s*(?:点击)?率|链接\s*ctr/),
  field('ctr', 'ctr', '点击率 CTR', ['ctr', 'click through rate', 'click-through rate', 'ctr percent', '点击率', '点击率 全部'], /(?:click\s*through\s*rate|^ctr$|点击率)/),
  field('cpc', 'cpc', '单次点击成本 CPC', ['cpc', 'cost per click', 'link cpc', 'cost per link click', '单次点击费用', '单次链接点击费用', '点击成本'], /(?:link\s*)?cpc|cost\s*per\s*(?:link\s*)?click|单次(?:链接)?点击(?:费用|成本)|点击成本/),
  field('cpm', 'cpm', '千次展示成本 CPM', ['cpm', 'cost per 1000 impressions', 'cost per mille', '千次展示费用', '千次曝光费用', '千次展示成本'], /cpm|cost\s*per\s*(?:1000|mille)\s*impressions?|千次(?:展示|曝光)(?:费用|成本)/),
  field('landingPageViews', 'landingPageViews', '落地页浏览 Landing Page Views', ['landing page views', 'landing page view', 'lpv', '落地页浏览量', '落地页访问', 'landing page views lpv', 'offsite conversion fb pixel landing page view'], /landing\s*page\s*views?|\blpv\b|落地页(?:浏览|访问)|fb\s*pixel\s*landing\s*page\s*view/),
  field('lpvRate', 'lpvRate', 'LPV Rate', ['lpv rate', 'landing page view rate', 'landing page views rate', '落地页浏览率', '落地页到达率'], /lpv\s*rate|landing\s*page\s*views?\s*rate|落地页(?:浏览|到达)率/),
  field('addToCart', 'addToCart', '加购 Add to Cart', ['add to cart', 'adds to cart', 'website adds to cart', 'atc', '加购', '加入购物车', 'offsite conversion fb pixel add to cart'], /adds?\s*to\s*cart|\batc\b|(?:加入)?加购|加入购物车|fb\s*pixel\s*add\s*to\s*cart/),
  field('atcRate', 'atcRate', '加购率 ATC Rate', ['atc rate', 'add to cart rate', 'adds to cart rate', '加购率'], /atc\s*rate|adds?\s*to\s*cart\s*rate|加购率/),
  field('initiateCheckout', 'initiateCheckout', '发起结账 Initiate Checkout', ['initiate checkout', 'initiated checkout', 'website checkouts initiated', 'initiate_checkout', '发起结账', '开始结账', 'offsite conversion fb pixel initiate checkout'], /initiat(?:e|ed)\s*checkout|checkouts?\s*initiated|(?:发起|开始)结账|fb\s*pixel\s*initiate\s*checkout/),
  field('checkoutRate', 'checkoutRate', '结账率 Checkout Rate', ['checkout rate', 'initiate checkout rate', '结账率', '发起结账率'], /(?:initiate\s*)?checkout\s*rate|(?:发起)?结账率/),
  field('checkoutCompletionRate', 'checkoutCompletionRate', '结账完成率', ['checkout completion rate', 'purchase completion rate', '结账完成率', '支付完成率'], /(?:checkout|purchase)\s*completion\s*rate|(?:结账|支付)完成率/),
  field('purchaseCvr', 'purchaseCvr', '购买转化率 Purchase CVR', ['purchase cvr', 'purchase conversion rate', '购买转化率', '购买 cvr'], /purchase\s*(?:cvr|conversion\s*rate)|购买\s*(?:转化率|cvr)/),
  field('purchases', 'purchases', '购买次数 Purchases', ['purchases', 'purchase', 'website purchases', 'website purchase', '购买', '购买次数', '成交购买', 'offsite conversion fb pixel purchase'], /website\s*purchases?|^purchases?$|购买(?:次数)?|成交购买|fb\s*pixel\s*purchase/),
  field('metaAttributedGmv', 'metaAttributedGmv', 'Meta Attributed GMV', ['meta attributed gmv', 'meta attributed revenue', 'purchase conversion value', 'website purchase conversion value', 'conversion value', 'purchase value', 'gmv', '销售额', '归因销售额', '购买转化价值', 'meta 归因销售额', 'meta归因销售额', 'offsite conversion fb pixel purchase value'], /(?:meta\s*)?(?:attributed\s*)?(?:gmv|revenue)|(?:website\s*)?purchase\s*(?:conversion\s*)?value|^conversion\s*value$|购买转化价值|归因销售额|销售额|fb\s*pixel\s*purchase\s*value/),
  field('purchaseRoas', 'roas', '购买回报 ROAS', ['purchase roas', 'roas', 'purchase return on ad spend', '广告支出回报', '购买 roas'], /purchase\s*roas|^roas$|return\s*on\s*ad\s*spend|广告支出回报|购买\s*roas/),
  field('cpa', 'cpa', '单次购买成本 CPA', ['cost per purchase', 'purchase cpa', 'cpa', '单次购买成本', '购买成本'], /(?:purchase\s*)?cpa|cost\s*per\s*purchase|单次购买成本|购买成本/),
  field('aov', 'aov', '平均订单价值 AOV', ['average order value', 'aov', '平均订单价值', '客单价'], /average\s*order\s*value|^aov$|平均订单价值|客单价/),
  field('formOpens', 'formOpens', '表单打开量', ['form opens', 'form open', '表单打开量', '表单打开'], /form\s*opens?|表单打开/),
  field('formSubmissions', 'formSubmits', '表单提交量', ['form submissions', 'form submits', 'form submit', '表单提交量', '表单提交'], /form\s*submi(?:t|ssion)s?|表单提交/),
  field('cpl', 'costPerResult', '单条线索成本 CPL', ['cpl', 'cost per lead', 'lead cpl', '单条线索成本', '线索成本'], /(?:lead\s*)?cpl|cost\s*per\s*lead|(?:单条)?线索成本/),
  field('leads', 'results', '销售线索 Leads', ['lead', 'leads', 'lead result', 'leads generated', 'leads collected', '潜在客户', '线索', '销售线索', '表单线索', '表单提交', '潜在客户信息 表单 量', 'leads form'], /leads?(?:\s*(?:generated|collected|result))?|潜在客户|(?:销售|表单)?线索|表单提交/),
  field('leadConversionRate', 'leadConversionRate', 'Lead 转化率', ['lead conversion rate', 'lead cvr', '线索转化率'], /lead\s*(?:conversion\s*rate|cvr)|线索转化率/),
  field('validLeads', 'validLeads', '有效 Lead', ['valid leads', 'qualified leads', '有效线索', '有效 lead'], /(?:valid|qualified)\s*leads?|有效\s*(?:线索|lead)/),
  field('invalidLeads', 'invalidLeads', '无效 Lead', ['invalid leads', '无效线索', '无效 lead'], /invalid\s*leads?|无效\s*(?:线索|lead)/),
  field('validLeadRate', 'validLeadRate', '有效 Lead 率', ['valid lead rate', '有效线索率', '有效 lead 率'], /valid\s*lead\s*rate|有效\s*(?:线索|lead)率/),
  field('validLeadCpl', 'validLeadCpl', '有效 Lead CPL', ['valid lead cpl', 'cost per valid lead', '有效线索成本', '有效 lead 成本'], /valid\s*lead\s*cpl|cost\s*per\s*valid\s*lead|有效\s*(?:线索|lead)成本/),
  field('contactedLeads', 'contactedLeads', '已联系 Lead', ['contacted leads', '已联系线索', '已联系 lead'], /contacted\s*leads?|已联系\s*(?:线索|lead)/),
  field('opportunities', 'opportunities', '商机 Opportunities', ['opportunities', 'opportunity', '商机'], /opportunities?|商机/),
  field('quotes', 'quotes', '报价 Quotes', ['quotes', 'quote', '报价'], /^quotes?$|报价/),
  field('deals', 'deals', '成交 Deals', ['deals', 'deal', 'closed won', '成交', '赢单'], /^deals?$|closed\s*won|成交|赢单/),
  field('platform', 'platform', '广告平台 Platform', ['platform', '广告平台'], /^platform$|广告平台/),
  field('product', 'product', '产品 Product', ['product', '产品'], /^product$|产品/),
  field('actions', 'actions', 'Meta Actions', ['actions', 'action'], /^actions?$/),
  field('actionValues', 'actionValues', 'Meta Action Values', ['action values', 'action value', 'action_values'], /^action\s*values?$/),
  field('conversions', 'conversions', 'Meta Conversions', ['conversions', 'conversion'], /^conversions?$/),
  field('conversionValues', 'conversionValues', 'Meta Conversion Values', ['conversion values', 'conversion value', 'conversion_values'], /^conversion\s*values?$/),
  field('currency', 'currency', '币种 Currency', ['currency', '币种'], /^currency$|币种/),
  field('timezone', 'timezone', '时区 Timezone', ['timezone', 'time zone', '时区'], /^time\s*zone$|时区/),
  field('budget', 'budget', '预算 Budget', ['budget', 'daily budget', '当前预算', '预算'], /(?:daily\s*)?budget|当前预算|^预算$/),
  field('status', 'status', '投放状态 Status', ['status', 'delivery status', '投放状态'], /(?:delivery\s*)?status|投放状态/),
  field('startTime', 'startTime', '开始投放时间', ['start time', 'start date', '开始投放时间'], /start\s*(?:time|date)|开始投放时间/)
]);

const AMBIGUOUS = Object.freeze({
  results: ['leads', 'purchases'],
  result: ['leads', 'purchases'],
  '成效': ['leads', 'purchases'],
  '结果': ['leads', 'purchases'],
  'cost per result': ['cpl', 'cpa'],
  '单次成效费用': ['cpl', 'cpa'],
  cost: ['spend', 'cpc', 'cpa', 'cpl'],
  value: ['metaAttributedGmv', 'purchases'],
  revenue: ['metaAttributedGmv', 'deals'],
  conversion: ['leads', 'purchases'],
  conversions: ['leads', 'purchases'],
  views: ['impressions', 'landingPageViews'],
  view: ['impressions', 'landingPageViews'],
  sales: ['deals', 'purchases'],
  sale: ['deals', 'purchases'],
  checkout: ['initiateCheckout', 'checkoutCompletionRate']
});

// Strong metric tokens are intentionally stricter than the broad semantic
// expressions above.  They make a standard metric with a descriptive suffix
// (for example "CPM（千次展示费用）") importable without asking the user,
// while broad words such as "Results" and "Cost" remain reviewable.
const STRONG_METRIC_MATCHERS = Object.freeze([
  ['linkClicks', /^(?:link|outbound|website)\s*clicks?\b|^(?:链接|网站|外链)\s*点击/],
  ['linkCtr', /^(?:link|outbound)\s*(?:click\s*)?ctr\b|^链接(?:\s*点击)?(?:率|ctr)/],
  ['landingPageViews', /^(?:landing\s*page\s*views?|lpv)\b|^落地页(?:浏览|访问)/],
  ['lpvRate', /^(?:lpv\s*rate|landing\s*page\s*views?\s*rate)\b|^落地页(?:浏览|到达)率/],
  ['addToCart', /^(?:adds?\s*to\s*cart|atc)\b|^(?:加购|加入购物车)/],
  ['atcRate', /^(?:atc\s*rate|adds?\s*to\s*cart\s*rate)\b|^加购率/],
  ['initiateCheckout', /^(?:initiat(?:e|ed)\s*checkout|checkouts?\s*initiated)\b|^(?:发起|开始)结账/],
  ['checkoutRate', /^(?:checkout\s*rate|initiate\s*checkout\s*rate)\b|^(?:发起)?结账率/],
  ['checkoutCompletionRate', /^(?:checkout|purchase)\s*completion\s*rate\b|^(?:结账|支付)完成率/],
  ['purchaseCvr', /^purchase\s*(?:cvr|conversion\s*rate)\b|^购买(?:转化率|cvr)/],
  ['metaAttributedGmv', /^(?:(?:meta\s*)?(?:attributed\s*)?(?:gmv|revenue)|(?:website\s*)?purchase\s*(?:conversion\s*)?value|purchase\s*value)\b|^(?:meta\s*)?(?:归因)?销售额|^购买转化价值/],
  ['purchaseRoas', /^(?:purchase\s*)?roas\b|^return\s*on\s*ad\s*spend\b|^(?:购买\s*)?roas|^广告支出回报/],
  ['cpa', /^(?:purchase\s*)?cpa\b|^cost\s*per\s*purchase\b|^单次购买成本|^购买成本/],
  ['aov', /^aov\b|^average\s*order\s*value\b|^平均订单价值|^客单价/],
  ['purchases', /^(?:website\s*)?purchases?\b|^购买(?:次数)?/],
  ['formOpens', /^form\s*opens?\b|^表单打开/],
  ['formSubmissions', /^form\s*submi(?:t|ssion)s?\b|^表单提交/],
  ['cpl', /^(?:lead\s*)?cpl\b|^cost\s*per\s*lead\b|^(?:单条)?线索成本/],
  ['leads', /^leads?(?:\s*(?:generated|collected|result))?\b|^(?:销售|表单)?线索|^潜在客户/],
  ['spend', /^(?:spend|amount\s*spent|(?:ad|media)\s*spend)\b|^(?:广告\s*(?:花费|消耗)|投放\s*(?:花费|金额)|消耗\s*金额|已?花费)/],
  ['impressions', /^(?:ad\s*)?impressions?\b|^(?:展示|曝光)(?:次数)?/],
  ['reach', /^(?:unique\s*)?(?:reach|people\s*reached|unique\s*people)\b|^(?:覆盖(?:人数|用户)|触达人数|独立触达)/],
  ['frequency', /^(?:(?:avg|average|ad)\s*)?frequency\b|^(?:平均\s*(?:展示)?频次|频次|人均曝光次数)/],
  ['clicks', /^(?:(?:all|total)\s*)?clicks?\b|^(?:所有|全部)?点击(?:量)?/],
  ['ctr', /^(?:ctr|click\s*through\s*rate)\b|^点击率/],
  ['cpc', /^(?:link\s*)?cpc\b|^cost\s*per\s*(?:link\s*)?click\b|^单次(?:链接)?点击(?:费用|成本)|^点击成本/],
  ['cpm', /^cpm\b|^cost\s*per\s*(?:1000|mille)\s*impressions?\b|^千次(?:展示|曝光)(?:费用|成本)/]
]);

// These columns are recognised as report metadata or optional supporting
// metrics, but are not consumed by the current dashboard calculations.  They
// should never become a blocking manual-confirmation task.
const AUXILIARY_FIELD_MATCHERS = Object.freeze([
  /^(?:country|国家)\s*code\b|^国家代码/,
  /^campaign\s*type\b|^广告系列类型/,
  /^(?:week|month|quarter)\s*(?:start|label)?\b|^(?:周|月份|季度)(?:开始|标签)?/,
  /^(?:internal|ad|campaign|ad\s*set|account)\s*id\b|^(?:内部|广告|广告系列|广告组|账户)\s*id/,
  /^(?:funnel|performance)\s*(?:type|tier)\b|^(?:漏斗|表现)(?:类型|层级)/,
  /^cost\s*per\s*(?:lpv|landing\s*page\s*view|atc|add\s*to\s*cart|checkout|initiate\s*checkout)\b|^每(?:次)?(?:落地页浏览|加购|结账)(?:费用|成本)/,
  /^(?:campaign\s*)?roas\s*(?:daily|weekly|monthly|quarterly|q\d|\d+d)?\b/
]);

const byCanonical = new Map(METRIC_DEFINITIONS.map(item => [item.canonicalMetric, item]));
const aliasLookup = new Map();
METRIC_DEFINITIONS.forEach(item => {
  [item.canonicalMetric, ...item.aliases].forEach(alias => {
    const key = compact(alias);
    if (key && !aliasLookup.has(key)) aliasLookup.set(key, item);
  });
});

export function getMetricDefinition(canonicalMetric) { return byCanonical.get(canonicalMetric) || null; }
export function getMetricLabel(canonicalMetric) { return getMetricDefinition(canonicalMetric)?.label || canonicalMetric; }
export function getSelectableMetrics(canonicalMetrics = []) {
  return canonicalMetrics.map(metric => ({ metric, label: getMetricLabel(metric) })).filter(item => item.label);
}

function getResultContext(headers = [], sampleRows = []) {
  const contextIndexes = headers.map((header, index) => ({ header: normalizeHeader(header), index }))
    .filter(item => /result\s*type|objective|optimization\s*goal|成效类型|结果类型|优化目标|目标/.test(item.header));
  const value = contextIndexes.flatMap(item => sampleRows.map(row => row?.[item.index])).join(' ').toLowerCase();
  const hasLeads = /lead|线索|潜在客户|lead generation|leads/.test(value);
  const hasPurchases = /purchase|购买|sales|sale|销售|shop|conversion/.test(value);
  // A mixed Result Type column cannot safely decide the meaning of Results.
  if (hasLeads === hasPurchases) return '';
  return hasLeads ? 'leads' : 'purchases';
}

function ambiguousKey(normalized = '') {
  if (AMBIGUOUS[normalized]) return normalized;
  // Unit, reporting-window, and initial-result suffixes do not resolve a
  // semantic ambiguity. They should still be reviewed or use Result Type.
  const stripped = normalized
    .replace(/(?:\s+(?:count|counts|times?|quantity|qty|number|amount|total|daily|weekly|monthly|quarterly|ytd|mtd|q\d|\d+d|initial|初始))+$/i, '')
    .trim();
  return AMBIGUOUS[stripped] ? stripped : '';
}

function explicitResultContext(normalized = '') {
  if (!/^results?\s+/.test(normalized)) return '';
  const qualifier = normalized.replace(/^results?\s+/, '');
  if (/lead|线索|潜在客户/.test(qualifier)) return 'leads';
  if (/purchase|购买|sales|sale|销售/.test(qualifier)) return 'purchases';
  return '';
}

function exactResult(header, context) {
  const normalized = normalizeHeader(header);
  const key = ambiguousKey(normalized) || (explicitResultContext(normalized) ? 'results' : '');
  if (!key) return null;
  const contextualMetric = key === 'cost per result' || key === '单次成效费用'
    ? (context === 'leads' ? 'cpl' : context === 'purchases' ? 'cpa' : '')
    : context;
  if (contextualMetric) {
    const definition = getMetricDefinition(contextualMetric);
    return {
      sourceHeader: String(header ?? ''), canonicalMetric: contextualMetric, internalKey: definition.internalKey,
      confidence: 0.9, matchType: 'context', status: 'confirmed', candidates: [contextualMetric]
    };
  }
  return {
    sourceHeader: String(header ?? ''), canonicalMetric: null, internalKey: null,
    confidence: 0.5, matchType: 'ambiguous', status: 'needs_confirmation', candidates: AMBIGUOUS[key]
  };
}

function buildMatch(header, definition, confidence, matchType, status = confidence >= 0.85 ? 'confirmed' : 'needs_confirmation') {
  return {
    sourceHeader: String(header ?? ''), canonicalMetric: definition.canonicalMetric, internalKey: definition.internalKey,
    confidence, matchType, status, candidates: status === 'needs_confirmation' ? [definition.canonicalMetric] : []
  };
}

export function resolveMetric(header, { headers = [], sampleRows = [], customMappings = {} } = {}) {
  const sourceHeader = String(header ?? '').trim();
  if (!sourceHeader) return { sourceHeader, canonicalMetric: null, internalKey: null, confidence: 0, matchType: 'unused', status: 'unused', candidates: [] };
  const normalized = normalizeHeader(sourceHeader);
  const contextual = exactResult(sourceHeader, explicitResultContext(normalized) || getResultContext(headers, sampleRows));
  // Explicit generic conversion labels must not be hijacked by Meta's raw
  // `conversions` payload field. They need Result Type or manual confirmation.
  if (AMBIGUOUS[normalized] && contextual) return contextual;
  // File-level Result Type / Objective context is more trustworthy than a
  // previously remembered generic mapping such as "Results".
  if (contextual?.status === 'confirmed') return contextual;
  const direct = aliasLookup.get(compact(sourceHeader));
  if (direct) return buildMatch(sourceHeader, direct, normalized === normalizeHeader(direct.canonicalMetric) ? 1 : 0.97, normalized === normalizeHeader(direct.canonicalMetric) ? 'exact_alias' : 'normalized_alias');
  const rememberedMetric = customMappings?.[normalized];
  const rememberedDefinition = rememberedMetric ? getMetricDefinition(rememberedMetric) : null;
  if (rememberedDefinition) return buildMatch(sourceHeader, rememberedDefinition, 1, 'remembered_mapping', 'confirmed');
  if (contextual) return contextual;

  if (AUXILIARY_FIELD_MATCHERS.some(pattern => pattern.test(normalized))) {
    return { sourceHeader, canonicalMetric: null, internalKey: null, confidence: 1, matchType: 'auxiliary', status: 'unused', candidates: [] };
  }

  const strongMatches = STRONG_METRIC_MATCHERS
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([metric]) => getMetricDefinition(metric))
    .filter(Boolean);
  if (strongMatches.length === 1) return buildMatch(sourceHeader, strongMatches[0], 0.93, 'strong_token', 'confirmed');

  const matches = METRIC_DEFINITIONS.filter(definition => definition.semantic?.test(normalized));
  // Semantic-only matches remain reviewable: a custom header such as
  // "Campaign Type" contains the word Campaign but must never replace the
  // actual Campaign column. Exact, normalised, and strong-token aliases auto-confirm.
  if (matches.length === 1) return buildMatch(sourceHeader, matches[0], 0.72, 'semantic');
  if (matches.length > 1) {
    return {
      sourceHeader, canonicalMetric: null, internalKey: null, confidence: 0.55, matchType: 'ambiguous', status: 'needs_confirmation',
      candidates: [...new Set(matches.map(item => item.canonicalMetric))]
    };
  }
  return { sourceHeader, canonicalMetric: null, internalKey: null, confidence: 0, matchType: 'unused', status: 'unused', candidates: [] };
}

export function buildHeaderMapping(headers = [], { sampleRows = [], sheetId = '', customMappings = {} } = {}) {
  const usedInternalKeys = new Set();
  return headers.map((header, index) => {
    const result = { ...resolveMetric(header, { headers, sampleRows, customMappings }), index, id: `${sheetId}:${index}` };
    if (result.status === 'confirmed' && usedInternalKeys.has(result.internalKey)) {
      result.status = 'unused'; result.matchType = 'duplicate'; result.confidence = 0; result.candidates = [];
      result.canonicalMetric = null; result.internalKey = null;
    }
    if (result.status === 'confirmed' && result.internalKey) usedInternalKeys.add(result.internalKey);
    return result;
  });
}

export function applyMappingOverrides(mapping = [], overrides = {}) {
  const usedInternalKeys = new Set(mapping.filter(item => item.status === 'confirmed').map(item => item.internalKey).filter(Boolean));
  return mapping.map(item => {
    const selected = overrides[item.id];
    if (!selected) return item;
    if (selected === 'ignore') return { ...item, canonicalMetric: null, internalKey: null, status: 'unused', matchType: 'ignored', confidence: 0 };
    const definition = getMetricDefinition(selected);
    if (!definition || usedInternalKeys.has(definition.internalKey)) return { ...item, canonicalMetric: null, internalKey: null, status: 'unused', matchType: 'duplicate', confidence: 0 };
    usedInternalKeys.add(definition.internalKey);
    return { ...item, canonicalMetric: definition.canonicalMetric, internalKey: definition.internalKey, status: 'confirmed', matchType: 'user_confirmed', confidence: 1, candidates: [] };
  });
}

export function mappingConfidenceLabel(confidence = 0) {
  if (confidence >= 0.85) return `置信度 ${Math.round(confidence * 100)}%`;
  if (confidence >= 0.6) return `待确认 ${Math.round(confidence * 100)}%`;
  return confidence ? `低置信度 ${Math.round(confidence * 100)}%` : '未使用';
}

export function confirmedMetricKeys(mapping = []) {
  return [...new Set(mapping.filter(item => item.status === 'confirmed' && item.internalKey).map(item => item.internalKey))];
}


/**
 * Groups field-mapping rows for the confirmation UI. Confirmed rows collapse
 * by canonical metric, while unresolved and unused rows collapse by their
 * normalised source header. Parser mappings are left untouched so every sheet
 * still imports its own confirmed column.
 */
export function groupMappingForDisplay(rows = [], status) {
  const groups = new Map();
  rows.filter(item => item.status === status && !(status === 'unused' && item.matchType === 'duplicate')).forEach(item => {
    const key = status === 'confirmed'
      ? `${status}:${item.canonicalMetric || item.internalKey || normalizeHeader(item.sourceHeader)}`
      : `${status}:${normalizeHeader(item.sourceHeader) || item.id}`;
    const group = groups.get(key) || {
      ...item, sourceHeaders: [], sheetNames: [], matchTypes: [], candidates: [], mapIds: []
    };
    if (item.sourceHeader && !group.sourceHeaders.includes(item.sourceHeader)) group.sourceHeaders.push(item.sourceHeader);
    if (item.sheetName && !group.sheetNames.includes(item.sheetName)) group.sheetNames.push(item.sheetName);
    if (item.matchType && !group.matchTypes.includes(item.matchType)) group.matchTypes.push(item.matchType);
    (item.candidates || []).forEach(candidate => { if (!group.candidates.includes(candidate)) group.candidates.push(candidate); });
    group.mapIds.push(item.id);
    groups.set(key, group);
  });
  return [...groups.values()];
}

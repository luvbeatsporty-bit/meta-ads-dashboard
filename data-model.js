export const BUSINESS_MODE = Object.freeze({ B2B_LEAD: 'b2b-lead', B2C_ECOMMERCE: 'b2c-commerce' });

export const DEFAULT_COMMERCE_RULES = Object.freeze({
  targetRoas: 3,
  targetCpa: 20,
  roasWatchRatio: 0.8,
  roasHighRiskRatio: 0.6,
  cpaWatchMultiplier: 1.2,
  cpaHighRiskMultiplier: 1.5,
  noPurchaseHighSpendMultiplier: 2,
  noPurchaseStopSpendMultiplier: 3,
  highCpaStopMultiplier: 2,
  lowRoasStopRatio: 0.5,
  minimumPurchaseSample: 3
});

export const DEFAULT_RULES = Object.freeze({
  extremeSpend: 30,
  extremeClicks: 30,
  highCpl: 20,
  highClicks: 30,
  highConversionPercent: 2,
  highValidCpl: 30,
  lowValidRatePercent: 20,
  watchSpend: 15,
  watchCpl: 15,
  watchCtrPercent: 0.8,
  watchCpc: 1.5,
  excellentCpl: 10,
  frequencyWarningThreshold: 2.5,
  frequencyHighRiskThreshold: 4
});

// These are the fields used by the current Phase 1/2 implementation. Unknown
// columns remain available in sourceRows, so later mappings do not require a
// new importer.
export const AD_FIELDS = [
  ['date', '日期'], ['platform', '广告平台'], ['country', '国家 / 地区'], ['product', '产品'],
  ['accountId', '广告账户 ID'], ['accountName', '广告账户名称'], ['campaignId', 'Campaign ID'],
  ['campaign', 'Campaign 名称'], ['adSetId', 'Ad Set ID'], ['adSet', 'Ad Set 名称'],
  ['adId', 'Ad ID'], ['ad', 'Ad 名称'], ['creative', '素材名称'], ['creativeType', '素材类型'],
  ['audienceType', '受众类型'], ['status', '投放状态'], ['startTime', '开始投放时间'],
  ['budget', '当前预算'], ['currency', '币种'], ['timezone', '时区'], ['spend', '花费'],
  ['impressions', '展示次数'], ['reach', '覆盖人数'], ['frequency', '频次'], ['allClicks', '全部点击量'],
  ['clicks', '链接点击量'], ['ctr', '链接 CTR'], ['allCtr', '全部 CTR'], ['cpc', '链接 CPC'],
  ['cpm', 'CPM'], ['landingPageViews', 'Landing Page Views'], ['lpvRate', 'LPV Rate'], ['placement', '版位'], ['addToCart', 'Add to Cart'], ['atcRate', 'ATC Rate'], ['initiateCheckout', 'Initiate Checkout'], ['checkoutRate', 'Checkout Rate'], ['purchases', 'Purchases'], ['checkoutCompletionRate', 'Checkout Completion Rate'], ['purchaseCvr', 'Purchase CVR'], ['metaAttributedGmv', 'Meta Attributed GMV'], ['formOpens', '表单打开量'],
  ['formSubmits', '表单提交量'], ['results', 'Lead / 成效'], ['costPerResult', 'Cost Per Result'],
  ['dateStart', '报告起始日期'], ['dateEnd', '报告截止日期']
];

export const LEAD_FIELDS = [
  ['leadId', 'Lead ID'], ['submittedAt', 'Lead 创建时间'], ['country', '国家 / 地区'], ['product', '产品'],
  ['campaignId', 'Campaign ID'], ['campaign', 'Campaign 名称'], ['adSetId', 'Ad Set ID'], ['adSet', 'Ad Set 名称'],
  ['adId', 'Ad ID'], ['ad', 'Ad 名称'], ['utmSource', 'UTM Source'], ['utmMedium', 'UTM Medium'],
  ['utmCampaign', 'UTM Campaign'], ['utmContent', 'UTM Content'], ['name', '联系人名称'], ['company', '公司名称'],
  ['email', '邮箱'], ['phone', '电话'], ['status', 'Lead 状态'], ['isValid', '是否有效'],
  ['isDuplicate', '是否重复'], ['isInternalTest', '是否内部测试'], ['contacted', '是否联系成功'],
  ['followedUp', '是否已经跟进'], ['interested', '是否明确感兴趣'], ['opportunity', '是否形成商机'],
  ['quoted', '是否报价'], ['won', '是否成交'], ['revenue', '成交金额'], ['invalidReason', '无效原因'],
  ['owner', '销售负责人'], ['notes', '销售备注']
];

export const AD_ALIASES = {
  date:['日期','date','day'], platform:['广告平台','platform'], country:['国家/地区','国家','地区','country','country/region','地域'], product:['产品','product'],
  accountId:['广告账户id','account id','accountid'], accountName:['广告账户名称','account name'], campaignId:['广告系列id','campaign id','campaignid'],
  campaign:['广告系列','广告系列名称','campaign','campaign name'], adSetId:['广告组id','ad set id','adset id'], adSet:['广告组','广告组名称','ad set','adset'],
  adId:['广告id','ad id','adid'], ad:['广告','广告名称','ad name'], creative:['素材名称','creative','creative name'], creativeType:['素材类型','creative type'],
  audienceType:['受众类型','audience type'], status:['投放状态','delivery status','status'], startTime:['开始投放时间','start time'], budget:['当前预算','budget'],
  currency:['币种','currency'], timezone:['时区','timezone'], spend:['花费','金额花费','已花费金额','已花费金额 (USD)','已花费金额（USD）','amount spent','spend','spend (usd)','amount spent (usd)'],
  impressions:['展示','展示次数','impressions'], reach:['覆盖人数','reach'], frequency:['频次','frequency'], allClicks:['全部点击量','all clicks'], clicks:['链接点击','链接点击量','link clicks','website clicks','clicks'],
  ctr:['链接ctr','链接 CTR','link ctr','link click-through rate','ctr','click-through rate','点击率'], allCtr:['全部ctr','all ctr'], cpc:['链接cpc','链接 CPC','link cpc','cost per link click','cpc','cost per click','单次点击费用','点击费用'], cpm:['cpm','千次展示费用'], landingPageViews:['landing page views','landing page view','lpv','落地页浏览量','landing_page_view','offsite_conversion.fb_pixel_landing_page_view'], lpvRate:['lpv rate','landing page view rate','landing page views rate','落地页浏览率','落地页到达率'], placement:['placement','版位','投放位置'], addToCart:['add to cart','adds to cart','website adds to cart','atc','add_to_cart','offsite_conversion.fb_pixel_add_to_cart'], atcRate:['atc rate','add to cart rate','adds to cart rate','加购率'], initiateCheckout:['initiate checkout','initiated checkout','website checkouts initiated','checkout','initiate_checkout','offsite_conversion.fb_pixel_initiate_checkout'], checkoutRate:['checkout rate','initiate checkout rate','结账率','发起结账率'], purchases:['purchases','purchase','website purchases','website purchase','offsite_conversion.fb_pixel_purchase'], checkoutCompletionRate:['checkout completion rate','purchase completion rate','结账完成率','支付完成率'], purchaseCvr:['purchase cvr','purchase conversion rate','购买转化率','购买cvr'], metaAttributedGmv:['purchase conversion value','website purchase conversion value','conversion value','purchase value','meta attributed gmv','meta attributed revenue','gmv','offsite_conversion.fb_pixel_purchase_value'],
  formOpens:['表单打开量','form opens'], formSubmits:['表单提交量','form submits'], results:['成效','结果','结果（初始）','结果(初始)','线索','lead','leads','results','表单提交','潜在客户信息（表单）量','leads (form)'],
  costPerResult:['cost per result','每项成效费用'], roas:['purchase roas','roas','purchase return on ad spend'], cpa:['cost per purchase','purchase cpa','cpa'], aov:['average order value','aov'], actions:['actions','action'], actionValues:['action values','action_values','actionvalues'], conversions:['conversions','conversion'], conversionValues:['conversion values','conversion_values','conversionvalues'], dateStart:['报告起始日期','报告开始日期','开始日期','date start','reporting starts','reporting start'], dateEnd:['报告截止日期','报告结束日期','结束日期','date stop','reporting ends','reporting end']
};

export const LEAD_ALIASES = {
  leadId:['lead id','线索id','潜在客户id','id'], submittedAt:['提交时间','创建时间','created time','created_at','submission time','date','lead created time'], country:['country','country/region','国家','国家/地区','地区'], product:['product','产品'],
  campaignId:['campaign id','campaignid','广告系列id'], campaign:['campaign','广告系列','广告系列名称','campaign name'], adSetId:['ad set id','adset id','广告组id'], adSet:['ad set','adset','广告组','广告组名称'], adId:['ad id','adid','广告id'], ad:['ad','广告','广告名称','ad name'],
  utmSource:['utm source'], utmMedium:['utm medium'], utmCampaign:['utm campaign'], utmContent:['utm content'], name:['name','联系人名称','姓名'], company:['company','公司名称'], email:['email','邮箱','电子邮箱'], phone:['phone','电话','手机号','电话号码','mobile'],
  status:['status','状态','lead status','线索状态','销售状态'], isValid:['是否有效','有效','is valid','valid','qualified'], isDuplicate:['是否重复','重复','duplicate'], isInternalTest:['是否内部测试','内部测试','internal test','test'], contacted:['是否联系成功','联系成功','contacted'], followedUp:['是否已经跟进','已跟进','followed up'], interested:['是否明确感兴趣','明确感兴趣','interested'], opportunity:['是否形成商机','形成商机','opportunity'], quoted:['是否报价','报价','quoted'], won:['是否成交','成交','won','closed'], revenue:['成交金额','revenue','deal value'], invalidReason:['无效原因','invalid reason'], owner:['销售负责人','sales owner','owner'], notes:['销售备注','sales notes','notes']
};

export function normalize(value) { return String(value ?? '').toLowerCase().replace(/[\s_\-()（）\[\]：:]/g, '').trim(); }
export function findAliasKey(value, aliases) { const v = normalize(value); return Object.keys(aliases).find(key => aliases[key].some(alias => normalize(alias) === v)) || ''; }
export const AD_METRIC_KEYS = Object.freeze([
  'spend', 'results', 'impressions', 'reach', 'frequency', 'allClicks', 'clicks', 'ctr', 'allCtr', 'cpc', 'cpm',
  'landingPageViews', 'addToCart', 'initiateCheckout', 'purchases', 'metaAttributedGmv', 'formOpens', 'formSubmits',
  'costPerResult', 'roas', 'cpa', 'aov', 'lpvRate', 'atcRate', 'checkoutRate', 'checkoutCompletionRate', 'purchaseCvr'
]);

export function toNumber(value) { if (typeof value === 'number') return Number.isFinite(value) ? value : 0; const n = parseFloat(String(value ?? '').replace(/[$￥€£,\s%]/g, '')); return Number.isFinite(n) ? n : 0; }
export function toOptionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}
export function isMetricAvailable(row, key) {
  if (!row) return false;
  if (row.availableMetrics && Object.hasOwn(row.availableMetrics, key)) return Boolean(row.availableMetrics[key]);
  if (row.sourceRows && Object.hasOwn(row.sourceRows, key)) return row.sourceRows[key] !== null && row.sourceRows[key] !== undefined && String(row.sourceRows[key]).trim() !== '';
  return row[key] !== null && row[key] !== undefined;
}
export function rowsHaveMetric(rows = [], key) { return rows.some(row => isMetricAvailable(row, key)); }

export function toDate(value) { if (value === null || value === undefined || value === '') return ''; if (typeof value === 'number') { if (typeof window !== 'undefined' && window.XLSX?.SSF) { const d = XLSX.SSF.parse_date_code(value); if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; } if (value > 20000 && value < 90000) return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000)).toISOString().slice(0, 10); } const text = String(value).trim(); const m = text.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/); return m ? `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}` : text; }
export function createAdRecord(raw = {}) {
  return {
    id: crypto.randomUUID(), country:'未分类', campaign:'未命名广告系列', adSet:'', ad:'', placement:'',
    spend:null, results:null, impressions:null, reach:null, frequency:null, allClicks:null, clicks:null,
    ctr:null, allCtr:null, cpc:null, cpm:null, landingPageViews:null, lpvRate:null, addToCart:null, atcRate:null, initiateCheckout:null,
    checkoutRate:null, purchases:null, checkoutCompletionRate:null, purchaseCvr:null, metaAttributedGmv:null, formOpens:null, formSubmits:null, costPerResult:null,
    roas:null, cpa:null, aov:null, dateStart:'', dateEnd:'', sourceFile:'', sourceSheet:'',
    availableMetrics:{}, sourceRows:{}, sourceRaw:{}, ...raw
  };
}
export function createLeadRecord(raw = {}) { return { id: crypto.randomUUID(), leadId:'', submittedAt:'', campaign:'', adSet:'', ad:'', country:'', status:'', sourceFile:'', sourceRow:{}, ...raw }; }

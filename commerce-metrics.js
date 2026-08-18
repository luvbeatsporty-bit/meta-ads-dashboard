import { isMetricAvailable, rowsHaveMetric, toNumber } from './data-model.js';
import { averageFrequency, rawMetricAverage } from './metrics.js';

export const safeDivide = (numerator, denominator) => {
  if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
  const top = toNumber(numerator);
  const bottom = toNumber(denominator);
  return bottom > 0 ? top / bottom : null;
};

function total(rows, key) {
  return rows.reduce((sum, row) => sum + (isMetricAvailable(row, key) ? toNumber(row[key]) : 0), 0);
}

function directOrDerived(rows, available, directKey, numeratorKey, denominatorKey, scale = 1) {
  if (available[numeratorKey] && available[denominatorKey]) return safeDivide(total(rows, numeratorKey) * scale, total(rows, denominatorKey));
  return available[directKey] ? rawMetricAverage(rows, directKey) : null;
}

export function commerceTotals(rows = []) {
  const keys = ['spend', 'impressions', 'reach', 'frequency', 'clicks', 'landingPageViews', 'addToCart', 'initiateCheckout', 'purchases', 'metaAttributedGmv', 'ctr', 'cpc', 'cpm', 'lpvRate', 'atcRate', 'checkoutRate', 'checkoutCompletionRate', 'purchaseCvr', 'roas', 'cpa', 'aov'];
  const availableMetrics = Object.fromEntries(keys.map(key => [key, rowsHaveMetric(rows, key)]));
  const totals = {
    spend: total(rows, 'spend'), impressions: total(rows, 'impressions'), reach: total(rows, 'reach'),
    linkClicks: total(rows, 'clicks'), landingPageViews: total(rows, 'landingPageViews'), addToCart: total(rows, 'addToCart'),
    initiateCheckout: total(rows, 'initiateCheckout'), purchases: total(rows, 'purchases'), metaAttributedGmv: total(rows, 'metaAttributedGmv')
  };
  const has = key => availableMetrics[key];
  return {
    ...totals,
    availableMetrics,
    frequency: has('frequency') || (has('impressions') && has('reach')) ? averageFrequency(rows) : null,
    ctr: directOrDerived(rows, availableMetrics, 'ctr', 'clicks', 'impressions'),
    cpc: directOrDerived(rows, availableMetrics, 'cpc', 'spend', 'clicks'),
    cpm: has('spend') && has('impressions') ? (totals.impressions > 0 ? totals.spend / totals.impressions * 1000 : null) : (has('cpm') ? rawMetricAverage(rows, 'cpm') : null),
    lpvRate: directOrDerived(rows, availableMetrics, 'lpvRate', 'landingPageViews', 'clicks'),
    atcRate: directOrDerived(rows, availableMetrics, 'atcRate', 'addToCart', 'landingPageViews'),
    checkoutRate: directOrDerived(rows, availableMetrics, 'checkoutRate', 'initiateCheckout', 'addToCart'),
    checkoutCompletionRate: directOrDerived(rows, availableMetrics, 'checkoutCompletionRate', 'purchases', 'initiateCheckout'),
    purchaseCvr: directOrDerived(rows, availableMetrics, 'purchaseCvr', 'purchases', 'clicks'),
    cpa: has('spend') && has('purchases') ? safeDivide(totals.spend, totals.purchases) : (has('cpa') ? rawMetricAverage(rows, 'cpa') : null),
    aov: has('metaAttributedGmv') && has('purchases') ? safeDivide(totals.metaAttributedGmv, totals.purchases) : (has('aov') ? rawMetricAverage(rows, 'aov') : null),
    roas: has('metaAttributedGmv') && has('spend') ? safeDivide(totals.metaAttributedGmv, totals.spend) : (has('roas') ? rawMetricAverage(rows, 'roas') : null)
  };
}

function dateValue(row) { const text = String(row.dateEnd || row.dateStart || row.date || '').slice(0, 10); const date = Date.parse(`${text}T00:00:00Z`); return Number.isFinite(date) ? date : null; }
function dateKey(row) { return String(row.dateEnd || row.dateStart || row.date || '').slice(0, 10); }

export function commerceGroups(rows = [], field = 'campaign') {
  const groups = new Map();
  rows.forEach(row => {
    const name = row[field] || '未分类'; const country = row.country || '未分类'; const key = field === 'campaign' ? `${name}|${country}` : name;
    if (!groups.has(key)) groups.set(key, { id:key, name, campaign:row.campaign || name, country, countries:new Set(), rows:[], dates:new Set() });
    const group = groups.get(key); group.rows.push(row); group.countries.add(country); const date = dateKey(row); if (date) group.dates.add(date);
  });
  return [...groups.values()].map(group => ({ ...group, ...commerceTotals(group.rows), dayCount:group.dates.size }));
}

export function commerceDimensionGroups(rows = [], dimension = 'campaign') {
  const groups = new Map();
  const valueFor = row => dimension === 'country' ? row.country || '未分类' : dimension === 'creative' ? row.creative || row.ad || '未命名素材' : row.campaign || '未分类 Campaign';
  rows.forEach(row => {
    const name=valueFor(row), key=`${dimension}:${name}`;
    if (!groups.has(key)) groups.set(key, { id:key, name, rows:[], countries:new Set(), campaigns:new Set(), creativeTypes:new Set(), dates:new Set() });
    const group=groups.get(key); group.rows.push(row); group.countries.add(row.country || '未分类'); group.campaigns.add(row.campaign || '未分类 Campaign'); if(row.creativeType) group.creativeTypes.add(row.creativeType); const date=dateKey(row); if(date) group.dates.add(date);
  });
  return [...groups.values()].map(group => ({ ...group, countries:[...group.countries], campaigns:[...group.campaigns], creativeTypes:[...group.creativeTypes], ...commerceTotals(group.rows), dayCount:group.dates.size }));
}

export function commerceTrend(rows = [], metric = 'spend') {
  const byDate = new Map(); rows.forEach(row => { const key=dateKey(row); if(!key) return; if(!byDate.has(key)) byDate.set(key, []); byDate.get(key).push(row); });
  const allowed = new Set(['spend','purchases','metaAttributedGmv','roas','cpa','purchaseCvr']); const key=allowed.has(metric)?metric:'spend';
  return [...byDate.entries()].sort(([one],[two]) => one.localeCompare(two)).map(([date, entries]) => { const totals=commerceTotals(entries); return { date, value:totals[key], totals }; });
}

export function recentCommerceComparison(rows = []) {
  const dated=rows.map(row => ({row,time:dateValue(row)})).filter(item=>item.time!==null); if(!dated.length) return null;
  const latest=Math.max(...dated.map(item=>item.time)), day=86400000;
  const current=dated.filter(item=>item.time>=latest-day*2).map(item=>item.row); const previous=dated.filter(item=>item.time>=latest-day*5 && item.time<latest-day*2).map(item=>item.row);
  if(!current.length||!previous.length) return null;
  const currentMetrics=commerceTotals(current), previousMetrics=commerceTotals(previous);
  const change=key => previousMetrics[key] !== null && previousMetrics[key] > 0 && currentMetrics[key] !== null ? (currentMetrics[key]-previousMetrics[key])/previousMetrics[key] : null;
  return { current:currentMetrics, previous:previousMetrics, ctrChange:change('ctr'), cpcChange:change('cpc'), cpaChange:change('cpa'), roasChange:change('roas'), impressionChange:change('impressions'), reachChange:change('reach'), frequencyChange:change('frequency') };
}

export function funnelStages(metrics) {
  return [['impressions','Impressions',metrics.impressions,null],['linkClicks','Link Clicks',metrics.linkClicks,metrics.ctr],['landingPageViews','Landing Page Views',metrics.landingPageViews,metrics.lpvRate],['addToCart','Add to Cart',metrics.addToCart,metrics.atcRate],['initiateCheckout','Initiate Checkout',metrics.initiateCheckout,metrics.checkoutRate],['purchases','Purchases',metrics.purchases,metrics.checkoutCompletionRate]]
    .map(([key,label,value,rate]) => ({ key,label,value:metrics.availableMetrics?.[key === 'linkClicks' ? 'clicks' : key] ? value : null,rate }));
}

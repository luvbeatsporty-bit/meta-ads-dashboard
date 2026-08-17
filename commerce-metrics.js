import { toNumber } from './data-model.js';
import { averageFrequency } from './metrics.js';

export const safeDivide = (numerator, denominator) => {
  const top = toNumber(numerator);
  const bottom = toNumber(denominator);
  return bottom > 0 ? top / bottom : null;
};

export function commerceTotals(rows = []) {
  const totals = rows.reduce((total, row) => {
    total.spend += toNumber(row.spend);
    total.impressions += toNumber(row.impressions);
    total.reach += toNumber(row.reach);
    total.linkClicks += toNumber(row.clicks ?? row.linkClicks);
    total.landingPageViews += toNumber(row.landingPageViews);
    total.addToCart += toNumber(row.addToCart);
    total.initiateCheckout += toNumber(row.initiateCheckout);
    total.purchases += toNumber(row.purchases);
    total.metaAttributedGmv += toNumber(row.metaAttributedGmv);
    return total;
  }, { spend: 0, impressions: 0, reach: 0, linkClicks: 0, landingPageViews: 0, addToCart: 0, initiateCheckout: 0, purchases: 0, metaAttributedGmv: 0 });

  return {
    ...totals,
    frequency: averageFrequency(rows),
    ctr: safeDivide(totals.linkClicks, totals.impressions),
    cpc: safeDivide(totals.spend, totals.linkClicks),
    cpm: totals.impressions > 0 ? totals.spend / totals.impressions * 1000 : null,
    lpvRate: safeDivide(totals.landingPageViews, totals.linkClicks),
    atcRate: safeDivide(totals.addToCart, totals.landingPageViews),
    checkoutRate: safeDivide(totals.initiateCheckout, totals.addToCart),
    checkoutCompletionRate: safeDivide(totals.purchases, totals.initiateCheckout),
    purchaseCvr: safeDivide(totals.purchases, totals.linkClicks),
    cpa: safeDivide(totals.spend, totals.purchases),
    aov: safeDivide(totals.metaAttributedGmv, totals.purchases),
    roas: safeDivide(totals.metaAttributedGmv, totals.spend)
  };
}

function dateValue(row) {
  const text = String(row.dateEnd || row.dateStart || row.date || '').slice(0, 10);
  const date = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(date) ? date : null;
}

function dateKey(row) {
  return String(row.dateEnd || row.dateStart || row.date || '').slice(0, 10);
}

export function commerceGroups(rows = [], field = 'campaign') {
  const groups = new Map();
  rows.forEach(row => {
    const name = row[field] || '未分类';
    const country = row.country || '未分类';
    const key = field === 'campaign' ? `${name}|${country}` : name;
    if (!groups.has(key)) groups.set(key, { id: key, name, campaign: row.campaign || name, country, countries: new Set(), rows: [], dates: new Set() });
    const group = groups.get(key);
    group.rows.push(row);
    group.countries.add(country);
    const date = dateKey(row);
    if (date) group.dates.add(date);
  });
  return [...groups.values()].map(group => ({ ...group, ...commerceTotals(group.rows), dayCount: group.dates.size }));
}

/**
 * Aggregates B2C reporting dimensions for dashboard tables. This deliberately
 * does not alter commerceGroups(), which remains the Campaign + Country input
 * used by the commercial diagnosis engine.
 */
export function commerceDimensionGroups(rows = [], dimension = 'campaign') {
  const groups = new Map();
  const valueFor = row => {
    if (dimension === 'country') return row.country || '未分类';
    if (dimension === 'creative') return row.creative || row.ad || '未命名素材';
    return row.campaign || '未分类 Campaign';
  };

  rows.forEach(row => {
    const name = valueFor(row);
    const key = `${dimension}:${name}`;
    if (!groups.has(key)) groups.set(key, {
      id: key,
      name,
      rows: [],
      countries: new Set(),
      campaigns: new Set(),
      creativeTypes: new Set(),
      dates: new Set()
    });
    const group = groups.get(key);
    group.rows.push(row);
    group.countries.add(row.country || '未分类');
    group.campaigns.add(row.campaign || '未分类 Campaign');
    if (row.creativeType) group.creativeTypes.add(row.creativeType);
    const date = dateKey(row);
    if (date) group.dates.add(date);
  });

  return [...groups.values()].map(group => ({
    ...group,
    countries: [...group.countries],
    campaigns: [...group.campaigns],
    creativeTypes: [...group.creativeTypes],
    ...commerceTotals(group.rows),
    dayCount: group.dates.size
  }));
}

/** Returns one current-filter aggregate per reporting day for the B2C trend chart. */
export function commerceTrend(rows = [], metric = 'spend') {
  const byDate = new Map();
  rows.forEach(row => {
    const key = dateKey(row);
    if (!key) return;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(row);
  });
  const allowed = new Set(['spend', 'purchases', 'metaAttributedGmv', 'roas', 'cpa', 'purchaseCvr']);
  const key = allowed.has(metric) ? metric : 'spend';
  return [...byDate.entries()]
    .sort(([one], [two]) => one.localeCompare(two))
    .map(([date, entries]) => {
      const totals = commerceTotals(entries);
      return { date, value: totals[key], totals };
    });
}

export function recentCommerceComparison(rows = []) {
  const dated = rows.map(row => ({ row, time: dateValue(row) })).filter(item => item.time !== null);
  if (!dated.length) return null;
  const latest = Math.max(...dated.map(item => item.time));
  const day = 86400000;
  const current = dated.filter(item => item.time >= latest - day * 2).map(item => item.row);
  const previous = dated.filter(item => item.time >= latest - day * 5 && item.time < latest - day * 2).map(item => item.row);
  if (!current.length || !previous.length) return null;
  const currentMetrics = commerceTotals(current);
  const previousMetrics = commerceTotals(previous);
  const change = key => previousMetrics[key] && currentMetrics[key] !== null ? (currentMetrics[key] - previousMetrics[key]) / previousMetrics[key] : null;
  return {
    current: currentMetrics,
    previous: previousMetrics,
    ctrChange: change('ctr'),
    cpcChange: change('cpc'),
    cpaChange: change('cpa'),
    roasChange: change('roas'),
    impressionChange: change('impressions'),
    reachChange: change('reach'),
    frequencyChange: change('frequency')
  };
}

export function funnelStages(metrics) {
  return [
    ['impressions', 'Impressions', metrics.impressions, null],
    ['linkClicks', 'Link Clicks', metrics.linkClicks, metrics.ctr],
    ['landingPageViews', 'Landing Page Views', metrics.landingPageViews, metrics.lpvRate],
    ['addToCart', 'Add to Cart', metrics.addToCart, metrics.atcRate],
    ['initiateCheckout', 'Initiate Checkout', metrics.initiateCheckout, metrics.checkoutRate],
    ['purchases', 'Purchases', metrics.purchases, metrics.checkoutCompletionRate]
  ].map(([key, label, value, rate]) => ({ key, label, value, rate }));
}

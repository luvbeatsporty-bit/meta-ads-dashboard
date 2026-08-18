import assert from 'node:assert/strict';
import { parseAdRows } from '../excel-import.js';
import { sumAds } from '../metrics.js';
import { commerceTotals } from '../commerce-metrics.js';
import { commerceDiagnostics } from '../commerce-diagnosis.js';
import { DEFAULT_COMMERCE_RULES } from '../data-model.js';

const rules = { ...DEFAULT_COMMERCE_RULES, frequencyWarningThreshold: 2.5, frequencyHighRiskThreshold: 4 };

function parse(headers, values, fileName = 'partial.csv') {
  const rows = parseAdRows([headers, values], fileName, 'Sheet1');
  assert.equal(rows.length, 1, `${fileName} should produce one record`);
  return rows[0];
}

// B2B: a small lead report is enough to import and derive CPL.
const b2bSpendLead = parse(
  ['Date', 'Campaign', 'Spend', 'Leads'],
  ['2026-08-10', 'B2B campaign', '100', '5']
);
assert.equal(b2bSpendLead.spend, 100);
assert.equal(b2bSpendLead.results, 5);
assert.equal(b2bSpendLead.availableMetrics.spend, true);
assert.equal(b2bSpendLead.availableMetrics.results, true);
assert.equal(b2bSpendLead.availableMetrics.impressions, false);
assert.equal(sumAds([b2bSpendLead]).cpl, 20);
assert.equal(sumAds([b2bSpendLead]).ctr, null);

// B2B: impressions + link clicks derive CTR and CPC without any lead field.
const b2bTraffic = parse(
  ['Country', 'Campaign', 'Spend', 'Impressions', 'Link Clicks'],
  ['US', 'Traffic campaign', '80', '10000', '200']
);
const b2bTrafficTotals = sumAds([b2bTraffic]);
assert.equal(b2bTrafficTotals.ctr, 0.02);
assert.equal(b2bTrafficTotals.cpc, 0.4);
assert.equal(b2bTrafficTotals.cpl, null);
assert.equal(b2bTraffic.availableMetrics.results, false);

// B2B: direct CTR + CPC fields are valid even without Spend or Impressions.
const b2bDirectRates = parse(
  ['Campaign', 'CTR', 'CPC'],
  ['Direct rates', '1.5%', '2.40']
);
const b2bDirectTotals = sumAds([b2bDirectRates]);
assert.equal(b2bDirectTotals.ctr, 0.015);
assert.equal(b2bDirectTotals.cpc, 2.4);
assert.equal(b2bDirectTotals.spend, 0);
assert.equal(b2bDirectTotals.availableMetrics.spend, false);

// B2C: Spend + Purchases derives CPA, while revenue-dependent metrics stay missing.
const b2cPurchases = parse(
  ['Date', 'Campaign', 'Spend', 'Purchases'],
  ['2026-08-10', 'Purchase campaign', '100', '4'],
  'b2c-purchases.csv'
);
const b2cPurchasesTotals = commerceTotals([b2cPurchases]);
assert.equal(b2cPurchasesTotals.cpa, 25);
assert.equal(b2cPurchasesTotals.aov, null);
assert.equal(b2cPurchasesTotals.roas, null);
assert.equal(b2cPurchasesTotals.availableMetrics.metaAttributedGmv, false);

// B2C: adding Meta attributed GMV enables AOV and ROAS.
const b2cRevenue = parse(
  ['Spend', 'Purchases', 'Meta Attributed GMV'],
  ['100', '4', '300'],
  'b2c-revenue.csv'
);
const b2cRevenueTotals = commerceTotals([b2cRevenue]);
assert.equal(b2cRevenueTotals.cpa, 25);
assert.equal(b2cRevenueTotals.aov, 75);
assert.equal(b2cRevenueTotals.roas, 3);

// B2C: funnel-only data is useful without Spend.
const b2cFunnel = parse(
  ['Link Clicks', 'Landing Page Views', 'Add to Cart', 'Initiate Checkout', 'Purchases'],
  ['200', '160', '24', '12', '5'],
  'b2c-funnel.csv'
);
const b2cFunnelTotals = commerceTotals([b2cFunnel]);
assert.equal(b2cFunnelTotals.lpvRate, 0.8);
assert.equal(b2cFunnelTotals.atcRate, 0.15);
assert.equal(b2cFunnelTotals.checkoutRate, 0.5);
assert.equal(b2cFunnelTotals.checkoutCompletionRate, 5 / 12);
assert.equal(b2cFunnelTotals.purchaseCvr, 0.025);
assert.equal(b2cFunnelTotals.cpa, null);

// B2C: CTR + CPC can import without triggering missing Purchase / ROAS / CPA rules.
const b2cRates = parse(
  ['Spend', 'CTR', 'CPC'],
  ['50', '2%', '1.25'],
  'b2c-rates.csv'
);
const b2cRateTotals = commerceTotals([b2cRates]);
assert.equal(b2cRateTotals.ctr, 0.02);
assert.equal(b2cRateTotals.cpc, 1.25);
assert.equal(b2cRateTotals.cpa, null);
assert.equal(b2cRateTotals.roas, null);
const b2cRateDiagnosis = commerceDiagnostics([b2cRates], rules)[0].d;
assert.notEqual(b2cRateDiagnosis.category, 'noPurchase');
assert.notEqual(b2cRateDiagnosis.category, 'roas');
assert.notEqual(b2cRateDiagnosis.category, 'cpa');

// A completely unknown header remains invalid.
assert.deepEqual(parseAdRows([['Unrelated column'], ['anything']], 'unknown.csv', 'Sheet1'), []);

// An explicit numeric zero is not the same as a missing Purchase field.
const explicitZeroRows = parseAdRows([
  ['Date', 'Campaign', 'Spend', 'Purchases'],
  ['2026-08-09', 'No purchase', '30', '0'],
  ['2026-08-10', 'No purchase', '30', '0']
], 'explicit-zero.csv', 'Sheet1');
assert.equal(explicitZeroRows.length, 2);
assert.equal(explicitZeroRows[0].purchases, 0);
assert.equal(explicitZeroRows[0].availableMetrics.purchases, true);
const explicitZeroDiagnosis = commerceDiagnostics(explicitZeroRows, rules)[0].d;
assert.equal(explicitZeroDiagnosis.category, 'noPurchase');
assert.equal(explicitZeroDiagnosis.stopCandidate, true);
assert.equal(explicitZeroDiagnosis.level, 'extreme');

console.log('partial import tests passed');

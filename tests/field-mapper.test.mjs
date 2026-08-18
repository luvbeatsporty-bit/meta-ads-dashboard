import assert from 'node:assert/strict';
import { normalizeHeader, resolveMetric, buildHeaderMapping, applyMappingOverrides, groupMappingForDisplay } from '../field-mapper.js';
import { parseAdRows } from '../excel-import.js';

function maps(header, metric, internalKey) {
  const result = resolveMetric(header);
  assert.equal(result.canonicalMetric, metric, `${header} should map to ${metric}`);
  assert.equal(result.status, 'confirmed', `${header} should be confirmed`);
  if (internalKey) assert.equal(result.internalKey, internalKey, `${header} should use legacy key ${internalKey}`);
}

['Spend', 'Spend_USD', 'SPEND', 'Amount Spent', '广告花费', '广告消耗', 'Dépenses', 'Ausgaben', 'Gasto'].forEach(header => maps(header, 'spend', 'spend'));
maps('Link_Clicks', 'linkClicks', 'clicks');
maps('Landing_Page_Views', 'landingPageViews', 'landingPageViews');
maps('Meta_Attributed_GMV_USD', 'metaAttributedGmv', 'metaAttributedGmv');
maps('Purchase_ROAS', 'purchaseRoas', 'roas');
maps('Ad_Set', 'adSet', 'adSet');
maps('Ad_Name', 'ad', 'ad');
maps('Creative_Type', 'creativeType', 'creativeType');
maps('广告花费（美元）', 'spend', 'spend');
maps('已花费金额 (USD)', 'spend', 'spend');
maps('Meta 归因销售额（USD）', 'metaAttributedGmv', 'metaAttributedGmv');
assert.equal(normalizeHeader(' Amount Spent（USD） '), 'amount spent');
assert.equal(normalizeHeader('展示次数'), '展示');

const ambiguous = resolveMetric('Results');
assert.equal(ambiguous.status, 'needs_confirmation', 'unqualified Results must not default to Leads');
assert.deepEqual(ambiguous.candidates, ['leads', 'purchases']);
const contextual = resolveMetric('Results', { headers: ['Results', 'Result Type'], sampleRows: [[3, 'Leads']] });
assert.equal(contextual.canonicalMetric, 'leads', 'Result Type must resolve Results as Leads');
assert.equal(contextual.internalKey, 'results');
const purchaseContextual = resolveMetric('Results', { headers: ['Results', 'Result Type'], sampleRows: [[3, 'Purchases']] });
assert.equal(purchaseContextual.canonicalMetric, 'purchases', 'Result Type must resolve Results as Purchases');
assert.equal(resolveMetric('Results', { headers: ['Results', 'Result Type'], sampleRows: [[3, 'Leads'], [2, 'Purchases']] }).status, 'needs_confirmation', 'mixed Result Type values must remain ambiguous');
assert.equal(resolveMetric('Results (Purchases)').canonicalMetric, 'purchases', 'explicit Results qualifier must map to Purchases');
assert.equal(resolveMetric('Checkout Count').status, 'needs_confirmation', 'unit suffix must not hide Checkout ambiguity');
assert.equal(resolveMetric('Views 7d').status, 'needs_confirmation', 'reporting-window suffix must not hide Views ambiguity');

const mapping = buildHeaderMapping(['Spend_USD', 'Results', 'Ad_Set']);
const resultField = mapping.find(item => item.sourceHeader === 'Results');
const overridden = applyMappingOverrides(mapping, { [resultField.id]: 'purchases' });
assert.equal(overridden.find(item => item.sourceHeader === 'Results').internalKey, 'purchases');

const rows = parseAdRows([
  ['Spend_USD', 'Link_Clicks', 'Landing_Page_Views', 'Add_to_Cart', 'Initiate_Checkout', 'Purchases', 'Meta_Attributed_GMV_USD', 'Ad_Set', 'Ad_Name', 'Creative_Type'],
  ['120', '240', '200', '45', '20', '0', '0', 'Prospecting', 'Video A', 'Video']
]);
assert.equal(rows.length, 1, 'semantic B2C headers must parse');
assert.equal(rows[0].spend, 120);
assert.equal(rows[0].clicks, 240);
assert.equal(rows[0].landingPageViews, 200);
assert.equal(rows[0].purchases, 0, 'explicit zero must be preserved');
assert.equal(rows[0].availableMetrics.purchases, true, 'explicit zero is available, not missing');
assert.equal(rows[0].adSet, 'Prospecting');
assert.equal(rows[0].creativeType, 'Video');
assert.deepEqual(parseAdRows([['Internal Tag'], ['x']]), [], 'unknown fields should not block valid fields but cannot import alone');

console.log('field mapper tests passed');

// Strong metric tokens with descriptive suffixes auto-confirm.
for (const [header, metric] of [
  ['CPM（千次展示费用）', 'cpm'],
  ['CPC（单次点击费用）', 'cpc'],
  ['CTR（点击率）', 'ctr'],
  ['Frequency（频次）', 'frequency'],
  ['Reach（覆盖人数）', 'reach'],
  ['Spend_USD', 'spend'],
  ['Purchase_ROAS', 'purchaseRoas'],
  ['AOV（平均订单价值）', 'aov']
]) {
  const result = resolveMetric(header);
  assert.equal(result.canonicalMetric, metric, `${header} should strongly map to ${metric}`);
  assert.equal(result.status, 'confirmed', `${header} should not need confirmation`);
  assert.ok(['exact_alias', 'normalized_alias', 'strong_token'].includes(result.matchType), `${header} should use a high-confidence matcher`);
}

// Supporting metadata and optional cost columns are unused, not ambiguous.
for (const header of ['Country Code', 'Campaign Type', 'Week Label', 'Internal ID', 'Cost per LPV']) {
  const result = resolveMetric(header);
  assert.equal(result.status, 'unused', `${header} should be unused`);
  assert.notEqual(result.matchType, 'ambiguous', `${header} should not require confirmation`);
}

// A generic Results field remains ambiguous, while contextual Results resolves automatically.
assert.equal(resolveMetric('Results').status, 'needs_confirmation');
assert.equal(resolveMetric('Results', { headers: ['Results', 'Result Type'], sampleRows: [[3, 'Leads']] }).canonicalMetric, 'leads');
assert.equal(resolveMetric('Results', { headers: ['Results', 'Result Type'], sampleRows: [[3, 'Purchases']] }).canonicalMetric, 'purchases');

// User-confirmed mappings can be remembered per B2B/B2C scope by the caller.
assert.equal(resolveMetric('Inquiry Count', { customMappings: { inquiry: 'leads' } }).canonicalMetric, 'leads');
assert.equal(resolveMetric('Inquiry Count', { customMappings: { inquiry: 'leads' } }).matchType, 'remembered_mapping');

// Duplicate columns are imported once, and the display model collapses rows
// with the same canonical metric/source header across sheets.
const duplicateMapping = buildHeaderMapping(['CPM（千次展示费用）', 'CPM（千次展示费用）'], { sheetId: 'sheet-1' });
assert.equal(duplicateMapping.filter(item => item.status === 'confirmed').length, 1);
assert.equal(duplicateMapping.filter(item => item.matchType === 'duplicate').length, 1);
const grouped = groupMappingForDisplay([
  { ...duplicateMapping[0], sheetName: 'A' },
  { ...duplicateMapping[1], sheetName: 'A' },
  { ...resolveMetric('CPM_USD'), id: 'sheet-2:0', sheetName: 'B' }
], 'confirmed');
assert.equal(grouped.length, 1);
assert.deepEqual(grouped[0].sourceHeaders, ['CPM（千次展示费用）', 'CPM_USD']);
const groupedUnused = groupMappingForDisplay([
  { ...duplicateMapping[1], sheetName: 'A' }
], 'unused');
assert.equal(groupedUnused.length, 0, 'duplicate columns should not be shown as a second unused field');

console.log('field mapper confirmation tests passed');

// Result-cost fields require context, but resolve automatically when Result Type is supplied.
assert.equal(resolveMetric('Cost per Result').status, 'needs_confirmation');
assert.equal(resolveMetric('单次成效费用').status, 'needs_confirmation');
assert.equal(resolveMetric('Cost per Result', { headers: ['Cost per Result', 'Result Type'], sampleRows: [[20, 'Leads']] }).canonicalMetric, 'cpl');
assert.equal(resolveMetric('Cost per Result', { headers: ['Cost per Result', 'Result Type'], sampleRows: [[20, 'Purchases']] }).canonicalMetric, 'cpa');
assert.equal(resolveMetric('Revenue').status, 'needs_confirmation');
assert.equal(resolveMetric('Conversion').status, 'needs_confirmation');

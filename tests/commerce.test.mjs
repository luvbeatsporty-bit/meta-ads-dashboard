import assert from 'node:assert/strict';
import { extractMetaConversions } from '../commerce-mapping.js';
import { commerceDimensionGroups, commerceTotals, commerceTrend, safeDivide } from '../commerce-metrics.js';
import { buildCommerceAdviceClusters, buildLayeredRecommendation, commerceDiagnostics, derivePrimaryDiagnosis, deriveSuggestedAction, diagnoseCommerceGroup } from '../commerce-diagnosis.js';
import { DEFAULT_COMMERCE_RULES } from '../data-model.js';

const rules = {
  ...DEFAULT_COMMERCE_RULES,
  frequencyWarningThreshold: 2.5,
  frequencyHighRiskThreshold: 4,
  watchCtrPercent: 0.8
};

function row(overrides = {}) {
  return {
    country: 'US', campaign: 'Test Campaign', dateStart: '2026-08-10', dateEnd: '2026-08-10',
    spend: 100, impressions: 10000, reach: 4000, frequency: 2.0, clicks: 200,
    landingPageViews: 160, addToCart: 24, initiateCheckout: 12, purchases: 5, metaAttributedGmv: 300,
    ...overrides
  };
}

assert.equal(safeDivide(1, 0), null, 'zero denominator must not produce Infinity');
assert.equal(safeDivide(0, 10), 0);

const totals = commerceTotals([row()]);
assert.equal(totals.lpvRate, 0.8);
assert.equal(totals.atcRate, 0.15);
assert.equal(totals.checkoutRate, 0.5);
assert.equal(totals.checkoutCompletionRate, 5 / 12);
assert.equal(totals.purchaseCvr, 0.025);
assert.equal(totals.cpa, 20);
assert.equal(totals.aov, 60);
assert.equal(totals.roas, 3);

assert.deepEqual(
  extractMetaConversions({
    sourceRaw: {
      actions: JSON.stringify([
        { action_type: 'omni_landing_page_view', value: '90' },
        { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '18' },
        { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: '12' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '8' }
      ]),
      action_values: JSON.stringify([{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '320' }])
    }
  }),
  { landingPageViews: 90, addToCart: 18, initiateCheckout: 12, purchases: 8, metaAttributedGmv: 320 },
  'actions and action_values must map purchase counts and attributed revenue separately'
);

const excellent = commerceDiagnostics([row()], rules)[0].d;
assert.equal(excellent.level, 'excellent', 'ROAS at target must be excellent');

const watchRoas = commerceDiagnostics([row({ metaAttributedGmv: 240 })], rules)[0].d;
assert.equal(watchRoas.level, 'watch', 'ROAS at 80% of target must be watch');

const lowRoas = commerceDiagnostics([row({ metaAttributedGmv: 150 })], rules)[0].d;
assert.equal(lowRoas.level, 'high', 'ROAS below 60% of target with sufficient spend must be high risk');

const noPurchaseGroup = {
  id: 'No Purchase|US', rows: [
    row({ campaign: 'No Purchase', dateStart: '2026-08-09', dateEnd: '2026-08-09', spend: 30, purchases: 0, metaAttributedGmv: 0 }),
    row({ campaign: 'No Purchase', dateStart: '2026-08-10', dateEnd: '2026-08-10', spend: 30, purchases: 0, metaAttributedGmv: 0 })
  ],
  spend: 60, impressions: 20000, reach: 8000, linkClicks: 400, landingPageViews: 300, addToCart: 20, initiateCheckout: 10,
  purchases: 0, metaAttributedGmv: 0, cpa: null, roas: 0, ctr: 0.02, dayCount: 2
};
const noPurchaseCandidate = diagnoseCommerceGroup(noPurchaseGroup, rules);
assert.equal(noPurchaseCandidate.level, 'extreme', 'no purchase spend at 3× CPA must be an extreme-risk manual stop candidate');
assert.equal(noPurchaseCandidate.stopCandidate, true, 'no-purchase commercial result must mark a stop candidate');
assert.equal(noPurchaseCandidate.autoStopCandidate, false, 'B2C candidates must never request automatic Meta pauses');
assert.match(noPurchaseCandidate.label, /关停候选/, 'stop candidates must have the manual-review label');

const highCpaCandidateGroup = {
  ...noPurchaseGroup,
  id: 'High CPA|US',
  rows: [
    row({ campaign: 'High CPA', dateStart: '2026-08-09', dateEnd: '2026-08-09', spend: 120, purchases: 3, metaAttributedGmv: 240 }),
    row({ campaign: 'High CPA', dateStart: '2026-08-10', dateEnd: '2026-08-10', spend: 120, purchases: 3, metaAttributedGmv: 240 })
  ],
  spend: 240, purchases: 6, metaAttributedGmv: 480, cpa: 40, roas: 2, dayCount: 2
};
const highCpaCandidate = diagnoseCommerceGroup(highCpaCandidateGroup, rules);
assert.equal(highCpaCandidate.stopCandidate, true, 'CPA at 2× target with enough purchases must be a stop candidate');
assert.equal(highCpaCandidate.autoStopCandidate, false, 'high CPA candidates must remain manual only');
assert.equal(highCpaCandidate.category, 'cpa', 'high CPA candidate must retain the commercial trigger type');

const lowRoasCandidateGroup = {
  ...noPurchaseGroup,
  id: 'Low ROAS|US',
  rows: [
    row({ campaign: 'Low ROAS', dateStart: '2026-08-09', dateEnd: '2026-08-09', spend: 120, purchases: 2, metaAttributedGmv: 48 }),
    row({ campaign: 'Low ROAS', dateStart: '2026-08-10', dateEnd: '2026-08-10', spend: 120, purchases: 2, metaAttributedGmv: 48 })
  ],
  spend: 240, purchases: 4, metaAttributedGmv: 96, cpa: 60, roas: 0.4, dayCount: 2
};
const lowRoasCandidate = diagnoseCommerceGroup(lowRoasCandidateGroup, rules);
assert.equal(lowRoasCandidate.stopCandidate, true, 'ROAS below 0.5× target with enough purchases must be a stop candidate');
assert.equal(lowRoasCandidate.autoStopCandidate, false, 'low ROAS candidates must remain manual only');
assert.equal(lowRoasCandidate.category, 'roas', 'low ROAS candidate must retain the commercial trigger type');

const frequencyOnlyGroup = {
  ...noPurchaseGroup,
  id: 'High Frequency|US',
  purchases: 4, metaAttributedGmv: 240, spend: 80, cpa: 20, roas: 3,
  rows: [
    row({ campaign: 'High Frequency', dateStart: '2026-08-09', dateEnd: '2026-08-09', spend: 40, frequency: 4.2, purchases: 2, metaAttributedGmv: 120 }),
    row({ campaign: 'High Frequency', dateStart: '2026-08-10', dateEnd: '2026-08-10', spend: 40, frequency: 4.2, purchases: 2, metaAttributedGmv: 120 })
  ],
  dayCount: 2
};
const frequencyOnlyDiagnosis = diagnoseCommerceGroup(frequencyOnlyGroup, rules);
assert.notEqual(frequencyOnlyDiagnosis.level, 'extreme', 'frequency must never independently create a stop candidate');
assert.equal(frequencyOnlyDiagnosis.stopCandidate, false, 'frequency alone must not create a manual stop candidate');
assert.equal(frequencyOnlyDiagnosis.autoStopCandidate, false, 'frequency alone must never request an automatic Meta pause');

const frequencyNormalGroup = {
  ...frequencyOnlyGroup,
  rows: frequencyOnlyGroup.rows.map(item => ({ ...item, frequency: 2.4 }))
};
assert.equal(diagnoseCommerceGroup(frequencyNormalGroup, rules).level, 'excellent', 'frequency below the warning threshold must not downgrade healthy commercial results');

const frequencyWatchGroup = {
  ...frequencyOnlyGroup,
  rows: frequencyOnlyGroup.rows.map(item => ({ ...item, frequency: 2.5 }))
};
assert.equal(diagnoseCommerceGroup(frequencyWatchGroup, rules).level, 'watch', 'frequency at the warning threshold must create a watch reminder');

const frequencyHighGroup = {
  ...frequencyOnlyGroup,
  rows: frequencyOnlyGroup.rows.map(item => ({ ...item, frequency: 4.0 }))
};
assert.equal(diagnoseCommerceGroup(frequencyHighGroup, rules).level, 'high', 'frequency at the high-risk threshold must create a high-risk reminder');
assert.notEqual(diagnoseCommerceGroup(frequencyHighGroup, rules, 2).level, 'extreme', 'high frequency must never independently create an auto-stop candidate');

function trendRows({ ctrMultiplier = 1, cpaMultiplier = 1, roasMultiplier = 1 } = {}) {
  return [
    ...[0, 1, 2].map(offset => row({ dateStart: `2026-08-0${5 + offset}`, dateEnd: `2026-08-0${5 + offset}`, frequency: 4, spend: 30, impressions: 1000, clicks: 30, purchases: 3, metaAttributedGmv: 90 })),
    ...[0, 1, 2].map(offset => {
      const clicks = Math.round(30 * ctrMultiplier);
      const purchases = cpaMultiplier > 1 ? Math.max(1, Math.round(3 / cpaMultiplier)) : 3;
      return row({ dateStart: `2026-08-0${8 + offset}`, dateEnd: `2026-08-0${8 + offset}`, frequency: 4, spend: 30, impressions: 1000, clicks, purchases, metaAttributedGmv: 90 * roasMultiplier });
    })
  ];
}

const ctrFatigue = diagnoseCommerceGroup({ ...frequencyHighGroup, rows: trendRows({ ctrMultiplier: 0.7 }) }, rules);
assert.equal(ctrFatigue.category, 'creativeFatigue', 'high frequency plus a CTR decline must flag creative fatigue');

const cpaFatigue = diagnoseCommerceGroup({ ...frequencyHighGroup, rows: trendRows({ cpaMultiplier: 1.5 }) }, rules);
assert.equal(cpaFatigue.category, 'creativeFatigue', 'high frequency plus a CPA increase must flag creative fatigue');

const roasFatigue = diagnoseCommerceGroup({ ...frequencyHighGroup, rows: trendRows({ roasMultiplier: 0.7 }) }, rules);
assert.equal(roasFatigue.category, 'creativeFatigue', 'high frequency plus a ROAS decline must flag creative fatigue');

const stopPrimary = derivePrimaryDiagnosis({ stopCandidate: true, signals: [{ category: 'roas', level: 'high' }, { category: 'frequency', level: 'high' }] });
assert.equal(stopPrimary.key, 'stopCandidate', 'a manual stop candidate must always be the primary diagnosis');
const noPurchasePrimary = derivePrimaryDiagnosis({ signals: [{ category: 'noPurchase', level: 'high' }, { category: 'roas', level: 'high' }] });
assert.equal(noPurchasePrimary.key, 'noPurchase', 'no-purchase high spend must outrank an ordinary low-ROAS diagnosis');
const roasPrimary = derivePrimaryDiagnosis({ signals: [{ category: 'roas', level: 'high' }, { category: 'frequency', level: 'high' }] });
assert.equal(roasPrimary.key, 'roasSevere', 'severe ROAS loss must outrank a frequency reminder');
assert.equal(deriveSuggestedAction({ primaryDiagnosis: { key: 'roasSevere' } }, 'country'), '建议调整 Campaign 预算', 'country actions must focus on country-level allocation');
assert.equal(deriveSuggestedAction({ primaryDiagnosis: { key: 'roasSevere' } }, 'campaign'), '建议检查 Ad Set', 'campaign actions must focus on internal Ad Set efficiency');
assert.equal(deriveSuggestedAction({ primaryDiagnosis: { key: 'creativeFatigue' } }, 'creative'), '建议更换素材', 'creative actions must focus on refreshing creative');
assert.match(buildLayeredRecommendation({ diagnosis: { primaryDiagnosis: { key: 'checkoutCompletion', label: 'Checkout Completion 异常' } }, scope: 'funnel' }).fullRecommendation, /支付/, 'funnel recommendations must provide funnel-specific diagnosis copy');

const clusterDiagnosis = (key, label, level, extra = {}) => ({
  level, label: level === 'extreme' ? '极高风险 · 关停候选' : level === 'high' ? '高风险' : level === 'watch' ? '观察' : '优秀',
  category: extra.category || (key === 'stopCandidate' ? 'noPurchase' : key === 'roasSevere' ? 'roas' : key === 'cpaSevere' ? 'cpa' : key),
  categories: extra.categories || [extra.category || key],
  rule: extra.rule || `${label} 测试规则`,
  advice: extra.advice || `${label} 完整建议`,
  stopCandidate: Boolean(extra.stopCandidate),
  primaryDiagnosis: { key, label }
});
const clusteredDiagnostics = [
  { campaign: 'Stop Campaign', country: 'US', ad: 'Stop Ad', spend: 30, purchases: 0, metaAttributedGmv: 0, cpa: null, roas: 0, d: clusterDiagnosis('stopCandidate', '关停候选', 'extreme', { stopCandidate: true }) },
  { campaign: 'Low ROAS A', country: 'US', ad: 'Low ROAS Ad A', spend: 120, purchases: 2, metaAttributedGmv: 60, cpa: 60, roas: .5, d: clusterDiagnosis('roasSevere', 'ROAS 严重偏低', 'high') },
  { campaign: 'Low ROAS B', country: 'CA', ad: 'Low ROAS Ad B', spend: 80, purchases: 1, metaAttributedGmv: 40, cpa: 80, roas: .5, d: clusterDiagnosis('roasSevere', 'ROAS 严重偏低', 'high') },
  { campaign: 'Checkout Campaign', country: 'UK', ad: 'Checkout Ad', spend: 50, purchases: 1, metaAttributedGmv: 70, cpa: 50, roas: 1.4, d: clusterDiagnosis('checkoutCompletion', 'Checkout Completion 异常', 'high', { category: 'checkout' }) }
];
const clustered = buildCommerceAdviceClusters(clusteredDiagnostics, rules);
assert.equal(clustered[0].primaryDiagnosis.key, 'stopCandidate', 'stop candidates must sort before every other problem cluster');
const roasCluster = clustered.find(item => item.primaryDiagnosis.key === 'roasSevere');
assert.equal(roasCluster.affectedAds, 2, 'same primary diagnosis rows must de-duplicate into one cluster');
assert.equal(roasCluster.affectedSpend, 200, 'affected spend must add all rows in the same diagnosis cluster');
assert.equal(roasCluster.affectedCampaigns, 2, 'clusters must preserve affected campaign counts');
assert.equal(roasCluster.affectedObjects[0].ad, 'Low ROAS Ad A', 'cluster detail payload must retain the affected Ad');
assert.match(roasCluster.fullRecommendation, /高花费低回报/, 'cluster retains a full recommendation for the detail modal');


const listItems = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));
const { getCommerceDetail, hasMoreListItems, renderCommerceAdvice, renderCommerceAnalysisModules, visibleDetailItems, visibleListItems } = await import('../commerce-ui.js');
assert.equal(visibleListItems(listItems, false).length, 5, 'collapsed commerce lists must use the default limit');
assert.equal(visibleListItems(listItems, true).length, 10, 'expanded commerce lists must expose all available records');
assert.equal(visibleDetailItems(listItems, 5).length, 5, 'collapsed commerce detail tables must use the default limit');
assert.equal(visibleDetailItems(listItems, 50).length, 10, 'a detail-table load-more action must expose all available records when fewer than fifty exist');
assert.equal(hasMoreListItems(listItems), true, 'a toggle should only be available when more than five records exist');
assert.equal(hasMoreListItems(listItems.slice(0, 5)), false, 'a five-row list must not render a no-op toggle');

const dimensionRows = Array.from({ length: 10 }, (_, index) => row({
  campaign: `Campaign ${index + 1}`,
  creative: `Creative ${index + 1}`,
  creativeType: index % 2 ? 'Video' : 'Image',
  country: `C${index + 1}`,
  dateStart: '2026-08-10',
  dateEnd: '2026-08-10',
  spend: index + 10,
  purchases: index + 1,
  metaAttributedGmv: (index + 1) * 30
}));
assert.equal(commerceDimensionGroups(dimensionRows, 'country').length, 10, 'country analysis must retain every country group');
assert.equal(commerceDimensionGroups(dimensionRows, 'campaign').length, 10, 'campaign analysis must retain every campaign group');
assert.equal(commerceDimensionGroups(dimensionRows, 'creative').length, 10, 'creative analysis must retain every creative group');

const trend = commerceTrend([
  row({ dateStart: '2026-08-09', dateEnd: '2026-08-09', spend: 40, purchases: 2, metaAttributedGmv: 120 }),
  row({ dateStart: '2026-08-10', dateEnd: '2026-08-10', spend: 60, purchases: 3, metaAttributedGmv: 240 }),
  row({ dateStart: '2026-08-10', dateEnd: '2026-08-10', spend: 40, purchases: 1, metaAttributedGmv: 40 })
], 'roas');
assert.equal(trend.length, 2, 'trend data must aggregate rows by report date');
assert.equal(trend[1].value, 2.8, 'daily ROAS must use that date’s aggregated GMV and spend');


const createHost = () => ({ innerHTML: '' });
const analysisHostIds = [
  'b2cAdviceList', 'b2cAdviceToggle', 'b2cRiskDistribution',
  'b2cCountryTable', 'b2cCountryToggle', 'b2cCampaignTable', 'b2cCampaignToggle',
  'b2cCreativeTable', 'b2cCreativeToggle', 'b2cRiskTable', 'b2cRiskTableToggle'
];
const analysisHosts = new Map(analysisHostIds.map(id => [id, createHost()]));
const originalDocument = globalThis.document;
globalThis.document = { getElementById: id => analysisHosts.get(id) || null };

const renderDiagnostics = dimensionRows.map((item, index) => ({
  id: `${item.campaign}|${item.country}`,
  campaign: item.campaign,
  country: item.country,
  d: {
    level: index % 2 ? 'watch' : 'high',
    label: index % 2 ? '观察' : '高风险',
    rule: '测试规则',
    advice: `测试建议 ${index + 1}`,
    category: 'creative',
    categories: ['creative']
  }
}));

renderCommerceAnalysisModules({
  rows: dimensionRows,
  diagnostics: renderDiagnostics,
  expandedLists: { countries: false, campaigns: false, creatives: false, risks: false },
  riskVisibleCount: 5,
  riskFilter: 'all',
  sort: { countries: 'spend', campaigns: 'spend', creatives: 'spend' }
});
assert.equal((analysisHosts.get('b2cCountryTable').innerHTML.match(/<tr>/g) || []).length, 6, 'collapsed country table must render five rows plus the header');
assert.match(analysisHosts.get('b2cCountryToggle').innerHTML, /展开全部/, 'country table must expose a real expansion toggle when more than five rows exist');
assert.equal((analysisHosts.get('b2cCampaignTable').innerHTML.match(/<tr>/g) || []).length, 6, 'collapsed campaign table must render five rows plus the header');
assert.equal((analysisHosts.get('b2cCreativeTable').innerHTML.match(/<tr>/g) || []).length, 6, 'collapsed creative table must render five rows plus the header');
assert.equal((analysisHosts.get('b2cRiskTable').innerHTML.match(/<tr>/g) || []).length, 5, 'collapsed risk tbody must render five data rows only');
assert.doesNotMatch(analysisHosts.get('b2cRiskTable').innerHTML, /<thead>/, 'risk tbody must not contain a duplicate header');

renderCommerceAnalysisModules({
  rows: dimensionRows,
  diagnostics: renderDiagnostics,
  expandedLists: { countries: true, campaigns: true, creatives: true, risks: true },
  riskVisibleCount: 10,
  riskFilter: 'all',
  sort: { countries: 'spend', campaigns: 'spend', creatives: 'spend' }
});
assert.equal((analysisHosts.get('b2cCountryTable').innerHTML.match(/<tr>/g) || []).length, 11, 'expanded country table must render all ten rows plus the header');
assert.equal((analysisHosts.get('b2cCampaignTable').innerHTML.match(/<tr>/g) || []).length, 11, 'expanded campaign table must render all ten rows plus the header');
assert.equal((analysisHosts.get('b2cCreativeTable').innerHTML.match(/<tr>/g) || []).length, 11, 'expanded creative table must render all ten rows plus the header');
assert.equal((analysisHosts.get('b2cRiskTable').innerHTML.match(/<tr>/g) || []).length, 10, 'expanded risk tbody must render all ten data rows only');
assert.match(analysisHosts.get('b2cCountryToggle').innerHTML, /收起/, 'expanded country toggle must switch its label to collapse');

const detailRows = Array.from({ length: 60 }, (_, index) => row({
  campaign: `Detail Campaign ${index + 1}`,
  country: `D${index + 1}`,
  creative: `Detail Creative ${index + 1}`,
  spend: index + 10,
  purchases: 1,
  metaAttributedGmv: 30
}));
const detailDiagnostics = detailRows.map(item => ({
  id: `${item.campaign}|${item.country}`,
  campaign: item.campaign,
  country: item.country,
  d: { level: 'watch', label: '观察', rule: '测试规则', advice: '测试建议', category: 'creative', categories: ['creative'] }
}));
renderCommerceAnalysisModules({
  rows: detailRows,
  diagnostics: detailDiagnostics,
  expandedLists: {},
  riskVisibleCount: 5,
  riskFilter: 'all',
  sort: {}
});
assert.equal((analysisHosts.get('b2cRiskTable').innerHTML.match(/<tr>/g) || []).length, 5, 'collapsed detail tbody must render five data rows only');
assert.match(analysisHosts.get('b2cRiskTableToggle').innerHTML, /展开更多广告明细/, 'collapsed detail table must offer a load-more action');
renderCommerceAnalysisModules({
  rows: detailRows,
  diagnostics: detailDiagnostics,
  expandedLists: {},
  riskVisibleCount: 50,
  riskFilter: 'all',
  sort: {}
});
assert.equal((analysisHosts.get('b2cRiskTable').innerHTML.match(/<tr>/g) || []).length, 50, 'first detail-table load-more action must render fifty data rows only');
assert.match(analysisHosts.get('b2cRiskTableToggle').innerHTML, /继续加载更多（已显示 50 \/ 60）/, 'detail table must expose its current incremental progress');
renderCommerceAnalysisModules({
  rows: detailRows,
  diagnostics: detailDiagnostics,
  expandedLists: {},
  riskVisibleCount: 60,
  riskFilter: 'all',
  sort: {}
});
assert.equal((analysisHosts.get('b2cRiskTable').innerHTML.match(/<tr>/g) || []).length, 60, 'detail tbody must render every data row only after explicit continued loading');
assert.match(analysisHosts.get('b2cRiskTableToggle').innerHTML, /收起，仅显示前 5 条/, 'fully loaded detail table must expose a collapse action');

assert.match(analysisHosts.get('b2cCountryTable').innerHTML, /Diagnosis/, 'country tables must use compact diagnosis columns');
assert.match(analysisHosts.get('b2cCountryTable').innerHTML, /Suggested Action/, 'country tables must use a short suggested-action column');
assert.match(analysisHosts.get('b2cCountryTable').innerHTML, /Details/, 'country tables must use a reusable detail link');
assert.doesNotMatch(analysisHosts.get('b2cCountryTable').innerHTML, /AI Recommendation/, 'country tables must not render the old long recommendation header');
assert.doesNotMatch(analysisHosts.get('b2cCountryTable').innerHTML, /测试建议 1/, 'country tables must not repeat long row-level AI copy');

renderCommerceAdvice(renderDiagnostics, false, rules);
assert.equal((analysisHosts.get('b2cAdviceList').innerHTML.match(/class="advice-card/g) || []).length, 1, 'identical row-level issues must collapse into one AI problem cluster');
assert.equal(analysisHosts.get('b2cAdviceToggle').innerHTML, '', 'a single issue cluster must not show an unnecessary expansion toggle');

const adviceClusterDiagnostics = [
  ...clusteredDiagnostics,
  { campaign: 'CPA Campaign', country: 'DE', ad: 'CPA Ad', spend: 90, purchases: 1, metaAttributedGmv: 45, cpa: 90, roas: .5, d: clusterDiagnosis('cpaSevere', 'CPA 严重偏高', 'high') },
  { campaign: 'Product Campaign', country: 'FR', ad: 'Product Ad', spend: 80, purchases: 1, metaAttributedGmv: 90, cpa: 80, roas: 1.125, d: clusterDiagnosis('productPage', 'ATC / 商品页问题', 'high', { category: 'productPage' }) },
  { campaign: 'Landing Campaign', country: 'AU', ad: 'Landing Ad', spend: 70, purchases: 1, metaAttributedGmv: 100, cpa: 70, roas: 1.43, d: clusterDiagnosis('landingPage', 'LPV / Landing Page 问题', 'watch', { category: 'landingPage' }) },
  { campaign: 'Creative Campaign', country: 'JP', ad: 'Creative Ad', spend: 60, purchases: 2, metaAttributedGmv: 220, cpa: 30, roas: 3.67, d: clusterDiagnosis('creativeFatigue', '素材疲劳', 'watch', { category: 'creativeFatigue' }) },
  { campaign: 'Excellent Campaign', country: 'SG', ad: 'Excellent Ad', spend: 55, purchases: 4, metaAttributedGmv: 220, cpa: 13.75, roas: 4, d: clusterDiagnosis('excellent', '表现优秀，可扩量', 'excellent', { category: 'roas' }) }
];
renderCommerceAdvice(adviceClusterDiagnostics, false, rules);
assert.equal((analysisHosts.get('b2cAdviceList').innerHTML.match(/class="advice-card/g) || []).length, 5, 'collapsed advice must show at most five issue clusters');
assert.match(analysisHosts.get('b2cAdviceToggle').innerHTML, /查看全部问题/, 'more than five issue clusters must expose a compact expansion toggle');
assert.ok(analysisHosts.get('b2cAdviceList').innerHTML.indexOf('关停候选') < analysisHosts.get('b2cAdviceList').innerHTML.indexOf('ROAS 严重偏低'), 'stop candidate cluster must be pinned before ordinary high-risk clusters');
const detailId = analysisHosts.get('b2cAdviceList').innerHTML.match(/data-commerce-detail-id="([^"]+)"/)?.[1];
const clusterDetail = getCommerceDetail(detailId);
assert.equal(clusterDetail.primaryDiagnosis, '关停候选', 'AI cluster details must retain the primary diagnosis');
assert.ok(clusterDetail.affectedObjects.length > 0, 'AI cluster details must retain affected objects for the shared modal');
assert.match(clusterDetail.fullRecommendation, /人工决定暂停/, 'AI cluster details must retain the complete recommendation');
renderCommerceAdvice(adviceClusterDiagnostics, true, rules);
assert.equal((analysisHosts.get('b2cAdviceList').innerHTML.match(/class="advice-card/g) || []).length, 8, 'expanded advice must reveal every issue cluster');
assert.match(analysisHosts.get('b2cAdviceToggle').innerHTML, /收起/, 'expanded advice toggle must switch its label to collapse');

globalThis.document = originalDocument;
console.log('commerce tests passed');

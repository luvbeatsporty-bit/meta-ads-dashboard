import assert from 'node:assert/strict';
import { extractMetaConversions } from '../commerce-mapping.js';
import { commerceTotals, safeDivide } from '../commerce-metrics.js';
import { diagnoseCommerceGroup, commerceDiagnostics } from '../commerce-diagnosis.js';
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
assert.equal(diagnoseCommerceGroup(noPurchaseGroup, rules, 0).level, 'high', 'no purchase spend at 3× CPA is high before consecutive checks');
assert.equal(diagnoseCommerceGroup(noPurchaseGroup, rules, 1).level, 'high', 'one qualifying check is not enough for stop candidacy');
assert.equal(diagnoseCommerceGroup(noPurchaseGroup, rules, 2).level, 'extreme', 'two qualifying checks create a stop candidate');

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
assert.notEqual(diagnoseCommerceGroup(frequencyOnlyGroup, rules, 2).level, 'extreme', 'frequency must never independently create an auto-stop candidate');

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

console.log('commerce tests passed');

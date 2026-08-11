import { DEFAULT_COMMERCE_RULES } from './data-model.js';
import { commerceGroups, recentCommerceComparison } from './commerce-metrics.js';
import { frequencySignals } from './metrics.js';

export const COMMERCE_RISK_ORDER = Object.freeze({ extreme: 0, high: 1, watch: 2, normal: 3, excellent: 4 });
const LEVEL_META = Object.freeze({
  extreme: ['极高风险', '极高风险'], high: ['高风险', '高风险'], watch: ['观察', '需要观察'], normal: ['正常', '正常'], excellent: ['优秀', '表现良好']
});

const RISK_EPSILON = 1e-9;

function signal(level, category, rule, advice) { return { level, category, rule, advice }; }
function below(value, threshold) { return value < threshold - RISK_EPSILON; }
function stronger(one, two) { return COMMERCE_RISK_ORDER[one.level] < COMMERCE_RISK_ORDER[two.level] ? one : two; }

function commercialSignal(metrics, rules, stopHits = 0, dayCount = 0) {
  const targetRoas = rules.targetRoas;
  const targetCpa = rules.targetCpa;
  const noPurchase = metrics.purchases === 0;
  const hasSample = metrics.spend >= targetCpa;
  const stopEligible = noPurchase && metrics.spend >= targetCpa * rules.noPurchaseStopSpendMultiplier && dayCount >= 2 && stopHits >= 2;
  if (stopEligible) return signal('extreme', 'noPurchase', `花费 ≥ 目标 CPA × ${rules.noPurchaseStopSpendMultiplier}、无 Purchase，且连续两次检查均满足最低运行样本`, '广告已达到无购买自动暂停候选条件。请人工复核素材、商品页和支付链路；是否暂停仍由现有自动化开关控制。');
  if (noPurchase && metrics.spend >= targetCpa * rules.noPurchaseHighSpendMultiplier) return signal('high', 'noPurchase', `花费 ≥ 目标 CPA × ${rules.noPurchaseHighSpendMultiplier} 且 Purchase = 0`, '当前广告花费已达到目标购买成本的两倍，但仍没有产生购买。建议优先检查素材点击质量、产品页、价格、加购和支付流程。');
  if (metrics.cpa !== null && metrics.cpa > targetCpa * rules.cpaHighRiskMultiplier) return signal('high', 'cpa', `CPA > 目标 CPA × ${rules.cpaHighRiskMultiplier}`, '当前单次购买成本已经明显高于目标 CPA，请检查 CTR、落地页、加购、结账和最终购买环节，定位成本上涨发生在哪一层。');
  if (metrics.roas !== null && hasSample && below(metrics.roas, targetRoas * rules.roasHighRiskRatio)) return signal('high', 'roas', `ROAS < 目标 ROAS × ${rules.roasHighRiskRatio}`, '当前广告回报明显低于目标，需要重点检查 CPA、购买转化漏斗、商品页面和素材表现。');
  if (metrics.roas !== null && below(metrics.roas, targetRoas * rules.roasWatchRatio)) return signal('high', 'roas', `ROAS 低于目标 ROAS × ${rules.roasWatchRatio}`, '当前 ROAS 明显低于目标，建议检查购买成本、产品页转化和素材表现，并考虑降低预算或调整广告。');
  if (metrics.cpa !== null && metrics.cpa > targetCpa * rules.cpaWatchMultiplier) return signal('watch', 'cpa', `CPA > 目标 CPA × ${rules.cpaWatchMultiplier}`, '当前单次购买成本开始高于目标，建议继续观察购买转化率、素材和落地页表现。');
  if (metrics.roas !== null && below(metrics.roas, targetRoas)) return signal('watch', 'roas', 'ROAS 略低于目标 ROAS', '当前 ROAS 略低于目标值，暂时不建议大幅调整。请继续观察 CPA、购买转化率和素材表现。');
  if (metrics.roas !== null && metrics.roas >= targetRoas) return signal('excellent', 'roas', 'ROAS 已达到或超过目标', '当前广告 ROAS 已达到或超过目标水平，整体盈利效率表现良好。可继续观察，并根据稳定性考虑逐步扩量。');
  return signal('normal', 'normal', '等待更多购买样本', '当前购买样本不足，请继续观察广告花费、购买和转化漏斗变化。');
}

function funnelSignal(metrics, ctrThreshold) {
  if (metrics.impressions >= 1000 && metrics.ctr !== null && metrics.ctr < ctrThreshold) return signal('watch', 'creative', `链接 CTR < ${(ctrThreshold * 100).toFixed(1)}%`, '当前广告点击率偏低，用户看到广告后没有产生足够兴趣。建议测试新的 Creative、封面、Hook、标题、视频前三秒或广告文案。');
  if (metrics.linkClicks >= 10 && metrics.lpvRate !== null && metrics.lpvRate < 0.7) return signal('watch', 'landingPage', 'LPV Rate < 70%', '广告点击表现正常，但 Landing Page View 比例偏低。建议检查网站加载速度、移动端页面、跳转链接和页面稳定性。');
  if (metrics.landingPageViews >= 15 && metrics.atcRate !== null && metrics.atcRate < 0.05) return signal('watch', 'productPage', 'ATC Rate < 5%', '用户已经正常进入商品页面，但加购率偏低。当前问题更可能出现在商品吸引力、价格、产品图片、产品介绍、优惠或信任感，而不是广告点击层面。');
  if (metrics.addToCart >= 5 && metrics.checkoutRate !== null && metrics.checkoutRate < 0.35) return signal('watch', 'cart', 'Checkout Rate < 35%', '用户有明显购买兴趣并完成加购，但进入结账流程的比例偏低。建议检查购物车页面、运费展示、优惠政策、库存、尺码和额外费用。');
  if (metrics.initiateCheckout >= 5 && metrics.checkoutCompletionRate !== null && metrics.checkoutCompletionRate < 0.45) return signal('watch', 'checkout', 'Checkout Completion Rate < 45%', '用户已经进入结账流程，但最终购买完成率偏低。建议重点检查支付方式、支付失败、运费、税费、结账页面体验以及支付信任问题。');
  return null;
}

function frequencyCommerceSignal(rows, metrics, rules) {
  const frequency = frequencySignals(rows, rules.targetCpa, { warningThreshold: rules.frequencyWarningThreshold, highRiskThreshold: rules.frequencyHighRiskThreshold });
  const comparison = recentCommerceComparison(rows);
  const base = frequency.signals[0];
  if (!base) return { frequency, signal: null };
  if (frequency.frequency7d >= rules.frequencyHighRiskThreshold && comparison && comparison.roasChange !== null && comparison.roasChange <= -0.2) return { frequency, signal: signal('high', 'creativeFatigue', `${frequency.frequencyPeriod}频次高，且近 3 天 ROAS 较前 3 天下降 ≥ 20%`, '当前广告频次持续升高，同时 ROAS 明显下降，素材可能已经出现疲劳。建议优先测试新 Creative，而不是继续增加预算。') };
  if (frequency.frequency7d >= rules.frequencyHighRiskThreshold && comparison && comparison.cpaChange !== null && comparison.cpaChange >= 0.2) return { frequency, signal: signal('high', 'creativeFatigue', `${frequency.frequencyPeriod}频次高，且近 3 天 CPA 较前 3 天上涨 ≥ 20%`, '当前广告重复曝光较高，同时购买成本正在上升，素材疲劳可能已经开始影响最终转化。建议更换素材，并检查当前目标受众是否过窄。') };
  return { frequency, signal: signal(base.level, base.type, base.rule, base.advice) };
}

export function diagnoseCommerceGroup(group, rules = DEFAULT_COMMERCE_RULES, stopHits = 0) {
  const commercial = commercialSignal(group, rules, stopHits, group.dayCount);
  const funnel = funnelSignal(group, (rules.watchCtrPercent || 0.8) / 100);
  const fatigue = frequencyCommerceSignal(group.rows, group, rules);
  // Commercial outcomes are the primary B2C decision layer. Funnel signals remain
  // visible as recommendations, while a material creative-fatigue signal can still
  // upgrade risk because it is already harming ad efficiency.
  let candidate = commercial;
  if (fatigue.signal && COMMERCE_RISK_ORDER[fatigue.signal.level] < COMMERCE_RISK_ORDER[candidate.level]) candidate = fatigue.signal;
  if (candidate.level === 'normal' && funnel) candidate = stronger(candidate, funnel);
  const related = [commercial, funnel, fatigue.signal].filter(Boolean).filter(item => item !== candidate && item.category !== 'normal');
  const [label, status] = LEVEL_META[candidate.level];
  return {
    ...candidate,
    label,
    status,
    frequency7d: fatigue.frequency.frequency7d,
    categories: [...new Set([candidate.category, ...related.map(item => item.category)])],
    rule: [candidate.rule, ...related.map(item => item.rule)].filter(Boolean).join('；'),
    advice: [candidate.advice, ...related.map(item => item.advice)].filter(Boolean).join(' 同时，'),
    autoStopCandidate: candidate.level === 'extreme'
  };
}

export function commerceDiagnostics(rows, rules, stopHitsById = {}) {
  return commerceGroups(rows).map(group => {
    const d = diagnoseCommerceGroup(group, rules, stopHitsById[group.id] || 0);
    return { ...group, d };
  }).sort((a, b) => COMMERCE_RISK_ORDER[a.d.level] - COMMERCE_RISK_ORDER[b.d.level] || b.spend - a.spend);
}

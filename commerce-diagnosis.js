import { DEFAULT_COMMERCE_RULES } from './data-model.js';
import { commerceGroups, recentCommerceComparison } from './commerce-metrics.js';
import { frequencySignals } from './metrics.js';

export const COMMERCE_RISK_ORDER = Object.freeze({ extreme: 0, high: 1, watch: 2, normal: 3, excellent: 4 });
const LEVEL_META = Object.freeze({
  extreme: ['极高风险', '极高风险'], high: ['高风险', '高风险'], watch: ['观察', '需要观察'], normal: ['正常', '正常'], excellent: ['优秀', '表现良好']
});

const PRIMARY_DIAGNOSIS_META = Object.freeze({
  stopCandidate: ['关停候选', '关停候选'],
  noPurchase: ['无购买高花费', '无购买高花费'],
  roasSevere: ['ROAS 严重偏低', 'ROAS 严重偏低'],
  roasWatch: ['ROAS 低于目标', 'ROAS 低于目标'],
  cpaSevere: ['CPA 严重偏高', 'CPA 严重偏高'],
  cpaWatch: ['CPA 高于目标', 'CPA 高于目标'],
  checkoutCompletion: ['Checkout Completion 异常', '支付完成流失'],
  checkout: ['Checkout 异常', '加购后结账流失'],
  productPage: ['ATC / 商品页问题', '商品页加购偏低'],
  landingPage: ['LPV / Landing Page 问题', '落地页到达异常'],
  creativeFatigue: ['素材疲劳', '素材疲劳'],
  creative: ['CTR 偏低', '素材吸引力不足'],
  audienceSaturation: ['受众趋于饱和', '受众趋于饱和'],
  frequency: ['Frequency 偏高', '频次偏高'],
  excellent: ['表现优秀，可扩量', '表现优秀'],
  normal: ['继续观察', '继续观察']
});

const RISK_EPSILON = 1e-9;

function signal(level, category, rule, advice, options = {}) {
  return {
    level,
    category,
    rule,
    advice,
    stopCandidate: false,
    autoStopCandidate: false,
    recommendedAction: '',
    ...options
  };
}
function below(value, threshold) { return value < threshold - RISK_EPSILON; }
function stronger(one, two) { return COMMERCE_RISK_ORDER[one.level] < COMMERCE_RISK_ORDER[two.level] ? one : two; }

function hasCompleteDiagnosticData(metrics) {
  return Boolean(
    metrics.rows?.length &&
    metrics.dayCount >= 2 &&
    metrics.rows.every(row => {
      const date = String(row.dateEnd || row.dateStart || row.date || '').slice(0, 10);
      return Boolean(date) && Number.isFinite(Number(row.spend)) && Number.isFinite(Number(row.purchases));
    })
  );
}

function stopCandidate(level, category, rule, advice) {
  return signal(level, category, rule, advice, {
    stopCandidate: true,
    autoStopCandidate: false,
    recommendedAction: '人工确认后暂停广告'
  });
}

function commercialSignal(metrics, rules, _stopHits = 0, dayCount = 0) {
  const targetRoas = rules.targetRoas;
  const targetCpa = rules.targetCpa;
  const noPurchase = metrics.purchases === 0;
  const hasSample = metrics.spend >= targetCpa;
  const minPurchaseSample = rules.minimumPurchaseSample ?? 3;
  const minimumRuntimeMet = dayCount >= 2 && hasCompleteDiagnosticData({ ...metrics, dayCount });
  const requiredSpend = targetCpa * rules.noPurchaseStopSpendMultiplier;

  // B2C only flags candidates for a person to handle. It never requests or
  // reports an automatic Meta pause, and it intentionally ignores stopHits.
  if (noPurchase && metrics.spend >= requiredSpend && minimumRuntimeMet) {
    return stopCandidate('extreme', 'noPurchase', `花费 ≥ 目标 CPA × ${rules.noPurchaseStopSpendMultiplier}、Purchase = 0，且已满足最低运行期`, `当前广告花费已经达到目标 CPA 的 ${rules.noPurchaseStopSpendMultiplier} 倍，但仍未产生任何购买，继续投放存在明显预算浪费风险。建议人工确认后暂停该广告。`);
  }
  if (metrics.purchases >= minPurchaseSample && metrics.spend >= requiredSpend && metrics.roas !== null && below(metrics.roas, targetRoas * rules.lowRoasStopRatio) && minimumRuntimeMet) {
    return stopCandidate('extreme', 'roas', `Purchases ≥ ${minPurchaseSample}、花费 ≥ 目标 CPA × ${rules.noPurchaseStopSpendMultiplier}、ROAS < 目标 ROAS × ${rules.lowRoasStopRatio}`, '当前广告已经产生一定购买样本，但 ROAS 长时间明显低于目标值，继续投放可能持续亏损。建议人工复核后考虑暂停。');
  }
  if (metrics.purchases >= minPurchaseSample && metrics.spend >= requiredSpend && metrics.cpa !== null && metrics.cpa >= targetCpa * rules.highCpaStopMultiplier && minimumRuntimeMet) {
    return stopCandidate('extreme', 'cpa', `Purchases ≥ ${minPurchaseSample}、花费 ≥ 目标 CPA × ${rules.noPurchaseStopSpendMultiplier}、CPA ≥ 目标 CPA × ${rules.highCpaStopMultiplier}`, `当前广告单次购买成本已达到目标 CPA 的 ${rules.highCpaStopMultiplier} 倍或以上，且已有足够购买样本，建议人工检查后考虑暂停或降低预算。`);
  }
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

function signalList(diagnosis = {}) {
  const listed = Array.isArray(diagnosis.signals) ? diagnosis.signals : [];
  return listed.length ? listed : [{ category: diagnosis.category || 'normal', level: diagnosis.level || 'normal', stopCandidate: diagnosis.stopCandidate }];
}

/** Selects one stable diagnosis for compact tables while preserving all tags for details. */
export function derivePrimaryDiagnosis(diagnosis = {}) {
  const signals = signalList(diagnosis);
  const has = (category, predicate = () => true) => signals.some(signalItem => signalItem?.category === category && predicate(signalItem));
  const byLevel = (category, levels) => has(category, item => levels.includes(item.level));
  let key = 'normal';
  if (diagnosis.stopCandidate || has('noPurchase', item => item.stopCandidate)) key = 'stopCandidate';
  else if (has('noPurchase')) key = 'noPurchase';
  else if (byLevel('roas', ['extreme', 'high'])) key = 'roasSevere';
  else if (byLevel('cpa', ['extreme', 'high'])) key = 'cpaSevere';
  else if (has('checkout')) key = 'checkoutCompletion';
  else if (has('cart')) key = 'checkout';
  else if (has('productPage')) key = 'productPage';
  else if (has('landingPage')) key = 'landingPage';
  else if (has('creativeFatigue')) key = 'creativeFatigue';
  else if (has('creative')) key = 'creative';
  else if (has('audienceSaturation')) key = 'audienceSaturation';
  else if (has('frequency')) key = 'frequency';
  else if (byLevel('roas', ['watch'])) key = 'roasWatch';
  else if (byLevel('cpa', ['watch'])) key = 'cpaWatch';
  else if (has('roas', item => item.level === 'excellent') || diagnosis.level === 'excellent') key = 'excellent';
  const [label, shortLabel] = PRIMARY_DIAGNOSIS_META[key] || PRIMARY_DIAGNOSIS_META.normal;
  return { key, label, shortLabel };
}

/** Returns one standard short action appropriate to the reporting layer. */
export function deriveSuggestedAction(diagnosis = {}, scope = 'ad') {
  const primary = diagnosis.primaryDiagnosis?.key || derivePrimaryDiagnosis(diagnosis).key;
  if (primary === 'stopCandidate') return '建议暂停';
  const funnelActions = { checkoutCompletion: '建议检查支付流程', checkout: '建议检查购物车', productPage: '建议检查商品页', landingPage: '建议检查 Landing Page' };
  if (funnelActions[primary]) return funnelActions[primary];
  if (primary === 'creativeFatigue' || primary === 'creative' || primary === 'frequency') return scope === 'country' ? '建议调整 Campaign 预算' : scope === 'campaign' ? '建议检查 Ad Set' : primary === 'creativeFatigue' ? '建议更换素材' : '建议更换素材';
  if (primary === 'audienceSaturation') return scope === 'country' ? '建议调整 Campaign 预算' : '建议扩大受众';
  if (primary === 'roasSevere' || primary === 'cpaSevere') return scope === 'country' ? '建议调整 Campaign 预算' : scope === 'campaign' ? '建议检查 Ad Set' : '建议降预算';
  if (primary === 'roasWatch' || primary === 'cpaWatch' || primary === 'noPurchase') return scope === 'country' ? '建议调整 Campaign 预算' : scope === 'campaign' ? '建议检查 Ad Set' : primary === 'noPurchase' ? '建议降预算' : '建议继续观察';
  if (primary === 'excellent') return '建议扩量';
  return '建议继续观察';
}

/** Produces layer-specific detail copy; compact views use the paired primary diagnosis and action only. */
export function buildLayeredRecommendation({ diagnosis = {}, scope = 'ad', name = '', metrics = {} } = {}) {
  const primaryDiagnosis = diagnosis.primaryDiagnosis || derivePrimaryDiagnosis(diagnosis);
  const recommendedAction = deriveSuggestedAction({ ...diagnosis, primaryDiagnosis }, scope);
  const label = primaryDiagnosis.label;
  const subject = name ? `“${name}”` : '当前对象';
  const copyByScope = {
    country: {
      stopCandidate: `${subject} 内存在达到人工关停候选标准的高花费广告组合。建议优先复核持续低回报 Campaign，并重新分配该国家预算。`,
      noPurchase: `${subject} 的整体花费已积累但没有形成购买。建议检查该市场高花费 Campaign 的购买效率，并控制继续投入。`,
      roasSevere: `${subject} 当前整体 ROAS 明显低于目标。建议优先检查高花费 Campaign，并减少持续低回报 Campaign 的预算。`,
      cpaSevere: `${subject} 的整体购买成本明显偏高。建议比较该国家的市场成本和 Campaign 分配，先压缩低效投入。`,
      checkoutCompletion: `${subject} 已进入结账的用户完成购买比例偏低。建议结合当地支付方式、税费与运费体验排查转化流失。`,
      checkout: `${subject} 的加购用户进入结账比例偏低。建议检查当地运费、优惠、库存和购物车信息是否造成流失。`,
      productPage: `${subject} 的商品页加购效率偏低。建议结合当地价格、优惠、商品信息与信任因素评估市场适配度。`,
      landingPage: `${subject} 的广告点击到达落地页比例偏低。建议优先检查该市场的页面加载、跳转与移动端体验。`,
      creativeFatigue: `${subject} 的频次与效率变化显示素材可能疲劳。建议调整该国家的 Campaign 分配，并为高消耗组合准备新素材。`,
      audienceSaturation: `${subject} 的新增覆盖趋缓且频次上升。建议调整国家预算分配，并评估扩展当地受众的空间。`,
      excellent: `${subject} 当前 ROAS 与购买成本表现健康。建议保持稳定投放，并在可控范围内逐步增加该市场预算。`,
      default: `${subject} 当前需要继续结合国家整体购买效率、市场成本和 Campaign 分配观察。`
    },
    campaign: {
      stopCandidate: `${subject} 已达到人工关停候选标准。建议先复核内部 Ad Set 与广告组合，再决定暂停或下调预算。`,
      noPurchase: `${subject} 花费已达到风险水平但没有购买。建议检查内部 Ad Set 的流量质量，并控制继续加预算。`,
      roasSevere: `${subject} 的 ROAS 明显低于目标。建议检查内部 Ad Set 与预算分配，优先降低持续低效组合的预算。`,
      cpaSevere: `${subject} 的 CPA 明显偏高。建议检查 Ad Set、受众和购买转化效率，再调整 Campaign 预算。`,
      creativeFatigue: `${subject} 的频次上升且效率走弱。建议先定位疲劳的 Ad Set / Creative，避免继续扩大同一素材预算。`,
      audienceSaturation: `${subject} 的受众可能趋于饱和。建议检查 Ad Set 覆盖和频次，并考虑扩展受众或拆分预算。`,
      excellent: `${subject} 当前 ROAS 与 CPA 表现健康。建议保持结构稳定，并以小步测试方式增加预算。`,
      default: `${subject} 需要结合 ROAS、CPA、Purchase 和 Ad Set 表现继续观察。`
    },
    creative: {
      stopCandidate: `${subject} 对应的商业结果已达到人工关停候选标准。建议先停止继续放量，并优先测试替代素材。`,
      roasSevere: `${subject} 的回报明显低于目标。建议优先替换 Hook、封面、文案或视频前三秒，并与高效素材对照测试。`,
      cpaSevere: `${subject} 的购买成本偏高。建议优化素材承诺与受众匹配度，并减少低效素材的消耗。`,
      creativeFatigue: `${subject} 出现频次升高与效率变差的素材疲劳信号。建议尽快更换 Creative、封面、Hook 或视频前三秒。`,
      creative: `${subject} 的 CTR 偏低。建议测试新的 Hook、封面、标题、文案或视频前三秒，提升首屏吸引力。`,
      audienceSaturation: `${subject} 重复曝光较高。建议准备备用素材，并配合更广的受众测试。`,
      excellent: `${subject} 当前素材效率健康。建议保留为对照素材，并在表现稳定时小步扩量。`,
      default: `${subject} 需要继续观察素材点击效率、频次和最终购买回报。`
    },
    funnel: {
      checkoutCompletion: '用户已进入结账流程但最终购买完成率偏低。建议优先检查支付方式、支付失败、税费、运费和结账信任感。',
      checkout: '用户已加购但进入结账比例偏低。建议检查购物车、运费展示、库存、优惠与额外费用。',
      productPage: '用户已经到达商品页但加购率偏低。建议检查商品卖点、价格、图片、优惠和信任信息。',
      landingPage: '广告点击后落地页到达比例偏低。建议检查页面加载速度、跳转稳定性和移动端体验。',
      creative: '广告 CTR 偏低。建议先测试新的 Creative、Hook、封面、标题或视频前三秒。',
      default: '优先从 LPV、商品页、购物车、Checkout 和支付完成率定位漏斗流失环节。'
    },
    ad: {
      stopCandidate: `${subject} 已满足人工关停候选条件。请先人工复核触发规则与数据完整性，再决定是否暂停。`,
      noPurchase: `${subject} 存在无购买高花费风险。建议检查点击质量和完整购买漏斗，并控制继续消耗。`,
      roasSevere: `${subject} 的 ROAS 明显低于目标。建议先降低预算并定位具体发生问题的漏斗或素材环节。`,
      cpaSevere: `${subject} 的 CPA 明显偏高。建议检查购买成本上涨来自素材、受众还是转化漏斗。`,
      default: diagnosis.advice || `${subject} 需要继续观察商业结果和转化漏斗变化。`
    },
    cluster: {
      stopCandidate: '存在达到人工关停候选标准的广告组合。建议优先逐项复核，再由人工决定暂停或继续观察。',
      noPurchase: '高花费无购买问题正在影响预算效率。建议优先排查高消耗对象的流量质量和购买漏斗。',
      roasSevere: '多个广告组合的 ROAS 明显低于目标。建议优先处理高花费低回报对象，并定位购买漏斗问题。',
      cpaSevere: '多个广告组合的购买成本明显偏高。建议优先检查高消耗 Campaign、Ad Set 和转化效率。',
      checkoutCompletion: '结账后最终完成购买的比例偏低。建议优先检查支付与结账体验。',
      checkout: '加购后的结账推进不足。建议优先检查购物车、运费和优惠信息。',
      productPage: '商品页到加购的转化偏低。建议优先检查商品信息、价格、优惠和信任感。',
      landingPage: '广告点击到落地页的到达效率偏低。建议检查页面加载、跳转与移动端体验。',
      creativeFatigue: '频次升高且效率走弱，素材可能开始疲劳。建议优先测试新的 Creative，而不是继续增加预算。',
      creative: '点击率偏低，素材吸引力不足。建议优先测试新的 Hook、封面、标题或视频前三秒。',
      audienceSaturation: '展示继续增加但新增覆盖放缓，受众可能趋于饱和。建议考虑扩大受众并增加新素材。',
      excellent: 'ROAS 高于目标且购买成本健康。建议保持结构稳定，并在表现持续稳定时逐步扩量。',
      default: '当前建议继续观察商业结果、漏斗和频次变化。'
    }
  };
  const scopeCopy = copyByScope[scope] || copyByScope.ad;
  return { primaryDiagnosis, recommendedAction, fullRecommendation: scopeCopy[primaryDiagnosis.key] || scopeCopy.default, metrics };
}

function diagnosisWeight(level) {
  return ({ extreme: 5, high: 4, watch: 2, normal: 1, excellent: 0 }[level] ?? 1);
}

/** Groups B2C recommendations by their primary problem instead of by individual ad combinations. */
export function buildCommerceAdviceClusters(diagnostics = [], rules = {}) {
  const clusters = new Map();
  diagnostics.forEach(item => {
    const diagnosis = item.d || {};
    const primaryDiagnosis = diagnosis.primaryDiagnosis || derivePrimaryDiagnosis(diagnosis);
    if (primaryDiagnosis.key === 'normal') return;
    const key = primaryDiagnosis.key;
    if (!clusters.has(key)) clusters.set(key, {
      key,
      title: primaryDiagnosis.label,
      primaryDiagnosis,
      items: [],
      level: diagnosis.level || 'normal',
      affectedSpend: 0,
      affectedGmv: 0,
      affectedPurchases: 0,
      campaigns: new Set(),
      countries: new Set(),
      rules: new Set(),
      tags: new Set()
    });
    const cluster = clusters.get(key);
    if (COMMERCE_RISK_ORDER[diagnosis.level] < COMMERCE_RISK_ORDER[cluster.level]) cluster.level = diagnosis.level;
    cluster.items.push(item);
    cluster.affectedSpend += Number(item.spend || 0);
    cluster.affectedGmv += Number(item.metaAttributedGmv || 0);
    cluster.affectedPurchases += Number(item.purchases || 0);
    if (item.campaign) cluster.campaigns.add(item.campaign);
    if (item.country) cluster.countries.add(item.country);
    if (diagnosis.rule) cluster.rules.add(diagnosis.rule);
    (diagnosis.categories || [diagnosis.category]).filter(Boolean).forEach(tag => cluster.tags.add(tag));
  });

  return [...clusters.values()].map(cluster => {
    const averageRoas = cluster.affectedSpend > 0 ? cluster.affectedGmv / cluster.affectedSpend : null;
    const layered = buildLayeredRecommendation({ diagnosis: { primaryDiagnosis: cluster.primaryDiagnosis, level: cluster.level }, scope: 'cluster' });
    const countries = [...cluster.countries];
    const candidateKinds = cluster.items.filter(item => item.d?.stopCandidate).reduce((all, item) => ({ ...all, [item.d.category]: (all[item.d.category] || 0) + 1 }), {});
    const candidateText = Object.entries(candidateKinds).map(([category, count]) => `${count} 个${category === 'noPurchase' ? '无购买高花费' : category === 'roas' ? '严重低 ROAS' : '严重高 CPA'}`).join('、');
    const summary = cluster.primaryDiagnosis.key === 'stopCandidate'
      ? `当前有 ${cluster.items.length} 个广告组合达到人工关停候选标准${candidateText ? `（${candidateText}）` : ''}，建议优先人工复核。`
      : `${cluster.items.length} 个广告组合受到影响，${countries.slice(0, 3).join(' / ') || '当前筛选范围'} 为主。${layered.fullRecommendation}`;
    return {
      ...cluster,
      affectedAds: cluster.items.length,
      affectedCampaigns: cluster.campaigns.size,
      countries,
      primaryCountries: countries.slice(0, 3),
      averageRoas,
      targetRoas: Number.isFinite(Number(rules.targetRoas)) ? Number(rules.targetRoas) : null,
      recommendedAction: layered.recommendedAction,
      fullRecommendation: layered.fullRecommendation,
      summary,
      score: diagnosisWeight(cluster.level) * Math.max(cluster.affectedSpend, 1),
      affectedObjects: cluster.items.map(item => ({
        country: item.country || '—', campaign: item.campaign || '—', ad: item.ad || item.creative || '—',
        spend: Number(item.spend || 0), purchases: Number(item.purchases || 0), cpa: item.cpa ?? null, roas: item.roas ?? null,
        rule: item.d?.rule || '—', diagnosis: item.d?.primaryDiagnosis?.label || derivePrimaryDiagnosis(item.d).label
      }))
    };
  }).sort((one, two) => {
    const candidateOrder = Number(Boolean(two.primaryDiagnosis.key === 'stopCandidate')) - Number(Boolean(one.primaryDiagnosis.key === 'stopCandidate'));
    if (candidateOrder) return candidateOrder;
    const levelOrder = COMMERCE_RISK_ORDER[one.level] - COMMERCE_RISK_ORDER[two.level];
    if (levelOrder) return levelOrder;
    if (two.score !== one.score) return two.score - one.score;
    if (two.affectedSpend !== one.affectedSpend) return two.affectedSpend - one.affectedSpend;
    return two.affectedAds - one.affectedAds;
  });
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
  const signals = [commercial, funnel, fatigue.signal].filter(Boolean);
  const related = signals.filter(item => item !== candidate && item.category !== 'normal');
  const [baseLabel, status] = LEVEL_META[candidate.level];
  const provisional = {
    ...candidate,
    label: candidate.stopCandidate ? '极高风险 · 关停候选' : baseLabel,
    status,
    frequency7d: fatigue.frequency.frequency7d,
    categories: [...new Set([candidate.category, ...related.map(item => item.category)])],
    rule: [candidate.rule, ...related.map(item => item.rule)].filter(Boolean).join('；'),
    advice: [candidate.advice, ...related.map(item => item.advice)].filter(Boolean).join(' 同时，'),
    signals,
    autoStopCandidate: false
  };
  const primaryDiagnosis = derivePrimaryDiagnosis(provisional);
  return {
    ...provisional,
    primaryDiagnosis,
    primaryDiagnosisKey: primaryDiagnosis.key,
    recommendedAction: candidate.recommendedAction || deriveSuggestedAction({ ...provisional, primaryDiagnosis }, 'ad')
  };
}

export function commerceDiagnostics(rows, rules, stopHitsById = {}) {
  return commerceGroups(rows).map(group => {
    const d = diagnoseCommerceGroup(group, rules, stopHitsById[group.id] || 0);
    return { ...group, d };
  }).sort((a, b) => COMMERCE_RISK_ORDER[a.d.level] - COMMERCE_RISK_ORDER[b.d.level] || b.spend - a.spend);
}

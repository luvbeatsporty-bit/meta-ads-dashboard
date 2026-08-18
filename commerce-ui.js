import { commerceDimensionGroups, commerceTotals, commerceTrend, funnelStages } from './commerce-metrics.js';
import { esc, integer, money, pct, titleText } from './metrics.js';
import { buildCommerceAdviceClusters, buildLayeredRecommendation, derivePrimaryDiagnosis, deriveSuggestedAction } from './commerce-diagnosis.js';

const DISPLAY_LIMIT = 5;
const RISK_ORDER = { extreme: 0, high: 1, watch: 2, normal: 3, excellent: 4 };
const riskClass = level => ({ extreme: 'extreme', high: 'high', watch: 'watch', excellent: 'excellent', normal: 'normal' }[level] || 'normal');
const rate = value => value === null || value === undefined ? '—' : pct(value);
const fixed = value => value === null || value === undefined ? '—' : Number(value).toFixed(2);
const byId = id => document.getElementById(id);

// Detail payloads stay in memory only. They power B2C full-text viewing without
// adding long, repetitive copy to every table cell or affecting B2B actions.
const commerceDetailEntries = new Map();
let commerceDetailSequence = 0;

function registerCommerceDetail(payload) {
  const id = `commerce-detail-${++commerceDetailSequence}`;
  commerceDetailEntries.set(id, { id, ...payload });
  return id;
}

export function getCommerceDetail(id) {
  return commerceDetailEntries.get(id) || null;
}

function detailTextCell(title, text, payload = {}, limit = 70) {
  const fullText = String(text || '—');
  const id = registerCommerceDetail({ title, text: fullText, ...payload });
  return `<div class="truncated-detail"><span title="${esc(fullText)}">${esc(titleText(fullText, limit))}</span><button type="button" class="text-button commerce-detail-link" data-commerce-detail-id="${id}">查看全文</button></div>`;
}

function detailButton(payload, label = '查看详情') {
  const id = registerCommerceDetail(payload);
  return `<button type="button" class="text-button commerce-detail-link" data-commerce-detail-id="${id}">${esc(label)}</button>`;
}

function commerceActionId(row) {
  return `b2c:${row.campaign || '未命名 Campaign'}|${row.country || '未分类'}`;
}

function detailPayloadForRow(row, diagnosis) {
  const cpa = row.purchases ? Number(row.spend || 0) / Number(row.purchases) : null;
  const roas = row.spend ? Number(row.metaAttributedGmv || 0) / Number(row.spend) : null;
  const primaryDiagnosis = diagnosis.primaryDiagnosis || derivePrimaryDiagnosis(diagnosis);
  const layered = buildLayeredRecommendation({ diagnosis: { ...diagnosis, primaryDiagnosis }, scope: 'ad', name: row.ad || row.creative || row.campaign, metrics: row });
  return {
    title: diagnosis.stopCandidate ? '关停候选诊断详情' : 'B2C 诊断详情',
    eyebrow: diagnosis.stopCandidate ? 'EXTREME RISK · MANUAL REVIEW' : 'B2C DIAGNOSTIC DETAIL',
    text: diagnosis.advice || '—',
    rule: diagnosis.rule || '—',
    recommendation: diagnosis.advice || layered.fullRecommendation || '—',
    fullRecommendation: layered.fullRecommendation,
    primaryDiagnosis: primaryDiagnosis.label,
    diagnosisTags: diagnosis.categories || [],
    recommendedAction: layered.recommendedAction || diagnosis.recommendedAction || '建议继续观察',
    stopCandidate: Boolean(diagnosis.stopCandidate),
    actionId: commerceActionId(row),
    context: [
      ['分析层级', 'Ad / Risk Detail'], ['Ad', row.ad || row.creative || '—'], ['Campaign', row.campaign || '—'], ['Country', row.country || '—'],
      ['Primary Diagnosis', primaryDiagnosis.label], ['风险状态', diagnosis.label || levelMeta(diagnosis.level)[0]],
      ['Spend', money(row.spend)], ['Purchases', integer(row.purchases)], ['CPA', money(cpa)], ['ROAS', roas === null ? '—' : `${fixed(roas)}×`],
      ['Frequency', row.frequency > 0 ? `${Number(row.frequency).toFixed(1)} 次` : '—']
    ]
  };
}

function candidateStatusCell(row, diagnosis, actions = {}) {
  if (!diagnosis.stopCandidate) return esc(actions[commerceActionId(row)] || row.status || '待人工复核');
  const payload = detailPayloadForRow(row, diagnosis);
  const detailId = registerCommerceDetail(payload);
  const actionId = payload.actionId;
  const saved = actions[actionId];
  return `<div class="commerce-candidate-status"><span>${esc(saved || '待人工确认')}</span><button type="button" class="text-button commerce-detail-link" data-commerce-detail-id="${detailId}">查看详情</button><div class="commerce-action-links"><button type="button" class="small-btn" data-commerce-action="handled" data-commerce-action-id="${esc(actionId)}">标记已处理</button><button type="button" class="small-btn" data-commerce-action="watch" data-commerce-action-id="${esc(actionId)}">保持观察</button><button type="button" class="small-btn" data-commerce-action="manualPause" data-commerce-action-id="${esc(actionId)}">人工暂停</button><button type="button" class="small-btn" data-commerce-action="ignore" data-commerce-action-id="${esc(actionId)}">忽略本次提醒</button></div></div>`;
}

export const visibleListItems = (items = [], expanded = false) => expanded ? items : items.slice(0, DISPLAY_LIMIT);
export const hasMoreListItems = (items = []) => items.length > DISPLAY_LIMIT;
export const visibleDetailItems = (items = [], visibleCount = DISPLAY_LIMIT) => {
  const limit = Math.max(DISPLAY_LIMIT, Number(visibleCount) || DISPLAY_LIMIT);
  return items.slice(0, Math.min(limit, items.length));
};

function metricCard(tone, label, value, note, icon) {
  return `<article class="metric ${tone}"><div class="metric-head"><small>${esc(label)}</small><i>${icon}</i></div><strong>${value}</strong><span>${esc(note)}</span><svg viewBox="0 0 150 35" aria-hidden="true"><path d="M2 28 C12 18 19 30 28 20 S44 25 56 10 S72 24 83 16 S100 9 112 20 S130 19 148 6"/></svg></article>`;
}

function listToggle(key, total, expanded, { noun = '条', expandLabel = '展开全部', collapseLabel = '收起，仅显示前 5 条' } = {}) {
  if (total <= DISPLAY_LIMIT) return '';
  const label = expanded ? `${collapseLabel} ↑` : `${expandLabel}（共 ${total} ${noun}） ↓`;
  return `<button type="button" class="list-toggle" data-commerce-list-toggle="${key}" aria-expanded="${String(expanded)}">${label}</button>`;
}

function detailListToggle(total, visibleCount) {
  if (total <= DISPLAY_LIMIT) return '';
  const visible = Math.min(Math.max(DISPLAY_LIMIT, Number(visibleCount) || DISPLAY_LIMIT), total);
  const expanded = visible > DISPLAY_LIMIT;
  const label = visible >= total
    ? '收起，仅显示前 5 条 ↑'
    : expanded
      ? `继续加载更多（已显示 ${visible} / ${total}） ↓`
      : `展开更多广告明细（共 ${total} 条） ↓`;
  return `<button type="button" class="list-toggle" data-commerce-list-toggle="risks" aria-expanded="${String(expanded)}">${label}</button>`;
}

function levelMeta(level) {
  return {
    extreme: ['极高风险', 'critical'], high: ['高风险', 'high'], watch: ['观察', 'watch'], normal: ['正常', 'normal'], excellent: ['优秀', 'excellent']
  }[level] || ['正常', 'normal'];
}

function riskBadge(diagnosis) {
  return `<span class="risk-badge ${riskClass(diagnosis?.level)}">${esc(diagnosis?.label || levelMeta(diagnosis?.level)[0])}</span>`;
}

function metricForTrend(metric, value) {
  if (value === null || value === undefined) return '—';
  if (metric === 'spend' || metric === 'metaAttributedGmv' || metric === 'cpa') return money(value);
  if (metric === 'purchaseCvr') return rate(value);
  if (metric === 'roas') return `${fixed(value)}×`;
  return integer(value);
}

const TREND_META = {
  spend: ['Spend', '广告花费'], purchases: ['Purchases', '购买次数'], metaAttributedGmv: ['GMV', 'Meta Attributed GMV'],
  roas: ['ROAS', 'Purchase ROAS'], cpa: ['CPA', 'Cost per Purchase'], purchaseCvr: ['CVR', 'Purchase CVR']
};

function renderTrendSvg(points, metric) {
  const usable = points.filter(point => Number.isFinite(point.value));
  if (!usable.length) return '<div class="empty">导入包含报告日期的 B2C 数据后显示趋势。</div>';
  const width = 760;
  const height = 238;
  const left = 44;
  const right = 18;
  const top = 18;
  const bottom = 36;
  const values = usable.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max || 1, 1);
  const x = index => left + (usable.length === 1 ? (width - left - right) / 2 : index / (usable.length - 1) * (width - left - right));
  const y = value => top + (max - value) / range * (height - top - bottom);
  const path = usable.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(usable.length - 1).toFixed(1)},${height - bottom} L${x(0).toFixed(1)},${height - bottom} Z`;
  const grid = [0, .5, 1].map(ratio => {
    const lineY = top + (height - top - bottom) * ratio;
    const label = metricForTrend(metric, max - range * ratio);
    return `<line x1="${left}" x2="${width - right}" y1="${lineY}" y2="${lineY}"/><text x="0" y="${lineY + 4}">${esc(label)}</text>`;
  }).join('');
  const labels = usable.map((point, index) => {
    if (usable.length > 8 && index % Math.ceil(usable.length / 6) !== 0 && index !== usable.length - 1) return '';
    return `<text x="${x(index)}" y="${height - 12}" text-anchor="middle">${esc(point.date.slice(5))}</text>`;
  }).join('');
  const dots = usable.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="3.5"><title>${esc(`${point.date} · ${TREND_META[metric][1]}：${metricForTrend(metric, point.value)}`)}</title></circle>`).join('');
  return `<svg class="commerce-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(TREND_META[metric][1])}趋势图"><g class="commerce-trend-grid">${grid}</g><path class="commerce-trend-area" d="${area}"/><path class="commerce-trend-line" d="${path}"/>${dots}<g class="commerce-trend-labels">${labels}</g></svg>`;
}

export function renderCommerceTrend(rows, metric = 'spend') {
  const selected = Object.hasOwn(TREND_META, metric) ? metric : 'spend';
  const controls = byId('b2cTrendMetricControls');
  if (controls) controls.querySelectorAll('[data-commerce-trend]').forEach(button => {
    const active = button.dataset.commerceTrend === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const host = byId('b2cTrendChart');
  if (host) host.innerHTML = renderTrendSvg(commerceTrend(rows, selected), selected);
}

function funnelStageHealth(stage, totals) {
  const has = key => Boolean(totals.availableMetrics?.[key]);
  if (stage.key === 'linkClicks' && has('impressions') && totals.impressions >= 1000 && totals.ctr !== null && totals.ctr < .008) return ['watch', 'CTR 偏低'];
  if (stage.key === 'landingPageViews' && has('clicks') && has('landingPageViews') && totals.linkClicks >= 10 && totals.lpvRate !== null && totals.lpvRate < .7) return ['watch', 'LPV 偏低'];
  if (stage.key === 'addToCart' && has('landingPageViews') && has('addToCart') && totals.landingPageViews >= 15 && totals.atcRate !== null && totals.atcRate < .05) return ['high', '加购偏低'];
  if (stage.key === 'initiateCheckout' && has('addToCart') && has('initiateCheckout') && totals.addToCart >= 5 && totals.checkoutRate !== null && totals.checkoutRate < .35) return ['high', '结账偏低'];
  if (stage.key === 'purchases' && has('initiateCheckout') && has('purchases') && totals.initiateCheckout >= 5 && totals.checkoutCompletionRate !== null && totals.checkoutCompletionRate < .45) return ['high', '支付完成偏低'];
  if (stage.key === 'purchases' && has('clicks') && has('purchases') && totals.linkClicks >= 10 && totals.purchases === 0) return ['watch', '暂无购买'];
  return ['normal', '正常'];
}

export function renderFunnel(targetId, totals, compact = false) {
  const host = byId(targetId);
  if (!host) return;
  const stages = funnelStages(totals);
  const max = Math.max(...stages.map(stage => stage.value ?? 0), 1);
  host.innerHTML = stages.map(stage => {
    const [level, status] = funnelStageHealth(stage, totals);
    const isAvailable = stage.value !== null && stage.value !== undefined;
    return `<article class="commerce-funnel-stage risk-${level}"><div class="commerce-funnel-top"><span>${esc(stage.label)}</span><b>${integer(stage.value)}</b></div><div class="commerce-funnel-track"><i style="width:${isAvailable ? Math.max(6, stage.value / max * 100) : 0}%"></i></div><small>${!isAvailable ? '暂无数据' : stage.rate === null ? '展示基数' : `上一层转化 ${rate(stage.rate)}`} · <em class="funnel-status ${riskClass(level)}">${esc(isAvailable ? status : '暂无数据')}</em></small></article>`;
  }).join('');
  host.classList.toggle('compact', compact);
}

function commerceAdviceItems(diagnostics, rules = {}) {
  return buildCommerceAdviceClusters(diagnostics, rules).map(cluster => ({ ...cluster, meta: `${cluster.affectedAds} 个广告组合 · ${cluster.affectedCampaigns} 个 Campaign`, text: cluster.summary }));
}

export function renderCommerceAdvice(diagnostics, expanded = false, rules = {}) {
  const host = byId('b2cAdviceList');
  const toggle = byId('b2cAdviceToggle');
  const items = commerceAdviceItems(diagnostics, rules);
  if (!host || !toggle) return;
  if (!items.length) {
    host.innerHTML = diagnostics.length
      ? '<div class="empty">当前没有需要优先处理的 B2C AI 建议。继续观察 ROAS、CPA、购买和转化漏斗表现。</div>'
      : '<div class="empty">导入包含 Purchase、GMV 与漏斗字段的 Meta 报表后，系统会在这里给出电商优化建议。</div>';
    toggle.innerHTML = '';
    return;
  }
  host.innerHTML = visibleListItems(items, expanded).map(item => {
    const averageRoas = item.averageRoas === null ? '—' : `${Number(item.averageRoas).toFixed(2)}×`;
    const context = [
      ['分析层级', '问题聚类'], ['Primary Diagnosis', item.primaryDiagnosis.label], ['风险级别', levelMeta(item.level)[0]],
      ['影响广告组合', `${item.affectedAds} 个`], ['影响 Campaign', `${item.affectedCampaigns} 个`], ['Affected Spend', money(item.affectedSpend)],
      ['主要国家', item.primaryCountries.join(' / ') || '—'], ['平均 ROAS', averageRoas], ['Target ROAS', item.targetRoas === null ? '—' : `${item.targetRoas.toFixed(2)}×`]
    ];
    const detailId = registerCommerceDetail({
      title: `${item.title} · 受影响对象`, eyebrow: 'B2C AI RECOMMENDATION CLUSTER', text: item.summary,
      rule: [...item.rules].join('；') || item.title, recommendation: item.fullRecommendation, fullRecommendation: item.fullRecommendation,
      primaryDiagnosis: item.primaryDiagnosis.label, diagnosisTags: [...item.tags], recommendedAction: item.recommendedAction,
      affectedObjects: item.affectedObjects, context, stopCandidate: item.primaryDiagnosis.key === 'stopCandidate'
    });
    const icon = item.level === 'excellent' ? '↗' : item.level === 'watch' ? '◷' : '!';
    return `<article class="advice-card ${riskClass(item.level)}"><span class="advice-icon">${icon}</span><span class="advice-copy"><span class="advice-label">${esc(item.title)}</span><h3>${esc(levelMeta(item.level)[0])} · ${esc(item.title)}</h3><small>${esc(item.meta)} · 涉及花费 ${esc(money(item.affectedSpend))}</small><p>${esc(titleText(item.summary, 180))}</p><div class="advice-cluster-stats"><span>主要国家 ${esc(item.primaryCountries.join(' / ') || '—')}</span><span>平均 ROAS ${esc(averageRoas)}</span><span>动作 ${esc(item.recommendedAction)}</span></div><button type="button" class="text-button commerce-detail-link" data-commerce-detail-id="${detailId}">查看详情</button></span></article>`;
  }).join('');
  toggle.innerHTML = listToggle('advice', items.length, expanded, { noun: '类问题', expandLabel: '查看全部问题' });
}

function diagnosisForGroup(group, diagnosisMap) {
  const related = [...new Set(group.rows.map(row => `${row.campaign}|${row.country}`))]
    .map(id => diagnosisMap.get(id))
    .filter(Boolean)
    .sort((one, two) => RISK_ORDER[one.level] - RISK_ORDER[two.level] || Number(two.spend || 0) - Number(one.spend || 0));
  return related[0] || { level: 'normal', label: '正常', rule: '等待更多购买样本', advice: '当前组合尚未形成可诊断的购买样本。', primaryDiagnosis: { key: 'normal', label: '继续观察' }, categories: [] };
}

function sortGroups(groups, key = 'spend') {
  return [...groups].sort((one, two) => {
    const a = one[key];
    const b = two[key];
    if (key === 'cpa') return (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY);
    return Number(b ?? -Infinity) - Number(a ?? -Infinity);
  });
}

function groupRows(rows, diagnostics, dimension, sortKey) {
  const diagnosisMap = new Map(diagnostics.map(item => [item.id, item.d]));
  return sortGroups(commerceDimensionGroups(rows, dimension).map(group => ({ ...group, d: diagnosisForGroup(group, diagnosisMap) })), sortKey);
}

function layeredGroup(group, scope) {
  const primaryDiagnosis = group.d.primaryDiagnosis || derivePrimaryDiagnosis(group.d);
  const layered = buildLayeredRecommendation({ diagnosis: { ...group.d, primaryDiagnosis }, scope, name: group.name, metrics: group });
  return { ...group.d, primaryDiagnosis, ...layered };
}

function groupDetailPayload(group, scope) {
  const diagnosis = layeredGroup(group, scope);
  return {
    title: `${group.name} · ${scope === 'country' ? '国家' : scope === 'campaign' ? 'Campaign' : 'Creative'} 诊断详情`,
    eyebrow: `B2C ${scope.toUpperCase()} DIAGNOSTIC`, text: diagnosis.advice || '—', rule: diagnosis.rule || '—',
    recommendation: diagnosis.advice || diagnosis.fullRecommendation || '—', fullRecommendation: diagnosis.fullRecommendation,
    primaryDiagnosis: diagnosis.primaryDiagnosis.label, diagnosisTags: diagnosis.categories || [], recommendedAction: diagnosis.recommendedAction,
    context: [
      ['分析层级', scope === 'country' ? 'Country' : scope === 'campaign' ? 'Campaign' : 'Creative'], ['对象', group.name],
      ['Primary Diagnosis', diagnosis.primaryDiagnosis.label], ['风险状态', diagnosis.label || levelMeta(diagnosis.level)[0]],
      ['Spend', money(group.spend)], ['Purchases', integer(group.purchases)], ['CPA', money(group.cpa)], ['ROAS', group.roas === null ? '—' : `${fixed(group.roas)}×`],
      ['Frequency', group.frequency === null ? '—' : `${fixed(group.frequency)} 次`]
    ],
    affectedObjects: group.rows.map(row => ({ country: row.country || '—', campaign: row.campaign || '—', ad: row.ad || row.creative || '—', spend: Number(row.spend || 0), purchases: Number(row.purchases || 0), cpa: row.purchases ? Number(row.spend || 0) / Number(row.purchases) : null, roas: row.spend ? Number(row.metaAttributedGmv || 0) / Number(row.spend) : null, rule: diagnosis.rule || '—', diagnosis: diagnosis.primaryDiagnosis.label }))
  };
}

function compactDiagnosisCell(diagnosis) {
  const primary = diagnosis.primaryDiagnosis || derivePrimaryDiagnosis(diagnosis);
  return `<span class="commerce-primary-diagnosis" title="${esc(primary.label)}">${esc(primary.label)}</span>`;
}

function compactActionCell(diagnosis, scope) {
  const action = diagnosis.recommendedAction || deriveSuggestedAction(diagnosis, scope);
  return `<span class="commerce-suggested-action">${esc(action)}</span>`;
}

function setTable(hostId, headers, rows, rowHtml, emptyText, toggleId, toggleKey, expanded, noun) {
  const table = byId(hostId);
  const toggle = byId(toggleId);
  if (!table || !toggle) return;
  const visible = visibleListItems(rows, expanded);
  table.innerHTML = `<thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? visible.map(rowHtml).join('') : `<tr><td colspan="${headers.length}"><div class="empty">${esc(emptyText)}</div></td></tr>`}</tbody>`;
  const expandNoun = noun.startsWith('个') ? noun.slice(1) : noun;
  toggle.innerHTML = listToggle(toggleKey, rows.length, expanded, { noun, expandLabel: `展开全部${expandNoun}` });
}

function renderCountryTable(rows, diagnostics, expanded, sortKey) {
  const groups = groupRows(rows, diagnostics, 'country', sortKey);
  setTable('b2cCountryTable', ['Country', 'Spend', 'Purchases', 'Meta GMV', 'ROAS', 'CPA', 'AOV', 'CTR', 'CPC', 'Frequency', 'Risk Level', 'Diagnosis', 'Suggested Action', 'Details'], groups, group => { const diagnosis = layeredGroup(group, 'country'); return `<tr><td>${esc(group.name)}</td><td>${money(group.spend)}</td><td>${integer(group.purchases)}</td><td>${money(group.metaAttributedGmv)}</td><td>${fixed(group.roas)}</td><td>${money(group.cpa)}</td><td>${money(group.aov)}</td><td>${rate(group.ctr)}</td><td>${money(group.cpc)}</td><td>${group.frequency === null ? '—' : `${fixed(group.frequency)} 次`}</td><td>${riskBadge(diagnosis)}</td><td>${compactDiagnosisCell(diagnosis)}</td><td>${compactActionCell(diagnosis, 'country')}</td><td>${detailButton(groupDetailPayload(group, 'country'))}</td></tr>`; }, '当前筛选条件下没有国家 / 地区数据。', 'b2cCountryToggle', 'countries', expanded, '个国家');
}

function renderCampaignTable(rows, diagnostics, expanded, sortKey) {
  const groups = groupRows(rows, diagnostics, 'campaign', sortKey);
  setTable('b2cCampaignTable', ['Campaign', 'Countries', 'Spend', 'Impressions', 'Reach', 'Frequency', 'Link Clicks', 'CTR', 'CPC', 'LPV', 'ATC', 'Checkout', 'Purchases', 'CPA', 'Meta GMV', 'ROAS', 'Risk Level', 'Diagnosis', 'Suggested Action', 'Details'], groups, group => { const diagnosis = layeredGroup(group, 'campaign'); return `<tr><td><span class="name" title="${esc(group.name)}">${esc(titleText(group.name, 30))}</span></td><td>${esc(group.countries.join(', '))}</td><td>${money(group.spend)}</td><td>${integer(group.impressions)}</td><td>${integer(group.reach)}</td><td>${group.frequency === null ? '—' : `${fixed(group.frequency)} 次`}</td><td>${integer(group.linkClicks)}</td><td>${rate(group.ctr)}</td><td>${money(group.cpc)}</td><td>${integer(group.landingPageViews)}</td><td>${integer(group.addToCart)}</td><td>${integer(group.initiateCheckout)}</td><td>${integer(group.purchases)}</td><td>${money(group.cpa)}</td><td>${money(group.metaAttributedGmv)}</td><td>${fixed(group.roas)}</td><td>${riskBadge(diagnosis)}</td><td>${compactDiagnosisCell(diagnosis)}</td><td>${compactActionCell(diagnosis, 'campaign')}</td><td>${detailButton(groupDetailPayload(group, 'campaign'))}</td></tr>`; }, '当前筛选条件下没有 Campaign 数据。', 'b2cCampaignToggle', 'campaigns', expanded, '个 Campaign');
}

function renderCreativeTable(rows, diagnostics, expanded, sortKey) {
  const groups = groupRows(rows, diagnostics, 'creative', sortKey);
  setTable('b2cCreativeTable', ['Creative / Ad', 'Creative Type', 'Spend', 'Impressions', 'Reach', 'Frequency', 'CTR', 'CPC', 'Purchases', 'CPA', 'Meta GMV', 'ROAS', 'Risk Level', 'Diagnosis', 'Suggested Action', 'Details'], groups, group => { const diagnosis = layeredGroup(group, 'creative'); return `<tr><td><span class="name" title="${esc(group.name)}">${esc(titleText(group.name, 30))}</span></td><td>${esc(group.creativeTypes.join(', ') || '—')}</td><td>${money(group.spend)}</td><td>${integer(group.impressions)}</td><td>${integer(group.reach)}</td><td>${group.frequency === null ? '—' : `${fixed(group.frequency)} 次`}</td><td>${rate(group.ctr)}</td><td>${money(group.cpc)}</td><td>${integer(group.purchases)}</td><td>${money(group.cpa)}</td><td>${money(group.metaAttributedGmv)}</td><td>${fixed(group.roas)}</td><td>${riskBadge(diagnosis)}</td><td>${compactDiagnosisCell(diagnosis)}</td><td>${compactActionCell(diagnosis, 'creative')}</td><td>${detailButton(groupDetailPayload(group, 'creative'))}</td></tr>`; }, '当前筛选条件下没有素材数据。', 'b2cCreativeToggle', 'creatives', expanded, '个素材');
}

function renderCommerceRiskOverview(diagnostics, selectedFilter) {
  const host = byId('b2cRiskDistribution');
  if (!host) return;
  const levels = ['excellent', 'normal', 'watch', 'high', 'extreme'];
  const counts = levels.reduce((all, level) => ({ ...all, [level]: diagnostics.filter(item => item.d.level === level).length }), {});
  host.innerHTML = levels.map(level => {
    const [label] = levelMeta(level);
    return `<button type="button" class="commerce-risk-summary ${riskClass(level)} ${selectedFilter === level ? 'active' : ''}" data-commerce-risk-filter="${level}" aria-pressed="${String(selectedFilter === level)}"><b>${counts[level]}</b><span>${label}</span></button>`;
  }).join('');
}

function renderCommerceDetailTable(rows, diagnostics, visibleCount, riskFilter, actions = {}) {
  const diagnosisByGroup = new Map(diagnostics.map(item => [item.id, item.d]));
  const details = rows.map(row => ({ ...row, d: diagnosisByGroup.get(`${row.campaign}|${row.country}`) || { level: 'normal', label: '正常', rule: '等待更多购买样本', advice: '当前记录尚未形成可诊断的 Campaign / 国家组合。' } }))
    .filter(row => riskFilter === 'all' || row.d.level === riskFilter)
    .sort((a, b) => RISK_ORDER[a.d.level] - RISK_ORDER[b.d.level] || Number(b.spend || 0) - Number(a.spend || 0));
  const table = byId('b2cRiskTable');
  const toggle = byId('b2cRiskTableToggle');
  if (!table || !toggle) return;
  const visible = visibleDetailItems(details, visibleCount);
  const columnCount = 34;
  // #b2cRiskTable is the tbody. The one static thead in index.html is intentional.
  table.innerHTML = details.length ? visible.map(row => {
    const metrics = commerceTotals([row]);
    const frequency = metrics.frequency === null ? '—' : `${Number(metrics.frequency).toFixed(1)} 次`;
    const payload = detailPayloadForRow(row, row.d);
    const layered = buildLayeredRecommendation({ diagnosis: row.d, scope: 'ad', name: row.ad || row.creative || row.campaign, metrics: row });
    const primary = row.d.primaryDiagnosis || derivePrimaryDiagnosis(row.d);
    return `<tr><td>${esc(String(row.dateEnd || row.dateStart || row.date || '—'))}</td><td>${riskBadge(row.d)}</td><td>${esc(row.country || '—')}</td><td>${esc(row.accountName || row.accountId || '—')}</td><td><span class="name" title="${esc(row.campaign || '')}">${esc(titleText(row.campaign || '—', 24))}</span></td><td>${esc(row.adSet || '—')}</td><td>${esc(row.ad || '—')}</td><td>${esc(row.creative || '—')}</td><td>${esc(row.placement || '—')}</td><td>${metrics.availableMetrics.spend ? money(metrics.spend) : '—'}</td><td>${metrics.availableMetrics.impressions ? integer(metrics.impressions) : '—'}</td><td>${metrics.availableMetrics.reach ? integer(metrics.reach) : '—'}</td><td>${frequency}</td><td>${metrics.availableMetrics.clicks ? integer(metrics.linkClicks) : '—'}</td><td>${rate(metrics.ctr)}</td><td>${money(metrics.cpc)}</td><td>${money(metrics.cpm)}</td><td>${metrics.availableMetrics.landingPageViews ? integer(metrics.landingPageViews) : '—'}</td><td>${rate(metrics.lpvRate)}</td><td>${metrics.availableMetrics.addToCart ? integer(metrics.addToCart) : '—'}</td><td>${rate(metrics.atcRate)}</td><td>${metrics.availableMetrics.initiateCheckout ? integer(metrics.initiateCheckout) : '—'}</td><td>${rate(metrics.checkoutRate)}</td><td>${metrics.availableMetrics.purchases ? integer(metrics.purchases) : '—'}</td><td>${rate(metrics.checkoutCompletionRate)}</td><td>${rate(metrics.purchaseCvr)}</td><td>${metrics.availableMetrics.metaAttributedGmv ? money(metrics.metaAttributedGmv) : '—'}</td><td>${money(metrics.cpa)}</td><td>${money(metrics.aov)}</td><td>${fixed(metrics.roas)}</td><td>${esc(primary.label)}</td><td>${esc(layered.recommendedAction)}</td><td>${detailButton(payload)}</td><td>${candidateStatusCell(row, row.d, actions)}</td></tr>`;
  }).join('') : `<tr><td colspan="${columnCount}"><div class="empty">${esc(riskFilter === 'all' ? '当前筛选条件下没有可分析的电商广告数据。' : '当前风险等级下没有广告明细。')}</div></td></tr>`;
  toggle.innerHTML = detailListToggle(details.length, visibleCount);
}

export function renderCommerceAnalysisModules({ rows, diagnostics, expandedLists = {}, riskVisibleCount = DISPLAY_LIMIT, riskFilter = 'all', sort = {}, actions = {} }) {
  renderCommerceRiskOverview(diagnostics, riskFilter);
  renderCountryTable(rows, diagnostics, Boolean(expandedLists.countries), sort.countries || 'spend');
  renderCampaignTable(rows, diagnostics, Boolean(expandedLists.campaigns), sort.campaigns || 'spend');
  renderCreativeTable(rows, diagnostics, Boolean(expandedLists.creatives), sort.creatives || 'spend');
  renderCommerceDetailTable(rows, diagnostics, riskVisibleCount, riskFilter, actions);
}

export function renderCommerceDashboard({ rows, diagnostics, expandedLists = {}, riskVisibleCount = DISPLAY_LIMIT, riskFilter = 'all', sort = {}, trendMetric = 'spend', actions = {}, rules = {} }) {
  const totals = commerceTotals(rows);
  const hasData = rows.length > 0;
  const available = totals.availableMetrics;
  const kpis = [
    metricCard('spend', '广告花费', hasData && available.spend ? money(totals.spend) : '—', '当前筛选范围 USD', '$'),
    metricCard('leads', '购买次数', hasData && available.purchases ? integer(totals.purchases) : '—', 'Meta Purchases', '▣'),
    metricCard('cpl', 'Meta Attributed GMV', hasData && available.metaAttributedGmv ? money(totals.metaAttributedGmv) : '—', 'Meta 归因销售额', '↗'),
    metricCard('clicks', 'Purchase ROAS', hasData && totals.roas !== null ? fixed(totals.roas) : '—', 'Meta GMV ÷ Spend', '×'),
    metricCard('cpm', 'CPA / Cost per Purchase', hasData && totals.cpa !== null ? money(totals.cpa) : '—', 'Spend ÷ Purchases', '◎'),
    metricCard('spend', 'AOV / Average Order Value', hasData && totals.aov !== null ? money(totals.aov) : '—', 'Meta GMV ÷ Purchases', '◈'),
    metricCard('clicks', '覆盖人数', hasData && available.reach ? integer(totals.reach) : '—', '当前筛选范围覆盖人数', '◉'),
    metricCard('cpm', '平均频次', hasData && totals.frequency !== null ? `${totals.frequency.toFixed(1)} 次` : '—', '平均每位用户看到广告次数', '↻'),
    metricCard('leads', 'Link Clicks', hasData && available.clicks ? integer(totals.linkClicks) : '—', '链接点击量', '↗'),
    metricCard('clicks', 'Link CTR', hasData && totals.ctr !== null ? rate(totals.ctr) : '—', '链接点击 ÷ 展示次数', '%'),
    metricCard('cpl', 'CPC', hasData && totals.cpc !== null ? money(totals.cpc) : '—', '每次链接点击成本', '¢'),
    metricCard('cpm', 'CPM', hasData && totals.cpm !== null ? money(totals.cpm) : '—', '每千次展示花费', '◉')
  ];
  byId('b2cMetrics').innerHTML = kpis.join('');
  byId('b2cAdviceMeta').textContent = `当前分析 ${diagnostics.length} 个 Campaign / 国家组合`;
  renderCommerceAdvice(diagnostics, Boolean(expandedLists.advice), rules);
  renderCommerceTrend(rows, trendMetric);
  renderFunnel('b2cFunnelCompact', totals, true);
  const funnelNote = byId('b2cFunnelCompact')?.parentElement?.querySelector('.commerce-funnel-missing-note');
  if (funnelNote) funnelNote.remove();
  const hasFunnelMetric = ['landingPageViews', 'addToCart', 'initiateCheckout', 'purchases'].some(key => available[key]);
  if (hasData && !hasFunnelMetric) byId('b2cFunnelCompact')?.insertAdjacentHTML('afterend', '<p class="mini-note commerce-funnel-missing-note">当前导入文件未包含 LPV / ATC / Checkout 等漏斗指标。</p>');
  renderCommerceAnalysisModules({ rows, diagnostics, expandedLists, riskVisibleCount, riskFilter, sort, actions });
  const source = byId('b2cDataSummary');
  if (source) source.textContent = hasData ? `已读取 ${rows.length} 条 Meta 广告记录；Meta Purchases 和 Meta Attributed GMV 不等同于店铺真实订单或 Store GMV。` : 'B2C 模式使用与 B2B 相同的 Meta 数据导入、国家、Campaign 和日期筛选条件。';
}

export function renderFunnelPage({ rows, diagnostics }) {
  const totals = commerceTotals(rows);
  renderFunnel('b2cFunnelFull', totals, false);
  const host = byId('b2cFunnelSummary');
  if (!host) return;
  const high = diagnostics.filter(item => item.d.level === 'extreme' || item.d.level === 'high').length;
  const watch = diagnostics.filter(item => item.d.level === 'watch').length;
  host.innerHTML = `<div class="funnel-summary-grid"><div><small>LPV Rate</small><b class="${totals.lpvRate !== null && totals.lpvRate < .7 ? 'watch' : ''}">${rate(totals.lpvRate)}</b><span>点击后成功到达落地页的比例</span></div><div><small>ATC Rate</small><b class="${totals.atcRate !== null && totals.atcRate < .05 ? 'high' : ''}">${rate(totals.atcRate)}</b><span>落地页访问后产生加购的比例</span></div><div><small>Checkout Rate</small><b class="${totals.checkoutRate !== null && totals.checkoutRate < .35 ? 'high' : ''}">${rate(totals.checkoutRate)}</b><span>加购后进入结账流程的比例</span></div><div><small>Checkout Completion Rate</small><b class="${totals.checkoutCompletionRate !== null && totals.checkoutCompletionRate < .45 ? 'high' : ''}">${rate(totals.checkoutCompletionRate)}</b><span>结账后最终完成购买的比例</span></div><div><small>Purchase CVR</small><b>${rate(totals.purchaseCvr)}</b><span>链接点击后完成购买的比例</span></div><div><small>当前诊断重点</small><b class="${high ? 'high' : watch ? 'watch' : 'excellent'}">${high ? `${high} 项高风险` : watch ? `${watch} 项观察` : '表现稳定'}</b><span>优先根据 ROAS、CPA 和漏斗异常定位问题</span></div></div>`;
}

export function renderCommerceRulesForm(rules, frequencyRules) {
  const fields = [
    ['targetRoas', '目标 ROAS', 0.1, 0.1], ['targetCpa', '目标 CPA', 1, 0.01], ['roasWatchRatio', '观察 ROAS 比例', 0.05, 0, 1], ['roasHighRiskRatio', '高风险 ROAS 比例', 0.05, 0, 1],
    ['cpaWatchMultiplier', 'CPA 观察倍数', 0.1, 0], ['cpaHighRiskMultiplier', 'CPA 高风险倍数', 0.1, 0], ['noPurchaseHighSpendMultiplier', '无购买高风险花费倍数', 0.1, 0], ['noPurchaseStopSpendMultiplier', '无购买关停候选倍数', 0.1, 0], ['highCpaStopMultiplier', '高 CPA 关停候选倍数', 0.1, 0], ['lowRoasStopRatio', '极低 ROAS 倍数', 0.05, 0, 1]
  ];
  const grid = byId('b2cRulesGrid');
  const commerceFields = fields.map(([key, label, step, min, max]) => `<label>${label}<input id="commerceRule-${key}" data-commerce-rule="${key}" type="number" min="${min}"${max !== undefined ? ` max="${max}"` : ''} step="${step}" value="${rules[key]}"></label>`).join('');
  const frequencyFields = [
    ['frequencyWarningThreshold', 'Frequency 观察值', 2.5],
    ['frequencyHighRiskThreshold', 'Frequency 高风险值', 4]
  ].map(([key, label, fallback]) => `<label>${label}<input id="commerceRule-${key}" data-frequency-rule="${key}" type="number" min="0" max="20" step="0.1" value="${frequencyRules?.[key] ?? fallback}"></label>`).join('');
  grid.innerHTML = `${commerceFields}${frequencyFields}`;
}

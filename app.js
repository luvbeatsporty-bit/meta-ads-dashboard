import { BUSINESS_MODE, DEFAULT_COMMERCE_RULES, DEFAULT_RULES, LEAD_FIELDS, createAdRecord } from './data-model.js';
import { parseAdImportPreview, previewAdFiles } from './excel-import.js';
import { applyMappingOverrides, getMetricLabel, mappingConfidenceLabel } from './field-mapper.js';
import { readLeadFiles, suggestedMapping, mapLeadFiles, matchLeadsToAds } from './lead-import.js';
import { money, integer, pct, esc, titleText, sumAds, summarise, diagnosticGroups, leadMetrics, classifyLead, averageFrequency, frequencySignals } from './metrics.js';
import { diagnose, RISK_ORDER } from './diagnosis.js';
import { renderCharts } from './charts.js';
import { downloadCsv } from './export.js';
import { loadActions, saveActions, saveDashboardData, loadDashboardData } from './storage.js';
import { commerceDiagnostics } from './commerce-diagnosis.js';
import { getCommerceDetail, renderCommerceAnalysisModules, renderCommerceAdvice, renderCommerceDashboard, renderCommerceRulesForm, renderCommerceTrend, renderFunnelPage } from './commerce-ui.js';

const $ = id => document.getElementById(id);
const RULES_KEY = 'personal-ads-intelligence-rules-v1';
const BUSINESS_MODE_KEY = 'personal-ads-intelligence-business-mode-v1';
const COMMERCE_STOP_HITS_KEY = 'personal-ads-intelligence-commerce-stop-hits-v1';
const ACTION_SCOPE = 'default';
const COMMERCE_ACTION_SCOPE = 'b2c';
const LIST_LIMIT = 5;
const RULE_INPUTS = {
  extremeSpend: 'extremeSpendRule',
  extremeClicks: 'extremeClicksRule',
  highCpl: 'highCplRule',
  highClicks: 'highClicksRule',
  highConversionPercent: 'highConversionRule',
  highValidCpl: 'highValidCplRule',
  lowValidRatePercent: 'lowValidRateRule',
  watchSpend: 'watchSpendRule',
  watchCpl: 'watchCplRule',
  watchCtrPercent: 'watchCtrRule',
  excellentCpl: 'excellentCplRule',
  frequencyWarningThreshold: 'frequencyWarningThresholdRule',
  frequencyHighRiskThreshold: 'frequencyHighRiskThresholdRule'
};

const state = {
  ads: [],
  commerceAds: [],
  leads: [],
  matches: [],
  charts: {},
  actions: {},
  commerceActions: {},
  rules: { ...DEFAULT_RULES },
  commerceRules: { ...DEFAULT_COMMERCE_RULES },
  businessMode: localStorage.getItem(BUSINESS_MODE_KEY) === BUSINESS_MODE.B2C_ECOMMERCE ? BUSINESS_MODE.B2C_ECOMMERCE : BUSINESS_MODE.B2B_LEAD,
  commerceExpanded: { advice: false, risks: false, countries: false, campaigns: false, creatives: false },
  commerceRiskVisibleCount: LIST_LIMIT,
  commerceRiskFilter: 'all',
  commerceSort: { countries: 'spend', campaigns: 'spend', creatives: 'spend' },
  commerceTrendMetric: 'spend',
  commerceStopHits: {},
  pendingLeadFiles: [],
  pendingAdImport: null,
  source: '未导入',
  commerceSource: '未导入',
  adviceFilter: 'all',
  riskFilter: 'all',
  expandedLists: { risks: false, countryQuality: false, campaigns: false },
  chartPanels: { risk: false, country: false, campaign: false },
  overviewChartsExpanded: true,
  overview: {
    trendGranularity: 'day',
    trendVisible: { spend: true, lead: true, cpl: true },
    campaignMetric: 'lead',
    riskHidden: {}
  },
  changedSinceStartup: false
};

function loadRules() {
  try {
    const saved = JSON.parse(localStorage.getItem(RULES_KEY) || '{}');
    // Migrate the existing flat B2B rule object without changing its values.
    if (saved && (saved.b2b || saved.b2c)) return { b2b: { ...DEFAULT_RULES, ...(saved.b2b || {}) }, b2c: { ...DEFAULT_COMMERCE_RULES, ...(saved.b2c || {}) } };
    return { b2b: { ...DEFAULT_RULES, ...saved }, b2c: { ...DEFAULT_COMMERCE_RULES } };
  } catch {
    return { b2b: { ...DEFAULT_RULES }, b2c: { ...DEFAULT_COMMERCE_RULES } };
  }
}

function persistRules() {
  localStorage.setItem(RULES_KEY, JSON.stringify({ b2b: state.rules, b2c: state.commerceRules }));
}

function loadCommerceStopHits() {
  try { return JSON.parse(localStorage.getItem(COMMERCE_STOP_HITS_KEY) || '{}') || {}; } catch { return {}; }
}

function persistCommerceStopHits() {
  localStorage.setItem(COMMERCE_STOP_HITS_KEY, JSON.stringify(state.commerceStopHits));
}

function commerceRules() {
  return { ...state.commerceRules, frequencyWarningThreshold: state.rules.frequencyWarningThreshold, frequencyHighRiskThreshold: state.rules.frequencyHighRiskThreshold, watchCtrPercent: state.rules.watchCtrPercent };
}

function commerceItems() {
  return commerceDiagnostics(selectedAds(), commerceRules(), state.commerceStopHits);
}

function commerceRiskDetailCount() {
  const diagnosisByGroup = new Map(commerceItems().map(item => [item.id, item.d]));
  return selectedAds().filter(row => {
    const level = diagnosisByGroup.get(`${row.campaign}|${row.country}`)?.level || 'normal';
    return state.commerceRiskFilter === 'all' || level === state.commerceRiskFilter;
  }).length;
}

function advanceCommerceRiskDetailRows() {
  const total = commerceRiskDetailCount();
  if (state.commerceRiskVisibleCount >= total) {
    state.commerceRiskVisibleCount = LIST_LIMIT;
    return;
  }
  const next = state.commerceRiskVisibleCount <= LIST_LIMIT
    ? 50
    : state.commerceRiskVisibleCount + 50;
  state.commerceRiskVisibleCount = Math.min(next, total);
}

function recordCommerceDiagnosticPass() {
  const rules = commerceRules();
  const candidates = commerceDiagnostics(selectedAds(), rules, {});
  const next = {};
  candidates.forEach(item => {
    const qualifies = item.purchases === 0 && item.spend >= rules.targetCpa * rules.noPurchaseStopSpendMultiplier && item.dayCount >= 2;
    next[item.id] = qualifies ? Math.min((state.commerceStopHits[item.id] || 0) + 1, 2) : 0;
  });
  state.commerceStopHits = next;
  persistCommerceStopHits();
}

function toast(text) {
  const element = $('toast');
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
}

function activeAds() {
  return state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE ? state.commerceAds : state.ads;
}

function selectedAds() {
  const country = $('countryFilter').value;
  const campaign = $('campaignFilter').value;
  const search = $('searchInput').value.trim().toLowerCase();
  return activeAds().filter(ad => (
    (!country || ad.country === country)
    && (!campaign || ad.campaign === campaign)
    && (!search || `${ad.country} ${ad.campaign} ${ad.adSet} ${ad.ad} ${ad.creative}`.toLowerCase().includes(search))
  ));
}

function dateRange() {
  const dates = activeAds().flatMap(ad => [ad.dateStart, ad.dateEnd]).filter(Boolean).sort();
  $('rangeText').value = dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '未识别报告日期';
}

function populateFilters() {
  const setOptions = (id, values, label) => {
    const element = $(id);
    const previous = element.value;
    element.innerHTML = `<option value="">全部${label}</option>${values.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('')}`;
    element.value = values.includes(previous) ? previous : '';
  };

  const ads = activeAds();
  setOptions('countryFilter', [...new Set(ads.map(ad => ad.country))].filter(Boolean).sort(), '国家 / 地区');
  setOptions('campaignFilter', [...new Set(ads.map(ad => ad.campaign))].filter(Boolean).sort(), '广告系列');
}

function currentQuality() {
  const ads = selectedAds();
  return leadMetrics(state.leads, ads, state.matches, new Set(ads.map(ad => ad.id)));
}

function groupQuality(group) {
  return leadMetrics(state.leads, group.rows, state.matches, new Set(group.rows.map(ad => ad.id)));
}

function diagnostics() {
  return diagnosticGroups(selectedAds())
    .map(group => {
      const quality = groupQuality(group);
      const frequency = frequencySignals(group.rows, state.rules.excellentCpl, {
        warningThreshold: state.rules.frequencyWarningThreshold,
        highRiskThreshold: state.rules.frequencyHighRiskThreshold
      });
      return {
        ...group,
        ...frequency,
        quality,
        d: diagnose(group, state.rules, quality, frequency.signals),
        local: state.actions[group.id] || ''
      };
    })
    .sort((a, b) => RISK_ORDER[a.d.level] - RISK_ORDER[b.d.level] || b.spend - a.spend);
}

function statusText(item) {
  return item.local || '待人工复核';
}


function countryQualityRankings(countries, items) {
  return countries.map(country => {
    const related = items.filter(item => item.country === country.name);
    const counts = { extreme: 0, high: 0, watch: 0, normal: 0, excellent: 0 };
    related.forEach(item => { counts[item.d.level] += 1; });

    let score = 55;
    if (!country.results) score -= 28;
    else if (country.cpl <= state.rules.excellentCpl) score += 22;
    else if (country.cpl <= state.rules.watchCpl) score += 12;
    else if (country.cpl > state.rules.highCpl) score -= 15;

    if (country.ctr >= state.rules.watchCtrPercent / 100) score += 10;
    else if (country.impressions) score -= 7;
    if (country.results >= 5) score += 4;
    score += counts.excellent * 5;
    score -= counts.watch * 7 + counts.high * 18 + counts.extreme * 34;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const level = score >= 80 ? '优秀' : score >= 65 ? '良好' : score >= 45 ? '观察' : '需优化';
    const tone = score >= 80 ? 'excellent' : score >= 65 ? 'normal' : score >= 45 ? 'watch' : 'critical';
    const riskCount = counts.extreme + counts.high + counts.watch;
    return { ...country, score, level, tone, counts, riskCount };
  }).sort((a, b) => b.score - a.score || b.results - a.results || a.cpl - b.cpl);
}

function riskCounts(items) {
  const counts = { all: items.length, extreme: 0, high: 0, watch: 0, normal: 0, excellent: 0 };
  items.forEach(item => { counts[item.d.level] += 1; });
  return counts;
}

function filteredRiskItems(items) {
  if (state.riskFilter === 'critical') return items.filter(item => item.d.level === 'extreme' || item.d.level === 'high');
  return state.riskFilter === 'all' ? items : items.filter(item => item.d.level === state.riskFilter);
}

function resetB2BViewState() {
  state.expandedLists = { risks: false, countryQuality: false, campaigns: false };
}

function resetCommerceViewState() {
  state.commerceExpanded = { advice: false, risks: false, countries: false, campaigns: false, creatives: false };
  state.commerceRiskVisibleCount = LIST_LIMIT;
  state.commerceRiskFilter = 'all';
  state.commerceSort = { countries: 'spend', campaigns: 'spend', creatives: 'spend' };
  state.commerceTrendMetric = 'spend';
}

function resetExpandedLists() {
  resetB2BViewState();
  resetCommerceViewState();
}

function resetDetailCharts() {
  state.chartPanels = { risk: false, country: false, campaign: false };
}

function refreshForFilterChange() {
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
}

function visibleItems(items, key) {
  return state.expandedLists[key] ? items : items.slice(0, LIST_LIMIT);
}

function renderListToggle(id, key, total, { noun = '条', expandLabel = '展开全部', collapseLabel = '收起，仅显示前 5 条' } = {}) {
  const container = $(id);
  if (!container) return;
  if (total <= LIST_LIMIT) {
    container.innerHTML = '';
    return;
  }
  const isExpanded = state.expandedLists[key];
  const label = isExpanded ? `${collapseLabel} ↑` : `${expandLabel}（共 ${total} ${noun}） ↓`;
  container.innerHTML = `<button type="button" class="list-toggle" data-list-toggle="${key}" aria-expanded="${String(isExpanded)}">${label}</button>`;
}

function adviceItems(items) {
  const counts = riskCounts(items);
  const best = items.find(item => item.d.level === 'excellent');
  const hasCategory = (item, category) => (item.d.categories || [item.d.category]).includes(category);
  const fatigueCount = items.filter(item => hasCategory(item, 'creativeFatigue')).length;
  const saturationCount = items.filter(item => hasCategory(item, 'audienceSaturation')).length;
  const fatigueHighCount = items.filter(item => item.d.level === 'high' && hasCategory(item, 'creativeFatigue')).length;
  const signalMeta = [fatigueCount ? `${fatigueCount} 个素材疲劳提醒` : '', saturationCount ? `${saturationCount} 个受众趋于饱和提醒` : ''].filter(Boolean).join(' · ');
  return [
    {
      kind: 'critical', filter: 'critical', icon: '!', label: '优先处理',
      title: `${counts.extreme + counts.high} 个广告需要优先处理`,
      meta: `${counts.extreme} 个极高风险 · ${counts.high} 个高风险${fatigueHighCount ? ` · ${fatigueHighCount} 个素材疲劳` : ''}`,
      text: fatigueHighCount ? '其中包含频次升高且 CTR、CPC 或 CPL 恶化的素材疲劳提醒，建议优先更换素材、封面或文案，不要继续增加预算。' : '存在持续消耗但没有 Lead、CPL 过高或转化异常的广告，建议优先检查素材、受众、表单和落地页。'
    },
    {
      kind: 'watch', filter: 'watch', icon: '◷', label: '继续观察',
      title: `${counts.watch} 个广告建议继续观察`,
      meta: signalMeta || '暂不建议立即调整',
      text: signalMeta ? '已识别素材疲劳或受众趋于饱和的早期信号，建议准备新素材、测试新封面或文案，并持续观察 CTR、CPC 和 CPL 变化。' : '当前数据处于观察区间，建议继续运行 2–3 天，并复查点击和转化表现。'
    },
    {
      kind: 'excellent', filter: 'excellent', icon: '↗', label: '表现较好',
      title: `${counts.excellent} 个广告可考虑小步扩量`,
      meta: best ? `${titleText(best.campaign, 18)} · ${best.country}` : '暂无符合扩量条件的广告',
      text: '当前 CPL、Lead 或转化表现较好，可尝试每次增加 10%–20% 预算，并持续观察成本变化。'
    }
  ];
}

function renderAdvice(items) {
  const list = $('adviceList');
  $('adviceMeta').textContent = `当前分析 ${items.length} 个广告组合`;
  if (!state.ads.length) {
    list.innerHTML = '<div class="empty">导入广告数据后，系统会在这里给出优先处理、继续观察和可扩量建议。</div>';
    return;
  }
  list.innerHTML = adviceItems(items).map(item => `
    <button type="button" class="advice-card ${item.kind}" data-risk-filter="${item.filter}">
      <span class="advice-icon">${item.icon}</span>
      <span class="advice-copy"><span class="advice-label">${item.label}</span><h3>${esc(item.title)}</h3><small>${esc(item.meta)}</small><p>${esc(item.text)}</p></span>
    </button>
  `).join('');
}

function focusRiskFilter(filter) {
  state.riskFilter = filter;
  resetExpandedLists();
  resetDetailCharts();
  switchView('dashboard');
  renderDashboard();
  $('riskCenter').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderRiskFilters(items) {
  const counts = riskCounts(items);
  const filters = [
    ['all', '全部', counts.all], ['extreme', '极高风险', counts.extreme], ['high', '高风险', counts.high],
    ['watch', '观察', counts.watch], ['normal', '正常', counts.normal], ['excellent', '优秀', counts.excellent]
  ];
  $('riskFilterBar').innerHTML = filters.map(([key, label, count]) => `
    <button type="button" class="risk-filter ${key} ${state.riskFilter === key ? 'active' : ''}" data-risk-filter="${key}">${label} <b>${count}</b></button>
  `).join('');
}

function renderAdviceModal() {
  const container = $('adviceDetailList');
  const filter = state.adviceFilter || 'all';
  const items = diagnostics().filter(item => {
    if (filter === 'critical') return item.d.level === 'extreme' || item.d.level === 'high';
    return filter === 'all' || item.d.level === filter;
  });
  document.querySelectorAll('[data-advice-filter]').forEach(button => button.classList.toggle('active', button.dataset.adviceFilter === filter));
  if (!items.length) {
    container.innerHTML = '<div class="empty">当前筛选范围内没有这一类建议。</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <article class="advice-detail ${item.d.level}" data-detail-id="${esc(item.id)}">
      <div class="advice-detail-head"><span class="pill ${item.d.level}">${esc(item.d.label)}</span><span>${esc(item.country)}</span></div>
      <h3 title="${esc(item.campaign)}">${esc(item.campaign)}</h3>
      <p><b>${esc(item.d.rule)}</b><br>${esc(item.d.advice)}</p>
      <div class="advice-stats"><span>花费 <b>${money(item.spend)}</b></span><span>Lead <b>${integer(item.results)}</b></span><span>CPL <b>${item.results ? money(item.cpl) : '—'}</b></span></div>
      <div class="detail-actions"><button class="small-btn" data-advice-action="focus" data-country="${esc(item.country)}" data-campaign="${esc(item.campaign)}">查看对应广告</button><button class="small-btn" data-advice-action="handled" data-id="${esc(item.id)}">标记已处理</button><button class="small-btn" data-advice-action="watch" data-id="${esc(item.id)}">加入观察</button></div>
    </article>
  `).join('');
}

function renderDashboard() {
  if (state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE) {
    const rows = selectedAds();
    const items = commerceItems();
    renderCommerceDashboard({
      rows,
      diagnostics: items,
      expandedLists: state.commerceExpanded,
      riskVisibleCount: state.commerceRiskVisibleCount,
      riskFilter: state.commerceRiskFilter,
      sort: state.commerceSort,
      trendMetric: state.commerceTrendMetric,
      actions: state.commerceActions,
      rules: commerceRules()
    });
    syncCommerceSortControls();
    renderFunnelPage({ rows, diagnostics: items });
    $('statusDot').classList.toggle('ready', state.commerceAds.length > 0);
    $('statusText').textContent = state.commerceAds.length ? `${state.commerceAds.length} 条 B2C 广告记录已载入 · B2C 电商模式` : '等待导入 B2C Meta 电商报表';
    $('b2cSourceLabel').textContent = state.commerceSource;
    return;
  }
  const rows = selectedAds();
  const total = sumAds(rows);
  const haveData = state.ads.length > 0;

  const available = total.availableMetrics;
  const frequency = averageFrequency(rows);
  $('mSpend').textContent = haveData && available.spend ? money(total.spend) : '—';
  $('mLeads').textContent = haveData && available.results ? integer(total.results) : '—';
  $('mCpl').textContent = haveData && total.cpl !== null ? money(total.cpl) : '—';
  $('mClicks').textContent = haveData && available.clicks ? integer(total.clicks) : '—';
  $('mCtr').textContent = haveData && total.ctr !== null ? pct(total.ctr) : '—';
  $('mCpm').textContent = haveData && total.cpm !== null ? money(total.cpm) : '—';
  $('mReach').textContent = haveData && available.reach ? integer(total.reach) : '—';
  $('mFrequency').textContent = haveData && frequency !== null ? `${frequency.toFixed(1)} 次` : '—';

  const countries = summarise(rows, 'country');
  const campaigns = summarise(rows, 'campaign');
  const items = diagnostics();
  const rankings = countryQualityRankings(countries, items);
  renderAdvice(items);
  renderStopPanel(items);
  renderTables(campaigns, rankings);
  renderRisks(items);
  renderCharts({ rows, items, rankings, campaigns, chartPanels: state.chartPanels, overview: state.overview });
  renderChartToggleButtons();
  renderOverviewControls();
  renderLeadQuality();
  renderDataQuality();

  $('statusDot').classList.toggle('ready', haveData);
  $('statusText').textContent = haveData ? `${state.ads.length} 条广告记录已载入` : '等待导入报表';
  $('dataSourceLabel').textContent = state.source;
}

function renderB2BListModules() {
  const rows = selectedAds();
  const countries = summarise(rows, 'country');
  const campaigns = summarise(rows, 'campaign');
  const items = diagnostics();
  const rankings = countryQualityRankings(countries, items);
  renderTables(campaigns, rankings);
  renderRisks(items);
}

function syncCommerceSortControls() {
  document.querySelectorAll('[data-commerce-sort]').forEach(button => {
    const [group, metric] = String(button.dataset.commerceSort || '').split(':');
    const active = state.commerceSort[group] === metric;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderCommerceAnalysisOnly() {
  const rows = selectedAds();
  const items = commerceItems();
  renderCommerceAnalysisModules({ rows, diagnostics: items, expandedLists: state.commerceExpanded, riskVisibleCount: state.commerceRiskVisibleCount, riskFilter: state.commerceRiskFilter, sort: state.commerceSort, actions: state.commerceActions });
  syncCommerceSortControls();
}

function renderCommerceAdviceOnly() {
  renderCommerceAdvice(commerceItems(), Boolean(state.commerceExpanded.advice), commerceRules());
}

function renderChartToggleButtons() {
  document.querySelectorAll('[data-chart-toggle]').forEach(button => {
    const key = button.dataset.chartToggle;
    const expanded = Boolean(state.chartPanels[key]);
    button.textContent = expanded ? '收起图表' : '查看图表';
    button.setAttribute('aria-expanded', String(expanded));
  });
}

function renderOverviewControls() {
  const expanded = state.overviewChartsExpanded;
  const content = $('coreChartsContent');
  const summary = $('coreChartsSummary');
  const toggle = $('overviewChartsToggle');
  if (content) content.hidden = !expanded;
  if (summary) summary.hidden = expanded;
  if (toggle) {
    toggle.textContent = expanded ? '收起图表' : '展开图表';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  document.querySelectorAll('[data-trend-granularity]').forEach(button => {
    button.classList.toggle('active', button.dataset.trendGranularity === state.overview.trendGranularity);
  });
  document.querySelectorAll('[data-overview-campaign-metric]').forEach(button => {
    button.classList.toggle('active', button.dataset.overviewCampaignMetric === state.overview.campaignMetric);
  });
  const campaignSubtitle = $('topCampaignsSubtitle');
  if (campaignSubtitle) {
    const labels = { lead: '按 Lead 排名', spend: '按花费排名', cpl: '按 CPL 从低到高' };
    campaignSubtitle.textContent = labels[state.overview.campaignMetric] || labels.lead;
  }
}

function renderStopPanel(items) {
  const extreme = items.filter(item => item.d.level === 'extreme');
  const panel = $('stopPanel');
  if (!extreme.length) {
    panel.classList.remove('show');
    panel.innerHTML = '';
    return;
  }
  panel.classList.add('show');
  panel.innerHTML = `
    <div class="stop-panel-copy"><span class="stop-icon">!</span><div><strong>发现 ${extreme.length} 个极高风险广告</strong><p>均达到关停候选条件，请优先复核。</p></div></div>
    <div class="stop-panel-actions"><button type="button" class="btn soft" data-stop-action="view">查看 ${extreme.length} 个广告</button><button type="button" class="btn primary" data-stop-action="export">导出关停候选</button></div>
  `;
}

function actionLabel(action) {
  const time = new Date().toLocaleString('zh-CN', { hour12: false });
  const labels = {
    handled: '已标记人工处理',
    watch: '保持观察',
    manualPause: '已记录人工暂停意向（未执行 Meta 操作）',
    ignore: '已忽略本次提醒'
  };
  return `${labels[action]} · ${time}`;
}

function saveAction(id, action) {
  if (action === 'restore') {
    delete state.actions[id];
    saveActions(ACTION_SCOPE, state.actions);
    toast('已恢复为待人工复核');
    return;
  }
  state.actions[id] = actionLabel(action);
  saveActions(ACTION_SCOPE, state.actions);
  toast(state.actions[id]);
}

function saveCommerceAction(id, action) {
  if (!id) return;
  if (action === 'restore') {
    delete state.commerceActions[id];
    saveActions(COMMERCE_ACTION_SCOPE, state.commerceActions);
    toast('B2C 已恢复为待人工复核');
    return;
  }
  state.commerceActions[id] = actionLabel(action);
  saveActions(COMMERCE_ACTION_SCOPE, state.commerceActions);
  toast(`B2C：${state.commerceActions[id]}`);
}

function closeCommerceDetail() {
  $('commerceDetailModal')?.classList.remove('open');
}

function renderCommerceDetailModal(detail) {
  if (!detail) return;
  const context = Array.isArray(detail.context) ? detail.context : [];
  const currentAction = detail.actionId ? state.commerceActions[detail.actionId] : '';
  $('commerceDetailEyebrow').textContent = detail.eyebrow || 'B2C DIAGNOSTIC DETAIL';
  $('commerceDetailTitle').textContent = detail.title || '诊断详情';
  const tags = Array.isArray(detail.diagnosisTags) ? detail.diagnosisTags.filter(Boolean) : [];
  const affectedObjects = Array.isArray(detail.affectedObjects) ? detail.affectedObjects : [];
  const formatCommerceNumber = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '—';
  const formatCommerceMoney = value => Number.isFinite(Number(value)) ? `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—';
  const formatCommerceRoas = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}×` : '—';
  const formatCommerceCpa = value => Number.isFinite(Number(value)) ? formatCommerceMoney(value) : '—';
  $('commerceDetailContent').innerHTML = `
    ${context.length ? `<dl class="commerce-detail-context">${context.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
    ${detail.primaryDiagnosis ? `<section class="commerce-detail-section"><h3>Primary Diagnosis</h3><p class="commerce-detail-copy">${esc(detail.primaryDiagnosis)}</p></section>` : ''}
    ${tags.length ? `<section class="commerce-detail-section"><h3>辅助诊断</h3><p class="commerce-detail-copy">${esc(tags.join(' · '))}</p></section>` : ''}
    <section class="commerce-detail-section"><h3>触发规则 / 风险原因</h3><p class="commerce-detail-copy">${esc(detail.rule || '—')}</p></section>
    <section class="commerce-detail-section"><h3>完整 AI 优化建议</h3><p class="commerce-detail-copy">${esc(detail.fullRecommendation || detail.recommendation || detail.text || '—')}</p></section>
    <section class="commerce-detail-section"><h3>建议操作</h3><p class="commerce-detail-copy">${esc(detail.recommendedAction || '继续观察')}</p></section>
    ${affectedObjects.length ? `<section class="commerce-detail-section"><h3>受影响对象（${affectedObjects.length} 个）</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Country</th><th>Campaign</th><th>Ad</th><th>Spend</th><th>Purchases</th><th>CPA</th><th>ROAS</th><th>Trigger Rule</th></tr></thead><tbody>${affectedObjects.map(item => `<tr><td>${esc(item.country || '—')}</td><td>${esc(item.campaign || '—')}</td><td>${esc(item.ad || '—')}</td><td>${formatCommerceMoney(item.spend)}</td><td>${formatCommerceNumber(item.purchases)}</td><td>${formatCommerceCpa(item.cpa)}</td><td>${formatCommerceRoas(item.roas)}</td><td>${esc(item.rule || '—')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
  `;
  $('commerceDetailActions').dataset.commerceDetailId = detail.id || '';
  $('commerceDetailActions').innerHTML = detail.stopCandidate && detail.actionId ? `
    <span class="mini-note">${esc(currentAction || '待人工确认')} · 仅记录人工处理，不会调用 Meta 暂停接口</span>
    <button type="button" class="small-btn" data-commerce-action="handled" data-commerce-action-id="${esc(detail.actionId)}">标记已处理</button>
    <button type="button" class="small-btn" data-commerce-action="watch" data-commerce-action-id="${esc(detail.actionId)}">保持观察</button>
    <button type="button" class="small-btn" data-commerce-action="manualPause" data-commerce-action-id="${esc(detail.actionId)}">人工暂停</button>
    <button type="button" class="small-btn" data-commerce-action="ignore" data-commerce-action-id="${esc(detail.actionId)}">忽略本次提醒</button>
  ` : '';
}

function openCommerceDetail(detailId) {
  const detail = getCommerceDetail(detailId);
  if (!detail) return;
  renderCommerceDetailModal(detail);
  $('commerceDetailModal').classList.add('open');
}

function renderRisks(items) {
  const body = $('riskTable');
  renderRiskFilters(items);
  if (!state.ads.length) {
    body.innerHTML = '<tr><td colspan="9"><div class="empty">请先上传 Excel 广告数据，系统会自动输出诊断与建议。</div></td></tr>';
    renderListToggle('riskTableToggle', 'risks', 0);
    return;
  }
  const filteredItems = filteredRiskItems(items);
  if (!filteredItems.length) {
    body.innerHTML = '<tr><td colspan="9"><div class="empty">当前风险状态下没有广告。可切换上方标签查看其他诊断结果。</div></td></tr>';
    renderListToggle('riskTableToggle', 'risks', 0);
    return;
  }

  body.innerHTML = visibleItems(filteredItems, 'risks').map(item => `
    <tr>
      <td><span class="pill ${item.d.level}">${esc(item.d.label)}</span></td>
      <td><div class="group-name" title="${esc(item.campaign)}">${esc(titleText(item.campaign, 34))}</div><span class="sub">${esc(item.country)}</span></td>
      <td>${money(item.spend)}</td>
      <td>${integer(item.results)}</td>
      <td>${item.results ? money(item.cpl) : '—'}</td>
      <td>${item.clicks ? pct(item.clickToLead) : '—'}<span class="sub">${integer(item.clicks)} 次链接点击</span></td>
      <td><div class="advice">${esc(item.d.rule)}</div></td>
      <td><div class="advice">${esc(item.d.advice)}</div></td>
      <td><div>${esc(statusText(item))}</div><div class="row-actions"><button class="small-btn" data-action="detail" data-id="${esc(item.id)}">查看详情</button><button class="small-btn" data-action="handled" data-id="${esc(item.id)}">标记已处理</button><button class="small-btn" data-action="watch" data-id="${esc(item.id)}">保持观察</button><button class="small-btn" data-action="ignore" data-id="${esc(item.id)}">忽略本次提醒</button>${item.local ? `<button class="small-btn" data-action="restore" data-id="${esc(item.id)}">恢复未处理</button>` : ''}</div></td>
    </tr>
  `).join('');
  renderListToggle('riskTableToggle', 'risks', filteredItems.length);
}

function renderTables(campaigns, rankings) {
  const visibleRankings = visibleItems(rankings, 'countryQuality');
  $('countryQualityTable').innerHTML = rankings.length
    ? visibleRankings.map((item, index) => `<tr><td><span class="rank">${index + 1}</span></td><td class="name" title="${esc(item.name)}">${esc(item.name)}</td><td><b class="score-value ${item.tone}">${item.score}</b></td><td><span class="quality-level ${item.tone}">${item.level}</span></td><td>${money(item.spend)}</td><td>${integer(item.results)}</td><td>${item.results ? money(item.cpl) : '—'}</td><td>${pct(item.ctr)}</td><td>${item.riskCount ? `${item.riskCount} 项` : '—'}</td></tr>`).join('')
    : '<tr><td colspan="9"><div class="empty">当前筛选条件下没有数据。</div></td></tr>';
  renderListToggle('countryQualityToggle', 'countryQuality', rankings.length, { noun: '个国家', expandLabel: '展开全部国家', collapseLabel: '收起，仅显示前 5 个国家' });

  const visibleCampaigns = visibleItems(campaigns, 'campaigns');
  $('campaignTable').innerHTML = campaigns.length
    ? visibleCampaigns.map((item, index) => `<tr><td><span class="rank">${index + 1}</span></td><td class="name" title="${esc(item.name)}">${esc(item.name)}</td><td title="${esc([...item.countries].join('、'))}">${esc(titleText([...item.countries].join('、'), 18))}</td><td>${money(item.spend)}</td><td>${integer(item.results)}</td><td>${item.results ? money(item.cpl) : '—'}</td><td>${integer(item.clicks)}</td><td>${money(item.cpm)}</td></tr>`).join('')
    : '<tr><td colspan="8"><div class="empty">当前筛选条件下没有数据。</div></td></tr>';
  renderListToggle('campaignTableToggle', 'campaigns', campaigns.length, { noun: '个 Campaign', expandLabel: '展开全部 Campaign', collapseLabel: '收起，仅显示前 5 个 Campaign' });
}

function renderLeadQuality() {
  const quality = currentQuality();
  $('leadSourceLabel').textContent = quality.hasSalesData ? `已导入 ${state.leads.length} 条记录` : '未导入';
  $('leadTotal').textContent = quality.hasSalesData ? integer(quality.total) : '—';
  $('leadMatched').textContent = quality.hasSalesData ? integer(quality.matchedCount) : '—';
  $('validLead').textContent = quality.hasSalesData ? integer(quality.validCount) : '—';
  $('validLeadRate').textContent = quality.validRate === null ? '—' : pct(quality.validRate);
  $('validLeadCpl').textContent = quality.validCpl === null ? '—' : money(quality.validCpl);

  const content = $('leadQualityContent');
  if (!quality.hasSalesData) {
    $('leadQualitySummary').textContent = '尚未导入 Lead 明细，因此没有 Lead 质量结论。';
    content.className = 'quality-content empty';
    content.textContent = '请导入 Lead CSV 或 Excel 文件。字段映射可识别广告名称、Campaign、国家、提交时间与 Lead 状态。';
    return;
  }

  $('leadQualitySummary').textContent = quality.hasQualityStatus
    ? `当前筛选广告对应 ${quality.matchedCount} 条已匹配 Lead，${quality.pendingCount} 条待确认，${quality.unmatchedCount} 条未匹配。有效 Lead 率和有效 Lead CPL 仅统计已匹配、非重复、非内部测试的有效 Lead。`
    : `已导入 ${quality.total} 条 Lead，但文件没有可识别的销售状态或“是否有效”字段；系统不会生成有效 Lead 率、有效 Lead CPL 或质量结论。`;

  const matchByLead = new Map(state.matches.map(match => [match.leadId, match]));
  content.className = 'quality-content';
  content.innerHTML = `
    <div class="quality-grid">
      <div class="quality-item"><b>${integer(quality.validCount)}</b><p>有效 Lead（已匹配）</p></div>
      <div class="quality-item"><b>${integer(quality.invalidCount)}</b><p>无效 Lead（已匹配）</p></div>
      <div class="quality-item"><b>${integer(quality.duplicateCount)}</b><p>重复 Lead（已匹配）</p></div>
      <div class="quality-item"><b>${integer(quality.pendingLeadCount)}</b><p>待跟进 / 无法联系</p></div>
      <div class="quality-item"><b>${integer(quality.pendingCount)}</b><p>待确认匹配</p></div>
      <div class="quality-item"><b>${quality.total ? pct(quality.matchedCount / quality.total) : '—'}</b><p>数据匹配率</p></div>
    </div>
    <div class="table-wrap"><table class="data-table quality-table"><thead><tr><th>Lead ID</th><th>状态</th><th>Campaign / 国家</th><th>匹配结果</th><th>匹配优先级</th></tr></thead><tbody>
      ${state.leads.map(lead => {
        const match = matchByLead.get(lead.id);
        const display = classifyLead(lead);
        const category = display.valid ? '有效' : display.invalid ? '无效' : display.duplicate ? '重复' : display.internal ? '内部测试' : '待跟进 / 未判定';
        const result = match?.matchStatus === 'matched' ? '已匹配' : match?.matchStatus === 'pending' ? '待确认' : '未匹配';
        return `<tr><td>${esc(lead.leadId)}</td><td>${esc(lead.status || category)}<span class="sub">${esc(category)}</span></td><td>${esc(lead.campaign || '—')}<span class="sub">${esc(lead.country || '未填写')}</span></td><td><span class="match-status ${match?.matchStatus || 'unmatched'}">${result}</span></td><td>${esc(match?.matchMethod || '未匹配')}</td></tr>`;
      }).join('')}
    </tbody></table></div>`;
}

function renderDataQuality() {
  const container = $('qualityContent');
  const isCommerce = state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE;
  const ads = isCommerce ? state.commerceAds : state.ads;
  const count = field => ads.filter(ad => Object.hasOwn(ad.sourceRows || {}, field) || String(ad[field] ?? '').trim()).length;
  const adSummary = ads.length ? `${ads.length} 条广告记录` : '未导入';

  if (isCommerce) {
    const availability = field => ads.length ? `${Math.round(count(field) / ads.length * 100)}%` : '—';
    container.innerHTML = `
      <div class="quality-item"><b>${adSummary}</b><p>B2C 广告数据载入情况</p></div>
      <div class="quality-item"><b>${availability('spend')}</b><p>Spend 字段可用率（0 值也视为有效）</p></div>
      <div class="quality-item"><b>${availability('impressions')}</b><p>Impressions 字段可用率；缺失时 CTR、CPM 仅显示 —</p></div>
      <div class="quality-item"><b>${availability('clicks')}</b><p>Link Clicks 字段可用率；缺失时漏斗点击率仅显示 —</p></div>
      <div class="quality-item"><b>${availability('purchases')}</b><p>Purchases 字段可用率；缺失时无法判断 CPA 和购买转化</p></div>
      <div class="quality-item"><b>${availability('metaAttributedGmv')}</b><p>Meta Attributed GMV 字段可用率；缺失时 ROAS、AOV 仅显示 —</p></div>`;
    return;
  }

  const leads = state.leads;
  const quality = currentQuality();
  const qualityText = leads.length ? `已匹配 ${quality.matchedCount}，待确认 ${quality.pendingCount}，未匹配 ${quality.unmatchedCount}` : '尚未导入销售 Lead 文件';
  container.innerHTML = `
    <div class="quality-item"><b>${adSummary}</b><p>广告数据载入情况</p></div>
    <div class="quality-item"><b>${ads.length ? `${Math.round(count('spend') / ads.length * 100)}%` : '—'}</b><p>花费字段可用率（0 值也视为有效）</p></div>
    <div class="quality-item"><b>${ads.length ? `${Math.round(count('impressions') / ads.length * 100)}%` : '—'}</b><p>展示字段可用率；缺失时 CTR、CPM 仅显示 —</p></div>
    <div class="quality-item"><b>${ads.length ? `${Math.round(count('clicks') / ads.length * 100)}%` : '—'}</b><p>链接点击字段可用率；缺失时转化率仅显示 —</p></div>
    <div class="quality-item"><b>${leads.length ? `${Math.round(quality.matchedCount / leads.length * 100)}%` : '—'}</b><p>Lead 匹配率：${qualityText}</p></div>
    <div class="quality-item"><b>${quality.hasQualityStatus ? '已提供' : '未提供'}</b><p>销售状态字段；未提供时不会生成有效 Lead 率和有效 Lead CPL 结论</p></div>`;
}

function renderMapping() {
  const headers = [...new Set(state.pendingLeadFiles.flatMap(file => file.headers))];
  const suggested = suggestedMapping(headers);
  $('mappingFields').innerHTML = LEAD_FIELDS.map(([key, label]) => `
    <label>${esc(label)}
      <select data-field="${esc(key)}"><option value="">不导入 / 未提供</option>${headers.map(header => `<option value="${esc(header)}" ${suggested[key] === header ? 'selected' : ''}>${esc(header)}</option>`).join('')}</select>
    </label>
  `).join('');
  $('mappingModal').classList.add('open');
}

function markDataChanged() { state.changedSinceStartup = true; }

async function persistImportedData() {
  return Boolean(await saveDashboardData({
    ads: state.ads,
    commerceAds: state.commerceAds,
    leads: state.leads,
    matches: state.matches,
    source: state.source,
    commerceSource: state.commerceSource
  }));
}

async function applyLeadMapping() {
  const mapping = Object.fromEntries([...$('mappingFields').querySelectorAll('select')].map(select => [select.dataset.field, select.value]));
  markDataChanged();
  state.leads = mapLeadFiles(state.pendingLeadFiles, mapping);
  state.matches = matchLeadsToAds(state.leads, state.ads);
  $('mappingModal').classList.remove('open');
  const saved = await persistImportedData();
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
  toast(`已导入 ${state.leads.length} 条 Lead；请在 Lead 质量页查看匹配情况${saved ? '（已保存在本机浏览器）' : '；浏览器未能保存到本机'}`);
}

function placeSharedFilterBar() {
  const filter = $('sharedFilterBar');
  if (!filter) return;
  const target = state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE ? $('b2cMetrics') : $('dashboardView').querySelector('.metrics');
  if (target && filter.nextElementSibling !== target) target.before(filter);
}

function switchBusinessMode(mode) {
  if (!Object.values(BUSINESS_MODE).includes(mode)) return;
  state.businessMode = mode;
  localStorage.setItem(BUSINESS_MODE_KEY, mode);
  document.body.dataset.businessMode = mode;
  document.querySelectorAll('button[data-business-mode]').forEach(button => button.classList.toggle('active', button.dataset.businessMode === mode));
  placeSharedFilterBar();
  populateFilters();
  dateRange();
  resetExpandedLists();
  resetDetailCharts();
  switchView(mode === BUSINESS_MODE.B2C_ECOMMERCE ? 'ecommerce' : 'dashboard');
  renderDashboard();
}

function switchView(view) {
  const allowedViews = state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE
    ? new Set(['ecommerce', 'funnel', 'quality', 'rules'])
    : new Set(['dashboard', 'leads', 'quality', 'rules']);
  if (!allowedViews.has(view)) view = state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE ? 'ecommerce' : 'dashboard';
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `${view}View`));
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'rules') renderRulesForm();
  if (view === 'funnel' || view === 'quality') renderDashboard();
  document.body.classList.remove('nav-open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderRulesForm() {
  const isCommerce = state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE;
  const heading = $('rulesView').querySelector('.overview-heading');
  if (heading) {
    heading.querySelector('.eyebrow').textContent = isCommerce ? 'ECOMMERCE DIAGNOSTIC RULES' : 'DIAGNOSTIC RULES';
    heading.querySelector('h1').textContent = isCommerce ? 'B2C 电商规则设置' : '规则设置';
    heading.querySelector('p').textContent = isCommerce ? '调整 ROAS、CPA 与无购买阈值后，电商广告诊断将立即按新规则重新计算。' : '调整阈值后，广告诊断将立即按新规则重新计算。';
  }
  if (isCommerce) {
    renderCommerceRulesForm(state.commerceRules, state.rules);
    return;
  }
  Object.entries(RULE_INPUTS).forEach(([key, id]) => { $(id).value = state.rules[key]; });
}

function saveRules() {
  if (state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE) {
    const next = { ...state.commerceRules };
    document.querySelectorAll('[data-commerce-rule]').forEach(input => {
      const key = input.dataset.commerceRule;
      const value = Number(input.value);
      next[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_COMMERCE_RULES[key];
    });
    const nextFrequencyRules = { ...state.rules };
    document.querySelectorAll('[data-frequency-rule]').forEach(input => {
      const key = input.dataset.frequencyRule;
      const value = Number(input.value);
      nextFrequencyRules[key] = Number.isFinite(value) && value >= 0 && value <= 20 ? value : DEFAULT_RULES[key];
    });
    if (nextFrequencyRules.frequencyHighRiskThreshold < nextFrequencyRules.frequencyWarningThreshold) { toast('高风险 Frequency 必须大于或等于观察 Frequency。'); return; }
    if (next.targetRoas <= 0) { toast('目标 ROAS 必须大于 0。'); return; }
    if (next.targetCpa <= 0) { toast('目标 CPA 必须大于 0。'); return; }
    if (next.roasWatchRatio < 0 || next.roasWatchRatio > 1 || next.roasHighRiskRatio < 0 || next.roasHighRiskRatio > 1) { toast('ROAS 比例必须在 0 到 1 之间。'); return; }
    if (next.roasHighRiskRatio > next.roasWatchRatio) { toast('高风险 ROAS 比例不能高于观察 ROAS 比例。'); return; }
    if (next.cpaHighRiskMultiplier < next.cpaWatchMultiplier) { toast('CPA 高风险倍数必须大于或等于观察倍数。'); return; }
    if (next.noPurchaseStopSpendMultiplier < next.noPurchaseHighSpendMultiplier) { toast('无购买关停候选倍数必须大于或等于高风险花费倍数。'); return; }
    if (next.highCpaStopMultiplier < next.cpaHighRiskMultiplier) { toast('高 CPA 关停候选倍数必须大于或等于 CPA 高风险倍数。'); return; }
    if (next.lowRoasStopRatio > next.roasHighRiskRatio) { toast('极低 ROAS 倍数不能高于高风险 ROAS 比例。'); return; }
    state.commerceRules = next;
    state.rules = nextFrequencyRules;
    recordCommerceDiagnosticPass();
    persistRules();
    resetExpandedLists();
    renderDashboard();
    toast('B2C 电商规则已保存并重新诊断');
    return;
  }
  const nextRules = { ...state.rules };
  Object.entries(RULE_INPUTS).forEach(([key, id]) => {
    const value = Number($(id).value);
    const isFrequencyRule = key === 'frequencyWarningThreshold' || key === 'frequencyHighRiskThreshold';
    nextRules[key] = Number.isFinite(value) && value >= 0 && (!isFrequencyRule || value <= 20)
      ? value
      : DEFAULT_RULES[key];
  });
  if (nextRules.frequencyHighRiskThreshold < nextRules.frequencyWarningThreshold) {
    toast('高风险 Frequency 必须大于或等于观察 Frequency。');
    return;
  }
  state.rules = nextRules;
  persistRules();
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
  toast('规则已保存并重新诊断');
}

function resetRules() {
  if (state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE) {
    state.commerceRules = { ...DEFAULT_COMMERCE_RULES };
    persistRules();
    renderRulesForm();
    resetExpandedLists();
    renderDashboard();
    toast('已恢复 B2C 默认规则');
    return;
  }
  state.rules = { ...DEFAULT_RULES };
  persistRules();
  renderRulesForm();
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
  toast('已恢复默认规则');
}

function exportDiagnostics(stopOnly) {
  let items = diagnostics();
  if (stopOnly) items = items.filter(item => item.d.level === 'extreme');
  if (!items.length) {
    toast('当前没有可导出的项目');
    return;
  }
  const rows = [[
    '风险状态', '广告系列', '国家/地区', '花费(USD)', '广告 Lead', 'CPL(USD)', '链接点击', '点击到Lead转化率', '触发判断', '系统建议', '人工处理状态', '处理说明'
  ]].concat(items.map(item => [
    item.d.label,
    item.campaign,
    item.country,
    item.spend.toFixed(2),
    item.results,
    item.results ? item.cpl.toFixed(2) : '',
    item.clicks,
    item.clicks ? `${(item.clickToLead * 100).toFixed(2)}%` : '',
    item.d.rule,
    item.d.advice,
    statusText(item),
    '导出项目与诊断理由，供后续处理。'
  ]));
  downloadCsv(stopOnly ? '个人广告看板_优先处理清单.csv' : '个人广告看板_完整诊断.csv', rows);
  toast(`已导出 ${items.length} 项${stopOnly ? '优先处理清单' : '诊断记录'}`);
}

async function loadDemo() {
  markDataChanged();
  const make = raw => createAdRecord(raw);
  state.ads = [
    make({ country: '美国', campaign: '春季表单测试', adSet: 'Broad', ad: '创意 A', spend: 42, results: 0, impressions: 2100, clicks: 41, dateStart: '2026-07-26', dateEnd: '2026-08-01' }),
    make({ country: '加拿大', campaign: 'B2B Lead', adSet: 'Lookalike', ad: '创意 B', spend: 28, results: 2, impressions: 1400, clicks: 49, dateStart: '2026-07-26', dateEnd: '2026-08-01' }),
    make({ country: '美国', campaign: '高意向关键词', adSet: 'Remarketing', ad: '创意 C', spend: 8, results: 1, impressions: 800, clicks: 18, dateStart: '2026-07-26', dateEnd: '2026-08-01' }),
    make({ country: '澳大利亚', campaign: '测试受众', adSet: 'Interest', ad: '创意 D', spend: 17, results: 1, impressions: 3300, clicks: 19, dateStart: '2026-07-26', dateEnd: '2026-08-01' })
  ];
  state.leads = [];
  state.matches = [];
  state.source = '演示数据';
  populateFilters();
  dateRange();
  recordCommerceDiagnosticPass();
  const saved = await persistImportedData();
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
  toast(`已加载演示数据（不是真实广告数据）${saved ? '，已保存在本机浏览器' : ''}`);
}

async function clearData() {
  markDataChanged();
  state.ads = [];
  state.leads = [];
  state.matches = [];
  state.source = '未导入';
  populateFilters();
  dateRange();
  const saved = await persistImportedData();
  resetB2BViewState();
  resetDetailCharts();
  renderDashboard();
  toast(saved ? '已清除 B2B 广告与 Lead 数据；B2C 数据保持不变' : '已清除 B2B 广告与 Lead 数据');
}

function openCommerceClearConfirm() {
  $('clearCommerceDataModal')?.classList.add('open');
}

function closeCommerceClearConfirm() {
  $('clearCommerceDataModal')?.classList.remove('open');
}

async function clearCommerceData() {
  closeCommerceClearConfirm();
  markDataChanged();
  state.commerceAds = [];
  state.commerceSource = '未导入';
  state.commerceStopHits = {};
  persistCommerceStopHits();
  state.commerceActions = {};
  saveActions(COMMERCE_ACTION_SCOPE, state.commerceActions);
  $('countryFilter').value = '';
  $('campaignFilter').value = '';
  $('searchInput').value = '';
  resetCommerceViewState();
  populateFilters();
  dateRange();
  const saved = await persistImportedData();
  renderDashboard();
  toast(saved ? '已清除 B2C 广告数据；B2B 数据和规则设置保持不变' : '已清除 B2C 广告数据；B2B 数据和规则设置保持不变');
}

function recognisedFieldCount(ads = []) {
  const fields = new Set();
  ads.forEach(ad => Object.entries(ad.availableMetrics || {}).forEach(([key, available]) => {
    if (available) fields.add(key);
  }));
  return fields.size;
}

function mappingPreviewModal() { return $('adImportMappingModal'); }

function previewNeedsReview(preview) {
  return preview.sheets.some(sheet => sheet.mapping.some(item => item.status === 'needs_confirmation'));
}

function pendingImportOverrides() {
  const modal = mappingPreviewModal();
  return Object.fromEntries([...modal.querySelectorAll('[data-ad-import-map]')].map(select => [select.dataset.adImportMap, select.value]));
}

function renderAdImportMappingPreview() {
  const pending = state.pendingAdImport;
  if (!pending) return;
  const modal = mappingPreviewModal();
  const rows = pending.preview.sheets.flatMap(sheet => sheet.mapping.map(item => ({ ...item, sheetName: sheet.sheetName })));
  const confirmed = rows.filter(item => item.status === 'confirmed');
  const review = rows.filter(item => item.status === 'needs_confirmation');
  const unused = rows.filter(item => item.status === 'unused');
  $('adImportMappingSummary').textContent = `已识别 ${confirmed.length} 个字段${review.length ? `；${review.length} 个字段需要确认` : ''}${unused.length ? `；${unused.length} 个未使用` : ''}。`;
  const fieldRow = item => {
    const options = ['<option value="ignore">不导入 / 未使用</option>', ...item.candidates.map(metric => `<option value="${esc(metric)}">${esc(getMetricLabel(metric))}</option>`)].join('');
    const control = item.status === 'needs_confirmation'
      ? `<select data-ad-import-map="${esc(item.id)}">${options}</select>`
      : `<span class="ad-import-mapping-status ${esc(item.status)}">${item.status === 'confirmed' ? `${esc(getMetricLabel(item.canonicalMetric))} · ${esc(mappingConfidenceLabel(item.confidence))}` : '未使用'}</span>`;
    return `<div class="ad-import-mapping-row"><div><b>${esc(item.sourceHeader || '（空表头）')}</b><small>${esc(item.sheetName)} · ${esc(item.matchType)}</small></div><div>${control}</div></div>`;
  };
  $('adImportMappingConfirmed').innerHTML = confirmed.length ? confirmed.map(fieldRow).join('') : '<div class="empty">暂未自动确认字段。</div>';
  $('adImportMappingReview').innerHTML = review.length ? review.map(fieldRow).join('') : '<div class="mini-note">没有需要人工确认的歧义字段。</div>';
  $('adImportMappingUnused').innerHTML = unused.length ? unused.map(fieldRow).join('') : '<div class="mini-note">没有未使用字段。</div>';
  $('applyAdImportMappingButton').textContent = review.length ? '确认字段并导入' : '确认导入';
  modal.classList.add('open');
}

async function beginAdImport(files, mode) {
  const selected = [...(files || [])];
  if (!selected.length) return;
  const extensions = mode === BUSINESS_MODE.B2C_ECOMMERCE ? /\.(xlsx|xls|csv)$/i : /\.(xlsx|csv)$/i;
  if (mode === BUSINESS_MODE.B2B_LEAD && selected.some(file => /\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name))) {
    toast('旧版 .xls 文件请先另存为 .xlsx 或 CSV 后再导入。');
    return;
  }
  const usable = selected.filter(file => extensions.test(file.name));
  if (!usable.length) {
    toast(mode === BUSINESS_MODE.B2C_ECOMMERCE ? 'B2C 广告报表导入失败：仅支持 .xlsx、.xls 或 .csv 文件。' : '请选择 .xlsx 或 .csv 格式的广告报表。');
    return;
  }
  if (usable.some(file => !file.size)) {
    toast(mode === BUSINESS_MODE.B2C_ECOMMERCE ? 'B2C 广告报表导入失败：文件为空。' : '广告报表导入失败：文件为空。');
    return;
  }
  try {
    const preview = await previewAdFiles(usable);
    if (!preview.confirmedColumns && !preview.sheets.some(sheet => sheet.mapping.some(item => item.status === 'needs_confirmation'))) {
      toast(mode === BUSINESS_MODE.B2C_ECOMMERCE ? 'B2C 广告报表导入失败：未识别到可支持的 Meta 广告字段，请检查文件表头。' : '未识别到可支持的 Meta 广告字段，请检查文件表头。');
      return;
    }
    state.pendingAdImport = { mode, files: usable, preview };
    renderAdImportMappingPreview();
  } catch (error) {
    console.error('广告报表字段识别失败', error);
    toast(mode === BUSINESS_MODE.B2C_ECOMMERCE ? commerceImportErrorMessage(error) : `广告报表导入失败：${String(error?.message || '请检查文件格式和内容。')}`);
  }
}

async function applyAdImportMapping() {
  const pending = state.pendingAdImport;
  if (!pending) return;
  const overrides = pendingImportOverrides();
  const effective = pending.preview.sheets.flatMap(sheet => applyMappingOverrides(sheet.mapping, overrides));
  if (!effective.some(item => item.status === 'confirmed' && item.internalKey)) {
    toast('请至少确认一个可导入的广告字段。');
    return;
  }
  try {
    const ads = parseAdImportPreview(pending.preview, overrides);
    if (!ads.length) {
      toast(pending.mode === BUSINESS_MODE.B2C_ECOMMERCE ? 'B2C 广告报表导入失败：没有可用数据记录。' : '广告报表导入失败：没有可用数据记录。');
      return;
    }
    markDataChanged();
    if (pending.mode === BUSINESS_MODE.B2C_ECOMMERCE) {
      state.commerceAds = ads;
      state.commerceSource = `B2C Meta ${pending.files.every(file => /\.csv$/i.test(file.name)) ? 'CSV' : 'Excel'}`;
      resetCommerceViewState();
    } else {
      state.ads = ads;
      state.leads = [];
      state.matches = [];
      state.source = 'Meta Excel';
      resetExpandedLists();
      resetDetailCharts();
    }
    populateFilters();
    dateRange();
    recordCommerceDiagnosticPass();
    const saved = await persistImportedData();
    mappingPreviewModal().classList.remove('open');
    state.pendingAdImport = null;
    renderDashboard();
    const prefix = pending.mode === BUSINESS_MODE.B2C_ECOMMERCE ? ' 条 B2C 广告记录' : ' 条广告记录';
    const mappedLabels = [...new Set(effective.filter(item => item.status === 'confirmed' && item.canonicalMetric).map(item => getMetricLabel(item.canonicalMetric)))];
    const fieldResult = mappedLabels.length ? `；字段识别：${mappedLabels.slice(0, 8).join('、')}${mappedLabels.length > 8 ? '等' : ''}` : '';
    toast(`已导入 ${ads.length}${prefix}，识别到 ${recognisedFieldCount(ads)} 个可分析字段${fieldResult}${saved ? '，已保存在本机浏览器' : '；浏览器未能保存到本机'}`);
  } catch (error) {
    console.error('广告报表导入失败', error);
    toast(pending.mode === BUSINESS_MODE.B2C_ECOMMERCE ? commerceImportErrorMessage(error) : `广告报表导入失败：${String(error?.message || '请检查文件格式和内容。')}`);
  }
}

function closeAdImportMappingPreview() {
  mappingPreviewModal().classList.remove('open');
  state.pendingAdImport = null;
}

async function importAds(files) { return beginAdImport(files, BUSINESS_MODE.B2B_LEAD); }

function commerceImportErrorMessage(error) {
  const message = String(error?.message || '').trim();
  if (/empty|为空/i.test(message)) return 'B2C 广告报表导入失败：文件为空。';
  if (/xlsx|workbook|zip|excel/i.test(message)) return 'B2C 广告报表导入失败：Excel 文件无法解析，请确认文件未损坏。';
  return `B2C 广告报表导入失败${message ? `：${message}` : '，请检查文件格式和内容。'}`;
}

async function importCommerceAds(files) { return beginAdImport(files, BUSINESS_MODE.B2C_ECOMMERCE); }

async function prepareLeads(files) {
  const selected = [...files];
  if (selected.some(file => /\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name))) { toast('旧版 .xls Lead 文件请先另存为 .xlsx 或 CSV 后再导入。'); return; }
  const usable = selected.filter(file => /\.(csv|xlsx)$/i.test(file.name));
  if (!usable.length) { toast('请选择 .xlsx 或 .csv 格式的 Lead 文件。'); return; }
  const data = await readLeadFiles(usable);
  if (!data.length) {
    toast('无法读取 Lead 文件，请检查文件内容与格式。');
    return;
  }
  state.pendingLeadFiles = data;
  renderMapping();
}

function bindDrop(zoneId, handler) {
  const zone = $(zoneId);
  ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => {
    event.preventDefault();
    zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => {
    event.preventDefault();
    zone.classList.remove('over');
  }));
  zone.addEventListener('drop', event => handler(event.dataTransfer.files));
}

function focusCampaign(country, campaign) {
  $('countryFilter').value = country || '';
  $('campaignFilter').value = campaign || '';
  $('searchInput').value = '';
  state.riskFilter = 'all';
  resetExpandedLists();
  resetDetailCharts();
  $('adviceModal').classList.remove('open');
  switchView('dashboard');
  renderDashboard();
  $('riskTable').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindEvents() {
  $('adFileInput').addEventListener('change', async event => {
    try { await importAds(event.target.files); } finally { event.target.value = ''; }
  });
  const commerceFileInput = $('commerceFileInput');
  $('commerceUploadButton').addEventListener('click', () => {
    // Reset before opening the picker so selecting the same report after clearing data fires change again.
    commerceFileInput.value = '';
    commerceFileInput.click();
  });
  commerceFileInput.addEventListener('change', async event => {
    try {
      await importCommerceAds(event.target.files);
    } finally {
      // Permit consecutive imports of the same B2C report without requiring a page refresh.
      event.target.value = '';
    }
  });
  $('leadFileInput').addEventListener('change', event => prepareLeads(event.target.files));
  bindDrop('adDropZone', importAds);
  bindDrop('b2cAdDropZone', async files => {
    try { await importCommerceAds(files); } catch { /* importCommerceAds reports user-facing errors */ }
  });
  bindDrop('leadDropZone', prepareLeads);

  ['countryFilter', 'campaignFilter'].forEach(id => $(id).addEventListener('change', refreshForFilterChange));
  $('searchInput').addEventListener('input', refreshForFilterChange);
  $('resetButton').addEventListener('click', () => {
    $('countryFilter').value = '';
    $('campaignFilter').value = '';
    $('searchInput').value = '';
    refreshForFilterChange();
  });

  $('guideButton').addEventListener('click', () => $('guideModal').classList.add('open'));
  $('closeGuide').addEventListener('click', () => $('guideModal').classList.remove('open'));
  $('closeMapping').addEventListener('click', () => $('mappingModal').classList.remove('open'));
  $('cancelMappingButton').addEventListener('click', () => $('mappingModal').classList.remove('open'));
  $('viewAllAdviceButton').addEventListener('click', () => { state.adviceFilter = 'all'; renderAdviceModal(); $('adviceModal').classList.add('open'); });
  $('closeAdvice').addEventListener('click', () => $('adviceModal').classList.remove('open'));
  $('closeCommerceDetail').addEventListener('click', closeCommerceDetail);
  ['guideModal', 'mappingModal', 'adImportMappingModal', 'adviceModal', 'commerceDetailModal'].forEach(id => $(id).addEventListener('click', event => {
    if (event.target === $(id)) $(id).classList.remove('open');
  }));
  $('adviceFilterBar').addEventListener('click', event => {
    const button = event.target.closest('[data-advice-filter]');
    if (!button) return;
    state.adviceFilter = button.dataset.adviceFilter;
    renderAdviceModal();
  });
  $('adviceDetailList').addEventListener('click', event => {
    const button = event.target.closest('[data-advice-action]');
    if (!button) return;
    const action = button.dataset.adviceAction;
    if (action === 'focus') { focusCampaign(button.dataset.country, button.dataset.campaign); return; }
    saveAction(button.dataset.id, action);
    renderAdviceModal();
    renderDashboard();
  });
  $('applyMappingButton').addEventListener('click', applyLeadMapping);
  $('applyAdImportMappingButton').addEventListener('click', applyAdImportMapping);
  $('cancelAdImportMappingButton').addEventListener('click', closeAdImportMappingPreview);
  $('closeAdImportMapping').addEventListener('click', closeAdImportMappingPreview);

  $('adviceList').addEventListener('click', event => {
    const button = event.target.closest('[data-risk-filter]');
    if (button) focusRiskFilter(button.dataset.riskFilter);
  });
  $('riskFilterBar').addEventListener('click', event => {
    const button = event.target.closest('[data-risk-filter]');
    if (!button) return;
    state.riskFilter = button.dataset.riskFilter;
    resetExpandedLists();
    resetDetailCharts();
    renderDashboard();
  });
  $('dashboardView').addEventListener('click', event => {
    const overviewToggle = event.target.closest('[data-overview-toggle]');
    if (overviewToggle) {
      state.overviewChartsExpanded = !state.overviewChartsExpanded;
      renderDashboard();
      return;
    }
    const granularityButton = event.target.closest('[data-trend-granularity]');
    if (granularityButton) {
      state.overview.trendGranularity = granularityButton.dataset.trendGranularity;
      renderDashboard();
      return;
    }
    const seriesButton = event.target.closest('[data-trend-series]');
    if (seriesButton) {
      const key = seriesButton.dataset.trendSeries;
      const enabled = state.overview.trendVisible[key];
      const visibleCount = Object.values(state.overview.trendVisible).filter(Boolean).length;
      if (!enabled || visibleCount > 1) state.overview.trendVisible[key] = !enabled;
      renderDashboard();
      return;
    }
    const campaignMetricButton = event.target.closest('[data-overview-campaign-metric]');
    if (campaignMetricButton) {
      state.overview.campaignMetric = campaignMetricButton.dataset.overviewCampaignMetric;
      renderDashboard();
      return;
    }
    const riskLegend = event.target.closest('[data-risk-legend]');
    if (riskLegend) {
      const key = riskLegend.dataset.riskLegend;
      state.overview.riskHidden[key] = !state.overview.riskHidden[key];
      renderDashboard();
      return;
    }
    const alertButton = event.target.closest('[data-alert-filter]');
    if (alertButton) {
      focusRiskFilter(alertButton.dataset.alertFilter || 'all');
      return;
    }
    const overviewLink = event.target.closest('[data-overview-link]');
    if (overviewLink) {
      const destination = overviewLink.dataset.overviewLink === 'country' ? $('countryQualityCard') : $('campaignRankingCard');
      destination?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const chartButton = event.target.closest('[data-chart-toggle]');
    if (chartButton) {
      const key = chartButton.dataset.chartToggle;
      if (Object.hasOwn(state.chartPanels, key)) {
        state.chartPanels[key] = !state.chartPanels[key];
        renderDashboard();
      }
      return;
    }
    const button = event.target.closest('[data-list-toggle]');
    if (!button) return;
    const key = button.dataset.listToggle;
    if (!Object.hasOwn(state.expandedLists, key)) return;
    event.preventDefault();
    event.stopPropagation();
    state.expandedLists[key] = !state.expandedLists[key];
    // Only refresh the affected B2B list modules. The prior full-dashboard
    // re-render plus scrollIntoView caused collapse/expand to jump the page.
    renderB2BListModules();
  });
  $('stopPanel').addEventListener('click', event => {
    const button = event.target.closest('[data-stop-action]');
    if (!button) return;
    if (button.dataset.stopAction === 'export') { exportDiagnostics(true); return; }
    focusRiskFilter('extreme');
  });
  $('riskTable').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'detail') {
      state.adviceFilter = 'all';
      renderAdviceModal();
      $('adviceModal').classList.add('open');
      const target = $('adviceDetailList').querySelector(`[data-detail-id="${CSS.escape(button.dataset.id)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    saveAction(button.dataset.id, button.dataset.action);
    renderDashboard();
  });

  $('exportAllButton').addEventListener('click', () => exportDiagnostics(false));
  $('exportStopButton').addEventListener('click', () => exportDiagnostics(true));
  $('demoButton').addEventListener('click', loadDemo);
  $('clearDataButton').addEventListener('click', clearData);
  $('clearCommerceDataButton').addEventListener('click', openCommerceClearConfirm);
  $('confirmClearCommerceDataButton').addEventListener('click', clearCommerceData);
  $('cancelClearCommerceDataButton').addEventListener('click', closeCommerceClearConfirm);
  $('cancelClearCommerceDataButtonSecondary').addEventListener('click', closeCommerceClearConfirm);
  $('saveRulesButton').addEventListener('click', saveRules);
  $('resetRulesButton').addEventListener('click', resetRules);
  document.querySelectorAll('button[data-business-mode]').forEach(button => button.addEventListener('click', () => switchBusinessMode(button.dataset.businessMode)));
  $('ecommerceView').addEventListener('click', event => {
    const detailButton = event.target.closest('[data-commerce-detail-id]');
    if (detailButton) {
      event.preventDefault();
      event.stopPropagation();
      openCommerceDetail(detailButton.dataset.commerceDetailId);
      return;
    }
    const actionButton = event.target.closest('[data-commerce-action]');
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      saveCommerceAction(actionButton.dataset.commerceActionId, actionButton.dataset.commerceAction);
      renderCommerceAnalysisOnly();
      return;
    }
    const listButton = event.target.closest('[data-commerce-list-toggle]');
    if (listButton) {
      const key = listButton.dataset.commerceListToggle;
      if (!Object.hasOwn(state.commerceExpanded, key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === 'risks') advanceCommerceRiskDetailRows();
      else state.commerceExpanded[key] = !state.commerceExpanded[key];
      if (key === 'advice') renderCommerceAdviceOnly();
      else renderCommerceAnalysisOnly();
      return;
    }
    const trendButton = event.target.closest('[data-commerce-trend]');
    if (trendButton) {
      state.commerceTrendMetric = trendButton.dataset.commerceTrend;
      renderCommerceTrend(selectedAds(), state.commerceTrendMetric);
      return;
    }
    const riskButton = event.target.closest('[data-commerce-risk-filter]');
    if (riskButton) {
      state.commerceRiskFilter = riskButton.dataset.commerceRiskFilter;
      state.commerceRiskVisibleCount = LIST_LIMIT;
      renderCommerceAnalysisOnly();
      return;
    }
    const sortButton = event.target.closest('[data-commerce-sort]');
    if (sortButton) {
      const [group, metric] = String(sortButton.dataset.commerceSort || '').split(':');
      if (!Object.hasOwn(state.commerceSort, group) || !metric) return;
      state.commerceSort[group] = metric;
      state.commerceExpanded[group] = false;
      renderCommerceAnalysisOnly();
    }
  });
  $('commerceDetailActions').addEventListener('click', event => {
    const actionButton = event.target.closest('[data-commerce-action]');
    if (!actionButton) return;
    event.preventDefault();
    event.stopPropagation();
    saveCommerceAction(actionButton.dataset.commerceActionId, actionButton.dataset.commerceAction);
    renderCommerceAnalysisOnly();
    const detail = getCommerceDetail($('commerceDetailActions').dataset.commerceDetailId || '');
    if (detail) renderCommerceDetailModal(detail);
    else closeCommerceDetail();
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) switchView(button.dataset.view);
  });
  document.querySelector('.menu-icon').addEventListener('click', () => document.body.classList.toggle('nav-open'));
}

function init() {
  const savedRules = loadRules();
  state.rules = savedRules.b2b;
  state.commerceRules = savedRules.b2c;
  state.commerceStopHits = loadCommerceStopHits();
  document.body.dataset.businessMode = state.businessMode;
  state.actions = loadActions(ACTION_SCOPE);
  state.commerceActions = loadActions(COMMERCE_ACTION_SCOPE);
  renderRulesForm();
  placeSharedFilterBar();
  document.querySelectorAll('button[data-business-mode]').forEach(button => button.classList.toggle('active', button.dataset.businessMode === state.businessMode));
  populateFilters();
  dateRange();
  renderDashboard();
  bindEvents();
  // Restore the persisted business mode's view on a fresh load. Without this,
  // a saved B2C mode could render B2C data into hidden hosts while the B2B
  // dashboard view remained active on screen.
  switchView(state.businessMode === BUSINESS_MODE.B2C_ECOMMERCE ? 'ecommerce' : 'dashboard');

  // 导入按钮必须立即可用；本机历史数据在后台恢复，避免本地存储异常时阻塞文件选择。
  loadDashboardData().then(saved => {
    if (state.changedSinceStartup || !saved || (!Array.isArray(saved.ads) || !saved.ads.length) && (!Array.isArray(saved.commerceAds) || !saved.commerceAds.length)) return;
    state.ads = Array.isArray(saved.ads) ? saved.ads : [];
    state.commerceAds = Array.isArray(saved.commerceAds) ? saved.commerceAds : [];
    state.leads = Array.isArray(saved.leads) ? saved.leads : [];
    state.matches = Array.isArray(saved.matches) ? saved.matches : [];
    state.source = saved.source || 'Meta Excel';
    state.commerceSource = saved.commerceSource || '未导入';
    populateFilters();
    dateRange();
    renderDashboard();
  }).catch(() => {});
}

init();

import { DEFAULT_RULES, LEAD_FIELDS, createAdRecord } from './data-model.js';
import { importAdFiles } from './excel-import.js';
import { readLeadFiles, suggestedMapping, mapLeadFiles, matchLeadsToAds } from './lead-import.js';
import { money, integer, pct, esc, titleText, sumAds, summarise, diagnosticGroups, leadMetrics, classifyLead, averageFrequency, frequencySignals } from './metrics.js';
import { diagnose, RISK_ORDER } from './diagnosis.js';
import { renderCharts } from './charts.js';
import { downloadCsv } from './export.js';
import { loadActions, saveActions, saveDashboardData, loadDashboardData, clearDashboardData } from './storage.js';

const $ = id => document.getElementById(id);
const RULES_KEY = 'personal-ads-intelligence-rules-v1';
const ACTION_SCOPE = 'default';
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
  leads: [],
  matches: [],
  charts: {},
  actions: {},
  rules: { ...DEFAULT_RULES },
  pendingLeadFiles: [],
  source: '未导入',
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
    return { ...DEFAULT_RULES, ...saved };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function persistRules() {
  localStorage.setItem(RULES_KEY, JSON.stringify(state.rules));
}

function toast(text) {
  const element = $('toast');
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
}

function selectedAds() {
  const country = $('countryFilter').value;
  const campaign = $('campaignFilter').value;
  const search = $('searchInput').value.trim().toLowerCase();
  return state.ads.filter(ad => (
    (!country || ad.country === country)
    && (!campaign || ad.campaign === campaign)
    && (!search || `${ad.country} ${ad.campaign} ${ad.adSet} ${ad.ad} ${ad.creative}`.toLowerCase().includes(search))
  ));
}

function dateRange() {
  const dates = state.ads.flatMap(ad => [ad.dateStart, ad.dateEnd]).filter(Boolean).sort();
  $('rangeText').value = dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '未识别报告日期';
}

function populateFilters() {
  const setOptions = (id, values, label) => {
    const element = $(id);
    const previous = element.value;
    element.innerHTML = `<option value="">全部${label}</option>${values.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('')}`;
    element.value = values.includes(previous) ? previous : '';
  };

  setOptions('countryFilter', [...new Set(state.ads.map(ad => ad.country))].filter(Boolean).sort(), '国家 / 地区');
  setOptions('campaignFilter', [...new Set(state.ads.map(ad => ad.campaign))].filter(Boolean).sort(), '广告系列');
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

function resetExpandedLists() {
  state.expandedLists = { risks: false, countryQuality: false, campaigns: false };
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
  container.innerHTML = `<button type="button" class="list-toggle" data-list-toggle="${key}">${label}</button>`;
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
  const rows = selectedAds();
  const total = sumAds(rows);
  const haveData = state.ads.length > 0;

  const reachAvailable = rows.some(row => Object.hasOwn(row.sourceRows || {}, 'reach') || Number(row.reach) > 0);
  const frequency = averageFrequency(rows);
  $('mSpend').textContent = haveData ? money(total.spend) : '—';
  $('mLeads').textContent = haveData ? integer(total.results) : '—';
  $('mCpl').textContent = haveData && total.results ? money(total.spend / total.results) : '—';
  $('mClicks').textContent = haveData ? integer(total.clicks) : '—';
  $('mCtr').textContent = haveData ? pct(total.impressions ? total.clicks / total.impressions : 0) : '—';
  $('mCpm').textContent = haveData ? money(total.impressions ? total.spend / total.impressions * 1000 : 0) : '—';
  $('mReach').textContent = haveData && reachAvailable ? integer(total.reach) : '—';
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
  const ads = state.ads;
  const leads = state.leads;
  const quality = currentQuality();
  const count = field => ads.filter(ad => Object.hasOwn(ad.sourceRows || {}, field) || String(ad[field] ?? '').trim()).length;
  const adSummary = ads.length ? `${ads.length} 条广告记录` : '未导入';
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
    leads: state.leads,
    matches: state.matches,
    source: state.source
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

function switchView(view) {
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `${view}View`));
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'rules') renderRulesForm();
  document.body.classList.remove('nav-open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderRulesForm() {
  Object.entries(RULE_INPUTS).forEach(([key, id]) => { $(id).value = state.rules[key]; });
}

function saveRules() {
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
  await clearDashboardData();
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
  toast('已清除本机浏览器中保存的数据');
}

async function importAds(files) {
  const selected = [...files];
  if (selected.some(file => /\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name))) { toast('旧版 .xls 文件请先另存为 .xlsx 或 CSV 后再导入。'); return; }
  const usable = selected.filter(file => /\.(xlsx|csv)$/i.test(file.name));
  if (!usable.length) { toast('请选择 .xlsx 或 .csv 格式的广告报表。'); return; }
  markDataChanged();
  const ads = await importAdFiles(usable);
  if (!ads.length) {
    toast('未识别到可分析的广告字段。请检查报表表头。');
    return;
  }
  state.ads = ads;
  state.leads = [];
  state.matches = [];
  state.source = 'Meta Excel';
  populateFilters();
  dateRange();
  const saved = await persistImportedData();
  resetExpandedLists();
  resetDetailCharts();
  renderDashboard();
  toast(`已导入 ${ads.length} 条广告记录${saved ? '，已保存在本机浏览器' : '；浏览器未能保存到本机'}`);
}

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
  $('adFileInput').addEventListener('change', event => importAds(event.target.files));
  $('leadFileInput').addEventListener('change', event => prepareLeads(event.target.files));
  bindDrop('adDropZone', importAds);
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
  ['guideModal', 'mappingModal', 'adviceModal'].forEach(id => $(id).addEventListener('click', event => {
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
    const wasExpanded = state.expandedLists[key];
    state.expandedLists[key] = !wasExpanded;
    renderDashboard();
    if (wasExpanded) {
      const moduleIds = { risks: 'riskCenter', countryQuality: 'countryQualityCard', campaigns: 'campaignRankingCard' };
      requestAnimationFrame(() => $(moduleIds[key])?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
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
  $('saveRulesButton').addEventListener('click', saveRules);
  $('resetRulesButton').addEventListener('click', resetRules);

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelector('.menu-icon').addEventListener('click', () => document.body.classList.toggle('nav-open'));
}

function init() {
  state.rules = loadRules();
  state.actions = loadActions(ACTION_SCOPE);
  renderRulesForm();
  populateFilters();
  dateRange();
  renderDashboard();
  bindEvents();

  // 导入按钮必须立即可用；本机历史数据在后台恢复，避免本地存储异常时阻塞文件选择。
  loadDashboardData().then(saved => {
    if (state.changedSinceStartup || !saved || !Array.isArray(saved.ads) || !saved.ads.length) return;
    state.ads = saved.ads;
    state.leads = Array.isArray(saved.leads) ? saved.leads : [];
    state.matches = Array.isArray(saved.matches) ? saved.matches : [];
    state.source = saved.source || 'Meta Excel';
    populateFilters();
    dateRange();
    renderDashboard();
  }).catch(() => {});
}

init();

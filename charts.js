import { titleText } from './metrics.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const usd = value => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const integer = value => Number(value || 0).toLocaleString();
const percent = value => `${(Number(value || 0) * 100).toFixed(1)}%`;

const RISK_META = {
  extreme: { label: '极高风险', color: '#db5365' },
  high: { label: '高风险', color: '#ea8845' },
  watch: { label: '观察', color: '#dfa32f' },
  normal: { label: '正常', color: '#4d82e8' },
  excellent: { label: '优秀', color: '#19ad88' }
};

const CAMPAIGN_COLORS = ['#6d62ef', '#3184ed', '#1bae90', '#e18a42', '#b56add'];

function host(id) { return document.getElementById(id); }

function empty(text = '导入广告数据后显示图表。') {
  return `<div class="chart-empty"><span>⌁</span><p>${esc(text)}</p></div>`;
}

function validDate(value) {
  const text = String(value || '').trim();
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bucketDate(value, granularity = 'day') {
  const date = validDate(value);
  if (!date) return String(value || '报告周期');
  if (granularity === 'month') return date.toISOString().slice(0, 7);
  if (granularity === 'week') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  }
  return date.toISOString().slice(0, 10);
}

function periodLabel(value, granularity = 'day') {
  if (granularity === 'month') return String(value).replace('-', '/');
  if (granularity === 'week') return `周 ${String(value).slice(5).replace('-', '/')}`;
  return String(value).slice(5).replace('-', '/');
}

function dateSeries(rows, granularity = 'day') {
  const grouped = new Map();
  rows.forEach(row => {
    const date = bucketDate(row.dateStart || row.dateEnd || row.date, granularity);
    const item = grouped.get(date) || { date, spend: 0, results: 0 };
    item.spend += Number(row.spend) || 0;
    item.results += Number(row.results) || 0;
    grouped.set(date, item);
  });
  return [...grouped.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(item => ({ ...item, cpl: item.results ? item.spend / item.results : 0 }));
}

function normalizedPoints(values, left, top, width, height) {
  const numbers = values.map(value => Number(value) || 0);
  const max = Math.max(...numbers, 0);
  const min = Math.min(...numbers, 0);
  const span = max - min;
  const count = Math.max(numbers.length - 1, 1);
  return numbers.map((value, index) => ({
    x: left + width * index / count,
    y: span ? top + height - ((value - min) / span) * height : top + height / 2
  }));
}

function path(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function trendTooltip(point) {
  return `日期：${point.date}\nSpend：${usd(point.spend)}\nLead：${integer(point.results)}\nCPL：${point.results ? usd(point.cpl) : '—'}`;
}

function trendChart(rows, overview = {}) {
  const granularity = overview.trendGranularity || 'day';
  const points = dateSeries(rows, granularity);
  const visible = { spend: true, lead: true, cpl: true, ...(overview.trendVisible || {}) };
  if (!points.length) return empty('导入包含报告日期的广告数据后显示趋势。');

  const series = [
    { key: 'spend', name: 'Spend', color: '#6d62ef', values: points.map(point => point.spend) },
    { key: 'lead', name: 'Lead', color: '#16ad8b', values: points.map(point => point.results) },
    { key: 'cpl', name: 'CPL', color: '#3184ed', dash: '6 5', values: points.map(point => point.cpl) }
  ];
  const legend = `<div class="trend-legend">${series.map(item => `<button type="button" class="trend-legend-item ${visible[item.key] ? 'active' : ''}" data-trend-series="${item.key}" aria-pressed="${Boolean(visible[item.key])}"><i class="${item.dash ? 'dashed' : ''}" style="${item.dash ? `border-color:${item.color}` : `background:${item.color}`}"></i>${item.name}</button>`).join('')}<span class="trend-normalised">已标准化</span></div>`;

  if (points.length === 1) {
    const point = points[0];
    return `${legend}<div class="trend-single-summary"><div><span>Spend</span><b>${usd(point.spend)}</b></div><div><span>Lead</span><b>${integer(point.results)}</b></div><div><span>CPL</span><b>${point.results ? usd(point.cpl) : '—'}</b></div><p>当前报表仅包含一个报告日期。按日导出报表后，可在此查看完整的投放趋势。</p></div>`;
  }

  const width = 760;
  const height = 278;
  const plot = { left: 44, top: 18, width: 680, height: 196 };
  const prepared = series.map(item => ({ ...item, points: normalizedPoints(item.values, plot.left, plot.top, plot.width, plot.height) }));
  const grid = [0, .25, .5, .75, 1].map(ratio => `<g><line x1="${plot.left}" y1="${plot.top + plot.height * ratio}" x2="${plot.left + plot.width}" y2="${plot.top + plot.height * ratio}" stroke="#ebeff6"/><text x="${plot.left - 10}" y="${plot.top + plot.height * ratio + 4}" text-anchor="end" class="chart-axis-label">${Math.round((1 - ratio) * 100)}%</text></g>`).join('');
  const labelIndexes = [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])];
  const labels = labelIndexes.map(index => `<text x="${prepared[0].points[index].x}" y="${plot.top + plot.height + 32}" text-anchor="middle" class="chart-axis-label">${esc(periodLabel(points[index].date, granularity))}</text>`).join('');
  const lines = prepared.filter(item => visible[item.key]).map(item => `<g class="trend-series ${item.key}"><path d="${path(item.points)}" fill="none" stroke="${item.color}" stroke-width="3" ${item.dash ? `stroke-dasharray="${item.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>${item.points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="3.3" fill="#fff" stroke="${item.color}" stroke-width="2"><title>${esc(trendTooltip(points[index]))}</title></circle>`).join('')}</g>`).join('');
  return `${legend}<div class="trend-chart-note">相对趋势按各指标自身范围标准化；悬停数据点可查看真实 Spend、Lead 与 CPL。</div><svg class="line-chart overview-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Spend、Lead 和 CPL 的日期趋势，已按各指标自身范围标准化">${grid}<line x1="${plot.left}" y1="${plot.top + plot.height}" x2="${plot.left + plot.width}" y2="${plot.top + plot.height}" stroke="#dfe6f1"/>${lines}${labels}</svg>`;
}

function riskCounts(items) {
  return Object.keys(RISK_META).map(level => ({ level, count: items.filter(item => item.d.level === level).length, ...RISK_META[level] }));
}

function horizontalBars(data, { value = item => item.value, label = item => item.label, valueText = item => String(value(item)), color = item => item.color || '#7161ef', compact = false } = {}) {
  if (!data.length) return empty('当前筛选范围没有可用于对比的数据。');
  const max = Math.max(...data.map(item => Number(value(item)) || 0), 1);
  return `<div class="bar-chart ${compact ? 'compact' : ''}">${data.map(item => {
    const raw = Number(value(item)) || 0;
    return `<div class="bar-row"><span class="bar-row-label" title="${esc(label(item))}">${esc(titleText(label(item), compact ? 14 : 20))}</span><span class="bar-track"><i style="width:${Math.max(raw ? 5 : 0, raw / max * 100)}%;background:${color(item)}"></i></span><b>${esc(valueText(item))}</b></div>`;
  }).join('')}</div>`;
}

function riskBars(items) {
  const data = riskCounts(items);
  return horizontalBars(data, { value: item => item.count, label: item => item.label, valueText: item => `${item.count} 项`, color: item => item.color });
}

function countryData(rankings, limit = 5) {
  return rankings.slice(0, limit).map(item => ({ ...item, label: item.name }));
}

function countryChart(rankings, metric = 'score', limit = 5) {
  const data = countryData(rankings, limit);
  const config = metric === 'lead'
    ? { value: item => item.results, valueText: item => `${integer(item.results)} Lead`, color: () => '#1aae89' }
    : metric === 'cpl'
      ? { value: item => item.cpl, valueText: item => item.results ? usd(item.cpl) : '—', color: () => '#3386ef' }
      : { value: item => item.score, valueText: item => `${item.score} 分`, color: item => item.tone === 'excellent' ? '#1aae89' : item.tone === 'critical' ? '#dc5265' : '#7161ef' };
  return horizontalBars(data, { label: item => item.name, ...config });
}

function campaignData(campaigns, limit = 5) {
  return [...campaigns].sort((a, b) => b.results - a.results || b.spend - a.spend).slice(0, limit).map(item => ({ ...item, label: item.name }));
}

function campaignChart(campaigns, metric = 'lead', limit = 5) {
  const data = campaignData(campaigns, limit);
  const config = metric === 'spend'
    ? { value: item => item.spend, valueText: item => usd(item.spend), color: () => '#7161ef' }
    : metric === 'cpl'
      ? { value: item => item.cpl, valueText: item => item.results ? usd(item.cpl) : '—', color: () => '#3386ef' }
      : { value: item => item.results, valueText: item => `${integer(item.results)} Lead`, color: () => '#1aae89' };
  return horizontalBars(data, { label: item => item.name, ...config });
}

function campaignCountries(campaign) {
  if (campaign.countries instanceof Set) return [...campaign.countries].filter(Boolean).join('、') || '未填写国家';
  if (Array.isArray(campaign.countries)) return campaign.countries.filter(Boolean).join('、') || '未填写国家';
  return campaign.country || '未填写国家';
}

function overviewCampaigns(campaigns, metric = 'lead') {
  if (!campaigns.length) return empty('导入广告数据后显示 Top Campaigns。');
  const configs = {
    lead: { label: 'Lead', subtitle: '按 Lead 排名', value: item => item.results, valueText: item => `${integer(item.results)} Lead`, sort: (a, b) => b.results - a.results || b.spend - a.spend },
    spend: { label: '花费', subtitle: '按花费排名', value: item => item.spend, valueText: item => usd(item.spend), sort: (a, b) => b.spend - a.spend },
    cpl: { label: 'CPL', subtitle: '按 CPL 从低到高', value: item => item.cpl, valueText: item => item.results ? usd(item.cpl) : '—', sort: (a, b) => (a.results ? a.cpl : Infinity) - (b.results ? b.cpl : Infinity) || b.spend - a.spend }
  };
  const config = configs[metric] || configs.lead;
  const data = [...campaigns].filter(item => metric !== 'cpl' || item.results).sort(config.sort).slice(0, 5);
  if (!data.length) return empty('当前筛选范围没有可用于排名的 Campaign。');
  const rawValues = data.map(config.value);
  const max = Math.max(...rawValues, 1);
  const min = Math.min(...rawValues, 0);
  return `<div class="overview-ranking-list">${data.map((item, index) => {
    const raw = Number(config.value(item)) || 0;
    const width = metric === 'cpl' && max !== min ? Math.max(16, (max - raw) / (max - min) * 100) : Math.max(raw ? 9 : 0, raw / max * 100);
    const color = CAMPAIGN_COLORS[index % CAMPAIGN_COLORS.length];
    return `<div class="overview-ranking-row"><span class="overview-rank">${index + 1}</span><div class="overview-ranking-main"><div class="overview-ranking-copy"><strong title="${esc(item.name)}">${esc(titleText(item.name, 24))}</strong><span title="${esc(campaignCountries(item))}">${esc(titleText(campaignCountries(item), 18))}</span></div><div class="overview-progress"><i style="width:${width}%;background:${color}"></i></div></div><b>${esc(config.valueText(item))}</b></div>`;
  }).join('')}</div><button type="button" class="chart-footer-link" data-overview-link="campaign">查看全部 Campaign →</button>`;
}

function overviewCountries(rankings) {
  if (!rankings.length) return empty('导入广告数据后显示国家表现。');
  const data = countryData(rankings, 5);
  return `<div class="country-score-list">${data.map((item, index) => {
    const tone = item.tone === 'excellent' ? '#18ad88' : item.tone === 'critical' ? '#db5365' : item.tone === 'watch' ? '#dfa32f' : '#6d62ef';
    return `<div class="country-score-row"><span class="country-rank">${index + 1}</span><div class="country-score-main"><div><strong title="${esc(item.name)}">${esc(titleText(item.name, 17))}</strong><span>${integer(item.results)} Lead · ${item.results ? usd(item.cpl) : '—'}</span></div><div class="country-score-track"><i style="width:${Math.max(4, item.score)}%;background:${tone}"></i></div></div><b>${item.score}<small>分</small></b></div>`;
  }).join('')}</div><button type="button" class="chart-footer-link" data-overview-link="country">查看完整国家报告 →</button>`;
}

function riskDonut(items, hidden = {}) {
  if (!items.length) return empty('导入广告数据后显示风险分布。');
  const data = riskCounts(items);
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const visible = data.filter(item => !hidden[item.level]);
  const visibleTotal = visible.reduce((sum, item) => sum + item.count, 0);
  let position = 0;
  const background = visibleTotal ? `conic-gradient(${visible.map(item => {
    const start = position / visibleTotal * 100;
    position += item.count;
    const end = position / visibleTotal * 100;
    return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(',')})` : '#edf1f7';
  return `<div class="risk-donut-layout"><div class="risk-donut" style="background:${background}"><div><b>${integer(total)}</b><span>广告组合</span></div></div><div class="risk-donut-legend">${data.map(item => `<button type="button" class="risk-legend-item ${hidden[item.level] ? 'muted' : ''}" data-risk-legend="${item.level}" aria-pressed="${!hidden[item.level]}" title="${esc(item.label)}：${item.count} 项，占 ${total ? percent(item.count / total) : '0.0%'}"><i style="background:${item.color}"></i><span>${item.label}</span><b>${item.count}</b></button>`).join('')}</div></div>`;
}

function alertTitle(item) {
  const categories = item.d.categories || [item.d.category];
  if (categories.includes('creativeFatigue')) return '素材疲劳预警';
  if (categories.includes('audienceSaturation')) return '受众趋于饱和';
  if (item.d.level === 'extreme') return '达到关停候选条件';
  if (item.d.level === 'high') return item.results ? 'CPL 高于目标值' : '高消耗但未获得 Lead';
  if (item.d.level === 'watch') return '当前表现需要继续观察';
  if (item.d.level === 'excellent') return '表现稳定，可考虑小步扩量';
  return '当前投放表现正常';
}

function latestReportDate(item) {
  const dates = item.dates instanceof Set ? [...item.dates] : Array.isArray(item.dates) ? item.dates : [];
  const latest = dates.filter(Boolean).sort().at(-1);
  return latest ? `报告日期 ${latest}` : '当前报告周期';
}

function recentAlerts(items) {
  if (!items.length) return empty('导入广告数据后显示需要关注的提醒。');
  const alerts = [...items].sort((a, b) => {
    const order = { extreme: 0, high: 1, watch: 2, excellent: 3, normal: 4 };
    return order[a.d.level] - order[b.d.level] || b.spend - a.spend;
  }).slice(0, 4);
  return `<div class="recent-alert-list">${alerts.map(item => `<button type="button" class="recent-alert ${item.d.level}" data-alert-filter="${item.d.level}"><i>${item.d.level === 'excellent' ? '↗' : item.d.level === 'watch' ? '◷' : '!'}</i><span><strong>${esc(alertTitle(item))}</strong><small title="${esc(`${item.country} · ${item.campaign}`)}">${esc(titleText(`${item.country} · ${item.campaign}`, 31))}</small></span><time>${esc(latestReportDate(item))}</time></button>`).join('')}</div><button type="button" class="chart-footer-link" data-alert-filter="${alerts[0]?.d.level || 'all'}">查看全部提醒 →</button>`;
}

function rulesChart(items) {
  const counts = new Map();
  items.forEach(item => counts.set(item.d.rule, (counts.get(item.d.rule) || 0) + 1));
  const data = [...counts.entries()].map(([label, value]) => ({ label, value, color: '#8662ef' })).sort((a, b) => b.value - a.value).slice(0, 5);
  return horizontalBars(data, { value: item => item.value, valueText: item => `${item.value} 项`, color: item => item.color, compact: true });
}

function cplDistribution(items) {
  const data = items.filter(item => item.results || item.spend).sort((a, b) => (b.cpl || b.spend) - (a.cpl || a.spend)).slice(0, 6);
  if (!data.length) return empty('暂无可用于 CPL 分布的广告。');
  const max = Math.max(...data.map(item => item.results ? item.cpl : item.spend), 1);
  return `<div class="dot-chart">${data.map(item => {
    const value = item.results ? item.cpl : item.spend;
    const level = item.d.level;
    const color = RISK_META[level]?.color || '#7161ef';
    return `<div class="dot-row"><span title="${esc(item.campaign)}">${esc(titleText(item.campaign, 18))}</span><i style="--dot:${Math.max(7, value / max * 100)}%;--tone:${color}"></i><b>${item.results ? usd(item.cpl) : `${usd(item.spend)} 无 Lead`}</b></div>`;
  }).join('')}</div>`;
}

function detailPanel(title, subtitle, content) {
  return `<article class="detail-chart-card"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>${content}</article>`;
}

function setHost(id, content) {
  const element = host(id);
  if (element) element.innerHTML = content;
}

function setDetailHost(id, open, content) {
  const element = host(id);
  if (!element) return;
  element.hidden = !open;
  if (open) element.innerHTML = content;
}

export function renderCharts({ rows = [], items = [], rankings = [], campaigns = [], chartPanels = {}, overview = {} }) {
  setHost('overviewTrendChart', trendChart(rows, overview));
  setHost('overviewRiskChart', riskDonut(items, overview.riskHidden || {}));
  setHost('overviewCountryChart', overviewCountries(rankings));
  setHost('overviewCampaignChart', overviewCampaigns(campaigns, overview.campaignMetric || 'lead'));
  setHost('overviewAlertsChart', recentAlerts(items));
  setHost('coreChartsSummary', `<span>${integer(items.length)} 个广告组合</span><b>花费、风险、国家与 Campaign 图表已收起</b>`);

  setDetailHost('riskCharts', chartPanels.risk, `<div class="detail-chart-grid risk-detail-grid">${detailPanel('风险等级分布', '各风险等级的广告组合数量', riskBars(items))}${detailPanel('规则触发分布', '当前筛选范围内最常触发的诊断规则', rulesChart(items))}${detailPanel('CPL 风险分布', '高成本或无 Lead 广告优先显示', cplDistribution(items))}</div>`);
  setDetailHost('countryCharts', chartPanels.country, `<div class="detail-chart-grid">${detailPanel('国家评分 Top10', '综合评分由高到低', countryChart(rankings, 'score', 10))}${detailPanel('国家 Lead 对比', 'Top10 国家 Lead 产出', countryChart(rankings, 'lead', 10))}${detailPanel('国家 CPL 对比', 'Top10 国家获客成本', countryChart(rankings, 'cpl', 10))}</div>`);
  setDetailHost('campaignCharts', chartPanels.campaign, `<div class="detail-chart-grid">${detailPanel('Top Campaign Lead', '按 Lead 产出排序', campaignChart(campaigns, 'lead', 10))}${detailPanel('Campaign CPL', '按 Lead 排名前十的获客成本', campaignChart(campaigns, 'cpl', 10))}${detailPanel('Campaign 花费', '按 Lead 排名前十的投放花费', campaignChart(campaigns, 'spend', 10))}</div>`);
}

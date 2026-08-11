import { commerceTotals, funnelStages } from './commerce-metrics.js';
import { esc, integer, money, pct, titleText } from './metrics.js';

const DISPLAY_LIMIT = 5;
const riskClass = level => ({ extreme: 'extreme', high: 'high', watch: 'watch', excellent: 'excellent', normal: 'normal' }[level] || 'normal');
const rate = value => value === null || value === undefined ? '—' : pct(value);
const fixed = value => value === null || value === undefined ? '—' : value.toFixed(2);

function metricCard(tone, label, value, note, icon) {
  return `<article class="metric ${tone}"><div class="metric-head"><small>${esc(label)}</small><i>${icon}</i></div><strong>${value}</strong><span>${esc(note)}</span><svg viewBox="0 0 150 35" aria-hidden="true"><path d="M2 28 C12 18 19 30 28 20 S44 25 56 10 S72 24 83 16 S100 9 112 20 S130 19 148 6"/></svg></article>`;
}

function priorityAdvice(items) {
  const count = level => items.filter(item => item.d.level === level).length;
  const special = category => items.filter(item => item.d.categories?.includes(category)).length;
  return [
    { tone: 'critical', label: '优先处理', icon: '!', title: `${count('extreme') + count('high')} 个广告需要优先处理`, meta: `${count('extreme')} 个极高风险 · ${count('high')} 个高风险`, text: '优先检查 ROAS、CPA、购买和漏斗环节。对于无购买广告，请先核对产品页、购物车和支付流程，再决定是否调整预算。' },
    { tone: 'watch', label: '继续观察', icon: '◷', title: `${count('watch')} 个广告建议继续观察`, meta: `${special('creativeFatigue')} 个素材疲劳 / ${special('landingPage')} 个落地页信号`, text: '系统已发现早期效率或漏斗信号。建议按触发环节优化素材、页面、购物车或结账体验，并持续观察购买表现。' },
    { tone: 'excellent', label: '表现较好', icon: '↗', title: `${count('excellent')} 个广告达到 ROAS 目标`, meta: '商业结果优先于单一点击指标', text: '当 ROAS、CPA 与购买表现稳定时，可按小步节奏扩量，并持续关注频次与转化率。' }
  ];
}

export function renderCommerceDashboard({ rows, diagnostics, expanded = false }) {
  const totals = commerceTotals(rows);
  const hasData = rows.length > 0;
  const kpis = [
    metricCard('spend', '广告花费', hasData ? money(totals.spend) : '—', '当前筛选范围 USD', '$'),
    metricCard('leads', '购买次数', hasData ? integer(totals.purchases) : '—', 'Meta Purchases', '▣'),
    metricCard('cpl', 'Meta Attributed GMV', hasData ? money(totals.metaAttributedGmv) : '—', 'Meta 归因销售额', '↗'),
    metricCard('clicks', 'Purchase ROAS', hasData ? fixed(totals.roas) : '—', 'Meta GMV ÷ Spend', '×'),
    metricCard('cpm', 'CPA / Cost per Purchase', hasData ? money(totals.cpa) : '—', 'Spend ÷ Purchases', '◎'),
    metricCard('spend', 'AOV / Average Order Value', hasData ? money(totals.aov) : '—', 'Meta GMV ÷ Purchases', '◈'),
    metricCard('clicks', '覆盖人数', hasData && totals.reach ? integer(totals.reach) : '—', '当前筛选范围覆盖人数', '◉'),
    metricCard('cpm', '平均频次', hasData && totals.frequency !== null ? `${totals.frequency.toFixed(1)} 次` : '—', '平均每位用户看到广告次数', '↻'),
    metricCard('leads', 'Link Clicks', hasData ? integer(totals.linkClicks) : '—', '链接点击量', '↗'),
    metricCard('clicks', 'Link CTR', hasData ? rate(totals.ctr) : '—', '链接点击 ÷ 展示次数', '%'),
    metricCard('cpl', 'CPC', hasData ? money(totals.cpc) : '—', '每次链接点击成本', '¢'),
    metricCard('cpm', 'CPM', hasData ? money(totals.cpm) : '—', '每千次展示花费', '◉')
  ];
  document.getElementById('b2cMetrics').innerHTML = kpis.join('');

  document.getElementById('b2cAdviceMeta').textContent = `当前分析 ${diagnostics.length} 个 Campaign / 国家组合`;
  document.getElementById('b2cAdviceList').innerHTML = hasData ? priorityAdvice(diagnostics).map(item => `
    <article class="advice-card ${item.tone}"><span class="advice-icon">${item.icon}</span><span class="advice-copy"><span class="advice-label">${item.label}</span><h3>${esc(item.title)}</h3><small>${esc(item.meta)}</small><p>${esc(item.text)}</p></span></article>`).join('') : '<div class="empty">导入包含 Purchase、GMV 与漏斗字段的 Meta 报表后，系统会在这里给出电商优化建议。</div>';

  renderFunnel('b2cFunnelCompact', totals, true);
  renderCommerceTable(rows, diagnostics, expanded);
  const source = document.getElementById('b2cDataSummary');
  if (source) source.textContent = hasData ? `已读取 ${rows.length} 条 Meta 广告记录；Meta Purchases 和 Meta Attributed GMV 不等同于店铺真实订单或 Store GMV。` : 'B2C 模式使用与 B2B 相同的 Meta 数据导入、国家、Campaign 和日期筛选条件。';
}

export function renderFunnel(targetId, totals, compact = false) {
  const host = document.getElementById(targetId);
  if (!host) return;
  const stages = funnelStages(totals);
  const max = Math.max(...stages.map(stage => stage.value), 1);
  host.innerHTML = stages.map((stage, index) => {
    const percentage = Math.max(8, stage.value / max * 100);
    const name = stage.label;
    const rateLabel = index === 0 ? '流量起点' : (stage.key === 'purchases' ? `完成率 ${rate(stage.rate)}` : `转化率 ${rate(stage.rate)}`);
    return `<article class="commerce-funnel-stage ${stage.key}"><div class="commerce-funnel-top"><span>${name}</span><b>${integer(stage.value)}</b></div><div class="commerce-funnel-track"><i style="width:${percentage}%"></i></div><small>${rateLabel}</small></article>`;
  }).join('');
  host.classList.toggle('compact', compact);
}

export function renderFunnelPage({ rows, diagnostics }) {
  const totals = commerceTotals(rows);
  renderFunnel('b2cFunnelFull', totals, false);
  const highlight = diagnostics.find(item => ['extreme', 'high', 'watch'].includes(item.d.level));
  document.getElementById('b2cFunnelSummary').innerHTML = rows.length
    ? `<div class="funnel-summary-grid"><div><small>Purchase CVR</small><b>${rate(totals.purchaseCvr)}</b><span>Purchases ÷ Link Clicks</span></div><div><small>Checkout Completion Rate</small><b>${rate(totals.checkoutCompletionRate)}</b><span>Purchases ÷ Initiate Checkout</span></div><div><small>当前诊断重点</small><b class="${highlight ? riskClass(highlight.d.level) : 'normal'}">${highlight ? esc(highlight.d.status) : '正常'}</b><span>${highlight ? esc(titleText(highlight.d.advice, 52)) : '当前没有需优先处理的漏斗问题。'}</span></div></div>`
    : '<div class="empty">请先导入 Meta 电商广告报表，至少包含展示、Link Click、Purchase 和 Purchase Conversion Value。</div>';
}

function renderCommerceTable(rows, diagnostics, expanded) {
  const diagnosisByGroup = new Map(diagnostics.map(item => [item.id, item.d]));
  const riskOrder = { extreme: 0, high: 1, watch: 2, normal: 3, excellent: 4 };
  const details = rows.map(row => ({ ...row, d: diagnosisByGroup.get(`${row.campaign}|${row.country}`) || { level: 'normal', label: '正常', rule: '等待更多购买样本', advice: '当前记录尚未形成可诊断的 Campaign / 国家组合。' } }))
    .sort((a, b) => riskOrder[a.d.level] - riskOrder[b.d.level] || Number(b.spend || 0) - Number(a.spend || 0));
  const visible = expanded ? details : details.slice(0, DISPLAY_LIMIT);
  const table = document.getElementById('b2cRiskTable');
  const cell = value => `<td>${value}</td>`;
  table.innerHTML = details.length ? visible.map(row => {
    const frequency = row.frequency > 0 ? `${Number(row.frequency).toFixed(1)} 次` : '—';
    const lpvRate = row.clicks ? Number(row.landingPageViews || 0) / Number(row.clicks) : null;
    const atcRate = row.landingPageViews ? Number(row.addToCart || 0) / Number(row.landingPageViews) : null;
    const checkoutRate = row.addToCart ? Number(row.initiateCheckout || 0) / Number(row.addToCart) : null;
    const completionRate = row.initiateCheckout ? Number(row.purchases || 0) / Number(row.initiateCheckout) : null;
    const purchaseCvr = row.clicks ? Number(row.purchases || 0) / Number(row.clicks) : null;
    const cpa = row.purchases ? Number(row.spend || 0) / Number(row.purchases) : null;
    const aov = row.purchases ? Number(row.metaAttributedGmv || 0) / Number(row.purchases) : null;
    const roas = row.spend ? Number(row.metaAttributedGmv || 0) / Number(row.spend) : null;
    return `<tr>${cell(esc(String(row.dateEnd || row.dateStart || row.date || '—')))}${cell(`<span class="risk-badge ${riskClass(row.d.level)}">${esc(row.d.label)}</span>`)}${cell(esc(row.country || '—'))}${cell(esc(row.accountName || row.accountId || '—'))}${cell(`<span class="name" title="${esc(row.campaign || '')}">${esc(titleText(row.campaign || '—', 24))}</span>`)}${cell(esc(row.adSet || '—'))}${cell(esc(row.ad || '—'))}${cell(esc(row.creative || '—'))}${cell(esc(row.placement || '—'))}${cell(money(row.spend))}${cell(integer(row.impressions))}${cell(row.reach ? integer(row.reach) : '—')}${cell(frequency)}${cell(integer(row.clicks))}${cell(rate(row.impressions ? Number(row.clicks || 0) / Number(row.impressions) : null))}${cell(money(row.clicks ? Number(row.spend || 0) / Number(row.clicks) : null))}${cell(money(row.impressions ? Number(row.spend || 0) / Number(row.impressions) * 1000 : null))}${cell(integer(row.landingPageViews))}${cell(rate(lpvRate))}${cell(integer(row.addToCart))}${cell(rate(atcRate))}${cell(integer(row.initiateCheckout))}${cell(rate(checkoutRate))}${cell(integer(row.purchases))}${cell(rate(completionRate))}${cell(rate(purchaseCvr))}${cell(money(row.metaAttributedGmv))}${cell(money(cpa))}${cell(money(aov))}${cell(fixed(roas))}${cell(`<span title="${esc(row.d.rule)}">${esc(titleText(row.d.rule, 42))}</span>`)}${cell(`<span title="${esc(row.d.advice)}">${esc(titleText(row.d.advice, 70))}</span>`)}${cell(esc(row.status || '待人工复核'))}</tr>`;
  }).join('') : '<tr><td colspan="33"><div class="empty">当前筛选条件下没有可分析的电商广告数据。</div></td></tr>';
  const toggle = document.getElementById('b2cRiskTableToggle');
  toggle.innerHTML = details.length > DISPLAY_LIMIT ? `<button type="button" class="list-toggle" data-b2c-list-toggle>${expanded ? '收起，仅显示前 5 条 ↑' : `展开全部（共 ${details.length} 条） ↓`}</button>` : '';
}

export function renderCommerceRulesForm(rules) {
  const fields = [
    ['targetRoas', '目标 ROAS', 0.1, 0.1], ['targetCpa', '目标 CPA', 1, 0.01], ['roasWatchRatio', '观察 ROAS 比例', 0.05, 0, 1], ['roasHighRiskRatio', '高风险 ROAS 比例', 0.05, 0, 1],
    ['cpaWatchMultiplier', 'CPA 观察倍数', 0.1, 0], ['cpaHighRiskMultiplier', 'CPA 高风险倍数', 0.1, 0], ['noPurchaseHighSpendMultiplier', '无购买高风险花费倍数', 0.1, 0], ['noPurchaseStopSpendMultiplier', '无购买自动关停候选倍数', 0.1, 0]
  ];
  const grid = document.getElementById('b2cRulesGrid');
  grid.innerHTML = fields.map(([key, label, step, min, max]) => `<label>${label}<input id="commerceRule-${key}" data-commerce-rule="${key}" type="number" min="${min}"${max !== undefined ? ` max="${max}"` : ''} step="${step}" value="${rules[key]}"></label>`).join('');
}

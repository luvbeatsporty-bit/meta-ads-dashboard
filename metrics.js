import { toNumber } from './data-model.js';
export const money = value => '$' + toNumber(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const integer = value => Math.round(toNumber(value)).toLocaleString('en-US');
export const pct = value => `${(toNumber(value) * 100).toFixed(2)}%`;
export const pctNumber = value => `${toNumber(value).toFixed(2)}%`;
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const titleText = (value, n) => { const v=String(value ?? ''); return v.length>n?v.slice(0,n-1)+'…':v; };
export function sumAds(rows) {
  return rows.reduce((total, row) => ({
    spend: total.spend + toNumber(row.spend),
    results: total.results + toNumber(row.results),
    impressions: total.impressions + toNumber(row.impressions),
    reach: total.reach + toNumber(row.reach),
    clicks: total.clicks + toNumber(row.clicks)
  }), { spend: 0, results: 0, impressions: 0, reach: 0, clicks: 0 });
}
export function summarise(rows, field) { const groups = new Map(); rows.forEach(row => { const key=row[field] || '未分类'; if(!groups.has(key)) groups.set(key,{name:key,spend:0,results:0,impressions:0,clicks:0,countries:new Set()}); const g=groups.get(key); g.spend+=row.spend;g.results+=row.results;g.impressions+=row.impressions;g.clicks+=row.clicks;g.countries.add(row.country); }); return [...groups.values()].map(g=>({...g,cpl:g.results?g.spend/g.results:0,ctr:g.impressions?g.clicks/g.impressions:0,cpm:g.impressions?g.spend/g.impressions*1000:0,cpc:g.clicks?g.spend/g.clicks:0})).sort((a,b)=>b.spend-a.spend); }
export function diagnosticGroups(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const key = `${row.campaign}|${row.country}`;
    if (!groups.has(key)) groups.set(key, { id: key, campaign: row.campaign, country: row.country, spend: 0, results: 0, clicks: 0, impressions: 0, reach: 0, dates: new Set(), rows: [] });
    const group = groups.get(key);
    group.rows.push(row);
    group.spend += toNumber(row.spend);
    group.results += toNumber(row.results);
    group.clicks += toNumber(row.clicks);
    group.impressions += toNumber(row.impressions);
    group.reach += toNumber(row.reach);
    if (row.dateStart) group.dates.add(row.dateStart);
  });
  return [...groups.values()].map(group => ({
    ...group,
    cpl: group.results ? group.spend / group.results : 0,
    clickToLead: group.clicks ? group.results / group.clicks : 0,
    dayCount: group.dates.size,
    cpc: group.clicks ? group.spend / group.clicks : 0,
    ctr: group.impressions ? group.clicks / group.impressions : 0,
    frequency: averageFrequency(group.rows)
  }));
}

function reportDate(row) {
  const value = String(row.dateEnd || row.dateStart || row.date || '').slice(0, 10);
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function hasRawFrequency(row) {
  return Number.isFinite(Number(row.frequency)) && Number(row.frequency) > 0;
}

/** Uses the Meta frequency field when it is available, otherwise impressions ÷ reach. */
export function averageFrequency(rows) {
  const usable = rows.filter(row => toNumber(row.reach) > 0);
  const totalReach = usable.reduce((sum, row) => sum + toNumber(row.reach), 0);
  if (!totalReach) return null;
  return usable.reduce((sum, row) => {
    const reach = toNumber(row.reach);
    const frequency = hasRawFrequency(row) ? Number(row.frequency) : toNumber(row.impressions) / reach;
    return sum + frequency * reach;
  }, 0) / totalReach;
}

function periodMetrics(rows) {
  const totals = sumAds(rows);
  return {
    ...totals,
    ctr: totals.impressions ? totals.clicks / totals.impressions : null,
    cpc: totals.clicks ? totals.spend / totals.clicks : null,
    cpl: totals.results ? totals.spend / totals.results : null,
    frequency: averageFrequency(rows)
  };
}

function relativeChange(current, previous) {
  return previous && current !== null && previous > 0 ? (current - previous) / previous : null;
}

/**
 * Frequency is evaluated against the latest report date, so historical Meta exports
 * remain analyzable without relying on the browser's current calendar date.
 */
export function frequencySignals(rows, targetCpl) {
  const dated = rows.map(row => ({ row, time: reportDate(row) })).filter(item => item.time !== null);
  const latest = dated.length ? Math.max(...dated.map(item => item.time)) : null;
  const day = 24 * 60 * 60 * 1000;
  const recent7 = latest === null ? rows : dated.filter(item => item.time >= latest - 6 * day).map(item => item.row);
  const current3 = latest === null ? [] : dated.filter(item => item.time >= latest - 2 * day).map(item => item.row);
  const previous3 = latest === null ? [] : dated.filter(item => item.time >= latest - 5 * day && item.time < latest - 2 * day).map(item => item.row);
  const recent = periodMetrics(recent7);
  const current = current3.length ? periodMetrics(current3) : null;
  const previous = previous3.length ? periodMetrics(previous3) : null;
  const comparison = current && previous ? {
    ctrChange: relativeChange(current.ctr, previous.ctr),
    cpcChange: relativeChange(current.cpc, previous.cpc),
    cplChange: relativeChange(current.cpl, previous.cpl),
    impressionChange: relativeChange(current.impressions, previous.impressions),
    reachChange: relativeChange(current.reach, previous.reach),
    frequencyChange: relativeChange(current.frequency, previous.frequency)
  } : null;
  const frequency = recent.frequency;
  const label = latest === null ? '当前报告周期' : '最近 7 天';
  const signals = [];
  const fatigue = (level, rule, advice) => signals.push({ type: 'creativeFatigue', level, label: `${level === 'high' ? '高风险' : '需要观察'} · 素材疲劳`, rule, advice });

  if (frequency !== null && frequency >= 3) {
    if (comparison?.cplChange !== null && comparison.cplChange >= 0.25) {
      fatigue('high', `${label}平均频次 ≥ 3，且近 3 天 CPL 较前 3 天上涨 ≥ 25%`, '广告频次持续升高，同时获客成本明显上涨，素材疲劳可能已经开始影响最终转化。建议优先更换素材或暂停表现较差的旧素材，并测试新的 Creative。');
    } else if (comparison?.ctrChange !== null && comparison.ctrChange <= -0.20) {
      fatigue('high', `${label}平均频次 ≥ 3，且近 3 天 CTR 较前 3 天下降 ≥ 20%`, '广告频次已经升高，同时点击率明显下降，说明当前素材可能已经出现疲劳。建议优先更换素材、封面、广告标题或视频前三秒，而不是继续增加预算。');
    } else if (comparison?.cpcChange !== null && comparison.cpcChange >= 0.20) {
      fatigue('high', `${label}平均频次 ≥ 3，且近 3 天 CPC 较前 3 天上涨 ≥ 20%`, '广告重复曝光较高，同时点击成本正在上升，当前素材的吸引力可能正在下降。建议更换素材，并检查当前目标受众是否过窄。');
    } else if (frequency >= 4) {
      fatigue('watch', `${label}平均频次 ≥ 4`, '最近7天同一用户平均已经看到该广告4次或以上，重复曝光较高。建议尽快准备新素材，并检查受众是否趋于饱和。');
    } else if (recent.cpl !== null && recent.cpl <= targetCpl && recent.results > 0 && !(comparison?.ctrChange !== null && comparison.ctrChange <= -0.20)) {
      fatigue('watch', `${label}平均频次 ≥ 3，但 CPL 和转化表现仍健康`, '当前广告频次较高，但 CPL 和转化表现仍然健康，暂不建议仅因为频次较高暂停广告。建议提前准备备用素材，并继续观察。');
    } else {
      fatigue('watch', `${label}平均频次 ≥ 3`, '当前广告频次较高，存在素材疲劳风险。建议准备新素材，并继续关注广告效果变化。');
    }
  } else if (frequency !== null && frequency >= 2.5) {
    fatigue('watch', `${label}平均频次 2.5–3.0`, '广告频次开始升高，同一批受众可能正在重复看到该素材，建议提前准备新的素材版本，并继续观察 CTR、CPC 和 CPL 变化。');
  }

  if (comparison
    && comparison.impressionChange !== null && comparison.impressionChange > 0
    && comparison.reachChange !== null && comparison.reachChange <= 0.05
    && comparison.frequencyChange !== null && comparison.frequencyChange > 0) {
    signals.push({
      type: 'audienceSaturation',
      level: 'watch',
      label: '需要观察 · 受众趋于饱和',
      rule: '近 3 天展示继续增加，但覆盖增长放缓且频次上升',
      advice: '广告展示次数继续增加，但新增覆盖人数增长较慢，同时频次持续升高，说明广告正在反复触达同一批用户。建议考虑扩大受众或增加新的广告素材。'
    });
  }

  return { frequency7d: frequency, frequencyPeriod: label, signals };
}

function truthy(value) { return /^(1|true|yes|y|是|有|有效|valid|qualified|合格|成功|已成交|成交)$/i.test(String(value ?? '').trim()); }
export function classifyLead(lead) { const status=String(lead.status||'').toLowerCase(); const internal=truthy(lead.isInternalTest)||/内部|测试|internal|test/.test(status); const duplicate=truthy(lead.isDuplicate)||/重复|duplicate/.test(status); const valid=truthy(lead.isValid)||/有效|valid|qualified|合格/.test(status); const invalid=/无效|invalid|垃圾|invalid reason|not qualified/.test(status); const pending=!valid&&!invalid&&!duplicate&&!internal && (!status || /待跟进|follow|pending|无法联系|contact/.test(status)); return {internal,duplicate,valid:valid&&!internal&&!duplicate,invalid:invalid&&!internal&&!duplicate,pending}; }
export function leadMetrics(leads, ads, matches, selectedAdIds = new Set()) { const hasSalesData=leads.length>0; const hasQualityStatus=leads.some(lead => lead.status || lead.isValid || lead.isDuplicate || lead.isInternalTest); const matched=leads.map(lead=>({lead,match:matches.find(item=>item.leadId===lead.id)})).filter(x=>x.match?.matchStatus==='matched' && x.match.matchedAdIds.some(id=>selectedAdIds.has(id))); const classified=matched.map(x=>({...x,...classifyLead(x.lead)})); const valid=classified.filter(x=>x.valid); const salesCount=classified.filter(x=>x.valid||x.invalid||x.duplicate||x.internal).length; const adTotals=sumAds(ads.filter(ad=>selectedAdIds.has(ad.id))); return {hasSalesData,total:leads.length,matchedCount:matched.length,unmatchedCount:leads.filter(lead=>{const m=matches.find(item=>item.leadId===lead.id);return !m||m.matchStatus==='unmatched';}).length,pendingCount:matches.filter(m=>m.matchStatus==='pending' && leads.some(lead=>lead.id===m.leadId)).length,validCount:valid.length,invalidCount:classified.filter(x=>x.invalid).length,duplicateCount:classified.filter(x=>x.duplicate).length,internalCount:classified.filter(x=>x.internal).length,pendingLeadCount:classified.filter(x=>x.pending).length,validRate:hasQualityStatus&&adTotals.results?valid.length/adTotals.results:null,validCpl:hasQualityStatus&&valid.length?adTotals.spend/valid.length:null,hasQualityStatus,adLeadCount:adTotals.results,matchedSalesCount:salesCount}; }

export function diagnose(row, rules, quality = null) {
  if (row.results === 0 && row.spend >= rules.extremeSpend) return {level:'extreme',label:'极高风险 · 关停候选',rule:`花费 ≥ $${rules.extremeSpend}，Lead = 0`,advice:'停止继续消耗；优先检查素材、受众、表单和落地页是否正常。'};
  if (row.results === 0 && row.clicks >= rules.extremeClicks) return {level:'extreme',label:'极高风险 · 关停候选',rule:`链接点击 ≥ ${rules.extremeClicks}，Lead = 0`,advice:'优先检查表单可提交性、页面加载、CTA 与广告承诺一致性。'};
  if (quality?.hasQualityStatus && quality.validCpl !== null && quality.validCpl > rules.highValidCpl && row.results > 0) return {level:'high',label:'高风险 · 人工处理',rule:`有效 Lead CPL > $${rules.highValidCpl}`,advice:'广告带来表单，但有效商机成本偏高；检查受众、国家、销售承接和 Lead 来源。'};
  if (quality?.hasQualityStatus && quality.validRate !== null && quality.validRate < rules.lowValidRatePercent / 100 && row.results > 0) return {level:'high',label:'高风险 · 人工处理',rule:`有效 Lead 率 < ${rules.lowValidRatePercent}%`,advice:'不要只看表面 CPL；先排查重复、无效、内部测试和目标客户匹配情况。'};
  if (row.results > 0 && row.clicks >= rules.highClicks && row.clickToLead < rules.highConversionPercent / 100) return {level:'high',label:'高风险 · 人工处理',rule:`链接点击 ≥ ${rules.highClicks} 且 点击→Lead < ${rules.highConversionPercent}%`,advice:'检查表单字段、移动端加载、CTA、落地页承接和流量精准度。'};
  if (row.results > 0 && row.cpl > rules.highCpl) return {level:'high',label:'高风险 · 人工处理',rule:`CPL > $${rules.highCpl}`,advice:'建议先降低预算 20–30%，检查国家、受众、素材与实际 Lead 质量。'};
  if ((row.results === 0 && row.spend >= rules.watchSpend && row.spend < rules.extremeSpend) || (row.results > 0 && row.cpl >= rules.watchCpl && row.cpl <= rules.highCpl)) return {level:'watch',label:'需要观察',rule:row.results===0?`花费 $${rules.watchSpend}–$${rules.extremeSpend}，暂无 Lead`:`CPL $${rules.watchCpl}–$${rules.highCpl}`,advice:'暂不加预算，继续观察，并检查链接、表单与素材点击率。'};
  if (row.ctr > 0 && row.ctr < rules.watchCtrPercent / 100) return {level:'watch',label:'需要观察',rule:`链接 CTR < ${rules.watchCtrPercent}%`,advice:'优先测试素材首图、文案、受众与 CTA，避免仅因低 CTR 直接关停。'};
  if (row.results > 0 && row.cpl <= rules.excellentCpl) return {level:'excellent',label:'表现优秀',rule:`CPL ≤ $${rules.excellentCpl}`,advice:'建议小步扩量 10–20%，复制测试相近受众或素材。'};
  return {level:'normal',label:'表现正常',rule:'CPL 处于正常区间或数据量偏少',advice:'建议继续运行，保持每日复查并结合实际 Lead 状态判断。'};
}
export const RISK_ORDER = {extreme:0,high:1,watch:2,normal:3,excellent:4};

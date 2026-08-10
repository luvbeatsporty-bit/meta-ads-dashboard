import { LEAD_ALIASES, LEAD_FIELDS, createLeadRecord, findAliasKey, toDate } from './data-model.js';
import { readSpreadsheetRows } from './excel-import.js';

export async function readLeadFiles(files) {
  const result = [];
  for (const file of [...files]) {
    const rows = await readSpreadsheetRows(file);
    if (rows.length) result.push({ fileName: file.name, headers: rows[0].map(value => String(value ?? '').trim()), rows: rows.slice(1) });
  }
  return result;
}

export function suggestedMapping(headers) {
  const mapping = {};
  headers.forEach(header => { const key = findAliasKey(header, LEAD_ALIASES); if (key && mapping[key] === undefined) mapping[key] = header; });
  return mapping;
}

export function mapLeadFiles(pending, mapping) {
  const leads = [];
  pending.forEach(file => file.rows.forEach((values, rowIndex) => {
    if (!values.some(value => String(value ?? '').trim())) return;
    const raw = { sourceFile:file.fileName, sourceRow:rowIndex + 2 };
    LEAD_FIELDS.forEach(([key]) => { const header = mapping[key]; const index = header ? file.headers.indexOf(header) : -1; raw[key] = index < 0 ? '' : String(values[index] ?? '').trim(); });
    raw.submittedAt = toDate(raw.submittedAt);
    if (!raw.leadId) raw.leadId = raw.email || raw.phone || `${raw.campaign}|${raw.ad}|${raw.submittedAt}|${file.fileName}|${rowIndex}`;
    leads.push(createLeadRecord(raw));
  }));
  return leads;
}

function norm(value) { return String(value ?? '').trim().toLowerCase(); }
function indexBy(records, key) { const map = new Map(); records.forEach(record => { const value = norm(record[key]); if (value) { if (!map.has(value)) map.set(value, []); map.get(value).push(record); } }); return map; }

export function matchLeadsToAds(leads, ads) {
  const indexes = Object.fromEntries(['adId','adSetId','campaignId','creative','campaign'].map(key => [key, indexBy(ads, key)]));
  return leads.map(lead => {
    const checks = [
      ['adId', 'Ad ID'], ['adSetId', 'Ad Set ID'], ['campaignId', 'Campaign ID'], ['utmContent', 'UTM Content', 'creative'], ['utmCampaign', 'UTM Campaign', 'campaign']
    ];
    for (const [leadKey, label, adKey = leadKey] of checks) {
      const value = norm(lead[leadKey]);
      if (!value || !indexes[adKey]) continue;
      const candidates = indexes[adKey].get(value) || [];
      if (candidates.length) return { leadId:lead.id, matchedAdIds:candidates.map(ad => ad.id), matchMethod:label, matchStatus:'matched', candidateAdIds:candidates.map(ad => ad.id) };
    }
    const campaignCandidates = indexes.campaign.get(norm(lead.campaign)) || [];
    const countryCandidates = campaignCandidates.filter(ad => !lead.country || norm(ad.country) === norm(lead.country));
    if (countryCandidates.length) return { leadId:lead.id, matchedAdIds:countryCandidates.map(ad => ad.id), matchMethod:'Campaign + 国家', matchStatus:'matched', candidateAdIds:countryCandidates.map(ad => ad.id) };
    if (campaignCandidates.length || lead.campaign) return { leadId:lead.id, matchedAdIds:[], matchMethod:'Campaign 名称待确认', matchStatus:'pending', candidateAdIds:(countryCandidates.length ? countryCandidates : campaignCandidates).map(ad => ad.id) };
    return { leadId:lead.id, matchedAdIds:[], matchMethod:'未匹配', matchStatus:'unmatched', candidateAdIds:[] };
  });
}

import { AD_ALIASES, AD_METRIC_KEYS, createAdRecord, findAliasKey, toDate, toOptionalNumber } from './data-model.js';
import { extractMetaConversionAvailability, extractMetaConversions } from './commerce-mapping.js';

export function parseCsvText(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index], next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell); rows.push(row); row = []; cell = ''; continue;
    }
    cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(values => values.some(value => String(value ?? '').trim()));
}

function xmlDecode(value = '') {
  return String(value).replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([\da-f]+);/gi, (entity, decimal, hex) => {
    if (entity === '&amp;') return '&';
    if (entity === '&lt;') return '<';
    if (entity === '&gt;') return '>';
    if (entity === '&quot;') return '"';
    if (entity === '&apos;') return "'";
    return String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10));
  });
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name.replace(':', '\\:')}=(['\"])(.*?)\\1`, 'i'));
  return match ? xmlDecode(match[2]) : '';
}

function cellIndex(reference = '') {
  const letters = String(reference).match(/[A-Z]+/i)?.[0]?.toUpperCase() || '';
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function inflate(raw, method) {
  if (method === 0) return raw;
  if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('不支持当前 Excel 压缩格式');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('不是有效的 .xlsx 文件');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (view.getUint32(localOffset, true) === 0x04034b50) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      entries.set(name, await inflate(bytes.slice(dataStart, dataStart + compressedSize), method));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryText(entries, path) {
  const bytes = entries.get(path);
  return bytes ? new TextDecoder().decode(bytes) : '';
}

function normalizeZipPath(target = '') {
  const chunks = ['xl', ...String(target).replace(/^\//, '').split('/')];
  const normalized = [];
  chunks.forEach(chunk => {
    if (!chunk || chunk === '.') return;
    if (chunk === '..') normalized.pop();
    else normalized.push(chunk);
  });
  return normalized.join('/');
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map(match =>
    xmlDecode([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(item => item[1]).join(''))
  );
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const values = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const tag = cellMatch[1], body = cellMatch[2];
      const index = cellIndex(attr(tag, 'r'));
      if (index < 0) continue;
      const type = attr(tag, 't');
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '';
      const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(match => match[1]).join('');
      let value = '';
      if (type === 's') value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr' || type === 'str') value = xmlDecode(inline || raw);
      else if (type === 'b') value = raw === '1';
      else if (raw !== '') value = Number.isFinite(Number(raw)) ? Number(raw) : xmlDecode(raw);
      values[index] = value;
    }
    if (values.some(value => String(value ?? '').trim())) rows.push(values.map(value => value ?? ''));
  }
  return rows;
}

async function readNativeXlsx(file) {
  const entries = await unzipXlsx(await file.arrayBuffer());
  const workbook = entryText(entries, 'xl/workbook.xml');
  const relationships = entryText(entries, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = parseSharedStrings(entryText(entries, 'xl/sharedStrings.xml'));
  const targets = new Map([...relationships.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gi)].map(match => [attr(match[1], 'Id'), attr(match[1], 'Target')]));
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/gi)) {
    const name = attr(match[1], 'name') || 'Sheet';
    const relationshipId = attr(match[1], 'r:id');
    const xml = entryText(entries, normalizeZipPath(targets.get(relationshipId)));
    if (xml) sheets.push({ name, rows: parseWorksheetRows(xml, sharedStrings) });
  }
  return sheets;
}

async function readSheetJsWorkbook(file) {
  if (!globalThis.XLSX) throw new Error('Excel 解析组件未加载，请刷新页面后重试。');
  try {
    const workbook = globalThis.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    if (!workbook.SheetNames?.length) throw new Error('Excel Sheet 为空。');
    return workbook.SheetNames.map(name => ({
      name,
      rows: globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true })
    }));
  } catch (error) {
    if (error?.message?.includes('为空')) throw error;
    throw new Error('Excel 文件无法解析，请确认文件未损坏。');
  }
}

export async function readWorkbookSheets(file) {
  if (/\.csv$/i.test(file.name)) {
    const text = String(await file.text()).replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('文件为空。');
    return [{ name: 'CSV', rows: parseCsvText(text) }];
  }
  if (/\.xlsx$/i.test(file.name)) {
    try { return await readNativeXlsx(file); } catch { return readSheetJsWorkbook(file); }
  }
  if (/\.xls$/i.test(file.name)) return readSheetJsWorkbook(file);
  throw new Error('不支持的文件格式。');
}

export async function readSpreadsheetRows(file) {
  const sheets = await readWorkbookSheets(file);
  return sheets[0]?.rows || [];
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 15); rowIndex += 1) {
    const found = rows[rowIndex].filter(value => findAliasKey(value, AD_ALIASES)).length;
    if (found >= 1) return rowIndex;
  }
  return -1;
}

export function parseAdRows(rows, fileName = '', sheetName = '') {
  const all = [];
  const headerIndex = findHeader(rows);
  if (headerIndex < 0) return all;
  const map = {};
  rows[headerIndex].forEach((value, index) => {
    const key = findAliasKey(value, AD_ALIASES);
    if (key && map[key] === undefined) map[key] = index;
  });
  if (!Object.keys(map).length) return all;
  const mappedKeys = Object.keys(map);
  const get = (row, key) => map[key] === undefined ? null : row[map[key]];
  const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';
  const numeric = (row, key) => toOptionalNumber(get(row, key));

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!row.some(value => String(value ?? '').trim())) continue;
    if (!mappedKeys.some(key => hasValue(get(row, key)))) continue;
    const country = String(get(row, 'country') ?? '未分类').trim() || '未分类';
    const campaign = String(get(row, 'campaign') ?? '未命名广告系列').trim() || '未命名广告系列';
    if (/^(total|合计|总计|汇总)$/i.test(country) || /^(total|合计|总计|汇总)$/i.test(campaign)) continue;
    const sourceRaw = Object.fromEntries(rows[headerIndex].map((header, index) => [String(header || '').trim(), row[index]]).filter(([key]) => key));
    const sourceRows = Object.fromEntries(mappedKeys.map(key => [key, get(row, key)]));
    const conversions = extractMetaConversions({
      landingPageViews: get(row, 'landingPageViews'), addToCart: get(row, 'addToCart'), initiateCheckout: get(row, 'initiateCheckout'),
      purchases: get(row, 'purchases'), metaAttributedGmv: get(row, 'metaAttributedGmv'), sourceRows, sourceRaw
    });
    const conversionAvailable = extractMetaConversionAvailability({ sourceRows, sourceRaw });
    const availableMetrics = Object.fromEntries(AD_METRIC_KEYS.map(key => [
      key,
      (map[key] !== undefined && hasValue(get(row, key))) || Boolean(conversionAvailable[key])
    ]));
    const conversionValues = Object.fromEntries(Object.keys(conversions).map(key => [key, conversionAvailable[key] ? conversions[key] : null]));
    const percent = key => { const value = numeric(row, key); return value === null ? null : value / (String(get(row, key)).includes('%') ? 100 : 1); };
    const ad = createAdRecord({
      date: toDate(get(row, 'date') || get(row, 'dateStart')),
      platform: String(get(row, 'platform') || 'Meta').trim(), country, product: String(get(row, 'product') || '').trim(),
      accountId: String(get(row, 'accountId') || '').trim(), accountName: String(get(row, 'accountName') || '').trim(), campaignId: String(get(row, 'campaignId') || '').trim(), campaign,
      adSetId: String(get(row, 'adSetId') || '').trim(), adSet: String(get(row, 'adSet') || '').trim(), adId: String(get(row, 'adId') || '').trim(), ad: String(get(row, 'ad') || '').trim(),
      creative: String(get(row, 'creative') || '').trim(), creativeType: String(get(row, 'creativeType') || '').trim(), audienceType: String(get(row, 'audienceType') || '').trim(), placement: String(get(row, 'placement') || '').trim(), status: String(get(row, 'status') || '').trim(),
      startTime: toDate(get(row, 'startTime')), budget: numeric(row, 'budget'), currency: String(get(row, 'currency') || 'USD').trim(), timezone: String(get(row, 'timezone') || '').trim(),
      spend: numeric(row, 'spend'), impressions: numeric(row, 'impressions'), reach: numeric(row, 'reach'), frequency: numeric(row, 'frequency'), allClicks: numeric(row, 'allClicks'), clicks: numeric(row, 'clicks'),
      ctr: percent('ctr'), allCtr: percent('allCtr'), cpc: numeric(row, 'cpc'), cpm: numeric(row, 'cpm'),
      lpvRate: percent('lpvRate'), atcRate: percent('atcRate'), checkoutRate: percent('checkoutRate'), checkoutCompletionRate: percent('checkoutCompletionRate'), purchaseCvr: percent('purchaseCvr'),
      ...conversionValues, roas: numeric(row, 'roas'), cpa: numeric(row, 'cpa'), aov: numeric(row, 'aov'),
      formOpens: numeric(row, 'formOpens'), formSubmits: numeric(row, 'formSubmits'), results: numeric(row, 'results'), costPerResult: numeric(row, 'costPerResult'),
      dateStart: toDate(get(row, 'dateStart') || get(row, 'date')), dateEnd: toDate(get(row, 'dateEnd') || get(row, 'date')), sourceFile: fileName, sourceSheet: sheetName,
      availableMetrics, sourceRows, sourceRaw
    });
    all.push(ad);
  }
  return all;
}

export function parseAdWorkbook(workbook, fileName = '') {
  const all = [];
  workbook.SheetNames.forEach(sheetName => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    all.push(...parseAdRows(rows, fileName, sheetName));
  });
  return all;
}

export async function importAdFiles(files) {
  const parsed = await Promise.all([...files].map(async file => {
    const sheets = await readWorkbookSheets(file);
    return sheets.flatMap(sheet => parseAdRows(sheet.rows, file.name, sheet.name));
  }));
  return parsed.flat();
}

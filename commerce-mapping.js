import { normalize, toNumber } from './data-model.js';

/**
 * A single compatibility layer for Meta e-commerce conversions. It supports
 * flat export columns as well as `actions` / `action_values` JSON payloads,
 * so different Ads Manager export labels do not leak into UI code.
 */
const ACTION_KEYS = Object.freeze({
  landingPageViews: ['landingpageview', 'landingpageviews', 'offsiteconversionfbpixellandingpageview', 'omnilandingpageview'],
  addToCart: ['addtocart', 'addstocart', 'websiteaddstocart', 'offsiteconversionfbpixeladdtocart', 'omniaddtocart'],
  initiateCheckout: ['initiatecheckout', 'initiatedcheckout', 'websitecheckoutsinitiated', 'offsiteconversionfbpixelinitiatecheckout', 'omniinitiatedcheckout'],
  purchases: ['purchase', 'purchases', 'websitepurchases', 'offsiteconversionfbpixelpurchase', 'omnipurchase'],
  metaAttributedGmv: ['purchaseconversionvalue', 'websitepurchaseconversionvalue', 'conversionvalue', 'purchasevalue', 'offsiteconversionfbpixelpurchasevalue', 'omnipurchasevalue']
});

const DIRECT_KEYS = Object.freeze({
  landingPageViews: ['landingpageviews', 'landingpageview'],
  addToCart: ['addtocart', 'addstocart', 'websiteaddstocart'],
  initiateCheckout: ['initiatecheckout', 'initiatedcheckout', 'websitecheckoutsinitiated'],
  purchases: ['purchases', 'purchase', 'websitepurchases'],
  metaAttributedGmv: ['purchaseconversionvalue', 'websitepurchaseconversionvalue', 'conversionvalue', 'metaattributedgmv', 'metaattributedrevenue']
});

function numeric(value) {
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeActionType(value) {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function keyForAction(value) {
  const actionType = normalizeActionType(value);
  const name = actionType.replace(/^offsiteconversionfbpixel/, '').replace(/^omni/, '');
  return Object.entries(ACTION_KEYS).find(([, aliases]) => aliases.includes(actionType) || aliases.includes(name))?.[0] || '';
}

function parsedPayload(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function readActionPayload(value, target, { valuePayload = false } = {}) {
  const payload = parsedPayload(value);
  if (!payload) return;
  const entries = Array.isArray(payload) ? payload : Object.entries(payload).map(([action_type, value]) => ({ action_type, value }));
  entries.forEach(entry => {
    if (!entry) return;
    const actionType = entry.action_type || entry.type || entry.name || entry.key;
    const metric = keyForAction(actionType);
    if (!metric) return;
    // Meta action_values / conversion_values use the same purchase action type,
    // but their value is attributed revenue rather than a purchase count.
    const targetMetric = valuePayload && metric === 'purchases' ? 'metaAttributedGmv' : metric;
    target[targetMetric] += numeric(entry.value ?? entry.count ?? entry.total ?? entry);
  });
}

function normalizedEntries(source) {
  return Object.entries(source || {}).map(([key, value]) => [normalize(key), value]);
}

function directValue(entries, aliases) {
  const match = entries.find(([key]) => aliases.includes(key));
  return match ? numeric(match[1]) : 0;
}

/** Extracts canonical e-commerce conversions from a Meta export record. */
export function extractMetaConversions(source = {}) {
  const raw = { ...(source.sourceRaw || {}), ...(source.sourceRows || {}), ...source };
  const entries = normalizedEntries(raw);
  const result = Object.fromEntries(Object.keys(ACTION_KEYS).map(key => [key, 0]));

  Object.entries(DIRECT_KEYS).forEach(([metric, aliases]) => {
    result[metric] = directValue(entries, aliases);
  });

  entries
    .filter(([key]) => ['actions', 'actionvalues', 'conversions', 'conversionvalues', 'websitepurchases', 'offsiteconversion'].includes(key))
    .forEach(([key, value]) => readActionPayload(value, result, { valuePayload: key === 'actionvalues' || key === 'conversionvalues' }));

  // Explicit normalized record fields have highest priority when present.
  Object.keys(result).forEach(key => {
    if (numeric(source[key]) > 0) result[key] = numeric(source[key]);
  });
  return result;
}

export const META_COMMERCE_FIELD_HELP = Object.freeze({
  landingPageViews: 'Landing Page Views / landing_page_view',
  addToCart: 'Add to Cart / add_to_cart',
  initiateCheckout: 'Initiate Checkout / initiate_checkout',
  purchases: 'Purchases / purchase',
  metaAttributedGmv: 'Purchase Conversion Value / purchase value'
});

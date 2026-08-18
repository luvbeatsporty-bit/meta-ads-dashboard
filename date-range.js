/**
 * Shared date-range helpers for the B2B and B2C report views.
 * Dates are kept as ISO calendar strings so comparisons remain timezone-safe.
 */

function cleanDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function dateValue(value) {
  const normalized = cleanDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(result.getTime()) || result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return null;
  return result;
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function shiftDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function monthStart(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function monthEnd(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 0));
}

export function getAvailableDateRange(rows = []) {
  const dates = rows.flatMap(row => [row?.dateStart, row?.dateEnd, row?.date])
    .map(cleanDate)
    .filter(Boolean)
    .sort();
  if (!dates.length) return { minDate: null, maxDate: null };
  return { minDate: dates[0], maxDate: dates[dates.length - 1] };
}

export function clampDateRange(range = {}, available = {}) {
  const minDate = cleanDate(available.minDate);
  const maxDate = cleanDate(available.maxDate);
  if (!minDate || !maxDate) return { startDate: null, endDate: null };
  const startDate = cleanDate(range.startDate) || minDate;
  const endDate = cleanDate(range.endDate) || maxDate;
  return {
    startDate: startDate < minDate ? minDate : startDate > maxDate ? maxDate : startDate,
    endDate: endDate < minDate ? minDate : endDate > maxDate ? maxDate : endDate
  };
}

export function isValidDateRange(range = {}, available = {}) {
  const minDate = cleanDate(available.minDate);
  const maxDate = cleanDate(available.maxDate);
  const startDate = cleanDate(range.startDate);
  const endDate = cleanDate(range.endDate);
  return Boolean(minDate && maxDate && startDate && endDate
    && startDate >= minDate && endDate <= maxDate && startDate <= endDate
    && dateValue(startDate) && dateValue(endDate));
}

/** A report row is included when its reporting interval overlaps the selected interval. */
export function filterAdsByDateRange(rows = [], range = {}) {
  const startDate = cleanDate(range.startDate);
  const endDate = cleanDate(range.endDate);
  if (!startDate || !endDate) return [...rows];
  return rows.filter(row => {
    const rowStart = cleanDate(row?.dateStart || row?.dateEnd || row?.date);
    const rowEnd = cleanDate(row?.dateEnd || row?.dateStart || row?.date);
    return rowStart && rowEnd && rowEnd >= startDate && rowStart <= endDate;
  });
}

export function getDateRangePresets(available = {}) {
  const minDate = cleanDate(available.minDate);
  const maxDate = cleanDate(available.maxDate);
  if (!minDate || !maxDate) return [];
  const max = dateValue(maxDate);
  const clamp = range => clampDateRange(range, { minDate, maxDate });
  return [
    { key: 'all', label: '全部数据', range: { startDate: minDate, endDate: maxDate } },
    { key: 'last7', label: '最近 7 天', range: clamp({ startDate: isoDate(shiftDays(max, -6)), endDate: maxDate }) },
    { key: 'last14', label: '最近 14 天', range: clamp({ startDate: isoDate(shiftDays(max, -13)), endDate: maxDate }) },
    { key: 'last30', label: '最近 30 天', range: clamp({ startDate: isoDate(shiftDays(max, -29)), endDate: maxDate }) },
    { key: 'thisMonth', label: '本月', range: clamp({ startDate: isoDate(monthStart(max)), endDate: isoDate(monthEnd(max)) }) },
    { key: 'lastMonth', label: '上月', range: clamp({ startDate: isoDate(monthStart(max, -1)), endDate: isoDate(monthEnd(max, -1)) }) }
  ];
}

export function formatDateRange(range = {}, emptyLabel = '未识别报告日期') {
  const startDate = cleanDate(range.startDate);
  const endDate = cleanDate(range.endDate);
  return startDate && endDate ? `${startDate} 至 ${endDate}` : emptyLabel;
}

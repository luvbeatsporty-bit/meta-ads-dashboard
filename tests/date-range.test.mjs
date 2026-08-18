import assert from 'node:assert/strict';
import {
  clampDateRange,
  filterAdsByDateRange,
  formatDateRange,
  getAvailableDateRange,
  getDateRangePresets,
  isValidDateRange
} from '../date-range.js';

const rows = [
  { id: 'jan', dateStart: '2026-01-01', dateEnd: '2026-01-31' },
  { id: 'feb', date: '2026-02-15' },
  { id: 'mar', dateStart: '2026-03-01', dateEnd: '2026-03-31' }
];

const available = getAvailableDateRange(rows);
assert.deepEqual(available, { minDate: '2026-01-01', maxDate: '2026-03-31' });
assert.equal(formatDateRange({ startDate: available.minDate, endDate: available.maxDate }), '2026-01-01 至 2026-03-31');
assert.equal(isValidDateRange({ startDate: '2026-02-01', endDate: '2026-02-28' }, available), true);
assert.equal(isValidDateRange({ startDate: '2025-12-31', endDate: '2026-01-31' }, available), false);
assert.equal(isValidDateRange({ startDate: '2026-03-01', endDate: '2026-02-28' }, available), false);
assert.equal(isValidDateRange({ startDate: '2026-02-30', endDate: '2026-03-01' }, available), false);
assert.deepEqual(clampDateRange({ startDate: '2025-12-31', endDate: '2026-04-01' }, available), {
  startDate: '2026-01-01', endDate: '2026-03-31'
});
assert.deepEqual(filterAdsByDateRange(rows, { startDate: '2026-02-01', endDate: '2026-02-28' }).map(row => row.id), ['feb']);
assert.deepEqual(filterAdsByDateRange(rows, { startDate: '2026-01-31', endDate: '2026-02-01' }).map(row => row.id), ['jan']);
assert.equal(filterAdsByDateRange([{ id: 'no-date' }], {}).length, 1, 'no-date data remains usable when date filtering is disabled');

const presets = getDateRangePresets(available);
assert.deepEqual(presets.find(item => item.key === 'last7').range, { startDate: '2026-03-25', endDate: '2026-03-31' });
assert.deepEqual(presets.find(item => item.key === 'last30').range, { startDate: '2026-03-02', endDate: '2026-03-31' });
assert.deepEqual(presets.find(item => item.key === 'thisMonth').range, { startDate: '2026-03-01', endDate: '2026-03-31' });
assert.deepEqual(presets.find(item => item.key === 'lastMonth').range, { startDate: '2026-02-01', endDate: '2026-02-28' });
assert.deepEqual(getDateRangePresets({ minDate: '2026-03-25', maxDate: '2026-03-31' }).find(item => item.key === 'last30').range, {
  startDate: '2026-03-25', endDate: '2026-03-31'
});
assert.deepEqual(getAvailableDateRange([{ spend: 1 }]), { minDate: null, maxDate: null });
console.log('date range tests passed');

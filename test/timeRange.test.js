import { describe, expect, it } from 'vitest';
import {
  dashboardRangeDays,
  filterRowsByDashboardRange,
  normalizeDashboardRange,
} from '../src/renderer-svelte/timeRange.js';

const rows = [
  { date: '2026-01-01', value: 1 },
  { date: '2026-01-24', value: 2 },
  { date: '2026-01-25', value: 3 },
  { date: '2026-01-31', value: 4 },
];

describe('dashboard time ranges', () => {
  it('normalizes persisted values and exposes preset durations', () => {
    expect(normalizeDashboardRange('90d')).toBe('90d');
    expect(normalizeDashboardRange('nonsense')).toBe('all');
    expect(dashboardRangeDays('7d')).toBe(7);
    expect(dashboardRangeDays('all')).toBeNull();
  });

  it('anchors a bounded range to the newest available row', () => {
    expect(filterRowsByDashboardRange(rows, '7d').map(row => row.value)).toEqual([3, 4]);
  });

  it('preserves the full series for All and ignores undated rows when bounded', () => {
    const withUnknown = [...rows, { date: '', value: 5 }];
    expect(filterRowsByDashboardRange(withUnknown, 'all')).toHaveLength(5);
    expect(filterRowsByDashboardRange(withUnknown, '30d')).toHaveLength(3);
  });

  it('supports alternate date fields', () => {
    const sales = [{ disposedAt: '2025-12-01' }, { disposedAt: '2026-01-31' }];
    expect(filterRowsByDashboardRange(sales, '30d', row => row.disposedAt)).toEqual([sales[1]]);
  });
});

export const DASHBOARD_RANGES = [
  { value: '7d', label: '7D', description: 'Last 7 days', days: 7 },
  { value: '30d', label: '30D', description: 'Last 30 days', days: 30 },
  { value: '90d', label: '90D', description: 'Last 90 days', days: 90 },
  { value: '1y', label: '1Y', description: 'Last year', days: 365 },
  { value: 'all', label: 'All', description: 'All history', days: null },
];

export const DEFAULT_DASHBOARD_RANGE = 'all';

export function normalizeDashboardRange(value) {
  return DASHBOARD_RANGES.some(option => option.value === value)
    ? value
    : DEFAULT_DASHBOARD_RANGE;
}

export function dashboardRangeDays(value) {
  return DASHBOARD_RANGES.find(option => option.value === normalizeDashboardRange(value))?.days ?? null;
}

export function dashboardRangeDescription(value) {
  return DASHBOARD_RANGES.find(option => option.value === normalizeDashboardRange(value))?.description ?? 'All history';
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterRowsByDashboardRange(rows, range, getDate = row => row?.date) {
  const source = Array.isArray(rows) ? rows : [];
  const days = dashboardRangeDays(range);
  if (days == null || !source.length) return [...source];

  const dated = source
    .map(row => ({ row, key: String(getDate(row) || '').slice(0, 10) }))
    .filter(item => parseDateKey(item.key));
  if (!dated.length) return [];

  const anchorKey = dated.reduce((latest, item) => item.key > latest ? item.key : latest, dated[0].key);
  const cutoff = parseDateKey(anchorKey);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffKey = dateKey(cutoff);
  return dated.filter(item => item.key >= cutoffKey && item.key <= anchorKey).map(item => item.row);
}

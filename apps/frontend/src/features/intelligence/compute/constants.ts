// compute/constants.ts — Shared constants for Intelligence compute modules

export const MACHINES = ['PRM019', 'PRM020', 'PRM031', 'PRM039', 'PRM042', 'PRM043'] as const;

export const MACHINE_AREA: Record<string, string> = {
  PRM019: 'PG1',
  PRM020: 'PG1',
  PRM031: 'PG2',
  PRM039: 'PG2',
  PRM042: 'PG2',
  PRM043: 'PG1',
};

// Customer code map: item_id ranges → customer codes (from ISOP row order)
export const CUSTOMER_BY_ITEM_RANGE: Array<{ from: number; to: number; code: string }> = [
  { from: 1, to: 40, code: '210020' },
  { from: 41, to: 49, code: '210099' },
  { from: 50, to: 53, code: '210112' },
  { from: 54, to: 55, code: '210194' },
  { from: 56, to: 70, code: '210204' },
  { from: 71, to: 74, code: '210208' },
  { from: 75, to: 75, code: '210273' },
  { from: 76, to: 76, code: '210582' },
  { from: 77, to: 78, code: '210588' },
  { from: 79, to: 79, code: '210588' },
  { from: 80, to: 80, code: '210592' },
  { from: 81, to: 81, code: '210602' },
  { from: 82, to: 84, code: '210604' },
  { from: 85, to: 85, code: '210605' },
  { from: 86, to: 88, code: '210610' },
];

export function getCustomerForItem(itemId: string): string {
  const num = parseInt(itemId.replace('item-', ''), 10);
  for (const range of CUSTOMER_BY_ITEM_RANGE) {
    if (num >= range.from && num <= range.to) return range.code;
  }
  return '210020';
}

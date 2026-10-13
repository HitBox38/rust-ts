// Range-table lookup shared by generated unicode tables.

/** `table` is flat [start, end] inclusive pairs, sorted. */
export function in_table(table: Uint32Array, c: number): boolean {
  let lo = 0;
  let hi = (table.length >> 1) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c < table[mid * 2]!) hi = mid - 1;
    else if (c > table[mid * 2 + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * `table` is flat [c, m0, m1, m2] quads sorted by c (a generated mapping table). Returns the index of
 * c's quad, or -1 if c maps to itself.
 */
export function mapping_index(table: Uint32Array, c: number): number {
  let lo = 0;
  let hi = (table.length >> 2) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = table[mid * 4]!;
    if (c < k) hi = mid - 1;
    else if (c > k) lo = mid + 1;
    else return mid * 4;
  }
  return -1;
}

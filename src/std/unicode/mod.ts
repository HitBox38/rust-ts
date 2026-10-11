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

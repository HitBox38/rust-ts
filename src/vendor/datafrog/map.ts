// Port of datafrog =2.0.1 `src/map.rs`.
//
//! Map functionality.

import { type Ord, Relation, type Variable } from "./lib.ts";

// crate: datafrog-2.0.1/src/map.rs:5 map_into
export function map_into<T1 extends Ord, T2 extends Ord>(input: Variable<T1>, output: Variable<T2>, logic: (t: T1) => T2): void {
  const results: T2[] = input.recent.value.iter().map((t) => logic(t));

  output.insert(Relation.from_vec(results));
}

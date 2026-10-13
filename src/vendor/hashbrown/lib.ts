// Port of hashbrown =0.17.1 `src/lib.rs` (re-exports of the ported subset).
//
// PORT: only the parts of hashbrown that decide bucket placement and iteration order are ported
// (control bytes, the NEON group of the oracle host, `RawTable`, and the `HashMap` / `HashSet`
// operations rustc uses); see raw.ts / map.ts / set.ts.
export { HashMap, debug_HashMap } from "./map.ts";
export { HashSet, debug_HashSet } from "./set.ts";
export { RawTable, TableLayout, type TryReserveError } from "./raw.ts";

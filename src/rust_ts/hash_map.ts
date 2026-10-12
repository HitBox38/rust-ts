// Debug of `std::collections::HashMap` / `FxHashMap` values ported as JS `Map`s (PORTING §5).
import { type Debug, debug_map, type Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";

/**
 * `<HashMap<K, V> as Debug>::fmt`: `f.debug_map().entries(self.iter()).finish()`.
 * PORT: `HashMap::iter` yields entries in hashbrown bucket order (FxHasher is unseeded, so rustc's
 * order is deterministic but depends on hashes, capacity and insertion history). With at most one
 * entry the order cannot matter, so that case is exact; larger maps stay unported until hashbrown
 * and FxHasher are ported.
 */
export function debug_HashMap<K, V>(v: Map<K, V>, f: Fmt, debug_K: Debug<K>, debug_V: Debug<V>): string {
  if (v.size > 1) unported("std::collections::HashMap Debug iteration order (hashbrown + FxHasher)");
  return debug_map(
    f,
    [...v].map(([k, x]) => [debug_K(k, f), debug_V(x, f)]),
  );
}

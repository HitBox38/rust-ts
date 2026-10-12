//! Contains thread-safe variants.
//
// Port of intl-memoizer 0.5.3, src/concurrent.rs. Representation as in ./lib.ts (see its header).
// PORT: `Mutex<type_map::concurrent::TypeMap>` is the map itself; `lock().unwrap()` cannot fail
// (single thread, no poisoning).
import { Ok, type Result } from "../../std/result.ts";
import type { LanguageIdentifier } from "../unic_langid/lib.ts";
import { concurrent as type_map_concurrent } from "../type_map/lib.ts";
import type { Memoizable } from "./lib.ts";

/// A thread-safe version of the [`intl_memoizer::IntlLangMemoizer`](super::IntlLangMemoizer).
/// See the single-thread version for more documentation.
// #[derive(Debug)]
export class IntlLangMemoizer {
  constructor(
    public lang: LanguageIdentifier,
    public map: type_map_concurrent.TypeMap,
  ) {}

  /// Create a new [`IntlLangMemoizer`] that is unique to a specific [`LanguageIdentifier`]
  // crate: intl-memoizer-0.5.3/src/concurrent.rs:15 new
  static new(lang: LanguageIdentifier): IntlLangMemoizer {
    return new IntlLangMemoizer(lang, type_map_concurrent.TypeMap.new());
  }

  /// Lazily initialize and run a formatter. See
  /// [`intl_memoizer::IntlLangMemoizer::with_try_get`](crate::IntlLangMemoizer::with_try_get)
  /// for documentation.
  // crate: intl-memoizer-0.5.3/src/concurrent.rs:25 with_try_get
  with_try_get<I, Args, E, R>(I: Memoizable<I, Args, E>, args: Args, cb: (i: I) => R): Result<R, E> {
    const map = this.map;
    const cache = type_map_concurrent.Entry.or_insert_with(map.entry(I.memoizer_cache), () => new Map<string, I>());

    let e: I;
    const key = I.args_key(args);
    if (cache.has(key)) {
      e = cache.get(key)!;
    } else {
      const val = I.construct(this.lang.clone(), args);
      if (val.$ === "Err") return val;
      cache.set(key, val._0);
      e = val._0;
    }
    return Ok(cb(e));
  }
}

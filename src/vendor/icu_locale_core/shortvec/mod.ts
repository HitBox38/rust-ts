// icu_locale_core 2.3.0 `src/shortvec/mod.rs` and `src/shortvec/litemap.rs`: not ported.
//
// PORT: `ShortBoxSlice<T>` (a small-vector: zero/one inline item or a boxed slice) is a plain
// `T[]` everywhere in the TS port (PORTING §5: SmallVec-like containers → `T[]`), and the
// `litemap::Store` impls for it are the array operations in src/vendor/litemap/map.ts.
// `remove` keeps upstream's assertion message (see extensions/unicode/value.ts `remove_subtag`).
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:63 default `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:76 default `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:84 new `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:91 new_single `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:96 new_double `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:108 push `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:125 single `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:136 into_single `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:146 len `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:160 is_empty `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:169 insert `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:199 remove `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:232 clear `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:239 retain `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:268 deref `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:282 deref_mut `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:297 from `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:310 from_iter `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:342 next `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:358 into_iter `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:383 test_new_single_const `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/mod.rs:392 test_get_single `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:21 lm_get_range `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:28 lm_len `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:33 lm_is_empty `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:39 lm_get `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:44 lm_last `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:57 lm_binary_search_by `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:67 lm_sort_from_iter `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:74 lm_with_capacity `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:78 lm_reserve `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:80 lm_get_mut `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:84 lm_push `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:88 lm_insert `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:92 lm_remove `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:96 lm_clear `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:103 lm_retain `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:110 lm_extend `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:159 lm_iter `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:174 lm_iter_mut `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:183 lm_into_iter `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:193 test_short_slice_impl `ShortBoxSlice<T>` is `T[]`
// crate-skip: icu_locale_core-2.3.0/src/shortvec/litemap.rs:198 test_short_slice_impl_full `ShortBoxSlice<T>` is `T[]`
export {};

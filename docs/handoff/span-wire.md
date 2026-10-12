# Handoff: span-wire (rustc_span integration fixer)

## Evidence
- `bunx tsc --noEmit -p .`: clean. `bun test src`: 60 pass, 0 fail, 0 skip. `bun test tools`: 6 pass.
- `bun scripts/coverage.ts --check`: markers ok (618). rustc_span 538/658: only source_map.rs,
  source_map/tests.rs and caching_source_map_view.rs (next lane) are missing.
- `RUST_TS_AGENT=span-wire bun scripts/difftest.ts --suite escape --sample 2000`: 2000/2000 MATCH
  (run `20261012-044620-span-wire-bwt4`).
- Float Debug: 11158 f64/f32 bit patterns (specials, thresholds 1e-4/1e16, powers of 10 and 2,
  subnormals, f32::MAX/MIN_POSITIVE, 6600 random bit patterns) compared with `rustc +nightly`
  `{:?}`: 0 mismatches. Scratch: `D:/rust-ts-data/tmp/span-wire/floats/` (gen.ts, main.rs, cmp.ts).
  426 of them are in `src/std/fmt.test.ts`.
- Module init order: each rustc_span module was imported first in a fresh process, then
  `create_default_session_globals_then(() => debug_Ident(Ident.from_str("main")))` ran. All gave `main#0`.

## Files
Edited: `src/rustc_span/{lib,span_encoding,hygiene,symbol,def_id,edition}.ts`, the tests
(`tests.test.ts`, `hygiene.test.ts`, `symbol/tests.test.ts`, `edit_distance/tests.test.ts`),
`src/std/{char,fmt}.ts`, `src/vendor/rustc_literal_escaper/lib.ts`, `tools/codegen/typemap.json`,
`docs/contracts/rustc_span.md` (rewritten for the integrated API).
New: `src/std/fmt.test.ts`, `src/rustc_hashes/lib.ts`, `src/rustc_data_structures/{fingerprint,atomic_ref}.ts`,
`src/rustc_data_structures/sync/freeze.ts`, `src/rustc_index/newtype_index.ts`.
Outside the owned list: `src/rust_ts/escapedump.ts`, which only has its call sites updated for the escaper's renamed companion methods.

## Wiring (all stand-ins removed)
- lib.ts uses the real hygiene exports (`SyntaxContext.*`, `ExpnId.root`, `ExpnData`, `DesugaringKind_eq`,
  `HygieneData.new`, `debug_SyntaxContext`), def_id's `LOCAL_CRATE`/`StableCrateId`, and `Interner.with_extra_symbols`.
  Bug found and fixed: `is_desugaring` compared `DesugaringKind` objects with `===` and
  `is_from_async_await` compared them with strings. They now use `DesugaringKind_eq` and `.$`.
- span_encoding.ts: the `SyntaxContext_*` stand-ins are replaced by hygiene's `SyntaxContext` companion.
- symbol.ts: the shims are replaced by `DUMMY_SP`, `Span.*`, `SyntaxContext.dollar_crate_name`,
  `debug_SyntaxContext`, `Edition.*` and `Edition_discriminant`.
- hygiene.ts: the seams are replaced by `Span.*`, lib's `debug_Span`, symbol's `debug_Symbol`/`display_Symbol`,
  and edition's `debug_Edition`. `SourceMap` is now the lib.ts placeholder type.
- Tests: `without_first_quote_test` and `test_find_best_match_for_name` are now plain `test(...)` (the runtime
  skip is gone). `test_trim` and the span test use `create_default_session_globals_then`.

## Normalisations (PORTING §8 and the review in docs/reviews/wave1.md)
- `&mut` handle methods take `MutRef<T>` everywhere. `Span.remove_mark/adjust/normalize_to_macros_2_0_and_adjust`
  now take `MutRef<Span>` and return only the upstream result (before: `[span, result]` tuples).
- `mark_with_reason` (hygiene.rs `impl Span`) is now `Span.mark_with_reason`, attached through the Span
  namespace augmentation like lib.rs's `impl Span`.
- Enum methods are on the companion: `Edition.*` (the free `Edition_*` fns are gone), `EscapeError.is_fatal`,
  `Mode.in_double_quotes`, `Mode.prefix_noraw`. `Edition_discriminant` is a `Record<Edition, number>` (the codegen form).
- Debug: `debug_Edition: Debug<Edition>`. hygiene's private copies of `debug_Edition`/`debug_Span`/`debug_Symbol` are removed.
- `_eq` naming: `span_data_eq` became `SpanData_eq` and `source_file_hash_eq` became `SourceFileHash_eq`.
- Stand-ins are deduplicated:
  - `Hash64`/`Hash128` are in `src/rustc_hashes/lib.ts`. This mirrors upstream `rustc_hashes`, not
    rustc_data_structures as root suggested.
  - `Fingerprint`, `AtomicRef` and `FreezeLock` are in `src/rustc_data_structures/`, with markers. `FreezeLock`
    gained `with`/`borrow`/`clone`, and the `write()` expect message now matches upstream.
  - There is one `newtype_index` helper in `src/rustc_index/newtype_index.ts`. def_id.ts, hygiene.ts, lib.ts
    (`AttrId`) and symbol.ts (`SymbolIndex`, which was inlined before) all use it.
- hygiene: `ExpnData.clone()` was added (derive Clone). `LocalExpnId.fresh`/`set_expn_data` clone before
  `update_disambiguator` mutates, which fixes the review finding.
- typemap.json:
  - `Span` now imports from `src/rustc_span/lib.ts`, because upstream's Debug impl is in lib.rs.
  - `f64`/`f32` map to `debug_f64`/`debug_f32` and are registered as helpers.
  - `Cell`/`RefCell` print `Cell { value: .. }` / `RefCell { value: .. }` instead of being transparent.
  - Every typemap import/value resolves; checked with `D:/rust-ts-data/tmp/span-wire/tmcheck.ts`.
- New Debug exports: `debug_AttrId` (+ `AttrId` companion). The other typemap Debug fns already existed. A
  test (`rust-ts: typemap Debug exports`) pins every one of them.
- std: `to_digit(c, radix)` (now with core's radix assert) and `is_whitespace(c)` are in `src/std/char.ts`.
  `debug_f64`/`debug_f32` are in `src/std/fmt.ts`: a port of `float_to_general_debug` + flt2dec (decode,
  estimate_scaling_factor, Dragon `format_shortest` in BigInt, digits_to_dec/exp_str). Upstream's Grisu path
  either equals Dragon or falls back to it.

## Remaining `unported(...)` in rustc_span (genuine gaps)
- source_map.rs (next lane): `SourceMap::{with_inputs, is_span_accessible, is_imported (lib.ts and hygiene.ts),
  span_to_diagnostic_string}`.
- StableHasher (rustc_data_structures): `FileName::*_source_code` hashes ×6, `StableSourceFileId::hash`,
  `StableCrateId::new`, `ExpnData::hash_expn`, plus `<DefId as ToStableHashKey>` (blocks
  `LocalExpnId::fresh`/`set_expn_data`/`mark_with_reason`).
- `blake3::hash`, `unicode_width::UnicodeWidthChar::width` (non-ASCII), `std::path::Path::file_name`
  (host-dependent), and `debug_hygiene_data(verbose)` (hash-order `{:#?}`).

## For root
- Concurrent lane ast-types: `newtype_index` moved from `def_id.ts` to `src/rustc_index/newtype_index.ts`,
  and `Hash64`/`Fingerprint`/`AtomicRef` moved out of def_id.ts. Fix any imports at merge.
- Not done (outside this scope): hygiene's `KeyedMap` stays local (the review suggested moving it to src/std).
  The private lib.ts helpers `Span_try_metavars`/`Span_prepare_to_combine`/`Span_with_ctxt_from_mark` stay
  module-level functions, not companion members.
- `FreezeLock.clone` in `SourceFile.clone` shares the inner value (`(v) => v`), as the code did before.
  Upstream deep-clones the lines Vec, but nothing mutates it after freezing.

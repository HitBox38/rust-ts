# Handoff: query-keys (plan-m5 wave 31): the remaining `QueryKey` impls of rustc_middle query/keys.rs

Branch `lane/query-keys` (from main `fb048c64`; no merges).

## Files touched
- `src/rustc_middle/query/keys.ts`: the five missing `impl QueryKey` blocks, in upstream order:
  - :350 `(CanonicalQueryInput<T>, usize)`: the generic factory `canonical_query_input_usize_key(debug_V)`, next to the
    `CanonicalQueryInput<T>` / `(.., bool)` factories. No query uses it at the pin, so it has no `KEY_*` instance.
  - :356 `CanonicalInput` → `KEY_CanonicalInput`; :362 `(CanonicalInput, bool)` → `KEY_CanonicalInput_bool`. These are
    unused at the pin too, so they have no config entry.
  - :404 `(LocalExpnId, &TokenStream)` → `KEY_LocalExpnId_TokenStream` (`derive_macro_expansion`). `default_span` is
    `self.0.expn_data().call_site`.
  - :418 `(Instance, CollectionMode)` → `KEY_Instance_CollectionMode` (`items_of_instance`). `default_span` forwards to
    `KEY_Instance`.
  - The old "not ported yet" PORT note is gone, and the canonical-inputs PORT note is updated.
- `src/rustc_middle/mono.ts` (**outside the lane's file list**): `CollectionMode` (mono.rs:712), a fieldless enum
  (string union + companion const + `debug_CollectionMode`) with a `// rustc-type:` marker, appended at the end of the
  file. It is the key type of `items_of_instance`, and it was not ported anywhere. (`rustc_ty_utils/opaque_types.ts` has
  an unrelated private `CollectionMode`.) mono.rs is not a codegen set, so I wrote it by hand in its mirrored file
  rather than generating all of mono.rs. Root: please accept this or move it.
- `tools/codegen/queries.config.json`:
  - two `keys` entries (`LocalExpnId_TokenStream`, `Instance_CollectionMode`);
  - one `types` entry mapping `rustc_middle::mono::CollectionMode` to mono.ts. `genTypeIndex` only reads `*.gen.ts`, so
    the hand-written type needs this entry.
- `src/rustc_middle/queries.gen.ts`: regenerated.
- `tools/codegen/queries.test.ts`: new test "key impls: every query key has a `QueryKey` impl". It checks:
  - the report has no unported keys;
  - the generated file has no `key_unported(`;
  - the two new `key:` lines and the `items_of_instance` key type;
  - a synthetic key type with no config entry still falls back to `key_unported(..)`.

## PORT decisions
- `&TokenStream` is the `TokenStream` object. Its derived `Hash`/`Eq` compare the token trees by value, so the cache key
  is `intern_key` of `[LocalExpnId, TokenStream]`. (A note in keys.ts says this.)
- In keys.ts, `debug_TokenStream` and `debug_CollectionMode` are read lazily with `require`, because keys.ts is in
  ty/context.ts's import closure. `TokenStream` is reached through `rustc_ast/lib.ts` (PORTING §8, as in
  ty/consts/lit.ts).

## unported(...) left
None added. `key_unported` itself stays in keys.ts as the fallback for future key types. It now has no uses in
queries.gen.ts.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/query/keys.rs`: **63/63 ported** (was 58/63).
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/mono.rs`: 8/41. This is unchanged: a type has no fn
  markers.
- `bun scripts/coverage.ts --check`: `markers ok (22992; vendor 4680)`.
- `bun tools/codegen/queries.ts --check`: up to date, **unported key impls: 0** (was 2); unknown types 120 (was 121).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_middle`: 349 pass, 0 fail.
- `bun test tools/codegen/queries.test.ts`: 6 pass, 0 fail.

## Samples (`RUST_TS_AGENT=root-f5de`; before = clean `fb048c64` checkout, after = `lane/query-keys`)
| suite | before | after |
|---|---|---|
| mir --sample 300 | 297 MATCH / 1 UNPORTED / 2 UNSTABLE | 297 / 1 / 2 (same) |
| tydump-ui --sample 300 | 298 MATCH / 2 UNSTABLE | 298 / 2 (same) |
| mir-minicore | 46/46 MATCH | 46/46 MATCH |

The one mir UNPORTED is `tests/ui/const-generics/transmute-fail.rs`: "rustc_abi::Size beyond 2^53". It is unrelated to
this lane.

## check-core-bin
`bun scripts/difftest.ts --suite check-core-bin` (alone on the machine, no gate running). Run
`20261029-210623-root-f5de-ftkl`:
- Result: **UNPORTED at `rustc_metadata::fs::encode_and_write_metadata (metadata encoding; plan-m5 waves 32-33)`**.
  - It no longer stops at a `QueryKey`. The whole analysis of core now runs, and the next stop is the planned
    encoder work.
- Subject: 151.3 s wall, **174.8 s user**, **8827 MB max RSS** (harness numbers; budget 12288 MB), exit 70. `/usr/bin/time`
  on the whole difftest gives 9.26 GB max RSS.
- harness-m5a's baseline was 143 s user / 9.0 GB, but it stopped earlier (at the ValidityRequirement key). The extra
  ~32 s is analysis that now runs further. The oracle takes 4.6 s / 1.05 GB.

## For root
- The `CollectionMode` type in `src/rustc_middle/mono.ts` is outside this lane's file list (see above).
- Stub/contract counts: none pinned the "unported key impls" count, so no test number changed. The only number test is
  the new one, which expects `{}`.

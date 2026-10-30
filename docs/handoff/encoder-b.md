# Handoff: lane encoder-b (plan-m5 wave 33)

Branch `lane/encoder-b`, base main `adaa9d4a`. Ports encoder.rs :651–:1481 into `src/rustc_metadata/rmeta/encoder.ts`:
`encode_crate_root`, `analyze_attr`, the 12 `should_encode_*` predicates and `encode_attrs`. That is all 15 of the
lane's contract fns; every stub is replaced in place by its body and a `// rustc:` marker.

## Files touched

- `src/rustc_metadata/rmeta/encoder.ts`:
  - the bodies of the 15 fns;
  - new imports;
  - one module-level helper, `u128_to_le_bytes`, placed next to the existing `usize_to_le_bytes`.

  The module header and the other lanes' stubs are unchanged.
- `src/rustc_metadata/rmeta/encoder_contract.test.ts` (the pinned contract test):
  - `ported_by` now accepts `// rustc:` markers in :651–:1481 as encoder-b's. The per-lane counts do not move (encoder-b is still 15).
  - In "stubs stop with their lane", `encode_crate_root()` now stops at its first callee, encoder-c's `encode_externally_implementable_items`, so the expected lane is `"encoder-c"`.
  - The `should_encode_span("Mod")` probe is gone, along with its import, because the fn is ported.
- `src/rustc_metadata/rmeta/encoder_b.test.ts` (new, 4 tests):
  - `analyze_attr`: each arm;
  - the predicates: the guarded arms (`Static { nested }`, `Ctor(_, CtorKind)`, `Impl { of_trait }`) and the `false` arms;
  - `should_encode_mir`: every arm, both `should_codegen()` branches, `-Zalways-encode-mir` and comptime fns;
  - `encode_attrs` against a `MemEncoder` `EncodeContext`. This checks the filtered attributes' bytes against `encode_Attribute`, the `attributes` / `attr_flags` table rows, and `IS_DOC_HIDDEN`.

## Coverage

- `bun scripts/coverage.ts --check`: markers ok (23,079; vendor 4,680).
- rmeta/encoder.rs: 26/95 → **41/95** (+15). rustc_metadata 393/453. TOTAL 22,500 / 25,518.
- `--missing compiler/rustc_metadata/src/rmeta/encoder.rs`: nothing is left in :651–:1481.

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_metadata`: 118 pass, 0 fail (14 files).
- Samples (`RUST_TS_AGENT=root-f5de`):

  | suite | before (base main, runs `20261030-192655-root-f5de-zr5q` / `-192741-root-f5de-yc28`) | after |
  |---|---|---|
  | `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run `20261030-193801-root-f5de-u6xd`) |
  | `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE (15 skipped) | 298 MATCH, 2 UNSTABLE (15 skipped; run `20261030-193849-root-f5de-lkdh`) |

  The "before" runs are the earliest root-f5de sample runs on today's shared base. I did not make a base worktree. Every root-f5de run of these two samples since has the same numbers. encoder.ts is not loaded at startup (rmeta/mod.ts comment), so nothing on these paths can change.
- **Small lib crate**: a `#![no_core]` lib with the three sized lang items, `pub fn f() {}` and `pub const C: u32 = 1`, run as `bun src/rust_ts/main.ts --crate-type lib --emit=metadata --edition 2024`.
  - It exits 70 with `unported: rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`.
  - That stop is the stand-in in `src/rustc_metadata/fs.ts:322`, so encoder.ts is not reached yet. Wiring it is encoder-d's job (`encode_metadata` / `with_encode_metadata_header`).
  - Once it is wired, `encode_crate_root` calls, in order:
    1. `encode_externally_implementable_items` (c);
    2. `encode_crate_deps` and `encode_dylib_dependency_formats` (d);
    3. lib features, stability implications, lang items, stripped cfg items, diagnostic items, canonical symbols, fake doc items (d);
    4. native libs, foreign modules (c);
    5. `encode_def_path_table` (a);
    6. traits, impls, incoherent impls (d);
    7. `encode_mir`, `encode_def_ids` (c);
    8. proc macros, debugger visualizers, exportable items, exported symbols (d);
    9. hygiene, source map (done);
    10. `encode_def_path_hash_map` (a);
    11. target modifiers, mitigations (d).

    The first stop is whichever of these is still a stub after the wave merges.

## unported(...) left

- `rustc_metadata::rmeta::encoder::encode_crate_root: -Zmeta-stats (rustc_data_structures::thousands::usize_with_underscores)`. It is reached only with `-Zmeta-stats`. The branch would need two things this lane cannot add:
  - `usize_with_underscores` (rustc_data_structures thousands.rs is not ported, and not my file);
  - `{:4.1}` float formatting with Rust's rounding.

  The stats themselves are collected faithfully, and `assert_eq!(total_bytes, computed_total_bytes)` runs.

## PORT decisions (in the code)

- `macro_rules! stat` is a local closure `stat(label, f)`.
- `record_array!` and `record_value!` are expanded inline in `encode_attrs`. The other `record_*!` macros are not used by this lane.
- `encode_attrs`: the lazy `.iter().filter(|attr| analyze_attr(attr, &mut state))` is a generator. `lazy_array` drives it, so `state.is_doc_hidden` is set during encoding, as upstream does.
- `interpret_alloc_index`: `self.interpret_allocs[idx]` comes from the `Map`'s keys in insertion order, taken once per round of the outer loop. This is sound because encoding only appends past `new_n`.
- `find_attr!(attrs, Kind)` uses rustc_attr_ir's boolean-form helper.
- `local_crate_hash.set(hash).expect("local_crate_hash set twice")`: `Untracked.local_crate_hash` is a plain `Svh | undefined` field. A second set panics with `expect`'s text.
- `assert_eq!(idx, cnum, "dep_extra_filenames must be indexed by CrateNum")` is inlined with its message, because `std/panic.ts`'s `assert_eq` has no message argument.
- Query values typed `unknown` in queries.gen.ts (`constness`, `associated_item`, `generics_of`, `exported_*_symbols`) are cast at the call, as elsewhere in the port.
- `should_encode_mir`'s `match` (one arm has a guard) is an if-chain in arm order.
- In the predicates, arms with sub-patterns are single `case`s returning the pattern's condition, with the upstream arms in a comment: `Static { nested: false }` / `{ nested: true }`, `Ctor(_, CtorKind::Fn)` / `Ctor(..)`, `Impl { of_trait: false }` / `Impl { .. }`.

## For root

- **`crate_hash(LOCAL_CRATE)`.** rustc_middle `hir/map.ts:1667` is still `unported("… Untracked::local_crate_hash …")`. `encode_crate_root` now sets `tcx.untracked().local_crate_hash`, so map.ts can read it: `unwrap(tcx.untracked().local_crate_hash, "crate_hash(LOCAL_CRATE) called before metadata encoding")`. That file is not this lane's.
- Upstream labels two `stat!` sections `"exportable-items"` (the second is `stable_order_of_exportable_impls`); kept as is (it only shows in `-Zmeta-stats`).

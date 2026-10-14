# Handoff: passes-a (M3): rustc_passes entry, diagnostic_items, lib_features, check_export, eii

Branch `lane/passes-a`, based on main 816b5c5. No baselines, suites, scripts, tools, probes or oracle outputs touched.

## Summary
- Ported, in upstream order with markers: rustc_passes `entry.rs`, `diagnostic_items.rs`, `lib_features.rs`,
  `check_export.rs`, `eii.rs`, and the last manual impl in `diagnostics.rs` (`impl Diagnostic for NoMainErr`, E0601).
  `weak_lang_items.rs` was already complete (lane lang-items).
- All providers are registered in `rustc_passes::provide` (lib.ts): `entry_fn`, `diagnostic_items`,
  `all_diagnostic_items`, `lib_features`, `exportable_items`, `stable_order_of_exportable_impls`,
  `check_externally_implementable_items`.
- Off-scope, but directly on the path (every case stopped there right after `entry_fn`): **rustc_metadata `eii.rs`**
  (`collect`, the local `externally_implementable_items` provider), new file `src/rustc_metadata/eii.ts`, plus a one-line
  repoint in `src/rustc_metadata/rmeta/decoder/cstore_impl.ts` (`externally_implementable_items: eii.collect` instead of
  `unported("rustc_metadata::eii::collect")`). **Root: please review this as an out-of-lane change.**

## For passes-b (diagnostics)
The rustc_passes diagnostics set already exists and covers **all of `diagnostics.rs`**: every `#[derive(Diagnostic)]` /
`#[derive(Subdiagnostic)]` type is generated into `src/rustc_passes/diagnostics.gen.ts` (tools/codegen, set
`rustc_passes`), including the check_attr and stability ones. The hand-written manual impls in `diagnostics.ts` are now
complete (2/2: `NoMainErr`, `DuplicateLangItem`). passes-b only needs to import `<Type>_diagnostic` from `./diagnostics.ts`;
nothing has to be generated or added. `rustc_middle::middle::lib_features::{FeatureStability, LibFeatures}` (needed by
stability.rs) is in `src/rustc_middle/middle/mod.ts` as the namespace `lib_features`.

## Files touched
- `src/rustc_passes/entry.ts` (new), `diagnostic_items.ts` (new), `lib_features.ts` (new), `check_export.ts` (new),
  `eii.ts` (new), `diagnostics.ts` (`NoMainErr_into_diag` / `NoMainErr_diagnostic`), `lib.ts` (exports, `provide`).
- `src/rustc_session/config/sigpipe.ts` (new): config/sigpipe.rs, constants only (the file has no fns).
- `src/rustc_middle/middle/mod.ts` (new): the inline `pub mod lib_features` of middle/mod.rs (`FeatureStability`,
  `LibFeatures`, `to_sorted_vec`).
- `src/rustc_metadata/eii.ts` (new) + `rmeta/decoder/cstore_impl.ts` repoint (see Summary).
- Tests: `src/rustc_passes/entry.oracle.test.ts` (new), driver `src/rustc_passes/oracle/entry_run.ts` (new, not a port).

## Coverage (`bun scripts/coverage.ts --missing`)
- rustc_passes: entry.rs 6/6, diagnostic_items.rs 6/6, lib_features.rs 7/7, check_export.rs 21/21, eii.rs 2/2,
  weak_lang_items.rs 2/2, diagnostics.rs 2/2, lib.rs 1/1.
- rustc_middle/src/middle/mod.rs 1/1; rustc_metadata/src/eii.rs 1/1.
- `bun scripts/coverage.ts --check`: markers ok (13380; vendor 3888).

## Tests
- `src/rustc_passes/entry.oracle.test.ts`, 22 cases, all pass. The oracle is the pinned rustc itself
  (`--emit=metadata`); the subject runs the queries from `after_expansion` in `run_required_analyses` order, then
  `abort_if_errors`. stderr and exit code are byte-identical with rustc for: E0601 (span at crate end, empty file
  `file_empty` note, nested `main` notes, `static main` label, `-Zteach`), E0137 (two `#[rustc_main]`), `ExternMain`,
  `#[rustc_main]` over `main`, `main` via `use`, `-Zon-broken-pipe=kill|error|inherit` (sigpipe 3/2/1), lib crate and
  `#![no_main]` (None), `EiiWithoutImpl` in a binary, explicit and default EII impls, duplicate diagnostic item, E0711
  (stable twice / stable after unstable / unstable after stable), and the collected lib features (`CURRENT_RUSTC_VERSION`
  -> `sym::env_CFG_RELEASE` = the pinned release). (There is no `#[start]` any more at the pin: `EntryFnType` has only
  `Main`.)
- `bun scripts/difftest.ts --suite tydump-nocore --sample 300` (RUST_TS_AGENT=passes-a, run 20261014-165410-passes-a-28hv):
  20 MATCH / 0 DIFF / 280 UNPORTED. All 280 stop at `rust_ts::tydump::prefix::run_required_analyses_prefix` (this base
  has no tydump prefix; lane tydump-subject adds it), so the suite cannot reach these passes here.
- Measurement only (not committed): a scratch worktree with lane/tydump-subject merged into this branch, same sample as
  that lane (RUST_TS_AGENT=tydump-subject, run 20261014-165550-tydump-subject-454e): **38 MATCH / 0 DIFF / 262 UNPORTED**.
  Stop histogram: **256 `check_mod_attrs provider (not ported)`** (passes-b; before: 256 `entry_fn provider`), 5
  `skip_binder of tcx.fn_sig(..)` (delegation), 1 `BangProcMacro::expand`. So every case now gets past `entry_fn`,
  `check_externally_implementable_items`, `exportable_items` and `stable_order_of_exportable_impls`. Merge note: the
  only conflict with lane/tydump-subject is the module list in `src/rustc_passes/lib.ts` (take both: the
  `delegation` export line and this lane's `diagnostic_items` comment).
- `--suite hir-tree-nocore --sample 100` (run 20261014-165644-passes-a-zbz4): 99 MATCH / 0 DIFF / 1 UNPORTED
  (`tests/ui/delegation/self-coercion-static-free.rs`, `fn_sig` skip_binder, not protected, pre-existing).

## Known stops reached from these passes (not ported, outside this lane)
- `effective_visibilities provider (not ported)` (rustc_privacy): reached by `exportable_items` only for
  `--crate-type=sdylib` / `-Zbuild-sdylib-interface` with `#[export_stable]` items.
- `Decodable for rustc_metadata::rmeta::EiiMapEncodedKeyValue` (codegen): reached by
  `check_externally_implementable_items` when an extern crate actually has EIIs (e.g. tests/ui/eii/duplicate). Crates
  without EIIs (std, core, ...) decode fine.

## unported(...) left
None in this lane's files.

## PORT decisions
- `entry.ts`: `EntryFnType` (rustc_session config.rs:1617) is a stand-in type here, because rustc_session/config.ts does
  not define it and the codegen typemap types the `entry_fn` value `[DefId, unknown]`. Move it to config.ts when
  config.rs:1617 is ported (and point the typemap at it).
- `rustc_middle/middle/mod.ts`: `LibFeatures` is an interface + companion (not a class), because the metadata decoder
  (`get_lib_features`) builds the extern value as a `{ stability }` record. `to_sorted_vec` sorts by the JS string order
  of the feature names (same as `Symbol`'s `StableCompare` byte order for ASCII names).
- `FxIndexMap<DefId, _>` / `FxIndexSet<DefId>` are `DefIdMap` / `DefIdSet` (check_export, eii) and `KeyedMap` with
  `DefId_hash_key` (metadata eii.rs, the shape the extern provider already builds); all keyed by value,
  insertion-ordered.
- `DiagnosticItems.name_to_id.insert(..)` returns the old value: `get` then `set` (a JS `Map` keeps the key's position,
  as `IndexMap::insert`).
- `check_export.rs` `visit_item`: the second `match` keeps the "handled above" `Impl` arm as `unreachable()`; the `Mod`
  arm is a comment because TS has already narrowed `Mod` out of the type.
- `eii.rs`: `tracing::debug!` is a comment.

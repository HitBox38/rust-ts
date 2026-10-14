# Handoff: merge-w14 (fixer): wave-14 lowering integration + hir-tree-nocore push

Worktree `.data/integ`, branch `integ`, from main `935a15a`. Real `--no-ff` merges, one fix-up commit after each.

## Step 1: merges (in this order) and resolutions
| merge | conflicts | fix-up commit |
|---|---|---|
| lower-index-diag | none | none needed |
| lower-lib-a | none | (with lib-b) |
| lower-lib-b | none textually; 52 tsc `Duplicate identifier` errors | `af7c2f0` |
| lower-item | none | `a8edb44` |
| lower-expr | none | `f2060cd` |
| lower-pat-path-block | none | `6cc651a` |
| lower-asm-format-contract | none | `a8366d1` |
| lower-delegation | none | `1c126f1` |
| middle-hir | none | `73294d8` |
| tyir-kind | none | `056b4e4` |
| harness-w13 (3 suites only; its UPSTREAM.json change was already dropped) | `harness/suites.ts`: both append at the same spot. Kept both: main's tydump/thirdump block, `);`, then harness-w13's hir block | in the merge commit `0b83bd8` |
| lang-items (added by root mid-task) | `rustc_interface/passes.ts` (kept middle-hir's provider wiring; `rustc_passes` dropped from the pending list since lang-items provides it); `rustc_middle/lib.ts` (both extension imports: `hir/mod.ts`, then `middle/lang_items.ts`) | merge `c7f00d0`, follow-up `1f01b26` |

Not merged: `lane/cache-deps`.

### What the fix-ups did
- **lib.ts imports**: lower-lib-b's block reduced to the deduplicated set from its handoff; `Target` and
  `DesugaringKind` became value imports.
- **Generated types are the single source.** lib.ts / expr.ts / format.ts / delegation/{generics,resolution,mod}.ts
  now `export * from "./<file>.gen.ts"`. Every hand-written copy of a generated type, every `*View` /
  `PerOwnerLoweringStateFields` / `TyCtxtLangItemsView` view and cast, every `PORT(pending-gen)` bridge
  (`pending_gen`, `diagnostics_` objects, `new_GenericArgsCtor`), every `declare module ".../diagnostics.ts"` block and
  every `diagnostic_pending` / `pending_diag` stand-in is gone; call sites use `diagnostics.<X>_diagnostic(..)`.
  Methods of generated classes are attached with `declare module "./lib.gen.ts"` + prototype/`Object.assign`
  (PerOwnerLoweringState, SpanLowerer, GenericArgsCtor, UnrepresentableConstArgError) and
  `declare module "./generics.gen.ts"` (GenericsGenerationResult(s), DelegationGenericArgsIterator).
- **Codegen set `rustc_ast_lowering` `hand` entries added** (with notes): `RelaxedBoundPolicy`,
  `expr::WillCreateDefIdsVisitor`, `expr::MoveExprInitializerFinder`, `delegation::SelfResolver`,
  `delegation::attributes::{AdditionInfo, AdditionKind}` (the last two now exported from attributes.ts).
- lower-lib-a's merge-pending helpers replaced by lower-lib-b's real `GenericArgsCtor` /
  `UnrepresentableConstArgError`; `lower_param_bounds_mut` passes `RelaxedBoundPolicy.reborrow(rbp)` per bound.
- `item.ts`: the `lower_where_predicate` dedup map is `Map<LocalDefId, DefIdMap<Span>>` (decls.ts contract changed to
  match); the two `Allowed(new Map())` sites build `DefIdMap`s.
- After middle-hir: `into_owner_info` calls `tcx.hash_owner_nodes` and the newly ported `tcx.needs_owner_info_hash()`
  (context.rs:1175); `create_def`'s assertion text uses `hir_def_key` + `debug_DefKey`; `lower_restriction_kind` uses
  `tcx.parent_module`.
- After tyir-kind: `unported_methods(TyCtxt.prototype, "rustc_middle::ty::context::TyCtxt", [14 inherent Interner
  methods])` in ty/context.ts, so `new_*_from_args` / `yes_if_next_solver` stop as UNPORTED instead of a TypeError.
  `rust_ts/stubs.ts` records each placeholder's path (`unported_stub_path`); ty/contract.test.ts counts context.ts's
  placeholders as still missing, so its pin (`INHERENT_CONTEXT_RS`) is unchanged. ty/decls.ts: `inputs`/`output`
  take `this: List<Ty>`.
- After lang-items: lowering calls the real `require_lang_item`, `is_lang_item`, `lang_items().drop_trait()`,
  `fn_trait_kind_from_def_id`, `async_fn_trait_kind_from_def_id` (path.ts `tcx_method` bridge removed). Probe built
  with `bun scripts/probes.ts build langitems`. All 30 codegen sets regenerated: byte-identical.
- Tests updated to the real behaviour (no expectation weakened; stop-asserting tests now assert the emitted
  diagnostic / produced HIR): item.test.ts / expr.test.ts fake owners cast to `curr_owner`; pat_path_block.test.ts
  (ExtraDoubleDot / MisplacedDoubleDot / ArbitraryExpressionInPattern now emit, segment without args, lang-item
  methods asked in order); delegation.test.ts (DelegationInfersMismatch emits). lib.oracle.test.ts gained
  `--remap-path-prefix` (fixture regenerated against the live oracle; it no longer depends on the checkout path).

## Step 2: hir-tree
Ported (markers on every fn, coverage `--missing` 0 for each):
- `compiler/rustc_hir/src/target_impls.rs` 5/5 → `src/rustc_hir/target_impls.ts` (`Target_from_<X>` free fns,
  re-exported by rustc_hir/lib.ts); lowering's `lower_generic_param` uses `Target_from_GenericParam`.
- `compiler/rustc_passes/src/debugger_visualizer.rs` 5/5 (the query `index_ast` `ensure_done`s; replaced the
  placeholder in rustc_passes/lib.ts) and `compiler/rustc_middle/src/middle/debugger_visualizer.rs` 2/2.
- `TyCtxt::needs_owner_info_hash` (context.rs:1175), `TyCtxt::is_sdylib_interface_build` (context.rs:2807).
- `LinkParser::finalize_check`'s ABI parse (`ExternAbi::from_str` + the `span_delayed_bug` recovery).
- StableHash for attributes: codegen opt-in `derive_stable_hash` for sets `rustc_attr_ir` and `rustc_structures`;
  `rustc_ast`'s `stable_hash_types` + RustcVersion, MetaItemLit, DocFragmentKind, AssocCtxt; manual impls
  `StableHash for HashIgnoredAttrId` (attr.rs:87, hashes nothing) and `for LangItem` (lang_items.rs:153, isize
  discriminant), both formerly `rustc-skip`; stable_hash.json entries for ast DelimArgs/AttrStyle/Path/RustcVersion/
  MetaItemLit/DocFragmentKind/AssocCtxt, span Transparency and the 5 rustc_structures types.
  `hash_owner_nodes` now hashes attribute slices with the generated `stable_hash_Attribute`.

### Histograms (`RUST_TS_AGENT=merge-w14`, same 300-case sample each round; 0 DIFF, 0 CRASH throughout)
| round | change | MATCH | UNPORTED | top stops |
|---|---|---|---|---|
| 0 | all merges | 30 | 270 | 269 `rustc_passes::debugger_visualizer::debugger_visualizers`, 1 proc-macro bridge |
| 1 | debugger_visualizer | 188 | 112 | 92 `target_impls From<&GenericParam>`, 15 `StableHash for rustc_attr_ir::Attribute`, 2 `ExternAbi::from_str`, 1 `is_method`, 1 `is_sdylib_interface_build`, 1 proc-macro |
| 2 | target_impls + attr_ir StableHash | 279 | 21 | 15 StableHash (rustc_structures `CrateType` of `#![crate_type]`), 2 from_str, 2 is_method, 1 is_sdylib, 1 proc-macro |
| 3 | rustc_structures StableHash | 288 | 12 | 5 StableHash (RustcVersion/Align/...), 2 from_str, 2 is_method, 2 is_sdylib, 1 proc-macro |
| 4 | rustc_ast StableHash types | 292 | 8 | 2 from_str, 2 is_method, 2 is_sdylib, 1 StableHash (`rustc_abi::Align`), 1 proc-macro |
| 5 | from_str + is_sdylib_interface_build | **296** | 4 | 2 `TyCtxt::is_method`, 1 StableHash `rustc_abi::Align` (`#[rustc_align]`), 1 proc-macro bridge (M6) |

Wider check, `RUST_TS_AGENT=merge-w14-wide --sample 2000`: 1986 MATCH, 0 DIFF, 14 UNPORTED (8 `is_method`
(delegation; needs `opt_associated_item` → `associated_item` query, not started), 3 StableHash (`rustc_abi::Align`,
autodiff/`CfgEntry` types), 2 proc-macro bridge, 1 `Size::signed_int_max` (format.rs `isize` literal inlining)).

`hir-tree --sample 200`: 199 MATCH, 0 DIFF, 1 UNPORTED (`is_method`).

## Final checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (9439; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4107 pass, 1 skip (pre-existing linux-only), 0 fail.
  The first run had 2 failures, both stale generated pins after the StableHash opt-ins: `queries.gen.ts` regenerated
  (`bun tools/codegen/queries.ts`; 5 query values gained `stable_hash_value`, only used with a dep graph), and
  tools/codegen/attr_ir.test.ts's golden file count 9 -> 10 (the new stable_hash.gen.ts).
- All 30 codegen sets regenerated after every config change: only the intended files changed.
- `RUST_TS_AGENT=merge-w14 --sample 200`: parse 200/200 MATCH (`20261014-042303-merge-w14-w3t1`), expanded 200/200
  (`-dot7`), resdump-nocore 200/200 (`-45xs`): no DIFF/UNPORTED.
- hir-tree-nocore `--sample 300`: 296 MATCH / 0 DIFF / 4 UNPORTED (`20261014-040531-merge-w14-y9ot`);
  hir-tree `--sample 200`: 199 / 0 / 1 (`20261014-040612-merge-w14-jdgr`).

## `unported(...)` left in the files touched here
- lowering: `PartialEq for SpanSnippetError` (asm.rs `equivalent`, only when both snippets fail);
  `UnordMap: StableHash` (`OwnerInfo::opt_hash`, only `-Zmetadata-crate-hash=no` / incremental);
  `Size::{signed,unsigned}_int_max` (format.rs, isize/usize literals); delegation: `AdtDef::did`, `fn_sig` binders,
  `TyCtxt::is_method`, `AssocItems::filter_by_name_unhygienic`, `Ty::super_visit_with`.
- ty/context.ts: placeholders for the 14 inherent Interner methods (lane ty-ctxt).
- generated: `unported_stable_hash` for `rustc_abi::Align`, `CfgEntry`, autodiff `DiffMode`/`DiffActivity`/`TypeTree`.

## PORT decisions (please record)
1. Codegen set `rustc_ast_lowering` is the type source for the crate; hand types: LoweringContext, NodeCollector,
   RelaxedBoundPolicy (`DefIdMap` field), the three ast `Visitor` classes, AdditionInfo/AdditionKind (typed fn
   pointers). `DirectConstArgContext` and `HirOrTyGenerics` keep hand companions that shadow the `export *`
   (generated flags + the `impl` consts; enum methods per PORTING §8).
2. `MisplacedImplTrait.position` is `new DiagArgFromDisplay(() => display_ImplTraitPosition(position))`.
3. asm.rs `equivalent`: `snippet_ne` compares two `Ok` snippets by text, differing variants as unequal, and stops
   UNPORTED for two `Err`s (structural `SpanSnippetError` equality not written).
4. `rustc_hir` `impl From<X> for Target` → free fns `Target_from_<X>` (Target's companion is in rustc_attr_ir).
5. `rust_ts/stubs.ts` `unported_methods` records each placeholder's path (`unported_stub_path`), so contract tests can
   tell placeholders from ports.
6. StableHash opt-in for rustc_attr_ir / rustc_structures and the stable_hash.json entries above (cross-crate types
   whose impls are generated or manual elsewhere).
7. `FinalizeCheckContext`'s `cx.dcx()` is written as the Deref chain `cx.shared.cx.dcx()`.
8. `DebugVisualizerUnreadable.error` is generated as `Error`; the `IoError` is cast (only on an unreadable file).

## For root
- Accept nothing from hir-tree yet: the suites are unprotected; the numbers above are samples.
- Next small stops: `TyCtxt::is_method` needs `opt_associated_item`; StableHash for `rustc_abi::Align`
  (rustc_abi has no codegen set); `TyCtxtFeed::feed_hir` and the stand-ins middle-hir listed (limits.ts
  `hir_krate_attrs`, lint.ts `hir_parent_id_iter`, rustc_resolve `HasAttrs for DefId`, rustc_lint levels/expect)
  can now use the real accessors.
- `lane/cache-deps` is still unmerged.

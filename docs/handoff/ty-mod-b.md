# Handoff: ty-mod-b (M3, wave 15): rustc_middle `ty/mod.rs` lines 1113 to the end

Branch `lane/ty-mod-b` (from main `ab2cdfc`, no merges). Commits: the port; unit tests; this handoff.

## Files touched
- `src/rustc_middle/ty/mod.ts`. Changes outside my region:
  - The shared `import type { .. } from "./decls.ts"` line (line 36): I removed `ImplOverlapKind`,
    `ImplTraitInTraitData`, `PseudoCanonicalInput` and `VariantDef`, because this file defines them now.
  - A `// ty-mod-b imports` block right after the original imports.
  - Nothing else above `TyCtxt_is_descendant_of` changed.
- My region starts after `TyCtxt_is_descendant_of`, at the `// ==== lane ty-mod-b` banner, and runs to the end of the
  file. Its contents, in upstream order:
  - `TypingEnv`: a class with all 11 methods. Plus `debug_TypingEnv`.
  - `PseudoCanonicalInput<T>`, `Destructor`, `AsyncDestructor`, each with its derived Debug.
  - `VariantFlags`: `flags_companion`, plus `debug_VariantFlags`, which is `external_bitflags_debug!`, i.e. `to_writer`.
  - `VariantDef`: a class with `new` and the 10 methods.
    - Its manual `PartialEq` is `VariantDef_eq`.
    - Its manual `Hash` is `key_VariantDef`, the canonical key built from `def_id`.
  - `VariantDiscr`, `FieldDef` (`ty`, `ident`, `FieldDef_eq`, `key_FieldDef`), `ImplOverlapKind`, `ImplTraitInTraitData`,
    each with its Debug.
  - All 49 `impl TyCtxt` fns from 1578 to 2333, as `TyCtxt_<name>`. The delegating methods in context.ts are
    unchanged. `opt_item_name` / `item_name` moved into upstream order; their bodies are unchanged.
  - The 4 `HasAttrs` impls: the tables `HasAttrs_DefId`, `HasAttrs_LocalDefId`, `HasAttrs_OwnerId` and `HasAttrs_HirId`.
  - `provide`.
  - `CrateInherentImpls`, with `_default` and Debug.
  - `SymbolName`: `new`, `display_SymbolName`, `debug_SymbolName`.
  - `DestructuredAdtConst`, with Debug.
  - The stand-ins listed below.
- New: `src/rustc_middle/ty/ty_mod_b.test.ts`, 13 tests.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/ty/mod.rs`: nothing missing at line 1113 or later.
  The file is at 111/150; the 39 that remain are all before line 1113, in ty-mod-a's range.
- `bun scripts/coverage.ts --check`: `markers ok (11133; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see the final note at the end of this file.
- `bun test src/rustc_middle/ty/ty_mod_b.test.ts`: 13 pass.
- Fresh-entry loads of every non-test module under `src/rustc_middle` and `src/rustc_type_ir`: the same set loads as
  on base `ab2cdfc`. Every module that failed before still fails, for the same pre-existing reasons, and nothing new
  fails. `ty/mod.ts`, `rustc_middle/lib.ts` and `rustc_interface/passes.ts` all load.
- `RUST_TS_AGENT=ty-mod-b bun scripts/difftest.ts --suite hir-tree-nocore --sample 300` gave 297 MATCH, 0 DIFF and
  3 UNPORTED (run `20261014-070542-ty-mod-b-v68d`). The 3 UNPORTED are pre-existing and unrelated:
  - two are proc-macro `quote!` (M6);
  - one is `StableHash without a TS impl`.

## The `is_method` stop (hir-tree): still there, now one step deeper
- `TyCtxt::is_method` (context.rs, lane ty-ctxt) → `opt_associated_item` (mine, now real) → the `associated_item`
  query. That query has no local provider: it is `rustc_ty_utils::assoc::associated_item`, which is not ported.
- The UNPORTED cases in `--filter delegation/` (108 of 144) come from rustc_ast_lowering's own stand-in
  `TyCtxt_is_method` in `delegation/resolution.ts:59`. That stand-in does not call `tcx.is_method`.
- Experiment, not committed: I repointed that stand-in at `tcx.is_method`. All 107 of those cases became CRASH with
  `tcx.associated_item(..) is not supported for this key` (the `default_query` ICE).
- **Root:** keep the lowering stand-in until the `associated_item` provider lands (ty-utils, wave 16). Then repoint
  it at `tcx.is_method(id)`.

## `unported(...)` left
- **Not ported in rustc_abi**
  - `TyCtxt_repr_options_of_def`: `ReprOptions`, `ReprFlags`, `IntegerType` and `ScalableElt`. The first statement
    builds a `ReprFlags`, so the fn stops before any query runs.
- **MIR (M4)**
  - `instance_mir`: the failing `assert!`'s message needs `Debug` of `mir::Body` / `InstanceKind`. The rest is ported
    over a `BodyView` / `InstanceKindView`.
  - `coroutine_layout`: the empty proxy `CoroutineLayout` (`SourceInfo::outermost`, `BitMatrix`,
    `RESERVED_VARIANTS`).
  - The stand-in `Body_coroutine_layout_raw`, used by `ordinary_coroutine_layout` and `async_drop_coroutine_layout`.
  - `vtable_allocation_provider`.
- **Stand-ins for other wave-15 lanes.** These are not markers. Each one is a module-local function marked
  `DELETE AT MERGE` or "repoint". The `upstream body` ones are real ports of the upstream fn; the rest call `unported`.
  - **ty-mod-a**
    - `RestrictionKind_` (a type) and `debug_RestrictionKind_`.
    - `ParamEnv_empty`, which `TypingEnv::fully_monomorphized` reaches.
    - `ParamEnv_with_normalized`, which the `with_*_normalized` fns reach.
    - `debug_ParamEnv_`.
    - `ImplTraitHeaderFields`: an interface over the `impl_trait_header` query value.
  - **ty-adt-assoc**
    - `AssocItem_is_fn`, `AssocItem_defaultness` and `AssocItem_trait_item_def_id` (upstream bodies).
    - `AssocItems_in_definition_order`, `AdtDef_variant_with_id`, `AdtDef_variant_with_ctor_id`,
      `AdtDef_non_enum_variant` (all `unported`).
    - `TraitDefFields`: an interface over the `trait_def` query value.
    - `closure_provide` and the four `trait_def_*_provider`s.
  - **ty-results**: `erase_regions_provide`.
  - **ty-util**: `util_provide`.
  - **Not in any current lane**: `inhabitedness_provide` and `util_bug_provide`.
- So `ty::provide` stops UNPORTED at `closure::provide` until those land. It is not wired yet:
  `rustc_interface/passes.ts` still calls `context::provide` and `print::provide` itself, so behaviour today is
  unchanged.
- **Reached through query values typed `unknown`.** These are casts with a `// PORT:` line, not stops:
  `param_env`, `param_env_normalized_for_post_analysis`, `typeck`, `associated_item(s)`, `impl_trait_header`,
  `trait_def`, `adt_def`, `constness`, `opaque_ty_origin`, `type_of`, `optimized_mir`, `mir_for_ctfe`, `mir_shims`,
  `fn_abi_of_instance_*`, `defaultness`.

## PORT decisions (please record)
1. **PORT(decls), pending root.**
   - ty/decls.ts still aliases these types to `Pending<..>`: `VariantDef`, `ImplOverlapKind`, `ImplTraitInTraitData`,
     `PseudoCanonicalInput`, `TypingEnv`, `Destructor`, `AsyncDestructor`, and `Attribute`, which is really
     `rustc_attr_ir::Attribute`.
   - The `TyCtxt_<name>` fns keep those aliases at the context.ts boundary (imported as `*_pending`) and convert with
     `from_pending` / `to_pending`.
   - **Root:** replace those aliases in decls.ts with re-exports of the real types from mod.ts (`Attribute` from
     rustc_attr_ir). Then the two helpers become identities and can be removed.
   - `tools/codegen/tyir.typemap.json` maps `ImplTraitInTraitData` to decls.ts with `debug: null`. It can point at
     mod.ts with `debug_ImplTraitInTraitData`, which would make assoc.gen.ts's `Rpitit` Debug real.
2. **`TypingEnv` placement.** The struct (mod.rs:1102–1109) is just inside ty-mod-a's line range. I define it in my
   region together with its `impl`.
   - Its field `typing_mode` is named `typing_mode_`, because the method `typing_mode()` takes the name (precedent:
     `Ty.flags_`).
   - `debug_TypingEnv` prints the field as `typing_mode`.
   - **Root:** at merge, drop any duplicate `TypingEnv` from ty-mod-a.
3. **Lazy `require` for init order.** binder.ts, visit.ts, fold.ts, unnormalized.ts, infer_ctxt.ts,
   ty_kind/closure.ts, fast_reject.ts, predicate.gen.ts and generic_args.ts all import this defining module, directly
   or transitively. A static value import makes `ty/mod.ts` fail with a TDZ error when it is the first module loaded
   (`fold_Term` in relate.ts).
   - So they are reached through lazy `require` helpers (`binder()`, `visit()`, ...), following the precedent of
     sty/mod.ts.
   - `ty::provide` reaches context.ts and print/pretty.ts the same way.
4. **`HasAttrs` impls are tables** `HasAttrs_<Id>: HasAttrs<Id, TyCtxt>` (rustc_attr_ir lib.ts convention).
   - **Root:** repoint context.ts's stand-in `HasAttrs_DefId_get_attrs` at `HasAttrs_DefId.get_attrs`, and its
     `AssocItem_is_method` at ty-adt-assoc's.
5. **Manual `Hash` impls** of `VariantDef` / `FieldDef` are canonical-key functions `key_VariantDef` /
   `key_FieldDef`, i.e. `DefId_key` of the id (PORTING §5). The `cfg!(debug_assertions)` deep checks in their
   `PartialEq` impls are kept as comments.
6. **`impl Iterator` returns are generators.**
   - In `provided_trait_methods` the `associated_items` query runs when the fn is called, as upstream does, and the
     filter runs as the iterator is consumed.
   - In `get_attrs` / `get_attrs_by_path` the slice is read at the call and filtered lazily.
7. **`mut ident: Ident` parameters** (`adjust_ident`, `adjust_ident_and_get_scope`) copy the `Ident` before
   `normalize_to_macros_2_0_and_adjust` mutates its span (PORTING §8). The caller's `Ident` is left unchanged.
8. **`self.arena.alloc(..)` / `alloc_str(..)` return the value itself.** This applies to `layout_error` and
   `SymbolName::new`. `Display for SymbolName` is the string, because `Fmt` has no width or precision.
9. **`TypingMode<CantBeErased>` matches** in `with_*_normalized` get an extra `ErasedNotCoherence` arm that calls
   `unreachable` (TS cannot see that the variant is uninhabited). `instance_mir` has a `default` arm for
   `InstanceKind` variants that `InstanceKindView` does not model.
10. **`ty::provide`** follows upstream: the sub-providers in upstream order, then the five `trait_def` / `vtable`
    providers. The sub-providers that are not ported yet are stand-ins (see "unported").
    - **Root:** once they land, have `rustc_interface/passes.ts` call `ty::provide` in place of
      `context::provide` + `print::provide`.
11. **`CrateInherentImpls.incoherent_impls`** (`FxIndexMap<SimplifiedType, _>`) is a `KeyedMap` on `intern_key`.

## For root
- **decls.ts re-exports** (decision 1). Also: `ty/print/pretty.ts`'s `ImplTraitInTraitDataView` and
  `VariantDef_ctor_kind` / `VariantDefShape` stand-ins can use mod.ts's real types and methods.
- **Merge with ty-mod-a.** Expect conflicts in:
  - the line-36 import (I removed four names; they may remove `ParamEnv`);
  - both lanes' import blocks;
  - possibly a duplicate `TypingEnv` / `RestrictionKind` / `ImplTraitHeader`.

  Then delete my `DELETE AT MERGE` stand-ins (`RestrictionKind_`, `debug_RestrictionKind_`, `ParamEnv_empty`,
  `ParamEnv_with_normalized`, `debug_ParamEnv_`) and repoint `ImplTraitHeaderFields` at the real
  `ImplTraitHeader`.
- **Merge with ty-adt-assoc**: repoint the `AssocItem_*`, `AssocItems_*` and `AdtDef_*` stand-ins,
  `TraitDefFields`, and the `closure` / `trait_def` providers.
- **rustc_ast_lowering's `TyCtxt_is_method` stand-in**: keep it for now (see "The `is_method` stop").

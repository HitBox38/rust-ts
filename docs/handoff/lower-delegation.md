# Handoff: lower-delegation (wave 14, M3a): rustc_ast_lowering delegation/*

Branch `lane/lower-delegation` (from main 935a15a, no merges).

## Result
All four delegation files are ported, in upstream order, with markers:
- `src/rustc_ast_lowering/delegation/resolution.ts`: `resolve_type_relative_delegations`, `DelegationResolver::new`
  and the 4 `resolver` methods, the 9 resolution methods, the nested `DefinitionsFinder::visit_id`, `SelfFinder::visit_ty`
  and `SelfFinder::contains_self`.
- `src/rustc_ast_lowering/delegation/generics.ts`: the generics helper types and their 13 methods, the 4
  `DelegationResolver` methods + `create_slots_from_args`, the 4 `LoweringContext` methods.
- `src/rustc_ast_lowering/delegation/mod.ts`: the 12 `LoweringContext` methods and `SelfResolver` (`try_replace_id`,
  `visit_id`).
- `src/rustc_ast_lowering/delegation/attributes.ts`: `ADDITIONS`, `add_attrs_if_needed`, `create_new_attrs`.
- New `src/rustc_ast_lowering/delegation/delegation.test.ts`: 11 unit tests.

No `unported_methods` list is left in delegation/*. No file outside `delegation/` was edited.

## Coverage (`bun scripts/coverage.ts --missing`)
- delegation/mod.rs 14/14, generics.rs 23/23, resolution.rs 18/18, attributes.rs 2/2.
- `bun scripts/coverage.ts --check`: `markers ok (8701; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3996 pass, 1 skip (the pre-existing linux-only one),
  0 fail. `contract.test.ts` still passes (8/8).
- End to end, in a scratch worktree of this branch with `lane/harness-w13` merged (its `harness/suites.ts` taken, since
  the merge conflicts with main's tydump suites; scratch removed afterwards):
  `RUST_TS_AGENT=lower-delegation bun scripts/difftest.ts --suite hir-tree-nocore --filter delegation`:
  146 cases, 3 MATCH, 0 DIFF, 143 UNPORTED (run `20261014-025452-lower-delegation-hbxc`).
  - **Stop histogram**: 143 x `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)`. The hir-tree driver path
    and `rustc_ast_lowering.provide` are not wired yet, so no case reaches delegation lowering; the 3 MATCHes fail
    before lowering.

## Unit tests (delegation.test.ts)
The lowering context is `Object.create(LoweringContext.prototype)` with recorded fakes for lib.rs methods (`next_id`,
`next_node_id`, `lower_node_id`, `create_def`, `get_partial_res`). Covered:
- `create_slots_from_args`: implicit Self, infer slots with their AST index, zip length, the `&params[0]` panic, the
  `DelegationInfersMismatch` path (stops at the diagnostic stand-in).
- `DelegationGenericArgsIterator::{next, consume_all}`: implicit Self / impl-trait skipping, arg shapes, id order.
- `HirOrTyGenerics`: uplifting in place (Self -> This for the child), `'a: 'a` predicates, the exact order of
  `next_node_id` / `create_def` / `next_id` / `lower_node_id`, the `bug!`s, `find_self_param`.
- `all_params` ordering, `segment_id_for_sig`, `process_segment`, `generate_param`/`generate_arg`/
  `generate_header_error`, `SelfResolver::try_replace_id`, `create_new_attrs`/`add_attrs_if_needed`,
  `get_user_args`, `resolve_delegation_sig`, `check_for_cycles`, `check_block_soundness`, `can_perform_self_mapping`.

## `unported(...)` left (all stand-ins for other lanes' APIs; marked `PORT(stand-in)` / `PORT(diag)`)
- resolution.ts:
  - `fn_sig_skip_binders`: `tcx.fn_sig(..).skip_binder().skip_binder()` and the `ty::FnSig` accessors
    (`inputs`/`output`/`safety`/`abi`/`c_variadic`, rustc_type_ir ty_kind.rs:1141..) are not ported (wave 15). Used
    by `resolve_delegation` and mod.ts `lower_delegation_sig`. `TyFnSigView` types the accessors.
  - `TyCtxt_is_method` (rustc_middle ty/context.rs:1295).
  - `AssocItems_filter_by_name_unhygienic` (rustc_middle ty/assoc.rs).
  - `Ty_super_visit_with` (`impl TypeSuperVisitable for Ty`, structural_impls.rs:420).
  - Diagnostic builders: `AmbiguousDelegationToInherentImpl`, `CycleInDelegationSignatureResolution`,
    `DelegationAttemptedBlockWithDefsDeletion`, `DelegationAttemptedBlockWithDefsRelowering`,
    `DelegationBlockSpecifiedWhenNoParams`, `UnresolvedDelegationCallee`.
- generics.ts:
  - `AdtDef_did` (`AdtDef` is pending, lane ty-adt-assoc).
  - Diagnostic builders: `DelegationInfersMismatch`, `DelegationToInherentImplMustContainParentGenerics`,
    `DelegationToInherentImplParentContainsInfer`.
- Reached at run time but owned elsewhere (already stubs there): the queries `fn_sig`, `asyncness`,
  `codegen_fn_attrs`, `constness`, `type_of`, `generics_of`, `inherent_impls`, `associated_items`,
  `expn_that_defined`, `index_ast`, `resolve_type_relative_delegations`; `TyCtxt::get_all_attrs`; `visit_with_Ty`;
  `TypeVisitor_provided.*`; `Ty::is_self_param`; and every lib.rs / expr.rs / path.rs / block.rs method called.

## `// PORT:` decisions (please record)
1. **Type stand-ins (`PORT(gen)`).** The helper types (`GenericsPosition`, `GenericArgSlot`, `DelegationGenerics`,
   `TyGenerics`, `HirOrTyGenerics`, `GenericsGenerationResult(s)`, `DelegationGenericArgsIterator`,
   `ParentSegmentArgs`, `GenericsResolution`, `ParamInfo`, `SigMapping`, `DelegationResolution`, `DelegationResults`)
   are written in each file in exactly the shape codegen set `rustc_ast_lowering` generates (checked against a scratch
   run and against lane lower-index-diag's committed `delegation/*.gen.ts`). Debug fns are left to the generator.
2. **`PerOwnerLoweringStateFields` (`PORT(decls)`, resolution.ts).** lib.ts's `PerOwnerLoweringState` is `unknown`, so
   `curr_owner` is read through this view of the 3 fields used (`owner`, `ident_and_label_to_local_id`, `attrs`), typed
   as lib.gen.ts generates them.
3. **Diagnostics (`PORT(diag)`).** A local `diagnostics` object holds `<Name>_diagnostic` stand-ins with the generated
   names and argument shapes, so the swap is one import.
4. **Associated fns without `self` on private helper types**: `DelegationGenerics::generate_all` and
   `GenericsGenerationResult::new` are module-level fns of generics.ts (`generate_all`, `GenericsGenerationResult_new`).
5. **`HirOrTyGenerics` methods** live on its companion const (PORTING §8). `into_hir_generics(&mut self)` reassigns
   `*self`, so it uses `replace_in_place` (std/mut_ref.ts).
6. **Visitor types are hand classes.** `SelfResolver` extends `rustc_ast` `visit.Visitor`. `DefinitionsFinder` (a
   `Visitor<ControlFlow<()>>`) and `SelfFinder` (a `TypeVisitor`; its provided methods delegate to
   `TypeVisitor_provided`) are nested classes in their fn bodies, as upstream nests them.
7. **`AdditionInfo` / `AdditionKind`** are hand-written with typed fn-pointer fields (the generator emits `unknown`).
8. **Copies of HIR nodes**: `.copied()`, `*arg`, `path.clone()`, `segment.clone()`, `ty.clone()` and `a.clone()` use the
   generated `clone_<T>` fns. `hir::Path::clone` takes a `clone_Res_HirId` adapter.
9. **`cfg_select! { debug_assertions => .. }`** in `lower_block_maybe_more_than_once` takes the `_` arm, per the
   merge-w13 decision that the oracle is a release build.
10. **Iteration order in `resolve_type_relative_delegations`.** `delegation_infos` is a `LocalDefIdMap` (FxHashMap)
    upstream but a JS `Map` in the resolver, so it iterates in insertion order. The result is only read by key; the
    only observable effect is the creation order of its `span_delayed_bug`s.
11. **Query values typed `unknown` in queries.gen.ts are cast at the call site**, each with a PORT note:
    - `index_ast` as `readonly (Steal<[ResolverAstLowering, AstOwner]> | undefined)[]`;
    - `generics_of` as `ty::Generics`;
    - `type_of` as `EarlyBinder<Ty>` (`.skip_binder()` is `.value`);
    - `resolve_type_relative_delegations` values as `TypeRelativeDelegationRes`;
    - `associated_items` as `AssocItems`;
    - `constness` as `hir::Constness`;
    - `asyncness` as a local `Asyncness = "Yes" | "No"` (fieldless enum, PORTING §5);
    - `codegen_fn_attrs` through a local `{ safe_target_features }` view;
    - `get_all_attrs` (typed with rustc_middle's pending `hir::Attribute`) as `rustc_attr_ir::Attribute[]`.
12. **Panics as core prints them.**
    - Slices use `slice_from` / `slice_to`.
    - `&params[0]` on an empty slice panics with `index out of bounds: the len is 0 but the index is 0`.
    - `delegation_infos[&def_id]` panics with HashMap's `no entry found for key`.
    - `bug!` is rustc_span's `bug`.
    - `unreachable!(msg)` gets the `internal error: entered unreachable code: ` prefix.
    - `assert_matches!` prints the stringified pattern.
13. **`ParamMode::Optional`, `AllowReturnTypeNotation::No` and `ImplTraitContext::Disallowed(ImplTraitPosition::Path)`**
    are written as the generated literals (`"Optional"`, `"No"`, `{ $: "Disallowed", _0: "Path" }`) with `satisfies`
    the lib.ts aliases. They type-check against the real unions once lib.gen.ts is wired.

## For root
1. **Integrating with lane lower-index-diag.** It commits `delegation/{generics,mod,resolution,attributes}.gen.ts` and
   `diagnostics.gen.ts`; its shapes equal my stand-ins. After both merge:
   - generics.ts, resolution.ts, mod.ts: replace each `PORT(gen)` type block with `export * from "./<file>.gen.ts"`.
     In generics.ts, turn the `export interface GenericsGenerationResult / DelegationGenericArgsIterator /
     GenericsGenerationResults { .. }` method merges into `declare module "./generics.gen.ts" { .. }`. Keep the
     hand `HirOrTyGenerics` companion const (the generated file has none for this enum).
   - In generics.ts and resolution.ts, replace the local `const diagnostics = { .. }` with
     `import * as diagnostics from "../diagnostics.ts"`.
   - Codegen set `rustc_ast_lowering`: add to `hand`
     - `rustc_ast_lowering::delegation::SelfResolver` (it extends the ast `Visitor`; the generated plain class would
       shadow it);
     - `rustc_ast_lowering::delegation::attributes::AdditionInfo` and `AdditionKind` (typed fn pointers).
2. **`PerOwnerLoweringStateFields`.** Once lane lower-lib-a gives `PerOwnerLoweringState` its generated class, drop the
   view and the `as PerOwnerLoweringStateFields` casts (resolution.ts, mod.ts, attributes.ts).
3. **Wave-15 follow-ups.** When `ty::FnSig`'s methods, `Binder`/`EarlyBinder::skip_binder`, `TyCtxt::is_method`,
   `AssocItems::filter_by_name_unhygienic`, `AdtDef::did` and `TypeSuperVisitable for Ty` exist, replace the
   stand-ins listed above, and type `decls.ts`'s `TyFnSig` as `ty::FnSig`.
4. **decls.ts.** No signature change was needed. `create_sig_mapping`'s `sig` parameter is `TyFnSig = unknown` and is
   cast to `TyFnSigView` inside.

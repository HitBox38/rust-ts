# Handoff: hirtylowerer-contract (wave 16, M3): the rustc_hir_analysis collect / HIR ty lowering contract

Branch `lane/hirtylowerer-contract` (from main `00ce463`, no merges).

## Result
`src/rustc_hir_analysis/` now exists as a contract plus stubs. The wave-16 lanes collect-a, collect-b, collect-rbv and
hir-ty-lowering-a/-b/-c (and the proposed -d, see the split table) only fill bodies.
- **decls.ts** declares every one of the 368 upstream fns of the contract's 16 files at its `file:line`.
- **Each stub module** has the final signature of every free fn (body `unported(..)`) and installs an `unported(..)`
  placeholder for every method of its file (`unported_methods`).
- **lib.ts** is the crate root. Its `provide` (lib.rs:126) and `collect::provide` (collect.rs:65) are ported, and
  `rustc_interface/passes.ts` calls `rustc_hir_analysis.provide` at upstream's position (after rustc_resolve, before
  `ty::provide`). The 32 collect queries now stop as `rustc_hir_analysis::collect::<fn>` instead of
  `<query> provider (not ported)`; nothing else changes.
- **Codegen set `rustc_hir_analysis`**: the types and `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impls of
  diagnostics.rs (159 types, 157 derive impls) and the types of 7 more contract files (33 types, 15 Debug, 16 Clone,
  3 TypeVisitable/TypeFoldable). Report: 0 unknown types, 0 missing IntoDiagArg, 1 missing Debug (see "unported").

## Files
All under `src/rustc_hir_analysis/` unless noted.
- **`decls.ts`, the contract. Root owns it from now on.** It holds:
  - the pending types (`InferCtxt`, `FulfillmentError`, ..., see "Types");
  - `interface HirTyLowererImpl<S>`: the 16 required methods of `trait HirTyLowerer` (mod.rs:138) as `this: S` methods
    (one `impl HirTyLowerer for X` block = one such object, the vtable);
  - `class HirTyLowerer`: the trait object `&dyn HirTyLowerer` (`data` + `vtable`), with the 16 dispatching methods;
  - `interface HirTyLowerer`: the 92 `impl dyn HirTyLowerer` methods, grouped by file and lane;
  - `interface GenericArgsLowerer` (mod.rs:371);
  - `class ItemCtxt` (collect.rs:134, the 4 fields in declaration order, 3 `declare static`s) and
    `interface ItemCtxt` (10 collect.rs methods, `lowerer`, 1 clauses_of.rs method);
  - `interface Fns_<module>` for each of the 14 modules with free fns (their final signatures);
  - comment-only declarations of the remaining 125 fns: `impl HirTyLowerer for ItemCtxt` (16), helper-type methods,
    visitor / folder impls, manual `impl Diagnostic`s, nested fns.
- **Stub modules:** `collect.ts`, `collect/{generics_of,type_of,clauses_of,item_bounds,resolve_bound_vars,dump}.ts`,
  `collect/type_of/opaque.ts`, `hir_ty_lowering/{mod,bounds,generics,dyn_trait,errors,cmse}.ts`, `diagnostics.ts`.
- **Generated:** `diagnostics.gen.ts`, `collect.gen.ts`, `collect/{generics_of,item_bounds}.gen.ts`,
  `collect/type_of/opaque.gen.ts`, `hir_ty_lowering/{mod,bounds,errors}.gen.ts`.
- **`lib.ts`**: the crate root (`provide`, the `mod` list with the status of each module, re-exports, stubs of
  `check_c_variadic_abi` / `check_crate` / `lower_ty` / `lower_const_arg_for_rustdoc`).
- **`contract.test.ts`**: 10 tests (see "Checks").
- **Outside the crate:**
  - `src/rustc_interface/passes.ts`: the import, the `rustc_hir_analysis.provide(providers.queries)` call, and the
    "pending crates" comment.
  - `tools/codegen/types.sets.json`: the new set `rustc_hir_analysis`.
  - `tools/codegen/hir_analysis.typemap.json` (new, set-local): `rustc_hir::PathSegment` / `PrimTy`,
    `rustc_middle::ty::GenericParamDefKind`, and `rustc_hir::def::Res` with its default `Id = HirId`.
  - `tools/codegen/diag_args.json`: one entry, `rustc_middle::ty::Ty` -> `Ty_into_diag_arg` / `display_Ty`. No current
    `.gen.ts` used an unported `IntoDiagArg for Ty`, so regenerating other sets changes nothing today.

## The representation of `HirTyLowerer` (PORT decision 1)
- **The trait object.** `&dyn HirTyLowerer<'tcx>` is the class `HirTyLowerer { data, vtable }`. Its prototype carries
  two kinds of methods:
  - the 16 trait methods, which dispatch through the vtable (`this.vtable.tcx.call(this.data)`);
  - the `impl dyn HirTyLowerer` methods of mod.rs, bounds.rs, dyn_trait.rs and errors.rs. Each lane assigns them.
- **An impl is a vtable object.** `impl HirTyLowerer for ItemCtxt` is `HirTyLowerer_ItemCtxt: HirTyLowererImpl<ItemCtxt>`
  in collect.ts. Its methods take the `ItemCtxt` as `this`. FnCtxt will be `HirTyLowerer_FnCtxt` (fnctxt-contract).
- **Why not methods on the implementor.**
  - `ItemCtxt` has the fields `tcx` and `item_def_id`, the same names as the trait methods `tcx()` and `item_def_id()`.
    FnCtxt has `infcx`.
  - Both implementors have an inherent `lower_ty` that differs from the dyn one. FnCtxt's returns `LoweredTy`, so a
    shared base class would not even type-check.
  - With a vtable object, no names change.
- **The provided `lowerer()`** (mod.rs:239) is `HirTyLowerer_provided.lowerer(self_, impl_)` in mod.ts, ported with
  its marker. It also takes the vtable, because it builds the trait object (upstream's unsizing coercion). Each
  implementor's `lowerer()` forwards to it: `ItemCtxt.prototype.lowerer` in collect.ts. That forwarder is contract
  glue, so it has no marker.
- **The coercion.** Where upstream coerces an `ItemCtxt` to `&dyn HirTyLowerer` implicitly, TS calls `lowerer()`. For
  example, `placeholder_type_error_diag(self, ..)` becomes `placeholder_type_error_diag(this.lowerer(), ..)`.
- **Static calls.** A static call of a trait method on a concrete `ItemCtxt` calls the impl directly. `self.tcx()` and
  `icx.probe_ty_param_bounds(..)` become `HirTyLowerer_ItemCtxt.tcx.call(this)` and so on. Field reads stay as they are
  (`this.tcx`).

## Split points and lane → file map
| lane | upstream (lines) | TS | what is waiting |
|---|---|---|---|
| collect-a | collect.rs (1854), collect/generics_of.rs (546), collect/type_of.rs (588), collect/type_of/opaque.rs (288); lib.rs `check_c_variadic_abi`, `lower_ty`, `lower_const_arg_for_rustdoc` | collect.ts, collect/generics_of.ts, collect/type_of.ts, collect/type_of/opaque.ts, lib.ts (3 stubs) | `ItemCtxt` statics + 10 methods, `HirTyLowerer_ItemCtxt` (16), 26 collect.rs free fns (the queries `adt_def`, `trait_def`, `fn_sig`, `impl_trait_header`, ...), `HirPlaceholderCollector`, `FieldUniquenessCheckContext` / `NestedSpan` / `FieldDeclSpan` methods; generics_of (3 fns, 2 visitors); type_of (8 fns, `HasTait`); opaque (3 fns, `TaitConstraintLocator`) |
| collect-b | collect/clauses_of.rs (1225), collect/item_bounds.rs (569), collect/dump.rs (241) | collect/clauses_of.ts, collect/item_bounds.ts, collect/dump.ts | 15 + 10 + 6 free fns, `ItemCtxt::probe_ty_param_bounds_in_generics`, `ConstCollector`, `MapAndCompressBoundVars`, `AssocTyToOpaque`, `AnonConstFinder` |
| collect-rbv | collect/resolve_bound_vars.rs (2859) | collect/resolve_bound_vars.ts | `provide` (a no-op stub today, see "unported"), 7 free fns, `BoundVarContext` (20 methods + 23 Visitor), `ResolvedArgExt` (4), the small visitors, `SegIdx` / `RevSegIdx`. **Recommended:** also port rustc_middle `middle/resolve_bound_vars.rs` (67 lines: `ResolvedArg`, `Set1`, `ObjectLifetimeDefault`, `ResolveBoundVars`); the types of resolve_bound_vars.rs are not generated (see "For root" 3). |
| hir-ty-lowering-a | hir_ty_lowering/mod.rs:1..2185 | hir_ty_lowering/mod.ts region `// ==== lane hir-ty-lowering-a: mod.rs:1..2185 ====` and its import block | 30 dyn methods (`check_param_res_if_mcg_for_instantiate_value_path` .. `probe_generic_path_segments`), `AssocItemQSelf::to_string`, `LowerTypeRelativePathMode`'s 3 methods, `ForbidParamUsesFolder` (+`TypeFolder`), `GenericArgsCtxt` (nested in `lower_generic_args_of_path`) |
| hir-ty-lowering-b | hir_ty_lowering/mod.rs:2186..3915 | mod.ts region `// ==== lane hir-ty-lowering-b: mod.rs:2186..3915 ====` and its import block | 25 dyn methods (`lower_resolved_ty_path` .. `lower_view`, including `lower_ty`, `lower_const_arg`, `lower_fn_ty`) |
| hir-ty-lowering-c | hir_ty_lowering/bounds.rs (988), generics.rs (710), dyn_trait.rs (1111) | hir_ty_lowering/{bounds,generics,dyn_trait}.ts | 9 + 12 dyn methods; 5 + 5 + 1 free fns; `CollectedBound` / `CollectedSizednessBounds::any`, `GenericParamAndBoundVarCollector`, `LifetimeArgsIssue` / `TraitObjectWithoutDyn` (nested manual Diagnostics) |
| **hir-ty-lowering-d (proposed)** | hir_ty_lowering/errors.rs (2095), cmse.rs (200); diagnostics.rs:477 `MissingGenericParams::into_diag` | hir_ty_lowering/{errors,cmse}.ts, diagnostics.ts | 16 dyn methods, 5 + 5 free fns, `AmbiguityBetweenVariantAndAssocItem_into_diag`, `MissingGenericParams_into_diag` |
| wave 17 | lib.rs `check_crate` (check-check); diagnostics.rs:2078 `UncoveredTyParam::into_diag` (coherence) | lib.ts, diagnostics.ts | — |
| unassigned | diagnostics/wrong_number_of_generic_args.rs (1188), remove_or_use_generic.rs, precise_captures.rs | (none yet) | `WrongNumberOfGenericArgs` is reached from `check_generic_arg_count` on an error path. Suggest wave 19 (error reporting), or after -d. |

- **Why mod.rs splits at 2186.**
  - Line 2185 closes `probe_generic_path_segments` and line 2186 is blank. The doc comment of `lower_resolved_ty_path`
    (fn at :2189) starts at 2187.
  - Region a has 2185 lines, about 400 of them the generated types and the trait declaration; region b has 1730.
  - The split is also the semantic boundary: a resolves generic args, trait refs and type-relative paths; b lowers
    resolved paths, types, consts and fn types.
  - contract.test.ts enforces it.
- **Why a lane -d.** plan-m3 assigns errors.rs and cmse.rs to no lane, and they do not fit into -a, -b or -c within
  the ~3k-line budget. **Decision for root to record:** "add lane hir-ty-lowering-d (hir_ty_lowering/errors.rs +
  cmse.rs + MissingGenericParams::into_diag)".

## How to fill a stub
1. **Read the contract.** Your methods are declared in `decls.ts`:
   - `interface HirTyLowerer` for the `impl dyn HirTyLowerer` methods, in the group of your file or region;
   - `interface ItemCtxt` for ItemCtxt's methods;
   - `HirTyLowererImpl<S>` for the trait's methods;
   - `Fns_<module>` for the free fns.

   Do not change a signature. A wrong or missing declaration goes in your handoff (signature + reason). If you cannot
   type-check without the change, add a local `declare module "../decls.ts"` (or `"./decls.ts"`) in your own file,
   marked `// PORT(decls): pending root`.
2. **Methods.** Write them in upstream order, each with the marker
   `// rustc: compiler/rustc_hir_analysis/src/<file>:<line> <name>` directly above it. The forms are:
   - `HirTyLowerer.prototype.<name> = function (this: HirTyLowerer, ..): R { .. };` for dyn methods;
   - `ItemCtxt.prototype.<name> = function (this: ItemCtxt, ..): R { .. };` for ItemCtxt's methods;
   - `HirTyLowerer_ItemCtxt.<name> = function (this: ItemCtxt, ..): R { .. };` for its trait impl.

   Then delete the name from the file's `unported_methods(..)` list, and delete the call when the list is empty.
   mod.ts has two lists, and each lane edits only its own region.
3. **Statics and free fns.** These already have their final signatures in the stubs:
   - `ItemCtxt.new` / `.new_internal` / `.new_for_delegation` in collect.ts;
   - every `export function` listed in `Fns_<module>`.

   Fill the body in place, add the marker, drop the `(stub ..)` comment, and keep upstream order. contract.test.ts
   type-checks every stub against its `Fns_` interface. Nested fns (`outlives_bounds`, `is_const_param_default`,
   `span_of_infer`, `resolve_param`, the inner `has_late_bound_regions`) are ported inside their parent with their
   own marker. So are nested types with impls (`GenericArgsCtxt`, `ReprCIssue`, ...).
4. **Self and trait objects.** Inside a dyn method, `this` is the trait object:
   - `this.tcx()`, `this.re_infer(..)` and the other trait methods dispatch;
   - `this.lower_ty(..)` and the other dyn methods are prototype methods.

   In an `ItemCtxt` method, `this.tcx` is the field, `this.lowerer()` gives the trait object, and trait methods are
   called on the impl (`HirTyLowerer_ItemCtxt.dcx.call(this)`). A `&dyn HirTyLowerer` parameter (`cx`) is a
   `HirTyLowerer`. `GenericArgsLowerer` implementors are plain objects or classes that implement the interface.
5. **Types.**
   - Generated types come from `<file>.gen.ts`; each stub module already does `export * from "./<file>.gen.ts"`.
     Examples: `PredicateFilter`, `RegionInferReason`, `GenericArgCountResult`, `ImpliedBoundsContext`.
   - Enum methods go on the generated companion const, extended in the hand module (PORTING §8). Examples:
     `LowerTypeRelativePathMode.assoc_tag`, `AssocItemQSelf.to_string`.
   - The `hand` types (types.sets.json) are `unknown` aliases in the stubs; the owning lane writes the class. They are:
     - Visitor / folder structs: `HirPlaceholderCollector`, `TaitConstraintLocator`, `AnonConstInParamTyDetector`,
       `MapAndCompressBoundVars`, `AssocTyToOpaque`, `ForbidParamUsesFolder`, `GenericParamAndBoundVarCollector`.
       Each extends rustc_hir intravisit's `Visitor` or implements the type_ir `TypeFolder` / `TypeVisitor`.
     - `GenericsArgsErrExtend`, which is already hand-written in errors.ts.
   - Pending types are the `Pending<..>` aliases in decls.ts. Use them; root replaces them.
   - Note for collect-a: collect.gen.ts's `FieldUniquenessCheckContext.seen_fields` is a `Map<Ident, ..>`. `Ident` is an
     object, so construct a `KeyedMap` (rust_ts/keyed.ts) with an `Ident` key fn.
6. **Diagnostics.** The derives are generated (diagnostics.gen.ts):
   - `<T>_into_diag` + `<T>_diagnostic` for `#[derive(Diagnostic)]`;
   - `<T>_add_to_diag` + `<T>_subdiagnostic` for `#[derive(Subdiagnostic)]`.

   Manual impls are hand fns of the same names, as in rustc_passes/diagnostics.ts.
7. **Imports.** New imports go at the top of your file. In mod.ts, use your lane's import block.
8. **Init order.** Breaking these rules gives a TDZ `ReferenceError` at load:
   - decls.ts imports only types and must never import a crate module at runtime;
   - a module's top-level code may touch only decls.ts (the classes), its own `.gen.ts` and other crates. It reads other
     rustc_hir_analysis exports inside function bodies only. collect.ts's `provide` and `lowerer` show the pattern;
   - consumers outside the crate import `src/rustc_hir_analysis/lib.ts` only.

   Every module currently loads as a fresh-process entry point.

## Types
- **Pending** (in decls.ts, `Pending<..>`):
  - `InferCtxt` and `SolverRegionConstraint` (lane infcx-contract);
  - `FulfillmentError` (wave 17);
  - `TestBinderBody` / `TestBinderForall` / `TestBinderExists` (check/wfcheck.rs, wave 17);
  - `ResolvedArg`, `ObjectLifetimeDefault` and `ResolveBoundVars` (rustc_middle middle/resolve_bound_vars.rs, see
    collect-rbv);
  - `LayoutCx` (M4).
- **Assumed from other crates:**
  - `ty::X` from rustc_middle ty/{mod,context,generics,generic_args,list,predicate,adt,assoc,trait_def,decls}.ts and
    rustc_type_ir/decls.ts (`EarlyBinder`, `Binder`, `PolyTraitRef`, `PolyFnSig`, ...);
  - `DynCompatibilityViolation` from rustc_middle traits/mod.ts;
  - `hir.X` from rustc_hir/lib.ts.
- **Parallel lanes.** No file of infcx-contract, evalctxt-contract or ty-utils was touched. When infcx-contract merges,
  replace the `InferCtxt` / `SolverRegionConstraint` aliases with re-exports.

## `unported(...)` left
- **Placeholders:**
  - every `impl dyn HirTyLowerer` method (92), as `rustc_hir_analysis::hir_ty_lowering[::bounds|::dyn_trait|::errors]::HirTyLowerer::<name>`;
  - ItemCtxt's 11 methods, as `rustc_hir_analysis::collect[::clauses_of]::ItemCtxt::<name>`;
  - the 16 `HirTyLowerer_ItemCtxt` methods, as `rustc_hir_analysis::collect::<ItemCtxt as HirTyLowerer>::<name>`.
- **Statics:** `ItemCtxt::{new, new_internal, new_for_delegation}`.
- **Free fns:** every `Fns_<module>` member except the two ported `provide`s, as
  `rustc_hir_analysis::<module path>::<name>`. That is 103 stubs, including lib.rs's `check_c_variadic_abi`,
  `check_crate`, `lower_ty` and `lower_const_arg_for_rustdoc`.
- **`collect::resolve_bound_vars::provide` is a no-op stub (PORT(stub)).**
  - It runs at provider setup, so it must not stop.
  - Its closures read `ResolveBoundVars`' fields, and that type is pending.
  - Until collect-rbv ports it, `resolve_bound_vars`, `named_variable_map`, `is_late_bound_map`,
    `object_lifetime_default`, `late_bound_vars_map` and `opaque_captured_lifetimes` keep the placeholder providers.
- **lib.rs `provide`** leaves out `coherence::provide`, `check::provide` and the 9 struct-update providers of wave-17
  modules. They are commented lines in lib.ts and those queries keep the placeholders.
- **Generated:** `TypeRelativePath`'s derived Debug prints its `AssocItem(AliasTerm)` variant through `unported_debug`.
  There is no `debug_AliasTerm` yet (merge-w15b typemap note). It is reached only from `debug!` tracing.

## PORT decisions (please record)
1. **`HirTyLowerer` representation.** The trait object is a class and each impl is a vtable object; see above.
   `lowerer` takes the vtable.
2. **The contract-first layout follows lowering-contract:**
   - `Fns_<module>` interfaces, one per module, because `provide` exists three times;
   - mod.rs split into two lane regions at 2186.
3. **`ItemCtxt.tainted_by_errors`** (`Cell<Option<ErrorGuaranteed>>`) is a `MutRef<ErrorGuaranteed | undefined>`. `dcx()`
   passes it to `DiagCtxtHandle::into_taintable` by reference.
4. **Codegen set `rustc_hir_analysis`** (types, diagnostics, Clone, TypeFoldable):
   - resolve_bound_vars.rs is excluded, because syn cannot parse its `gen` block (`files_note` in the set);
   - `GenericsArgsErrExtend` is `hand`, because the generator imports `hir::Ty` and `ty::Ty` under one TS name;
   - visitor / folder structs are `hand`, as in rustc_ast_lowering.
5. **The `provide` wiring.** Partial `provide`s keep the unported queries on rustc_interface's placeholders (merge-w15b
   decision 1). rbv's `provide` is a documented no-op stub.
6. **Lane hir-ty-lowering-d** (errors.rs + cmse.rs), proposed above.

## For root
1. **Record the decisions** above, and add lane hir-ty-lowering-d to plan-m3 / next.md.
2. **Review the tools changes**, made because the brief asked for "a new set":
   - types.sets.json (set `rustc_hir_analysis`; it uses an extra informational key `files_note`, which the generator
     ignores);
   - the new hir_analysis.typemap.json;
   - one diag_args.json entry.
3. **typedefs probe and `gen` blocks.** Optional: teach the typedefs probe to skip `gen` blocks inside fn bodies (or
   parse with a `gen_blocks`-aware syn). Then add resolve_bound_vars.rs to the set. Otherwise collect-rbv hand-writes
   `BoundVarContext`, `Scope`, `BinderScopeType`, ... (all private to the file).
4. **diag-expand was not run.** I did not run `bun tools/codegen/diag-expand.ts` against the real rustc_macros expansion
   for diagnostics.rs. That check builds a scratch cargo crate. The generator is the one verified 394/394 on
   rustc_parse/rustc_session. Running it once on this set before the -d lane relies on it would be cheap insurance.
5. **When infcx-contract merges**, swap `InferCtxt` / `SolverRegionConstraint` in decls.ts. When FnCtxt lands, add
   `HirTyLowerer_FnCtxt` + `FnCtxt.prototype.lowerer` the same way as ItemCtxt.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (12261; vendor 3888)`.
- `bun scripts/coverage.ts --crate rustc_hir_analysis`: 3/799. That is `collect::provide`, `HirTyLowerer_provided.lowerer`
  and lib.rs `provide`. Per contract file (ported/total):

  | file | ported/total |
  |---|---|
  | collect.rs | 1/64 |
  | clauses_of | 0/18 |
  | dump | 0/8 |
  | generics_of | 0/10 |
  | item_bounds | 0/18 |
  | resolve_bound_vars | 0/68 |
  | type_of | 0/9 |
  | opaque | 0/12 |
  | hir_ty_lowering/mod.rs | 1/87 |
  | bounds | 0/20 |
  | cmse | 0/5 |
  | dyn_trait | 0/14 |
  | errors | 0/22 |
  | generics | 0/6 |
  | lib.rs | 1/5 |
  | diagnostics.rs (hand fns) | 0/2 |
- **contract.test.ts** (10 tests):
  1. Its impl/trait scan agrees with coverage.ts's fn finder; there are 368 fns.
  2. Every fn is declared at its `file:line`.
  3. The trait's required methods equal the `HirTyLowererImpl` slots, the trait object's forwarders and
     `impl HirTyLowerer for ItemCtxt`. All 92 dyn methods are declared. `GenericArgsLowerer` and ItemCtxt (14) are
     complete.
  4. Every declared method exists on `HirTyLowerer.prototype`, `ItemCtxt.prototype` and `HirTyLowerer_ItemCtxt`.
  5. Each `Fns_<module>` equals its stub exports and lists every upstream free fn. This is checked by tsc and at runtime.
  6. The placeholders stop with `Unported` and the upstream path.
  7. `ItemCtxt::lowerer()` builds a trait object over `HirTyLowerer_ItemCtxt` that dispatches with the implementor as
     `this`.
  8. The stub lists name only their own file's methods.
  9. mod.ts's two lists split at 2186.
  10. `provide` installs exactly the 32 collect providers.

  Negative controls: dropping `"lower_ty"` from mod.ts's -b list fails test 4. Putting a region-a name into the -b list
  fails test 9.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".
- `RUST_TS_AGENT=hirtylowerer-contract bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 96 MATCH /
  0 DIFF / 4 UNPORTED / 0 CRASH (run `20261014-113235-hirtylowerer-contract-5lg2`). The 4 are:
  - 2 delegation cases at `rustc_hir_analysis::collect::fn_sig`, which were `fn_sig provider (not ported)` before (the
    same cases, with a new reason);
  - 2 at `StableHash without a TS impl` (pre-existing).

  No new UNPORTED, and none of the 4 is protected.

## Test run

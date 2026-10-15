# Handoff: fnctxt-contract (M3, wave 18, contract-first): the rustc_hir_typeck contract

Branch `lane/fnctxt-contract` (from integ `4447fa3`, no merges).

## Result
- `src/rustc_hir_typeck/` exists as a contract plus stubs; the wave-18b typeck lanes only fill bodies.
  - **decls.ts** declares every one of the crate's 1041 upstream fns at its `file:line`:
    - real declarations: `FnCtxt` (488 methods + 3 statics), `TypeckRootCtxt` (4 + `new`), the augmented contract
      classes (209 methods + 19 associated fns), the traits `Delegate` / `TypeInformationCtxt`, `Companions` (18) and
      `Fns_<module>` (69 free fns of 19 modules);
    - comment-only declarations for the remaining 230 (single-file helper types, trait impls, nested fns).
  - **Codegen set `rustc_hir_typeck`** (all 39 files): 206 types, 57 Debug, 49 Clone, 83 diagnostic derives, 6
    TypeVisitable/TypeFoldable, into 31 `*.gen.ts`. Report: 0 unknown types, 0 missing Clone, 1 missing Debug
    (`AliasTy` in cast.rs `PointerKind`, only reached from `debug!`), 2 missing TypeFoldable (cast.rs `List`, closure.rs
    `PolyFnSig`, both in `debug!`-only types).
  - **Stub modules** for every file: the final signature of each free fn (body `unported(..)`), `unported_methods`
    placeholders for every method of `FnCtxt` and of the contract classes, and a "How to fill a stub" header.
- **Ported for real** (76 fns): lib.rs 16/17 (all but the error path `report_unexpected_variant_res`), typeck_root_ctxt.rs
  5/5, expectation.rs 6/6, diverges.rs 6/6, fn_ctxt/mod.rs 26/26 (incl. `FnCtxt::new`, the whole `impl HirTyLowerer for
  FnCtxt`, `PpAnn`, `LoweredTy::from_raw`), gather_locals.rs 13/13, autoderef.rs 4/4.
- **Wired:** `rustc_interface/passes.ts` calls `rustc_hir_typeck.provide(providers.queries)` at upstream's position
  (passes.rs:918, after rustc_hir_analysis). `typeck_root` / `used_trait_imports` / `method_autoderef_steps` /
  `check_transmutes` / `check_offloads` now run rustc_hir_typeck code: a typeck call reaches `typeck_with_inspect`,
  builds `TypeckRootCtxt` (real `InferCtxt` + `FulfillmentEngine`) and `FnCtxt`, and stops at the first stub
  (`rustc_hir_typeck::loops::check` for fns and consts; see "Stops").

## Files
- **New, contract (root-owned after integration):** `src/rustc_hir_typeck/decls.ts`.
- **New, generated:** `src/rustc_hir_typeck/**/*.gen.ts` (31 files, set `rustc_hir_typeck`).
- **New, hand (ported):** `lib.ts`, `typeck_root_ctxt.ts`, `expectation.ts`, `diverges.ts`, `fn_ctxt/mod.ts`,
  `gather_locals.ts`, `autoderef.ts`.
- **New, stub modules:** every other `src/rustc_hir_typeck/**/*.ts` (32 files). Some carry contract code beyond
  placeholders: `coercion.ts` (hand class `CoerceMany`), `writeback.ts` (hand class `WritebackCx` + placeholders for its
  `Visitor` overrides), `expr_use_visitor.ts` (`TypeInformationCtxt_FnCtxt` vtable, `Delegate_provided`),
  `method/suggest.ts` (hand `SelfSource` + Debug), `diagnostics.ts` (stubs of the 10 manual impls under the names
  diagnostics.gen.ts imports), the `register_deref` calls of `coercion.ts`, `method/{probe,confirm}.ts`,
  `fn_ctxt/checks.ts`, and `export type X = unknown` aliases for the hand visitor types the owning lane writes.
- **Tests:** `src/rustc_hir_typeck/contract.test.ts` (12 tests).
- **Edited outside the crate:**
  - `src/rustc_interface/passes.ts`: the import, the `provide` call, the "pending crates" comment.
  - `tools/codegen/types.sets.json`: new set `rustc_hir_typeck` (appended; rest of the file untouched).
  - `tools/codegen/hir_typeck.typemap.json` (new, set-local): the rustc_hir / rustc_middle / rustc_infer types the crate's
    types reach under the paths it uses (hir `Expr`/`Block`/`Param`/..., `HirIdMap`, `Adjustment`, `PolyTraitRef`, ...),
    plus Debug for `ParamTy` / `ParamConst` / `PolyFnSig` (ported since `middle_traits_thir.typemap.json` marked them).
  - `src/rustc_privacy/privacy.test.ts`: re-pinned (see "Re-pinned tests").

## Representation (PORT decisions, please record)
1. **Deref = field + `deref()` + generated forwarders.** `TypeckRootCtxt -> InferCtxt` (`infcx`), `FnCtxt ->
   TypeckRootCtxt` (`root_ctxt`), `Coerce` / `ProbeContext` / `ConfirmContext -> FnCtxt` (`fcx`), and fn_ctxt/checks.rs's
   `FnCallDiagCtxt -> ArgMatchingCtxt -> ArgsCtxt -> CallCtxt -> FnCtxt`. This generalizes the precedents (PORTING §8
   "Deref realised as a field", WfCheckingCtxt's hand forwarders, TyCtxt/Session's getters) to a crate whose 33k lines
   auto-deref everywhere:
   - each defining module calls `register_deref(Outer, "field", Inner)` (decls.ts); lib.ts calls `install_derefs()` once
     every module is loaded. For every member the inner type has and the outer one does not (inner instance fields,
     inner prototype methods/accessors, recursively the inner type's own forwarders) the outer prototype gets a forwarder:
     fields are getter/setter on `this.<field>.<name>`, methods call `this.<field>.<name>(..)` (so `this` is the inner
     value, as after Rust's auto-deref). Own members (fields, methods, `unported_methods` placeholders) shadow, as
     Rust's method lookup tries the outer type first.
   - TS side: `interface FnCtxt extends Omit<TypeckRootCtxt, FnCtxt_shadowed>`, `interface TypeckRootCtxt extends
     Omit<InferCtxt, ..>`, `interface ProbeContext extends Omit<FnCtxt, ..>`, ... The `*_shadowed` lists are the members
     that both declare (FnCtxt: `typing_mode`, `dcx`, `err_ctxt`, `root_vid`, `deref`) plus always `drop`, so an FnCtxt is
     **not** structurally an InferCtxt: a deref *coercion* (`&FnCtxt` passed as `&InferCtxt`) must be written
     `this.infcx` (contract.test.ts checks it with `@ts-expect-error`).
   - So inside an FnCtxt method `self.tcx`, `self.infcx`, `self.typeck_results.borrow()`, `self.next_ty_var(sp)`,
     `self.register_predicate(o)` are `this.tcx`, `this.infcx`, `this.typeck_results`, `this.next_ty_var(sp)`,
     `this.register_predicate(o)`.
2. **`impl HirTyLowerer for FnCtxt`** is the vtable object `HirTyLowerer_FnCtxt: HirTyLowererImpl<FnCtxt>`
   (fn_ctxt/mod.ts), `FnCtxt.prototype.lowerer()` forwards to `HirTyLowerer_provided.lowerer` (as ItemCtxt,
   hirtylowerer-contract decision 1). `self.tcx()` (the trait method) is written `this.tcx`.
3. **`TypeInformationCtxt`** (expr_use_visitor.rs) uses the same representation: `TypeInformationCtxtImpl<S>` (one
   impl block) + the trait-object class `TypeInformationCtxt { data, vtable }` (`TypeInformationCtxt.of(fcx,
   TypeInformationCtxt_FnCtxt)`); FnCtxt's fields `tcx` / `typeck_results` collide with the trait's methods.
   `type Error` is `ErrorGuaranteed` (`!` for the LateContext impl). **`Delegate`** is a plain interface (implementors
   are classes); its provided `copy` / `bind` are `Delegate_provided.copy(self_, ..)`; `impl Delegate for &mut D` is
   the identity.
4. **`impl PpAnn for FnCtxt`** is the class `FnCtxtPpAnn`; `FnCtxt_as_PpAnn(fcx)` is the coercion.
5. **Enum methods on companions** (PORTING §8): `Expectation`, `Diverges`, `Needs`, `TupleArgumentsFlag`, declared in
   decls.ts `Companions`; each hand module exports `X = { ...gen.X, <methods> }` and `type X = gen.X`.
   `Diverges`' `BitAnd`/`BitOr` are `bitand`/`bitor`; `BitAndAssign`/`BitOrAssign` take a `MutRef<Diverges>` cell;
   `Diverges_eq` is the derived `PartialEq`.
6. **Statics:** `FnCtxt` / `TypeckRootCtxt` (decls.ts classes) use `declare static`; generated / hand classes declare
   theirs by namespace augmentation (`CastCheck.new`, `CoerceMany.new` / `with_capacity`, `ProbeContext.new`, ...),
   assigned as `(X as unknown as {..}).name = function ..` (infcx-contract precedent).
7. **Codegen `hand` types:** `FnCtxt`, `TypeckRootCtxt` (decls.ts); `GatherLocalsVisitor`, `WritebackCx` (classes
   extending intravisit `Visitor`); `CoerceMany` (hand class in coercion.ts because its field `expected_ty` collides
   with the method `expected_ty()`: the field is **`expected_ty_`**); the visitor / folder / ProofTreeVisitor /
   Delegate implementors (`Resolver`, `EagerlyNormalizeConsts`, `HasRecursiveOpaque`, `AnnotateUnitFallbackVisitor`,
   `CheckLoopVisitor`, `CheckParameters`, `CheckInlineAssembly`, `FindClosureArg`, `NestedObligationsForSelfTy`,
   `FindFromFloatForF32RootVids`, `CoerceVisitor`, `InferBorrowKindVisitor`, `InferBorrowKind`, `ExprPlaceDelegate`):
   `export type X = unknown` in the stub; the owning lane writes the class. `SelfSource` is `skip` and hand-written
   (method/suggest.ts: its derived Debug needs hir's `debug_Ty` and the generator imports middle's under the same name).
8. **`Result<(), E>` is `Result<undefined, E>`** in declarations (hirtylowerer rule), except query providers, which
   match queries.gen.ts (`check_transmutes` / `check_offloads`: `Result<null, ErrorGuaranteed>`).
9. **The `From` impls of gather_locals.rs** are `Declaration_from_LetStmt` / `Declaration_from_LetExpr`; the macro
   `type_error_struct!` is the fn `type_error_struct(dcx, span, ty, code, message)` in lib.ts.
10. **Split points** of fn_ctxt/checks.rs (1669), expr.rs (1855), pat.rs (1780): blank lines between methods; each split
    file's stub has one `unported_methods(FnCtxt.prototype, ..)` list per lane under `// ==== lane <name>: ... ====`.

## Split table (wave 18b; lines are upstream; error-reporting files stay stubs for wave 19)
| lane | upstream (compiler/rustc_hir_typeck/src/) | lines | fns | notes |
|---|---|---|---|---|
| typeck-lib-wb | check.rs, writeback.rs, fallback.rs, opaque_types.rs, loops.rs | 2772 | 3+55+18+6+11 | `check_fn` (+`check_panic_info_fn`, `check_lang_start_fn`), `WritebackCx` (hand class exists) + `Resolver` / `EagerlyNormalizeConsts` / `HasRecursiveOpaque` classes, fallback, opaque uses, `loops::check` + `CheckLoopVisitor`. **First stop of every typeck today (`loops::check`)**: start here. |
| typeck-checks-a | fn_ctxt/checks.rs:1..1668, fn_ctxt/arg_matrix.rs, fn_ctxt/inspect_obligations.rs | 2402 | 23+11+13 | `check_casts`, `check_argument_types`, `check_decl*`, `check_stmt`, `check_expr_block`, `check_expr_lit`, ... (`report_arg_errors` :859 is error-path, in this region) |
| typeck-checks-b | fn_ctxt/checks.rs:1669..3710 | 2042 | 50 | `label_fn_like` .. `SameModuloVars`: argument-error reporting (`FnCallDiagCtxt` / `ArgMatchingCtxt` / `ArgsCtxt` / `CallCtxt`, derefs registered). Error path only: root may move it to wave 19. |
| typeck-impl | fn_ctxt/_impl.rs, place_op.rs, _match.rs | 2664 | 57+8+12 | `normalize`, `write_ty`, `register_wf_obligation`, `require_type_is_sized`, `select_obligations_where_possible`, `structurally_resolve_type`, `instantiate_value_path`, ... (most of the FnCtxt core) |
| typeck-expr-a | expr.rs:1..1854, op.rs | 3208 | 39+25 | `check_expr*`, `check_expr_kind`, unop/addr_of/path/break/return/if/assign/loop/method_call/cast/array/repeat/tuple/struct; binops |
| typeck-expr-b | expr.rs:1855..3957, inline_asm.rs | 2766 | 28+9 | struct fields, field access, index, yield, asm, offset_of; `InlineAsmCtxt` |
| typeck-pat-a | pat.rs:1..1779; lib.rs:479 `report_unexpected_variant_res` | ~1880 | 37+1 | `check_pat_top` .. `check_pat_struct` / `resolve_pat_path` |
| typeck-pat-b | pat.rs:1780..3388 | 1609 | 33 | tuple struct / tuple / struct fields / deref / ref / slice patterns |
| typeck-coerce | coercion.rs; demand.rs:171..289 (`demand_suptype*`, `demand_eqtype*`, `demand_coerce*`) | ~2356 | 49+8 | `Coerce` (deref registered), `CoerceMany` (hand class exists), `can_coerce`, `CoerceVisitor` |
| typeck-callee-cast | callee.rs, cast.rs | 2598 | 17+22 | `check_expr_call`, `DeferredCallResolution::resolve`, `CastCheck` |
| typeck-probe | method/probe.rs | 2758 | 55 | `ProbeContext` (deref registered), `Pick`, `method_autoderef_steps` provider |
| typeck-method | method/mod.rs, method/confirm.rs, closure.rs; method/prelude_edition_lints.rs:156 `lint_edition_dependent_dot_call`, :273 `lint_fully_qualified_call_from_2018` | ~2620 | 9+22+17+2 | `lookup_method`, `ConfirmContext` (deref registered), `check_expr_closure`. The two lint fns are on the **success path** (method calls / UFCS calls in edition < 2021: they return early from edition 2021) |
| typeck-upvar | upvar.rs | 2758 | 52 | `closure_analyze`, `InferBorrowKind` (a `Delegate`) |
| typeck-euv | expr_use_visitor.rs, intrinsicck.rs, naked_functions.rs; rustc_middle hir/place.rs (4 fns + types) | ~2420 | 95+6+8 | `ExprUseVisitor`, `TypeInformationCtxt_FnCtxt`, `Delegate_provided`; **port rustc_middle hir/place.rs** (`PlaceWithHirId`, `Place`, `PlaceBase`, `Projection`, `ProjectionKind` are `Pending` in decls.ts) |
| (done here) | lib.rs (16/17), typeck_root_ctxt.rs, expectation.rs, diverges.rs, fn_ctxt/mod.rs, gather_locals.rs, autoderef.rs | 1883 | 76 | |
| wave 19 | method/suggest.rs (5035), fn_ctxt/suggestions.rs (3956), demand.rs except :171..289, fn_ctxt/adjust_fulfillment_errors.rs, method/prelude_edition_lints.rs except :156 / :273, diagnostics.rs manual impls (10) | ~11.8k | | error reporting. `FnCtxt::err_ctxt` (fn_ctxt/mod.rs:192) is `unported` until `TypeErrCtxt` exists (errctxt-contract). |

- Order: typeck-lib-wb and typeck-impl unblock everything (every typeck body passes `loops::check`, then `check_fn` /
  `check_expr_coercible_to_type_or_error`, `normalize`, `register_wf_obligation`, ...); expr-a / checks-a / coerce /
  pat-a next.
- Success-path functions in wave-19 files: only the ones named above (demand_* and the two edition lints). The lanes
  report any other success-path hit in their handoff.

## How to fill a stub
1. **Find the declaration.** Every fn of your file is declared in `src/rustc_hir_typeck/decls.ts` under
   `// <file>:<line>`:
   - `interface FnCtxt` (grouped by file and lane region), `interface TypeckRootCtxt`;
   - `declare module "./<file>.gen.ts"` / `"./<hand module>"` augmentations: `interface X` (methods) and
     `namespace X` (associated fns) of `CoerceMany`, `Coerce`, `CastCheck`, `Pick`, `ProbeContext`, `ConfirmContext`,
     `LoweredTy`, `DeferredCallResolution`, `EnclosingBreakables`, `ExprUseVisitor`, `GatherLocalsVisitor`,
     `WritebackCx`, `CallCtxt`, `ArgsCtxt`, `ArgMatchingCtxt`, `FnCallDiagCtxt`;
   - `interface Companions`, `interface Delegate`, `interface TypeInformationCtxtImpl<S>`;
   - `interface Fns_<module>` (free fns);
   - comment-only declarations (`// name(..): R;`) at the end, grouped by file.
   Do not change a real signature. A wrong or missing one goes in your handoff. If you cannot type-check without the
   change, add a local `declare module "<path>/decls.ts"` in your file marked `// PORT(decls): pending root`.
2. **Methods.** In upstream order write `FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };` (or the
   contract class's prototype) with `// rustc: compiler/rustc_hir_typeck/src/<file>:<line> <name>` directly above it,
   then delete the name from the `unported_methods(..)` list (and the call when the list is empty). In a split file
   edit only your lane's list. Associated fns: `(CastCheck as unknown as { new: typeof CastCheck.new }).new =
   function ..` (FnCtxt's: `FnCtxt.user_args_for_adt = function ..`).
3. **Free fns** already have their final signatures in the stub: fill the body in place, add the marker, drop the
   `(stub ..)` comment. Nested fns are ported inside their parent with their own marker.
4. **Deref.** Inside FnCtxt / ProbeContext / ConfirmContext / Coerce / the checks.rs contexts, read inner members
   directly (`this.tcx`, `this.infcx`, `this.next_ty_var(..)`, `this.register_predicate(..)`, a ProbeContext's
   `this.normalize(..)`). Write a deref coercion explicitly (`this.infcx` where `&InferCtxt` is expected; `this.fcx`
   where `&FnCtxt` is expected). `self.lowerer()` is `this.lowerer()`; `self.tcx()` is `this.tcx`.
5. **Types are generated** (`<file>.gen.ts`, re-exported by your stub). A wrong generated type is fixed in
   `tools/codegen/hir_typeck.typemap.json` / the set and regenerated with `bun tools/codegen/types.ts
   rustc_hir_typeck` (root-reviewed data: say so in your handoff). Hand types listed in "Representation" 7 that are
   `export type X = unknown` in your stub: replace the alias with the class (fields in declaration order) and its trait
   impl; keep the type exported under the same name.
6. **Pending types** (decls.ts `Pending<..>`): `PlaceWithHirId`, `Place`, `PlaceBase`, `Projection` (lane typeck-euv
   ports rustc_middle hir/place.rs and swaps them for re-exports), `SizeSkeleton` (M4), `DefIdOrName` (wave 19).
7. **Init order** (TDZ `ReferenceError` otherwise): decls.ts imports only types; a module's top-level code may touch
   only decls.ts, its own `.gen.ts` and other crates; other rustc_hir_typeck modules are imported normally but read
   inside function bodies only; consumers outside the crate import `src/rustc_hir_typeck/lib.ts`. Never call
   `install_derefs()` yourself; register a new Deref with `register_deref` at top level.
8. **contract.test.ts must stay green.** Its counts change only when declarations change (root).

## `unported(...)` left
- **Placeholders** (`unported_methods`): every FnCtxt method outside the ported files (as
  `rustc_hir_typeck::<module>::FnCtxt::<name>`, e.g. `rustc_hir_typeck::expr::FnCtxt::check_expr`), the methods and
  associated fns of the augmented contract classes, `<WritebackCx as Visitor>` overrides,
  `<&FnCtxt as TypeInformationCtxt>` (10), `FnCtxt::report_unexpected_variant_res` (lib.rs:479, lane typeck-pat-a).
- **Free-fn stubs:** every `Fns_<module>` member except lib.rs's (51 stubs), plus the 10 manual-impl stubs of
  diagnostics.ts and `Delegate_provided.{copy,bind}`.
- **Inside ported code:**
  - `FnCtxt::err_ctxt` (fn_ctxt/mod.rs:192): `TypeErrCtxt` is pending (errctxt-contract, wave 19);
  - `<FnCtxt as HirTyLowerer>::select_inherent_assoc_candidates` (fn_ctxt/mod.rs:319): needs a `TypeFoldable`
    descriptor of `Vec<InherentAssocCandidate>` for `with_replaced_escaping_bound_vars` and `predicates_for_generics`;
    reached only with `#![feature(inherent_associated_types)]`;
  - `typeck_with_inspect` (lib.rs:108), fn bodies: `tcx.codegen_fn_attrs(..)` (provider not ported) then
    `CodegenFnAttrFlags` (rustc_middle middle/codegen_fn_attrs.rs not ported): `unported("..CodegenFnAttrFlags..")`;
  - `GatherLocalsVisitor::declare` (gather_locals.rs:136), a `let` with a type annotation:
    `canonicalize_user_type_annotation` needs `UserType`'s derived `TypeFoldable`, which codegen does not generate
    (rustc_middle ty/typeck_results.rs `UserType` / `UserTypeKind`): `unported("TypeFoldable for ..UserType..")`.

## Stops (what a typeck call does today)
`check_crate` -> `tcx.ensure_ok().typeck(def)` -> `typeck_root` -> `typeck_with_inspect`: `TypeckRootCtxt::new`
(`InferCtxt` in typeck mode + `FulfillmentEngine`, next or old solver per `-Znext-solver`), `FnCtxt::new`, then
- fn bodies: `fn_sig`, `check_abi`, then **`rustc_hir_typeck::loops::check`** (stub);
- const / static / anon const bodies: `infer_type_if_missing`, `type_of`, then **`loops::check`**.
(Under compiletest flags the old solver's `FulfillmentContext::new` (wave 20, selcx-contract) is reached first, in
`TypeckRootCtxt::new`, when `-Znext-solver=coherence` is passed.)

## Re-pinned tests
- `src/rustc_privacy/privacy.test.ts` "privacy_test/clean_pub.rs (--mod-privacy): check_mod_privacy stops UNPORTED at
  typeck": the stop moved from `typeck_root provider (not ported)` to `rustc_hir_typeck::loops::check` (exit 70 kept).

## For root
1. **Record the decisions** of "Representation" (1 Deref forwarders, 2/3 vtables, 6 statics, 7 hand types incl.
   `CoerceMany.expected_ty_`, 8 `Result<null>` for providers, 10 split points) and the split table.
2. **Review the tools changes**: the appended set `rustc_hir_typeck` in types.sets.json and the new
   `hir_typeck.typemap.json`.
3. **Codegen follow-ups** (not changed here): derive(TypeFoldable) for rustc_middle `UserType` / `UserTypeKind` (every
   `let x: T` stops at `GatherLocalsVisitor::declare` until then); `CodegenFnAttrs` (rustc_middle
   middle/codegen_fn_attrs.rs + the `codegen_fn_attrs` provider, rustc_codegen_ssa) is needed by every fn body's typeck.
4. **rustc_middle hir/place.rs** is unported and needed by expr_use_visitor.rs / upvar.rs: assigned to typeck-euv above.
5. **Parallel lane selcx-contract**: no rustc_trait_selection file was touched.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (15062; vendor 3888)`.
- Coverage `bun scripts/coverage.ts --crate rustc_hir_typeck`: 76/1041 (lib.rs 16/17, typeck_root_ctxt 5/5,
  expectation 6/6, diverges 6/6, fn_ctxt/mod 26/26, gather_locals 13/13, autoderef 4/4; every other file 0).
- `bun test src/rustc_hir_typeck src/rustc_interface --timeout=60000`: 12 pass / 0 fail (contract.test.ts; rustc_interface
  has no test files). Also run: `src/rustc_hir_analysis src/rust_ts src/rustc_middle/ty/closure.test.ts` 246 pass / 0
  fail; `src/rustc_privacy` 13 pass after the re-pin.
- contract.test.ts (12 tests): the scan agrees with coverage.ts (1041 fns); every fn declared at `file:line`; FnCtxt /
  TypeckRootCtxt / the augmented classes / the traits / Companions declare every upstream method; every declared method
  and static exists at runtime; `Fns_<module>` == stub exports (tsc + runtime); placeholders stop with the upstream
  path; Deref forwarders (fields read/write through two levels, `this` binding, shadowing, `@ts-expect-error` on
  FnCtxt-as-InferCtxt); `lowerer()` dispatch; stub lists own-file only and split at the lane lines; `provide` installs
  the 5 providers. Negative control: removing `"check_expr"` from expr.ts's list fails "every declared method exists".
- Fresh-process load of `src/rustc_hir_typeck/lib.ts`: ok (forwarders installed: `FnCtxt.prototype.tcx` is a getter,
  `next_ty_var` a forwarder).
- Difftests: see "Samples".

## Samples
Base = integ `4447fa3` (`RUST_TS_AGENT=fnctxt-base`), lane = this branch (`RUST_TS_AGENT=fnctxt-contract`), same cases
(same `--seed`). Every case has the same status and the same stop as on base: no new DIFF, no new UNPORTED, no stop
change (the cases stop before typeck: old solver `FulfillmentContext::new` in 27 minicore cases, `codegen_fn_attrs
provider` in 8 minicore / 68 nocore cases, ...).

| suite | run | MATCH | DIFF | UNPORTED | CRASH | base |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-074735-fnctxt-contract-3ob3` | 5 | 0 | 41 | 0 | `20261015-014431-fnctxt-base-73aw`: 5 / 0 / 41 / 0 |
| tydump-nocore `--sample 100 --seed fnctxt` | `20261015-074746-fnctxt-contract-ftc1` | 17 | 0 | 83 | 0 | `20261015-014441-fnctxt-base-bcgs`: 17 / 0 / 83 / 0 |
| hir-tree-nocore `--sample 100 --seed fnctxt` | `20261015-074809-fnctxt-contract-2xzb` | 100 | 0 | 0 | 0 | `20261015-014501-fnctxt-base-xicu`: 100 / 0 / 0 / 0 |

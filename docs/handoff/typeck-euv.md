# Handoff: typeck-euv (M3, wave 18b): ExprUseVisitor, intrinsicck, naked functions, rustc_middle hir/place.rs

Branch `lane/typeck-euv` (from integ `a5910d3`, no merges).

## Result
- **rustc_middle hir/place.rs**: ported to the new `src/rustc_middle/hir/place.ts` (4/4 fns + the 5 types).
- **expr_use_visitor.rs** 95/95, **intrinsicck.rs** 6/6, **naked_functions.rs** 8/8.
- decls.ts: the four `Pending` place aliases are now re-exports of hir/place.ts (the one allowed decls.ts edit, below).
- `bun scripts/coverage.ts --crate rustc_hir_typeck`: 185/1041 on this branch (76 at base + 109 from this lane).

## Files
- **New:** `src/rustc_middle/hir/place.ts`, `src/rustc_middle/hir/place.test.ts` (3 tests),
  `src/rustc_hir_typeck/expr_use_visitor.test.ts` (2 tests).
- **Filled stubs:** `src/rustc_hir_typeck/expr_use_visitor.ts`, `intrinsicck.ts`, `naked_functions.ts`.
- **decls.ts (root-owned), the allowed edit:**
  - removed `PlaceWithHirId` / `Place` / `PlaceBase` / `Projection = Pending<..>`; added
    `import type { Place, PlaceBase, PlaceWithHirId, Projection, ProjectionKind } from "../rustc_middle/hir/place.ts"` and
    `export type { Place, PlaceBase, PlaceWithHirId, Projection }`;
  - `ProjectionKind` (used by `ExprUseVisitor.cat_projection`) is now imported from hir/place.ts instead of rustc_middle
    ty/decls.ts's `Pending<"ProjectionKind">` (dropped from that import line).
  - Not changed: the header comment (line 8) still says "Pending types (rustc_middle hir/place.rs, ...)": root may reword.
- No other file outside the assignment was touched (no tools/, scripts/, harness/, baselines).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream | ported |
|---|---|
| compiler/rustc_middle/src/hir/place.rs | 4/4 |
| compiler/rustc_hir_typeck/src/expr_use_visitor.rs | 95/95 |
| compiler/rustc_hir_typeck/src/intrinsicck.rs | 6/6 |
| compiler/rustc_hir_typeck/src/naked_functions.rs | 8/8 |

`bun scripts/coverage.ts --check`: `markers ok (15276; vendor 3888)`.

## Representation / PORT decisions (please record)
1. **hir/place.rs types are hand-written** (no codegen set; precedent rustc_middle ty/closure.ts): `PlaceBase` /
   `ProjectionKind` are `$`-tagged unions with frozen unit singletons on the companion (`PlaceBase.Rvalue`,
   `ProjectionKind.Deref`, ...); `Projection` an interface; `Place` / `PlaceWithHirId` classes (`PlaceWithHirId.new`
   static). Derives written by hand: `debug_<T>` (Debug), `<T>_eq` (PartialEq), `clone_Place` / `clone_PlaceWithHirId`
   (Clone copies the `projections` vector). **Not written** (codegen follow-up): `TypeFoldable` / `TypeVisitable` /
   `Hash` / `StableHash` / `TyEncodable` / `TyDecodable` of the place types.
2. `Place`'s methods (`impl Place`, place.rs:104) sit in the class body before `PlaceWithHirId::new` (place.rs:94)
   (PORTING §8, class must declare them); markers keep the upstream lines.
3. **Trait markers restated** (merge-w16a precedent for `HirTyLowererImpl`): `declare module "./decls.ts"` in
   expr_use_visitor.ts restates `interface Delegate` (required methods :48/:63/:67/:88/:100 with markers) and
   `interface TypeInformationCtxtImpl<S>` (:157..:175 with markers); signatures identical to decls.ts.
4. **`impl Delegate for &mut D`** (:108) is the class `DelegateMutRef` (forwards to `_0`); callers keep passing the
   `D` itself (contract: `&mut D` is the object).
5. **`impl TypeInformationCtxt for (&LateContext, LocalDefId)`** (:227) is `TypeInformationCtxt_LateContext:
   TypeInformationCtxtImpl<[LateContext, LocalDefId]>`; `self.0.typeck_results()` is rustc_lint's
   `LateContext.typeck_results_()` (field-name collision there). `ExprUseVisitor.for_clippy` builds
   `TypeInformationCtxt.of([cx, def_id], TypeInformationCtxt_LateContext)`.
6. **`ExprUseVisitor<Cx, D>`** is used as `ExprUseVisitor<TypeInformationCtxt, Delegate>`; `delegate: RefCell<D>` is
   the delegate (`borrow_mut()` dropped). `ExprUseVisitor.new` casts `Cx` to the trait-object class.
7. **Moves of `Place`s**: `cat_projection` / `cat_deref` (`let mut projections = base_place.place.projections;
   projections.push(..)`) copy the vector before pushing: the moved-from value is unobservable in Rust, but a TS caller
   or a delegate that kept the reference still holds it. Every upstream `.clone()` of a `PlaceWithHirId` is
   `clone_PlaceWithHirId`.
8. **`HirPlace` is still `Pending`** in rustc_middle ty/decls.ts (type of `TypeckResults.closure_fake_reads` and
   `CapturedPlace.place`): expr_use_visitor.ts casts it with a local `as_place` (same shape as hir/place.ts `Place`).
9. `mir::FakeReadCause` (`PendingEnum` in typeck_results.ts) is built per PORTING §5: `{ $: "ForMatchedPlace" | "ForLet",
   _0: LocalDefId | undefined }`. `thir::DerefPatBorrowMode` (also `PendingEnum`) is read as `{ $: "Box" } | { $:
   "Borrow", _0: Mutability }`.
10. `rustc_abi::FIRST_VARIANT` is a local `const FIRST_VARIANT = 0 as VariantIdx` (as rustc_middle ty/adt.ts, mir_build).
11. Match arms merged where TS needs one `case` per tag, order preserved: `walk_expr` `Unary(Deref, _)` / `Unary(_, _)`,
    `walk_pat` `Expr(PatExpr { kind: Path })` / `Expr(_) | Range`, `cat_expr_unadjusted` `Unary(Deref)` /
    `UnsafeBinderCast(Unwrap)` fall through to the rvalue arm otherwise, `cat_pattern` `Binding(.., Some)` / `Guard`
    and `Ref` with / without the `skipped_ref_pats` guard. `adjusts.peekable()` in `cat_pattern` is an index.
12. **intrinsicck**: `check_transmutes` / `check_offloads` return `Result<null, ErrorGuaranteed>` (providers, contract
    rule 8); `result.and(x)` is a local `result_and` with `x` evaluated first (eager, as in Rust). The free fns stay
    exported (contract.test.ts checks them against `Fns_intrinsicck`).
13. **naked_functions**: `CheckParameters` / `CheckInlineAssembly` are hand classes extending intravisit `Visitor`
    (replacing the stub's `export type X = unknown`).

## `unported(...)` left
- intrinsicck.rs (M4 layout, as assigned):
  - `skeleton_string` (whole body): `rustc_middle::ty::layout::SizeSkeleton / LayoutError (M4)`;
  - `check_transmute`: after normalization and the `from == to` early return, `SizeSkeleton::compute (M4)`; the
    normalization error path: `LayoutError::NormalizationFailure (M4)`.
- Reached through calls (other owners):
  - `TyCtxt::try_normalize_erasing_regions` (rustc_middle ty/normalize_erasing_regions.rs placeholder) from
    `check_transmute` / `check_offload`;
  - `upvars_mentioned` **provider not ported** (rustc_passes upvars.rs): every `ExprUseVisitor.new` (so `expr_place`
    and upvar.rs's `closure_analyze`) stops there today;
  - `FnCtxt::structurally_resolve_type` (placeholder until lane typeck-impl merges) from
    `TypeInformationCtxt_FnCtxt.structurally_resolve_type` (`FnCtxt::dcx`, `InferCtxt::deeply_resolve_ignoring_regions`
    and `InferCtxtExt::type_is_copy_modulo_regions` / `type_is_use_cloned_modulo_regions` are already ported);
  - error path of `check_asm`: `<NakedFunctionsAsmBlock as Diagnostic>::into_diag` (diagnostics.ts stub, wave 19);
  - clippy path only: rustc_lint `LateContext::type_is_copy_modulo_regions` / `type_is_use_cloned_modulo_regions`.

## Cross-lane needs / for root
1. **rustc_middle ty/decls.ts** still has `HirPlace = Pending<"hir::place::Place">` and `ProjectionKind =
   Pending<"ProjectionKind">`: both can now be re-exports of `src/rustc_middle/hir/place.ts` (`Place`,
   `ProjectionKind`). Then ty/closure.ts's views (`HirPlaceView`, `HirPlaceBase`, `HirProjectionKind`, `view_HirPlace`)
   and its unported Debug stand-ins (`debug_HirPlace`, `debug_PlaceBase`, `debug_ProjectionKind`) can use hir/place.ts's
   real ones (`debug_Place` / `debug_PlaceBase` / `debug_ProjectionKind`); likewise rustc_mir_build thir/cx/expr.ts
   (`HirPlaceView`, `debug_HirPlaceBase`) and rust_ts/tydump_dump.ts (`unported_debug("(Span,
   rustc_middle::hir::place::Place)")`, `closure_fake_reads`). Not done here (not this lane's files).
2. rustc_middle hir/mod.ts should declare `pub mod place;` (`export * as place from "./place.ts"`); consumers import
   hir/place.ts directly meanwhile.
3. **Codegen**: `TypeFoldable` / `TypeVisitable` for `Place` / `PlaceBase` / `Projection` / `ProjectionKind` (writeback's
   resolution of `closure_min_captures` / `closure_fake_reads` / `closure_kind_origins` needs them; lane typeck-lib-wb).
4. **`upvars_mentioned` provider** (rustc_passes upvars.rs) is needed by every `ExprUseVisitor` (upvar inference).
5. Lane typeck-upvar: import `PlaceWithHirId` / `Place` / `PlaceBase` / `Projection` types from decls.ts (or the
   classes / `ProjectionKind` / `clone_*` / `*_eq` / `debug_*` from `../rustc_middle/hir/place.ts`); build
   `ExprUseVisitor.new(TypeInformationCtxt.of(fcx, TypeInformationCtxt_FnCtxt), delegate)`; a delegate that does not
   override `copy` / `bind` forwards to `Delegate_provided.copy(this, ..)` / `.bind(this, ..)` (as `ExprPlaceDelegate`).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- `bun test src/rustc_hir_typeck src/rustc_middle/hir src/rustc_middle/ty/closure.test.ts --timeout=60000`: 22 pass /
  0 fail (contract.test.ts 12 unchanged, expr_use_visitor.test.ts 2: `let (a, b) = t;` walk order with a fake
  `TypeInformationCtxt`, provided `copy` / `bind`; place.test.ts 3).
- No pre-existing test was re-pinned.

## Samples
Base = integ `a5910d3` in a temporary detached worktree (`RUST_TS_AGENT=typeck-euv-base`, removed afterwards), lane =
this branch (`RUST_TS_AGENT=typeck-euv`), same cases (same `--seed typeck-euv`). Per-case comparison: every case has the
same status and the same `unported` stop as on base (0 changed). No case reaches this lane's code yet (typeck still stops
at `loops::check` / the old solver before any `ExprUseVisitor`, transmute or naked-fn check).

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `euv-lane-tydump-minicore` | 5 | 0 | 41 | 0 | `euv-base-tydump-minicore`: 5 / 0 / 41 / 0 |
| tydump-nocore `--sample 100` | `euv-lane-tydump-nocore` | 75 | 0 | 25 | 0 | `euv-base-tydump-nocore`: 75 / 0 / 25 / 0 |
| hir-tree-nocore `--sample 100` | `euv-lane-hir-tree-nocore` | 100 | 0 | 0 | 0 | `euv-base-hir-tree-nocore`: 100 / 0 / 0 / 0 |

Top stops (lane = base): tydump-minicore: old solver `FulfillmentContext::new` (34), `check_unused_traits provider` (3),
`StableHash without a TS impl` (2); tydump-nocore: `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` (9),
`LateParamRegionKind::from_bound` (5), `FulfillmentContext::new` (3), `EarlyParamRegion: RegionName::is_named` (3).

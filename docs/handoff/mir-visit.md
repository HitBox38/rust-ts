# Handoff: mir-visit (M4 wave 21, MIR fill lane 3 of 6): rustc_middle `mir/visit.rs`

Branch `lane/mir-visit` (from `aae2f3fc`, no merges). Commits: port + tests (`f9598805`), then handoff + decision record.

## Files touched
- `src/rustc_middle/mir/visit.ts`: all 125 stubs filled (both `make_mir_visitor!` expansions, `PlaceContext` methods,
  `VisitPlacesWith`).
- `src/rustc_middle/mir/visit.test.ts` (new): 14 tests on hand-built MIR.
- `src/rustc_middle/mir/contract.test.ts`: re-pinned (see below).
- `docs/state/*`: one recorded decision.

## Result
- **`Visitor`** (`make_mir_visitor!(Visitor,)`) and **`MutVisitor`** (`make_mir_visitor!(MutVisitor, mut)`): every
  macro fn ported twice, each with the marker of its line in the macro, **in macro expansion order**: the
  `extra_body_methods!(mut)` pair (`visit_body_preserves_cfg` / `super_body_preserves_cfg`, :1037 / :1041) sits right
  after `visit_body` in `MutVisitor` (invocation at :81); `visit_place_fns!` (:182) sits right after `visit_place` in
  both (`tcx` / `super_place` / `process_projection` / `process_projection_elem` in `MutVisitor`; `visit_projection` /
  `visit_projection_elem` / `super_place` / `super_projection` / `super_projection_elem` in `Visitor`). The contract had
  them at the end of the classes; they moved.
- The helper macros are expanded in place: `super_body!` three times (`Visitor::super_body` with
  `basic_blocks.deref()`, `MutVisitor::super_body` with `as_mut()` (invalidates the CFG cache),
  `super_body_preserves_cfg` with `as_mut_preserves_cfg()` (keeps it)); `basic_blocks!` in `visit_location`.
- `MutVisitor` write-backs: `&mut` Copy leaves are `field_mut(node, "<field>")` views (`Place.local`, `StorageLive._0`,
  `SourceInfo.span/scope`, `ConstOperand.span`, `Const::Ty._1` / `Val._1` / `Unevaluated._1`, rvalue tys / regions /
  consts, `AggregateKind` args / tys, `Call/TailCall.fn_span`, `AscribeUserType._1` (variance), `LocalDecl.ty`,
  `VarDebugInfoFragment.ty` and its `Field` tys, coroutine `yield_ty` / `resume_ty`, `SourceScopeData` span / parents /
  inlined callsite span / shim tys / callee args, `CanonicalUserTypeAnnotation` span / inferred_ty, `Body.span`).
  `super_place` re-interns the projection with `tcx().mk_place_elems` only when `process_projection` changed it.
- `PlaceContext` companion methods (9), `VisitPlacesWith` (`visit_local`, `visit_place`).
- `assert_eq!(local, RETURN_PLACE, "...")` in `Return` panics with core's message format (module-private
  `assert_return_place`).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_middle/src/mir/visit.rs`: **74/74 ported** (base 1/74). rustc_middle
2384/3369; TOTAL 17555/25518. `bun scripts/coverage.ts --check`: markers ok.

## `// PORT:` decisions (in visit.ts's header and inline; recorded with `state.ts record decision`)
- `&mut` of a temporary (`&mut body.return_ty()` in `super_body!`, `let mut local = RETURN_PLACE` in `Return`) is a
  fresh `{ value }`, not written back (as upstream).
- `&mut` of an `Option<Copy>` field's payload (`if let Some(x) = &mut o.f`) is `field_mut(o, "f")` cast to the payload
  type after the `Some` check.
- `Cow<[PlaceElem]>` in `process_projection`: `owned` (`Cow::Owned` once set; `undefined` = `Cow::Borrowed` → `None`).
- `super_source_scope_data`'s `InstanceKind` match is an if-chain in arm order; the inner `ShimKind` switch has a
  `default: bug()` for the shim kinds the earlier arm already took (exhaustive upstream). `ambient_variance` ends in
  `unreachable()` after its four arms (exhaustive upstream).
- `TyContext::LocalDecl { source_info: *source_info }` copies with `clone_SourceInfo` (PORTING §8 Copy objects).
- `VisitPlacesWith::visit_place` hands `clone_Place(place)` to the closure (`*place`).

## `unported(...)` left
None in visit.ts. Walks call sibling-lane stubs (they stop UNPORTED until those lanes land): `Place::as_ref`,
`PlaceRef::iter_projections`, `StmtDebugInfos::deref` / `deref_mut` (mir-body-b), `Place: From<Local>`
(`Place_from_Local`, mir-body-b; used by `VisitPlacesWith::visit_local`), `Body::return_ty`, `SourceInfo::outermost`
(mir-body-a).

## Tests (`src/rustc_middle/mir/visit.test.ts`)
A recording `Visitor` / `MutVisitor` (every `visit_*` callback logs, then defers to the default) checks the exact
callback sequence, `PlaceContext`s and `TyContext`s, written by hand from the macro, for: every `StatementKind`
(+ statement debuginfos), every `Rvalue` kind (each `BorrowKind` / `Mutability` / `RawPtrKind` context, every
`AggregateKind`), every `Operand` / `mir::Const` kind, every `TerminatorKind` (+ every `InlineAsmOperand`) and
`AssertKind`, every `ProjectionElem` with mutating / non-mutating / debuginfo contexts (`Index` locals as `Copy` only
for real uses), a whole `Body` (`super_body!` order: coroutine tys, var debug info incl. composite fragments, blocks
with after-last debuginfos at `statement_index = len`, source scopes, return ty, local decls + user type projections,
user type annotations, body span, required consts), `super_source_scope_data` for every `InstanceKind` / `ShimKind`
arm, `visit_location`, all `PlaceContext` methods, `VisitPlacesWith`. `MutVisitor`: the same body walk (places through
`visit_local` + `process_projection`), CFG cache invalidated by `visit_body` and kept by `visit_body_preserves_cfg`; a
rewriting visitor (rename `_1`→`_9`, rename every ty / region / const / args, shift spans / scopes, change variance)
checks every write-back lands (including the re-interned projection `Index(_9)` / `Field(F')` / `OpaqueCast(O')` /
`UnwrapUnsafeBinder(W')` and an untouched projection keeping its identity); renaming `_0` in `Return` panics with
upstream's message; `process_projection` returns `undefined` when nothing changes.
While a sibling fn the walks need is still a stub, the test installs a test-local copy of upstream's body for it
(`shim_if_stub`, restored in `afterAll`); once the sibling lane lands, the real fn is used. `VisitPlacesWith::visit_local`
is checked to stop at `<Place as From<Local>>::from` while that is a stub, and fully otherwise.

## Re-pinned tests (no assertion weakened)
- `src/rustc_middle/mir/contract.test.ts`: "stubs per fill lane": the `"mir-visit": 125` entry is gone (0 stubs left;
  other lanes' counts unchanged here: expect a merge conflict on that object with the other fill lanes, take every
  lane's removal / new count). "stubs stop as UNPORTED": the two visitor lines (`Visitor::visit_body`,
  `MutVisitor::visit_local` stopping as stubs) now check that `visit_local` runs without stopping (the walks themselves
  are covered by visit.test.ts).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `bun test src/rustc_middle`: 283 pass, 0 fail (visit.test.ts 14, contract.test.ts 6).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at the end): 5570 pass, 1 skip, **2 fail**, both
  base fallout, not this lane: rustc_lint `types.oracle.test.ts` "late types lints: PENDING TypeLimits: fn pointer `==`
  suggestion stops at utils::std_or_core" and "... ambiguous_wide_pointer_comparisons stops at utils::std_or_core" (the
  PENDING cases now run past `std_or_core` and emit the full lint). The same 2 fail when that file is run in the base
  worktree at `aae2f3fc` (11 pass / 2 fail). Log: `$RUST_TS_DATA/tmp/mir-visit/fulltest.log`.

## Samples (lane vs base `aae2f3fc` = detached worktree `lanes/mir-visit-base`; both `RUST_TS_AGENT=mir-visit`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-194106-mir-visit-t2pu` | 45 / 0 / 1 / 0 | `20261021-194125-mir-visit-91yn` | 45 / 0 / 1 / 0 |
| hir-tree `--sample 200` | `20261021-194145-mir-visit-ki9s` | 200 / 0 / 0 / 0 | `20261021-194242-mir-visit-5ake` | 200 / 0 / 0 / 0 |

No new DIFF; the one UNPORTED (`mini_core_hello_world.rs`) stops at the same place on both
(`rustc_middle::mir::interpret::TyCtxt::const_eval_poly (M4)`). No suite reaches the MIR visitors yet (MIR building is
wave 22).

## For root / other lanes
- Delete the worktree `.data/lanes/mir-visit-base` (detached at `aae2f3fc`) when done comparing.
- `pretty.ts`'s `ExtraComments extends Visitor` (lane mir-pretty) is unaffected: the class shape and signatures are the
  contract's.

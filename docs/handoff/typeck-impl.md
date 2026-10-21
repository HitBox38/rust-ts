# Handoff: typeck-impl (M3 wave 18b, rustc_hir_typeck): fn_ctxt/_impl.rs, place_op.rs, _match.rs

Branch `lane/typeck-impl` (from integ `a5910d3`, no merges). Commits: `925b42c` (_impl.rs), `440d5c6` (place_op.rs,
_match.rs), `17b58fc` (unit tests), then this handoff.

## Result
- **fn_ctxt/_impl.rs 57/57**, **place_op.rs 8/8**, **_match.rs 12/12** ported (all of the lane's fns; no
  `unported_methods` list left in the three stubs). Helper types are local classes inside their fn: `UnreachableItem`
  (manual `Diagnostic`), `CollectClauses` (intravisit `Visitor`), `CtorGenericArgsCtxt` (`GenericArgsLowerer`, as
  hir_analysis's `GenericArgsCtxt`).
- No signature in decls.ts changed. Two declarations are wrong and are worked around locally (see "For root").

## Files
- `src/rustc_hir_typeck/fn_ctxt/_impl.ts`, `src/rustc_hir_typeck/place_op.ts`, `src/rustc_hir_typeck/_match.ts` (stubs
  filled).
- New: `src/rustc_hir_typeck/typeck_impl.test.ts` (16 tests, fake `FnCtxt` receiver as pat_b.test.ts: write_ty /
  node_ty / node_ty_opt, table writers, deferred call resolutions, `with_breakable_ctxt`, `apply_adjustments` (NeverToAny
  type var, retarget, reborrow replacement, compose delayed bug), `can_contain_user_lifetime_bounds`, `err_args`,
  `register_wf_obligation` / `add_wf_bounds`, `select_obligations_where_possible` order (mutate, adjust, err_ctxt,
  report), `deeply_resolve_ignoring_regions_with_obligations`, `expr_in_place`, `warn_if_unreachable` (once; message and
  labels), `arms_contain_ref_bindings`, `maybe_get_coercion_reason` / `if_cause`, place-op bail without lang items,
  builtin `lookup_derefing`, builtin `convert_place_op_to_mutable`).
- Nothing outside these files was edited.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs`: 57/57 ported.
- `... place_op.rs`: 8/8 ported. `... _match.rs`: 12/12 ported.
- `bun scripts/coverage.ts --check`: `markers ok (15240; vendor 3888)`.

## `unported(...)` left (in my files)
- `FnCtxt::write_user_type_annotation_from_args` (_impl.rs:302), when `can_contain_user_lifetime_bounds(args,
  user_self_ty)`: `unported("TypeFoldable for rustc_middle::ty::typeck_results::UserType (FnCtxt::write_user_type_annotation_from_args)")`.
- `FnCtxt::lower_ty_saving_user_provided_ty` (_impl.rs:582), same condition on the lowered type:
  `unported("TypeFoldable for rustc_middle::ty::typeck_results::UserType (FnCtxt::lower_ty_saving_user_provided_ty)")`.
  Both need the derived `TypeFoldable` of rustc_middle `UserType` / `UserTypeKind` (codegen; same gap as
  `GatherLocalsVisitor::declare`). **This is the main blocker of this lane's success path**: every path to a generic
  item (`G(4)` with `struct G<T>`, generic fn calls, `Vec::new`, ...) reaches it in `instantiate_value_path`.
- Error paths only reach other lanes' stops: `FnCtxt::err_ctxt` (wave 19) from `select_obligations_where_possible`,
  `report_ambiguity_errors`, `try_structurally_resolve_const`, `type_must_be_known_at_this_point`,
  `structurally_resolve_const`; `RemoveSemiForCoerce` subdiagnostic stub (diagnostics.ts, wave 19) from
  `suggest_removing_semicolon_for_coerce`. No success-path fn of a wave-19 file is needed by this lane.

## PORT decisions
1. `tag()` (`format!("{self:p}")`): each FnCtxt gets a sequential pseudo-address (`0x1000`, `0x2000`, ...; WeakMap).
   Only reached from `debug!` and the `bug!` of `node_ty` (an ICE text whose address is not reproducible upstream).
2. `debug!` / `#[instrument]` calls are comments (the `deeply_resolve_ignoring_regions` inside `write_ty`'s `debug!` is
   not evaluated, as with tracing off).
3. In-place writes to stored `Adjustment`s (`*target = new_target` in `apply_adjustments`, `*deref = ..` in
   `convert_place_derefs_to_mutable`, `adjustment.kind/target = ..` and the unsize `*target` in
   `convert_place_op_to_mutable`) replace the array element with a new `Adjustment` object instead of mutating it (an
   `Adjustment` object may be shared with the vector a caller built). Same observable table contents.
4. `with_breakable_ctxt`: `FxIndexMap::swap_remove` on `by_id` is a `delete` (never iterated, only looked up).
5. `can_contain_user_lifetime_bounds((args, user_self_ty))`: the tuple's `TypeVisitable` is composed from the container
   helpers (`visit_with_tuple2`, `visit_with_Option`, generated `visit_with_UserSelfTy`): `d_UserArgsTuple`.
6. `TypeErrCtxt` is `Pending`: calls after `this.err_ctxt()` go through a local view interface `TypeErrCtxtView`
   (`report_fulfillment_errors`, `emit_inference_failure_err`) as rustc_trait_selection traits/mod.ts' `err_ctxt`
   precedent; unreachable while `err_ctxt` is unported.
7. `arms_contain_ref_bindings`: `Iterator::max` over `Mutability` (`Not < Mut`).
8. `Obligation::new(.., ClauseKind)` uses the inline `Predicate_upcast_from_ClauseKind` adapter (as fn_ctxt/mod.ts).

## For root
1. **decls.ts `explain_if_expr`** (_match.rs:313): the out-parameter `error: &mut bool` is declared `error: boolean`;
   it should be `error: MutRef<boolean>` (PORTING §8). _match.ts assigns the method with `MutRef<boolean>` through a cast
   marked `// PORT(decls): pending root` and calls it through a typed local helper.
2. **decls.ts imports `CoerceMany` from `./coercion.gen.ts`** (the generated class, field `expected_ty`), while the
   contract class is the hand-written one in coercion.ts (field `expected_ty_`, the augmented methods). Every
   decls.ts declaration that mentions `CoerceMany` (`FnCtxt.ret_coercion`, `if_fallback_coercion(coercion)`, the
   coercion.rs / expr.rs methods; lib.gen.ts' `BreakableCtxt.coerce` is right) therefore has the wrong type; _match.ts converts with `as_hand_CoerceMany` (`// PORT(decls): pending root`).
   Fix: `import type { CoerceMany } from "./coercion.ts"` in decls.ts (lane typeck-coerce will meet the same issue).
3. **Codegen follow-up (blocking)**: derive(TypeFoldable) for rustc_middle `UserType` / `UserTypeKind` (see unported).
4. **Found in a scratch integration** (not my files): `typeck_with_inspect` (lib.ts:345) asserts
   `typeck_results.hir_owner === id.owner` on `OwnerId` *objects*, which always fails once a body is fully checked:
   ICE `assertion failed: typeck_results.hir_owner == id.owner`. It must compare by value
   (`hir_owner.def_id === id.owner.def_id`).

## Samples (no new DIFF)
Base = integ `a5910d3` in a temporary detached worktree (`RUST_TS_AGENT=typeck-impl-base`), lane = this branch
(`RUST_TS_AGENT=typeck-impl`), same `--seed typeck-impl`. Per-case status and stop message identical between base and
lane (0 changed cases): no case reaches typeck code on either side.

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-nocore `--sample 100` | `20261015-081654-typeck-impl-h59l` | 72 | 0 | 28 | 0 | `20261015-081957-typeck-impl-base-6bzq` 72/0/28/0 |
| tydump-minicore (46, full) | `20261015-081808-typeck-impl-sgnn` | 5 | 0 | 41 | 0 | `20261015-082033-typeck-impl-base-0t27` 5/0/41/0 |
| hir-tree-nocore `--sample 100` | `20261015-081850-typeck-impl-b0h0` | 100 | 0 | 0 | 0 | `20261015-083329-typeck-impl-base-1spf` 100/0/0/0 |

Top stops (lane = base): tydump-nocore `IntegerExt::from_int_ty` (8), `LateParamRegionKind::from_bound` (6), QueryKey
`LitToConstInput` (5), QueryKey `(CanonicalImpliedOutlivesBoundsGoal, bool)` (4), `check_unused_traits` (3);
tydump-minicore old solver `FulfillmentContext::new` (34), `check_unused_traits` (3).

**Scratch integration** (temporary, discarded; not part of this branch): integ HEAD + typeck-impl, -lib-wb, -checks-a,
-expr-a, -coerce, -callee-cast, -method, -probe, -pat-a, -upvar, -euv (all merged cleanly, tsc clean) + selcx-contract's
QueryKey commit `fa3d876`, with the lib.ts:345 assert patched. Hand-written no_core const bodies through
`src/rust_ts/tydump.ts` vs the oracle probe `target/probes/release/tydump` (byte-identical output = MATCH):
- MATCH: `const A: u8 = 3; const B: u8 = A;` (path to a const: `instantiate_value_path`), `match true {..}`,
  `match 3u8 { 0 => 1, n => n }`, `match () { () => true }` (`check_expr_match`, `demand_scrutinee_type`,
  `CoerceMany` arms), `if true { 1 } else { 2 }`, `if true { }` (`if_fallback_coercion`), `let mut a = 1u8; a = 2;`,
  `&1`, `*X` (`lookup_derefing` builtin), `loop { break 3 }` (`with_breakable_ctxt`), `(1, true)`.
- Stops: `G(4)` with `struct G<T>` and `let y: u8 = x` at the `UserType` TypeFoldable gap; `S(3)` at
  `TyCtxt::is_intrinsic`; `[1, 2]` at `Target::parse_data_layout`; enums at `IntegerExt::from_int_ty`; `L.0` /
  `S { 0: 1 }` at expr-b placeholders; `x == 1` without `PartialEq` (oracle: E0369) at `err_ctxt` (wave 19).
- fn bodies stop before typeck at the `implied_outlives_bounds` provider (rustc_traits, selcx-contract).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 28 pass / 0 fail (contract.test.ts 12 + typeck_impl.test.ts 16).
- No pre-existing unit test's pinned stop moved (nothing re-pinned).

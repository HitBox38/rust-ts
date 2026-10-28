# Handoff: mt-coroutine-a (M4 wave 24): coroutine transform (StateTransform) + by-move body

Branch `lane/mt-coroutine-a` (base `de448071` on integ-w19, no merges). Commits: the port + tests → test type fix →
this handoff (with a header-comment touch-up of mod.ts).

## Files touched
- `src/rustc_mir_transform/coroutine/mod.ts`: **stub replaced** by the whole port of coroutine/mod.rs (`StateTransform`
  `run_pass` / `policy`, `RenameLocalVisitor`, `SelfArgVisitor`, `replace_base`, `SELF_ARG` / `CTX_ARG`,
  `SuspensionPoint`, `TransformVisitor` (+ its `MutVisitor` impl), `make_aggregate_adt`,
  `make_coroutine_state_argument_indirect` / `_pinned`, `transform_async_context`, `eliminate_get_context_calls`,
  `insert_switch`, `insert_term_block`, `return_poll_ready_assign`, `insert_poll_ready_block`, `insert_panic_block`,
  `can_return`, `can_unwind`, `generate_poison_block_and_redirect_unwinds_there`, `create_coroutine_resume_function`,
  `Operation`, `create_cases`, `EnsureCoroutineFieldAssignmentsNeverAlias`). The re-exports lib.ts uses
  (`StateTransform`, `coroutine_by_move_body_def_id`, `mir_coroutine_witnesses`) keep their names.
- `src/rustc_mir_transform/coroutine/by_move_body.ts`: **stub replaced** by the whole port of coroutine/by_move_body.rs
  (`coroutine_by_move_body_def_id`, `MakeByMoveBody`).
- `src/rustc_mir_transform/coroutine/drop.ts` (shared with mt-cleanup / mt-drops / mt-shim): only the mt-coroutine-a
  part. The stand-ins for mod.rs items (`TransformVisitor`, `Operation`, `create_cases`, `insert_switch`,
  `insert_term_block`, `return_poll_ready_assign`, `insert_poll_ready_block`, `insert_panic_block`,
  `make_coroutine_state_argument_indirect` / `_pinned`, `transform_async_context`,
  `generate_poison_block_and_redirect_unwinds_there`) and the redeclared `SELF_ARG` are deleted; one
  `import { .. } from "./mod.ts"` replaces them (`use super::*`), and the header's PORT note says so. The stand-ins of
  the other lanes (`deref_finder`, `DropShimElaborator`, `Unwind`, `elaborate_drop`) are untouched. Merge note: if
  another lane edited the import block / header of drop.ts, keep both sides.
- `src/rustc_mir_transform/pass_manager.test.ts`: stub-module count 54 → 52 (delta −2: coroutine/mod.ts and
  coroutine/by_move_body.ts).
- `src/rustc_mir_transform/coroutine/mod.test.ts` (new, 4 tests): `Operation`, `create_cases` (StorageLive set, resume
  argument moved out of `CTX_ARG` unless it is `CTX_ARG`, drop vs resume targets), `insert_switch` (discriminant local,
  `START_BLOCK` → former entry, default last), `generate_poison_block_and_redirect_unwinds_there` (poison block,
  `UnwindResume` → goto, `Continue` → `Cleanup(poison)` outside cleanup blocks).

## Coverage
- coroutine/mod.rs 45/45, coroutine/by_move_body.rs 5/5 (`bun scripts/coverage.ts --missing`).
- rustc_mir_transform 339/1101; TOTAL 20768/25518. `bun scripts/coverage.ts --check`: markers ok (21347; vendor 4330).

## Tests
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_mir_transform`: 62 pass, 0 fail (before mod.test.ts; mod.test.ts alone: 4 pass).
- Full unit suite not run (coordinator: root runs it at integration).

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with the base runs named in w25-common.txt)
| suite | lane run | M / D / U / C / T | base run | MATCH lost |
|---|---|---|---|---|
| tydump-minicore (46) | `20261027-225105-root-f5de-dl71` | 46 / 0 / 0 / 0 / 0 | `…-wos5` (45 M) | 0 |
| mirdump-minicore (46) | `20261027-225258-root-f5de-j13z` | 45 / 0 / 1 / 0 / 0 | `…-p8q4` | 0 |
| tydump-ui `--sample 300` | `20261027-225439-root-f5de-2kl3` | 258 / 0 / 36 / 0 / 4 (+2 unstable) | `…-zjq3` | 0 (the 4 TIMEOUTs, MATCH in base, re-run alone: all MATCH) |
| mirdump-ui `--sample 300` | `20261028-001855-root-f5de-zxna` (`--jobs 4`) | 273 / 0 / 27 / 0 / 0 | `…-mzgb` (269 M) | 0 |
| borrowck-ui `--sample 300` | `20261028-002842-root-f5de-nzm0` (`--jobs 4`) | 0 / 0 / 300 / 0 / 0 | `…-86qn` (300 U) | 0 |

The first mirdump-ui / borrowck-ui runs (`…-1qvw`, `…-5prw`) hit 195 / 153 TIMEOUTs at load average 200–390; both were
re-run with `--jobs 4` on the clean tree (above). No new DIFF / CRASH anywhere. Every changed UNPORTED stop, and the
gained MATCHes, come from base drift since the Oct-22 base runs (borrowck lanes: `UniverseInfo::relate`,
`OutlivesConstraintSet::push`, `CleanupPostBorrowck`, `Decodable for mir::Body`, `try_to_bits_for_ty` gone); none
names a coroutine item.

## Stops that moved
**None in the samples.** No sampled case reaches `StateTransform` (it runs in `run_runtime_lowering_passes`, behind
`mir_borrowck` / drop elaboration; mirdump prints `mir_built` / `mir_promoted` only) or `coroutine_by_move_body_def_id`.

New runtime stops, in the order a body reaches them:
1. `StateTransform::run_pass` → `elaborate_coroutine_drops` → `rustc_mir_transform::elaborate_drop::elaborate_drop (lane
   mt-drops)` (drop.ts stand-in; always reached: `insert_clean_drop` adds a `drop(_1)`). Then, once mt-drops lands,
   `rustc_mir_transform::deref_separator::deref_finder (lane mt-cleanup)` in `create_coroutine_drop_shim` (drop.ts's
   stand-in) / `create_coroutine_resume_function` (mod.ts's stand-in), then
   `rustc_mir_transform::abort_unwinding_calls::AbortUnwindingCalls (pass not ported)` (its `policy`, via
   `run_passes_no_validate`).
2. `coroutine_by_move_body_def_id` is **not reachable yet**: `TyCtxt::needs_coroutine_by_move_body_def_id`
   (`src/rustc_middle/ty/context.ts`, context.rs:2913) still stops at
   `unported("rustc_type_ir::binder::EarlyBinder::instantiate_identity (binder.rs, lane tyir-binder)")` although
   `EarlyBinder.instantiate_identity` is ported now. Verified locally (patch reverted, not committed) on an
   `async move || ..` / `async || ..` file under tydump: with that fn completed as upstream, the by-move body is built
   and the next stops are `coverage_attr_on provider (not ported)` (coverage/query.rs) and, with that bypassed,
   `rustc_middle::dep_graph::hash_result (StableHash of the values of query explicit_clauses_of)` when the new def is
   fed.

## `unported(...)` left
- mod.ts: module-local stand-in `deref_finder` → `rustc_mir_transform::deref_separator::deref_finder (lane mt-cleanup)`
  (deref_separator.ts is mt-cleanup's stub and does not export it yet). mt-cleanup / root: export the port and import
  it in mod.ts and drop.ts, deleting both stand-ins.
- by_move_body.ts: none.

## PORT decisions (please record)
1. `IndexVec<Local, Option<(Ty, VariantIdx, FieldIdx)>>` `remap` is `([Ty, VariantIdx, FieldIdx] | undefined)[]` (as
   layout.ts); `remap.get(l)` / `IndexSlice<I, Option<T>>::contains` read the slot (`undefined` out of bounds).
2. `impl MirPass for StateTransform` sits in the class body (PORTING §8); `Operation` is a string union with its methods
   on the companion const.
3. Items drop.rs reaches through `use super::*` are exported from mod.ts, including the upstream-private `SELF_ARG`.
4. Copies of `Copy` / cloned MIR values stored back into the MIR are `clone_Place` / `clone_SourceInfo` /
   `clone_Operand`; `IndexVec::swap` of `local_decls` is an inline swap; `SwitchTargets::new`'s values are `bigint`.
5. by_move_body: `UnordMap` is a `Map` (only `get` / `len` used); `tcx.arena.alloc(Steal::new(..))` is
   `Steal.new(body, "rustc_middle::mir::Body")`; fed query values (`codegen_fn_attrs`, `generics_of`) are shared, not
   cloned (query values are never mutated; precedent interpret/intern.ts); `fold_CoroutineClosureSignature` is a
   module-local `TypeFoldable` descriptor (precedent rustc_mir_build builder/mod.ts).

## For root / other lanes
- rustc_middle owner: complete `needs_coroutine_by_move_body_def_id` (context.ts:2684) as upstream:
  `matches!(coroutine_kind, Desugared(_, Closure)) && let ty::Coroutine(_, args) =
  type_of(def_id).instantiate_identity().skip_norm_wip().kind() && args.as_coroutine().kind_ty().to_opt_closure_kind()
  != Some(FnOnce)`.
- mt-cleanup: `deref_finder` export (above). mt-drops: `elaborate_drop` / `Unwind` (drop.ts stand-ins). mt-shim:
  `DropShimElaborator`. Whoever ports `abort_unwinding_calls.rs` unblocks the resume function's pass run.
- `debug_BitMatrix` printing raw indices (mt-coroutine-b's note) still affects the `coroutine_resume` dump once it is
  reachable.

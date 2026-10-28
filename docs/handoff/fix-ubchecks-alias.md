# Handoff: fix-ubchecks-alias (wave 26 fixer: MIR aliasing bugs exposed by mt-opt1)

Branch `lane/fix-ubchecks-alias` (base `fc497c3c` on integ-w25, no merges). Commits: `605bf46d` the fixes, `c6cecfa6` the alias
checker and its test, `89fc2a0c` `Session::emit_lifetime_markers` and the lib.ts comment, then this handoff.

## The bug and the fix
In rustc `Place` and `SourceInfo` are `Copy`, so every statement, terminator, local decl and operand holds its own value.
The port must `clone_*` at each point where rustc copies, because MIR passes edit these objects in place (decision
2026-10-22 "MIR build aliasing", PORTING §8). `SimplifyLocals` renames locals and the inliner remaps scopes, so a shared
object gets edited twice.

Fixed (each reuse now clones where rustc copies):
- `check_alignment.ts` `insert_alignment_check` and `check_null.ts` `insert_null_check`:
  - every use of a new place after its assignment is `clone_Place`: `thin_ptr`, `addr`, `alignment_mask` (also as the
    second assignment target), `alignment_bits`, `is_ok`, `pointee_should_be_checked`, `is_null`,
    `should_throw_exception`;
  - every `Statement::new` / `LocalDecl::with_source_info` gets `clone_SourceInfo(source_info)`.
- `check_pointers.ts`: `let source_info = statement.source_info` is a copy now. It was shared by the statement and every
  `Assert` terminator inserted for it; the terminator gets its own copy.
- `check_enums.ts`: the same `source_info` copy in `run_pass`, plus `clone_Place` / `clone_SourceInfo` at every reuse in
  `insert_discr_cast_to_u128`, `insert_direct_enum_check` (`discr_masked` used three times), `insert_uninhabited_enum_check`
  and `insert_niche_check`.
- `known_panics_lint.ts`: audited, no change. It only reads the body.
- Found by the audit and the checker, outside the four check files:
  - `shim.ts` `build_adt_ctor`: one `SourceInfo` was shared by the statement and the terminator of every ADT constructor
    body.
  - `shim.ts` `CloneShimBuilder`: `ref_loc` (assignment target, then `Move` arg), `dest_field` (call destination, then the
    cleanup `Drop` place) and `temp` (assignment target, then the `SwitchInt` discr) are now cloned.
  - `promote_consts.ts` (lane mt-promote, not in the brief's list; same bug class, so I fixed it here):
    - `promote_candidate` shared `statement.source_info` between the original statement, the new `promoted_ref` local
      decl and the new `promoted_ref` statement;
    - `promote_temp`'s non-`keep_original` path shared the original terminator's `SourceInfo` with the terminator moved
      into the **promoted body** (a share across bodies).

The audit covered, by reading and with the checker below: mt-cleanup (16 files), mt-drops (`elaborate_drop.ts`,
`elaborate_drops.ts`), mt-shim (`shim.ts`, `shim/async_destructor_ctor.ts`), mt-coroutine-a (`coroutine/mod.ts`,
`coroutine/by_move_body.ts`), mt-inline (`inline.ts`, `inline/cycle.ts`, `cost_checker.ts`, `cross_crate_inline.ts`),
mt-opt1's 13 files, and `patch.ts`. Apart from the fixes above they already follow the rule.

## Alias checker (kept as a test)
- `src/rustc_mir_transform/alias_check_oracle/alias_check.ts`:
  - `find_shared_objects(root)` walks a body's object graph and reports every object reached through two paths. It
    skips frozen (interned) objects, `BasicBlocks.cache`, and the `DefId`-like value classes.
  - `find_shared_mir_nodes` keeps only the MIR nodes passes edit in place: `Place`, `SourceInfo`, `Operand::*`,
    `Statement`, `Terminator`, `BasicBlockData`, `LocalDecl`, `ConstOperand`, `SourceScopeData`.
- `alias_check_oracle/run.ts` (test driver):
  - runs the real driver (prefix analyses, the `MIR_borrow_checking` loop with the real `mir_borrowck`), then
    `optimized_mir` / `mir_for_ctfe` for every `mir_keys` body;
  - replaces `MirDumper::new` / `dump_mir`, so that every point where `-Zdump-mir=all` would dump a body runs the check
    instead (no files; the borrowck / dataflow dumpers stay off, since they render graphviz);
  - at the end it also checks the completed bodies together, for sharing across bodies.
- `alias_check.test.ts`: 3 unit tests of the walker, plus the runner on 4 fixtures with UB checks on:
  - the new `alias_check_oracle/ubchecks.rs` (pointer derefs, enum transmutes, promoteds, ctors, drops);
  - the existing `elaborate_drops_oracle/drops.rs`, `known_panics_lint_oracle/cases/ub_checks.rs` and
    `validate_oracle/ctors.rs`.
  - It asserts no `ALIAS` line, and that bodies reached PromoteTemps, ElaborateDrops, CheckAlignment, CheckNull,
    CheckEnums and InstSimplify. In the real tree the bodies stop at mt-opt2's
    `UnreachablePropagation (pass not ported)` stub, after UnreachableEnumBranching.
  - At base the same runner reports the CheckAlignment / CheckNull / CheckEnums / PromoteTemps / ctor shares (checked
    by restoring the 6 files). With the fix it reports none.
- The directory is `*_oracle/` because pass_manager.test.ts's layout test requires every other non-test `.ts` in the
  crate to mirror an upstream file.

## `Session::emit_lifetime_markers`
- Ported into `src/rustc_session/session.ts` (session.rs:883, with marker and upstream body), between
  `at_least_rust_2024` and `diagnostic_width`.
- The stand-in in `remove_storage_markers.ts` is gone. `RemoveStorageMarkers::policy` calls
  `ctx.deref().emit_lifetime_markers()` and CopyProp calls `tcx.sess.emit_lifetime_markers()`; the stale header notes
  are updated.
- `lib.ts:152` now reads `// mod ssa; (ssa.ts; not referenced here: copy_prop imports it)`.

## Oracle verification (scratch: `$RUST_TS_DATA/scratch/fix-ubchecks-alias/`)
- This is mt-opt1's driver (`cwrap.ts`, `cmp.sh`, `first.sh`, `batch.sh`), repointed at this worktree, with the same
  stand-ins: ForceInline no-op unless `CWRAP_NOOP_INLINE=0`, and the mt-opt2 policies off.
- `CWRAP_ALIAS=1` adds the checker: per dump (`CWRAP-ALIAS`) and over the final bodies (`CWRAP-XALIAS`).
- All runs use `--target x86_64-unknown-linux-gnu`, UB checks on (default flags).
- "equal" means byte-identical after the allocN normalisation.

| input | flags | dumps compared | equal |
|---|---|---|---|
| c2.rs | default (UB checks on) | 2148 | 2148 (base: `bx2` wrong from `SimplifyLocals-final.after`, 2144) |
| c3.rs | default (UB checks on) | 2720 | 2720 (base: `i10` ICE `Option::unwrap()` at simplify.ts `visit_local`, no dumps after it) |
| c2.rs | `-Zinline-mir`, real ForceInline/Inline (`CWRAP_NOOP_INLINE=0`) | 2192 | 2192 |
| c7.rs | `-Zinline-mir`, real inliner | 3430 | 3430; no MIR node shared across the 37 final bodies |
| c5.rs / c6.rs / c7.rs | default | 1130 / 951 / 3360 | all |
| c5.rs + `CWRAP_SHIMS=1` | drop-glue shims | 1215 | all |
| tests/ui/mir batch (53 files, `uimir.list`) | default (UB checks on) | 32695 (52 files) | 32695 |

- **tests/ui/mir batch:**
  - `mir_assign_eval_order` is now 1194 / 1194 and `mir_early_return_scope` 463 / 463, with UB checks on. All their
    bodies complete, so `mir_early_return_scope.main` no longer hits the `visit_local` ICE. At mt-opt1 both diverged
    from `SimplifyLocals-before-const-prop.after` on.
  - `mir_fat_ptr_drop` (368 / 368) is equal now too; it used to stop at `Decodable for mir::Body`, fixed by the base.
  - `issue-75419-validation-impl-trait` still hits the RPIT driver ICE before any pass, as at mt-opt1.
  - The `FatalErrorMarker` bodies in 6 files are the same ones as in mt-opt1's batch (`scratch/mt-opt1/ob-ui.log`): they
    are poisoned by an earlier unported stop.
  - 1773 final bodies were checked, and no MIR node is shared within or between bodies.

- c3's only oracle-only dumps are `mutp`'s, which stops at the known KPL `QueryKey for ty::Value` stop.
- c2's `h` hits a `FatalErrorMarker` on both the base and this branch.
- With the fix, `CWRAP-ALIAS` reports no shared MIR node in any of these runs.

## Samples (`RUST_TS_AGENT=root-f5de`, branch at `89fc2a0c`)
| suite | run | M / D / U / UNSTABLE | vs base run (w26 brief) | vs `kv-*` run |
|---|---|---|---|---|
| tydump-minicore | `20261028-044247-root-f5de-nvmf` | 46 / 0 / 0 / 0 | `wos5` 45/0/1: 1 UNPORTED->MATCH | — |
| mirdump-minicore | `20261028-044306-root-f5de-d82j` | 46 / 0 / 0 / 0 | `p8q4` 45/0/1: 1 UNPORTED->MATCH | — |
| mir-minicore | `20261028-044325-root-f5de-200v` | 40 / 0 / 6 / 0 | (none in brief) | `kv-mir-minicore` identical per case |
| tydump-ui `--sample 300` | `20261028-044345-root-f5de-0vhl` | 295 / 0 / 3 / 2 | `zjq3`: 34 UNPORTED->MATCH | `kv-tydump-ui` identical |
| mirdump-ui `--sample 300` | `20261028-044543-root-f5de-kd24` | 300 / 0 / 0 / 0 | `mzgb`: 31 UNPORTED->MATCH | `kv-mirdump-ui` identical |
| borrowck-ui `--sample 300` | `20261028-044751-root-f5de-sn2o` | 286 / 0 / 14 / 0 | `86qn`: 286 UNPORTED->MATCH | `kv-borrowck-ui` identical |

- No MATCH was lost, and there is no new DIFF, CRASH or TIMEOUT.
- Every case that is not MATCH has the same status in the `kv-*` runs (integ-w25 runs).
- The remaining stops:
  - mir-minicore: `UnreachablePropagation (pass not ported)` ×4 and `QueryKey for ty::Value` ×2;
  - borrowck-ui: polonius ×12, `UnreachablePropagation` ×1, `NonGenericOpaqueTypeParam` diagnostic ×1.

## Tests
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (22347; vendor 4351).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform src/rustc_session`: **150 pass, 0 fail**. This includes the
  new alias_check.test.ts (7 tests); the first run failed only the layout test, before the directory rename.
- Coverage: check_alignment 3/3, check_null 3/3, check_pointers 6/6, check_enums 10/10, shim 38/38, promote_consts 27/27,
  remove_storage_markers 2/2, copy_prop 7/7, session.rs 80/104 (+1: `emit_lifetime_markers`).
- No pinned test moved, and the full unit suite was not run (root runs it).

## `unported(...)` left / new runtime stops
None added, none removed. No stop moved.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (fix-ubchecks-alias) The UB-check passes (check_alignment/check_null/check_pointers/check_enums), `build_adt_ctor`,
   `CloneShimBuilder` and PromoteTemps follow the MIR aliasing rule. Each `Place` stored again after its first use is
   `clone_Place`, and each `SourceInfo` stored into a statement / terminator / local decl is `clone_SourceInfo`, where
   rustc copies.
2. (fix-ubchecks-alias) The MIR alias checker (`alias_check_oracle/alias_check.ts`, test-only) treats as bugs only
   shared `MIR_NODES` (Place, SourceInfo, Operand, Statement, Terminator, BasicBlockData, LocalDecl, ConstOperand,
   SourceScopeData). Shared immutable payloads are reported by `find_shared_objects` but are not failures.
3. (fix-ubchecks-alias) `Session::emit_lifetime_markers` is ported in session.ts; `SanitizerSet::intersects` is a
   nonzero `&` of the bit sets.

## For root / other lanes
1. **Harmless sharing still present (not fixed: other lanes' files, nothing edits these values in place).** The checker
   sees:
   - mir_build: a `BlockTailInfo` shared by several block-tail temps' `LocalInfo` (`builder/expr/as_temp.ts:69`), the
     canonical `user_ty` shared by two `user_type_annotations`, and a `ByRef::Yes` binding mode;
   - coroutine: the `CoroutineKind` of `ResumedAfter*` assert messages shared with `body.coroutine.coroutine_kind`, and
     the `InstanceKind` shared between a coroutine body's `source` and its `coroutine_drop_proxy_async` body;
   - the unit variant `LocalInfo::Boring` is not a frozen singleton;
   - inline.ts: the callee `Instance` in `SourceScopeData::inlined`, when the same callee is inlined twice.
   - If one of these ever becomes edited in place, clone it at the source.
2. **mt-opt2**: when the opt2 passes land, the alias test bodies will run past `UnreachablePropagation` into GVN /
   SimplifyLocals etc. Keep `alias_check.test.ts` green: a share that a pass creates fails it at that pass.
3. The scratch driver keeps mt-opt1's stand-ins (`CWRAP_NOOP_INLINE`, `CWRAP_OPT2_OFF`). mt-inline is merged, so
   `CWRAP_NOOP_INLINE=0` works now (used above).

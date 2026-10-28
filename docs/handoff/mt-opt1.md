# Handoff: mt-opt1 (wave 25, MIR optimizations at -Zmir-opt-level=1)

Branch `lane/mt-opt1` (base `7f2d6592` on main, no merges). Commits: `3136dd1a` instsimplify (first, as asked), `d4c337a8` the
nine small passes, `4ac38d75` ssa / copy_prop / single_use_consts, then this handoff.

## Files touched
All in `src/rustc_mir_transform/`. Every one replaces an mt-opt1 stub and keeps the stub's names and shapes.
- `instsimplify.ts`: `InstSimplify` (both variants), `InstSimplifyContext`, `SimplifyUbCheck`, `intrinsic_assert_panics`,
  `resolve_rust_intrinsic`.
- `lower_slice_len.ts`, `remove_storage_markers.ts`, `remove_zsts.ts`, `remove_unneeded_drops.ts`,
  `multiple_return_terminators.ts`, `simplify_branches.ts`, `strip_debuginfo.ts` (also `drop_invalid_debuginfos`),
  `prettify.ts` (`ReorderBasicBlocks`, `ReorderLocals`), `unreachable_enum_branching.ts`, `single_use_consts.ts`,
  `copy_prop.ts`.
- **new** `ssa.ts`: `SsaLocals`, `SsaVisitor`, `compute_copy_classes`, `StorageLiveLocals`, `MaybeUninitializedLocals`.
  It is exported for the mt-opt2 passes (gvn, ref_prop, ssa_range_prop, simplify_comparison_integral, dest_prop, ...).
- `pass_manager.test.ts`: the stub-module count is now 19 (was 31; 12 stub files became ports, and ssa.ts is new, not a
  stub).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_mir_transform/src/<f>.rs`)
instsimplify 19/19, lower_slice_len 3/3, remove_storage_markers 2/2, remove_zsts 9/9, remove_unneeded_drops 2/2,
multiple_return_terminators 2/2, simplify_branches 4/4, strip_debuginfo 3/3, prettify 11/11,
unreachable_enum_branching 5/5, single_use_consts 11/11, copy_prop 7/7, ssa 20/20.
`bun scripts/coverage.ts --check`: markers ok (22195; vendor 4330). `bunx tsc --noEmit -p .`: clean.

## Tests
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`: **70 pass, 0 fail**.
- No test pinned any of the 12 stubs' stops (the only "pass not ported" text in a test fixture is `simplify_oracle/pass_names.txt`,
  which is rustc's list of pass names).

## Oracle verification (`-Zdump-mir`, scratch, not committed)
Script: `$RUST_TS_DATA/scratch/mt-opt1/{cwrap.ts,cmp.sh,first.sh,batch.sh,cmpruns.py,c2..c7.rs,uimir.list}`. It is
fix-w24-mir's driver, repointed at this worktree, with these changes:
- `CWRAP_OPT=1` (cmp.sh's default) also builds the bodies `--emit=mir` renders (`write_mir_pretty`): `optimized_mir`
  (+ `mir_for_ctfe` for const fns), or `instance_mir(Item)`, for every `mir_keys` entry that is not a trivial const. So
  the whole `run_optimization_passes` list runs, and every pass in it writes its dumps.
- cmp.sh / first.sh now compare phase `1-*` dumps too, so `mir_shims` dumps are compared.
- **Test-only stand-ins for other lanes' stubs**, in the driver only:
  - `ForceInline` (mt-inline) is a no-op with its real policy (`Required`). This is exact when no callee is
    `#[rustc_force_inline]`.
  - `Inline` gets its real policy at mir-opt-level <= 1 without `-Zinline-mir` (disabled).
  - The 13 mt-opt2 passes get their real policy at mir-opt-level <= 1 (all disabled).
  - Each stand-in throws if asked for a configuration it does not emulate.
- All runs use `--target x86_64-unknown-linux-gnu`. The aarch64 host stops at `compute_rust_abi_info (lane fn-abi:
  x86_64 only)` as soon as CTFE calls a fn.
- macOS's file system is case-insensitive: dump names that differ only in case collide (`c1.F` / `c1.f`). c1.rs is
  therefore not used; the other inputs avoid such names.

Results ("equal" means byte-identical after the allocN normalisation; the raw differences are alloc ids only):

| input | flags | dumps compared | equal |
|---|---|---|---|
| c7.rs (new, 45 fns aimed at these passes) | default (mir-opt-level 1) | 3117 | 3117 |
| c7.rs | `-Zmir-opt-level=1` | 3305 | 3305 |
| c7.rs | `-Zmir-opt-level=0` | 2153 | 2153 |
| c7.rs | `-Zmir-strip-debuginfo=all-locals` / `=locals-in-tiny-functions` | 3373 / 3373 | all |
| c7.rs | `-Zmir-enable-passes=+ReorderBasicBlocks,+ReorderLocals,+MultipleReturnTerminators` | 3577 | 3577 |
| c7.rs | `-Cpanic=abort` / `-Zub-checks=no` | 3165 / 3095 | all |
| c7.rs, c2.rs, c3.rs | `-Copt-level=1 -Zmir-opt-level=1 -Zub-checks=no` (lifetime markers on: CopyProp's `StorageChecker` + `MaybeUninitializedLocals` path, RemoveStorageMarkers off) | 3027 / 1831 / 2449 | all |
| c2.rs / c3.rs | `-Zub-checks=no` | 1869 / 2503 | all |
| c2.rs / c3.rs | default | 1983 / 2661 | 1979 / 2661 (see the aliasing bug below) |
| c5.rs / c6.rs | default | 1130 / 951 | all |
| c5.rs + `CWRAP_SHIMS=1` | drop-glue shims through `InstSimplify-before-inline` (then `ForceInline.before`) | 55 shim dumps | 55, raw |
| mini_core.rs | the mirdump-minicore argv | 6675 | 6675 (87 bodies through all passes) |
| tests/ui/mir, 53 run/build/check-pass single-file tests | default, and `-Zub-checks=no` | see below | see below |

Every pass changed real bodies in these runs. In c7.rs, InstSimplify-before-inline changed 17 of 32 bodies,
InstSimplify-after-simplifycfg 1, LowerSliceLenCalls 1, RemoveZsts 4, UnreachableEnumBranching 2,
SimplifyConstCondition-after-inst-simplify 2, SingleUseConsts 1, CopyProp 19 and RemoveStorageMarkers 25.
StripDebugInfo changed 7 bodies with all-locals and 3 with locals-in-tiny-functions. ReorderBasicBlocks changed 4,
ReorderLocals 1 and MultipleReturnTerminators 5. RemoveUnneededDrops changed nothing on these inputs: it only acts when
PostAnalysis typing reveals a type, i.e. opaque types, and an RPIT input crashes the driver earlier (below).

**tests/ui/mir batch** (`batch.sh` over `uimir.list`: the 53 single-file run/build/check-pass tests without aux files,
compile flags or revisions; default flags):
- 49 files: every compared dump equal (normalised). That is 29254 of 29254 dumps, and 318 bodies ran all the
  optimization passes.
- `mir_assign_eval_order` and `mir_early_return_scope`: the only diffs are the check_alignment / check_null aliasing bug
  below. The first diff is at `SimplifyLocals-before-const-prop.after`, and `mir_early_return_scope.main` hits the
  simplify.ts `visit_local` unwrap ICE. With `-Zub-checks=no`, both are fully equal (1158 / 439 dumps).
- `mir_fat_ptr_drop`: the subject stops at `Decodable for mir::Body` while printing a static's allocation in a
  `built` dump. That is pre-existing and not in an optimization pass.
- `issue-75419-validation-impl-trait`: the RPIT driver ICE described below (before any pass).

Stops the driver hit, all other lanes' code reached from correct code:
- `QueryKey for (ValidityRequirement, ty::PseudoCanonicalInput<Ty>)` (rustc_middle query keys). It is reached from
  InstSimplify's `simplify_intrinsic_assert` → `tcx.check_validity_requirement` on `assert_inhabited` /
  `assert_zero_valid` / `assert_mem_uninitialized_valid` calls.
- The known `Decodable for mir::Body` and `QueryKey for ty::Value` (KPL) stops, and the `FatalErrorMarker` that
  poisons the bodies after them.
- An RPIT (`fn f() -> impl Sized`) makes the driver ICE at `find_opaque_ty_constraints_for_rpit`'s
  `assert!(!tcx.next_trait_solver_globally())`. This happens before any optimization pass, and the cause is probably the
  driver's faked `mir_borrowck`. It is not investigated.

## Bug found in another lane's files (not fixed: not mine) — **check_alignment.ts / check_null.ts reuse `Place` objects**
- `insert_alignment_check` (check_alignment.ts) and `insert_null_check` (check_null.ts), lane mt-kpl-ubchecks, use one
  `Place` object both as an assignment's LHS and inside later operands. Examples: `thin_ptr`, `addr`,
  `alignment_mask`, `alignment_bits`, `is_null`, ....
- In Rust `Place` is `Copy`. In the port it must be `clone_Place(..)` at each extra use (PORTING §8).
- Up to now no later pass renamed locals in place, so the sharing could not be seen. With this lane, `optimized_mir` at
  the default opt level reaches `SimplifyLocals-final` (simplify.ts). Its `LocalUpdater` visits a shared Place twice and
  maps its local twice.
- Seen on c2.rs `bx2`: wrong MIR from `SimplifyLocals-final.after` on, i.e. `_11 = copy _10 as *const ()` /
  `_11 = copy _11 as usize`.
- Seen on c3.rs `i10` (`read_via_copy` of a raw pointer): an ICE, `called Option::unwrap() on a None value` at
  simplify.ts `visit_local`.
- With `-Zub-checks=no` (no check passes) every body matches.
- Where it bites: debug builds, where ub_checks are on, in any fn that dereferences a raw pointer or reference that
  CheckAlignment / CheckNull instrument. CheckEnums / check_pointers.ts may have the same pattern; I did not check
  them.
- **Fix (owner: mt-kpl-ubchecks or root)**: `clone_Place` the reused places in check_alignment.ts / check_null.ts (and
  check `check_pointers.ts` / `check_enums.ts`).

## New runtime stops (what the 12 stubs' stops became)
- `optimized_mir` on bodies: the old stop `LowerSliceLenCalls (pass not ported)` becomes `inline::ForceInline (pass not
  ported)` (mt-inline).
  - With mt-inline's two passes stood in (scratch only), `optimized_mir` runs to completion at mir-opt-level <= 1, apart
    from the mt-opt2 passes' policies. Those are stubs, so the real tree stops at the first mt-opt2 pass:
    `unreachable_prop::UnreachablePropagation (pass not ported)`.
- `tcx.mir_shims(..)` (drop glue): the old stop `InstSimplify (pass not ported)` becomes `inline::ForceInline (pass not
  ported)`.
- InstSimplify on intrinsic asserts: `QueryKey for (ValidityRequirement, ty::PseudoCanonicalInput<Ty>)`, as above.
- Sampled difftests: see below. The new borrowck-ui stops are `inline::cycle::mir_inliner_callees` (20 cases) and
  `inline::ForceInline` (1 case), both mt-inline. Those cases run with `-O` (mir-opt-level 2).

## Samples (`RUST_TS_AGENT=root-f5de`, lane at `4ac38d75`)
| suite | lane run | M / D / U / UNSTABLE | old base run | M / D / U / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261028-024131-root-f5de-zkj6` | 46 / 0 / 0 / 0 | `wos5` | 45 / 0 / 1 / 0 |
| mirdump-minicore (46) | `20261028-024151-root-f5de-7vqp` | 45 / 0 / 1 / 0 | `p8q4` | 45 / 0 / 1 / 0 |
| tydump-ui `--sample 300` | `20261028-024213-root-f5de-z7oh` | 294 / 0 / 4 / 2 | `zjq3` | 261 / 0 / 37 / 2 |
| mirdump-ui `--sample 300` | `20261028-024415-root-f5de-sq2b` | 296 / 0 / 4 / 0 | `mzgb` | 269 / 0 / 31 / 0 |
| borrowck-ui `--sample 300` | `20261028-024601-root-f5de-0hpg` | 261 / 0 / 39 / 0 | `86qn` | 0 / 0 / 300 / 0 |

- 0 DIFF, 0 CRASH, 0 TIMEOUT. No MATCH became anything else (`cmpruns.py`, case by case).
- The figures match what the w26 brief gives for the base (borrowck-ui ~259, tydump-ui ~294, mirdump-ui ~296). The
  gains over the old base runs come from the base, not from this lane.

**Base check of every case that is not MATCH for me**:
- I put this worktree's `src/rustc_mir_transform` back to `7f2d6592` for the run and restored it afterwards.
- Then I ran each of the 48 UNPORTED cases with `--filter <id>` (run ids `mt-opt1-base-1..50`). The 2 UNSTABLE
  cases were skipped.
- All 48 are UNPORTED at base too. So no case moved away from MATCH and none became DIFF/CRASH. The log is
  `$RUST_TS_DATA/tmp/mt-opt1-base.log`.

## Full unit suite
`RUST_TS_REQUIRE_PROBES=1 bun test src` (run once, detached): **6197 pass, 1 skip, 2 fail** out of 6200.
- The 2 failures are 5 s timeouts: `late_passes_e1.oracle.test.ts` (deref_into_dyn_supertrait) and
  `vendor/odht/odht.oracle.test.ts` ("build: insert results ...").
- Both files are outside this lane, and the machine's load average was about 140.
- Re-run alone with `--timeout 120000`, both files pass: 32 pass, 0 fail.

## `unported(...)` left
None in the 14 lane files.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-opt1) remove_storage_markers.ts holds a module-local, exported stand-in for `Session::emit_lifetime_markers`
   (session.rs:883), with the upstream body and no marker. session.ts (not this lane's file) has not ported it.
   copy_prop.ts imports it from there.
   **Root: port it into session.ts as `Session.prototype.emit_lifetime_markers` and repoint both callers.**
2. (mt-opt1) instsimplify: the `&mut Rvalue` of an `Assign` is a `MutRef` onto the statement tuple's slot
   (`field_mut(kind._0, 1)`); `*kind = CastKind::IntToInt` writes the `Cast` rvalue's field.
   `field == Ok(first_val)` (derived `PartialEq` of `ConstValue`) is `intern_key_eq`.
3. (mt-opt1) MIR visitors in these passes (`SimplifyUbCheck`, remove_zsts' `Replacer`, prettify's
   `BasicBlockUpdater` / `LocalFinder` / `LocalUpdater`, single_use_consts' `SingleUseConstsFinder` / `LocalReplacer`,
   `SsaVisitor`, copy_prop's `Replacer` / `StorageChecker`) extend mir/visit.ts's `Visitor` / `MutVisitor`, with
   field `tcx_`. `*operand = ..` is `replace_in_place`.
4. (mt-opt1) The derived `PartialEq` of `mir::Place` / `Location` / `DefLocation` are file-local helpers
   (`place_eq`, `Location_eq`, `DefLocation_eq`), following liveness.ts / borrow_set.ts. `Place` compares `local` and
   the interned `projection` list by identity.
5. (mt-opt1) ssa: `SsaLocals::assignments(body)` returns an array instead of a lazy iterator. Its only caller here,
   `compute_copy_classes`, consumes it at once, and the iteration does not mutate `assignments`.
   `Set1::insert(&mut slot, ..)` takes `field_mut(vec, local)`. `#[cfg(debug_assertions)]` blocks are comments.
   `debug_StorageLiveLocals` is the derived Debug.
6. (mt-opt1) simplify_branches: the fn-local `try_get_const` stays a nested fn inside `run_pass`.
   `pre_place_const.take()` in the terminator's match guards reads the value without clearing it; it is not read
   afterwards, and the two guarded arms are exclusive.
7. (mt-opt1) unreachable_enum_branching: `FxHashSet<u128>` is a `Set<bigint>`; `.iter().next()` is only taken on a
   one-element set. strip_debuginfo / prettify: `Vec::retain` and `*data = ..` refill the same array.

## For root / other lanes
1. **mt-kpl-ubchecks / root**: the `clone_Place` fix in check_alignment.ts / check_null.ts (above). It is a real
   miscompile/ICE in `optimized_mir` at the default opt level, now that the opt pipeline runs past InstSimplify.
2. **root**: move the `emit_lifetime_markers` stand-in into session.ts (decision 1).
3. **root**: lib.ts:152 still says `// mod ssa; (not referenced here: lane mt-opt1 adds ssa.ts)`. ssa.ts now exists; it
   is not imported by lib.ts and is not needed there.
4. **mt-opt2**: `SsaLocals`, `StorageLiveLocals` and `MaybeUninitializedLocals` are in ssa.ts. CopyProp's use of them is
   oracle-checked: c7/c2/c3 with lifetime markers on, and everything above.
5. **mt-inline**: with ForceInline/Inline ported, re-run `$RUST_TS_DATA/scratch/mt-opt1/cmp.sh <file> <out> --target
   x86_64-unknown-linux-gnu` with `CWRAP_NOOP_INLINE=0` to drop this lane's stand-ins.
6. The scratch driver's stand-ins must go once those lanes land (`CWRAP_NOOP_INLINE=0`, `CWRAP_OPT2_OFF=0`).

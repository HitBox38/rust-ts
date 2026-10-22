# Handoff: mt-validate (M4 wave 23: the MIR `Validator`)

Branch `lane/mt-validate` (from `f5de3f15`, no merges). Commits: the port + tests (`29e6f40d`), then this handoff.

## Result
- **`src/rustc_mir_transform/validate.ts`**: compiler/rustc_mir_transform/src/validate.rs ported whole, replacing the stub
  (25/25 fns, upstream order, markers): `Validator` (`run_pass`, `policy`), `EdgeKind`, `CfgChecker` (`fail`,
  `check_edge`, `check_cleanup_control_flow`, `check_unwind_edge`, `is_critical_call_edge`, visitor `visit_local` /
  `visit_statement` / `visit_terminator` / `visit_source_scope`), `validate_types` (exported, for the inliner),
  `TypeChecker` (`fail`, `mir_assign_valid_types`, `predicate_must_hold_modulo_regions`, `visit_operand`,
  `visit_projection_elem`, `visit_var_debug_info`, `visit_place`, `visit_rvalue`, `visit_statement`,
  `visit_terminator`, `visit_local_decl`), `validate_debuginfos` (exported), `DebuginfoChecker`.
- **Ported ahead of ctfe-util (wave 23b)**, new files in rustc_const_eval (precedent: mt-built-lints' util/alignment.ts):
  - `src/rustc_const_eval/util/compare_types.ts`: compare_types.rs whole (2/2: `sub_types`, `relate_types`).
  - `src/rustc_const_eval/util/mod.ts`: util/mod.rs partial (3/4: `binop_left_homogeneous`, `binop_right_homogeneous`,
    `unop_homogeneous`) plus the re-exports of alignment.ts / compare_types.ts. **Left for ctfe-util**: `context_spans`
    (mod.rs:56) and the modules `caller_location`, `check_validity_requirement`, `type_name` with their re-exports.
- `pass_manager.test.ts` module-layout stub count 57 → 56 (as the mt-skeleton contract asks).
- Coverage: validate.rs 25/25, compare_types.rs 2/2, util/mod.rs 3/4; rustc_mir_transform 260/1101, rustc_const_eval
  118/764; TOTAL 19608/25518. `bun scripts/coverage.ts --check`: markers ok.
- lint.rs (plan-m4 groups it with this lane) was not in this assignment: its stub stays (see "For root").

## How the `Validator` stops moved
- mirdump-ui `--sample 300` (as `root-f5de`): base `20261022-175248-root-f5de-c6id` had 4
  `rustc_mir_transform::validate::Validator (pass not ported)` stops; now 0. All 4 went UNPORTED → MATCH
  (`mir/mir-inlining/ice-issue-100550-unnormalized-projection.rs`, `mir/static-by-value-str.rs`,
  `nll/polonius/nll-problem-case-3-issue-68934.rs#legacy`, `pattern/usefulness/tuple-struct-nonexhaustive.rs`).
- tests/ui/mir/validate (filter run `20261022-180901-mt-validate-ro81`): the 5 Validator stops are gone:
  `project-into-simd.rs` UNPORTED → MATCH; `error-body`, `ice-zst-as-discr-145786`,
  `issue-95978-validator-lifetime-comparison`, `validate-unsize-cast` now stop later at
  `try_destructure_mir_constant_for_user_output` (printer, wave 23b). `call-move-arg.rs` (UNSTABLE by design) now ICEs on
  both sides with the same broken-MIR message.
- No `Validator` stop is left anywhere I ran.

## Samples (lane at `29e6f40d`, `RUST_TS_AGENT=root-f5de`, compared case by case with root's base runs)
| suite | lane run | M / D / U | base run | M / D / U | changes |
|---|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-190353-root-f5de-ainc` | 17 / 0 / 29 | `bbue` | 17 / 0 / 29 | none |
| tydump-minicore (46) | `20261022-190402-root-f5de-1bs6` | 45 / 0 / 1 | `8kp6` | 45 / 0 / 1 | none |
| mirdump-ui `--sample 300` | `20261022-190410-root-f5de-u3p6` | 21 / 0 / 279 | `c6id` | 17 / 0 / 283 | 4 UNPORTED → MATCH |

**0 DIFF, 0 CRASH.** mirdump-ui top stops now: 246 `try_destructure_mir_constant_for_user_output`, 16 `mir_borrowck`,
14 `eval_to_valtree`, 2 `eval_to_const_value_raw_provider`, 1 `eval_static_initializer_provider`.

## Validator acceptance check (`-Zvalidate-mir`, scratch, not committed)
`$RUST_TS_DATA/scratch/mt-validate/{vcheck.ts,vwrap.ts}`: runs the oracle probe and the real `src/rust_ts/mirdump.ts`
with an extra `-Zvalidate-mir` (validation after every pass of `mir_built` / `mir_promoted` and at every phase change),
counts the port's `Validator::run_pass` calls, and compares "broken MIR" ICEs (message text after the panic location).
This replaces merge-w22b's 1061-body set (that driver is gone) with a larger one:
| case set | cases | bodies validated by the port | result |
|---|---|---|---|
| mirdump-minicore | 46 | 2097 | 0 flagged |
| mirdump-ui sample 300 (root-f5de) | 300 | 13559 | 0 flagged (1 by-design ICE, same message) |
| all mirdump-ui tests/ui/mir cases | 212 | 5680 | 5 by-design ICEs with identical messages; 3 flagged = tests/ui/mir/lint/{no-storage,storage-live,storage-return} (`-Zlint-mir`: lint.rs is still a stub, UNPORTED) |

So: no body the oracle accepts is rejected, and every rejection message matched. The check found one bug, fixed before
the commit: `check_edge`'s message prints `{:?}` of the **`BasicBlockData`** (upstream shadows `bb`), not the block id.

## Tests
- `src/rustc_mir_transform/validate.oracle.test.ts` (11 tests, probe-gated like promote_consts.test.ts):
  - `validate_oracle/ctors.rs` (unit/tuple/generic/const-generic/lifetime structs, enum variants, a union, small fns,
    a ctor as fn pointer) through mirdump on both sides, with and without `-Zvalidate-mir`: stdout, stderr and exit
    code byte-identical; checks the ctor bodies are printed.
  - Invalid MIR under `-Zvalidate-mir --crate-type=lib`: `validate_oracle/invalid/{cast_kind, field_type,
    resume_noncleanup, switch_dup}.rs` (CfgChecker / TypeChecker / `check_kinds!` / the multi-line `Assign` message)
    and tests/ui/mir/validate/{call-move-arg, noncleanup-cleanup, noncleanup-resume, noncleanup-terminate,
    project-into-simd}.rs: both exit 101, and the port's ICE message equals the oracle's (location prefix removed,
    continuation lines de-indented).
- Full `RUST_TS_AGENT=mt-validate RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `29e6f40d` (detached):
  **6069 pass, 1 skip (the existing one), 0 fail** (6070 tests, 430 files, 2357 s). Log:
  `$RUST_TS_DATA/scratch/mt-validate/fulltest.log`.
- `bunx tsc --noEmit -p .`: clean.

## `unported(...)` left
None in validate.ts, compare_types.ts, util/mod.ts.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-validate) rustc_const_eval util/compare_types.rs (whole) and util/mod.rs's three operator classifiers are ported ahead of ctfe-util; util/mod.ts re-exports alignment.ts and compare_types.ts and leaves `context_spans` and the caller_location / check_validity_requirement / type_name modules to ctfe-util, which completes the file.
2. (mt-validate) validate.rs: `CfgChecker` / `TypeChecker` / `DebuginfoChecker` are classes extending mir/visit.ts's `Visitor`; `MirPhase` `PartialOrd` comparisons use `MirPhase_cmp`; `EdgeKind` is a string union whose derived Debug is the variant name; `FxHashSet<u128>` is `Set<bigint>`; `targets.iter().len()` is `size_hint()[0]`.
3. (mt-validate) `TypeChecker::predicate_must_hold_modulo_regions(pred: impl Upcast<..>)` takes the value and its upcast fn; `macro_rules! check_kinds` is a local closure taking the message as a function of `{:?}` of the type and the pattern as a predicate; `(src, dest).has_opaque_types()` uses `fold_tuple2(fold_Ty, fold_Ty)`.
4. (mt-validate) Faithful quirks kept: `check_edge` prints `{:?}` of the target `BasicBlockData` (upstream shadows `bb`); the cleanup-cycle loop `take()`s the same `parent[bb]` slot on every iteration (shadowing scope); `"backwards subslice {from}..{to}"` is a literal (no `format!`).
5. (mt-validate) `bug!("unhandled type: {:?}", switch_ty.kind())` prints `debug_Ty(switch_ty)` (`impl Debug for Ty` prints the kind, under `with_no_trimmed_paths!` here).

## For root
- **lint.rs** (`-Zlint-mir`, `lint_body`) is still the mt-skeleton stub: tests/ui/mir/lint/{no-storage,storage-live,
  storage-return} stop there (all UNSTABLE in mirdump-ui anyway). plan-m4 paired it with validate.rs; assign it.
- The port's ICE report is `rust-ts: internal compiler error: <message>` (no `#[track_caller]` location, no span
  snippet). The broken-MIR message itself is byte-identical to the oracle's; full ICE reports stay non-comparable
  (thread id, backtrace), as recorded for the M4a UNSTABLE cases.
- ctfe-util: complete `src/rustc_const_eval/util/mod.ts` (see "Result").

## Files touched
- `src/rustc_mir_transform/validate.ts` (stub replaced), `validate.oracle.test.ts`, `validate_oracle/` (fixtures),
  `pass_manager.test.ts` (stub count only).
- New: `src/rustc_const_eval/util/compare_types.ts`, `src/rustc_const_eval/util/mod.ts`.
- No harness/, scripts/ or tools/ edits.

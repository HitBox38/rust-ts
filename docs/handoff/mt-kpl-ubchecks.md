# Handoff: mt-kpl-ubchecks (M4 wave 24): known_panics_lint + the UB-check passes

Branch `lane/mt-kpl-ubchecks` (from `de448071` on integ-w19, no merges). Commits: `cc53fad2` the port + oracle test,
then this handoff.

## Result
All four stub modules are replaced with the whole port, and `check_pointers.rs` has a new module (mt-skeleton layout;
lib.ts untouched):
| upstream (`compiler/rustc_mir_transform/src/`) | fns | notes |
|---|---|---|
| known_panics_lint.rs | 37/37 | `KnownPanicsLint` (`MirLint`), `Value`, `ConstPropagator` (a `Visitor` over `InterpCx<DummyMachine>`), `DbgVal`, `ConstPropMode`, `CanConstProp` |
| check_pointers.rs | 6/6 | new file: `PointerCheck`, `BorrowedFieldProjectionMode`, `check_pointers`, `PointerFinder`, `split_block` |
| check_alignment.rs | 3/3 | |
| check_null.rs | 3/3 | |
| check_enums.rs | 10/10 | |

- Coverage (`bun scripts/coverage.ts --missing <file>`): complete for all five files. rustc_mir_transform 348/1101,
  TOTAL 20777/25518. `--check`: markers ok (21356; vendor 4330).
- `src/rustc_mir_transform/pass_manager.test.ts`: stub-module count 54 → 50 (delta -4).
- `unported(...)` left in this lane's files: **none**.

## Verification (new `src/rustc_mir_transform/known_panics_lint.oracle.test.ts`, 3 tests, all pass with `RUST_TS_REQUIRE_PROBES=1`)
No suite reaches this code yet: `KnownPanicsLint` runs in `mir_drops_elaborated_and_const_checked` (after `mir_borrowck`
and drop elaboration; at the base every borrowck-ui case stops in borrowck), and the UB checks run in
`run_optimization_passes`. So the test has its own driver, `known_panics_lint_oracle/run.ts`: the mirdump probe's
`MIR_borrow_checking` loop (no `mir_borrowck`), and where rustc calls `mir_drops_elaborated_and_const_checked`
(`should_codegen()` or a const context) it runs the lint on the `mir_promoted` body. The oracle compiles with
`--emit=obj` (the lint only runs when codegen is requested).
- `cases/arith.rs` (shifts with and without a constant LHS, add/sub/mul overflow, `Neg`, div/rem by zero, `MIN / -1`,
  `SwitchInt` pruning, `#[allow]` lint roots, int casts, tuples (`Aggregate` + field projection), multiple assignments
  (`OnlyInsideOwnBlock`), borrowed locals (`NoPropagation`), closures): **stderr and exit code byte-identical** to rustc
  (18 errors, 1 liveness warning interleaved in rustc's order).
- `cases/ub_checks.rs` (driver mode `KPL_ORACLE_UB_PASSES=1`): `CheckAlignment`, `CheckNull`, `CheckEnums` are run on
  the `mir_promoted` body of 10 fns (raw-pointer reads/writes, excluded `u8` pointee, `&(*p).1` field borrows
  (`FollowProjections`), `&mut *p` (`NullReferenceConstructed`), ZST pointee, and runtime-dialect custom MIR
  `CastTransmute` into a direct-tag enum, `Option<bool>` (niche), an enum wider than its tag (the `[MaybeUninit<u8>; N]`
  subslice path) and an uninhabited enum). All 40 printed bodies (`before` + after each pass) equal rustc's
  `-Zdump-mir` files byte-for-byte (the `before` texts check the premise that no runtime lowering pass changed them).
- `cases/bounds.rs`: **pinned stop** (see below); the oracle side checks rustc's "index out of bounds" text.
- tests/ui tried with the same driver (not in the test): `lint/lint-type-overflow3.rs` and
  `const_prop/ice-assert-fail-div-by-zero.rs` match up to the late lints the driver doesn't run (`overflowing_literals`,
  `unused_must_use`), i.e. every KPL diagnostic in them is identical. `mir/mir_detects_invalid_ops.rs`,
  `numbers-arithmetic/overflowing-{lsh,rsh}-4.rs`, `lint/const-n-is-zero.rs` stop in rustc_borrowck
  (`UniverseInfo::relate`): evaluating a promoted constant runs CTFE, which runs `mir_borrowck` (as upstream).
  `lint/unconditional_panic_98444.rs` stops at the `ty::Value` key (below).

## Runtime stops reached through this lane's code (other owners)
1. **`rustc_middle::query::keys: QueryKey for \`ty::Value<'tcx>\` (cache)`**: every array bounds check. The array
   length is a `Const::Ty` value; `eval_mir_constant` runs `valtree_to_const_val`, whose key is `key_unported` in
   queries.gen.ts (rustc_middle / tools codegen, root). Pinned by `bounds.rs` (`STOP_VALTREE_KEY`); when it moves, make
   `bounds.rs` an ordinary oracle case.
2. rustc_borrowck (bck lanes): promoted constants evaluated by the lint (CTFE → `mir_borrowck`).
3. rustc_metadata `Decodable for mir::Body` (seen through `layout_of` of a pattern type such as `NonZero<u32>`, whose
   range end is a CTFE'd extern const): reached from `CanConstProp::check` / `EnumFinder` layouts.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, at `cc53fad2`, compared case by case with the base runs)
| suite | this lane (M / D / U) | base (M / D / U) |
|---|---|---|
| tydump-minicore | `kpl-tydump-minicore-012811`: 46 / 0 / 0 | `20261022-210451-root-f5de-wos5`: 45 / 0 / 1 |
| mirdump-minicore | `kpl-mirdump-minicore-013316`: 45 / 0 / 1 | `20261022-210534-root-f5de-p8q4`: 45 / 0 / 1 |
| tydump-ui `--sample 300` | `kpl-tydump-ui-013729`: 262 / 0 / 36 (+2 UNSTABLE) | `20261022-210624-root-f5de-zjq3`: 261 / 0 / 37 (+2 UNSTABLE) |
| mirdump-ui `--sample 300` | `kpl-mirdump-ui-015855`: 273 / 0 / 27 | `20261022-211125-root-f5de-mzgb`: 269 / 0 / 31 |
| borrowck-ui `--sample 300` | `kpl-borrowck-ui-020930`: 0 / 0 / 300 | `20261022-211729-root-f5de-86qn`: 0 / 0 / 300 |

**No MATCH lost, 0 DIFF, 0 CRASH.** The host ran at load average 200-530 (about 10 lanes), so the first pass had 180
TIMEOUTs (19 / 8 / 124 / 23 / 6). Each was re-run alone (`--filter <id> --jobs 1`, run ids `kplre-*`): all finished,
none DIFF / CRASH / TIMEOUT, every base MATCH still MATCH. The table counts those re-runs. The 6 UNPORTED → MATCH moves
(1 tydump-minicore, 1 tydump-ui, 4 mirdump-ui) come from the base runs being older than `de448071`, not from this lane:
no suite reaches this lane's code (see Verification). Comparison scripts: `$RUST_TS_DATA/tmp/kpl/{cmp.py,rerun.log}`.

## `// PORT:` decisions
- All files: `IndexVec<BasicBlock|Local, _>` are arrays; `IndexVec::push` is rustc_index's `IndexVec.push`.
  `local_decls.push(LocalDecl::with_source_info(ty, si)).into()` is a local helper `push_local_place` in
  check_alignment / check_null / check_enums (not an upstream fn). `basic_blocks.indices().rev()` is evaluated once,
  before any insertion (as the Rust range). `terminator.take()` + `statements.split_off(i)` are an assignment of
  `undefined` and `splice(i)`.
- check_pointers.ts: the `F: Fn(..) -> PointerCheck` bound is the exported type `OnFinding`.
- check_alignment.ts: `max_align < Align::MAX` compares `pow2` (derived `Ord`).
- check_enums.ts: `TyAndSize` (`derive(Debug, Copy, Clone)`) is an interface; its Debug is never used.
  `u128::wrapping_sub` is `BigInt.asUintN(128, a - b)`.
- known_panics_lint.ts:
  - `Option<()>` is `null` (Some) / `undefined` (None) (precedent rustc_session config.ts).
  - `&mut Value` (`project_mut`, `access_mut`) is a `MutRef<Value>` view onto the slot (`field_mut` on the array);
    `Value` objects are never shared between slots, so `SetDiscriminant` mutates `Aggregate.variant` in place.
  - `Value`'s derived Debug is not ported (only `trace!` and the skipped debug-assertions block read it).
  - The `LayoutOfHelpers` / `HasDataLayout` / `HasTyCtxt` / `HasTypingEnv` impls are plain methods (`tcx_()`,
    `typing_env_()`: the fields keep their names); `LayoutOf::layout_of` on `self` is only reached from the skipped
    `cfg!(debug_assertions)` block.
  - `report_assert_as_lint(.., assert_kind: AssertKind<impl Debug>)` takes the operand's Debug (`debug_P`), as
    `AssertLint_diagnostic` does. `DbgVal` is a module-level type; its `impl Debug` is `debug_DbgVal` (marker `:493 fmt`).
  - `expected != value_const` (`Scalar`'s derived `PartialEq`) is `intern_key_eq`.
  - `has_param()` of `ConstOperand` / `Rvalue` uses local `TypeVisitable` descriptors over the generated
    `visit_with_*`; `try_normalize_erasing_regions` of a `mir::Const` uses consts.ts's `fold_Const`.
  - `ensure_not_propagated`'s body and `visit_basic_block_data`'s trailing block are `cfg!(debug_assertions)`: skipped.
  - `use_ecx`'s `assert!` formats its message only on failure; `u64::try_into::<u32>()` is a range check.
  - `generics_of` is cast to `Generics` (query value `unknown` in queries.gen.ts). `MAX_ALLOC_LIMIT` is a `number`.

## For root / other lanes
- lib.ts line 140 still says `// mod check_pointers; (not referenced here: lane mt-kpl-ubchecks adds check_pointers.ts)`;
  the module now exists (lib.rs does not reference it from the pass lists, so nothing else changes).
- When `valtree_to_const_val`'s key is ported, update/replace the `bounds.rs` pin in known_panics_lint.oracle.test.ts.
- Once mt-drops / borrowck land, the lint is reached by real `analysis` (borrowck-ui) and the tests/ui cases above can
  join the oracle test.

## Files touched
- `src/rustc_mir_transform/{known_panics_lint,check_alignment,check_null,check_enums}.ts` (stubs replaced),
  `src/rustc_mir_transform/check_pointers.ts` (new), `src/rustc_mir_transform/pass_manager.test.ts` (count).
- New tests: `src/rustc_mir_transform/known_panics_lint.oracle.test.ts`,
  `src/rustc_mir_transform/known_panics_lint_oracle/{run.ts, cases/arith.rs, cases/bounds.rs, cases/ub_checks.rs}`.
- No harness/, scripts/, tools/ edits.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`: 65 pass, 0 fail (10 files). Full unit suite not run
  (root runs it at integration, per the coordinator).

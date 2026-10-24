# Handoff: ctfe-util (M4 wave 23c, CTFE fill lane)

Branch `lane/ctfe-util` (from `43e37d73`, no merges). Commits: the port + tests (`d5fb17aa`), a fix for std/result.test.ts's one-argument `unwrap_result` rule (`a47d97e1`), then
this handoff.

## Result
The `ctfe-util` row of docs/handoff/interp-contract.md's split table is done (22 stubs → 0), plus `-Zlint-mir`:
- `src/rustc_const_eval/util/mod.ts`: `context_spans` (mt-validate's three classifiers and re-exports kept). 4/4.
- `src/rustc_const_eval/util/check_validity_requirement.ts`: whole file (`check_validity_requirement`, `_strict`, `_lax`,
  `validate_scalar_in_layout`). 4/4.
- `src/rustc_const_eval/util/type_name.ts`: `TypeNamePrinter` (all 15 `Printer` / `PrettyPrinter` / `fmt::Write` methods)
  and `type_name`. 16/16.
- `src/rustc_const_eval/util/caller_location.ts`: `alloc_caller_location`. 2/2.
- `src/rustc_mir_transform/lint.ts`: lint.rs whole, replacing mt-skeleton's stub module (`lint_body`, `Lint` + `fail`,
  `places_conflict_for_assignment`, `visit_local` / `visit_statement` / `visit_terminator`). 6/6.
- compare_types.rs (mt-validate) untouched, 2/2.
- Coverage: rustc_const_eval 278 → 305/764, rustc_mir_transform 289/1101; TOTAL 19827/25518. `bun scripts/coverage.ts --check`:
  markers ok (20406; vendor 4330).
- `contract.test.ts`: markers 176 → 198, stubs 481 → 459, the `ctfe-util` row removed from the per-lane table (0 left).
  The runtime stop is unchanged (`eval_in_interpreter`, ctfe-a). `pass_manager.test.ts`: module-layout stub count 55 → 54.

## Tests
- **New `src/rustc_const_eval/util/type_name.oracle.test.ts`**: the oracle is the real `std::any::type_name`: the pinned
  rustc builds and runs a host binary from a fixture whose `main` prints `type_name::<T>()` / `type_name_of_val(&v)`; the
  port compiles the same file in-process (x86_64-unknown-linux-gnu, oracle sysroot) and calls `type_name` on the
  monomorphic, region-erased types (aliases normalized in `fully_monomorphized`, fn items, `g::<u8>`, the trait's `m`
  with `Self = u8`, closures and an async block via `type_of`). 39 cases, all equal: primitives, tuples, arrays, slices,
  refs / raw pointers, std ADTs (`HashMap`, `Rc<str>`, `io::Error`), `dyn` with auto traits / assoc bindings / HRTB,
  fn pointers (bound regions print `'_`, variadic `extern "C"`), const generics, a projection, `<u8 as m::Tr>::m`,
  `n::<impl Plain>::other` (`print_path_with_impl`), `<u8 as m::Tr>::mk2::{{closure}}`, `af::{{closure}}`.
- **New `src/rustc_mir_transform/lint.oracle.test.ts`** (mirdump probe vs src/rust_ts/mirdump.ts, as
  validate.oracle.test.ts): tests/ui/mir/lint/{no-storage, storage-live, storage-return} under `-Zlint-mir
  -Zeagerly-emit-delayed-bugs` give identical stdout / stderr / exit 1 with the `broken MIR in ..` error
  (`visit_local`, `StorageLive`, `Return` checks); assignment-overlap / call-overlap (build-fail: linted only after
  optimizations, not reached by the dump) identical, exit 0; lane mt-validate's `validate_oracle/ctors.rs` under
  `-Zlint-mir` identical (no false positive). 6 pass. (Without the eager flag the tests' own `-Ztreat-err-as-bug` ICE
  report reaches `std::panic::Location::caller (DiagLocation Display)`: the port prints everything before it
  identically, then stops UNPORTED.)
- **Lint acceptance check** (scratch, not committed: `$RUST_TS_DATA/scratch/ctfe-util/lcheck.ts`, oracle vs subject with
  an extra `-Zlint-mir -Zeagerly-emit-delayed-bugs` on each case's harness argv): mirdump-minicore 46 and mt-validate's
  mirdump-ui sample 300: 0 broken on either side, 0 flagged; all 212 tests/ui/mir mirdump-ui cases: 208 ok, 4 flagged =
  the 3 lint tests + validate/call-move-arg, whose own `-Ztreat-err-as-bug` makes both sides ICE: the `broken MIR`
  message is identical, only the ICE report differs (location / thread / backtrace, non-comparable by design).
- `check_validity_requirement` / `validate_scalar_in_layout` / `alloc_caller_location` are not reachable yet: they stop in
  other lanes' stubs (`allocate`, `write_bytes_ptr`, `validate_place`, `allocate_bytes_dedup`, `Immediate::new_slice`,
  `project_fields`, `write_immediate` / `write_scalar`, `intern_const_alloc_recursive`). No test of their own.
- Contract + pass_manager tests: 22 pass. `bunx tsc --noEmit -p .`: clean.
- Full `RUST_TS_AGENT=ctfe-util RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `a47d97e1` (detached, clean tree): **6108 pass, 1 skip (the existing one), 0 fail** (6109 tests, 437 files, 4145 s; an earlier run at `d5fb17aa` was aborted after std/result.test.ts flagged the one-argument `unwrap_result`, fixed in `a47d97e1`). Log: `$RUST_TS_DATA/scratch/ctfe-util/logs/fulltest.log`.

## Samples (lane at `d5fb17aa`, `RUST_TS_AGENT=root-f5de`, per case vs interp-contract's base runs)
| suite | lane run | M / D / U | base run | M / D / U | changes |
|---|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-202546-root-f5de-u4dz` | 45 / 0 / 1 | `z4n9` | 43 / 0 / 3 | 2 UNPORTED → MATCH |
| mirdump-ui `--sample 300` | `20261022-202605-root-f5de-eh2x` | 266 / 0 / 34 | `f9jh` | 222 / 0 / 78 | 44 UNPORTED → MATCH |

**0 DIFF, 0 CRASH, no MATCH lost.** The moves are the `validate::Validator` stops gone with mt-validate (in this lane's base
`43e37d73`, after interp-contract's runs); this lane's code is off the default path (`-Zlint-mir`, the intrinsics, the
`check_validity_requirement` query). Stops left: `mir_borrowck` 16, `eval_queries::eval_in_interpreter` 16 (ctfe-a),
`ConstValue::try_to_bits_for_ty (M4)` 3.

## `unported(...)` left
None in the five files.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (ctfe-util) `InterpResult<()>::discard_err().is_some()` is `InterpResult.disarm(r).$ === "Ok"` (check_validity_requirement.rs): `discard_err` returns `T | undefined`, which cannot tell `Some(())` from `None`.
2. (ctfe-util) type_name.ts imports rustc_middle ty/print/pretty.ts before ty/print/mod.ts (`PrettyPrinter`, `print_GenericArg` from pretty.ts): importing print/mod.ts first breaks the fresh-entry load (`Printer` TDZ). `write!(self.path, "::{}", data)` appends `display_DefPathData` to `path` directly; `p.print_type(ty).unwrap()` unwraps with a local `debug_PrintError` (`fmt::Error`'s derived Debug, `Error`; pretty.ts's twin is not exported).
3. (ctfe-util) lint.rs: `Lint` is a class extending mir/visit.ts's `Visitor`; `places: FxHashSet<PlaceRef>` is `KeyedSet<PlaceRef>(intern_key)`; `!set.insert(x)` is `has` then `add`; `dest == src` of `Place` is `local` + interned `projection` identity; `Cow::Borrowed(always_live_locals)` is the bit set; the free fn `places_conflict_for_assignment` (upstream between `impl Lint` and `impl Visitor`) sits after the class.
4. (ctfe-util) alloc_caller_location: `filename_with_nul.as_bytes()` is `utf8(..)`, `file_ptr.into()` is `Pointer_Option_from_Pointer`, `ecx.layout_of(..).unwrap()` is `unwrap_result(.., debug_InterpErrorKind)`, `ecx.tcx.require_lang_item` / `mk_args` / `lifetimes` go through `ecx.tcx.deref()` (TyCtxtAt), `type_of` stays the TyCtxtAt query.
5. (ctfe-util) context_spans: the guarded match is an if-chain (pattern && guard per arm, same order); `span.macro_backtrace().last()` drains the generator.

## Files touched
- `src/rustc_const_eval/util/{mod, check_validity_requirement, type_name, caller_location}.ts`, `src/rustc_mir_transform/lint.ts`.
- New tests: `src/rustc_const_eval/util/type_name.oracle.test.ts`, `src/rustc_mir_transform/lint.oracle.test.ts`.
- Counts only: `src/rustc_const_eval/interpret/contract.test.ts`, `src/rustc_mir_transform/pass_manager.test.ts`.
- No harness/, scripts/ or tools/ edits.

## For root
- No `-Zlint-mir` stop is left; the three tests/ui/mir/lint cases stay UNSTABLE in mirdump-ui (their ICE report prints the
  `#[track_caller]` "delayed at" location: the port stops at `std::panic::Location::caller (DiagLocation Display)`).
- Next stops for this lane's fns are other lanes' stubs (see "Tests"); `type_name` becomes reachable with
  interp-intrinsics' `sym::type_name`.

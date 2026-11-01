# Handoff: lane `miri-eval` (M6 wave 36, Miri core)

Branch `t3/port-miri-eval-core` (worktree t3-228bb9d7), based on main `06fa2c65`. Ports Miri's `eval.rs`, `helpers.rs`,
`operator.rs`, `math.rs` and `clock.rs` (2,844 upstream lines, 139 fns) into the skeleton modules
`src/miri/{eval,helpers,operator,math,clock}.ts`. Every fn is ported; the `stub_methods` / `stub_statics` calls of
these five modules are deleted.

## Files touched

- `src/miri/{eval,helpers,operator,math,clock}.ts`: ported (the lane's own files).
- `src/miri/{eval,helpers,operator,math,clock}.test.ts` (new): unit tests; `eval.test.ts` / `math.test.ts` carry the
  ports of the upstream `#[cfg(test)] mod tests` (markers `eval.rs:683`, `:687`, `math.rs:635`, `:637`, `:644`).
- `src/miri/math.oracle.txt` (new): oracle fixture for `math.test.ts` (see "Oracle probe").
- **Outside the lane, needs root acceptance:** `src/std/time.ts` + `src/std/time.test.ts` (new) and `src/std/task.ts`
  (new). PORTING §1 keeps lanes out of `src/std/`, but plan-m6 D14 sends host time through `src/std` stand-ins, and
  `tools/codegen/miri.typemap.json` names this lane for the `std::time` stand-in. No existing file under `src/std/`
  was edited.
  - `time.ts`: `Duration` (core `time.rs` subset: `new`, `from_secs/millis/micros/nanos/nanos_u128`, `as_secs`,
    `subsec_nanos`, `as_nanos`, `checked_/saturating_add/sub`, `ZERO`, `MAX`). It also has `Instant` / `SystemTime`
    over the unix `Timespec` arithmetic. `// std:` markers.
  - `task.ts`: `Poll<T>`.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23332; vendor 5050)`.
- `bun scripts/coverage.ts --missing`:
  - eval.rs 9/9
  - helpers.rs 71/71
  - operator.rs 4/4
  - math.rs 45/45
  - clock.rs 10/10
  - total 139/139 (the contract's table had 0/139)
- Codegen: `bun tools/codegen/types.ts miri` leaves the tree unchanged (no diff; 0 unknown types, missing debug 13 /
  clone 2, as before).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri src/rustc_const_eval src/std/time.test.ts`: 76 pass, 0 fail on 4 of 5
  runs.
  - The first run had one `(unnamed) [241.89ms]` failure. Its log was filtered and lost, and I could not reproduce it
    (4 clean reruns). It may be a flake outside this lane; it is reported here, not resolved.
- `bun scripts/difftest.ts --suite mir --sample 200` (agent `miri-eval`): MATCH=200 DIFF=0 UNPORTED=0, run
  `20261101-130416-miri-eval-0mf3`. Nothing outside `src/miri` changed apart from the new `src/std` files, which no
  compiler code imports.

### Unit tests (self-contained logic)

- **clock.test.ts:**
  - The virtual clock: tick / sleep / now / epoch / duration_since.
  - The 2^53 stop in `MonotonicClock::sleep`.
  - `Instant::add_lossy` u128 saturation.
  - `Deadline::from` / `add_lossy`, including the 1h fallback and the panic when that overflows too.
  - `MiriMachine::timeout`: monotonic relative/absolute, and the isolation assert for `RealTime`.
- **math.test.ts:**
  - Upstream `test_sqrt` (Half/Single/Double/Quad).
  - Oracle-exact `apply_random_float_error` (Random and Max modes, f64/f32), `apply_random_float_error_ulp` (f64/f32,
    and Max mode on f16), and `generate_nan` (operator.rs).
    - All of these draw from one `StdRng::seed_from_u64(0)` stream; the next `u64` after them also matches, so the
      number of RNG draws is right.
  - `IeeeExt::pi` bits.
  - Host float ops `sin cos exp exp2 ln log10 log2 powf powi` for f64 / f32 / f16 against the oracle's libm: all
    equal (9 f64 inputs, 9 f32 inputs, 5 f16 inputs).
  - `strip_float_suffix` / `clamp_float_value` / `fixed_float_value` cases.
- **operator.test.ts:**
  - `binary_ptr_op_` on a real `TyCtxt` (a `#![no_core]` crate): all six comparisons, on scalars and on lexicographic
    ScalarPairs (`*const [u8]`).
  - The ABI-mismatch `assert_eq!` panic.
  - `Add/Sub/BitAnd/BitOr/BitXor` keep the LHS provenance and give a `usize` layout.
  - `span_bug!` on other operators.
- **eval.test.ts:**
  - Upstream `windows_argv0_panic_on_quote` / `windows_argv0_no_escape`, plus more escaping cases (empty argument,
    backslashes before a quote and at the end, a surrogate pair, interior NUL).
  - `MiriConfig::default()`: all 38 fields, and fresh collections per call.
- **helpers.test.ts:**
  - `bool_to_simd_element` (sizes 1 to 16).
  - `windows_check_buffer_size`, including its panics.
  - `ToUsize` / `ToU64`.
  - `isolation_abort_error` currently stops `unported` (below).
- **std/time.test.ts:** Duration carry and overflow panics, checked/saturating ops, and Instant / SystemTime arithmetic.

### Oracle probe (math.oracle.txt)

A scratch cargo crate at `$RUST_TS_DATA/tmp/miri-eval/fuzzprobe`. It is not a registered probe (`tools/` is off-limits).

- **Inputs:** `src/main.rs`, `Cargo.toml`, `Cargo.lock`.
- **Pinned versions:**
  - rand `=0.10.1`
  - rustc_apfloat `=0.2.3`
  - chacha20 pinned to `0.10.0` with `cargo update -p chacha20 --precise 0.10.0 --offline`, as in Miri's Cargo.lock
- **Build:** `cargo +nightly-2026-10-11 build --offline --release`. This builds a crate; it does not touch the
  toolchain.
- **Contents:**
  - math.rs's `apply_random_float_error(_ulp)` and operator.rs's `generate_nan` verbatim, over
    `(mode, &mut StdRng)` instead of the ecx.
  - The host `f64/f32/f16` ops, with inputs behind `black_box`.
  - `core::{f16,f32,f64}::consts::PI` bits.
- **Output:** `./target/release/fuzzprobe > src/miri/math.oracle.txt`.

Queued harness item: register it as `tools/probes/mirimath`. This follows the vendor-rand precedent for
`stdrng.oracle.txt`.

## Contract changes (declared signatures this lane owns, corrected in place)

**clock.ts**
- `Pending<"Duration">` is now src/std/time.ts `Duration`, in `Instant.add_lossy`, `Instant.duration_since` (return),
  `MonotonicClock.sleep` and `MiriMachine.timeout`.
- `Deadline` became `export type Deadline = gen.Deadline` plus a companion `Deadline` with `from(instant)` (the
  `From<Instant>` impl) and `add_lossy(self, d)`.

**operator.ts**
- `generate_nan` now takes a trailing `F2_: FloatType<F2>` dictionary, matching the interpreter's
  `Machine::generate_nan(ecx, inputs, F2_)`, and `F1 extends Float<F1> & FloatConvert`.
  miri-machine's `generate_nan` hook should be `ecx.generate_nan(inputs, F2_)`.
- New helper exports:
  - `machine_rng(rng)`: the typed `StdRng` of `machine.rng`.
  - `MiriImmTy`: rustc_const_eval's `ImmTy` constructors typed with Miri's provenance.
  - `imm_to_scalar(imm)`.

**math.ts**
- These fns take a trailing `F_: FloatType<IeeeFloat<S>>`, because they need the type before they have a value:
  - `fixed_float_value(ecx, name, args, F_)`
  - `sqrt_op(this_, f, dest, F_)`
  - `host_unary_float_op(this_, f, op, dest, F_)`
- These use `val.Self()` / `base.Self()` instead: `apply_random_float_error(_ulp)`, `clamp_float_value`,
  `fixed_powi_value`, `sqrt`.
- `IeeeFloat<S>` replaces `Pending<"IeeeFloat<S>">`.
- New exports:
  - `strip_float_suffix` (for tests)
  - `ToHost_*` / `ToSoft_*`
  - `HostFloatOperation_{Half,Single,Double}`
  - `IeeeExt`, `IeeeExt_{Half,Single,Double}`

**helpers.ts**
- `try_project_field_named` / `project_field_named` are `<P extends Projectable<P, Provenance>>`.
- `write_int(i: bigint, ..)` (`impl Into<i128>`).
- `write_int_fields_named(values: readonly [string, bigint][], ..)`.
- `read_c_str_with_char_size(..)` returns `bigint[]`: the generic `T: TryFrom<u128>` is dropped, and `read_wide_str` /
  `read_wchar_t_str` convert to numbers.
- `lookup_link_section` returns `[ImmTy, Span][]`.
- `path_ty_layout(cx)` takes any `{ tcx_(), typing_env_(), layout_of }`, e.g. an `InterpCx`.
- New exports:
  - `throw_machine_stop(info)`
  - `ToUsize_u32` and `ToU64_usize` (the trait impls)

**eval.ts**
- `eval_entry` returns `Result<null, number>`; the `number` is a nonzero `NonZeroI32`.
- `MiriConfig` is also a value: the companion with `default()`.
- `args_to_utf16_command_string(Iterable<string>): number[]` is exported (for tests).
- `lib.ts` re-exports only `type MiriConfig`. Root: add the value if the driver should use `MiriConfig.default()`
  through the prelude.

## Needs from other lanes / root (signatures the skeleton lacks)

1. **miri-driver: `impl MachineStopType for TerminationInfo`** (diagnostics.rs:113).
   - Please export a boxing fn, e.g. `MachineStopType_from_TerminationInfo(info): MachineStopType`. It returns an
     object with `display()` / `debug(f)` / `with_validation_path`, as rustc_middle error.ts's `MachineStopType`
     expects.
   - Until then, helpers.ts `throw_machine_stop` stops `unported(...)`. This affects `isolation_abort_error` (every
     isolation abort) and eval.ts's `Done` exit (`TerminationInfo::Exit`). Wiring it is a one-line change in
     `throw_machine_stop`.
2. **miri-race:** `GlobalDataRaceHandler::as_genmc_ref` (data_race_handler.rs:47) is undeclared. eval.ts has a local
   `as_genmc_ref`, marked `PORT(contract): pending`; switch it to the export.
3. **miri-threads:**
   - `ThreadId::MAIN_THREAD` (thread.rs:59) is undeclared. eval.ts has a local `MAIN_THREAD()`, marked pending.
   - `StackEmptyCallback` should return `InterpResult<Poll<null>>` (src/std/task.ts). eval.ts converts at the boundary
     (`poll_of` / `pending_poll`).
4. **miri-shims-a:** `GlobalCtorState` / `TlsDtorsState.on_stack_empty` should return `InterpResult<Poll<null>>`.
   Their `#[derive(Default)]` (`#[default] Init`) is built in eval.ts from the generated types.
5. **miri-machine:**
   - The `Machine` hooks should call this lane's methods: `binary_ptr_op` → `ecx.binary_ptr_op_(..)`,
     `generate_nan` → `ecx.generate_nan(inputs, F2_)`, `equal_float_min_max` → `ecx.equal_float_min_max(a, b)`.
   - eval.ts depends on `MiriMachine.new` / `late_init` / `communicate` / `is_local` (still stubs).
6. **Root, typemap (`tools/codegen/miri.typemap.json`, a tools/codegen data edit):**
   - Map `std::time::{Duration, Instant, SystemTime}` to src/std/time.ts (`clone: copy`). This drops clock.ts's
     `host_instant` / `host_system_time` casts and the `Pending<"std::time::Duration">` in scheduler.gen.ts and the
     shims.
   - Map `rand::rngs::StdRng` to `src/vendor/rand/rngs/std.ts` `StdRng`. This drops operator.ts's `machine_rng` cast.
   - Map `Poll<()>` to src/std/task.ts `Poll<null>` where the skeleton declares it.
7. **Root:** accept the new `src/std/time.ts` / `task.ts` (above) and record it as a decision, if you agree.

## `unported(...)` left

- `miri::diagnostics::TerminationInfo as MachineStopType (pending lane miri-driver)`: helpers.ts `throw_machine_stop`
  (item 1 above).
- `miri::helpers::gen_random: host getrandom (isolation off; plan-m6 D5)`: `getrandom::fill` is out of M6. The
  isolation-on path (`rng.fill_bytes`) is ported.
- `miri::clock::MonotonicClock::sleep (virtual clock past 2^53 ns; decision C5 amendment)`: the recorded
  virtual-clock-counter decision.

## `// PORT:` decisions

1. **Host float ops (math.ts header).**
   - f64 uses JS `Math` (JavaScriptCore calls the host libm). `exp2(x)` is `2 ** x`.
   - f32 is the f64 op rounded with `Math.fround`, where Rust calls `sinf` & co.
   - f16 promotes to f32 and rounds back, which is LLVM's lowering.
   - `powi` is compiler-rt `__powidf2` / `__powisf2`, ported exactly.
   - Measured equal to the oracle on every probed input. Different inputs could still differ in the last bit for
     f32/f16; the test lists any difference it finds and requires exact f64.
2. **Generic floats.** They use their `FloatType` dictionary, from a value (`x.Self()`) or a trailing `F_` (contract
   changes above). `ToHost` / `ToSoft` / `HostFloatOperation` / `IeeeExt` are impl tables. The `impl_float_host_operations!`
   and `impl_ieee_pi!` macros are factory fns with markers on the macro-body fns. `core::fNN::consts::PI` bits are
   constants checked against the oracle.
3. **CTFE-typed interpreter APIs.**
   - `InterpCx` class-body methods (`eval_global`, `size_and_align_of_val`, ...), the `ImmTy` / `Immediate`
     companions and `ValueVisitor_provided` are typed with the CTFE provenance.
   - Miri's values are the same objects, so they are cast at those calls: `MiriImmTy`, `imm_to_scalar`, `miri_mplace`,
     and `UnsafeCellVisitor extends ValueVisitor_provided<interp_MPlaceTy>`.
   - Interp-generic could make these generic later. That needs a reviewed rustc_const_eval change; I made none.
4. **`generate_nan`'s `nans.choose(rng)`.** It runs over a hand-built `Chain` / `Once` / slice-`filter(_map)`
   `RustIterator` with core's exact `next` / `size_hint`. rand's `choose` depends on them; this is oracle-checked.
5. **`UnsafeCellVisitor`.** It is the fn-local struct of `visit_freeze_sensitive`, as a module-level class with the
   markers of its impl fns (`ecx` :553, `visit_value` :558, `visit_union` :601).
6. **`reject_in_isolation`'s `static DEDUP: Mutex<FxHashSet<String>>`.** It is a module-level `Set`: process-global,
   as upstream.
7. **`MainThreadState::on_main_stack_empty(&mut self, ..)`.** It takes a `MutRef<MainThreadState>`. The callback given
   to `late_init` closes over it, as upstream's `move` closure does.
8. **`catch_unwind(|| ecx.run_threads())`.** It is `try` / `catch`: `FatalErrorMarker` is rethrown as is, and any
   other throw runs `handle_ice()` first, then rethrows (`resume_unwind`).
9. **`MonotonicClock::sleep` (host, isolation off).** It uses `Bun.sleepSync` (D14).
10. **`StdInstant::now()` / `SystemTime::now()`.** These use `process.hrtime.bigint()` and
    `performance.timeOrigin + performance.now()` (D14; host values differ per run on both sides anyway).
11. **`args_to_utf16_command_string`.** `arg.bytes().any(..)` checks UTF-8 bytes, and `chars()` iterates Unicode scalar
    values (`[...arg]`). The result is UTF-16 code units (`charCodeAt`).
12. **eval.ts `entry_fn` / `create_ecx` fatal messages.** These are the Rust string literals with `\`-continuations
    resolved (no leading indentation).

PASS WITH NOTES

# Re-check: lane `ssa-base` fixes (M7 wave 41, wave 40n)

- **Reviewed:** `git diff 3b63f5ec..8a1cf71c` on `t3/port-ssa-base-crate-driver`: `1524ed53` (F1, N7's code change) and
  `8a1cf71c` (N1–N7, handoff). First review: `docs/reviews/ssa-base.md` at `1e57a7c0` (FAIL, F1 plus N1–N7).
- **Reviewer:** independent, read-only on code. Upstream is read from `$RUST_TS_DATA/rust` at pin `6f5da406b56`.
- **Result:** F1 is fixed. I proved the tests are location-independent in a checkout at a different path, and my
  regenerated oracle equals `oracle.json`. N1, N2, N4, N5, N6 and N7 are fixed as asked, and N3 is now disclosed in the
  handoff. No check is weakened, and nothing outside the lane's files changed. Three notes follow. None blocks.

## Evidence
I merged `8a1cf71c` into this worktree (`t3-cb033e4e`, a different path from the porter's `t3-284633cb`). I ran everything
on AC power with `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and `RUSTC_ICE=0`.
- `bunx tsc --noEmit -p .`: exit 0.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26399, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor
  5311; library 744; llvm 390)`. That is unchanged from the first review.
- `bun scripts/coverage.ts --missing`: base.rs 28/28, lib.rs 11/11, assert_module_sources.rs 10/10, back/lto.rs 8/8.
- `bun test ./src/rustc_codegen_ssa/base.test.ts`: **12 pass, 0 fail**. The first review had 4 fail at a foreign path.
- `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: **190 pass, 0 fail** (24 files).
- `bun test ./scripts/lib/unit-steps.test.ts`: **10 pass, 0 fail**.
- `git status` was clean after the test runs and after my oracle runs from `base_oracle/`, so nothing was left in the tree.

## 1. F1: fixed
- `oracle.json` contains no `/Users`, `t3-` or `worktree` string. Its closure names read `{closure@cgus.rs:…}` (36
  occurrences); the rest are library paths (`<std…`, `core…`, `std…`).
- `base.test.ts:29` `FIXTURE = "cgus.rs"`. All three oracle runs use `cwd: DIR` (`:67`, `:78`, `:88`), and so does the
  driver (`:119-120`). The only output paths are `--out-dir` arguments under `$RUST_TS_DATA/tmp`, so nothing is written to
  `base_oracle/`.
- **Independent regeneration.** I ran `rustc +nightly` (commit-hash `6f5da406b56c2db6607202b63daee73aa8c61297`, which
  equals `UPSTREAM.json`) from `src/rustc_codegen_ssa/base_oracle/` with `cgus.rs` and the test's `bin` flags. The output
  went to my scratchpad.
  - The `RUSTC_LOG=rustc_codegen_ssa::base=info -Ztrim-diagnostic-paths=no` log has 146 `codegen_instance(..)` lines.
    They are **identical** to `oracle.json`'s `bin.instances`, element by element, with no normalisation.
  - `-Csave-temps`: the `main` shim, extracted as the test extracts it, is identical to `bin.main`. The allocator module
    is `cgus.370gba7z70vw642p0l8uv3rqs.rcgu.bc`, which equals `bin.allocator`.
- **Old vs new fixture.** I took `3b63f5ec`'s `oracle.json` and stripped the absolute prefix (up to and including
  `base_oracle/`). It then equals the new file in all 8 fields: `bin` and `rlib`, each with instances, mono, allocator and
  main. So the regeneration changed only the path, and no expectation moved.

## 2. N1: fixed
`assert_module_sources.ts:81-91`. Upstream assert_module_sources.rs:69-76 is
`if print_mono_items && let Some(data) = … { data.actual_reuse.items().all(|(cgu, reuse)| { println!(…); true }); }`.
The port keeps the same condition and keeps upstream's loop as a comment. It stops
`unported("…CGU_REUSE in UnordMap (FxHashMap) iteration order (-C incremental)")` only when `actual_reuse` is non-empty.
That is exactly the case where upstream iterates and prints. An empty map prints nothing upstream, so passing through is
faithful. `check_expected_reuse` follows unchanged. Nothing is printed in a guessed order.

## 3. N4: fixed
- `base.ts:341-344` (upstream base.rs:261 `assert_eq!(result, None)`, `result: Option<(Bx::Value, Bx::Value)>`). It
  panics only when `result` is `Some`. The text is
  ``assertion `left == right` failed\n  left: Some((<v0>, <v1>))\n right: None``. That is core's `assert_eq!` format
  (it matches `std/panic.ts:85`), with `Option`/tuple `{:?}`. The values are formatted with the backend's `debug_Value`,
  the existing `BackendTypes` contract (traits/backend.ts:65), which traits/builder.ts:652 uses the same way.
- `assert_module_sources.ts:171` (upstream :139 `assert_eq!(iter.next().unwrap(), crate_name)`). Both sides are `&str`
  (upstream :118-119 `crate_name.as_str()`). `assert_eq(…, debug_str)` uses `std/fmt.ts:212` `<str as Debug>`, which
  quotes and applies `escape_debug`. That is correct.

## 4. N2, N3, N5, N6, N7: fixed
- **N2.** `lib.ts:312-313` now says the methods (`serialize_rlink` :350, `deserialize_rlink` :371) sit in the class body
  before `CodegenError` and `provide`, and that upstream has them after `provide` :339. I checked this against upstream
  lib.rs (:331 `CodegenError`, :339 `provide`, :349 `impl CompiledModules`, :350/:371) and against lib.ts (:321/:346
  methods, :391 `CodegenError`, :404 `provide`). The comment cites PORTING §8's first bullet, which allows this placement.
- **N3.** Handoff PORT decision 3 lists the three modules that are new at startup, and asks root to note them for D14.
- **N5.** `base.ts:14-16` and `:1324` (and handoff decision 6 and the unported list) now say "plan-m2 D3, plan-m3 D12".
- **N6.** `base.ts:1469`: `pub struct Coordinator<B: WriteBackendMethods>` (back/write.rs:2054). Verified.
- **N7.**
  - `driver.ts:34-36` takes `--ssa-out=<file>` from `argv[2]` and splices it out before the driver reads the rustc
    arguments. `driver.ts` has no `process.env` read.
  - The test passes `--ssa-out` first (`base.test.ts:119`), with `env: ENV`.
  - The handoff corrects its earlier claim, and its note on what the "codegen_instance order" test pins matches the
    driver's header (`driver.ts:16-18`).
  - `unit-steps.test.ts`: 10/10.

## 5. Regressions
- Only the lane's files changed (7 files: base.ts, lib.ts, assert_module_sources.ts, base.test.ts, base_oracle/driver.ts,
  base_oracle/oracle.json, and the handoff). No baseline, suite, harness or script file changed.
- No assertion was removed or loosened. The test compares the same four fact kinds against the same oracle. The only
  changes in the test are the `cwd` and the relative fixture path. The `write_stdout` import removal in
  assert_module_sources.ts follows from N1.

## Findings

**1. (note) The `RUST_TS_SSA_OUT` pattern N7 removed here is still used in another lane's test.**
`src/rustc_codegen_ssa/mir/analyze_oracle/driver.ts:30` reads `process.env.RUST_TS_SSA_OUT`, which
`src/rustc_codegen_ssa/mir/analyze.test.ts:103` sets for its child. That code is from ssa-mir-core (`3000ed80`), not this
lane, and `unit-steps.test.ts` passes with it. So it is not in scope and blocks nothing. Root may want the same
`--ssa-out` change there, so the two drivers stay consistent.

**2. (note, carried forward) Three modules are new at startup.** They are listed in
`docs/handoff/ssa-base.md` (PORT decision 3):
- `rustc_codegen_ssa/decodable.gen.ts`, via lib.ts;
- `std/time.ts`, via base.ts;
- `rustc_codegen_ssa/assert_module_sources.ts`, via base.ts.

Root should carry this into D14's bundle batch. This is disclosure only. I took no new difftest samples.

**3. (nit) Line break in the handoff.** `docs/handoff/ssa-base.md:157-158`: decision 6 breaks after "(plan-m2" and
"D3, plan-m3 D12)", so the sentence wraps mid-parenthesis onto a short line. This is cosmetic.

## Verdict
**PASS WITH NOTES.** F1 and N1–N7 are resolved. The fixture is checkout-independent, I verified it at a foreign path, and
it matches a fresh pinned-rustc regeneration. The notes are informational.

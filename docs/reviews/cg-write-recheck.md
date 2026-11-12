PASS WITH NOTES

# Re-check: lane cg-write review fixes (M7, wave 40o)

- **Reviewed:** `git diff d50983fe..dde685fe` on `t3/port-cg-write-backend`: `c43c885f` (N1, N3, N4, N5, N6) and `dde685fe`
  (handoff). Merged into this review branch for the runs below.
- **Reviewer:** independent, read-only on code. Pin `6f5da406b56`. The first review is `docs/reviews/cg-write.md` at `11153680`
  (`t3/review-cg-write-port`).
- **Result:** root required N1, N3, N4 and N6, and all four are done. N5 (optional) is done and faithful. Deferring N2 is reasonable.
  - No check is weakened beyond the lldb re-run that root asked to remove.
  - No file outside the lane's own changed.
  - Two small notes remain: R1 in the hand-run tool, R2 in a comment. Neither touches the unit step or any protected output.

## Evidence (AC power, `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (26657, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 404)`. That is unchanged from the first review.
- `bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: **224 pass,
  0 fail** (20 files). The first review had 216 + 10 = 226, so the drop is exactly the two removed per-target lldb tests.
- **Without lldb:** `PATH=<scratch dir holding only a bun symlink>:$HOME/.cargo/bin`. There, `command -v lldb` finds nothing:
  `~/.cargo/bin` has `rust-lldb` but no `lldb`, and `/usr/bin` is not on the PATH. With `RUST_TS_REQUIRE_PROBES=1`:
  - `bun test ./src/rustc_codegen_llvm/back/write.test.ts` gives **12 pass, 0 fail**, with nothing skipped.
  - `-t "rustc -vV"` gives 3 pass, so the version-fixture test ran: the pinned sysroot resolved through the rustup shim. It was
    not skipped.
- **The same PATH, `bun …/write_oracle/record.ts`:** exit 1, with an uncaught `ENOENT` stack trace (R1). `git status` stays clean
  afterwards, because it stopped before writing anything.
- **N5 against the oracle:** I compiled a 1-line program with the pinned toolchain. `String::from_utf8_lossy([EF BB BF 61 FF E2 82
  62])` gives `feff 61 fffd fffd 62`, and Bun's `new TextDecoder("utf-8", { ignoreBOM: true })` gives the same. A default
  `TextDecoder` gives `61 fffd fffd 62`, without the BOM.

## 1. N1: lldb out of the unit tests (required). Done.
- **`write.test.ts` runs no lldb.**
  - `lldb`, `record_tm` and `record.ts` appear only in the header comment (`:6-10`) and in doc comments naming the argument form
    (`:190`, `:198`, `:207`).
  - The only `spawnSync` calls left are `rustc +<pin> --print sysroot` (`:68`) and `<sysroot>/bin/rustc -vV` (`:310`).
  - No test file in the repo imports or spawns `write_oracle/record.ts`. A repo-wide grep of `src scripts harness tools` finds
    `record.ts`'s name only in this lane's files.
  - `record.ts` is not a `*.test.ts`, so the unit-step roots never collect it. tsc only type-checks it.
- **The fixture comparisons are kept.**
  - `create_target_machine` (`:289-306`) still compares the port's recorded `LLVMRustCreateTargetMachine` calls, 23 arguments each,
    against the committed `<target>.tm`. It is unconditional.
  - `rustc -vV` vs `version.txt` is kept as "the version fixture is current" (`:308-318`), with the same
    `skipIf(!HAVE && !REQUIRE)` as before. So under the gate's `RUST_TS_REQUIRE_PROBES=1` it runs, or fails.
  - `get_version` and `print_version` still compare against `version.txt` (`:320-335`).
- **The fixtures are byte-identical:** `.tm`, `version.txt`, and `record_tm.py`'s logic. Only its 2-line header comment changed.
- **`write_oracle/record.ts`** is a hand-run driver (`bun src/rustc_codegen_llvm/back/write_oracle/record.ts`).
  - Its lldb invocation is the removed test's, verbatim: same commands, same `SIGUSR1` handling, same rustc arguments, and
    `cwd: WORK` with the relative `empty.rs`.
  - It writes `<target>.tm` and `version.txt`, one output line per file.
  - The `ERROR:` requirement is not fully met. See R1.
- **`write_oracle/README.md`** says how to run it, what it needs (the pinned toolchain plus Xcode CLT lldb on
  aarch64-apple-darwin), and when to run it: a pin change, a `record_tm.py` change, or a change to how `write.test.ts` compiles.
  It also says to commit the re-recorded files with the change that needed them, after checking `git diff`. That is adequate.
- **No harness change was needed.** `scripts/` and `harness/` are untouched, and `unit-steps.test.ts` passes (it is in the 224).

## 2. N3: relative compile (required). Done.
- **`with_tcx`** (`write.test.ts:98-115`) writes `WORK/empty.rs`, saves `process.cwd()`, and calls `chdir(WORK)`. It then runs
  `run_compiler` on the relative `"empty.rs"` inside `try`, and the `finally` restores the cwd (`:111-113`). That matches the
  oracle's run: relative `empty.rs` with `cwd` set to the work directory.
- **The callback is synchronous**, and Bun runs one file's tests one after another. So the temporary cwd cannot leak into another
  test, even when `f` throws, as the emit test's expected `into_compiled_module` stop does.
- **The emit test** passes a relative `--out-dir` (`emit-<target>`, `:341-343`). It writes while the cwd is `WORK`, and reads the
  output back as `join(WORK, out_path)` after the restore (`:403-404`). This is consistent, and the test passes.

## 3. N4, N5, N6
- **N4 (required). Done, and right.** `skeleton.test.ts:273` now names `back/write.test.ts`, and that file has the oracle check
  (`describe("llvm_util: get_version, print_version")`, `write.test.ts:320`).
- **N5 (optional). Done, and faithful.**
  - `archive.ts:84-85` decodes with `{ ignoreBOM: true }`.
  - `CStr::to_string_lossy` is `String::from_utf8_lossy` on the bytes. It keeps a leading U+FEFF and substitutes maximal subparts,
    and WHATWG's non-fatal decoder does the same. The probe above shows identical output on a BOM plus two invalid sequences.
  - It is still unreachable: `LLVMRustGetSymbols` is a model stop.
- **N6 (required). Done.**
  - `llvm_util.ts:401-404` now says why `SmallCStr::new`'s interior-NUL panic is dropped, and quotes its message correctly
    (`small_c_str.rs:33`: `The string "{s}" cannot be converted into a CStr: {e}`).
  - `write.ts:254` points at it.
  - `context.ts` (`create_module`) has the same `SmallCStr::new` comments and no code for the panic, as the new comment says.
  - The `const triple` line moved below the `cpu` comment. `versioned_llvm_target` is still evaluated before `target_cpu`, as
    upstream does, so nothing changes.
  - The reason given is slightly too narrow (R2).

## 4. N2: deferral
This is reasonable.
- The stand-in (`rustc_session/stand_ins.ts:118-133`) models both `generic_activity` and `TimingGuard::none()` with its one
  `VerboseTimingGuard { run }`. Its doc comment (`:129`) says that type stands for both.
- The only other `TimingGuard` in the tree is `back/profiling.ts:26`'s `{ drop() }` placeholder for the measureme path, which is
  never constructed here.
- All 10 `SelfProfilerRef_generic_activity_with_arg` results in `write.ts` are bound to an unused `_timer`. So the type cannot
  change behaviour, and making it exact would mean either a new stand-in type outside the lane's files or a mismatched placeholder.
  It belongs with the stand-in move (PORT decision 2), as the handoff says.

## 5. Regressions and scope
- **The diff touches only lane files:** `back/archive.ts`, `back/write.ts`, `back/write.test.ts`, `back/write_oracle/{README.md,
  record.ts, record_tm.py}`, `llvm_util.ts`, its own comment line in `skeleton.test.ts`, and `docs/handoff/cg-write.md`.
- **The source changes are comments only,** apart from the N5 decoder option. There are no marker or logic changes, and the
  coverage figure is unchanged.
- **No test was weakened** except the removal root asked for. The 23-argument comparison, the version comparison, the
  `--emit=llvm-ir` byte comparison and the diagnostic-handler call sequence are all intact.

## Findings
No F findings.

- **R1, `record.ts` does not always fail with one `ERROR:` line** (`src/rustc_codegen_llvm/back/write_oracle/record.ts:32`, `:17-19`,
  `:75-76`). This affects only the hand-run tool: no test or gate step runs it.
  - **lldb missing:** with lldb not on `PATH`, `Bun.spawnSync(["lldb", …])` throws `ENOENT`. The result is an uncaught 13-line stack
    trace with no `ERROR:` line (reproduced above). The header (`:8`), the README and the handoff (`:174`) all promise "one `ERROR:`
    line". The fix is a `try`/`catch` around the spawn that calls `die(...)`.
  - **Scratch left behind:** `die()` calls `process.exit(1)` inside the `try`, which skips the `finally`. So every `die` path after
    `:26` leaves `$RUST_TS_DATA/tmp/cg-write-record/<pid>/` behind.
  - **Partial rewrite:** a failure on the second target leaves the first target's `.tm` already rewritten. The README's "check
    `git diff`" covers that.
  - **Nice to have:** pass lldb `-x` (`--no-lldbinit`), as the first review suggested, so a user's `~/.lldbinit` cannot change the
    recording. Also put stderr in the `ERROR:` line.
- **R2, the N6 reason is a little too narrow** (`src/rustc_codegen_llvm/llvm_util.ts:402-403`).
  - The comment says a NUL "cannot come from argv (`-C target-cpu`), only from a target-spec JSON's `\u0000`".
  - But rustc expands `@argfile` arguments (`rustc_driver_impl/src/args.rs:26-27`: `read_file`, which is `read_to_string`, then
    `contents.lines()`), and a line can carry U+0000. So `-Ctarget-cpu=a<NUL>b` in an argfile reaches `target_config`, and upstream
    panics there.
  - Dropping the panic is still fine (no suite has such an argfile), but the comment should read "argv or an `@argfile` line, or a
    target-spec JSON". `write.ts:254` and `context.ts` inherit the same reasoning.

## For root
- N1, N3, N4 and N6 are resolved. Accept the lane's fixes.
- R1 and R2 can ride with the next touch of these files, for example the ssa-write merge or the stand-in move that also carries N2.
  Neither blocks the merge. R1 concerns only a tool run by hand, and R2 is a comment.

# Independent re-check: root's stderr fix on `integ-w56` (wave 40p)

I am the reviewer, read-only on code. I checked one root commit on `integ-w56`, merged into this worktree:

- `7faa04ad` ("integ-w56: target.ts writes stderr through std/io.ts's write_stderr"). It changes only
  `src/rust_ts/llvm/target.ts`: it adds the import at :23, and the `writeStderr` helper at :75-77 now calls `write_stderr`
  instead of `process.stderr.write(Buffer.from(s, "utf8"))`.

The earlier commits were checked in `docs/reviews/root-w56-check.md` (`c26f2d27`). I read upstream from `$RUST_TS_DATA/rust`
at `6f5da406`: `compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:87-123`.

## Verdict: APPROVE WITH NITS

The fix is correct and the guard test passes. `write_stderr` is the path `src/std/io.ts:408-412` sanctions for ported code
("the way to write to stderr from ported code and from drivers. Never use `process.stderr.write`"). It writes the same UTF-8
bytes to fd 2, synchronously. That is better than before: the old call could queue part of the text on a full pipe and
then lose it at `process.exit(101)`. The nits below concern cases no current compile reaches. None of them blocks.

## Checks

1. **Bytes on fd 2.** `write_stderr` (`src/std/io.ts:413`) UTF-8-encodes the string with `TextEncoder`, which gives the
   same bytes as `Buffer.from(s, "utf8")`. It then writes them with `writeSync(2, …)` in a loop that retries on
   `EINTR`/`EAGAIN` (`io.ts:347-364`).
   - I tested this in a scratch `bun -e` that ran `LLVMRustInstallErrorHandlers(); void process.stderr;` (which makes the
     pipe non-blocking) and then `report_fatal_error('x'.repeat(1<<20))`. Its fd 2 went into a pipe whose reader started
     0.3 s late. The reader got 1048595 bytes, which is 2^20 + `"rustc-LLVM ERROR: "` + `"\n"`, and the exit code was
     101.
   - `report_fatal_error('boom', false)` printed exactly `rustc-LLVM ERROR: boom\n` (checked with `od -c`). This matches
     `std::cerr << "rustc-LLVM ERROR: " << Reason << std::endl` at RustWrapper.cpp:94.
2. **`OUTPUT_CAPTURE` and `process.exit`.** Upstream's `FatalErrorHandler` uses `std::cerr` and `BadAllocErrorHandler`
   uses `::write(2, …)`. Neither goes through Rust's `OUTPUT_CAPTURE`. The port's `write_stderr` does
   (`io.ts:415-418`). With a capture set, the message goes into the sink, and `process.exit(101)` (`target.ts:97`) then
   drops it.
   - I confirmed this: with `set_output_capture([])` set, the same scratch run printed 0 bytes and exited 101.
   - No compiler path sets a capture: outside `io.ts` the only caller is `src/miri/bin/miri.test.ts`. Nothing in the
     model reaches the handlers yet either (`docs/handoff/llir-init.md:214`). So no output changes today. See nit 1.
3. **Other direct uses.** `target.ts` no longer contains `process.stdout` or `process.stderr` (one doc-comment mention
   remains at :73).
   - Grepping `src/rust_ts/llvm/` and `src/rustc_codegen_llvm/` for `process.std(out|err)` finds nothing else.
   - The lanes' new `console.log` calls are all in tests (SKIP lines) or in hand-run tool scripts:
     `tools_oracle/{record,evidence,objects}.ts` and `back/write_oracle/record.ts`. None of them is on a compile path,
     and the guard does not cover them. `main` already has 55 such calls outside tests.
4. **Load order.** In fresh `bun -e` processes, `import('./src/rust_ts/llvm/target.ts')`, then `ffi.ts`, then `tools.ts`,
   each loaded first, all load cleanly. `std/io.ts` imports nothing from `rust_ts/llvm`, so the new edge adds no cycle.
5. **Commands** (`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`):
   - `bunx tsc --noEmit -p .`: exit 0, no output.
   - `bun test ./src/std/io.test.ts ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/`: 313 pass, 0 fail, 0 skipped, across
     26 files. This includes "nothing under src/ writes through process.stdout or process.stderr".
   - No test calls `FatalErrorHandler`. `src/rust_ts/llvm/target.oracle.test.ts:198-200` checks only the installed
     handlers' names, which still pass. See nit 3.

## Findings

1. **Nit: the LLVM handlers' stderr goes through `OUTPUT_CAPTURE`, which upstream's never does.**
   - Where: `src/rust_ts/llvm/target.ts:76`, with `src/std/io.ts:415-418`.
   - Upstream: `std::cerr` (RustWrapper.cpp:94) and `::write(2, …)` (:117-119) write to fd 2 whatever Rust's capture
     holds.
   - With a capture set, the port puts the text in the sink, and `process.exit(101)` / `process.abort()` then lose it.
   - No impact today (check 2).
   - Suggested fix: call `stderr_write_all` (`io.ts:378`) from the helper instead. It writes fd 2 directly, swallows
     `EBADF` as upstream does, and the guard test allows it.
2. **Nit: a failed write panics, where upstream ignores it.**
   - Where: `src/std/io.ts:420`, reached from `target.ts:90`, `:108-110` and `:131`.
   - The port: `write_stderr` panics on any write error other than `EBADF`, such as `EPIPE` or `EIO`. Inside
     `FatalErrorHandler` that would throw a `Panic` instead of reaching `exit(101)`, and inside `BadAllocErrorHandler` it
     would throw instead of reaching `abort()`.
   - Upstream: `std::cerr` only sets `badbit`, and `BadAllocErrorHandler` discards `::write`'s result with `(void)!`.
   - The same change as nit 1 fixes this: `void stderr_write_all(bytes)`, dropping the result.
   - Edge case only.
3. **Nit: no test pins the handler's text or its exit code.**
   - Where: `src/rust_ts/llvm/target.oracle.test.ts:198-200`.
   - The test asserts only that the handlers are installed. A child-process test would pin both the message and the exit
     code, like the scratch run in check 1: call `report_fatal_error("boom")`, then expect stderr to be exactly
     `rustc-LLVM ERROR: boom\n` and the exit code to be 101.
   - `io.test.ts`'s `child_through_pipe` pattern shows how.
4. **Nit, already there before this commit: an upstream comment was dropped.**
   - Where: `src/rust_ts/llvm/target.ts:92-95`.
   - The port keeps only the first three lines of the comment above `sys::RunInterruptHandlers()` (RustWrapper.cpp:95-97).
   - It drops lines :99-105 ("In practice, this will do nothing, because the only cleanup LLVM does is … less
     artifacts.").
   - PORTING.md §2 says to keep ordinary comments. `docs/reviews/llir-init.md` did not raise this. It belongs to a fixers
     lane, not to this commit.

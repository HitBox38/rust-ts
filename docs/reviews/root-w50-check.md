APPROVE WITH NITS

# root-w50-check: root's commits on `integ-w50` (7418d6e1, 85e77ec9)

Reviewer: lane `root-w50-check`, read-only on code. Tree under test: `integ-w50` at 85e77ec9, checked out detached in
this worktree. `.env.local` was copied from integ-w39, plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.
The machine was on AC power. The state summary shows no open STOP. Every mutation below was made in this worktree and
undone with `git checkout -- <path>`. None was in place while the unit steps ran.

Nothing blocks the merge. The current tree is correct:
- `RUNTIME_C_FILES` is exactly what the guard finds, and the mutation checks show the guard catches a dropped file.
- The `RUSTC_BLESS` refusal is complete.
- The metadata test still catches a leaked temp dir.
- The fcntl tests are exact and not flaky.

Each nit is a way a later change could slip past one of these tests without the test failing.

## 1. The run-time C guard (`scripts/subject-bin.cases.ts` `ccSources`)

### Mutation checks (`bun test ./scripts/subject-bin.cases.ts -t "RUNTIME_C_FILES is exactly"`, temp `RUST_TS_DATA`)

| # | mutation | result | |
|---|---|---|---|
| base | none | 1 pass | |
| M1 | drop `src/std/thread.c` from `RUNTIME_C_FILES` (scripts/lib/subject-bin.ts:377) | **fail** (found set +1) | caught |
| M2 | drop `src/rust_ts/proc_macro_host.c` | **fail** | caught |
| M3 | thread.ts: `source: join(import.meta.dir, NAME)` (computed source in `cc_or_unported`) | **fail** | caught |
| M4 | thread.ts: two `cc_or_unported` calls on one line, the second with `source: SRC_Y` | **fail** | caught |
| M10 | `cc_or_unported(\`y\`, { source: join(import.meta.dir, "y.c") })` (template-literal `what`) | **fail** | caught (refused as unreadable) |
| M11 | `what` with an escaped `\"` | **fail** | caught (refused as unreadable) |
| M12 | tinycc.ts: `return cc({ ...options });` | **fail** | caught |
| M5 | `import { cc_or_unported as build } ...; build("y", { source: join(import.meta.dir, "y.c") })` | pass | **missed** |
| M6 | `import { cc as compile } from "bun:ffi"; compile({ source: join(import.meta.dir, "y.c") })` | pass | **missed** (gap predates this commit: harness-w50's regex) |
| M7 | `const U = "https://example.com"; export const lib_y = () => cc({ source: join(import.meta.dir, "y.c") });` on one line | pass | **missed** |
| M8 | `const G = "src/*"; ... cc({ source: join(import.meta.dir, "y.c") }); const H = "*/x";` on one line | pass | **missed** |
| M9 | tinycc.ts: a module-level `cc_or_unported("y", { source: join(import.meta.dir, "y.c") })` | pass | **missed** |

The new `cc_or_unported` form is read correctly, and every non-literal or doubled call the task lists is refused (M3,
M4, M10-M12). The misses come from three sources: names imported under an alias, the comment stripping, and the
tinycc.ts branch.

**N1 (comment stripping fails open on `//` or `/*` inside a string).** `scripts/subject-bin.cases.ts:191`:
`raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")` does not know about strings.
- A string holding `//`, such as a URL, deletes the rest of its line. A `cc(` call later on that line disappears (M7).
- A string holding `/*` deletes everything up to the next `*/` anywhere in the file (M8).

Before this commit the guard did not strip anything, so M7 and M8 would have been refused. The stripping was needed only
because tinycc.ts's doc comment names `` `cc(options)` ``. No current file is affected: I checked the 13 tracked non-test
files that contain `bun:ffi` or `cc_or_unported`, and none has `//` or `/*` inside a string.

Suggested fix: strip comments with Bun's own parser. I checked that
`new Bun.Transpiler({ loader: "ts", trimUnusedImports: false }).transformSync(raw)` does this:
- it drops both comments from `const U = "https://x/*"; /* c */ ... cc({ source: join(import.meta.dir, "y.c") }); // cc(z)`;
- it keeps the string and the call, in a form the existing source regex still reads;
- on thread.ts, proc_macro_host.ts and tinycc.ts it leaves exactly the calls the regexes expect.

**N2 (aliases are not seen).** The guard counts calls by name, so a renamed import is invisible:
- `cc_or_unported as X` (M5) is a new hole, opened by the wrapper;
- `cc as X` from `bun:ffi` (M6) predates this commit;
- the same goes for a destructured `const { cc: c } = await import("bun:ffi")`, and for `cc` re-exported by another
  module, whose importer never names `bun:ffi`.

A cheap fail-closed rule: refuse any file whose stripped text matches `/\bcc(?:_or_unported)?\s+as\b|\bcc\s*:/` (an
alias or a destructuring rename), and say so in the error. That covers the forms an editor's auto-import produces. The
re-export case is rarer; a header comment naming it as out of scope would do.

**N3 (the tinycc.ts exemption is narrow for `cc(`, but blind to `cc_or_unported(`).** `scripts/subject-bin.cases.ts:192-195`:
- The branch requires exactly one `\bcc\s*\(` and `return cc(options);`. Neither a second `cc(` nor a changed forward
  passes (the case test, and M12).
- But inside tinycc.ts the branch counts no `cc_or_unported(` calls, so a module-level compile through the wrapper in
  that file is missed (M9).

Fix: apply the general count to tinycc.ts too, after removing the one allowed `return cc(options);` and the
`function cc_or_unported(` definition. Contrived today, but it costs two lines.

Smaller observations, no action needed:
- The subtraction of `function cc_or_unported(` definitions applies to every file, not only tinycc.ts. Another file
  defining a function by that name has one call fewer counted. Every case of this I tried still ended with an unreadable
  forwarding `cc(` being refused, so it fails closed.
- The early return (`:189`) skips files that name neither `bun:ffi` nor `cc_or_unported`. This is the re-export hole
  from N2.

## 2. `RUSTC_BLESS`

- **Who reads it:** `git grep RUSTC_BLESS` finds only `src/rustc_errors/markdown/tests/term.test.ts:70` (the reader), its
  header comment, the driver-cli handoff and the new `UNIT_ENV_REFUSED` entry (scripts/lib/unit-steps.ts:142). No tool,
  harness script or other test reads it. Rustc itself does not read it either: upstream's only reader is
  `compiler/rustc_errors/src/markdown/tests/term.rs:65`, a test that bootstrap's `--bless` drives.
- **Does the gate need it:** no. Nothing the gate starts uses it, so refusing to start when it is set costs nothing.
- **Scan test:** `bun test ./scripts/lib/unit-steps.test.ts` gives 9 pass. With the entry deleted it gives 7 pass,
  2 fail: "every variable a test file reads by name is refused ... or named harmless" and "every fixture-writer variable
  (REGEN, BLESS, ...) ... is refused", both naming `RUSTC_BLESS (src/rustc_errors/markdown/tests/term.test.ts)`. The
  entry is required and sufficient.

## 3. `src/rustc_interface/metadata_temp_dir.test.ts`

**What the run does now.** At 85e77ec9 the subject on that argv prints
`rust-ts: unported: IntoDiagArg without a TS impl (see types report)` and exits 70. It leaves `d2/liblibfoo.rmeta` and
no `rmeta*` directory.

The stop is on the path the file's header means:
- `run_compiler` builds the Linker (`src/rustc_driver_impl/lib.ts:351-352`), which encodes the metadata;
- then `dump_feature_usage_metrics` (`:357`) fails to write;
- then `emit_err(UnstableFeatureUsage { error })` needs `IntoDiagArg` for `Box<dyn Error>`;
- the stop unwinds through the `catch` that calls `built_linker?.drop()` (`:370`).

**Leak mutation.** With the `built_linker?.drop();` in that catch commented out, the test fails with
`+ "d2/rmeta8PCy6i"` (1 pass, 1 fail). Restored, it gives 2 pass. The test still catches a leaked temp dir on that exit.

**N4 (the weakened assertion can pass vacuously).** `src/rustc_interface/metadata_temp_dir.test.ts:40`:
`toContain("rust-ts: unported:")` also matches a stop *before* the metadata is encoded. Such a run never makes a temp
dir, so `leftovers()` is trivially empty. Mutation: I inserted
`if (sess.opts.unstable_opts.metrics_dir !== undefined) unported("MUTATION early stop");` just before
`Linker.codegen_and_build_linker` (`src/rustc_driver_impl/lib.ts:351`). The file still gave **2 pass, 0 fail**.

Before this commit, the message `dump_feature_usage_metrics` pinned where the stop happened. Suggested fix: keep the
generic stop check, and also prove the metadata was written, for example
`expect(existsSync(join(cwd, "d2", "liblibfoo.rmeta"))).toBe(true)`. The current stop leaves that file; a stop before
encoding cannot. That tests what the header says without tying it to one unported message. Checked: with the early-stop
mutation the run leaves `d2/` empty (exit 70); at 85e77ec9 it leaves `d2/liblibfoo.rmeta`.

**N5 (the comment calls the diagnostic a warning).** `metadata_temp_dir.test.ts:36` says "the warning for the missing
metrics dir", but upstream emits an **error**. Oracle (`rustc +nightly-2026-10-11`, 6f5da406b) on the same argv
(`libfoo.rs -Zmetrics-dir=d2/m --emit=metadata --out-dir d2`, `d2/m` absent):

```
error: cannot dump feature usage metrics: No such file or directory (os error 2)

error: aborting due to 1 previous error

```

The oracle exits **1** and leaves `d2/liblibfoo.rmeta` and no `rmeta*` directory.

For driver-cli's follow-up, the path to port is:
- `IntoDiagArg` for `Box<dyn std::error::Error>`, through display: `compiler/rustc_error_messages/src/diagnostic_impls.rs:71`,
  in the `into_diag_arg_using_display!` list;
- the `UnstableFeatureUsage` diagnostic: `compiler/rustc_driver_impl/src/diagnostics.rs:111-115`,
  `#[diag("cannot dump feature usage metrics: {$error}")]`.

Once both are ported, this test exits 1, not 70, and must change again. That is a reason to pin "the metadata was
written" rather than "some stop".

## 4. `7418d6e1` (`src/std/fs.test.ts`)

**fcntl exact minimum** (`:299-312`):
- `free_from(200)` and `free_from(777)` return the lowest fd at or above each start that `fstat` reports closed;
  `expect(d).toBe(min)` keeps the check exact.
- **Mutation A:** fcntl declared `[I32, I32, FFIType.i64]`, without the stack padding (src/std/fs.ts:113): **fail**.
- **Mutation A2:** `...pad(5)` instead of `...pad(6)`: **fail**. In both, the try_clone test fails too.
- A lost or misplaced variadic is still caught.
- The race window between the check and `fcntl` needs another thread to be handed fd ≥ 200 as its lowest free fd. That
  is not credible.

**try_clone in a child** (`:320-334`):
- **Mutation B:** `try_clone`'s minimum 3 changed to 0 (src/std/fs.ts:384): 12 pass, **1 fail**, matching root's note.
- **Safety:** fd 0 is closed only in a child that `close(0)` checks was open (`stdin: "ignore"`). The test process's own
  fds are never touched, so the old clobber risk is gone.
- **Flakiness:** a child thread opening an fd between `close(0)` and `try_clone` could only hide a regression, never fail
  a correct port. `expect(stderr).toBe("")` would fail if Bun printed a warning in the child; none appeared in 5 runs or
  in the gate-style step.
- **5 runs** of `bun test ./src/std/fs.test.ts`: 13 pass, 0 fail each time.

## 5. Unit steps as the gate runs them (`unitStaticSteps`, scripts/gate.ts:402)

I ran these from the scratchpad with a small driver that calls `unitStaticSteps(u, runDir)` and runs each step's
`cmd`/`env` through `scripts/lib/common.ts` `run`, as `runStaticStep` does. Load was 1-5 on 12 cores.

| step | exit | time | result |
|---|---|---|---|
| runner unit tests (`./scripts ./harness`, one process) | 0 | 64 s | 446 pass, 0 fail, 0 skip (45 files) |
| unit tests (`./src ./tools`, `--parallel=4`) | 0 | 342 s | 7452 pass, 1 skip, 0 fail (635 files) |
| unit tests (alone) | 0 | 89 s | 39 pass, 0 fail (4 files) |

The one skip is `read_binary_file_handles_lying_stat` (src/rustc_span/source_map/tests.test.ts), which is in the gate's
`ALLOWED_SKIPS` (scripts/gate.ts:252). The total, 7453 tests, matches root's u50b report.

**`late_passes_e1` "deref_into_dyn_supertrait: `Deref` for a non-`dyn` type".** I did not see it: it passed in my gate-style run (0.85 s, 2 assertions).

The cause of root's failure is a Bun crash, not this lint. Root's report is `$RUST_TS_DATA/tmp/w40/u50b-unit-tests.junit.xml`
(05:33, the run after the fix; `u50/` is the run before it). It holds one failure, the stderr equality of this case, and
the subject's stderr is Bun's own crash banner:
- `Bun v1.4.3 (c6da4a4d3) macOS Silicon ... Args: ".../src/rustc_lint/late_oracle/run.ts" "--late-pass=deref_into_dyn_supertrait.ts:DerefIntoDynSupertrait" ...`
- `panic: Trap instruction at address 0x1055332A8`
- `oh no: Bun has crashed. This indicates a bug in Bun, not your code.`
- `Builtins: "bun:ffi" ...`, `Elapsed: 690ms`.

The case is a "no diagnostic" one, so any byte on our stderr fails it. The crash is in Bun's runtime, 0.7 s into a short
compile, and none of these commits touch that code. It is the only `Bun has crashed` in the junit reports of the past
week under `$RUST_TS_DATA/runs` and `tmp/`. So it is intermittent and Bun-side, not an integration defect. The
`bun.report` link in that report encodes the stack, for whoever takes it up; I did not open it.

A separate weakness of the file: `WORK` (`late_passes_e1.oracle.test.ts:32`) is
`$RUST_TS_DATA/tmp/lint-late-e1-oracle/${RUST_TS_AGENT ?? "default"}`. Two sessions with `RUST_TS_AGENT` unset share it,
and each truncates and rewrites `case<i>.rs` and `case<i>.rmeta` there. That did not cause this failure: the stderr
shown is a crash, not a mismatch. It is one more way two concurrent unit runs can disturb each other (N6).

**N6 (shared scratch directories).** About 40 oracle test files key their scratch directory on
`RUST_TS_AGENT ?? "default"`. A gate's unit step running while another session's ad-hoc unit run uses the same
directory can race on the per-case files. For root's queue, not this batch: a per-process `mkdtemp` under that
directory would remove the race.

## 6. `bunx tsc`

Exit 0, no output.

## Summary of nits

- **N1** `scripts/subject-bin.cases.ts:191`: comment stripping fails open on `//` or `/*` inside strings (M7, M8). Use
  `Bun.Transpiler` to strip.
- **N2** `scripts/subject-bin.cases.ts:196`: aliased `cc` and `cc_or_unported` imports are not seen (M5, M6). Refuse
  `as` and destructuring renames.
- **N3** `scripts/subject-bin.cases.ts:192-195`: the tinycc.ts branch ignores `cc_or_unported(` calls in that file (M9).
- **N4** `src/rustc_interface/metadata_temp_dir.test.ts:40`: a stop before encoding passes vacuously (shown by
  mutation). Assert `d2/liblibfoo.rmeta` exists.
- **N5** `src/rustc_interface/metadata_temp_dir.test.ts:36`: "warning" should be "error". The oracle gives
  `error: cannot dump feature usage metrics: ...` and exit 1. Port `IntoDiagArg for Box<dyn Error>`
  (rustc_error_messages diagnostic_impls.rs:71) and `UnstableFeatureUsage`.
- **N6** shared `RUST_TS_AGENT ?? "default"` scratch directories in the oracle tests (root's queue).

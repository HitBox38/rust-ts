APPROVE WITH NITS

# Review: harness batch `harness-w50` (wave 40j)

Branch `t3/harness-runtime-c-key`, commits `54a27846` (item 1), `d030bcb8` (item 2), `e7fd5da0` (item 3) and `169bff08` (handoff),
against merge base `0ce28aa2`. This is an independent, read-only review: I edited no code. I ran the checks below on a detached
checkout of `169bff08`, in source mode, on AC power, with `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`.

There are no must-fix findings. Every claim in the handoff that I could reproduce held:
- mir-opt-o4 gives 406 MATCH, with every protected id MATCH.
- The oracle-key dump matches the handoff exactly.
- A dump byte broken on the subject side turns the case DIFF.
- The unit steps, `tsc` and the probe checks are clean.

I have four nits. N1 and N2 concern item 3's "impossible to fail on noise". Neither can fire at the pin today, and both are
cheap to close.

## Findings (must fix)

None.

## Nits

- **N1. The `$DUMP_DIR` mask breaks the size line it sits under, so the safeguard gives a false DIFF instead of preventing one.**
  `scripts/mir-dump-run.ts:97` prints `--- <path> (<bytes.length> bytes)`, the size of the *raw* file, and then prints the
  *masked* text. The two sides' dump dirs differ in length: `oracle` has 6 characters, `subject` has 7. So a dump that names its
  own dump dir prints the same masked text on both sides, but sizes that differ by one byte per occurrence.
  Evidence: I called `dumpReport` on `…/mir-opt-o4/oracle/0123456789abcdef` and on `…/subject/0123456789abcdef`, each holding
  `x.mir` = `// written to <its dir>/x.mir\n`. The results were `--- x.mir (186 bytes)` and `--- x.mir (187 bytes)`, with the
  same `// written to $DUMP_DIR/x.mir` text: not equal.
  The test pins the raw size (`harness/mir-dump.test.ts:117`, `Buffer.byteLength(text)` of the unmasked text) and covers only
  one side, so it does not see this.
  It is latent. No dump at the pin contains its dir: the cached oracle text has no `/Users` path and no `$DUMP_DIR`, and the lane's
  `diff -rq` of the two real trees was clean. But the handoff calls the mask "a safeguard", and as written it would turn that
  case into a lost protected case on a later pin.
  Fix: print `Buffer.byteLength(masked)`, which still tells whether a final newline was added. Then add a test that reports the
  same tree under an `oracle` and a `subject` dir and expects equal strings.
- **N2. The compiler is not a holder of the case lock, unlike the other fixed-directory wrappers.** `scripts/host-rlib-run.ts:121`,
  `scripts/ir-run.ts:97` and `scripts/rlib-native-run.ts:132` each register their compiler with `addLockHolder`.
  `host-rlib-run` was made to do this by review harness-w46 N3. `mir-dump-run.ts:107-108` empties the dir and spawns the compiler
  without doing so.
  - If a difftest is killed with SIGKILL, its wrapper dies and the compiler keeps writing into `<side>/<16 hex>`. The next
    difftest takes the case lock (owner dead), and its wrapper empties the dir while the orphan still writes there.
  - On the oracle side, that mixed tree, or exit 2 from a `readdirSync` race in `dumpReport`, is written to the oracle cache,
    and the case then DIFFs until the entry is removed.
  - Also, `scripts/subject-bin-bench.ts:92` runs `s.subject([c])` outside any case lock, so a bench of mir-opt-o4 during a gate
    can empty the gate's subject dump dir.

  Both need an unusual coincidence on a one-second oracle run. The fix is the existing pattern: a `<dir>.lock` held by the
  wrapper, with `addLockHolder(lock, p.pid)`.
- **N3. Death by signal collapses to exit 128 for every signal except INT, KILL and TERM.** `scripts/mir-dump-run.ts:102,117`:
  `128 + (SIGNALS[p.signalCode] ?? 0)`.
  - Before this batch, difftest saw Bun's own code for the compiler. I checked that `Bun.spawn(["sh","-c","kill -ABRT $$"]).exited`
    resolves to 134, with `signalCode` `SIGABRT`.
  - Now SIGABRT, SIGSEGV and SIGBUS all give 128. So an oracle that aborts and a subject that segfaults compare equal on `code`,
    and only the text separates them.
  - No mir-opt-o4 case dies by signal at the pin (406 MATCH, so nothing changed in practice). The same map is copied in four other
    wrappers.

  Fix, here or in a batch of its own for all five: `128 + os.constants.signals[p.signalCode]`.
- **N4. The `cc(` guard can be bypassed in two ways.** `scripts/subject-bin.cases.ts:184` scans only files whose text contains
  `bun:ffi`.
  - A helper that re-exports `cc` (`export { cc } from "bun:ffi"`) lets another module call
    `cc({ source: join(import.meta.dir, "x.c") })` unseen.
  - An aliased import (`import { cc as tcc } from "bun:ffi"`) counts 0 `cc(` calls.

  The prefilter is not needed. In the tracked tree, only `src/rust_ts/proc_macro_host.ts` and `src/std/thread.ts` contain a
  `cc(` call at all (`(^|[^A-Za-z0-9_$])cc\s*\(` over every non-test `.ts`), so dropping it costs no false alarms. Also failing on
  `\bcc\s+as\b` closes the alias. Only `.ts` files are scanned; no `.js`, `.mjs` or `.tsx` is tracked under `src/` today.

## Checks

### Item 3: mir-opt-o4 compares its dump tree

- **Reproduced the run.** `bun scripts/difftest.ts --suite mir-opt-o4 --jobs 6` on `169bff08` (run `20261111-025731-review-w50-pu3a`)
  gave total 406, MATCH 406, 0 of any other status, skipped 10. All 406 ids of `harness/baseline/mir-opt-o4.txt` are present and
  MATCH. The oracle side came from the cache the lane's run filled under the new keys, so that run's oracle tree and my run's
  subject tree agree. That is two separate processes, a basic check of determinism.
- **A broken dump byte turns DIFF.** This is a scratch script, with no code edited. I took the cached oracle entry of
  `tests/mir-opt/dump_dataflow.rs` (`oracle-cache/f7/f77cb372…`, 138 files in its report). I ran the suite's subject command as
  is, and again with a shim inserted after `--` that runs the compiler and then overwrites the first byte of the first sorted
  `.mir` file in its `-Zdump-mir-dir`. `classify` against the cached oracle gave **MATCH** for the plain run and **DIFF** for the
  mutated one.
- **Can a case pass while its dumps differ?** No, apart from N1's direction (which only DIFFs).
  - Every regular file is listed, sorted, with its size and its full text (or a sha256 if it is not UTF-8).
  - The report goes to stdout after the compiler exits, and `render` compares stdout, stderr and exit code exactly.
  - Things not compared: empty directories, a symlink's target ("not a regular file") and file modes. rustc's dumps make none of
    these.
  - The only masking is the dump dir itself, so text can match only when it differs by that path.
- **Determinism.**
  - The file names are rustc's `<crate>.<item>.<pass>…` names (e.g. `dump_dataflow.main.3-2-037.ReorderLocals.before.mir`),
    with no pid or hash.
  - The cached text has no absolute path and no date.
  - The order is `Array.prototype.sort` by UTF-16 code unit over relative paths, independent of `readdir` order.
- **No dump dir, or a crash before writing.** The dir is removed first, and `dumpReport` prints nothing when no file exists. A
  crash before writing gives the compiler's own output and exit only, as before this batch. If the oracle dumps and the subject
  dies first, the case DIFFs, because the report is missing. The run test covers a failing compile that writes, and a run that
  writes nothing.
- **Lock.**
  - `caseLock` is `tmp/mir-opt-o4/<16 hex>.case.lock`, beside the side dirs and outside what the refusal pattern lets the
    wrapper delete.
  - difftest takes it around both sides, which then run one after the other (`scripts/difftest.ts:1131-1136`), and around a
    subject timeout's re-run (`:1171`).
  - It is a cross-process `O_EXCL` file under the shared `$RUST_TS_DATA`, so a gate and a reviewer's difftest of one case wait
    for each other.
  - Gaps: N2.
- **Signals.** difftest's timeout is `proc.kill()` (SIGTERM, `scripts/lib/common.ts:114`), and the wrapper passes it on to the
  compiler.
- **Gate.** `oracleRuns` parses the wrapper and returns `["rustc"]`. I ran `checkProbes(<every protected suite>, true)`: it
  returned true. `undeclaredRuns` is empty over all of `SUITES`.
- **Mutants I ran**, each restored after:
  - the `oracleRuns` branch deleted: `harness/mir-dump.test.ts` 1 fail;
  - the report not printed: 1 fail.

### Oracle keys

`bun scripts/oracle-keys.ts --out` on a `git archive` of `0ce28aa2`, then on `169bff08`:

| | keys | sha1 |
|---|---|---|
| before | 372,681 | `d4ab0b6119beb5615138207542912f0327b053ec` |
| after | 372,681 | `22796868a73ea70c6a31a608c5ec60463bac721a` |

Both sha1s equal the handoff's. By (suite, id): **0 lost, 0 new, 406 changed, all in `mir-opt-o4`.**
- The key no longer holds the worktree path. `oracleVersion` now hashes the Bun binary, and `oracleKey` hashes the wrapper's
  bytes and the oracle `rustc_driver`. The command line itself is not in the key. So the gate's root checkout gets the same keys
  as the lane's checkout.
- One side effect: a Bun upgrade re-runs these 406 oracles, as it already does for the other wrapper suites.

### Item 2: run-time C in the subject-bin key

- The tracked `.c` files:
  - `src/std/thread.c` and `src/rust_ts/proc_macro_host.c` (both keyed);
  - `src/std/sync/mpsc_test_echo.c` (named only by `mpsc.test.ts`);
  - five under `harness/corpus/rlib-native/c/` (compiled by the suite's runner for both sides, not by the subject).

  There is no `.c`, `.h`, `.m` or `.cc` file under `src/miri` or `tools`. The `src/miri` FFI (`host_libm.ts`, `shims/math.ts`)
  only `dlopen`s system libraries. No subject module spawns `cc`, `clang` or `gcc`.
- The key (`v: 3`), `meta.json` and the post-build re-check all match the handoff. Mutant: `proc_macro_host.c` dropped from
  `RUNTIME_C_FILES` → `scripts/subject-bin.test.ts` fails, with the guard test and the header test both naming it.
- Guard gaps: N4.

### Item 1: harness-w49 N1–N4

- **N1.** A table that names none of the parsed optional `LLVMInitialize*TargetInfo` symbols gets the string (undecided)
  branch, and `@VER`/`@@VER` is cut at the first `@` after position 0. Tests cover an empty table, a table without TargetInfo,
  and versioned names.
- **N2.** The `gateRun` env-refusal test is present.
- **N3.** `shownFindings` adds a "more" line per list.
- **N4.** The header comment explains whose LLVM is read.
- All match the w49 review's requests. The oracle-key dump shows no minicore key moved.

### Unit steps and tsc

- `bunx tsc --noEmit -p .` is clean.
- I ran `unitStaticSteps` and `runStaticStep` from `scripts/gate.ts`, one at a time, in a scratch run dir:

| step | tests | failures | skipped | time |
|---|---|---|---|---|
| runner unit tests | 442 | 0 | 0 | 65 s |
| unit tests (src/tools) | 7421 | 0 | 1 (allowlisted) | 343 s |
| unit tests (alone) | 39 | 0 | 0 | 91 s |

  The first runner attempt wrote no junit report, because I had not created the run dir; the gate creates it. The re-run with
  the dir in place is the one in the table.

Scratch removed: my run dir, the key dumps, the junit files and the `git archive` copy.

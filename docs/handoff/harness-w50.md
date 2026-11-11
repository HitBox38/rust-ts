# harness-w50 (wave 40j): harness-w49 nits, run-time C in the subject-bin key, mir-opt-o4 compares its dump tree

Harness batch: `harness/` and `scripts/` runner code and tests only. No `src/`, baseline, oracle output or expectation change.
Item 3 changes what MATCH means for the protected suite `mir-opt-o4` and changes its 406 oracle keys (measured first: all 406
still MATCH; details below).

## Files touched

| file | what |
|---|---|
| `harness/compiletest.ts` | `llvmComponentOracle`: a table with no `LLVMInitialize*TargetInfo` symbol is undecided (N1); `nmSymbols` drops `@VER`/`@@VER` (N1); header comment on whose LLVM is read (N4) |
| `harness/compiletest.test.ts` | empty / TargetInfo-less table and versioned-name cases in the harness-w49 test |
| `scripts/gate-power.test.ts` | `gate()` takes extra env; a test that `gateRun` refuses with `gateEnvRefusal`'s joined text (N2) |
| `scripts/subject-bin-compare.ts` | `shownFindings`: 5 errors and 5 notes, each list with its own `... N more` (N3) |
| `scripts/lib/subject-bin.ts` | `RUNTIME_C_FILES`, `runtimeCInputs`; key v3 adds `runtimeC`; `meta.json` records it; re-checked after the build (w40i-audit N1) |
| `scripts/subject-bin.cases.ts` | N3 test; run-time C key, scan and fixture tests |
| `scripts/mir-dump-run.ts` | new: the wrapper both sides of `mir-opt-o4` now run (item 3) |
| `harness/suites.ts` | `mir-opt-o4` runs through the wrapper: `MIR_DUMP_RUN`, `mirOptDumpPath`, `mirOptDumpRun`, `caseLock`, `oracleKey`; description and header line. `mirOptDumpDir` removed |
| `scripts/gate.ts` | `oracleRuns` reads the wrapper's compiler (so `undeclaredRuns` sees `rustc`) |
| `harness/mir-dump.test.ts` | new: the suite's commands, the wrapper's parse, refusal, report and run |
| `harness/m7-suites.test.ts` | the mir-opt-o4 dump-dir assertion reads the wrapper's `--dir` |

## Item 1: harness-w49 review N1-N4

- **N1.** `llvmComponentOracle` now treats a symbol table that names none of the 19 `LLVMInitialize<T>TargetInfo` initializers
  as unusable. That covers an empty or stripped table, or an LLVM linked in with its local symbols stripped. Every optional
  component is then undecided, so the test is rejected (a skip) with the reason "the oracle's rustc_driver symbol table names no
  `LLVMInitialize*TargetInfo` function, so it does not show its LLVM components". Required components still continue.
  `nmSymbols` also drops a GNU `nm` symbol version (`@LLVM_23.1`, `@@LLVM_23.1`). I did not add the review's other option (no
  initializer *for the host's own architecture*), since the brief asks for the no-initializer rule. On the root host nothing
  changes: all 19 initializers are present, and the oracle-key dump shows no minicore key moved.
  Tests: an empty table, a table with only a non-TargetInfo LLVM symbol, and versioned names. Mutants: the rule off → fail;
  the version strip off → fail.
- **N2.** `scripts/gate-power.test.ts` starts a real `gateRun` with `NODE_ENV=test` and `REGEN=1` and expects one `ERROR:` line
  matching `NODE_ENV=test set: …; and REGEN=1 set: every unit test would inherit it`, with no pmset read and no gate.json.
  Mutant: `scripts/gate.ts:603` back to `freezeEnvRefusal() ?? unitEnvRefusal(process.env)` → fails.
- **N3.** `shownFindings(lines, notes, out)` prints the first 5 of each list and then `... <n> more[ in <out>]` for each list that
  has more than 5, as before harness-w49, now per list. Test: 7+0, 5+6, 6+7, 5+5. Mutant: the old `lines + notes > 10` rule →
  fails.
- **N4.** The compiletest header says the oracle's LLVM is read, not one built for COMPILETEST_TARGET, and why. The oracle
  compiles the case, and CI builds the same `LLVM_TARGETS_TO_BUILD` for every dist host.

## Item 2: run-time C in the subject-bin key (w40i-audit N1)

- Scan: in the tracked tree, `bun:ffi`'s `cc` is used by exactly two non-test modules: `src/std/thread.ts` → `thread.c` and
  `src/rust_ts/proc_macro_host.ts` → `proc_macro_host.c`. `src/std/sync/mpsc_test_echo.c` is compiled only by
  `src/std/sync/mpsc.test.ts`, never by the subject. Neither keyed file has a local `#include "…"`.
- `RUNTIME_C_FILES = ["src/std/thread.c", "src/rust_ts/proc_macro_host.c"]`, sits next to `CONFIG_FILES` and is hashed the same
  way (`absent` when missing).
  - It is in the key (`subjectBinKeyOf`, now `v: 3`, with `runtimeC`) and in `meta.json`.
  - After the build it is re-checked like the config files: a change during the build stops it with "`<path>` changed while
    `<entry>` was being built".
  - It is not part of `staleConfigs`. Bun does not cache the C; the binary compiles it from the tree at run time.
  - Every listed file is keyed for both entries (`main.ts`, `miri.ts`). For miri this is a little more than it needs, but it
    is simple and never wrong.
- What this guarantees: a build's hash now names the C its binary compiles, provided the tree is not edited after the build.
  The gate already checks that with `git status` at start and end. The binary still reads the working-tree C at run time, as
  in source mode.
- Every subject-bin key changes once, because this file's own source is in the key anyway. The next binary-mode gate builds both
  entries anew (about 160 MB each). I built no real entry here; the fixture tests exercise the builder.
- Tests (`scripts/subject-bin.cases.ts`):
  - each run-time C's content or absence changes the key;
  - fixture: a C edit makes a new build (with the bundled files back to the first build's, so only the C differs), and an edit
    during the build stops it and leaves the cache as it was;
  - **the guard**: every `cc(` call in a tracked non-test `.ts` must read as `cc({ source: join(import.meta.dir, "<file>") …`
    (else the test fails, naming the file), and the files found must equal `RUNTIME_C_FILES`;
  - every other `.c`/`.h` under `src/` may be named only by test files, and keyed files may not include local headers.
  - Mutants: `runtimeC` dropped from the key → 2 fail; the post-build re-check dropped → 1 fails; `proc_macro_host.c` dropped
    from the list → 2 fail.

## Item 3: mir-opt-o4 compares both sides' `-Zdump-mir-dir`

### What the comparison is

`scripts/mir-dump-run.ts --dir <dump dir> -- <compiler argv>`:
- empties `<dump dir>`;
- runs `<compiler argv> -Zdump-mir-dir=<dump dir>`, with the flag last as before, its stdout and stderr inherited and its exit
  code passed on;
- then, if the compiler wrote any file there, prints `-Zdump-mir-dir: <n> file(s)` and, for each file sorted by relative path,
  `--- <path> (<size> bytes)` and its text. Non-UTF-8 files print a sha256 instead.

Because of this, the oracle cache holds the oracle's tree, and the subject's tree is compared byte for byte. The suite's dump
dirs stay `$RUST_TS_DATA/tmp/mir-opt-o4/{oracle,subject}/<16 hex>`. The tree is left there for `diff -r`. The suite now holds a
case lock (`tmp/mir-opt-o4/<16 hex>.case.lock`), as the dirs are fixed per case.

**Normalisation (decision):** only the dump dir itself is masked, spelled `$DUMP_DIR` in file text. I checked compiletest's
mir-opt mode (`runtest/mir_opt.rs` `check_mir_dump`): it runs `normalize_output` on a dump before comparing it with the
checked-in `.mir`/`.diff`. That normalisation spells machine paths (`$DIR`, `$SRC_DIR`, …) so that a dump made on one machine
compares with a file blessed on another. Here both sides run on one machine, in one cwd, with the same argv except the dump
dir. Byte identity is the stronger check, and that normalisation could only hide a difference. No dump at the pin contains its
dump dir anyway; the mask is a safeguard.

### Measured first

1. As a separate report suite (`mir-opt-o4-dumps`, same cases and argv, its own dump dirs), `difftest --jobs 6` (run
   `20261111-023247-harness-w50-8aeh`): **total 406, MATCH 406**, 0 of any other status. All 406 protected ids of
   `harness/baseline/mir-opt-o4.txt` were present and MATCH. A first attempt was discarded and re-run with fresh keys: I had
   mutation-tested the wrapper while that run was using it.
2. Only one case writes a dump at the pin: `tests/mir-opt/dump_dataflow.rs` (`-Z dump-mir=main -Z dump-mir-dataflow`), 138
   files (124 `.mir`, 13 `.dot`, 1 `.html`). The oracle's and the port's trees are identical (`diff -rq`). `graphviz.rs`
   (`-Z dump-mir-graphviz` without `-Zdump-mir`) writes none. The other 404 cases print nothing extra, so their output is
   unchanged.

All 406 MATCH, so I folded the comparison into `mir-opt-o4` itself and removed the report suite. Confirming run of the folded
suite, `difftest --suite mir-opt-o4 --jobs 6` (run `20261111-023743-harness-w50-01bm`): **total 406, MATCH 406**, every
protected id MATCH, both dump trees 138 files and identical.

### The oracle-key change

`bun scripts/oracle-keys.ts --out` before (a `git archive` of `0ce28aa2`) and after (this branch's final tree):

| | keys | sha1 |
|---|---|---|
| before | 372,681 | `d4ab0b6119beb5615138207542912f0327b053ec` (= harness-w49's "after") |
| after | 372,681 | `22796868a73ea70c6a31a608c5ec60463bac721a` |

By (suite, id): **0 lost, 0 new, 406 changed, all 406 in `mir-opt-o4`.** Every other suite's keys are byte-identical, so items
1 and 2 moved no key. The 406 change because the oracle command is now the wrapper: `oracleVersion` reads its first word, now
Bun rather than `rustc`, and the suite gained an `oracleKey` (the wrapper's source and the oracle `rustc_driver` hash). **Yes,
it re-runs the oracle**, once, for all 406 cases. My confirming run already filled the shared oracle cache under the new keys.
Those keys are the same once this branch is merged (same wrapper bytes, same pin), so the gate should hit the cache. If the
cache is cold, the 406 oracle compiles are small: the whole suite took 146 s on both sides at `--jobs 6`.

Tests (`harness/mir-dump.test.ts`, `harness/m7-suites.test.ts`):
- the suite's commands are the wrapper with mir-opt-o4's case argv unchanged (equal to `mirOptCases`);
- distinct dirs per case and side, the case lock, `oracleRuns` = `["rustc"]`, no undeclared run;
- the wrapper's parse and its refusal (only an absolute `<...>/mir-opt-o4/oracle|subject/<16 hex>` is ever emptied);
- the report: sorting, masking, no final newline, an empty file, non-UTF-8, a symlink, an empty tree printing nothing;
- a run with a stub compiler: stale files removed, output and exit passed through, the tree printed after a failing compile
  too, nothing printed when nothing was written, and a refused dir that removes nothing.
- Mutants: report not printed, mask off, dump dir not emptied, refusal off, gate `oracleRuns` branch removed → each fails.

## Evidence

- `bunx tsc --noEmit -p .`: clean.
- Unit steps as the gate runs them (`unitStaticSteps` + `runStaticStep` from scripts/gate.ts, one at a time, parent with
  `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`, source mode):

  | step | tests | failures | skipped | time |
  |---|---|---|---|---|
  | runner unit tests | 442 | 0 | 0 | 66 s |
  | unit tests (src/tools, workers) | 7421 | 0 | 1 (allowlisted: `read_binary_file_handles_lying_stat`) | 447 s |
  | unit tests (alone) | 39 | 0 | 0 | 140 s |

  Runner 442 = 436 (harness-w49) + 1 (gate-power N2) + 5 (`harness/mir-dump.test.ts`). The N3 and item 2 tests are inside
  `scripts/subject-bin.cases.ts`, which runs as one runner test (37 cases inside).
- Oracle-key dump: above.
- Load was 20-33 during the unit steps (other lanes on the machine).

## `unported(...)` and `// PORT:`

None. This is harness code, not a port.

## Notes for root

- Commits: item 1 is `54a27846`. Item 2 is `d030bcb8`; that commit also carries item 1's N3 test, as both live in
  `scripts/subject-bin.cases.ts`. Item 3 is `e7fd5da0`; this handoff is the commit after it.
- The next binary-mode gate rebuilds both subject builds (new key format). The next gate's `mir-opt-o4` uses the new oracle
  keys; the cache is warm from this lane's run.
- `mir-opt-o4` is protected, so this batch changes a protected suite's runner. It needs the usual review.
- Scratch removed: `tmp/mir-opt-o4-dumps`. My run dirs under `$RUST_TS_DATA/runs` (`*-harness-w50-*`) can go after review.
  The `mir-opt-o4-dumps` oracle-cache entries (406, small) are orphaned. No subject build was made at my worktree path.

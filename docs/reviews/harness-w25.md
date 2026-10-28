ACCEPT-WITH-NOTES

# Review: harness-w25 (`lane/harness-w25`, `7f2d6592..8e44765c`)

Reviewer: review-harness-w25 (independent, read-only on `.data/lanes/harness-w25`, HEAD `8e44765c`, clean tree).

All scratch work is under `.data/scratch/review-hw25/`:
- `base/` and `head/` are `git archive` copies of the two trees.
- `tools/` holds my own tools: `reg.ts` (registry hash + dump), `cmp.ts`, `an.ts` / `an2.ts` (argv analysis),
  `unst.ts` (unstable re-runs), `dropo.ts` (the `-o` equivalence check), `slow.sh`.
- `cwd/` is a private compile cwd (`tests` -> upstream `tests`), used for every oracle run that might write.
- `out/` holds the registry hashes, the case dumps and per-case results (`dropo.jsonl`).
- Difftest runs are `.data/runs/rv25-*`, all under `RUST_TS_AGENT=review-harness-w25`.

**Scope:** 5 files.
- `harness/suites.ts`: one appended block (195 lines added, 0 removed).
- `scripts/unstable.test.ts`: 10 lines added, 2 changed (a comment, and the `withUnstable` expectation).
- The handoff and 2 decisions in `docs/state/`.
- No baseline, oracle output, probe, runner script, `src/` file or existing suite changed.

## 1. Existing suites unchanged: verified
- **Method:** `tools/reg.ts` imports `<tree>/harness/suites.ts` in its own bun process, once for base and once for
  head, with the same data dir. This is my own tool. It is stricter than hw23's: functions are hashed by their full
  source text, not by its length.
- **What it hashes, per suite:**
  - metadata: milestone, description, mode, timeouts, cwd, probes, `readsOnlyCaseFile`, key set and subset names;
  - `skipped()`, `unstable()` and the case order;
  - for batch suites, the batch commands;
  - per case: `{case, oracle([c]), subject([c]), subset membership, blessed(c)}`, with the tree root normalised.
- **Result:** all 30 existing suites are identical (333,456 cases). The only additions are `mir-minicore` (46),
  `mir-o0` (46), `mir` (21526) and `thir-tree` (1860).
- **Shared runner:** no file under `scripts/` changed except the test. difftest, gate, env and the unstable code are
  byte-identical to base. The gate only diffs suites that have a baseline, so the four new suites change no gate run
  until root accepts one.

## 2. Suites against plan §4 and D14: verified
My own comparison (`tools/an.ts`, `an2.ts`) checks every new case against its source suite at head. It compares id,
file, env, key set and order, and requires the args to be exactly the source args with compiletest's `-o <path>` pair
removed and the appended flags added.

| suite | source | cases | mismatches | `-o` dropped | skips | oracle / subject |
|---|---|---|---|---|---|---|
| mir-minicore | tydump-minicore | 46 | 0 | 3 | equal (589) | `rustc +nightly <args>` / `bun src/rust_ts/main.ts <args>` |
| mir-o0 | tydump-minicore | 46 | 0 | 3 | equal | same; `-Zmir-opt-level=0` comes last |
| thir-tree | thirdump-ui | 1860 | 0 | 216 | equal (15) | same |
| mir | hir-tree | 21526 | 0 | n/a | none (hir-tree has 4) | same |

- **thir-tree's own `-Zunpretty`.** My first matcher only knew the `-Zunpretty=` spelling and flagged 3 thir-print
  cases. Those 3 spell it `-Z unpretty=...`, and the lane's `hasUnpretty` handles both spellings. No thir-tree case
  has two `-Zunpretty` flags. The modes are `thir-tree` ×1856 (1849 appended, 7 the tests' own), plus `thir-flat` ×3
  and `-Z unpretty=thir-tree` ×1, both the tests' own.
- **mir.** The 21522 shared cases have hir-tree's argv, with `-Zunpretty=hir-tree` replaced by
  `-Zwrite-long-types-to-disk=no -Zunpretty=mir`. The 4 extra cases are hir-tree's 4 skips. The argv has no
  compiletest flags at all: no `-o`, no `--out-dir`, no `--emit`.
- **Subsets.** `cg_clif` is exactly mini_core.rs and mini_core_hello_world.rs, the files the M4c gate names.
  thir-tree's subsets are thirdump-ui's.
- **Timeouts.** Subject 60 s and oracle 300 s, as in all three source suites.
- **D14: `-o` redirects the dump, and dropping it changes nothing else.**
  - Upstream: `write_or_print` (rustc_driver_impl pretty.rs:202) writes to `sess.io.output_file`, else to stdout.
    The `-Zunpretty` branch (lib.rs:281–293) returns after `pretty::print` + `write_dep_info`, before `emit_mir` and
    codegen.
  - On traits/alias/basic.rs, in my private cwd:
    - the suite argv prints 968 B on stdout;
    - compiletest's argv with the `build/...` directory missing exits 1 ("failed to write");
    - with the directory present, stdout is empty and the file holds the same 968 B.
  - `tools/dropo.ts` ran every one of the 222 dropped-`-o` cases twice in the private cwd (216 + 3 + 3):
    - once with the suite argv;
    - once with the source argv, the `-o` directory created, and the same appended flags.

    **222/222** have the same exit code and the same stderr, and suite-stdout equals the `-o` file. So dropping `-o`
    only moves the dump to stdout.
  - Afterwards the private cwd held only the 219 `-o` files: the runs without an out dir wrote nothing.
- **`--out-dir` handling is safe.** On this path `write_dep_info` (passes.rs:823):
  - writes dep-info only if `--emit` asks for it, and `assertNoOwnOutput` rejects that;
  - otherwise only `create_dir_all`s the out dir, which is under `build/`.

  No case passes `-Cincremental`, `-Zdump-mir*`, `-Zself-profile`, `--print`, `-Ztemps-dir` or `--emit=...=<path>`. The
  3 `--emit=link` / `--emit=mir` cases are never produced on this path.

## 3. Departures: verified, and I agree with all three
- **`-Zwrite-long-types-to-disk=no` on `mir`: compiletest passes it, and it is needed.**
  - compiletest passes it for every UI test: runtest.rs:1798, `TestMode::Ui`. It is already in every thirdump-ui and
    thir-tree argv.
  - The long-type path is `output_filenames(()).temp_path_for_diagnostic("long-type-{hash}.txt")`
    (rustc_middle ty/error.rs:307). With no `--out-dir`, that is the cwd, which is the upstream checkout.
  - I reproduced it on on_unimplemented_long_types.rs in my private cwd with the `mir` argv:
    - with the default or `=yes`, each run writes one `<stem>.long-type-<hash>.txt` into the cwd, and the hash
      differs between runs (`2154201220115491229`, `17368886601987334374`);
    - with `=no`, nothing is written, and stderr prints the full type (1228 B against 689 B).
  - The lane's data agrees: pass 2 (old argv) against pass 3 (new argv) differ in exactly 89 cases. Those are 14
    listed ICEs, 1 load timeout and 74 cases that its separate 88-case double run (`u88-a/b`) shows identical under the
    new argv.
  - The alternative, a per-case `--out-dir` under `build/`, would leave those 74 cases UNSTABLE. The departure is the
    right choice, and it is recorded.
- **Own `-Zunpretty` rules.**
  - thir-print keeps its own mode. That is exactly compiletest's invocation of those 11 tests. Appending
    `thir-tree` would turn the 3 `thir-flat` tests into tree dumps.
    - With `--impl shim --filter thir-print`: 11/11 MATCH.
    - The oracle's thir-flat.rs stdout has the flat format (it starts like the blessed `.stdout`; only the crate
      hash differs).
  - In the minicore hygiene tests, the last `-Zunpretty` wins.
    - `parse_unpretty` (rustc_session options.rs:1476) overwrites the slot: `*slot = Some(s.to_string())`.
    - Oracle check: `-Zunpretty=expanded,hygiene -Zunpretty=mir` on unpretty-debug.rs runs the MIR mode (analysis
      diagnostics: E0601, `requires sized lang_item`), not the expansion printer.
    - With `--impl shim --filter hygiene/unpretty-debug`: 4/4 MATCH.
    - Keeping them as MIR cases is consistent with the rest of the corpus.
- **Keeping `closures/supertrait-hint-cycle.rs`.**
  - I ran it alone with the exact `mir` argv, niced, at load average 37–104: 157 s wall, 99 s user + 5 s sys,
    exit 1, E0275, empty stdout. This matches the lane's "~120 s CPU".
  - The lane's pass 3 has it as the only timeout (300 s, at load 125–144). The next slowest cases take 43 s, 40 s,
    40 s and 16 s.
  - It fits the oracle's 300 s plus difftest's retry, and it is cached after its first success. Skipping it would hide
    a real case, and hir-tree kept a comparable one. **Agree.**

## 4. `unstable()` lists: verified, each entry is a nondeterministic oracle
- `tools/unst.ts` ran each of the 23 listed cases on the oracle twice, with the suite's exact argv, `caseEnv` env and
  the upstream cwd.
- **mir (14).** All 14 exit 101 on both runs, with the same stdout.
  - stderr differs between the runs, and is equal once `(<tid>) panicked` is normalised.
  - All 14 match `UNSTABLE_ORACLE_PATTERNS[0]` (thread id).
- **thir-tree (9).**
  - The 7 ICE ids behave the same way: exit 101, and they differ only in the thread id.
  - The 2 long-type tests exit 1. They differ only in the `long-type-<hash>` name, and match pattern 1.
    - These two tests pass their own `-Zwrite-long-types-to-disk=yes`. Their file goes to compiletest's
      `--out-dir`, under `build/`.
- **Nothing is hidden.**
  - Every listed case is also detected by difftest's patterns. The lists only document them: listed or detected, the
    status is UNSTABLE, never MATCH.
  - Every listed id is a case of its suite.
  - No unlisted case differs between the lane's runs. I re-checked its jsonl: mir pass 2 against pass 3, and
    thir-tree a against b (exactly the 9).
  - The lane's 50 other `ice:true` records in mir are const-eval `evaluation panicked` errors (exit 0/1), which are
    stable.
- **`unstable.test.ts` change.**
  - It only adds expectations: mir 14 and thir-tree 9, each with non-empty reasons, and thir-tree containing all 8
    M3 ids.
  - The `withUnstable` list grows from 3 to 5 exact entries. That is still an exact `toEqual`, not a loosening.
  - No existing assertion was removed or weakened. `bun test scripts/unstable.test.ts`: 1 pass, 58 expects.

## 5. Nothing written into the upstream checkout or outside `$RUST_TS_DATA`: verified
- **`git -C .data/rust status --short --ignored`** was empty:
  - after my unstable re-runs, which ran in the upstream cwd;
  - after all difftest samples.
- **`-o` and long-type checks.** Every oracle run that could write (the `-o` checks, the long-type check) ran in my
  private cwd. The 222 no-out-dir runs left nothing there (§2).
- **Outside `$RUST_TS_DATA`.** A `find -newer` over `/tmp` and `$HOME` (depth 2) after the shim/stub samples showed
  only unrelated tool files. The lane worktree and the main checkout stayed clean.
- **Samples:**

  | suite | port | shim | stub |
  |---|---|---|---|
  | mir-minicore | 12: 8 MATCH, 4 UNPORTED | 8/8 MATCH | 8 UNPORTED |
  | mir-o0 | 12: 8 MATCH, 4 UNPORTED | 8/8 MATCH | 8 UNPORTED |
  | thir-tree | 24: 11 MATCH, 13 UNPORTED | 8/8 MATCH (+ thir-print 11/11) | 8 UNPORTED |
  | mir | 24: 12 MATCH, 12 UNPORTED | 8/8 MATCH | 8 UNPORTED |

  - Port samples are `--sample` with seed `review-harness-w25`. Shim and stub use `--sample 8 --seed rv25x`.
  - There were 0 DIFF, 0 CRASH, 0 TIMEOUT and 0 UNSTABLE, and no `ERROR:` line.

## 6. Conventions: followed
- **Env.** Every case runs with `NOCORE_ENV` (`RUSTC_ICE=0`, `RUST_BACKTRACE=0`), or with the source case's env
  unchanged. `mir` goes through `pinSessionEnv`, like hir-tree. The scrub and the PATH pinning are the shared
  `caseEnv` / `oraclePinnedPathEnv`, untouched.
- **Skips.** Every skip carries its source suite's reason. `MIR_SKIPPED` is empty, with the re-measurement
  documented next to it, as plan §4 asks ("skips as hir-tree, re-measured").
- **Fail-loud checks.** `dropHarnessOutFile` and `assertNoOwnOutput` throw `ERROR:` while the case list is built.
  Neither fired on any case.

## Findings (ranked; none blocking)
- **N1 (root decision): protection of the report suites.**
  - Plan §4 makes `mir-o0` and `thir-tree` report only, so no share ever triggers their protection.
  - As in harness-w23 N1, recommend protecting them from their first accepted run. Otherwise thir-tree regressions,
    the only real-CLI check of the THIR path, go unprotected.
- **N2 (low): `docs/state/current.json` coverage.**
  - The lane's state records changed `coverage.ported` from 21360 to 21598.
  - This lane changes no `src/` file. `state.ts` copies the number from the shared `$RUST_TS_DATA/coverage.json`, which
    another lane last wrote.
  - At merge, keep main's value or recompute it. Do not take this one as this tree's.
- **N3 (informational): no out dir on 219 thir-tree and minicore cases.**
  - After the drop, the 219 run-* cases have neither `-o` nor `--out-dir`. So rustc's output dir is the cwd, the
    upstream checkout, as it already is for every `mir` and hir-tree case.
  - On this path nothing is written there (§2). The one observable effect is `write_dep_info`'s
    `GeneratedFileConflictsWithDirectory` check against cwd entries.
  - No new case's would-be output name collides with a directory in the checkout root. In `mir`, the only candidate,
    `unresolved/auxiliary/library.rs` (a bin crate), fails with E0601 in `analysis` before `write_dep_info`.
  - Oracle-observable, not a write. Nothing to change.
- **N4 (low, cosmetic): mir-o0's milestone.** It is `milestone: "M4c"`, where plan §4 says "M4c-1 (report)". The field
  is display-only (`difftest --list`), and the description says "report only".
- **N5 (informational): gate cost of `mir`.**
  - The slow oracle case (supertrait-hint-cycle.rs) took 157 s wall and 99 s user + 5 s sys, niced at load 37–104.
    It exits 1 with E0275 and empty stdout. Root should expect that case on the first gate run, and the port TIMEOUT
    on it, as the handoff says.
  - The suite adds 21.5k subject processes per gate (plan §6). Consider bundling the port first, or accepting that the
    first `mir` run is long.
- **N6 (informational): huge-static.rs.** The handoff's CRASH (`tests/ui/limits/huge-static.rs` exits 101 after the
  oracle's E0080) is a port bug for driver-m4 or the fixers. It is not a harness issue.

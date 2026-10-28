# Handoff: harness-w25 (M4c suites `mir-minicore`, `mir-o0`, `mir`, `thir-tree`; harness batch, needs an independent review)

Branch `lane/harness-w25`, base `7f2d6592`. No ported upstream code: no coverage numbers, no `// rustc:` markers, no
`// PORT:`, no `unported(...)` added. Baselines, oracle outputs, probes, runner scripts and existing suites are unchanged
(proof in §5). The four new suites start unprotected; root protects them through a gate run after review.

## Files touched
- `harness/suites.ts`: one appended block "M4c" (helpers `hasUnpretty`, `dropHarnessOutFile`, `assertNoOwnOutput`,
  `mirMinicoreCases`, `MIR_SKIPPED` (empty), `MIR_UNSTABLE`, `THIR_TREE_UNSTABLE`, `thirTreeCases`; four suites). Nothing
  else in the file changed.
- `scripts/unstable.test.ts`: the test pinned the list of suites that have an `unstable` list to the three existing
  ones. It now expects `mir` and `thir-tree` as well, and checks their lengths (14, 9), their reasons, and that
  thir-tree's list contains all 8 M3 ids. No existing assertion was loosened.
- `docs/state/{current.json,history.jsonl}`: 2 decisions (suites/D14; the `mir` argv and the own-`-Zunpretty` rules).
  Expect the usual merge conflict.

## 1. Suites
All four: real CLI, oracle `rustc +<toolchain> <args>`, subject `bun src/rust_ts/main.ts <args>`, mode single, cwd =
upstream checkout, env `NOCORE_ENV` (+ the case's own env, session variables pinned by `pinSessionEnv`), subject
timeout 60 s, oracle 300 s (+ difftest's 4x retry), no probes.

| suite | milestone | cases | skipped | unstable list | subsets | argv |
|---|---|---|---|---|---|---|
| `mir-minicore` | M4c | 46 (14 revision cases) | 589 (= tydump-minicore's) | none | `cg_clif` (2) | tydump-minicore's, minus compiletest's `-o` (3 cases), + `-Zunpretty=mir` |
| `mir-o0` | M4c (report) | 46 | 589 | none | `cg_clif` (2) | mir-minicore + `-Zmir-opt-level=0` (last, so it wins) |
| `mir` | M4c | 21526 | 0 | 14 | none | `stdArgs(f)` + `-Zwrite-long-types-to-disk=no` + `-Zunpretty=mir` + file |
| `thir-tree` | M4c (report) | 1860 (445 revision cases) | 15 (= thirdump-ui's) | 9 | as thirdump-ui: `typeck+traits` 1744, `rustc_dump` 119, `thir-print` 11 | thirdump-ui's, minus compiletest's `-o` (216 cases), + `-Zunpretty=thir-tree` unless the test passes its own `-Zunpretty` |

`thir-tree` also has `blessed` (`--report blessed`, report only), like every compiletest-argv ui suite. The minicore
suites have none, like tydump-minicore.

### D14 (the `-o` rule)
- harness/compiletest.ts `compileArgs` adds `-o build/<target>/test/ui/<dir>/<stem>[.<rev>]/a` for run-* tests (and
  `--out-dir` for the others). `dropHarnessOutFile` removes exactly that pair.
  - It only accepts a `-o` that comes before the harness's `-Znext-solver=coherence` and whose value has that
    `build/...` prefix and the `/a` suffix. Anything else throws `ERROR:` while the case list is built.
  - `--out-dir` stays. On this path, `write_dep_info` only creates the empty directory, under `build/`, which
    difftest's upstream check ignores.
- **Checked:**
  - On thir-tree `tests/ui/traits/alias/basic.rs` the oracle prints 968 B of THIR on stdout. With `-o /tmp/x/a` added,
    stdout is empty and the file holds the same 968 B.
  - With compiletest's `build/...` path, whose directory does not exist, the oracle exits 1 instead.
- **`assertNoOwnOutput`** throws `ERROR:` (at case-list time) for any case whose argv could still write a file. It
  rejects:
  - any remaining `-o`;
  - `--emit` with `dep-info` or a `=<path>`;
  - `-Zdump-mir*`, `-Zself-profile`, `-Zdump-dep-graph`, `-Ztemps-dir`, `-Zdump-mono-stats`, `-Zllvm-time-trace`,
    `-Zmetrics-dir`, `-Znll-facts` and `-Zdump-proof-tree`.

  No case in either corpus trips it. Three cases pass `--emit=link` (trait-bound-holds-for-ty-error-140303.rs#old/#next)
  or `--emit=mir` (traits/issue-97695-double-trivial-bound.rs). The `-Zunpretty` path never produces those
  (rustc_driver_impl lib.rs:281 returns before `emit_mir`/codegen), and the upstream checkout stayed clean.
- **Verified mechanically** (`.data/scratch/hw25/tools/d14.ts`):
  - mir-minicore 46/46, mir-o0 46/46 and thir-tree 1860/1860 cases have the same id, file, env and order as their source
    suite (tydump-minicore, thirdump-ui), and the same skips.
  - Their args are exactly the source args, minus the compiletest `-o` pair (3, 3 and 216 cases), plus the appended
    flags.
  - `mir`: all 21522 hir-tree cases have mir's args, with `-Zunpretty=hir-tree` replaced by
    `-Zwrite-long-types-to-disk=no -Zunpretty=mir`. mir has 4 more cases: hir-tree's skips.

### Own `-Zunpretty` flags (decision recorded)
- **thir-tree:** the 11 thir-print tests pass their own `-Zunpretty` (8 `thir-tree`, 3 `thir-flat`). They keep it, so
  each case is exactly compiletest's run of that test. Appending `-Zunpretty=thir-tree` would turn the 3 thir-flat
  tests into thir-tree dumps. A case outside thir-print with its own `-Zunpretty` throws `ERROR:`; there are none.
- **mir-minicore / mir-o0:** the 4 tests `tests/ui/hygiene/unpretty-debug*.rs` pass `-Zunpretty=expanded,hygiene`.
  - The appended `-Zunpretty=mir` comes after it and wins: `parse_unpretty` (rustc_session options.rs:1476) overwrites
    the slot.
  - So compiletest's argv stays untouched, and the cases are MIR cases like the rest of the corpus.
  - Under `mir` they fail as bins (E0601, no `main`), which is the oracle's behaviour.
  - If root prefers, skipping them instead is a one-line change.

### `mir` argv: `-Zwrite-long-types-to-disk=no` (decision recorded; reviewer please check)
- The plan says `stdArgs` + `-Zunpretty=mir` "as hir-tree". Unlike hir-tree, this mode type-checks the crate.
- With the default `-Zwrite-long-types-to-disk=yes`, every type error that names a long type writes
  `<stem>.long-type-<hash>.txt` into the cwd. The cwd is the upstream checkout.
  - My first two oracle passes left **242 such files from 74 cases** in the checkout root. All were mine (mtimes
    03:45–03:53, during the passes), and I deleted them; `git status --ignored` minus `build/` is empty again.
  - These writes would make difftest's upstream check fail every gate run.
  - The note in the output also names a hash of an interned type's address, so all 74 cases were UNSTABLE.
- With `no`, which is what compiletest passes, rustc prints the full type instead.
  - The 74 cases are then reproducible: identical across 3 runs.
  - Nothing is written.
- This is the only departure from hir-tree's argv.

### `mir` skips: re-measured, none needed
hir-tree's 4 skips were re-measured with this mode, together with suggestions/fn-to-method-deeply-nested.rs (182 s
under hir-tree), each with a 1500 s cap:

| file | `-Zunpretty=mir` |
|---|---|
| associated-consts/issue-93775.rs | exit 0, 0.1 s (1.1 KB MIR) |
| expr/if/expr-stack-overflow.rs | exit 0, 0.3 s (3.6 MB) |
| parser/survive-peano-lesson-queue.rs | exit 0, 0.2 s (617 KB) |
| try-trait/deep-try-chain-issue-153583.rs | exit 1, 1.9 s (E0277) |
| suggestions/fn-to-method-deeply-nested.rs | exit 1, 0.1 s (E0425) |

The hir-tree cost was the `{:#?}` tree, which this mode does not print.

Then every case was run (§2):
- No timeout at load average ~10.
- The slowest case is `tests/ui/closures/supertrait-hint-cycle.rs` (E0275 overflow). It takes ~120 s of CPU: 90–100 s
  wall with 4 jobs, 323 s wall alone at load average 67, and one pass at load average 125–144 hit the 300 s first try.
  That is within the 300 s + 1200 s retry, and it is cached once per oracle build.
  - **It stays**, as fn-to-method-deeply-nested.rs did in hir-tree.
  - Root: expect it to be the one slow oracle case on the first gate run. The port will TIMEOUT (60 s) on it if it gets
    that far.
- Every other case: < 6 s wall at load ~10, < 15 s at load ~100.

## 2. Oracle runs (reproducibility, distribution)
Method: `.data/scratch/hw25/tools/oracle.ts` runs each case with the suite's exact argv, `caseEnv(c.env)` and cwd, as
difftest does, and records per case the exit code, timing, and hashes of stdout and stderr. `cmp2.ts` compares two runs.

| suite | runs | exit 0 | exit 1 | exit 101 | stdout non-empty | timeouts | differing between runs | max wall |
|---|---|---|---|---|---|---|---|---|
| mir-minicore | 2 x all | 9 | 37 | 0 | 9 | 0 | 0 | 88 ms |
| mir-o0 | 2 x all | 9 | 37 | 0 | 9 | 0 | 0 | 148 ms |
| thir-tree | 2 x all | 845 | 1006 | 9 | 846 | 0 | 9 (all listed) | 12.2 s |
| mir | 3 x all (+ the 88 a 4th/5th time) | 7821 | 13690 | 14 | 8425 | 0 (1 at load 140, see above) | 14 ICE (listed) | see §1 |

- **mir:**
  - Passes 1 and 2 ran with the plan's argv, without `-Zwrite-long-types-to-disk=no`. 88 cases differed: 74 long-type
    notes and 14 ICEs.
  - With the final argv, those 88 were run twice more: the 74 are identical, and the 14 ICEs still differ.
  - Pass 3 then ran every case with the final argv, and was compared with pass 2. Exactly the 88, plus the one load
    timeout, differ. So the added flag changes nothing else.
  - 604 cases exit 1 with MIR on stdout: lint errors such as `#![deny(dead_code)]` do not stop the printing.
- **Unstable lists.** Every listed case differs only in `thread 'rustc' (<tid>) panicked` (or, for the 2 thir-tree
  long-type tests, the `.long-type-<hash>` note), and difftest's `UNSTABLE_ORACLE_PATTERNS` detects all 23 by itself
  (`tools/ice.ts`). The lists document them, as in mirdump-ui.
  - **mir (14):** these are tests that ICE with plain `stdArgs`:
    - broken-MIR validation: 7 simd tests and 3 mir/validate tests;
    - elaborate_box_derefs: borrowck-describe-field-generic-param-owned-box.rs;
    - CTFE: do_not_const_check.rs;
    - a typeck `bug!`: move-expr/name-resolution.rs;
    - track-diagnostics/track.rs, which ICEs on purpose.
  - **thir-tree (9):** thirdump-ui's 8 `M3_UI_UNSTABLE` ids, plus trait-bound-holds-for-ty-error-140303.rs#old, which
    ICEs in `normalize_erasing_regions` on this path; the probe stops before that point.
    - The 6 M3 ICE ids get a thread-id reason here instead of `M3_UI_SAME_ICE`. That root decision ("the port ICEs at
      the same point") was made for the probes, not for this path.
- Upstream checkout clean after every run except my first two `mir` passes (the long-type files, removed). No difftest
  run printed `ERROR:`.

## 3. Sample difftests (`RUST_TS_AGENT=root-f5de`, `--impl port`, `--jobs 4`, host load 60–140)
| suite | sample | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT | UNSTABLE | run |
|---|---|---|---|---|---|---|---|---|---|
| mir-minicore | all 46 | 37 | 0 | 9 | 0 | 0 | 0 | 0 | `hw25-mir-minicore-port` (cg_clif: 0/2, both UNPORTED) |
| mir-o0 | all 46 | 37 | 0 | 9 | 0 | 0 | 0 | 0 | `hw25-mir-o0-port` |
| thir-tree | 200 | 103 | 0 | 97 | 0 | 0 | 0 | 0 | `hw25-thir-tree-port` (blessed: PASS 102 / FAIL 92 / NOT_COVERED 6) |
| mir | 300 | 172 | 0 | 125 | 1 | 0 | 0 | 2 | `hw25-mir-port` |

- **Every MATCH is an error case:** oracle exit 1, empty stdout (cross-checked against the oracle runs:
  `tools/matchcodes.ts`). Every case where the oracle prints MIR or THIR is UNPORTED.
- **Where the port stops** (UNPORTED reasons):
  - **mir (125):**
    - `rustc_driver_impl::pretty::print (Mir: needs a TyCtxt)`: 80. This is driver-m4's pretty.rs Mir arm.
    - `rmeta decoder: Decodable for mir::Body<'static>`: 26. This is optimized MIR of std items, needed by the inliner
      / `cross_crate_inlinable`.
    - `LowerSliceLenCalls (pass not ported)`: 6 (mt-opt1).
    - `StableHash of Ty under while_hashing_spans`: 2.
    - `QueryKey for ty::Value (cache)`: 2.
    - `cross_crate_inlinable provider`: 2.
    - 7 singles: `EarlyBinder::iter_instantiated_copied`, a Binder `visit_with`, `Assume::from_const`, `Relate for
      ty::Expr`, `mir::Const::Unevaluated` (asm const), `hash_result` of `type_of`, `select_inherent_assoc_candidates`.
  - **mir-minicore:**
    - pretty print Mir: 4.
    - `mir_inliner_callees`: 3 (mt-inline).
    - `QueryKey for ty::Value (cache)`: 2. These are mini_core.rs and mini_core_hello_world.rs.
  - **mir-o0:** pretty print Mir: 7, `QueryKey for ty::Value`: 2. At level 0 the inliner does not run.
  - **thir-tree (97):**
    - `pretty::print (ThirTree: needs a TyCtxt)`: 57.
    - `mir_inliner_callees`: 30.
    - `Decodable for mir::Body`: 4.
    - `LowerSliceLenCalls`: 3.
    - 3 singles: `hash_result`, `IntoDiagArg`, `Debug` without a TS impl.
    - thir-tree reaches MIR passes because `analysis` runs `mir_drops_elaborated_and_const_checked` and CTFE.
  - So the analysis is already wired far enough that error cases match. The four stops above are the next steps for
    driver-m4, mt-inline, mt-opt1 and rmeta.
- **The CRASH** is `tests/ui/limits/huge-static.rs`: the port prints the oracle's E0080 and then exits 101 instead of 1.
  This is a port bug, not a harness issue. File: `hw25-mir-port/diffs/mir/tests__ui__limits__huge-static.rs.txt`.
- **Harness validation** (`RUST_TS_AGENT=harness-w25`, `--sample 40`): `--impl shim` gives **40/40 MATCH** on all four
  suites; `--impl stub` gives **0/40** (40 UNPORTED) on all four.

## 4. For the reviewer
- **D14:** is `dropHarnessOutFile` the right cut? It drops only compiletest's own `-o`, and keeps `--out-dir`, `-O`
  (run-pass `optimize_tests`, so those cases print level-2 MIR) and the test's own flags (`-Zinline-mir`,
  `-Zvalidate-mir`, `-Copt-level`, ...).
- **The `mir` argv departure** (`-Zwrite-long-types-to-disk=no`, §1). The alternative is a per-case out dir under
  `build/`. That would stop the writes, but the 74 cases would stay UNSTABLE.
- **The own-`-Zunpretty` rules:** thir-print keeps its own mode; the minicore hygiene tests are overridden.
- **No `mir` skip,** and the ~120 s CPU case is kept.
- **The `unstable.test.ts` change,** which only adds expectations.
- **N2 of review harness-w23** (rmeta aux crates cause a post-analysis "required to be available in rlib format"
  error) does not apply:
  - the `-Zunpretty` path stops before codegen and metadata;
  - none of the oracle outputs contain that error;
  - `mir` has no aux crates.

## 5. Existing suites unchanged (proof)
- **Method:** `.data/scratch/hw25/tools/hash.ts` (review-hw23's tool) loads `harness/suites.ts` from `git archive`
  copies of base `7f2d6592` and lane HEAD, each in its own bun process with the shared data dir.
- **What it hashes, per suite:**
  - metadata, `skipped()`, `unstable()` and the case order;
  - per case: `{case, oracle([c]), subject([c]), subset membership, blessed(c)}`.
- **Result (`tools/cmp.ts`):** **all 30 existing suites IDENTICAL** (333,456 case records). The only additions are
  `mir-minicore` (46), `mir-o0` (46), `mir` (21526) and `thir-tree` (1860).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test scripts harness`: 43 pass, 0 fail.
- `bun scripts/coverage.ts --check`: markers ok.
- The full unit suite was not run: this lane changes no `src/` file.

## Notes for root
- **Protection:** each suite becomes protected through a gate run after review.
  - `mir` at 21.5k cases makes the gate much longer: one subject process per case, and the port's time per case grows as
    more of the pipeline is ported. The oracle side is fast: about 4 min for the whole suite with 4 jobs at load ~10.
  - mir-o0 and thir-tree are report-only in plan §4. As with review harness-w23 N1, consider protecting them from their
    first accepted run anyway.
- **Port issues seen** (for driver-m4 and fixers):
  - huge-static.rs exits 101 after a correct E0080;
  - the UNPORTED stops in §3.

ACCEPT-WITH-NOTES

# Review: harness-w20c (`lane/harness-w20c`, `67c4d7c6..94d3e225`)

Reviewer: review-harness-w20c (independent, read-only on `.data/lanes/harness-w20c`, HEAD `94d3e225`, clean tree).

All scratch work is under `.data/scratch/review-hw20c/`:
- `base/`, `head/` are `git archive` copies of the two trees; `headgit/` is a git-initialised copy of head, used only
  for the gate refusal tests.
- `data/`, `data2/`, `data4/` are private data dirs, each with its own empty oracle cache. `rust`, `aux`, `probes` and
  `target` are symlinks to the shared dirs. Nothing was written to the shared probes or the shared oracle cache.
- `data5/` has a fake upstream checkout (a tiny git repo) for the upstream-check tests.
- The tools are in `tools/` (`hash.ts`, `cmp.ts`, `runall.sh`, `check.ts`, `scan.ts`, `cmpdec.ts`, `fakeacc.ts`).

**Scope:** `scripts/lib/{env,unstable,upstream,common,oracle}.ts`, `scripts/{difftest,gate,phase-diff}.ts`,
`harness/{suites,compiletest}.ts`, the 2 new test files, the handoff, and 2 decisions. No baseline, oracle-output,
probe or `src/` changes.

## 1. No case definition changed: verified
- **Method:** `tools/hash.ts` imports `<tree>/harness/suites.ts` in its own bun process, once for base and once for
  head, with the shared `RUST_TS_DATA`. For every case of every suite it hashes
  `{id, file, args, env, oracle([c]), subject([c])}`, with the tree root normalised. Per suite it also hashes
  `skipped()` and, for batch suites, `oracle(all)` and `subject(all)`.
- **Result:** all 26 suites are identical, case by case, including skip lists and batch commands. The only addition
  is `unstable()`: 8 ids on tydump-ui and the same 8 on thirdump-ui.
- On this host, `pinnedPathEnv` returns `{PATH}` alone, so the pinned cases' `Case.env`, and with it their cache
  keys, are unchanged.

## 2. The env scrub changes no protected result: verified
**Fresh-oracle samples.** `tools/runall.sh` ran `difftest --suite <s> --sample 150` from the head tree for all 20
protected suites, each run with a fresh private oracle cache (`RUST_TS_AGENT=review-harness-w20c`).

| run | caller env | protected cases sampled | not MATCH |
|---|---|---|---|
| A | my session env (only scrubbed var present: `MallocNanoZone`) | 2606 | 0 |
| B | A plus `RUSTC_LOG=debug RUSTC_LOG_COLOR=always CLICOLOR_FORCE=1 RUST_BACKTRACE=full RUSTC_BOOTSTRAP=-1 CARGO_PKG_NAME=x CARGO_MANIFEST_DIR=/tmp COLORTERM=truecolor TERM=xterm-256color NO_COLOR=1 RUST_MIN_STACK=100000 MallocStackLogging=1 RUSTC_ICE=/tmp` | 2456 + parse-ui 150 (re-run without `RUSTC_BOOTSTRAP`, see L1) | 0 |

- Run A sampled 150 cases from each of these suites: lex, tokens, escape, emit, parse-ui, parse, hir-tree (148
  protected), hir-tree-nocore, resdump, resdump-nocore, expanded, expanded-nocore, unpretty-expanded,
  unpretty-expanded-nocore, unpretty-hir (148), fluent-parse and fluent-format. It ran every case of tokens-str (39),
  escape-synthetic (11) and symbols (10). The result: 0 DIFF, 0 UNSTABLE, 0 `ERROR:` lines.
- **Fresh vs cached, compared directly.** Cache keys do not depend on the data dir for all suites except parse-ui
  (the A and B keys coincide), so I compared A's private entries with the shared cache's entries at the same keys:
  - 2460 entries are equal: 2358 byte for byte, and 102 equal once decoded (`{text, code}`; only the gzip/JSON bytes
    differ).
  - 0 entries differ.
  - The 150 parse-ui keys contain the data-dir path, so those entries can only be compared through MATCH (150/150).
- **The scrub works.** The 2460 entries shared by A (clean) and B (polluted) are byte-identical.
- **Audit of the removal list against the pinned sources.** I grepped the runtime `env::var`/`var_os` reads in
  `compiler/` and `library/std`. Every removed variable is read somewhere that can change output:
  - `COLORTERM`+`TERM`: `rustc_session/src/session.rs:1287`, `-Zterminal-urls`;
  - `CARGO_CRATE_NAME`: `rustc_session/src/utils.rs:118`, `FROM_CARGO`, which switches diagnostic help text;
  - `CARGO_PKG_*`: `rustc_metadata/creader.rs:1301` and `rustc_interface/passes.rs:328`;
  - `RUST_MIN_STACK`, `RUSTC_FORCE_RUSTC_VERSION`, `RUSTC_OVERRIDE_VERSION_STRING`, `RUST_TARGET_PATH`, the
    dep-graph variables, `RUSTC_GRAPHVIZ_FONT`, `RAYON_*`, and the backtrace/ICE variables.
  - Nothing that the tools need to start is removed:
    - `PATH`, `HOME`, `TMPDIR`, `USERPROFILE`, `RUSTUP_*` and `CARGO_HOME` are kept;
    - rustup reads only `RUSTUP_*`, `CARGO_HOME` and `HOME`;
    - neither rustc nor Bun needs `TERM`.
  - Missing candidates are in L2.

## 3. UNSTABLE: verified
- **Ordering.** In `classify`, ORACLE_TIMEOUT comes first, then UNSTABLE, then everything else, so UNSTABLE is never
  MATCH. The unit test covers equal texts and an UNPORTED subject.
- **Listed cases bypass the cache.** A listed case is never read from or written to the cache, in single or batch
  mode. A detected case (single mode, oracle stderr only) is never written, and a cached entry that matches is
  removed. `writeCached` has no other callers.
- **Measured:** `--filter on_unimplemented_long_types` and `--filter projection-cache-rematch-impl-122529.rs` on
  both M3 ui suites, with a private cache:
  - the listed cases came out UNSTABLE (subject `ICE` for 122529#old, with root's same-ICE reason);
  - the cache grew by exactly 2 entries, the two unlisted `#next` revisions.
- **Gate accept refuses.** In the git copy (`headgit`, private data), a fake passing `gate.json` gave lex an extra
  MATCH and tydump-ui a MATCH for a listed id. Accept died with `ERROR: ... tydump-ui would protect 1 case(s) ...;
  nothing accepted`, and `git status` stayed clean, so lex was not written either: accept checks every suite before
  it writes anything.
- **Gate run fails on a listed id in a baseline.** `gate run` fails if a baseline lists one (`unstableOk`, part of
  `pass`). The unit test checks `protectedUnstable`, and that no current baseline lists one.
- **The detection patterns cannot catch a stable case.** I scanned all 545,440 entries of the shared oracle cache:
  - **Exact patterns** (stderr): 16 hits, all in the listed cases. The 12 thread-id hits are the 6 ICE cases × 2
    suites; the 4 long-type hits are the 2 long-type cases × 2 suites. No other case matched, protected or not.
    These 16 stale entries will be removed on the next run of those suites.
  - **Near misses:**
    - `long-type-`/`rustc-ice-` appear elsewhere only as test-file names or in token-dump stdout (`"rustc-ice-{file_now}-{pid}.txt"`);
    - neither form matches the patterns, which only look at stderr.
- **Reasons match root's decision.** The 5 same-ICE reasons match root's decision in `docs/handoff/ui-diffs-20.md`
  (`d7cd332e`): success-results-in-unconstrained-infer, incorrect-old-solver-caching-ice-148095, 141124, the
  use-impl-to-normalize-own-self-ty-ice case and 122529, all `#old`. 151069#old carries the thread-id reason.

## 4. Upstream-checkout check and phase-diff: verified
These tests used the fake upstream in `data5`: a tiny git repo with an untracked `stray.rs`, an ignored
`rustc-ice-…txt` and an ignored `build/out.txt`.
- **Dirty at start, difftest.** It printed `ERROR: the upstream checkout is not clean before the run: 2 path(s)
  (!! rustc-ice-…; ?? stray.rs)`, ran on, and recorded `upstreamDirty`. `build/` was excluded.
- **Dirty at start, gate.** `gate run` printed the same `ERROR:` and then `ERROR: the gate runs only on a clean
  upstream checkout`, before it created any run dir.
- **Change during a run.** I created files while difftest ran. difftest printed `ERROR: suite …: the upstream
  checkout changed during the run …`, wrote `<suite>.upstream-changes.txt`, and recorded `upstreamChanges` in the
  summary. The gate turns this into `upstreamOk=false`, which fails the run.
- **phase-diff out dir.** I ran the oracle by hand with phase-diff's new flags on copies of
  `on_unimplemented_long_types.rs`, `attributes/export/crate-type.rs` and
  `location-insensitive-scopes-issue-117146.rs`:
  - every long-type file and the sdylib interface `libcrate_type.rs` went to `--out-dir`, and the source dir stayed
    clean;
  - the old `--emit=metadata -o -` writes `libstdout.rs` into the cwd.
  - The subject accepts `--emit=metadata=- --out-dir` and reaches the same unported point as before.
  - phase-diff from base and from head gives the same result on a no_core file (diverges at thir, unported).
- The real upstream checkout was clean before and after all my runs (0 paths outside `build/`).

## 5. Windows PATH pin: correct by reasoning, unit-tested, not run on Windows
- **One `PATH` reaches the child.** On win32, `mergeEnv` deletes every other spelling of a name before it sets or
  removes the name, so `Path` + pinned `PATH` gives one `PATH`.
- **Scrub before case env.** `caseEnv` puts the scrub first and `Case.env` second, so a case's
  `RUST_BACKTRACE=short` survives an inherited `rust_backtrace` in any spelling.
- **Inherited `RUSTUP_WINDOWS_PATH_ADD_BIN`.** An inherited `Rustup_Windows_Path_Add_Bin=1` is replaced by the
  pinned `0`.
- **Other platforms.** `pinnedPathEnv`, `getEnv` and `isScrubbedEnvVar` behave as before off win32. The tests in
  `scripts/lib/env.test.ts` pass explicit platforms.
- What remains is in L5.

## 6. Checks (head tree)
- `bunx tsc --noEmit -p .`: clean.
- `bun test scripts harness`: 34 pass, 0 fail.
- `bun test tools`: 50 pass, 0 fail. Both test runs used a private `RUST_TS_DATA`.
- **Merge into `main`.** The only conflicts are in `docs/state/{current.json,history.jsonl}`, as expected. The base
  `67c4d7c6` (harness-w20b) is not in `main` yet.

## Findings

### BLOCKER
None.

### HIGH
None.

### MED
None.

### LOW
- **L1: the helper rustc runs during case listing and key computation are not scrubbed.** These are
  `harness/compiletest.ts` `rustcPrint` (`--print=check-cfg`, etc.), `oracleSysroot`, `verifyOraclePin` and
  `rustcDriverHash`.
  - **Evidence:** with `RUSTC_BOOTSTRAP=-1` set, parse-ui's case listing threw. `rustc --print=check-cfg … failed`
    came out as a stack trace, with no `ERROR:` line, and the `RUSTC_LOG` warning text was in it.
  - **Impact:** their outputs only feed case args and keys, so the effect is a loud failure or different keys, never
    a poisoned entry.
  - **Fix:** run them with `mergeEnv(process.env, caseEnv(undefined))`.
- **L2: not scrubbed, but read at run time by the pinned sources.**
  - `DUMP_OBLIGATION_FOREST_GRAPHVIZ` (`rustc_data_structures/obligation_forest/graphviz.rs:27`) writes `.gv` files
    into the cwd, which is the upstream checkout. The new check would catch that.
  - `POLONIUS_ALGORITHM` (`rustc_borrowck/nll.rs:176`) matters once borrowck suites exist.
  - `RUSTC_BOOTSTRAP_SYNTHETIC_TARGET` is also read.
  - Subject-only variables such as `BUN_*`/`NODE_OPTIONS` cannot poison the oracle cache, but they could cause
    spurious losses.
  - Add the first two before borrowck milestones.
- **L3: the upstream check is a set difference of `git status` lines.** Content changes to a file that was already
  untracked or dirty, and deletions of pre-existing strays, are not reported.
  - This only matters for difftest runs that start dirty, because the gate requires a clean start.
  - **Expected effect:** the gate also fails on strays left by concurrent agents, and root should expect that.
- **L4: phase-diff.**
  - An upstream-change `ERROR:` after "all phases match" leaves the exit code at 0.
  - `$RUST_TS_DATA/phase-diff/out` is shared between agents and grows without bound, because long-type files have
    unique names.
- **L5: Windows has not been run.** rustup prepends `$CARGO_HOME\bin` unless the PATH already contains it.
  - If the spelling of `oraclePathEnv()` (drive-letter case, separators, a `CARGO_HOME` with `/`) differs from
    rustup's own, a second entry is added, and the protected `env!("PATH")` cases would DIFF.
  - The gate would catch that as a loss, so it cannot pass silently.
  - **Check:** on the first Windows run, confirm that the oracle's `env!("PATH")` equals the pin.

## What I require
- Merge harness-w20b before this branch, and resolve the usual `docs/state` conflict.
- L1–L4 can go in a later harness batch. L5 must be checked on the first Windows gate run.

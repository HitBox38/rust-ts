ACCEPT-WITH-NOTES

# Review: harness-w12 (`lane/harness-w12` at ce8ea5a)

Reviewer: reviewer-w12 (independent, read-only on the lane).
- **Scope:** `git diff main...lane/harness-w12` (merge base 31568d0): `harness/suites.ts` (+55 lines, appended after the nocore
  block) and `docs/handoff/harness-w12.md`. Nothing else.
- **Merge and build:**
  - `git merge-tree --write-tree main lane/harness-w12` is clean.
  - `bunx tsc --noEmit -p .` in the lane worktree prints nothing.
  - `git diff --stat main...lane/harness-w12 -- scripts harness/baseline tools src docs/state` is empty.

**Summary.** The three suites `expanded`, `unpretty-expanded` and `resdump` are exactly the nocore suites minus the two
`-Zcrate-attr` arguments. The oracle and subject commands are symmetric. The skip measurements check out, and so does a
hand-run MATCH. No blocking findings. There are two LOW notes (L1 skip scope, L2 cache key vs. sysroot components) and
some INFO notes. The new suites start unprotected, which is correct.

## 1. Symmetry of oracle and subject (OK)
I loaded the lane's `harness/suites.ts` and walked every case of the three new suites and the three nocore suites (scratch
`argv.ts`). Results per suite:

| suite | cases | ids not in nocore | oracle/subject trailing argv != case args | args != nocore args minus the 2 `-Zcrate-attr` | env != nocore env |
|---|---|---|---|---|---|
| expanded | 21,523 | 0 | 0 | 0 | 0 |
| unpretty-expanded | 21,523 | 0 | 0 | 0 | 0 |
| resdump | 21,523 | 0 | 0 | 0 | 0 |

- **Commands:**
  - The oracle is `rustc +nightly <args>`, or `<probes>/release/resdump <args>` for resdump.
  - The subject is `bun src/rust_ts/{main,resdump}.ts <args>`.
  - `<args>` is `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot> --edition=<directive> [-Zunpretty=ast-tree,expanded | -Zunpretty=expanded] <file>`.
- **Settings shared with nocore:**
  - cwd is `UPSTREAM` on both sides (no `cwd` set).
  - Timeouts are 60 s for the subject and 300 s for the oracle, the same as nocore.
  - `probes: ["resdump"]` is set on the resdump suite.
  - env is `NOCORE_ENV` (`RUSTC_ICE=0`, `RUST_BACKTRACE=0`) on both sides. It is also part of the cache key.
- **Extra subject env:** the only extra variable is the existing `RUST_TS_IMPL` (`runSubject`, `scripts/difftest.ts:231`), which selects the implementation. It carries no oracle data.
- **No side channel:** the subject reads no oracle data. Non-test `process.env` reads in `src/` are only rustc's own variables (`RUST_BACKTRACE`, `RUSTC_FORCE_RUSTC_VERSION`, ...) and `RUST_TS_IMPL`.
- **Shared sysroot:** with std, both sides decode the same `lib/rustlib/x86_64-unknown-linux-gnu/lib` metadata from the same `--sysroot`.

## 2. Existing suites, baselines, runner scripts (OK)
The nocore definitions are unchanged. `NOCORE_ENV` and `NOCORE_SKIPPED` are reused and not edited. No file under
`scripts/`, `harness/baseline/`, `tools/` or `src/` changed. The cache key formula (`cachePath`, `difftest.ts:145`) includes
the suite name, so the new suites get fresh keys, and every existing key is unchanged.

## 3. Skipped cases
- **`expanded`: justified.** The lane's scratch `$RUST_TS_DATA/tmp/harness-w12/t-skip-ast.tsv` shows all 3 files killed with
  signal 137 at 1559.98 s with 0 bytes of output. That is longer than the oracle's 300 s plus the 4 x 300 s retry. Each
  would be an ORACLE_TIMEOUT on every run, never cached, at a cost of 25 min per file per run.
- **`deep-try-chain-issue-153583.rs` stays, correctly.** The lane measured 353.23 s with std and 349.95 s without (`t-deep-*.tsv`).
  That fails the first 300 s attempt, but the 1200 s retry has about 3.4x headroom, and the result is cached.
- **Other heavy files.** The lane timed 215 candidates per mode (`t-cands-{ast,exp,res}.tsv`, 215 rows each). Nothing
  exits with a code other than 0 or 1. The slowest ast-tree case is `mir/issue-29227.rs` at 6.29 s. That supports "nothing
  else needs skipping".
- **L1 (LOW): `unpretty-expanded` and `resdump` skip 3 cases with no technical reason.** I re-measured the oracle with std
  on the 3 files:

  | file | `-Zunpretty=expanded` | resdump probe |
  |---|---|---|
  | `associated-consts/issue-93775.rs` | 0.036 s, 3,765 B stdout | 0.026 s, 232,420 B |
  | `expr/if/expr-stack-overflow.rs` | 0.043 s, 211,463 B | 0.057 s, 844,163 B |
  | `parser/survive-peano-lesson-queue.rs` | 0.103 s, 84,034 B | 0.072 s, 1,411,488 B |

  All finish in under 0.2 s, as the handoff and the code comment say. These suites skip them only to keep one case list
  across the three suites.
  - **Precedent:** the nocore suites do the same. It was reviewed and accepted in harness-w8-2 §M1/I1.
  - **Acceptable:** the reason is documented in the `suites.ts` comment, and the 3 cases are recorded in
    `<suite>.skipped.jsonl` with a reason, so they are not silently lost.
  - **Cost:** 3 cases per suite. They are also the deepest inputs, so they are the best stress cases for the
    resolver and printer.
  - **Optional for root:** give these two suites their own case list later, in a separate reviewed batch. It is
    cheap now, while the suites are unprotected.
- **INFO I1 (carried over from harness-w8-2 I1):** the `reason` strings in `skipped.jsonl` for `unpretty-expanded` and
  `resdump` name the `-Zunpretty=ast-tree,expanded` oracle, now with " (with std too)" appended. Someone reading only the
  skipped list could think those modes hang. They do not.

## 4. Timeouts and environment (OK, one LOW note)
- **ORACLE_TIMEOUT is never a pass.**
  - `classify` checks `o.timedOut` before anything else and returns `ORACLE_TIMEOUT` (`difftest.ts:360`).
  - The cache never stores ORACLE_TIMEOUT results (`difftest.ts:14`).
  - `gate.ts` builds the MATCH set from `status === "MATCH"` only (`:247`, `:287`), and it counts a protected
    ORACLE_TIMEOUT as lost (`:36`, `:251-264`).
  - This batch does not touch any of that code.
- **The env hides nothing.** The new suites use exactly the nocore env (see harness-w8 §3 for what `RUSTC_ICE=0` and
  `RUST_BACKTRACE=0` mask: only nondeterministic text). The upstream checkout was clean after my runs (`git status --porcelain` printed nothing).
- **L2 (LOW, pre-existing mechanism, much more exposed now): the oracle cache key does not cover the sysroot's
  source components.**
  - With std, many diagnostics point into the library. I tried a scratch file using `Som(1)` and `std::vec::Vecc`:
    the oracle printed `--> /rustc/6f5da406b56c.../library/core/src/option.rs:606:4`, and the subject's output was byte-identical.
  - That text depends on the `rust-src` component being absent. `lib/rustlib/src` does not exist in the oracle toolchain today.
    If `rust-src` were installed, rustc would remap that path to the local sysroot and print source snippets.
    The subject ports the same remap (`rmeta/decoder.ts:2305-2325`), so fresh runs would stay symmetric.
  - The problem is the cache: `oracleVersion` hashes only `librustc_driver` (or the probe), so already-cached oracle
    entries would go stale, and suites would diverge for reasons outside the port.
  - **Recommendation (separate harness batch, or a recorded decision):** either fold the presence of
    `lib/rustlib/src` (and the target `lib` listing) into the oracle version key, or record a decision that the oracle
    toolchain must not get `rust-src`.
- **INFO I2 (host dependence):** the absolute `--sysroot` makes cache keys machine-specific, the same as in nocore (D1).
  Baselines store ids only, so this is fine.

## 5. Reproducibility spot-check (OK)
Both runs used `RUST_TS_AGENT=reviewer-w12`, the lane worktree, `--impl port` (the default) and `--jobs 6`:

| suite | sample | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT | skipped | run |
|---|---|---|---|---|---|---|---|---|---|
| expanded | 50 | 49 | 0 | 1 | 0 | 0 | 0 | 3 | `rv-hw12-expanded` |
| resdump | 30 | 29 | 0 | 1 | 0 | 0 | 0 | 3 | `rv-hw12-resdump` |

- **The UNPORTED case:** in both runs it is `include-macros/shebang-in-item-ctxt.rs`, stopping at
  `rustc_session::Session::resolve_path (session.rs:934)`. That is the most frequent stop in the handoff's histogram.
- **Hand-run MATCH:** `tests/ui/collections/hashmap/hashmap-path-key.rs` (uses `std::collections::HashMap` and
  `std::path::Path`) is a MATCH in both runs. I ran both sides by hand with the suite's exact argv and env, cwd = upstream:
  - **expanded:** oracle and subject both exit 0. stdout (28,146 B) and stderr (0 B) are `cmp`-identical.
  - **resdump:** oracle and subject both exit 0. stdout (6,457 B) and stderr (0 B) are `cmp`-identical.
  - **std is really involved:**
    - The AST has `ExternCrate(None, std#2)`.
    - The resdump shows `ModChild { ident: std#2, res: Def(Mod, DefId(1:0 ~ std[5743])) ... }`.
    - It also shows `HashMap#0 -> DefId(1:1004 ~ std[5743]::collections::hash::map::HashMap)` and
      `Path#0 -> DefId(1:4330 ~ std[5743]::path::Path)`.
    - So the subject decoded the std metadata and resolved into it, matching the oracle.
- **Conclusion:** the MATCHes are real comparisons of non-trivial with-std output, not an artefact of both sides failing early.

## Gate recommendation
- **Merge:** OK to merge.
- **Protection:** the suites start unprotected. Root may protect them after the first full clean gate run.
- **Before protecting:** decide L2. Decide L1 too if root wants the 3 cases back in `unpretty-expanded`/`resdump`.
  Changing either after protection risks losing protected cases or rebuilding the cache.
- **Cost:** per the handoff, about 55 min per cold full `expanded` run at 8 jobs, and about 0.3 GB of cache for all three
  suites. Disk on this machine is at 2.6 GB free, so root should check space before the first full run.

## Scratch
- Scratch was under `$RUST_TS_DATA/tmp/review-hw12/` and has been deleted.
- The two sample runs stay in `$RUST_TS_DATA/runs/rv-hw12-{expanded,resdump}`.

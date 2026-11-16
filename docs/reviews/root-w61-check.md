# Review root-w61-check: root's own commits on `integ-w61`

Independent, read-only check of root's two commits on the integration branch `integ-w61` (head `495745d0`), and of the merges
under them. Nothing was edited in `$RUST_TS_DATA/integ-w61`; tests ran in a separate detached worktree at `495745d0`
(`.env.local` copied, `node_modules` linked from the main checkout; both gitignored, `git status` clean before and after).

## Verdict: PASS WITH NOTES

Neither commit loosens a check or touches a suite, baseline, oracle output or runner. The explicit timeout equals the gate's
own per-test timeout, so it masks nothing the gate would see. The new `m7d-suites` assertion is as strict as the old one,
restated for the accepted state: it fails if `std-self` gains a baseline or if any of the four protected suites loses one. The
merges bring in exactly the four reviewed branches plus root's two commits. `tsc` and both test files pass. The notes are
small; none blocks the merge.

## What was checked

**Merges.** `git diff main...integ-w61 --stat`: 19 files, +1192/-25. The merge base is `fe9713e1`. Between them, the merged
tips `9009c1ef` (cargo-fix-a), `c648fee1` (its review), `c626119a` (tools-prep-m8), `8c7ecbfa` (its review), `7d2d8810` and
`495745d0` touch exactly those 19 files. Each merged tip is the current tip of its `t3/` branch. None of the four merges
(`eab81d1e`, `10596e4f`, `e2287253`, `8ecfc8d2`) has a combined-diff change (`git diff-tree --cc` is empty), so no
resolution edits were slipped in. `main` has moved on by two commits (`0575c7bc`, `41526a23`). They touch only
`docs/state/current.json` and `docs/state/history.jsonl`, which `integ-w61` does not touch, so the integration merge into
main will not conflict.

**`7d2d8810`.** Two changed lines.
- `scripts/upstream.ts`: a header comment, `cargo-src.ts` changed to `tools-src.ts`. No code change.
- `scripts/coverage.test.ts`: `}` changed to `}, 60_000);` on "--crate: each tool crate's denominator". The seven expected
  denominators and the regex are unchanged.

The gate runs the `scripts`/`harness` roots as "runner unit tests" with `--timeout=60000` (`UNIT_TEST_TIMEOUT_MS`,
`scripts/lib/unit-steps.ts:54`, passed by `unitStepArgs` at `unit-steps.ts:67`). So under the gate this test already had
60 s, and the explicit value changes nothing there. It only gives a plain `bun test` the same 60 s, which is the flake review
tools-prep-m8 N3 saw (over 5 s at load ~14, 2.7 s at load ~10). A hung test still fails at 60 s. This is the right fix, not a
mask.

**`495745d0`.** Only `harness/m7d-suites.test.ts` changes: the test is renamed, and the loop
`expect(existsSync(baseline/n.txt)).toBe(false)` becomes `.toBe(n !== "std-self")`.
- `j.names` is pinned just above to exactly `["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self", "std-self"]`. So
  the new loop asserts that those four baselines exist and that `std-self`'s does not.
- On main, `harness/baseline/` has `rg-build.txt` (1 line), `rg-behaviour.txt` (63), `rg-behaviour-rgtest.txt` (324) and
  `pm-self.txt` (282). There is no `std-self.txt`, on main or on `integ-w61`.
- `git log main -- harness/baseline/{those five}` shows a single commit, `4a3ffbf8` ("Accept wave 40t gate run
  gate-20261115-141315-root-qswd (688 gained, 0 lost)"). It adds the four files and one `history.jsonl` line.
- That line, `history.jsonl:727` (kind `accept`, run `gate-20261115-141315-root-qswd`, tested `cc7f52fa`), lists `pm-self`
  282/282, `rg-build` 1/1, `rg-behaviour` 63/63 and `rg-behaviour-rgtest` 324/324, and no `std-self`. Line 728 records M7 done
  at that run.
- `std-self` is still report only. It is defined at `harness/suites.ts:2968` with no case (`STD_SELF_SKIP`, comment at
  `suites.ts:2876`). It has no baseline, so it is not among `protectedSuites()` (`scripts/gate.ts:635`, which reads
  `harness/baseline/*.txt`), the gate's default suites (`gate.ts:969`).
- The original intent was "these suites are report only, so the gate does not run them by default". Restated for the
  accepted state, that is "the four the accept protected have a baseline; `std-self` does not". The new assertion says
  exactly that. Mutation check in the scratch worktree: adding an empty `std-self.txt` fails the test (1 fail), and so does
  removing `pm-self.txt` (1 fail). With both restored it passes. The rest of the file (shapes, commands, corpus, queries,
  oracle keys, the no-result hook) is unchanged.

**Loosening.** Neither commit touches `harness/suites.ts`, `harness/baseline/`, oracle outputs, `scripts/gate.ts`,
`scripts/difftest.ts` or `scripts/lib/unit-steps.ts`. No expectation value changed except the baseline-existence one above,
and that one follows the recorded accept.

**Tests** (worktree at `495745d0`, Bun 1.4.4, AC power, load ~5):
- `bunx tsc --noEmit -p .`: exit 0.
- `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 bun test harness/m7d-suites.test.ts scripts/coverage.test.ts`: 12 pass,
  0 fail, 232 `expect()` calls, 6.29 s.

## Findings

1. **N1 is half fixed, while the commit says "Fix review tools-prep-m8 N1".** N1 had two parts. The header's
   `cargo-src.ts` is fixed. The second part is not: the new sparse-path and `cargo` block in `upstream.ts status` still sits
   between the "`git submodule status` (trimmed) …" comment (`scripts/upstream.ts:36-37` on `integ-w61`) and the submodule
   loop it describes (`:48`). Comment only, with no behaviour effect. Move the comment down to the loop in a later scripts
   batch, or record N1's second half as open in `docs/next.md`.
2. **The hard-coded `60_000` is decoupled from `UNIT_TEST_TIMEOUT_MS`.** A per-test timeout overrides Bun's `--timeout`. If
   the gate's constant is ever lowered, this one test would quietly keep 60 s. Today the two values are equal, so nothing is
   loosened. Importing the constant from `scripts/lib/unit-steps.ts`, or splitting the test into one `test` per crate (N3's
   other option), would keep them tied. Optional.
3. **`integ-w61` is two commits behind main** (`0575c7bc`, `41526a23`, docs/state only). There is no overlap with the
   integration diff, so this is not a problem. Root should merge main (a real merge) or merge `integ-w61` into main before
   the gate, so the gate's clean-tree HEAD includes the recorded decisions.

# Review: tools-prep-m8 (scripts/tools batch, M8 wave 41 step 1)

Reviewer: independent, read-only. Subject: branch `t3/prepare-tool-source-fetches` at `c626119a` (`git diff main...c626119a`,
merge base `c3a5c9ac`), handoff `docs/handoff/tools-prep-m8.md`, against `docs/plan-m8.md` D1, D3, D4, D18, D21, §1, §8 wave 41
step 1, and root's "tools-prep-m8 scope" decision (`docs/state/history.jsonl`, 2026-11-15T23:51).

Method: a detached scratch worktree of `c626119a` at `$RUST_TS_DATA/tmp/review-tools-prep-m8/wt`, scratch data dirs beside it
(`data1`–`data3`, with copy-on-write clones of the existing `tools-deps/cargo-home` and `CARGO_NET_OFFLINE=true`), and scratch
scripts in `.../scripts/`. Nothing was built and no crates were re-fetched. The shared `cargo-src` and `tools-deps` were only
read. Host on AC power, no `GATE_RUNNING`, load 6–15 during the review.

## Verdict: PASS WITH NOTES

The batch does what D3, D4 and D21 ask for. The pins are right, setup checks the hash and fails loudly, the lock check catches
every tampering I tried (including one run end to end through `setup`), and the new `--check` rule refuses markers outside the
counted crate roots without refusing anything on main or on any other branch in flight. The only gate-cost effect beyond the
expected `rg-build` subject rebuild is a few seconds of unit and marker steps. None of the notes blocks the merge. N3 (a test that
times out under plain `bun test` under load) and N8 (a note to lanes about the stale-worktree race) are the ones worth acting on
soon.

## Findings

### Checks that pass (evidence)

**P1. D3 pins match.** `UPSTREAM.json` `rust.sparse` gains exactly `src/tools/clippy` and `src/tools/rustfmt`. The new top-level
`cargo` is `{ repo: https://github.com/rust-lang/cargo.git, commit 29c5daa1afc262323364e039bb70c83372cc702c, sha256
a1aaf1613ebbf43f5234626f589350d64ea3d4c1a889bce8f55562a86404ad16 }`, the same values as plan §1a and D3. `shasum -a 256` of the
on-disk `cargo-src/cargo-29c5daa1….tar.gz` gives the same hash. The pin's `src/tools/cargo` gitlink is `29c5daa1…`
(`upstream.ts status`: `ok cargo 29c5daa1… (gitlink src/tools/cargo: 29c5daa1…)`). The checkout's `sparse-checkout list` holds all
11 paths.

**P2. `upstream.ts status`'s new checks are correct.** On the real checkout: `ok sparse: 11 paths checked out` and `ok cargo`. In the
scratch worktree I added a fake sparse entry `src/tools/nope` and changed one hex digit of `cargo.commit` (then reverted). The output
was `ERROR: sparse path(s) not checked out: src/tools/nope` and `ERROR: cargo 29c5…7000 (gitlink …702c)`. The sparse check requires
each pinned path to be in the cone list and on disk, so non-cone patterns would fail closed. Extra paths are allowed. `fetch` is
unchanged.

**P3. `tools-src.ts setup` meets D3's four requirements.**
- **Hash before use:** `sha256File(tarball)` is compared to `cargo.sha256` before `tar -x`. With a 9-byte garbage tarball under a
  scratch `RUST_TS_DATA`, the output was `ERROR: cargo-29c5….tar.gz does not have its pinned SHA-256 …; removed` with exit 1. The
  file was removed, and nothing was unpacked or fetched.
- **Only networked step:** `curl` and the two `cargo fetch` calls run only under `setup`. `status` and `coverage.ts` make no network
  calls. Nothing in `scripts/`, `harness/` or `tools/` runs `upstream.ts fetch` or `tools-src.ts setup` automatically (grep).
- **Idempotent:** I ran `setup tools-deps` twice in `data2`, which holds a symlink to the real checkout and a CoW clone of the
  CARGO_HOME. Both runs exited 0. The resulting `Cargo.lock` is byte-identical to the shared `tools-deps/Cargo.lock`, `status` is
  ok, `git -C rust status --short` is empty, and `cargo metadata --offline --locked` succeeds. The re-run deletes `src/`, which
  holds symlinks into the checkout. I checked separately that Bun 1.4.4's `rmSync(recursive)` unlinks a symlinked directory and
  file without following them (`rm-test/`: the target survived).
- **Fails loudly:** every failure goes through `die` (`ERROR:` + exit 1). Examples: the missing checkout (`setup tools-deps` in
  `data1`), the bad hash above, a non-zero cargo exit (its last stderr line is shown), and a lock outside the root lock (P4).

**P4. The `tools-deps` lock check rejects what it must.** `lockSubsetErrors` matches on name, version, source and checksum.
`scripts/lock-tamper.ts` ran against the real pruned lock (116 packages) and root lock (656). The untampered lock gives 0 errors.
Each of these gives exactly 1:
- serde's version bumped;
- its checksum changed;
- its checksum dropped;
- its source changed to a git URL;
- its source dropped (made a path package);
- a path package's version changed (`clippy_config 9.9.9`);
- a new registry package appended;
- a changed checksum with CRLF line endings.

**End to end:** in `data3` the root `Cargo.lock` is a copy without `itertools 0.15.0`. `setup tools-deps` (offline) printed
`ERROR: tools-deps resolved 1 package(s) away from the root lock: itertools 0.15.0 (…) is not in the root Cargo.lock …`, exited 1,
and wrote no `setup-done`. `status` then reported `ERROR: tools-deps …`.

**P5. D4 coverage counts are right, and `--check` passes on the branch.**
- The `--crate` totals match plan §1c:
  - clippy: 3,295 + 982 + 108 + 24 + 4 + 11 = 4,424 (§1c: ~4,430);
  - rustfmt: 1,595, with its bins and `src/test`, and nothing outside `src/` (§1c: ~1,600).
- `bun scripts/coverage.ts --check --offline` on `c626119a` gives `markers ok (27358, …)` in 3.4 s.

**P6. The new `--check` rule refuses exactly what it should.** A throwaway `src/review_tmp/m.ts` in the scratch worktree (removed
after) gave these results:
- **Accepted:** `clippy_config/src/types.rs:54 name`, `clippy_lints/src/lib.rs:425 explain` and `rustfmt/src/lib.rs:148 is_comment`.
- **`matches no upstream fn`:** `types.rs:55 name`.
- **`out of scope (… tools.excluded …: <reason>)`:** `clippy_dev`, `lintcheck` (a `rustc-skip:` marker) and
  `rustfmt/config_proc_macro`.
- **`under no tool crate's root … nor Miri's`:**
  - `src/tools/miri/tests/ui.rs`, which `--check` did not check before;
  - `clippy/book/…`;
  - `src/tools/cargo/…`;
  - `src/tools/compiletest/…`.
- **Exit:** 1.

Nothing on main is refused. Every `// rustc*: src/tools/` marker under `src/` is in `src/tools/miri/src/`: 1,533 `rustc:` and 263
`rustc-type:`. The other matches in the repo are prose in `docs/` and `harness/scope.json`. The branches in flight (`t3/perf-heavy`,
`t3/add-aarch64-cargo-intrinsics`, `t3/gate-oracle-guard-headroom`, `t3/9110ba08`, `lane/fixer-30`) have 0 such markers outside
Miri's root. `--crate X` skips the tool-tree rule, but the gate's `markers` step runs the full `--check --offline` (`gate.ts:599`).
`toolsEntryErrors`' fixture tests cover:
- nested roots;
- overlap with Miri's root;
- names taken by Miri or a compiler crate;
- a missing root or excluded path;
- a missing reason;
- a tool that is not checked out.

**P7. The two extra crates fit plan §1c.** §1c's "Total in scope" row (157,003 lines, ~4,430 fns) includes the
"`declare_clippy_lint`, `rustc_tools_util` | 2 | 497 | 437 | 15" row. D14's `clippy-contract-a` needs `declare_clippy_lint`, and the
driver's `--version` line comes from `rustc_tools_util`. Root recorded the addition. Without the entries the new rule would refuse
their markers. The mapping is `src/rustc_tools_util/` (D4's pattern), which looks like a compiler crate's path. No script picks
crates by a `src/rustc_*` pattern (grep), and `toolsEntryErrors` refuses a tool crate named like a compiler crate, so this is safe.

**P8. `scope.json` matches D1, D4 and §1.**
- **Excluded:** `tools.excluded` holds D4's five (`clippy_dev`, `lintcheck`, `clippy_lints_internal`, `clippy_dummy`, rustfmt's
  `check_diff`), plus three more root recorded:
  - `clippy_test_deps`: D10 builds it with the oracle's cargo.
  - rustfmt's `ci`: a separate `Cargo.toml` crate, not in the component.
  - `config_proc_macro`: D5 replaces it with codegen. §1c counts its 499 lines in rustfmt's total, but D5 and root's decision
    supersede that.
- **Counted:** the seven `tools.crates` roots are the in-scope rows of §1c.
- **Left out:** §1c's developer trees `book` and `util`, and also `etc`, `tests` and the `build.rs` files (see N6). They sit
  under no root, so markers into them are refused.

**P9. Ratchet: the `harness/m7-suites.test.ts` edit loosens nothing.** The only hunk changes the test's title and appends the two
D3 paths to the expected list. It is still an exact `toEqual` on the whole `sparse` array, so any other change to the list still
fails. No other file under `harness/` changes besides `scope.json`.

**P10. The `rg-build` rebuild is the only cache effect.** Of everything that keys a cache, only `scripts/rg-build.ts` `portInputs`
reads `UPSTREAM.json` (line 137), so the next gate rebuilds ripgrep's subject side. The oracle cache is unaffected. Other keys:
- `subjectBinKey` hashes only `CONFIG_FILES` (`tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`) and the bundle's inputs.
  `src/rust_ts/oracle_sysroot_env.ts` reads `UPSTREAM.json` at run time, not as an import.
- `miriOracleKey` does not read it.
- The 18 contract tests that import `scripts/coverage.ts` use exported functions the batch does not change; only the `main` block
  and imports changed.
- No suite walks `src/tools/` except Miri's own `src/tools/miri` (`harness/suites.ts:1907, 1922`), so the new trees add no cases.

The gate's cost otherwise grows by:
- `markers`: about +0.4 s (handoff 2.4 → 2.8 s; I measured 3.4 s under load);
- the runner unit step: about +3.8 s (P11).

The full coverage run's TOTAL also changes (N2), which shows in `state.ts summary` but feeds no gate check.

**P11. Unit tests: env vars and cost (D13).**
- `bunx tsc --noEmit -p .` is clean.
- `bun test --timeout=60000` on `scope.test.ts`, `tools-src.test.ts`, `coverage.test.ts`, `harness/m7-suites.test.ts` and
  `scripts/lib/unit-steps.test.ts` gives 64 pass, 0 fail.
- `unit-steps.test.ts` scans every test file's environment reads, and the new files are in it. The new tests read only
  `REPO_ROOT`/`upstreamRoot` from `upstream-root.ts`. `coverage.test.ts`'s child keeps its existing `env: process.env`.
- **Cost** (junit, load ~10), 3.8 s in total, well under D13's 10 s:

  | Test | Time |
  |---|---|
  | `--crate` denominators | 2.74 s |
  | rustfmt files | 0.40 s |
  | `--missing` on clippy's driver | 0.33 s |
  | `--missing` on a tree out of M8 | 0.32 s |
  | scope tests and `tools-src` tests | under 0.1 s together |

### Notes

**N1. The doc comments have small errors.** `scripts/upstream.ts`'s header says the cargo source comes from
`scripts/cargo-src.ts`; the script is `scripts/tools-src.ts`. The new sparse and cargo block is inserted between the existing
"`git submodule status` (trimmed) …" comment and the submodule loop that comment describes. Fix both when next convenient.

**N2. Counting the tools in TOTAL needs its own recorded decision.** Handoff decision 1 counts the tool rows in TOTAL, as Miri's are.
This moves the summary figure from 26263/27873 (94.2%) to 26263/33892 (77.49%) after root's next full `coverage.ts` run. D4's
"following Miri" supports it. Root's "tools-prep-m8 scope" entry records the two extra crates and the three exclusions, but not
this choice. Root should record it so the drop in `state.ts summary` is explained.

**N3. One new test times out under plain `bun test`.** "--crate: each tool crate's denominator" spawns `coverage.ts` 7 times in one
test. At load ~14, plain `bun test scripts/coverage.test.ts` (Bun's 5 s default timeout) failed it: `this test timed out after
5000ms`. At load ~10 it takes 2.7 s. The gate is not affected: it passes `--timeout=60000` (`UNIT_TEST_TIMEOUT_MS`,
`unit-steps.ts:54`), and the same test passed under it. But lanes and reviewers running `bun test` by hand will see a flake. The
handoff's "47 pass" was at lower load. A cheap fix in a later scripts batch: one `test` per crate, or a per-test timeout.

**N4. `tools-src.ts status` has small gaps.**
- It exits 0 even when it prints `ERROR:` lines, and so does `setup <unknown>`, which prints usage. This matches
  `upstream.ts status`, but no script can gate on the exit code.
- It does not check that the CARGO_HOME directories exist.
- `setupCargo` does not delete a stale `setup-done` before it starts, unlike `setupToolsDeps`. A re-run that dies in
  `cargo fetch` therefore leaves `status` reporting ok. That stays harmless only while the earlier run of the same pin succeeded and
  its CARGO_HOME is intact.

All low risk.

**N5. `lockPackages` fails open on unexpected formatting.**
- A `[[package]]` block whose `name`/`version` lines do not match the strict `^name = "…"$` form is skipped, not reported. With
  `version  =  "9.0.0"`, `lockSubsetErrors` returned 0 errors over 115 parsed packages. Cargo never writes that form, so the risk
  is low. Failing closed (an error for an unparsable block) would cost one line.
- The check compares packages, not dependency edges. I normalized name-only edges (cargo writes `"syn"` when only one version is
  locked) to name-and-version. Then 0 of the 116 packages have an edge that the root lock's entry lacks
  (`scripts/lock-edges2.ts`). An edge check would be a cheap extra guarantee, but nothing needs it today.

**N6. The tools' `build.rs` files are under no root.**
- clippy's `build.rs` (1 fn, `rustc_tools_util::setup_version_info!()`) and rustfmt's `build.rs` (5 fns, commit info) set the
  version strings the oracle prints.
- Markers into them are refused today as "under no tool crate's root".
- If a contract lane needs to port or mirror them, it needs a `scope.json` entry in a scripts batch. Root should know this before
  `clippy-contract-a`, whose driver prints `--version`.

**N7. A missing tool tree crashes `--crate <tool>`.** With a tool's root absent from the checkout, `coverage.ts --crate clippy_lints`
prints its `note:` and then reaches `const r = (rows[0] ?? vrows[0])!; r.files` with both empty, a TypeError (read from the code, not
run). The gate still fails loudly, through `coverage.test.ts`. A clean `ERROR:` would be better.

**N8. The stale-worktree race needs a note to lanes, not a guard in this batch.** The handoff is right that a worktree on the old
`UPSTREAM.json` running `bun scripts/upstream.ts fetch` would `sparse-checkout set` the shared checkout back to 9 paths. Code in this
batch cannot stop old code. The worktrees on the old pin today are the other `t3/*` and `lane/*` worktrees at `c3a5c9ac`,
`fe9713e1` and older. Nothing runs `fetch` automatically, and the damage would be loud, not silent:
- `upstream.ts status` reports `ERROR: sparse path(s) not checked out`.
- The gate's runner unit step fails: `coverage.test.ts`'s tool tests lose their rows (N7).
- Once tool markers exist, `--check` refuses them with "whose root … is not in the upstream checkout".
- Before tool markers exist, a full `coverage.ts` run only prints notes and writes the smaller TOTAL to `coverage.json`.

Two actions for root:
1. When this merges, tell the lanes not to run `upstream.ts fetch` from a worktree that has not merged it, or to merge main first.
2. Optionally, in a later scripts batch, make `fetch` refuse to narrow the checkout. When `sparse-checkout list` holds a path not in
   `PIN.sparse`, stop unless `--narrow` is given. This protects only against future narrowing, not against the old code in
   existing worktrees.

## Scratch

`$RUST_TS_DATA/tmp/review-tools-prep-m8/`:
- `scripts/`: `lock-tamper.ts`, `lock-edges.ts`, `lock-edges2.ts`, `drop-pkg.ts`
- `junit.xml`: timings

I removed the scratch worktree and data dirs (`wt`, `data1`–`data3`, `rm-test`) after the review.

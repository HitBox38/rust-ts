ACCEPT-WITH-FIXES

# Review: harness batch `gate-provenance` (commit ce36580)

Reviewer: review-gp (independent, read-only). Reviewed at HEAD 5071baf, where `scripts/` and `harness/` are unchanged since ce36580.

The batch closes audit-1 F1 and F4 for the cases it targets. An old run with no provenance is refused. So is a run that skipped static checks, a run on a dirty tree, a run at a different HEAD, and a run that left out any protected suite. Rustc-based suites now key the oracle cache on the toolchain build. One gap remains: an accept can still produce a baseline commit whose tree was never tested (finding 1). Fix 1 before the next real accept. Fixes 2 and 3 are small and should go in the same follow-up batch.

## Findings

### 1. MEDIUM: accept does not check that the tree is clean (scripts/gate.ts:94-95)
Cleanliness is only checked at run time, through `g.dirty` (gate.ts:93). At accept time `provenance()` is called, but only `head` is compared; `now.dirty` is ignored.
Scenario: root runs the gate on a clean tree at H (PASS). Root then edits `src/...` without committing. HEAD is still H, so the accept succeeds. Root then commits the edit together with the grown baseline "naming the run id". The commit's tree was never tested.
This is live right now. The root tree is dirty (`docs/state/*` modified, `LICENSE-*` untracked). `gate-20261012-185308-root-a805` (head 5071baf, dirty [], pass, all 4 protected suites) would pass every check. I did not run it.
Fix: at accept, refuse if `now.dirty` has any path outside `docs/state/` (state.ts writes there). In particular, refuse if anything under `harness/baseline/` is dirty, so an accept always applies to the committed baseline the run compared against.

### 2. MEDIUM-LOW: provenance is recorded only at the start of the run (scripts/gate.ts:66, 81)
A full gate takes a long time. Edits made during the run and reverted before accept leave HEAD the same and the tree clean. The results then reflect code that is in no commit.
Fix: call `provenance()` again after the last suite. Set `pass = false` (or record the run as dirty) unless `head` and `dirty` are identical to the start values.

### 3. LOW-MEDIUM: git exit codes are ignored (scripts/gate.ts:52-56)
If `git` fails, `head` becomes `""` and `dirty` becomes `[]`, so the tree reads as clean. If git also fails at accept time, `"" === ""` and the accept passes with no real provenance.
Scenario: the Windows `safe.directory` "dubious ownership" error on a worktree on D:. Both commands exit non-zero with output only on stderr.
Fix: require `code === 0`, and require `head` to match `/^[0-9a-f]{40}$/`, in both run and accept.

### 4. LOW: gate.json is fully trusted (scripts/gate.ts:89-104)
Anyone can hand-edit `gate.json` to set `pass`, `head` and `dirty: []` and add arbitrary `gained` ids. This cannot be prevented locally. Cheap mitigations:
- (a) Recompute the gained ids at accept time from `<run>/<suite>.jsonl`: the MATCH ids minus the current baseline.
- (b) Check that `s.baseline === readBaseline(s.suite).size`.
- (c) Check `s.suite` against the `SUITES` registry. Today a suite name like `../x` makes accept write outside `harness/baseline/` (gate.ts:102).

The evidence files can also be overwritten. `difftest.ts --run-id <gate-id> --sample N` (difftest.ts:268) writes into a gate run's directory. Consider refusing `--run-id gate-*` in the difftest CLI. Until then, the regression auditor has to cross-check.

### 5. INFO: lane-run and suite-subset paths are sound
- A lane run accepted in root is refused unless root HEAD equals the lane HEAD. If they are equal, the commit is identical, so the tested tree is identical. Root's merge commits differ from the lane head, so in practice the gate has to be re-run in root. Correct.
- A lane accept made in the lane worktree is not blocked by the tool. If that baseline growth is merged and the merge breaks those cases, the next root gate fails. That shows up as a FAIL, not a silent loss. Root-only accept stays a policy rule (AGENTS.md section 1).
- A `--suites` run naming only new suites is refused by the missing-protected-suite check (gate.ts:96-97). Verified by reading the code.

### 6. LOW (future): the driver hash does not cover sysroot rlibs (scripts/lib/oracle.ts:31-47)
The parse suite (`-Zunpretty=ast-tree`) does not need std, so this is fine today. Later suites that compile against std (expansion, resolve, typeck) also depend on `lib/rustlib/<target>/lib/*.rlib`. A different commit is already caught by `verifyOraclePin`. For the same commit, the rlibs come from the same build, so the risk is low. When such suites are added, revisit this, for example by also hashing the rustlib manifest.

### 7. NIT
- oracle.ts:3: the comment refers to `oracleIdentity`, which does not exist. It should say `rustcDriverHash`.
- difftest.ts:70: `existsSync(cmd0)` is evaluated against the process cwd before the `cmd0 === "rustc"` test. A stray file named `rustc` in the cwd would key the cache on that file instead. Test `cmd0 === "rustc"` first.

## Cache-key check (question 2)
- Probe suites (lex, escape, escape-synthetic, symbols) are unchanged. `probePath` returns an absolute path to an existing binary or dies, so these suites stay keyed on the probe binary.
- The parse suite's `cmd0` is `"rustc"` (`oracleRustcCmd`), so it keys on `rustcDriverHash()`. `bun scripts/difftest.ts --suite parse --sample 5` gave UNPORTED=5 (expected) in 3.6s. For `tests/ui/static/safe-extern-statics.rs`, both the new driver-keyed entry (fc5a2e0a...) and the old pin-keyed entry are in the cache. The new key is in use, and the old entries are orphaned, which is harmless.
- This keeps the parse suite from being served stale results after a reinstall of the same commit. A different commit was already refused by `verifyOraclePin`.
- Regex `^(lib)?rustc_driver-[0-9a-f]+\.(dll|so|dylib)$`:
  - Windows: matches `bin/rustc_driver-460b8e2647e52b59.dll` (211 MB) and correctly skips the `.pdb`.
  - Linux: matches `lib/librustc_driver-<h>.so`.
  - macOS: matches `.dylib`.
  - Correct on all three.

## Other checks
- `bunx tsc --noEmit -p .` (TS 7.0.2) exits 0. No file imports the removed `oracle()` or `Outcome`; the remaining `oracle(` hits are the `Suite.oracle` method.
- `bun scripts/gate.ts accept --run gate-20261012-105941-root-hf6n` printed `ERROR: gate run ... has no provenance (older gate.ts); re-run the gate` and exited 1. `harness/baseline` and `docs/state` were unchanged; `docs/state` was already dirty before the review.

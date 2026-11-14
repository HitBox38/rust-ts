# Review: lane `default-sysroot`, re-check (wave 40r)

Reviewer: independent, read-only on code (AGENTS.md §1). Subject: `t3/port-default-sysroot`, `adfcd33f`, on `e3e5797d`.
First review: `docs/reviews/default-sysroot.md` (`101d83a1`, FAIL on F1; N2 and N3 open). Review branch
`t3/review-default-sysroot-recheck-r`, on `adfcd33f`. Upstream pin `6f5da406b56c`. AC power throughout; no gate was running.

## Verdict: PASS WITH NOTES

F1 is fixed:
- The comments now give the real reason, and they match root's corrected decision.
- A named guard test fails under the eager read.

N2 is fixed: both order mutations now fail. N3 is corrected. The diff changes no behaviour: it touches only comments, one new
test file and the handoff. The notes below need no change before integration.

## Checks

### 1. F1

**Comments.**
- `src/rustc_session/config.ts:1720-1731` (`Sysroot.default_`) and `:1741` (`Sysroot::new`) now say the lazy read is "required for
  correctness, not only speed".
- They give both environments: Miri's own `RUSTUP_HOME`, where `rustc +<pin>` fails, and unit tests with no `PATH`.
- They say why upstream has no such problem: it reads its own binary's location.
- They cite the `miri-hello` loss and name the guard test.
- The ~20 ms saving is now marked secondary.
- `PORT(perf)` became `PORT`. That is right: PORTING §3 allows `PORT(perf)` only when the change cannot show in any output.
- `src/rustc_session/filesearch.ts:182-186` says the same.
- The two false claims, "the value is the same" and "Upstream has no such failure", are gone from both files.
- This matches the history entry of 2026-11-14T13:58:56Z ("Correction to the 2026-11-14 default-sysroot lazy-read
  decision"): lazy for correctness, Miri `RUSTUP_HOME`, no `PATH`, `miri-hello`, a named guard test.

**Eager-read mutation, re-applied.** I changed `Sysroot.new` to `return new Sysroot(explicit, default_sysroot());`:
- The guard test **fails** at its first assertion: stderr is not empty. 2 pass, 1 fail.
- Reverted with `git checkout`; the tree is clean.

**Positive control.** I ran the same setup by hand without `--sysroot`: a fake failing `rustc` that logs its calls, first in
`PATH`, with only `HOME` and `RUSTC_ICE=0` set.
- The fake logged `+nightly --print sysroot`.
- The subject printed `rust-ts: unported: rustc_session::filesearch::default_sysroot (rustc +nightly --print sysroot failed:
  error: x)`.
- So the fake is reached when the default is read. An empty log in the guard means "never asked", not "never found".

**Guard test properties.**

| Property | Finding |
|---|---|
| Deterministic | Yes. Its input is fixed (`pub fn f() -> u32 { 1 }`). The child's environment is built from scratch: `HOME`, `RUSTC_ICE=0` and `PATH=<fake bin>:/usr/bin:/bin`. It does not depend on timing. It passed 4 of 4 runs here. |
| Environment reads | It names only `RUST_TS_REQUIRE_PROBES` and `HOME`, both in `UNIT_ENV_HARMLESS` (`scripts/lib/unit-steps.test.ts:195-`). The `{ ...process.env, RUSTUP_AUTO_INSTALL: "0" }` spread only hands variables to the oracle child, which the scan does not count as a read (`unit-steps.test.ts:170-172`). That test passes, in the bundle below. |
| Scratch directory | `mkdtempSync(join(tmpdir(), "rust-ts-sysroot-guard-"))` in `beforeAll`, removed by `rm -rf` in `afterAll`. After 4 runs and the mutation run, no `rust-ts-sysroot-guard-*` was left in `$TMPDIR`. The directory is unique per run, so it is safe under the gate's `--parallel 4` unit step, which has roots `src` and `tools` and so includes this file. |
| Skip behaviour | It skips visibly when the pinned rustc is missing, and runs (then fails) under `RUST_TS_REQUIRE_PROBES=1`, as the probes rule requires. |
| Wall time | The whole file took 0.83 s (`Ran 3 tests ... [828ms]`), load average about 46. The guard took 1.18 s when it failed under the mutation. A process wall time was 1.7-2.1 s per file run. The 60 s timeout leaves a wide margin. |

### 2. N2: order mutations, re-applied

| | Mutation | Result |
|---|---|---|
| M2 | `config.ts` `all_paths` changed to `[default, ...explicit]` | **fails**: 2 tests (`Sysroot::all_paths ...`, `Session::get_tools_search_paths ...`) |
| M4 | `session.ts` self-contained `flatMap` changed to `[path/self-contained, path]` | **fails**: 1 test (`Session::get_tools_search_paths ...`) |

Each was reverted with `git checkout`. `git status` was clean after each one.

### 3. No other behaviour change

`git diff e3e5797d adfcd33f --stat` touches 4 files:
- `config.ts`: comment lines only.
- `filesearch.ts`: comment lines only.
- `config_sysroot.test.ts`: new.
- `docs/handoff/default-sysroot.md`.

There is no code change in `src/`. `Sysroot.new` still passes `undefined`, and the getter, setter, `path()` and `all_paths()` are
unchanged.

### 4. Commands

- `bunx tsc`: exit 0.
- `bun scripts/coverage.ts --check`: `markers ok (27155, ...)`.
- `bun test ./src/rustc_session/ ./src/rustc_codegen_ssa/back/ ./src/rustc_interface/ ./src/rustc_driver_impl/ ./scripts/lib/unit-steps.test.ts`
  (with `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`):
  - **434 pass, 0 fail**, no skips, 37 files, 217.6 s.
  - The handoff's 515 / 53 files also included `./src/std/`.
- `RUST_TS_AGENT=rev-default-sysroot-recheck bun scripts/difftest.ts --suite run-pass-miri --sample 100 --jobs 6`:
  - **MATCH 100/100** (497 skipped).
  - Run `20261114-141544-rev-default-sysroot-recheck-ix2o`.
  - No protected case is lost in the sample.

## Notes

1. **The N2 tests check upstream's order as read, not the oracle's linker `PATH`.**
   - The first review suggested oracle-compared linker cases: a `--sysroot` that differs from the default, and self-contained tools.
   - The lane instead wrote unit tests that build `Sysroot("/explicit", "/default")` and call
     `Session.prototype.get_tools_search_paths` on a stub session.
   - The expected lists are right against config.rs:1447 and session.rs:825-840, and they kill both mutations, so N2's purpose is
     met.
   - An oracle-compared linker case would still be a stronger, end-to-end check. It is optional, for whoever next touches
     `linker_args.oracle.test.ts`.
2. **The guard stands in for Miri's `RUSTUP_HOME` with a fake `rustc`; it does not use the real isolated home.**
   - This is adequate. The positive control above shows the fake is reached whenever the default is read, and the failure shape is
     the same: `rustc +<pin>` exits non-zero.
   - The real environment is still covered at gate time by `miri-hello` and the Miri suites.
3. **The guard covers a non-linking `--emit=metadata` compile only.**
   - That is the path every protected suite takes today.
   - When `self_contained_components` (ssa-link-b) is ported, link-time readers of `all_paths` become reachable with `--sysroot`.
     Those spawn by design, as upstream's linker `PATH` includes the default.
   - This guard does not police that path, and should not.
4. **First-review N1 and N4 stay open.** They are carried in the handoff's "Decisions for root" items 2-3, for the Miri owner, the
   owner of `src/rust_ts/llvm/`, ssa-link-b and the harness batch. Nothing in this lane needs to change for them.

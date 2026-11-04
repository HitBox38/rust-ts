# Handoff: harness-w39 (harness batch; needs an independent review)

Branch `t3/7f54d27c`, on `main` `b79919b0` with `integ-w38` `223c634a` merged (`09bddbe8`). No port code: no marker, `unported(...)` or
`// PORT:` was added or changed.

## Items

1. **Aux cache poisoning, fixed (`a4fedf9f`).** The test's child now has a private `RUST_TS_DATA`, and its two aux crates cannot build (an endless const evaluation, a compile error). With a real build planted under the old test's key, base fails and head passes, and the planted cache's `aux/ui` listing did not change; a real build in the same private setup landed only in the private root.
2. **Scope, done (`4dc9de69`); `rustc_monomorphize` needed no edit.** Miri is now 1504/1535, up from 1483/1514 (+21/+21; the review's 1199 predates later ports). The `--check` line is identical and the case dump is unchanged. `inScopeCrates` is every crate under `compiler/` minus `excluded`, so `rustc_monomorphize` already counts (`--crate`: 0/153), and the table hides crates at 0.
3. **harness-w38 L1-L4, fixed (`83326b06`).** L1: `fixture miriepoll` with `MIRI_BE_RUSTC=host MIRI_LOG=debug RUSTC_LOG=debug` reports `unchanged` and leaves no `.o`. L2: one `ERROR:` line for Miri and unknown probes. L3: `build` stamps a source hash and a stale binary fails `fixtures.test.ts` (tested on a scratch `miripaths` build). L4: another process's `needs-layouts-*` dir fails base and passes head.
4. **harness-m6c N1, fixed; re-check L3-L8 checked (`04650e49`).** N1: `scripts/lib/case-lock.ts`; of two concurrent `difftest --filter issue-miri-3680`, the second printed the wait and both gave UNPORTED. L3, L4, L6 were already fixed. L5 is root's call (no code). L7 was half fixed; a `gate.json` missing a field now gives one `ERROR:` line. L8: added the missing pointer to `docs/handoff/harness-m6c.md`; its second point resolved on merge.
5. **`common.test.ts`, fixed (`6a8f1416`).** The child spins to 300 ms of its own CPU time, and the test requires at least that. It passes with 40 spinners running and fails when the unit is seconds or microseconds. Reading `sysMs` instead of `userMs` still passes, as it did before.
6. **No `.env.local`, fixed (`ae66ba91`).** A `bunfig.toml` preload prints one `WARNING:` line after the last test, just before the summary. With the file present it registers nothing. Exit codes do not change.

## Case lists

Dumped on `integ-w38` `223c634a` and on head `04650e49` (each suite's cases, skips with reasons, unstable list, oracle key, metadata, and first case's commands; repo path normalized): 58 suites, 364,386 cases on both, and the two dumps are **byte-identical** (sha256 `31cc7d61333b521f...`). No file under `harness/baseline` or `src` changed. In `harness/suites.ts` only a comment changed.

## Tests

| command (`RUST_TS_REQUIRE_PROBES=1`) | result |
|---|---|
| `bun test ./scripts ./harness` | 180 pass, 0 fail, 0 skip |
| `bun test ./tools` | 67 pass, 0 fail, 0 skip |
| `bun test ./scripts ./harness ./tools` | 12 fail, 17 skip on head, **the same 12 failures on base** |

`bunx tsc --noEmit -p .` exits 0. `src/` tests were not run except `src/miri/contract.test.ts` (8 pass).

The combined command fails on any tree: `scripts/lib/deps.test.ts` sets `RUST_TS_DATA` to a temp dir before `common.ts` first loads, and one process shares the module cache, so `tools/` then looks for probes in that temp dir. The gate keeps these roots in separate steps (`scripts/lib/unit-steps.ts`), so it is not affected. Not fixed here. The two commands run separately are the 247 tests of the combined run.

## For root

- **L3 starts working only after a rebuild.** The 38 built probes have no stamp, so the test prints one line saying they cannot be checked, and passes. Run `bun scripts/probes.ts build` when no gate is running. A lane that rebuilds a changed probe into the shared target will fail this test on other trees until it is rebuilt from theirs, which is true of the binary they are using.
- **`$RUST_TS_DATA/coverage.json` was overwritten by this lane.** A full `bun scripts/coverage.ts` writes to the shared file, and I ran it from this branch. I did not save the old contents. It now holds `integ-w38`'s figures (24086/27032), regenerated from a checkout of that commit. Rerun it after merging: head gives 24107/27053.
- **Case lock limit.** If two waiters see the same dead owner, both can run. This needs a killed difftest plus two more on the same case at that moment; it is stated in the file and not handled.
- **Not changed, stale after item 2:** the `shims/unix/socket.rs` reason in `harness/scope.json` and the `socket.ts` text ("no socket fd exists"), both part of review miri-tail-b N1.
- Shared data written: run dirs `w39-lock-a` and `w39-lock-b`, and the `coverage.json` above. The lock file is removed after use (0 left in `tmp/miri-temp`).

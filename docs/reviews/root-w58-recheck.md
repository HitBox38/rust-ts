verdict: PASS WITH NOTES

Independent re-check of root's fix for review root-w58-check (`docs/reviews/root-w58-check.md`, `4cdb800b`, APPROVE WITH NITS N1-N4).
Subject: commit `80e5a32f` on `integ-w58` ("review root-w58-check N1-N4"), and the three harness-m7b merges above it up to head `0c8742b8`.
I am read-only on the code: this file is all I wrote to the tree. The review branch starts at `0c8742b8`. Line numbers are at `0c8742b8`.
Setup: `.env.local` from `integ-w39` plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`; `bun install --frozen-lockfile`; AC power
throughout; no `GATE_RUNNING` in the main checkout; no open STOP. The comparison and mutation runs used two detached worktrees (`c708c5d5`,
`80e5a32f`) in this session's scratch directory, removed afterwards.

**N1-N4 are fixed as asked, nothing else changed in behaviour on the root host, and the three harness-m7b merges are automatic.** The notes
are informational; none needs action before the gate.

## 1. N1-N3: the shared helper

- **N1.** `src/rustc_session/filesearch.ts:162-188`: `REPO`, `DEFAULT_SYSROOT`, then `default_sysroot`'s upstream `///` doc, the
  "not ported (no marker; filesearch.rs:279 ...)" note and the function's `PORT` block, then the function (`:189`). The helper is gone
  from between them. Fixed.
- **N2.** One `export function oracle_sysroot_env()` in `src/rust_ts/oracle_sysroot_env.ts`. `git grep oracle_sysroot_env` finds
  exactly two users: `filesearch.ts:196` (`default_sysroot`) and `llvm/tools.ts:72` (`oracle_sysroot`). The `80e5a32f` diff of both
  files is only the deleted copy plus one import line; neither spawn changed otherwise. Fixed.
- **Import cycles: none possible.** `oracle_sysroot_env.ts` has no import at all (it reads only `process.env`), so it cannot close a cycle.
- **Lazy load holds.** I ran `bun --preload <dump require.cache> src/rust_ts/main.ts --emit=metadata hello.rs` on `c708c5d5` and on
  `80e5a32f`, once with `--sysroot <oracle sysroot>` and once without. All four exit 0 and write `libhello.rmeta`.
  - On both commits and in both modes the sorted module lists differ by exactly one line: `+ src/rust_ts/oracle_sysroot_env.ts`
    (2105 → 2106 modules).
  - No `src/rust_ts/llvm/` or `src/rustc_codegen_llvm/` module loads on `80e5a32f`, so `filesearch.ts` does not pull in the IR model.
    Before the fix the helper lived in `tools.ts` too, but `filesearch.ts` never imported it from there, so this was never at risk;
    the new module is the only addition.
- **Environment, identical in effect apart from the two Windows names (N3).** Before: `RUSTUP_AUTO_INSTALL=0` plus `PATH`, `HOME`,
  `RUSTUP_HOME`, `CARGO_HOME` when set, in both copies. After: the same, plus `USERPROFILE` and `SYSTEMROOT` when set. Neither is set
  in this host's environment, and nothing under `scripts/`, `harness/` or `src/` sets either on a non-Windows host (they are only
  passed through: `scripts/miri.ts:50`, `harness/compiletest.ts:1296`, and the Windows cases of `scripts/lib/env.test.ts`). So on
  macOS and Linux the child's environment is byte-for-byte what it was. The new doc comment cites `scripts/lib/env.ts`'s start-up set,
  which lists both names (`env.ts:34-35`). Fixed.
- **The default-sysroot guard** (`src/rustc_session/config_sysroot.test.ts`) passes on `0c8742b8` (3/3, `RUST_TS_REQUIRE_PROBES=1`).
  **It still reaches the fake `rustc`:** on a scratch copy of `80e5a32f` I made `Sysroot.new` read `default_` eagerly. The guard then
  fails with `rust-ts: unported: rustc_session::filesearch::default_sysroot (rustc +nightly --print sysroot failed: error: toolchain is
  not installed)`. That error text is the fake script's own, so the spawn under `oracle_sysroot_env()` found the fake through the test's
  `PATH`. Reverted (`git status` clean).

## 2. N4: the linked executable's bytes

`src/rustc_driver_impl/driver.oracle.test.ts:110-128`. For `x.rs` and `-ooptimize x.rs` (keyed by `args.join(" ")`, so no other case
matches) the test removes `WORK/<out>`, runs the oracle, reads the file, removes it again, runs the port, and compares with
`Buffer.compare(...) === 0` after the stderr/stdout/exit checks. Both cases run without `--sysroot`, so they link through the port's
default sysroot as intended.

Mutations, each on a scratch copy of `80e5a32f` (the test file is identical at `0c8742b8`), each reverted:

| Mutation | Result |
|---|---|
| none | 2 pass |
| flip the last byte of the oracle's buffer before the compare | **2 fail** (`rustc x.rs`, `rustc -ooptimize x.rs`) |
| port never runs (`const got = want`) | **2 fail**: `ENOENT ... /driver-oracle-<pid>-<rand>/x` (and `/optimize`) |
| port never runs, and the `rmSync` before the port side removed | 2 pass (the stale oracle file is compared with itself) |

So the comparison really runs, and the second `rmSync` is exactly what stops a stale file from passing: with it in place, a port that
writes nothing fails on the read instead of comparing the oracle's leftover. The first `rmSync` does the same for the oracle side, so a
file left by an earlier case cannot reach either buffer. `WORK` is `test_scratch_dir("driver-oracle")`, a fresh `mkdtemp` per process
(`src/rust_ts/test_scratch.ts`), so a concurrent run in another worktree cannot write into it either. Fixed, and robust.

## 3. The harness-m7b merges

| Merge | Parents | `--remerge-diff` | `--cc` | Files changed on both sides since the merge base |
|---|---|---|---|---|
| `688f53d4` (t3/add-m7b-report-suites) | `80e5a32f`, `3385d616` | empty | empty | none |
| `43dcec45` (t3/review-harness-m7b-r) | `688f53d4`, `99a5229d` | empty | empty | none |
| `0c8742b8` (t3/review-harness-m7b-recheck-r) | `43dcec45`, `7c6031a5` | empty | empty | none |

An empty `--remerge-diff` means each merge's tree is what git's own merge of the parents produces; an empty `--cc` means no hunk was
taken from neither parent. No file was touched on both sides, so there was nothing to resolve. `git diff 80e5a32f 0c8742b8` touches no
file under `src/`: only `docs/` (the harness-m7b handoff and reviews), `harness/` and `scripts/`. All automatic; no hand resolution.

## 4. Commands (at `0c8742b8`)

| Command | Result |
|---|---|
| `bunx tsc` | clean (exit 0) |
| `bun scripts/coverage.ts --check` | `markers ok (27220, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 527)` |
| `bun test ./src/rustc_session/ ./src/rustc_driver_impl/ ./src/rust_ts/ ./harness/m7-suites.test.ts ./scripts/lib/unit-steps.test.ts` | 609 pass, 0 fail, no skips, 44 files (275 s) |
| `bun scripts/difftest.ts --suite native-hello --jobs 6` | MATCH 1/1 (100%), criterion met; run `20261114-162634-root-or1w` |

## Notes

**N1 (informational): the helper unifies the environment, not the whole spawn.** The two `--print sysroot` spawns still differ in two
pre-existing ways the fix did not touch and the first review did not ask about: `default_sysroot` passes `stdin: "ignore"` and strips
only the trailing newline (`filesearch.ts:197`, `:210`), while `oracle_sysroot` inherits stdin and `.trim()`s (`tools.ts:72-74`).
Both are deliberate on the `filesearch.ts` side (its `PORT` block takes the oracle's string as printed), and on this host the two give
the same path. Nothing to do now; if lockstep is the goal, a later change could share the spawn itself, not only its environment.

**N2 (informational, test ergonomics): the N4 compare fails with an opaque message.** `expect(Buffer.compare(a, b)).toBe(0)` reports
only `Expected: 0, Received: -1`. If it ever fires, the first look will be at the two files' sizes and first differing offset; an
`expect(..., "<out>: <size a> vs <size b> bytes")` message would save that step. Not needed for correctness.

**N3 (informational, Windows, unchecked host).** `process.env["SYSTEMROOT"]` finds `SystemRoot` on Windows only because Bun's
`process.env` lookup is case-insensitive there, as Node's is; the child then receives the upper-case spelling, which Windows also treats
case-insensitively. That is fine, but it is unverified here (AGENTS.md §5); the guard in `config_sysroot.test.ts` skips on `win32`, so the first Windows run of
`driver.oracle.test.ts`'s `x.rs` case (which reads the default sysroot) would be the one to confirm it.

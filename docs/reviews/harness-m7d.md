verdict: FAIL

Independent review of harness batch `harness-m7d` (wave 40t): the M7d suites `rg-build`, `rg-behaviour`, `rg-behaviour-rgtest`, `pm-self`
and `std-self`, the M7d criteria group with `minMatch`, `scripts/gate.ts`'s `oracleRuns`, and harness-w40s N1 and N2.
Subject: commit `b27cf4f9` on `t3/add-m7d-harness-suites`, on top of main `9c662b55`. Handoff `docs/handoff/harness-m7d.md`; root's record of
the six decisions in `docs/state/history.jsonl` (2026-11-15, "harness-m7d (its six decisions").
I am read-only on the lane: this file is all I wrote to the tree. Line numbers are at `b27cf4f9`. AC power throughout, no `GATE_RUNNING`,
load 3-5, `--jobs 6` at most, `RUST_TS_AGENT=review-m7d-r1`. My scripts and outputs are in this session's scratch directory.

**The protected side is untouched, and pm-self is sound: its port side really builds every aux crate with the port, and 20 of 20
sampled cases MATCH.** The ripgrep suites have three defects that make results wrong or uncompared, each shown by a run:
- a lock wait prints a line, with a pid, into the stderr difftest compares and caches (F1: 11-16 of 63 rg-behaviour cases differ
  oracle against oracle at `--jobs 4`);
- an interrupted build leaves cargo's compiler running and records a failed build for the key, which later runs trust (F2);
- the build scripts' printed output, the one thing the port-built build scripts produce, is compared by name only: this cargo writes
  it to `run/stdout`, and the byte comparison looks for `run/output` (F3).

All three are small fixes. The design otherwise holds up. With integ-w60's code, the port's `rg-build` report is **byte-identical to
the oracle's**: 742 lines, `cargo build` exit 0, `rg` built, 5 min wall. The port-built `rg` gives the oracle's output on all 63 scripted
queries. I compared the 10 `run/stdout` files of F3 by hand too: all 10 are equal, so F3 hides nothing today.

## 1. Protected suites are untouched

**All 81 existing suites, dumped independently** (my own script, not the lane's). It imports `harness/suites.ts` and `scripts/difftest.ts`
from the tree, and ran on `9c662b55` and on `b27cf4f9`, both checked out in this same worktree, so the repo path is the same in
commands and keys. Per suite it hashes:
- the metadata (every non-function field, the subset names, the list of hooks);
- every case (id, file, args, env), the skips and the `unstable()` list;
- every case's oracle and subject command (or the batch command), `caseLock`, `irArgs` and subset membership;
- `oracleKey()`;
- every 25th case's `blessed` and full `oracleCacheKey`.

Result: **81 of 81 identical** (7 min per dump). The five new suites are the only additions.

**`scripts/gate.ts`** (`:58-61`, `:245-246`): two new branches in `oracleRuns`, matched on the new wrappers' paths only
(`RG_BUILD`, `RG_BEHAVIOUR`, `PM_SELF_RUN`). The new imports (`scripts/rg-build.ts`, `scripts/rg-behaviour.ts`, `scripts/pm-self-run.ts`)
have no load-time effect: everything is behind `import.meta.main` or a memo. No protected suite's command can reach the new branches,
and nothing else in how a suite runs or is scored changed. None of the new suites has a baseline, so the gate's defaults are unchanged
(`harness/m7d-suites.test.ts` checks this).

**`harness/compiletest.ts`**: `export` added to `AUX_DIR` and `auxEnv`, nothing else. **`pmCorpus`** also returns `auxSteps`; pm-ui's cases
are unchanged (in the dump).

## 2. Suite design

### rg-build

- **Stderr with masks plus sorted `Compiling` lines is sound.** The sorted list carries its count and keeps duplicates, so a crate compiled
  twice shows as a second line and a higher count, and a missing one as a lower count. The same holds for the compiler-call lines
  (`probe|compile <crate> <-C metadata>: exit, stderr size+sha`, sorted): one line per call. Every other stderr line keeps its order.
  The oracle's run shows 34 `Compiling` lines, 45 compiles and 8 probes, and two oracle runs gave byte-identical reports (742 lines).
- **Objects and binaries by name only is right** for plan-m7 D2/D8 (`-O` is not byte parity). The names still pin the CGU count and names
  (macOS keeps the `.rcgu.o` files for `debug = 1`), the metadata hashes and the file set.
- **But the bytes that should be compared are not all compared: F3.**
- **The oracle cache key** covers ripgrep's sources and every registry crate (`inputDirs`), `Cargo.lock` (the case file, and in
  `inputDirs`), the profile (ripgrep's `Cargo.toml`), the toolchain (`rustcDriverHash`; cargo is the same pinned toolchain), Bun
  (`oracleVersion` hashes the first word, the Bun binary), the wrapper scripts (`RG_BUILD_SOURCES`), and `cc -v`, `ld -v`, the SDK version,
  `sw_vers`, `SDKROOT`, `DEVELOPER_DIR`, `LIBRARY_PATH` (`hostToolsId`). Not covered, both minor: `$RG_ROOT/cargo/config*` (outside
  `cargo/registry/src`) and `MACOSX_DEPLOYMENT_TARGET`, which rustc reads.
- **What the compiler tells cargo is not recorded: N3.**

### rg-behaviour

- **The queries are deterministic when nothing waits.** Run one at a time, each query gives identical output across six runs (one checked
  by hand, three sides each). The masks are only the `--json` `elapsed`/`elapsed_total` objects and `--stats`'s `<n> seconds` lines.
  `--files` and every directory search sort by path, which the unit test enforces.
- **But every query takes rg-build's lock to read the stamp, and a wait prints into the compared stderr: F1.** Oracle against oracle at
  `--jobs 4`, three runs: 16, 11 and 11 of 63 cases differ, a different set each time. Six queries started together: 5 of 6 have
  `note: waiting for pid 63617 to release …/ripgrep/rg-build.lock` in their stderr. At `--jobs 1`, where nothing waits, two runs were
  63/63 equal. So the masks are enough, and the lock note is the only source of the differences.
- **The on-demand build's key** (`rgBinKey`, `scripts/rg-build.ts:87-89`) is right for the oracle: rg-build's sources, `Cargo.lock`, the host
  tools, the compiler argv and the rustc build. For the port it covers `src/` exactly (`HEAD:src` plus every changed or untracked file), but
  not the port's other inputs: N1. A stale `rg` cannot reach a gate that names `rg-build` first (heavy suites run in their given order, and
  `rg-build` always rebuilds and rewrites the key's binary), but it can reach other runs.
- **The corpus** sits under its own `.git`, so the repository's `.gitignore` above it does not apply (`--files` is right). rg also reads
  `.ignore`/`.rgignore` from every parent directory; none exists today (I checked up to `/`): N4.

### rg-behaviour-rgtest

**Faithful to M7d.** plan-m7 §6 lists ripgrep's own integration tests "as a report", and the suite has no criterion; M7d's "rg-behaviour
scripted set MATCH" is the `rg-behaviour` group alone. An oracle-built test binary is the harness, not the subject, so building it once
with the oracle is right. `TMPDIR` is `rust-ts-rgtest-<hash>` in this process's temp directory, outside any git repository (checked by
`rgtestTmp`), and emptied at the start of each run; the gate and difftest pass the caller's `TMPDIR` through (`scripts/lib/env.ts`).
The same lock-note problem (F1) applies to its two locks.

### pm-self

- **The port side uses the port for every aux crate, with no fallback.** A case's subject command passes `--compiler
  ["<bun>", "<repo>/src/rust_ts/main.ts"]`, and pm-self-run runs every step with exactly that compiler and the step's own environment
  (`HOME`, `PATH`, `RUSTC_ICE`, `RUST_BACKTRACE`: no `RUST_TS_IMPL`, so never the shim). Over all 282 cases, no subject command names pm-ui's
  oracle-built aux directory (`$DATA/aux/ui/…`): every path was rewritten to the placeholder. The 311 steps are 292 proc macros, 16
  dylibs and 3 others.
- **Three cases checked by hand** (`proc-macro/add-impl.rs`, `derives/attr-macro-changes-type-kind.rs`,
  `proc-macro/issue-76270-panic-in-libproc-macro.rs`): I ran both sides and polled the process table every 100 ms. The oracle side shows
  its `rustc` processes, the port side none. Each side's aux dylib is byte-identical to the other's (e.g. `libadd_impl.dylib`, 439,632
  bytes), and stdout, stderr and exit agree (the third case exits 1 on both, as pm-ui).
- **`pm-self --sample 20` on the port: 20/20 MATCH** (13/13 in `tests/ui/proc-macro`), run `20261115-103549-review-m7d-r1-r6ml`, 15 s.
- The key: the case args carry every step's file, argv and environment and the aux key (`auxKey`: every aux source and its deps), the
  main file and its deps are difftest's, and `oracleKey` adds pm-self-run and the rustc build. Sound.

### std-self

Defined, no case, skipped with a reason that says why. Acceptable.

### The M7d criteria and `minMatch`

`scripts/criteria.ts:68-71` matches plan-m7 §6: rg-build and rg-behaviour 100% with every case counted (an oracle timeout or UNSTABLE is not
met), check-rg 34 of 34 (the count regex takes the 34 crate ids and leaves out the run case and the probe), pm-self at least one MATCH.
`minMatch` is one extra term in `met` (`:206`) on the exact count, and the verdict line prints it. The tests cover each group's
met/not-met edges, and M7a's check-rg group still accepts 33. `--milestone M7` now needs M7d, as "M7 = M7a-d" says.

## 3. Determinism and safety

- **Paths.** Builds run in `$RUST_TS_DATA/ripgrep/target/rg-build` (emptied first, moved to `kept/rg-build/<side>`), the integration-test
  build in `target/rgtest-bin` (deleted after), queries in `ripgrep/behaviour/<hash>`, rgtest in `ripgrep/rgtest-run`, pm-self in
  `$DATA/pm-self/<hash>/aux` (emptied first). Only rgtest's `TMPDIR` is outside, by design.
- **Environment.** rg-build drops every `CARGO_*`, `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUSTC*` wrapper and `GIT_DIR`-like variable and sets
  check-rg's `rgCargoEnv`; its compiler wrapper drops `CARGO_MAKEFLAGS` only. A query runs rg with `PATH=/usr/bin:/bin` and its own
  `HOME`, nothing else; rgtest adds `TMPDIR` and `RUST_BACKTRACE=0`.
- **Interrupts are not safe: F2.**
- **Shared `$RUST_TS_DATA` across worktrees: N2.**

## 4. Evidence

| run | result |
|---|---|
| `rg-build`, oracle side, twice (`run --side oracle`) | exit 0, `rg` built, 22 s and 21 s, 0.70 GB max RSS; the two reports byte-identical |
| `rg-build`, port side with integ-w60's compiler (`6d23a76a`, which has `LLVMRustGetSymbols`) | **report byte-identical to the oracle's** (742 lines, `diff` empty); exit 0; `cargo exit 0`; `rg --version` prints `ripgrep 15.2.0`; 45 compiles + 8 probes, all exit 0; **300 s wall**, 526 s user, **4.5 GB max RSS**, at load 4-5 |
| the port-built `rg` against the oracle's, all 63 scripted queries (the query wrapper with the same port argv, so it used the kept binary after one rebuild) | **63/63 equal** (306 s, including the 5-minute rebuild of the port's `rg`: an `oracle-self` run had evicted it, N2) |
| `rg-behaviour` oracle against oracle, `--jobs 4`, three runs | 47, 52, 52 of 63 equal (F1) |
| `rg-behaviour` oracle against oracle, `--jobs 1`, twice | 63/63 equal, both runs (39 s, which includes a rebuild of the subject side's key, then 13 s) |
| `pm-self --sample 20 --jobs 6` (port) | 20/20 MATCH |
| `mono-ui --sample 200 --jobs 6` | 200/200 MATCH (`20261115-103029-review-m7d-r1-vj6r`) |
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/` / `./scripts/` / `./tools/`, one root at a time | 90 / 500 / 84 pass, 0 fail (9 s / 93 s / 8 s) |

**How I ran the port's rg-build.** integ-w60 does not contain this batch, so I ran this batch's wrapper from my worktree with integ-w60's
compiler after the `--`: `bun scripts/rg-build.ts run --side subject -- bun <integ-w60>/src/rust_ts/main.ts --sysroot <oracle sysroot>`,
in `$RUST_TS_DATA/ripgrep`, as the suite does. That is the suite's subject command with another `main.ts`; I compared its report with
the oracle side's as difftest does.

**Disk.**
- **One rg-build of each side keeps about 240 MB:** the oracle's tree is 124 MB and the port's 117 MB, plus 0.4 MB of logs each.
  `bin/<side>` is 6-7 MB per `rg`. The lane's 1.4 MB figure for the port's tree was from a build that stopped at its first crate.
- **Peak during a port build:** one tree plus the kept one, about 250 MB.
- **pm-self:** 144 MB, unchanged by the sample. `ripgrep/behaviour` is 4.8 MB.
- **What I left:** `$RUST_TS_DATA/ripgrep` was 491 MB when I started. I deleted the port's kept tree and logs and its `bin/subject` key,
  which only my command line used, so it ends at 490 MB.
- **Free space:** the volume showed 13 GiB free at the start and at the end. Other lanes share it.

## Findings

**F1. A lock wait prints a line with a pid into the stderr that difftest compares and caches.** `scripts/rg-build.ts:185` and `:192`, and
`scripts/rg-behaviour.ts:111` and `:154`, call `withCaseLock` with its default `note`, `console.error`. When the lock is held, the wrapper's
stderr gets `note: waiting for pid <n> to release <lock>: another run has this lock`.
- Single mode compares stderr, so the case is a false DIFF; on the oracle side the line, pid included, is **written to the oracle cache**,
  and every later subject run of that case differs until the key changes.
- `ensureRg` takes rg-build's lock for every query, even only to read the stamp. So any second process at once waits: another case of
  a non-heavy run (`oracle-self --jobs 4`: 11-16 of 63 differ), or, inside difftest's one-at-a-time heavy runs, another worktree's or
  agent's rg-build, rg-behaviour or rgtest on the shared `$RUST_TS_DATA`. A port build holds that lock for 15+ minutes.
- Fix: pass a silent `note` (`() => {}`), as scripts/native-run.ts, ir-run.ts, host-rlib-run.ts and rlib-native-run.ts already do. Better
  still, read a stamp without the build lock (the stamp directory is renamed into place atomically), so queries do not queue behind a
  build of the other side.

**F2. An interrupted build leaves the compiler running and records a failure that later runs trust.** `scripts/rg-build.ts:139-141` and
`:176-179`.
- On SIGTERM (difftest's timeout: `run` calls `proc.kill()`) or SIGINT, the handler sends SIGTERM to cargo only. cargo does not pass it on:
  in a scratch cargo project with a slow `RUSTC`, after `kill -TERM` cargo exited 143 and its compiler kept running with ppid 1. Here that
  compiler is the port, at up to several GB, still writing into the target directory that the next build empties.
- Then `buildLocked` carries on and writes `bin/<side>/<key>/stamp.json` with `no rg: cargo exit <n>`. `ensureRg` trusts any stamp, so
  every later rg-behaviour and rgtest run of that key never rebuilds:
  - port side: exit 1, a DIFF, not the real result or a TIMEOUT, until `src/` changes;
  - oracle side: `die` (`scripts/rg-behaviour.ts:65`) exits 1, and difftest caches that output for all 63 queries
    (`runOracle` caches any oracle output that did not time out). Deleting the stamp does not clean the cache.
- Fix: run cargo in its own process group and signal the group, as native-run does for its programs. Write no stamp when the build was
  signalled or cargo ended by a signal. And never let an oracle-side failure stamp stand: rebuild, or fail without output difftest caches.

**F3. The build scripts' output is not byte-compared, though the handoff says it is.** `scripts/lib/rg-build.ts:83` `comparedBytes`
matches `run/(output|stderr|root-output)`. This cargo's build-dir layout writes the build script's stdout to `run/stdout` (10 of 10 runs in
the oracle tree: `invoked.timestamp`, `root-output`, `stderr`, `stdout`). So the `cargo:` lines, such as anyhow's
`cargo:rustc-cfg=error_generic_member_access`, are compared by name only. Those lines are what the port-built build scripts produce (plan-m7
D19: "the first time port-built programs run during a build"). A wrong one changes a `--cfg` of the crate's compile, which neither the
call lines (exit, stderr) nor the artifact names show. The unit test (`scripts/lib/rg-build.test.ts:59-61`) pins the old name. Today the port's 10 files equal the oracle's (I checked by hand,
section 4), so nothing is hidden yet. Fix: add `stdout`, with a test on this layout.

**N1. The port's kept `rg` is keyed by `src/` only.** `scripts/rg-build.ts:70-89`. The port also runs code and data outside `src/`:
- `scripts/lib/common.ts`, `oracle.ts`, `llvm-tools.ts` (the pinned tools' hashes), `env.ts` and `miri.ts`, and `tools/llir/ffi_gen.ts`;
- the pinned LLVM tools themselves;
- the Bun binary: the path in the compiler argv stays the same across an upgrade;
- the oracle sysroot's std, which the port links against: the subject's key has no `rustcDriverHash`.

Add those to the subject's key: hashes of the imported `scripts/` and `tools/` files, `llvmToolHashes()`, the Bun binary's hash and
`rustcDriverHash()`. Until then, a gate should name `rg-build` before `rg-behaviour` and `rg-behaviour-rgtest`.

**N2. Worktrees evict each other's binaries mid-run.** The key includes the compiler argv, so each worktree has its own key. `buildLocked`
deletes every other key of the side (`scripts/rg-build.ts:178`). A query that got its path from `ensureRg` has released the lock before it
copies or spawns `rg` (`scripts/rg-behaviour.ts:85`, `:161`), so another worktree's build can delete the file under it: a spawn error, exit
2. Keep a few keys, or delete only keys older than the lock holder's run.

**N3. What the compiler tells cargo is not in the report.** `scripts/rg-build-rustc.ts:31` passes stdout through and records nothing of
it. So the answers cargo acts on (`-vV`, `--print=cfg`, `--print=file-names`, `--print=sysroot`) are compared only through their effects.
A different `-vV` changes every metadata hash, which shows. A different `cfg` shows only if it changes a dependency or a build script's
result. Record a probe's stdout size and hash in its call line.

**N4. Ancestor ignore files are outside every key.** rg reads `.ignore` and `.rgignore` in every parent of the corpus (the `ignore`
crate's `add_parents`), up to `/`. There are none today. A check like `rgtestTmp`'s would make that explicit, or the corpus could live
under the temp directory, as rgtest's `TMPDIR` does.

**N5. Small.**
- `scripts/rg-build.ts:28`'s header says a missing setup exits 2; `die` exits 1.
- pm-self's aux steps drop `RUST_TS_IMPL` (`scripts/pm-self-run.ts:83` runs each step with exactly its environment). So under
  `--impl shim` or `stub` the aux crates are still built by the port; only the main compile follows the flag. That is harmless while the
  port builds them all, but the harness self-check is then not what it says for this suite.

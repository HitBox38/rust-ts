verdict: APPROVE WITH AMENDMENTS

Design: plan-m6 (`docs/plan-m6.md`, `docs/handoff/plan-m6.md`, branch head f08c88a1). Reviewed against PLAN.md §3–§5, AGENTS.md,
PORTING.md and the plan-m5 precedent. I am read-only: I wrote only this file. My scratch scripts and outputs are in `/tmp/m6rev/`.
I ran Miri only through the isolated home (`RUSTUP_HOME=$RUST_TS_DATA/rustup-miri`). I ran no rustup command and did not change
the oracle toolchain.

The direction is right. Miri is exactly what PLAN.md §3 ("later: Miri as an execution oracle") and §4 ("const eval + Miri-style
shims = an interpreter") describe. The oracle is reproducible and deterministic, and the key numbers mostly reproduce. There are
two **blocking** findings (B1 D3's scope, B2 lanes mixing harness and port work). Both can be fixed by amending the plan, with no
redesign, but root must apply them before the affected lanes are briefed. The other findings are non-blocking amendments.

## What I checked

| claim | how | result |
|---|---|---|
| The Miri oracle is the pinned commit | `miri --version`, `rustc -vV` in the isolated toolchain; sha256 of `bin/rustc` and `librustc_driver-*.dylib` against the oracle's | **OK**. `miri 0.1.0 (6f5da406b5 2026-10-10)`; isolated rustc commit-hash 6f5da406b56c…; rustc and librustc_driver are **bit-identical** to the oracle's. Upstream checkout HEAD 6f5da406b56c; `src/tools/miri/src` is 56,307 lines |
| Oracle toolchain is clean | `lib/rustlib/components` of `~/.rustup/…nightly-2026-10-11…` | **OK**. cargo, rust-std (aarch64-darwin, x86_64-linux), rustc, llvm-tools, rustc-dev; no rust-src, no miri |
| Determinism | 6 cases run twice each under the isolated Miri, full stdout+stderr sha256 + exit code: hashmap-debug-format, fn-bare-spawn (threads), stdout-before-main (UB), env-funky-keys (isolation error, 3.9 KB backtrace into std), cast-region-to-uint (prints addresses), binary-op-on-fn-ptr-eq | **OK**. 6/6 SAME. (The lane's sample hashed only stdout plus the first stderr line, so this is the first full-stderr check) |
| run-pass outcome counts | **all** 3,256 run-pass cases + 238 run-fail cases under the oracle Miri (8 workers, 60 s timeout) | Sample reproduced: the 300 sampled ids are 281 exit 0 again. Full run-pass: 3,062 exit 0 (94.0%), 163 exit 1, 29 exit 101, **2 killed at 60 s**. run-fail: 140 exit 101, 97 exit 1, 1 exit 0. File counts: run-pass 3,770 ✓; run-fail+run-crash files are 244, not "292" (292 is probably file×revision: fix the wording) |
| run-pass oracle cost ("p99 0.25 s, max 0.26 s, ≈ 2 min CPU") | same full run | p50 0.02 s, p99 0.31 s, **max > 60 s**. `collections/hashset-connected-border-12860.rs` and `range/step_overflowing.rs` time out on the oracle (the first ran > 140 s standalone). Four more take 5–19 s (`threads-sendsync/task-comm-6.rs` 18.7 s, `generics/issue-94923.rs` 10.3 s, `impl-trait/example-calendar.rs` 8.3 s, `task-comm-5.rs` 5.1 s). 13 cases ≥ 1 s, 9 ≥ 2 s. Sum 274 s (≈ 154 s without the two timeouts). **The max/tail claim is wrong**: it was extrapolated from a 9% sample (N3) |
| rustc_const_eval 764/764 and other coverage rows | `bun scripts/coverage.ts` | **OK**. 764/764; mir_transform 1,101/1,101; ty_utils 123/123; metadata 448/453 (host_dylib 1/6, the 5 fns listed); rustc_monomorphize 0/153; codegen_ssa 111/1,091; symbol_export 29/29; symbol_mangling 71/71; total 22,590/25,518 |
| Miri line counts by area | `wc -l` at the pin | **OK**. genmc 2,097, native_lib 1,583, windows 3,184, tree_borrows 5,486, x86 4,039, unix/fs.rs 2,404, machine.rs 2,205. In-scope set = 33,788 lines (plan: ≈ 33.1k + bin/log). Every in-scope Miri file is in exactly one lane, and the lane sums match the plan (2.1k–2.9k each) |
| 10.8× CTFE slowdown | re-ran `ctfe20000.rs` / `ctfe200000.rs` on port and oracle (`--target x86_64-unknown-linux-gnu --emit=metadata`) and differenced the two sizes | **Reproduced, method sound** (differencing removes startup). Port 2.28 / 7.25 s, oracle 0.06 / 0.55 s → 27.6 µs vs 2.72 µs per iteration = **10.1×** (plan 10.8×; noise). rmetas byte-identical. It measures the CTFE machine, not Miri, so applying it to Miri (with SB / data-race work) is an estimate, and the plan labels it as one |
| hello.rs MIR with `MIRI_DEFAULT_ARGS` against the Miri sysroot | port vs oracle `-Zunpretty=mir` | **OK**. Byte-identical stdout (864 B) and stderr |
| pm test count | `grep -l '^//@ proc-macro:'` in tests/ui | 273 (plan 272; 50 run-pass ✓). Immaterial |
| D5 versions | root `Cargo.lock`, miri's deps; `strings` on the isolated `miri` binary | **Provable**. The root lock's `miri` entry depends on `rand 0.10.1`; rand 0.10.1 → `chacha20` (only 0.10.0 in the lock) + `rand_core 0.10.1`. The binary embeds `rand-0.10.1`, `smallvec-1.15.1`, `chrono-0.4.42` source paths, so it was built from the root lock, not miri's own (rand 0.10.3 / chacha20 0.10.2) |
| Miri needs the native backend's `target_config` | bin/miri.rs:112 `make_miri_codegen_backend` | The port already has a stand-in (`src/rust_ts/codegen_backend.ts`, oracle table `target_config.gen.ts`, plan-m5 D4). Run-pass cases with non-default `-Ctarget-cpu/-feature` stop there, which is acceptable. The `miri-driver` lane must wire `MiriCodegenBackend` onto this stand-in (N9) |

## Decisions

| | verdict | reason |
|---|---|---|
| D1 | **agree** (+ guard) | Verified: same commit, bit-identical rustc/driver, deterministic. Native output is rightly rejected for M6. Amend: the guard test should also assert that the isolated toolchain's `rustc -vV` commit-hash and `librustc_driver` sha256 equal the oracle's. Also keep a backup of `rustup-miri`, since re-installing needs the network |
| D2 | **amend** | Agree on the layout and markers. (a) Excluding "sockets" as a whole is wrong at one edge: `shims/unix/socket.rs:172` emits the isolation error (`reject_in_isolation("`socket`")`) that run-pass cases reach (≥ 4 run-pass files use `std::net`). Port socket.rs's isolation-on prologues (as is done for fs.rs) and exclude only the isolation-off backends (`tcp_socket.rs`, `virtual_socket.rs`, `socket_address.rs` beyond what the reject paths need). (b) The `scope.json` exclusions and the new `vendor` entries need owner approval, per that file's own comment. Say so in the decision record |
| D3 | **amend — blocking (B1)** | "Typing only, no logic change" is false. The CTFE port folded `OFFSET_IS_ADDR` into constants and dropped the upstream arm: `interpret/intrinsics.ts:598` (`ptr_offset_from`: "the `if` arm is not taken"), `place.ts:602`, `memory.ts:881`/`:1928`, `validity.ts:580`/`:848` (all `Provenance_CtfeProvenance.OFFSET_IS_ADDR`), `pointer.ts:131` `OFFSET_IS_ADDR_OF_EVERY_PROVENANCE = false`, `allocation.ts` `Prov_`. Miri's provenance has `OFFSET_IS_ADDR = true`, so these arms must be re-ported from upstream (a logic change; the CTFE paths stay the same). The interp-generic brief must (1) inventory every `PORT:` that folded an associated type or const, (2) re-port the dropped arms, and (3) get a reviewer check against upstream as well as unchanged protected suites |
| D4 | **agree** | It keeps interpreter divergences apart from encoder divergences. The port already decodes the Miri sysroot. The mono lanes are not on the M6 gate path (the Miri run path never calls `collect_and_partition_mono_items`; only `MiriDepCompilerCalls` does). Keep them as optional M7 groundwork that never blocks the M6 gate (N8) |
| D5 | **agree** | Versions proven as above. The probe still has to confirm that `StdRng` in rand 0.10.1 is ChaCha12 from chacha20 0.10.0, and the draw order. Record the vendor entries in scope.json (owner approval, D2b) |
| D6 | **agree** | Every oracle outcome is a case, and the `-O` warning is fixed text. Note that `exec-env` → `-Zmiri-env-set` is a harness translation (with isolation on, Miri forwards no host env). That is fine because both sides run the same argv. Put it in the harness batch's review |
| D7 | **agree, amend the record** | Defensible against the line-by-line principle. It *is* rustc's path (host_dylib.rs, creader, bridge server, ported). The only non-ported code is a ~150-line FFI edge, the kind PORTING §7 already allows, and "interpreting" proc macros has no upstream analogue. Amend: (a) edit PLAN.md §4's sentence in the same commit as the decision, so the plan doesn't silently contradict it. (b) Record the M7/M9 consequence: until rust-ts can build host proc-macro dylibs itself, every proc macro rust-ts runs was compiled by the oracle. M9 (rust-ts compiles tsc-rs, whose deps likely include derive macros) therefore requires M7 to emit `--crate-type proc-macro` dylibs **for the host triple**, beyond PLAN.md's x86_64-linux target, with the same `#[repr(C)]` bridge ABI. Otherwise M9 must run on x86_64-linux (WSL2) with port-built dylibs. Put this in PLAN.md §5's M7/M9 rows. (c) Before `pm-host` starts, verify `bun:ffi` `cc`/TinyCC on the Windows host that AGENTS.md §5 names (only macOS arm64 was measured) |
| D8 | **agree** (+ ordering) | Porting both bridge halves keeps the rpc byte format honest. But `pm-lib`'s target (the 30 `quote!` cases) needs `pm-bridge`'s client/server (`run1`/`run2`). Mark `pm-bridge` ✱ contract-first, or move `pm-lib`'s acceptance target after it merges |
| D9 | **amend** | Agree that SB, data-race, weak memory and validation stay on. But it contradicts the waves: D9 says Tree Borrows lands "after the gate", while wave 38 (→ gate M6) has `miri-tb-a/b`. Pick one. Since 73 of the 389 tests/pass + panic files mention tree-borrows (most as revisions), the choice changes what `miri-pass` ≥ 80% means (see G2) |
| D10 | **amend** | The release oracle compiles out `debug!`/`trace!`, so only `info!`-and-above events are comparable. Port only those. The trace format is tracing-tree output (indented, with `frame=` spans), and `rustc_log` is excluded in scope.json, so `miri-diff.ts` should compare normalised event lines, not raw indentation. Porting events into `rustc_const_eval/interpret/*` edits files the interp-generic and fixer lanes own: give it its own lane after interp-generic, not part of `miri-driver` |
| D11 | **amend** | Hello ≤ 3 s and p99 ≤ 10 s are realistic: oracle p99 0.31 s × 10–30 + 0.7 s startup ≈ 3.8–10 s. "All within 60 s except Miri's weak-memory/fs tests" is not: run-pass has its own tail (13 cases ≥ 1 s, 9 ≥ 2 s, 6 ≥ 5 s, 2 oracle timeouts). Record the measured list. Give the 2 oracle-timeout cases an `oracleTimeoutMs` or accept them as ORACLE_TIMEOUT (never MATCH). Count gate wall-clock too: every accepted Miri suite re-runs on every gate (N5) |
| D12 | **agree** | aarch64/loongarch are unreachable on the target. x86 is late but before the gate, which is fine |
| D13 | **amend** | Agree that tests/pass + panic are a gate source. But the measured case set ignores ui_test directives: 109/389 files use `//@revisions`, `//@only-target` or `//@ignore-target` (63 use revisions). That is why 13 tests/pass cases "fail" on the oracle (aarch64/loongarch/windows-only tests, a TB test run without its `-Zmiri-tree-borrows` revision). harness-m6c must parse revisions, only/ignore-target, `rustc-env` and per-revision `compile-flags`, as Miri's ui.rs does, before the threshold means anything |
| D14 | **agree** (+ note) | Isolation-on paths byte-exact, host-dependent paths through `src/std` stand-ins: right. Note that the driver's `config.current_exe = canonicalize(file)` (bin/miri.rs:165) is host fs access outside isolation, so it goes through a stand-in too. Also see N2 (absolute paths in oracle output) |

## Findings

**B1 (blocking, D3).** As above: interp-generic is not typing-only. Root should amend D3's text and the lane brief before the
lane starts: inventory the folded constants, re-port the dropped `OFFSET_IS_ADDR == true` arms, and get an upstream-fidelity
review on top of full protected suites. Otherwise the lane will do what D3 literally says, and Miri's `ptr_offset_from`,
ptr-to-int / read-pointer-as-bytes paths and validity checks will run CTFE's arms. That fails silently as DIFFs much later.

**B2 (blocking, waves).** Three lanes mix harness/scripts work with porting, which AGENTS.md §2 forbids ("changes to `harness/`
or `scripts/` need their own reviewed batch"):
- `pm-host` bundles `harness-m6b`;
- `miri-sysroot` bundles the `miri-sysroot-*` suites;
- `miri-driver` bundles D10, which needs `scripts/miri-diff.ts` and edits to rustc_const_eval files.

Split each into a porting lane and a harness batch. Also: wave 35's `UPSTREAM.json` sparse change and the coverage.ts `miri` crate
are inside `harness-m6a`, which is right, but that batch then covers five things (toolchain + guard, cache key, run mode, three
suites, coverage, sparse). Consider splitting the run mode + suites from the toolchain/guard/coverage part so each review stays
small.

**G1 (non-blocking, gates).** M6a/M6b/M6 can be measured with the existing harness. difftest MATCH counts per suite are enough,
the thresholds are root-checked like M4's 97.4%, and new suites start unprotected and only grow. Two gaps:
- State the denominator: are ORACLE_TIMEOUT and UNSTABLE cases in or out?
- Justify 90% for run-pass. The oracle's own mix is 94.0% exit 0, so 90% MATCH could be met while getting almost none of the
  error-output cases right, and M7's gate ("run-pass parity") will be measured against this suite. Suggest either ≥ 95%, or 90%
  with a named list of the out-of-scope reasons for the rest (x86 intrinsics before the late wave, isolation-off, FFI).

**G2 (non-blocking, gates).** `miri-pass` ≥ 80% is not well-founded until harness-m6c defines the case set (D13 amendment). The
D9 tree-borrows choice also changes it. Fix the number after that batch has measured the oracle's outcomes on the proper case set.

**N1 (non-blocking, what M6 does not cover; put it in the plan for M7).** Rejecting native execution is right for M6. But Miri
ignores `-O` (it prints a warning and runs at mir-opt-level 0) and cannot run:
- FFI to `rust_test_helpers` (8/300 sampled);
- inline asm;
- process spawning;
- isolation-off fs/env/time;
- real addresses and ABI;
- panic=abort and the real unwinder;
- linking and the mono collector / codegen_ssa path.

M7's "run-pass parity" therefore needs a native execution comparison (x86_64-linux, WSL2) on a deterministic subset. The plan
should say this, rather than "not even kept as a report" reading as final.

**N2 (non-blocking, risk missed).** Oracle output is machine-specific. Miri's diagnostics and backtraces print absolute
paths into the isolated toolchain's rust-src (`/Users/…/.data/rustup-miri/toolchains/…/library/std/src/sys/fs/unix.rs:1967:26`),
and compiletest's argv carries `-Z ignore-directory-in-diagnostics-source-blocks=/Users/<user>/.cargo`. A cache made on one
host or `RUST_TS_DATA` path is invalid on another, and the Windows host in AGENTS.md §5 would need its own measurements. The
cache key must include the sysroot/rust-src path (the planned sysroot-rmeta hash covers it only indirectly).

**N3 (non-blocking, measurement).** The §4 suite-cost row ("max 0.26 s user; ≈ 2 min CPU for all") and the claim that only Miri's
own tests are heavy were extrapolated from a 300-case sample. The full run (above) has 2 oracle timeouts and a 5–19 s tail.
Correct the plan's table.

**N4 (non-blocking, D7 runtime).** A proc macro's own `println!`/`eprintln!` (many tests/ui/proc-macro cases print token
streams) writes through the dylib's std directly to fd 1/2, while the port writes through Bun. stdout is dylib-only in
`--emit=metadata` runs, so that is safe. But any stderr interleaving with port diagnostics depends on Bun flushing
synchronously before each FFI call. Add a pm-ui test with a proc macro that `eprintln!`s between diagnostics.

**N5 (non-blocking, gate cost).** Once protected, run-pass-miri (3.3k cases at an estimated 1–10 s each in the port), miri-pass and
pm-ui are re-run on every gate. Estimate the added gate wall-clock and decide early whether the Miri suites get a heavy or
split-by-sample class.

**N6 (non-blocking, ordering).** `miri-contract` (MiriMachine implementing `Machine` with Miri's associated types) depends on
`interp-generic`'s type parameters. Both are ✱ in the same wave, so say explicitly that interp-generic merges first or that
miri-contract builds on its branch.

**N7 (non-blocking, D10 lane).** See D10: a separate lane after interp-generic, info-level events only, normalised comparison.

**N8 (non-blocking, scope).** The mono-collector/partition lanes (~5k lines) and `miri-sysroot` serve only report suites in M6.
Keep them out of the M6 critical path. If the wave is crowded, move them to M7's plan.

**N9 (non-blocking, hidden dependency).** `miri-driver` relies on:
- `MiriCodegenBackend` over the existing target_config stand-in;
- `exported_non_generic_symbols` for `miri_start` and `iter_exported_symbols` (ported via codegen_ssa symbol_export);
- `rustc_driver_impl::run_compiler` with `after_analysis` (present).

None is missing, but the lane brief should list them.

**N10 (non-blocking, wording).** "292 files, 54 skipped" for run-fail: there are 244 run-fail/run-crash files at the pin. "44 files
name these types" (D3): I count 38 under rustc_const_eval + rustc_middle/mir/interpret. Neither changes a decision.

## Summary for root
Accept D1, D4, D5, D6, D8 (with the pm-bridge ordering), D12 and D14 as written. Accept D2, D7, D9, D10, D11 and D13 with the
amendments above. Accept D3 only with B1's amendment, and split the mixed lanes per B2, before briefing wave 35/36.

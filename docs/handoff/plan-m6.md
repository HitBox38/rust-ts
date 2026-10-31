# Handoff: plan-m6 (design lane, wave 35)

Branch `t3/9421fe0a` from main `db733043`. No code changed.

## Files touched
- `docs/plan-m6.md` (new): the M6 plan (what "runs" means, port status, proc macros, suites/gates, D1–D14, waves 35–38,
  risks).
- `docs/handoff/plan-m6.md` (this file).

## Coverage / samples
No ported code, so coverage is unchanged (22,590 / 25,518 fns) and no sample difftests were run. The measurements are in
the plan's §1b, §1c, §2, §3 and §4. Scripts and results are under `$RUST_TS_DATA/tmp/plan-m6/` (50 MB).

## Oracle-toolchain incident (root correction, 2026-11-01)
This lane ran `rustup component add miri rust-src --toolchain nightly-2026-10-11`, which **modified the oracle toolchain**.
With `rust-src` installed, rustc's diagnostics into std/core print local paths and snippets, so fresh oracle output stopped
matching the oracle cache and the baselines (another lane saw 7/300 `mir` DIFFs). Root removed both components. I checked
afterwards, read-only: the oracle lists cargo, llvm-tools, rust-std (aarch64-apple-darwin, x86_64-unknown-linux-gnu), rustc
and rustc-dev, and has no `lib/rustlib/src`.
- From then on Miri ran only from an isolated rustup home: `RUSTUP_HOME=$RUST_TS_DATA/rustup-miri`,
  `CARGO_HOME=$RUST_TS_DATA/cargo-miri` (`rustup toolchain install nightly-2026-10-11 --profile minimal --component
  miri,rust-src`, 544 MB + 15 MB). The sysroot is `$RUST_TS_DATA/miri-sysroot` (112 MB). The env is in
  `$RUST_TS_DATA/tmp/plan-m6/mirienv.sh`.
- I deleted the two Miri sysroots built earlier from the oracle's rust-src (`~/Library/Caches/org.rust-lang.miri`, 111 MB,
  and a temporary one in tmp/plan-m6).
- **Re-taken after the removal:** every Miri run (hello world, block count, MIRI_LOG trace, loop timings, the 300-case
  run-pass sample, Miri's tests/pass + panic, the sysroot argv capture), and every oracle-rustc comparison (hello MIR with
  Miri flags, the CTFE loops, the proc-macro dylib build and `-Zunpretty=expanded`, the native builds of the sample). Results
  are identical to the first runs: 300/300 samples have the same exit code and stdout hash; tests/pass is 362/14/13 both
  times; MIR and rmeta comparisons match the same way. The plan reports only the re-taken numbers.
- D1 makes the isolated toolchain part of the Miri oracle decision, and §4 adds a guard test on the oracle's component list.

## Headline measurements
- Miri (isolated, x86_64-unknown-linux-gnu): std hello world takes 0.02 s user, 107 MB, **2,620 basic blocks**; the sysroot
  builds in 11.6 s user. The release Miri's `MIRI_LOG=info` trace works (22,954 lines for hello world).
- run-pass: 3,770 files → 3,256 no-aux cases via harness/compiletest.ts (+ 238 run-fail/run-crash). Sample of 300 under
  Miri: 281 exit 0, 14 exit 1 (FFI, isolation, inline asm), 5 exit 101; p99 0.25 s user. Natively, 4 exit-0 cases differ
  from Miri on stdout (addresses, timings): native output is nondeterministic and host-only.
- Miri's own tests/pass + tests/panic: 389 tests, 362 exit 0 / 14 exit 101 / 13 exit 1; 65 s in all; the slowest is 7 s.
- Port: hello.rs MIR with Miri's flags against the Miri sysroot is **byte-identical** (the port decodes Miri-built rmetas).
  CTFE costs 28.7 µs per loop iteration against the oracle's 2.7 µs (10.8× user, 11.8× instructions); the rmetas match.
- Proc macros: 272 tests use a proc-macro aux crate (180 aux sources); `quote!` blocks 30 cases in each of 11 suites. The
  port reads an oracle-built dylib's metadata and stops at `host_dylib::dlsym_proc_macros`. `bun:ffi` dlopens the dylib and
  finds `__rustc_proc_macro_decls_*__`; `bun:ffi` `cc` (TinyCC) handles the struct-by-value calls. At the pin the decls
  are `&[Client]` and the bridge structs are `#[repr(C)]`, so no Rust helper is needed.
- Coverage: rustc_const_eval 764/764, mir_transform 1,101/1,101, proc_macro_server 50/50; rustc_monomorphize 0/153,
  host_dylib 1/6; Miri (56,307 lines, ~1,833 fns) is not counted by coverage.ts and is 0% ported. On x86_64-linux about
  33k lines are needed, plus ~4k x86 intrinsics and 5.5k for tree borrows.

## Decisions for root to record (plan §5)
- D1 The M6 oracle is the pinned nightly's Miri **in an isolated rustup home** (`$RUST_TS_DATA/rustup-miri`, sysroot
  `$RUST_TS_DATA/miri-sysroot`), target x86_64-unknown-linux-gnu. The oracle toolchain is never modified. Native execution
  is rejected.
- D2 Port Miri to `src/miri/` (`// rustc: src/tools/miri/src/...` markers, coverage crate `miri`). Out of scope: genmc,
  native-lib, windows / other-OS unix shims, sockets, tracing_chrome.
- D3 ✱interp-generic: un-erase the `Machine` associated types and let `provenance_of` recognise Miri's provenance. This
  changes typing only.
- D4 M6 interprets the oracle-built Miri sysroot. A port-built sysroot is a report suite (`miri-sysroot-*`). The mono
  collector still lands in M6 because M7 needs it.
- D5 Vendor rand 0.10.1, rand_core 0.10.1 and chacha20 0.10.0 (root Cargo.lock), the StdRng path only, with a probe.
- D6 Run-pass argv = compiletest's argv with the Miri sysroot (keep `-O`; `exec-env` → `-Zmiri-env-set`). Every oracle
  outcome is a case.
- D7 Proc macros load oracle-built host dylibs through bun:ffi plus a TinyCC trampoline. This amends PLAN.md §4
  ("interpreted, no dylib loading").
- D8 Port all of library/proc_macro (both bridge halves, the client API, quote.rs); `quote!` runs as a TS client.
- D9 Stacked Borrows, the data-race detector, weak memory and validation stay on (Miri's defaults). Tree Borrows comes after
  the gate.
- D10 Port the interpreter's `info!` / `trace!` events behind `MIRI_LOG` and add `scripts/miri-diff.ts`, a first-divergence
  tool that is never a gate.
- D11 Perf targets: hello world ≤ 3 s user; run-pass p99 ≤ 10 s; heavy class for Miri's slowest tests.
- D12 x86 intrinsics get a late wave. aarch64 / loongarch intrinsics are unported.
- D13 Miri's tests/pass and tests/panic are part of the gate; tests/fail is a report. pass-dep, genmc and native-lib are out
  of M6.
- D14 Host-dependent Miri paths go through `src/std` stand-ins with `// PORT:`. Isolation-on paths must be byte-exact.

Gates: M6a `miri-hello` MATCH. M6b `run-pass-miri` + `run-fail-miri` ≥ 90% and `miri-pass` ≥ 80%. M6 = M6a + M6b +
`pm-ui` ≥ 95% + the 30 `quote!` cases MATCH everywhere.

## Left for others
- Harness/scripts batches (plan §4): the isolated-toolchain setup and guard test, the Miri oracle cache key, the run mode,
  aux chains (Miri rlibs, proc-macro dylibs), coverage.ts for `miri`, and adding `src/tools/miri/tests` to the sparse
  checkout (`UPSTREAM.json`).
- `bun scripts/crate-src.ts chacha20 --version 0.10.0` failed (cargo fetch, offline/network) and needs one online run.
- The rustup `miri` component is assumed to use the root Cargo.lock versions (it is built from the root workspace). The
  D5 probe should confirm this against the oracle Miri's RNG draws.
- No `unported(...)` or `// PORT:` were added; this lane wrote no code.

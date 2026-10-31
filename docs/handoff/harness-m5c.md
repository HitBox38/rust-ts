# Handoff: harness-m5c (plan-m5 D1/D2/D12, wave 34: the alloc/std aux chain and suites; harness batch, needs an independent review)

Branch `lane/harness-m5c`, base main `e4ba72ab`. No ported upstream code, so there are no coverage changes, no
`// rustc:` markers, no `unported(...)` and no `// PORT:` decisions (`bun scripts/coverage.ts --check`: markers ok,
23168; vendor 4680). No baseline, oracle output or existing suite changed (proof in "Verification"). The 7 new suites
are unprotected.

The setup rules say "never edit harness/ or scripts/", but the lane section says this lane exists to change them (and
UPSTREAM.json's sparse list). I followed the lane section.

## Files touched

| file | what |
|---|---|
| `harness/library.ts` (new) | the library crates' D1 argv (`libArgs`, `libEnv`), the crate table `LIB_CRATES` (core + 19 aux crates + std), the oracle-built aux chain (`oracleLibRmeta`), `libLockedVersion` (library/Cargo.lock), `EMPTY_SYSROOT` |
| `harness/suites.ts` | imports from library.ts (`M5_TARGET` moved there; same value); `CORE_ARGS` exported (for the test); `rmetaSuite` takes optional per-case probe args and a subject command (defaults = the old commands); one appended M5 block: 7 suites |
| `scripts/chain-run.ts` (new) | check-chain's subject: the port's core, then the oracle's alloc against it |
| `UPSTREAM.json` | `"submodules": ["library/backtrace"]` (see below) |
| `scripts/lib/common.ts` | `UpstreamPin.submodules?` (doc'd) |
| `scripts/upstream.ts` | `fetch` initializes the submodules (shallow); `status` checks them |
| `scripts/gate-probes.test.ts` | the test pins the list of suites that run rmeta-run.ts: +5 (check-alloc, rmeta-alloc, check-std, rmeta-std, check-chain) |
| `harness/library.test.ts`, `scripts/chain-run.test.ts` (new) | tests (below) |

## 1. The D2 aux chain (`harness/library.ts`)

- **Argv per crate** (D1): `--crate-name <c> --edition=<e> <root> --crate-type lib --target x86_64-unknown-linux-gnu
  -Zforce-unstable-if-unmarked --emit=metadata`, then the crate's `--cfg`s, then (every crate but core) `--sysroot
  $RUST_TS_DATA/aux/m5-empty-sysroot`, `-Zunstable-options` if any `priv:` extern, its `--extern`s, one `-L
  dependency=<dir>` per transitive dep (how rustc finds deps of deps), and `--cap-lints allow` for crates.io crates
  only (cargo always passes it for registry crates; it only matters for the aux crates' own builds).
- **Source of features, cfgs and externs**: plan-m5's `cargo check -Zbuild-std=std -v` log
  (`$RUST_TS_DATA/tmp/plan-m5/bs-std2.log`), at the pin, for target x86_64-unknown-linux-gnu. Build-script cfgs taken
  from it: compiler_builtins `intrinsics_enabled f16_enabled f128_enabled mem_unaligned`, libc `freebsd12`, object
  `core_error`, std `backtrace_in_libstd` + env `STD_ENV_ARCH=x86_64`. std's features: `addr2line backtrace miniz_oxide
  object panic-unwind` (bootstrap's default `backtrace` + `panic-unwind`, plus the optional deps they enable).
- **core's argv equals `CORE_ARGS(["lib"])`** (a test checks it), so the aux core rmeta is check-core's oracle file:
  measured 54,314,115 B, sha256 `c65818a4…`, the same as check-core's cached oracle line. compiler_builtins
  (1,582,118 B) and alloc (4,648,828 B) have plan-m5 §1c's sizes.
- **Crates** (build order, deps first): core, compiler_builtins, alloc, rustc_std_workspace_core, libc 0.2.189,
  memchr 2.8.3, adler2 2.0.1, rustc_demangle 0.1.28, cfg_if 1.0.4, unwind, rustc_std_workspace_alloc, panic_abort,
  panic_unwind, gimli 0.34.0, object 0.39.1, hashbrown 0.17.1, miniz_oxide 0.9.1, std_detect, addr2line 0.27.1, then
  std. alloc needs 2 of them, std needs 19. Its 13 `--extern`s are the build-std ones, with cargo's `priv:` marks on
  9 of them.
- **Cache** (the `oracleAuxRmeta` pattern): `$RUST_TS_DATA/aux/m5-<crate>-<key16>/lib<crate>.rmeta`. The key covers:
  - `rustcDriverHash()`;
  - every file under the crate's `inputs`;
  - its argv, which holds its deps' rmeta paths and so their keys;
  - its env.

  Each crate is built into a `.tmp-<pid>` directory, which is then renamed into place, so a concurrent process never
  sees half a crate. A failed oracle build throws one `ERROR:` line. The first build of the whole chain takes 7.4 s
  user, then nothing. Disk: about 80 MB, 54 MB of it core.
- **Inputs** were checked with each crate's `--emit=dep-info` (same argv): every listed file of all 21 crates lies
  under the declared `inputs`. That is a one-off check by this lane, not run by the harness: dep-info is a tracked
  output type, so emitting it changes the SVH. Examples:
  - alloc reads only `library/alloc/src`.
  - std reads `library/std/src` and `library/backtrace/src`, plus `library/portable-simd/crates/std_float` and doc
    files under core's three input dirs.
- **crates.io sources**: the version is the single crates.io entry in `library/Cargo.lock`. The path comes from `bun
  scripts/crate-src.ts <pkg> --version <v>`, spawned synchronously because `cases()` is sync, and that script fetches
  the crate if needed. The absolute registry path is passed to rustc, as cargo does.

### UPSTREAM.json / upstream checkout change (exactly)

- `UPSTREAM.json` `rust` gains `"submodules": ["library/backtrace"]`. The `sparse` list is unchanged: `library` is
  already in it. `library/backtrace` is a gitlink (submodule, commit `d902726a1dcdc1e1c66f73d1162181b5423c645b`), so
  a sparse-checkout entry cannot populate it.
- `bun scripts/upstream.ts fetch` now runs, after the checkout: `git -c protocol.file.allow=never submodule update
  --init --depth 1 -- library/backtrace`. `status` prints `ok submodule d902726a… library/backtrace` or `ERROR:`.
- **Done on the shared checkout** (`$RUST_TS_DATA/rust`), with the same command plus `--single-branch`, which takes
  2 s. Afterwards:
  - `git submodule status` shows ` d902726a…` (at the recorded commit);
  - `git status --porcelain --ignored --untracked-files=all` outside `build/` is still empty, so the checkout stays
    clean for difftest's check.

  Other machines (the Windows host) need `bun scripts/upstream.ts fetch` once. `libArgs` throws an `ERROR:` naming
  that command when an in-tree input is missing.

## 2. Suites (all `milestone: "M5"`, heavy, unprotected)

| suite | mode | cases | what |
|---|---|---|---|
| `check-alloc`, `check-std` | single | 1 each | rmeta-run `--bytes`: stderr + exit + size/sha256 (D4's gate cases) |
| `rmeta-alloc`, `rmeta-std` | split (`rmetadump`) | 14,678 / 18,196 | the probe's sections, as rmeta-core |
| `mir-alloc`, `mir-std` | split (`mir-pretty`) | 3,734 / 5,204 | `-Zunpretty=mir` per body, as mir-core |
| `check-chain` | single | 1 (`alloc`) | D12 report: the oracle checks alloc against the **port's** core rmeta |

- Case = `{id: <crate>, file: library/<crate>/src/lib.rs, args: libArgs(crate), env: NOCORE_ENV + libEnv}`.
  `inputDirs` = the crate's inputs.
- The aux chain is built when a suite's cases are made. The case argv contains the aux paths, and through them their
  keys, so the oracle cache key follows any aux change.
- **rmetadump for alloc/std**: the probe gets `--sysroot <empty> -L dependency=<the case's dirs>` instead of the
  oracle sysroot (`libProbeArgs`). With the oracle sysroot, the decoder would resolve the crate's deps to the
  sysroot's core, which has another SVH.
- **check-chain**:
  - Oracle side: check-alloc's command.
  - Subject side: `rmeta-run --bytes -- bun scripts/chain-run.ts --fresh <F> --first <n> -- <port core
    argv (CORE_ARGS(["lib"])) -o F> <oracle alloc argv with core → F>`, where F = `$RUST_TS_DATA/rmeta/check-chain/<h>/port-core/libcore.rmeta`.
  - In the subject's argv, only `--extern core=` and core's `-L dependency=` point at F. compiler_builtins stays the
    oracle-built one (built against the oracle core), so a port core with any other SVH fails to load.
  - **Negative check**: I ran the same chain with an oracle core built with `-Cmetadata=rust_ts_negative` in place of
    the port's. The result was `error[E0460]: found possibly newer version of crate core which compiler_builtins
    depends on`, which would be a DIFF.
  - A side finding: a core built with an extra unknown `--cfg` gave a byte-identical rmeta.
- Existing suites:
  - Their commands, modes, keys, inputDirs and timeouts are unchanged. Checked by dumping `oracle(dummy)`,
    `subject(dummy)`, `oracleKey()` and the fields of all 40 existing suites, at base `e4ba72ab` and on this branch:
    0 differences.
  - `rmeta-run.ts` and `split.ts` are untouched, so no oracle cache is re-keyed.
  - The gate runs only protected suites by default, so the new suites run only when named.

## 3. Verification (`RUST_TS_AGENT=root-f5de`; no GATE_RUNNING during any run)

- `bunx tsc --noEmit -p .`: clean. `bun test scripts harness`: **86 pass, 0 fail** (was 76: +6 library.test.ts, +4
  chain-run.test.ts). `bun scripts/coverage.ts --check`: markers ok.
- Existing suite: `check-ui --sample 100` gave MATCH 100/100, and all 100 statuses are identical to
  gate-20261030-222147-root-bec4 (run `20261031-080836-root-f5de-r0xa`).
- The new suites ran one at a time, with no other heavy process running. Load average was about 5–25 (other lanes
  were active), so user CPU is the comparable number.

| suite | result | subject (port) | oracle | run |
|---|---|---|---|---|
| `check-alloc` | **MATCH 1/1** (4,648,828 B, sha256 `1a7d7d95…`, identical) | 19.5 s wall, 35.2 s user, **2,541 MB** | 1.0 s, 0.8 s user, 296 MB | `20261031-080903-root-f5de-hf1t` |
| `check-std` | **MATCH 1/1** (6,064,471 B, sha256 `62dbd391…`, identical; empty stderr) | 21.1 s wall, 38.9 s user, **3,326 MB** | 1.0 s, 0.9 s user, 344 MB | `20261031-080932-root-f5de-720u` |
| `rmeta-alloc` | **MATCH 14,678/14,678** | 19.8 s, 35.0 s user, 2,376 MB | 1.1 s, 295 MB | `20261031-081002-root-f5de-llau` |
| `rmeta-std` | **MATCH 18,196/18,196** | 20.8 s, 38.5 s user, 3,398 MB | 1.3 s, 344 MB | `20261031-081024-root-f5de-n0ez` |
| `mir-alloc` | **MATCH 3,734/3,734** | 20.5 s, 37.8 s user, 3,077 MB | 1.0 s, 301 MB | `20261031-081047-root-f5de-y1mz` |
| `mir-std` | UNPORTED 5,204/5,204 (run-level) | 20.9 s, 39.4 s user, 3,285 MB, exit 70 | 1.0 s, 347 MB | `20261031-081109-root-f5de-ajc3` |
| `check-chain` | **MATCH 1/1** | 108.9 s wall, 145.6 s user, **8,797 MB** (port core + oracle alloc) | 2.2 s, 295 MB | `20261031-081238-root-f5de-8b9y` |

### Where the port stops (seeds for wave-34 fixer lanes)
- **alloc**: nowhere. check, rmeta and mir all match.
- **std**: check-std and rmeta-std match. **mir-std** (`-Zunpretty=mir`, all optimized MIR) stops UNPORTED with
  `rustc_abi::Size beyond 2^53 (Size.raw is a JS number)` (`SIZE_BEYOND_2_53`, the root decision on `Size`). JS
  stack:
  - `Size.from_bytes` (src/rustc_abi/lib.ts:1124);
  - ← `Pointer::without_provenance` (src/rustc_middle/mir/interpret/pointer.ts:430);
  - ← `CompileTimeMachine::ptr_from_addr_cast` (src/rustc_const_eval/interpret/machine.ts:1012);
  - ← the int→ptr cast in interpret/cast.ts:443;
  - ← `eval_body_using_ecx`.

  So CTFE of a std const casts an address ≥ 2^53 (e.g. `usize::MAX`-like sentinels) to a pointer. The fix needs
  `Size` (or that path) to hold u64 values: a representation decision for root.
- Not run: nothing. All 7 new suites ran once.

## 4. For root to decide or record

1. **D1 argv details** taken from cargo/bootstrap:
   - `priv:` marks on `--extern`s, plus the `-Zunstable-options` they need. That flag is UNTRACKED; `is_private` is
     encoded in the rmeta's `CrateDep`.
   - std's 5 features, as listed in §1.
   - The build-script cfgs/env of §1.
   - `--cap-lints allow` on crates.io aux crates only.
   - `-o <file>` for the aux builds instead of `--out-dir`. The rmeta bytes are the same: probe-rmetadump checked this,
     and here core's aux file equals check-core's oracle file.
2. **Protection.** check-alloc, check-std, rmeta-alloc (14,678), rmeta-std (18,196) and mir-alloc (3,734) all MATCH. With
   check-core already protected, that meets plan-m5 §4's M5c gate criteria (check-core, check-alloc and check-std
   MATCH). Each costs about 20 s wall and 2.4–3.4 GB per gate. check-chain is report-only (D12) and costs a core run
   (about 110 s, 8.8 GB).
3. **Shared checkout change.** The `library/backtrace` submodule is now initialized in `$RUST_TS_DATA/rust` (§1).
   Other checkouts need `bun scripts/upstream.ts fetch`.
4. **Disk.** About 80 MB under `aux/m5-*`. `rmeta/check-chain/<h>/` keeps 2 × 4.6 MB plus the port's 54 MB core. The
   check-/rmeta-alloc/std dirs keep 2 × 4.6 or 6 MB each. The disk was at 97% (14 GiB free).
5. **mir-std's stop** (§3) is a `Size` representation question (u64 addresses in CTFE), not a missing port.
6. The gate's unit-test step runs `bun test src tools`, so `scripts/*.test.ts` and `harness/*.test.ts` (both new tests
   included) are outside the gate. probe-rmetadump-fix already noted this.

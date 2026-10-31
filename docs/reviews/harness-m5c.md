verdict: APPROVE

Review of harness batch **harness-m5c** (`git diff main...lane/harness-m5c`, head `e06ae189`, base `e4ba72ab`).
Independent reviewer; read-only. Spec: plan-m5 D1, D2, D12, §4.

## What I ran (scratch detached worktree at lane/harness-m5c, removed afterwards)

- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun test scripts harness`: **86 pass, 0 fail** (matches the handoff).
- `RUST_TS_AGENT=rev-m5c bun scripts/difftest.ts --suite check-ui --sample 100`: MATCH 100/100
  (run `20261031-082144-rev-m5c-7szx`). This is an existing suite that runs through the refactored `rmetaSuite`.
- `RUST_TS_AGENT=rev-m5c bun scripts/difftest.ts --suite check-alloc`: **MATCH 1/1**. The heavy line was reported:
  subject 18.5 s wall, 33.1 s user, 2,427 MB max RSS (budget 12,288 MB), oracle cached
  (run `20261031-082202-rev-m5c-09z0`).
- Not run, per the instructions: check-chain and mir-std.

## The judged points

1. **No ratchet weakening.** The `harness/suites.ts` changes are additive:
   - `M5_TARGET` was moved to library.ts with the same value, and `CORE_ARGS` is now exported.
   - The `rmetaSuite` refactor keeps the old behavior when no options are passed: `probeArgs` defaults to
     `RMETADUMP_ARGS(content)` and `subject` defaults to `main.ts + c.args`.
   - `cachePath` (difftest.ts:322) is unchanged, and the existing suites' fields are unchanged. check-ui sample 100
     MATCH confirms this.
   - `gate.ts`, `difftest.ts`, `split.ts`, `rmeta-run.ts` and the baselines are untouched. The 7 new suites are
     unprotected, so the gate does not run them by default.
   - The existing m5b logic still applies: `--skip-heavy` lists heavy suites as `notRun`, and accept refuses a run
     that skipped a protected suite. Nothing new can count as lost or be silently accepted.
2. **Split mode.**
   - No new splitter. rmeta-alloc/std reuse `rmetadump` and mir-alloc/std reuse `mir-pretty` (m5a, already reviewed).
   - Ids are `<crate>|<section>` / `<crate>|<header>` per suite, so suites cannot collide.
   - Outputs are kept off raw storage at core scale: the existing gzip path is used, and the rmeta files sit in
     `$RUST_TS_DATA/rmeta/<suite>/<h>/`.
   - The probe's `libProbeArgs` (empty sysroot plus the case's `-L dependency=` dirs) is derived only from `c.args`.
     It is therefore covered by the oracle cache key, and both sides' rmetas are decoded against the same aux rmetas.
3. **Heavy class.** All 7 suites use `M5_HEAVY`: serial, 12 GB RSS budget, 1,800 s subject and 300 s oracle timeouts.
   RSS and an over-budget `ERROR:` are reported by the existing m5b path, and my check-alloc run showed the heavy line.
   check-chain's measured 8.8 GB is under the budget.
4. **Tests.** The batch adds no split logic. The existing `rmeta-split.test.ts` / `split-run.test.ts` cover the split
   edge cases. The new tests cover:
   - the argv shape (core = `CORE_ARGS`; the priv/extern/-L sets of alloc and std);
   - the crate table's integrity (unique, deps first, roots, editions and inputs in the checkout, locked versions);
   - `libLockedVersion`'s error cases;
   - the suites' commands;
   - chain-run's parsing, stale-file removal and short-circuit.
5. **Auditor visibility.** Nothing is hidden:
   - Every new suite prints the standard summary and heavy lines.
   - check-chain's outputs pass through rmeta-run unchanged.
   - The handoff records every argv choice for root to decide (§4).

## Lane-specific checks

- **The D2 aux chain** (`harness/library.ts:281` `oracleLibRmeta`):
  - Every dependency is built by the oracle with its own `libArgs`, against the oracle-built rmetas of its own deps,
    core first. Registry crates use the single crates.io version in `library/Cargo.lock` (via `crate-src.ts`).
  - The cache key (`:287`) covers `rustcDriverHash`, the content of every file under the crate's inputs, its argv
    (which carries its deps' keyed paths, so a change cascades) and its env.
  - Writes are temp-then-rename and safe under concurrency. A failure throws one `ERROR:` line, and a non-empty
    "empty sysroot" is refused.
  - The case argv carries the aux paths, so `cachePath` follows any aux change.
- **D1 argv:**
  - `priv:` marks match the manifests: `cargo-features = ["public-dependency"]`, with only `public = true` deps left
    unmarked. alloc: core public, compiler_builtins private. std: alloc, core, std_detect and libc public, the other 9
    private.
  - std's 5 features match cargo's resolution of bootstrap's default `backtrace` + `panic-unwind`: `dep/feat` enables
    the implicit features `addr2line`, `object` and `miniz_oxide`; `dep:panic_unwind` adds none.
  - `backtrace_in_libstd` and `STD_ENV_ARCH=x86_64` match library/std/build.rs. `STD_ENV_ARCH` goes in the case env,
    which is part of the cache key.
  - `--cap-lints allow` is passed to registry aux crates only, never to the subject crates. `lint_cap` is
    `[TRACKED_NO_CRATE_HASH]` (options.rs:369).
  - I could not re-read the build-std log (`$RUST_TS_DATA/tmp/plan-m5/bs-std2.log` is not on this machine). The
    cfg lists (compiler_builtins, libc `freebsd12`, object `core_error`) rely on the lane's and plan-m5's reading of
    it, and the MATCH results corroborate them.
- **UPSTREAM.json / upstream.ts.** `submodules` is optional in `UpstreamPin`, and nothing hashes UPSTREAM.json as a
  whole. `status` flags `-`, `+` and `U`. The shared checkout shows ` d902726a… library/backtrace`, and the sparse
  checkout stays clean.
- **check-chain soundness.**
  - The subject replaces only `--extern core=` and core's `-L dependency=` with the port's file. compiler_builtins
    stays the oracle-built one, so a core with a different SVH must fail to load.
  - The lane's negative control (`.data/tmp/m5c/neg.json`) uses exactly this argv shape with an oracle core built with
    `-Cmetadata=rust_ts_negative`, and gave E0460. The suite therefore cannot pass vacuously.
  - The stale port core is removed before each run. If the port fails, the oracle does not run, and the port's exit
    code is the result.
- **gate-probes.test.ts.** The pin gains exactly the 5 new suites that use the rmeta-run wrapper. mir-* suites are
  correctly absent, since they don't use the wrapper. The probe appears only on rmeta-alloc/std. The test passes.

## Findings

1. `harness/library.ts:248`, **non-blocking**: std gets `--crate-type lib`, but library/std/Cargo.toml has
   `crate-type = ["dylib", "rlib"]`, which bootstrap's cargo passes (`--crate-type dylib --crate-type rlib`).
   - This follows plan-m5 §1a/§1b's table, so it is not a lane defect. The handoff's §4.1 list of D1 details for root
     to record does not mention it.
   - `CrateType::Dylib` reaches the encoder (`encode_dylib_dependency_formats`, rustc_metadata encoder.rs:2403).
   - Root should record that `lib` is the chosen D1 crate type for std, so that a future bootstrap-faithfulness
     question does not reopen it.
2. `harness/library.ts:93` / `:254`, **non-blocking**: alloc's argv adds `-Zunstable-options --extern
   priv:compiler_builtins=…`. This goes beyond plan-m5 §1b's literal alloc line (`--extern core=… --extern
   compiler_builtins=…`).
   - It is faithful to library/alloc/Cargo.toml (public-dependency feature, compiler_builtins not `public`) and to
     cargo.
   - It changes `CrateDep::is_private` in the rmeta.
   - The lane listed it (§4.1). Root must record it as a decision before protecting check-alloc / check-std.
3. `scripts/upstream.ts:25`, **non-blocking**: the scripted `submodule update --init --depth 1` was not the command
   run on the shared checkout. The lane added `--single-branch` by hand, so the scripted form is untested on a fresh
   or Windows checkout. Root should run `bun scripts/upstream.ts fetch` + `status` once on the Windows host before the
   alloc/std suites are protected there. `libArgs` throws an `ERROR:` naming the fix if `library/backtrace` is
   missing, so a failure would be loud.
4. `harness/suites.ts:1511–1514` / `scripts/chain-run.ts`, **non-blocking**: check-chain's subject output joins the
   port core's stdout/stderr and then the oracle alloc's. Its oracle output is alloc's alone.
   - Today core's stderr is empty (check-core MATCH), so this is harmless.
   - If core ever emitted a diagnostic on both sides, check-chain would DIFF with no port defect.
   - It is report-only (D12), so acceptable. A comment in the suite would help whoever reads such a DIFF.
5. `scripts/chain-run.test.ts:26`, **non-blocking**: the test drives its fake compilers with `/bin/sh -c`. The
   existing script tests (e.g. rmeta-run.test.ts:79) spawn `process.execPath` with a TS fake, so they are portable.
   On the Windows host named in AGENTS.md §5, this test fails. It is outside the gate's `bun test src tools` step, so
   the gate is not affected, but `bun test scripts` would go red there.
6. `harness/library.ts:281–305`, **non-blocking (disk)**: aux dirs `aux/m5-<crate>-<key>` are never collected. Each
   oracle, source or argv change adds about 80 MB, 54 MB of it core. check-chain also keeps a 54 MB port core under
   `rmeta/check-chain/<h>/port-core/`. The disk was at 97% (handoff §4.4). Root should add a cleanup note or a
   followup.
7. **Non-blocking, for the auditor**: the new tests (`harness/library.test.ts`, `scripts/chain-run.test.ts`) and the
   updated `scripts/gate-probes.test.ts` pin are not run by the gate's unit-test step, which runs `bun test src
   tools`. The handoff discloses this (§4.6). The auditor should not treat a green gate as covering them; root should
   run `bun test scripts harness` at integration.

ACCEPT-WITH-NOTES

# Review: harness-w20b (`lane/harness-w20b`, `ec00a1a2..2afbfd0d`)

Reviewer: review-harness-w20b (independent, read-only on `.data/lanes/harness-w20b`, HEAD `2afbfd0d`, clean tree).

All of my scratch work is under `.data/scratch/review-hw20b/`:
- `base/` and `head/` are `git archive` copies of the two trees;
- `data1/` and `data2/` are private data dirs, each with its own empty oracle cache. `rust` and `aux` are symlinked to the shared
  dirs; `probes` and `target` are symlinked to the lane's scratch probe build. The shared probes were never touched.

**Scope:** `harness/{compiletest,compiletest.test,suites}.ts`, `scripts/lib/oracle.ts`, `scripts/difftest.ts` (a re-export only),
`tools/probes/{tydump,thirdump,resdump}/main.rs`, the handoff, and 2 decisions. No baseline, oracle-output or `src/` changes.

**Merge:** `git merge-tree integ-w19 lane/harness-w20b` is clean.

## 1. Exactly the claimed case definitions changed: verified

- **Method:** `tools/hash.ts` imports `<tree>/harness/suites.ts` in its own bun process, once for base and once for head, with the
  shared `RUST_TS_DATA`.
  - For every suite it records:
    - `{id, file, args, env, oracle([c]), subject([c])}` for each case, with the tree root normalized;
    - the hash of `skipped()`;
    - the hashes of `oracle(cases)` and `subject(cases)` over all cases.
  - `tools/cmp.ts` diffs the two records per case.
- **Result:** 24 of the 26 suites have identical metadata. The only per-case differences are:
  - **The 50 env cases.** The 5 files changed in exactly 10 suites:
    - the suites: expanded-nocore, unpretty-expanded-nocore, resdump-nocore, expanded, unpretty-expanded, resdump, tydump-nocore,
      hir-tree-nocore, hir-tree, unpretty-hir;
    - the only change is the appended env key: `PATH: "/Users/tomernorman/.cargo/bin"` for 4 files, and `PWD: null` for
      `compiletest-self-test/rustc-env.rs`;
    - 45 of them are protected: 5 in each of the 9 suites. tydump-nocore has no baseline. I grepped this in `harness/baseline/*.txt`.
  - **The aux cases.** 57 in tydump-ui and 57 in thirdump-ui, all unprotected. With `aux/ui/<16 hex>` normalized, all 114 are
    byte-identical (`tools/aux.ts`: `bad: 0`).
- tydump-minicore, thirdump-minicore, the skip lists and every other case are unchanged. That matches the handoff exactly.

## 2. Env pin: sound on macOS/Linux, but not on a Windows host (H1)

- **Both sides get the same env.**
  - `run()` (`scripts/lib/common.ts`) overlays `Case.env` on `process.env`, and `null` deletes the variable.
  - The oracle gets `c.env`. The subject gets `{...c.env, RUST_TS_IMPL}`.
  - `cachePath` hashes `c.env` whenever it is defined, and the pinned cases always have it.
- **Both sides find their executables.**
  - The subject (`process.execPath`) and the probes are run by absolute path.
  - `rustc +nightly` is found in the pinned PATH, and `oraclePathEnv` dies if it is not there.
  - `rustc-env.rs` pins only `PWD`, so it still looks `rustc` up in the caller's PATH, as before.
- **The value on macOS is deterministic.** In my runs (§3), the oracle's `env!("PATH")` is exactly `/Users/tomernorman/.cargo/bin`. rustup's
  `insert_path` does not add a duplicate when that dir is already present.
  - The value depends on the machine (`$CARGO_HOME`/`~`), but it is part of the cache key, so each machine computes its own.
  - It does not depend on the session.
- **Completeness.**
  - **Corpus scan.** I scanned all 21,528 files of the macro-expanding suites (21,526 in `tests/ui` plus the 2 cg_clif files) for
    `*env*!(…)` and non-literal `include*!(…)`.
    - The only session variables named are `PATH` (macro-comma-support-rpass, glob-shadowing, prelude via `env_imported!`) and
      `PWD` (rustc-env.rs, in the main crate).
    - `expand-full-in-format-str.rs` uses `env!(env_name!())` with `"PATH"`.
    - Everything else is a variable no session sets: `CARGO_PKG_VERSIO` and the other `CARGO_*` typo tests, `FOO`, `MY_ENV`,
      `COMPILETEST_*`, `INVALID_UTF8_BIN`, `NON_EXISTENT`, escaped or empty names, and so on.
    - The other `include!(...)` calls use `concat!` of literals, `line!()`, or macros that do not resolve.
  - **Typo suggestions.** The `CARGO_*` suggestions in `rustc_builtin_macros/src/env.rs` use a fixed `KNOWN_CARGO_VARS` list, not
    the process environment.
  - **Proc macros.** None run in any protected suite: those suites build no aux crates.
  - **Variables rustup sets only on the oracle side.** These are `CARGO_HOME`, `RUSTUP_HOME`, `RUSTUP_TOOLCHAIN`,
    `RUST_RECURSION_COUNT` and `DYLD_FALLBACK_LIBRARY_PATH`/`LD_LIBRARY_PATH`. No test in the corpus reads any of them.
  - **Conclusion:** the static rule plus the lane's dep-info ground truth cover the current corpus. Residual gaps are listed under L1–L2.

## 3. The 45 protected cases (all 50 changed cases) still MATCH: verified

I ran `tools/run3.sh`: `difftest --suite <s> --filter <file>` from the head tree, for all 10 suites × 5 files. Each run used
`env -i` and a fresh private oracle cache. The two runs differ only in the caller's PATH:

| run | caller PATH | result |
|---|---|---|
| 1 | my full shell PATH (20 entries; cargo bin not first) | 50/50 MATCH |
| 2 | `/bin:/usr/bin:~/.cargo/bin:/opt/homebrew/bin:/usr/sbin` | 50/50 MATCH |

- Both runs produced the same 50 cache keys, with byte-identical contents (`cmp`).
- The probe suites ran with the lane's new probes, so the logger change is covered for resdump and resdump-nocore.

## 4. M1, L1–L6: verified in code and tests

- **M1, timeout and retry.** `buildAux` spawns with `timeout: timeoutMs`. If that times out, it retries once with
  `timeoutMs * ORACLE_RETRY_FACTOR`. The factor is now defined in `scripts/lib/oracle.ts`, and difftest re-exports the same constant.
  The M3 ui suites pass `M3_UI_ORACLE_TIMEOUT_MS`, which is also their `oracleTimeoutMs`. `aux` without `auxTimeoutMs` throws.
- **M1, ERROR on failure.** A second timeout, a signal or a non-zero exit all go through `auxBuildError`. It prints
  `ERROR: <id>: …` and throws a plain `Error`. The per-revision `catch` in `uiFileCases` rethrows anything that is not a
  `Reject`, so the case list fails and is never skipped. Static refusals (proc-macro, `-o`, missing file) stay `Reject` skips, as
  before. The `tmp` dir is removed in a `finally`.
- **M1, fixed env.** `auxEnv` builds the env from scratch:
  - `HOME`, `USERPROFILE`, `SYSTEMROOT`, `RUSTUP_HOME` and `CARGO_HOME` are inherited;
  - `PATH` is pinned;
  - `RUSTC_ICE=0` and `RUST_BACKTRACE=0` are set;
  - then the aux file's `rustc-env`/`unset-rustc-env` apply.
  - The full result is hashed into the aux key.
- **L1.** The key also hashes `caseDeps(UPSTREAM, s.file, s.env)` for each step.
- **L3.** The new tests cover aux-bin (no `-L`/`--extern`), no-prefer-dynamic (an existing rmeta in `--extern`), and a forced 1 ms
  failure: an `ERROR:` line, a throw, and no `.tmp-<pid>` left behind. The `CARGO_HOME=<home>/./` trick yields a fresh key while
  `oraclePathEnv` still resolves to the same dir, because `join` normalizes it.
- **L5.** `cleanStaleAuxTmps` runs on the first `buildAux` call of each process and treats EPERM as alive. After the test run,
  `aux/ui` has no `*.tmp-*` dirs.
- **L2, L4, L6.** Header text, count explanation, and merge notes. These are fine.
- **Tests in the head tree:**
  - `bun test scripts harness`: 19 pass, 0 fail. The test child needs the repo's `.env.local`, which I copied into my archive.
  - `bun test tools`: 50 pass, 0 fail.
  - `bunx tsc --noEmit -p .`: clean.

## 5. Probe logger: faithful, and no change to protected output

- **Upstream.** `rustc_driver_impl::main` (`compiler/rustc_driver_impl/src/lib.rs:1677`) calls `init_rustc_env_logger(&early_dcx)`
  first, then `signal_handler::install()`, then `install_ice_hook`.
  - The probes now call `init_rustc_env_logger` first and then `install_ice_hook`, in the same order. They omit the signal and
    ctrl-c handlers, as before.
  - `init_rustc_env_logger` reads `RUSTC_LOG`. When it is unset, `rustc_log` uses `EnvFilter::default()` plus WARN.
- **The scratch binaries really contain the change.** With `RUSTC_LOG=rustc_resolve=debug`, the old shared resdump printed 0
  DEBUG lines. The new resdump, tydump and thirdump printed 2 each.
- **Old vs new probe, same argv and env, comparing exit code, stdout and stderr exactly** (`tools/probecmp.ts`, fixed-seed sample):

  | suite | sample | identical |
  |---|---|---|
  | resdump (protected) | 120 | 120 |
  | resdump-nocore (protected) | 120 | 120 |
  | tydump-nocore | 120 | 120 |
  | tydump-minicore | all 46 | 46 |
  | thirdump-minicore | all 46 | 46 |

- **tydump-ui and thirdump-ui, all cases:**
  - 1840/1849 and 1851/1860 are identical, with 9 differences in each suite. This matches the handoff.
  - **`next-solver/issue-118950-root-region.rs`:** old and new are each stable across two runs. The new probe adds the
    ` WARN rustc_infer::infer::relate::generalize may incompletely handle alias type: …` line, and plain `rustc +nightly` prints
    the same line. This is a move toward parity.
  - **The other 8 per suite vary between two runs of the same binary,** old as well as new. They are:
    - `error-reporting/conditionally-implemented-trait-long-type.rs`
    - `on_unimplemented_long_types.rs`
    - `next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old`
    - `next-solver/normalize/old-solver-caching-bug-151069.rs#old`
    - `next-solver/normalize/success-results-in-unconstrained-infer.rs#old`
    - `next-solver/overflow/incorrect-old-solver-caching-ice-148095.rs#old`
    - `projection-cache-rematch-impl-122529.rs#old`
    - `projection-cache-rematch-impl-141124.rs#old`
  - **How to mark them (recommendation, its own harness batch):**
    - add a per-suite `unstable(): {id, reason}[]` list in `harness/suites.ts`, matched by exact id;
    - `difftest` reports those cases under their own status (e.g. `UNSTABLE`), never MATCH, and never caches their oracle output;
    - `gate accept` refuses to add them to a baseline, and `gate run` fails if a baseline contains one.
    - Normalizing the thread id or the long-type hash would change MATCH logic and needs a separate decision. Until then, root must
      not accept these ids. None of them can MATCH today, so the current risk is low.

## Findings

### BLOCKER
None.

### HIGH
- **H1: on a Windows host the PATH pin is not symmetric.** rustup's `set_ldpath`
  (rust-lang/rustup `src/toolchain.rs`) appends `<toolchain>\bin` to the proxied rustc's PATH on Windows by default, controlled by
  `RUSTUP_WINDOWS_PATH_ADD_BIN`.
  - So on Windows, the oracle's `env!("PATH")` would be `<cargo>\bin;<toolchain>\bin`, while the subject sees `<cargo>\bin`. The 36
    protected PATH cases would DIFF there.
  - Windows `process.env` also keeps the variable as `Path`. `run()` would then pass both `Path` and `PATH` in one env object.
  - AGENTS.md §5 still names Windows as the host. Before any gate runs on Windows, do one of:
    - pin `RUSTUP_WINDOWS_PATH_ADD_BIN=0` alongside `PATH` in the pinned cases' env (it is keyed);
    - include the toolchain `bin` in the pinned value;
    - and normalize the `Path`/`PATH` key case.
  - On macOS and Linux (§3) the pin is correct. This does not block acceptance on this host.

### MED
- **M1: `RUSTC_LOG` is not in the cache key, and the probes now honour it.** A difftest run with `RUSTC_LOG` set would cache
  log-polluted oracle outputs for resdump and resdump-nocore (protected) under the normal keys. Plain-rustc suites already had
  this exposure, and the handoff records it as a residual. Cheap fix in a follow-up harness batch: have difftest and the gate refuse
  to run, or strip `RUSTC_LOG*`, while the oracle cache is written.

### LOW
- **L1: only session variables are pinned.** Tests also read `FOO` (`env-macro/simple.rs`), `MY_ENV`, `CARGO_*` and
  `COMPILETEST_*`. A caller who happens to export one of them, for example a shell under `cargo`, which sets `CARGO_*`, changes
  both sides but also poisons the shared cache. Pinning every statically found literal name to unset (`null`), unless the case's
  own `rustc-env` sets it, would close this at no cost.
- **L2: the dynamic-name rule misses some forms.** It misses `env!(concat!("PA","TH"))` and names built by macro expansion. Proc-macro
  aux crates (M6) can read any variable through `std::env`. When M6 lands, switch to dep-info `# env-dep:` lines, or pin
  unconditionally for proc-macro cases.
- **L3: `pinSessionEnv` scans aux sources with the main case's env,** not each aux step's env (`caseDeps(.., c.env)`). The
  difference only matters for `#[path]`/`include!` paths that depend on env. None do at the pin.
- **L4 (observation, outside this batch):** the upstream checkout has an untracked
  `tests/ui/location-insensitive-scopes-issue-117146.long-type-7141148208715502321.txt`, dated 2026-10-21 11:18. Some suite's
  case writes into `tests/ui`. Root should find it and point its out-dir under `build/`.

## What I require
- Root, after merging:
  - rebuild the shared probes (`bun scripts/probes.ts build tydump thirdump resdump`) before the first gate run;
  - drop the `.data/tmp/oracle-PATH.txt` gate workaround.
- Before any Windows gate run: H1. As a follow-up harness batch: M1, the unstable-case list (§5) and L1.

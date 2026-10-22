# Handoff: harness-w20b (harness batch: review harness-w20 M1 + L1-L6, PATH pinning, probe logger; needs an independent review)

Branch `lane/harness-w20b`, base `ec00a1a2` (integ-w19 incl. harness-w20). There is no ported upstream code, so there
are no coverage numbers, no `// rustc:` markers, no `unported(...)` and no `// PORT:`. Baselines, oracle outputs and
MATCH logic are unchanged.

## Files touched
- `harness/compiletest.ts`: aux builds (M1, L1, L2, L5); `uiFileCases` takes `auxTimeoutMs` and returns `auxFiles`.
- `harness/compiletest.test.ts`: new aux-bin, no-prefer-dynamic and failed-build tests (L3).
- `harness/suites.ts`: session-variable pinning (`pinSessionEnv`); the M3 ui suites pass their oracle timeout to aux builds.
- `scripts/lib/oracle.ts`: `ORACLE_RETRY_FACTOR` moved here (difftest re-exports it); new `oraclePathEnv()`.
- `scripts/difftest.ts`: imports/re-exports `ORACLE_RETRY_FACTOR` only.
- `tools/probes/{tydump,thirdump,resdump}/main.rs`: `init_rustc_env_logger` (task 4).
- `docs/state/*`: two decisions recorded.

## 1. M1: aux builds (`harness/compiletest.ts` `buildAux`, `auxEnv`)
- **Timeout.** Each aux build gets the suite's oracle timeout (`M3_UI_ORACLE_TIMEOUT_MS` = 300 s). If it times out, it
  is retried once with `ORACLE_RETRY_FACTOR` (4) times that, the same policy as difftest's oracle processes.
  `uiFileCases(.., { aux: true })` without `auxTimeoutMs` throws.
- **Fixed environment.** Nothing from the caller's environment reaches an aux build except
  `HOME`/`USERPROFILE`/`SYSTEMROOT`/`RUSTUP_HOME`/`CARGO_HOME`, which rustup needs to find the toolchain. The build
  env is:
  - those inherited variables;
  - `PATH` = `oraclePathEnv()`;
  - `RUSTC_ICE=0` and `RUST_BACKTRACE=0`, as the cases get them;
  - then the aux file's `rustc-env` / `unset-rustc-env`.
  The whole env is part of the aux key.
- **Failure.** Any failure prints one `ERROR: <case id>: the oracle's build of an auxiliary crate failed: ...` line
  and throws a plain `Error`, never a `Reject`. That covers a second timeout, a signal and any non-zero exit. So the
  case list cannot be made and the run stops instead of skipping the case. The temp dir is removed in a `finally`.
  Static refusals (proc-macro aux, `-o`, missing aux file) stay skips, as before.

## 2. L1-L6
- **L1:** the aux key now also hashes `caseDeps(UPSTREAM, auxFile, auxEnv)` for every aux step. That covers
  `mod`/`#[path]`/`include!` files the aux crate pulls in.
- **L2:** the header comments are fixed:
  - target std: parse-ui needs none, while the M3 suites type-check against the installed x86_64-linux rust-std;
  - `build/` dir: written by thir-print's `-Zunpretty`, never read by collection or deps;
  - aux paragraph: env, timeout, ERROR, deps in the key.
- **L3:** new unit tests (`bun test harness/compiletest.test.ts`, 7 pass):
  - `compiletest-self-test/test-aux-bin.rs`: the aux bin is built, and the main compile gets no `-L` and no `--extern`;
  - `compiletest-self-test/no-prefer-dynamic-means-no-so.rs`: no `--crate-type` (the `noPreferDynamic` path), and the
    `--extern` rmeta exists;
  - a forced failed build (1 ms timeout): the `ERROR:` line is printed, the error is thrown rather than turned into a
    skip, and no `.tmp-<pid>` dir is left.
    - The test spells `CARGO_HOME` as `<cargo home>/./`. `CARGO_HOME` is part of the key, so this gives a key nobody
      has built yet, and the build really runs.
- **L4 (the rustc_dump count, 119 vs 127):** 127 is the number of revision-cases of the 111 files *before* skips:
  - `uiFileCases` over the 111 files gives 119 cases + 8 skipped = 127.
  - The 8 skipped cases:
    - `layout/thumb-enum.rs`, `layout/hexagon-enum.rs` and the 4 revisions of `repr/repr-c-dead-variants.rs`:
      `needs-llvm-components`;
    - `symbol-names/const-in-global-asm.rs`: `needs-asm-support`;
    - `scalable-vectors/layout.rs`: `only-aarch64`.
  - No file-level grep gives 127. I checked: 112 `.rs` files mention `rustc_dump` (one only in a comment), 110 have
    `#[rustc_dump`, 62 use the check_crate dumps, and 63 `.stderr` files mention `rustc_dump`.
  - So the plan's 127 counts all revisions; 119 of them are runnable under this harness.
  - Root: the M3 rustc_dump gate is measured on the 119 runnable cases. Amend the plan text if wanted.
- **L5:**
  - On its first aux build, each process removes `aux/ui/*.tmp-<pid>` dirs whose pid is not alive
    (`process.kill(pid, 0)`; EPERM counts as alive).
  - A failed build removes its own temp dir (`finally`).
- **L6:** a root merge matter. This lane appends 2 decisions to `docs/state/history.jsonl`/`current.json`, so expect
  the same kind of conflict.

## 3. PATH pinning (`harness/suites.ts` `pinSessionEnv`, `scripts/lib/oracle.ts` `oraclePathEnv`)
**Rule.**
- A case gets fixed values in `Case.env` for every variable of `SESSION_ENV_VARS` that its sources may read:
  - the variables: `PATH HOME USER LOGNAME PWD OLDPWD TMPDIR TMP TEMP SHELL TERM LANG LC_ALL USERPROFILE`;
  - the sources: the case file, every file `caseDeps` finds, and the aux sources with their deps.
- Values:
  - `PATH` = `$CARGO_HOME/bin`. That is where Bun looks up the oracle's `rustc +<toolchain>`. It is also exactly the
    dir rustup prepends to its rustc's PATH when it is missing, so with it rustup leaves PATH unchanged. I measured
    this: with `PATH=/usr/bin:/bin` the oracle's `env!("PATH")` was `~/.cargo/bin:/usr/bin:/bin`.
  - Every other variable is unset (`null`).
- The case's own `rustc-env` / `unset-rustc-env` wins.
- `oraclePathEnv()` dies if there is no `rustc` in that dir.
- The subject (`process.execPath`) and the probes are run by absolute path, and the subject spawns nothing, so both
  sides still find their executables.

**What "may read" means.**
- The variable's name is the string-literal first argument of any macro call. This catches aliases too
  (`use env as env_imported; env_imported!("PATH")`).
- Or: a macro whose name contains `env` is called with a non-literal argument (`env!(env_name!())`) and the name
  occurs as a string literal somewhere in the sources.

**Where it applies.** Every suite whose tools expand macros on tests/ui files:
- expanded-nocore, unpretty-expanded-nocore, resdump-nocore;
- expanded, unpretty-expanded, resdump;
- tydump-nocore;
- hir-tree-nocore, hir-tree, unpretty-hir;
- tydump-minicore, thirdump-minicore, tydump-ui, thirdump-ui.

It does not apply to lex, parse, tokens or parse-ui*, which never expand macros.

**Ground truth.**
- I ran the oracle rustc with `--emit=dep-info` on every `resdump` case (21,523, std argv) and collected the
  `# env-dep:` lines.
- Only `macros/expand-full-in-format-str.rs` and `rust-2018/uniform-paths/prelude.rs` read a session variable
  (`PATH`).
- All other env reads (28 lines in all) are of variables that no session sets: `FOO`, `MY_ENV`,
  `CARGO_PKG_VERSIO`, `COMPILETEST_*`, ....
- The static rule finds both, plus 3 over-approximations that are harmless:
  - `glob-shadowing.rs`: the `env` there resolves to a local decl macro;
  - `macro-comma-support-rpass.rs`: the reads are in `#[test]` fns, which are cfg'd out;
  - `compiletest-self-test/rustc-env.rs`: `PWD`; the main crate stops at `extern crate env`.

### Exact list of changed case definitions
Old and new definitions of every case of every suite (`[file, args, env]` + `skipped()`), loaded from the base tree
and from the lane: 24 of the 26 suites are identical except below.

**The env changes.** These 5 cases change in each of these 10 suites:
- the suites: expanded-nocore, unpretty-expanded-nocore, resdump-nocore, expanded, unpretty-expanded, resdump,
  tydump-nocore, hir-tree-nocore, hir-tree, unpretty-hir;
- 50 case definitions in all; 45 of them are protected (all but tydump-nocore, which is unprotected).
- Each case keeps `{RUSTC_ICE:"0",RUST_BACKTRACE:"0"}`, and the table shows the key that is appended:

| case | appended to env |
|---|---|
| `tests/ui/macros/expand-full-in-format-str.rs` | `PATH: <CARGO_HOME>/bin` |
| `tests/ui/rust-2018/uniform-paths/prelude.rs` | `PATH: <CARGO_HOME>/bin` |
| `tests/ui/imports/glob-shadowing.rs` | `PATH: <CARGO_HOME>/bin` |
| `tests/ui/macros/macro-comma-support-rpass.rs` | `PATH: <CARGO_HOME>/bin` |
| `tests/ui/compiletest-self-test/rustc-env.rs` | `PWD: null` |

**The aux changes.** tydump-ui and thirdump-ui (unprotected) each change in the 57 aux cases: only the
`aux/ui/<key>` path in argv differs, because the aux key now covers the env and deps.
- I checked this: the oracle probe run with the old and with the new aux dirs gives identical output for all 57 in
  both suites (aux key normalized).
- `difftest`: 33 MATCH and 24 UNPORTED in each suite. The 2 status changes against harness-w20's full run,
  `traits/bound/on-structs-and-enums-xc{,1}.rs` UNPORTED -> MATCH, come from ports since then.

Nothing else changes. That includes tydump-minicore/thirdump-minicore (none of their sources read session
variables), every skip list, and every other case.

### Verification (all 50 changed env cases, MATCH)
| run | caller PATH | oracle | result |
|---|---|---|---|
| A | my shell PATH | freshly computed | 50/50 MATCH |
| B | `.data/tmp/oracle-PATH.txt` (different order and entries) | freshly computed: I removed the 50 entries made by run A | 50/50 MATCH |
| A2 | my shell PATH | reused B's entries | 50/50 MATCH |

Root can drop the gate-PATH workaround (the decision of 2026-10-21 10:30) once this merges. The first gate run
recomputes these 50 oracle entries.

## 4. Probe logger (`tools/probes/{tydump,thirdump,resdump}`)
**Change.** `main` now calls `rustc_driver::init_rustc_env_logger(&early_dcx)` first, as `rustc_driver_impl::main`
does. With `RUSTC_LOG` unset, tracing's default filter prints WARN and ERROR events, as plain rustc prints them.
- I included `resdump`: it is the same driver setup with the same gap. The other rustc-driver probes (langitems,
  rmeta*) are not suite oracles and are untouched.

**Affected suites (new probe binaries, so new oracle keys):** resdump, resdump-nocore, tydump-nocore,
tydump-minicore, thirdump-minicore, tydump-ui, thirdump-ui.
- After merging, root must rebuild them: `bun scripts/probes.ts build tydump thirdump resdump`.
- I built them only in a scratch data dir (`.data/scratch/hw20b-data`), so the shared probes are untouched.

**Old (shared) vs new probe over every case of every affected suite** (oracle output text):

| suite | cases | identical | different |
|---|---|---|---|
| resdump (protected) | 21,523 | 21,523 | 0 |
| resdump-nocore (protected) | 21,523 | 21,523 | 0 |
| tydump-nocore | 21,523 | 21,523 | 0 |
| tydump-minicore | 46 | 46 | 0 |
| thirdump-minicore | 46 | 46 | 0 |
| tydump-ui | 1,849 | 1,840 | 9 |
| thirdump-ui | 1,860 | 1,851 | 9 |

- **Toward parity:** in both tydump-ui and thirdump-ui, 1 of the 9 differences is the expected one.
  `traits/next-solver/issue-118950-root-region.rs` now has rustc's
  ` WARN rustc_infer::infer::relate::generalize may incompletely handle alias type: ...` line. The subject does not
  print tracing events, so this case stays non-MATCH: it moves toward oracle parity, and the remaining gap is on the
  subject side.
- **Run-to-run noise, not caused by the logger:** the other 8 differences per suite are outputs that already differ
  between two runs of the same probe:
  - 6 ICE cases (`#old` revisions) print `thread 'rustc' (<tid>) panicked`;
  - 2 long-type cases print the `long-type-<hash>.txt` name;
  - harness-w20 listed these as nondeterministic or "can never MATCH".
- **No protected case changes.**
- `RUSTC_LOG` stays unkeyed: a caller's `RUSTC_LOG` now affects the probe suites exactly as it already affects the
  plain-rustc suites. That is a known residual. Pinning it would change every case's key.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test scripts harness`: 19 pass, 0 fail.
- `bun test tools`: 50 pass, 0 fail.
- Samples, `--sample 300`, seed harness-w20b:

| suite | probe | result |
|---|---|---|
| hir-tree | none (shared data) | 299 MATCH, 0 DIFF, 1 UNPORTED |
| expanded | none (shared data) | 296 MATCH, 0 DIFF, 4 UNPORTED |
| tydump-minicore | new | all 46 cases: 41 MATCH, 0 DIFF, 5 UNPORTED |
| tydump-ui | new | 152 MATCH, 3 DIFF, 145 UNPORTED (typeck+traits 143/285, rustc_dump 9/17) |
| resdump | new | 297 MATCH, 0 DIFF, 3 UNPORTED |

The 3 tydump-ui DIFFs are port bugs (subject side), not harness changes:
- `non_lifetime_binders/foreach-partial-eq-next-solver.rs` and `next-solver/fn-trait.rs` are harness-w20's DIFF #1 and #2.
- `next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#next` was UNPORTED in harness-w20's run. The subject
  now gets further, and the first difference is at line 72 (the `-->` span is `:15:16` in the oracle, `:20:1` in the
  subject). Its oracle output is the same with the old and the new probe.

The probe-suite samples ran with the new probes, from the scratch data dir, which has its own oracle cache.
hir-tree and expanded ran on the shared data.

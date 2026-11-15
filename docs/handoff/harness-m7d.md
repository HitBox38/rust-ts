# harness-m7d (wave 40t): the ripgrep and self-hosting suites

Harness batch (AGENTS.md §2): `harness/`, `scripts/` and `tools/` only. Nothing under `src/` changed. Base `6a74a1de`, branch
`t3/add-m7d-harness-suites`. AC power throughout, no `GATE_RUNNING` seen. The oracle toolchain was not touched.

## Files touched

- **New:**
  - `scripts/rg-build.ts`: both sides of `rg-build`, and `ensureRg`, which keeps each side's `rg` for rg-behaviour.
  - `scripts/rg-build-rustc.ts`: cargo's `RUSTC` for rg-build.
  - `scripts/rg-behaviour.ts`: both sides of `rg-behaviour` (`query`) and `rg-behaviour-rgtest` (`rgtest`).
  - `scripts/pm-self-run.ts`: both sides of `pm-self`.
  - `scripts/lib/rg-build.ts`: their pure parts. Tests in `scripts/lib/rg-build.test.ts`.
  - `harness/corpus/rg-behaviour/corpus.json` (21 files, 2.4 KB) and `queries.json` (63 queries).
  - `harness/m7d-suites.test.ts`.
- **Changed:**
  - `harness/suites.ts`: the five suites. `pmCorpus` also keeps each case's aux steps; pm-ui's cases are unchanged.
  - `harness/compiletest.ts`: `AUX_DIR` and `auxEnv` exported. Only `export` was added.
  - `scripts/gate.ts`: `oracleRuns` knows the three new wrappers.
  - `scripts/criteria.ts` and its test: the M7d groups, and `minMatch`.
  - `scripts/probes.ts`: N1, a comment only.
  - `harness/m7-suites.test.ts`: N2.
- **Not touched:** `scripts/rg-check.ts`, `scripts/rg-rustc.ts`, `scripts/lib/rg-check.ts` and `scripts/native-run.ts`. Their hashes key
  the protected `check-rg*` and native suites, so editing them would re-key those suites. rg-build has its own wrapper, `rustc-wrap-build.sh`.

## The suites

None has a baseline, so none is in the gate's defaults. A gate must name them with `--suites`.

| suite | mode | cases | what is compared |
|---|---|---|---|
| `rg-build` | single, heavy | 1 (`ripgrep-15.2.0`) | See below. |
| `rg-behaviour` | single, heavy | 63 | rg's stdout, stderr and exit, for each scripted query |
| `rg-behaviour-rgtest` | split (`rmetadump`), heavy | 1 run, 323 sections | `ok`/`FAILED`/`ignored` for each test, and the test binary's exit |
| `pm-self` | single | 282 | each aux build's exit and stderr, then the main compile's stdout, stderr and exit |
| `std-self` | single, heavy | 0 (1 skipped) | defined, with no case (see below) |

### `rg-build` (scripts/rg-build.ts)

- **The build:** the oracle's `cargo build --release --locked --offline -j1`, with `RUSTC` set to a wrapper.
  - The wrapper sends **every** call to the side's compiler: cargo's probes, a build script's `--version`, build scripts and their
    dependencies, every crate and the link. On the port's side, cargo runs build scripts that the port built.
  - The stock release profile (`debug = 1`), and `CARGO_INCREMENTAL=0`.
  - Every `CARGO_*`, `RUSTFLAGS`-like and `RUSTC*` variable of the caller is dropped.
  - The environment is `rgCargoEnv`'s, as check-rg's: `CARGO_HOME` is ripgrep's own, and `GIT_CEILING_DIRECTORIES` keeps build.rs out of
    this repo.
- **One target path for both sides** (`$RUST_TS_DATA/ripgrep/target/rg-build`), under the lock `rg-build.lock`.
  - It is emptied before each build.
  - Afterwards it is moved to `kept/rg-build/<side>`, with the logs in `kept/rg-build/<side>-logs`.
- **The report (stdout):**
  - cargo's exit, whether `rg` exists, and `rg --version` (exit, stdout and stderr).
  - Every compiler call: `probe|compile <crate> <-C metadata>: exit, stderr size+sha256`, sorted.
  - cargo's stderr: `$RG_ROOT` and the sysroot get names, the `Finished` time is masked, and the `Compiling` lines are listed first, sorted.
  - The names of the artifacts in `release/`, leaving out `.fingerprint` and `incremental`.
  - The bytes of every `*.d` and every build-script `run/{output,stderr,root-output}`.
- **Exit:** 70 with the port's first `rust-ts: unported:` line, which makes the case UNPORTED. 101 if a compiler panicked. Otherwise 0.
- **Why `-j1`:** with more jobs, the compilers' diagnostics arrive in the order jobs finish. `-j1` also keeps the port to one compile at a time.
  - Even at `-j1`, cargo's `Compiling` order varies: two oracle runs swapped `serde` and `termcolor`. Hence the sorting.
- **`CARGO_MAKEFLAGS` is dropped from the compiler's environment** (in rg-build-rustc.ts).
  - Bun does not pass cargo's jobserver fds through.
  - So every rustc warned "failed to connect to jobserver", in every crate's stderr, on the oracle too.
- **The binary for rg-behaviour:** `bin/<side>/<key>/rg` plus `stamp.json`.
  - `<key>` hashes rg-build's sources, the ripgrep lock, the host tools (`cc -v`, `ld -v`, SDK, `sw_vers`) and the compiler argv.
  - For the oracle it also hashes the rustc build; for the port, the state of `src/` (`HEAD:src` plus every changed or untracked file and
    its contents).
  - A build that makes no `rg` writes only the stamp, with the reason, so later cases do not rebuild for the same key.

### `rg-behaviour` (scripts/rg-behaviour.ts `query`)

- **Each query:**
  - The corpus is written afresh to `$RUST_TS_DATA/ripgrep/behaviour/<hash>/corpus`, with an empty `.git` so it is a repository root
    for ignore rules.
  - rg runs there with `PATH=/usr/bin:/bin`, `HOME=<case>/home` and nothing else: no `RIPGREP_CONFIG_PATH`, no global git excludes.
  - stdin is the query's text, if it has one; the limit is 30 s.
  - The times printed by `--json` (`elapsed`, `elapsed_total`, in both field orders) and `--stats` are masked.
- **It uses rg-build's binary for each side (`ensureRg`).**
  - If no build for the current key is kept, the first case builds it, under rg-build's lock. This happens on the oracle side when
    difftest has rg-build's oracle output cached.
  - On the port's side, a failed build's `unported` gives UNPORTED.
- **Coverage:** literal, no match, `-i`, `-S`, `-w`, `-F`, regex dot, anchors, alternation, repetition, `-c`, `--count-matches`, `-l`,
  `--files-without-match`, `-0`, `-n --column`, `-b`, `-o`, `-v`, `-C`, `-B/-A`, `-m`, `--no-heading -H`, `--vimgrep`, `--passthru`,
  `--color=always`, `--json` (twice), `--stats`, `-g`, `--iglob`, `-t`, `-T`, `--files`, `--sortr`, `--max-depth`, `--no-ignore`,
  `--no-ignore-vcs`, `--hidden`, `-uuu`, and binary detection (an explicit file, in a directory, `-a`, `--binary`).
  - Also: `-U`, `--multiline-dotall`, `-r` with groups and named groups, `\p{Greek}`, Unicode case folding, `(?-u)`, `--crlf`,
    `-E latin1`, `-f`, stdin, an invalid regex, `-P` (not built in), a missing file and `--version`.
- **The corpus** covers each of these: a `.gitignore` with a re-include, `.rgignore`, a hidden directory, an ignored `build/`, a binary
  file with NULs, a Latin-1 file, CRLF, Unicode and multiline text.
  - The queries that search a directory use `--sort=path`, which a test checks.
- **The sanity check passes:** `--files` lists exactly the files that are not ignored.
  - That holds although the corpus sits inside this repository's `.data`: rg stops at the corpus's `.git`.

### `rg-behaviour-rgtest`

- **Why a separate suite:** the M7d figure "rg-behaviour's scripted set MATCH" must be a whole suite's, because criteria.ts sums suites,
  not subsets.
- **The test binary:** ripgrep's `integration` test target, built once **by the oracle** with `cargo test --release --no-run`. It is
  the harness, not the code under test.
  - It is kept in `$RUST_TS_DATA/ripgrep/rgtest-bin/<key>/`, and its build tree is deleted.
- **Each side's run:**
  - The binary is copied to `rgtest-run/run/deps/integration`, with the side's `rg` at `rgtest-run/run/rg`. That is where the tests
    look for it (`../rg`).
  - It runs with 4 threads and a 10-minute limit, under `rgtest-run.case.lock`.
- **333 vs 323:** the source has 333 `rgtest!`. Of those, 9 are `cfg(not(target_os = "macos"))` and 1 is
  `cfg(target_pointer_width = "32")`, so **323 tests** run on this host.
- **`TMPDIR` must be outside any git repository.** With it under `$RUST_TS_DATA` (inside this repo), 2 tests failed on the oracle's own
  rg: `f1414_no_require_git` and `f45_precedence_internal`.
  - It is now `$TMPDIR/rust-ts-rgtest-<hash>`. `rgtestTmp` dies if a `.git` is in it or above it.
  - Since that fix, the oracle passes 323/323.

### `pm-self` (scripts/pm-self-run.ts)

- **The cases:** each of pm-ui's 282 cases, as `--aux-key <key> --step <JSON>... -- <pm-ui's main argv>`.
  - The steps are pm-ui's planned aux builds, in build order, each with the environment pm-ui's oracle build of it gets (`auxEnv`).
  - The oracle's aux directory is written back as the placeholder `@RUST_TS_AUX_DIR@`.
  - The key is that directory's `auxKey`, so any change to an aux source, command or environment re-keys the case.
- **Each side** builds **every** aux crate, proc macros included, in `$RUST_TS_DATA/pm-self/<hash>/aux`, with its own compiler. Then it
  runs the main compile with the same compiler.
  - The oracle's side builds everything with the oracle.
  - On the port's side, the port loads proc macros the port built: "self".
- **The output:** `pm-self: aux <file>: exit <n>` for each step, with its stderr passed on. A failed step ends the run with its exit code,
  so the port's 70 gives UNPORTED.
- **The lock:** one directory per case, used by both sides in turn under the case lock.

### `std-self`

- **Defined with no case.** `skipped` lists `hello` with the reason `STD_SELF_SKIP`.
- **Why:** a port-built sysroot is 20-odd codegen compiles. The front end alone takes about 12 GB on core, and this host has room for one
  such compile beside the running lanes, not a sysroot build in a wave.
- **The design, for when it is run:**
  1. Start from `harness/corpus/miri-sysroot/crates.json`, the argv of cargo-miri for all 27 sysroot crates. Drop `MIRI_BE_RUSTC`,
     `--cfg miri` and `-Zalways-encode-mir`, and emit `link`.
  2. Build those crates in dependency order with the port into `<case>/sysroot/lib/rustlib/<host>/lib`. Run their build scripts as the
     corpus records them.
  3. Build hello with `--sysroot <case>/sysroot`, link it with `cc`, and run it as scripts/native-run.ts does.
  4. The oracle's side does the same with the oracle. It is heavy, and its 12 GB budget is `M5_HEAVY`.
  5. The likely first stop is the `LLVMRustGetSymbols` that rg-build hits below.

### M7d in scripts/criteria.ts

| group | rule |
|---|---|
| `plan-m7 M7d rg-build` | 100%, every case counted (an oracle timeout or UNSTABLE is not met) |
| `plan-m7 M7d rg-behaviour` | 100%, every case counted |
| `plan-m7 M7d check-rg` | count group: 34 of the 34 crates (M7a's group stays at 33) |
| `plan-m7 M7d pm-self` | `minMatch: 1` (new field), UNSTABLE excluded like the other M7 percent groups |

`--milestone M7` now also needs M7d. The verdict lines name each sub-milestone (review harness-m7b-recheck note 1).

## Results

### Oracle against oracle (`bun scripts/oracle-self.ts`: the oracle's command, then the same with `--side subject`, still the oracle's compiler)

These are the runs on the final code:

| suite | result |
|---|---|
| `rg-build` | 1/1 equal (52 s). Before that, 3 consecutive `run --side oracle` reports were byte-identical (722 lines). |
| `rg-behaviour` | 63/63 equal |
| `rg-behaviour-rgtest` | 1/1 equal: 324 cases (the run and 323 tests), the oracle's rg passes 323/323 |
| `pm-self` | **282/282 equal** (345 s, `--jobs 6`) |

Two earlier oracle-self runs found bugs in the harness, both fixed:
- **`rg-behaviour`, 61/63:** `--json`'s `summary` prints `elapsed_total` with its fields in the other order, which the mask missed.
- **`rg-behaviour-rgtest`:** the oracle's rg failed 2 tests because of the `TMPDIR` problem described above.

### difftest with the port (`RUST_TS_AGENT=harness-m7d`)

| suite | result | run |
|---|---|---|
| `rg-build` | **UNPORTED 1/1**: `llir: LLVMRustGetSymbols`, at the first crate, `memchr` (cargo stops there: no `--keep-going`). Subject 7 s, 1.36 GB max RSS. | `20261115-094603-root-bb5t` |
| `rg-behaviour` | UNPORTED 63/63, same reason (the port's build of rg makes no binary) | `20261115-094636-root-2avr` |
| `rg-behaviour-rgtest` | UNPORTED 324/324, same reason | `20261115-094651-root-zjt0` |
| `pm-self` | **MATCH 282/282** (2 skipped, as pm-ui) | `20261115-094909-harness-m7d-nl38` |

- **pm-self passes today:** the port builds every aux crate, including the proc-macro dylibs, and loads its own dylibs.
  - I checked one case by hand (`tests/ui/fmt/indoc-issue-106408.rs`). The port's `libformat_string_proc_macro.dylib` is
    byte-identical to the oracle's in pm-ui's aux directory.
  - That fits plan-m7 D1: the same pinned `opt`/`llc` and the same `cc` and link line. It also explains why proc-macro dylibs build
    while rlibs stop: a dylib needs no archive symbol table.
  - The port's runtime has no oracle fallback: the only `rustc +<pin>` spawns in codegen are offline fixture-regeneration scripts.
- So **M7d's pm-self group is met** on these numbers, once a gate names the suite.
- rg-build, rg-behaviour and rgtest wait for `LLVMRustGetSymbols`, which is rg-fix-a's lane.

### The protected suites and the required samples

- **All 81 existing suites are unchanged.** The dump (scratch `dump.ts`, as harness-w40s's) was taken before any edit and again at
  the end.
  - Per suite it hashes: the metadata, the cases (id, file, args, env, mode), the skips, the unstable ids and reasons, every case's
    oracle and subject commands, `caseLock` and `irArgs`, `blessed`, the subsets, `oracleKey()`, and every 25th case's full oracle cache key.
  - Result: 891 lines, **identical**.
- `difftest --suite mono-ui --sample 200 --jobs 6`: **200/200 MATCH** (`20261115-095601-harness-m7d-qnfl`).
- `difftest --suite run-pass-native --sample 200 --jobs 6`: **200/200 MATCH** (`20261115-095735-harness-m7d-rzah`).

### Commands

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/` | 90 pass, 0 fail |
| `bun test ./scripts/` | 500 pass, 0 fail |
| `bun test ./tools/` | 84 pass, 0 fail |

- **Run the three roots one at a time, as the gate's unit steps do.** In one Bun process, `bun test ./harness/ ./scripts/ ./tools/`
  fails 18 probe and golden tests: a test repoints `RUST_TS_DATA` to a temp directory before `scripts/lib/common.ts` loads (see
  `scripts/lib/deps.test.ts`). That contamination already exists, and this lane did not cause it.
- **Unit-test wall time added by this lane:** `harness/m7d-suites.test.ts` about 0.3 s, `scripts/lib/rg-build.test.ts` about 0.03 s, and
  the criteria test is negligible. pm-self's 282 cases are not made in a unit test.
- **Coverage:** `coverage.ts --missing` does not apply. No upstream file was ported, and there are no `unported(...)` or `// PORT:`
  markers: this is harness code.

### Disk

All under `$RUST_TS_DATA`, except the tests' `TMPDIR`.

| path | size | note |
|---|---|---|
| `ripgrep/kept/rg-build/oracle` (+ logs) | 124 MB | each side's target tree, replaced per run |
| `ripgrep/kept/rg-build/subject` | 1.4 MB | the port stops at the first crate |
| `ripgrep/bin` | 6.3 MB | the oracle's `rg` and the port's stamp |
| `ripgrep/rgtest-bin` | 2 MB | the oracle-built test binary; its 1-minute build tree is deleted |
| `ripgrep/rgtest-run` | 14 MB | |
| `$TMPDIR/rust-ts-rgtest-<hash>` | 5 MB | |
| `ripgrep/behaviour` | 4.8 MB | 63 query directories |
| `pm-self` | 144 MB | 282 case directories, each keeping its last aux build |

- **Peak during a build:** about 250 MB (one tree building, one kept).
- **Free on the data volume at the end:** 7.0 GiB. Other lanes share the volume; it was 9.2 GiB at the start.

## Review nits from harness-w40s

- **N1:** `scripts/probes.ts`'s `sysroot_extern` comment now says only metadata-only crates can be pinned.
  - rustc-dev ships 3 `.rlib`s (`manifest-rustc-dev-aarch64-apple-darwin`): `rustc_public`, `rustc_public_bridge` and
    `tikv_jemalloc_sys`. Naming one stops with "no metadata-only", never with the wrong copy.
  - Comment only. Choosing from the manifest was left out: the rule is safe as it is, and a selection change would need probe rebuilds.
  - No suite key hashes `scripts/probes.ts`. Probe staleness hashes only `tools/probes/<name>`.
- **N2:** `harness/m7-suites.test.ts` now pins `native-hello.txt` to `["hello"]` and checks that the other five M7b baselines are not empty.

## N3: the cost of the default-sysroot spawn

**Not material: about 0.1% of a gate.** No harness design is needed now.

- **Which compiles pay it:**
  - Every protected suite's subject command was listed. The only subject processes that run the port's rustc driver without
    `--sysroot` are `parse`'s: **21,523**, one per case.
  - The other 14 suites without `--sysroot` are batch dump tools (`lexdump`, `tokdump`, ...) or one wrapper process (`check-core`,
    `mir-core`, `check-rg*`, which passes `--sysroot` to the port itself). `symbols` is 10 symdump processes.
- **It is real for `parse`.** A shim `rustc` first on `PATH` logged one `+nightly --print sysroot` call per `parse` compile: 200 of 200.
- **Cost per compile:**
  - Measured on a 200-case `parse` sample, run in alternating order, real proxy against the shim, which prints the same sysroot at once.
    The 1-minute load average was 7.6 at the start (other lanes running).
  - **930.4 ms against 916.2 ms of wall time per compile: 14 ms, or 1.5%.** The spawn alone takes 30 ms of wall (`rustc +nightly --print
    sysroot` × 20: 0.60 s).
- **Over a gate:** 21,523 × 14-30 ms is 5-11 minutes of process time, or 0.6-1.4 minutes of wall at 8 jobs, against a 10.66-hour gate.
- **If it is ever wanted, the design:**
  - The harness sets `RUST_TS_DEFAULT_SYSROOT=<oracleSysroot()>` in the subject's environment for every case (`scripts/lib/env.ts`), so no
    case key changes.
  - `rustc_session/filesearch.ts` `default_sysroot` reads it before spawning, under the existing PORT note. That needs a reviewed src change.
  - The value is the string the oracle prints, so `all_paths` and the linker's `PATH` are unchanged.

## Decisions (for root to record; this lane did not write `docs/state/history.jsonl`)

1. `rg-build` runs cargo at `-j1` and compares the `Compiling` lines sorted. Both were measured as needed (see above).
2. `rg-build`'s wrapper drops `CARGO_MAKEFLAGS` for the compiler. Otherwise every crate's stderr carries a jobserver warning caused by
   the harness.
3. `rg-behaviour` builds a side's `rg` on demand, keyed, when none is kept for the current key. The alternative, refusing, would break
   whenever difftest has rg-build's oracle output cached.
4. ripgrep's integration tests are a sibling suite, `rg-behaviour-rgtest`, run by an oracle-built test binary, with `TMPDIR` outside any
   git repository.
5. `pm-self`'s port side builds **every** aux crate, not only the proc-macro ones: "the oracle building everything" on the other side.
6. `std-self` is defined with no case, and skipped with a reason.

## Follow-ups

- Port side: `rust-ts: unported: llir: LLVMRustGetSymbols` (rlib symbol table, `back/archive.rs`) stops rg-build at its first crate, and
  so stops rg-behaviour and rgtest. This is for lane rg-fix-a.
- pm-self: 282/282 MATCH already. Lane pm-self may want to check that it agrees, and root can name `pm-self` in a gate to protect it.
- std-self: the design above.
- `.data` disk: 7.0 GiB free at the end. See "Disk".
- **For root, once these suites run in a gate:**
  - `rg-build`, `rg-behaviour`, `rg-behaviour-rgtest` and `pm-self` need `--suites`.
  - `scripts/criteria.ts --milestone M7d` reads them.
  - None needs a probe. `scripts/gate.ts` `oracleRuns` maps their wrappers to `rustc`, and `harness/m7d-suites.test.ts` checks that
    `undeclaredRuns` finds nothing.

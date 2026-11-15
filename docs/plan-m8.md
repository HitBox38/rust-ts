# M8 plan — cargo, rustfmt and clippy for rust-ts

**Status: proposed (planning lane plan-m8, 2026-11-15/16).** Not yet reviewed. Decisions D1–D18 are in §7. Decisions marked
**[owner]** are ones I think the owner would want to weigh; root takes the recommended option for the others.

Pin `6f5da406b56c` (1.101.0-nightly). Base: main `2f4cd61c` (M7 done, gate-20261115-141315-root-qswd; 26,263 / 27,873 fns).
Paths are relative to the upstream checkout (`src/tools/…`, `compiler/…`) or to the cargo source. Line counts are `wc -l` of `.rs`
files unless "code" is written, which is `cloc`'s code column (no blank or comment lines). Fn counts are a regex over `fn`
lines (as plan-m7 did for `rustc_codegen_llvm`): coverage.ts does not count these trees yet.

**How measurements were taken.** macOS arm64, 12 cores, 24 GB, 9.4–11 GiB free disk (98% used), swap 6.9–7.6 GB of 8–9 GB used
before anything started (it grew to 14 GB, and free disk fell to 4.5 GiB, during the port's compile of the `cargo` crate). AC power throughout. Oracle `rustc +nightly-2026-10-11`. Port = the gate's subject binary
`$RUST_TS_DATA/subject-bin/5fb6b937…/rts` (main.ts, built from main cc7f52fa; `src/` is unchanged since, `git diff cc7f52fa HEAD
-- src` empty) with `--sysroot <oracle sysroot>`, as `rgCompiler("subject")` runs it. "user" = user CPU, "rss" = max resident set,
both from `/usr/bin/time -l`. No oracle component was added or removed: clippy and rustfmt were run from their dist tarballs,
unpacked outside the toolchain (§1b). Scripts and outputs are in `$RUST_TS_DATA/tmp/plan-m8/` (§10 says what is kept):

| Path | What it is |
|---|---|
| `src/src/tools/{clippy,rustfmt}` | `git archive HEAD` of the two trees from `$RUST_TS_DATA/rust` (not in the sparse checkout) |
| `dl/` | cargo's source tarball, the 2026-10-11 nightly channel manifest, the clippy and rustfmt component tarballs |
| `cargo-src/cargo-29c5daa1…/` | cargo at the rust repo's `src/tools/cargo` gitlink |
| `cargo-home/` | isolated `CARGO_HOME` with cargo's `Cargo.lock` crates (`cargo fetch --locked`) |
| `oracle-clippy/`, `oracle-rustfmt/` | the pinned components, unpacked |
| `bin/rustc-port.sh`, `bin/port-build.sh` | `RUSTC` wrapper for cargo that runs the port and logs each call; the build script |
| `bin/rustc-mixed.sh`, `bin/port-build2.sh` | the same with `crc32fast`, `sha1`, `sha2` sent to the oracle (§4b) |
| `port-log/`, `port-build{,2}.{out,err}` | the port's builds of cargo: per call `.time`, `.exit`, `.stderr` |
| `scripts/smoke.sh`, `smoke-{port,oracle}.txt` | the 11-step smoke test of a cargo binary, and its two outputs |
| `scripts/tst-all.sh`, `tst-all.txt`, `tst-fail*.txt` | cargo's testsuite, oracle-built, module by module |
| `scripts/clippy-ui.ts`, `scripts/rustfmt-sys.ts`, `scripts/calls.ts` | the measurement scripts; `*.jsonl` their results |

## 0. Recommendation

M8 should mean **two ports and one build**, which is option (c):

- **clippy-ts and rustfmt-ts are line-by-line ports**, like rustc. Both are written against rustc's own crates. Every
  `rustc_*` crate they import is already ported: 31 crates, all at or above 88% except the parts of `rustc_data_structures`
  and `rustc_target` that are infrastructure. Their oracles are the pinned nightly's own `clippy-preview` and
  `rustfmt-preview` components, built from the pin's commit (`git_commit_hash = 6f5da406b…` in the channel manifest).
- **cargo is built by rust-ts from its pinned source and runs its own testsuite.** It is not ported. Its host build graph
  is 317 packages with 2.13M lines of Rust, 12 proc macros and 9 `-sys` crates around C libraries (curl, libgit2, SQLite,
  libssh2, nghttp2, zlib, and OpenSSL found on the host). A TypeScript cargo would have to replace those C libraries, which is a redesign the
  contract forbids. Building cargo is also the exact rehearsal M9 needs ("rust-ts compiles tsc-rs").

What the measurements settle:

| Question | Measured answer |
|---|---|
| Where are the sources? | clippy and rustfmt are in-tree subtrees at the pin (`src/tools/clippy` 27 MB, `src/tools/rustfmt` 10 MB), **not in the sparse checkout**. cargo is the submodule `src/tools/cargo` at `29c5daa1afc2`, fetched as a tarball (SHA-256 `a1aaf161…`) |
| How big? | clippy 157k lines (116k code, ~4.4k fns, 835 lints); rustfmt 38k (30k code, ~1.6k fns); cargo 108k (82k code) plus about 11k in the workspace crates it links |
| Are there oracles? | Yes: `clippy-preview` and `rustfmt-preview` for 2026-10-11, hashes checked against the manifest; both run against the oracle's `librustc_driver` (same hash, `3bee00c5d9e363a9`). cargo is the oracle toolchain's own component |
| Do the upstream tests run with them? | clippy `tests/ui`: 1,019 of 1,224 test files run with ui_test's argv and no aux in **27 s for all** (p50 25 ms). rustfmt `tests/source`: 802 files in **12 s**, and the CLI reproduces the committed `tests/target` for 717 (89%) |
| Can the port build cargo? | §4: **almost.** Every compile through the port: 389 of 392 calls exit 0, including the 108k-line `cargo` crate, all 12 proc macros (built and loaded by the port) and all 37 build scripts (C through `cc`); 3 small crates stop on missing aarch64 intrinsic signatures in the IR model. With those three sent to the oracle, the build links a `cargo` that behaves like the oracle's on an 11-step smoke test, including ripgrep's `cargo check` (§4b) |
| Does cargo's own testsuite run here? | With the oracle: 64 s to build, **4,425 tests in about 12 min**, 27 fail for host reasons (21 want an `x86_64-apple-darwin` std) and 33 are ignored; no network needed (§4c). The port's build of its 210k-line test crate is the open question (12.45 GB for the 108k-line `cargo` crate) |
| Can the port's front end run clippy's tests? | The port as plain rustc on 3 sampled clippy ui files: 0.2–0.4 s wall, 0.3–0.5 GB. A clippy suite costs minutes per gate, not hours |
| How big is the work? | About **220k upstream lines to port** (clippy 157k, rustfmt 38k, vendor about 25k), against M7's 52k + 9k vendor: about 80 porting lanes, plus fixers and about 8 harness and tools batches |

The order puts the cheap, measurable thing first: **cargo built by the port (M8a)** needs no porting at all beyond the stops
§4 found. rustfmt-ts (M8b) is next, about a fifth of the porting. clippy-ts (M8c) is most of the cost, and its ui suite moves
lane by lane, so it is measurable from its first lint lane on.

## 1. What "cargo-ts, rustfmt-ts, clippy-ts" can mean at the pin

### 1a. Sources

| Tool | At the pin | Sparse checkout | How M8 gets it |
|---|---|---|---|
| clippy | `src/tools/clippy`, a git subtree (tree `fb391aaf`), version `0.1.101` | no (`UPSTREAM.json` `sparse` lists `compiler`, `library`, `tests/*`, `src/tools/compiletest`, `src/tools/miri/{src,tests}`) | add `src/tools/clippy` to `sparse` (D3) |
| rustfmt | `src/tools/rustfmt`, a subtree (tree `e493659d`), `rustfmt-nightly 1.11.0` | no | add `src/tools/rustfmt` |
| cargo | submodule `src/tools/cargo` → `rust-lang/cargo` `29c5daa1afc262323364e039bb70c83372cc702c`; the nightly's `cargo` component reports `cargo 1.101.0-nightly (29c5daa1a 2026-10-07)`, the same commit | the gitlink only | pinned tarball (`codeload.github.com/rust-lang/cargo/tar.gz/<commit>`, SHA-256 `a1aaf1613ebbf43f5234626f589350d64ea3d4c1a889bce8f55562a86404ad16`) into `$RUST_TS_DATA`, with its `Cargo.lock`'s crates in an isolated `CARGO_HOME`, as ripgrep (plan-m7 D19) |

clippy and rustfmt in the rust repo are built from the **root workspace**, so their crates.io versions are the root
`Cargo.lock`'s (as plan-m6 found for Miri). rustfmt's own `Cargo.lock` is for standalone builds and is not the pin's.

### 1b. Oracles

The 2026-10-11 nightly channel manifest has `clippy-preview` and `rustfmt-preview` for `aarch64-apple-darwin`, both with
`git_commit_hash = 6f5da406b56c2db6607202b63daee73aa8c61297`. I downloaded the tarballs (SHA-256 equal to the manifest's
`xz_hash`: clippy `08d0af9f…`, rustfmt `3ed6326d…`) and unpacked them outside the toolchain. `clippy-driver` links
`@rpath/librustc_driver-3bee00c5d9e363a9.dylib`, the oracle's own, so with `DYLD_LIBRARY_PATH=<oracle>/lib` it prints `rustc
1.101.0-nightly (6f5da406b 2026-10-10)` and `clippy 0.1.101 (6f5da406b5 2026-10-10)`; `rustfmt --version` prints `rustfmt
1.11.0-nightly (6f5da406b5 2026-10-10)`. **Nothing was added to the oracle toolchain.** For the harness these become an
isolated rustup home like Miri's (D2): adding components to the oracle's toolchain is what broke the cache in M6.

cargo's oracle is the oracle toolchain's `cargo` component, already in `UPSTREAM.json` `components`, and already what
`rg-build` uses.

### 1c. Sizes and crate graphs

**clippy** (workspace members that ship in the component; `clippy_dev`, `lintcheck`, `clippy_dummy`, `book`, `util` are
developer tools and stay out):

| Crate | Files | Lines | Code | Fns | Role |
|---|---|---|---|---|---|
| `clippy_lints/src` | 745 | 133,587 | 96,307 | ~3,300 | 835 `declare_clippy_lint!` lints, 340 top-level files (72,926 lines) and lint groups in dirs: `methods` 22,138, `matches` 6,840, `loops` 5,701, `operators` 4,727, `casts` 4,104, `doc` 2,568, `functions` 1,940, `transmute` 1,853, `attrs` 1,410, `types` 1,361, … |
| `clippy_utils/src` | 30 + dirs | 19,786 | 15,807 | ~980 | the shared helpers: `lib.rs` 3,716, `hir_utils` 1,833, `consts` 1,200, `sugg` 1,157, `source`, `visitors`, `ty/`, `mir/`, `ast_utils/`, `sym.rs` (extra symbols), `msrvs.rs`, `paths.rs` |
| `clippy_config/src` | 5 | 2,579 | 2,044 | ~110 | `clippy.toml` (`define_Conf!`, toml `DeTable`) |
| `src/driver.rs`, `src/main.rs` | 2 | 554 | 415 | 24 | `clippy-driver` (a `rustc_driver::Callbacks` that sets `register_lints`), `cargo-clippy` |
| `declare_clippy_lint`, `rustc_tools_util` | 2 | 497 | 437 | 15 | the lint macro; version info |
| `clippy_lints_internal` | 12 | 1,870 | 1,404 | | only with feature `internal`, not in the component: out |
| **Total in scope** | | **157,003** | **115,010** | **~4,430** | |

Its rustc imports (`extern crate`): `rustc_{span, session, middle, lint, hir, errors, driver, data_structures, attr_ir,
trait_selection, lexer, infer, index, hir_typeck, hir_analysis, attr_parsing, ast, abi, target, structures, resolve,
parse_format, mir_dataflow, interface, hir_pretty, const_eval, ast_pretty, arena}`. Port coverage of those crates today:
`rustc_hir_typeck` 1,041/1,041, `rustc_hir_analysis` 799/799, `rustc_lint` 714/718, `rustc_middle` 3,113/3,369,
`rustc_trait_selection` 965/976, `rustc_mir_dataflow` 378/378, `rustc_const_eval` 764/764, `rustc_hir_pretty` 119/119,
`rustc_ast_pretty` 274/274, `rustc_interface` 59/90, `rustc_driver_impl` 68/77; the rest 100% except `rustc_data_structures`
(554/960) and `rustc_target` (293/930: other targets' specs). `rustc_arena` is erased in the port (plan-m2: no `src/rustc_arena`), so clippy's arena uses become plain allocation.
So **clippy reuses the ported compiler wholesale**: it is a lint plugin, and `rustc_lint`'s `LintStore`, `LateContext`,
`EarlyContext`, `register_lints` and the `Callbacks::config` hook are what it plugs into, all ported for rustc's own lints.

Its crates.io dependencies (root `Cargo.lock` versions): `arrayvec 0.7.6`, `itertools 0.15.0`, `memchr 2.8.0`,
`quine-mc_cluskey 0.2.4` (`nonminimal_bool`), `regex-syntax 0.8.8` (`invalid_regex`, `trivial_regex`), `serde 1.0.228`
(derive), `unicode-normalization 0.1.25` (**already vendored**), `unicode-script 0.5.7` (**vendored**), `semver 1.0.27`,
`url 2.5.7` (doc lints), `cargo_metadata 0.23.1` (the `cargo` lint group only), `rustc_apfloat 0.2.3` (**vendored**),
`toml 1.1.0` (`clippy_config`, `parse` + `preserve_order`).

**rustfmt** (`rustfmt-nightly`):

| Part | Lines | Code | Notes |
|---|---|---|---|
| `src/` library (without `test/` and the bins) | 33,279 | | `items.rs` 3,658, `expr.rs` 2,621, `comment.rs` 2,187, `config/*` 3,669, `macros.rs` 1,672, `imports.rs` 1,572, `types.rs` 1,359, `visitor.rs` 1,125, `chains.rs` 1,101, `lists.rs` 951, `overflow.rs` 826, … |
| `src/test/*` (the system-test harness: `mod.rs` 1,271, `configuration_snippet.rs` 319, `mod_resolver.rs`, `parser.rs`) | 1,762 | | `#[cfg(test)]`; 294 `#[test]` fns across `src/` |
| bins: `bin/main.rs` 1,013, `cargo-fmt/main.rs` 577 (+ its tests 414), `format-diff/main.rs` 282, `git-rustfmt/main.rs` 208 | 2,494 | | `rustfmt` is the one the tests drive; `cargo-fmt` is `cargo fmt` |
| `config_proc_macro` | 499 | 387 | `#[config_type]`, `#[nightly_only_test]`, … : a proc-macro crate |
| **Total** | **38,034** | **30,790** (`src` 30,403 + macro 387) | ~1,600 fns |

Its rustc imports: `rustc_{ast, ast_pretty, data_structures, driver, errors, expand, feature, parse, session, span}` and
`thin_vec`: the parser side only, all 98.5–100% ported (`parse` protected at 21,523 cases). Its crates.io dependencies and
where `src/` uses them (non-test):

| Crate (root lock) | Used in | Port today |
|---|---|---|
| `annotate-snippets 0.12.16` | `format_report_formatter.rs` | **vendored, same version** |
| `getopts 0.2.24` | `bin/main.rs`, `format-diff`, `git-rustfmt` | **vendored, same version** |
| `unicode-properties 0.1.4` | `string.rs` | **vendored, same version** |
| `unicode-width 0.1.14` | `utils.rs` | vendored at 0.2.2 (rustc's); 0.1.14 is a second version (D7) |
| `unicode-segmentation 1.12.0` | `string.rs` (graphemes) | no |
| `toml 1.1.0` (+ `toml_parser`, `toml_datetime`, `serde_spanned`, `toml_writer`; 19.6k lines at 1.1.x) | `config/mod.rs` | no; shared with clippy_config |
| `serde 1.0.228` + derive, `serde_json 1.0.145` | config types, `emitter/json.rs`, `config/file_lines.rs`, `config/macro_names.rs` | no |
| `regex 1.12.2` | `lib.rs`, `string.rs`, `items.rs` (fixed patterns) | `regex-automata 0.4.13` partly vendored |
| `ignore 0.4.25` (+ `globset`) | `ignore_path.rs` (the `ignore` option) | no |
| `itertools 0.15.0` | 10 files | no (adaptors, used inline) |
| `diff 0.1.13` | `rustfmt_diff.rs`, `emitter.rs` | no (small; not measured) |
| `term 1.2.1` | coloured diff output | no |
| `dirs 6.0.0` | config search in `$HOME` | no |
| `bytecount 0.6.9`, `semver 1.0.27`, `thiserror`, `anyhow`, `tracing` | small helpers; `required_version`; error types; logs | `tracing` as rustc's (`src/rust_ts/tracing.ts`) |
| `cargo_metadata`, `clap`, `clap-cargo` | `cargo-fmt`, `format-diff` only | no |

**cargo** (source at `29c5daa1`):

| Part | Lines | Code |
|---|---|---|
| `src/` (the `cargo` lib and bin) | 107,831 | 81,802 |
| `crates/` that cargo links: `cargo-util-schemas` 4,564, `cargo-util` 2,598, `cargo-util-terminal` 786, `cargo-platform` 735, `crates-io` 516, `rustfix` 859, `home` 235, `credential/*` | about 11k | |
| `crates/cargo-test-support` 5,717, `cargo-test-macro` 466 | test support | |
| `tests/testsuite` (994 files) | 209,863 | 4,454 `#[cargo_test]` |

Its host graph (`cargo tree -p cargo --target aarch64-apple-darwin -e normal,build`): **317 packages**; 2,134,831 lines of Rust
in the 309 registry packages (without their `tests/`, `benches/`, `examples/`); the largest are `encoding_rs` 138k, `libc`
128k, `jiff` 99k, `objc2-foundation` 76k, `rustix` 72k, `regex-automata` 65k, `regex-syntax` 58k, `syn` 50k, `nix` 49k; 51 `gix*`
crates hold 133k. **12 proc macros** (`async-trait`, `color-print-proc-macro`, `displaydoc`, `futures-macro`, `maybe-async`,
`rustversion`, `serde_derive`, `thiserror-impl`, `tracing-attributes`, `yoke-derive`, `zerofrom-derive`, `zerovec-derive`).
**9 `-sys` crates**: `core-foundation-sys`, `curl-sys` (curl 8.21.0), `libgit2-sys` (1.9.6), `libnghttp2-sys`,
`libsqlite3-sys`, `libssh2-sys`, `libz-sys`, `openssl-sys`, `security-framework-sys`; their build scripts compile C with `cc`.

### 1d. The three scopes, costed

| | (a) port to TypeScript, line by line | (b) build the upstream Rust with rust-ts | (c) mix: port clippy and rustfmt, build cargo |
|---|---|---|---|
| **clippy** | 157k lines (~57 lanes) + vendor ~10k (toml, regex-syntax's parser, url's parser, quine-mc_cluskey, semver). Runs in the port's process on the port's HIR and types: a TS clippy | links the **oracle's** `librustc_driver` from `rustc-dev` (`#![feature(rustc_private)]`): the lints would run inside the oracle's compiler. It tests rust-ts as a compiler of 157k lines of rustc-internal Rust, and gives no TS clippy. `clippy_lints` is one crate of 134k lines through the port's front end; §4b's 108k-line `cargo` crate took 12.45 GB, so it may not fit on this host | (a) |
| **rustfmt** | 38k (~16 lanes) + vendor ~15k (toml stack shared, `diff`, `unicode-segmentation`, `ignore`/`globset`, `semver`, a `regex` subset). A TS formatter over the port's parser | the same trade as clippy: a binary around the oracle's `rustc_parse` | (a) |
| **cargo** | 108k + 11k of its crates, and **2.13M lines of dependencies with 7 C libraries**. Out of the question under PORTING: a TS cargo would replace curl, libgit2 and SQLite, and gix's 133k lines, with something else | the oracle's `cargo` builds cargo's source with `RUSTC` = the port, as `rg-build` builds ripgrep. **Measured (§4): 389 of 392 compiler calls through the port succeed, 3 stop on missing intrinsic signatures; with those three sent to the oracle, the build links a `cargo` that behaves like the oracle's on an 11-step smoke test.** Its own testsuite (4,425 tests) is then built by the port and run | (b) |
| Upstream tests that can run | clippy `tests/ui` 1,224 + `ui-toml` 130 (+ `ui-cargo` 91 with cargo); rustfmt `tests/source` 802, `tests/target` 1,065 (idempotence), 294 unit tests | the same tests, but they test the oracle's compiler with a port-compiled plugin | all of the left column, plus cargo's testsuite |

So: (a) for cargo is infeasible; (b) for clippy and rustfmt is cheap but does not produce a TypeScript tool, and its signal is
"rust-ts compiles rustc-internal code", which M9 does not need. **(c)** is the recommendation (D1). (b) for rustfmt stays
possible as a one-off report experiment if a lane has spare capacity (§10: I did not run it, to keep to one build at a time).

## 2. clippy

### 2a. How clippy runs

`clippy-driver` (`src/driver.rs`) is `rustc_driver::compiler_entrypoint(&args, &mut ClippyCallbacks)` where
`ClippyCallbacks::config` (:140) wraps `config.register_lints` to call `clippy_lints::register_lint_passes` and
`register_lints` (and `clippy_config`'s `Conf::read` from `clippy.toml`, found through `CLIPPY_CONF_DIR` or the crate's
directory), and sets `config.psess_created` to track the conf file and `config.override_queries` for
`mir_borrowck`-style hooks. Every lint is an `EarlyLintPass` or `LateLintPass` over AST / HIR / `TyCtxt`, emitting through
`clippy_utils::diagnostics::span_lint_and_*`, which are thin wrappers over `rustc_lint`'s `LintContext::opt_span_lint`.

The port already has every piece of this path for rustc's own lints: `rustc_lint` 714/718, `rustc_driver_impl`'s
`Callbacks` (the Miri driver uses `after_analysis`, `override_queries` and `extra_symbols`). clippy's `sym.rs` extra
symbols go past `PREDEFINED_SYMBOLS_COUNT` the way Miri's do (plan-m6 §1a).

### 2b. Upstream tests

`tests/compile-test.rs` drives `ui_test 0.30.7`. For `tests/ui` it runs `clippy-driver <file> --edition=2024 --emit=metadata
-Aunused -Ainternal_features -Zui-testing -Zdeduplicate-diagnostics=no -Znext-solver=coherence -Dwarnings` plus the file's
`//@` directives, compares stderr with `<file>.stderr` and, with `rustfix` on, applies the machine-applicable suggestions and
compares with `<file>.fixed`. Dependencies for aux and `extern crate` come from `clippy_test_deps` (libc, regex, serde, quote,
syn, futures, parking_lot, tokio, itertools), built once by cargo. Also `tests/ui-toml` (per-directory `clippy.toml`),
`tests/ui-internal` (feature `internal`: out), `tests/ui-cargo` (`cargo clippy` on small projects: needs `cargo-clippy` and
`cargo metadata`), and `dogfood.rs` (clippy on its own source, `-D clippy::all -D clippy::pedantic`).

| Directory | `.rs` (non-aux) | `.stderr` | `.fixed` | Notes |
|---|---|---|---|---|
| `tests/ui` | 1,224 | 1,091 | 642 | 162 use `aux-build` (130 a proc-macro aux; `proc_macros.rs` itself uses `syn`/`quote`, 112 files), 21 use external deps, 19 `revisions`, 12 `only-`/`ignore-`, 21 `compile-flags`, 128 `no-rustfix`, 159 `check-pass` |
| `tests/ui-toml` | 130 | 136 | 42 | |
| `tests/ui-internal` | 15 | 15 | 6 | out |
| `tests/ui-cargo` | 91 | 29 | | report |

**Measured with the oracle** (`scripts/clippy-ui.ts`): the 1,019 `tests/ui` files that need no aux, no revisions, no target
filter and no external crate, with the argv above from the clippy root: **27 s in all, p50 25 ms, p99 45 ms, max 326 ms**;
exit 0 on 136, exit 1 (the `-Dwarnings` lint errors) on 882, exit 101 on 1 (`custom_ice_message.rs`, an intentional ICE). 391
of 1,019 reproduce the committed `.stderr` byte for byte after dropping clippy's `= help: for further information visit …`
line; the rest differ by `ui_test`'s other normalisations (it re-renders from JSON and drops some empty `|` lines). That is
irrelevant to M8, whose expectation is the oracle's own output (as plan-m6 D6, plan-m7 §1g), but it says the committed
baselines cannot be used as-is (D10).

**The port's front end on these files** (port as plain rustc, same argv, `approx_const.rs`, `methods.rs`,
`manual_let_else.rs`): exit 0, 0.21–0.41 s wall, 0.36–1.20 s user, 306–542 MB. So a clippy ui case through clippy-ts should
cost about as much as a `check-ui` case: the 1,224 cases are minutes of gate time.

### 2c. What has to be ported, by group

| Group | Lines | Lanes (≤ ~3k) |
|---|---|---|
| Contract: `src/driver.rs`, `declare_clippy_lint`, `clippy_lints/src/{lib.rs, declared_lints.rs, deprecated_lints.rs, utils/*}`, `clippy_config` | ~7.0k | 3 (✱) |
| `clippy_utils` | 19.8k | 7 |
| `methods/` | 22.1k | 8 |
| `matches/`, `loops/`, `operators/`, `casts/` | 21.4k | 8 |
| other dirs (`doc`, `functions`, `transmute`, `attrs`, `types`, `floating_point_arithmetic`, `ptr`, `ifs`, `write`, `unit_types`, `misc_early`, `cargo`, `derive`, `returns`, …) | ~16k | 6 |
| 340 top-level lint files | 72.9k | 25 |
| **Total** | **~157k** | **~57** |

About 28.6k of `clippy_lints`'s lines are comments, mostly the lint documentation inside `declare_clippy_lint!`, which
PORTING §2 keeps but which costs little to port. Macros (`declare_clippy_lint!`, `declare_lint_pass!`/`impl_lint_pass!`,
`define_Conf!`, `msrv_aliases!`, clippy's `sym` list) are generated by `tools/codegen` (D5).

## 3. rustfmt

### 3a. How rustfmt runs

`rustfmt` parses with `rustc_parse` into `rustc_ast` (`parse/parser.rs`, `parse/session.rs`: its own `ParseSess` with a
silent emitter), resolves out-of-line modules itself (`modules.rs`), then walks the AST with `FmtVisitor` (`visitor.rs`),
producing text through the `Rewrite` trait (`items.rs`, `expr.rs`, `types.rs`, `patterns.rs`, `chains.rs`, `macros.rs`,
`comment.rs`, `lists.rs`, `overflow.rs`, …) against `Config` (`config/*`, built by the `create_config!` macro and
`#[config_type]`, read from `rustfmt.toml` with `toml` + serde). No type checking, no HIR: it needs only the parser half of
the port, which is protected at 100% of `parse` (21,523 cases) and `parse-ui` (991).

### 3b. Upstream tests

`cargo test` of rustfmt runs `src/test/mod.rs`: **`system_tests`** formats every `tests/source/**/*.rs` with the configuration
from its "significant comments" (`// rustfmt-<option>: <value>`, `config` and `target` keys, `edition`, `style_edition`) and
compares with `tests/target/…`; **`idempotence_tests`** formats every `tests/target` file and expects no change;
`self_tests` formats rustfmt's own source; `warning_tests`, `coverage_tests`, `checkstyle_test`, `json_test`,
`modified_test` and the `stdin_*` tests cover the emit modes; plus `configuration_snippet.rs` (the examples in
`Configurations.md`), `tests/config`, `tests/mod-resolver`, `tests/parser`, `tests/cargo-fmt`, `tests/rustfmt` (the binary's
CLI, `tests/rustfmt/main.rs`). In all 294 `#[test]` fns in `src/` and the integration tests in `tests/`.

| Directory | `.rs` | Notes |
|---|---|---|
| `tests/source` | 804 (802 with a target) | `system_tests` |
| `tests/target` | 1,065 | `idempotence_tests` |
| all of `tests/` | 1,947 `.rs`, 37 `.toml` | |

**Measured with the oracle** (`scripts/rustfmt-sys.ts`): each `tests/source` file through the component's `rustfmt
--emit stdout --quiet`, with its significant comments as `--edition`, `--style-edition`, `--config k=v,…` and
`--config-path`: **12 s for all 804 files, p50 15 ms, max 56 ms**; exit 0 on 735, 1 on 68, 101 on 1. **717 of 802 equal their
committed target byte for byte.** The rest are the CLI emulation, not rustfmt: files formatted as part of a module tree
(`cfg_if/detect/**`, where `--emit stdout` prints every file of the tree) and `error[internal]: line formatted, but
exceeded maximum width` reports that the test harness counts but the CLI turns into exit 1. Again the expectation in the
suites is the oracle's output, so this only tells how faithful a CLI-driven harness is: good enough, and a port of
`src/test/mod.rs` itself (D11) covers the rest.

### 3c. Lanes

| Group | Lines | Lanes |
|---|---|---|
| ✱Contract: `lib.rs`, `config/*`, `rewrite.rs`, `shape.rs`, `utils.rs`, `spanned.rs`, `source_map.rs`, `formatting*`, `skip.rs`, `release_channel.rs` | 7,377 | 3 |
| `items.rs` | 3,658 | 2 |
| `expr.rs`, `closures.rs`, `matches.rs` | 3,768 | 2 |
| `comment.rs`, `string.rs`, `missed_spans.rs` | 3,308 | 1 |
| `macros.rs`, `parse/macros/*` | 2,207 | 1 |
| `imports.rs`, `reorder.rs`, `sort.rs`, `attr*` | 2,946 | 1 |
| `types.rs`, `patterns.rs`, `pairs.rs`, `vertical.rs`, `stmt.rs`, `range.rs`, `header.rs` | 2,999 | 1 |
| `visitor.rs`, `chains.rs`, `lists.rs`, `overflow.rs` | 4,003 | 2 |
| `modules*`, `parse/{mod,parser,session}.rs`, `emitter*`, `rustfmt_diff.rs`, `format_report_formatter.rs`, `ignore_path.rs`, `source_file.rs`, `coverage.rs` | 3,013 | 1 |
| `bin/main.rs`, `cargo-fmt` (+ tests), `format-diff`, `git-rustfmt` | 2,494 | 1 |
| `src/test/*` (as `*.test.ts`, the system test driver, D11) | 1,762 | 1 |
| **Total** | **37,535** (+ 499 `config_proc_macro`, generated: D5) | **16** |

## 4. cargo built by rust-ts

### 4a. The oracle's build

`cargo build --offline --locked -j4` of cargo at `29c5daa1` (dev profile, `CARGO_INCREMENTAL=0`, isolated `CARGO_HOME`):
**317 `Compiling` lines, 54 s wall, 116 s user, 18 s sys, 2.6 GB max rss, 2.1 GB of target directory.** cargo's
`Cargo.toml` sets no `[profile.*]`, so release is opt-level 3, 16 CGUs, no LTO (so no bitcode in rlibs: G2 and the ThinLTO
buffer are not on this path, §5). Default features: `http-transport-curl`; `vendored-openssl` and `vendored-libgit2` are off,
so `libgit2-sys` and `curl-sys` build their bundled C or find the system's, by their build scripts' own probes.

### 4b. The port's build

The same command with `RUSTC` = `bin/rustc-port.sh` (every call, probes and build scripts included, to the port; `-j2`
because of memory; `--keep-going` so that one stop does not hide the next):

| | Port (every call) | Oracle |
|---|---|---|
| Compiler calls | **392: 389 exit 0, 3 stop** (exit 70). That is all 317 units, the 37 build scripts, cargo's probes | 317 units |
| Proc macros | **all 12 built by the port and loaded by the port's own proc-macro host** while compiling their users (pm-self's path) | |
| Build scripts | all 37 compiled by the port and **run by cargo**: the 9 `-sys` crates' scripts ran their probes and drove `cc` over the bundled C (curl, libgit2, SQLite, libssh2, nghttp2) and succeeded. I did not compare their outputs with the oracle's (`rg-build` does that byte for byte; `cargo-build` will) | |
| The stops | `crc32fast` (`llvm.aarch64.crc32b`), `sha1` (`llvm.aarch64.crypto.sha1h`), `sha2` (`llvm.aarch64.crypto.sha256h`): `rust-ts: unported: llir: the signature of … (IntrinsicsAArch64.td) is not in the IR model`. The IR model's aarch64 name table is complete (580 names, generated); only these intrinsics' **signatures** are missing. One small fixer lane | |
| Blocked by them | only the link of the `cargo` binary (it needs those rlibs); with pipelining every other unit compiled from their `.rmeta`, **including the `cargo` lib crate itself** (108k lines): exit 0 | |
| Wall, `-j2` | 1,362 s (22.7 min) | 54 s at `-j4` |
| CPU | **4,088 s user** (35× the oracle's 116 s), 642 s sys | 116 s user |
| Largest compiles (user, rss) | **`cargo` 424 s, 12.45 GB** (533 s wall, 419 s sys: it swapped); `objc2-foundation` 172 s, 6.3 GB; `gix` 89 s, 6.0 GB; `jiff` 62 s, 4.1 GB; `regex-automata` 59 s, 3.7 GB; `syn` 59 s, 3.2 GB; `git2` 56 s, 2.8 GB | max 2.6 GB for the whole build |
| Host | swap 6.9 → 13 GB used during `cargo`'s compile; free disk 11 → 4.5 GiB (swap files) | |

**A port-built cargo, with three crates from the oracle.** To see past the stops, I re-ran the build with a wrapper that
sends only `crc32fast`, `sha1` and `sha2` to the oracle and everything else to the port (mixing is sound when symbols agree,
plan-m7 §3; this is a measurement, not a harness design: D15). cargo recompiled 39 units, `cargo` among them, in 751 s wall at
`-j1` (936 s user), and **linked `target/debug/cargo`** (134 MB, `cargo 1.101.0`).

**Smoke test** (`scripts/smoke.sh`): the same 11 steps with the port-built cargo and with the oracle's `cargo` component, the
oracle `rustc` as `RUSTC` in both: `--version`; `new`; `build`, `run`, `test` (one passing and one failing test),
`build --release`, `metadata`, `tree`, `clean` on that project; then ripgrep 15.2.0's `cargo check --locked -j4` (34 crates)
and `cargo tree`. **All 11 exit codes are the same** (`test` exits 101 on both, as it should), and every output is the same
except three things, none a port difference:
- `--version`: the port-built `cargo 1.101.0` against the component's `cargo 1.101.0-nightly (29c5daa1a 2026-10-07)`. The
  suffix comes from `build.rs`'s `git-commit-info` file and `CFG_*` variables that rust's bootstrap provides when it builds the
  component; the tarball has neither. So `cargo-smoke` compares the port-built cargo with an **oracle-built cargo from the same
  source and environment**, not with the component (D8).
- a thread id in the failing test's panic line (harness-m7b's mask covers it);
- the order of `Compiling`/`Checking` lines at `-j4` (rg-build sorts them).

### 4c. cargo's own tests

`tests/testsuite` is one integration-test binary (994 files, 209,863 lines, 4,454 `#[cargo_test]`), built with
`cargo-test-support` (5.7k), `snapbox`, `gix` and the `cargo` lib, and run against `CARGO_BIN_EXE_cargo`. The tests create
projects under a sandbox (`__CARGO_TEST_ROOT`), local registries (`file://` and an in-process HTTP server), local git
repositories (through `git2`), and run `cargo` on them; that `cargo` finds `rustc` **on `PATH`**
(`cargo-test-support/src/lib.rs:1280`, `:1303`, `paths.rs:461`), so the compiler under test is the harness's choice.

| `#[cargo_test(…)]` | Count | In M8 |
|---|---|---|
| plain | 4,058 | yes |
| `nightly` | 309 | yes: the oracle toolchain is a nightly |
| `build_std_mock` | 23 | yes (a mock std) |
| `requires = "git"` 8, `"nm"` 3, `"readelf"` 3, `"hg"` 2, `"lldb"` 2, `"gdb"` 2, `"ssh"` 1, `"objdump"` 1, `"strings"` 1, `"cdb"` 1, `requires_rustup_stable` 2, split-debuginfo 3 | 29 | as the host has them; the rest are skipped by cargo's own macro, on both sides |
| `container_test` 9, `public_network_test` 7 | 16 | out (skipped by cargo's macro unless enabled) |

So the testsuite needs **no network and no registry stub of ours**: its stubs are its own. It needs `git` on `PATH` for 8.

Two ways to run it, and M8 wants both:
- **`cargo-testsuite`**: testsuite and `cargo` built by the port; `rustc` on `PATH` = the **oracle**. It tests the port-built
  cargo. Cases = test names; a case MATCHes when its outcome (ok / FAILED / ignored) is the oracle-built testsuite's.
- **`cargo-testsuite-rustc`** (report, heavy): the oracle-built testsuite and cargo, with the **port** as `rustc` on `PATH`. It
  is about 4,000 cargo scenarios, each a few compiles, through the port: a large real-world front-end and diagnostics check,
  and a direct rehearsal of M9. It needs `-C incremental` (cargo's dev profile, which these tests use; §5).

**Measured with the oracle** (oracle cargo and rustc build the testsuite; `scripts/tst-all.sh` runs it module by module,
clearing the sandbox between modules because it grows about 0.3 GB per 200 tests):

| | Result |
|---|---|
| Build of `testsuite` (`cargo test --test testsuite --no-run`, `-j4`, dev) | 64 s wall, 138 s user, 2.6 GB max rss, 2.1 GB of target |
| Tests listed | **4,425** (`--list`; the `#[cargo_test]` count of 4,454 includes a few behind `cfg`) |
| Run, default test threads (12) | **about 12 min wall** (747 s including about 3 min of modules matched twice by the substring filter) |
| Outcome | **27 fail, 33 ignored, the rest (about 4,365) pass** |
| The 27 failures | 21 assert that a cross target is installed (`utils/cross_compile.rs:181`: on aarch64 macOS they cross-compile to `x86_64-apple-darwin`, whose std is not in the oracle toolchain and must not be added); 2 `cargo_alias_config` and 1 `script::cargo` tests about external subcommands on `PATH`; 2 `rustup`, 2 `install`, 1 `version::verbose`, 1 `jobserver`, 1 `standard_lib`: host and environment assumptions. **All are environment, none is cargo**: they fail the same way on both sides, and cargo's own `CFG_DISABLE_CROSS_TESTS=1` skips the 21 |

So the testsuite is a cheap suite to *run* (12 min, about a sixth of `run-pass-native`'s gate time) once its binary exists. The
expensive part is the port's build of it: `tests/testsuite` is **one crate of 210k lines**, twice the `cargo` crate, which took
the port 424 s and 12.45 GB (§4b). Whether the port can build it on this host is not known (§9, §10).

## 5. M7 follow-ups and M8

| Follow-up (docs/next.md "Queued") | Matters for M8? | Why |
|---|---|---|
| **G2: `LLVMRustGetSymbols` for bitcode members** | **No** for cargo (no LTO in its profiles, so no bitcode members); **watch** in `cargo-testsuite-rustc` (a few tests use `-C lto`/`linker-plugin-lto`) | |
| **ThinLTO embedded-bitcode buffer** | No for cargo's build; wait | rlibs carry bitcode only with LTO or `-C embed-bitcode=yes` |
| **`uselistorder`** | No | it changes `__text` bytes of 15 of 283 pm-self dylibs, not behaviour (pm-self F1); M8 compares behaviour and test outcomes |
| **`-C incremental`** | **Yes, for `cargo-testsuite-rustc` only** | cargo's dev profile turns it on; the testsuite's projects use it and some tests assert its files. `cargo-build` and `cargo-testsuite` set `CARGO_INCREMENTAL=0` as rg-build does. Port incremental's session directory handling (rustc_incremental's `prepare_session_directory`, `save_dep_graph`) only when that report is promoted; it is a `scope.json` change (D16) |
| **`std-self`** (port-built core/alloc/std) | No for M8; **yes for M9** | 12 GB on core; nothing in M8 needs a port-built sysroot. Keep it queued for M9's plan |
| **harness-m7d re-check notes 1–6** (sweep matches the tag anywhere, prune by build date, uncached-error race, signal exit, SIGHUP, rgtest spawns) | **Yes** | M8's `cargo-build` generalises `scripts/rg-build.ts`; fix them in that batch rather than copy them (D8) |

The other queued items (review nits, `llvm-link` hash pinning, `Triple::normalize` for MSVC, StableHash generator, …) are not
on M8's path; they keep their place in the queue.

## 6. Suites and gates

Each suite is a separately reviewed harness batch (plan-m6 A2). Report until accepted; whatever an accepted gate matches is
protected (plan-m6 A9). Denominators exclude ORACLE_TIMEOUT and UNSTABLE (plan-m7 harness-m7b decision).

| Suite | Mode | Cases | Oracle cost (measured) | Port estimate | Role |
|---|---|---|---|---|---|
| `cargo-build` | the oracle's `cargo build` of cargo `29c5daa1` with every compile on the side's compiler (rg-build's design, `-j1`) | 1 (dev) | 54 s wall at -j4 | about 25–35 min wall at `-j1` (measured 22.7 min at `-j2`, 4,088 s CPU), heavy | **M8a** |
| `cargo-build-release` | the same, `--release` | 1 | not measured | about 2× dev | report → M8a |
| `cargo-smoke` | the 11 steps of §4b's smoke test (and more as found), run by the port-built `cargo` and by an oracle-built `cargo` from the same source, oracle `rustc`; thread ids masked, `Compiling` lines sorted | ~11 | 3.6 s | 5.9 s (measured) | **M8a** |
| `cargo-testsuite` | §4c, outcome per test name, `CFG_DISABLE_CROSS_TESTS=1` | 4,425 | 64 s build + about 12 min run | the port's build of the 210k-line test crate is unmeasured (12.45 GB for the 108k-line `cargo` crate); the run is native, about 12 min | **M8a ≥ 95%**, then protected |
| `cargo-testsuite-rustc` | §4c, oracle-built testsuite and cargo, the port as `rustc` on `PATH` | 4,425 | (as above) | thousands of small compiles at 0.2–1 s each: hours; heavy | report |
| `rustfmt-system` | `tests/source/**` through `rustfmt` with significant comments as CLI flags; stdout, stderr, exit | 804 | 12 s | ~1–2 min | **M8b ≥ 99%** |
| `rustfmt-idem` | `tests/target/**` through `rustfmt --check`; stdout, stderr, exit | 1,065 | ~15 s (est.) | ~2 min | **M8b ≥ 99%** |
| `rustfmt-emit` | the emit modes the tests use (`--emit json`, `checkstyle`, `--check` diff, stdin, `--file-lines`) on a fixed set from `tests/writemode`, `tests/rustfmt`, `tests/config` | ~60 | seconds | | **M8b ≥ 95%** |
| rustfmt unit tests | `src/**` `#[test]` ported as `*.test.ts` (PORTING §2), including `src/test/mod.rs`'s `system_tests` and `idempotence_tests` against the **committed** targets | 294 fns | | in the unit step: must fit its budget (D13) | **M8b: all pass or `test.skip` with a recorded reason** |
| `clippy-ui` | `tests/ui`, ui_test's argv + directives (aux via the pm-ui path, `clippy_test_deps` built once by the oracle's cargo); stderr + exit | 1,224 files (+ revisions) | 27 s for 1,019 | ~4–8 min wall | **M8c ≥ 95%** |
| `clippy-ui-json` | the same with `--error-format=json`: the suggestions behind every `.fixed` | 1,224 | the same | the same | **M8c ≥ 90%**, report before |
| `clippy-ui-toml` | `tests/ui-toml`, `CLIPPY_CONF_DIR` per directory | 130 | seconds | | **M8c ≥ 95%** |
| `clippy-ui-cargo` | `tests/ui-cargo` with the port-built or oracle `cargo-clippy` | 91 | | | report |
| `clippy-dogfood` | clippy-ts on clippy's own crates (`rustc_private`) | 6 crates | | heavy | report |

**Gates** (`scripts/criteria.ts` groups, per plan-m6 A12):
- **M8a, cargo built by the port:** `cargo-build` MATCH; `cargo-smoke` all MATCH; `cargo-testsuite` ≥ 95%.
- **M8b, rustfmt-ts:** `rustfmt-system` ≥ 99%, `rustfmt-idem` ≥ 99%, `rustfmt-emit` ≥ 95%, unit tests clean.
- **M8c, clippy-ts:** `clippy-ui` ≥ 95%, `clippy-ui-toml` ≥ 95%, `clippy-ui-json` ≥ 90%.
- **M8 = M8a + M8b + M8c.**
- **Report only:** `cargo-build-release` before M8a, `cargo-testsuite-rustc`, `clippy-ui-cargo`, `clippy-dogfood`.

The thresholds sit where plan-m7 put its own (98% for run-pass against a 99.3% control); the cases below them are named in the
gate record. rustfmt's 99% is high because its oracle is deterministic and cheap, and a formatter difference is always a bug.

**Gate time.** The last gate took 7 h 15 min over 71 suites. The clippy and rustfmt suites add minutes (check-ui's 730 cases
took 28 s in the last gate). `cargo-build` is one heavy case of about 25–35 min wall at `-j1` (measured 22.7 min at `-j2`, 4,088 s CPU), five or more times
`rg-build`'s slot (285 s in the last gate), and it must run alone (12.45 GB on one compile). `cargo-testsuite` runs in about 12
min once its binary exists; building that binary through the port is the unknown (D9). Expect M8a to add about 1 h to a gate.

## 7. Decisions

**D1. [owner] M8 = clippy-ts and rustfmt-ts as line-by-line ports; cargo built by rust-ts, not ported. Amends PLAN.md's M8
row ("cargo-ts").** §1d: a TS cargo is not a port but a redesign around 7 C libraries and 2.1M lines of dependencies. The
owner may prefer to keep the name "cargo-ts" for "cargo as built by rust-ts" or to drop it; either way M8a is the build and
its testsuite. **Alternative the owner may want:** defer clippy-ts (about 80% of M8's porting) to after M9, making M8 =
M8a + M8b. I recommend keeping it: it is the tool that exercises the ported type checker most, and it is measurable lane by
lane.

**D2. Oracles: the pinned nightly's `clippy-preview` and `rustfmt-preview`, in an isolated rustup home**
(`$RUST_TS_DATA/rustup-tools`, `--profile minimal --component clippy,rustfmt`), with binaries called by absolute path, keyed by
hash, and a guard that the oracle toolchain still has exactly `UPSTREAM.json`'s components (plan-m6 D1's rule). Measured: the
components exist for the pin's date and are built from the pin's commit. cargo's oracle is the oracle toolchain's own `cargo`.
`UPSTREAM.json` gains a `tools` entry with both components (`toolsComponents`, as `miri.components`).

**D3. Sources.** `UPSTREAM.json` `sparse` gains `src/tools/clippy` and `src/tools/rustfmt` (37 MB); cargo is pinned as
`{ "repo": "https://github.com/rust-lang/cargo.git", "commit": "29c5daa1…", "sha256": "a1aaf161…" }`, fetched by a setup
script into `$RUST_TS_DATA/cargo-src` with its `Cargo.lock`'s crates in `$RUST_TS_DATA/cargo-src/cargo-home` (setup is the
only networked step, as `rg-check.ts setup`). A scripts batch (`harness-m8a`).

**D4. Paths and markers, following Miri (plan-m6 D2).** `src/tools/clippy/<crate>/src/<path>.rs` →
`src/<crate>/<path>.ts` for `clippy_lints`, `clippy_utils`, `clippy_config`; `src/tools/clippy/src/driver.rs` →
`src/clippy/driver.ts` (an entry like `src/miri/bin/miri.ts`); `src/tools/rustfmt/src/<path>.rs` → `src/rustfmt/<path>.ts`.
Markers `// rustc: src/tools/clippy/clippy_lints/src/<path>:<line> <name>` and `// rustc: src/tools/rustfmt/src/<path>:…`;
coverage.ts counts them as crates `clippy_lints`, `clippy_utils`, `clippy_config`, `clippy`, `rustfmt` (scripts batch).
`clippy_dev`, `lintcheck`, `clippy_lints_internal`, `clippy_dummy` and rustfmt's `check_diff` are out (`scope.json`).

**D5. Macros through `tools/codegen`, never by hand** (PORTING §5): `declare_clippy_lint!` (lint statics + `LintInfo`),
`declare_lint_pass!`/`impl_lint_pass!` (already generated for rustc's lints), clippy's `sym` list, `msrv_aliases!`,
`define_Conf!`; rustfmt's `create_config!`, `#[config_type]` (config_proc_macro) and the serde derives on config and JSON
types. One tools batch, `codegen-tools-m8`, contract-first.

**D6. serde is not ported as a framework.** Its derives are generated (D5) as the concrete TOML and JSON (de)serializers
the derive would produce for each type, with the error texts of `serde`'s and `toml`'s `Display` impls ported from
source, because rustfmt and clippy print them (`clippy.toml` errors are ui-toml expectations). `toml 1.1.x` with
`toml_parser`, `toml_datetime`, `serde_spanned`, `toml_writer` is ported as vendor (`vendor-toml`, about 11k of 19.6k lines,
only what parsing a document and its errors reach). `serde_json`: only what `--emit json` and `file_lines` reach.

**D7. Vendor at the root `Cargo.lock`'s versions, only what is reached** (PORTING §5b): `diff 0.1.13`,
`unicode-segmentation 1.12.0` (tables from the crate, generated like `tools/gen-unicode.ts`), `ignore 0.4.25` + `globset`
(the `ignore` option), `semver 1.0.27`, `bytecount`, `quine-mc_cluskey 0.2.4`, `regex-syntax 0.8.8`'s parser and error
`Display` (clippy's regex lints parse user regexes, so this cannot be a JS `RegExp`), `url 2.5.7`'s parser (doc lints),
`itertools` adaptors where used. **`unicode-width` 0.1.14 is a second version** beside the vendored 0.2.2: vendored as
`src/vendor/unicode_width_0_1/` (their width tables differ). `regex` in rustfmt (`lib.rs`, `string.rs`, `items.rs`, fixed
patterns) may be a `PORT:` `RegExp` per pattern where the semantics provably agree, as plan-m7 did for `back/link.rs:1295`;
otherwise it goes through the vendored `regex-automata`. `term` (colours) stops when stdout is a tty; the suites run without
one. `dirs` goes through `src/std`. `cargo_metadata` and `clap` (only `cargo-fmt`, `format-diff`, clippy's `cargo` lints)
wait for `clippy-ui-cargo`: `unported` until then.

**D8. `cargo-build` generalises `scripts/rg-build.ts`** into one project-build harness (`scripts/cargo-project-build.ts`):
ripgrep and cargo are two configured projects with the same report format, key, lock, sweep and kept-binary rules. The
harness-m7d re-check notes 1–6 are fixed in that batch. `cargo-smoke` runs the port-built cargo and an oracle-built cargo **from the same source and environment**: the
component's version line carries bootstrap's `git-commit-info` suffix, which a tarball build never has (§4b). `rg-build`'s protected case must stay byte-identical (the batch's
proof: re-run `rg-build` and `rg-behaviour` before and after).

**D9. cargo's testsuite: outcomes per test, both sides built by their own compiler, `CFG_DISABLE_CROSS_TESTS=1`.** The harness builds the `testsuite` binary
with each side's compiler (oracle cargo, `RUSTC` = side), lists its tests, runs each in its own sandbox with
`RUST_TEST_THREADS=1` and the oracle's `rustc` first on `PATH`, and records ok / FAILED / ignored. Case = test name. Flaky tests
(time, ports, filesystem races) are found by three oracle runs and listed as UNSTABLE with reasons, as harness-m7b did.
`container_test` and `public_network_test` stay off. Measured on the oracle side: 64 s build, about 12 min run at 12 threads, 27 environment failures (§4c); the run fits a gate's
heavy slot. The unknown is the port's build of the 210k-line test crate: `harness-m8c` measures it first, alone on the host.
If it does not fit in memory, a perf lane on the front end's memory goes first, and until then M8a is judged on `cargo-build` +
`cargo-smoke` with the testsuite as a report (a recorded decision).

**D10. clippy's suites compare against the oracle's `clippy-driver`, never the committed `.stderr`/`.fixed`.** Measured:
391 of 1,019 committed baselines equal the driver's raw stderr; the rest are `ui_test`'s normalisations. The harness reuses
`harness/compiletest.ts`'s directive parsing for `//@` lines, and pm-ui's path for proc-macro aux (oracle-built host dylibs,
plan-m6 D7). `clippy_test_deps` is built once by the oracle's cargo into `$RUST_TS_DATA/clippy-test-deps` and passed with
`--extern`/`-L dependency` as `compile-test.rs` does.

**D11. rustfmt's suites drive the `rustfmt` binary with significant comments as flags, and its own test driver is ported.**
The CLI suites compare port and oracle (stdout, stderr, exit); `src/test/mod.rs` is ported as a unit test (`system_tests`,
`idempotence_tests` against the committed targets), so the upstream test of record runs as upstream wrote it. Measured: the
CLI emulation reproduces 717 of 802 targets with the oracle; the rest are module-tree files and internal-error counts.

**D12. Startup: separate entries, lazy loading.** `src/clippy/driver.ts` and `src/rustfmt/bin/main.ts` are their own entry
points (subject binaries in `BINARY_ENTRIES`, harness batch), so no existing suite loads them; clippy's lint modules load
when `register_lints` runs. Today's startup is 0.2 s for a small check with the binary (§2b).

**D13. Unit-step budget.** Each lane adds ≤ 10 s of unit-test wall (plan-m7's rule was 15 s with 9 minutes left; the step has
grown). rustfmt's ported `system_tests` and `idempotence_tests` are about 1,870 formatting runs in one process: measure them
first, and if they exceed the budget, run them as a suite (`rustfmt-upstream-tests`) instead of in the unit step.

**D14. Contract-first, as M6 and M7.** ✱`clippy-contract` (driver, `declare_clippy_lint`, `clippy_lints/src/lib.rs` with
the 835 registrations, `declared_lints.rs`, `deprecated_lints.rs`, `clippy_config`, stubs per lint lane) and
✱`rustfmt-contract` (`lib.rs`, `config/*`, `rewrite.rs`, `shape.rs`, `utils.rs`, `spanned.rs`, `formatting.rs`, stubs) merge
before their fill lanes. A clippy lint lane that ports a lint's file flips that lint's ui tests from UNPORTED, so the
contract registers every lint with an `unported` pass body.

**D15. cargo's stops are fixed in the port, never worked around in the harness.** §4b's stops are port bugs (the IR model's
intrinsic table, …) and go to fixer lanes. The harness may set what rg-build sets (`CARGO_INCREMENTAL=0`, no `CARGO_*` from
the caller, `-j1`) and nothing else.

**D16. [owner] `-C incremental` stays out of M8's gates; `cargo-testsuite-rustc` is a report until it is decided.** Porting
`rustc_incremental` enough to run with a session directory is a `scope.json` change (plan-m7 D11 kept it out). The owner may
want it in M8 if the port is meant to be a drop-in `rustc` for cargo's default dev profile, which M9 will also hit.

**D17. Process and memory.** One heavy build at a time (`cargo-build`, `cargo-testsuite` builds, `rg-build`); the port's
largest compiles in cargo's graph are the `cargo` crate at 12.45 GB, `objc2-foundation` 6.3 GB and `gix` 6.0 GB (§4b), so
`-j1` in the suite and at most `-j2` by hand, with nothing else heavy running. Disk: `cargo-build`'s
target tree is about 2–3 GB per side and is deleted after its report, as rg-build's.

**D18. Harness and porting never mix (plan-m6 A2).** `harness-m8*` lanes own `harness/` and `scripts/`; porting lanes own
`src/clippy*`, `src/rustfmt`, `src/vendor/*`; codegen batches own `tools/`.

## 8. Waves and lanes

Lanes ≤ about 3k upstream lines; ✱ = contract-first, merges before its dependants. Start 5–6 heavy lanes at a time (memory:
wave 38's 11 lanes drove load to 100–300). Wave numbers continue from M7's 40t.

**Wave 41: cargo first light, setup, contracts (→ M8a measurable)**
- `cargo-fix-a`: the stops of §4b, in order of how many crates they block. Today: the three aarch64 intrinsic signatures (`crc32*`, `crypto.sha1*`, `crypto.sha256*`, and their AES/SHA3 siblings while there, from `IntrinsicsAArch64.td`, pinned in the LLVM manifest), then whatever `cargo-smoke` finds. About 1 day.
- `harness-m8a` (harness batch): D2 isolated tools toolchain + guard; D3 sources (sparse, cargo tarball, `CARGO_HOME`);
  D8 project-build harness with the m7d notes; `cargo-build` and `cargo-smoke` (report); coverage.ts learns the tool crates
  (D4).
- ✱`clippy-contract-a`: `src/driver.rs`, `declare_clippy_lint`, `clippy_lints/src/{lib.rs, declared_lints.rs,
  deprecated_lints.rs}` (~2.6k).
- ✱`clippy-contract-b`: `clippy_config` (2.6k) + `clippy_utils/src/{lib.rs (first half), sym.rs, msrvs.rs, diagnostics.rs}`.
- ✱`rustfmt-contract`: `lib.rs`, `config/*`, `rewrite.rs`, `shape.rs`, `utils.rs`, `spanned.rs`, `formatting.rs` (~7.4k, three
  chained lanes).
- `codegen-tools-m8` (tools batch, D5, D6).

**Wave 42: rustfmt fill, clippy_utils, vendors (→ M8b)**
- rustfmt: 13 fill lanes from §3c (with the bins and `src/test/*`).
- `clippy-utils-a` … `-f` (17k left of `clippy_utils`).
- `vendor-toml` (~11k reached, two lanes), `vendor-fmt-small` (`diff`, `unicode-segmentation`, `semver`, `bytecount`,
  `unicode-width 0.1`), `vendor-ignore` (`ignore` + `globset`, reached part).
- `harness-m8b`: `rustfmt-system`, `rustfmt-idem`, `rustfmt-emit` (report), the subject entry for rustfmt (D12).
- `harness-m8c`: `cargo-testsuite` (D9); its first step is the port's build of the 210k-line test crate, alone on the host.
- Fixers from `rustfmt-system` first differences and `cargo-build`.

**Waves 43–45: clippy lints (→ M8c)**
- `methods-a` … `-h` (22.1k), `matches-a`…`-c`, `loops-a`/`-b`, `operators-a`/`-b`, `casts-a`/`-b`, six lanes for the other
  directories, 25 lanes for the top-level files (alphabetical blocks of ~3k, so a lane's ui tests are easy to name).
- `vendor-regex-syntax` (the parser, errors), `vendor-url` (parser), `vendor-quine`.
- `harness-m8d`: `clippy-ui`, `clippy-ui-json`, `clippy-ui-toml` (report), `clippy_test_deps` setup, the clippy subject entry.
  It can land in wave 42, before the lints: the contract's unported passes give a 0% baseline that each lane moves.
- Fixers per suite.

**Wave 46: tail and reports**
- Fixers on the three gates' tails; `clippy-ui-cargo`, `clippy-dogfood`, `cargo-testsuite-rustc` and `cargo-build-release`
  as reports.

**What it adds up to.** clippy ~157k + rustfmt ~38k + vendor ~25k = **about 220k upstream lines**, against M7's 52k + 9k
vendor. About **73 porting lanes** (57 clippy, 16 rustfmt) + about 8 vendor lanes + 1–2 cargo fixer lanes, **plus perhaps 25
fixers and 8 harness and tools batches**, each with an independent review.

## 9. Risks, cost, and what would change the plan

**Cost, honestly.** M7 was planned at about 37 lanes and 7–12 days, and took 10 days (2026-11-05 to 2026-11-15) with about
11 gates. M8 is about **2.5–3× M7's porting** (220k against 61k lines, ~80 lanes against ~37), but most of it is clippy's
lints: many small, independent files that call a compiler which is already ported, rather than new infrastructure. I expect **3–5 weeks**, at 5–6 heavy lanes in flight and a gate every 1–2 days, so 15–25 gates of
7–8 h: the gate itself is the floor. In tokens, about 110 agents at ≤ 500k and about 90 reviews at about 300k: **order of
80–120 M tokens**. Extrapolated, with wide error; I measured no dollars. **M8a alone** (cargo built by the port) is a few
days: one fixer lane for the three intrinsic signatures, the `harness-m8a` batch, then `cargo-testsuite` (its oracle run is 12 min; the port's build of its 210k-line crate is the unknown). My estimate is
3–5 days and 2–3 gates, or longer if that build needs a memory lane first.

**Risks.**
- **clippy's reach into rustc's unported corners.** clippy calls internal APIs that rustc's own lints never needed
  (`rustc_middle` is 256 fns short, `rustc_interface` 31, `rustc_driver_impl` 9; clippy uses `rustc_hir_typeck`'s
  `expr_use_visitor`, `rustc_mir_dataflow` analyses and `rustc_const_eval`'s const evaluation from lints). Each becomes a
  stop that a clippy lane cannot fix (it owns only clippy files): fixers in `rustc_*` crates run beside the lint lanes.
- **The lint docs.** 28.6k comment lines in `declare_clippy_lint!` are lint documentation (`clippy --explain`, the lint
  list). Porting them as comments is cheap; generating `LintInfo`'s doc text (D5) must take them from the source, not a lane.
- **serde and toml exactness (D6).** `clippy.toml` and `rustfmt.toml` errors print serde/toml messages. Generated
  deserializers must produce the same error texts and spans; `clippy-ui-toml` checks clippy's, `tests/config` rustfmt's.
- **Unit-step budget (D13).** rustfmt's own test driver is about 1,870 format runs; it may have to be a suite.
- **Memory.** The port's front end took 3.7–6.3 GB on `regex_automata`, `jiff`, `gix` and `objc2-foundation`, and **12.45 GB
  and 424 s user on the 108k-line `cargo` crate**, with swap at 13 GB of 14 GB (§4b). It fits only at `-j1`, and a gate running
  it must not overlap another heavy suite.
- **Disk.** 9.4–11 GiB free. A cargo build tree is 2–3 GB per side; the isolated tools toolchain about 0.6 GB; cargo's crates
  0.37 GB; clippy's test deps about 0.3 GB. Delete trees after reports.
- **The port's memory on cargo's testsuite crate.** 210k lines in one crate, twice the `cargo` crate that took 12.45 GB with
  swap at 13 of 14 GB. It may not build on 24 GB. Mitigation: build it alone; if it fails, a front-end memory lane (the plan-m7
  watch item: check-core is at 12.3 GB) before `cargo-testsuite` is gated.
- **cargo's testsuite flakiness.** One oracle run found no flaky test, but it is a large integration testsuite with timing and
  process tests; the UNSTABLE list must come from repeated oracle runs (D9), and a racy protected case is withdrawn by the
  established process.
- **The pinned cargo's tests assume its own repository layout** (`CARGO_MANIFEST_DIR`, `tests/testsuite/**/in`, snapbox
  snapshot files in source). They run from the unpacked tarball; nothing is edited.

What would change the plan:
- The port cannot build cargo's 210k-line test crate on this host: a front-end memory lane goes first, and until it lands M8a
  is judged on `cargo-build` + `cargo-smoke` with `cargo-testsuite` as a report, by a recorded decision (D9).
- clippy's first lint lanes find that most ui tests stop in `rustc_*` code rather than clippy's: then a `rustc-for-clippy`
  fixer wave goes before the remaining lint lanes.
- The owner defers clippy-ts (D1): M8 is M8a + M8b, about 16 rustfmt lanes and 5 vendor lanes, roughly half of M7: 1–2 weeks.

## 10. What I could not check

- **cargo's testsuite through the port**: the oracle's build and run were measured (§4c), the port's build of the 210k-line test
  crate was not (memory: it may not fit, §9). Flaky tests: one oracle run only, so none identified. `cargo-testsuite-rustc` was
  not tried.
- **The port's release build of cargo**: not tried. The dev build's rmeta and object bytes, and its per-crate stderr, were
  **not** compared with the oracle's (I deleted the oracle's tree for disk before the port's build finished); only the
  resulting binary's behaviour was. The binary is the mixed one: three small crates were the oracle's.
- **The smoke test's ripgrep step** used `$RUST_TS_DATA/ripgrep/cargo` as `CARGO_HOME` (offline, locked, read-only use, as
  check-rg does) and a copy of ripgrep's source; its target went to scratch.
- **clippy or rustfmt built by rust-ts against `rustc-dev`** (scope (b) for them): not tried, to keep to one build at a time.
- **ui_test's exact normalisations**: I matched only clippy's help-link filter; the suites do not depend on them.
- **The isolated tools toolchain** was not installed: I unpacked the two tarballs instead. Installing with rustup into
  `$RUST_TS_DATA/rustup-tools` is `harness-m8a`'s, as `harness-m6a` did for Miri.
- **Line counts for vendor crates** are from versions in cargo's lock where the root lock's differ slightly (`toml` 1.1.5 vs
  1.1.0, `regex-syntax` 0.8.11 vs 0.8.8); and which parts are reached is estimated, not traced.
- **Fn counts** for clippy and rustfmt are a regex over `fn` lines, not coverage.ts.
- **Windows**: not considered (AGENTS.md §5: kept where cheap, unchecked).

Kept in `$RUST_TS_DATA/tmp/plan-m8/`: `scripts/`, `bin/`, the `*.jsonl` and `*.txt` results, `port-log/`,
`port-build{,2}.{out,err}`, `oracle-build.err`, `tst-build.err`, cargo's tarball and the channel manifest (`dl/`). Removed: the
build and test trees, the unpacked components, sources and `cargo-home`, the component tarballs.

Critical files: src/tools/clippy/{src/driver.rs, clippy_lints/src/lib.rs, clippy_utils/src/{lib.rs, diagnostics.rs, sym.rs},
clippy_config/src/conf.rs, tests/compile-test.rs}, src/tools/rustfmt/src/{lib.rs, config/mod.rs, config/config_type.rs,
visitor.rs, items.rs, test/mod.rs}, cargo `tests/testsuite/main.rs`, `crates/cargo-test-support/src/lib.rs`,
compiler/rustc_driver_impl/src/lib.rs, compiler/rustc_lint/src/{context.rs, late.rs, early.rs}, scripts/rg-build.ts,
harness/compiletest.ts, harness/suites.ts.

# M8 plan — cargo, rustfmt and clippy for rust-ts

**Status: second revision (planning lane plan-m8, 2026-11-16).** The independent review (`docs/reviews/plan-m8.md` on
`t3/review-m8-plan`, 5a5f8beb) and its re-check (`docs/reviews/plan-m8-recheck.md` on `t3/review-revised-m8-plan`, 444ceedd) were
both APPROVE WITH CHANGES; this text answers F1–F11 and N1–N9 (§11 lists where). It follows root's recorded decisions
(`docs/state/history.jsonl`):
- **"M8 scope"** (2026-11-15T22:38): option (c) stands until the owner overrules it, with the alternatives costed in §1e;
- **"M8 host capacity"** (22:38): M8a gates on the cargo build and `cargo-smoke`; the test-crate measurement is in the first wave
  and runs alone behind a free-disk minimum and a memory watchdog;
- **"plan-m8 D16"** (22:38): `-C incremental` stays out, root's decision;
- **"M8 host headroom"** (23:09): D20's minimums (20 GiB free, swap under 4 GiB) stand; every non-heavy wave-41 step runs now, and
  `m8-measure` and every `cargo-build` run wait for the host; a watchdog stop inside a gate fails the run;
- **"M8 cargo testsuite status"** (23:09): the testsuite stays a report for M8a; root revisits it after `m8-measure`.

Decisions D1–D22 are in §7. **[owner]** marks what the owner may still want to overrule.

Pin `6f5da406b56c` (1.101.0-nightly). Base: main `2f4cd61c` (M7 done, gate-20261115-141315-root-qswd; 26,263 / 27,873 fns).
Paths are relative to the upstream checkout (`src/tools/…`, `compiler/…`) or to the cargo source. Line counts are `wc -l` of `.rs`
files unless "code" is written, which is `cloc`'s code column (no blank or comment lines). Fn counts are a regex over `fn`
lines (as plan-m7 did for `rustc_codegen_llvm`): coverage.ts does not count these trees yet. **Memory is in MiB/GiB** (the first
version wrote MiB as "GB"; review F9): `/usr/bin/time -l`'s bytes divided by 2^20.

**How measurements were taken.** macOS arm64, 12 cores, 24 GiB, 9.4–11 GiB free disk (98% used), swap 6.7–7.5 GiB used before
anything started; it peaked at 12.8 GiB used (14.0 GiB allocated), and free disk fell to 4.5 GiB, during the port's compile of the
`cargo` crate (swap files live on the data volume). At the revisions the host idled at 8.5–10.3 GiB of swap and 11–12 GiB free.
Disk sizes are `du -h`'s, so GiB. AC power throughout. Oracle `rustc
+nightly-2026-10-11`. Port = the gate's subject binary `$RUST_TS_DATA/subject-bin/5fb6b937…/rts` (main.ts, built from main
cc7f52fa; `src/` is unchanged since) with `--sysroot <oracle sysroot>`, as `rgCompiler("subject")` runs it. "user" = user CPU,
"rss" = max resident set. No oracle component was added or removed: clippy and rustfmt ran from their dist tarballs, unpacked
outside the toolchain, hash-checked against the manifest (§1b). Scripts and outputs in `$RUST_TS_DATA/tmp/plan-m8/` (§10 says
what is kept):

| Path | What it is |
|---|---|
| `src/tools/{clippy,rustfmt}` | `git archive HEAD` of the two trees from `$RUST_TS_DATA/rust` (not in the sparse checkout) |
| `dl/` | cargo's source tarball, the 2026-10-11 nightly channel manifest, the clippy and rustfmt component tarballs |
| `bin/rustc-port.sh`, `bin/port-build.sh` | `RUSTC` wrapper for cargo that runs the port and logs each call; the build script |
| `bin/rustc-mixed.sh`, `bin/port-build2.sh` | the same with `crc32fast`, `sha1`, `sha2` sent to the oracle (§4b) |
| `port-log/`, `port-build{,2}.{out,err}` | the port's builds of cargo: per call `.time`, `.exit`, `.stderr` |
| `scripts/clippy-ui.ts` → `clippy-ui-oracle.jsonl` | clippy ui as first measured (no `CLIPPY_CONF_DIR`, no `--crate-type=lib`) |
| `scripts/clippy-ui2.ts` → `clippy-ui2-oracle.jsonl`; `scripts/clippy-classify.ts` | the same with upstream's settings (F3), and a classifier of what still differs from the committed `.stderr` |
| `scripts/lane-probe.ts` → `lane-oracle.jsonl` | the re-check's probe (copied, unchanged), re-run here: each of the 1,019 clippy ui files in full, with the lint groups allowed, and with `-W` per annotated lint (N1) |
| `scripts/rustfmt-sys.ts` → `rustfmt-sys-oracle.jsonl`, `rustfmt-sys2-oracle.jsonl` | rustfmt system tests, first under rustfmt's own `rustfmt.toml`, then without it and with an empty `HOME` (F3) |
| `scripts/smoke.sh`, `smoke-{port,oracle}.txt` | the 11-step smoke test of a cargo binary, and its two outputs |
| `scripts/tst-all.sh`, `tst-all.txt`, `tst-fail*.txt` | cargo's testsuite, oracle-built, module by module |
| `scripts/calls.ts`, `cargo-tree.txt`, `cargo-deps-lines.txt` | the call-log summariser; cargo's host graph and per-package line counts |

## 0. Recommendation

M8 should mean **two ports and one build**, option (c), which root has recorded as the M8 scope:

- **clippy-ts and rustfmt-ts are line-by-line ports**, like rustc. Both are written against rustc's own crates, and every
  `rustc_*` crate they import is already ported: 31 crates, all at or above 88% except `rustc_interface` (59/90, 65.6%: backend
  loading and parallel infrastructure, not on clippy's path), and the parts of `rustc_data_structures` and `rustc_target` that are
  infrastructure or other targets. Their oracles are the pinned nightly's own `clippy-preview` and `rustfmt-preview`, built from
  the pin's commit.
- **cargo is built by rust-ts from its pinned source**, and its own testsuite is run against the port-built `cargo`. A
  line-by-line port with its C libraries behind an FFI seam, option (a′), is possible but costs about **1.7–2.5× all of (c)'s
  porting** (§1e). Building cargo is also the exact rehearsal M9 needs ("rust-ts compiles tsc-rs").

What the measurements settle:

| Question | Measured answer |
|---|---|
| Where are the sources? | clippy and rustfmt are in-tree subtrees at the pin (`src/tools/clippy` 27 MB, `src/tools/rustfmt` 10 MB), **not in the sparse checkout**. cargo is the submodule `src/tools/cargo` at `29c5daa1afc2`, fetched as a tarball (SHA-256 `a1aaf161…`) |
| How big? | clippy 157k lines (116k code, ~4.4k fns, 835 lints); rustfmt 38k (31k code, ~1.6k fns); cargo 108k (82k code) plus about 11k in the workspace crates it links |
| Are there oracles? | Yes: `clippy-preview` and `rustfmt-preview` for 2026-10-11, hashes equal to the manifest's; both link the oracle's `librustc_driver-3bee00c5d9e363a9.dylib`. cargo is the oracle toolchain's own component |
| Do the upstream tests run, with upstream's settings? | clippy `tests/ui` (1,019 files without aux crates), with `CLIPPY_CONF_DIR=tests` and `--crate-type=lib` where there is no `main`: **22 s for all**; the raw stderr equals the committed `.stderr` for **311 of the 876** that have one (and 141 of the 143 without one print nothing), and 547 more differ only by ui_test's renderings (empty `\|` lines, `//~` annotations in quoted source). rustfmt `tests/source` (804) without rustfmt's own config: **9 s**, **748 of 802** equal their committed target (§2b, §3b) |
| Can the port build cargo? | **Almost.** 389 of 392 calls exit 0, including the 108k-line `cargo` crate (424 s user, 12,450 MiB), all 12 proc macros (built and loaded by the port) and all 37 build scripts; 3 small crates stop on missing aarch64 intrinsic signatures in the IR model. With those three sent to the oracle, the build links a `cargo` that behaves like the oracle's on an 11-step smoke test, including ripgrep's `cargo check` (§4b) |
| Does cargo's own testsuite run here? | With the oracle: 64 s to build, **4,425 tests in about 12 min**, 27 fail for host reasons and 33 are ignored; no network needed (§4c). Its test code need not be built by the port to test a port-built `cargo` (D9) |
| Can the port's front end run clippy's tests? | The port as plain rustc on 3 sampled clippy ui files: 0.21–0.41 s wall, 292–517 MiB |
| How big is the work? | About **220k upstream lines to port** (clippy 157k, rustfmt 38k, vendor about 25k), against M7's 52k + 9k vendor: about 82 lanes (73 porting, 9 vendor), plus fixers and about 10 harness and tools batches |

**Order.** M8a (cargo built by the port) needs only one small fixer lane and its harness, so its code comes first; its heavy runs
wait for the host (D20). rustfmt-ts (M8b) is about a fifth of the porting. clippy-ts (M8c) is most of the cost. At the pin clippy
runs one combined early pass, whose sub-passes always run, and one combined late pass, whose sub-passes upstream builds only when
one of their lints is not allowed (§2a). So once clippy's early group is ported, a report suite that allows every lint group and
warns only the lints a test annotates, `clippy-ui-lane` (§2d), measures clippy lane by lane, with no glue in the port.

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
`git_commit_hash = 6f5da406b56c2db6607202b63daee73aa8c61297`. The tarballs' SHA-256 equal the manifest's `xz_hash` (clippy
`08d0af9f…`, rustfmt `3ed6326d…`). `clippy-driver` links `@rpath/librustc_driver-3bee00c5d9e363a9.dylib`, the oracle's own file;
run with `DYLD_LIBRARY_PATH=<oracle>/lib` it loads **the oracle's** `librustc_driver` and prints `rustc 1.101.0-nightly (6f5da406b
2026-10-10)` and `clippy 0.1.101 (6f5da406b5 2026-10-10)`; `rustfmt --version` prints `rustfmt 1.11.0-nightly (6f5da406b5
2026-10-10)`. **Nothing was added to the oracle toolchain.** D2 keeps exactly this arrangement for the harness (review F11).

cargo's oracle is the oracle toolchain's `cargo` component, already in `UPSTREAM.json` `components`, and already what `rg-build`
uses.

### 1c. Sizes and crate graphs

**clippy** (workspace members that ship in the component; `clippy_dev`, `lintcheck`, `clippy_dummy`, `book`, `util` are developer
tools and stay out):

| Crate | Files | Lines | Code | Fns | Role |
|---|---|---|---|---|---|
| `clippy_lints/src` | 745 | 133,587 | 96,307 | ~3,300 | 835 `declare_clippy_lint!` lints, 340 top-level files (72,926 lines) and lint groups in dirs: `methods` 22,138, `matches` 6,840, `loops` 5,701, `operators` 4,727, `casts` 4,104, `doc` 2,568, `functions` 1,940, `transmute` 1,853, `attrs` 1,410, `types` 1,361, … The dirs' `mod.rs` files (declarations and dispatch) are 16,626 lines, `methods/mod.rs` alone 6,229 |
| `clippy_utils/src` | 30 + dirs | 19,786 | 15,807 | ~980 | the shared helpers: `lib.rs` 3,716, `hir_utils` 1,833, `consts` 1,200, `sugg` 1,157, `source`, `visitors`, `ty/`, `mir/`, `ast_utils/`, `sym.rs` (extra symbols), `msrvs.rs`, `paths.rs` |
| `clippy_config/src` | 5 | 2,579 | 2,044 | ~110 | `clippy.toml`: `conf.rs` 1,014 (`define_Conf!`), `de.rs` 562 (a visitor over toml's `DeTable`), `types.rs` 918 |
| `src/driver.rs`, `src/main.rs` | 2 | 554 | 415 | 24 | `clippy-driver` (a `rustc_driver::Callbacks` that sets `register_lints`), `cargo-clippy` |
| `declare_clippy_lint`, `rustc_tools_util` | 2 | 497 | 437 | 15 | the lint macro; version info |
| `clippy_lints_internal` | 12 | 1,870 | 1,404 | | only with feature `internal`, not in the component: out |
| **Total in scope** | | **157,003** | **115,010** | **~4,430** | |

Its rustc imports (`extern crate`): `rustc_{span, session, middle, lint, hir, errors, driver, data_structures, attr_ir,
trait_selection, lexer, infer, index, hir_typeck, hir_analysis, attr_parsing, ast, abi, target, structures, resolve,
parse_format, mir_dataflow, interface, hir_pretty, const_eval, ast_pretty, arena}`. Port coverage of those crates today:
`rustc_hir_typeck` 1,041/1,041, `rustc_hir_analysis` 799/799, `rustc_lint` 714/718, `rustc_middle` 3,113/3,369,
`rustc_trait_selection` 965/976, `rustc_mir_dataflow` 378/378, `rustc_const_eval` 764/764, `rustc_hir_pretty` 119/119,
`rustc_ast_pretty` 274/274, **`rustc_interface` 59/90 (65.6%)**, `rustc_driver_impl` 68/77; the rest 100% except
`rustc_data_structures` (554/960) and `rustc_target` (293/930: other targets' specs). `rustc_arena` is erased in the port
(plan-m2: no `src/rustc_arena`), so clippy's arena uses become plain allocation. So **clippy reuses the ported compiler
wholesale**: it is a lint plugin, and `rustc_lint`'s `LintStore`, `LateContext`, `EarlyContext`, `register_lints` and the
`Callbacks::config` hook are what it plugs into, all ported for rustc's own lints.

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
`thin_vec`: the parser side only, all 98.5–100% ported (`parse` protected at 21,523 cases). Its crates.io dependencies and where
`src/` uses them (non-test):

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
`libsqlite3-sys` (`rusqlite` with `bundled`), `libssh2-sys`, `libz-sys`, `openssl-sys`, `security-framework-sys`. Which C each
links, and from where, is in §4a.

### 1d. The three scopes the brief named

| | (a) port to TypeScript, line by line | (b) build the upstream Rust with rust-ts | (c) mix: port clippy and rustfmt, build cargo |
|---|---|---|---|
| **clippy** | 157k lines (~57 lanes) + vendor ~10k (toml, regex-syntax's parser, url's parser, quine-mc_cluskey, semver). Runs in the port's process on the port's HIR and types: a TS clippy | links the **oracle's** `librustc_driver` from `rustc-dev` (`#![feature(rustc_private)]`): the lints would run inside the oracle's compiler. It tests rust-ts as a compiler of 157k lines of rustc-internal Rust, and gives no TS clippy. `clippy_lints` is one crate of 134k lines through the port's front end; §4b's 108k-line `cargo` crate took 12,450 MiB, so it may not fit on this host | (a) |
| **rustfmt** | 38k (~16 lanes) + vendor ~15k (toml stack shared, `diff`, `unicode-segmentation`, `ignore`/`globset`, `semver`, a `regex` subset). A TS formatter over the port's parser | the same trade as clippy: a binary around the oracle's `rustc_parse` | (a) |
| **cargo** | §1e's (a′): its own 119k lines, the reached part of 2.13M lines of Rust dependencies, and the C libraries behind an FFI seam | the oracle's `cargo` builds cargo's source with `RUSTC` = the port, as `rg-build` builds ripgrep. **Measured (§4): 389 of 392 compiler calls through the port succeed, 3 stop on missing intrinsic signatures; with those three sent to the oracle, the build links a `cargo` that behaves like the oracle's on an 11-step smoke test** | (b) |
| Upstream tests that can run | clippy `tests/ui` 1,224 + `ui-toml` 130 (+ `ui-cargo` 91 with cargo); rustfmt `tests/source` 804, `tests/target` 1,065 (idempotence), 294 unit tests | the same tests, but they test the oracle's compiler with a port-compiled plugin | all of the left column, plus cargo's 4,425 tests against the port-built `cargo` |

(b) for clippy and rustfmt is cheap but produces no TypeScript tool, and its signal ("rust-ts compiles rustc-internal code") is
one M9 does not need.

### 1e. The options for the owner, costed (review F4)

The first version said a TypeScript cargo would be "a redesign the contract forbids". That overstated it. The project already has
a seam for native code: `rustc_codegen_llvm` is ported with its seam at `llvm/ffi.rs` (plan-m7 D4), and proc-macro dylibs and host
libm are reached through `bun:ffi`. So **(a′)** is a real option: port cargo's own crates line by line, vendor only the reached
part of its Rust dependencies (PORTING §5b), and put the C libraries behind a `-sys` seam.

**(a′) costed.** From `cargo-deps-lines.txt` (per-package lines of the 309 registry crates, without their tests, benches and
examples). **Every package is assigned to one row, and the rows sum to the graph's 2,134,831 lines** (re-check N7: the first
revision left about 470k unassigned):

| Row | Packages | Lines | In (a′) | Estimate of what is reached |
|---|---|---|---|---|
| cargo's own `src/` + workspace crates | | 119k (not in the 2.13M) | ported whole | 119k |
| `gix*` (fetch, status, revision, shallow clone, index, refs, packs) | 51 | 133,419 | vendor, reached part | 50–80k |
| toml stack (`toml`, `toml_edit`, `toml_parser`, `toml_writer`, `toml_datetime`, `serde_spanned`, `winnow`) | 7 | 69,791 | vendor; manifests are cargo's core | 30–40k |
| serde stack (`serde`, `serde_core`, `serde_json`, `serde_derive`, `serde-untagged`, `serde_ignored`, `serde-value`, `erased-serde`) | 8 | 65,189 | the reached part of `serde::de` + generated derives (D6) | 15–25k |
| clap stack (`clap*`, `anstream`, `anstyle*`, `color-print*`, `terminal_size`, `unicode-width`, …) | 16 | 69,027 | vendor; cargo's `--help` texts are asserted by hundreds of tests | 20–30k |
| Rust side of git, curl, SQLite (`git2`, `git2-curl`, `curl`, `rusqlite`, `hashlink`, `fallible-*`) | 7 | 68,015 | vendor; the C behind them goes through the seam | 25–35k |
| archives (`tar`, `flate2`, `zlib-rs`, `libz-rs-sys`, `crc32fast`, `filetime`, `adler2`, `miniz_oxide`) | 5 | 32,501 | vendor (`zlib-rs` is pure Rust) | 15–25k |
| the 9 `-sys` crates' bindings | 9 | 56,451 | not ported: replaced by the seam | 0 (seam below) |
| platform and OS (`libc`, `rustix`, `nix`, `objc2*`, `core-foundation`, `security-framework`, `openssl*`, `cc`, `tempfile`, `walkdir`, `jobserver`, …) | 27 | 446,486 | `src/std` stand-ins | 0 |
| proc macros and their deps (`syn`, `quote`, `proc-macro2`, the 12 derive crates) | 15 | 75,771 | `tools/codegen` | 0 |
| i18n tables (`encoding_rs`, `icu_*`, `zerovec`, `yoke`, `tinystr`, …) | 19 | 209,602 | reached only through `url`/`idna` and `gix`'s path decoding | 0–10k |
| async (`futures*`, `tokio`, `pin-project*`, `mio`, `bytes`, …) | 13 | 55,984 | cargo's HTTP registry blocks on futures | 5–15k |
| time (`jiff`, `time*`, `deranged`, …) | 6 | 139,140 | timestamps, `-Z` date gates, gix's dates | 10–25k |
| regex and text search (`regex*`, `aho-corasick`, `memchr`, `bstr`, `globset`, `ignore`, `unicode-normalization`, …) | 11 | 218,569 | `package` include/exclude, gix's matching; `regex-automata` partly vendored | 20–40k |
| hashes and crypto (`sha1*`, `sha2`, `blake3`, `hmac`, `digest`, `typenum`, `rand*`, …) | 35 | 110,099 | vendor; `typenum`/`generic-array` erase | 10–20k |
| everything else (`hashbrown` ×3, `indexmap`, `im-rc`, `itertools`, `tracing*`, `http`, `nom`, `url`, `heapless`, `crossbeam-channel`, `log`, …) | 80 | 384,787 | the hash tables become `Map`; `im-rc` is the resolver's | 40–80k |
| **Graph total** | **309** | **2,134,831** | | |
| the C seam (curl easy/multi with callbacks, libgit2 with credential/transport callbacks and `git2-curl`'s custom transport, SQLite, libssh2 through libgit2) | | | new TS over `bun:ffi`, as `rust_ts/proc_macro_host.ts` | 5–10k new |
| **(a′) total** | | | | **about 360–550k upstream lines + 5–10k new**, 120–185 lanes |

The reach column is an estimate from each row's role, not a trace (§10). Even at its low end, **(a′) is 1.7–2.5× all of (c)'s
porting (220k), and 2.3–3.5× clippy-ts**. It has costs (c) does not: cargo's job queue and `gix`'s `parallel` feature use threads
and `jobserver` (sequential `PORT:`s, as plan-m7 D15 did); `curl`'s multi handle and `gix`'s HTTP transport are callback-driven
through the seam; and the C libraries stay native, so it is not TypeScript all the way down either. Its test strategy is good,
though: an oracle-built testsuite (D9) can drive any `cargo` binary, a TS one included. Calendar: 2.5–3.5 months at today's pace;
tokens 220–400 M.

| Option | What M8 delivers | Porting | Calendar (est.) | Tokens (est.) |
|---|---|---|---|---|
| **(c) — recommended, recorded as M8 scope** | clippy-ts, rustfmt-ts; cargo built by the port, tested by its own testsuite | ~220k | 3–5 weeks | 80–120 M |
| (c) without clippy-ts (clippy deferred after M9) | rustfmt-ts; cargo built by the port | ~53k (rustfmt 38k + ~15k vendor), ~21 lanes | 1–2 weeks | 25–35 M |
| (a′) cargo ported too | all three in TS, C behind a seam | ~580–770k (with clippy and rustfmt) | 3.5–4.5 months | 300–520 M |
| (c) with cargo-ts deferred to after M9 | as (c) minus `cargo-*` suites | ~220k | 3–5 weeks | 75–110 M |

**Why (c) still.** (a′) is the largest single block of porting since rustc itself, and most of it is not compiler code: HTTP,
git, archives, SQLite. It would be the project's first port of a non-compiler program, carried by a seam to five C libraries that
the oracle tests cannot see past. (c) instead tests the compiler on the largest real program it has built (317 crates, a 108k-line
crate, 12 proc macros, C build scripts), which is what M9 needs, and its testsuite design (D9) is reusable if (a′) is chosen
later. **Deferring clippy** saves about three quarters of M8's porting and moves nothing M9 needs, but clippy-ts is the tool that
exercises the ported type checker, trait solver and MIR most, and its lint lanes are small, independent and parallel; deferring
reorders the work rather than saving it. I recommend keeping it. **[owner]** The owner may overrule either way (D1).

## 2. clippy

### 2a. How clippy runs

`clippy-driver` (`src/driver.rs`) is `rustc_driver::compiler_entrypoint(&args, &mut ClippyCallbacks)` where
`ClippyCallbacks::config` (:140) wraps `config.register_lints` to call `clippy_lints::register_lint_passes` and `register_lints`
(and `clippy_config`'s `Conf::read` from `clippy.toml`, found through `CLIPPY_CONF_DIR` or the crate's directory), and sets
`config.psess_created` to track the conf file and `config.override_queries` for `mir_borrowck`-style hooks. Every lint is an
`EarlyLintPass` or `LateLintPass` over AST / HIR / `TyCtxt`, emitting through `clippy_utils::diagnostics::span_lint_and_*`, which
are thin wrappers over `rustc_lint`'s `LintContext::opt_span_lint`.

**How the passes are registered at the pin** (`clippy_lints/src/lib.rs:449–487`; re-check N1; the first two versions of this
plan described an older architecture):
- two pre-expansion passes, `attrs::EarlyAttributes` and `nonstandard_macro_braces::MacroBraces`;
- **one** `CombinedEarlyLintPass` (`combined_early_pass.rs`, 92 lines), declared by `early_lint_methods!` (:492) with 51
  sub-passes from 49 modules, among them the two lint-less collectors `FormatArgsCollector` and `AttrCollector`, whose
  `FormatArgsStorage` and `AttrStorage` the late passes read. **Every early sub-pass runs on every crate**: "the early pass runner
  has no such filtering";
- **one** `CombinedLateLintPass` (`combined_late_pass.rs`, 91 lines), declared by `late_lint_methods!` (:553) with 316 sub-passes.
  Each sub-pass is an `Option`, **built only if `is_lint_pass_required(tcx.skippable_lints(()), <T>::lint_vec())`** (:477–478).
  `skippable_lints` (`compiler/rustc_lint/src/levels.rs:115`) holds every lint that is allowed at the crate root (command line
  included) or allow-by-default and that nothing raises. `eval_always` lints (clippy has one, `cognitive_complexity`) and lint-less
  passes are never skippable. rustc's own `late.rs:369–380` filters its passes the same way.

The port already has both halves of that filter (`src/rustc_lint/levels.ts:162` `skippable_lints`, `late.ts:436–444`) and
generated `lint_vec()`s, and every piece of the driver path for rustc's own lints: `rustc_lint` 714/718, `rustc_driver_impl`'s
`Callbacks` (the Miri driver uses `after_analysis`, `override_queries` and `extra_symbols`). That structure decides §2d.

clippy's `sym.rs` extra symbols go past `PREDEFINED_SYMBOLS_COUNT` the way Miri's do (plan-m6 §1a).

### 2b. Upstream tests

`tests/compile-test.rs` drives `ui_test 0.30.7`. For `tests/ui` it sets **`CLIPPY_CONF_DIR=tests`** (`:279`, so
`tests/clippy.toml` applies, not clippy's root `clippy.toml` with its dogfood settings) and `RUSTC_ICE=0`, and runs
`clippy-driver <file> --edition=2024 --emit=metadata -Aunused -Ainternal_features -Zui-testing -Zdeduplicate-diagnostics=no
-Znext-solver=coherence -Dwarnings` plus the file's `//@` directives; ui_test adds **`--crate-type=lib`** to a file with no `fn
main`. It compares stderr with `<file>.stderr` after ui_test's normalisations (it re-renders from JSON, drops the `//~`
annotations from quoted source and some empty `|` lines, and applies each test's `//@normalize-stderr-test`) and, with `rustfix` on,
applies the machine-applicable suggestions and compares with `<file>.fixed`. Dependencies for aux and `extern crate` come from
`clippy_test_deps` (libc, regex, serde, quote, syn, futures, parking_lot, tokio, itertools), built once by cargo. Also
`tests/ui-toml` (a per-directory `CLIPPY_CONF_DIR`), `tests/ui-internal` (feature `internal`: out), `tests/ui-cargo` (`cargo
clippy` on small projects: needs `cargo-clippy` and `cargo metadata`), and `dogfood.rs` (clippy on its own source).

| Directory | `.rs` (non-aux) | `.stderr` | `.fixed` | Notes |
|---|---|---|---|---|
| `tests/ui` | 1,224 | 1,091 | 642 | 162 use `aux-build` (130 a proc-macro aux; `proc_macros.rs` itself uses `syn`/`quote`, 112 files), 21 use external deps, 19 `revisions`, 12 `only-`/`ignore-`, 21 `compile-flags`, 128 `no-rustfix`, 159 `check-pass`; 103 of the 1,019 measured have no `fn main` |
| `tests/ui-toml` | 130 | 136 | 42 | |
| `tests/ui-internal` | 15 | 15 | 6 | out |
| `tests/ui-cargo` | 91 | 29 | | report |

**Measured with the oracle, with upstream's settings** (`scripts/clippy-ui2.ts`; review F3): the 1,019 `tests/ui` files that need
no aux, no revisions, no target filter and no external crate, run from the clippy root:

| Setting | Raw stderr equal to the committed `.stderr` (after dropping clippy's `= help: for further information visit …` line) | Stops at E0601 (no `main`) |
|---|---|---|
| as first measured (no `CLIPPY_CONF_DIR`, no `--crate-type=lib`) | 391 | (not recorded; the review counted 91) |
| `CLIPPY_CONF_DIR=tests` | **401** (the review's figure, reproduced) | 90 |
| `CLIPPY_CONF_DIR=tests` + `--crate-type=lib` without `main` | **452** | **0** |

With both settings: **22 s for all, p50 19 ms**; exit 0 on 149, exit 1 (the `-Dwarnings` lint errors) on 869, exit 101 on 1
(`custom_ice_message.rs`, an intentional ICE). **143 of the 1,019 have no committed `.stderr`**; 141 of them match only because
their empty output equals "no file" (re-check N9). With a `.stderr`, the match is **311 of 876**. Of the 567 that still differ (`scripts/clippy-classify.ts`): **302 only by empty
`|` lines**, **245 by the `//~` annotations in quoted source** (and empty `|` lines), 6 are tests with their own
`normalize-stderr-test`, 2 have no `.stderr`, and 12 need what this filter skipped (`libc` from `clippy_test_deps`,
`proc_macro.rs`'s crate type, `--test`-style tests). So **with upstream's settings, every committed baseline but 14 is reproduced
by the oracle up to ui_test's named normalisations** (the 12, and the 2 that print output where no `.stderr` is committed). The expectation in M8's suites is still the oracle's own output, raw (D10):
the normalisations are presentation, not behaviour, and both sides run the same settings.

**The port's front end on these files** (port as plain rustc, same argv, `approx_const.rs`, `methods.rs`, `manual_let_else.rs`):
exit 0, 0.21–0.41 s wall, 0.36–1.20 s user, 292–517 MiB. So a clippy ui case through clippy-ts should cost about as much as a
`check-ui` case: the 1,224 cases are minutes of gate time.

### 2c. What has to be ported, by group

| Group | Lines | Lanes (≤ ~3k) |
|---|---|---|
| ✱Contract: `src/driver.rs` 335, `declare_clippy_lint` 279, `clippy_lints/src/{lib.rs 874, declared_lints.rs 841, deprecated_lints.rs 206, combined_early_pass.rs 92, combined_late_pass.rs 91}` | 2,718 | 1 (`clippy-contract-a`) |
| ✱Contract: `clippy_config` (2,579) + `clippy_utils/src/{diagnostics.rs, sym.rs, msrvs.rs}` | ~3.9k | 2 (`clippy-contract-b`, chained) |
| ✱Dispatch contracts: the directories' `mod.rs` (declarations, pass structs, `check_*` dispatch): `methods/mod.rs` 6,229 (two chained lanes), then `doc` 1,407 + `matches` 1,296, `operators` 1,133 + `loops` 1,005, `casts` 959 + `types` 703 + `attrs` 643, `functions` 633 + `transmute` 571 + `misc_early` 371 + `write` 355 + `cargo` 282 + the rest | 16.6k | 7 (`dispatch-methods-a/-b`, `dispatch-a…e`) |
| `clippy_utils` (the rest) | ~17k | 6 |
| **The early group, ported before any other lint file** (§2d): the 49 modules of `early_lint_methods!` (both pre-expansion passes and both collectors among them) and `cognitive_complexity.rs` (170, the one `eval_always` lint). At most 14.6k counting the mixed directories `attrs`, `doc`, `functions`, `misc_early` whole; their lines are part of the rows below | ≤ 14.6k | 5 (`clippy-early-a…e`) |
| `methods/` lint files (without `mod.rs`) | 15.9k | 6 |
| `matches/`, `loops/`, `operators/`, `casts/` files (without `mod.rs`) | 17.0k | 6 |
| other directories' files (without `mod.rs`) | ~9.5k | 4 |
| 340 top-level lint files | 72.9k | 25 |
| **Total** | **~157k** | **~57** |

The early group's lanes are taken from the rows below them, so the total stays about 57. About 28.6k of `clippy_lints`'s lines are comments, mostly the lint documentation inside `declare_clippy_lint!`, which PORTING §2
keeps but which costs little to port. Macros (`declare_clippy_lint!`, `declare_lint_pass!`/`impl_lint_pass!`, `define_Conf!`,
`msrv_aliases!`, `combined_{early,late}_lint_pass!`, clippy's `sym` list) are generated by `tools/codegen` (D5).

### 2d. Measuring clippy lane by lane (review F1, re-check N1)

**The problem.** The contract registers every sub-pass (D14), and a sub-pass whose body is not yet ported stops with `unported`.
In the gated `clippy-ui`, a case stops while any sub-pass it activates is a stub: every early sub-pass (all always run), the
`eval_always` `cognitive_complexity`, and every late sub-pass that holds a default-on lint (497 of the 835 lints are default-on) or a
lint the file raises. So `clippy-ui` reads about 0 until the early group and every late sub-pass with a default-on lint have
landed. It is still the right gate; it is the wrong progress measure.

**The design: `clippy-ui-lane`, a report-only suite that relies on upstream's own late-pass filter. No glue, no environment
variable, nothing under `src/`.**
1. **Same lint configuration on both sides**, through ordinary lint levels, appended to `clippy-ui`'s argv (D10): `-A clippy::all
   -A clippy::pedantic -A clippy::nursery -A clippy::cargo` (restriction is allow-by-default), then **`-W clippy::<lint>` for each
   lint the file annotates with `//~`** (restored: re-check N1). In-source attributes still win over the command line.
2. **The late pass selects itself.** With every group allowed, `skippable_lints` contains every clippy lint except those the file
   raises (its `-W` lints, its `warn`/`deny`/`forbid`/`expect` attributes) and `cognitive_complexity`. Upstream's
   `CombinedLateLintPass::new` (ported in `clippy-contract-a`) then builds only the sub-passes holding one of those lints, on both
   sides alike. A stub sub-pass is never built unless the file makes it active, and then exit 70 is the honest answer.
3. **The early group is a prerequisite.** Early sub-passes are never skipped, so no early stub may remain when the suite starts to
   count: the early group (§2c, `clippy-early-a…e`, ≤ 14.6k lines, with `cognitive_complexity`) is the first clippy porting after
   the contracts. That is what early passes need, and why: no filter exists for them upstream, and adding one in the port would be
   a redesign. Before the early group lands, `clippy-ui-lane` has no eligible case.
4. **Eligible cases** at a run: a ui file each of whose *raised* lints belongs to a sub-pass that is fully ported (every fn of the
   files implementing it: `bun scripts/coverage.ts --missing`; the sub-pass ↔ lint ↔ file table is generated by
   `codegen-clippy-macros`, D5). Raised = `//~` annotations, `warn`/`deny`/`forbid`/`expect` attributes and `//@compile-flags`.
   **Group names in attributes** (`#![warn(clippy::pedantic)]`; 3 of the 1,019 files) are expanded to their member lints from the
   generated group table (re-check N9). **`allow` attributes do not count** (255 files have some): an allowed lint's sub-pass is not
   built unless something else raises it, and if it is, an unported stub shows as UNPORTED anyway. Ineligible cases are skipped
   with `waiting for <sub-pass>` and are not in the denominator.
5. **A lint is measurable only when its whole sub-pass is.** `Methods` holds 164 lints in one sub-pass, so no `methods-*` lane's
   cases become eligible until the last of the methods lanes lands (§8 orders them together); the same holds for other
   multi-lint sub-passes, which the generated table names.
6. **Vacuous cases are excluded.** A case whose oracle lane output holds none of its annotated diagnostics would MATCH with empty
   output on both sides. Measured on the oracle (`scripts/lane-probe.ts`, the re-check's probe re-run here; 1,019 files, 871 with
   diagnostics in `clippy-ui`):

   | Configuration | Files with ≥ 1 diagnostic | Of the 871: **empty output** | fewer diagnostics (not empty) | Diagnostics in all |
   |---|---|---|---|---|
   | `clippy-ui` | 871 | – | – | 9,442 |
   | groups allowed, no `-W` (the first revision's design) | 814 | **57** | 23 | 8,997 |
   | groups allowed **+ `-W` per `//~` lint** (this design) | 866 | **5** | 1 | 9,432 |

   The 5 (`blocks_in_conditions_2021.rs`, `blocks_in_conditions_unfixable.rs`, `def_id_nocore.rs`, `manual_filter_unfixable.rs`,
   `mixed_attributes_style/mod_declaration.rs`) are listed and excluded by the harness; the 143 files without a `.stderr` are kept,
   since an empty expectation is what they test.
7. **Known approximation, which is why it is never protected (D19):** cross-pass state on the late side. The early collectors'
   storage is filled by the (ported) early group on both sides, so it is exact; a late sub-pass that reads another late sub-pass's
   state would see it missing on both sides alike only if that other sub-pass is skipped on both, which upstream does too. A case
   that matches here and fails in `clippy-ui` names such a dependency.
8. **When.** `clippy-contract-a` ports `combined_{early,late}_pass.rs`; `codegen-clippy-macros` emits the table; `harness-m8d`
   lands `clippy-ui-lane` with `clippy-ui` before the first lint lane, and it starts to count once the early group is in.
9. **Its first use** is §9's trigger: if, over the first 3–5 late lint lanes, most eligible cases stop in `rustc_*` code rather
   than in clippy's, a `rustc-for-clippy` fixer wave goes before the remaining lint lanes.

Because nothing in the port changes, there is no lane-only switch that could reach a gated suite (re-check N2 does not arise), and
D18 needs no exception. The suite differs from `clippy-ui` only in its argv, which lives in its own case definitions.

## 3. rustfmt

### 3a. How rustfmt runs

`rustfmt` parses with `rustc_parse` into `rustc_ast` (`parse/parser.rs`, `parse/session.rs`: its own `ParseSess` with a silent
emitter), resolves out-of-line modules itself (`modules.rs`), then walks the AST with `FmtVisitor` (`visitor.rs`), producing text
through the `Rewrite` trait (`items.rs`, `expr.rs`, `types.rs`, `patterns.rs`, `chains.rs`, `macros.rs`, `comment.rs`, `lists.rs`,
`overflow.rs`, …) against `Config` (`config/*`, built by the `create_config!` macro and `#[config_type]`, read from `rustfmt.toml`
with `toml` + serde). It looks for `rustfmt.toml` **upward from each file** and in the user's config directory. No type checking,
no HIR: it needs only the parser half of the port, which is protected at 100% of `parse` (21,523 cases) and `parse-ui` (991).

### 3b. Upstream tests

`cargo test` of rustfmt runs `src/test/mod.rs`: **`system_tests`** formats every `tests/source/**/*.rs` with the **default
config** plus its "significant comments" (`// rustfmt-<option>: <value>`, `config` and `target` keys, `edition`, `style_edition`;
`read_config`, :859) and compares with `tests/target/…`; **`idempotence_tests`** formats every `tests/target` file and expects no
change; `self_tests` formats rustfmt's own source; `warning_tests`, `coverage_tests`, `checkstyle_test`, `json_test`,
`modified_test` and the `stdin_*` tests cover the emit modes; plus `configuration_snippet.rs` (the examples in
`Configurations.md`), `tests/config`, `tests/mod-resolver`, `tests/parser`, `tests/cargo-fmt`, `tests/rustfmt` (the binary's CLI).
In all 294 `#[test]` fns in `src/` and the integration tests in `tests/`.

| Directory | `.rs` | Notes |
|---|---|---|
| `tests/source` | 804 (802 with a target) | `system_tests` |
| `tests/target` | 1,065 | `idempotence_tests` |
| all of `tests/` | 1,947 `.rs`, 37 `.toml` | |

**Measured with the oracle** (`scripts/rustfmt-sys.ts`): each `tests/source` file through the component's `rustfmt --emit stdout
--quiet`, its significant comments passed as `--edition`, `--style-edition`, `--config k=v,…` and `--config-path`:

| Setting | Equal to the committed target | exit 0 / 1 / 101 | Time |
|---|---|---|---|
| as first measured: from the rustfmt root, so files without a `config` comment read **rustfmt's own `rustfmt.toml`** (`error_on_line_overflow`, `error_on_unformatted`, `style_edition = "2024"`, …) | 717 of 802 | 735 / 68 / 1 | 12 s |
| **without that file, `HOME` and `XDG_CONFIG_HOME` empty** (review F3) | **748 of 802** (the review's figure, reproduced) | 788 / 15 / 1 | 9 s |

Of the 54 left: **15 exit 1 because the CLI's `--config k=v` cannot carry a JSON-valued option** (`file_lines` 12,
`skip_macro_invocations` 3), 5 are files formatted as part of a module tree (`--emit stdout` prints every file of the tree), 1
is an ICE in the oracle, and 33 exit 0 with other text, which I did not classify. The first two classes are the emulation; the
harness removes them by writing the significant comments into a generated `rustfmt.toml` per case (passed with `--config-path`,
which takes arrays as TOML) instead of `--config`, and by comparing per file of a module tree (D11).

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

rustfmt has a milder form of F1: nearly every source file goes through `visitor`, `items`, `expr`, `lists` and `comment`, so
`rustfmt-system` moves only after most of these 16 lanes have landed. At this size that is accepted; lane reviews use the
per-function unit tests and the files whose constructs a lane covers.

## 4. cargo built by rust-ts

### 4a. The oracle's build, and the C it links (review F7)

`cargo build --offline --locked -j4` of cargo at `29c5daa1` (dev profile, `CARGO_INCREMENTAL=0`, isolated `CARGO_HOME`): **317
`Compiling` lines, 54 s wall, 116 s user, 18 s sys, 2,482 MiB max rss, 2.1 GiB of target directory.** cargo's `Cargo.toml` sets no
`[profile.*]`, so release is opt-level 3, 16 CGUs, no LTO (so no bitcode in rlibs: G2 and the ThinLTO buffer are not on this
path, §5). Default features: `http-transport-curl`.

**Where each `-sys` crate's C comes from on this host** (read from the build scripts at the locked versions; `pkg-config` is not on
`PATH`; Homebrew has `openssl`, `openssl@3`, `openssl@3.5`, `openssl@3.6`, `openssl@4`, `libgit2`, `libgit2@1.9`, `curl`,
`libssh2`, `sqlite`, `libnghttp2`):

| Crate | Default build here | Mutable host input? |
|---|---|---|
| `libsqlite3-sys` | bundled SQLite (`rusqlite` with `bundled`) | no |
| `libgit2-sys` | probes `pkg-config` for a system libgit2, which fails without it, so it builds its vendored libgit2 | **by accident**: installing `pkg-config` would switch it to Homebrew's `libgit2` |
| `libssh2-sys` | builds its bundled libssh2, linked to OpenSSL from `openssl-sys` | through OpenSSL |
| `openssl-sys` | `find_normal.rs` looks in Homebrew's well-known prefixes (`/opt/homebrew/opt/openssl@3`, …) | **yes: Homebrew OpenSSL**, headers at build time and its dylib at run time |
| `curl-sys` | on Apple, links the system libcurl if `curl-config` (first on `PATH`) reports HTTP/2, else builds its vendored curl (and `libnghttp2-sys`'s nghttp2) | **yes: whichever `curl-config` is on `PATH`**, and the macOS SDK's libcurl |
| `libz-sys` | `pkg-config` fails, so the system zlib of the SDK | the SDK and OS (already in rg-build's `hostToolsId`) |

So a `brew upgrade` of OpenSSL, or a `pkg-config` install, between the oracle's cached build and the port's build could flip a
protected `cargo-build` MATCH. **cargo has a feature for exactly this**: `all-static = ['vendored-openssl', 'curl/static-curl',
'curl/force-system-lib-on-osx', 'vendored-libgit2']`, commented "primarily used by rust-lang/rust distributing cargo the
executable". It builds OpenSSL from `openssl-src` and libgit2 from source, and on Apple uses the OS's libcurl. D15 adopts it, plus
a recorded check.

### 4b. The port's build

The same command with `RUSTC` = `bin/rustc-port.sh` (every call, probes and build scripts included, to the port; `-j2` because of
memory; `--keep-going` so that one stop does not hide the next):

| | Port (every call) | Oracle |
|---|---|---|
| Compiler calls | **392: 389 exit 0, 3 stop** (exit 70). That is all 317 units, the 37 build scripts, cargo's probes | 317 units |
| Proc macros | **all 12 built by the port and loaded by the port's own proc-macro host** while compiling their users (pm-self's path) | |
| Build scripts | all 37 compiled by the port and **run by cargo**: the `-sys` scripts ran their probes and drove `cc` over the bundled C (libgit2, libssh2, SQLite) and succeeded. I did not compare their outputs with the oracle's (`rg-build` does that byte for byte; `cargo-build` will) | |
| The stops | `crc32fast` (`llvm.aarch64.crc32b`), `sha1` (`llvm.aarch64.crypto.sha1h`), `sha2` (`llvm.aarch64.crypto.sha256h`): `rust-ts: unported: llir: the signature of … (IntrinsicsAArch64.td) is not in the IR model`. The IR model's aarch64 name table is complete (580 names, generated); only these intrinsics' **signatures** are missing | |
| Blocked by them | only the link of the `cargo` binary (it needs those rlibs); with pipelining every other unit compiled from their `.rmeta`, **including the `cargo` lib crate itself** (108k lines): exit 0 | |
| Wall, `-j2` | 1,362 s (22.7 min) | 54 s at `-j4` |
| CPU | **4,088 s user** (35× the oracle's 116 s), 642 s sys | 116 s user |
| Largest compiles (user, max rss) | **`cargo` 424 s, 12,450 MiB** (12.2 GiB; 533 s wall, 419 s sys: it swapped); `objc2-foundation` 172 s, 6,267 MiB; `gix` 89 s, 6,045 MiB; `jiff` 62 s, 4,108 MiB; `regex-automata` 59 s, 3,721 MiB; `syn` 59 s, 3,188 MiB; `git2` 56 s, 2,761 MiB | 2,482 MiB for the whole build |
| Sum of the calls' own wall time | **2,139 s (35.6 min)**, before the C compiles in build scripts and the final link: a `-j1` build is about **40–50 min per side** uncached (review F9) | |
| Host | swap 6.7 → 12.8 GiB used during `cargo`'s compile (14.0 GiB allocated); free disk 11 → 4.5 GiB (swap files) | |

I did not split the `cargo` crate's 12,450 MiB between the front end and codegen. Wave 41's measurement does (D20).

**A port-built cargo, with three crates from the oracle.** To see past the stops, I re-ran the build with a wrapper that sends only
`crc32fast`, `sha1` and `sha2` to the oracle and everything else to the port (mixing is sound when symbols agree, plan-m7 §3; this
is a measurement, not a harness design: D15). cargo recompiled 39 units, `cargo` among them, in 751 s wall at `-j1` (936 s user),
and **linked `target/debug/cargo`** (134 MB, `cargo 1.101.0`).

**Smoke test** (`scripts/smoke.sh`): the same 11 steps with the port-built cargo and with the oracle's `cargo` component, the
oracle `rustc` as `RUSTC` in both: `--version`; `new`; `build`, `run`, `test` (one passing and one failing test), `build
--release`, `metadata`, `tree`, `clean` on that project; then ripgrep 15.2.0's `cargo check --locked -j4` (34 crates) and `cargo
tree`. **All 11 exit codes are the same** (`test` exits 101 on both, as it should), and every output is the same except three
things, none a port difference:
- `--version`: the port-built `cargo 1.101.0` against the component's `cargo 1.101.0-nightly (29c5daa1a 2026-10-07)`. The suffix
  comes from `build.rs`'s `git-commit-info` file and `CFG_*` variables that rust's bootstrap provides when it builds the component;
  the tarball has neither. So `cargo-smoke` compares the port-built cargo with an **oracle-built cargo from the same source and
  environment**, not with the component (D8).
- a thread id in the failing test's panic line (harness-m7b's mask covers it);
- the order of `Compiling`/`Checking` lines at `-j4` (rg-build sorts them).

### 4c. cargo's own tests

`tests/testsuite` is one integration-test binary (994 files, 209,863 lines, 4,454 `#[cargo_test]`), built with
`cargo-test-support` (5.7k), `snapbox`, `gix` and the `cargo` lib, and run against `CARGO_BIN_EXE_cargo`, **a path baked in at
compile time** (`snapbox::cmd::cargo_bin!("cargo")`, `tests/testsuite/utils/mod.rs`). The tests create projects under a sandbox,
local registries (`file://` and an in-process HTTP server), local git repositories (through `git2`), and run `cargo` on them; that
`cargo` finds `rustc` **on `PATH`** (`cargo-test-support/src/lib.rs:1280`, `:1303`, `paths.rs:461`). `cargo-test-support` sets
**`CARGO_INCREMENTAL=0` for every test** (`lib.rs:1442`); about 25 sites in 10 files turn it back on for tests of incremental
behaviour (review F6).

| `#[cargo_test(…)]` | Count | In M8 |
|---|---|---|
| plain | 4,058 | yes |
| `nightly` | 309 | yes: the oracle toolchain is a nightly |
| `build_std_mock` | 23 | yes (a mock std) |
| `requires = "git"` 8, `"nm"` 3, `"readelf"` 3, `"hg"` 2, `"lldb"` 2, `"gdb"` 2, `"ssh"` 1, `"objdump"` 1, `"strings"` 1, `"cdb"` 1, `requires_rustup_stable` 2, split-debuginfo 3 | 29 | as the host has them; the rest are skipped by cargo's own macro, on both sides |
| `container_test` 9, `public_network_test` 7 | 16 | out (skipped by cargo's macro unless enabled) |

So the testsuite needs **no network and no registry stub of ours**: its stubs are its own. It needs `git` on `PATH` for 8.

**Measured with the oracle** (oracle cargo and rustc build the testsuite; `scripts/tst-all.sh` runs it module by module, clearing
the sandbox between modules because it grows about 0.3 GiB per 200 tests):

| | Result |
|---|---|
| Build of `testsuite` (`cargo test --test testsuite --no-run`, `-j4`, dev) | 64 s wall, 138 s user, 2,450 MiB max rss, 2.1 GiB of target |
| Tests listed | **4,425** (`--list`; the `#[cargo_test]` count of 4,454 includes a few behind `cfg`) |
| Run, default test threads (12) | **about 12 min wall** (747 s including about 3 min of modules matched twice by the substring filter) |
| Outcome | **27 fail, 33 ignored, the rest (about 4,365) pass** |
| The 27 failures | 21 assert that a cross target is installed (`utils/cross_compile.rs:181`: on aarch64 macOS they cross-compile to `x86_64-apple-darwin`, whose std is not in the oracle toolchain and must not be added); 2 `cargo_alias_config` and 1 `script::cargo` tests that met external `cargo-*` subcommands on my inherited `PATH`; 2 `rustup`, 2 `install`, 1 `version::verbose`, 1 `jobserver`, 1 `standard_lib`: host and environment assumptions. **None is cargo** |

**Three ways to run it** (review F5, re-check N3):
- **`cargo-testsuite`: an oracle-built testsuite per side, the subject side's `cargo` replaced by the port-built one.**
  `cargo_bin!("cargo")` is `env!("CARGO_BIN_EXE_cargo")` (snapbox 1.2.2 `src/macros.rs:158–159`): an absolute path fixed when the
  test crate is compiled, so a copied tree still runs the binary at the original path. The harness therefore builds the testsuite
  **once per side**, with the oracle's cargo and rustc, into two fixed trees, `$RUST_TS_DATA/cargo-testsuite/oracle` and
  `…/subject`; in the subject tree it replaces `debug/cargo` (the baked-in path) with `cargo-build`'s kept port-built binary.
  Before every run it checks that the file at each tree's baked path has the hash of that side's binary, and refuses otherwise.
  Each tree is keyed (source, lock, oracle rustc, `hostToolsId`) and locked, so the sides can run one after the other without an
  interrupted run leaving the wrong binary where the other side expects its own. Trusted test code (libtest,
  `cargo-test-support`, snapbox's comparisons are the oracle's) tests the port-built cargo, and the port never compiles the
  210k-line test crate. No source is edited. **Disk: about 4.2 GiB kept** (two trees of 2.1 GiB), plus about 0.3 GiB of sandbox
  per 200 tests, cleared per module; **time: 2 × 64 s to build the trees** (oracle only, cached between gates) and about 12 min
  per side to run. This is the configuration that may be protected later (root's "M8 cargo testsuite status": a report for M8a,
  revisited after `m8-measure`).
- `cargo-testsuite-port`: testsuite and `cargo` both built by the port, in a third tree. It also tests the port on the largest
  single crate it will have compiled (210k lines; the 108k-line `cargo` crate took 12,450 MiB), but a miscompile in the test code's
  own assertions could turn a failure into `ok`, which outcome matching cannot see. Report.
- `cargo-testsuite-rustc` (report, heavy): the oracle side's tree, with the **port** as `rustc` on `PATH`: about 4,000 cargo
  scenarios through the port, a large front-end and diagnostics check and a rehearsal of M9. Since every test runs with
  `CARGO_INCREMENTAL=0`, only the few dozen tests that turn incremental back on stop (`unported`, listed as expected).

## 5. M7 follow-ups and M8

| Follow-up (docs/next.md "Queued") | Matters for M8? | Why |
|---|---|---|
| **G2: `LLVMRustGetSymbols` for bitcode members** | **No** for cargo (no LTO in its profiles, so no bitcode members); **watch** in `cargo-testsuite-rustc` (a few tests use `-C lto`/`linker-plugin-lto`) | |
| **ThinLTO embedded-bitcode buffer** | No for cargo's build; wait | rlibs carry bitcode only with LTO or `-C embed-bitcode=yes` |
| **`uselistorder`** | No | it changes `__text` bytes of 15 of 283 pm-self dylibs, not behaviour (pm-self F1); M8 compares behaviour and test outcomes |
| **`-C incremental`** | **No** (root's decision "plan-m8 D16") | cargo's test setup sets `CARGO_INCREMENTAL=0` for every test (§4c), and `cargo-build` sets it as rg-build does. Only the few dozen tests that turn it back on, in the report `cargo-testsuite-rustc`, need it. M9's plan revisits it |
| **`std-self`** (port-built core/alloc/std) | No for M8; **yes for M9** | about 12 GB of RSS on core (plan-m7's figure, its unit); nothing in M8 needs a port-built sysroot. Keep it queued for M9's plan |
| **harness-m7d re-check notes 1–6** (sweep matches the tag anywhere, prune by build date, uncached-error race, signal exit, SIGHUP, rgtest spawns) | **Yes** | M8's `cargo-build` generalises `scripts/rg-build.ts`; fix them in that batch rather than copy them (D8) |

The other queued items (review nits, `llvm-link` hash pinning, `Triple::normalize` for MSVC, StableHash generator, …) are not on
M8's path; they keep their place in the queue.

## 6. Suites and gates

Each suite is a separately reviewed harness batch (plan-m6 A2). Report until accepted; whatever an accepted gate matches is
protected (plan-m6 A9). Denominators exclude ORACLE_TIMEOUT and UNSTABLE (plan-m7 harness-m7b decision), and, new here, **ENV**:
a case the oracle side does not pass for host reasons (§4c's 27, `requires` a tool the host lacks). **Two mechanisms make "never
protected" mechanical** (re-check N5, D19, in `harness-m8a`): ENV is its own difftest status, which `matchesOfRun` never returns; and
a suite field `neverProtect` makes `gate accept` skip the suite with a note, whatever `--suites` named.

| Suite | Mode | Cases | Oracle cost (measured) | Port estimate | Role |
|---|---|---|---|---|---|
| `cargo-build` | the oracle's `cargo build --features all-static` of cargo `29c5daa1` with every compile on the side's compiler (rg-build's design, `-j1`) | 1 (dev) | 54 s wall at `-j4` (without `all-static`; its OpenSSL build is unmeasured) | **40–50 min at `-j1`** (calls alone 35.6 min), heavy, alone | **M8a** |
| `cargo-build-release` | the same, `--release` | 1 | not measured | about 2× dev | report |
| `cargo-smoke` | the 11 steps of §4b's smoke test (and more as found), run by the port-built `cargo` and by an oracle-built `cargo` from the same source, oracle `rustc`; thread ids masked, `Compiling` lines sorted | ~11 | 3.6 s | 5.9 s (measured) | **M8a** |
| `cargo-testsuite` | an oracle-built testsuite per side, the subject side's `cargo` replaced by the port-built one; outcome per test (D9) | 4,425, minus ENV | 2 × 64 s build (cached), 4.2 GiB kept, + about 12 min run | about 12 min (the binaries under test are native) | report (`neverProtect` until root's revisit after `m8-measure`); if promoted, **≥ 99%** |
| `cargo-testsuite-port` | testsuite and `cargo` both port-built, a third tree | same | | the 210k-line crate's build is measured in wave 41 (D20) | report (`neverProtect`) |
| `cargo-testsuite-rustc` | oracle-built testsuite and cargo, the port as `rustc` | same | | hours; heavy | report (`neverProtect`) |
| `rustfmt-system` | `tests/source/**` through `rustfmt` with a generated `rustfmt.toml` per case, no inherited config (D11); stdout, stderr, exit | 804 (per file of module trees) | 9 s | ~1–2 min | **M8b ≥ 99%** |
| `rustfmt-idem` | `tests/target/**` through `rustfmt --check`, same settings | 1,065 | ~15 s (est.) | ~2 min | **M8b ≥ 99%** |
| `rustfmt-emit` | the emit modes the tests use (`--emit json`, `checkstyle`, `--check` diff, stdin, `--file-lines`) on a fixed set from `tests/writemode`, `tests/rustfmt`, `tests/config` | ~60 | seconds | | **M8b ≥ 95%** |
| rustfmt unit tests | `src/**` `#[test]` ported as `*.test.ts` (PORTING §2), including `src/test/mod.rs`'s `system_tests` and `idempotence_tests` against the **committed** targets | 294 fns | | in the unit step: must fit its budget (D13) | **M8b: all pass or `test.skip` with a recorded reason** |
| `clippy-ui` | `tests/ui` with `compile-test.rs`'s environment and ui_test's per-file defaults (D10); stderr + exit | 1,224 files (+ revisions) | 22 s for 1,019 | ~4–8 min wall | **M8c ≥ 95%** |
| `clippy-ui-lane` | `clippy-ui`'s argv + every lint group allowed + `-W` per `//~` lint, both sides; upstream's late-pass filter selects the sub-passes (§2d); eligible cases only, 5 vacuous ones excluded | grows lane by lane, from the early group on | the same | the same | report, `neverProtect` permanently |
| `clippy-ui-json` | `clippy-ui` with `--error-format=json`: the suggestions behind every `.fixed` | 1,224 | the same | the same | **M8c ≥ 90%**, report before |
| `clippy-ui-toml` | `tests/ui-toml`, `CLIPPY_CONF_DIR` per directory | 130 | seconds | | **M8c ≥ 95%** |
| `clippy-ui-cargo` | `tests/ui-cargo` with the port-built or oracle `cargo-clippy` | 91 | | | report |
| `clippy-dogfood` | clippy-ts on clippy's own crates (`rustc_private`) | 6 crates | | heavy | report |

**Gates** (`scripts/criteria.ts` groups, per plan-m6 A12):
- **M8a, cargo built by the port** (root's "M8 host capacity"): **`cargo-build` MATCH and `cargo-smoke` all MATCH.**
  `cargo-testsuite` stays a report for M8a (root's "M8 cargo testsuite status"); root revisits it after `m8-measure` gives real
  numbers, and promoting it (≥ 99%) is a recorded decision plus a reviewed change of its `neverProtect` field.
- **M8b, rustfmt-ts:** `rustfmt-system` ≥ 99%, `rustfmt-idem` ≥ 99%, `rustfmt-emit` ≥ 95%, unit tests clean.
- **M8c, clippy-ts:** `clippy-ui` ≥ 95%, `clippy-ui-toml` ≥ 95%, `clippy-ui-json` ≥ 90%.
- **M8 = M8a + M8b + M8c.**
- **Report only, `neverProtect` set:** `cargo-build-release`, `cargo-testsuite` (until promoted), `cargo-testsuite-port`,
  `cargo-testsuite-rustc`, `clippy-ui-lane` (always), `clippy-ui-cargo`, `clippy-dogfood`. Clearing the field for a suite other
  than `clippy-ui-lane` is how root promotes it, in a reviewed harness batch.

**Thresholds.** `cargo-testsuite` compares the same test code on the same `rustc` with only `cargo` rebuilt, so every non-flaky
difference is a miscompile: **99%** (review F5), with every case below it named in the gate record. rustfmt's 99% is high for the
same reason: a deterministic, cheap oracle, where any difference is a bug. clippy's 95% follows plan-m7's run-pass bar: its tail
will hold `rustc_*` gaps that clippy reaches and rustc's own lints never did.

**Gate time.** The last gate took 7 h 15 min over 71 suites. The clippy and rustfmt suites add minutes (check-ui's 730 cases took
28 s in the last gate). `cargo-build`'s port side is one heavy case of 40–50 min at `-j1` that must run alone (12,450 MiB on one
compile), with the oracle side cached: **M8a adds about 1 h** to a gate. If `cargo-testsuite` is promoted it adds about 12 min
(both trees cached); `cargo-testsuite-port` would add its build, measured in wave 41, so up to 2 h (review F9).

**Headroom inside a gate** (D20, root's "M8 host headroom"). The gate checks D20's start minimums **immediately before each
D20-covered heavy suite starts** (`cargo-build`, `cargo-build-release`, `cargo-testsuite-port`, `cargo-testsuite-rustc`), not only
at the gate's start, and `cargo-build` runs **first** among the gate's suites, when swap is lowest (a suite field, in
`harness-m8a`). If the check fails, or the watchdog stops a suite, **the gate run fails and nothing is accepted**; it is re-run
once the host meets D20, as a battery spell is treated, never recorded as a lost case. A consequence root should weigh: once
`cargo-build` is protected, every later gate runs it, so every gate needs D20's headroom at its start. On today's host (11–12 GiB
free, 8.5–10.3 GiB of swap at idle) that means a restart before each gate until the owner frees disk. **[owner]**

## 7. Decisions

**D1. [owner] M8 = clippy-ts and rustfmt-ts as line-by-line ports; cargo built by rust-ts, not ported. Amends PLAN.md's M8 row
("cargo-ts").** Recorded by root as "M8 scope" under the owner's standing instruction; it changes what the milestone delivers and
adds crates to `scope.json`, so the owner may overrule it. §1e costs the alternatives: (a′) port cargo with its C behind a seam
(~360–550k more lines, 2.5–3.5 months), and deferring clippy-ts (M8 becomes 1–2 weeks). PLAN.md's row is amended when this plan is
accepted.

**D2. Oracles: the pinned `clippy-preview` and `rustfmt-preview` dist tarballs, unpacked, run on the oracle's own
`librustc_driver`** (review F11). `UPSTREAM.json` gains `tools: { clippy: {url, sha256}, rustfmt: {url, sha256} }` (the manifest's
`xz_url` and `xz_hash`); a setup step downloads, checks and unpacks them into `$RUST_TS_DATA/tools/<sha256>/` (about 20 MB,
instead of about 0.6 GiB for an isolated rustup home). They run by absolute path with `DYLD_LIBRARY_PATH=<oracle sysroot>/lib`.
The guard test checks that the dylib each binary links (`otool -L`) is the oracle's `librustc_driver` file, that the oracle
toolchain still has exactly `UPSTREAM.json`'s components (plan-m6 D1's rule), and the tarballs' hashes; the oracle key includes
them. **Both sides pass the same explicit `--sysroot=<oracle sysroot>`**: a sysroot with `rust-src` (as the Miri home has) prints
real std paths instead of `/rustc/<hash>/…`.

**D3. Sources.** `UPSTREAM.json` `sparse` gains `src/tools/clippy` and `src/tools/rustfmt` (37 MB); cargo is pinned as `{ "repo":
"https://github.com/rust-lang/cargo.git", "commit": "29c5daa1…", "sha256": "a1aaf161…" }`, fetched by a setup script into
`$RUST_TS_DATA/cargo-src` with its `Cargo.lock`'s crates in `$RUST_TS_DATA/cargo-src/cargo-home` (setup is the only networked step,
as `rg-check.ts setup`). In the batch `tools-prep-m8`, which merges before any contract lane (D21).

**D4. Paths and markers, following Miri (plan-m6 D2).** `src/tools/clippy/<crate>/src/<path>.rs` → `src/<crate>/<path>.ts` for
`clippy_lints`, `clippy_utils`, `clippy_config`; `src/tools/clippy/src/driver.rs` → `src/clippy/driver.ts` (an entry like
`src/miri/bin/miri.ts`); `src/tools/rustfmt/src/<path>.rs` → `src/rustfmt/<path>.ts`. Markers `// rustc:
src/tools/clippy/clippy_lints/src/<path>:<line> <name>` and `// rustc: src/tools/rustfmt/src/<path>:…`; coverage.ts counts them as
crates `clippy_lints`, `clippy_utils`, `clippy_config`, `clippy`, `rustfmt` (in `tools-prep-m8`, so `coverage.ts --check` accepts
the contract lanes' markers). `clippy_dev`, `lintcheck`, `clippy_lints_internal`, `clippy_dummy` and rustfmt's `check_diff` are out
(`scope.json`, with D1).

**D5. Macros through `tools/codegen`, never by hand** (PORTING §5), **in two batches that merge before the contracts that use them**
(re-check N6):
- **`codegen-clippy-macros`**, before `clippy-contract-a/-b` integrate: `declare_clippy_lint!` (lint statics + `LintInfo`, with the
  lint docs taken from the source), `declare_lint_pass!`/`impl_lint_pass!` and their `lint_vec()`s (already generated for rustc's
  lints), `combined_{early,late}_lint_pass!` with `early_lint_methods!`/`late_lint_methods!`, clippy's `sym` list,
  `msrv_aliases!`, `define_Conf!`, and two tables §2d needs: sub-pass ↔ lint ↔ implementing files, and lint group ↔ member lints;
- **`codegen-fmt-serde`**, before `rustfmt-contract`'s config lane: rustfmt's `create_config!`, `#[config_type]`
  (config_proc_macro) and the serde derives on config and JSON types (D6).

**D6. serde follows the project's Decodable precedent** (review F10). The reached part of `serde::de` is vendored and ported
(`Error`, `Unexpected`, `Expected`, `value`, and `private::de` where `untagged` or `flatten` is used): the observable error texts
come from the interplay of the derive's visitor, `de::Error::{unknown_field, missing_field, invalid_type}` and `Unexpected`, and
toml's span handling, not from `Display` impls alone. `tools/codegen` emits what `serde_derive` emits for each type, **checked
against the oracle's `-Zunpretty=expanded`** of `clippy_config` and of rustfmt's config types (an exact oracle for the generator).
`clippy_config`'s hand-written `de.rs` visitor over `DeTable` is ported as code. `toml 1.1.x` with `toml_parser`, `toml_datetime`,
`serde_spanned`, `toml_writer` is vendor (`vendor-toml`, the part that parsing a document and its errors reach, about 11k of 19.6k
lines). `serde_json`: only what `--emit json` and `file_lines` reach.

**D7. Vendor at the root `Cargo.lock`'s versions, only what is reached** (PORTING §5b): `diff 0.1.13`, `unicode-segmentation 1.12.0`
(tables from the crate, generated like `tools/gen-unicode.ts`), `ignore 0.4.25` + `globset` (the `ignore` option), `semver 1.0.27`,
`bytecount`, `quine-mc_cluskey 0.2.4`, `regex-syntax 0.8.8`'s parser and error `Display` (clippy's regex lints parse user regexes,
so this cannot be a JS `RegExp`), `url 2.5.7`'s parser (doc lints), `itertools` adaptors where used. **`unicode-width` 0.1.14 is a
second version** beside the vendored 0.2.2: vendored as `src/vendor/unicode_width_0_1/` (their width tables differ). `regex` in
rustfmt (`lib.rs`, `string.rs`, `items.rs`, fixed patterns) may be a `PORT:` `RegExp` per pattern where the semantics provably
agree, as plan-m7 did for `back/link.rs:1295`; otherwise it goes through the vendored `regex-automata`. `term` (colours) stops when
stdout is a tty; the suites run without one. `dirs` goes through `src/std`. `cargo_metadata` and `clap` (only `cargo-fmt`,
`format-diff`, clippy's `cargo` lints) wait for `clippy-ui-cargo`: `unported` until then.

**D8. `cargo-build` generalises `scripts/rg-build.ts`** into one project-build harness (`scripts/cargo-project-build.ts`): ripgrep
and cargo are two configured projects with the same report format, key, lock, sweep and kept-binary rules. The harness-m7d
re-check notes 1–6 are fixed in that batch. `cargo-smoke` runs the port-built cargo and an oracle-built cargo **from the same source
and environment**: the component's version line carries bootstrap's `git-commit-info` suffix, which a tarball build never has
(§4b). `rg-build`'s protected case must stay byte-identical (the batch's proof: re-run `rg-build` and `rg-behaviour` before and
after).

**D9. cargo's testsuite: oracle-built per side, the port-built `cargo` in the subject side's tree, outcome per test, ENV never
protected** (review F5, re-check N3, N5, N8).
- **Configurations:** as §4c. `cargo-testsuite` builds the testsuite once per side with the oracle (the `CARGO_BIN_EXE_cargo` path
  is fixed at compile time), replaces `debug/cargo` in the subject tree with `cargo-build`'s kept port-built binary, and checks
  the hash at each baked path before each run. 4.2 GiB kept; 2 × 64 s to build.
- **Status:** a report for M8a, `neverProtect` set (root's "M8 cargo testsuite status"); root revisits after `m8-measure`.
- **Cases:** test names from `--list`. A test the oracle side does not pass (FAILED, or skipped by `requires`) on two oracle runs gets
  the difftest status **ENV**, which `matchesOfRun` never returns: out of the denominator, never protected, listed with its
  reason. `CFG_DISABLE_CROSS_TESTS=1` turns the 21 cross tests into skips on both sides. A test whose outcome differs between
  oracle runs is UNSTABLE, as harness-m7b did.
- **Environment:** `PATH` is built, not inherited: the oracle toolchain's own `bin` (not the rustup proxy) first, then
  `/usr/bin:/bin` (for `git`, and `perl`/`make` for `all-static`'s OpenSSL build); no `~/.cargo/bin`, so external `cargo-*`
  subcommands cannot leak in (three of the 27 failures came from them). `HOME` and `CARGO_HOME` point into the run's sandbox.
- **Concurrency and disk:** module by module with libtest's `--test-threads=6`, each module's sandbox (`target/tmp/cit`) deleted
  after it (it grows about 0.3 GiB per 200 tests); the run refuses to start below the free-disk minimum (D20).

**D10. clippy's suites compare against the oracle's `clippy-driver` with upstream's settings, raw** (review F3). The harness
reproduces `compile-test.rs`'s environment and ui_test's per-file defaults: `CLIPPY_CONF_DIR=tests` for ui (the per-directory value
for ui-toml), `RUSTC_ICE=0`, `--crate-type=lib` when the file has no `fn main`, `-Ldependency`/`--extern` for `clippy_test_deps`
(built once by the oracle's cargo into `$RUST_TS_DATA/clippy-test-deps`), pm-ui's path for proc-macro aux (oracle-built host dylibs,
plan-m6 D7), `harness/compiletest.ts`'s directive parsing, and each test's own `//@normalize-stderr-test` applied to both sides
(they exist for nondeterminism: `custom_ice_message.rs` prints the version, target, flags and a rustc source location). It does not
apply ui_test's presentation normalisations: both sides render the same way. **Proof in `harness-m8d`:** with ui_test's empty-`|`
and `//~` normalisations applied to the oracle's output, the emulation reproduces the committed `.stderr` for every runnable case but
a named list (measured here: all of the 1,019 runnable cases but 14, §2b). The proof states separately that 141 of its matches
are files with no `.stderr` whose expected output is empty (re-check N9).

**D11. rustfmt's suites run with the default config plus the significant comments, as `src/test/mod.rs` does** (review F3). Each
case runs from a scratch directory with no `rustfmt.toml` above it, with `HOME` and `XDG_CONFIG_HOME` pointing at an empty
directory, and with the significant comments written into a generated `rustfmt.toml` passed by `--config-path` (TOML carries the
array-valued options the CLI's `--config` cannot); a `config` comment's file is merged into it. Module-tree sources are compared per
emitted file. The CLI suites compare port and oracle (stdout, stderr, exit); `src/test/mod.rs` is also ported as a unit test
(`system_tests`, `idempotence_tests` against the committed targets). **Proof in `harness-m8b`:** the emulation reproduces at least
the 748 targets measured here, with each remaining class named.

**D12. Startup: separate entries, lazy loading.** `src/clippy/driver.ts` and `src/rustfmt/bin/main.ts` are their own entry points
(subject binaries in `BINARY_ENTRIES`, harness batch), so no existing suite loads them; clippy's lint modules load when
`register_lints` runs.

**D13. Unit-step budget.** Each lane adds ≤ 10 s of unit-test wall (plan-m7's rule was 15 s with 9 minutes left; the step has
grown). rustfmt's ported `system_tests` and `idempotence_tests` are about 1,870 formatting runs in one process: measure them first,
and if they exceed the budget, run them as a suite (`rustfmt-upstream-tests`) instead of in the unit step.

**D14. Contract-first, with clippy's lane-by-lane measurement settled by the pass structure** (review F1, re-check N1).
✱`clippy-contract-a` (driver, `declare_clippy_lint`, `clippy_lints/src/lib.rs` with `register_lint_passes`, `declared_lints.rs`,
`deprecated_lints.rs`, `combined_early_pass.rs`, `combined_late_pass.rs`), ✱`clippy-contract-b` (`clippy_config`, the core of
`clippy_utils`), the ✱dispatch contracts (each directory's `mod.rs`, §2c) and ✱`rustfmt-contract` merge before their fill lanes,
after the codegen batch each needs (D5). Stub sub-pass bodies call `unported`, as everywhere. **The early group** (§2c) is the first
clippy porting after the contracts, because early sub-passes always run. Then `clippy-ui-lane` counts lane by lane through
upstream's own late-pass filter (§2d), with nothing added to the port. `clippy-ui` is expected to read about 0 until the early
group and every late sub-pass with a default-on lint have landed.

**D15. cargo's stops are fixed in the port, never worked around in the harness; the build's C inputs are pinned by configuration**
(review F7). §4b's stops are port bugs and go to fixer lanes. The harness sets what rg-build sets (`CARGO_INCREMENTAL=0`, no
`CARGO_*` from the caller, `-j1`) and, on both sides, **`--features all-static`**, cargo's own distribution configuration
(vendored OpenSSL and libgit2, the OS's libcurl on Apple), plus a built `PATH` without `pkg-config` or Homebrew's `curl-config`. This
is configuration, not a source edit. **And a recorded check:** the report includes each `-sys` crate's build-script output (link
lines and `DEP_*` metadata, as rg-build already byte-compares build-script outputs) and `otool -L` of the built `cargo`, so a host
change that still leaks in shows as a named DIFF on both sides' rebuild, never as a silent flip; rg-build's `hostToolsId` (cc, ld,
SDK, OS) is in the key. `all-static`'s OpenSSL build (`openssl-src`, C via `make`) has not been timed: `harness-m8a` measures it on
the oracle first.

**D16. `-C incremental` stays out of M8's gates** (root's decision "plan-m8 D16"; not the owner's, since keeping
`rustc_incremental` out is `scope.json`'s status quo, plan-m7 D11). cargo's test setup sets `CARGO_INCREMENTAL=0` for every test
(§4c); the few dozen tests that turn it back on are expected UNPORTED in `cargo-testsuite-rustc`. M9's plan revisits it if the owner
wants a drop-in `rustc` for cargo's default profiles.

**D17. Process and memory.** One heavy build at a time (`cargo-build`, the test-crate measurement, `rg-build`); the port's largest
compiles in cargo's graph are the `cargo` crate at 12,450 MiB, `objc2-foundation` 6,267 MiB and `gix` 6,045 MiB (§4b), so `-j1` in
the suite and nothing else heavy running. Disk: `cargo-build`'s target tree is about 2–3 GiB per side and is deleted after its
report, as rg-build's, keeping only the binary.

**D18. Harness and porting never mix (plan-m6 A2).** `harness-m8*`, `tools-prep-m8` and the codegen batches own `harness/`,
`scripts/` and `tools/`; porting lanes own `src/clippy*`, `src/rustfmt`, `src/vendor/*`. No exception: the lane measurement needs
no code under `src/` (§2d). If a later lane proposes any lane-only switch in the port, it is a separate subject entry that no gated
suite runs, or it is refused by `gateEnvRefusal`, nulled in every gated suite's case environment and unit-tested, in a reviewed
harness batch (re-check N2).

**D19. "Never protected" is mechanical** (re-check N5; in `harness-m8a`'s scope). `harness/suites.ts` gains a `Suite` field,
`neverProtect`: `gate accept` skips such a suite's matches with a note, whatever `--suites` named, and a unit test pins it. It is set
permanently on `clippy-ui-lane`, and on the report suites of §6 until a recorded decision clears it in a reviewed batch. ENV is a
difftest status of its own (D9) that `matchesOfRun` never returns. `clippy-ui-lane` may be retired once `clippy-ui` passes its
threshold.

**D20. Host headroom for heavy builds** (review F2, re-check N4; root's "M8 host capacity" and "M8 host headroom"). The minimums
stand. Every run of the port's cargo build, of `m8-measure` and of a D20-covered heavy suite in a gate needs:
- **before it starts:** AC power, no `GATE_RUNNING` (unless it is the gate), **at least 20 GiB free on the data volume, and swap
  used under 4 GiB**. Today the host idles at 11–12 GiB free and 8.5–10.3 GiB of swap; a restart returns the swap files' space
  (about 10 GiB, giving about 21.8 GiB by the re-check's count), and root has asked the owner to free 20–30 GiB;
- **while it runs, a watchdog** (a small script beside the build, polling every 5 s) that kills the build's process group (by its
  own pid, never `pkill`) when free disk falls under 4 GiB or `kern.memorystatus_vm_pressure_level` reaches critical (4) for 60 s.
  For `m8-measure`, which runs before `harness-m8a` lands, the watchdog is a root scratch script under
  `$RUST_TS_DATA/tmp/m8-measure/`; from `harness-m8a` on it is part of the project-build harness;
- **in a gate:** the check runs **immediately before each D20-covered heavy suite starts** (`cargo-build`, `cargo-build-release`,
  `cargo-testsuite-port`, `cargo-testsuite-rustc`), beside the battery check at the gate's start (`scripts/lib/host-state.ts`);
  `cargo-build` runs first among the gate's suites. **A failed check or a watchdog stop fails the gate run: nothing is accepted**,
  and the run is repeated once the host meets D20. It is never recorded as a lost case. The gate record names which. All of this is
  a scripts change in `harness-m8a`'s reviewed batch.

**D21. Wave-41 ordering** (review F8, re-check N4, N6). `tools-prep-m8` (D3's sparse change, D4's coverage.ts crates,
`scope.json` per D1) merges before any contract lane integrates, because `coverage.ts --check` (a gate step) rejects markers into
trees that are not checked out. The codegen batches merge before the contracts that use them (D5). The rest of `harness-m8a` (D2,
D8, D15, D19, D20, `cargo-build`, `cargo-smoke`) is a second batch whose code and review proceed now; its `cargo-build` proof runs
wait on D20. Each step of §8's wave 41 is marked **now** or **waits on host**.

**D22. `cargo-fix-a` is proved per crate now, end to end later.** Its intrinsic signatures are proved by compiling `crc32fast`,
`sha1` and `sha2` alone through the port (small compiles, outside D20), against the oracle's IR; the end-to-end check through
`cargo-build` waits on D20 with the other heavy runs.

## 8. Waves and lanes

Lanes ≤ about 3k upstream lines; ✱ = contract-first, merges before its dependants. Start 5–6 heavy lanes at a time (memory: wave
38's 11 lanes drove load to 100–300). Wave numbers continue from M7's 40t.

**Wave 41: setup, cargo first light, the test-crate measurement, contracts (→ M8a measurable).** Each step is marked **now** (it
can start today) or **waits on host** (it needs D20's headroom: a restart or freed disk), per root's "M8 host headroom".
1. **now** — `tools-prep-m8` (scripts batch, merges first): D3 sources (sparse, cargo tarball, `CARGO_HOME`), D4 coverage.ts crates,
   `scope.json` entries (D1).
2. **now** — `codegen-clippy-macros` and `codegen-fmt-serde` (tools batches, D5, D6), with the `-Zunpretty=expanded` check and §2d's
   two tables; each merges before the contracts that use it (re-check N6).
3. **now** — ✱`clippy-contract-a` (2,718 lines, with the combined-pass files), ✱`clippy-contract-b` (~3.9k, two chained lanes),
   ✱`rustfmt-contract` (7.4k, three chained lanes), after steps 1 and 2.
4. **now** — `cargo-fix-a` code: the three aarch64 intrinsic signatures (`crc32b`, `crypto.sha1h`, `crypto.sha256h`, from
   `IntrinsicsAArch64.td` pinned in the LLVM manifest), proved by compiling `crc32fast`, `sha1` and `sha2` alone (D22). About 1 day.
   **Waits on host:** its end-to-end check through `cargo-build`, and any further signature that run reaches.
5. **now** — `harness-m8a` code and review (harness batch): D2 tool oracles and guard, D8 project-build harness with the m7d notes,
   D15 (`all-static`, built `PATH`, recorded build-script outputs), D19 (`neverProtect`, the ENV status), D20 (per-suite headroom
   check, `cargo-build` first, the watchdog, a failed check or watchdog stop fails the run), `cargo-build` and `cargo-smoke`
   (report), and its `rg-build`/`rg-behaviour` before-and-after proof (rg-build is outside D20). **Waits on host:** its proof run
   of `cargo-build` on both sides, and `all-static`'s first oracle build.
6. **waits on host** — `m8-measure` (root-run, alone, D20's preconditions, the scratch watchdog): the port's build of cargo's
   210k-line test crate. Dependencies from the oracle (a wrapper that sends only `--crate-name testsuite`, and then `cargo`, to the
   port; mixing is sound, plan-m7 §3), so only the crate in question is the port's. First `cargo check --tests` (front end only),
   then `cargo test --no-run`; the same split for the `cargo` crate. It answers whether `cargo-testsuite-port` can run here, where a
   memory lane would aim (front end or codegen and the IR model), and gives root the numbers for "M8 cargo testsuite status". If
   the watchdog stops it, that is the answer, recorded.
7. **waits on host** — every `cargo-build` run (the M8a gate's first one included).

**Wave 42: dispatch contracts, the early group, rustfmt fill, clippy_utils, vendors, the clippy suites (→ M8b; clippy measurable).
All now**, except `harness-m8c`'s runs.
- ✱`dispatch-methods-a`/`-b` (`methods/mod.rs`, 6,229), ✱`dispatch-a` … `-e` (the other directories' `mod.rs`, ~10.4k).
- **`clippy-early-a` … `-e`** (§2c: the 49 early modules and `cognitive_complexity`, ≤ 14.6k), the first clippy porting after the
  contracts: `clippy-ui-lane` counts from here on (§2d).
- rustfmt: 13 fill lanes from §3c (with the bins and `src/test/*`).
- `clippy-utils-a` … `-f` (~17k left of `clippy_utils`).
- `vendor-toml` (~11k reached, two lanes), `vendor-serde-de` (D6), `vendor-fmt-small` (`diff`, `unicode-segmentation`, `semver`,
  `bytecount`, `unicode-width 0.1`), `vendor-ignore` (`ignore` + `globset`, reached part).
- `harness-m8b`: `rustfmt-system`, `rustfmt-idem`, `rustfmt-emit` (report), D11's settings and proof, the rustfmt subject entry
  (D12).
- **`harness-m8d`: `clippy-ui`, `clippy-ui-lane` (`neverProtect`), `clippy-ui-json`, `clippy-ui-toml` (report), `clippy_test_deps`
  setup, D10's settings and proof, §2d's eligibility and vacuous-case list, the clippy subject entry. It merges before the first
  late lint lane.**
- `harness-m8c` code: `cargo-testsuite` (D9, the two oracle-built trees, `neverProtect`), and `cargo-testsuite-port` if
  `m8-measure` says it can run. **Waits on host:** its runs, which need `cargo-build`'s kept binary.
- Fixers from `rustfmt-system` first differences, and from `cargo-build` once it runs.

**Waves 43–45: clippy's late lints (→ M8c). Now** (as soon as wave 42's prerequisites land).
- `methods-a` … `-f` (15.9k) **together** (the `Methods` sub-pass holds 164 lints, so none of its cases is eligible until the last
  of these lands, §2d point 5), `matches-a`/`-b`, `loops-a`/`-b`, `operators-a`, `casts-a` (17.0k in all), the other directories'
  late files, 25 lanes for the top-level files (alphabetical blocks of ~3k). Each lane's review reports the `clippy-ui-lane` cases
  it made eligible and their matches.
- `vendor-regex-syntax` (the parser, errors), `vendor-url` (parser), `vendor-quine`.
- After the first 3–5 late lint lanes, §9's `rustc-for-clippy` trigger is evaluated on `clippy-ui-lane`.
- Fixers per suite.

**Wave 46: tail and reports**
- Fixers on the three gates' tails; `clippy-ui-cargo`, `clippy-dogfood`, `cargo-testsuite-rustc` and `cargo-build-release` as
  reports; `cargo-testsuite` promoted to M8a's gate if root decides so after `m8-measure`.

**What it adds up to.** clippy ~157k + rustfmt ~38k + vendor ~25k = **about 220k upstream lines**, against M7's 52k + 9k vendor.
About **73 porting lanes** (57 clippy, 16 rustfmt) + about 9 vendor lanes + 1–2 cargo fixer lanes, **plus perhaps 25 fixers, 10
harness and tools batches and one root-run measurement**, each lane and batch with an independent review.

## 9. Risks, cost, and what would change the plan

**Cost, honestly.** M7 was planned at about 37 lanes and 7–12 days, and took 10 days (2026-11-05 to 2026-11-15) with about 11
gates. M8 is about **2.5–3× M7's porting** (220k against 61k lines, ~82 lanes against ~37), but most of it is clippy's lints: many
small, independent files that call a compiler which is already ported, rather than new infrastructure. I expect **3–5 weeks**, at
5–6 heavy lanes in flight and a gate every 1–2 days, so 15–25 gates of 8–9 h (M8a adds about 1 h): the gate itself is the floor. In
tokens, about 115 agents at ≤ 500k and about 95 reviews at about 300k: **order of 80–120 M tokens**. Extrapolated, with wide error;
I measured no dollars. **M8a alone** is 3–5 days of work and 2–3 gates (`tools-prep-m8`, `cargo-fix-a`, `harness-m8a`, the
measurement), **counted from the day the host first meets D20**: its code proceeds now, but `m8-measure`, `cargo-build` and M8a's
gate wait for a restart or for the owner to free disk, and once `cargo-build` is protected every gate needs that headroom at its
start (§6). The porting waves for M8b and M8c do not wait. The alternatives are costed in §1e.

**Risks.**
- **Host capacity (D20).** The host idles at 11–12 GiB free and 8.5–10.3 GiB of swap; the `cargo` crate's compile alone took swap
  up by about 6 GiB and free disk down to 4.5 GiB. A restart gives about 21.8 GiB free, under 2 GiB above the bar. Every heavy step waits for headroom, and the watchdog makes an overrun a recorded
  stop instead of a stalled host. If headroom cannot be had, M8a's heavy steps wait; the porting waves do not depend on them.
- **The port's memory on cargo's testsuite crate.** 210k lines in one crate, twice the `cargo` crate's 12,450 MiB. It may not build
  on 24 GiB. It no longer blocks M8a (D9: the protected configuration uses the oracle-built testsuite), and wave 41 measures which
  phase is at fault.
- **clippy's reach into rustc's unported corners.** clippy calls internal APIs that rustc's own lints never needed (`rustc_middle`
  is 256 fns short, `rustc_interface` 31, `rustc_driver_impl` 9; clippy uses `rustc_hir_typeck`'s `expr_use_visitor`,
  `rustc_mir_dataflow` analyses and `rustc_const_eval`'s const evaluation from lints). Each becomes a stop that a clippy lane cannot
  fix (it owns only clippy files): fixers in `rustc_*` crates run beside the lint lanes, steered by `clippy-ui-lane`.
- **`clippy-ui-lane`'s approximation (§2d).** It can match where `clippy-ui` later fails, through state shared between late
  sub-passes, and it measures a multi-lint sub-pass only whole (`Methods`: 164 lints). That is why it is `neverProtect`; a
  difference from `clippy-ui` names the shared state.
- **The early group gates all of clippy's measurement** (§2d point 3): ≤ 14.6k lines in five lanes before any late lint is
  measurable. If those lanes stall in `rustc_*` gaps, the `rustc-for-clippy` fixers start there.
- **The lint docs.** 28.6k comment lines in `declare_clippy_lint!` are lint documentation (`clippy --explain`, the lint list).
  Porting them as comments is cheap; generating `LintInfo`'s doc text (D5) must take them from the source, not a lane.
- **serde and toml exactness (D6).** `clippy.toml` and `rustfmt.toml` errors print serde/toml messages with spans. Following the
  Decodable precedent and checking codegen against `-Zunpretty=expanded` removes most of the risk; `clippy-ui-toml` and
  `tests/config` check the rest.
- **Host C libraries (D15).** `all-static` removes Homebrew OpenSSL and the accidental libgit2 choice from the build; the OS's
  libcurl and SDK zlib remain, keyed by `hostToolsId`. `all-static`'s OpenSSL build time is unmeasured.
- **Unit-step budget (D13).** rustfmt's own test driver is about 1,870 format runs; it may have to be a suite.
- **cargo's testsuite flakiness.** One oracle run found no flaky test, but it is a large integration testsuite with timing and
  process tests; the UNSTABLE list must come from repeated oracle runs (D9), and a racy protected case is withdrawn by the
  established process.
- **The pinned cargo's tests assume its own repository layout** (`CARGO_MANIFEST_DIR`, `tests/testsuite/**/in`, snapbox snapshot
  files in source). They run from the unpacked tarball; nothing is edited.

What would change the plan:
- Wave 41's measurement shows the port cannot build the 210k-line test crate within D20's limits: `cargo-testsuite-port` stays a
  report, and a front-end (or codegen) memory lane is queued; M8a is unaffected (D9).
- Over the first 3–5 late lint lanes, most of the cases they make eligible in **`clippy-ui-lane`** stop in `rustc_*` code rather
  than in clippy's: a `rustc-for-clippy` fixer wave goes before the remaining lint lanes.
- The owner overrules D1: to (a′) (§1e: plan a cargo port as its own milestone, reusing D9's oracle-built testsuite), or by
  deferring clippy-ts (M8 = M8a + M8b, 1–2 weeks).
- `m8-measure`'s numbers: root revisits `cargo-testsuite`'s status ("M8 cargo testsuite status"); promoted, it joins M8a at ≥ 99%.
- The owner frees 20–30 GiB: the restart before each gate is no longer needed (§6).

## 10. What I could not check

- **The port's build of cargo's testsuite crate**, on any configuration: it is wave 41's measurement. The oracle's build (64 s) and
  run (4,425 tests in about 12 min, 27 host failures) were measured. Flaky tests: one oracle run only, so none identified.
  `cargo-testsuite-rustc` was not tried.
- **Which phase took the `cargo` crate's 12,450 MiB** (front end or codegen and the IR model).
- **`--features all-static`** on either side: not built; its OpenSSL build time is unknown. §4a's table is read from the build
  scripts, not from a build's link lines.
- **The port's release build of cargo**: not tried. The dev build's rmeta and object bytes, and its per-crate stderr, were **not**
  compared with the oracle's (I deleted the oracle's tree for disk before the port's build finished); only the resulting binary's
  behaviour was. The binary is the mixed one: three small crates were the oracle's.
- **The smoke test's ripgrep step** used `$RUST_TS_DATA/ripgrep/cargo` as `CARGO_HOME` (offline, locked, read-only use, as check-rg
  does) and a copy of ripgrep's source; its target went to scratch.
- **(a′)'s reach** (§1e): every package is assigned to a row by name, and the rows sum to the graph; what each row reaches is
  estimated from its role, not traced through the code.
- **clippy or rustfmt built by rust-ts against `rustc-dev`** (scope (b) for them): not tried.
- **§2d in practice**: measured on the oracle only (the `-W` table). I did not check, sub-pass by sub-pass, which late sub-passes
  read another's state, nor run the port's `skippable_lints` on these files (the early group is not ported yet).
- **The early group's exact size**: ≤ 14.6k counts the mixed directories `attrs`, `doc`, `functions`, `misc_early` whole.
- **Whether a restart returns the swap files' space** on this host, and for how long the headroom lasts.
- **ui_test's normalisations** were reproduced only as far as §2b's classifier; 33 rustfmt differences were not classified.
- **Line counts for vendor crates** are from versions in cargo's lock where the root lock's differ slightly (`toml` 1.1.5 vs 1.1.0,
  `regex-syntax` 0.8.11 vs 0.8.8); and which parts are reached is estimated, not traced.
- **Fn counts** for clippy and rustfmt are a regex over `fn` lines, not coverage.ts.
- **Windows**: not considered (AGENTS.md §5: kept where cheap, unchecked).

Kept in `$RUST_TS_DATA/tmp/plan-m8/`: `scripts/`, `bin/`, the `*.jsonl` and `*.txt` results, `port-log/`,
`port-build{,2}.{out,err}`, `oracle-build.err`, `tst-build.err`, cargo's tarball and the channel manifest (`dl/`). Removed: the build
and test trees, the unpacked components, sources and `cargo-home`, the component tarballs.

## 11. Changes in the revisions (review plan-m8, re-check plan-m8-recheck)

| Finding | Where |
|---|---|
| F1 clippy measured lane by lane | §2d (design), D14, D19, §6 `clippy-ui-lane`, §8 (`harness-m8d` before the first lint lane), §9 trigger |
| F2 host capacity; test-crate measurement in wave 41; M8a restated | D20, §8 wave 41 step 2, §6 gates (M8a = `cargo-build` + `cargo-smoke`), §9 |
| F3 upstream's test settings; counts 401/452 and 748 | §2b, §3b, D10, D11 |
| F4 (a′) and deferring clippy costed | §1e, D1 |
| F5 ENV cases, oracle-built testsuite against the port-built `cargo`, 99% | §4c, D9, §6 |
| F6 incremental | §4c, §5, D16 |
| F7 Homebrew OpenSSL, libgit2, curl | §4a, D15 |
| F8 `tools-prep-m8` first; `methods/mod.rs` and the other dispatch files as contracts | D21, §2c, §8 |
| F9 `-j1` estimate, MiB, `rustc_interface` | §4b, §6 gate time, units throughout, §0 |
| F10 serde through `serde::de` + codegen checked against `-Zunpretty=expanded` | D6 |
| F11 D2 simplified; one explicit `--sysroot` | D2 |
| N1 the pin's combined early/late passes; no glue; `-W` per `//~` lint restored (57 → 5 empty cases) | §0, §2a, §2c (early group, combined-pass files), §2d, D5, D14, §8 wave 42 |
| N2 a lane-only switch reaching a gated suite | §2d (no switch exists), D18 (what any later switch must do) |
| N3 the testsuite built once per side; the baked path checked by hash; 4.2 GiB | §4c, D9, §6 |
| N4 D20's minimums stand; per-heavy-suite check; `cargo-build` first; a watchdog stop fails the gate; steps marked now / waits on host | §6 headroom, D20, D21, D22, §8 wave 41, §9 |
| N5 `neverProtect` and the ENV status | §6, D9, D19, `harness-m8a` (§8 step 5) |
| N6 codegen before the contracts it feeds | D5 (two batches), D21, §8 wave 41 step 2 |
| N7 every dependency package assigned; (a′) now 360–550k | §1e, D1, §0 |
| N8 the testsuite stays a report for M8a, revisited after `m8-measure` | §4c, §6, D9, §9 |
| N9 units (MiB/GiB), the 143 files without `.stderr`, group names in attributes | header, §2b, D10, §2d point 4 |

Critical files: src/tools/clippy/{src/driver.rs, clippy_lints/src/lib.rs, clippy_lints/src/methods/mod.rs, clippy_utils/src/{lib.rs,
diagnostics.rs, sym.rs}, clippy_config/src/{conf.rs, de.rs}, tests/compile-test.rs}, src/tools/rustfmt/src/{lib.rs, config/mod.rs,
config/config_type.rs, visitor.rs, items.rs, test/mod.rs}, cargo `tests/testsuite/main.rs`, `tests/testsuite/utils/mod.rs`,
`crates/cargo-test-support/src/lib.rs`, compiler/rustc_driver_impl/src/lib.rs, compiler/rustc_lint/src/{context.rs, late.rs,
early.rs}, scripts/rg-build.ts, scripts/lib/host-state.ts, harness/compiletest.ts, harness/suites.ts.

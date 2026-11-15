verdict: APPROVE WITH CHANGES

Subject: plan-m8 (`docs/plan-m8.md`, `docs/handoff/plan-m8.md`, branch `t3/plan-m8-research`, commit `d36cdc8e`).
Reviewed against AGENTS.md, PORTING.md, PLAN.md §1–§5, `docs/plan-m7.md` and its review, the pinned upstream (clippy and rustfmt
trees from the local partial clone, no fetch), cargo's pinned tarball (the plan's own copy, SHA-256 checked), the plan's kept
measurements in `$RUST_TS_DATA/tmp/plan-m8/`, and the 2026-10-11 clippy and rustfmt components, which I downloaded into my scratch
directory (hashes equal to the manifest's) and ran by absolute path. I am read-only: this file is all I wrote to the tree. I ran
no gate, no suite and no port build. No oracle component was added or removed. My result files are in
`$RUST_TS_DATA/tmp/review-plan-m8/` (`a/b.jsonl`: clippy ui as measured and with `CLIPPY_CONF_DIR=tests`; `fa/fb.jsonl`: rustfmt
system tests with and without rustfmt's own `rustfmt.toml`). AC power; load 1.6–3.4.

The plan is well measured and the direction is right: clippy and rustfmt as line-by-line ports on the already-ported crates, M8a
first because it is cheap and measurable, oracles from the pin's own components. Almost every number I spot-checked is exact. What
must change before lanes start:

- **D14's contract would make `clippy-ui` 0% until the last lint lane lands (F1).** clippy runs every registered pass on every
  crate, so one `unported` pass body stops every ui test. The plan's "measurable lane by lane" does not hold.
- **The host cannot take M8a's heavy builds as it stands (F2).** Swap is at 10.7 of 12 GB with the machine idle, and 10 GiB of disk
  is free. The plan's own `cargo` compile grew swap by about 6 GB and left 4.5 GiB free. The 210k-line test crate is twice that,
  and it is measured in wave 42 "alone on the host" while wave 42 runs about 20 lanes.
- **Both CLI emulations read the projects' own dogfood config (F3).** I reproduced the plan's 391 and 717 exactly. With upstream's
  settings they are 401 and 748, and 91 clippy files never reach a lint. D10 and D11 still stand, but the harness has to copy what
  `compile-test.rs` and `src/test/mod.rs` set.
- **D1 needs the owner, and the plan should show the owner a fairer option (a) for cargo (F4).**

## What I checked

| Claim | How | Result |
|---|---|---|
| clippy 157,003 lines; 745 files in `clippy_lints/src`; 835 lints; ~4.4k fns | `git archive` from the local blobs (none missing, no fetch), `wc -l`, `grep` | **Exact.** 133,587 + 19,786 + 2,579 + 554 + 279 + 218 = 157,003; 835 `declare_clippy_lint!`; 4,392 `fn` lines in the three crates |
| rustfmt 37,535 in `src` (+ 499 macro), `src/test` 1,762, 294 `#[test]`, 804 sources, 1,065 targets | the same | **Exact** |
| clippy `tests/ui` 1,224 non-aux `.rs`, 1,091 `.stderr`, 642 `.fixed`, `ui-toml` 130 | `find` | **Exact** |
| The `rustc_*` crates clippy and rustfmt import are ported | `extern crate` lines vs `bun scripts/coverage.ts` | **True: 31 crates** (28 for clippy, among them `rustc_structures` 29/29 and `rustc_arena`, which is erased; rustfmt adds `expand`, `feature`, `parse`). One wording fix: "all at or above 88% except `rustc_data_structures` and `rustc_target`" is wrong for `rustc_interface` at **59/90 (65.6%)**, which the plan lists elsewhere. The gaps I looked at are backend loading and parallel infrastructure (`util.rs` `load_backend_from_dylib`, `rustc_path`, `get_codegen_sysroot`), not on clippy's path |
| cargo graph: 317 packages, 2,134,831 lines, 9 `-sys` crates | the plan's `cargo-tree.txt` and `cargo-deps-lines.txt` | **Exact** (317 unique packages; 309 registry crates sum to 2,134,831; the 9 `-sys` names). The 12 proc macros are all in the list |
| cargo `src/` 107,831; testsuite 994 files, 209,863 lines, 4,454 `#[cargo_test]` | the tarball (SHA-256 `a1aaf161…`, equal to D3's) | **Exact** |
| 389 of 392 calls exit 0; 3 stops on aarch64 intrinsic signatures; 1,362 s wall | `port-log/*.exit` up to `port-build.end`'s mtime; the three `.stderr` | **Exact.** The log has 432 calls in all, because build 2 added 40 |
| `cargo` crate: 424 s user, "12.45 GB" | `port-log/*.cargo.time` | **The unit is wrong.** Max RSS is 13,054,820,352 bytes: 12,450 MiB, which is 12.16 GiB or **13.05 GB**. The plan's "GB" figures are MiB/1000 throughout (`gix` 6.68e9 B, …). This is low severity, but the memory argument is understated by about 5% |
| Testsuite on the oracle: 4,425 listed, 27 unique failures | `tst-all.txt`, `tst-fail-unique.txt` | **Exact** |
| `clippy-preview` and `rustfmt-preview` exist at the pin and run on the oracle's `librustc_driver` | manifest `git_commit_hash`, `xz_hash`; `otool -L` | **True.** Both carry `6f5da406b…`. `clippy-driver` links `@rpath/librustc_driver-3bee00c5d9e363a9.dylib`, the oracle's file name. I ran both from scratch with `DYLD_LIBRARY_PATH=<oracle>/lib`. Nothing was installed |
| clippy ui: 1,019 runnable, 27 s, 391 match the committed `.stderr`, exit 1 on 882 | re-ran the plan's `clippy-ui.ts` | **Reproduced exactly** (391; 882 / 136). But see F3 for what the 391 measures |
| rustfmt: 717 of 802 equal their target, exit 1 on 68 | re-ran the plan's `rustfmt-sys.ts` | **Reproduced exactly** (717; 735 / 68). But see F3 |
| `-j1` `cargo-build` at "about 25–35 min" | sum of per-call wall over build 1 | **Low.** The calls alone sum to 2,139 s (35.6 min), before build scripts' C compiles and the final link (F9) |

## Findings

### F1. HIGH, blocking for the clippy waves: D14's stub contract makes `clippy-ui` all-UNPORTED until every lint lane lands

D14 says: "A clippy lint lane that ports a lint's file flips that lint's ui tests from UNPORTED, so the contract registers every lint
with an `unported` pass body." That is not how clippy runs. `register_lint_passes` registers about 400 early and late passes, and
`rustc_lint` runs **every registered pass** on every crate. Lint levels are checked when a lint is emitted, and only some passes
check `is_lint_allowed` early. A ui test for lint X therefore also runs all the other passes' `check_expr`, `check_item`, ….
Any stub whose body is `unported` stops the test with exit 70. And because `-Dwarnings` is on, each expected `.stderr` also
depends on every default-on lint that does *not* fire.

So under D14 as written, `clippy-ui`, `clippy-ui-json` and `clippy-ui-toml` stay at 0 until the last of about 57 lanes merges.
§0's "measurable from its first lint lane on", §8's "a 0% baseline that each lane moves" and §9's escape hatch ("clippy's first
lint lanes find that most ui tests stop in `rustc_*` code") all assume otherwise. The `rustc-for-clippy` signal arrives last, not
first. rustfmt has a milder form of the same problem: nearly every source file goes through `visitor`, `items`, `expr`, `lists`
and `comment`, so `rustfmt-system` moves only after most of its 16 lanes. That is acceptable at that size, but the plan should say it.

**Amend D14 and §8 with a measurement that works lane by lane, and decide it now.** The option I recommend: a report-only suite,
`clippy-ui-lane`. For each ui file, both sides run with `-A clippy::all -A clippy::pedantic … -W clippy::<the lints the file
annotates with //~>`, and a rust-ts-only driver option (glue in `src/rust_ts/`, not ported code) registers only the passes that are
ported. Unregistered passes are not a guessed value, because their lints are allowed on both sides. The suite is approximate in
known ways: `#[expect]` fulfilment, and passes with side effects such as msrv attribute tracking. So it is never protected. The
gated `clippy-ui` keeps full fidelity. Alternatively, pass stubs could stop only when a lint they own is not allowed. Either way,
it is a harness and driver design question that must be settled before `clippy-contract-a`, because the contract decides what the
stubs do. Also reorder §9's "what would change the plan" trigger so it is evaluated on `clippy-ui-lane`.

### F2. HIGH, blocking for M8a's heavy steps: host capacity, and the 210k-line measurement is scheduled where it cannot run alone

- **Now:** `vm.swapusage` shows 10,685 MB of 12,288 MB used **with the host idle**, load about 2. The data volume has 10 GiB free
  (98% used). `hw.memsize` is 24 GiB.
- **The plan's own build:** swap grew from 6.9 to 13 GB, and free disk fell from 11 to 4.5 GiB, during one 13.05 GB compile
  (§4b). macOS swap files live on that volume. A compile of twice the source size, the 210k-line testsuite crate, from today's
  starting point would very likely exhaust the disk. That is not a failed measurement: it is a stalled or rebooted host, and
  memory notes say reboots have happened under load before. §9's disk budget lists target trees, toolchain and crates, but **not
  swap growth**, which is the largest item.
- **Ordering:** D9 and §8 put the port's build of the test crate in `harness-m8c`, wave 42, "alone on the host". Wave 42 is 13
  rustfmt lanes, 6 `clippy-utils` lanes, 4 vendor lanes, two harness batches and fixers. It cannot be alone there. That measurement
  decides whether M8a needs a memory lane, and what M8a's gate is (D9's fallback). It should come first, not in the middle.

**Amend:**
1. Make "host headroom" an explicit precondition of `cargo-fix-a`'s end-to-end check, `harness-m8a`'s `cargo-build` and the
   test-crate measurement. I suggest at least 30 GiB free and swap cleared (a restart) before each such run. Add a disk-free check
   to the gate's preflight beside the battery check: a gate that runs `cargo-build` refuses below a threshold. This is a scripts
   change, so it needs a reviewed batch.
2. Move the test-crate measurement into wave 41, as a root-run or single-lane step between waves, with nothing else running. Do
   it first with `--emit=metadata` (the front end only), then a full build. The split says whether D9's memory lane targets the
   front end (as §9 assumes; check-core's 12.3 GB is a front-end figure) or the codegen and IR model. The plan does not know which
   phase took the `cargo` crate's 12 GiB.
3. Give the run a watchdog that kills the build when free disk falls below about 3 GiB. macOS has no RSS ulimit.
4. Freeing disk is outside `$RUST_TS_DATA`'s control. If the owner cannot free about 20 GiB, M8a is `cargo-build` +
   `cargo-smoke` with `cargo-testsuite` as a report, by D9's fallback, decided up front rather than discovered.

### F3. HIGH (harness design): both CLI emulations run under the project's own dogfood config, not under upstream's test settings

The plan's conclusion that the committed baselines cannot be used as they are, so the suites compare with the oracle binaries
(D10, D11), still holds. But the measurements that support it measure something else, and the harness designs in §2b, §3b, D10
and D11 would carry the same errors into the suites. Comparing with the oracle hides these errors: both sides would run the wrong
configuration identically, and the suites would match while not testing what upstream's tests test.

- **clippy.** `compile-test.rs:279` runs ui with `CLIPPY_CONF_DIR=tests`, so `tests/clippy.toml` applies (`lint-commented-code =
  false`). `clippy-ui.ts` does not set it, and runs from the clippy root, so clippy reads the **root `clippy.toml`**: clippy's
  dogfood settings (`avoid-breaking-exported-api = false`, `check-inconsistent-struct-field-initializers = true`,
  `disallowed-methods` …). Setting it changes **20 of 1,019 outputs** and raises the match count from 391 to 401. Separately, 103 of
  the 1,019 have no `fn main`, and ui_test compiles such files as a library. The plan's argv omits `--crate-type=lib`, so **91 of the
  1,019** stop at E0601 before any lint runs. Example: `doc/doc_markdown-issue_13097.rs` gives E0601 as measured; with `--crate-type=lib`
  and `CLIPPY_CONF_DIR=tests` its raw stderr is **byte-identical to the committed `.stderr`**. So "the rest differ by ui_test's other
  normalisations" (§2b) is not established. A good part of the 628 are the emulation.
- **rustfmt.** `rustfmt-sys.ts` runs `rustfmt tests/source/X.rs` from the rustfmt root. rustfmt searches upward from the file for
  a config, so every file **without a `config` comment reads rustfmt's own `rustfmt.toml`**: `error_on_line_overflow = true`,
  `error_on_unformatted = true`, `style_edition = "2024"`, `overflow_delimited_expr = false`. `src/test/mod.rs` uses the default
  config plus the significant comments. With that file moved aside in my copy, the result goes from **717 to 748** matches, and
  exit 1 from **68 to 15**. Most of the "`exceeded maximum width` reports … the CLI turns into exit 1" that §3b blames on the CLI
  come from that config.

**Amend D10 and D11:**
- The clippy harness reproduces `compile-test.rs`'s environment and ui_test's per-file defaults: `CLIPPY_CONF_DIR=tests` (ui),
  the per-directory value (ui-toml), `RUSTC_ICE=0`, `--crate-type=lib` when there is no `fn main`, `-Ldependency` for
  `clippy_test_deps`, and the test's own `//@normalize-stderr-test` applied to both sides. These exist for nondeterminism:
  `custom_ice_message.rs` prints the version, target, flags and `delayed at <rustc source location>`.
- The rustfmt harness runs from a directory with no `rustfmt.toml` above it, or passes an explicit default `--config-path`, with
  `HOME` and `XDG_CONFIG_HOME` pointed at an empty directory, so user config cannot leak in.
- `harness-m8b` and `harness-m8d` each prove their emulation on the oracle: the share of committed baselines it reproduces, with
  every remaining class named. A suite that tests the right thing should get close to `src/test/mod.rs` and ui_test.

### F4. HIGH (owner): D1 reinterprets PLAN.md's milestone, and the plan's case against porting cargo is overstated

PLAN.md §5 says M8 is "cargo-ts, rustfmt-ts, clippy-ts", gated by "each tool's upstream tests". By analogy with the other two,
"cargo-ts" means cargo in TypeScript. Option (c) builds cargo with rust-ts instead. That is a change of what the milestone
delivers, not a porting judgment. It also adds new in-scope crates to `harness/scope.json` (D4), whose header says that changing it
needs the owner's approval. **D1 must go to the owner.** The plan is right to mark it.

Before it goes, §1d should be fair to the alternative. "A TS cargo would have to replace curl, libgit2 and SQLite … a redesign the
contract forbids" overstates it. The project already has a seam pattern for C and C++: `rustc_codegen_llvm` is ported with its
seam at `llvm/ffi.rs` (plan-m7 D4), and host libm and proc-macro dylibs are reached through `bun:ffi`. A port of cargo's own code
(about 108k lines + 11k of its crates) could put the 7 C libraries behind a `-sys` seam the same way. PORTING §5b vendors only
what is *reached* of the Rust dependencies, so the cost is not 2.13M lines. The real costs are `gix` (133k lines, much of it
reached by fetch and status), `toml`/`serde`, `clap`, `tar`/`flate2`, the HTTP and registry code, and a test strategy for a binary
whose testsuite is itself 210k lines of Rust. That is likely well above clippy's 157k, so (c) probably remains the right
recommendation. But the owner should choose between costed options:

- (a′) port cargo's own crates, vendor what is reached, with the C libraries behind an FFI seam; not costed by the plan;
- (c) build it with the port, as recommended;
- defer cargo-ts to after M9.

Add (a′) to §1d with an order-of-magnitude estimate, even if it is rough.

### F5. MEDIUM: D9's oracle is outcome-only, which protects both-sides failures and cannot see a miscompiled assertion

- A case MATCHes when ok / FAILED / ignored agree. The 27 environment failures fail on both sides, so they would MATCH and become
  **protected FAILED cases**, which later protect nothing, or protect a different failure. Rule: tests the oracle side does not
  pass are listed as ENV, out of the denominator and never protected, as ORACLE_TIMEOUT is.
- In `cargo-testsuite`, the testsuite itself (libtest, `cargo-test-support`, `snapbox`'s comparisons) is compiled by the port.
  A miscompile in the test code's own comparison can turn a real failure into `ok`, and outcome-only matching cannot tell.
  `snapbox::cmd::cargo_bin!("cargo")` bakes in `CARGO_BIN_EXE_cargo` at compile time (`tests/testsuite/utils/mod.rs`
  `cargo_exe`), so a third, cleaner configuration is possible without editing any source: the **oracle-built testsuite with the
  port-built `cargo` binary placed at the baked-in path**. That tests the port-built cargo by trusted test code. I recommend it
  as the gated M8a suite, with the all-port build as a second suite: report first, then protected.
- **95% is loose for a compiler-equivalence check.** Same source, same rustc on `PATH`: every non-flaky difference is a miscompile.
  Consider 99%, with the shortfall named.
- D9 should say how tests run concurrently ("each in its own sandbox with `RUST_TEST_THREADS=1`" read literally is serial, about
  2 h+ per side), how sandboxes are cleaned (the plan measured +0.3 GB per 200 tests), and that `PATH` is built, not inherited.
  Two of the 27 failures (`cargo_alias_config`, `script::cargo`) come from external `cargo-*` subcommands on the reviewer's
  `PATH`. The oracle toolchain's `bin`, not the rustup proxy, goes first.

### F6. MEDIUM: D16 is safe, and the plan's reason for `cargo-testsuite-rustc` needing incremental is wrong

`cargo-test-support/src/lib.rs:1442` sets `CARGO_INCREMENTAL=0` for **every** test ("Tests that specifically need to check the
incremental behavior should turn this back on"). About 25 sites in 10 testsuite files turn it back on. So §4c's "It needs
`-C incremental` (cargo's dev profile, which these tests use)" and §5's "the testsuite's projects use it" are wrong: incremental
blocks a few dozen tests, not the suite. Those tests can be listed as expected UNPORTED.

For M9, building tsc-rs needs `CARGO_INCREMENTAL=0` exactly as `rg-build` and `cargo-build` set it. "rust-ts type-checks rust-ts"
does not involve incremental. Keeping `rustc_incremental` out is the status quo of `scope.json` (plan-m7 D11), so **D16 does not need
the owner**: only bringing incremental *in* would, being a `scope.json` change. Mark D16 as root's decision, with a note for
plan-m9 to revisit if the owner wants a drop-in `rustc` for default cargo profiles. Correct §4c and §5.

### F7. MEDIUM: `cargo-build` depends on mutable host state (Homebrew C libraries), and D15 forbids pinning it

The 9 `-sys` build scripts probe the host. This host has Homebrew `openssl`, `openssl@3`, `openssl@3.5`, `openssl@3.6`, `openssl@4`,
`libgit2`, `libgit2@1.9`, `curl`, `libssh2`, `sqlite`, `libnghttp2`; `pkg-config` is not on `PATH`. §1c says OpenSSL is "found
on the host". A `brew upgrade` between the oracle's cached build and the port's build changes build-script outputs (link lines,
`DEP_*` metadata) and the binary's dynamic libraries, and so flips a protected MATCH. D15 allows only what `rg-build` sets, but
ripgrep has no `-sys` crates, so that precedent does not cover this.

**Amend D15:** either the oracle key includes what the probes found (the build-script outputs or a hash of the selected
libraries' install names), or the harness pins them with environment variables such as `OPENSSL_DIR`, `LIBGIT2_NO_VENDOR=0`,
`LIBZ_SYS_STATIC`. Pinning is configuration, not a source edit, and is a recorded decision. Say which.

### F8. MEDIUM: wave and lane order

- **Contract lanes depend on the coverage and sources part of `harness-m8a`.** Their markers
  (`// rustc: src/tools/clippy/…`) point into trees that are not in the sparse checkout, and `coverage.ts --check` (a gate step)
  rejects markers that point at nothing. So D3's sparse change and D4's coverage.ts change must merge before any contract lane
  integrates. Split them out of `harness-m8a` into a small `tools-prep-m8` batch that merges first. As listed, `harness-m8a` also
  holds D2, D3, D4, D8 (with six re-check notes), `cargo-build` and `cargo-smoke`, which is large for one reviewed batch.
- **`clippy_lints/src/methods/mod.rs` is 6,229 lines**: about 150 lint declarations and the `check_methods` dispatch every
  `methods-*` lane needs. It is a contract file over the 3k limit. Make it a chained `methods-contract` before `methods-a…h`, and
  do the same for each directory's `mod.rs` dispatch (`matches`, `loops`, `operators`, `casts`, `doc` 1,407, …). Other sizes are
  within the limit: `clippy-contract-a` is 2,535 lines, and `clippy_utils/src/lib.rs` (3,716) is already split.
- **`cargo-fix-a`'s "AES/SHA3 siblings while there"** is harmless but unmeasured. Keep it to what a run reaches, or name the test
  that proves each signature.

### F9. LOW: estimates

- `cargo-build` at `-j1`: build 1's calls sum to 35.6 min of wall, and that excludes the C compiles in build scripts and the link
  of a 134 MB binary. Expect 40–50 min per side when uncached. Add the port's test-crate build, unmeasured but more than twice the
  `cargo` crate, and the 12-minute run: M8a adds closer to 2 h than 1 h to a gate (§6, "Gate time").
- The memory figures should be in GiB or GB consistently ("12.45 GB" is 12,450 MiB = 12.16 GiB = 13.05 GB).
- §0's "all at or above 88%" should name `rustc_interface` at 65.6%.

### F10. LOW: D6 generates serde output "concretely", which risks drifting from serde's error texts

D6 generates "the concrete TOML and JSON (de)serializers the derive would produce", and ports only the `Display` texts. serde's
observable errors come from the interplay of the derive's visitor, `de::Error::{unknown_field, missing_field, invalid_type}`,
`Unexpected`/`Expected`, and toml's span handling. `clippy_config`'s `define_Conf!` hand-writes a visitor over `DeTable` too.
The faithful version is the project's own precedent (Decodable through tools/codegen): vendor the reached part of `serde::de`
(`Error`, `Unexpected`, `Expected`, `value`, `private::de` where `untagged` or `flatten` is used). Have codegen emit what
`serde_derive` emits, checked against the oracle's `-Zunpretty=expanded` of `clippy_config` and of rustfmt's config types. That
gives an exact oracle for the generator for free.

### F11. LOW: D2 can be simpler, and must not change the sysroot

The plan's measurements ran the components unpacked, hash-checked against the manifest, by absolute path, with
`DYLD_LIBRARY_PATH=<oracle>/lib`, which literally runs them on the oracle's `librustc_driver`. An isolated rustup home loads its
*own* copy of `librustc_driver` (the same file name and presumably the same bytes) and costs about 0.6 GB of the scarce disk (F2).
Either way:
- both sides must pass the same explicit `--sysroot` (the main oracle's). A sysroot with `rust-src` (the Miri home has
  `lib/rustlib/src`) prints real std paths instead of `/rustc/<hash>/…`. The main oracle has `rustc-src` from `rustc-dev`, which
  matters for `clippy-dogfood`.
- the guard should compare the `librustc_driver` hash the tool loads with the oracle's.

## Decisions for the owner

1. **D1 (scope): yes, owner.** It redefines PLAN.md's "cargo-ts" and adds crates to `scope.json`. Present it with (a′) costed (F4)
   and with the plan's own alternative of deferring clippy-ts. My recommendation is (c) with clippy kept, as the plan says.
2. **Host capacity (new): owner.** Freeing at least 20–30 GiB of disk on the root host, or accepting that M8a gates on
   `cargo-build` + `cargo-smoke` with `cargo-testsuite` as a report until it is freed (F2). The project cannot free space outside
   `$RUST_TS_DATA` on its own.
3. **D16: not owner.** Keeping incremental out is the status quo (F6). Only bringing it in would need the owner. Root records it;
   plan-m9 revisits it.

Root can decide the rest, with these amendments: D9 (F5), D10/D11 (F3), D14 (F1), D15 (F7), D6 (F10), D2 (F11), wave order (F8).

## Must be settled before a lane starts

- F1's lane-by-lane clippy measurement and the stub semantics, before `clippy-contract-a`.
- F2's headroom precondition and the move of the test-crate measurement into wave 41, before any heavy cargo build.
- F8's `tools-prep-m8` (sparse + coverage.ts), before any contract lane integrates.

The others (F3, F5, F7) bind the harness batches that build those suites (`harness-m8a/b/c/d`), and their reviewers should check
them.

## What I did not check

- The port's build of cargo, or anything through the port: I relied on the plan's logs, which agree with its text.
- `cargo-smoke`'s 11 outputs, beyond the plan's account.
- ui-toml, ui-cargo and the rustfmt emit modes; flakiness of cargo's testsuite.
- How much of `gix`, `toml`, `clap` and others a TypeScript cargo would reach (F4's (a′) is not costed by me either).
- Whether the isolated rustup home's `librustc_driver` is byte-identical to the oracle's; I did not install one.

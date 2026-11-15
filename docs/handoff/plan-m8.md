# Handoff: plan-m8 (planning lane)

**Output:** `docs/plan-m8.md`, revised after the independent review (`docs/reviews/plan-m8.md` on `t3/review-m8-plan`, 5a5f8beb:
APPROVE WITH CHANGES). It follows root's recorded decisions "M8 scope", "M8 host capacity" and "plan-m8 D16"
(`docs/state/history.jsonl`, 2026-11-15T22:38). No code, harness, scripts, baselines or oracle changed. No coverage numbers apply.

**Recommendation.** Option (c), recorded by root as the M8 scope:
- clippy-ts and rustfmt-ts are line-by-line ports onto the already-ported `rustc_*` crates, checked against the pinned nightly's
  `clippy-preview`/`rustfmt-preview` run on the oracle's own `librustc_driver`.
- cargo is built by rust-ts from its pinned source (29c5daa1). Its own testsuite, built by the oracle, runs against the port-built
  `cargo` at the baked-in `CARGO_BIN_EXE_cargo` path.
- Measured: 389 of 392 calls of cargo's build through the port succeed, including the 108k-line `cargo` crate (424 s,
  12,450 MiB). The 3 stops are missing aarch64 intrinsic signatures. A port-built `cargo` matched the oracle's on an 11-step smoke
  test.
- The review's alternative (a′) is costed in §1e: port cargo with its C libraries behind an FFI seam, vendoring only reached Rust
  code. That is about 330–470k more lines, 1.5–2× all of (c)'s porting and 2–3 months. Deferring clippy-ts makes M8 1–2 weeks.
- I keep (c) with clippy: (a′) is mostly non-compiler code behind a C seam, and (c) exercises the compiler on the program M9
  resembles. **[owner]** D1 can still be overruled.

**What changed in the revision (F1–F11):**
- F1: §2d designs `clippy-ui-lane`, a report suite that enables only ported lints on both sides through ordinary lint levels and
  registers only ported passes on the port's side (glue in `src/rust_ts/clippy_lane.ts`). It is in place before the first lint
  lane; `clippy-ui` stays the exact gate.
- F2: D20 adds a host-headroom precondition (≥ 20 GiB free, swap under 4 GB), a watchdog (free disk < 4 GiB or critical memory
  pressure kills the build's process group) and a gate preflight disk check. The test-crate measurement is wave 41 step 2,
  root-run alone. M8a = `cargo-build` + `cargo-smoke`; `cargo-testsuite` is a report until the owner frees disk.
- F3: re-measured with upstream's settings.
  - clippy: `CLIPPY_CONF_DIR=tests` alone gives 401; adding `--crate-type=lib` without `main` gives 452. All but 14 of the 1,019
    match the committed baselines up to ui_test's named normalisations (302 empty `|` lines, 245 `//~` annotations).
  - rustfmt: without its own `rustfmt.toml` and with an empty `HOME`, 748 of 802; 15 of the rest are JSON-valued options the CLI's
    `--config` cannot carry.
  - D10 and D11 now copy these settings and must prove them.
- F4: §1e costs (a′), deferring clippy and deferring cargo-ts.
- F5: the ENV class is never protected; the protected configuration is the oracle-built testsuite with the port-built `cargo`; the
  bar is 99%; `PATH` is built, not inherited; tests run module by module with the sandbox cleaned between modules.
- F6: `cargo-test-support` sets `CARGO_INCREMENTAL=0` for every test; D16 is root's decision.
- F7: §4a names Homebrew OpenSSL (via `openssl-sys`'s Homebrew probe), libgit2 vendored only because `pkg-config` is missing, and
  `curl-config` on `PATH`. D15 builds with cargo's own `--features all-static` and records build-script outputs and `otool -L`.
- F8: `tools-prep-m8` (sparse, coverage.ts, scope.json) merges first (D21); `methods/mod.rs` and the other directories' `mod.rs`
  become 7 dispatch contract lanes.
- F9: `-j1` estimate is 40–50 min per side (the calls alone sum to 35.6 min); memory figures are now in MiB; `rustc_interface` is
  listed at 65.6%.
- F10: serde follows the Decodable precedent, with the reached `serde::de` ported and codegen checked against
  `-Zunpretty=expanded`.
- F11: D2 uses the hash-pinned tarballs on the oracle's `librustc_driver` (about 20 MB, not about 0.6 GB), with one explicit
  `--sysroot`.

**Decisions** (plan-m8 §7): D1 **[owner]** scope; D2 tool oracles; D3 sources; D4 paths/markers; D5 macros via codegen; D6 serde;
D7 vendor; D8 project-build harness; D9 cargo testsuite; D10 clippy settings; D11 rustfmt settings; D12 entries; D13 unit budget;
D14 contracts + lane measurement; D15 C inputs pinned by `all-static`; D16 incremental out (root); D17 one heavy build at a time;
D18 harness/porting split; D19 `clippy-ui-lane` never protected; D20 host headroom; D21 wave-41 ordering.

**First wave (41), in order:**
1. `tools-prep-m8` (sources, coverage.ts crates, `scope.json`).
2. `m8-measure`: root-run, alone, behind D20; the port's build of the 210k-line test crate and of the `cargo` crate, front end
   first then full.
3. `cargo-fix-a`: the three aarch64 intrinsic signatures.
4. `harness-m8a`: tool oracles, project-build harness with the m7d notes, `all-static`, the watchdog and preflight check,
   `cargo-build`, `cargo-smoke`.
5. ✱`clippy-contract-a` (with the §2d glue), ✱`clippy-contract-b`, ✱`rustfmt-contract`.
6. `codegen-tools-m8`.

`harness-m8d` (the clippy suites, including `clippy-ui-lane`) lands in wave 42 before any lint lane.

**Cost:**
- About 220k upstream lines; ~73 porting + ~9 vendor lanes + 1–2 cargo fixers + ~25 fixers + 9 harness/tools batches + one
  root-run measurement: 2.5–3× M7.
- 3–5 weeks, 15–25 gates (M8a adds about 1 h per gate); 80–120 M tokens, extrapolated with wide error.
- M8a alone is 3–5 days and 2–3 gates, but its first heavy run waits on D20's headroom (a restart or freed disk).

**Measurements and scratch:** `$RUST_TS_DATA/tmp/plan-m8/` (plan-m8 header; §10 says what was kept). The revision re-measured
only F3 (oracle runs of clippy ui and rustfmt system tests, about 1 min of CPU) and read the `-sys` build scripts. It ran no build.

**Not checked:**
- the port's build of cargo's test crate (wave 41's job);
- which phase used the `cargo` crate's 12,450 MiB;
- `all-static` on either side;
- byte comparison of the port's cargo build with the oracle's;
- (a′)'s reach, estimated per dependency group;
- §2d in practice;
- clippy or rustfmt built against `rustc-dev`.

See plan-m8 §10.

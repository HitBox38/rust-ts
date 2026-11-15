# Handoff: plan-m8 (planning lane)

**Output:** `docs/plan-m8.md` (proposed, unreviewed). No code, harness, scripts, baselines or oracle changed. No coverage numbers
apply (no ported code).

**Recommendation.** Option (c). clippy-ts and rustfmt-ts are line-by-line ports onto the already-ported `rustc_*` crates (every crate they import is ported), checked against the pinned nightly's own `clippy-preview`/`rustfmt-preview` (built from the pin's commit) on their upstream tests. cargo is not portable under the contract (317-package graph, 2.13M lines of deps, 7 C libraries); it is built by rust-ts from its pinned source (commit 29c5daa1) and runs its own testsuite. Measured: the port compiled 389 of 392 calls of cargo's dev build, including the 108k-line `cargo` crate (424 s, 12.45 GB) and all 12 proc macros and 37 build scripts; 3 stops are missing aarch64 intrinsic signatures (`crc32b`, `crypto.sha1h`, `crypto.sha256h`). With those three crates sent to the oracle, the port-built `cargo` matched the oracle's on an 11-step smoke test (incl. ripgrep's `cargo check`). Order: M8a cargo built by the port (cheap, measurable now), M8b rustfmt-ts, M8c clippy-ts.

**Decisions** (plan-m8 §7; **[owner]** marks the ones the owner may want to weigh):
- D1 **[owner]** clippy-ts and rustfmt-ts are line-by-line ports; cargo is built by rust-ts (not ported) and runs its own testsuite. Amends PLAN.md's M8 row.
- D2 Oracles: pinned `clippy-preview`/`rustfmt-preview` in an isolated rustup home; cargo = the oracle toolchain's own.
- D3 Sources: `src/tools/{clippy,rustfmt}` join the sparse checkout; cargo pinned as a tarball (commit 29c5daa1, SHA-256 a1aaf161…).
- D4 Paths and markers as Miri's: `src/clippy_lints/`, `src/clippy_utils/`, `src/clippy_config/`, `src/clippy/driver.ts`, `src/rustfmt/`.
- D5 Macros (`declare_clippy_lint!`, `define_Conf!`, `create_config!`, `#[config_type]`, serde derives) through tools/codegen.
- D6 serde not ported as a framework: derives generated as concrete (de)serializers; toml 1.1 stack vendored.
- D7 Vendor at the root `Cargo.lock`'s versions, only what is reached; `unicode-width` 0.1.14 as a second version.
- D8 `cargo-build` generalises `rg-build.ts`; harness-m7d re-check notes 1–6 fixed there.
- D9 cargo's testsuite: outcome per test name, each side built by its own compiler, oracle `rustc` on `PATH`.
- D10 clippy suites compare with the oracle `clippy-driver`, not the committed `.stderr`/`.fixed`.
- D11 rustfmt suites drive the binary with significant comments as flags; `src/test/mod.rs` ported as a unit test.
- D12 Separate entries (`clippy-driver`, `rustfmt`), lazy loading.
- D13 Unit-step budget ≤ 10 s per lane; rustfmt's own system tests may have to be a suite.
- D14 Contract-first (`clippy-contract-a/-b`, `rustfmt-contract`).
- D15 cargo's stops are fixed in the port, never worked around in the harness.
- D16 **[owner]** `-C incremental` stays out of M8's gates; `cargo-testsuite-rustc` is a report until decided.
- D17 One heavy build at a time; `-j1` in suites.
- D18 Harness and porting never mix.

**First wave (41):** `cargo-fix-a` (the three aarch64 intrinsic signatures, then smoke-test stops); `harness-m8a` (isolated tools toolchain, sources, project-build harness generalising rg-build with the harness-m7d notes, `cargo-build`, `cargo-smoke`, coverage.ts learns the tool crates); ✱`clippy-contract-a`, ✱`clippy-contract-b`, ✱`rustfmt-contract` (three chained lanes); `codegen-tools-m8` (tools batch: clippy/rustfmt macros, serde derives).

**Cost:** about 220k upstream lines (clippy 157k, rustfmt 38k, vendor ~25k), ~73 porting lanes + ~8 vendor + 1–2 cargo fixers + ~25 fixers + ~8 harness/tools batches: 2.5–3× M7. Calendar 3–5 weeks, 15–25 gates; order of 80–120 M tokens (extrapolated, wide error). M8a alone 3–5 days and 2–3 gates, unless the port's build of cargo's 210k-line test crate needs a memory lane first. Gate cost: clippy/rustfmt suites minutes; `cargo-build` ~25–35 min heavy; `cargo-testsuite` ~12 min run.

**Measurements and scratch:** `$RUST_TS_DATA/tmp/plan-m8/` (see plan-m8 header and §10 for what was kept).

**Not checked:** the port's build of cargo's testsuite crate (the oracle's build, 64 s, and run, 4,425 tests in ~12 min with 27 host failures, were measured); byte comparison of the port's cargo build with the oracle's; clippy/rustfmt built by rust-ts against `rustc-dev`; the
isolated tools toolchain install (tarballs were unpacked instead); vendor reach (estimated, not traced). See plan-m8 §10.

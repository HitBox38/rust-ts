# Handoff: plan-m8 (planning lane)

**Output:** `docs/plan-m8.md`, second revision. It answers:
- the review (`docs/reviews/plan-m8.md`, 5a5f8beb), findings F1–F11;
- the re-check (`docs/reviews/plan-m8-recheck.md`, 444ceedd), findings N1–N9.

Both were APPROVE WITH CHANGES. It follows root's recorded decisions "M8 scope", "M8 host capacity", "plan-m8 D16" (2026-11-15T22:38),
"M8 host headroom" and "M8 cargo testsuite status" (23:09).

No code, harness, scripts, baselines or oracle changed. No coverage numbers apply.

**Recommendation (unchanged): option (c).**
- clippy-ts and rustfmt-ts are line-by-line ports onto the ported `rustc_*` crates, checked against the pinned `clippy-preview` and
  `rustfmt-preview` run on the oracle's `librustc_driver`.
- cargo is built by rust-ts from its pinned source and gated on `cargo-build` and `cargo-smoke`. Its own testsuite is a report for
  M8a.
- The alternative (a′), porting cargo with its C libraries behind an FFI seam, now has every dependency package assigned. It
  costs 360–550k upstream lines, 1.7–2.5× all of (c). **[owner]** D1 can still be overruled.

**What changed in this revision (N1–N9):**
- **N1:** `clippy-ui-lane` is redesigned for the pin's real structure: one combined early pass whose 51 sub-passes always run, and
  one combined late pass whose 316 sub-passes upstream builds only when `skippable_lints` says a lint of theirs is raised.
  - Both sides allow every lint group and add `-W clippy::<lint>` for each `//~` lint. Upstream's own late-pass filter, already
    ported, then selects the sub-passes. **No glue and nothing under `src/`.**
  - Early passes need one thing: the early group is ported first (`clippy-early-a…e`). Those are the 49 early modules plus
    `cognitive_complexity`, the only `eval_always` lint, at most 14.6k lines. No upstream filter exists for early passes, and
    adding one would be a redesign.
  - Re-measured on the oracle: of the 871 files with diagnostics, **57 become empty without the `-W` flags and 5 with them**. The
    5 are excluded.
  - Group names in attributes are expanded from a generated table. `allow` attributes do not count. A multi-lint sub-pass
    (`Methods`, 164 lints) is measurable only whole.
  - `combined_{early,late}_pass.rs` join `clippy-contract-a`, and their macros join D5.
- **N2:** no lane-only switch exists. D18 says what any later one would need: a separate entry, or `gateEnvRefusal` plus a null in
  every gated case's environment, plus a unit test.
- **N3:** the testsuite is built once per side by the oracle, because `CARGO_BIN_EXE_cargo` is fixed at compile time. The subject
  tree's `debug/cargo` is replaced by the port-built binary, and each tree's baked path is hash-checked before every run. This
  keeps about 4.2 GiB on disk and costs 2 × 64 s to build.
- **N4:**
  - D20's minimums stand (20 GiB free, swap under 4 GiB).
  - The gate checks them immediately before each D20-covered heavy suite, and `cargo-build` runs first.
  - A failed check or a watchdog stop fails the gate run: nothing is accepted, and the run is repeated.
  - Consequence, flagged **[owner]**: once `cargo-build` is protected, every gate needs that headroom at its start. On today's
    host that means a restart before each gate until disk is freed.
- **N5:** a `neverProtect` suite field (`gate accept` skips such a suite) and an ENV difftest status that is never a MATCH, both in
  `harness-m8a`.
- **N6:** codegen is split into `codegen-clippy-macros` and `codegen-fmt-serde`, each merging before the contracts it feeds.
- **N7:** §1e assigns all 309 packages; the rows sum to 2,134,831 lines.
- **N8:** the testsuite stays a report (`neverProtect`); root revisits it after `m8-measure`.
- **N9:** swap and disk figures are now in MiB/GiB. The 143 files without a `.stderr` are explained: with a `.stderr` the match is
  311 of 876, and 141 match by printing nothing.

**Wave 41:**

| # | Step | Status |
|---|---|---|
| 1 | `tools-prep-m8` (sources, coverage.ts crates, `scope.json`) | **now** |
| 2 | `codegen-clippy-macros` and `codegen-fmt-serde` | **now** |
| 3 | ✱`clippy-contract-a` (with the combined-pass files), ✱`clippy-contract-b`, ✱`rustfmt-contract` | **now** |
| 4 | `cargo-fix-a`: the three intrinsic signatures, proved per crate. Its end-to-end check through `cargo-build` waits | **now** (code) |
| 5 | `harness-m8a`: tool oracles, project-build harness, `all-static`, `neverProtect`/ENV, per-suite headroom check, watchdog, `cargo-build`, `cargo-smoke`, rg-build proof. Its `cargo-build` proof run waits | **now** (code and review) |
| 6 | `m8-measure` (root, alone, scratch watchdog) | **waits on host** |
| 7 | every `cargo-build` run | **waits on host** |

**Cost:**
- About 220k upstream lines: ~73 porting + ~9 vendor lanes, 1–2 cargo fixers, ~25 fixers, 10 harness/tools batches and one root
  measurement. That is 2.5–3× M7.
- 3–5 weeks, 15–25 gates, 80–120 M tokens (extrapolated, with wide error).
- M8a: 3–5 days and 2–3 gates, counted from when the host first meets D20.

**Scratch:** `$RUST_TS_DATA/tmp/plan-m8/` (see plan-m8 §10). This revision added `scripts/lane-probe.ts` (the re-check's probe,
copied unchanged) and `lane-oracle.jsonl`. It used the re-check's unpacked clippy and its source tree read-only, ran no build and
no port.

**Not checked:**
- the port's build of cargo's test crate (`m8-measure`);
- which phase took the `cargo` crate's 12,450 MiB;
- `all-static` on either side;
- §2d through the port, and shared state between late sub-passes;
- the early group's exact size;
- whether a restart frees the swap files' space;
- (a′)'s reach, estimated per row.

See plan-m8 §10.

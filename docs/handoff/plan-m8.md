# Handoff: plan-m8 (planning lane)

**Output:** `docs/plan-m8.md`, final revision. It answers:
- the review (`docs/reviews/plan-m8.md`, 5a5f8beb): F1–F11;
- the re-check (`docs/reviews/plan-m8-recheck.md`, 444ceedd): N1–N9;
- the second re-check (`docs/reviews/plan-m8-recheck2.md`, 264698b8): P1–P7.

It follows root's recorded decisions:
- "M8 scope", "M8 host capacity" and "plan-m8 D16" (2026-11-15T22:38);
- "M8 host headroom" and "M8 cargo testsuite status" (23:09);
- "M8 kept caches" (23:31).

No code, harness, scripts, baselines or oracle changed. No coverage numbers apply.

**Recommendation (unchanged): option (c).**
- clippy-ts and rustfmt-ts are line-by-line ports onto the ported `rustc_*` crates, checked against the pinned components on the
  oracle's `librustc_driver`.
- cargo is built by rust-ts. `cargo-build` is a report until the host passes D20 in steady state with M8's caches counted (D23);
  then M8a is `cargo-build` + `cargo-smoke`.
- The alternative (a′), porting cargo behind an FFI seam, is costed at 360–550k lines, 1.6–2.5× all of (c). **[owner]** D1 can
  still be overruled.

**What changed in this revision (P1–P7):**
- **P1:**
  - `DumpHir` and `Author` are lint-less late sub-passes that are always built. They join `cognitive_complexity` and the early
    sub-passes in an "always-running group": 12,516 lines without the four mixed directories' `mod.rs`, ≤ 15.6k with them, in 5
    lanes.
  - The `clippy_utils` modules that group imports (`source`, `res`, `paths`, `attrs`, `numeric_literal`, `ty/`, `visitors`,
    `macros`, `check_proc_macro`, `ast_utils`, `sugg`, `lib.rs` helpers, beyond contract-b's `diagnostics`/`sym`/`msrvs`) go into
    `clippy-utils-a…e`, which land with the group.
  - `clippy-ui-lane` counts once all of that is in. clippy is now 58 lanes.
- **P2:** `harness-m8a` is split.
  - `harness-m8a-gate` lands now: tool oracles, `neverProtect`, ENV and their accept checks, and D20's gate logic with fake host
    readers.
  - `harness-m8a-build` merges after its `rg-build` proof. Its `cargo-build` proof waits on the host.
- **P3:**
  - D23 lists M8's kept caches: about 5.3–5.6 GiB, of which 4.2 GiB are the testsuite trees.
  - After a restart (about 21.8 GiB free) that leaves about 16.3 GiB, 3.7 GiB short of 20. Without the trees it is about 20.5 GiB.
  - So the trees are rebuilt per run while short of room, and `cargo-build` stays a report until D23 holds.
  - D20's 20 GiB is re-derived from `m8-measure`'s measured peak + 4 GiB floor + 2 GiB margin.
- **P4:**
  - Unit tests: a failed check or a watchdog stop sets `pass: false` with no lost case, and `accept` refuses.
  - The gate stops at the failure.
  - A `neverProtect` suite with a baseline is refused by `gate run` and `accept`; ENV comes only from oracle runs.
  - D20 has one minimum table: 20 GiB plus swap under 4 GiB for port builds, and 10 GiB for `cargo-testsuite` (**proposed; root to
    confirm**).
- **P5:** cites `late_lint_crate` at `late.ts:478–485`, `is_lint_pass_required` at `lib.ts:570–580`, and `skippable_lints` at
  `levels.ts:162`.
- **P6:** vacuous cases are decided per lint from the oracle lane's JSON lint codes, not from a list.
  - `cast_alignment.rs` is vacuous until `clippy_test_deps` supplies `libc`.
  - `unicode.rs` is credited without `unicode_not_nfc`.
  - Message-form annotations are mapped through `clippy-ui`'s JSON.
- **P7:**
  - `tools-prep-m8` fetches the root-lock crates for the codegen check into `$RUST_TS_DATA/tools-deps/`.
  - §1e's archives row is fixed, and the ratio is now 1.6×.
  - The mixed directories' `mod.rs` owners are named: `doc` → `dispatch-a`, `attrs` → `-c`, `functions`/`misc_early` → `-d`.
  - The testsuite runs the test executable directly, never `cargo test`.

**Wave 41:**

| # | Step | Status |
|---|---|---|
| 1 | `tools-prep-m8` (sources, `tools-deps`, coverage.ts crates, `scope.json`) | **now** |
| 2 | `codegen-clippy-macros`, `codegen-fmt-serde` | **now** |
| 3 | `harness-m8a-gate` (tool oracles, `neverProtect`/ENV, gate headroom logic and unit tests) | **now** |
| 4 | ✱`clippy-contract-a`, ✱`clippy-contract-b`, ✱`rustfmt-contract` | **now** |
| 5 | `cargo-fix-a` (three intrinsic signatures, proved per crate). Its end-to-end check waits | **now** |
| 6 | `harness-m8a-build` (code, review, rg-build proof, merge). Its `cargo-build` proof, `all-static` build and slowdown measurement wait | **now** |
| 7 | `m8-measure` | **waits on host** |
| 8 | every `cargo-build` run; protection waits for D23 | **waits on host** |

**Cost:**
- About 220k upstream lines; ~74 porting + ~9 vendor lanes, 1–2 cargo fixers, ~25 fixers, 11 harness/tools batches and one root
  measurement.
- 3–5 weeks and 15–25 gates; 80–120 M tokens (extrapolated).
- M8a: 3–5 days and 2–3 gates, counted from when D23 holds.

**Scratch:** `$RUST_TS_DATA/tmp/plan-m8/` (plan-m8 §10). This revision measured only the cache sizes and the always-running
group's `clippy_utils` imports, reading the re-check's unpacked clippy tree read-only. It ran no build and no port.

**Not checked:**
- `m8-measure`;
- `clippy-test-deps` and `tools-deps` sizes (estimates);
- what `clippy-utils-a…e` import in turn;
- §2d through the port;
- `all-static`;
- whether a restart frees the swap files' space.

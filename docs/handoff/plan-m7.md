# Handoff: plan-m7 (design lane)

Branch `t3/plan-m7-clang-ir` from main `db323c3b`. No code changed. Status of the plan: proposal, not reviewed.

## Files touched
- `docs/plan-m7.md` (new): the M7 plan. D1–D20 are in its §7, waves 39–44 in §8, what I could not check in §10.
- `docs/handoff/plan-m7.md` (this file).

## Coverage and samples
No ported code, so coverage is unchanged (24,230 / 27,053 fns). No `unported(...)` added, no `// PORT:` decisions. No suite was run, and the
oracle toolchain was not changed: no `rustup` command ran, and the `llvm-tools` binaries were only executed.

Scripts and results: `$RUST_TS_DATA/tmp/plan-m7/`. Sourced by every script: `env.sh`. I deleted the build directories afterwards to save disk (about 700 MB;
`rg/t-*`, `np/w`, `np/c`); the sources, logs and JSONL results stay. Anything that needs a ripgrep tree again: `rg/run.sh`, `rg/runcheck2.sh`, `rg/runrb.sh`.

## For root
1. **Decisions to look at first:** D4 (port `rustc_codegen_llvm` at the FFI seam, against scope.json's current exclusion; needs owner approval), D1 (pinned `opt`/`llc`, not system clang; amends PLAN.md), D2 (normal form plus behaviour; no parity after LLVM passes), D3 (IR on x86_64-linux, native on the host), D13 (preflight first).
2. **PLAN.md needs editing when D1 and D3 are accepted:** §4 "textual LLVM IR → system clang" and "Target x86_64-unknown-linux-gnu first", and the M7 row.
3. **Lanes in worktrees need `RUST_TS_HOST_TUPLE`.** This worktree has no `.env.local`, so every port run exited 70 (`CFG_COMPILER_HOST_TRIPLE`) until I set the variable. One of my samples had to be discarded and rerun. Briefs should say so, or setup should copy `.env.local`.
4. **`docs/plan-ice-report.md` is not on main.** The brief points at it. I read it from `t3/plan-ice-report` and its review from `b9374970` (`t3/review-ice-report-plan`). Its F6 is cited in plan-m7 §4.
5. **Bugs this lane found, none fixed here:**
   - O2 has a two-line repro: plan-m7 §5, `$RUST_TS_DATA/tmp/plan-m7/o2/p2.rs`. It is the MIR inliner: `-Zmir-enable-passes=-Inline` makes `prog.rs` byte-identical. 5 of 120 sampled run-pass cases, and ripgrep's `rg`. Root cause not found.
   - O6: `serde_core.rmeta` differs from the oracle's (4 bytes smaller), and 4 other ripgrep dependencies differ, at least `grep` only through hashes. No protected suite sees it.
   - O4: `rustc_data_structures::jobserver::initialize` stops every crate under cargo.
   - O7: `callconv/aarch64.rs` stops some host `cargo check` runs too, not only codegen.
6. **Side effects outside `tmp/plan-m7/`:** `bun scripts/coverage.ts` rewrote `$RUST_TS_DATA/coverage.json` (same base as main). `harness/suites.ts` was only loaded to list cases. ripgrep's crates went to an isolated `CARGO_HOME` under `tmp/plan-m7/rg/cargo`, except that `scripts/crate-src.ts object --offline` read `~/.cargo`, which it already held.
7. **The load I added:** at most 3 or 4 workers at a time, and it stayed under 40 with the audit alongside.

## Could not be checked
See plan-m7 §10. The main ones: no port IR exists, so every parity statement is about oracle text and its mutations, and TS codegen cost is an estimate; x86_64-linux execution; LLVM's source (a submodule, not fetched), so the list of LLVM behaviours to imitate is unverified; the bytecode bundle figure (my trials failed on the top-level `await` at `src/rust_ts/main.ts:42`).

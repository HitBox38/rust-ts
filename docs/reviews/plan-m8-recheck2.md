verdict: APPROVE WITH CHANGES

Subject: the second revision of plan-m8 (`docs/plan-m8.md` and `docs/handoff/plan-m8.md` at `53080690` on `t3/plan-m8-research`;
diff against `408b873c`), re-checked against the previous re-check (`docs/reviews/plan-m8-recheck.md` at `444ceedd`, findings
N1–N9), root's decisions "M8 host headroom" and "M8 cargo testsuite status" (`docs/state/history.jsonl` lines 732–733,
2026-11-15T23:09) and the three 22:38 decisions, AGENTS.md and PORTING.md. Lane `recheck2-plan-m8`, read-only: this file is all I
wrote to the tree.

**What I ran.** No gate, no suite, and no build through either compiler. Nothing was added to or removed from the oracle toolchain.
I used the previous re-check's unpacked `clippy-driver` (hash-checked then) and its clippy source tree, read-only. I ran it on the
oracle sysroot for three configurations of the 1,019 `tests/ui` files: about 60 s of 20 ms runs. Scratch is in
`$RUST_TS_DATA/tmp/recheck2-plan-m8/`:
- `scripts/lane2.ts`, `lane3.ts`: an independent probe that records each diagnostic's lint code from `--error-format=json`, not by
  counting text lines;
- `scripts/passes.ts`: sub-pass ↔ lint table from `lib.rs` and the `declare_lint_pass!`/`impl_lint_pass!` macros;
- `out/`: the results.

Host at the start: AC power, load about 1.4, 12 GiB free on the data volume, swap 8.6 of 10.0 GiB used (10 swap files of 1 GiB).

The revision answers N1–N9, and its numbers hold. I reproduced 57 → 5 independently, and the §1e sums. N1's design is sound: a
`clippy-ui-lane` MATCH cannot hide an unported lint the case reaches. Three things must change before the lanes they affect:

- **P1.** The prerequisite group misses two lint-less **late** sub-passes that always run, `DumpHir` and `Author`. Without them,
  `clippy-ui-lane` counts nothing.
- **P2.** `harness-m8a` bundles `neverProtect` with work whose proof waits on the host, and wave 42's `harness-m8d` needs
  `neverProtect`.
- **P3.** M8's own kept caches come out of the same 20 GiB that D20 demands. They would close the 1.8 GiB margin a restart gives.

## Questions 1–5 in brief

1. **N1–N9:** all resolved, N4 and N5 with residual work (P3, P4). See the table.
2. **N1 verified** (details under N1 below):
   - one combined early pass with 51 sub-passes and one combined late pass with 316;
   - the filter primitives are in `src/`;
   - no MATCH path around an unported lint;
   - 57 → 5 reproduced;
   - the 14.6k bound reproduced. It is short by `DumpHir`/`Author` (P1).
3. **Decisions and ratchet:** nothing contradicts them. `neverProtect` and ENV are mechanical in the design: `gateAccept` adds only
   `status === "MATCH"` (`scripts/gate.ts:812`), and refuses any run whose `gate.json` has `pass: false` (`:917`). So "a failed
   check or a watchdog stop fails the run" makes acceptance impossible once harness-m8a sets `pass: false` for it. P4 asks for
   unit tests that pin both, and for two edge cases.
4. **Wave 41 split:** right in substance. Every "now" step can be finished and checked with typecheck, unit tests, coverage and
   small compiles. Two dependencies need stating:
   - P2, `harness-m8a`'s merge;
   - P7a, the crates the codegen batch's `-Zunpretty=expanded` check needs.
5. **New errors:**
   - P1, the lint-less late passes and the early group's reach into `clippy_utils`;
   - P2, the merge order;
   - P3, the disk budget;
   - P4, the gate-failure details;
   - P5, citations;
   - P6, the vacuous-case rule;
   - P7, nits.

## N1–N9

| Finding | Status | Evidence |
|---|---|---|
| N1 pass architecture, `-W` | **Resolved** (P1, P5, P6 remain) | §2a, §2c, §2d, D5, D14 rewritten for the combined passes. `-W clippy::<each //~ lint>` restored (§2d point 1). Glue removed. Contract-a gains `combined_{early,late}_pass.rs`; D5 gains their macros. Verified below |
| N2 env-var glue reaching a gated suite | **Resolved** | No switch exists (§2d's last paragraph). D18 says what any later switch must do: a separate entry, or `gateEnvRefusal` plus a null in every gated case's environment, plus a unit test, in a reviewed batch |
| N3 baked `CARGO_BIN_EXE_cargo` | **Resolved** (nit P7d) | §4c, D9: one oracle-built tree per side, the subject tree's `debug/cargo` replaced, a hash check at each baked path before every run, trees keyed and locked, 4.2 GiB |
| N4 D20 holds M8a's gate, and every later gate | **Resolved as decided by root** (P3, P4 remain) | D20's minimums stand. The check runs before each covered heavy suite (§6, D20), and `cargo-build` runs first. A failed check or watchdog stop fails the run. Steps are marked now / waits on host (§8, D21, D22). §9 counts M8a from the day the host meets D20. The every-gate consequence is flagged **[owner]** (§6) |
| N5 never-protected has no mechanism | **Resolved in design** (P4 remains) | D19 adds a `neverProtect` suite field that `accept` skips, with a unit test. ENV is its own difftest status, never returned by `matchesOfRun`, which today takes only `"MATCH"` (`gate.ts:805–815`) |
| N6 codegen after the contracts | **Resolved** (P7a) | D5 splits codegen into `codegen-clippy-macros` and `codegen-fmt-serde`, each merging before the contracts it feeds. Wave 41 step 2 now precedes step 3 |
| N7 dependency table partial | **Resolved** (nit P7b) | 15 rows, 309 packages, **2,134,831 lines**, which I summed and which equal `cargo-deps-lines.txt`'s total. Reach column sums to 359–544k + 119k as stated ("360–550k") |
| N8 testsuite's reason to stay a report | **Resolved by root's decision** | "M8 cargo testsuite status" keeps it a report. The plan sets `neverProtect` and revisits after `m8-measure` (§4c, §6, D9, §9) |
| N9 units, `.stderr`-less files, group attributes | **Resolved** | GiB/MiB throughout (the one "12 GB" is quoted as plan-m7's unit, §5). §2b and D10 separate the 141 empty-expectation matches. §2d point 4 expands group names from a generated table |

### N1 in detail

**Structure.** The claims hold against the pinned clippy source (`clippy_lints/src/lib.rs:449–487`, `:490–551`, `:553ff`):
- two pre-expansion passes;
- **one** `CombinedEarlyLintPass` with **51** sub-passes over **49** modules, its fields not optional
  (`combined_early_pass.rs:13–15`: "the early pass runner has no such filtering");
- **one** `CombinedLateLintPass` with **316** sub-passes. Each is built as
  `is_active(&<T>::lint_vec()).then(|| ctor)` (`combined_late_pass.rs`, `new`), and `is_active` is
  `rustc_lint::is_lint_pass_required(tcx.skippable_lints(()), lints)` (`lib.rs:477–478`).

Upstream `skippable_lints` (`compiler/rustc_lint/src/levels.rs:115`):
- excludes `eval_always` lints and `report_in_deps` lints;
- keeps a lint only if it is allowed at the crate root or allow-by-default;
- then removes every lint that any owner raises to a non-allow level. `LevelSpec::is_allow` is `level == Allow`
  (`rustc_middle/src/lint.rs:95`), so `#[expect]` raises, as §2d point 2 says.

Clippy has exactly one `eval_always` lint, `cognitive_complexity.rs:40`.

**The filter in `src/`.** The port has the primitives:
- `is_lint_pass_required`: `src/rustc_lint/lib.ts:570–580`;
- `skippable_lints`: `src/rustc_lint/levels.ts:162–193`, provider at `:1105`, including the `eval_always` and `report_in_deps`
  exclusions;
- generated `lint_vec()`s: `src/rustc_lint/*.lints.gen.ts`.

The pass-level filter that clippy's single combined pass goes through is `late_lint_crate`, at `src/rustc_lint/late.ts:479–485`
(upstream `late.rs:422–431`). The plan cites `late.ts:436–444` and `late.rs:369–380`, which are `late_lint_mod`'s filter for module
passes (P5). The per-sub-pass `Option` construction itself is clippy's code: it is not in `src/` yet, and it arrives with
`clippy-contract-a` and `codegen-clippy-macros`, as §2d point 2 says.

**Can a case MATCH while a lint it needs is unported? No route found.** An unported body exits 70 the moment it is reached. The
port reaches what the oracle reaches until the first difference. So a MATCH means every reached path is ported. A lint the case
"needs" can be unported only if the oracle never reaches its emission either, which is a vacuous case (P6). I checked the routes the
brief names:
- **Early sub-passes:** all always built; a stub is UNPORTED on its first callback.
- **`cognitive_complexity`:** never skippable; it is in the prerequisite group.
- **Lints emitted from shared helpers:** `clippy_utils` declares no lints. Its helpers are reached through a pass and stop as that
  pass's code does.
- **Lints emitted by a sub-pass other than the one that declares them:** the emitter is built only if one of its own lints is
  raised, on both sides alike. If it is not built, the lint is absent on both sides, so the case is vacuous for that lint (P6),
  not a false MATCH. If it is built and is a stub, the case is UNPORTED.
- **`Methods`' 164 lints:** confirmed 164 in one sub-pass. §2d point 5 makes them measurable only together.

  Other multi-lint late sub-passes:

  | Sub-pass | Lints |
  |---|---|
  | `Operators` | 32 |
  | `Casts` | 28 |
  | `Matches` | 27 |
  | `Loops` | 25 |
  | `Documentation` | 20 |
  | `Transmute` | 15 |
  | `Functions` | 13 |
  | `Types` | 10 |

- **Eligibility mistakes:** a raised lint the scanner misses, such as one in a `cfg_attr` or in a module file. Such a mistake only
  builds a pass the table did not expect, which is UNPORTED or a denominator error, never a silent MATCH.

What the route analysis did find is that the prerequisite group is incomplete (P1).

**57 → 5, re-run.** My run uses its own probe (`lane3.ts`, JSON lint codes) and the same filter and argv: 3 × 1,019 runs, 41 s for
two configurations.

| Configuration | Of the 870 with diagnostics*: empty | fewer, not empty | Diagnostics in all |
|---|---|---|---|
| `clippy-ui` | – | – | 8,571 |
| groups allowed, no `-W` | **57** | 23 | 8,183 |
| groups allowed + `-W` per `//~` lint | **5** | 1 (`manual_filter.rs`, 20 → 15) | 8,566 |

\*870 by JSON level, 871 by the plan's text count. The plan's absolute diagnostic counts (9,442 / 8,997 / 9,432) are text-line
counts, so they differ from mine; the empty and fewer counts are the same.

The 5 are exactly the plan's 5. With `-W`, the oracle's lane output has the same lint codes in the same order as `clippy-ui`'s for
**1,011 of the 1,019 files**: the lane configuration changes which sub-passes are built, almost never what is printed. The plan's
`lane-oracle.jsonl` is byte-identical to the previous re-check's `lane.jsonl`. That fits a deterministic re-run, and my independent
probe agrees.

**Early bound.** I counted the 49 modules, with `attrs`, `doc`, `functions` and `misc_early` whole: **14,458** lines, plus
`cognitive_complexity.rs` 170, giving **14,628**. That matches "≤ 14.6k". It is ≤ 5 lanes only at about 2.9k each. P1 adds 942
lines.

## New findings

### P1. MEDIUM (binds the early-group lanes and `harness-m8d`): two lint-less late sub-passes always run and are missing from the prerequisite group; and the early group reaches into `clippy_utils`

**Evidence.**
- `utils/dump_hir.rs:6–22` is `declare_lint_pass!(… DumpHir => [])`.
- `utils/author.rs:18–50` is `declare_lint_pass!(… Author => [])`.
- Both are in `late_lint_methods!` (`lib.rs:553ff`).
- `is_lint_pass_required` returns `true` for an empty lint list (`rustc_lint/src/lib.rs:787–791`), so both are built for every
  crate.
- Their `check_item`, `check_expr`, `check_stmt`, `check_trait_item` and `check_impl_item` run on every node and call `has_attr`,
  which uses `clippy_utils::attrs::get_builtin_attr`.

My table (`out/passes.tsv`) finds exactly 2 lint-less early sub-passes (the collectors, already in the group) and exactly 2
lint-less late ones, these two. Every other late sub-pass has at least one lint.

**Consequences.**
- §2d's "problem" paragraph and points 2–3 list what always runs: early sub-passes, `cognitive_complexity`, and late sub-passes
  with a raised lint. They omit these two. So does D14.
- While `DumpHir` and `Author` are stubs, every `clippy-ui-lane` case is UNPORTED. "`clippy-ui-lane` counts from here on" in §8
  wave 42 would then read 0, and §9's trigger would have nothing to read.
- No false MATCH results, only no measurement.
- Separately, the early group's bodies import `clippy_utils` heavily:
  - `diagnostics` 91 times and `source` 36;
  - also `msrvs`, `sym`, `ty`, `res`, `macros`, `visitors`, `ast_utils`, `attrs`, `sugg`, `numeric_literal`,
    `is_from_proc_macro`, and `lib.rs` helpers.

  Those modules belong to the `clippy-utils-a…f` lanes, which wave 42 runs in parallel and does not order. Until they land, the
  early group's own paths stop as UNPORTED, so counting starts later than the plan says.

**Fix.**
- Add `utils/dump_hir.rs` (63 lines) and `utils/author.rs` (879) to the prerequisite group. The bound becomes ≤ 15.6k, 5–6 lanes.
- Name them in §2d (the problem paragraph and point 3) and in D14.
- Order the `clippy_utils` modules the early group imports into the first `clippy-utils-*` lanes, landing with the early group.
- Restate when `clippy-ui-lane` starts to count: after the early group, `cognitive_complexity`, the two lint-less late passes, and
  the `clippy_utils` they reach.

### P2. MEDIUM-LOW (binds `harness-m8a`'s merge): D19's mechanism sits in a batch whose proof waits on the host, and wave 42 needs it

**Evidence.**
- D21 puts D2, D8, D15, D19, D20, `cargo-build` and `cargo-smoke` in one second `harness-m8a` batch, "whose code and review
  proceed now; its `cargo-build` proof runs wait on D20". §8 step 5 says the same.
- The plan does not say whether the batch merges before that proof run.
- `harness-m8d` (wave 42, "all now") lands `clippy-ui-lane` with `neverProtect`. `harness-m8c`'s code needs `neverProtect` for
  `cargo-testsuite`.
- If `harness-m8a` merges only after its `cargo-build` proof, the clippy suites inherit a dependency on the host that the plan says
  they do not have (§9: "the porting waves … do not wait").

**Fix.** Pick one and write it into D21:
- split `harness-m8a` so that D19 (`neverProtect`, ENV) and D20's gate logic (with fake host readers, P4) merge now; or
- let `harness-m8a` merge after its `rg-build`/`rg-behaviour` proof, with `cargo-build` and `cargo-smoke` registered but kept out
  of every gate's `--suites`, and with `neverProtect` set, until their proof run.

### P3. MEDIUM (root, owner; before `harness-m8c` keeps trees, and before `cargo-build` is protected): M8's standing caches come out of D20's 20 GiB

**Evidence.**
- D20 requires ≥ 20 GiB free before each covered heavy suite in every gate once `cargo-build` is protected.
- A restart gives about 21.8 GiB, a 1.8 GiB margin (§9 risks). I found the same 12 GiB free and 10 × 1 GiB swap files today.
- The plan adds kept data on that volume and never sums it:
  - the two `cargo-testsuite` trees, **4.2 GiB "cached between gates"** (§4c, §6);
  - `$RUST_TS_DATA/cargo-src` with its `CARGO_HOME`, unmeasured. The lock includes `openssl-src`, the vendored C of the `-sys`
    crates and every platform's crates if fetched without `--target`;
  - kept `cargo` binaries (134 MB each side);
  - `clippy-test-deps`;
  - the tool tarballs and the 37 MB of sparse sources.
- Once the trees are kept, a restart alone no longer reaches 20 GiB. "A restart before each gate" (§6) then stops being a way to
  run a gate at all, and every gate, including M8b's and M8c's, waits on the owner.

**Fix.**
- Add a standing-disk line to D20: the measured size of each kept M8 cache.
- Either do not keep the testsuite trees below a free-disk level (rebuild 2 × 64 s, oracle only), or add the caches to the 20–30 GiB
  the owner is asked to free.
- Give root the option, in §6, of not protecting `cargo-build` until the owner has freed disk. M8a is then shown in a gate record
  but not ratcheted, so other gates do not need a restart each. That is a root decision; the plan should cost it.

### P4. LOW (`harness-m8a` review): pin the gate failure modes with tests, and settle three details

- **Tests for D20 in a gate.** D19 asks for a unit test; D20 does not. Using `host-state.ts`'s injectable `HostReaders`, require
  unit tests that:
  - a failed headroom check before a covered suite sets `gate.json` `pass: false` with a named reason and records no case of that
    suite as lost;
  - a watchdog stop does the same;
  - `accept` then refuses (`gate.ts:917`).
- **What happens after a failure.** Say whether the gate stops at the failed check or runs on. With `cargo-build` first, running on
  wastes about 7 h of a run that cannot be accepted.
- **`neverProtect` with a baseline file.** Make it a refusal in both `gate run` and `accept`. Skipping the suite in `accept` must
  never also skip a loss check against a baseline that exists.
- **ENV is decided from oracle runs only.** Add a unit test that a subject-side outcome can never produce ENV.
- **Wording.** D9 says `cargo-testsuite` "refuses to start below the free-disk minimum (D20)". D20 and §6 do not list
  `cargo-testsuite` among the covered suites. Say which minimum applies; the trees need 4.2 GiB plus 0.3 GiB per 200 tests.
- **A risk to measure.** `cargo-build` first reverses the heavy-last order (plan-m5 §4.2). Measure in `harness-m8a`'s proof whether
  the suites after a 12 GiB compile run slower, because a timeout is a false loss.

### P5. LOW: §2a's and §2d's citations point at the module-pass filter

`late.ts:436–444` and `late.rs:369–380` are `late_lint_mod`, which filters `late_lint_mod_passes`. Clippy's combined pass is
registered with `register_late_lint_pass` (`lib.rs:476`), so it goes through `late_lint_crate`: `late.rs:422–431`, port
`late.ts:478–485`. In both places the combined pass is always kept, because `cognitive_complexity` is `eval_always`.

**Fix.** Cite:
- `late.ts:478–485`;
- `lib.ts:570–580` for `is_lint_pass_required`;
- `levels.ts:162` for `skippable_lints`.

Say that the per-sub-pass selection arrives with `clippy-contract-a` and `codegen-clippy-macros`.

### P6. LOW (`harness-m8d`): make the vacuous-case rule mechanical, per lint, and say how message-form annotations are handled

**Evidence.**
- §2d point 6 defines vacuous as "oracle lane output holds none of its annotated diagnostics", then names 5 files.
- 4 of those 5 (`blocks_in_conditions_2021.rs`, `blocks_in_conditions_unfixable.rs`, `def_id_nocore.rs`,
  `mixed_attributes_style/mod_declaration.rs`) annotate with message-form `//~^ ERROR: <text>`. That form names no lint, so `-W`
  cannot be derived from it.
- `cast_alignment.rs` prints only `E0433` on both configurations. Its annotated `cast_ptr_alignment` never fires in this emulation,
  so it meets the stated rule but is not in the list.
- Two annotated lints are lost under `-W` in files that are not empty:
  - `unicode.rs`: `unicode_not_nfc` disappears, because the file-wide `-W clippy::non_ascii_literal` changes `Unicode`'s branch, and
    `non_ascii_literal` goes from 4 to 8;
  - `manual_filter.rs`: 5 of 20 `manual_filter` diagnostics disappear.

  Such a case counts toward a lint it no longer tests.

**Fix.**
- Have the harness apply the rule from the oracle's JSON lint codes, not from a fixed list.
- Credit a case to a lint only if the lane output holds that lint's diagnostics.
- Map message-form annotations to their lint through the oracle's `clippy-ui` JSON, or exclude those files by rule.

### P7. Nits

- **a. Root-lock crates for codegen's check.** D3/`tools-prep-m8` fetches cargo's lock only. The codegen batches' check against the
  oracle's `-Zunpretty=expanded` of `clippy_config` and of rustfmt's config needs the root `Cargo.lock`'s `serde`, `serde_derive`,
  `toml` and `itertools`, built by the oracle's cargo. `rustc-dev` is already an oracle component (`UPSTREAM.json:11`), so this is
  feasible now. Say where those crates come from.
- **b. Archives row.** §1e's archives row names `libz-rs-sys`, `adler2` and `miniz_oxide`, which are not in the graph. Its 5
  packages and 32,501 lines are `tar`, `flate2`, `zlib-rs`, `crc32fast` and `filetime`. Also, "1.7–2.5×" of 220k is 1.6–2.5×
  (360/220 = 1.64).
- **c. Who owns the mixed directories' `mod.rs`.** §2c counts `attrs`, `doc`, `functions` and `misc_early` whole in the early
  group, but their `mod.rs` files (3,054 lines) are in the dispatch-contract row. Say that the dispatch lanes own them and the
  early lanes port the rest. The early group's own share is then about 11.6k, plus P1's 942.
- **d. Never `cargo test` in the subject tree.** Say that `cargo-testsuite` runs the built test executable directly and never
  `cargo test` there. Otherwise cargo's freshness check could rebuild the swapped `debug/cargo` after the hash check has passed.

## What I did not check

- Anything through the port: no build, no difftest, no `m8-measure`, no `skippable_lints` run on clippy files.
- Which late sub-passes read another late sub-pass's state, one by one (§2d point 7).
- The size of cargo's `CARGO_HOME`, the tarball and the vendored C (P3 asks for it).
- Whether the gate's other suites slow down after a first-run 12 GiB compile (P4).
- The plan's other sections that did not change, beyond what N1–N9 touch.

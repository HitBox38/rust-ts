verdict: APPROVE WITH CHANGES

Subject: the revised plan-m8 (`docs/plan-m8.md` and `docs/handoff/plan-m8.md` at `408b873c` on `t3/plan-m8-research`; diff against
`d36cdc8e`), re-checked against the first review (`docs/reviews/plan-m8.md` at `5a5f8beb`, findings F1–F11), root's three decisions
(`docs/state/history.jsonl`, 2026-11-15T22:38: "M8 scope", "M8 host capacity", "plan-m8 D16"), AGENTS.md and PORTING.md.
Lane `recheck-plan-m8`, read-only: this file is all I wrote to the tree. No gate, no suite, no build through either compiler. No
oracle component was added or removed. I downloaded the 2026-10-11 `clippy-preview` and `rustfmt-preview` tarballs again (SHA-256
equal to the manifest's `xz_hash`: `08d0af9f…`, `3ed6326d…`), unpacked them outside the toolchain and ran them by absolute path with
`DYLD_LIBRARY_PATH=<oracle sysroot>/lib`. Scratch, scripts and results are in `$RUST_TS_DATA/tmp/recheck-plan-m8/`. AC power; load
about 1.4; host at the start: 11.8 GiB free on the data volume, swap 8,702 of 10,240 MiB used, 10 swap files of 1 GiB in
`/System/Volumes/VM`, `kern.memorystatus_vm_pressure_level` 1.

The revision answers every finding and its numbers hold: I reproduced 452, 401 and 748 exactly. Four things must change before the
lanes they affect start:

- **§2d's mechanism does not fit clippy at the pin (N1).** clippy registers one combined early pass and one combined late pass,
  not about 400 passes. Upstream already skips late sub-passes whose lints are all allowed. So the env-var glue cannot work as
  written, and it is not needed for late passes. Without the review's `-W clippy::<annotated lint>`, 57 of the 871 files that have
  diagnostics become vacuous matches.
- **The env-var glue can leak into the gated `clippy-ui` (N2).** `RUST_TS_*` variables are passed through to both sides on purpose
  (`scripts/lib/env.ts`), and the gate does not refuse this one.
- **D9's "copy of the test tree" cannot move the baked-in path (N3).** `cargo_bin!` is `env!(…)`, an absolute path fixed at compile
  time.
- **D20 holds M8a's gate, not only the testsuite, until the owner acts (N4).** Once `cargo-build` is protected, D20 also holds every
  later gate until the owner acts.

## Questions 1–7 in brief

1. **F1–F11:** nine resolved, two partly resolved (F1, F5). See the table below.
2. **The decisions and the ratchet:** no direct contradiction. There are three gaps:
   - D19's "never protected" has no mechanism (N5).
   - D20 makes M8a's own gate wait on the owner. Root's "M8 host capacity" assumed only the testsuite would wait (N4).
   - The plan keeps `cargo-testsuite` as a report for a reason its own D9 removed (N8).

   Harness and scripts changes are all in named, reviewed batches. Withdrawals of racy cases follow the existing reviewed process
   (`yield1.rs`, integ-w60).
3. **`clippy-ui-lane`:** yes, a lane MATCH can be a `clippy-ui` failure. That is acceptable for a report, but only if the suite can
   never be protected (N5) and the variable cannot reach a gated suite (N2). The mechanism itself must be redesigned (N1).
4. **F3's numbers:** all three reproduced exactly, on the full sets (22 s and 9 s), not a sample.
5. **F4's numbers:** the named groups and cargo's own 119k reproduce from the pinned sources. The two "about" rows leave about 470k
   lines of the 2.13M graph unassigned (N7). The conclusion stands.
6. **Wave 41 on this host:** D20 blocks step 2 and every `cargo-build` run today. A restart alone would give about 21.8 GiB, just
   above the bar. Steps 1, 3 (except its end-to-end check), 4 (except its `cargo-build` proof), 5 and 6 can proceed, and so can all
   of wave 42 except `harness-m8c` (N4).
7. **New errors:**
   - stale pass architecture (N1);
   - leak path (N2);
   - baked path (N3);
   - gate interaction (N4);
   - unenforced never-protect (N5);
   - codegen ordering and the missing combined-pass files (N6);
   - unassigned dependency lines (N7);
   - the testsuite's report status (N8);
   - nits (N9).

## F1–F11

| Finding | Status | Evidence |
|---|---|---|
| F1 clippy measurable lane by lane | **Partly resolved** | §2d (plan :310–348), D14 (:678–683), D19 (:709), §6 (:552), §8 (:758–759) add a report-only `clippy-ui-lane` that lands before the first lint lane, and §9's trigger moves onto it. The suite and its role are right. Its mechanism is built on a pass architecture the pin no longer has, and it drops the review's `-W` (N1). The env-var glue needs fencing (N2) |
| F2 host capacity; measurement in wave 41 | **Resolved** (see N4 for the consequences) | D20 (:712–722): ≥ 20 GiB free and swap < 4 GB to start; a watchdog at < 4 GiB free or memory-pressure level 4 for 60 s, which kills by its own process group; and a gate preflight beside `batteryRefusal`. §8 wave 41 step 2 (:736–740) runs the measurement root-run and alone, front end first (`cargo check --tests`), as the review asked. The sysctl exists here (`kern.memorystatus_vm_pressure_level: 1`) |
| F3 upstream's test settings | **Resolved** | §2b (:271–286), §3b (:377–389), D10 (:652–660), D11 (:662–668). **Reproduced on the full sets**: 452 with `CLIPPY_CONF_DIR=tests` + `--crate-type=lib` (E0601 on 0), 401 with `CLIPPY_CONF_DIR=tests` only (E0601 on 90), and my 452 set equals the plan's `clippy-ui2-oracle.jsonl` set file for file; exits 149/869/1, p50 20 ms, 103 lib files. rustfmt 748 of 802, exits 788/15/1, 9 s, from an extracted tree with no `rustfmt.toml` in any ancestor directory and `HOME`/`XDG_CONFIG_HOME` empty. Its 15 exit-1 cases are `file_lines` 12 and `skip_macro_invocations` 3, as §3b says |
| F4 (a′) and deferring clippy costed | **Resolved** (N7 on the table) | §1e (:190–233), D1 (:579–583), §9 (:821–822). From `cargo-deps-lines.txt`: `gix*` 133.4k, toml stack 69.8k, clap stack 45.7k, git2/curl/rusqlite/hashlink/fallible 68.0k, tar/flate2/zlib-rs/crc32fast/filetime 32.5k, serde stack 52–61k (with or without `serde_derive`); cargo `src/` 107,831 plus 10.2k in `crates/` without `credential/`, so about 119k. "Reached" totals 334–464k from the rows, so 330–470k; ratios 1.5–2.1× of 220k and 2.1–3.0× of 157k, as stated. Deferring clippy: 38k + ~15k vendor, ~21 lanes, about 76% less porting. `all-static` exists at cargo `Cargo.toml:291` |
| F5 the testsuite oracle | **Partly resolved** | §4c (:508–517), D9 (:639–650), §6 (:536–537, :544, :567–569). ENV is out of the denominator; UNSTABLE comes from repeated oracle runs; the protected configuration is the oracle-built testsuite with the port-built `cargo`; 99%; a built `PATH`; module by module at `--test-threads=6` with the sandbox cleared; `CFG_DISABLE_CROSS_TESTS` exists (`cross_compile.rs:6`). But the "copy of the oracle-built test tree" cannot move a path that `env!` baked in (N3), and "never protected" has no mechanism (N5) |
| F6 incremental | **Resolved** | §4c (:483–485, :515–517), §5 (:526), D16 (:695–698), marked as root's decision, as recorded |
| F7 host C libraries | **Resolved** | §4a (:414–438), D15 (:685–693): `--features all-static` on both sides, a built `PATH` without `pkg-config`/Homebrew `curl-config`, build-script outputs and `otool -L` in the report, and `hostToolsId` in the key. Nit: `openssl-src` needs `perl` and `make` on that built `PATH` (`/usr/bin` has both) |
| F8 wave and lane order | **Resolved** (N6 on codegen) | D21 (:724–726) puts `tools-prep-m8` first. §2c (:298) adds 7 dispatch-contract lanes, `methods/mod.rs` 6,229 lines in two (I measured 6,229, and 16,626 for all `mod.rs` below `src/`). `cargo-fix-a` is limited to what a run reaches (:741–743) |
| F9 estimates and units | **Resolved** (nits in N9) | §4b (:455) 40–50 min at `-j1`; §6 gate time (:572–575); MiB/GiB in the header (:14–15); `rustc_interface` at 65.6% (:45, :116) |
| F10 serde | **Resolved** | D6 (:613–620): the reached part of `serde::de` is ported, and codegen is checked against the oracle's `-Zunpretty=expanded` |
| F11 D2 | **Resolved** | D2 (:585–592): hash-pinned tarballs on the oracle's `librustc_driver`, one explicit `--sysroot`, and a guard on `otool -L`. I checked: `clippy-driver` links `@rpath/librustc_driver-3bee00c5d9e363a9.dylib` and prints `rustc 1.101.0-nightly (6f5da406b 2026-10-10)` |

## New findings

### N1. HIGH (blocks `clippy-contract-a` and `harness-m8d`): §2d is designed for a pass architecture clippy no longer has at the pin, and drops the review's `-W`

**Evidence.**
- `clippy_lints/src/lib.rs:449–487` (`register_lint_passes`) makes four calls:
  - two `register_pre_expansion_lint_pass` (`EarlyAttributes`, `MacroBraces`);
  - **one** `register_early_lint_pass` of `CombinedEarlyLintPass`, with 51 sub-passes over 49 modules (`early_lint_methods!`, :492);
  - **one** `register_late_lint_pass` of `CombinedLateLintPass`, with 316 sub-passes (`late_lint_methods!`, :553).
- `combined_late_pass.rs:56–90` makes each late sub-pass an `Option`. It is built only if
  `is_active(&<T>::lint_vec())`, where `is_active` is `rustc_lint::is_lint_pass_required(tcx.skippable_lints(()), …)` (lib.rs:477–478).
- `skippable_lints` (`compiler/rustc_lint/src/levels.rs:115`) is every lint that is allowed at the crate root (the command line
  included) or allow-by-default, and that no owner raises. Exceptions: `eval_always` lints (clippy has one, `cognitive_complexity`)
  and lint-less passes, which always run (`rustc_lint/src/lib.rs:787–795`).
- rustc's own `late.rs:369–380` filters the same way.
- Early sub-passes are never skipped (`combined_early_pass.rs:13–15`).
- The port already has both pieces: `skippable_lints` (`src/rustc_lint/levels.ts:162`) and the filter (`late.ts:436–444`), with
  generated `lint_vec()`.

**Consequences for the plan.**
- §2a (:244–245), §2d (:312) and the original F1 say "`rustc_lint` runs every registered pass on every crate". At this pin that is
  wrong for late passes.
- §2d point 4 "wraps `LintStore::register_{early,late}_pass` … replaces each pass whose `get_lints()` are not all ported with
  nothing". There is one pass per kind, so that would drop the whole combined early pass, or the whole late pass, until the last
  lane.
- Dropping the early pass would also drop `FormatArgsCollector` and `AttrCollector`. Those are lint-less early passes whose
  `FormatArgsStorage` and `AttrStorage` the late passes read (lib.rs:465–481). That is exactly the shared state point 5 assumes
  away.
- `clippy-contract-a`'s file list (:296) also omits `combined_early_pass.rs` (92 lines) and `combined_late_pass.rs` (91), and D5's
  macro list omits `combined_{early,late}_lint_pass!`.
- For `clippy-ui` the picture is better than D14 says, because upstream skips late sub-passes whose lints are all allow-by-default.
  A case needs ported:
  - all early sub-passes;
  - the lint-less and `eval_always` late passes;
  - the late sub-passes that hold a default-on lint (497 of 835 lints) or a lint the file raises.

  The 338 pedantic, restriction, nursery and cargo lints do not block it.

**The `-W` was dropped.** The review asked for `-A clippy::all … -W clippy::<the lints the file annotates with //~>`. §2d point 3
(:327–330) keeps only the `-A` flags, "so a lint fires only if the file turns it on by attribute". Measured on the oracle
(`scripts/lane-probe.ts`, `out/lane.jsonl`; the same 1,019 files and argv as the plan's `clippy-ui2.ts`):

| Configuration | Files with ≥ 1 diagnostic | Of the 871 with diagnostics in `clippy-ui`: none left | fewer | Diagnostics in all |
|---|---|---|---|---|
| `clippy-ui` | 871 | – | – | 9,442 |
| §2d point 3 (`-A` groups) | 814 | **57** | **80** | 8,997 |
| plus `-W clippy::<each //~ lint>` | 866 | 5 | 6 | 9,432 |

Examples of the 57: `assertions_on_constants.rs`, which has `#![expect(clippy::eq_op, …)]` and 17 `//~` lines but relies on the
default level; `box_collection.rs`; `cast_slice_different_sizes.rs`. Once their lints are ported, each would MATCH with empty
output on both sides and test nothing. The progress measure §9's trigger reads would then overcount.

**Fix (amend §2a, §2d, D5, D14 and the contract file list before `clippy-contract-a`):**
- Run the lane suite with the `-A` groups **plus `-W clippy::<each //~ lint>`**.
- Let upstream's ported `skippable_lints` do the selection for late passes, on both sides alike. No glue and no environment
  variable are needed for them. An unported late stub is never built unless the file makes it active, and then exit 70 is the
  honest answer.
- Make the early sub-passes, the two pre-expansion passes, the lint-less collectors and `cognitive_complexity` a prerequisite group
  that is ported first. The early modules total at most 14.5k lines, counting whole directories for `attrs`, `doc`, `functions` and
  `misc_early`.
- Add `combined_{early,late}_pass.rs` to contract-a, and their macros to D5's generated list.
- Exclude cases where the oracle's lane output holds none of the file's annotated diagnostics. Five are left with `-W`.
- Eligibility (point 2) need not count lints that appear only in `allow` attributes. 255 files have some, and they would delay
  eligibility for no gain, because an active stub shows as UNPORTED anyway.
- Say that a lint in a multi-lint pass is measurable only when its whole pass is. `Methods` holds 164 lints, so no `methods-*`
  lane's ui cases become eligible until the last of the 8 methods lanes lands.

### N2. HIGH if the glue is kept: `RUST_TS_CLIPPY_LANE` can reach the gated `clippy-ui`

**Evidence.**
- `scripts/lib/env.ts` header: "Not scrubbed: … `RUST_TS_*`". `caseEnv` overlays the case's own env onto the caller's.
- `gateEnvRefusal` (`scripts/gate.ts:175`) refuses only `RUST_TS_FREEZE_LISTS`, `NODE_ENV` and the unit-step variables.
- The glue is read at run time by the one subject binary that the gated suites also run (D12).

So a root shell that exported the variable for a lane run, and then started a gate, would run the gated `clippy-ui` with
unported passes removed. Take a case where the oracle's full output has nothing from those passes. It then MATCHes and becomes
protected, although the port never ran them. That is the "unported path into a silent MATCH" §2d's last paragraph says it avoids.

It also puts harness-selection logic under `src/` (D18's exception). The porting-lane review of `clippy-contract-a` is not the
harness review AGENTS.md §2 asks for.

**Fix:** prefer N1's design, which needs no variable. If any lane-only switch remains, do all of the following:
- make it a separate subject entry (`clippy-lane`) that no gated suite runs, not a run-time variable;
- or else add it to `gateEnvRefusal`, set it to `null` in every other clippy suite's `Case.env`, put it in the lane suite's oracle
  key, and give it a unit test;
- in either case, have its harness side reviewed in `harness-m8d`.

### N3. MEDIUM (binds `harness-m8c`): D9 cannot copy the test tree, because `CARGO_BIN_EXE_cargo` is baked in as an absolute path

**Evidence.**
- cargo `tests/testsuite/utils/mod.rs:18–21`: `cargo_exe()` is `snapbox::cmd::cargo_bin!("cargo")`.
- In snapbox 1.2.2 (the lock's version and checksum, `8de56eb4…`), `src/macros.rs:158–159` defines it as
  `Path::new(env!(concat!("CARGO_BIN_EXE_", $bin)))`, a compile-time absolute path. The run-time lookup (`cmd.rs:888`) is a
  different function that the testsuite does not call.
- D9 (:641–642) says it "copies the port-built `cargo` … into a copy of the oracle-built test tree at the baked-in path". A copied
  tree still runs the binary at the original path.
- The only way to use one oracle build is to overwrite the oracle-built `cargo` inside the oracle's cached tree. The sides could
  not then run concurrently, and an interrupted run would leave the port's binary where the next oracle run expects the oracle's.

**Fix:** build the oracle testsuite once per side, into two fixed target directories. That costs 64 s and 2.1 GB each, oracle-only.
Then replace `debug/cargo` only in the port side's tree. Key and lock each tree, and check before each run that the file at the baked
path has the hash of the side's binary.

### N4. MEDIUM (owner, root): D20 holds M8a's gate until the owner acts, and once `cargo-build` is protected, every later gate too

**Measured now.**
- 11.8 GiB free.
- Swap 8.7 of 10.0 GiB in use.
- Swap files: 10 × 1 GiB.

Both of D20's start conditions fail. A restart (the owner's action, on a host shared with another project) returns the swap
files' 10 GiB, giving about 21.8 GiB free. That clears 20 GiB by under 2 GiB, before anything else grows.

**Consequences.**
- **Blocked until then:**
  - wave 41 step 2 (`m8-measure`);
  - `cargo-fix-a`'s end-to-end check through `cargo-build`;
  - `harness-m8a`'s proof run of `cargo-build` on both sides;
  - `harness-m8c`, which needs `cargo-build`'s kept binary;
  - any gate that runs `cargo-build`.
- **Can proceed:**
  - `tools-prep-m8`;
  - `cargo-fix-a`'s code and per-crate proofs (`crc32fast`, `sha1` and `sha2` alone are small compiles);
  - `harness-m8a`'s code, its review and its `rg-build`/`rg-behaviour` before-and-after proof (D20 does not cover rg-build);
  - the contracts and `codegen-tools-m8`;
  - all of wave 42 except `harness-m8c`;
  - waves 43–45.

  So M8b and M8c are not held up. M8a is.
- **The gate.**
  - The gate runs every suite that has a baseline (`protectedSuites()`, `scripts/gate.ts:635`), and accept refuses a run that
    skipped one (:937–938).
  - Once `cargo-build` is protected, D20's preflight (< 20 GiB) refuses **every** gate, and with it every accept for the porting
    waves.
  - Heavy suites run last (:681), so `cargo-build` starts after about 7 h of other suites, when swap is highest. D20 checks only at
    the gate's start, and its swap rule is not in the gate's preflight.
  - D20 does not say what a watchdog stop inside a gate is. As written it would be a lost protected case.
- **Tension with root's "M8 host capacity".** That decision gates M8a on `cargo-build` + `cargo-smoke` "until the owner frees
  about 20–30 GiB", which implies `cargo-build` itself can run now. D20 makes the threshold for `cargo-build` the same as the
  210k-line measurement's. The plan's own measurement of the `cargo` crate moved free disk from 11 to 4.5 GiB, about 6.5 GiB.

**Fix (root, before `harness-m8a`):**
- Set per-run thresholds from measurements. For example, `cargo-build` at 14 GiB, which is the measured 6.5 GiB plus the 4 GiB
  floor plus margin; `m8-measure` at 20 GiB.
- Check the threshold when the heavy suite **starts**, not only at the gate's start. Consider running `cargo-build` first, when
  swap is lowest.
- Define a watchdog stop in a gate as "run not acceptable, re-run", as a battery spell is treated, not as a loss.
- Record whether the owner's restart is a standing precondition, and correct §9's "M8a alone is 3–5 days" to depend on it.
- State in wave 41 step 2 where its watchdog lives before `harness-m8a` lands. A scratch script under `$RUST_TS_DATA/tmp` is fine
  for a root measurement.

### N5. MEDIUM: "never protected" (D19, ENV) has no mechanism, and accept protects every MATCH of every suite it ran

**Evidence.** `gateAccept` (`scripts/gate.ts:940–958`) adds every MATCH of every suite in the run to that suite's baseline. A suite
gets into a run either by having a baseline or by `--suites`. `harness/suites.ts` has no report-only or never-protect field. Only
`unstable` cases are refused (:950–952).

So `clippy-ui-lane` stays unprotected only if nobody passes it to `--suites`. Promoting report suites by naming them in a gate is
root's normal practice (plan-m6 A9). ENV is safe only if the harness gives it a status that is not MATCH.

**Fix (harness-m8c/d, scripts batch):**
- Add a `Suite` field (for example `neverProtect`) that makes `gate run` refuse the suite, or makes `accept` skip it with a note,
  with a unit test.
- Give ENV its own status in difftest, which `matchesOfRun` never returns.

### N6. LOW–MEDIUM: wave 41 lists `codegen-tools-m8` after the contract lanes that need its output

`clippy-contract-a` registers every lint (`declared_lints.rs`, `lib.rs`), and `clippy-contract-b` holds `define_Conf!`. Both need
what D5 generates:
- `declare_clippy_lint!` statics and `LintInfo`;
- `impl_lint_pass!`'s `lint_vec`;
- the combined-pass macros (N1);
- `define_Conf!`;
- the `sym` list.

Yet §8 lists `codegen-tools-m8` as step 6, after the contracts in step 5. §2d point 6 also has the pass ↔ lint table come from it.

**Fix:** make `codegen-tools-m8`, or its clippy-macro half, merge before `clippy-contract-a/-b` integrate, as `tools-prep-m8` does
for markers. Or say that the contracts call `unported` for generated items until it lands.

### N7. LOW: §1e's dependency table leaves about 470k of the 2.13M lines unassigned

The named rows reproduce (F4 above). The remaining 1,729k are covered by two rows: "about 540k" (hashes, time, regex, …) and
"about 720k" (platform), together 1,260k. My classification of the remainder gives about 807k of non-platform crates, the largest
being `jiff` 99k, `regex-automata` 65k, `regex-syntax` 58k, `time` 35k and `unicode-normalization` 24k. That leaves about 870k
platform and build-time crates.

If the reached share of the larger bucket scales with it, the "rest" estimate grows from 60–110k to about 90–165k. (a′) then
becomes about 360–520k: still well above (c), so the recommendation does not change.

**Fix:** assign every package to a row (the rows should sum to 2,134,831) and widen the estimate, or say the table is partial.

### N8. LOW (root): `cargo-testsuite`'s reason to stay a report no longer applies under the plan's own D9

Root's "M8 host capacity" kept the testsuite as a report because of the port's build of the 210k-line test crate. Under D9 the
protected configuration never compiles that crate with the port. Its costs are:
- the oracle's 64 s / 2.1 GB build (two of them, per N3);
- a 12-minute run with a sandbox cleared per module.

That is far less than `cargo-build` itself, and it is the suite that actually tests the port-built cargo.

**Fix:** root may revisit the decision and let `cargo-testsuite` join M8a at ≥ 99% once `cargo-build` runs, independent of the
owner freeing 20–30 GiB. Only `cargo-testsuite-port` needs that.

### N9. Nits

- Swap figures are still in "GB" (:18–19, :456, :714–716, §5's "12 GB on core") under a header that says MiB/GiB. The peak
  disagrees between :18 ("14 GB") and :456 ("6.9 → 13 GB").
- §2b (:284) says "every committed baseline but 14". 143 of the 1,019 have no `.stderr`, and they match only because the empty
  output equals "no file". Say so in D10's proof.
- §2d point 2 does not say how group names in attributes (`#![warn(clippy::pedantic)]`) count as mentions. Three of the 1,019 have
  one. Expand groups or exclude those files.

## What I did not check

- Anything through the port: no build, no difftest, no `m8-measure`.
- `--features all-static` on either side, and `openssl-src`'s build time.
- Which late sub-passes are lint-less or hold only allow-by-default lints, one by one. I counted lints by group: 497 default-on,
  338 allow-by-default.
- rustfmt's 33 unclassified differences, and ui-toml, ui-cargo and the rustfmt emit modes.
- Whether a restart actually returns the 10 GiB of swap files on this host, and for how long the headroom lasts.
- (a′)'s reach: the remainder is classified by package name, not traced.

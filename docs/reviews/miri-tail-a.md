# Review: miri-tail-a (independent reviewer, read-only)

Branch `t3/port-miri-tail-stops`, head `02e53812`, base `1d221bff`. Upstream at the pin, oracle `rustc +nightly`.

## Verdict: APPROVE WITH NITS

I looked for a stop replaced by an answer that only fits the tested inputs, and did not find one. Every value I tried
either matches the oracle byte for byte or stops `unported`. No protected case I ran changed. No finding against this lane is above low.

| evidence (all on `02e53812`) | result |
|---|---|
| `--print cfg` + stderr, `-C target-feature`, 6 targets, 467 single features and lists | 467 identical |
| `--print cfg` + other `--print` kinds, `-Z sanitizer`, `-C llvm-args`, 220 random feature lists (910 of 916 ran) | 628 identical, 246 UNPORTED, 36 DIFF, all pre-existing `--print sysroot`/`target-libdir` (O1) |
| real compiles (`--emit=metadata` etc.): `-C lto`, `-l`, `-C target-feature`, `-Z sanitizer`, `-C llvm-args`, `-Z randomize-layout` | 729: 669 identical, 60 UNPORTED, 0 DIFF; every emitted file byte-identical (286 runs, rmetas included) |
| `-Zrandomize-layout`/`-Zlayout-seed`, `#[rustc_dump_layout(debug)]` on about 40 types, 11 seeds, 2 targets, on and off | 44 identical |
| target modifiers against an oracle-built `no_core` dep without the flags | 30 identical, including the `mixing -Zsanitizer` errors |
| same, dep with the flags | 60 UNPORTED (`Decodable for TargetModifier`), a loud stop |
| protected run-pass-miri with `-O`, LTO or codegen-units flags: all 92 ids (substring filters added 1 case) | 93/93 MATCH |
| protected run-fail-miri with `-O`: all 66 ids (filters added 8 cases) | 74/74 MATCH |
| `--sample`: mirdump-ui 200, tydump-ui 200, thirdump-ui 100, check-ui 100 | 600/600 MATCH |
| `--sample 100` run-fail-miri | 98 MATCH, 2 TIMEOUT, neither a regression (see 7) |
| `bunx tsc --noEmit -p .`; `coverage.ts --check --offline` | 0 errors; `markers ok (24402; vendor 5076; library 584)` |
| the lane's tests + `print.oracle.test.ts`, `RUST_TS_REQUIRE_PROBES=1` | 193 pass, 0 fail |

## What I checked, by question

**1. `-C target-feature`: sound for every value, not only the tested ones.** Upstream's `global_llvm_features(sess,
for_cfg = true)` skips the flag (llvm_util.rs:770), so LLVM's answer does not
depend on it; `internal_target_features` handles it in Rust afterwards. The table is `T = ⋃ implied(f)` over the features
LLVM reports. The port's base set is `⋃ implied(f)` over `f ∈ T` with `to_llvm_features(f)` defined. If `T` is closed
under `implied_target_features`, the two sets are equal, so the base set is exact and the flag is applied to the same
set upstream applies it to. I checked closure with the port's own functions: 0 violations on all 6 targets.
- Source: `tools/codegen/target-config.ts` with `tools/codegen/target-config/probe.rs`, a rustc_private probe, both
  committed. `--check` says up to date against the pinned oracle.
- Other inputs to the LLVM answer, walked through `global_llvm_features`: `-C target-cpu`, `-Z llvm-target-feature`,
  retpoline, fixed-x18, hwaddress and wasm unwinding all stay stops. `MACOSX_DEPLOYMENT_TARGET` (in the versioned triple)
  gives identical output at 10.12, 11.0 and 14.0.
- Tried: `+avx2`, `-sse2`, `-x87`, `+soft-float`, unknown names, missing prefix, empty items, `crt-static` both ways and
  both orders, implied and inverse-implied chains, tied `paca`/`pacg`, LLVM-name suggestions (`+pclmul`, `+cx16`,
  `+fullfp16`, `+pauth`), x86 names on arm and the reverse, repeated flags. No difference in cfg or diagnostics.
- A target the table does not cover is loud: unported built-in specs stop first (`riscv64gc-unknown-linux-gnu`,
  `i686-unknown-linux-gnu`, `x86_64-unknown-linux-musl`, `thumbv7em-none-eabihf`, `aarch64-linux-android`,
  `wasm32-unknown-unknown`); a JSON target stops at `TargetTuple::from_path`, exit 70.
- `update_target_reliable_float_cfg` matches upstream arm by arm. The only feature it reads is `vsx`, on PowerPC64, which
  none of the 6 targets is, so `-C target-feature` cannot change these flags here.

**2. `-C llvm-args`: exact and invisible.** `parse_list` splits on whitespace, so `join(" ")` cannot collide. Both values
are accepted silently on all 6 targets. Reordered, repeated or combined values, `--enable-tail-merge=0`,
`-inline-threshold=0`, `=1`, `--help`, `--version` and `-bogus` all stay `unported`, even where the oracle accepts
the value. Neither value collides with the args `configure_llvm` adds itself. The flag is tracked, so it reaches the
SVH: rmetas with it are byte-identical to the oracle's.

**3. `-Z sanitizer`: confirmed.** `sanitizer_features_by_flags` (target_features.rs) adds a feature only for
`HWADDRESS`, not `KERNELHWADDRESS` (upstream's comment says so), and nothing else in `configure_llvm` or
`global_llvm_features` reads sanitizers. All four `target_modifier_consistency_check` fns match upstream line by line;
the stand-in's flag values and `MUTUALLY_EXCLUSIVE` equal `rustc_structures`'. The `r = None` paths ran against the oracle.
The `r = Some` paths are not reachable yet, see "Not checked".

**4. `-C lto`: as upstream, and nothing downstream sees a default.** `each_linked_rlib`, `ignored_for_lto` and the
`CrateInfo::new` block match upstream. Dropping the error is upstream's `drop(..)`. Nothing reads
`each_linked_rlib_file_for_lto` yet; `exported_symbols_for_lto` gets the real list.

`thin_lto_supported`: confirmed. session.rs:449 is `pub thin_lto_supported: bool = true` under `derive(Default)`, and
upstream's `DummyCodegenBackend` and Miri do not override `init`. Only `MiriCodegenBackend` (src/miri/bin/miri.ts:244) and
`DummyCodegenBackend` (src/rustc_interface/util.ts:250) use the provided `init`. The placeholder `false` at
src/rustc_session/session.ts:1168 is overwritten before `validate_commandline_args_with_session_available`, as upstream
passes it to the constructor. No test in tests/ui uses `-Zcodegen-backend=dummy`. The effect is `Session::lto` giving
`ThinLocal` under Miri with `-O`, which is why I ran every protected Miri case with those flags instead of a sample.

**5. `parse_native_lib`: faithful.** Line by line against upstream, including arm order and every error text. The PORT
for `split_at_checked(1)` is correct: an empty modifier and a multi-byte first char (`static:é=foo`, `static:+é=foo`) take
the same fatal arm, as the oracle shows. 54 values in 5 settings plus 11 multi-`-l` combinations through `Collector`
(renames, overrides, `--crate-type=staticlib`): 0 differences, rmetas identical, so `NativeLib` hashes correctly in the
SVH.

**6. `-Zrandomize-layout`: identical for every input that matters.**
- `seq/increasing_uniform.rs`: `diff` of 0.9.3 and 0.10.1 is 3 lines, trait names only. `shuffle` and `partial_shuffle`:
  `diff` of the two sources is empty. `distr/uniform.rs` and `distr/uniform_int.rs`: trait
  names, comments, `simd_support` bounds, serde test crates. `RngExt::random_range` is the same text as 0.9.3's
  `Rng::random_range`. The only behaviour switch in those files is the `unbiased` feature; no compiler crate enables it.
- Probe rebuilt from `docs/handoff/miri-tail-a-probe/` through upstream's lock (resolved rand 0.9.3, rand_core 0.9.3,
  rand_xoshiro 0.7.0): output byte-identical to `shuffle.oracle.txt`. `.crate` sha256 prefixes equal Cargo.lock's for
  rand 0.9.3 (`7ec09565`), rand 0.10.1 (`d2e8e8bc`), rand_core 0.9.3 (`99d9a139`), rand_xoshiro 0.7.0 (`f703f466`).
- The other path (`self.len() >= u32::MAX`) is unreachable for a field list.
- PORTING 5b asks for the version in the lock, and rustc_abi's is 0.9.3, so this is a deviation. It is the right call
  (`scripts/coverage.ts` holds one version per crate and the logic is identical), but it needs a decision: N1.
- Write-back: upstream's `optimizing` is `&mut in_memory_order.raw[..end]`, so the shuffle is in place; the port's is a
  copy, so the shuffle branch must write back. The added line sits inside `repr.can_randomize_type_layout()`, so nothing
  changes with randomization off: the dumps with the flag off also match the oracle.

**7. Protected results.** A flag reached only by protected cases that stopped at base cannot lose anything. The real
exposure was `thin_lto_supported` (above) and code on the default path: `target_config` computing what it used to read,
`Session::lto`, and two new imports in `rustc_abi`. Samples and full flagged runs show no change.
- The 2 run-fail TIMEOUTs: `tests/ui/panics/panic-in-ffi.rs` (protected) and `tests/ui/test-attrs/terse.rs` (not). Rerun
  alone at load ~30 both still hit the limit, so I ran them with a longer one on both sides. They are slow at base.
- User CPU, base vs head, run alternately at load 8-10: `panic-in-ffi.rs` 55.1, 60.6 vs 60.4, 56.5 s, same stderr length.
  `terse.rs` 173.5 vs 193.9 s (one pair, under load, unprotected). Through difftest: `bycopy_untupled.rs#opt` 6.7, 6.2 vs
  6.7, 6.2 s; `mir/issue-74739.rs` 5.8, 5.6 vs 5.8, 5.2 s; mirdump 2.2, 2.2 vs 2.2, 2.2 s; tydump 1.9, 1.9 vs 1.9, 2.0 s.
  No regression.

**8. `harness/scope.json`:** one added entry and the comma it needs. Only `scripts/coverage.ts` reads the file.
`crate-src.ts rand_xoshiro --offline` resolves it. Vendor markers pass `--check`; I read each generator and helper
against the crate source and the `common.rs` macro lines (18, 46, 174) are right, as are `SliceRandom`'s 459 and 470.

## Findings

All low. None blocks merging.

- **N1. src/vendor/rand/seq/slice.ts:78,88; src/rustc_abi/layout.ts:1223. Low (process).** `shuffle` comes from rand
  0.10.1 where PORTING 5b says rustc_abi's locked 0.9.3, and `ORACLE_ACCEPTED_LLVM_ARGS`
  (src/rust_ts/codegen_backend.ts:42) is a new kind of allowlist. Neither is recorded: `state.ts summary` has no decision
  on either. Scenario: a later lane "corrects" the version, or adds a value to the list without the source check, with
  nothing to read. Fix: root records both decisions; the handoff's item 4 asks for this.
- **N2. src/vendor/rand_xoshiro/common.ts:86. Low.** The comment cites `rand_core-0.9.3/src/le.rs:29` for
  `read_u64_into`; the fn is at line 35. The code is right. Scenario: this is what having no `crate:` marker costs, as
  `--check` cannot see these four citations; a later reader lands on the wrong fn. Fix: correct the line. A lasting fix
  (rand_core 0.9.3 as a vendor entry) needs a `scripts/coverage.ts` change.
- **N3. src/rustc_metadata/native_libs.ts:6-7. Low.** The comment says `-l` is unported and "the list is always empty
  when this runs". Now false: `Collector` runs with real entries and matches the oracle. Scenario: someone removes
  "dead" handling on this comment's word. Fix: delete the two lines (owner, per the handoff).
- **N4. src/rustc_driver_impl/print.oracle.test.ts:184,187. Low.** Both `pending` entries name stops that no longer
  exist. They pass through the else arm, but `pending` also accepts exit 70 with that exact text. Scenario: a later change
  reinstates the `-C target-feature` stop; the test passes while the case regresses to UNPORTED. Fix: make both `exact`.
- **N5. src/vendor/rand_xoshiro/shuffle.oracle.txt, docs/handoff/miri-tail-a-probe/. Low.** The fixture's source is in
  `docs/handoff/`, unregistered in `tools/probes`, and nothing rebuilds it. It reproduces today. Scenario: at a re-pin that
  moves rand 0.9.x or rand_xoshiro, the fixture goes stale with no signal. Fix: register it in a harness batch, with
  vendor-rand's queued `randstream`.
- **N6. `tests/ui/sanitizer/cfi/coroutine.rs#cfi`. Low (gate risk).** 33.9 s user, 22.3 s wall at load ~10, exit 0, and
  TIMEOUT twice at load 30-45. This confirms the handoff. It is not yet protected, so once accepted it can be lost under a
  loaded gate, and a lost case blocks the revision. Fix: accept it from a quiet gate, or give it to miri-perf.

## For root, not this lane

- **O1. src/rustc_session/filesearch.ts:166. Med, pre-existing.** With no `--sysroot`, `--print sysroot` prints
  `<rust-ts: default sysroot unported>` and exits 0; `--print target-libdir` builds a path on it. Same at base. It is the
  kind of wrong answer this review was looking for, and the lane only makes it reachable with more flags. It should stop.
- **O2. `tests/ui/panics/panic-in-ffi.rs`. Pre-existing.** Protected, 55-60 s user and 48-56 s wall at load 8-10 on base
  and head, against a 60 s limit. It matched at the last gate; a busy gate can lose it. For miri-perf.

## Not checked

- The gate, full suites and full `bun test ./src`, per the brief. The handoff's failing `harness/compiletest.test.ts` test.
- `consistent` with `r = Some`: a dep carrying target modifiers stops at `Decodable for TargetModifier`, and encoding stops
  too. Those branches and `target_cpu` were read against upstream, never run. They become reachable when that derive lands.
- Anything behind real codegen or linking: `-C llvm-args` effects, LLVM's own warnings for `+bogus`. rust-ts stops first.
- `hwaddress`, `-C target-cpu` and the other stops the handoff lists: I checked only that they stop.
- The Windows host.
- 6 of the 916 cases of the second matrix: a time limit killed the run. All were `--print cfg` random feature lists.
- Raw outputs of the first three matrices were lost when the host rebooted during this review. The counts above are from
  my session. The real-compile matrix, the Miri runs and the samples were run after the reboot.
- Most samples ran at load 30-60, so they are evidence on output, not on timing. Timing is the CPU figures in 7.

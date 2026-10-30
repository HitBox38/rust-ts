verdict: APPROVE-WITH-NOTES

Reviewer: independent, read-only. Batch `git diff main...lane/passes-reachable` (fa14dd81; 3 commits, 17 files).
No open STOP. GATE_RUNNING absent throughout.

## What was checked

- **config.rs `mod dep_tracking` (config.rs:3364-3606) vs config.ts `dep_tracking`.** Checked each impl in order: the trait (3400), the
  via-hash macro (3411), `Option<T>` (3419: i32 literals 1/0), the 2- and 3-tuple impls (3510/3529: i32 0/1/2), `Vec` (3545:
  usize len, usize index, elem), `FxIndexMap` (3560: len, then key/value in insertion order), `OutputTypes` (3575: values hashed only when
  `!for_crate_hash`) and `stable_hash` (3592: usize key length, `str` hash, sub-hash, keys in BTreeMap order). All match.
  The via-hash table has every type of the upstream `impl_dep_tracking_hash_via_hash!` list. The derived `Hash` impls
  spelled out for each type match upstream:
  - the variant order of every hand-built discriminant table: CFGuard, CFProtection, OptLevel, LtoCli, InstrumentCoverage,
    FmtDebug, DebugInfo, DebugInfoCompression, MirStripDebugInfo, SplitDwarfKind, ResolveDocLinks, NextSolverConfig,
    PAuthKey, WasiExecModel, Polonius, FunctionReturn, UnstableFeatures, SourceFileHashAlgorithm, AutoDiff, Offload, and
    the 11 `target_spec_enum!` / `OnBrokenPipe` enums in rustc_target spec/mod.rs;
  - the explicit discriminants of CollapseMacroDebuginfo;
  - the field order of CoverageOptions, InstrumentMcountOpts, InstrumentXRay, LocationDetail, PacRet, BranchProtection,
    PatchableFunctionEntry, CodegenRetagOptions, RustcVersion, Align and NativeLib;
  - the hand-written `Hash` impls: TargetTuple (tuple.rs:37: a u8 tag, path_for_rustdoc skipped), RealFileName (reuses
    rustc_span's port) and Hash64 (`write_u64`);
  - the bitflags types (SanitizerSet u16, RemapPathScopeComponents u8).
  None of these enums has a `#[repr(..)]` that would change the width of the discriminant write.
- **options.rs macros vs the generator.**
  - `insert!` (29): set, then panic on a duplicate.
  - `hash_opt!` (40): UNTRACKED/SUBSTRUCT emit nothing; TRACKED inserts; TRACKED_NO_CRATE_HASH inserts only when
    `!for_crate_hash`.
  - `hash_substruct!` (51): after `stable_hash`, in declaration order, the `Hash64` hash of the sub-struct's hash.
  - The group `dep_tracking_hash` fns (609) have no substruct step.

  `tools/codegen/options.ts` `dth()` is correct in general, not only for the cases it fixed: `()` maps to unit, only
  2-/3-tuples, only `NonZero<usize>`, and an unknown generic or a type outside the via-hash list is an ERROR. UNTRACKED
  options never ask for an impl, as upstream, where `hash_opt!` [UNTRACKED] needs no trait impl.
  `bun tools/codegen/options.ts --check`: up to date.
- **svh.rs** (5 fns) vs svh.ts: `new`, `as_u128`, `to_hex`, `as_fingerprint` and Display, plus the derived Debug,
  Decodable and StableHash. Logic is equivalent: `as_u128` = `f1 << 64 | f0` (fingerprint.rs:71) and `as_fingerprint`
  inverts it. Markers are correct.
- **reachable.rs** (16 fns) vs reachable.ts: compared function by function.
  - Order, match arms and the `bug!` text are the same.
  - The `Static { nested: true }` / Const / AssocConst / Static / default dispatch in `propagate_item` is the same.
  - `propagate_from_alloc` handles every `GlobalAlloc` variant, including the manual `visit_def_id(def_id, "", &"")`.
  - `check_item` / `has_custom_linkage` keep the conditions in the same order.
  - `reachable_set`'s library crate types are Rlib/Dylib/ProcMacro/Sdylib, the seed uses
    `ReachableThroughImplTrait`, and lang items are added.

  `LocalDefId` is a branded number, so `Set<LocalDefId>` membership is by value. All 17 marker lines verified. The
  provide order in lib.ts matches rustc_passes lib.rs:45.
- **Out-of-lane edits.**
  - `rmeta/decoder.ts`: the stand-in became a re-export of svh.ts.
  - `get_crate_hash` uses `Svh.new`.
  - `hir/map.ts`: the unported `Svh_new` / `stable_hash_Svh` shims were removed. `crate_hash` and `legacy_crate_hash` now
    return real Svh values, and the remaining `local_crate_hash` unported is unchanged.
  - The codegen JSON maps changed one entry each.
  - `queries.gen.ts` and `decodable.gen.ts` are regenerated; the diffs are only the Svh type/debug/stable_hash and import lines.

  All are mechanical and correct. `debug_Svh` now uses `debug_struct`, so `{:#?}` is right; that is an improvement over
  the old single-line stand-in.
- **harness/, scripts/, harness/baseline**: untouched (diffstat).
- **Commands run** (scratch worktree, since removed):
  - `bunx tsc --noEmit -p .`: clean.
  - `bun scripts/coverage.ts --check`: markers ok.
  - Coverage: config.rs 131/136, options.rs 100/100, svh.rs 5/5, reachable.rs 16/16, as the handoff claims.
  - `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_session/dep_tracking.oracle.test.ts`: 9 pass.
  - Samples (`RUST_TS_AGENT=rev-pr`): mir `--sample 60` gave 60/60 MATCH; tydump-ui `--sample 60` gave 60/60 MATCH. No lost
    MATCH, consistent with the handoff's 300-case samples.
- **Extra probe-vs-port runs** (my own argv, through the probe and the port's run.ts; not committed). Every case that
  reached the hash printed byte-identical output:
  - `-Zpatchable-function-entry=3,1` and `=5`;
  - `-Zcrate-attr` x2;
  - `-Zmerge-functions=trampolines`;
  - `-Zinstrument-mcount=fentry`, `-Zinstrument-xray=never,skip-exit`, `-Zmir-include-spans`;
  - `-Zremap-cwd-prefix`, `-Zsimulate-remapped-rust-src-base`;
  - `-Zinline-mir-threshold`, `-Zcross-crate-inline-threshold=12` (`InliningThreshold::Sometimes`);
  - `-Zmetadata-crate-hash=no`, `-Zfmt-debug=none`, `-Zdebuginfo-compression=zstd`;
  - `--crate-type=proc-macro,dylib`, `-Csplit-debuginfo=unpacked`, `-Cforce-frame-pointers=non-leaf`, and others.

  The non-matching runs all stop at pre-existing, unrelated `unported(...)` driver paths (llvm_util configure/target_config,
  rustc_thread_pool, blake3, `-l` parsing), not in the hash code.

## Probe sign-off (tools/probes/optshash): APPROVED

- It is sound. It runs the pinned nightly's own `rustc_driver::compiler_entrypoint`, applying exactly the `config`
  effect of rustc's `TimePassesCallbacks` (rustc_driver_impl lib.rs:167: `trimmed_def_paths = true`, unconditional, and
  a TRACKED option).
- It calls the same `sess.opts.dep_tracking_hash(true/false)` the encoder seeds the crate hash with. It calls it from
  `after_crate_root_parsing`, after `build_session`; `Session.opts` is not mutated after that, so the value equals the
  one at metadata-encode time.
- run.ts mirrors it through the ported driver.
- The probe is used only by a src/ test, not by harness/ or scripts/, and the test is a visible skip when the probe is
  not built.

## Findings

1. src/rustc_session/dep_tracking.oracle.test.ts:76-110 (non-blocking). The handoff says the 7 option sets exercise
   "patchable entries", but no case passes `-Zpatchable-function-entry`. I checked it ad hoc and it matches the
   oracle. Suggest adding it (for example to `codegen-misc`) so `hash_PatchableFunctionEntry` is pinned by the test,
   and correcting the handoff wording.
2. tools/codegen/options.ts:399-410, 573-576 (non-blocking). `DTH_VIA_HASH` and the `via_hash` keys go by the type's
   last path segment, for example `lint::Level` as `Level`. A future tracked option whose type shares a last segment
   with a listed type from another crate would be bound to the wrong impl without the generator noticing; usually tsc
   would catch the type mismatch, but not when the TS shapes coincide. Today there is no such collision. Consider
   keying by the full path text the generator already has (`ty.text`).
3. src/rustc_passes/reachable.ts (whole file) (non-blocking). `reachable.provide` is now enabled, but no test executes
   `reachable_set`; only tsc checks it. Its query value stays `unknown` in queries.gen.ts, and symbol_export.ts casts it.
   Root may want a typemap entry `LocalDefIdSet -> Set<LocalDefId>`, and an execution test once encoder or symbol export
   reaches it. The logic matches upstream line by line (see above).
4. src/rustc_session/config.ts `hash_NativeLib` (non-blocking, informational). It hashes `name` and `new_name` and then
   throws `unported(...)` for `NativeLibKind`. That is harmless, because the throw aborts the hash, and it is
   unreachable today: `-l` parsing is itself unported, as confirmed by the `-l foo` run. Both `unported` gaps
   (NativeLibKind, LanguageIdentifier) are correctly marked and listed in the handoff.
5. src/rustc_session/dep_tracking.oracle.test.ts:62-68 (non-blocking, informational). The D1 core case compares a hash
   that depends on the checkout path, because `working_dir` is TRACKED. Both sides use the same cwd, so the test is
   sound, but the printed value (`a66f5a6641fe6032`) is machine-specific and should not be recorded as a constant
   anywhere. The handoff's sysroot finding (only the incremental hash differs without `--sysroot`, through
   `real_rustc_dev_source_base_dir`) is correct and does not affect the crate hash.

verdict: APPROVE-WITH-NOTES

Lane crateinfo-symbols, branch `lane/crateinfo-symbols` (f17611de), base main adaa9d4a+. Reviewed `git diff main...lane/crateinfo-symbols`
(11 files) against upstream at the pin.

## What was checked
- middle/exported_symbols.rs: all 3 fns and 4 types against :12/:18/:26/:38/:49/:62/:86. Variant order, field order, doc comments and
  `symbol_name_for_local_instance` arms (incl. the ThreadLocalShim `Instance { def: Shim(ThreadLocal), args: empty }`) match.
  `metadata_symbol_name`: `{:08x}` → `lower_hex_StableCrateId(.., PLAIN).padStart(8, "0")` is correct (LowerHex forwards to the u64;
  PLAIN has no `#`, so no `0x`).
- back/linker.rs :1625–:1800 (7 fns): order, control flow, comments, the `ProcMacro`/`Dylib` + `!is_like_wasm` metadata-symbol rule, the
  `linked_symbols` crate-type and LTO matches, and the `||` grouping in the `linked_symbols` filter
  (`(below && !builtins) || used || std_internal`) all match. `formats[&crate_type]` → `get` + panic is a faithful IndexMap index.
- back/lto.rs :89 `exported_symbols_for_lto`: thresholds per `Lto`, `info.used` filter, local crate first then each linked rlib,
  allocator shim names only under `Rust`. Query order is the same (Rust's `.chain(tcx.exported_generic_symbols(cnum))` evaluates both
  queries before iterating, as the TS spread does).
- base.rs :376 `wants_wasm_eh`, :665 `allocator_kind_for_codegen`, :685 `needs_allocator_shim_for_linking`: logic matches; placed in
  upstream order before `collect_eii_linkage` (:954).
- symbol_export.ts shims (:603, :654, :755, :808, :882): line numbers and signatures match upstream; bodies are `unported`, nothing guessed.
- codegen_backend.ts (rustc_codegen_llvm, out of scope, so line comments instead of markers): every cited line is right —
  `TargetFeatureFoldStrength` :178, `LLVMFeature` :195, `new` :201, `with_dependencies` :205, `to_llvm_features` :239, `get_version` :469,
  `llvm_features_by_flags` :663, `global_llvm_features` :688. `to_llvm_features` matches arm-for-arm (all renames, both `None`
  filters per arch, nvptx `major >= 24` guards, `sse4.2`→`EnableOnly(crc32)`, `apxf`→`egpr` + 7 `Both`). The closure's
  dependency filter `Both || (enable && EnableOnly)` equals upstream's `(_, Both) | (true, EnableOnly)`. `global_llvm_features` is called
  right after LLVM init and before the autodiff block, matching llvm_backend.rs:180–184. `-C target-feature`, `-C target-cpu`,
  `-Z llvm-target-feature` and `-Z fixed-x18` still stop at `non_default_llvm_input`, so no new diagnostic path is reachable.
- No changes under `harness/`, `scripts/`, `tools/` or `harness/baseline` (`git diff --stat` empty for those paths).
- In a scratch worktree: `bunx tsc --noEmit -p .` clean; `coverage.ts --check` markers ok; coverage matches the handoff (exported_symbols.rs
  3/3; lto.rs, base.rs, linker.rs missing lists as claimed).
- Both new oracle tests pass with `RUST_TS_REQUIRE_PROBES=1` (2 pass, 16 expects). The global-features test is not vacuous: it asserts
  aarch64-linux non-empty and `+cx16` on windows-msvc.
- Sample: `RUST_TS_AGENT=rev-cis difftest --suite borrowck-ui --sample 60` → MATCH 60/60, DIFF 0, UNPORTED 0
  (run 20261030-195055-rev-cis-0i3h; this suite runs the full driver, so `init` is exercised). This agrees with the handoff's
  no-lost-MATCH claims.

## Findings
1. src/rustc_codegen_ssa/back/linker.oracle.test.ts:88 (`oracle_metadata_symbol`): non-blocking. The test captures the export list with a
   `#!/bin/sh` script passed as `-C linker=` and builds for `x86_64-unknown-linux-gnu`. That only works on a POSIX host with that target's std
   installed. On the Windows host described in AGENTS.md §5, the oracle build fails and the test throws `ERROR:` instead of skipping, which would
   break the gate's unit-test step there. It passes on this (darwin) machine. Suggest skipping visibly when the host can't run the script, or
   using a portable capture.
2. src/rustc_codegen_ssa/base.ts:47 (`allocator_kind_for_codegen`): non-blocking. Upstream's `///` doc comment (base.rs:662–664, "Decide
   allocator kind to codegen. …") was dropped. PORTING.md §2 says to keep doc comments. The other two helpers keep theirs.
3. src/rust_ts/codegen_backend.ts:210 (`TargetFeatureFoldStrength`): non-blocking. `as_str` (llvm_util.rs:187) and `IntoIterator for
   LLVMFeature` were not carried over. Neither is used on the `init` path (they serve `target_config`/`internal_target_features`, which use
   the D4 table), so leaving them out is fine for an out-of-scope crate. A one-line note would make that explicit.
4. src/rustc_codegen_ssa/back/lto.ts:1: non-blocking. `crate_type_allows_lto` (lto.rs:77), the fn right before the ported one, is not
   ported, although it is a trivial pure match. It is not called by `exported_symbols_for_lto`, so this is only coverage.
5. src/rustc_metadata/rmeta/encoder.ts:38: non-blocking. This one-line import change is outside the lane's assigned files. The move forced it
   and the handoff declares it; I accept it. Related root follow-up, per the handoff: `rustc_metadata` cstore_impl.ts still has its own local
   `ExportedSymbol` type, which should import the rustc_middle one so the two cannot drift.
6. src/rustc_middle/middle/exported_symbols.ts:72 (`symbol_name_for_local_instance`): non-blocking, informational. The `as SymbolName`
   casts are needed because the generated `symbol_name` query has `Value: unknown` (queries.gen.ts:934). That is a codegen gap outside this
   lane, not a guessed value.

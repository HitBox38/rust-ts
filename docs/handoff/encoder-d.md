# Handoff: lane encoder-d (plan-m5 wave 33)

Branch `lane/encoder-d`, made from main `adaa9d4a`. Scope: encoder.rs :2064–end, the SVH seeding, `EncodedMetadata`
and the driver switch-over.

## What landed

### encoder.rs: all 35 encoder-d fns are ported, and none are stubs
- **The `EncodeContext` methods** (:2064–:2403), in upstream order:
  - `encode_proc_macros` (the whole proc-macro branch);
  - `encode_debugger_visualizers`, `encode_crate_deps` (with the cnum sanity check), `encode_target_modifiers`,
    `encode_enabled_denied_partial_mitigations`, `encode_lib_features`, `encode_stability_implications`,
    `encode_canonical_symbols`, `encode_diagnostic_items`, `encode_fake_doc_items`;
  - `encode_lang_items`, `encode_lang_items_missing`, `encode_stripped_cfg_items`, `encode_traits`;
  - `encode_impls`, which writes the `impl_trait_header`, `impl_is_fully_generic_for_reflection`, `defaultness`,
    `impl_parent` (`ancestors().nth(1)`) and `coerce_unsized_info` table entries; the `FxIndexMap` is a `DefIdMap`
    (insertion order);
  - `encode_incoherent_impls` (the `FxIndexMap` is a `KeyedMap`, insertion order), `encode_exportable_items`,
    `encode_stable_order_of_exportable_impls`, `encode_exported_symbols`, `encode_dylib_dependency_formats`.
- **The free fns:**
  - `prefetch_mir`, with both branches (D5: it returns at once when `!should_codegen()`);
  - `EncodedMetadata`: `from_path`, `full`, `stub_or_full`, `path`, plus `encode` / `decode`;
  - `encode_metadata`, `with_encode_metadata_header`;
  - `encode_root_position`, `encode_unhashed_position`, `encode_crate_hash`;
  - `provide`, `rendered_const`, `classify`.
- **SVH (encoder.rs :2677–:2701).**
  - The vendored `XxHash3_128` is seeded with the supplement fingerprint. That fingerprint is the `StableHasher` over
    `dep_tracking_hash(true)`, then `compute_hir_hash`.
  - The `FileEncoder` is built with `with_flush_strategy`, so every flushed byte goes into the hasher.
  - With `-Zmetadata-crate-hash=no`, it uses a plain `FileEncoder::new`.
  - After `f`, the code calls `finish()`. It then writes the root position, the unhashed position and
    `local_crate_hash` into the header.
  - **Not mine:** the `finish_128` → `local_crate_hash` step itself (:836–:843) is in `encode_crate_root`, lane encoder-b.

### Driver switch-over (outside encoder.ts, as the task asked)
- **rustc_metadata/fs.ts.**
  - The two pending-lane shims are gone. fs.ts imports `encode_metadata` / `EncodedMetadata` from rmeta/encoder.ts.
  - `moved = true` is now set *before* `from_path`. This is because `from_path` takes the dir by value and drops it
    itself: on an empty file (the bin `--emit=metadata` case) and on its own I/O errors (metadata-deps review #4).
- **rustc_interface/stand_ins.ts.** The `EncodedMetadata` stand-in interface is removed. Its five importers now take
  the type, type-only, from `rustc_metadata/lib.ts`: queries.ts, passes.ts, util.ts, rust_ts/codegen_backend.ts,
  rustc_codegen_ssa/back/link.ts.
- **rustc_interface/queries.ts.** `Linker::link`'s body is wrapped in `try { .. } finally { this.metadata.drop() }`.
  Upstream's `link(self)` drops `metadata` (and with it the `MaybeTempDir`) when the body returns or unwinds. This
  re-indents the body; the logic is unchanged.
- **rustc_metadata/lib.ts.**
  - It loads `./rmeta/encoder.ts` after decoder.ts.
  - It re-exports `EncodedMetadata`, `encode_metadata`, `rendered_const` and `type ProcMacroKind`, as `pub use rmeta::{..}`
    does.
  - `provide` is now rmeta/mod.ts's.
- **rustc_metadata/rmeta/mod.ts `provide`.** It is ported: `encoder::provide(&mut providers.queries)` and then
  `cstore_impl::provide(providers)`. Both are loaded through lazy `require`, because mod.ts must not import encoder.ts
  or cstore_impl.ts at load time.
  - **Effect:** the local providers `doc_link_resolutions` / `doc_link_traits_in_scope` now exist.
- **rustc_interface/passes.ts.** A stale PORT comment about `rustc_metadata::provide` is removed.
- **Hand-expanded `#[derive(Encodable)]`.** `DeniedPartialMitigation` is encoded on every lib crate (always 2 entries),
  so its encoders are needed:
  - rustc_session/options/mitigation_coverage.ts: `encode_DeniedPartialMitigation{,Kind,Level}`, next to their
    hand-expanded decoders;
  - rustc_target/spec/mod.ts: `encode_StackProtector`, next to `decode_StackProtector`.

### Contract test
encoder_contract.test.ts:
- `ported_by` returns `encoder-d` for :2064 onwards;
- the per-lane count stays 35, since ported fns count for their lane;
- the `encode_metadata` "stub stops with encoder-d" probe is removed, because no encoder-d stubs are left.

### New test: `src/rustc_metadata/rmeta/encoder_d.test.ts` (3 tests)
1. **Round trip through the port's `MetadataBlob`.**
   - A no_core lib crate is compiled in process.
   - `with_encode_metadata_header` writes encoder-d's lists plus a `CrateHeader` root. It sets `local_crate_hash` the
     way encoder-b's code will.
   - The test reads the file back and checks:
     - `check_compatibility` (the version string);
     - `root_pos`, the header, and the crate hash in the header;
     - every list: lang items, missing lang items, traits, 2 `TraitImpls`, diagnostic items, both mitigations, and the
       empty lists.
   - The SVH is recomputed independently: one-shot XXH3-128 over the supplement plus the flushed bytes, with the header
     fields zeroed. It equals what the flush strategy fed in.
2. **`rendered_const` / `classify`.** On `0x10`, `-1`, `()`, `{ 5 }`, `LIT` and `1 + 2`, the results are `Literal 0x10`,
   `Literal -1`, `Simple ()`, `Simple { 5 }`, `Simple LIT` and `Complex _`.
3. **`EncodedMetadata`.**
   - `from_path` removes the temp dir on an empty file and on an error (missing stub).
   - On success it keeps the dir until `drop()`.
   - `encode` gives exact bytes, and `decode` round-trips them.

## Verification
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (23,099; vendor 4,680).
- **Coverage:**
  - encoder.rs: 26/95 → **61/95**;
  - rustc_metadata: 378 → 413;
  - TOTAL: 22,485 → **22,520** (+35).

  `--missing` now lists only encoder-a/b/c fns.
- **`bun test`:**

  | directory | pass | fail |
  |---|---|---|
  | src/rustc_metadata | 117 | 0 |
  | src/rustc_session | 83 | 0 |
  | src/rustc_target | 13 | 0 |
  | src/rustc_interface | 4 | 0 |
  | src/rustc_codegen_ssa | 12 | 0 |
- **Samples** (`RUST_TS_AGENT=root-f5de`). Before = a base worktree at `adaa9d4a`, after = this branch. The per-case
  jsonl files are identical (0 differing lines).

  | suite | before | after |
  |---|---|---|
  | `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (20261030-192655-root-f5de-zr5q) | same (20261030-194337-root-f5de-nowu) |
  | `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE, 15 skipped (20261030-192741-root-f5de-yc28) | same (20261030-194451-root-f5de-f20v) |
- **Small lib crate, `--crate-type lib --emit=metadata`** (6 items, `#![no_std]`, oracle sysroot via `--sysroot`).
  - Encoding runs through `encode_metadata` → `with_encode_metadata_header`: the SVH seed (`compute_hir_hash`,
    `dep_tracking_hash`), the header and the rustc version.
  - It **stops at `EncodeContext::encode_crate_root (lane encoder-b)`**, with exit 70.
  - No `rmeta*` temp dir is left behind. The oracle writes a 2,453-byte `liblib.rmeta`.
- **Bin crate, `--emit=metadata`.** The port writes the same 0-byte `libmain.rmeta` as the oracle, and `from_path`
  removes the temp dir. It then stops at `rustc_codegen_ssa::back::linker::exported_symbols (CrateInfo::new)`.

## `unported(...)` left (all in encoder.ts)
- `Encodable for DocLinkResMap` (proc-macro crates with doc links in the crate root).
- `Encodable for DebuggerVisualizerFile` (`#[debugger_visualizer]`): not generated in rustc_middle.
- `Encodable for TargetModifier` (target-modifier flags; decoder.ts's decoder is unported too).
- `Encodable for (ExportedSymbol, SymbolExportInfo)`: empty without codegen (D5); M7.
- `encode_metadata`: reuse of the saved metadata work product (`-C incremental`; D3).

Each element encoder stops only for a non-empty list.

## Gaps found on the encode path (other lanes / root)
- **The `fake_doc_items` provider is not ported** ("fake_doc_items provider (not ported)", rustc_passes).
  `encode_crate_root` calls `encode_fake_doc_items` for every non-proc-macro crate, so it will be the next stop after
  encoder-b lands, unless someone ports it.
- **`crate_hash(LOCAL_CRATE)` with `needs_metadata()`** (rustc_middle hir/map.ts:1667) is still
  `unported(".. local_crate_hash ..")`. Once encoder-b sets `local_crate_hash`, it should read
  `*tcx.untracked().local_crate_hash.get().expect("crate_hash(LOCAL_CRATE) called before metadata encoding")`.
- **`TyCtxt::metadata_dep_node`** (context.ts:2702) is unported. See the PORT decision below.
- **`SelfProfilerRef::artifact_size`** is missing from the rustc_session stand-in. See below.

## PORT decisions (in the code)
- `encode_metadata` builds the metadata `DepNode` only when the dep graph is enabled. `DepNode` is not ported
  (`with_task` takes `undefined`), and building it has no observable effect. Root may want to record this.
- `artifact_size("crate_metadata", ..)` is not called, because the stand-in profiler has none (`-Z self-profile` is
  unported). Its `fstat` size argument is still read.
- The header writers are positional writes (`pwrite`). These leave the fd offset unchanged, so `stream_position` and
  the final seek back are no-ops.
- `par_join` / `par_for_each_in` run sequentially.
- `EncodeContext`'s file is closed in a `finally` (Rust's drop of `ecx`).
- `EncodedMetadata` and its temp dir:
  - `_temp_dir` is fs.ts's `MaybeTempDir`;
  - `from_path` reads the whole file (as locator.ts does for `Mmap::map`) and drops `temp_dir` on every non-final
    return;
  - `drop()` is the drop glue, called by `Linker::link`.
- `encode` / `decode` of `EncodedMetadata` use the generic `[u8]` / `Vec<u8>` impls. These are the same bytes as the
  `FileEncoder` / `MemDecoder` specialisations.
- `let mut def_key` in `encode_proc_macros` is a copy: `clone_DefKey`.
- `to_sorted_stable_ord()` of `stability_implications` sorts by `Symbol::stable_cmp`.
- Element encoders for tuples, generics and `Option`s are small module-level helpers next to `prefetch_mir`. `lazy`
  and `lazy_array` take an `Encodable` fn.
- The `record_*!` macros are expanded inline, each with the macro call as a comment.

## Notes for root
- Merging with encoder-a/b/c will conflict in encoder.ts's import block and in the contract test's `ported_by` /
  stub probes. My imports are in a separate block marked `// lane encoder-d`. The only existing import lines I changed:
  - `DefKind`, `FileEncoder` and `XxHash3_128` went from `import type` to value imports;
  - `import type { Svh } from "./decoder.ts"` was removed, because `Svh` now comes from rustc_data_structures/svh.ts.
- The base worktree used for the "before" samples has been removed.

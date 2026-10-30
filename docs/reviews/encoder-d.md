verdict: APPROVE-WITH-NOTES

Reviewer: independent (read-only), lane encoder-d, wave 33. Batch: `git diff main...lane/encoder-d` (ae84951e).
Upstream: `.data/rust` at the pin.

## What I checked
- All 35 fns from encoder.rs :2064 to the end, compared one by one with upstream: order, control flow, the
  `empty_proc_macro!` / `record_*!` expansions (checked against the macro bodies at :86 and :433–:468), panic and
  span_bug texts, and the table writes.
  - `encode_stripped_cfg_items` correctly has no `empty_proc_macro!`, as upstream.
  - `an.nth(1)` is right: two `next()` calls on a fused iterator.
  - `classify` handles `QPath` correctly: there are only two variants at the pin, `Resolved` and `TypeRelative`.
  - The `rendered_const` guard fallthrough (`Literal` without a snippet goes to `id_to_string`) is right.
- **SVH.** The hasher is `XxHash3_128.new()` (seed 0, the vendored twox-hash 2.1.2, which already has oracle tests).
  - It is seeded only when `metadata_crate_hash` is set. The seed is `StableHasher(dep_tracking_hash(true): Hash64,
    compute_hir_hash: Fingerprint).finish()`, written as `to_le_bytes`.
  - Every flushed byte reaches it through `FileEncoder.with_flush_strategy`. That includes `METADATA_HEADER`, the
    three zero placeholders (8 + 8 + 16 bytes) and the version string, exactly as upstream.
  - `finish_128` happens in encode_crate_root, which is encoder-b's code, not this lane's.
  - The header patch-up writes root_pos, then unhashed_pos, then `local_crate_hash` at the upstream offsets. The
    panic text "local_crate_hash set during encoding" matches.
  - `EncodeContext` constructor args are in field declaration order.
- **Driver switch-over.**
  - fs.ts: `moved = true` is set before `from_path`, which matches Rust's by-value move.
  - `from_path` drops `temp_dir` on the empty-file return and on every `?` error.
  - The `Linker::link` try/finally covers the early returns.
  - The stand-in removal and the type-only re-imports are fine.
  - rmeta/mod.ts `provide` matches mod.rs:631 (encoder then decoder). The query keys (`ModId`, local `LocalModId`)
    and the span_bug texts match.
- **The new encoders** follow rustc_macros serialize.rs `encodable_body`: the variant index goes out as `emit_u8`
  when there are fewer than 255 variants, then the fields.
  - `StackProtector` is None/Basic/Strong/All = 0..3, the upstream order.
  - `DeniedPartialMitigationKind` uses the generated discriminant table (StackProtector=0, ControlFlowGuard=1).
  - `DeniedPartialMitigation` writes kind, then level.
- **The round-trip test really reads the written file.** It does `readFileSync(path)`, then `MetadataBlob.new`, then
  `check_compatibility`, `root_pos`, `get_header`, `get_crate_hash` and a decode of every list.
- **No changes under `harness/`, `scripts/`, `tools/` or `harness/baseline`.** The test only imports
  `scripts/lib/common.ts` (`DATA`).
- **What I ran, in a scratch worktree at lane/encoder-d (since removed):**
  - `bunx tsc --noEmit -p .`: clean.
  - `bun test` on encoder_d.test.ts and encoder_contract.test.ts: 11 pass, 0 fail.
  - `coverage.ts --check`: markers ok (23099; vendor 4680).
  - `--missing encoder.rs`: 34 left, none at :2064 or later. That fits the claimed 61/95.
  - `difftest --suite emit --sample 30` (`RUST_TS_AGENT=rev-encd`): 30/30 MATCH.
  - The handoff's mir and tydump-ui samples (identical before/after) are plausible: nothing in those suites reaches
    `encode_metadata`.
- **integ-w33 merge b3e227f9 (import conflict with encoder-a).** The resolution is correct. `encode_DefKey`, `Svh` and
  `CRATE_DEF_ID` were dropped from encoder-a's lines, but encoder-d's block still brings them in (merged file lines
  105, 102 and 118). `DefKind` is a value import, and `Hash64` / `encode_DefPathHashMapRef` from encoder-a are kept.
  I did not typecheck integ-w33 itself.

## Findings

1. **src/rustc_metadata/rmeta/encoder.ts:1555, :1559, :1573 (vs :1577): non-blocking.** `EncodedMetadata.from_path`
   drops `temp_dir` while `file` is still open.
   - **What happens:** on the empty-file return and on the `fstat` / read error paths, `temp_dir?.drop()` runs inside
     the `try`, and `closeSync(file)` only runs afterwards in the `finally`.
   - **Upstream order:** the body's locals (`file_metadata`, `file`) drop before the by-value parameter `temp_dir`. So
     the file is closed before the directory is removed.
   - **Why it matters:** on the Windows host, removing a directory that holds an open file can fail. `TempDir.drop`
     swallows the error, so an `rmeta*` dir would be left in the output dir. That is the bin `--emit=metadata` case.
   - **Fix:** close the file before the drop. For example, set a flag and drop after the `finally`.
   - The handoff's "no temp dir left behind" was seen on this macOS machine. Root should re-check it on Windows.

2. **src/rustc_interface/passes.ts:1381 → src/rustc_interface/queries.ts:147: non-blocking (latent).** An
   unwinding exit between `from_path`'s success and `Linker::link` never drops the `EncodedMetadata`.
   - **Where:** the rest of `start_codegen` (`codegen_crate`, `CrateInfo_new`), `codegen_and_build_linker`, and
     `report_unused_features` in rustc_driver_impl.
   - **Upstream:** a fatal error or ICE there unwinds and drops the `Linker` or `metadata`, which removes the temp dir.
     The port leaks it.
   - **When it bites:** today it is latent, because lib crates stop in `encode_crate_root` before `from_path`. It
     becomes live once encoder-b lands.
   - **Also minor:** upstream drops `metadata` inside `codegen_backend.link`, before `_timing` ends. The port drops it
     after `_timing.drop()`. I see no observable effect.
   - **Suggestion:** a follow-up item for root to own the drop on unwind, for example a try/finally around the
     `metadata`-holding region.

3. **src/rustc_metadata/rmeta/encoder.ts, `encode_metadata` (`dep_node` built only when `is_fully_enabled()`):
   non-blocking, already recorded.** Upstream calls `tcx.metadata_dep_node()` unconditionally. The deviation has a
   PORT comment and no observable effect, and root accepted it in the 19:54 decision. When the dep graph is fully
   enabled, the port stops with `unported(...)`. It never guesses at the `try_mark_green` chain. That is correct.

4. **src/rustc_metadata/rmeta/encoder_d.test.ts:139–145, :203–209: non-blocking (test scope).** The SVH check
   computes the supplement with the same port functions the code under test uses (`dep_tracking_hash(true)`,
   `compute_hir_hash`).
   - **What it proves:** the hashed byte stream (one-shot vs. streaming, the placeholders zeroed) and the header
     round trip.
   - **What it doesn't:** that the supplement or the SVH equals the oracle's.
   - **Follow-up:** once encoder-b lands, check the oracle match against the crate hash in the oracle's
     `liblib.rmeta` header.

5. **src/rustc_metadata/rmeta/encoder.ts:~1068 (`encode_impls`, `an.nth(1)`): non-blocking (style).**
   `an._0.next() === undefined ? undefined : an._0.next()` is correct for this fused iterator. A short comment or an
   `nth` helper would make the intent clearer. No change is needed.

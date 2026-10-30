verdict: APPROVE-WITH-NOTES

Reviewer: independent review of lane encoder-a (branch `lane/encoder-a`, 1 commit 7f213df6 over main).
Diff: definitions.ts, def_path_hash_map.ts, encoder.ts, encoder_contract.test.ts, new encoder_a.test.ts, handoff.
Nothing under `harness/`, `scripts/`, `tools/` or `harness/baseline` changed.

## Checked against upstream (pin at .data/rust)

- encoder.rs:402 `[u8]` (`encode_slice_u8`): `Encoder::emit_usize(e, len)` then `emit_raw_bytes`. EncodeContext's
  `emit_usize` delegates to `opaque` (encoder_methods!), so the UFCS -> method call is the same. Faithful.
- encoder.rs:556 `encode_def_path_table`: `defs = tcx.definitions()`; proc-macro branch iterates
  `once(CRATE_DEF_ID).chain(resolutions(()).proc_macros)`, `def_key`/`def_path_hash` via `defs`; else branch
  `enumerated_keys_and_path_hashes()` with `LocalDefId { local_def_index }`. `record_some_lazy!` expansion matches
  encoder.rs:433 (value, `self.lazy`, `set_some`); `record_value!` matches :447 (`set`). Table key is `LocalDefId`
  (TableBuilder<LocalDefId, DefIndex, ..>, mod.rs:406), as ported. Value `local_hash().as_u64()`. Faithful.
- encoder.rs:577 `encode_def_path_hash_map`: `lazy(BorrowedFromTcx(tcx.def_path_hash_to_def_index_map()))`. Faithful.
- definitions.rs:118 `Encodable for DefKey`: `e.encode_def_key(self.parent, self.disambiguated_data)`; dispatches to
  EncodeContext's override (encoder.rs:244 -> `Option<LocalDefId>`, `encode_local_def_id` = bare `emit_u32`, :237).
  The generated `encode_DisambiguatedDefPathData` is the derive (data, then u32 disambiguator). Faithful.
- def_path_hash_map.rs:36 `Encodable for DefPathHashMapRef`: odht `raw_bytes()` -> `emit_usize(len)` +
  `emit_raw_bytes`, then `after_parallel_alloc.expect("must be set before metadata encoding").range(..).encode(e)`
  as the generic `[T]` slice impl (serialize.rs:312) of `(Hash64, LocalDefId)` tuples; `SortedMap<Hash64, LocalDefId>`
  matches upstream's field type (definitions.rs:63), and `encode_Hash64` is the 8 LE raw bytes (serialize.rs:741).
  `unwrap(v, msg)` panics with exactly `msg`, as `.expect` does. `OwnedFromMetadata` panic text is verbatim.
  The post-`commit_end_of_determinism` part is the sorted slice in key order (`SortedMap.range(range_full())` =
  `data.slice`). Faithful. The odht byte layout itself is vendor code already oracle-checked
  (src/vendor/odht/odht.oracle.test.ts, tools/probes/odht).
- Markers: all 5 fns carry correct `// rustc: <path>:<line> <name>` markers; `coverage --check`: markers ok
  (23069; vendor 4680).
- No `unported(...)` remains in the 5 fns; no invented behaviour.

## Claims verified (scratch worktree at lane/encoder-a)

- `bunx tsc --noEmit -p .`: clean (0 lines).
- `bun test src/rustc_metadata src/rustc_hir_id`: 130 pass, 0 fail (15 files).
- coverage: encoder.rs 29/95, def_path_hash_map.rs 3/3, rustc_hir_id definitions.rs 26/26 — as claimed.
- `difftest --suite mir --sample 30` (RUST_TS_AGENT=rev-encoder-a): 30/30 MATCH (run 20261030-194244-rev-encoder-a-t7hr),
  confirming the new value imports (encoder.ts -> rustc_hir_id/definitions.ts, def_path_hash_map.ts) cause no
  module init-order break. The code is unreachable from the CLI until encoder-b/d land (fs.ts:320 shim), so the
  lane's "samples unchanged" claim is plausible; no lost MATCH.
- Test byte expectations checked by hand against upstream: crate root `[0,0,0]` (None, CrateRoot=0, disamb 0);
  child `[1, 0, 5]` (Some, `encode_local_def_id` u32 0 — no CrateNum, per encoder.rs:237 — TypeNs = variant 5,
  definitions.rs:258). Correct.

## Findings

1. src/rustc_hir_id/definitions.ts:200 (encode_DefKey cast) — non-blocking. The
   `as Encodable<DisambiguatedDefPathData>` cast is sound at runtime (every `encode_def_key` impl calls `encode_T`
   with `self`, a SpanEncoder). I agree with the lane's suggestion: typing the interface and provided method in
   src/rustc_span/lib.ts:1647/1658 as `encode_T: Encodable<T, SpanEncoder>` is the faithful translation of upstream's
   `impl Encodable<Self>` (rustc_span lib.rs:1364) and removes the cast. EncodeContext's override
   (`Encodable<T, EncodeContext>`) stays compatible through method-parameter bivariance. Root's call (not this lane's file).
2. src/rustc_metadata/rmeta/encoder.ts:42-43 — non-blocking, cosmetic. The new `encode_DefKey` (rustc_hir_id) and
   `Hash64` (rustc_hashes) imports are inserted between the two `rustc_hir/` imports, breaking the file's sorted
   import order. No behavioural effect.
3. src/rustc_metadata/rmeta/encoder_a.test.ts — non-blocking, informational. All checks are port<->port round trips
   (plus hand-verified byte prefixes); there is no oracle comparison of a real `.rmeta`'s def-path table / hash map
   yet. That can only come once encoder-b/d wire `encode_crate_root`/`encode_metadata`; the integrator should make
   sure a byte-level oracle check of these tables happens then.

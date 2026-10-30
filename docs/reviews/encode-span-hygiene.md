verdict: APPROVE-WITH-NOTES

Lane encode-span-hygiene (wave 32). Reviewed the lane's own commits after the integ-w32 merge
(`git diff 3f63335e lane/encode-span-hygiene`: da7c983f, 92cd5e02). Files: rmeta/encoder.ts,
encoder_contract.test.ts, new encoder_span_hygiene.test.ts, docs/handoff. Nothing under `harness/`, `scripts/`,
`harness/baseline` or `tools/` changed.

Checked in a scratch worktree (now removed): `bunx tsc --noEmit -p .` clean; `bun test` of the two encoder test
files 13 pass / 0 fail; `coverage --check` markers ok (23041; vendor 4680); `coverage --missing encoder.rs` leaves
only :402 `[u8]` encode, :556 encode_def_path_table, :577 encode_def_path_hash_map (encoder-a), plus the other lanes'
stubs. The handoff's four sample runs exist, and their per-case jsonl files are identical before and after (mir
297 MATCH / 1 UNPORTED / 2 UNSTABLE; tydump-ui 298 MATCH / 2 UNSTABLE; 0 DIFF/CRASH). No MATCH lost.

Fidelity, compared line by line with encoder.rs at the pin:
- SpanEncoder impl (:151-:244): all 10 fns are in upstream order with upstream logic. The proc-macro CrateNum panic
  text, with `{crate_num:?}` given by debug_CrateNum (`crate3`, tested), and the encode_def_index panic text are
  verbatim. encode_def_id writes krate.encode then emit_u32(index). encode_syntax_context writes
  get_syntax_ctxt_encoding_index then a u32. encode_expn_id schedules only LOCAL_CRATE expansions, then writes krate
  and ExpnIndex (the :144 impl).
- encode_span: Occupied/Vacant become get/set, and the position is inserted before `span.data().encode`, as
  upstream. `offset < last_location` picks the relative or absolute form, with SpanTag::indirect(relative,
  bytes_needed). `write_with(8, ..)` writes the 8 LE bytes and returns `needed`, which matches `[u8; 8]` with N=8 in
  both FileEncoder and MemEncoder.
- encode_symbol / encode_byte_symbol / encode_local_def_id / encode_def_key: match. encode_def_key maps the parent
  to LocalDefId and encodes the Option through encode_LocalDefId, which calls encode_local_def_id.
- bytes_needed (:254): `(64 - lz).div_ceil(8)`. It is correct for 0 and for every n < 2^53, and the tests check the
  byte boundaries.
- SpanData encode (:259): the order of every step matches upstream:
  - the proc-macro ctxt override;
  - the dummy span gives Partial (tag, then ctxt if not root), then return;
  - source_file_cache refresh through lookup_source_file_idx;
  - a span whose hi is outside the file gives Partial;
  - a Foreign span reads metadata_index from ExternalSource::Foreign, else panics `Unexpected external source {src:?}`;
  - a Local span does insert_full, and the insertion index is the value. The u32 expect message is
    `...: TryFromIntError(())`;
  - then lo relative to start_pos, len, tag, optional ctxt, lo, optional len, metadata_index u32, and the cnum for
    Foreign.
  The SpanTag bit layouts in the tests (0b00100100, 0b00011101, 0b00001011, 0b00001111) agree with
  SpanTag::new/indirect in mod.rs.
- encode_symbol_or_byte_symbol (:529): the predefined / Vacant (SYMBOL_STR, then insert the position, then emit) /
  Occupied (SYMBOL_OFFSET + usize) branches match. It mixes `opaque.emit_*` and `self.emit_*` exactly as upstream
  does.
- encode_source_map (:581):
  - take() + unwrap; TableBuilder::default; stable_crate_id(LOCAL_CRATE);
  - the enumerate order (Map insertion order, value = on-disk index, recorded with a PORT);
  - the assert message;
  - (**sf).clone(), through SourceFile.clone at lib.rs:1976. The RealFileName clone is a new object with
    `update_for_crate_metadata`, so the session's own file keeps `local` (tested);
  - cnum for proc-macro crates, `from_filename_for_export`, the u32 expect, set_some(lazy), encode(opaque).
- encode_hygiene (:2036): three TableBuilders, then HygieneEncodeContext::encode with the 4-tuple context, then
  set_some of lazy(SyntaxContextKey) and, for local expns only, lazy(expn_data.expect("local expn")) / lazy(hash) at
  as_raw. The tables are encoded in upstream order. SyntaxContextKey is
  `(SyntaxContext, ExpnId, Transparency)` (hygiene.ts:122), and its tuple encoding goes through
  encode_syntax_context / encode_expn_id, as upstream's tuple impl does. latest_ctxts and latest_expns are Vecs
  upstream, so the order of the lazies in the blob is deterministic, and the port keeps it.

Tests: encoder_span_hygiene.test.ts drives the real code. encode_Span / encode_Symbol / encode_DefId / ... dispatch
into EncodeContext's SpanEncoder methods, and decoding uses the port's decoder.ts MetadataDecodeContext:
- both shorthand forms are covered (absolute at position 1, and relative in the last test);
- the Partial, dummy-with-ctxt, long-length (out-of-band len) and Foreign tags are covered;
- encode_hygiene and encode_source_map are covered by decoding their tables, and the contexts are rebuilt with the
  same marks and hashes.
The round trip shares one session, so it proves consistency with the port's decoder, not with oracle bytes. The
hand-computed byte checks cover the tag layouts.

Contract test: SPAN_HYGIENE = {151,162,166,171,176,188,222,226,237,244,254,259,529,581,2036}. `ported_by()` now
attributes `// rustc:` markers per lane. The counts are encode-contract 11, encoder-a 3, encode-span-hygiene 15,
encoder-b 15, encoder-c 16, encoder-d 35 (total 95). They agree with `coverage --missing` and with the ownership
change root accepted (state.ts decision 2026-10-30T09:07). The "stubs stop" probe for encoder-a moved to
encode_def_path_table, which is still a stub. That is correct.

Findings:

1. src/rustc_metadata/rmeta/encoder.ts (encode_span, the two `write_with(8, ..)` calls; encode_SpanData and
   encode_source_map, the `> 0xffff_ffff` checks). Severity: non-blocking. The handoff lists these as PORT
   decisions: `*dest = offset.to_le_bytes()` written as `usize_to_le_bytes`, and `try_into().expect` written as an
   explicit range check. In the code they carry plain backtick comments, not `// PORT:` markers. Both
   translations are correct, so the only issue is the marker. Convert the comments to `// PORT:` when the file is
   next touched.

2. src/rustc_metadata/rmeta/encoder.ts:~776 (`encode_SyntaxContextKey`). Severity: non-blocking. This is a
   hand-written local helper for the tuple alias's Encodable. It is correct: `encode_tuple` over SyntaxContext,
   ExpnId and Transparency is exactly what the generic tuple impl does, and it mirrors decoder.ts's decode_tuple_.
   If tools/codegen later emits encoders for type-alias tuples, replace this helper so the two sides cannot drift.

3. src/rustc_metadata/rmeta/encoder_span_hygiene.test.ts. Severity: non-blocking. The Foreign-span path is checked
   by hand-computed bytes only: decoding it needs the CStore. That path of encode_SpanData has no decode-side
   check yet. It should get one once encoder-d / the CStore round trip exists, or an rmeta oracle comparison
   should cover it.

4. Handoff claim "No `raw_encode_syntax_context` at the pin": verified. The pinned hygiene.rs has no such fn, and
   the only mention is the stale `raw_encode_expn_id` comment in encoder.rs (kept verbatim in the port). No action.

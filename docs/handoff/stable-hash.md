# Handoff: stable-hash (wave 8, M2 foundations)

Upstream naming at this pin: `HashStable` is now **`StableHash`** (`stable_hash`, `StableHashCtxt`,
`rustc_data_structures/src/stable_hash.rs`), and the derives are `StableHash` / `StableHash_NoContext`
(`rustc_macros/src/stable_hash.rs`, attribute `#[stable_hash(..)]`). There is no `HashStable_Generic` any more.
The `StableHashCtxt` rustc uses is `rustc_middle::ich::StableHashState`.

## Files touched
- **Vendor** `rustc-stable-hash =0.1.2` (rustc builds it with feature `nightly`): `src/vendor/rustc_stable_hash/{lib,sip128,stable_hasher,int_overflow}.ts`,
  plus the crate tests `sip128/tests.test.ts` and `stable_hasher/tests.test.ts` (SipHash-1-3 vector, expected-value tests).
- `src/rustc_hashes/lib.ts`: full port (was 3/15).
- `src/rustc_data_structures/fingerprint.ts` (full), `stable_hash.ts` (new, full), `fingerprint/tests.test.ts`, `stable_hash/tests.test.ts`.
- `src/rustc_span/def_id.ts`: `StableCrateId::new`; `StableHash` for `DefId`/`LocalDefId`/`CrateNum`; `ToStableHashKey` for `DefId`/`LocalDefId`; the
  `Hasher`/`RawDefId` stand-ins are replaced by the real ones.
- `src/rustc_span/hygiene.ts`: `ExpnData::hash_expn`, the tail of `update_disambiguator` (so `LocalExpnId::fresh`, `set_expn_data` and
  `mark_with_reason` now work), `StableHash` for `SyntaxContext`/`ExpnId`/`LocalExpnId`. The local `StableHashCtxt` stand-in is now a re-export
  of the real trait.
- `src/rustc_span/lib.ts`: `StableHash` for `Span`; `impl Hash for RealFileName`; the six `FileName::*_source_code` fns; `StableSourceFileId::hash()`
  computes the real `Hash128`; derived `Hash` of `FileName`/`InnerRealFileName`/`Option` written out (no derive(Hash) codegen yet).
- **Generated** `src/rustc_span/stable_hash.gen.ts`: 20 `derive(StableHash)` impls.
- **Outside the listed ownership** (needed by the brief; please check):
  - `src/rustc_span/symbol.ts`: `stable_hash_Symbol` and `stable_hash_ByteSymbol` (two skip markers replaced).
  - New `src/rustc_middle/ich.ts`: `StableHashState` (span hashing with lines/cols, `def_path_hash`, controls) and `SourceSpanCache`.
    `Untracked` is a local stand-in interface, `UntrackedForHashing`. tyctxt-min should build it in `with_stable_hashing_context` via
    `StableHashState.new(sess, untracked)`.
- **tools/codegen**: `types.ts` (derive(StableHash)), new `stable_hash.json` (impls for external types), `typemap.span.json`
  (cfg `target_pointer_width = "64"`), `types.sets.json` (new `rustc_span` set), `stable_hash.test.ts`, `fixtures/rustc_span.typedefs.json`.
- **Oracle fixtures and probe**:
  - `src/rustc_data_structures/stable_hash_oracle.json` and `stable_hash.oracle.test.ts`.
  - `src/rustc_span/{stable_crate_id_oracle,expn_hash_oracle}.json` and `stable_hash.oracle.test.ts`.
  - Probe source: `src/rustc_data_structures/stable_hash_probe/{main.rs,Cargo.toml.in}`. It is a rustc-dev probe in tools/probes template format.
    It was built by hand in scratch; the tests replay the fixtures and do not need it.

## Coverage
- rustc-stable-hash-0.1.2: 80/80, every `.rs` file including the tests. This needs the scope.json entry, see "For root".
- `rustc_data_structures`:
  - `stable_hash.rs` 44/44, `stable_hash/tests.rs` 11/11. Two of those are rustc-skips: the DenseBitSet and BitMatrix tests.
  - `fingerprint.rs` 25/25 (two rustc-skips: `Encodable`), `fingerprint/tests.rs` 1/1.
- `rustc_hashes/lib.rs` 15/15.
- `rustc_span`: `hygiene.rs` 98/98, `def_id.rs` 52/52, `lib.rs` 242/242, `symbol.rs` 71/71.
- `rustc_middle/ich.rs` 10/10.
- `coverage --check` with the scope.json entry added in scratch: `markers ok (3743; vendor 2403)`. Without the entry it prints 80 `ERROR`s
  ("names no harness/scope.json vendor crate").

## Oracle results
All of these match the pinned rustc.
- **StableHasher battery: 243 cases, all match.**
  - Primitives of every width with boundary values.
  - `isize` short/long encodings, `char`, `f32`/`f64` bits, `Ordering`, `Hash64`/`Hash128`/`Fingerprint`, `str`/`String`, `[u8]`, `Vec`s.
  - Nested tuples, `Option<Option<_>>`, `Result`, `BTreeMap`.
  - A mixed every-width sequence, and 120 random sequences that cross buffer boundaries (multi-byte strings, u128/i128).
  - Each case is compared as `Hash128`, `Hash64`, `Fingerprint` and `Hasher::finish`.
- **`StableCrateId::new`: 240 direct calls match.** The inputs vary names × lib/exe × `-C metadata` sets (sorting, dedup, length prefix,
  non-ASCII) × version strings.
- **6 real rustc sessions match.** Here the stable crate id is recomputed from crate name, crate type, `-C metadata` and rust-ts's
  `CFG_VERSION`.
- **ExpnHash: all 12 local expansions of a no_core crate match, disambiguators included.**
  - The crate has nested macro_rules, a macro defined by a macro, macro 2.0, `$crate`, modules, and `dup!(nothing! {})`, which yields
    `disambiguator: 1`.
  - It runs the full path: `LocalExpnId::set_expn_data` → `update_disambiguator` → `hash_expn` → generated `stable_hash_ExpnData` → ich
    `stable_hash_span` (lines/cols, `StableSourceFileId`, ctxt marks) → `ExpnHash::new` with the crate's stable crate id.
- **`StableSourceFileId` of a real local file matches** (std `Path` hashing through `src/std/path.ts`).

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 2022 pass, 1 skip, 0 fail. This run was before the new codegen test file. The one skip
  already existed: `read_binary_file_handles_lying_stat` is linux-only.
- The new codegen tests pass: 3 pass.
- Regenerating every codegen set in place leaves the tree unchanged (git status clean). The `rustc_span` set reproduces `stable_hash.gen.ts`
  byte for byte, which the golden test also checks.
- Fresh-process imports of def_id, hygiene, lib, symbol, span_encoding, stable_hash.gen, edition and source_map: all load. There is a new
  def_id → stable_hash.gen → hygiene import cycle, and it does no init-time work.
- `RUST_TS_AGENT=stable-hash bun scripts/difftest.ts --suite parse --sample 300`: **300/300 MATCH** (run
  `20261013-024652-stable-hash-adt3`).
- Perf spot check against the lane base `94a42b6` (git archive in scratch), with `-Zunpretty=ast-tree`:
  - `tests/ui/parser/slowparse-string.rs` (400 KB), 3 alternating runs: base 0.87 / 0.80 / 0.95 s, lane 0.94 / 0.85 / 0.96 s. Output is
    identical. There is no hot-path change: the lexer and parser do not touch hashing.
  - Startup on a 1-line file, 10 interleaved runs: base 0.631 s, lane 0.651 s. That is about 20 ms of extra module loading (stable_hash.ts,
    vendor, the gen module) now reached from rustc_span.

## `unported(...)` left
- New, in `stable_hash.ts`:
  - `rustc_index::bit_set::DenseBitSet (Hash)` and `BitMatrix (Hash)`, because bit_set is not ported.
  - Generated code would use `unported_stable_hash` for a field type with no StableHash impl. The report lists these under
    `missing_stable_hash`; it is 0 for rustc_span.
- Removed:
  - `ExpnData::hash_expn`.
  - `<DefId as ToStableHashKey>` in `update_disambiguator`.
  - `StableCrateId::new`.
  - The six `FileName::*_source_code` StableHasher unporteds.
  - `StableSourceFileId::hash`.
- Unchanged, not mine:
  - `debug_hygiene_data(verbose = true)`.
  - `std::path::Path::file_name`.
  - `blake3::hash`.

## `// PORT:` decisions (please record)
1. **u64 arithmetic in SipHasher128 uses int32 pairs**, signed int32 fields with explicit carry and rotates.
   - Measured on bun with 2M 8-byte words, one c_round each: `bigint` state 12.2 s (1.3 MB/s), int32 pairs 0.44 s (31 MB/s).
   - u64 values cross the API as `bigint` (`write_u64`, results). `usize`/`isize` are `number`.
   - `short_write<const LEN>(bytes)` becomes `short_write(LEN, lo, hi)`, so no array is allocated per write.
   - The buffer is a 72-byte LE `Uint8Array`, which gives the host-native byte order rustc uses.
2. `Hasher::finish(&self) -> u64` is named `finish_u64()`. The name `finish` is kept for `ExtendedHasher::finish` and the typed
   `StableHasher::finish(W)`, where `W` is the target's companion: `hasher.finish(Hash64)`. `FromStableHash` is the companion's `from`.
3. A `Hasher` stand-in for `std::hash::Hasher` lives in `src/vendor/rustc_stable_hash/stable_hasher.ts`, with `Hasher_provided`. Root:
   consider moving it to `src/std/hash.ts`. `src/std/path.ts`'s own `Hasher` takes `write_usize(bigint)`; `path_hasher(h)` in
   `stable_hash.ts` adapts it.
4. The **`StableHash` trait is a function type.** Each impl is `stable_hash_<T>(self, hcx, hasher[, element impls])`. `StableOrd` and
   `StableCompare` are objects carrying `cmp`. `Discriminant<T>` is passed as (value, repr), with `isize` by default.
5. **`RawSpan` is the `Span` handle number.** `to_raw_span`/`from_raw_span` are casts.
   - span_encoding.ts still rustc-skips them with the reason "only feeds StableHash", which is now out of date.
   - The span_encoding owner may port them as identity casts. `stable_hash_Span` and ich then cast inline.
6. **`ToStableHashKey` for `DefId`/`LocalDefId` is ported**, contrary to PORTING §3's skip list. `DefId`'s StableHash and
   `update_disambiguator` need it.
7. **derive(StableHash) codegen convention:**
   - Output is `<crate>/stable_hash.gen.ts`, holding only `export function` declarations so that hand modules can import it inside cycles.
   - Each enum gets a `<Enum>__discriminant` table (explicit discriminants honoured, `#[repr(int)]` honoured) and hashes it first, then
     the fields in declaration order.
   - The field attributes `#[stable_hash(ignore)]` and `#[stable_hash(project(f))]` are supported.
   - Generic types take `stable_hash_<P>` parameters.
   - Arrays hash as slices (method autoref unsizing), and `u8` sequences use the `[u8]` impl.
   - Item types that have a manual `impl StableHash` import `stable_hash_<T>` from the hand module of the impl's file.
   - External types come from `tools/codegen/stable_hash.json`.
   - New set options:
     - `derive_stable_hash`.
     - `derive_only`: write only the derive modules (for hand-written crates).
     - `stable_hash_access`: field reads of branded newtypes such as `ExpnHash._0($v)`, and `StableSourceFileId` via `$v.hash()`.
   - `RelativeBytePos`/`BytePos` live inside `impl_pos!`, which the probe does not expand. `RelativeBytePos` has a map entry with a note.
8. `StableSourceFileId` still stores its hash inputs, because source_map.ts keys on them. `hash()` computes and caches upstream's `Hash128`.
9. There is no derive(Hash) codegen. The derived `Hash` of `FileName`, `InnerRealFileName` and `Option` is written out in lib.ts, marked as
   such.
10. `rustc_middle/ich.ts` uses `UntrackedForHashing` in place of `rustc_crate_store::Untracked`, with the locks erased. The inherent and
    trait `stable_hash_controls` are one method carrying both markers.

## For root
1. Add `"rustc-stable-hash": "=0.1.2"` to the `vendor` section of `harness/scope.json`. Otherwise `coverage --check` reports 80 `ERROR`s.
2. Move the probe to `tools/probes/hashprobe/`. The `Cargo.toml.in` is ready, with `rustc_dev = true`. Its modes are `battery`,
   `crate-ids` and `compile [--custom-name=N] <rustc args>`. The last one prints the stable crate id, source files, all local `ExpnData` +
   `ExpnHash` and the ctxt marks after expansion. It is useful to the expansion lanes as an oracle for hygiene.
3. Record the decisions above. Delete `docs/claims/wave8-stable-hash.md`.
4. hir-def: the oracle reports the crate root's `DefPathHash` as `(stable_crate_id, local_hash == stable_crate_id)`. See
   `expn_hash_oracle.json` `crate_root`.
5. Metadata lanes:
   - Add `derive_stable_hash: true` to any set whose types need hashing.
   - Add map entries in `stable_hash.json` for new external types. The generator reports any that are missing under
     `missing_stable_hash`.
   - `Fingerprint`/`PackedFingerprint` decode are ported against a minimal `RawBytesDecoder` stand-in (fingerprint.ts). Repoint it to
     rustc_serialize's `Decoder` once that exists.

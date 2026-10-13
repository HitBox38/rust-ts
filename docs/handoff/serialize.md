# Handoff: serialize (wave 11, M2): rustc_serialize + derive(Decodable)/(Encodable) codegen

Branch `lane/serialize`, based on main d0697a1. There are no merges.

## Files touched
- **Port** `src/rustc_serialize/`:
  - `lib.ts`, `int_overflow.ts`, `leb128.ts`, `opaque.ts`, `opaque/mem_encoder.ts`, `serialize.ts`.
  - Tests: `leb128/tests.test.ts`, `opaque/tests.test.ts`.
  - Round trip: `serialize_oracle.test.ts`, plus `serialize_oracle/{cases.ts,expected.txt}`.
- **Generated** (GENERATED headers):
  - `src/rustc_span/decodable.gen.ts`: 12 decoders and 12 encoders.
  - `src/rustc_serialize/opaque/tests.gen.ts`: the test types `Struct` and `Enum`.
- **tools/codegen**:
  - `types.ts`: derive(Decodable)/(Encodable).
  - New `serialize.json`.
  - `types.sets.json`: the rustc_span opt-in and a new `rustc_serialize` set.
  - New `serialize.test.ts` (6 tests).
  - New `fixtures/rustc_serialize.typedefs.json`.
  - `stable_hash.test.ts`: the rustc_span set now writes 2 files, and its file-list expectation says so.
- **Probe**: `tools/probes/serialize/{Cargo.toml.in,main.rs}`. It is a rustc-dev probe.

## Coverage (`bun scripts/coverage.ts --missing`)
| upstream file | ported |
|---|---|
| lib.rs | 0/0 (no fns) |
| int_overflow.rs | 4/4 |
| leb128.rs | 2/2 + the 20 macro fns (`// rustc-macro:`) |
| opaque.rs | 36/36 (1 rustc-skip: the `#[cfg(debug_assertions)] Drop`, compiled out of rustc) |
| opaque/mem_encoder.rs | 12/12 |
| serialize.rs | 107/107 |
| opaque/tests.rs | 25/25 |
| leb128/tests.rs | 0/0 (the 10 macro tests are ported with `// rustc-macro:`) |

`coverage --check`: markers ok (7600; vendor 3004).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3662 pass, 1 skip (the existing linux-only one), 0 fail.
- `--suite parse --sample 200`: **200/200 MATCH** (run `20261013-145043-serialize-fgy8`).
- Every existing codegen set regenerates byte-identically, except the two sets that opted in.
- Fresh-process imports load: rustc_serialize lib/opaque/mem_encoder/leb128, rustc_span decodable.gen/lib.

## Round-trip oracle (`serialize` probe)
The probe encodes 50 cases with the oracle's own `MemEncoder` **and** `FileEncoder`:
- every integer width with LEB128 boundary values;
- char, String, byte_str and PathBuf;
- Vec, Option, `Option<Option>`, Result, tuples, arrays, `Box<[T]>`, NonZero;
- BTreeMap/Set, FxHashMap/Set, FxIndexMap;
- Hash64/128, Fingerprint, IntEncodedWithFixedSize;
- a 70 KB blob plus 12,000 u64 values, which crosses FileEncoder's 64 KiB buffer and `write_all_cold_path`;
- all 12 generated rustc_span types, with every variant.

The test does the following:
- **Always**: the port's MemEncoder bytes for the case values hash to the oracle's (`expected.txt`). Decoding them gives the values back,
  and the FileEncoder file equals mem + `MAGIC_END_BYTES`.
- **Live** (probe built): it decodes the oracle's bytes, compares them with the values, and re-encodes them with the port's MemEncoder and
  FileEncoder. Both match byte for byte. It also checks that the fixture is current.

All pass. FxHashMap/Set expectations use `src/rust_ts/hash_map.ts` (hashbrown order), so even hash-ordered maps match without the probe.

## How a later lane opts types into Decodable
1. In `tools/codegen/types.sets.json`, on the set that owns the types:
   - `"derive_decodable": true`, plus `"derive_encodable": true` if you want encoders (round-trip tests).
   - Optional `"decodable_types": [..]` (names or keys) limits generation to those items. Leave it out to get every `#[derive(Decodable*)]` type.
2. Where the output goes:
   - **Per-file sets** (generated types): `decode_<T>` / `encode_<T>` are emitted in each file's `.gen.ts`, next to the type.
   - **`derive_only` sets** (hand-written types): they go to `<crate>/decodable.gen.ts`, which contains only function declarations and is
     safe to import inside cycles.
3. Signature: `decode_<T>(__decoder[, decode_<P>...])`. It follows `decodable_body`:
   - A struct decodes its fields in order, with no tag.
   - An enum reads the variant **index** with `read_u8`, or with `read_usize` once it has 255 or more variants. Explicit discriminants do not
     matter.
   - A single-variant enum has no tag. A zero-variant enum panics with upstream's message.
   - Bad tags panic with upstream's message.
   - Encode mirrors `encodable_body`.
4. Field types resolve in this order:
   - a generated item;
   - a manual `impl Decodable` whose hand module **exports `decode_<T>`**. The generator checks the file, so a hand impl ported later is
     picked up on regeneration;
   - `tools/codegen/serialize.json`, for external types (templates `$D`/`$d0..`, `$v`/`$E`/`$e0..`, `transparent`, `*_nullable`,
     `values`/`values_import`);
   - anything else becomes `unported_decodable` and is listed under `missing_decodable` / `missing_encodable` in the report.
     `&T` fields (`RefDecodable`) are reported the same way.
5. Hand types whose TS value is not a `{ field }` object or a `new T(..)`:
   - Construct them with `decodable_construct: { "<key>": { "expr": "X.of($0)", "import": ["X"] } }`. The fields are decoded first, in order.
   - Encoders read fields through `stable_hash_access`.
6. Decoder types per derive come from `serialize.json` `decoders` / `encoders`.
   - Today every derive maps to `Decoder` / `Encoder`, because `SpanDecoder`, `BlobDecoder`, `TyDecoder` and `LazyDecoder` are not ported.
   - Once a trait exists, change its entry and regenerate.
7. `newtype_index!` types with `#[encodable]` get `X.from_u32(d.read_u32())` / `e.emit_u32(X.as_u32(self))`.

## `unported(...)` left
- `rustc_serialize::leb128::read_usize_leb128` / `read_isize_leb128`: called for a value outside ±2^53, which has no exact TS number.
  This never happens in metadata offsets or lengths.
- Generated code would call `unported_decodable` / `unported_encodable` for a field without an impl. There are none in the committed files.

## `// PORT:` decisions (please record)
1. **Widths and representation.**
   - `u64`/`u128`/`i64`/`i128` are `bigint`; `usize`/`isize` are `number`.
   - The usize/isize LEB128 reads use `number` arithmetic for 7 bytes, then switch to `bigint`. They refuse values that are not exact.
   - `str`/`String` are JS strings. `read_str` decodes with an ASCII fast path or `TextDecoder`. `read_raw_bytes` returns a zero-copy
     `Uint8Array` view.
2. **Traits.** `Encodable<T>` and `Decodable<T, D>` are function types, and impls are named `encode_<T>` / `decode_<T>`, as with StableHash.
   - Provided methods live in `Encoder_provided` / `Decoder_provided`, and implementors forward to them.
   - The opaque specializations are separate fns (`FileEncoder_encode_slice_u8`, `MemDecoder_decode_Vec_u8`,
     `*_IntEncodedWithFixedSize`). TS has no specialization, and they produce the same bytes.
   - The 12 `tuple!` impls are one variadic `decode_tuple` / `encode_tuple`.
3. **opaque.rs representation.**
   - `MemDecoder` keeps indices `start <= current <= end` into its bytes.
   - `FileEncoder` holds a Node fd. Its fields are `file_`/`path_` because the names clash with the accessor methods.
   - `drop()` closes the file, since TS has no destructor.
   - `write_with::<N>` / `read_array::<N>` take `N` as an argument.
   - `MemEncoder.data` is a capacity buffer, with `len` as the `Vec` length.
4. **Collections.** BTreeMap/BTreeSet decode into a `Map`/`Set` in the encoded order, which is key order. Hash maps decode into a `Map` in the
   encoded order.
5. **Codegen.**
   - `u64`/`i64` fields of generated types are `number` (typemap.json), so `serialize.json` converts them with `Number(..)` / `BigInt(..)`.
   - `Fingerprint`'s encode template is the body of the rustc-skipped impl.
   - `RelativeBytePos`/`BytePos` live in `impl_pos!`, which the probe does not expand, so their templates are the manual impls.
6. **Brief vs upstream.**
   - The derived enum tag is `read_u8` (`read_usize` only from 255 variants), as `decodable_body` does it, not `read_usize`.
   - There is no `MetadataDecodable` at the pin. The decode derives are `Decodable_NoContext`, `Decodable`, `BlobDecodable`, `LazyDecodable`
     and `TyDecodable`, and all five are supported.
7. **Test types inside fns.** The fn-local test types in `opaque/tests.rs` (`UnitLikeStruct`, `A`, `B`) are invisible to the typedefs probe,
   so their derive expansions are written out in the test.

## For root
1. Build the probe before the gate: `bun scripts/probes.ts build serialize`. With `RUST_TS_REQUIRE_PROBES=1` and no probe, the live tests fail.
2. **rustc_span opt-in.** 12 types are opted in (`decodable_types`):
   - Edition, SourceFileHashAlgorithm, SourceFileHash, MultiByteChar, NormalizedPos;
   - ExpnHash, Transparency, MacroKind, AstPass, DesugaringKind;
   - DefPathHash, StableCrateId.

   The others (Span, Spanned, Ident, ExpnKind, ExpnData, FileName, RealFileName, ModId, ...) need `SpanDecoder`/`BlobDecoder`. Those traits
   and `decode_Span`/`decode_Symbol`/... are rustc-skipped in `rustc_span/lib.ts`. Whoever ports them, probably rmeta-decoder:
   - exports `decode_<T>` from the hand module;
   - switches `serialize.json` `decoders.Decodable`/`BlobDecodable`;
   - adds the types to `decodable_types` and regenerates.
3. **fingerprint.ts.** Its `RawBytesDecoder` stand-in is structurally satisfied by rustc_serialize's `Decoder`, so nothing breaks. The owner can
   repoint it to `Decoder` from `src/rustc_serialize/lib.ts`.
4. **node_modules.** My worktree's tracked `node_modules` symlink pointed at `.data/node_modules`, which was missing. I placed a copy of the
   locator lane's `node_modules` there, outside the repo. Nothing in git changed and nothing was committed.
5. **Record decisions.** Record the decisions above with `bun scripts/state.ts record decision ...`.

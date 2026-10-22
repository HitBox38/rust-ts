# Handoff: mir-interp-a (M4 wave 21, MIR fill lane 5 of 6): interpret/allocation{, /init_mask, /provenance_map}.rs

Branch `lane/mir-interp-a` (from `aae2f3fc`, no merges).

## Files touched
- `src/rustc_middle/mir/interpret/allocation.ts`: every stub ported (`AllocBytes for Box<[u8]>`, `Allocation` constructors /
  accessors / byte accessors / scalar read-write / provenance and init-mask copy hooks, `adjust_from_tcx`, `AllocFlags` and
  `Allocation` `Decodable`, `all_zero`, `Hash for Allocation`, `ConstAllocation` Debug, `AllocError::to_interp_error`,
  `AllocRange` Display / `From` / `end` / `subrange`, `alloc_range`); `MAX_BYTES_TO_HASH` / `MAX_HASHED_BUFFER_LEN` exported
  for init_mask.ts (`super::`).
- `src/rustc_middle/mir/interpret/allocation/init_mask.ts`: every stub ported; the nested fns (`find_bit_fast`,
  `search_block`, `find_bit_slow`) moved inside `find_bit`.
- `src/rustc_middle/mir/interpret/allocation/provenance_map.ts`: every stub ported; the file-local `RangeBounds` interface is
  gone (rustc_index idx.ts's `RangeBounds` / `range` / `range_to` / `range_from` instead); `cmp_Size` exported.
- New tests: `allocation/init_mask/tests.test.ts` (upstream's `init_mask/tests.rs`, 8 tests, `// rustc:` markers) and
  `interpret/allocation.test.ts` (16 lane tests; the 2 scalar ones skip until mir-interp-b lands, see below).
- `src/rustc_middle/mir/contract.test.ts` (shared): the mir-interp-a stub count is 0 (entry removed); see "Re-pinned tests".
- `docs/state/history.jsonl`: 3 `(mir-interp-a)` decisions.

## Coverage
`bun scripts/coverage.ts --missing`: allocation.rs 51/51, allocation/init_mask.rs 26/26, allocation/provenance_map.rs 23/23,
allocation/init_mask/tests.rs 9/9. rustc_middle 2411/3369 (base 2311); TOTAL 17582/25518 (base 17482). `--check`: markers ok.
Stubs of lane mir-interp-a left: 0 (was 91).

## Representation (PORT, recorded as decisions)
1. **InitMask blocks (D6)**: upstream's `Vec<u64>` is a `number[]` of 32-bit word pairs (`blocks[2k]` = bits 0..32 of block
   `k`, `blocks[2k + 1]` = bits 32..64). Block count, growth (`amount / 64 + 1` blocks) and unused trailing bits are
   upstream's, so the word array has exactly upstream's bits: derived `Eq` / `Hash` (ConstAllocation interning, AllocId
   dedup) compare the same. `BLOCK_SIZE` and every bit / block index stay 64-based; `u64::MAX << n` / `>> n` are
   `max_shl` / `max_shr` word pairs; out-of-range block indexes panic as the `Vec` index. The upstream quirk
   `set_range_inbounds(s, s)` with `s` on a block boundary (sets the whole block, `u64::MAX << 0`) is kept (tested).
   The generated `debug_InitMaskMaterialized` prints the 32-bit words (upstream: the u64 blocks); it is only reached by
   `find_bit`'s `debug_assert_eq!` (a comment), so nothing prints it. A Debug override would need tools (typemap).
2. **Allocation (D8)**: `Bytes: AllocBytes` is `Box<[u8]>` (`AllocBytes_Box`, `AllocBytes_of` / `deref` helpers); handed-out
   slices / raw pointers are `Uint8Array` views; slice indexing panics with core's `slice_index_fail` texts.
   `Prov::OFFSET_IS_ADDR` / `Prov::WILDCARD` read `provenance_of(prov)` where a provenance value is at hand, else
   `CtfeProvenance`'s (`Prov_`; both ported impls: `OFFSET_IS_ADDR = false`, no wildcard).
   `AllocBytes::zeroed` returns `None` when the JS engine refuses the typed array (`RangeError`): upstream's host
   allocation failure, documented there as non-deterministic.
3. **Decodable**: the manual impls are generic over `D extends Decoder` (stub signatures took `TyDecoder`; changed, callers
   with a `TyDecoder` still type-check): `decode_AllocFlags`, `decode_Allocation(d, decode_Prov, decode_Extra)`,
   `decode_ProvenanceMap(d, decode_Prov)`, `decode_InitMaskMaterialized`, plus `decode_InitMask` (new export).
4. Iterators (`get_range`, `provenances`, `ptr_fragments`) are generators over the slices upstream borrows at the call;
   `InitChunkIter` is the JS iterator of the contract; `peekable().peek()` in `prepare_copy` takes the first chunk first.
   `'prov: { .. break 'prov None }` in `read_ptr` is a labelled block. `trace!` / `debug_assert!` are comments.

## `unported(...)` left
- `std::alloc::handle_alloc_error (...)` in `Allocation::new` (host allocation failure: rustc aborts the process).
- `Decodable for ... InitMask` (init_mask.ts) and `Decodable for ... SortedMap<rustc_abi::Size, _>` (provenance_map.ts):
  derived `Decodable_NoContext`, not generated for the `rustc_middle_mir` codegen set, so `decode_Allocation` stops at
  the provenance map. **For tools/root**: `derive_decodable` on the set (InitMask, InitMaskBlocks) and serialize.json
  entries for `rustc_abi::Size` (`Size::from_bytes(decode_u64)`, derive of `struct Size { raw: u64 }`) and
  `SortedMap` (`Vec<(K, V)>`), then replace the two stand-ins.
- `Hash for ... ProvenanceMap` / `InitMask` (allocation.ts, used by `hash_Allocation`): derived `Hash`, not generated.
  TS interning keys on `intern_key`, so nothing calls `hash_Allocation` today.

## For root / other lanes
- Metadata `ConstAllocation` is not reachable yet: `TyCtxt::mk_const_alloc` is an `unported` stub in ty/context.ts,
  ty/codec.ts keeps its own `decode_Allocation` stand-in, rustc_metadata cstore_impl.ts decodes `ConstAllocation` with
  `decode_unported`. Wire `codec.ts` to `decode_Allocation(d, decode_CtfeProvenance, () => null)` once the derived
  decoders above exist. No oracle comparison was possible (nothing decodes one).
- mir-interp-b: `read_scalar` / `write_scalar` / `adjust_from_tcx` call `Scalar.{from_uint, from_pointer,
  to_bits_or_ptr_internal}`, `Pointer.new` / `into_raw_parts`, `read_target_uint` / `write_target_uint`;
  `try_new` calls `InterpResult.from_result` + `InterpErrorInfo_from_InterpErrorKind`; `adjust_from_tcx` `interp_ok`.
  `AllocError::to_interp_error`'s `ReadPartialPointer` arm calls `Pointer.new`.
- The 2 scalar tests in allocation.test.ts (`describe.skipIf(!interp_b_ported())`) start running once those are ported.
  They pass against local stand-ins written from upstream value.rs / pointer.rs / mod.rs (not committed): ptr write/read
  with provenance, int write/read, `ReadPointerAsInt` / `ReadPartialPointer` / uninit errors, a pointer copied bytewise in
  two halves re-assembling on read, the pointer-size-mismatch ICE text, big-endian layout.

## Re-pinned tests (no assertion weakened)
- `src/rustc_middle/mir/contract.test.ts`: the stub-per-lane table drops `"mir-interp-a": 91` (0 left); the marker scan
  skips ported upstream unit tests (`.../tests.rs` markers, here init_mask/tests.rs), which are not scope files of the
  715-fn check.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `bun test src/rustc_middle`: 291 pass, 2 skip (the mir-interp-b scalar tests), 0 fail; `src/rustc_middle/mir`
  (contract.test.ts included): 28 pass, 2 skip, 0 fail.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at the end): 5578 pass, 3 skip, **2 fail**, both in
  `src/rustc_lint/types.oracle.test.ts` ("late types lints: PENDING TypeLimits: fn pointer `==` suggestion stops at
  utils::std_or_core", "... ambiguous_wide_pointer_comparisons stops at utils::std_or_core"): the PENDING expectation of
  an `unported: rustc_lint::utils::std_or_core` stop no longer holds. Base fallout: they fail on `aae2f3fc` too
  (confirmed by root); nothing in this lane touches rustc_lint.

## Samples (lane vs base `aae2f3fc`; base = the detached worktree `lanes/mir-visit-base`; both `RUST_TS_AGENT=mir-interp-a`, same samples)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-194950-mir-interp-a-6jig` | 45 / 0 / 1 / 0 | `20261021-195252-mir-interp-a-o3wp` | 45 / 0 / 1 / 0 |
| tydump-ui `--sample 200` | `20261021-195015-mir-interp-a-11aq` | 177 / 0 / 23 / 0 | `20261021-195313-mir-interp-a-3gzb` | 177 / 0 / 23 / 0 |
| hir-tree `--sample 200` | `20261021-195137-mir-interp-a-srxg` | 199 / 0 / 1 / 0 | `20261021-195441-mir-interp-a-y5xl` | 199 / 0 / 1 / 0 |

No new DIFF; every case has the same status and the same `unported` stop as on base (compared per case). No current
suite reaches an allocation (MIR building / CTFE are later waves).

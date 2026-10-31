# size-bigint: exact `Size` above 2^53

Lane: `lane/size-bigint` (worktree `/Users/tomernorman/.t3/worktrees/rust-ts/t3-be40ae68`), based on `cb7b9a60`
(main `e4ba72ab` plus the decision record). Implements root's decision of 2026-10-31 ("Size representation", the
gaps-30b stop-4 design).

## Design (`src/rustc_abi/lib.ts`, `Size`)

- `Size` has two forms. A value below 2^53 is `small: number` with `big: undefined` (the fast path: every existing
  caller). A value of 2^53 or more is `big: bigint` with `small: NaN`. `big` is set only above
  `Number.MAX_SAFE_INTEGER`, so each value has exactly one representation (one `intern_key` too). The constructor is
  private: values come from `from_bytes` / `from_bits` (through `Size.of`) or `ZERO`.
- `raw` is now a **getter**. It returns `small`, or stops with `unported(SIZE_BEYOND_2_53)` on a big Size. So every
  `.raw` read that was not converted (in other lanes' files too) stops and never rounds. This is why I picked a getter
  rather than `raw = NaN`: with NaN, `a.raw === b.raw` would quietly be false for two equal big sizes.
- `bytes()` / `bits()` / `bytes_usize()` behave as before: a `number`, and `unported` when the value can't be exact.
- New helpers, each with a `PORT (size-bigint)` note:
  - `bytes_u64(): bigint`, always exact;
  - `is_big()`;
  - `Size_eq` (the derived `PartialEq`);
  - `Size_cmp` (the derived `Ord`, returning -1/0/1).
  `Size_eq` and `Size_cmp` compare `number`s when both sides are small.
- The `Size` ops all handle the big form: `from_bits`, `from_bytes`, `align_to`, `is_aligned`, `checked_add`,
  `checked_mul`, `add`, `sub`, `mul`, and `Step_Size` `forward*`/`backward*`. `add` and `sub` keep a `number` fast path
  when both sides are small. `steps_between` still stops when its `usize` count goes past 2^53.
- `debug_Size` prints the exact value (`Size(18446744073709551615 bytes)`). `Size` has no `Display`.
- I kept the `SIZE_BEYOND_2_53` text unchanged, so UNPORTED reasons can be compared with earlier runs.

## Converted paths

- **Pointer / Scalar** (rustc_middle mir/interpret):
  - `wrapping_offset`;
  - the four `Provenance::fmt` / `Pointer<Option<_>>` Debug/Display impls (`+0x…`, `[noalloc]`, `null pointer`);
  - `Scalar::from_pointer` and `to_bits` (value.ts);
  - `Allocation::write_scalar` and the pointer-bytes write (allocation.ts);
  - the `ProvenanceMap` encoder.
- **const_eval**:
  - every `BigInt(<size>.bytes())` became `<size>.bytes_u64()` (memory, intrinsics, place, operator, validity, simd,
    type_info, machine); these are exact and the same for small values;
  - `scalar_may_be_null`'s in-bounds and alignment checks;
  - `guaranteed_cmp`'s residue, equality and in-bounds checks;
  - `size_of_val` / `align_of_val` (the result is a `u64` bigint);
  - `size_and_align_from_meta`: now upstream's `full_size > self.max_size_of_val()` / `size > max_size_of_val()` through
    `Size_cmp`, replacing the old `target_isize_max` workaround. Its `assert_eq!` compares with `Size_eq` and prints
    `{:?}` as upstream does;
  - `offset_with_meta`: `offset.bytes().try_into().unwrap()` on the exact offset (it panics above `i64::MAX` as
    upstream does).
- **rustc_abi layout**:
  - `univariant_biased`: the `obj_size_bound` check; the ZST, scalar and scalar-pair checks; `Size_max`; the field sort
    keys (`alignment_group_key` with `u64_trailing_zeros_u64` for a big size, and `inner_niche_offset_key`);
  - `layout_of_enum`: the niche-filling largest-variant key, the fits-before/after-niche checks, `others_zst`,
    `same_size`, the `obj_size_bound` check, the discriminant patch-up, the tag-equals-size check, the common-prim
    offset and the scalar-pair checks. Upstream compares `Size`s there; the port had compared `.bytes()`;
  - `is_zst` / `is_1zst` (as `Size_eq(size, ZERO)`, which allocates no bigint);
  - layout/ty.rs `homogeneous_aggregate`; `Reg_eq`.
- **rustc_ty_utils**:
  - `layout_sanity_check`'s release-mode checks (multiple of align, `obj_size_bound`), plus its debug-only comparisons;
  - layout.ts's coroutine and unsizing comparisons, `size_eq` and `size_max`.
- **Codegen**: `tools/codegen/serialize.json`'s `Size` encode is now `encode_u64($v.bytes_u64(), $E)`. I regenerated
  `rustc_middle_mir` and `rustc_crate_store`. That changed 4 lines in `pointer.gen.ts`, `consts.gen.ts`,
  `init_mask.gen.ts` and `cstore.gen.ts`, and nothing else.

## `.raw` / `Size_eq` audit

Every `.raw` read of a `Size` in rustc_abi, rustc_ty_utils, rustc_middle/mir/interpret and rustc_const_eval now uses
`Size_eq` / `Size_cmp` / `bytes_u64()`. Some reads remain in other lanes' files and go through the guarded getter, so
on a big Size they stop rather than compare wrongly:
- `rustc_middle/mir/pretty.ts` (allocation dumps; an allocation is never ≥ 2^53 bytes);
- `rustc_middle/ty/print/pretty.ts:2280`;
- `rustc_lint/builtin.ts:2183` and `rustc_lint/types/literal.ts`.

`Size_eq` didn't exist before this lane; the earlier per-file `size_eq` helpers now call it.

## Results

### The gaps-30b case list (mir), all 33 ids the gate had at `Size beyond 2^53`

The gaps-30b handoff lists 32 cases; the gate has one more, `const-generics/transmute-fail`.
- Before: 0/33 MATCH. After: **30/33 MATCH**.
- The other 3 now stop at a different, non-`Size` cause:
  `rustc_middle::mir::interpret::UndefinedBehaviorInfo u64/i64 field beyond 2^53 (a number in error.gen.ts)`. The
  cases are `consts/const_transmute_type_id2`, `consts/offset_from_ub` and `consts/offset_ub`. Codegen types the
  `addr` / `inbounds_size` / `ptr_offset` fields of `DanglingIntPointer` / `PointerOutOfBounds` as `number`
  (memory.ts `i64_number`). Fixing that means a typemap change to `bigint`, plus error.ts's Display and validity.ts's
  readers, so I left it (see "For root").

### M5 suites

I ran these on a throwaway branch `tmp/size-bigint-m5c`: this lane plus a merge of **`lane/harness-m5c`, which is not
yet reviewed**. The merge is **not** on `lane/size-bigint`. Runs went one at a time, with no other heavy process.

| suite | before | after | subject cost | run |
|---|---|---|---|---|
| mir-std | UNPORTED 5,204/5,204 (harness-m5c) | **MATCH 5,204/5,204** | 24.6 s wall, 3,382 MB | `20261031-084342-root-f5de-zbva` |
| mir-alloc | MATCH 3,734 | MATCH 3,734/3,734 | 21.9 s, 2,376 MB | `20261031-084412-root-f5de-2are` |
| check-alloc | MATCH 1 | MATCH 1/1 | 19.7 s, 2,390 MB | `20261031-084434-root-f5de-vbpt` |
| check-std | MATCH 1 | MATCH 1/1 | 20.7 s, 3,347 MB | `20261031-084455-root-f5de-1w5x` |
| check-core | MATCH 1 | MATCH 1/1 | 113.5 s, 8,732 MB | `20261031-084521-root-f5de-xxra` |

### Samples (`RUST_TS_AGENT=root-f5de`)

"Before" is the gate `gate-20261030-222147-root-bec4` on the same ids.

| run | before | after | details |
|---|---|---|---|
| `--suite mir --sample 300` | MATCH 297, UNSTABLE 2, UNPORTED 1 | **MATCH 298**, UNSTABLE 2 | +transmute-fail; `20261031-083926-root-f5de-sjx7` |
| `--suite tydump-ui --sample 300` | MATCH 298, UNSTABLE 2 | MATCH 298, UNSTABLE 2 | unchanged; `20261031-084017-root-f5de-5ppo` |
| `--suite mir-core` (full) | MATCH 47,734 | MATCH 47,734/47,734 | 125.7 s wall, 8,081 MB (the gate measured 115 s); `20261031-084113-root-f5de-l5wt` |

The mir-core run was in progress while I made the last commit's `place.ts` edit (an `i64` unwrap that only fires
above `i64::MAX`, plus a comment), so its batches may have mixed the two trees. The results can't differ, but root's
gate run is the clean evidence.

### Checks

- `bunx tsc --noEmit -p .` is clean, and `bun scripts/coverage.ts --check` reports markers ok (23,168; vendor 4,680).
- `bun test`: all pass.

  | directory | pass |
  |---|---|
  | `src/rustc_abi` | 27 |
  | `src/rustc_middle/mir` | 85 |
  | `src/rustc_const_eval` | 39 |
  | `src/rustc_mir_transform` | 81 |
  | `src/rustc_ty_utils` | 32 |
  | `src/rustc_metadata` | 128 |
  | `src/rust_ts/intern_key.test.ts` | 6 |
  | `tools/codegen/serialize.test.ts` | 7 |

- `abi_lib.test.ts` was updated to the new contract. Cases that used to assert `unported` on values ≥ 2^53 now assert
  exact `bytes_u64()`. New assertions cover `bytes()`/`raw` stopping on the big form, Debug, `Size_eq`/`Size_cmp`
  across forms, big-form `add`/`sub`/`mul` panic texts, a big-form result coming back to the small form, big
  `align_to`/`is_aligned`, `Step` wrapping to 2^64 - 1, and `steps_between` stopping.

### Coverage (`bun scripts/coverage.ts --missing`), all fully ported

- rustc_abi: `lib.rs` 157/157, `layout.rs` 16/16, `layout/ty.rs` 47/47, `callconv/reg.rs` 3/3.
- rustc_middle mir/interpret: `pointer.rs` 39/39, `value.rs` 61/61, `allocation.rs` 51/51, `provenance_map.rs` 23/23.
- rustc_const_eval: `eval_context.rs` 37/37, `intrinsics.rs` 27/27, `memory.rs` 73/73, `place.rs` 60/60,
  `operator.rs` 10/10, `validity.rs` 41/41, `machine.rs` 38/38, `type_info.rs` 6/6, `intrinsics/simd.rs` 6/6.
- rustc_ty_utils: `layout.rs` 9/9, `layout/invariant.rs` 4/4.

## `unported(...)` left

- No new ones. `SIZE_BEYOND_2_53` now fires only from:
  - `Size.raw` / `bytes()` / `bits()` / `bytes_usize()` / `bits_usize()` on a value they can't return exactly;
  - `u64_arg` / `usize_arg` given a `number` that isn't a safe integer;
  - `steps_between`, through `bytes()`.
- The 3 cases above stop at the existing `i64_number` unported in memory.ts, which isn't new.

## `// PORT:` decisions (all marked `PORT (size-bigint)`)

1. The two-form `Size` and the guarded `raw` getter (the design above).
2. `align_to` wraps `bytes + mask` to `u64`, as rustc's release build does. The overflow is unreachable in practice.
3. `add` / `sub` take a `number` fast path when both values are small.
4. `alignment_group_key`: a big-form size is larger than any `Align` (2^29 at most), so `align.max(size)` is `size`.
5. `size_and_align_from_meta` goes back to upstream's `Size` comparisons against `max_size_of_val()`.
6. `size_of_val`'s result is an exact `u64`.
7. `offset_with_meta`'s `try_into().unwrap()` panic text is `TryFromIntError(())`.

## For root

- **Unreviewed merge:** mir-std was measured with `lane/harness-m5c` merged, which hasn't been reviewed yet. That merge
  is only on the local branch `tmp/size-bigint-m5c` (not pushed; delete it after integration).
- **Follow-up (3 mir cases):** `UndefinedBehaviorInfo`'s `u64`/`i64` fields (`DanglingIntPointer.addr` /
  `inbounds_size`, `PointerOutOfBounds.ptr_offset` / `inbounds_size`) are `number` in `error.gen.ts`. Making them
  `bigint` is a typemap decision that also touches `error.ts` Display, `validity.ts` and tests. It would unblock
  `const_transmute_type_id2`, `offset_from_ub` and `offset_ub`.
- **Notes left as they were:** the `mir.typemap.json` / `typemap.hir.json` `Size` notes still say "abi-lib decision:
  `Size.raw` is a number". The notes don't affect generated output, so I didn't touch them.
- **Edits outside the obvious lane files**, needed for the audit: `src/rustc_ty_utils/layout.ts` and
  `layout/invariant.ts`. Also `tools/codegen/serialize.json` plus 4 regenerated `.gen.ts` files.

# Review: lane `size-bigint` (exact `Size` above 2^53)

Reviewer: independent, read-only. Batch: `git diff cb7b9a60...lane/size-bigint` (head 2f2af931, 4 commits). Checked
against the pinned upstream (`compiler/rustc_abi/src/lib.rs` `Size`, plus the converted callers in rustc_const_eval
interpret / const_eval, rustc_middle mir/interpret, rustc_abi layout, rustc_ty_utils layout and the codegen `Size`
encoder) and root's decision (cb7b9a60, "Size representation").

## Verdict: APPROVE WITH NITS

No blocking findings.

## Checks

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check --offline` | markers ok (23168; vendor 4680) |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_abi src/rustc_const_eval src/rustc_middle src/rustc_ty_utils src/rustc_metadata tools/codegen` | 635 pass, 0 fail (88 files) |
| `difftest --suite mir --sample 200` (`RUST_TS_AGENT=rev-sizebig`) | MATCH 200/200; run `20261031-085133-rev-sizebig-njis` |
| `--filter` on the 4 named cases | `const-generics/transmute-fail` MATCH. `consts/offset_ub`, `consts/offset_from_ub` and `consts/const_transmute_type_id2` are UNPORTED at `UndefinedBehaviorInfo u64/i64 field beyond 2^53 (a number in error.gen.ts)`: a clean stop, not wrong output |

I did not re-run the M5 suites (mir-std, check-core). Those numbers were measured with the unreviewed
`lane/harness-m5c` merged in. They are plausible: mir-std's only blocker was `SIZE_BEYOND_2_53`, and this lane removes
that at its source. Root's gate run is the evidence.

## What I verified

1. **Fidelity of `Size`.**
   - `from_bits` uses `div_ceil(8)`. `from_bytes` keeps the `try_into().ok().unwrap()` panic.
   - `bits` keeps upstream's overflow message, now printed with the exact value.
   - `checked_add` / `checked_mul` return `None` at or above `u64::MAX` or `obj_size_bound`.
   - `add` / `sub` / `mul` keep upstream's panic texts. Their small fast paths are exact: an `add` sum is used only when
     `Number.isSafeInteger`, and a `sub` of two safe integers is exact.
   - The `Step` ops wrap or check as before.
   - `align_to` wraps at `u64`, as rustc's release build does (PORT note, unreachable).
   - `max_aligned_factor` and the `randomization_seed` use `bytes_u64()`.
   - Each value has one representation (`Size.of` uses big only above `MAX_SAFE`), so `intern_key` stays canonical: a
     NaN `small` gives the key `NaN`, and `intern_key_eq` uses `Object.is`.
2. **Converted callers match upstream.**
   - `size_and_align_from_meta`: `full_size > max_size_of_val()` / `size > max_size_of_val()`, with `saturating_mul`
     then `from_bytes`. The `assert_eq!` message matches the `{:?}` format.
   - `guaranteed_cmp`: residue, `==` and `<`.
   - `scalar_may_be_null`: `offset <= info.size`, `is_multiple_of`.
   - `offset_with_meta`: `try_into().unwrap()` with `TryFromIntError(())`.
   - `wrapping_offset`, which follows upstream's `wrapping_add` and `truncate_to_target_usize`.
   - The pointer Debug/Display output (`+0x…`, `[noalloc]`, `null pointer`), and `Scalar::from_maybe_pointer` /
     `try_to_scalar_int`.
   - The layout comparisons now compare `Size`s, as upstream does. `alignment_group_key` relies on "big ⇒ larger than
     any align", which is correct: align ≤ 2^29.
   - The `inner_niche_offset_key` `!x` is computed as `U64_MAX ^ x`.
3. **Comparisons.** No `===` / `<` on Size objects or on `.small` / `.big` outside lib.ts. `.small` / `.big` are not
   read anywhere else. The `.raw` reads left are all in other lanes' files (`rustc_middle/mir/pretty.ts`,
   `rustc_middle/ty/print/pretty.ts:2280`, `rustc_lint/builtin.ts:2183`, `rustc_lint/types/literal.ts`). They go
   through the guarded getter, so they stop rather than round.
4. **Encoding.** `encode_u64(bigint)` → `emit_u64` is exact LEB128. The serialize.json encoder and the 4 regenerated
   `.gen.ts` lines are identical in shape. Decoding goes through `from_bytes(decode_u64)`, which is exact.
5. **Debug** prints `Size(N bytes)` with the exact value (`v.big ?? v.small`), as upstream's `{}` of `self.bytes()`
   does.
6. **Performance.**
   - Small values never touch bigint in `from_bytes`, `add`, `sub`, `Size_eq`, `Size_cmp`, `is_zst` / `is_1zst`, or the
     `bytes()` getter.
   - The `BigInt(x.bytes())` sites became `bytes_u64()`, which costs the same.
   - Each object now has two fields, so a `Size` uses a little more memory. The handoff's check-core and mir-core
     figures look in line with the gate's.

## Findings

All non-blocking.

1. **Stale comments (nit).** These comments still say a `Size` stays below 2^53, or that `max_size_of_val()` is
   unported:
   - `src/rustc_const_eval/interpret/memory.ts:552`;
   - `src/rustc_const_eval/interpret/memory.ts:739`: "a `Size` is below 2^53 (recorded decision), so it always fits";
   - `src/rustc_const_eval/interpret/operator.ts:531`: "unported under the Size rule";
   - `src/rustc_const_eval/interpret/intrinsics.ts:568`;
   - `src/rustc_const_eval/interpret/validity.ts:548`;
   - `src/rustc_middle/mir/interpret/pointer.ts:11-12`: "a `Size` past 2^53 stops in `Size::from_bytes`";
   - `src/rustc_abi/layout.ts:277-278`;
   - the `mir.typemap.json` / `typemap.hir.json` notes, which the handoff already flags.

   Update them in a follow-up.
2. **Unchecked `i64::try_from(size.bytes()).unwrap()` (nit).** The four memory.ts sites `get_ptr_access` (~740),
   `check_ptr_access`, `get_ptr_alloc` and `get_ptr_alloc_mut` now pass `bytes_u64()` without upstream's panic above
   `i64::MAX`. `intrinsics.ts:568` (`ptr_offset_from`) is the same. Before this lane, `from_bytes` made such a value
   impossible. Now it is still unreachable: access sizes are layout sizes, below `obj_size_bound` (2^61), or come from
   `compute_size_in_bytes`, which filters to at most `isize::MAX`. For consistency with `place.ts`'s
   `offset_with_meta`, add the check, or at least fix the comment.
3. **Local comparators still use `.bytes()` (nit).** They stop on a big value rather than compare it, and are never fed
   one in practice (provenance offsets, range sets within an allocation):
   - `provenance_map.ts:27` `cmp_Size`;
   - `layout/ty.ts:58` and `validity.ts:154` `SIZE_RANGE_SET_OPS.cmp`;
   - `validity.ts:163` `size_eq`.

   They could call `Size_cmp` / `Size_eq`. The handoff's audit claim covers `.raw` only, which is accurate.
4. **Upstream form not restored in two places (nit).**
   - `compute_size_in_bytes` (`operator.ts:532`) still compares against `target_isize_max` as a bigint, instead of
     upstream's `.filter(|&total| total <= self.max_size_of_val())`.
   - `allocate_bytes_ptr`'s assert (`memory.ts:551`) does the same.

   Both are semantically equal. Restore the `Size_cmp` form, as was done in `size_and_align_from_meta`, when the
   comments in finding 1 are fixed.
5. **Clean stops on newly reachable big offsets (note).** Big pointer offsets now reach callers that are not converted.
   One is the `offset.bytes() !== 0` check in `memory.ts` 573 / 611 / 658 / 1307 / 1324 / 1346 / 1373 (deallocate,
   vtable / fn / type-id pointer lookups). Another is `rustc_lint/builtin.ts:2183`. A case that reaches one with a
   dangling big-offset pointer stops UNPORTED at `SIZE_BEYOND_2_53` instead of reporting upstream's UB. That is the
   decision's intended behaviour (stop, never round); convert them only if a suite case needs it.

## Handoff claims

- **Coverage, tsc, markers and unit tests:** reproduced.
- **30/33:** consistent. I checked the 3 remaining cases (clean `unported` at the existing `i64_number` guard) plus
  `transmute-fail` (MATCH).
- **mir-std 5,204/5,204:** not reproduced here, since it depends on the unreviewed `lane/harness-m5c`. Plausible; leave
  it to root's gate.

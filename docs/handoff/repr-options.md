# Handoff: repr-options (M3)

Branch `lane/repr-options`, based on 00ce463 (merge-w15b handoff).

`TyCtxt::repr_options_of_def` is ported, along with rustc_abi's `ReprFlags`, `IntegerType`, `ScalableElt` and
`ReprOptions`. It matches the oracle byte for byte, so `adt_def` no longer stops on it (collect-a "For root" 1).

## Files
- `src/rustc_abi/lib.ts` (extended):
  - `ReprFlags`: bitflags. It is a branded number with a `flags_companion`, like `AdtFlags`. Its Debug is `to_writer` (lib.rs:116).
  - `IntegerType`: the union, `is_signed`, Debug and `IntegerType_eq`.
  - `ScalableElt`: Debug and `ScalableElt_eq`.
  - `ReprOptions`: a class with all 13 methods, `debug_ReprOptions` and `ReprOptions_eq`.
  - `TargetDataLayout`: `obj_size_bound(_in)`, `ptr_sized_integer(_in)`, `c_vector_align`, `rust_vector_align`, `pointer_offset(_in)`, and `data_layout` (the `HasDataLayout` impl, placed in the class body per §8).
  - `interface HasDataLayout`.
  - `Size`: `bytes_usize`, `bits_usize`, `align_to`, `is_aligned`, `checked_add`, `checked_mul`, `sign_extend`, `truncate`, `signed_int_min`, `signed_int_max`, `unsigned_int_max`.
  - `Align`: `max_for_target`, `bytes_usize`, `bits_usize`, `max_aligned_factor`, `restrict_for_offset`, plus the derive helpers `Align_eq`, `Align_min` and `Align_max`.
  - `AbiAlign`: `min`, `max` and `debug_AbiAlign`.
  - `Integer`: `int_ty_str`, `uint_ty_str`, `size`, `from_attr`, `align`, `signed_max`, `signed_min`, `fit_signed`, `fit_unsigned`, `for_align`, `approximate_align`, and `debug_Integer`.
- `src/rustc_middle/ty/mod.ts`: `TyCtxt_repr_options_of_def` (mod.rs:1588) is ported, replacing the stub.
- Stand-ins repointed at the real rustc_abi types and methods:
  - `ty/decls.ts`: `ReprOptions` is now a re-export, no longer `Pending`.
  - `ty/util.ts`: `IntegerType` is now a re-export.
  - `ty/adt.ts`: the `ReprOptions_packed` and `ReprOptions_discr_type` stand-ins are gone.
  - `ty/sty.ts`: the `ReprOptions_{simd,is_scalable,scalable,discr_type}` stand-ins and its local `ReprOptions`/`ScalableElt` types are gone. This had to change too, because its call sites no longer typechecked once `AdtDef::repr()` returned the real type.
- Tests:
  - `src/rustc_abi/tests.test.ts`: from tests.rs, `align_constants` only. The `WrappingRange` tests need wrapping_range.rs.
  - `src/rustc_abi/repr.test.ts`: unit tests.
  - `src/rustc_middle/ty/ty_mod_b.test.ts`: the old "stops UNPORTED" test is replaced by a mocked-tcx `repr_options_of_def` test.
  - `src/rustc_middle/ty/repr.oracle.test.ts` and `ty/repr_oracle/{probe.rs,run.ts,r.rs,l.rs,expected.json}`: an oracle test against a throwaway rustc-dev probe (consts_oracle pattern; the build line is in the probe.rs header).
    - Three cases: `r.rs` as a bin, `r.rs` with `-Zrandomize-layout -Zlayout-seed=12345`, and `l.rs` as a lib.
    - They cover `repr(C)`, `repr(u8/isize/usize/i128)`, `repr(C, u16)`, `repr(packed(2))`, `repr(packed)`, `repr(C, packed(4), packed(1))`, `repr(align(8))`, `repr(align(2), align(16), align(4))` on a union, `repr(transparent)`, `repr(simd)`, `repr(Rust)`, the `owned_box` lang item (IS_LINEAR), `rustc_pass_indirectly_in_non_rustic_abis`, and `rustc_scalable_vector(4)` with and without `N`.
    - Each case checks the `{:?}` and `{:#?}` output, all predicates and `discr_type`. stdout, stderr and the exit code are identical to the oracle.

## Coverage
- `bun scripts/coverage.ts --check`: markers ok (12313; vendor 3888).
- rustc_abi lib.rs: 55 new markers (81 in total).
  - 77 fns are still missing. They are `BackendLaneCount`, `TargetDataLayoutError::into_diag`, the `Size` `Add`/`Sub`/`Mul`/`Step` impls, `AbiAlign::deref`, and everything from `Float` (:1437) on (`Primitive`, `Scalar`, layout, ...).
  - `HasDataLayout for &TargetDataLayout` (:815) is left missing: with `&T` = `T` it is the same impl as :807.
  - The nested `Size::bits::overflow` (:914) is never reached (see the PORT note).
- rustc_middle ty/mod.rs: no missing fns.

## Sample runs
- `difftest --suite hir-tree-nocore --sample 200` (run `20261014-150745-repr-options-5z4i`): 199 MATCH, 1 UNPORTED. The UNPORTED case is `delegation/target-expression-removal-pass.rs` (`fn_sig provider`); it is not protected and was already unported.

## unported(...) left
- None added.
- Still open, not owned by this lane:
  - `CrateMetadata::get_adt_def` (decoder.ts:1624).
  - `Decodable for AdtDefData` (codec.ts:422).
  - These need `decode_ReprOptions` (and `IntegerType`, `ScalableElt`, `ReprFlags`) from codegen. **There is no rustc_abi set in tools/codegen/types.sets.json**, so the decoder is not a codegen opt-in that a porting lane can switch on. Root or a codegen lane should add a rustc_abi set: `derive_decodable` for `ReprOptions`, `IntegerType`, `ScalableElt` and `Integer`, and `ReprFlags` as a bitflags `u8`. `Align` is already mapped in serialize.json and `Hash64` is ported.

## For root
1. **Gap found (not fixed; tools/ is not mine):** `StableHash for rustc_abi::Align` is not generated.
   - `stable_hash_ReprAttr` calls `unported_stable_hash` for the `ReprPacked`/`ReprAlign` payloads (rustc_attr_ir/stable_hash.gen.ts:213).
   - So any crate that needs the crate hash (every lib crate) and has `#[repr(packed)]` or `#[repr(align)]` stops UNPORTED in HIR hashing. For example, `r.rs --crate-type=lib` in the oracle test.
   - Suggested fix: a tools/codegen/stable_hash.json entry `{"paths": ["rustc_abi::Align"], "stable_hash": "stable_hash_u8($v.pow2, $hcx, $h)"}` (derive on `struct Align { pow2: u8 }`), then regenerate. Then add `{ name: "lib-full", args: ["r.rs", "--crate-type=lib"] }` to repr.oracle.test.ts.
2. When collect-a merges, repoint its stand-ins at the real ports: `rustc_abi::ReprOptions::{discr_type, c}` and `rustc_abi::Size::{signed_int_min, signed_int_max, unsigned_int_max}`. All of them now exist on `ReprOptions` / `Size`.
3. `GlobalCtxt.data_layout` (context.ts:2930) is still `unported`. `Integer::from_attr(tcx, ..)` and the other `HasDataLayout` users need it once `TyCtxt` implements `HasDataLayout`.

## PORT decisions
1. `ReprFlags` is a branded `number` with the `flags_companion` API, the same as `AdtFlags`. Its Debug is bitflags' `to_writer`, so the empty set prints `flags: `, as rustc does.
2. `ReprOptions` is a class. The `scalable()` method is named `is_scalable()` because the field `scalable` holds the name (sty.ts already used that name).
3. Derived `PartialEq`/`Ord` on `Align`, which is a class whose instances are not unique, are the free functions `Align_eq`, `Align_min` and `Align_max`. They keep `Ord::min`/`Ord::max` tie behaviour. `Option<Align>::max` in `repr_options_of_def` is written out (`None` < `Some`).
4. `u128`/`i128` values (`sign_extend`, `truncate`, `signed_int_*`, `Integer::signed_*`, `fit_*`) are `bigint`. `obj_size_bound` returns a `number`, since it is a power of two and exact. `align_to`/`is_aligned`/`checked_mul` do their mask and overflow arithmetic in `bigint`.
5. `find_attr!(.., RustcScalableVector { element_count } => element_count)` returns `Option<&Option<u16>>`. The port keeps the outer `Some` as an `{ element_count }` wrapper.
6. Hand-written Debug/PartialEq for the rustc_abi derives (PORTING "Traits"): there is no rustc_abi codegen set.

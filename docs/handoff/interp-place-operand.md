# Handoff: interp-place-operand (M4 wave 23c, CTFE fill lane)

Branch `lane/interp-place-operand` (from `43e37d73`, no merges). Commits: the port (`ea301612`), then this handoff.

## Result
- **compiler/rustc_const_eval/src/interpret/place.rs 60/60, operand.rs 56/56** (`bun scripts/coverage.ts --missing`): all
  112 stubs of the split table's `interp-place-operand` row are ported (place 58, operand 54), in upstream order, with
  `// rustc:` markers. rustc_const_eval 395/764; TOTAL 19911/25518. `--check`: markers ok (20490; vendor 4330).
- No `unported(..)` left in place.ts / operand.ts. The paths reach other lanes' stubs (see "Where it stops").
- `src/rustc_const_eval/interpret/contract.test.ts`: markers 176 → 288, stubs 481 → 369, the `interp-place-operand`
  row removed (0). Runtime pin unchanged: `eval_to_allocation_raw` of `const C: u8 = 7;` still stops at
  `eval_queries::eval_in_interpreter` (ctfe-a).
- New unit test `src/rustc_const_eval/interpret/place_operand.test.ts` (end to end isn't reachable yet): `Immediate`
  constructors and accessors, `ImmTy::from_*`, `Display` (`7_u8`, `uninit: u8`) and `Debug` of `ImmTy`,
  `assert_matches_abi`, `read_scalar` / `read_target_usize` / `read_immediate` (uninit → UB) on immediate operands,
  `ImmTy::offset_` / `to_pair` on a `(u8, u32)` `ScalarPair`, `PlaceTy` local projection (and its bounds assert),
  `fake_alloc_zst`, wrapping `MPlaceTy` offsets. It also pins where the memory paths stop: `allocate` →
  `memory::InterpCx::allocate_ptr` (interp-memory), `copy_op` into an mplace →
  `CompileTimeMachine::enforce_validity` (ctfe-b).

## Signature changes to the contract (please record)
1. `as_mplace_or_mutable_local` (private to place.rs) returns `Either<MPlaceTy, [MutRef<Immediate>, TyAndLayout,
   Local]>`: upstream's `&mut Immediate` (the local's value) is a `MutRef` whose setter stores
   `LocalValue::Live(Operand::Immediate(v))` into the frame's `LocalState.value` (the mutable field).
2. `Immediate::clear_provenance(&mut self)` is `Immediate.clear_provenance(self: MutRef<Immediate>)` (as
   `Scalar.clear_provenance`); immediates are shared values, never mutated in place.
3. `ImmTy::to_pair` / `ImmTy::from_pair` take `cx: HasTyCtxt & HasTypingEnv` (the contract had the tuple types
   `[HasTyCtxt]` / `[HasTypingEnv]`).
4. `print_scalar` (nested in `impl Display for ImmTy`) moved inside `display_ImmTy` and returns `PrintResult`.

## `// PORT:` decisions
- `self.clone()` of `PlaceTy::to_place`, `MPlaceTy::force_mplace`, `OpTy::to_op`, `ImmTy::to_op` shares the value
  (decision 4 of interp-contract: values are immutable once built).
- `*self.frame_mut().locals[local].access_mut().unwrap() = Operand::Indirect(..)` (`force_allocation`): `access_mut`
  is unwrapped, then `LocalState.value = { $: "Live", _0: { $: "Indirect", .. } }`.
- `cfg!(debug_assertions)` blocks are skipped (`ImmTy::offset_`'s input check, `write_immediate_no_validate`'s ABI
  check, the `mir_assign_valid_types` sanity checks of `eval_place` / `eval_place_to_op`); `copy_op_no_validate` takes
  the `else` branch (fixed-size comparison). `debug_assert!`s are comments.
- `M::Provenance::OFFSET_IS_ADDR` is `Provenance_CtfeProvenance.OFFSET_IS_ADDR` (false).
- `offset.bytes().try_into().unwrap()` (u64 → i64, `MemPlace::offset_with_meta_`) is `BigInt(offset.bytes())`.
- `Display for ImmTy`: a print error panics with `format!`'s "a Display implementation returned an error unexpectedly".
- Non-upstream helpers exported from operand.ts (used by place.ts): `assert_eq_msg` (`assert_eq!(a, b, "msg")`),
  `size_eq` (`Size` `==` by `.bytes()`), `assert_matches_none` (`assert_matches!(meta, MemPlaceMeta::None)`).

## Where it stops (the next stubs on these paths, other lanes)
- interp-memory: `allocate_ptr` (`allocate_dyn`), `get_ptr_alloc(_mut)`, `check_misalign`, `is_ptr_misaligned`,
  `AllocRef::read_scalar`, `AllocRefMut::write_scalar` / `write_uninit_full` / `clear_provenance`, `mem_copy`,
  `global_root_pointer`, `scalar_may_be_null`, `check_ptr_access` / `check_ptr_align`, `get_ptr_vtable_ty`,
  `read_bytes_ptr_strip_provenance`, `validation_in_progress`.
- interp-step-call: `LocalState::access` / `access_mut`, `Frame::locals_addr`, `layout_of_local`. **Note for
  interp-step-call:** place.ts writes locals by assigning `LocalState.value` (a fresh `LocalValue::Live`); `access_mut`
  should return the live `Operand` and keep `value` the single source of truth.
- interp-intrinsics (wave 24): `ptr_offset_inbounds`, reached by `OffsetMode::Inbounds` offsets of memory places
  (`Projectable::offset`, i.e. every field projection into memory).
- interp-ops: `project`, `Projectable_provided.offset` / `len` / `transmute`.
- interp-validity-intern: `validate_place`. ctfe-b: `CompileTimeMachine::enforce_validity`, `runtime_checks`.
- ctfe-a: `eval_in_interpreter` (still the stop of every non-trivial const in the samples).

## Samples (`RUST_TS_AGENT=root-f5de`, at `ea301612`)
| suite | run | M / D / U | vs interp-contract run (`e99b4cde`) |
|---|---|---|---|
| mirdump-minicore (46) | `20261022-193556-root-f5de-x55j` | 45 / 0 / 1 | `z4n9` 43 / 0 / 3: 2 UNPORTED → MATCH |
| tydump-minicore (46) | `20261022-193624-root-f5de-tpef` | 45 / 0 / 1 | `qaih` 45 / 0 / 1: no move |
| mirdump-ui `--sample 300` | `20261022-193654-root-f5de-wv1z` | 266 / 0 / 34 | `f9jh` 222 / 0 / 78: 44 UNPORTED → MATCH |
| tydump-ui `--sample 300` | `20261022-194050-root-f5de-hv4z` | 258 / 0 / 40 (+2 UNSTABLE) | `j6hf` same: no move |

**0 DIFF, 0 CRASH, no case lost** (per case, only UNPORTED → MATCH). The 2 + 44 moves are exactly interp-contract's
`validate::Validator` stops (2 / 44), so they come from mt-validate, which was already merged at the base `43e37d73`, not
from this lane. The const-eval stops did not move: `eval_queries::eval_in_interpreter` 16 (mirdump-ui) / 12 (tydump-ui),
`ConstValue::try_to_bits_for_ty (M4)` 2 / 1 / 1 (rustc_middle). The rest: `mir_borrowck provider` 16 / 25,
`hash_result` 2 (tydump-ui). This lane moves no case until ctfe-a (`eval_in_interpreter`) and interp-memory land.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok. contract.test.ts: 4 pass.
  place_operand.test.ts: 1 pass.
- Full `RUST_TS_AGENT=interp-place-operand RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `ea301612`
  (detached, clean tree; the first attempt was killed at the 1 h background limit on the loaded host, the rerun finished): **6102 pass, 1 skip (the existing one), 0 fail** (6103 tests, 436 files, 3642 s). Log: `$RUST_TS_DATA/scratch/interp-place-operand/logs/fulltest.log`.

## Files touched
- `src/rustc_const_eval/interpret/place.ts`, `src/rustc_const_eval/interpret/operand.ts` (the assigned files).
- `src/rustc_const_eval/interpret/contract.test.ts` (this lane's counts only), new
  `src/rustc_const_eval/interpret/place_operand.test.ts`, this handoff. No harness/ or scripts/ edits.

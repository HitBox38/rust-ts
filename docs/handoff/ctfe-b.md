# Handoff: ctfe-b (M4 wave 23c, CTFE fill lane)

Branch `lane/ctfe-b` (from `43e37d73`, no merges). Commits: the port (`d5876fe0`), then this handoff.

## Result
Every `ctfe-b` stub of the interp-contract split table is ported (40 → 0):
- `const_eval/machine.ts` (machine.rs 38/38): `display_MemoryKind`, `location_triple_for_span`, `hook_special_const_fn`,
  `guaranteed_cmp`, `best_lint_scope` and the whole `Machine` impl of `CompileTimeMachine` (`enforce_alignment`,
  `enforce_validity`, `load_mir`, `find_mir_or_eval_fn`, `panic_nounwind`, `call_intrinsic` with every CTFE intrinsic arm
  and the fallback-body path, `call_llvm_intrinsic`, `assert_panic`, `runtime_checks`, `binary_ptr_op`,
  `increment_const_eval_counter` (LONG_RUNNING_CONST_EVAL lint + progress warning), `expose_provenance`, `init_frame`,
  `before_access_global`, `retag_ptr_value`, `with_retag_mode`, `before_memory_write`, `before_alloc_access`,
  `cached_union_data_range`).
- `const_eval/dyn_trait.ts` 5/5, `const_eval/type_info.ts` 6/6, `const_eval/type_info/adt.ts` 5/5.
- Left in machine.ts: `CompileTimeMachine::static_def_id` (intern.rs, lane interp-validity-intern; not mine).

## Coverage / checks
- `bun scripts/coverage.ts --missing`: machine.rs 38/38, dyn_trait.rs 5/5, type_info.rs 6/6, type_info/adt.rs 5/5.
  `--check`: markers ok (20418; vendor 4330).
- `bunx tsc --noEmit -p .`: clean.
- `contract.test.ts`: 4 pass. Re-pinned counts: markers 176 → 216, stubs 481 → 441, the `ctfe-b` row was removed (0 stubs).
  The runtime stop is unchanged (`eval_queries::eval_in_interpreter`, ctfe-a: it comes before any ctfe-b code).
- Full `RUST_TS_AGENT=ctfe-b RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `d5876fe0` (detached, clean tree):
  **6101 pass, 1 skip (the existing one), 0 fail** (6102 tests, 435 files, 6121 s under heavy load). Log:
  `$RUST_TS_DATA/scratch/ctfe-b/logs/fulltest.log`.

## Samples (`RUST_TS_AGENT=root-f5de`, at `d5876fe0`)
| suite | run | M / D / U / CRASH |
|---|---|---|
| mirdump-minicore (46) | `20261022-193507-root-f5de-2igb` | 45 / 0 / 1 / 0 |
| tydump-minicore (46) | `20261022-193530-root-f5de-ahpn` | 45 / 0 / 1 / 0 |
| mirdump-ui `--sample 300` | `20261022-193553-root-f5de-iuf7` | 266 / 0 / 34 / 0 |
| tydump-ui `--sample 300` | `20261022-193928-root-f5de-pokv` | 258 / 0 / 40 / 0 (+2 UNSTABLE) |

**0 DIFF, 0 CRASH.** No new DIFF. The const-eval stops are still ctfe-a's `eval_in_interpreter` (16 mirdump-ui, 12
tydump-ui), so CTFE output cannot move until ctfe-a / interp-memory / interp-place-operand / interp-validity-intern land.
The other stops: `mir_borrowck provider` and `try_to_bits_for_ty (M4)`.

## `unported(...)` left
None in this lane's code. At runtime these paths still reach other lanes' stubs: `ConstEvalErrKind_into_InterpErrorInfo`
(ctfe-a: every `Err(ConstEvalErrKind::X).into()` and `throw_machine_stop!`), `Frame::lint_root` (interp-step-call,
`best_lint_scope`), `eval_intrinsic` / `read_type_id` / `write_type_id` (interp-intrinsics), `project_*` /
`ArrayIterator::next` / `write_discriminant` (interp-ops), the place / operand / memory fns (interp-place-operand,
interp-memory), `type_implements_dyn_trait` / `get_vtable_ptr` (interp-ops).

## `// PORT:` decisions (please record)
1. **Signature fix (contract declarations in my files)**: the `impl Writeable` params that are *projected* are the type
   parameter `P extends Writeable<P>` (the declared `Writeable<unknown>` does not satisfy `project_field<P extends
   Projectable<P>>`): `write_dyn_trait_type_info`, `write_type_info`, `write_tuple_type_info`, `write_fn_ptr_type_info`,
   `write_adt_type_info`. Params that are only written or read for their layout stay `Writeable`. Same pattern for the
   other lanes (e.g. interp-intrinsics' `write_type_id`, which projects `dest`).
2. `throw_machine_stop!(ConstEvalErrKind::Abort)` is `Err(ConstEvalErrKind_into_InterpErrorInfo(..))`. This is the same
   as `err_machine_stop!(x).into()` (error.rs:91).
3. `usize::checked_add(1)` on `num_evaluated_steps`: `usize::MAX` is `Number.MAX_SAFE_INTEGER` (mt-promote precedent).
   `is_power_of_two` is a local helper (exact on safe integers).
4. The `read_target_usize(..)? as usize` indices of the `type_id_*` intrinsics stay bigints for the bounds checks (exact)
   and become numbers below them. `BoundsCheckFailed { len, index }` are numbers (generated type).
5. `u64::wrapping_neg` (`guaranteed_cmp`) is `BigInt.asUintN(64, -int)`. `Size::from_bytes` of that stops at
   `SIZE_BEYOND_2_53` above 2^53 (recorded Size decision). `Align` comparisons go through `.bytes()`.
6. `u32::try_from(..).unwrap()` of line / column (`location_triple_for_span`) are the plain numbers.
7. `Ty::new_array`'s `u64` length is a number (`Number(len)`).
8. The `Machine` methods take `ecx: CompileTimeInterpCx` (method parameter bivariance; upstream `&InterpCx<'tcx, Self>`).
9. `*imm_ty` (Deref) is the field `.imm` (eval_context.ts header), so these paths don't depend on the `ImmTy::deref` stub.
10. `display_MemoryKind` returns the text (the `Display` convention). `f` is unused.
11. `assert_eq!` debug printers: `debug_Ty(.., PLAIN)` for `Ty`, `String` for counts, the identity for `Mutability`.

## Shared files edited
- `src/rustc_const_eval/interpret/contract.test.ts` (counts only, see above). It will conflict with the other 23c lanes'
  count edits; when merging, recompute the totals.
- No harness/ or scripts/ edits.

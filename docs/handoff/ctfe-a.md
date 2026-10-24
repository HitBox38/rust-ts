# Handoff: ctfe-a (M4 wave 23c, CTFE fill lane): rustc_const_eval const_eval/{eval_queries, error, valtrees, dummy_machine}.rs

Branch `lane/ctfe-a` (from `43e37d73`, no merges). All 37 stubs of the split table's `ctfe-a` row are ported. Nothing in
these four files calls `unported(..)` now.

## Files touched
- `src/rustc_const_eval/const_eval/eval_queries.ts`: 11 stubs ported: `setup_for_eval`, `eval_body_using_ecx`,
  `eval_trivial_const_using_ecx`, `intern_and_validate`, `op_to_const`, `turn_into_const_value`, `make_result`
  (`InterpretationResult_ConstAlloc`), `eval_in_interpreter`, `const_validate_mplace`, `report_eval_error`,
  `report_validation_error`.
- `src/rustc_const_eval/const_eval/error.ts`: 5 stubs ported: `Display for ConstEvalErrKind`, `Into<InterpErrorInfo>`,
  `get_span_and_frames`, `report` (E0080, the pointer-bytes help notes, `RawBytesNote`, the `ErrorHandled` mapping),
  and `lint`. New helper `ConstEvalErrKind_as_MachineStopType` (`impl MachineStopType for ConstEvalErrKind {}`).
- `src/rustc_const_eval/const_eval/valtrees.ts`: 9 stubs ported: `branches`, `slice_branches`,
  `const_to_valtree_inner`, `reconstruct_place_meta`, `create_valtree_place`, `valtree_to_const_value`,
  `valtree_to_ref`, `valtree_into_mplace`, `dump_place`.
- `src/rustc_const_eval/const_eval/dummy_machine.ts`: 12 stubs ported (`DummyMachine`'s Machine fns and
  `Display for Zst`). `Zst` now implements `MachineStopType`.
- New test `src/rustc_const_eval/const_eval/error.oracle.test.ts`. It checks the Display of `ConstEvalErrKind` (directly
  and as a `MachineStop` `InterpErrorKind`) against the pinned rustc's `error[E0080]:` lines: panic, mutable global,
  overflow, division by zero and bounds check. It is checked against captured strings and also live. It also checks
  `Zst`.
- Re-pinned (no assertion weakened; the stop moved forward):
  - `src/rustc_const_eval/interpret/contract.test.ts`: markers 176 → 213, stubs 481 → 444, the `ctfe-a` row is
    removed. The runtime stop for `const C: u8 = 7;` (`eval_to_allocation_raw`) is now
    `rustc_const_eval::interpret::place::InterpCx::allocate` (interp-place-operand).
  - `src/rustc_symbol_mangling/symbol_names.oracle.test.ts`: `STOP_CONST_EVAL` is now
    `const_eval::machine::CompileTimeMachine::load_mir` (ctfe-b; consts with a body). The new
    `STOP_CONST_EVAL_TRIVIAL` = `interpret::place::InterpCx::allocate` covers the three `types.rs` revisions.

## Coverage
- `bun scripts/coverage.ts --missing`: eval_queries.rs 18/18, error.rs 5/5, valtrees.rs 10/10, dummy_machine.rs 17/17.
- rustc_const_eval 278 → 320/764. TOTAL 19836/25518. `bun scripts/coverage.ts --check`: markers ok (20415; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `contract.test.ts`: 4 pass. This covers the fresh entries: every hand module still loads standalone.
- `error.oracle.test.ts` (with `RUST_TS_REQUIRE_PROBES=1`): 3 pass. `symbol_names.oracle.test.ts`: 28 pass.
- Full `RUST_TS_AGENT=ctfe-a RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `81675651` (detached, clean tree):
  **6104 pass, 1 skip (the existing one), 0 fail** (6105 tests, 436 files, 3470 s; slow because several lanes' full runs
  overlapped). Log: `$RUST_TS_DATA/scratch/ctfe-a/fulltest.log`.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, compared per case with the interp-contract runs)
| suite | this lane | M / D / U | base (interp-contract) | M / D / U |
|---|---|---|---|---|
| mirdump-minicore | `20261022-202617-root-f5de-ak5s` | 45 / 0 / 1 | `20261022-185047-root-f5de-z4n9` | 43 / 0 / 3 |
| mirdump-ui `--sample 300` | `20261022-202704-root-f5de-j6rq` | 266 / 0 / 34 | `20261022-185127-root-f5de-f9jh` | 222 / 0 / 78 |
| tydump-minicore | `20261022-202643-root-f5de-6psy` | 45 / 0 / 1 | `20261022-185109-root-f5de-qaih` | 45 / 0 / 1 |
| tydump-ui `--sample 300` | `20261022-203007-root-f5de-gvk1` | 258 / 0 / 40 (+2 UNSTABLE) | `20261022-185304-root-f5de-j6hf` | 258 / 0 / 40 (+2 UNSTABLE) |

**0 DIFF and 0 CRASH. No case was lost.** The comparison script is `$RUST_TS_DATA/scratch/ctfe-a/cmp.ts`.
- **The UNPORTED → MATCH moves come from the base, not from this lane.** These are mirdump-minicore 2 and mirdump-ui 44,
  all of them `validate::Validator`. `43e37d73` already contains mt-validate, but the base runs were made before it.
- **The const-eval stops moved past `eval_in_interpreter`** (this lane) into neighbouring lanes:
  - mirdump-ui: 12 → `CompileTimeMachine::load_mir` (ctfe-b), 3 → `InterpCx::allocate` (interp-place-operand), and 1 →
    `rustc_metadata … Decodable for (ConstValue, Ty)`. That last one is an extern trivial const read through
    `tcx.trivial_const`.
  - tydump-ui: 11 → `load_mir`, 1 → `allocate`.
- **Other stops** (not CTFE): `mir_borrowck` 16 / 25, `ConstValue::try_to_bits_for_ty (M4)` (rustc_middle), and
  `hash_result (type_of)` 2 in tydump-ui. All of these are unchanged from the base.

## Where const evaluation stops now
- **Trivial const:** `eval_in_interpreter` → `eval_trivial_const_using_ecx` → `setup_for_eval` → `InterpCx::allocate`
  (interp-place-operand). After that, `copy_op`, then `intern_const_alloc_recursive` / `RefTracking::new` /
  `const_validate_place` (interp-validity-intern), then `make_result`.
- **Const with a body:** `ecx.load_mir` → `CompileTimeMachine::load_mir` (ctfe-b). After that,
  `ensure_monomorphic_enough` (interp-ops) and `push_stack_frame_raw` / `step` (interp-step-call).
- **Statics:** `create_static_alloc` (interp-ops).
- **Error reporting:** this needs `Frame::generate_stacktrace_from_stack` / `FrameInfo::as_note` (interp-step-call),
  `util::context_spans` (ctfe-util), and `print_alloc_bytes_for_diagnostics` / `get_alloc_info` (interp-memory).
- **valtrees:** this needs `project_field` / `project_downcast` / `project_index` / `read_discriminant` /
  `write_discriminant` / `Projectable::len` (interp-ops), and `read_immediate` / `deref_pointer` / `allocate_dyn` /
  `write_immediate` / `MPlaceTy::to_ref` (interp-place-operand).

## `unported(...)` left
- **None in this lane's files.** The `unimplemented!()` fns of `DummyMachine` (`find_mir_or_eval_fn`,
  `panic_nounwind`, `call_intrinsic`, `call_llvm_intrinsic`, `assert_panic`, `expose_provenance`) are
  `panic("not implemented")`, as the contract did for `init_frame` / `stack_mut`.

## `// PORT:` decisions
- `eval_in_interpreter`: the `cfg!(debug_assertions)` block (a `debug_assert!` on `const_of_item`) is skipped.
- `op_to_const`: `ConstValue::Slice.meta` is a `number` (generated type). The `to_target_usize` bigint is converted with
  `Number()`, because a slice length stays below 2^53. The `debug_assert!` on the struct tail is kept as a comment.
- `ConstEvalErrKind_as_MachineStopType`: `Box<dyn MachineStopType>` is an object with `display` / `debug` /
  `with_validation_path` plus `value`, the boxed kind, kept for a future `downcast_ref`. `Zst` (the
  `throw_machine_stop_str!` local type) is a class implementing `MachineStopType`. The macro is expanded in place as
  `return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: new Zst("..") }))` with a comment.
- `valtrees::dump_place`: its only statement is `trace!`, so it is a comment and the argument is not evaluated. The body
  is empty.
- `binary_ptr_op`: the comparison of `(u128, u128)` tuples is a lexicographic compare of bigints.
- `lint`: the signature is now `<L extends Diagnostic>`, so the decorator returns the `Diagnostic` trait object that
  `emit_node_span_lint` takes. This is a declaration change, for root to review.
- **Init order:**
  - eval_queries.ts reads lazily: `lib.ts` (`CTRL_C_RECEIVED`), `interpret/util.ts` (`create_static_alloc`,
    `ensure_monomorphic_enough`) and `util/mod.ts` (`context_spans`).
  - Its other imports are used only at call time.
  - valtrees.ts imports `VALTREE_MAX_NODES` from `./mod.ts` (used only at call time). The fresh-entry check passes.

## Shared files edited (review)
- `src/rustc_const_eval/interpret/contract.test.ts` and `src/rustc_symbol_mangling/symbol_names.oracle.test.ts`
  (re-pins, above). No harness/ or scripts/ edits.

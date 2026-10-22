# Handoff: interp-validity-intern (M4 wave 23c, CTFE fill lane): interpret/validity.rs and intern.rs

Branch `lane/interp-validity-intern` (from `43e37d73`, no merges).

## Result
- **interpret/validity.rs 41/41, interpret/intern.rs 8/8** (`bun scripts/coverage.ts --missing`): every stub of the lane
  (48, split table of docs/handoff/interp-contract.md) is ported, including `CompileTimeMachine::static_def_id`
  (intern.rs:53, in the class body in const_eval/machine.ts). No `unported(..)` left in the lane's code.
- The **T** functions of the trivial path: `intern_const_alloc_recursive` (with `intern_shallow`, `prepare_alloc`,
  `intern_as_new_static`), `RefTracking::new` / `empty` / `next` / `track`, `const_validate_place` /
  `validate_place_internal` / `validate_place`, the whole `ValidityVisitor` (its `ValueVisitor` impl included).
- Interning order (plan-m4 D13): `todo` is a stack (`Vec::pop`), the base allocation is interned first, the nested
  pointers pushed in `ptrs()` order, exactly as upstream; `swap_remove` on the `FxIndexMap` is const_eval/machine.ts's
  `swap_remove` on the `FxIndexMap_AllocMap`'s map.
- Validation messages: every `format!` of validity.rs is kept verbatim (template literals); `{scalar:x}` is
  `lower_hex_Scalar`, `{ptr}` / `{vtable}` `display_Pointer_Option`, `{ty}` `display_Ty`, the dyn-trait lists
  `display_List_PolyExistentialPredicate`, `{bits}` / `{lo}` / `{hi}` the `bigint`s.

## End to end
Not reachable yet on the trivial path: validation and interning call stubs of the parallel lanes (interp-place-operand:
`MPlaceTy::ptr`, `read_immediate`, `place_to_op`, `as_mplace_or_imm`, ...; interp-memory: `ghost_run_mut`,
`check_ptr_access`, ...; interp-ops: `ValueVisitor_provided::walk_value`, `project_*`; ctfe-a: `eval_in_interpreter`,
which is still the first stop of `eval_to_allocation_raw`). The contract test's runtime stop is unchanged.
Unit tests instead:
- `src/rustc_const_eval/interpret/validity.test.ts`: `fmt_range` (every case), the Display / `From` impls,
  `ValidationErrorKind::to_string` / `ptr_bytes_warning`, `CtfeValidationMode`, `RefTracking`; in a compiler session:
  `visit_scalar` (in range / out of range, the `ValidationError` it builds), `with_elem` + `write_path` (`.inner.1.<deref>[3]`,
  every `PathElem`), `aggregate_field_path_elem` of a tuple.
- `src/rustc_const_eval/interpret/intern.test.ts`: `intern_const_alloc_recursive` on hand-built local allocations (a
  const pointing through a shared reference to a second allocation: both interned immutably and removed from the local
  map; a pointer to a missing allocation: `DanglingPointer`; a non-shared-ref pointer to new memory: the "static const
  safety checks" ICE). It installs `MPlaceTy::ptr`'s one-line body (`self.mplace.ptr`, interp-place-operand's stub) for
  its duration.

## Samples (`RUST_TS_AGENT=root-f5de`)
Lane runs at `420e8f90`, compared case by case to interp-contract's lane runs (at `e99b4cde`; this lane's base `43e37d73`
also contains the merges after it):

| suite | lane run | M / D / U | reference run | M / D / U |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-193638-root-f5de-u1tu` | 45 / 0 / 1 | `20261022-185047-root-f5de-z4n9` | 43 / 0 / 3 |
| tydump-minicore (46) | `20261022-202555-root-f5de-vl24` | 45 / 0 / 1 | `20261022-185109-root-f5de-qaih` | 45 / 0 / 1 |
| mirdump-ui `--sample 300` | `20261022-193759-root-f5de-3x7y` | 266 / 0 / 34 | `20261022-185127-root-f5de-f9jh` | 222 / 0 / 78 |
| tydump-ui `--sample 300` | `20261022-194148-root-f5de-25vr` | 258 / 0 / 40 (+2 UNSTABLE) | `20261022-185304-root-f5de-j6hf` | 258 / 0 / 40 (+2 UNSTABLE) |

**0 DIFF, 0 CRASH, no case lost**: the only per-case changes are UNPORTED → MATCH (mirdump-minicore 2, mirdump-ui 44),
all from the base's merges (mt-validate / passes-analysis: `validate::Validator` stops), not from this lane. Const
evaluation still stops first at ctfe-a's `eval_queries::eval_in_interpreter` (mirdump-ui 16, tydump-ui 12), so this
lane's code is not reached end to end yet.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (20426; vendor 4330).
- `src/rustc_const_eval/interpret/contract.test.ts`: 4 pass (counts: markers 224, stubs 433, this lane's row gone; the
  runtime stop of `const C: u8 = 7;` is still `eval_queries::eval_in_interpreter`, ctfe-a). validity.test.ts 4 pass,
  intern.test.ts 1 pass.
- Full `RUST_TS_AGENT=interp-validity-intern RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `420e8f90`
  (detached, clean tree but this handoff): **6106 pass, 1 skip (the existing one), 0 fail** (6107 tests, 437 files, 6121 s
  under a load of ~100 from the parallel lanes). Log: `$RUST_TS_DATA/scratch/interp-validity-intern/logs/fulltest.log`.

## `// PORT:` decisions
- intern.rs's trait alias `CompileTimeMachine<'tcx>` (`Machine<..> + HasStaticRootDefId`) is `compile_time_machine(ecx)`
  (a cast of `ecx.machine`); `MemoryMap = FxIndexMap<..>` lets intern.rs reach the map itself: `alloc_map_of(ecx)` (the
  `FxIndexMap_AllocMap`'s `map`).
- `intern_as_new_static`: `tcx.generics_of(static_id).clone()` feeds the shared query value (never mutated).
- `intern_shallow`'s iterator is over the interned (immutable) allocation's `ptrs()`.
- The macros `err_validation_failure!` / `throw_validation_failure!` / `try_validation!` are functions (validity.ts header):
  `try_validation(r, where_, arms)` takes the match as a function returning the message (or `undefined` for `e => e`);
  messages are only built on error, as in the macro.
- `RangeSet::new()` of `Size` needs the `Size` table of rustc_abi layout/ty.ts, which is not exported: validity.ts has an
  identical `SIZE_RANGE_SET_OPS` (root may export the abi one and drop the copy).
- `check_safe_pointer`'s "too close to the end of the address space" check keeps the address a `bigint`
  (`Size::from_bytes(x).bytes()` is the identity on `u64`; a `Size` past 2^53 would be unported).
- `visit_value`'s arm `ty::Array(tys, ..) | ty::Slice(tys) if self.ecx.layout_of(*tys)?.is_zst()`: the guard (with its
  `?`) runs only for arrays / slices the int/float arm did not take, as in the match.
- `cfg!(debug_assertions)` block at the end of `visit_value` skipped (no debug assertions).
- `union_data_range_uncached` is nested inside `ValidityVisitor.union_data_range` again (its marker moved with it).

## Signature / contract fixes (root-owned declarations)
- `write_path(out: string, ..)` → `write_path(out: MutRef<string>, ..)` (`&mut String`, PORTING §8).
- `Path::new` was assigned to `Path.new_` (so `Path.new` was undefined at run time); now assigned to `Path.new`, like
  `Pointer.new`.

## `unported(...)` left
None in validity.ts / intern.ts.

## Files touched
- `src/rustc_const_eval/interpret/{validity,intern}.ts` (the lane), `src/rustc_const_eval/const_eval/machine.ts`
  (only `static_def_id`, intern.rs:53).
- `src/rustc_const_eval/interpret/contract.test.ts`: counts only (markers 176 → 224, stubs 481 → 433, the lane's row
  removed from the per-lane table).
- New tests: `src/rustc_const_eval/interpret/{validity,intern}.test.ts`.
- No harness/ or scripts/ edits.

# Handoff: interp-contract (M4 wave 23b, contract-first): the CTFE interpreter of rustc_const_eval

Branch `lane/interp-contract` (from `f5de3f15`, no merges). Commits: the contract (`e99b4cde`), then this handoff.

## Result
- **Codegen set `rustc_const_eval_interpret`** (types.sets.json): every type of rustc_const_eval interpret/**, const_eval/**
  and util/** → 17 `*.gen.ts`, 54 types with derived Debug / Clone. Report: 0 unknown types, 0 missing Debug / Clone,
  7 manual Debug impls (declared as stubs: `debug_ImmTy`, `debug_OpTy`, `debug_MPlaceTy`, `debug_PlaceTy`,
  `debug_LocalState`, `debug_DumpAllocs`, and `debug_PlacePrinter`, ported). `erase_params: ["Prov"]` (D8). Set-local
  `tools/codegen/const_eval_interpret.typemap.json` (interpret/mod.rs re-exports `rustc_middle::mir::interpret::*` through
  a glob the generator does not follow; `Prov` / `M::Provenance` → `CtfeProvenance`, `M::ExtraFnVal` → `never`).
  `import_gen` lists every hand module with a twin (the generated modules import each other's `.gen.ts`, never a hand
  module). Hand types: `InterpCx`, `PlacePrinter`, `Memory`, `AllocRef`, `AllocRefMut`, `DumpAllocs`, `SpanGuard`,
  `RefTracking`, `ValidityVisitor`, `CompileTimeMachine`, `CompileTimeInterpCx`, `DummyMachine`, `TypeNamePrinter`.
- **Every fn of the scope files is declared** (38 files, 657 upstream fns; `src/rustc_const_eval/interpret/contract.test.ts`,
  scan = coverage): 171 ported (`// rustc:`; this counts the trait declarations), 486
  `// stub: <path>:<line> <name> (lane <lane>)` over the final signature with body
  `unported("rustc_const_eval::<module>::<Type>::<name>")` (the test checks the path names the fn's own module).
- **Ported (the hub)**: interpret/machine.rs 84/84 (the `Machine` interface, `Machine_provided`, the
  `compile_time_machine!` base class, `AllocMap` + `AllocMap_provided`, `MayLeak`), interpret/eval_context.rs 38/38
  (`InterpCx` with the `HasDataLayout` / `HasTyCtxt` / `HasTypingEnv` / `LayoutOfHelpers` / `FnAbiOfHelpers` impls,
  `new`, the layout cache, stack / frame helpers, `load_mir`, `instantiate_from_*`, `resolve`,
  `find_closest_untracked_caller_location`, `size_and_align_from_meta`, `go_to_block` / `return_to_block` /
  `unwind_to_block`, `ctfe_query`, `eval_global`, `eval_mir_constant`, `dump_place`, `generate_stacktrace`,
  `adjust_nan`, `mir_assign_valid_types`, `from_known_layout`, `PlacePrinter`), interpret/mod.rs, lib.rs 2/2
  (`assert_typing_mode`, `provide`).
- **Ported (the query providers' entry points, wired in `provide`)**: `eval_to_const_value_raw_provider`,
  `eval_to_allocation_raw_provider`, `eval_static_initializer_provider`, `retry_codegen_mode_with_postanalysis`
  (eval_queries.rs), `eval_to_valtree` (valtrees.rs), `try_destructure_mir_constant_for_user_output`,
  `tag_for_variant_provider` (const_eval/mod.rs), `const_caller_location_provider` (util/caller_location.rs).
- **Ported (glue the trivial path needs, 20 fns of other lanes' files)**: `CompileTimeMachine::new` / `stack` /
  `stack_mut` / `get_default_alloc_params`, `CanAccessMutGlobal::from`, the `AllocMap` impl for `FxIndexMap` (7),
  `MayLeak` for `MemoryKind` / `!` (const_eval/machine.rs); `DummyMachine`'s `static_def_id` / `init_frame` / `stack` /
  `stack_mut` / `get_default_alloc_params`; `Memory::new` / `alloc_map`; `Immediate::from(Scalar)`, `const_val_to_op`
  (operand.rs); `mk_eval_cx_to_read_const_val`, `mk_eval_cx_for_const_val` (eval_queries.rs); `EnteredTraceSpan for ()`.
  With these, the MIR printer's `const ()` prints (the top mirdump stop: 205 of the 300-case sample turn MATCH).
- `InternKind` is generated in interpret/intern.gen.ts; diagnostics.ts re-exports it (takes over const-check's stand-in;
  const_eval.typemap.json points there, diagnostics.gen.ts regenerated: one import line).

## Representation decisions (please record)
1. **`InterpCx<'tcx, M>`** is the class `InterpCx<M extends Machine = Machine>` (interpret/eval_context.ts), fields in
   declaration order. `impl InterpCx` is split over every interpret / const_eval file: `declare module
   "<..>/interpret/eval_context.ts" { interface InterpCx<M extends Machine = Machine> { .. } }` +
   `InterpCx.prototype.<name> = function (this: InterpCx, ..)`; eval_context.rs's methods are in the class body.
   `CompileTimeInterpCx` is `InterpCx<CompileTimeMachine>`; its methods (const_eval/*) are `InterpCx.prototype` methods
   with `this: CompileTimeInterpCx`.
2. **Machine (D8)**: `trait Machine` is the interface `Machine`; its associated fns are methods of the machine object and
   `M::f(ecx, ..)` is `ecx.machine.f(ecx, ..)` (upstream parameters kept, `ecx` / `machine: &Self` included); associated
   consts are readonly members (`ecx.machine.ALL_CONSTS_ARE_PRECHECKED`). Provided fns: the base class
   `Machine_provided`; `compile_time_machine!` is the abstract class `compile_time_machine extends Machine_provided`,
   extended by `CompileTimeMachine` and `DummyMachine` (unit struct: `new DummyMachine()`). Associated types are the CTFE
   machines': `Provenance = CtfeProvenance`, `ProvenanceExtra = boolean`, `ExtraFnVal = never`, `MemoryKind =
   CtfeMemoryKind` (const_eval's), `MemoryMap = CtfeMemoryMap` (the class `FxIndexMap_AllocMap`), `AllocExtra` /
   `FrameExtra` = `null`, `Bytes = Uint8Array`, `<Bytes as AllocBytes>::AllocParams = null`.
3. **`Prov` is erased** (codegen `erase_params`): the value types `Immediate`, `ImmTy`, `Operand`, `OpTy`, `MemPlace`,
   `MPlaceTy`, `Place`, `PlaceTy`, `MemPlaceMeta`, `LocalState`, `LocalValue`, `FnArg`, `Frame` are over `CtfeProvenance`
   (`Pointer<Option<Prov>>` is `Pointer<CtfeProvenance | undefined>`).
4. **Values are immutable once built** (Copy/Clone types are shared; `clone_X` where upstream clones then mutates);
   `LocalState.value`, `Frame.loc`, `Memory`'s maps and the machine's fields are the mutable state.
5. **Method / field name clashes: the method gets `_`** (precedent `tcx_()`): `Projectable::layout()` → `layout_()`,
   `MPlaceTy::mplace()` → `mplace_()`, `PlaceTy::place()` → `place_()`, `OpTy::op()` → `op_()`, `Frame::body()` /
   `instance()` / `locals()` / `return_place()` / `return_cont()` → `..._()`, `Machine::stack()` → `stack_()` (field
   `CompileTimeMachine.stack`), `ValueVisitor::ecx()` → `ecx_()`, `Memory::alloc_map()` → `alloc_map_()`. Exception:
   `TypeNamePrinter`'s field `tcx` is `tcx_` (rustc_middle's abstract `Printer` fixes `tcx()`).
6. **Traits**: `Projectable<Self>` / `Writeable<Self>` are interfaces implemented by the classes' prototypes (`P:
   Projectable` is `P extends Projectable<P>`, `&impl Projectable` is `Projectable`); `Projectable`'s provided `len` /
   `offset` / `transmute` are `Projectable_provided` (stubs), forwarded from the four classes' prototypes
   (projection.ts). `ValueVisitor<V>` is an interface with the base class `ValueVisitor_provided<V>`; `V::from(mplace)`
   is the member `V_from_MPlaceTy`. `InterpretationResult<R>` is an impl table passed first (`R_`, precedent mt-promote's
   `Q_`): `InterpretationResult_ConstAlloc`, `InterpretationResult_ConstAllocation`. `MayLeak<T>` is a table over the
   value (`MayLeak_MemoryKind`, `MayLeak_never`; `MemoryKind::<T>::may_leak` takes `T_`). `HasStaticRootDefId` is an
   interface implemented by the machine classes (intern.rs's impl lives in `CompileTimeMachine`'s body).
   `EnteredTraceSpan` (tracing, not ported) is `undefined`; `enter_trace_span!` / `trace!` / `debug!` are comments.
7. **Enum methods** are companion fns (`Immediate.to_scalar(imm)`, `MemPlaceMeta.unwrap_meta(m)`, `FnArg`, `FnVal`,
   `MemoryKind`, `ValidationErrorKind`, `CtfeValidationMode`); `From<A> for B` is `B_from_A(a)`; `Debug` / `Display` impls
   are `debug_X(self, f)` / `display_X(self, f)`; `impl Deref for ImmTy` is `deref()` (or the field `imm`).
8. **Numbers**: `u64` / `i64` / `u128` / `i128` are bigints, `usize` / `Size` numbers (recorded decisions); `NonZero<usize>`
   a number; raw `*const u8` / `*mut u8` / `&[u8]` / `Box<[u8]>` are `Uint8Array`; `VecDeque<T>` is `T[]`;
   `std::cmp::Ordering` (`ImmTy::from_ordering`) is `-1 | 0 | 1`.
9. **Results**: `InterpResult<'tcx, T>` is `Result<T, InterpErrorInfo>` (`InterpResult` = unit, `undefined`): `?` is
   `if (r.$ === "Err") return r;`, `throw_ub!(X)` is `return Err(InterpErrorInfo_from_InterpErrorKind({..}))` with the
   macro as a comment; `layout_of` returns `Result<TyAndLayout, InterpErrorKind>` as upstream (its `?` converts with
   `InterpErrorInfo_from_InterpErrorKind`); `Result<_, ErrorHandled>`'s `?` converts with `InterpErrorInfo_from_ErrorHandled`.
10. **Generic parameters**: `T: TypeFoldable` takes its fold descriptor (`instantiate_from_*_frame_*(.., d_T)`); `F: Float`
    takes its `FloatType` dictionary (`generate_nan(ecx, inputs, F2_)`, `adjust_nan(f, inputs, F2_)`); `RefTracking<T>`'s
    `FxHashSet<T>` is a `KeyedSet` over a key fn passed to `empty` / `new` (`key_MPlaceTy` = `intern_key`, place.ts).
11. `cfg!(debug_assertions)` blocks are skipped with a `// PORT:` (`assert_typing_mode` is a no-op, `from_known_layout`
    returns the known layout); `CTRL_C_RECEIVED` is `{ value: false }`; `ArgAbi` / `FnAbi` are `Pending1` placeholders
    until lane fn-abi; `tracing::Span` of `SpanGuard` is `unknown`.

## Init order (TDZ-free; checked by contract.test.ts "fresh entry")
- interpret/eval_context.ts value-imports only `.gen.ts` modules and other crates; it reads the interpret hand modules,
  util/mod.ts and lib.ts lazily (`require`, at call time).
- Extension modules import `InterpCx` from eval_context.ts and the generated classes they extend at load from the
  `.gen.ts` twins (never through a hand module); enum companions are assigned only by their own module.
- interpret/machine.ts value-imports no interpret hand module (`CompileTimeMachine` / `DummyMachine` extend
  `compile_time_machine` at load); const_eval/machine.ts is read lazily by `Memory::new`.
- interpret/mod.ts loads eval_context.ts first, then the files in upstream order; const_eval/mod.ts loads dyn_trait.ts,
  type_info.ts, type_info/adt.ts (the `impl InterpCx<CompileTimeMachine>` extension modules).

## Split table (fill lanes; upstream lines, stubs left)
`T` = on the trivial-const path (see below): port first.

| lane | wave | upstream (compiler/rustc_const_eval/src/) | lines | stubs | trivial path |
|---|---|---|---|---|---|
| interp-memory | 23b | interpret/memory.rs | 1736 | 71 | **T**: `allocate_ptr`, `get_ptr_alloc(_mut)`, `get_alloc_raw(_mut)`, `global_root_pointer`, `AllocRef(Mut)::read/write_scalar`, `mem_copy`, `get_alloc_info`, `ptr_get_alloc_id` |
| interp-place-operand | 23b | interpret/place.rs, operand.rs | 2122 | 112 (place 58, operand 54) | **T**: `allocate(_dyn)`, `ptr_with_meta_to_mplace`, `ptr_to_mplace`, `copy_op` (→ `_inner` / `_no_validate`), `write_immediate*`, `read_immediate(_raw)`, `read_scalar`, `raw_const_to_mplace`, `as_mplace_or_imm`, `Immediate::new_slice`, the `Projectable` / `Writeable` impls |
| ctfe-a | 23b | const_eval/{eval_queries, error, valtrees, dummy_machine}.rs (mod.rs and lib.rs done) | 1509 | 37 (eval_queries 11, error 5, valtrees 9, dummy_machine 12) | **T**: `eval_in_interpreter`, `eval_trivial_const_using_ecx`, `setup_for_eval`, `intern_and_validate`, `const_validate_mplace`, `turn_into_const_value`, `op_to_const`, `InterpretationResult_ConstAlloc`; valtrees for `eval_to_valtree` |
| fn-abi | 23b | (rustc_ty_utils abi.rs + rustc_target callconv mod/x86_64 + passes abi_test; outside this contract) | ~2.2k | – | `FnAbi` / `ArgAbi` are `Pending1` placeholders (ty/decls.ts, interpret/call.ts) |
| interp-step-call | 24 | interpret/{step, call, stack}.rs | 2616 | 60 (step 8, call 17, stack 35) | `Frame::current_span` / `generate_stacktrace_from_stack` (error reporting), `push_stack_frame_raw` / `step` (non-trivial consts) |
| interp-ops | 24 | interpret/{operator, cast, discriminant, projection, traits, util, visitor}.rs | 2431 | 57 | **T**: `Projectable_provided`, `project_field` / `project_downcast` / `read_discriminant` (destructuring aggregates), `ValueVisitor_provided` (validation walk), `ensure_monomorphic_enough`, `InterpretationResult_ConstAllocation` (statics) |
| interp-intrinsics | 24 | interpret/intrinsics.rs, intrinsics/atomic.rs | 1570 | 28 | |
| interp-validity-intern | 24 | interpret/{validity, intern}.rs | 2126 | 48 (validity 41, intern 7) | **T**: `intern_const_alloc_recursive` (every CTFE result), `RefTracking::new` / `next`, `const_validate_place` / `validate_operand_internal`, `ValidityVisitor`, `CompileTimeMachine::static_def_id` |
| ctfe-b | 24 | const_eval/{machine, dyn_trait, type_info, type_info/adt}.rs | 1870 | 40 (machine 24) | **T**: `CompileTimeMachine`'s `enforce_validity`, `before_access_global`, `before_alloc_access`, `load_mir`, `init_frame`, `increment_const_eval_counter` |
| ctfe-util | 24 | util/{mod, check_validity_requirement, compare_types, type_name}.rs (caller_location.rs: 1 left) | 650 | 27 | `relate_types` (`mir_assign_valid_types`, copies of differently-typed places), `alloc_caller_location` |
| interp-simd | 24 (last) | interpret/intrinsics/simd.rs | 902 | 6 | |
| — | done | interpret/{machine, eval_context, mod}.rs, lib.rs, const_eval/mod.rs, entry points, glue above | | 0 | |

**The trivial-const path.** `const ()` / unit printing is complete (no stub on it). Evaluating any const — even a
trivial one (`const C: u8 = 7;`, `eval_to_allocation_raw`) — goes `eval_in_interpreter` → `eval_trivial_const_using_ecx`
→ `setup_for_eval` → `allocate` (place → memory) → `const_val_to_op` (done) → `copy_op` (place, operand, memory) →
`intern_and_validate` → `intern_const_alloc_recursive` (**intern.rs**) → `const_validate_mplace` → `RefTracking` /
`const_validate_place` (**validity.rs**, walking with **visitor.rs** and `project_*`) → `make_result`. So plan-m4's
23b set (memory, place-operand, ctfe-a) alone cannot finish a trivial const: interning and validation (wave 24's
interp-validity-intern, plus visitor / projection of interp-ops and a few `CompileTimeMachine` hooks of ctfe-b) are on every
path. Recommendation: schedule interp-validity-intern and interp-ops with 23b (or as 23c) to reach the `const_eval_poly` /
`eval_to_valtree` / `eval_to_const_value_raw` stops. `&str` constants additionally need `global_root_pointer` (memory) and
`Immediate::new_slice` (operand); destructuring aggregates in the MIR printer needs `read_discriminant`,
`project_downcast`, `project_field` (interp-ops) and `op_to_const` (ctfe-a).

## How to fill a stub
1. `grep -rn "// stub: compiler/rustc_const_eval/src/<file>:<line> <name>" src` (or `bun scripts/coverage.ts --missing
   <path>`). Keep the signature; a wrong one goes in your handoff (or fix it and say so: declarations are root-owned after
   integration).
2. Replace the body in place (prototype assignment, class body, companion assignment, table member or free fn) and turn
   the comment into `// rustc: <path>:<line> <name>`. Nested fns (`// PORT: nested in ..`) move inside their parent.
3. Conventions: "Representation decisions" above; interpret/eval_context.ts's header repeats them.
4. Init order: the rules above; no new load-time reads of hand modules.
5. `src/rustc_const_eval/interpret/contract.test.ts`: lower your lane's stub count, the totals (`markers` / `stubs`), and
   re-pin the runtime stop (`eval_to_allocation_raw` of `const C: u8 = 7;` now stops at
   `rustc_const_eval::const_eval::eval_queries::eval_in_interpreter`) to the next stub on the path.

## Where const evaluation stops now (samples)
| suite | lane run (`RUST_TS_AGENT=root-f5de`, at `e99b4cde`) | M / D / U | base (`f5de3f15`) | M / D / U |
|---|---|---|---|---|
| mirdump-minicore (46) | `20261022-185047-root-f5de-z4n9` | 43 / 0 / 3 | `20261022-175111-root-f5de-bbue` | 17 / 0 / 29 |
| tydump-minicore (46) | `20261022-185109-root-f5de-qaih` | 45 / 0 / 1 | `20261022-175059-root-f5de-8kp6` | 45 / 0 / 1 |
| mirdump-ui `--sample 300` | `20261022-185127-root-f5de-f9jh` | 222 / 0 / 78 | `20261022-175248-root-f5de-c6id` | 17 / 0 / 283 |
| tydump-ui `--sample 300` | `20261022-185304-root-f5de-j6hf` | 258 / 0 / 40 (+2 UNSTABLE) | `20261022-175123-root-f5de-supl` | 258 / 0 / 40 (+2 UNSTABLE) |

**0 DIFF, 0 CRASH; no case lost** (per case: only UNPORTED → MATCH and same-status moves).
- mirdump-minicore: 26 UNPORTED → MATCH (the 28 `try_destructure_mir_constant_for_user_output` stops). Left: `validate::Validator`
  2 (mt-validate), `ConstValue::try_to_bits_for_ty (M4)` 1 (`mini_core_hello_world.rs`, was `eval_to_const_value_raw_provider`).
- mirdump-ui: 205 UNPORTED → MATCH. Base const-eval stops (`try_destructure_mir_constant_for_user_output` 246,
  `eval_to_valtree` 14, `eval_to_const_value_raw_provider` 2, `eval_static_initializer_provider` 1) are gone; now
  `validate::Validator` 44, `mir_borrowck` 16, `eval_queries::eval_in_interpreter` 16 (ctfe-a), `try_to_bits_for_ty` 2.
- tydump-ui / tydump-minicore: same statuses; `eval_to_valtree` 12 → `eval_queries::eval_in_interpreter` 12,
  `eval_to_const_value_raw_provider` 1 → `try_to_bits_for_ty (M4)` 1.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (20314; vendor 4330).
- Coverage: rustc_const_eval 113 → 278/764; TOTAL 19743/25518. interpret/machine.rs 84/84, eval_context.rs 38/38,
  interpret/mod.rs and lib.rs complete; the other scope files as in the split table.
- `src/rustc_const_eval/interpret/contract.test.ts`: 4 tests pass (scan = coverage, split table, fresh entries, runtime).
- Regenerating every codegen set: no diff but the new set (the known untracked `src/rustc_lexer/lib.gen.ts` was deleted).
- Full `RUST_TS_AGENT=interp-contract RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `e99b4cde` (detached, clean
  tree): **6062 pass, 1 skip (the existing one), 0 fail** (6063 tests, 430 files, 1046 s). Log:
  `$RUST_TS_DATA/scratch/interp-contract/logs/fulltest.log`.

## Re-pinned tests (no assertion weakened; the const-eval stop moved)
- `rustc_middle/mir/debug.oracle.test.ts`: `display_Const` of `()` now prints `()` (the oracle's `const ()`) instead of
  stopping at `try_destructure_mir_constant_for_user_output`.
- `rustc_lint/late_passes_e1.oracle.test.ts`: `default_overrides_default_fields` no longer stops (the
  `eval_to_const_value_raw` provider returns trivial consts' values): its `stop` is dropped and it matches the oracle.
- `rustc_symbol_mangling/symbol_names.oracle.test.ts`: `STOP_CONST_EVAL` is `eval_queries::eval_in_interpreter`.
- `rustc_ty_utils/layout.test.ts`: `layout_discriminants` stops at `rustc_middle::mir::ConstValue::try_to_bits_for_ty (M4)`.

## `unported(...)` left
- The 486 stub bodies of the split table (each names its fn).
- `rustc_middle::mir::ConstValue::try_to_bits_for_ty (M4)` (rustc_middle, not this lane) is now the stop of
  `mini_core_hello_world.rs` and of explicit enum discriminants (`eval_explicit_discr`).

## Shared files edited (review)
- `tools/codegen/types.sets.json` (new set), `tools/codegen/const_eval_interpret.typemap.json` (new),
  `tools/codegen/const_eval.typemap.json` (`InternKind` → interpret/intern.gen.ts); `src/rustc_const_eval/diagnostics.ts`
  (+ regenerated diagnostics.gen.ts: one import line), `src/rustc_const_eval/lib.ts`, `const_eval/mod.ts`.
- Tests re-pinned (above): `rustc_middle/mir/debug.oracle.test.ts`, `rustc_lint/late_passes_e1.oracle.test.ts`,
  `rustc_symbol_mangling/symbol_names.oracle.test.ts`, `rustc_ty_utils/layout.test.ts`.
- No harness/ or scripts/ edits.

## For root
- The trivial path needs wave-24 lanes (see the split table); consider moving interp-validity-intern and interp-ops
  forward.
- Pre-existing: `const_eval/fn_queries.ts` does not load as a fresh entry point (`MacroKinds` TDZ, also at base); the
  contract test skips it.
- `rustc_middle::mir::ConstValue::try_to_bits_for_ty (M4)` is the next stop of explicit discriminants and
  `mini_core_hello_world.rs` (rustc_middle owner).

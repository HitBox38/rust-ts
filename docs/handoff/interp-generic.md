# Handoff: lane `interp-generic` (✱ contract-first, M6 wave 35; plan-m6 D3 + A1)

Branch `t3/generalize-interpreter-machine` (worktree t3-01475c92), based on main `b0008692`.

The interpreter is now usable by a second `Machine`. CTFE's behaviour does not change: the mir and mir-core samples
are 300/300 MATCH, and CTFE costs the same as before. On types, every machine associated type is a type parameter
with upstream's CTFE default. At run time, every place where upstream dispatches statically on an associated type
(`M::Provenance::OFFSET_IS_ADDR`, `Prov::WILDCARD`, `M::Bytes: AllocBytes`, `M::MemoryMap: Default`, `Cow::Owned`)
now goes through the machine or through a descriptor that is passed in. Before, these were fixed to CTFE's values.

## The contract (for `miri-contract` and later Miri lanes)

- **`Machine<T extends MachineTypes = CtfeMachineTypes>`** (interpret/machine.ts). `T` is a type-level record of the
  associated types: `MemoryKind`, `Provenance`, `ProvenanceExtra`, `ExtraFnVal`, `FrameExtra`, `AllocExtra`, `Bytes`,
  `AllocParams` (= `<Bytes as AllocBytes>::AllocParams`) and `MemoryMap`. Every hook signature uses `T[...]`.
  - `CtfeMachineTypes` holds the `compile_time_machine!` values. `compile_time_machine` extends
    `Machine_provided<CtfeMachineTypes>`.
  - Helper types: `AnyMachine` (= `Machine<any>`, the bound `M: Machine<'tcx>`), `MachineTypesOf<M>`, `ProvOf<M>`,
    `MachineFrame<T>`, `MachineAllocation<T>`.
- **New members of `Machine`.** These are the static dispatch on associated types; a machine must set them:
  - `readonly Provenance: Provenance<T["Provenance"]>`: the impl of `Self::Provenance: Provenance`.
    `M::Provenance::X` is `ecx.machine.Provenance.X`.
  - `readonly Bytes: AllocBytes<T["Bytes"], T["AllocParams"]>`: the impl of `Self::Bytes`.
  - `MemoryMap_default(): T["MemoryMap"]`: `Self::MemoryMap::default()`.
  - `readonly __types?: T`: type-level only, never set.
  - `compile_time_machine` sets the first three to `Provenance_CtfeProvenance`, `AllocBytes_Box` and an
    `FxIndexMap_AllocMap`.
- **`Cow<T>`** (interpret/machine.ts) is `{ $: "Borrowed" | "Owned", _0 }`. `adjust_global_allocation` and
  `get_global_alloc` return `Cow<…>`; CTFE returns `Cow.Borrowed(alloc)`.
- **`InterpCx<M extends AnyMachine = Machine>`**, with `memory: Memory<M>`.
  - Every `declare module ... interface InterpCx<M>` declaration in interpret/* is machine-generic: values are
    `OpTy<ProvOf<M>>`, `Frame<ProvOf<M>, MachineTypesOf<M>["FrameExtra"]>`, `MachineAllocation<MachineTypesOf<M>>`,
    `AllocRef<ProvOf<M>, …>`, `FnVal<…["ExtraFnVal"]>`, `[AllocId, Size, …["ProvenanceExtra"]]`, and so on.
  - The method bodies stay typed with the CTFE defaults. They dispatch through the machine at run time.
  - `InterpCx.prototype` is `InterpCx<any>`, and `MachineTypesOf<any>` is `any`-typed, which is what lets the CTFE-typed
    bodies be assigned to it. A Miri caller gets its own types from the declarations.
- **`Memory<M>`.** `alloc_map: MachineTypesOf<M>["MemoryMap"]`, `extra_fn_ptr_map: Map<AllocId, …["ExtraFnVal"]>`,
  `va_list_map`. `Memory.new(machine)` takes the machine, because `M::MemoryMap::default()` needs it.
- **`AllocRef` / `AllocRefMut<Prov = CtfeProvenance, Extra = null, Bytes = Uint8Array>`** have a trailing field
  `Prov: Provenance<Prov>`, set from `machine.Provenance` where they are made.
- **Value types are generic over `Prov`** (default `CtfeProvenance`, as upstream): `Immediate`, `ImmTy`, `Operand`,
  `OpTy`, `MemPlaceMeta`, `MemPlace`, `MPlaceTy`, `Place`, `PlaceTy`, `LocalValue`, `LocalState`, `FnArg`,
  `Frame<Prov, Extra>`, `ArrayIterator<Prov, P>`, `Projectable<Self, Prov>` and `Writeable<Self, Prov>`.
  - Their generated `debug_X(v, f, debug_Prov)` and `clone_X(v, clone_Prov)` take the provenance's impls. Pass
    `debug_provenance` / `clone_provenance` (pointer.ts).
  - Their `ecx` parameters are `InterpCx<AnyMachine>`.
- **pointer.ts**
  - `Provenance<P>` gains the supertraits as members: `eq` (`PartialEq`) and `debug` (`Debug`).
  - Object-valued provenances register themselves with `register_object_provenance(impl)`. The impl is an
    `ObjectProvenance<P>` with `owns(prov)`. `provenance_of(prov)` stays bigint → CTFE and number → AllocId, then
    falls back to the registered object impls.
  - `provenance_eq(a, b)` is `a === b ||` the impl's `eq` (objects only).
  - `Pointer<Option<P>>::addr(Prov)` takes the impl.
- **Allocation / ProvenanceMap**
  - Where upstream reads `Prov::OFFSET_IS_ADDR` or `Prov::WILDCARD` with no value at hand, the method takes a trailing
    `Prov: Provenance<Prov>`:
    - `Allocation.get_bytes_strip_provenance`, `get_bytes_unchecked_raw(_mut)` and `read_scalar` are overloaded. The
      descriptor can be left out only when `this` is an `Allocation<CtfeProvenance>`, which keeps the two callers in
      mir/pretty.ts and ty/print/pretty.ts unchanged.
    - `process_native_write`, `ProvenanceMap.read_ptr` and `write_wildcards` always require it.
  - The constructors (`from_bytes`, `from_bytes_byte_aligned_immutable`, `try_new`, `new`) take a trailing
    `Bytes_: AllocBytes<Bytes, Params>`, defaulting to `AllocBytes_Box` (upstream's default type
    `Bytes = Box<[u8]>`). `AllocBytes<B, AllocParams = null>`.

## Restored branches / dispatch (port ↔ upstream at the pin)

`OFFSET_IS_ADDR` / `WILDCARD` arms (A1). Every upstream occurrence in rustc_const_eval and mir/interpret is listed:

| port | upstream | what |
|---|---|---|
| interpret/intrinsics.ts:598-599 | interpret/intrinsics.rs:409 | `ptr_offset_from`: the dropped `if M::Provenance::OFFSET_IS_ADDR { (a.addr(), b.addr(), true) }` arm, **re-ported** |
| interpret/memory.ts:889-890 | interpret/memory.rs:612 | `is_ptr_misaligned`: `else if OFFSET_IS_ADDR { is_offset_misaligned(ptr.addr()) }` (was `Provenance_CtfeProvenance`; `addr()` now dispatches) |
| interpret/memory.ts:1945 | interpret/memory.rs:1698 | `ptr_try_get_alloc_id`: `assert!(M::Provenance::OFFSET_IS_ADDR)` |
| interpret/place.ts:602 | interpret/place.rs:498 | `check_ptr_access` maybe-null message |
| interpret/validity.ts:580 | interpret/validity.rs:688 | maybe-null message |
| interpret/validity.ts:848 | interpret/validity.rs:944 | maybe-null message |
| mir/interpret/pointer.ts:472 | mir/interpret/pointer.rs:309 | `Pointer<Option<Prov>>::addr`: `assert!(Prov::OFFSET_IS_ADDR)` (was the constant `OFFSET_IS_ADDR_OF_EVERY_PROVENANCE = false`, removed) |
| mir/interpret/allocation.ts:374 | mir/interpret/allocation.rs:597 | `get_bytes_strip_provenance` |
| mir/interpret/allocation.ts:425 | mir/interpret/allocation.rs:653 | `get_bytes_unchecked_raw_mut` assert |
| mir/interpret/allocation.ts:436 | mir/interpret/allocation.rs:661 | `get_bytes_unchecked_raw` assert |
| mir/interpret/allocation.ts:493 | mir/interpret/allocation.rs:719 | `read_scalar` (no-provenance read) |
| mir/interpret/allocation/provenance_map.ts:309 | provenance_map.rs:215 | `read_ptr`: `Some(frag.prov) == Prov::WILDCARD` (value impl + `PartialEq`) |
| mir/interpret/allocation/provenance_map.ts:330 | provenance_map.rs:237 | `read_ptr`: `.or_else(\|\| Prov::WILDCARD)` |
| mir/interpret/allocation/provenance_map.ts:332 | provenance_map.rs:239 | `read_ptr`: `prov.is_none() && !Prov::OFFSET_IS_ADDR` |
| mir/interpret/allocation/provenance_map.ts:463 | provenance_map.rs:354 | `write_wildcards`: `Prov::WILDCARD.unwrap()` |
| mir/interpret/value.ts:462 | mir/interpret/value.rs:295 | already dispatched on the value (`provenance_of`); both arms were ported; unchanged |

Other specialisations to CTFE that are now dispatched again:

| port | upstream | what |
|---|---|---|
| interpret/memory.ts:1005-1025 | interpret/memory.rs:720-733 | `get_alloc_raw`: the dropped **`Cow::Owned` arm** (`M::GLOBAL_KIND.expect(..)`, insert into the map), **re-ported** |
| interpret/memory.ts:1117 (+ `Cow_into_owned_Allocation`) | interpret/memory.rs:831 | `get_alloc_raw_mut`: `alloc.into_owned()` (an owned `Cow` is moved, a borrowed one cloned) |
| interpret/machine.ts `compile_time_machine.adjust_global_allocation` | interpret/machine.rs:810 | returns `Cow::Borrowed(alloc)` |
| interpret/memory.ts:251, eval_context.ts:304 | interpret/memory.rs:165 | `M::MemoryMap::default()` (was `FxIndexMap_AllocMap` hard-wired) |
| interpret/memory.ts:542, 544, 554 | interpret/memory.rs:260, 262, 275 | `Allocation::new / try_new / from_bytes` with `M::Bytes` (was `Box` hard-wired) |
| interpret/memory.ts:1073, 1165 | interpret/memory.rs (get_ptr_alloc / _mut) | `AllocRef(Mut)` carry `M::Provenance` for `read_scalar` / `get_bytes_strip_provenance` |
| interpret/memory.ts:1438, 1516 | interpret/memory.rs:1124, 1193 | `prov.get_alloc_id()` through `M::Provenance` (was the CTFE impl) |
| interpret/memory.ts:1601 | interpret/memory.rs:1270 | `DumpAllocs`: generic `Prov` dispatches on the value |
| interpret/stack.ts:856, 868, 878, 882 | interpret/stack.rs:701 (`print`, 726/732/735) | `LocalState::print` is generic over `Prov` (value impl; Debug via `debug_provenance`) |
| interpret/eval_context.ts:828 | interpret/eval_context.rs:668 | `PlacePrinter`: `get_alloc_id` through `M::Provenance` |
| interpret/validity.ts:959 | interpret/validity.rs:1059 | `in_mutable_memory`: `get_alloc_id` through `M::Provenance` |
| mir/interpret/allocation/provenance_map.ts:257, 320 | provenance_map.rs:168, 226 | provenance `==` is `PartialEq` (`provenance_eq`), no longer JS identity |

What I checked and left alone because it is already right for any machine:
- Every `M::hook` call site. I compared per-file counts against upstream; all hooks are called.
- The `FnVal::Other` / `extra_fn_ptr_map` paths, which are fully ported.
- The `CtfeProvenance` value operations in intern.ts, util.ts, `global_root_pointer`, `operand.ts:1000/1016`,
  `intrinsics.ts:175` and traits.ts. Upstream works on `Pointer<CtfeProvenance>` (tcx pointers) or on
  `CompileTimeMachine` only in each of these.

## Files touched

- Mine:
  - interpret: machine.ts, eval_context.ts, memory.ts, place.ts, operand.ts, stack.ts, projection.ts, intrinsics.ts,
    validity.ts, call.ts, cast.ts, discriminant.ts, intern.ts, operator.ts, step.ts, traits.ts,
    intrinsics/atomic.ts, intrinsics/simd.ts.
  - Generated twins, regenerated rather than hand-edited: call.gen.ts, operand.gen.ts, place.gen.ts, projection.gen.ts,
    stack.gen.ts, step.gen.ts.
  - mir/interpret: pointer.ts, allocation.ts, allocation/provenance_map.ts.
  - Tests: interpret/machine_generic.test.ts (new), place_operand.test.ts, mir/interpret/allocation.test.ts,
    interpret_b.oracle.test.ts.
- **Outside my assignment. Root, please review these. All of them are mechanical consequences of the generalisation:**
  - `tools/codegen/types.sets.json`: set `rustc_const_eval_interpret` drops `"erase_params": ["Prov"]` and its note.
  - `tools/codegen/const_eval_interpret.typemap.json`:
    - `Prov` is no longer mapped; `M::Provenance` is still `CtfeProvenance`, used only by step.rs `EvaluatedCalleeAndArgs`.
    - The `Scalar` / `Pointer` entries take `$0` / `$d0`.
    - The header note is updated.
    - The generator itself is unchanged. `bun tools/codegen/types.ts rustc_const_eval_interpret` is idempotent on the
      branch.
  - `src/rustc_const_eval/const_eval/{machine,type_info,dyn_trait}.ts` and `type_info/adt.ts`: only the
    `interface InterpCx<M extends AnyMachine = Machine>` header and the import. TS requires identical type parameters
    on every declaration.
  - `src/rustc_const_eval/const_eval/{eval_queries,valtrees}.ts` and `src/rustc_mir_transform/gvn.ts`:
    `clone_MPlaceTy(x)` → `clone_MPlaceTy(x, clone_provenance)` (8 sites), and one `debug_MemPlaceMeta` arg in
    valtrees.ts:86.

## Verification

- `bunx tsc --noEmit -p .`: clean (0 errors).
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 4680)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_const_eval src/rustc_middle`: 401 pass, 0 fail (47 files).
- `bun scripts/difftest.ts --suite mir --sample 300` (agent `interp-generic`): 300/300 MATCH (run
  `20261031-225936-interp-generic-42cg`).
- `bun scripts/difftest.ts --suite mir-core --sample 300`: 300/300 MATCH (run `20261031-230037-interp-generic-5rji`).
  The heavy `core` case took 171.7 s user, against 145–184 s in earlier gate and root runs.
- CTFE cost: the plan's `ctfe200000.rs` (`--target x86_64-unknown-linux-gnu --emit=metadata`) took 7.32 / 7.37 s user on
  the branch and 7.34 / 7.32 s on base `b0008692`. That is the same; CTFE stays on the bigint/number path with no extra
  allocation per pointer op.
  - The one new allocation is the `Cow` wrapper in `adjust_global_allocation`, once per global-allocation lookup miss,
    next to the `InterpResult` objects that are already built there.
- Stand-in second machine (`interpret/machine_generic.test.ts`, 3 tests, all pass):
  - An object-valued `TestProv` (`OFFSET_IS_ADDR = true`, with a wildcard) takes the restored Allocation/ProvenanceMap
    arms: no-provenance read, strip-provenance, raw-bytes asserts, partial-pointer read and `write_wildcards` →
    `WILDCARD`. The CTFE impl gives upstream's `false`-arm results on the same allocations.
  - A `DummyMachine` whose `Provenance` says `OFFSET_IS_ADDR = true` takes the interpreter arms:
    - `is_ptr_misaligned`: aligned by address, where CTFE reports misalignment from the allocation's alignment.
    - `ptr_try_get_alloc_id` with `ptr_get_alloc → None`: `Err(addr)`, where CTFE fails the assertion.
    - `ptr_offset_from` on two allocations: writes `8`, where CTFE raises "not both derived from the same allocation".
- Coverage, unchanged (all ported): machine.rs 83/83, memory.rs 73/73, intrinsics.rs 27/27, place.rs 60/60,
  validity.rs 41/41, stack.rs 35/35, eval_context.rs 37/37, pointer.rs 39/39, allocation.rs 51/51,
  provenance_map.rs 23/23.

## `unported(...)` left

None added and none removed.

## `// PORT:` decisions (new or changed)

1. Associated types are a type-level record `T extends MachineTypes`. Static dispatch on an associated type is a
   member of the machine (`Provenance`, `Bytes`, `MemoryMap_default`) or a descriptor parameter
   (interpret/machine.ts header).
2. A defaulted type parameter is a defaulted descriptor parameter: `Bytes_ = AllocBytes_Box`, and on
   `Allocation<CtfeProvenance>` only, `Prov = Provenance_CtfeProvenance` (allocation.ts header, overloads).
3. Every `AllocBytes` impl's value is a `Uint8Array`, possibly a subclass. `Deref` and `as_ptr`/`as_mut_ptr` are the
   view itself for every impl, so those calls keep using `AllocBytes_Box`'s identity functions (allocation.ts header).
   Miri's `MiriAllocBytes` must follow this.
4. Object-valued provenances register their impl (`register_object_provenance`, with `owns`). `provenance_of` is
   unchanged for bigint and number values. The `PartialEq` / `Debug` supertraits are the descriptor's `eq` / `debug`.
5. `AllocRef(Mut)` carry the `Provenance` impl as a trailing field: a machine-typed field, as D3 allows.
6. `Memory::new()` takes the machine (`M::MemoryMap::default()`).
7. The interpreter method declarations are machine-generic (`ProvOf<M>`), while the bodies stay typed with the CTFE
   defaults. `MachineTypesOf<any>` is `any`-typed so those bodies can be assigned to `InterpCx.prototype`
   (interpret/machine.ts).
8. `Cow<T>` is a tagged union in interpret/machine.ts. It is not in `src/std`, which is not mine; root may want to
   move it there.

## Follow-ups for root

- The two pretty-printer callers (`mir/pretty.ts:2406`, `ty/print/pretty.ts:4560`) still use the CTFE-only overload of
  `get_bytes_strip_provenance`. That is correct, because both read tcx allocations (`CtfeProvenance`).
- `step.gen.ts` `EvaluatedCalleeAndArgs.args` is `FnArg<CtfeProvenance>[]`: upstream names `M::Provenance` there, and
  the generator does not yet map a type's `M` parameter. It is internal to `eval_callee_and_args`, so it is harmless
  until Miri calls that directly.
- The value-type methods declared in the generated-type augmentations (`MPlaceTy`, `PlaceTy`, …) are generic over
  `Prov`. The one-line `Projectable` augmentations in projection.ts are generic too.
- An upstream-fidelity review of the A1 rows above against the pin, which plan review B1 asks for.

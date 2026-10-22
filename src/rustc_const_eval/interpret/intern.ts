// Port of compiler/rustc_const_eval/src/interpret/intern.rs (lane interp-validity-intern; declared by interp-contract,
// plan-m4 wave 23b/23c). Interning order decides AllocIds (plan-m4 D13): `todo` is a stack (`Vec::pop`), the base
// allocation first, as upstream.
//! This module specifies the type based interner for constants.
//!
//! After a const evaluation has computed a value, before we destroy the const evaluator's session
//! memory, we need to extract all memory allocations to the global memory pool so they stay around.
//!
//! In principle, this is not very complicated: we recursively walk the final value, follow all the
//! pointers, and move all reachable allocations to the global `tcx` memory. The only complication
//! is picking the right mutability: the outermost allocation generally has a clear mutability, but
//! what about the other allocations it points to that have also been created with this value? We
//! don't want to do guesswork here. The rules are: `static`, `const`, and promoted can only create
//! immutable allocations that way. `static mut` can be initialized with expressions like `&mut 42`,
//! so all inner allocations are marked mutable. Some of them could potentially be made immutable,
//! but that would require relying on type information, and given how many ways Rust has to lie
//! about type information, we want to avoid doing that.
import { debug_Mutability, type Mutability } from "../../rustc_ast_ir/lib.ts";
import { type FxIndexMap_AllocMap, swap_remove } from "../const_eval/machine.ts";
import * as diagnostics from "../diagnostics.ts";
import { InterpCx } from "./eval_context.ts";
import { debug_InternError, InternError, type InternKind } from "./intern.gen.ts";
import { type CtfeMemoryKind, type Machine } from "./machine.ts";
import { MemoryKind } from "./memory.ts";
import { DefPathData, PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { type AllocId, type Allocation, type ConstAllocation, CtfeProvenance, interp_ok, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { type MPlaceTy, type PlaceTy } from "./place.gen.ts";
import { PlaceTy_from_MPlaceTy } from "./place.ts";

export * from "./intern.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // intern.rs:383 (lane interp-validity-intern)
    intern_with_temp_alloc(layout: TyAndLayout, f: (a0: InterpCx, a1: PlaceTy) => InterpResult<undefined>): InterpResult<AllocId>;
  }
}

/// A trait for machines that support static roots
// pub trait HasStaticRootDefId
export interface HasStaticRootDefId {
  // rustc: compiler/rustc_const_eval/src/interpret/intern.rs:49 static_def_id
  static_def_id(): LocalDefId | undefined;
}

// pub trait CompileTimeMachine<'tcx> = Machine<'tcx, MemoryKind = const_eval::MemoryKind, Provenance = CtfeProvenance, ..>
//     + HasStaticRootDefId;
// PORT: the trait alias is `compile_time_machine(ecx)` (end of file).

// PORT: `impl HasStaticRootDefId for const_eval::CompileTimeMachine<'_>` (intern.rs:52) is in the class body of
// `CompileTimeMachine` (const_eval/machine.ts); `impl .. for DummyMachine` in const_eval/dummy_machine.ts.

// rustc: compiler/rustc_const_eval/src/interpret/intern.rs:58 prepare_alloc
export function prepare_alloc<Prov, Extra, Bytes>(tcx: TyCtxt, kind: MemoryKind<CtfeMemoryKind>, alloc: Allocation, mutability: Mutability): Result<undefined, InternError> {
  switch (kind.$) {
    case "Machine": {
      // MemoryKind::Machine(const_eval::MemoryKind::Heap { was_made_global })
      const was_made_global = kind._0.was_made_global;
      if (!was_made_global) {
        // Attempting to intern a `const_allocate`d pointer that was not made global via
        // `const_make_global`.
        tcx.dcx().delayed_bug("non-global heap allocation in const value");
        return Err(InternError.ConstAllocNotGlobal);
      }
      break;
    }
    case "Stack":
    case "CallerLocation":
      break;
  }

  if (!alloc.provenance_merge_bytes(tcx)) {
    // Per-byte provenance is not supported by backends, so we cannot accept it here.
    tcx.dcx().delayed_bug("partial pointer in const value");
    return Err(InternError.PartialPointer);
  }

  // Set allocation mutability as appropriate. This is used by LLVM to put things into
  // read-only memory, and also by Miri when evaluating other globals that
  // access this one.
  switch (mutability) {
    case "Not":
      alloc.mutability = "Not";
      break;
    case "Mut":
      // This must be already mutable, we won't "un-freeze" allocations ever.
      assert_eq<Mutability>(alloc.mutability, "Mut", (v) => debug_Mutability(v, PLAIN));
      break;
  }
  return Ok(undefined);
}

/// Intern an allocation. Returns `Err` if the allocation does not exist in the local memory.
///
/// `mutability` can be used to force immutable interning: if it is `Mutability::Not`, the
/// allocation is interned immutably; if it is `Mutability::Mut`, then the allocation *must be*
/// already mutable (as a sanity check).
///
/// Returns an iterator over all relocations referred to by this allocation.
// PORT: `M: CompileTimeMachine<'tcx>` (the trait alias above) includes `HasStaticRootDefId`: `ecx.machine` is read
// through `compile_time_machine(ecx)`. The iterator is over the interned (immutable) allocation's pointers.
// rustc: compiler/rustc_const_eval/src/interpret/intern.rs:104 intern_shallow
export function intern_shallow(ecx: InterpCx, alloc_id: AllocId, mutability: Mutability, disambiguator: PerParentDisambiguatorState | undefined): Result<IterableIterator<CtfeProvenance>, InternError> {
  // trace!("intern_shallow {:?}", alloc_id);
  // remove allocation
  // FIXME(#120456) - is `swap_remove` correct?
  const removed = swap_remove(alloc_map_of(ecx), alloc_id);
  if (removed === undefined) {
    return Err(InternError.DanglingPointer);
  }
  const [kind, alloc] = removed;

  const r = prepare_alloc(ecx.tcx.deref(), kind, alloc, mutability);
  if (r.$ === "Err") {
    const err = r._0;
    // We want to error here, but we have to first put the
    // allocation back into the `alloc_map` to keep things in a consistent state.
    ecx.memory.alloc_map.insert(alloc_id, [kind, alloc]);
    return Err(err);
  }

  // link the alloc id to the actual allocation
  const alloc_ = ecx.tcx.deref().mk_const_alloc(alloc);
  const static_id = compile_time_machine(ecx).static_def_id();
  if (static_id !== undefined) {
    intern_as_new_static(
      ecx.tcx,
      static_id,
      alloc_id,
      alloc_,
      unwrap(disambiguator, "disambiguator needed"),
    );
  } else {
    ecx.tcx.deref().set_alloc_id_memory(alloc_id, alloc_);
  }
  return Ok(alloc_.inner().provenance_().ptrs_().iter().map(([_, prov]) => prov).values());
}

/// Creates a new `DefId` and feeds all the right queries to make this `DefId`
/// appear as if it were a user-written `static` (though it has no HIR).
// rustc: compiler/rustc_const_eval/src/interpret/intern.rs:142 intern_as_new_static
export function intern_as_new_static(tcx: TyCtxtAt, static_id: LocalDefId, alloc_id: AllocId, alloc: ConstAllocation, disambiguator: PerParentDisambiguatorState): void {
  // `intern_const_alloc_recursive` is called once per static and it contains the `PerParentDisambiguatorState`.
  //  The `<static_id>::{{nested}}` path is thus unique to `intern_const_alloc_recursive` and the
  // `PerParentDisambiguatorState` ensures the generated path is unique for this call as we generate
  // `<static_id>::{{nested#n}}` where `n` is the `n`th `intern_as_new_static` call.
  const feed = tcx.create_def(
    static_id,
    undefined,
    { $: "Static", safety: "Safe", mutability: alloc.inner().mutability, nested: true },
    DefPathData.NestedStatic,
    disambiguator,
  );
  tcx.deref().set_nested_alloc_id_static(alloc_id, feed.def_id());

  if (tcx.deref().is_thread_local_static(LocalDefId.to_def_id(static_id))) {
    tcx.deref()
      .dcx()
      .emit_err(diagnostics.NestedStaticInThreadLocal_diagnostic({ span: tcx.def_span(static_id) }));
  }

  // These do not inherit the codegen attrs of the parent static allocation, since
  // it doesn't make sense for them to inherit their `#[no_mangle]` and `#[link_name = ..]`
  // and the like.
  feed.codegen_fn_attrs(CodegenFnAttrs.new());

  feed.eval_static_initializer(Ok(alloc));
  // PORT: `.clone()`: query values are never mutated, the fed value is shared.
  feed.generics_of(tcx.generics_of(static_id));
  feed.def_ident_span(tcx.def_ident_span(static_id));
  feed.explicit_clauses_of(tcx.explicit_clauses_of(static_id));
  feed.feed_hir();
}

/// Intern `ret` and everything it references.
///
/// This *cannot raise an interpreter error*. Doing so is left to validation, which
/// tracks where in the value we are and thus can show much better error messages.
///
/// For `InternKind::Static` the root allocation will not be interned, but must be handled by the caller.
// #[instrument(level = "debug", skip(ecx))]
// rustc: compiler/rustc_const_eval/src/interpret/intern.rs:204 intern_const_alloc_recursive
export function intern_const_alloc_recursive(ecx: InterpCx, intern_kind: InternKind, ret: MPlaceTy): Result<undefined, InternError> {
  const id = compile_time_machine(ecx).static_def_id();
  // PORT: `disambiguator.as_mut()`: the state object itself (`Option<&mut _>`).
  const disambiguator = id !== undefined ? PerParentDisambiguatorState.new(id) : undefined;

  // We are interning recursively, and for mutability we are distinguishing the "root" allocation
  // that we are starting in, and all other allocations that we are encountering recursively.
  let base_mutability: Mutability;
  let inner_mutability: Mutability;
  let is_static: boolean;
  if (intern_kind.$ === "Constant" || intern_kind.$ === "Promoted") {
    // Completely immutable. Interning anything mutably here can only lead to unsoundness,
    // since all consts are conceptually independent values but share the same underlying
    // memory.
    [base_mutability, inner_mutability, is_static] = ["Not", "Not", false];
  } else if (intern_kind._0 === "Not") {
    [base_mutability, inner_mutability, is_static] = [
      // Outermost allocation is mutable if `!Freeze` i.e. contains interior mutable types.
      ret.layout.ty.is_freeze(ecx.tcx.deref(), ecx.typing_env) ? "Not" : "Mut",
      // Inner allocations are never mutable. They can only arise via the "tail
      // expression" / "outer scope" rule, and we treat them consistently with `const`.
      "Not",
      true,
    ];
  } else {
    // Just make everything mutable. We accept code like
    // `static mut X = &mut [42]`, so even inner allocations need to be mutable.
    [base_mutability, inner_mutability, is_static] = ["Mut", "Mut", true];
  }

  // Intern the base allocation, and initialize todo list for recursive interning.
  const base_alloc_id = CtfeProvenance.alloc_id(unwrap(ret.ptr().provenance));
  // trace!(?base_alloc_id, ?base_mutability);
  // First we intern the base allocation, as it requires a different mutability.
  // This gives us the initial set of nested allocations, which will then all be processed
  // recursively in the loop below.
  let todo: CtfeProvenance[];
  if (is_static) {
    assert(disambiguator !== undefined, "assertion failed: disambiguator.is_some()");
    // Do not steal the root allocation, we need it later to create the return value of `eval_static_initializer`.
    // But still change its mutability to match the requested one.
    const [kind, alloc] = unwrap(alloc_map_of(ecx).get(base_alloc_id));
    const r = prepare_alloc(ecx.tcx.deref(), kind, alloc, base_mutability);
    if (r.$ === "Err") return r;
    todo = alloc.provenance_().ptrs_().iter().map(([_, prov]) => prov);
  } else {
    assert(disambiguator === undefined, "assertion failed: disambiguator.is_none()");
    const r = intern_shallow(ecx, base_alloc_id, base_mutability, undefined);
    if (r.$ === "Err") return r;
    todo = [...r._0];
  }
  // We need to distinguish "has just been interned" from "was already in `tcx`",
  // so we track this in a separate set.
  const just_interned = new Set<AllocId>([base_alloc_id]);
  // Whether we encountered a bad mutable pointer.
  // We want to first report "dangling" and then "mutable", so we need to delay reporting these
  // errors.
  let found_bad_mutable_ptr = false;

  // Keep interning as long as there are things to intern.
  // We show errors if there are dangling pointers, or mutable pointers in immutable contexts
  // (i.e., everything except for `static mut`). We only return these errors as a `Result`
  // so that the caller can run validation, and subsequently only report interning errors
  // if validation fails. Validation has the better error messages so we prefer those, but
  // interning has better coverage since it "sees" *all* pointers, including raw pointers and
  // references stored in unions.
  let prov: CtfeProvenance | undefined;
  while ((prov = todo.pop()) !== undefined) {
    // trace!(?prov);
    const alloc_id = CtfeProvenance.alloc_id(prov);

    if (base_alloc_id === alloc_id && is_static) {
      // This is a pointer to the static itself. It's ok for a static to refer to itself,
      // even mutably. Whether that mutable pointer is legal at all is checked in validation.
      // See tests/ui/statics/recursive_interior_mut.rs for how such a situation can occur.
      // We also already collected all the nested allocations, so there's no need to do that again.
      continue;
    }

    // Ensure that this is derived from a shared reference. Crucially, we check this *before*
    // checking whether the `alloc_id` has already been interned. The point of this check is to
    // ensure that when there are multiple pointers to the same allocation, they are *all*
    // derived from a shared reference. Therefore it would be bad if we only checked the first
    // pointer to any given allocation.
    // (It is likely not possible to actually have multiple pointers to the same allocation,
    // so alternatively we could also check that and ICE if there are multiple such pointers.)
    // See <https://github.com/rust-lang/rust/pull/128543> for why we are checking for "shared
    // reference" and not "immutable", i.e., for why we are allowing interior-mutable shared
    // references: they can actually be created in safe code while pointing to apparently
    // "immutable" values, via promotion or tail expression lifetime extension of
    // `&None::<Cell<T>>`.
    // We also exclude promoteds from this as `&mut []` can be promoted, which is a mutable
    // reference pointing to an immutable (zero-sized) allocation. We rely on the promotion
    // analysis not screwing up to ensure that it is sound to intern promoteds as immutable.
    if (
      intern_kind.$ !== "Promoted" &&
      inner_mutability === "Not" &&
      !CtfeProvenance.shared_ref(prov)
    ) {
      const is_already_global = ecx.tcx.deref().try_get_global_alloc(alloc_id) !== undefined;
      if (is_already_global && !just_interned.has(alloc_id)) {
        // This is a pointer to some memory from another constant. We encounter mutable
        // pointers to such memory since we do not always track immutability through
        // these "global" pointers. Allowing them is harmless; the point of these checks
        // during interning is to justify why we intern the *new* allocations immutably,
        // so we can completely ignore existing allocations.
        // We can also skip the rest of this loop iteration, since after all it is already
        // interned.
        continue;
      }
      // If this is a dangling pointer, that's actually fine -- the problematic case is
      // when there is memory there that someone might expect to be mutable, but we make it immutable.
      const dangling = !is_already_global && !ecx.memory.alloc_map.contains_key(alloc_id);
      if (!dangling) {
        found_bad_mutable_ptr = true;
      }
    }
    if (ecx.tcx.deref().try_get_global_alloc(alloc_id) !== undefined) {
      // Already interned.
      // debug_assert!(!ecx.memory.alloc_map.contains_key(&alloc_id));
      continue;
    }
    // We always intern with `inner_mutability`, and furthermore we ensured above that if
    // that is "immutable", then there are *no* mutable pointers anywhere in the newly
    // interned memory -- justifying that we can indeed intern immutably. However this also
    // means we can *not* easily intern immutably here if `prov.immutable()` is true and
    // `inner_mutability` is `Mut`: there might be other pointers to that allocation, and
    // we'd have to somehow check that they are *all* immutable before deciding that this
    // allocation can be made immutable. In the future we could consider analyzing all
    // pointers before deciding which allocations can be made immutable; but for now we are
    // okay with losing some potential for immutability here. This can anyway only affect
    // `static mut`.
    just_interned.add(alloc_id);
    const next = intern_shallow(ecx, alloc_id, inner_mutability, disambiguator);
    if (next.$ === "Err") return next;
    todo.push(...next._0);
  }
  if (found_bad_mutable_ptr) {
    // We found a mutable pointer inside a const where inner allocations should be immutable,
    // and there was no other error. This should usually never happen! However, this can happen
    // in unleash-miri mode, so report it as a normal error then.
    if (ecx.tcx.deref().sess.opts.unstable_opts.unleash_the_miri_inside_of_you) {
      return Err(InternError.BadMutablePointer);
    } else {
      span_bug(
        ecx.tcx.span,
        "the static const safety checks accepted a mutable pointer they should not have accepted",
      );
    }
  }
  return Ok(undefined);
}

/// Intern an allocation. This function assumes that it references no other allocation.
// #[instrument(level = "debug", skip(ecx))]
// rustc: compiler/rustc_const_eval/src/interpret/intern.rs:361 intern_const_alloc_for_constprop
export function intern_const_alloc_for_constprop(ecx: InterpCx, alloc_id: AllocId): InterpResult<undefined> {
  if (ecx.tcx.deref().try_get_global_alloc(alloc_id) !== undefined) {
    // The constant is already in global memory. Do nothing.
    return interp_ok(undefined);
  }
  // Move allocation to `tcx`.
  if (!unwrap_result(intern_shallow(ecx, alloc_id, "Not", undefined), debug_InternError).next().done) {
    // We are not doing recursive interning, so we don't currently support provenance.
    // (If this assertion ever triggers, we should just implement a
    // proper recursive interning loop -- or just call `intern_const_alloc_recursive`.
    panic("`intern_const_alloc_for_constprop` called on allocation with nested provenance");
  }
  return interp_ok(undefined);
}

// impl<'tcx> InterpCx<'tcx, DummyMachine>
/// A helper function that allocates memory for the layout given and gives you access to mutate
/// it. Once your own mutation code is done, the backing `Allocation` is removed from the
/// current `Memory` and interned as read-only into the global memory.
// rustc: compiler/rustc_const_eval/src/interpret/intern.rs:383 intern_with_temp_alloc
InterpCx.prototype.intern_with_temp_alloc = function (this: InterpCx, layout: TyAndLayout, f: (a0: InterpCx, a1: PlaceTy) => InterpResult<undefined>): InterpResult<AllocId> {
  // `allocate` picks a fresh AllocId that we will associate with its data below.
  const dest_r = this.allocate(layout, MemoryKind.Stack);
  if (dest_r.$ === "Err") return dest_r;
  const dest = dest_r._0;
  const r = f(this, PlaceTy_from_MPlaceTy(dest));
  if (r.$ === "Err") return r;
  const alloc_id = CtfeProvenance.alloc_id(unwrap(dest.ptr().provenance)); // this was just allocated, it must have provenance
  for (const prov of unwrap_result(intern_shallow(this, alloc_id, "Not", undefined), debug_InternError)) {
    // We are not doing recursive interning, so we don't currently support provenance.
    // (If this assertion ever triggers, we should just implement a
    // proper recursive interning loop -- or just call `intern_const_alloc_recursive`.
    if (this.tcx.deref().try_get_global_alloc(CtfeProvenance.alloc_id(prov)) === undefined) {
      panic("`intern_with_temp_alloc` with nested allocations");
    }
  }
  return interp_ok(alloc_id);
};

/** PORT: `M: CompileTimeMachine<'tcx>` (intern.rs:36) is `Machine<..> + HasStaticRootDefId`. */
function compile_time_machine(ecx: InterpCx): Machine & HasStaticRootDefId {
  return ecx.machine as Machine & HasStaticRootDefId;
}

/** PORT: the bound `MemoryMap = FxIndexMap<AllocId, (MemoryKind<..>, Allocation)>` lets intern.rs reach the
 * `FxIndexMap` itself (`swap_remove`, `get_mut`): the map of the `AllocMap` impl. */
function alloc_map_of(ecx: InterpCx): Map<AllocId, [MemoryKind<CtfeMemoryKind>, Allocation]> {
  return (ecx.memory.alloc_map as FxIndexMap_AllocMap<AllocId, [MemoryKind<CtfeMemoryKind>, Allocation]>).map;
}

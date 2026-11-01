// Port of src/tools/miri/src/provenance_gc.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-driver` (plan-m6 wave 36): ported.
// Its types are generated into provenance_gc.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (lane miri-driver): `trait VisitProvenance` is implemented two ways (borrowck-contract rule 5):
// - by object values (`MachineCallback`, the generated classes `MiriMachine`, `AllocExtra`, `Thread`, ...) as a method
//   `visit_provenance(visit)` (the `VisitProvenance` interface below);
// - by values that are not objects of a class of their own (numbers, strings, `Option<T>`, tuples, `Vec<T>`, maps, enums
//   such as `Provenance` / `Scalar` / `IoError` / `Immediate`, and the interpreter's classes that live in rustc_const_eval)
//   as impl tables `VisitProvenance_<T>` with `self` first: `VisitProvenance_Scalar.visit_provenance(s, visit)`.
//   The generic impls (`Option<T>`, `(A, B)`, `Box<T>`, `Rc<T>`, `Vec<T>`, `BTreeMap<K, V>`, `FxHashMap<K, V>`,
//   `RefCell<T>`) take the element impls as trailing parameters; `VisitProvenance_object` is the impl of any object that
//   has the method. `Box<T>`, `Rc<T>` and `RefCell<T>` are the value itself (PORTING §5), so their tables just forward.
// - `impl VisitProvenance for MiriInterpCx` is the table `VisitProvenance_MiriInterpCx` (not an `InterpCx.prototype`
//   method: `InterpCx` is shared with CTFE, and only this file calls it).
import { AllocState, type BorTag } from "./borrow_tracker/mod.ts";
import { type IoError } from "./shims/io_error.ts";
import { type ImmTy, type MPlaceTy, type OpTy, type PlaceTy, type Pointer, type Scalar, type StrictPointer } from "./lib.ts";
import { AllocExtra, type MiriInterpCx, MiriMachine, type Provenance } from "./machine.ts";
import { type MiriAllocBytes } from "./alloc/alloc_bytes.ts";
import { LiveAllocs } from "./provenance_gc.gen.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { type Immediate } from "../rustc_const_eval/interpret/operand.ts";
import { type MemPlaceMeta } from "../rustc_const_eval/interpret/place.ts";
import { type Allocation } from "../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId } from "../rustc_middle/mir/interpret/mod.ts";
import { unwrap } from "../std/panic.ts";
export * from "./provenance_gc.gen.ts";

// rustc-type: src/tools/miri/src/provenance_gc.rs:10 VisitWith
/** `pub type VisitWith<'a> = dyn FnMut(Option<AllocId>, Option<BorTag>) + 'a;` */
export type VisitWith = (alloc_id: AllocId | undefined, tag: BorTag | undefined) => void;

/** `pub trait VisitProvenance` (provenance_gc.rs:12), as implemented by object values (a method). */
export interface VisitProvenance {
  // rustc: src/tools/miri/src/provenance_gc.rs:13 visit_provenance
  visit_provenance(visit: VisitWith): void;
}

/** An impl table of `VisitProvenance` for a non-object type (`self` first). */
export interface VisitProvenanceImpl<T> {
  visit_provenance(self: T, visit: VisitWith): void;
}

/** The impl of an object value that implements `VisitProvenance` as a method. */
export const VisitProvenance_object: VisitProvenanceImpl<VisitProvenance> = {
  visit_provenance(self: VisitProvenance, visit: VisitWith): void {
    self.visit_provenance(visit);
  },
};

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- provenance_gc.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // provenance_gc.rs:265
    run_provenance_gc(this: MiriInterpCx): void;
  }
}

declare module "./provenance_gc.gen.ts" {
  interface LiveAllocs {
    // provenance_gc.rs:235
    is_live(id: AllocId): boolean;
  }
}

// `impl VisitProvenance for AllocExtra` (machine.rs:410) and `impl VisitProvenance for MiriMachine` (machine.rs:1030) are
// prototype methods of the generated classes, ported in machine.ts (lane miri-machine); declared here.
declare module "./machine.gen.ts" {
  interface AllocExtra extends VisitProvenance {}
  interface MiriMachine extends VisitProvenance {}
}

// Trivial impls for types that do not contain any provenance
// macro_rules! no_provenance { ($($ty:ident)+) => { $( impl VisitProvenance for $ty { .. } )+ } }
// no_provenance!(i8 i16 i32 i64 isize u8 u16 u32 u64 usize bool ThreadId Deadline Symbol);
/** The `no_provenance!` impls: `i8 i16 i32 i64 isize u8 u16 u32 u64 usize bool ThreadId Deadline Symbol`. */
export const VisitProvenance_no_provenance: VisitProvenanceImpl<unknown> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:21 visit_provenance
  visit_provenance(_self: unknown, _visit: VisitWith): void {},
};

// impl VisitProvenance for &'static str
export const VisitProvenance_str: VisitProvenanceImpl<string> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:29 visit_provenance
  visit_provenance(_self: string, _visit: VisitWith): void {},
};

// impl<T: VisitProvenance> VisitProvenance for Option<T>
export const VisitProvenance_Option = {
  // rustc: src/tools/miri/src/provenance_gc.rs:33 visit_provenance
  visit_provenance<T>(self: T | undefined, visit: VisitWith, T_: VisitProvenanceImpl<T>): void {
    if (self !== undefined) {
      const x = self;
      T_.visit_provenance(x, visit);
    }
  },
};

// impl<A, B> VisitProvenance for (A, B) where A: VisitProvenance, B: VisitProvenance
export const VisitProvenance_tuple2 = {
  // rustc: src/tools/miri/src/provenance_gc.rs:45 visit_provenance
  visit_provenance<A, B>(self: readonly [A, B], visit: VisitWith, A_: VisitProvenanceImpl<A>, B_: VisitProvenanceImpl<B>): void {
    A_.visit_provenance(self[0], visit);
    B_.visit_provenance(self[1], visit);
  },
};

// impl<T: ?Sized + VisitProvenance> VisitProvenance for Box<T>
export const VisitProvenance_Box = {
  // rustc: src/tools/miri/src/provenance_gc.rs:52 visit_provenance
  visit_provenance<T>(self: T, visit: VisitWith, T_: VisitProvenanceImpl<T>): void {
    T_.visit_provenance(self, visit);
  },
};

// impl<T: ?Sized + VisitProvenance> VisitProvenance for Rc<T>
export const VisitProvenance_Rc = {
  // rustc: src/tools/miri/src/provenance_gc.rs:58 visit_provenance
  visit_provenance<T>(self: T, visit: VisitWith, T_: VisitProvenanceImpl<T>): void {
    T_.visit_provenance(self, visit);
  },
};

// impl<T: VisitProvenance> VisitProvenance for Vec<T>
export const VisitProvenance_Vec = {
  // rustc: src/tools/miri/src/provenance_gc.rs:64 visit_provenance
  visit_provenance<T>(self: readonly T[], visit: VisitWith, T_: VisitProvenanceImpl<T>): void {
    for (const el of self) T_.visit_provenance(el, visit);
  },
};

// impl<K: VisitProvenance, V: VisitProvenance> VisitProvenance for BTreeMap<K, V>
// PORT: a `BTreeMap` is ported as a `Map` kept in key order (the iteration order is the map's).
export const VisitProvenance_BTreeMap = {
  // rustc: src/tools/miri/src/provenance_gc.rs:70 visit_provenance
  visit_provenance<K, V>(self: ReadonlyMap<K, V>, visit: VisitWith, K_: VisitProvenanceImpl<K>, V_: VisitProvenanceImpl<V>): void {
    for (const [key, value] of self) {
      K_.visit_provenance(key, visit);
      V_.visit_provenance(value, visit);
    }
  },
};

// impl<K: VisitProvenance, V: VisitProvenance> VisitProvenance for FxHashMap<K, V>
export const VisitProvenance_FxHashMap = {
  // rustc: src/tools/miri/src/provenance_gc.rs:79 visit_provenance
  visit_provenance<K, V>(self: ReadonlyMap<K, V>, visit: VisitWith, K_: VisitProvenanceImpl<K>, V_: VisitProvenanceImpl<V>): void {
    for (const [key, value] of self) {
      K_.visit_provenance(key, visit);
      V_.visit_provenance(value, visit);
    }
  },
};

// impl<T: VisitProvenance> VisitProvenance for std::cell::RefCell<T>
export const VisitProvenance_RefCell = {
  // rustc: src/tools/miri/src/provenance_gc.rs:88 visit_provenance
  visit_provenance<T>(self: T, visit: VisitWith, T_: VisitProvenanceImpl<T>): void {
    T_.visit_provenance(self, visit);
  },
};

// impl VisitProvenance for BorTag
export const VisitProvenance_BorTag: VisitProvenanceImpl<BorTag> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:94 visit_provenance
  visit_provenance(self: BorTag, visit: VisitWith): void {
    visit(undefined, self);
  },
};

// impl VisitProvenance for AllocId
export const VisitProvenance_AllocId: VisitProvenanceImpl<AllocId> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:100 visit_provenance
  visit_provenance(self: AllocId, visit: VisitWith): void {
    visit(self, undefined);
  },
};

// impl VisitProvenance for Provenance
export const VisitProvenance_Provenance: VisitProvenanceImpl<Provenance> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:106 visit_provenance
  visit_provenance(self: Provenance, visit: VisitWith): void {
    if (self.$ === "Concrete") {
      const { alloc_id, tag } = self;
      visit(alloc_id, tag);
    }
  },
};

// impl VisitProvenance for StrictPointer
export const VisitProvenance_StrictPointer: VisitProvenanceImpl<StrictPointer> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:114 visit_provenance
  visit_provenance(self: StrictPointer, visit: VisitWith): void {
    VisitProvenance_Provenance.visit_provenance(self.provenance, visit);
  },
};

// impl VisitProvenance for Pointer
export const VisitProvenance_Pointer: VisitProvenanceImpl<Pointer> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:120 visit_provenance
  visit_provenance(self: Pointer, visit: VisitWith): void {
    VisitProvenance_Option.visit_provenance(self.provenance, visit, VisitProvenance_Provenance);
  },
};

// impl VisitProvenance for Scalar
export const VisitProvenance_Scalar: VisitProvenanceImpl<Scalar> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:126 visit_provenance
  visit_provenance(self: Scalar, visit: VisitWith): void {
    switch (self.$) {
      case "Ptr":
        VisitProvenance_StrictPointer.visit_provenance(self._0, visit);
        break;
      case "Int":
        break;
    }
  },
};

// impl VisitProvenance for IoError
export const VisitProvenance_IoError: VisitProvenanceImpl<IoError> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:135 visit_provenance
  visit_provenance(self: IoError, visit: VisitWith): void {
    // use crate::shims::io_error::IoError::*;
    switch (self.$) {
      case "LibcError":
        break;
      case "WindowsError":
        break;
      case "HostError":
        break;
      case "Raw":
        VisitProvenance_Scalar.visit_provenance(self._0, visit);
        break;
    }
  },
};

// impl VisitProvenance for Immediate<Provenance>
export const VisitProvenance_Immediate: VisitProvenanceImpl<Immediate<Provenance>> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:147 visit_provenance
  visit_provenance(self: Immediate<Provenance>, visit: VisitWith): void {
    switch (self.$) {
      case "Scalar": {
        VisitProvenance_Scalar.visit_provenance(self._0, visit);
        break;
      }
      case "ScalarPair": {
        VisitProvenance_Scalar.visit_provenance(self._0, visit);
        VisitProvenance_Scalar.visit_provenance(self._1, visit);
        break;
      }
      case "Uninit":
        break;
    }
  },
};

// impl VisitProvenance for MemPlaceMeta<Provenance>
export const VisitProvenance_MemPlaceMeta: VisitProvenanceImpl<MemPlaceMeta<Provenance>> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:162 visit_provenance
  visit_provenance(self: MemPlaceMeta<Provenance>, visit: VisitWith): void {
    switch (self.$) {
      case "Meta":
        VisitProvenance_Scalar.visit_provenance(self._0, visit);
        break;
      case "None":
        break;
    }
  },
};

// impl VisitProvenance for ImmTy<'_>
export const VisitProvenance_ImmTy: VisitProvenanceImpl<ImmTy> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:171 visit_provenance
  visit_provenance(self: ImmTy, visit: VisitWith): void {
    // `(**self)`: `ImmTy` derefs to its `Immediate`.
    VisitProvenance_Immediate.visit_provenance(self.imm, visit);
  },
};

// impl VisitProvenance for MPlaceTy<'_>
export const VisitProvenance_MPlaceTy: VisitProvenanceImpl<MPlaceTy> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:177 visit_provenance
  visit_provenance(self: MPlaceTy, visit: VisitWith): void {
    VisitProvenance_Pointer.visit_provenance(self.ptr(), visit);
    VisitProvenance_MemPlaceMeta.visit_provenance(self.meta(), visit);
  },
};

// impl VisitProvenance for PlaceTy<'_>
export const VisitProvenance_PlaceTy: VisitProvenanceImpl<PlaceTy> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:184 visit_provenance
  visit_provenance(self: PlaceTy, visit: VisitWith): void {
    const e = self.as_mplace_or_local();
    switch (e.$) {
      case "Left":
        VisitProvenance_MPlaceTy.visit_provenance(e._0, visit);
        break;
      case "Right":
        break;
    }
  },
};

// impl VisitProvenance for OpTy<'_>
export const VisitProvenance_OpTy: VisitProvenanceImpl<OpTy> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:193 visit_provenance
  visit_provenance(self: OpTy, visit: VisitWith): void {
    const e = self.as_mplace_or_imm();
    switch (e.$) {
      case "Left":
        VisitProvenance_MPlaceTy.visit_provenance(e._0, visit);
        break;
      case "Right":
        VisitProvenance_ImmTy.visit_provenance(e._0, visit);
        break;
    }
  },
};

// impl VisitProvenance for Allocation<Provenance, AllocExtra<'_>, MiriAllocBytes>
export const VisitProvenance_Allocation: VisitProvenanceImpl<Allocation<Provenance, AllocExtra, MiriAllocBytes>> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:202 visit_provenance
  visit_provenance(self: Allocation<Provenance, AllocExtra, MiriAllocBytes>, visit: VisitWith): void {
    for (const prov of self.provenance_().provenances()) {
      VisitProvenance_Provenance.visit_provenance(prov, visit);
    }

    self.extra.visit_provenance(visit);
  },
};

// impl VisitProvenance for crate::MiriInterpCx<'_>
export const VisitProvenance_MiriInterpCx: VisitProvenanceImpl<MiriInterpCx> = {
  // rustc: src/tools/miri/src/provenance_gc.rs:212 visit_provenance
  visit_provenance(self: MiriInterpCx, visit: VisitWith): void {
    // Visit the contents of the allocations and the IDs themselves, to account for all
    // live allocation IDs and all provenance in the allocation bytes, even if they are leaked.
    // We do *not* visit all the `AllocId` of the live allocations; we tried that and adding
    // them all to the live set is too expensive. Instead we later do liveness check by
    // checking both "is this alloc id live" and "is it mentioned anywhere else in
    // the interpreter state".
    self.memory.alloc_map_().iter((it) => {
      for (const [_id, [_kind, alloc]] of it) {
        VisitProvenance_Allocation.visit_provenance(alloc, visit);
      }
    });
    // And all the other machine values.
    self.machine.visit_provenance(visit);
  },
};

// rustc: src/tools/miri/src/provenance_gc.rs:235 is_live
LiveAllocs.prototype.is_live = function (this: LiveAllocs, id: AllocId): boolean {
  return this.collected.has(id) || this.ecx.is_alloc_live(id);
};

/** `retain` of a map that is an `FxHashMap` (bucket order) or a plain `Map` (the visiting order does not change which
 * entries are kept). */
function map_retain<K, V>(m: Map<K, V>, f: (k: K, v: V) => boolean): void {
  const retain = (m as { retain?: (f: (k: K, v: V) => boolean) => void }).retain;
  if (typeof retain === "function") {
    retain.call(m, f);
    return;
  }
  for (const [k, v] of m) {
    if (!f(k, v)) m.delete(k);
  }
}

// rustc: src/tools/miri/src/provenance_gc.rs:240 remove_unreachable_tags
function remove_unreachable_tags(ecx: MiriInterpCx, tags: Set<BorTag>): void {
  // Avoid iterating all allocations if there's no borrow tracker anyway.
  if (ecx.machine.borrow_tracker !== undefined) {
    ecx.memory.alloc_map_().iter((it) => {
      for (const [_id, [_kind, alloc]] of it) {
        AllocState.remove_unreachable_tags(unwrap(alloc.extra.borrow_tracker), tags);
      }
    });
  }
}

// rustc: src/tools/miri/src/provenance_gc.rs:251 remove_unreachable_allocs
function remove_unreachable_allocs(ecx: MiriInterpCx, allocs_: Set<AllocId>): void {
  const allocs = new LiveAllocs(allocs_, ecx);
  map_retain(ecx.machine.allocation_spans, (id, _) => allocs.is_live(id));
  map_retain(ecx.machine.symbolic_alignment, (id, _) => allocs.is_live(id));
  ecx.machine.alloc_addresses.remove_unreachable_allocs(allocs);
  const borrow_tracker = ecx.machine.borrow_tracker;
  if (borrow_tracker !== undefined) {
    borrow_tracker.remove_unreachable_allocs(allocs);
  }
  // Clean up core (non-Miri-specific) state.
  ecx.remove_unreachable_allocs(allocs.collected);
}

// impl<'tcx> EvalContextExt<'tcx> for crate::MiriInterpCx<'tcx> {}
// rustc: src/tools/miri/src/provenance_gc.rs:265 run_provenance_gc
InterpCx.prototype.run_provenance_gc = function (this: MiriInterpCx): void {
  const this_ = this.eval_context_mut();

  // We collect all tags and AllocId from every part of the interpreter.
  // PORT: the two `FxHashSet`s are only queried (`contains`), never iterated: plain `Set`s.
  const tags = new Set<BorTag>();
  const alloc_ids = new Set<AllocId>();
  VisitProvenance_MiriInterpCx.visit_provenance(this_, (id, tag) => {
    if (id !== undefined) {
      alloc_ids.add(id);
    }
    if (tag !== undefined) {
      tags.add(tag);
    }
  });

  // Based on this, clean up the interpreter state.
  remove_unreachable_tags(this_, tags);
  remove_unreachable_allocs(this_, alloc_ids);
};

// (The miri-machine placeholders for AllocExtra / MiriMachine `visit_provenance` were removed at integration: machine.ts ports them.)

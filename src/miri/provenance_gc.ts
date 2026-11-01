// Port of src/tools/miri/src/provenance_gc.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into provenance_gc.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type BorTag } from "./borrow_tracker/mod.ts";
import { type MiriInterpCx } from "./machine.ts";
import { LiveAllocs } from "./provenance_gc.gen.ts";
import { stub_methods } from "../rust_ts/miri_stub.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { type AllocId } from "../rustc_middle/mir/interpret/mod.ts";
export * from "./provenance_gc.gen.ts";

// rustc-type: src/tools/miri/src/provenance_gc.rs:10 VisitWith
/** `pub type VisitWith<'a> = dyn FnMut(Option<AllocId>, Option<BorTag>) + 'a;` */
export type VisitWith = (alloc_id: AllocId | undefined, tag: BorTag | undefined) => void;

/** `pub trait VisitProvenance` (provenance_gc.rs:12; lane miri-driver). PORT(contract): implemented by object values as a
 * method (`MachineCallback`, the generated classes); values that are not objects (`Option<T>`, `Vec<T>`, `Scalar`, ...)
 * get impl tables `VisitProvenance_<T>` (borrowck-contract rule 5), which the lane defines. */
export interface VisitProvenance {
  // rustc: src/tools/miri/src/provenance_gc.rs:13 visit_provenance
  visit_provenance(visit: VisitWith): void;
}

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

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// trait VisitProvenance (provenance_gc.rs:12): visit_provenance (:13)
// macro_rules! no_provenance (provenance_gc.rs:17): fns in its body: visit_provenance (:21)
// impl VisitProvenance for &'static str (provenance_gc.rs:28): visit_provenance (:29)
// impl VisitProvenance for Option<T> (provenance_gc.rs:32): visit_provenance (:33)
// impl VisitProvenance for (A, B) (provenance_gc.rs:40): visit_provenance (:45)
// impl VisitProvenance for Box<T> (provenance_gc.rs:51): visit_provenance (:52)
// impl VisitProvenance for Rc<T> (provenance_gc.rs:57): visit_provenance (:58)
// impl VisitProvenance for Vec<T> (provenance_gc.rs:63): visit_provenance (:64)
// impl VisitProvenance for BTreeMap<K, V> (provenance_gc.rs:69): visit_provenance (:70)
// impl VisitProvenance for FxHashMap<K, V> (provenance_gc.rs:78): visit_provenance (:79)
// impl VisitProvenance for std::cell::RefCell<T> (provenance_gc.rs:87): visit_provenance (:88)
// impl VisitProvenance for BorTag (provenance_gc.rs:93): visit_provenance (:94)
// impl VisitProvenance for AllocId (provenance_gc.rs:99): visit_provenance (:100)
// impl VisitProvenance for Provenance (provenance_gc.rs:105): visit_provenance (:106)
// impl VisitProvenance for StrictPointer (provenance_gc.rs:113): visit_provenance (:114)
// impl VisitProvenance for Pointer (provenance_gc.rs:119): visit_provenance (:120)
// impl VisitProvenance for Scalar (provenance_gc.rs:125): visit_provenance (:126)
// impl VisitProvenance for IoError (provenance_gc.rs:134): visit_provenance (:135)
// impl VisitProvenance for Immediate<Provenance> (provenance_gc.rs:146): visit_provenance (:147)
// impl VisitProvenance for MemPlaceMeta<Provenance> (provenance_gc.rs:161): visit_provenance (:162)
// impl VisitProvenance for ImmTy<'_> (provenance_gc.rs:170): visit_provenance (:171)
// impl VisitProvenance for MPlaceTy<'_> (provenance_gc.rs:176): visit_provenance (:177)
// impl VisitProvenance for PlaceTy<'_> (provenance_gc.rs:183): visit_provenance (:184)
// impl VisitProvenance for OpTy<'_> (provenance_gc.rs:192): visit_provenance (:193)
// impl VisitProvenance for Allocation<Provenance, AllocExtra<'_>, MiriAllocBytes> (provenance_gc.rs:201): visit_provenance (:202)
// impl VisitProvenance for crate::MiriInterpCx<'_> (provenance_gc.rs:211): visit_provenance (:212)
// fn remove_unreachable_tags (provenance_gc.rs:240)
// fn remove_unreachable_allocs (provenance_gc.rs:251)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::provenance_gc::EvalContextExt", "src/tools/miri/src/provenance_gc.rs", "miri-driver", () => InterpCx.prototype, ["run_provenance_gc"]);
stub_methods("miri::provenance_gc::LiveAllocs", "src/tools/miri/src/provenance_gc.rs", "miri-driver", () => LiveAllocs.prototype, ["is_live"]);

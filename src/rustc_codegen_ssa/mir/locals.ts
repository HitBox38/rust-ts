//! Locals are in a private module as updating `LocalRef::Operand` has to
//! be careful wrt to subtyping. To deal with this we only allow updates by using
//! `FunctionCx::overwrite_local` which handles it automatically.
// Port of compiler/rustc_codegen_ssa/src/mir/locals.rs (lane ssa-mir-core, plan-m7 wave 41).
//
// PORT: `impl FunctionCx { initialize_locals, overwrite_local }` (locals.rs:40) lives in the `FunctionCx` class body in
// mod.ts, with markers to this file (PORTING §8, clarification 1). mod.ts constructs `Locals` at run time, so this file
// imports mod.ts for types only; a run-time import back would be a load cycle, and the crate root (lib.ts, lane ssa-base)
// does not load mir extension files. The fields `values` stays public for those two methods (upstream `pub(super)`
// visibility from the parent module).
import type { Local } from "../../rustc_middle/mir/mod.ts";
import type { LocalRef } from "./mod.ts";

export class Locals<V> {
  constructor(public values: LocalRef<V>[]) {}

  // impl<'tcx, V> Index<mir::Local> for Locals<'tcx, V>
  // rustc: compiler/rustc_codegen_ssa/src/mir/locals.rs:22 index
  index(index: Local): LocalRef<V> {
    return this.values[index]!;
  }

  // To mutate locals, use `FunctionCx::overwrite_local` instead.
  // impl<'tcx, V, Idx: ?Sized> !IndexMut<Idx> for Locals<'tcx, V> {}

  // rustc: compiler/rustc_codegen_ssa/src/mir/locals.rs:31 empty
  static empty<V>(): Locals<V> {
    return new Locals<V>([]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/locals.rs:35 indices
  indices(): Local[] {
    return this.values.map((_, i) => i as Local);
  }
}

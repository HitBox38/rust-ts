// Port of compiler/rustc_middle/src/ty/intrinsic.rs (lane typeck-gaps; the contract stub of lane ty-contract filled).
//
// - `IntrinsicDef` is a data-only struct (an interface); its derived `Debug` is `debug_IntrinsicDef`. The derived
//   `Decodable` / `Encodable` / `StableHash` impls are not written (tools/codegen; PORTING §3/§5).
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import type { DefId } from "../../rustc_span/def_id.ts";
import { debug_Symbol, type Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_struct } from "../../std/fmt.ts";
import { TyCtxt } from "./context.ts";

// rustc-type: compiler/rustc_middle/src/ty/intrinsic.rs:8 IntrinsicDef
export interface IntrinsicDef {
  name: Symbol;
  /// Whether the intrinsic has no meaningful body and all backends need to shim all calls to it.
  must_be_overridden: boolean;
  /// Whether the intrinsic can be invoked from stable const fn (`#[rustc_intrinsic_const_stable_indirect]`).
  const_stable_indirect: boolean;
}
/** `#[derive(Debug)]` */
export const debug_IntrinsicDef: Debug<IntrinsicDef> = (v, f) =>
  debug_struct(f, "IntrinsicDef", [
    ["name", debug_Symbol(v.name, f)],
    ["must_be_overridden", debug_bool(v.must_be_overridden, f)],
    ["const_stable_indirect", debug_bool(v.const_stable_indirect, f)],
  ]);

// impl TyCtxt<'_>
// rustc: compiler/rustc_middle/src/ty/intrinsic.rs:17 is_intrinsic
TyCtxt.prototype.is_intrinsic = function (this: TyCtxt, def_id: DefId, name: Symbol): boolean {
  const i = this.intrinsic(def_id);
  if (i === undefined) return false;
  return i.name === name;
};

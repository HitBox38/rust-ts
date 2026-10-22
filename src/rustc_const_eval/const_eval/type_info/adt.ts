// Port of compiler/rustc_const_eval/src/const_eval/type_info/adt.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-b; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type VariantIdx } from "../../../rustc_abi/lib.ts";
import { type CompileTimeInterpCx } from "../machine.ts";
import { InterpCx } from "../../interpret/eval_context.ts";
import { type Machine } from "../../interpret/machine.ts";
import { type Writeable } from "../../interpret/place.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type AdtDef } from "../../../rustc_middle/ty/adt.ts";
import { type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type Region } from "../../../rustc_middle/ty/region.ts";
import { unported } from "../../../std/panic.ts";
import { MPlaceTy } from "../../interpret/place.gen.ts";
import type { Const } from "../../../rustc_middle/ty/consts.gen.ts";

declare module "../../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // adt.rs:14 (lane ctfe-b)
    write_adt_type_info(place: Writeable, adt_def: AdtDef): InterpResult<VariantIdx>;
    // adt.rs:36 (lane ctfe-b)
    write_generics(place: Writeable, generics: GenericArgs): InterpResult;
    // adt.rs:50 (lane ctfe-b)
    write_generic_lifetime(_region: Region, place: MPlaceTy): InterpResult;
    // adt.rs:60 (lane ctfe-b)
    write_generic_type(ty: Ty, place: MPlaceTy): InterpResult;
    // adt.rs:84 (lane ctfe-b)
    write_generic_const(c: Const, place: MPlaceTy): InterpResult;
  }
}

// stub: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:14 write_adt_type_info (lane ctfe-b)
InterpCx.prototype.write_adt_type_info = function (this: CompileTimeInterpCx, place: Writeable, adt_def: AdtDef): InterpResult<VariantIdx> {
  return unported("rustc_const_eval::const_eval::type_info::adt::InterpCx::write_adt_type_info");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:36 write_generics (lane ctfe-b)
InterpCx.prototype.write_generics = function (this: CompileTimeInterpCx, place: Writeable, generics: GenericArgs): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::adt::InterpCx::write_generics");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:50 write_generic_lifetime (lane ctfe-b)
InterpCx.prototype.write_generic_lifetime = function (this: CompileTimeInterpCx, _region: Region, place: MPlaceTy): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::adt::InterpCx::write_generic_lifetime");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:60 write_generic_type (lane ctfe-b)
InterpCx.prototype.write_generic_type = function (this: CompileTimeInterpCx, ty: Ty, place: MPlaceTy): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::adt::InterpCx::write_generic_type");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:84 write_generic_const (lane ctfe-b)
InterpCx.prototype.write_generic_const = function (this: CompileTimeInterpCx, c: Const, place: MPlaceTy): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::adt::InterpCx::write_generic_const");
};

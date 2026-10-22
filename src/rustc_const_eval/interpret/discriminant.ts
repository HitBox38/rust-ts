// Port of compiler/rustc_const_eval/src/interpret/discriminant.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type FieldIdx, type VariantIdx } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { type Writeable } from "./place.ts";
import { type Projectable } from "./projection.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
import { ImmTy } from "./operand.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // discriminant.rs:20 (lane interp-ops)
    write_discriminant(variant_index: VariantIdx, dest: Writeable): InterpResult;
    // discriminant.rs:53 (lane interp-ops)
    read_discriminant(op: Projectable): InterpResult<VariantIdx>;
    // discriminant.rs:222 (lane interp-ops)
    discriminant_for_variant(ty: Ty, variant: VariantIdx): InterpResult<ImmTy>;
    // discriminant.rs:247 (lane interp-ops)
    tag_for_variant(layout: TyAndLayout, variant_index: VariantIdx): InterpResult<[ScalarInt, FieldIdx] | undefined>;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/discriminant.rs:20 write_discriminant (lane interp-ops)
InterpCx.prototype.write_discriminant = function (this: InterpCx, variant_index: VariantIdx, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::discriminant::InterpCx::write_discriminant");
};

// stub: compiler/rustc_const_eval/src/interpret/discriminant.rs:53 read_discriminant (lane interp-ops)
InterpCx.prototype.read_discriminant = function (this: InterpCx, op: Projectable): InterpResult<VariantIdx> {
  return unported("rustc_const_eval::interpret::discriminant::InterpCx::read_discriminant");
};

// stub: compiler/rustc_const_eval/src/interpret/discriminant.rs:222 discriminant_for_variant (lane interp-ops)
InterpCx.prototype.discriminant_for_variant = function (this: InterpCx, ty: Ty, variant: VariantIdx): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::discriminant::InterpCx::discriminant_for_variant");
};

// stub: compiler/rustc_const_eval/src/interpret/discriminant.rs:247 tag_for_variant (lane interp-ops)
InterpCx.prototype.tag_for_variant = function (this: InterpCx, layout: TyAndLayout, variant_index: VariantIdx): InterpResult<[ScalarInt, FieldIdx] | undefined> {
  return unported("rustc_const_eval::interpret::discriminant::InterpCx::tag_for_variant");
};

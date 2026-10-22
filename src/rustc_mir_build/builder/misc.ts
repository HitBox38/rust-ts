// Port of compiler/rustc_mir_build/src/builder/misc.rs (lane mb-mod, plan-m4 wave 22): `impl Builder` methods put on its
// prototype (builder/mod.ts header: conventions). `InferCtxt::type_is_copy_modulo_regions` is rustc_trait_selection's
// `InferCtxtExt` (infer.ts), loaded with that crate (as the other mir_build callers of its extensions rely on).
//! Miscellaneous builder routines that are not specific to building any particular
//! kind of thing.
import { type BasicBlock, Const, ConstOperand, Local, LocalDecl, type Operand, type Place, Place_from_Local, type SourceInfo } from "../../rustc_middle/mir/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { Builder } from "./mod.ts";
import { type Span } from "../../rustc_span/lib.ts";

declare module "./mod.ts" {
  interface Builder {
    temp(ty: Ty, span: Span): Place;
    literal_operand(span: Span, const_: Const): Operand;
    zero_literal(span: Span, ty: Ty): Operand;
    push_usize(block: BasicBlock, source_info: SourceInfo, value: number): Place;
    consume_by_copy_or_move(place: Place): Operand;
  }
}

/// Adds a new temporary value of type `ty` storing the result of
/// evaluating `expr`.
///
/// N.B., **No cleanup is scheduled for this temporary.** You should
/// call `schedule_drop` once the temporary is initialized.
// rustc: compiler/rustc_mir_build/src/builder/misc.rs:18 temp
Builder.prototype.temp = function (this: Builder, ty: Ty, span: Span): Place {
  // `IndexVec::push` returns the index of the new element.
  this.local_decls.push(LocalDecl.new(ty, span));
  const temp = Local.from_usize(this.local_decls.length - 1);
  const place = Place_from_Local(temp);
  // debug!("temp: created temp {:?} with type {:?}", place, self.local_decls[temp].ty);
  return place;
};

/// Convenience function for creating a literal operand, one
/// without any user type annotation.
// rustc: compiler/rustc_mir_build/src/builder/misc.rs:27 literal_operand
Builder.prototype.literal_operand = function (this: Builder, span: Span, const_: Const): Operand {
  const constant = new ConstOperand(span, undefined, const_);
  return { $: "Constant", _0: constant };
};

/// Returns a zero literal operand for the appropriate type, works for
/// bool, char and integers.
// rustc: compiler/rustc_mir_build/src/builder/misc.rs:34 zero_literal
Builder.prototype.zero_literal = function (this: Builder, span: Span, ty: Ty): Operand {
  const literal = Const.from_bits(this.tcx, 0n, this.typing_env(), ty);

  return this.literal_operand(span, literal);
};

// rustc: compiler/rustc_mir_build/src/builder/misc.rs:40 push_usize
Builder.prototype.push_usize = function (this: Builder, block: BasicBlock, source_info: SourceInfo, value: number): Place {
  const usize_ty = this.tcx.types.usize;
  const temp = this.temp(usize_ty, source_info.span);
  this.cfg.push_assign_constant(block, source_info, temp, new ConstOperand(source_info.span, undefined, Const.from_usize(this.tcx, value)));
  return temp;
};

// rustc: compiler/rustc_mir_build/src/builder/misc.rs:61 consume_by_copy_or_move
Builder.prototype.consume_by_copy_or_move = function (this: Builder, place: Place): Operand {
  const tcx = this.tcx;
  const ty = place.ty(this.local_decls, tcx).ty;
  if (this.infcx.type_is_copy_modulo_regions(this.param_env, ty)) {
    return { $: "Copy", _0: place };
  } else {
    return { $: "Move", _0: place };
  }
};

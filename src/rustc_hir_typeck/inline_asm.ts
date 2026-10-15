// Port of compiler/rustc_hir_typeck/src/inline_asm.rs (lane typeck-expr-b).
//
// `InlineAsmCtxt` and `NonAsmTypeReason` are generated (inline_asm.gen.ts); the methods of `impl InlineAsmCtxt` are
// declared below by augmenting the generated module (decls.ts only lists them as comments) and assigned onto its
// prototype; `InlineAsmCtxt::new` is the namespace member `InlineAsmCtxt.new` (fnctxt-contract "Statics").
// - The fn-local `struct FormattingSubRegisterArg` and its `impl Diagnostic` (inline_asm.rs:199..242) are module-level
//   (`FormattingSubRegisterArg` / `FormattingSubRegisterArg_diagnostic`, the generated-diagnostic shape), with the
//   nested `format_size` inside `into_diag`.
// - `debug!` is tracing only.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
import { InlineAsmTemplatePiece } from "../rustc_ast/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { ASM_SUB_REGISTER } from "../rustc_lint_defs/builtin.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { FieldIdx } from "../rustc_middle/ty/decls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { display_Const } from "../rustc_type_ir/ir_print.ts";
import { Article_TyKind } from "../rustc_middle/ty/sty.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import {
  InlineAsmReg,
  InlineAsmRegClass,
  InlineAsmSize,
  InlineAsmType,
  type ModifierInfo,
} from "../rustc_target/asm/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { FnCtxt } from "./decls.ts";
import { AsmConstPtrUnstable_diagnostic, RegisterTypeUnstable_diagnostic } from "./diagnostics.gen.ts";
import { InlineAsmCtxt, type NonAsmTypeReason } from "./inline_asm.gen.ts";

export * from "./inline_asm.gen.ts";

declare module "./inline_asm.gen.ts" {
  interface InlineAsmCtxt {
    // inline_asm.rs:42
    tcx(): TyCtxt;
    // inline_asm.rs:46
    expr_ty(expr: hir.Expr): Ty;
    // inline_asm.rs:57
    is_thin_ptr_ty(ty: Ty): boolean;
    // inline_asm.rs:71
    get_asm_ty(span: Span, ty: Ty): Result<InlineAsmType, NonAsmTypeReason>;
    // inline_asm.rs:190
    check_asm_operand_type(
      idx: number,
      reg: hir.InlineAsmRegOrRegClass,
      expr: hir.Expr,
      template: readonly InlineAsmTemplatePiece[],
      is_input: boolean,
      tied_input: [hir.Expr, InlineAsmType | undefined] | undefined,
    ): InlineAsmType | undefined;
    // inline_asm.rs:459
    check_asm(asm: hir.InlineAsm): void;
  }
  namespace InlineAsmCtxt {
    // inline_asm.rs:38
    function new_(fcx: FnCtxt, def_id: LocalDefId): InlineAsmCtxt;
    export { new_ as new };
  }
}

// impl<'a, 'tcx> InlineAsmCtxt<'a, 'tcx> {

// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:38 new
(InlineAsmCtxt as unknown as { new: typeof InlineAsmCtxt.new }).new = function (fcx: FnCtxt, def_id: LocalDefId): InlineAsmCtxt {
  return new InlineAsmCtxt(fcx.tcx.asm_target_features(def_id), fcx);
};

// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:42 tcx
InlineAsmCtxt.prototype.tcx = function (this: InlineAsmCtxt): TyCtxt {
  return this.fcx.tcx;
};

// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:46 expr_ty
InlineAsmCtxt.prototype.expr_ty = function (this: InlineAsmCtxt, expr: hir.Expr): Ty {
  const ty_ = this.fcx.typeck_results.expr_ty_adjusted(expr);
  const ty = this.fcx.deeply_resolve_ignoring_regions_with_obligations(ty_, fold_Ty);
  if (TypeVisitableExt.has_non_region_infer(ty, fold_Ty)) {
    return Ty.new_misc_error(this.tcx());
  } else {
    return this.tcx().erase_and_anonymize_regions(ty, fold_Ty);
  }
};

// FIXME(compiler-errors): This could use `<$ty as Pointee>::Metadata == ()`
// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:57 is_thin_ptr_ty
InlineAsmCtxt.prototype.is_thin_ptr_ty = function (this: InlineAsmCtxt, ty: Ty): boolean {
  // Type still may have region variables, but `Sized` does not depend
  // on those, so just erase them before querying.
  if (this.fcx.type_is_sized_modulo_regions(this.fcx.param_env, ty)) {
    return true;
  }
  if (this.fcx.deeply_resolve_ignoring_regions_with_obligations(ty, fold_Ty).kind().$ === "Foreign") {
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:71 get_asm_ty
InlineAsmCtxt.prototype.get_asm_ty = function (this: InlineAsmCtxt, span: Span, ty: Ty): Result<InlineAsmType, NonAsmTypeReason> {
  let asm_ty_isize: InlineAsmType;
  const width = this.tcx().sess.target.pointer_width;
  switch (width) {
    case 16:
      asm_ty_isize = InlineAsmType.I16;
      break;
    case 32:
      asm_ty_isize = InlineAsmType.I32;
      break;
    case 64:
      asm_ty_isize = InlineAsmType.I64;
      break;
    default:
      bug(`unsupported pointer width: ${width}`);
  }

  const k = ty.kind();
  if ((k.$ === "Int" && k._0 === "I8") || (k.$ === "Uint" && k._0 === "U8")) return Ok(InlineAsmType.I8);
  if ((k.$ === "Int" && k._0 === "I16") || (k.$ === "Uint" && k._0 === "U16")) return Ok(InlineAsmType.I16);
  if ((k.$ === "Int" && k._0 === "I32") || (k.$ === "Uint" && k._0 === "U32")) return Ok(InlineAsmType.I32);
  if ((k.$ === "Int" && k._0 === "I64") || (k.$ === "Uint" && k._0 === "U64")) return Ok(InlineAsmType.I64);
  if ((k.$ === "Int" && k._0 === "I128") || (k.$ === "Uint" && k._0 === "U128")) return Ok(InlineAsmType.I128);
  if ((k.$ === "Int" && k._0 === "Isize") || (k.$ === "Uint" && k._0 === "Usize")) return Ok(asm_ty_isize);
  if (k.$ === "Float" && k._0 === "F16") return Ok(InlineAsmType.F16);
  if (k.$ === "Float" && k._0 === "F32") return Ok(InlineAsmType.F32);
  if (k.$ === "Float" && k._0 === "F64") return Ok(InlineAsmType.F64);
  if (k.$ === "Float" && k._0 === "F128") return Ok(InlineAsmType.F128);
  if (k.$ === "FnPtr") return Ok(asm_ty_isize);
  if (k.$ === "RawPtr") {
    const elem_ty = k._0;
    if (this.is_thin_ptr_ty(elem_ty)) {
      return Ok(asm_ty_isize);
    } else {
      return Err({ $: "NotSizedPtr", _0: ty });
    }
  }
  if (k.$ === "Adt" && k._0.repr().simd()) {
    const adt = k._0;
    const args = k._1;
    if (!adt.is_struct()) {
      const guar = this.fcx.dcx().span_delayed_bug(span, `repr(simd) should only be used on structs, got ${adt.descr()}`);
      return Err({ $: "Tainted", _0: guar });
    }

    const fields = adt.non_enum_variant().fields;
    if (fields.length === 0) {
      return Err({ $: "EmptySIMDArray", _0: ty });
    }
    const field = unwrap(fields[0 as FieldIdx], "index out of bounds");
    const elem_ty = Unnormalized.skip_norm_wip(field.ty(this.tcx(), args));

    let size: number;
    let ty_: Ty;
    const ek = elem_ty.kind();
    if (ek.$ === "Array") {
      const ty__ = ek._0;
      const len_ = ek._1;
      // FIXME: `try_structurally_resolve_const` doesn't eval consts
      // in the old solver.
      const len = this.fcx.next_trait_solver()
        ? this.fcx.try_structurally_resolve_const(span, len_)
        : this.fcx.tcx.normalize_erasing_regions(this.fcx.typing_env(this.fcx.param_env), Unnormalized.new_wip(len_), fold_Const);
      const len_usize = len.try_to_target_usize(this.tcx());
      if (len_usize === undefined) {
        return Err({ $: "UnevaluatedSIMDArrayLength", _0: field.did, _1: len });
      }
      [size, ty_] = [len_usize, ty__];
    } else {
      [size, ty_] = [fields.length, elem_ty];
    }

    const tk = ty_.kind();
    if ((tk.$ === "Int" && tk._0 === "I8") || (tk.$ === "Uint" && tk._0 === "U8")) return Ok({ $: "VecI8", _0: size });
    if ((tk.$ === "Int" && tk._0 === "I16") || (tk.$ === "Uint" && tk._0 === "U16")) return Ok({ $: "VecI16", _0: size });
    if ((tk.$ === "Int" && tk._0 === "I32") || (tk.$ === "Uint" && tk._0 === "U32")) return Ok({ $: "VecI32", _0: size });
    if ((tk.$ === "Int" && tk._0 === "I64") || (tk.$ === "Uint" && tk._0 === "U64")) return Ok({ $: "VecI64", _0: size });
    if ((tk.$ === "Int" && tk._0 === "I128") || (tk.$ === "Uint" && tk._0 === "U128")) {
      return Ok({ $: "VecI128", _0: size });
    }
    if ((tk.$ === "Int" && tk._0 === "Isize") || (tk.$ === "Uint" && tk._0 === "Usize")) {
      const width = this.tcx().sess.target.pointer_width;
      switch (width) {
        case 16:
          return Ok({ $: "VecI16", _0: size });
        case 32:
          return Ok({ $: "VecI32", _0: size });
        case 64:
          return Ok({ $: "VecI64", _0: size });
        default:
          bug(`unsupported pointer width: ${width}`);
      }
    }
    if (tk.$ === "Float" && tk._0 === "F16") return Ok({ $: "VecF16", _0: size });
    if (tk.$ === "Float" && tk._0 === "F32") return Ok({ $: "VecF32", _0: size });
    if (tk.$ === "Float" && tk._0 === "F64") return Ok({ $: "VecF64", _0: size });
    if (tk.$ === "Float" && tk._0 === "F128") return Ok({ $: "VecF128", _0: size });
    return Err({ $: "InvalidElement", _0: field.did, _1: ty_ });
  }
  if (k.$ === "Adt" && k._0.repr().is_scalable()) {
    const adt = k._0;
    const [_element_count, elem_ty, _number_of_vectors] = unwrap(ty.scalable_vector_parts(this.tcx()));

    const ek = elem_ty.kind();
    if ((ek.$ === "Int" && ek._0 === "I8") || (ek.$ === "Uint" && ek._0 === "U8")) return Ok(InlineAsmType.SveVecI8);
    if ((ek.$ === "Int" && ek._0 === "I16") || (ek.$ === "Uint" && ek._0 === "U16")) return Ok(InlineAsmType.SveVecI16);
    if ((ek.$ === "Int" && ek._0 === "I32") || (ek.$ === "Uint" && ek._0 === "U32")) return Ok(InlineAsmType.SveVecI32);
    if ((ek.$ === "Int" && ek._0 === "I64") || (ek.$ === "Uint" && ek._0 === "U64")) return Ok(InlineAsmType.SveVecI64);
    if ((ek.$ === "Int" && ek._0 === "I128") || (ek.$ === "Uint" && ek._0 === "U128")) return Ok(InlineAsmType.SveVecI128);
    if (ek.$ === "Float" && ek._0 === "F16") return Ok(InlineAsmType.SveVecF16);
    if (ek.$ === "Float" && ek._0 === "F32") return Ok(InlineAsmType.SveVecF32);
    if (ek.$ === "Float" && ek._0 === "F64") return Ok(InlineAsmType.SveVecF64);
    if (ek.$ === "Float" && ek._0 === "F128") return Ok(InlineAsmType.SveVecF128);
    if (ek.$ === "Bool") return Ok(InlineAsmType.SveVecBool);
    const fields = adt.non_enum_variant().fields;
    const field = unwrap(fields[0 as FieldIdx], "index out of bounds");
    return Err({ $: "InvalidElement", _0: field.did, _1: ty });
  }
  if (k.$ === "Infer") bug("unexpected infer ty in asm operand");
  return Err({ $: "Invalid", _0: ty });
};

/** inline_asm.rs:199 `struct FormattingSubRegisterArg<'a>` (fn-local in `check_asm_operand_type`). */
interface FormattingSubRegisterArg {
  expr_span: Span;
  idx: number;
  suggested_modifier: number;
  suggested_result: string;
  suggested_size: InlineAsmSize;
  default_modifier: number;
  default_result: string;
  default_size: InlineAsmSize;
}

// impl<'a, 'b> Diagnostic<'a> for FormattingSubRegisterArg<'b>
// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:211 into_diag
function FormattingSubRegisterArg_into_diag(self: FormattingSubRegisterArg, dcx: DiagCtxtHandle, level: Level): Diag {
  const { expr_span, idx, suggested_modifier, suggested_result, suggested_size, default_modifier, default_result, default_size } =
    self;

  // rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:223 format_size
  function format_size(size: InlineAsmSize): string {
    switch (size.$) {
      case "FixedBytes":
        return `${size._0}-byte values`;
      case "Scalable":
        return "scalable values";
    }
  }
  return Diag.new(dcx, level, "formatting may not be suitable for sub-register argument")
    .with_span_label(expr_span, "for this argument")
    .with_help(
      `use \`{${idx}:${String.fromCodePoint(suggested_modifier)}}\` to have the register formatted as \`${suggested_result}\` (for ${format_size(suggested_size)})`,
    )
    .with_help(
      `or use \`{${idx}:${String.fromCodePoint(default_modifier)}}\` to keep the default formatting of \`${default_result}\` (for ${format_size(default_size)})`,
    );
}

/** `FormattingSubRegisterArg` as a `Diagnostic` trait object. */
function FormattingSubRegisterArg_diagnostic(self: FormattingSubRegisterArg): Diagnostic {
  return { into_diag: (dcx, level) => FormattingSubRegisterArg_into_diag(self, dcx, level) };
}

// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:190 check_asm_operand_type
InlineAsmCtxt.prototype.check_asm_operand_type = function (
  this: InlineAsmCtxt,
  idx: number,
  reg: hir.InlineAsmRegOrRegClass,
  expr: hir.Expr,
  template: readonly InlineAsmTemplatePiece[],
  is_input: boolean,
  tied_input: [hir.Expr, InlineAsmType | undefined] | undefined,
): InlineAsmType | undefined {
  const ty = this.expr_ty(expr);
  if (TypeVisitableExt.has_non_region_infer(ty, fold_Ty)) {
    bug(`inference variable in asm operand ty: ${hir.debug_Expr(expr, PLAIN)} ${debug_Ty(ty, PLAIN)}`);
  }

  let asm_ty_: Result<InlineAsmType, NonAsmTypeReason>;
  const k = ty.kind();
  if (k.$ === "Never" && is_input) {
    // `!` is allowed for input but not for output (issue #87802)
    return undefined;
  } else if (TypeVisitableExt.references_error(ty, fold_Ty)) {
    return undefined;
  } else if (k.$ === "Adt" && this.tcx().is_lang_item(k._0.did(), LangItem.MaybeUninit)) {
    const ty_ = k._1.type_at(0);
    asm_ty_ = this.get_asm_ty(expr.span, ty_);
  } else {
    asm_ty_ = this.get_asm_ty(expr.span, ty);
  }
  if (asm_ty_.$ === "Err") {
    const reason = asm_ty_._0;
    switch (reason.$) {
      case "UnevaluatedSIMDArrayLength": {
        const did = reason._0;
        const len = reason._1;
        const msg = `cannot evaluate SIMD vector length \`${display_Const(len)}\``;
        this.fcx
          .dcx()
          .struct_span_err(this.tcx().def_span(did), msg)
          .with_span_note(expr.span, "SIMD vector length needs to be known statically for use in `asm!`")
          .emit();
        break;
      }
      case "Invalid": {
        const ty = reason._0;
        const msg = `cannot use value of type \`${display_Ty(ty)}\` for inline assembly`;
        this.fcx
          .dcx()
          .struct_span_err(expr.span, msg)
          .with_note(
            "only integers, floats, SIMD vectors, scalable vectors, pointers and function pointers can be used as arguments for inline assembly",
          )
          .emit();
        break;
      }
      case "NotSizedPtr": {
        const ty = reason._0;
        const msg = `cannot use value of unsized pointer type \`${display_Ty(ty)}\` for inline assembly`;
        this.fcx.dcx().struct_span_err(expr.span, msg).with_note("only sized pointers can be used in inline assembly").emit();
        break;
      }
      case "InvalidElement": {
        const did = reason._0;
        const ty = reason._1;
        const msg = `cannot use SIMD vector with element type \`${display_Ty(ty)}\` for inline assembly`;
        this.fcx
          .dcx()
          .struct_span_err(this.tcx().def_span(did), msg)
          .with_span_note(
            expr.span,
            "only integers, floats, SIMD vectors, pointers and function pointers can be used as arguments for inline assembly",
          )
          .emit();
        break;
      }
      case "EmptySIMDArray": {
        const ty = reason._0;
        const msg = `use of empty SIMD vector \`${display_Ty(ty)}\``;
        this.fcx.dcx().struct_span_err(expr.span, msg).emit();
        break;
      }
      case "Tainted": {
        // An error has already been reported.
        break;
      }
    }
    return undefined;
  }
  const asm_ty = asm_ty_._0;

  // Check that the type implements Copy. The only case where this can
  // possibly fail is for SIMD types which don't #[derive(Copy)].
  if (!this.fcx.type_is_copy_modulo_regions(this.fcx.param_env, ty)) {
    const msg = "arguments for inline assembly must be copyable";
    this.fcx.dcx().struct_span_err(expr.span, msg).with_note(`\`${display_Ty(ty)}\` does not implement the Copy trait`).emit();
  }

  // Ideally we wouldn't need to do this, but LLVM's register allocator
  // really doesn't like it when tied operands have different types.
  //
  // This is purely an LLVM limitation, but we have to live with it since
  // there is no way to hide this with implicit conversions.
  //
  // For the purposes of this check we only look at the `InlineAsmType`,
  // which means that pointers and integers are treated as identical (modulo
  // size).
  if (tied_input !== undefined && tied_input[1] !== undefined) {
    const [in_expr, in_asm_ty] = tied_input;
    if (!InlineAsmType.eq(in_asm_ty, asm_ty)) {
      const msg = "incompatible types for asm inout argument";
      const in_expr_ty = this.expr_ty(in_expr);
      this.fcx
        .dcx()
        .struct_span_err([in_expr.span, expr.span], msg)
        .with_span_label(in_expr.span, `type \`${display_Ty(in_expr_ty)}\``)
        .with_span_label(expr.span, `type \`${display_Ty(ty)}\``)
        .with_note("asm inout arguments must have the same type, unless they are both pointers or integers of the same size")
        .emit();
    }

    // All of the later checks have already been done on the input, so
    // let's not emit errors and warnings twice.
    return asm_ty;
  }

  // Check the type against the list of types supported by the selected
  // register class.
  const asm_arch = unwrap(this.tcx().sess.asm_arch);
  const allow_experimental_reg = this.tcx().features().asm_experimental_reg();
  const reg_class = hir.InlineAsmRegOrRegClass.reg_class(reg);
  const supported_tys = InlineAsmRegClass.supported_types(reg_class, asm_arch, allow_experimental_reg);
  const supported = supported_tys.find(([t, _]) => InlineAsmType.eq(t, asm_ty));
  if (supported === undefined) {
    let err: Diag;
    if (
      !allow_experimental_reg &&
      InlineAsmRegClass.supported_types(reg_class, asm_arch, true).some(([t, _]) => InlineAsmType.eq(t, asm_ty))
    ) {
      err = this.tcx().sess.create_feature_err(RegisterTypeUnstable_diagnostic({ span: expr.span, ty }), sym.asm_experimental_reg);
    } else {
      const msg = `type \`${display_Ty(ty)}\` cannot be used with this register class`;
      err = this.fcx.dcx().struct_span_err(expr.span, msg);
      const supported_tys_: string[] = supported_tys.map(([t, _]) => InlineAsmType.display(t));
      err.note(`register class \`${Symbol.as_str(InlineAsmRegClass.name(reg_class))}\` supports these types: ${supported_tys_.join(", ")}`);
    }
    const suggest = InlineAsmRegClass.suggest_class(reg_class, asm_arch, asm_ty);
    if (suggest !== undefined) {
      err.help(`consider using the \`${Symbol.as_str(InlineAsmRegClass.name(suggest))}\` register class instead`);
    }
    err.emit();
    return asm_ty;
  }
  const [, feature] = supported;

  // Check whether the selected type requires a target feature. Note that
  // this is different from the feature check we did earlier. While the
  // previous check checked that this register class is usable at all
  // with the currently enabled features, some types may only be usable
  // with a register class when a certain feature is enabled. We check
  // this here since it depends on the results of typeck.
  //
  // Also note that this check isn't run when the operand type is never
  // (!). In that case we still need the earlier check to verify that the
  // register class is usable at all.
  if (feature !== undefined) {
    if (!this.target_features.has(feature)) {
      const msg = `\`${Symbol.as_str(feature)}\` target feature is not enabled`;
      this.fcx
        .dcx()
        .struct_span_err(expr.span, msg)
        .with_note(
          `this is required to use type \`${display_Ty(ty)}\` with register class \`${Symbol.as_str(InlineAsmRegClass.name(reg_class))}\``,
        )
        .emit();
      return asm_ty;
    }
  }

  // Check whether a modifier is suggested for using this type.
  const suggested: ModifierInfo | undefined = InlineAsmRegClass.suggest_modifier(reg_class, asm_arch, asm_ty);
  if (suggested !== undefined) {
    const { modifier: suggested_modifier, result: suggested_result, size: suggested_size } = suggested;
    // Search for any use of this operand without a modifier and emit
    // the suggestion for them.
    const spans: Span[] = [];
    for (const piece of template) {
      if (piece.$ === "Placeholder") {
        const { operand_idx, modifier, span } = piece;
        if (operand_idx === idx && modifier === undefined) {
          spans.push(span);
        }
      }
    }
    if (spans.length !== 0) {
      const {
        modifier: default_modifier,
        result: default_result,
        size: default_size,
      } = unwrap(InlineAsmRegClass.default_modifier(reg_class, asm_arch));
      this.tcx().emit_node_span_lint(
        ASM_SUB_REGISTER,
        expr.hir_id,
        spans,
        FormattingSubRegisterArg_diagnostic({
          expr_span: expr.span,
          idx,
          suggested_modifier,
          suggested_result,
          suggested_size,
          default_modifier,
          default_result,
          default_size,
        }),
      );
    }
  }

  return asm_ty;
};

// rustc: compiler/rustc_hir_typeck/src/inline_asm.rs:459 check_asm
InlineAsmCtxt.prototype.check_asm = function (this: InlineAsmCtxt, asm: hir.InlineAsm): void {
  const asm_arch = this.tcx().sess.asm_arch;
  if (asm_arch === undefined) {
    this.fcx.dcx().delayed_bug("target architecture does not support asm");
    return;
  }
  const allow_experimental_reg = this.tcx().features().asm_experimental_reg();
  for (let idx = 0; idx < asm.operands.length; idx++) {
    const [op, op_sp] = asm.operands[idx]!;
    // Validate register classes against currently enabled target
    // features. We check that at least one type is available for
    // the enabled features.
    //
    // We ignore target feature requirements for clobbers: if the
    // feature is disabled then the compiler doesn't care what we
    // do with the registers.
    //
    // Note that this is only possible for explicit register
    // operands, which cannot be used in the asm string.
    const reg = hir.InlineAsmOperand.reg(op);
    if (reg !== undefined) {
      // Some explicit registers cannot be used depending on the
      // target. Reject those here.
      if (reg.$ === "Reg") {
        const { reg: reg_, source_name } = reg;
        if (reg_.$ === "Err") {
          // `validate` will panic on `Err`, as an error must
          // already have been reported.
          continue;
        }
        const r = InlineAsmReg.validate(
          reg_,
          asm_arch,
          this.tcx().sess.relocation_model(),
          this.target_features,
          this.tcx().sess.target,
          hir.InlineAsmOperand.is_clobber(op),
        );
        if (r.$ === "Err") {
          const msg_ = r._0;
          const reg_name = source_name !== undefined ? Symbol.as_str(source_name) : InlineAsmReg.name(reg_);
          const msg = `cannot use register \`${reg_name}\`: ${msg_}`;
          this.fcx.dcx().span_err(op_sp, msg);
          continue;
        }
      }

      if (!hir.InlineAsmOperand.is_clobber(op)) {
        let missing_required_features: Symbol[] = [];
        const reg_class = hir.InlineAsmRegOrRegClass.reg_class(reg);
        if (reg_class.$ === "Err") {
          continue;
        }
        for (const [, feature] of InlineAsmRegClass.supported_types(reg_class, asm_arch, allow_experimental_reg)) {
          if (feature !== undefined) {
            if (this.target_features.has(feature)) {
              missing_required_features = [];
              break;
            } else {
              missing_required_features.push(feature);
            }
          } else {
            missing_required_features = [];
            break;
          }
        }

        // We are sorting primitive strs here and can use unstable sort here
        // PORT: `Symbol`'s derived `Ord` is its index; `dedup` removes consecutive duplicates.
        missing_required_features.sort((a, b) => a - b);
        missing_required_features = missing_required_features.filter((f, i, v) => i === 0 || v[i - 1] !== f);
        if (missing_required_features.length === 0) {
          // nothing
        } else if (missing_required_features.length === 1) {
          const feature = missing_required_features[0]!;
          const msg = `register class \`${Symbol.as_str(InlineAsmRegClass.name(reg_class))}\` requires the \`${Symbol.as_str(feature)}\` target feature`;
          this.fcx.dcx().span_err(op_sp, msg);
          // register isn't enabled, don't do more checks
          continue;
        } else {
          const features = missing_required_features;
          const msg = `register class \`${Symbol.as_str(InlineAsmRegClass.name(reg_class))}\` requires at least one of the following target features: ${features
            .map((f) => Symbol.as_str(f))
            .join(", ")}`;
          this.fcx.dcx().span_err(op_sp, msg);
          // register isn't enabled, don't do more checks
          continue;
        }
      }
    }

    switch (op.$) {
      case "In": {
        const { reg, expr } = op;
        this.check_asm_operand_type(idx, reg, expr, asm.template, true, undefined);
        break;
      }
      case "Out": {
        const { reg, expr } = op;
        if (expr !== undefined) {
          this.check_asm_operand_type(idx, reg, expr, asm.template, false, undefined);
        }
        break;
      }
      case "InOut": {
        const { reg, expr } = op;
        this.check_asm_operand_type(idx, reg, expr, asm.template, false, undefined);
        break;
      }
      case "SplitInOut": {
        const { reg, in_expr, out_expr } = op;
        const in_ty = this.check_asm_operand_type(idx, reg, in_expr, asm.template, true, undefined);
        if (out_expr !== undefined) {
          this.check_asm_operand_type(idx, reg, out_expr, asm.template, false, [in_expr, in_ty]);
        }
        break;
      }
      case "Const": {
        const anon_const = op.anon_const;
        const ty = this.expr_ty(this.tcx().hir_body(anon_const.body).value);
        const k = ty.kind();
        if (k.$ === "Error") {
          // nothing
        } else if (ty.is_integral()) {
          // nothing
        } else if (k.$ === "FnPtr") {
          if (!this.tcx().features().asm_const_ptr()) {
            this.tcx().sess.create_feature_err(AsmConstPtrUnstable_diagnostic({ span: op_sp }), sym.asm_const_ptr).emit();
          }
        } else if ((k.$ === "RawPtr" && this.is_thin_ptr_ty(k._0)) || (k.$ === "Ref" && this.is_thin_ptr_ty(k._1))) {
          if (!this.tcx().features().asm_const_ptr()) {
            this.tcx().sess.create_feature_err(AsmConstPtrUnstable_diagnostic({ span: op_sp }), sym.asm_const_ptr).emit();
          }
        } else {
          const const_possible_ty = !this.tcx().features().asm_const_ptr() ? "integer" : "integer or thin pointer";
          this.fcx
            .dcx()
            .struct_span_err(op_sp, "invalid type for `const` operand")
            .with_span_label(this.tcx().def_span(anon_const.def_id), `is ${Article_TyKind.article(ty.kind())} \`${display_Ty(ty)}\``)
            .with_help(`\`const\` operands must be of an ${const_possible_ty} type`)
            .emit();
        }
        break;
      }
      // Typeck has checked that SymFn refers to a function.
      case "SymFn": {
        const expr = op.expr;
        const ty = this.expr_ty(expr);
        const k = ty.kind();
        if (k.$ === "FnDef") {
          // nothing
        } else if (k.$ === "Error") {
          // nothing
        } else {
          this.fcx
            .dcx()
            .struct_span_err(op_sp, "invalid `sym` operand")
            .with_span_label(expr.span, `is ${Article_TyKind.article(ty.kind())} \`${display_Ty(ty)}\``)
            .with_help("`sym` operands must refer to either a function or a static")
            .emit();
        }
        break;
      }
      // AST lowering guarantees that SymStatic points to a static.
      case "SymStatic":
        break;
      // No special checking is needed for labels.
      case "Label":
        break;
    }
  }
};


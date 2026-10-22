// Port of compiler/rustc_mir_build/src/builder/expr/as_constant.rs (declared by lane builder-contract, filled by lane
// mb-expr-a, plan-m4 wave 22; builder/mod.ts's header has the representation notes).
//! See docs in builder/expr/mod.rs
import { Size } from "../../../rustc_abi/lib.ts";
import { debug_LitKind } from "../../../rustc_ast/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { debug_DefKind, type DefKind } from "../../../rustc_hir/def.ts";
import { type AllocId, CTFE_ALLOC_SALT, Pointer_from_AllocId, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Const, ConstOperand, type ConstValue, UnevaluatedConst } from "../../../rustc_middle/mir/mod.ts";
import { debug_ExprKind, type Expr } from "../../../rustc_middle/thir.ts";
import { type LitToConstInput } from "../../../rustc_middle/ty/consts/lit.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type Ty, Ty as TyC } from "../../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type CanonicalUserType, type UserTypeAnnotationIndex } from "../../../rustc_middle/ty/typeck_results.ts";
import { type DefId } from "../../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { ByteSymbol, Symbol } from "../../../rustc_span/symbol.ts";
import { AliasConst } from "../../../rustc_type_ir/const_kind.ts";
import { type AliasConstKind } from "../../../rustc_type_ir/const_kind.gen.ts";
import { Const as ty_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { IsRigid } from "../../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { unwrap } from "../../../std/panic.ts";
import { Builder, parse_float_into_constval } from "../mod.ts";

declare module "../mod.ts" {
  interface Builder {
    as_constant(expr: Expr): ConstOperand;
  }
}

/// Compile `expr`, yielding a compile-time constant. Assumes that
/// `expr` is a valid compile-time constant!
// rustc: compiler/rustc_mir_build/src/builder/expr/as_constant.rs:23 as_constant
Builder.prototype.as_constant = function (this: Builder, expr: Expr): ConstOperand {
  const tcx = this.tcx;
  const { ty, span, kind } = expr;
  if (kind.$ === "Scope") {
    const { value } = kind;
    return this.as_constant(this.thir.index_ExprId(value));
  } else {
    return as_constant_inner(
      expr,
      (user_ty) => {
        // PORT: `IndexVec::push` returns the new index.
        const idx = this.canonical_user_type_annotations.length as UserTypeAnnotationIndex;
        this.canonical_user_type_annotations.push({
          span,
          user_ty: user_ty,
          inferred_ty: ty,
        });
        return idx;
      },
      tcx,
    );
  }
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_constant.rs:46 as_constant_inner
export function as_constant_inner(expr: Expr, push_cuta: (a0: CanonicalUserType) => UserTypeAnnotationIndex | undefined, tcx: TyCtxt): ConstOperand {
  const { ty, span, kind } = expr;

  switch (kind.$) {
    case "Literal": {
      const { lit, neg } = kind;
      const const_ = lit_to_mir_constant(tcx, { lit: lit.node, ty, neg });

      return new ConstOperand(span, undefined, const_);
    }
    case "NonHirLiteral": {
      const { lit } = kind;
      const user_ty = kind.user_ty === undefined ? undefined : push_cuta(kind.user_ty);

      const const_: Const = { $: "Val", _0: { $: "Scalar", _0: { $: "Int", _0: lit } }, _1: ty };

      return new ConstOperand(span, user_ty, const_);
    }
    case "ZstLiteral": {
      const user_ty = kind.user_ty === undefined ? undefined : push_cuta(kind.user_ty);

      const const_: Const = { $: "Val", _0: { $: "ZeroSized" }, _1: ty };

      return new ConstOperand(span, user_ty, const_);
    }
    case "NamedConst": {
      const { def_id, args } = kind;
      const user_ty = kind.user_ty === undefined ? undefined : push_cuta(kind.user_ty);

      const get_kind = (def_id: DefId, def_kind: DefKind): AliasConstKind => {
        switch (def_kind.$) {
          case "AssocConst": {
            const pk = tcx.def_kind(tcx.parent(def_id));
            if (pk.$ === "Impl" && pk.of_trait === false) {
              return { $: "InherentImpl", def_id };
            } else {
              return { $: "Projection", def_id };
            }
          }
          case "Const":
            return { $: "Free", def_id };
          default:
            return bug(`unexpected DefKind in THIR ExprKind::NamedConst: ${debug_DefKind(def_kind, PLAIN)}`);
        }
      };

      const could_be_direct_const = (def_id: DefId): AliasConstKind | undefined => {
        const def_kind = tcx.def_kind(def_id);
        if (!(def_kind.$ === "Const" || def_kind.$ === "AssocConst")) {
          return undefined;
        }
        if (tcx.is_direct_const(def_id)) {
          return get_kind(def_id, def_kind);
        }
        // Under gca_const_items, `def_id` might be a regular const declared in a trait,
        // but is `impl`d as a directly represented const. We do not know whether it is
        // here, so we must use type system normalization for all const projections.
        // FIXME(gca_const_items): there's a lot to consider here! `Const::Ty` uses
        // valtrees and `Const::Unevaluated` does not, we should revisit this before
        // stabilization.
        let kind: AliasConstKind;
        if (tcx.features().gca_const_items() && (kind = get_kind(def_id, def_kind)).$ === "Projection") {
          return kind;
        }
        return undefined;
      };

      const kind_ = could_be_direct_const(def_id);
      if (kind_ !== undefined) {
        const alias = AliasConst.new(tcx, kind_, args);
        const ct = ty_Const.new_alias(tcx, IsRigid.No, alias);
        const const_: Const = { $: "Ty", _0: ty, _1: ct };
        return new ConstOperand(span, user_ty, const_);
      }

      const uneval = UnevaluatedConst.new(def_id, args);
      const const_: Const = { $: "Unevaluated", _0: uneval, _1: ty };
      return new ConstOperand(span, user_ty, const_);
    }
    case "ConstParam": {
      const { param } = kind;
      const const_param = ty_Const.new_param(tcx, param);
      const const_: Const = { $: "Ty", _0: expr.ty, _1: const_param };

      return new ConstOperand(span, undefined, const_);
    }
    case "ConstBlock": {
      const { did: def_id, args } = kind;
      const uneval = UnevaluatedConst.new(def_id, args);
      const const_: Const = { $: "Unevaluated", _0: uneval, _1: ty };

      return new ConstOperand(span, undefined, const_);
    }
    case "StaticRef": {
      // PORT: thir.gen.ts types `alloc_id` as `unknown` (the THIR set maps `mir::interpret::AllocId` to `unknown`,
      // mir-contract "Stand-ins"); it holds the `AllocId` that thir/cx/expr.ts reserved.
      const alloc_id = kind.alloc_id as AllocId;
      const ty = kind.ty;
      const const_val: ConstValue = { $: "Scalar", _0: Scalar.from_pointer(Pointer_from_AllocId(alloc_id), tcx) };
      const const_: Const = { $: "Val", _0: const_val, _1: ty };

      return new ConstOperand(span, undefined, const_);
    }
    default:
      return span_bug(span, `expression is not a valid constant ${debug_ExprKind(kind, PLAIN)}`);
  }
}

// #[instrument(skip(tcx, lit_input))]
// rustc: compiler/rustc_mir_build/src/builder/expr/as_constant.rs:145 lit_to_mir_constant
export function lit_to_mir_constant(tcx: TyCtxt, lit_input: LitToConstInput): Const {
  const { lit, ty: ty0, neg } = lit_input;

  const ty = unwrap(ty0, "type of literal must be known at this point");

  const er = TypeVisitableExt.error_reported(ty, fold_Ty);
  if (er.$ === "Err") {
    const guar = er._0;
    return { $: "Ty", _0: TyC.new_error(tcx, guar), _1: ty_Const.new_error(tcx, guar) };
  }

  const tk = ty.kind();
  const lit_ty = tk.$ === "Pat" ? tk._0 : ty;

  const trunc = (n: bigint): ConstValue => {
    const width = lit_ty.primitive_size(tcx);
    // trace!("trunc {} with size {} and shift {}", n, width.bits(), 128 - width.bits());
    const result = width.truncate(n);
    // trace!("trunc result: {}", result);
    return { $: "Scalar", _0: Scalar.from_uint(result, width) };
  };

  const k = lit_ty.kind();
  let value: ConstValue;
  if (lit.$ === "Str" && k.$ === "Ref" && k._1.is_str()) {
    const s = new TextEncoder().encode(Symbol.as_str(lit._0));
    const len = s.length;
    const allocation = tcx.allocate_bytes_dedup(s, CTFE_ALLOC_SALT);
    value = { $: "Slice", alloc_id: allocation, meta: len };
  } else if (lit.$ === "ByteStr" && k.$ === "Ref" && k._1.kind().$ === "Slice") {
    const data = ByteSymbol.as_byte_str(lit._0);
    const len = data.length;
    const allocation = tcx.allocate_bytes_dedup(data, CTFE_ALLOC_SALT);
    value = { $: "Slice", alloc_id: allocation, meta: len };
  } else if (lit.$ === "ByteStr" && k.$ === "Ref" && k._1.is_array()) {
    const id = tcx.allocate_bytes_dedup(ByteSymbol.as_byte_str(lit._0), CTFE_ALLOC_SALT);
    value = { $: "Scalar", _0: Scalar.from_pointer(Pointer_from_AllocId(id), tcx) };
  } else if (lit.$ === "CStr" && k.$ === "Ref" && is_cstr_adt(tcx, k._1)) {
    const data = ByteSymbol.as_byte_str(lit._0);
    const len = data.length;
    const allocation = tcx.allocate_bytes_dedup(data, CTFE_ALLOC_SALT);
    value = { $: "Slice", alloc_id: allocation, meta: len };
  } else if (lit.$ === "Byte" && k.$ === "Uint" && k._0 === "U8") {
    value = { $: "Scalar", _0: Scalar.from_uint(BigInt(lit._0), Size.from_bytes(1)) };
  } else if (lit.$ === "Int" && k.$ === "Uint" && !neg) {
    value = trunc(lit._0);
  } else if (lit.$ === "Int" && k.$ === "Int") {
    const n = lit._0;
    // Unsigned "negation" has the same bitwise effect as signed negation,
    // which gets the result we want without additional casts.
    value = trunc(neg ? BigInt.asUintN(128, -n) : n);
  } else if (lit.$ === "Float" && k.$ === "Float") {
    value = unwrap(parse_float_into_constval(lit._0, k._0, neg));
  } else if (lit.$ === "Bool" && k.$ === "Bool") {
    value = { $: "Scalar", _0: Scalar.from_bool(lit._0) };
  } else if (lit.$ === "Char" && k.$ === "Char") {
    value = { $: "Scalar", _0: Scalar.from_char(lit._0) };
  } else if (lit.$ === "Err") {
    const guar = lit._0;
    return { $: "Ty", _0: TyC.new_error(tcx, guar), _1: ty_Const.new_error(tcx, guar) };
  } else {
    return bug(`invalid lit/ty combination in \`lit_to_mir_constant\`: ${debug_LitKind(lit, PLAIN)}: ${debug_Ty(ty, PLAIN)}`);
  }

  return { $: "Val", _0: value, _1: ty };
}

/** The guard of the `CStr` arm: `matches!(inner_ty.kind(), ty::Adt(def, _) if tcx.is_lang_item(def.did(), LangItem::CStr))`. */
function is_cstr_adt(tcx: TyCtxt, inner_ty: Ty): boolean {
  const k = inner_ty.kind();
  return k.$ === "Adt" && tcx.is_lang_item(k._0.did(), LangItem.CStr);
}

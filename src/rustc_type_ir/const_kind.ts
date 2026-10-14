// Port of compiler/rustc_type_ir/src/const_kind.rs (lane tyir-kind). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into const_kind.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir);
// this file holds the inherent methods and the manual impls, in upstream order.
// PORT (D3): `I: Interner` is erased (see ty_kind.ts). Methods of the generated enums live on their companion const
// (`ValTreeKind.to_leaf(v)`); the impl on `AliasConst` (= `Alias<AliasConstKind>`) is the companion `AliasConst`.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (no `{:#?}`), so those operands use `PLAIN`.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Consts, ScalarInt } from "../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { debug_BoundConst, debug_Placeholder, EarlyBinder } from "./binder.ts";
import { standin_fold_Ty } from "./fold.ts";
import * as gen from "./const_kind.gen.ts";
import { debug_AliasConstKind, debug_ConstVid, debug_ValTreeKind, type InferConst } from "./const_kind.gen.ts";
import type { Interner } from "./interner.ts";
import { type AliasConst as AliasConstT, debug_Alias } from "./ty/alias.ts";
import { debug_bound_var, debug_IsRigid } from "./ty_kind.ts";
import type { Unnormalized } from "./unnormalized.ts";

export * from "./const_kind.gen.ts";

// rustc: compiler/rustc_type_ir/src/const_kind.rs:54 fmt
export const debug_ConstKind: Debug<gen.ConstKind> = (self, _f) => {
  switch (self.$) {
    case "Param":
      // write!(f, "{param:?}")
      // PORT: `impl Debug for ty::ParamConst` (rustc_middle ty/structural_impls.rs) is not ported yet.
      return unported("rustc_type_ir::const_kind::ConstKind Debug (Param: Debug for rustc_middle::ty::ParamConst)");
    case "Infer":
      return debug_InferConst(self._0, PLAIN);
    case "Bound":
      return debug_bound_var(self._0, self._1, debug_BoundConst);
    case "Placeholder":
      return debug_Placeholder(self._0, PLAIN, debug_BoundConst);
    case "Alias": {
      return `AliasConst(${debug_IsRigid(self._0, PLAIN)}, ${debug_Alias(self._1, PLAIN, debug_AliasConstKind)})`;
    }
    case "Value":
      // write!(f, "{val:?}")
      // PORT: `impl Debug for ty::Value` (rustc_middle ty/consts/valtree.rs, lane ty-results) is not ported yet.
      return unported("rustc_type_ir::const_kind::ConstKind Debug (Value: Debug for rustc_middle::ty::Value)");
    case "Error":
      return "{const error}";
    case "Expr":
      // write!(f, "{expr:?}")
      // PORT: `impl Debug for ty::Expr` (rustc_middle ty/print/pretty.rs) is not ported yet.
      return unported("rustc_type_ir::const_kind::ConstKind Debug (Expr: Debug for rustc_middle::ty::Expr)");
  }
};

export const AliasConst = {
  // rustc: compiler/rustc_type_ir/src/const_kind.rs:74 new
  new(_interner: TyCtxt, kind: gen.AliasConstKind, args: GenericArgs): AliasConstT {
    // PORT: `if cfg!(debug_assertions) { interner.debug_assert_alias_term_args_compatible(kind.into(), args); }`:
    // the oracle is a release build without debug assertions.
    return { kind, args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/const_kind.rs:81 type_of
  type_of(self: AliasConstT, interner: TyCtxt): Unnormalized<Ty> {
    let def_id: DefId;
    switch (self.kind.$) {
      case "Projection":
        def_id = self.kind.def_id;
        break;
      case "InherentSelf": {
        return panic("AliasConst::type_of got InherentSelf - args should always be InherentImpl at this point");
      }
      case "InherentImpl":
        def_id = self.kind.def_id;
        break;
      case "Free":
        def_id = self.kind.def_id;
        break;
      case "Anon":
        def_id = self.kind.def_id;
        break;
    }
    // PORT: queries.gen.ts types the `type_of` query's value `unknown` until its type is generated; it is
    // `EarlyBinder<Ty>` (`Interner::type_of`).
    return EarlyBinder.instantiate(interner.type_of(def_id) as EarlyBinder<Ty>, interner, self.args, standin_fold_Ty);
  },
};

export type AliasConstKind = gen.AliasConstKind;
export const AliasConstKind = {
  // rustc: compiler/rustc_type_ir/src/const_kind.rs:150 is_direct_const
  is_direct_const(self: AliasConstKind, interner: Interner): boolean {
    return interner.ir_is_direct_const(self);
  },

  // rustc: compiler/rustc_type_ir/src/const_kind.rs:154 def_span
  def_span(self: AliasConstKind, interner: Interner): Span {
    switch (self.$) {
      case "Projection":
        return interner.def_span(self.def_id);
      case "InherentSelf":
        return interner.def_span(self.def_id);
      case "InherentImpl":
        return interner.def_span(self.def_id);
      case "Free":
        return interner.def_span(self.def_id);
      case "Anon":
        return interner.def_span(self.def_id);
    }
  },
};

// rustc: compiler/rustc_type_ir/src/const_kind.rs:185 fmt
export const debug_InferConst: Debug<InferConst> = (self, _f) => {
  switch (self.$) {
    case "Var":
      return debug_ConstVid(self._0, PLAIN);
    case "Fresh":
      return `Fresh(${self._0})`;
  }
};

// rustc-skip: compiler/rustc_type_ir/src/const_kind.rs:195 stable_hash StableHash impl (incremental, M5)

export type ValTreeKind = gen.ValTreeKind;
export const ValTreeKind = {
  // rustc: compiler/rustc_type_ir/src/const_kind.rs:243 to_leaf
  to_leaf(self: ValTreeKind): ScalarInt {
    switch (self.$) {
      case "Leaf":
        return self._0;
      case "Branch":
        return panic(`expected leaf, got ${debug_ValTreeKind(self, PLAIN)}`);
    }
  },

  // rustc: compiler/rustc_type_ir/src/const_kind.rs:253 to_branch
  to_branch(self: ValTreeKind): Consts {
    switch (self.$) {
      case "Branch":
        return self._0;
      case "Leaf":
        return panic(`expected branch, got ${debug_ValTreeKind(self, PLAIN)}`);
    }
  },

  // rustc: compiler/rustc_type_ir/src/const_kind.rs:261 try_to_leaf
  try_to_leaf(self: ValTreeKind): ScalarInt | undefined {
    switch (self.$) {
      case "Leaf":
        return self._0;
      case "Branch":
        return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/const_kind.rs:269 try_to_branch
  try_to_branch(self: ValTreeKind): Consts | undefined {
    switch (self.$) {
      case "Branch":
        return self._0;
      case "Leaf":
        return undefined;
    }
  },
};

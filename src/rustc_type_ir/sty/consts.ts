// Port of compiler/rustc_type_ir/src/sty/consts.rs (contract by lane ty-contract, docs/plan-m3.md D2/D3; filled by lane
// tyir-misc, sub-lane lib-sty).
//
// Defines the hash-consed `Const` class (`pub struct Const<I: Interner>(pub I::InternedConstKind)`).
// PORT (D2, D3):
// - `I` is erased to rustc_middle's `TyCtxt`; `I::InternedConstKind` is
//   `Interned<'tcx, WithCachedTypeInfo<ConstKind<'tcx>>>`, so the `Const` object *is* the interned
//   `WithCachedTypeInfo` box (fields `internee`, `flags`, `outer_exclusive_binder`): one frozen instance per
//   distinct `ConstKind`, made only by `CtxtInterners::intern_const` (rustc_middle ty/context.ts). Equality is
//   `===`; a `Const` is its own `Map`/`Set` key.
// - Field renames (res-lib rule): `WithCachedTypeInfo`'s `flags` / `outer_exclusive_binder` are the fields
//   `flags_` / `outer_exclusive_binder_`, because `impl Flags for Const` (consts.rs:150) needs the method names.
// - Methods: declared in ../decls.ts (this file's) and rustc_middle ty/decls.ts (ty/consts.rs's), filled on
//   `Const.prototype` / `Const` below, in upstream order (docs/handoff/ty-contract.md "How to fill a stub").
// - Trait impls that are not methods: `Debug` (consts.rs:24) is `debug_Const`; `TypeFoldable` /
//   `TypeVisitable` / `TypeSuperFoldable` / `TypeSuperVisitable` (:168-:223) are the D4 descriptor
//   `fold_Const`; `Relate` (:239) is `relate_Const`.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (`PLAIN`), tyir-kind decision 5.
import { Interned } from "../../rustc_data_structures/intern.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_with_Expr, try_fold_with_Expr, visit_with_Expr } from "../../rustc_middle/ty/consts/kind.ts";
import { display_Value as display_ValueC, fold_with_Value, try_fold_with_Value, visit_with_Value } from "../../rustc_middle/ty/consts/valtree.ts";
import type { Expr, ParamConst, Value } from "../../rustc_middle/ty/decls.ts";
import { visit_with_ErrorGuaranteed } from "../../rustc_middle/ty/structural_impls.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { fold_with_AliasConstKind, try_fold_with_AliasConstKind, visit_with_AliasConstKind } from "../const_kind.gen.ts";
import type { AliasConst, BoundConst, BoundVar, ConstKind, ConstVid, DebruijnIndex, InferConst, IsRigid, PlaceholderConst, TypeFlags } from "../decls.ts";
import type { FallibleTypeFolder, TypeFolder, TypeSuperFoldable } from "../fold.ts";
import type { RelateResult, TypeRelation } from "../relate.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../ty/alias.ts";
import type { TypeSuperVisitable, TypeVisitor } from "../visit.ts";

// The other types of sty/consts.rs with their derived impls are generated into consts.gen.ts (set rustc_ty of
// tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./consts.gen.ts";

// PORT (init order): this is a defining module (rustc_middle ty/mod.ts imports it, ty-contract "Init order"), and
// const_kind.ts reaches the extension module rustc_middle ty/sty.ts (through ty_kind.ts), so a static import throws a
// TDZ `ReferenceError` (`Ty`) when rustc_middle/lib.ts loads. `debug_ConstKind` is required lazily, at call time.
function const_kind(): typeof import("../const_kind.ts") {
  return require("../const_kind.ts") as typeof import("../const_kind.ts");
}

// ---- PORT stand-ins for fns of other lanes' files that are not ported yet (convention 6) -------------------------

/** `impl Display for ty::Value` (rustc_middle ty/consts/valtree.rs:241, lane ty-results). */
function display_Value(v: Value): string {
  return display_ValueC(v);
}
// PORT (init order, merge-w15a): binder.ts reaches rustc_middle ty/sty.ts (see `const_kind()` above), so it is
// required lazily.
function binder(): typeof import("../binder.ts") {
  return require("../binder.ts") as typeof import("../binder.ts");
}

// rustc-type: compiler/rustc_type_ir/src/sty/consts.rs:22 Const
export class Const extends Interned {
  /** `WithCachedTypeInfo::internee` */
  readonly internee: ConstKind;
  /** `WithCachedTypeInfo::flags` (renamed: module comment) */
  readonly flags_: TypeFlags;
  /** `WithCachedTypeInfo::outer_exclusive_binder` (renamed: module comment) */
  readonly outer_exclusive_binder_: DebruijnIndex;

  /** PORT: only `CtxtInterners::intern_const` constructs (D2); the kind object is frozen with it. */
  constructor(internee: ConstKind, flags: TypeFlags, outer_exclusive_binder: DebruijnIndex) {
    super();
    this.internee = Object.freeze(internee);
    this.flags_ = flags;
    this.outer_exclusive_binder_ = outer_exclusive_binder;
    Object.freeze(this);
  }

  // PORT: also `impl IntoKind for Const` (consts.rs:163, `*self.0.get()`): one method.
  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:38 kind
  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:163 kind
  kind(): ConstKind {
    return this.internee;
  }

  /** PORT: a class static because `new` cannot be declared in a namespace (ty-contract). */
  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:43 new
  static new(interner: TyCtxt, kind: ConstKind): Const {
    return interner.mk_ct_from_kind(kind);
  }

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:151 flags
  flags(): TypeFlags {
    return this.flags_;
  }

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:155 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    return this.outer_exclusive_binder_;
  }
}

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:25 fmt
export function debug_Const(self: Const, _f: Fmt): string {
  // If this is a value, we spend some effort to make it look nice.
  const k = self.kind();
  if (k.$ === "Value") {
    const cv = k._0;
    return display_Value(cv);
  } else {
    // Fall back to something verbose.
    return const_kind().debug_ConstKind(self.kind(), PLAIN);
  }
}

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:48 new_var
Const.new_var = function (interner: TyCtxt, infer: ConstVid): Const {
  return Const.new(interner, { $: "Infer", _0: { $: "Var", _0: infer } });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:53 new_infer
Const.new_infer = function (interner: TyCtxt, infer: InferConst): Const {
  return Const.new(interner, { $: "Infer", _0: infer });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:58 new_bound
Const.new_bound = function (interner: TyCtxt, debruijn: DebruijnIndex, bound_const: BoundConst): Const {
  return Const.new(interner, { $: "Bound", _0: { $: "Bound", _0: debruijn }, _1: bound_const });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:63 new_anon_bound
Const.new_anon_bound = function (interner: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): Const {
  return Const.new_bound(interner, debruijn, binder().BoundConst.new(var_));
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:68 new_canonical_bound
Const.new_canonical_bound = function (interner: TyCtxt, var_: BoundVar): Const {
  return Const.new(interner, { $: "Bound", _0: { $: "Canonical" }, _1: binder().BoundConst.new(var_) });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:73 new_placeholder
Const.new_placeholder = function (interner: TyCtxt, placeholder: PlaceholderConst): Const {
  return Const.new(interner, { $: "Placeholder", _0: placeholder });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:78 new_alias
Const.new_alias = function (interner: TyCtxt, is_rigid: IsRigid, alias_const: AliasConst): Const {
  return Const.new(interner, { $: "Alias", _0: is_rigid, _1: alias_const });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:83 new_expr
Const.new_expr = function (interner: TyCtxt, expr: Expr): Const {
  return Const.new(interner, { $: "Expr", _0: expr });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:88 new_error
Const.new_error = function (interner: TyCtxt, e: ErrorGuaranteed): Const {
  return Const.new(interner, { $: "Error", _0: e });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:93 is_ct_var
Const.prototype.is_ct_var = function (this: Const): boolean {
  const k = this.kind();
  return k.$ === "Infer" && k._0.$ === "Var";
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:98 is_ct_error
Const.prototype.is_ct_error = function (this: Const): boolean {
  return this.kind().$ === "Error";
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:103 new_param
Const.new_param = function (interner: TyCtxt, param: ParamConst): Const {
  return Const.new(interner, { $: "Param", _0: param });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:108 new_fresh
Const.new_fresh = function (interner: TyCtxt, fresh: number): Const {
  return Const.new(interner, { $: "Infer", _0: { $: "Fresh", _0: fresh } });
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:113 new_misc_error
Const.new_misc_error = function (interner: TyCtxt): Const {
  // PORT: `I::Span::dummy()` is `DUMMY_SP` (`impl inherent::Span for Span`, rustc_middle ty/context.rs:131).
  return Const.new_error_with_message(interner, DUMMY_SP, "ty::ConstKind::Error constructed but no error reported");
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:122 new_error_with_message
Const.new_error_with_message = function (interner: TyCtxt, span: Span, msg: string): Const {
  const reported = interner.span_delayed_bug(span, msg);
  return Const.new_error(interner, reported);
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:127 is_trivially_wf
Const.prototype.is_trivially_wf = function (this: Const): boolean {
  switch (this.kind().$) {
    case "Param":
    case "Placeholder":
    case "Bound":
      return true;
    case "Infer":
    case "Alias":
    case "Value":
    case "Error":
    case "Expr":
      return false;
  }
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:138 is_ct_infer
Const.prototype.is_ct_infer = function (this: Const): boolean {
  return this.kind().$ === "Infer";
};

// rustc: compiler/rustc_type_ir/src/sty/consts.rs:142 ct_vid
Const.prototype.ct_vid = function (this: Const): ConstVid | undefined {
  const k = this.kind();
  if (k.$ === "Infer" && k._0.$ === "Var") {
    const vid = k._0._0;
    return vid;
  }
  return undefined;
};

// PORT: `kind != self.kind()` is the derived `PartialEq` of `ConstKind`: equal intern keys (rust_ts/intern_key.ts, the
// derived `Hash` + `Eq` as a string; interned children compare by identity).
function ConstKind_ne(a: ConstKind, b: ConstKind): boolean {
  return intern_key(a) !== intern_key(b);
}

/** D4 descriptor: the `TypeFoldable`/`TypeVisitable`/`TypeSuper*` impls of `Const` (consts.rs:168-:223). */
export const fold_Const: TypeSuperFoldable<Const> & TypeSuperVisitable<Const> = {
  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:169 try_fold_with
  try_fold_with<E>(self: Const, folder: FallibleTypeFolder<E>): Result<Const, E> {
    return folder.try_fold_const(self);
  },

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:173 fold_with
  fold_with(self: Const, folder: TypeFolder): Const {
    return folder.fold_const(self);
  },

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:179 visit_with
  visit_with<R>(self: Const, visitor: TypeVisitor<R>): R {
    return visitor.visit_const(self);
  },

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:185 try_super_fold_with
  try_super_fold_with<E>(self: Const, folder: FallibleTypeFolder<E>): Result<Const, E> {
    const k = self.kind();
    let kind: ConstKind;
    switch (k.$) {
      case "Alias": {
        const is_rigid = k._0;
        const alias_const = try_fold_with_Alias(k._1, folder, try_fold_with_AliasConstKind);
        if (alias_const.$ === "Err") return alias_const;
        kind = { $: "Alias", _0: is_rigid, _1: alias_const._0 };
        break;
      }
      case "Value": {
        const v = try_fold_with_Value(k._0, folder);
        if (v.$ === "Err") return v;
        kind = { $: "Value", _0: v._0 };
        break;
      }
      case "Expr": {
        const e = try_fold_with_Expr(k._0, folder);
        if (e.$ === "Err") return e;
        kind = { $: "Expr", _0: e._0 };
        break;
      }

      case "Param":
      case "Infer":
      case "Bound":
      case "Placeholder":
      case "Error":
        return Ok(self);
    }
    if (ConstKind_ne(kind, self.kind())) {
      return Ok(Const.new(folder.cx(), kind));
    } else {
      return Ok(self);
    }
  },

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:205 super_fold_with
  super_fold_with(self: Const, folder: TypeFolder): Const {
    const k = self.kind();
    let kind: ConstKind;
    switch (k.$) {
      case "Alias": {
        const is_rigid = k._0;
        kind = { $: "Alias", _0: is_rigid, _1: fold_with_Alias(k._1, folder, fold_with_AliasConstKind) };
        break;
      }
      case "Value":
        kind = { $: "Value", _0: fold_with_Value(k._0, folder) };
        break;
      case "Expr":
        kind = { $: "Expr", _0: fold_with_Expr(k._0, folder) };
        break;

      case "Param":
      case "Infer":
      case "Bound":
      case "Placeholder":
      case "Error":
        return self;
    }
    if (ConstKind_ne(kind, self.kind())) {
      return Const.new(folder.cx(), kind);
    } else {
      return self;
    }
  },

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:224 super_visit_with
  super_visit_with<R>(self: Const, visitor: TypeVisitor<R>): R {
    const k = self.kind();
    switch (k.$) {
      case "Alias":
        return visit_with_Alias(k._1, visitor, visit_with_AliasConstKind);
      case "Value":
        return visit_with_Value(k._0, visitor);
      case "Expr":
        return visit_with_Expr(k._0, visitor);
      case "Error":
        return visit_with_ErrorGuaranteed(k._0, visitor);

      case "Param":
      case "Infer":
      case "Bound":
      case "Placeholder":
        return visitor.Result.output();
    }
  },
};

// PORT (merge-w13): the impl fns of `fold_Const` as tools/codegen's generated code calls them (type_fold.json shape).
export function visit_with_Const<R>(self: Const, visitor: TypeVisitor<R>): R {
  return fold_Const.visit_with(self, visitor);
}
export function try_fold_with_Const<E>(self: Const, folder: FallibleTypeFolder<E>): Result<Const, E> {
  return fold_Const.try_fold_with(self, folder);
}
export function fold_with_Const(self: Const, folder: TypeFolder): Const {
  return fold_Const.fold_with(self, folder);
}

// PORT: `R: TypeRelation<I>` is the relation object (relate.ts's `TypeRelation`); relate.ts wraps this fn in its
// `relate_Const` descriptor.
// rustc: compiler/rustc_type_ir/src/sty/consts.rs:240 relate
export function relate_Const(relation: TypeRelation, a: Const, b: Const): RelateResult<Const> {
  return relation.consts(a, b);
}

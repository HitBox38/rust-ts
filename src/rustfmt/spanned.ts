// Port of src/tools/rustfmt/src/spanned.rs (lane rustfmt-contract-2).
//
// The modules this file uses that later lanes port (`macros.rs`, `items.rs`) are imported as `../rustfmt/<path>` and
// declared in contract_lib.d.ts until they exist.
import { ast } from "../rustc_ast/lib.ts";
import { BytePos, Span, type Spanned as rustc_span_Spanned } from "../rustc_span/lib.ts";

import type { MacroArg } from "../rustfmt/macros.ts";
import { is_named_param, span_lo_for_param } from "../rustfmt/items.ts";
import { mk_sp, outer_attributes } from "./utils.ts";

/// Spanned returns a span including attributes, if available.
// PORT: an impl table over `Self` (as rewrite.ts's `Rewrite<T>`): `x.span()` is `Spanned_X.span(x)`.
export interface Spanned<T> {
  // rustc: src/tools/rustfmt/src/spanned.rs:11 span
  span(self: T): Span;
}

// impl<T: Spanned> Spanned for Box<T>
// PORT: `Box<T>` is `T` (PORTING §5).
export function Spanned_for_Box<T>(inner: Spanned<T>): Spanned<T> {
  return {
    // rustc: src/tools/rustfmt/src/spanned.rs:15 span
    span(self: T): Span {
      return inner.span(self);
    },
  };
}

// impl<T> Spanned for rustc_span::Spanned<T>
export function Spanned_for_rustc_span_Spanned<T>(): Spanned<rustc_span_Spanned<T>> {
  return {
    // rustc: src/tools/rustfmt/src/spanned.rs:21 span
    span(self: rustc_span_Spanned<T>): Span {
      return self.span;
    },
  };
}

/** The fields `span_with_attrs_lo_hi!` and `span_with_attrs!` read. */
interface HasAttrsSpan {
  attrs: readonly ast.Attribute[];
  span: Span;
}

// PORT: `macro_rules! span_with_attrs_lo_hi` as a function.
function span_with_attrs_lo_hi(this_: { attrs: readonly ast.Attribute[] }, lo: BytePos, hi: BytePos): Span {
  const attrs = outer_attributes(this_.attrs);
  if (attrs.length === 0) {
    return mk_sp(lo, hi);
  } else {
    return mk_sp(Span.lo(attrs[0]!.span), hi);
  }
}

// PORT: `macro_rules! span_with_attrs` as a function.
function span_with_attrs(this_: HasAttrsSpan): Span {
  return span_with_attrs_lo_hi(this_, Span.lo(this_.span), Span.hi(this_.span));
}

// PORT: `macro_rules! implement_spanned` as a function returning the impl; each invocation below is one call.
function implement_spanned<T extends HasAttrsSpan>(): Spanned<T> {
  return {
    // rustc: src/tools/rustfmt/src/spanned.rs:46 span
    span(self: T): Span {
      return span_with_attrs(self);
    },
  };
}

// Implement `Spanned` for structs with `attrs` field.
export const Spanned_AssocItem: Spanned<ast.AssocItem> = implement_spanned<ast.AssocItem>();
export const Spanned_Expr: Spanned<ast.Expr> = implement_spanned<ast.Expr>();
export const Spanned_ExprField: Spanned<ast.ExprField> = implement_spanned<ast.ExprField>();
export const Spanned_ForeignItem: Spanned<ast.ForeignItem> = implement_spanned<ast.ForeignItem>();
export const Spanned_Item: Spanned<ast.Item> = implement_spanned<ast.Item>();
export const Spanned_Local: Spanned<ast.Local> = implement_spanned<ast.Local>();
export const Spanned_WherePredicate: Spanned<ast.WherePredicate> = implement_spanned<ast.WherePredicate>();

// impl Spanned for ast::Stmt
export const Spanned_Stmt: Spanned<ast.Stmt> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:63 span
  span(self: ast.Stmt): Span {
    const kind = self.kind;
    switch (kind.$) {
      case "Let":
        return mk_sp(Span.lo(Spanned_Local.span(kind._0)), Span.hi(self.span));
      case "Item":
        return mk_sp(Span.lo(Spanned_Item.span(kind._0)), Span.hi(self.span));
      case "Expr":
      case "Semi":
        return mk_sp(Span.lo(Spanned_Expr.span(kind._0)), Span.hi(self.span));
      case "MacCall": {
        const mac_stmt = kind._0;
        if (mac_stmt.attrs.length === 0) {
          return self.span;
        } else {
          return mk_sp(Span.lo(mac_stmt.attrs[0]!.span), Span.hi(self.span));
        }
      }
      case "Empty":
        return self.span;
    }
  },
};

// impl Spanned for ast::Pat
export const Spanned_Pat: Spanned<ast.Pat> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:83 span
  span(self: ast.Pat): Span {
    return self.span;
  },
};

// impl Spanned for ast::Ty
export const Spanned_Ty: Spanned<ast.Ty> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:89 span
  span(self: ast.Ty): Span {
    return self.span;
  },
};

// impl Spanned for ast::Arm
export const Spanned_Arm: Spanned<ast.Arm> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:95 span
  span(self: ast.Arm): Span {
    const lo = self.attrs.length === 0 ? Span.lo(self.pat.span) : Span.lo(self.attrs[0]!.span);
    const body = self.body;
    const hi = body !== undefined ? Span.hi(body.span) : Span.hi(self.pat.span);
    return span_with_attrs_lo_hi(self, lo, hi);
  },
};

// impl Spanned for ast::Param
export const Spanned_Param: Spanned<ast.Param> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:111 span
  span(self: ast.Param): Span {
    if (is_named_param(self)) {
      return mk_sp(span_lo_for_param(self), Span.hi(self.ty.span));
    } else {
      return self.ty.span;
    }
  },
};

// impl Spanned for ast::GenericParam
export const Spanned_GenericParam: Spanned<ast.GenericParam> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:121 span
  span(self: ast.GenericParam): Span {
    const kind = self.kind;
    let lo: BytePos;
    if (self.attrs.length !== 0) lo = Span.lo(self.attrs[0]!.span);
    else if (kind.$ === "Const") lo = Span.lo(kind.span);
    else lo = Span.lo(self.ident.span);
    const hi = self.bounds.length === 0 ? Span.hi(self.ident.span) : Span.hi(Spanned_GenericBound.span(self.bounds[self.bounds.length - 1]!));
    let ty_hi: BytePos;
    if (kind.$ === "Type" && kind.default !== undefined) {
      ty_hi = Span.hi(Spanned_Ty.span(kind.default));
    } else if (kind.$ === "Const") {
      ty_hi = Span.hi(Spanned_Ty.span(kind.ty));
    } else {
      ty_hi = hi;
    }
    // `std::cmp::max`
    return mk_sp(lo, BytePos.max(hi, ty_hi));
  },
};

// impl Spanned for ast::FieldDef
export const Spanned_FieldDef: Spanned<ast.FieldDef> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:146 span
  span(self: ast.FieldDef): Span {
    // FIXME(default_field_values): This needs to be adjusted.
    return span_with_attrs_lo_hi(self, Span.lo(self.span), Span.hi(self.ty.span));
  },
};

// impl Spanned for ast::FnRetTy
export const Spanned_FnRetTy: Spanned<ast.FnRetTy> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:153 span
  span(self: ast.FnRetTy): Span {
    switch (self.$) {
      case "Default":
        return self._0;
      case "Ty":
        return self._0.span;
    }
  },
};

// impl Spanned for ast::GenericArg
export const Spanned_GenericArg: Spanned<ast.GenericArg> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:162 span
  span(self: ast.GenericArg): Span {
    switch (self.$) {
      case "Lifetime":
        return self._0.ident.span;
      case "Type":
        return Spanned_Ty.span(self._0);
      case "Const":
        return Spanned_Expr.span(self._0.value);
    }
  },
};

// impl Spanned for ast::GenericBound
export const Spanned_GenericBound: Spanned<ast.GenericBound> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:172 span
  span(self: ast.GenericBound): Span {
    switch (self.$) {
      case "Trait":
        return self._0.span;
      case "Outlives":
        return self._0.ident.span;
      case "Use":
        return self._1;
    }
  },
};

// impl Spanned for MacroArg
export const Spanned_MacroArg: Spanned<MacroArg> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:182 span
  span(self: MacroArg): Span {
    switch (self.$) {
      case "Expr":
        return Spanned_Expr.span(self._0);
      case "Ty":
        return Spanned_Ty.span(self._0);
      case "Pat":
        return Spanned_Pat.span(self._0);
      case "Item":
        return Spanned_Item.span(self._0);
      case "Keyword":
        return self._1;
    }
  },
};

// impl Spanned for ast::MetaItemInner
export const Spanned_MetaItemInner: Spanned<ast.MetaItemInner> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:194 span
  span(self: ast.MetaItemInner): Span {
    // PORT: `self.span()` resolves to the inherent `MetaItemInner::span` (rustc_ast attr), not this trait method.
    return ast.MetaItemInner.span(self);
  },
};

// impl Spanned for ast::PreciseCapturingArg
export const Spanned_PreciseCapturingArg: Spanned<ast.PreciseCapturingArg> = {
  // rustc: src/tools/rustfmt/src/spanned.rs:200 span
  span(self: ast.PreciseCapturingArg): Span {
    switch (self.$) {
      case "Lifetime":
        return self._0.ident.span;
      case "Arg":
        return self._0.span;
    }
  },
};

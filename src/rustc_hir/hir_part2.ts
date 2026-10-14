// hir.rs fns part 2 (lines 1538-3328), merged into hir.ts by the lane owner.
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import { BinOpKind, type Movability } from "../rustc_ast/lib.ts";
import type { ExprPrecedence } from "../rustc_ast/util/parser.ts";
import { HirId_eq, HirId_make_owner, type HirId } from "../rustc_hir_id/lib.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { DesugaringKind, type MutRef } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Ident, sym } from "../rustc_span/symbol.ts";
import { type Debug, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Res_eq } from "./def.ts";
import * as gen from "./hir_standin.ts";
import type {
  AmbigArg,
  AssocItemConstraint,
  Body,
  BodyId,
  ConstArg,
  ConstItemRhs,
  Expr,
  FnSig,
  GenericArg,
  GenericBounds,
  ImplItem,
  ImplItemId,
  Pat,
  TraitFn,
  TraitItem,
  TraitItemId,
  Ty,
} from "./hir_standin.ts";
import { Visitor, walk_ty } from "./intravisit.ts";

declare module "./hir_standin.ts" {
  interface Pat {
    walk_short_(it: (p: Pat) => boolean): boolean;
    walk_short(it: (p: Pat) => boolean): boolean;
    walk_(it: (p: Pat) => boolean): void;
    walk(it: (p: Pat) => boolean): void;
    walk_always(it: (p: Pat) => void): void;
    is_never_pattern(): boolean;
    is_guaranteed_to_constitute_read_for_never(): boolean;
  }
  interface DotDotPos {
    as_opt_usize(): number | undefined;
  }
  interface Body {
    id(): BodyId;
  }
  interface Expr {
    precedence(has_attr: (hir_id: HirId) => boolean): ExprPrecedence;
    is_syntactic_place_expr(): boolean;
    is_place_expr(allow_projections_from: (e: Expr) => boolean): boolean;
    range_span(): Span | undefined;
    is_size_lit(): boolean;
    peel_drop_temps(): Expr;
    peel_blocks(): Expr;
    peel_borrows(): Expr;
    can_have_side_effects(): boolean;
    is_approximately_pattern(): boolean;
    equivalent_for_indexing(other: Expr): boolean;
    method_ident(): Ident | undefined;
  }
  interface TraitItemId {
    hir_id(): HirId;
  }
  interface TraitItem {
    hir_id(): HirId;
    trait_item_id(): TraitItemId;
    expect_const(): [Ty, ConstItemRhs | undefined];
    expect_fn(): [FnSig, TraitFn];
    expect_type(): [GenericBounds, Ty | undefined];
  }
  interface ImplItemId {
    hir_id(): HirId;
  }
  interface ImplItem {
    hir_id(): HirId;
    impl_item_id(): ImplItemId;
    vis_span(): Span | undefined;
    expect_const(): [Ty, ConstItemRhs];
    expect_fn(): [FnSig, BodyId];
    expect_type(): Ty;
  }
  interface AssocItemConstraint {
    ty(): Ty | undefined;
    ct(): ConstArg | undefined;
  }
  // `impl<'hir> Ty<'hir>` (Unambig = `()`); the `impl Ty<'hir, AmbigArg>` fns are on `TyAmbig`.
  interface Ty<Unambig> {
    try_as_ambig_ty(this: Ty): Ty<AmbigArg> | undefined;
    peel_refs(this: Ty): Ty;
    as_generic_param(this: Ty): [DefId, Ident] | undefined;
    find_self_aliases(this: Ty): Span[];
    is_suggestable_infer_ty(this: Ty): boolean;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1539 walk_short_
gen.Pat.prototype.walk_short_ = function (this: Pat, it: (p: Pat) => boolean): boolean {
  if (!it(this)) {
    return false;
  }

  const kind = this.kind;
  switch (kind.$) {
    case "Missing":
      return unreachable();
    case "Wild":
    case "Never":
    case "Expr":
    case "Range":
    case "Err":
      return true;
    case "Binding":
      if (kind._3 === undefined) {
        return true;
      }
      return kind._3.walk_short_(it);
    case "Deref":
    case "Ref":
    case "Guard":
      return kind._0.walk_short_(it);
    case "Struct":
      return kind._1.every((field) => field.pat.walk_short_(it));
    case "TupleStruct":
      return kind._1.every((p) => p.walk_short_(it));
    case "Tuple":
    case "Or":
      return kind._0.every((p) => p.walk_short_(it));
    case "Slice": {
      const [before, slice, after] = [kind._0, kind._1, kind._2];
      return [...before, ...(slice !== undefined ? [slice] : []), ...after].every((p) => p.walk_short_(it));
    }
  }
};

/// Walk the pattern in left-to-right order,
/// short circuiting (with `.all(..)`) if `false` is returned.
///
/// Note that when visiting e.g. `Tuple(ps)`,
/// if visiting `ps[0]` returns `false`,
/// then `ps[1]` will not be visited.
// rustc: compiler/rustc_hir/src/hir.rs:1563 walk_short
gen.Pat.prototype.walk_short = function (this: Pat, it: (p: Pat) => boolean): boolean {
  return this.walk_short_(it);
};

// rustc: compiler/rustc_hir/src/hir.rs:1567 walk_
gen.Pat.prototype.walk_ = function (this: Pat, it: (p: Pat) => boolean): void {
  if (!it(this)) {
    return;
  }

  const kind = this.kind;
  switch (kind.$) {
    case "Missing":
    case "Wild":
    case "Never":
    case "Expr":
    case "Range":
    case "Err":
      break;
    case "Binding":
      if (kind._3 !== undefined) {
        kind._3.walk_(it);
      }
      break;
    case "Deref":
    case "Ref":
    case "Guard":
      kind._0.walk_(it);
      break;
    case "Struct":
      kind._1.forEach((field) => field.pat.walk_(it));
      break;
    case "TupleStruct":
      kind._1.forEach((p) => p.walk_(it));
      break;
    case "Tuple":
    case "Or":
      kind._0.forEach((p) => p.walk_(it));
      break;
    case "Slice": {
      const [before, slice, after] = [kind._0, kind._1, kind._2];
      [...before, ...(slice !== undefined ? [slice] : []), ...after].forEach((p) => p.walk_(it));
      break;
    }
  }
};

/// Walk the pattern in left-to-right order.
///
/// If `it(pat)` returns `false`, the children are not visited.
// rustc: compiler/rustc_hir/src/hir.rs:1587 walk
gen.Pat.prototype.walk = function (this: Pat, it: (p: Pat) => boolean): void {
  this.walk_(it);
};

/// Walk the pattern in left-to-right order.
///
/// If you always want to recurse, prefer this method over `walk`.
// rustc: compiler/rustc_hir/src/hir.rs:1594 walk_always
gen.Pat.prototype.walk_always = function (this: Pat, it: (p: Pat) => void): void {
  this.walk((p) => {
    it(p);
    return true;
  });
};

/// Whether this a never pattern.
// rustc: compiler/rustc_hir/src/hir.rs:1602 is_never_pattern
gen.Pat.prototype.is_never_pattern = function (this: Pat): boolean {
  let is_never_pattern = false;
  this.walk((pat) => {
    const kind = pat.kind;
    switch (kind.$) {
      case "Never":
        is_never_pattern = true;
        return false;
      case "Or":
        is_never_pattern = kind._0.every((p) => p.is_never_pattern());
        return false;
      default:
        return true;
    }
  });
  return is_never_pattern;
};

/// Whether this pattern constitutes a read of value of the scrutinee that
/// it is matching against. This is used to determine whether we should
/// perform `NeverToAny` coercions.
///
/// See [`expr_guaranteed_to_constitute_read_for_never`][m] for the nuances of
/// what happens when this returns true.
///
/// [m]: ../../rustc_middle/ty/struct.TyCtxt.html#method.expr_guaranteed_to_constitute_read_for_never
// rustc: compiler/rustc_hir/src/hir.rs:1626 is_guaranteed_to_constitute_read_for_never
gen.Pat.prototype.is_guaranteed_to_constitute_read_for_never = function (this: Pat): boolean {
  const kind = this.kind;
  switch (kind.$) {
    // Does not constitute a read.
    case "Wild":
      return false;

    // The guard cannot affect if we make a read or not (it runs after the inner pattern
    // has matched), therefore it's irrelevant.
    case "Guard":
      return kind._0.is_guaranteed_to_constitute_read_for_never();

    // This is unnecessarily restrictive when the pattern that doesn't
    // constitute a read is unreachable.
    //
    // For example `match *never_ptr { value => {}, _ => {} }` or
    // `match *never_ptr { _ if false => {}, value => {} }`.
    //
    // It is however fine to be restrictive here; only returning `true`
    // can lead to unsoundness.
    case "Or":
      return kind._0.every((pat) => pat.is_guaranteed_to_constitute_read_for_never());

    // Does constitute a read, since it is equivalent to a discriminant read.
    case "Never":
      return true;

    // All of these constitute a read, or match on something that isn't `!`,
    // which would require a `NeverToAny` coercion.
    case "Missing":
    case "Binding":
    case "Struct":
    case "TupleStruct":
    case "Tuple":
    case "Ref":
    case "Deref":
    case "Expr":
    case "Range":
    case "Slice":
    case "Err":
      return true;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:1691 fmt
export function display_RangeEnd(v: gen.RangeEnd): string {
  switch (v) {
    case "Included":
      return "..=";
    case "Excluded":
      return "..";
  }
}

// PORT: `u32::MAX`, the `None` niche of `DotDotPos`.
const U32_MAX = 4294967295;

export type DotDotPos = gen.DotDotPos;
export const DotDotPos = gen.DotDotPos as typeof gen.DotDotPos & {
  "new": (n: number | undefined) => DotDotPos;
};

/// Panics if n >= u32::MAX.
// rustc: compiler/rustc_hir/src/hir.rs:1707 new
DotDotPos.new = function (n: number | undefined): DotDotPos {
  if (n !== undefined) {
    assert(n < U32_MAX, "assertion failed: n < u32::MAX as usize");
    return new gen.DotDotPos(n);
  } else {
    return new gen.DotDotPos(U32_MAX);
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:1717 as_opt_usize
gen.DotDotPos.prototype.as_opt_usize = function (this: DotDotPos): number | undefined {
  if (this._0 === U32_MAX) {
    return undefined;
  } else {
    return this._0;
  }
};

// (hir.rs:1723 `impl fmt::Debug for DotDotPos` is lane hir-types'.)

// rustc: compiler/rustc_hir/src/hir.rs:1964 id
gen.Body.prototype.id = function (this: Body): BodyId {
  return { hir_id: this.value.hir_id };
};

/// The type of source expression that caused this coroutine to be created.
export type CoroutineKind = gen.CoroutineKind;
export const CoroutineKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:1980 movability
  movability(self: CoroutineKind): Movability {
    if (self.$ === "Desugared" && (self._0 === "Async" || self._0 === "AsyncGen")) {
      return "Static";
    } else if (self.$ === "Desugared" && self._0 === "Gen") {
      return "Movable";
    } else if (self.$ === "Coroutine") {
      return self._0;
    }
    return unreachable();
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1989 is_fn_like
  is_fn_like(self: CoroutineKind): boolean {
    return self.$ === "Desugared" && self._1 === "Fn";
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1993 is_async_desugaring
  is_async_desugaring(self: CoroutineKind): boolean {
    return self.$ === "Desugared" && (self._0 === "Async" || self._0 === "AsyncGen");
  },

  // rustc: compiler/rustc_hir/src/hir.rs:2000 to_plural_string
  to_plural_string(self: CoroutineKind): string {
    if (self.$ === "Desugared" && self._1 === "Fn") {
      return `${display_CoroutineDesugaring(self._0, PRETTY)}fn bodies`;
    } else if (self.$ === "Desugared" && self._1 === "Block") {
      return `${display_CoroutineDesugaring(self._0, PRETTY)}blocks`;
    } else if (self.$ === "Desugared" && self._1 === "Closure") {
      return `${display_CoroutineDesugaring(self._0, PRETTY)}closure bodies`;
    } else if (self.$ === "Coroutine") {
      return "coroutines";
    }
    return unreachable();
  },
};

// PORT: `f` carries the formatter's `alternate` flag (`{:#}`), which `CoroutineDesugaring`'s Display reads.
// rustc: compiler/rustc_hir/src/hir.rs:2011 fmt
export function display_CoroutineKind(v: CoroutineKind, f: Fmt = PLAIN): string {
  switch (v.$) {
    case "Desugared": {
      const [d, k] = [v._0, v._1];
      return display_CoroutineDesugaring(d, f) + display_CoroutineSource(k);
    }
    case "Coroutine":
      return "coroutine";
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2040 fmt
export function display_CoroutineSource(v: gen.CoroutineSource): string {
  switch (v) {
    case "Block":
      return "block";
    case "Closure":
      return "closure body";
    case "Fn":
      return "fn body";
  }
}

// PORT: `f.alternate()` is `f.alternate` (`{:#}` passes PRETTY).
// rustc: compiler/rustc_hir/src/hir.rs:2064 fmt
export function display_CoroutineDesugaring(v: gen.CoroutineDesugaring, f: Fmt = PLAIN): string {
  let out = "";
  switch (v) {
    case "Async":
      if (f.alternate) {
        out += "`async` ";
      } else {
        out += "async ";
      }
      break;
    case "Gen":
      if (f.alternate) {
        out += "`gen` ";
      } else {
        out += "gen ";
      }
      break;
    case "AsyncGen":
      if (f.alternate) {
        out += "`async gen` ";
      } else {
        out += "async gen ";
      }
      break;
  }

  return out;
}

export type BodyOwnerKind = gen.BodyOwnerKind;
export const BodyOwnerKind = {
  ...gen.BodyOwnerKind,

  // rustc: compiler/rustc_hir/src/hir.rs:2112 is_fn_or_closure
  is_fn_or_closure(self: BodyOwnerKind): boolean {
    switch (self.$) {
      case "Fn":
      case "Closure":
        return true;
      case "Const":
      case "Static":
      case "GlobalAsm":
        return false;
    }
  },
};

/// The kind of an item that requires const-checking.
export type ConstContext = gen.ConstContext;
export const ConstContext = {
  ...gen.ConstContext,

  /// A description of this const context that can appear between backticks in an error message.
  ///
  /// E.g. `const` or `static mut`.
  // rustc: compiler/rustc_hir/src/hir.rs:2149 keyword_name
  keyword_name(self: ConstContext): string {
    if (self.$ === "Const") {
      return "const";
    } else if (self.$ === "Static" && self._0 === "Not") {
      return "static";
    } else if (self.$ === "Static" && self._0 === "Mut") {
      return "static mut";
    } else if (self.$ === "ConstFn") {
      return "const fn";
    }
    return unreachable();
  },
};

/// A colloquial, trivially pluralizable description of this const context for use in error
/// messages.
// rustc: compiler/rustc_hir/src/hir.rs:2162 fmt
export function display_ConstContext(v: ConstContext): string {
  switch (v.$) {
    case "Const":
      return "constant";
    case "Static":
      return "static";
    case "ConstFn":
      return "constant function";
  }
}

/** `impl IntoDiagArg for ConstContext` */
// rustc: compiler/rustc_hir/src/hir.rs:2172 into_diag_arg
export function ConstContext_into_diag_arg(self: ConstContext, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self.$) {
    case "ConstFn":
      s = "constant function";
      break;
    case "Static":
      s = "static";
      break;
    case "Const":
      s = "constant";
      break;
  }
  return { $: "Str", _0: s };
}

// rustc: compiler/rustc_hir/src/hir.rs:2227 precedence
gen.Expr.prototype.precedence = function (this: Expr, has_attr: (hir_id: HirId) => boolean): ExprPrecedence {
  const prefix_attrs_precedence = (): ExprPrecedence => {
    if (has_attr(this.hir_id)) {
      return "Prefix";
    } else {
      return "Unambiguous";
    }
  };

  const kind = this.kind;
  switch (kind.$) {
    case "Closure":
      switch (kind._0.fn_decl.output.$) {
        case "DefaultReturn":
          return "Jump";
        case "Return":
          return prefix_attrs_precedence();
      }
      break;

    case "Break":
    case "Ret":
    case "Yield":
    case "Become":
      return "Jump";

    // Binop-like expr kinds, handled by `AssocOp`.
    case "Binary":
      return BinOpKind.precedence(kind._0.node);
    case "Cast":
      return "Cast";

    case "Assign":
    case "AssignOp":
      return "Assign";

    // Unary, prefix
    case "AddrOf":
      return "Prefix";

    // Here `let pats = expr` has `let pats =` as a "unary" prefix of `expr`.
    // However, this is not exactly right. When `let _ = a` is the LHS of a binop we
    // need parens sometimes. E.g. we can print `(let _ = a) && b` as `let _ = a && b`
    // but we need to print `(let _ = a) < b` as-is with parens.
    case "Let":
    case "Unary":
      return "Prefix";

    // Need parens if and only if there are prefix attributes.
    case "Array":
    case "Block":
    case "Call":
    case "ConstBlock":
    case "Continue":
    case "Field":
    case "If":
    case "Index":
    case "InlineAsm":
    case "Lit":
    case "Loop":
    case "Match":
    case "MethodCall":
    case "OffsetOf":
    case "Path":
    case "Repeat":
    case "Struct":
    case "Tup":
    case "Type":
    case "UnsafeBinderCast":
    case "Use":
    case "Err":
      return prefix_attrs_precedence();

    case "DropTemps":
      return kind._0.precedence(has_attr);
  }
};

/// Whether this looks like a place expr, without checking for deref
/// adjustments.
/// This will return `true` in some potentially surprising cases such as
/// `CONSTANT.field`.
// rustc: compiler/rustc_hir/src/hir.rs:2290 is_syntactic_place_expr
gen.Expr.prototype.is_syntactic_place_expr = function (this: Expr): boolean {
  return this.is_place_expr((_) => true);
};

/// Whether this is a place expression.
///
/// `allow_projections_from` should return `true` if indexing a field or index expression based
/// on the given expression should be considered a place expression.
// rustc: compiler/rustc_hir/src/hir.rs:2298 is_place_expr
gen.Expr.prototype.is_place_expr = function (this: Expr, allow_projections_from: (e: Expr) => boolean): boolean {
  const kind = this.kind;
  if (kind.$ === "Path" && kind._0.$ === "Resolved") {
    const path = kind._0._1;
    const res = path.res;
    return res.$ === "Local" || (res.$ === "Def" && res._0.$ === "Static") || res.$ === "Err";
  }

  // Type ascription inherits its place expression kind from its
  // operand. See:
  // https://rust-lang.github.io/rfcs/0803-type-ascription.html#type-ascription-and-temporaries
  else if (kind.$ === "Type") {
    return kind._0.is_place_expr(allow_projections_from);
  }

  // Unsafe binder cast preserves place-ness of the sub-expression.
  else if (kind.$ === "UnsafeBinderCast") {
    return kind._1.is_place_expr(allow_projections_from);
  } else if (kind.$ === "Unary" && kind._0 === "Deref") {
    return true;
  } else if (kind.$ === "Field" || kind.$ === "Index") {
    const base = kind._0;
    return allow_projections_from(base) || base.is_place_expr(allow_projections_from);
  }

  // Suppress errors for bad expressions.
  else if (kind.$ === "Err" || (kind.$ === "Let" && kind._0.recovered.$ === "Yes")) {
    return true;
  }

  // Partially qualified paths in expressions can only legally
  // refer to associated items which are always rvalues.
  else if (
    (kind.$ === "Path" && kind._0.$ === "TypeRelative") ||
    kind.$ === "Call" ||
    kind.$ === "MethodCall" ||
    kind.$ === "Use" ||
    kind.$ === "Struct" ||
    kind.$ === "Tup" ||
    kind.$ === "If" ||
    kind.$ === "Match" ||
    kind.$ === "Closure" ||
    kind.$ === "Block" ||
    kind.$ === "Repeat" ||
    kind.$ === "Array" ||
    kind.$ === "Break" ||
    kind.$ === "Continue" ||
    kind.$ === "Ret" ||
    kind.$ === "Become" ||
    kind.$ === "Let" ||
    kind.$ === "Loop" ||
    kind.$ === "Assign" ||
    kind.$ === "InlineAsm" ||
    kind.$ === "OffsetOf" ||
    kind.$ === "AssignOp" ||
    kind.$ === "Lit" ||
    kind.$ === "ConstBlock" ||
    kind.$ === "Unary" ||
    kind.$ === "AddrOf" ||
    kind.$ === "Binary" ||
    kind.$ === "Yield" ||
    kind.$ === "Cast" ||
    kind.$ === "DropTemps"
  ) {
    return false;
  }
  return unreachable();
};

/// If this is a desugared range expression,
/// returns the span of the range without desugaring context.
// rustc: compiler/rustc_hir/src/hir.rs:2359 range_span
gen.Expr.prototype.range_span = function (this: Expr): Span | undefined {
  return is_range_literal(this) ? unwrap(Span.parent_callsite(this.span)) : undefined;
};

/// Check if expression is an integer literal that can be used
/// where `usize` is expected.
// rustc: compiler/rustc_hir/src/hir.rs:2365 is_size_lit
gen.Expr.prototype.is_size_lit = function (this: Expr): boolean {
  const kind = this.kind;
  return (
    kind.$ === "Lit" &&
    kind._0.node.$ === "Int" &&
    (kind._0.node._1.$ === "Unsuffixed" || (kind._0.node._1.$ === "Unsigned" && kind._0.node._1._0 === "Usize"))
  );
};

/// If `Self.kind` is `ExprKind::DropTemps(expr)`, drill down until we get a non-`DropTemps`
/// `Expr`. This is used in suggestions to ignore this `ExprKind` as it is semantically
/// silent, only signaling the ownership system. By doing this, suggestions that check the
/// `ExprKind` of any given `Expr` for presentation don't have to care about `DropTemps`
/// beyond remembering to call this function before doing analysis on it.
// rustc: compiler/rustc_hir/src/hir.rs:2380 peel_drop_temps
gen.Expr.prototype.peel_drop_temps = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "DropTemps") {
    expr = expr.kind._0;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2388 peel_blocks
gen.Expr.prototype.peel_blocks = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "Block" && expr.kind._0.expr !== undefined) {
    expr = expr.kind._0.expr;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2396 peel_borrows
gen.Expr.prototype.peel_borrows = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "AddrOf") {
    expr = expr.kind._2;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2404 can_have_side_effects
gen.Expr.prototype.can_have_side_effects = function (this: Expr): boolean {
  const kind = this.peel_drop_temps().kind;
  switch (kind.$) {
    case "Path":
    case "Lit":
    case "OffsetOf":
    case "Use":
      return false;
    case "Type":
    case "Unary":
    case "Field":
    case "Index":
    case "AddrOf":
    case "Cast":
    case "UnsafeBinderCast": {
      let base: Expr;
      if (kind.$ === "Type" || kind.$ === "Field" || kind.$ === "Index" || kind.$ === "Cast") {
        base = kind._0;
      } else if (kind.$ === "Unary" || kind.$ === "UnsafeBinderCast") {
        base = kind._1;
      } else {
        // ExprKind::AddrOf(.., base)
        base = kind._2;
      }
      // This isn't exactly true for `Index` and all `Unary`, but we are using this
      // method exclusively for diagnostics and there's a *cultural* pressure against
      // them being used only for its side-effects.
      return base.can_have_side_effects();
    }
    case "Binary": {
      const [lhs, rhs] = [kind._1, kind._2];
      // This isn't exactly true for all `Binary`, but we are using this
      // method exclusively for diagnostics and there's a *cultural* pressure against
      // them being used only for its side-effects.
      return lhs.can_have_side_effects() || rhs.can_have_side_effects();
    }
    case "Struct": {
      const [fields, init] = [kind._1, kind._2];
      let init_side_effects: boolean;
      switch (init.$) {
        case "Base":
          init_side_effects = init._0.can_have_side_effects();
          break;
        case "DefaultFields":
        case "None":
        case "NoneWithError":
          init_side_effects = false;
          break;
      }
      return fields.map((field) => field.expr).some((e) => e.can_have_side_effects()) || init_side_effects;
    }

    case "Array":
    case "Tup":
      return kind._0.some((arg) => arg.can_have_side_effects());
    case "Call": {
      // ExprKind::Call(Expr { kind: ExprKind::Path(QPath::Resolved(None, Path { res:
      // Res::Def(DefKind::Ctor(_, CtorKind::Fn), _), .. })), .. }, args)
      const fkind = kind._0.kind;
      if (
        fkind.$ === "Path" &&
        fkind._0.$ === "Resolved" &&
        fkind._0._0 === undefined &&
        fkind._0._1.res.$ === "Def" &&
        fkind._0._1.res._0.$ === "Ctor" &&
        fkind._0._1.res._0._1 === "Fn"
      ) {
        return kind._1.some((arg) => arg.can_have_side_effects());
      }
      return true;
    }
    case "Repeat":
      return kind._0.can_have_side_effects();
    case "If":
    case "Match":
    case "MethodCall":
    case "Closure":
    case "Block":
    case "Break":
    case "Continue":
    case "Ret":
    case "Become":
    case "Let":
    case "Loop":
    case "Assign":
    case "InlineAsm":
    case "AssignOp":
    case "ConstBlock":
    case "Yield":
    case "DropTemps":
    case "Err":
      return true;
  }
};

/// To a first-order approximation, is this a pattern?
// rustc: compiler/rustc_hir/src/hir.rs:2475 is_approximately_pattern
gen.Expr.prototype.is_approximately_pattern = function (this: Expr): boolean {
  const kind = this.kind;
  switch (kind.$) {
    case "Array":
    case "Call":
    case "Tup":
    case "Lit":
    case "Path":
    case "Struct":
      return true;
    default:
      return false;
  }
};

/// Whether this and the `other` expression are the same for purposes of an indexing operation.
///
/// This is only used for diagnostics to see if we have things like `foo[i]` where `foo` is
/// borrowed multiple times with `i`.
// rustc: compiler/rustc_hir/src/hir.rs:2491 equivalent_for_indexing
gen.Expr.prototype.equivalent_for_indexing = function (this: Expr, other: Expr): boolean {
  const [k1, k2] = [this.kind, other.kind];
  if (k1.$ === "Lit" && k2.$ === "Lit") {
    // lit1.node == lit2.node
    return unported("<rustc_ast::ast::LitKind as PartialEq>::eq (hir.rs:2493 equivalent_for_indexing)");
  } else if (
    k1.$ === "Path" &&
    k1._0.$ === "Resolved" &&
    k1._0._0 === undefined &&
    k2.$ === "Path" &&
    k2._0.$ === "Resolved" &&
    k2._0._0 === undefined
  ) {
    const [path1, path2] = [k1._0._1, k2._0._1];
    return Res_eq(path1.res, path2.res, HirId_eq);
  } else if (
    k1.$ === "Struct" &&
    k1._0.$ === "Resolved" &&
    k1._0._0 === undefined &&
    k1._0._1.res.$ === "Def" &&
    k1._2.$ === "None" &&
    k2.$ === "Struct" &&
    k2._0.$ === "Resolved" &&
    k2._0._0 === undefined &&
    k2._0._1.res.$ === "Def" &&
    k2._2.$ === "None"
  ) {
    const [path1_def_id, args1] = [k1._0._1.res._1, k1._1];
    const [path2_def_id, args2] = [k2._0._1.res._1, k2._1];
    if (!(DefId_eq(path2_def_id, path1_def_id) && is_range_literal(this) && is_range_literal(other))) {
      return false;
    }
    // std::iter::zip(args1, args2).all(|(a, b)| a.expr.equivalent_for_indexing(b.expr))
    const n = Math.min(args1.length, args2.length);
    for (let i = 0; i < n; i++) {
      const [a, b] = [args1[i]!, args2[i]!];
      if (!a.expr.equivalent_for_indexing(b.expr)) {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:2520 method_ident
gen.Expr.prototype.method_ident = function (this: Expr): Ident | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "MethodCall":
      return kind._0.ident;
    case "Unary":
      return kind._1.method_ident();
    case "AddrOf":
      return kind._2.method_ident();
    default:
      return undefined;
  }
};

/// Checks if the specified expression is a built-in range literal.
/// (See: `LoweringContext::lower_expr()`).
// rustc: compiler/rustc_hir/src/hir.rs:2531 is_range_literal
export function is_range_literal(expr: Expr): boolean {
  // PORT: the two `if let` chains are tested in order; each returns `true` when all its
  // conditions hold (no condition has side effects).
  {
    const kind = expr.kind;
    if (kind.$ === "Struct" && kind._0.$ === "Resolved" && kind._0._0 === undefined && kind._2.$ === "None") {
      const path = kind._0._1;
      const segment = path.segments[path.segments.length - 1];
      if (segment !== undefined) {
        const name = segment.ident.name;
        if (
          (name === sym.RangeFrom ||
            name === sym.RangeFull ||
            name === sym.Range ||
            name === sym.RangeToInclusive ||
            name === sym.RangeTo ||
            name === sym.RangeFromCopy ||
            name === sym.RangeCopy ||
            name === sym.RangeInclusiveCopy ||
            name === sym.RangeToInclusiveCopy) &&
          Span.is_desugaring(expr.span, DesugaringKind.RangeExpr)
        ) {
          return true;
        }
      }
    }
  }
  {
    const kind = expr.kind;
    if (kind.$ === "Call") {
      const func = kind._0;
      const fkind = func.kind;
      if (fkind.$ === "Path" && fkind._0.$ === "Resolved" && fkind._0._0 === undefined) {
        const path = fkind._0._1;
        const segment = path.segments[path.segments.length - 1];
        if (
          segment !== undefined &&
          segment.ident.name === sym.range_inclusive_new &&
          Span.is_desugaring(expr.span, DesugaringKind.RangeExpr)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/// Checks if the specified expression needs parentheses for prefix
/// or postfix suggestions to be valid.
/// For example, `a + b` requires parentheses to suggest `&(a + b)`,
/// but just `a` does not.
/// Similarly, `(a + b).c()` also requires parentheses.
/// This should not be used for other types of suggestions.
// rustc: compiler/rustc_hir/src/hir.rs:2564 expr_needs_parens
export function expr_needs_parens(expr: Expr): boolean {
  const kind = expr.kind;
  // parenthesize if needed (Issue #46756)
  if (kind.$ === "Cast" || kind.$ === "Binary") {
    return true;
  }
  // parenthesize borrows of range literals (Issue #54505)
  else if (is_range_literal(expr)) {
    return true;
  } else {
    return false;
  }
}

export type QPath = gen.QPath;
export const QPath = {
  /// Returns the span of this `QPath`.
  // rustc: compiler/rustc_hir/src/hir.rs:2758 span
  span(self: QPath): Span {
    switch (self.$) {
      case "Resolved":
        return self._1.span;
      case "TypeRelative": {
        const [qself, ps] = [self._0, self._1];
        return Span.to(qself.span, ps.ident.span);
      }
    }
  },

  /// Returns the span of the qself of this `QPath`. For example, `()` in
  /// `<() as Trait>::method`.
  // rustc: compiler/rustc_hir/src/hir.rs:2767 qself_span
  qself_span(self: QPath): Span {
    switch (self.$) {
      case "Resolved":
        return self._1.span;
      case "TypeRelative":
        return self._0.span;
    }
  },
};

/// Hints at the original code for a `match _ { .. }`.
export type MatchSource = gen.MatchSource;
export const MatchSource = {
  ...gen.MatchSource,

  // rustc: compiler/rustc_hir/src/hir.rs:2818 name
  name(self: MatchSource): string {
    switch (self.$) {
      case "Normal":
        return "match";
      case "Postfix":
        return ".match";
      case "ForLoopDesugar":
        return "for";
      case "TryDesugar":
        return "?";
      case "AwaitDesugar":
        return ".await";
      case "FormatArgs":
        return "format_args!()";
    }
  },
};

/// The loop type that yielded an `ExprKind::Loop`.
export type LoopSource = gen.LoopSource;
export const LoopSource = {
  ...gen.LoopSource,

  // rustc: compiler/rustc_hir/src/hir.rs:2843 name
  name(self: LoopSource): string {
    switch (self) {
      case "Loop":
        return "loop";
      case "While":
        return "while";
      case "ForLoop":
        return "for";
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:2860 fmt
export function display_LoopIdError(v: gen.LoopIdError): string {
  switch (v) {
    case "OutsideLoopScope":
      return "not inside loop scope";
    case "UnlabeledCfInWhileCondition":
      return "unlabeled control flow (break or continue) in while condition";
    case "UnresolvedLabel":
      return "label not found";
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2891 fmt
export function display_YieldSource(v: gen.YieldSource): string {
  switch (v.$) {
    case "Await":
      return "`await`";
    case "Yield":
      return "`yield`";
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2918 hir_id
gen.TraitItemId.prototype.hir_id = function (this: TraitItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// PORT: `macro_rules! expect_methods_self_kind` (hir.rs:2938) / `expect_methods_self` (hir.rs:2950)
// are expanded by hand at their call sites (hir.rs:2978, :3071); the generated fns have no `fn <name>`
// upstream, so they carry no `// rustc:` marker. `#[track_caller]` is dropped. HIR is arena-allocated
// and never edited in place, so the `*rhs`/`*ty` copies of Copy HIR values return the same object.

// PORT: `T: fmt::Debug` is passed as `debug_T`.
// rustc: compiler/rustc_hir/src/hir.rs:2963 expect_failed
export function expect_failed<T>(ident: string, found: T, debug_T: Debug<T>): never {
  return panic(`${ident}: found ${debug_T(found, PLAIN)}`);
}

// rustc: compiler/rustc_hir/src/hir.rs:2969 hir_id
gen.TraitItem.prototype.hir_id = function (this: TraitItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:2974 trait_item_id
gen.TraitItem.prototype.trait_item_id = function (this: TraitItem): TraitItemId {
  return new gen.TraitItemId(this.owner_id);
};

// expect_methods_self_kind! (hir.rs:2978): expect_const
gen.TraitItem.prototype.expect_const = function (this: TraitItem): [Ty, ConstItemRhs | undefined] {
  const kind = this.kind;
  if (kind.$ !== "Const") {
    return expect_failed("expect_const", this, gen.debug_TraitItem);
  }
  const [ty, rhs] = [kind._0, kind._1];
  return [ty, rhs];
};

// expect_methods_self_kind! (hir.rs:2978): expect_fn
gen.TraitItem.prototype.expect_fn = function (this: TraitItem): [FnSig, TraitFn] {
  const kind = this.kind;
  if (kind.$ !== "Fn") {
    return expect_failed("expect_fn", this, gen.debug_TraitItem);
  }
  const [ty, trfn] = [kind._0, kind._1];
  return [ty, trfn];
};

// expect_methods_self_kind! (hir.rs:2978): expect_type
gen.TraitItem.prototype.expect_type = function (this: TraitItem): [GenericBounds, Ty | undefined] {
  const kind = this.kind;
  if (kind.$ !== "Type") {
    return expect_failed("expect_type", this, gen.debug_TraitItem);
  }
  const [bounds, ty] = [kind._0, kind._1];
  return [bounds, ty];
};

// rustc: compiler/rustc_hir/src/hir.rs:3022 hir_id
gen.ImplItemId.prototype.hir_id = function (this: ImplItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3055 hir_id
gen.ImplItem.prototype.hir_id = function (this: ImplItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3060 impl_item_id
gen.ImplItem.prototype.impl_item_id = function (this: ImplItem): ImplItemId {
  return new gen.ImplItemId(this.owner_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3064 vis_span
gen.ImplItem.prototype.vis_span = function (this: ImplItem): Span | undefined {
  const impl_kind = this.impl_kind;
  switch (impl_kind.$) {
    case "Trait":
      return undefined;
    case "Inherent":
      return impl_kind.vis_span;
  }
};

// expect_methods_self_kind! (hir.rs:3071): expect_const
gen.ImplItem.prototype.expect_const = function (this: ImplItem): [Ty, ConstItemRhs] {
  const kind = this.kind;
  if (kind.$ !== "Const") {
    return expect_failed("expect_const", this, gen.debug_ImplItem);
  }
  const [ty, rhs] = [kind._0, kind._1];
  return [ty, rhs];
};

// expect_methods_self_kind! (hir.rs:3071): expect_fn
gen.ImplItem.prototype.expect_fn = function (this: ImplItem): [FnSig, BodyId] {
  const kind = this.kind;
  if (kind.$ !== "Fn") {
    return expect_failed("expect_fn", this, gen.debug_ImplItem);
  }
  const [ty, body] = [kind._0, kind._1];
  return [ty, body];
};

// expect_methods_self_kind! (hir.rs:3071): expect_type
gen.ImplItem.prototype.expect_type = function (this: ImplItem): Ty {
  const kind = this.kind;
  if (kind.$ !== "Type") {
    return expect_failed("expect_type", this, gen.debug_ImplItem);
  }
  const ty = kind._0;
  return ty;
};

/// Obtain the type on the RHS of an assoc ty equality constraint if applicable.
// rustc: compiler/rustc_hir/src/hir.rs:3112 ty
gen.AssocItemConstraint.prototype.ty = function (this: AssocItemConstraint): Ty | undefined {
  const kind = this.kind;
  if (kind.$ === "Equality" && kind.term.$ === "Ty") {
    return kind.term._0;
  }
  return undefined;
};

/// Obtain the const on the RHS of an assoc const equality constraint if applicable.
// rustc: compiler/rustc_hir/src/hir.rs:3120 ct
gen.AssocItemConstraint.prototype.ct = function (this: AssocItemConstraint): ConstArg | undefined {
  const kind = this.kind;
  if (kind.$ === "Equality" && kind.term.$ === "Const") {
    return kind.term._0;
  }
  return undefined;
};

export type Term = gen.Term;
export const Term = {
  /** `impl From<&'hir Ty<'hir>> for Term<'hir>` */
  // rustc: compiler/rustc_hir/src/hir.rs:3135 from
  from_Ty(ty: Ty): Term {
    return { $: "Ty", _0: ty };
  },

  /** `impl From<&'hir ConstArg<'hir>> for Term<'hir>` */
  // rustc: compiler/rustc_hir/src/hir.rs:3141 from
  from_ConstArg(c: ConstArg): Term {
    return { $: "Const", _0: c };
  },
};

/// The kind of [associated item constraint][AssocItemConstraint].
export type AssocItemConstraintKind = gen.AssocItemConstraintKind;
export const AssocItemConstraintKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:3161 descr
  descr(self: AssocItemConstraintKind): string {
    switch (self.$) {
      case "Equality":
        return "binding";
      case "Bound":
        return "constraint";
    }
  },
};

// PORT: `impl Ty<'hir, AmbigArg>` (hir.rs:3188, :3226) -> the `TyAmbig` companion: `peel_refs` is also
// defined by `impl Ty<'hir>` (:3236), which owns the prototype (the ast.ts `AssocItem` precedent).
// The pointer casts between `Ty<'hir, AmbigArg>` and `Ty<'hir>` are identity casts (`AmbigArg` is
// uninhabited: `never`; `()` is `null`), written `as unknown as`.
export const TyAmbig = {
  /// Converts a `Ty` in an ambiguous position to one in an unambiguous position.
  ///
  /// Functions accepting an unambiguous types may expect the [`TyKind::Infer`] variant
  /// to be used. Care should be taken to separately handle infer types when calling this
  /// function as it cannot be handled by downstream code making use of the returned ty.
  ///
  /// In practice this may mean overriding the [`Visitor::visit_infer`][visit_infer] method on hir visitors, or
  /// specifically matching on [`GenericArg::Infer`] when handling generic arguments.
  ///
  /// [visit_infer]: [rustc_hir::intravisit::Visitor::visit_infer]
  // rustc: compiler/rustc_hir/src/hir.rs:3199 as_unambig_ty
  as_unambig_ty(self: Ty<AmbigArg>): Ty {
    // SAFETY: `Ty` is `repr(C)` and `TyKind` is marked `repr(u8)` so that the layout is
    // the same across different ZST type arguments.
    const ptr = self as unknown as Ty;
    return ptr;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3227 peel_refs
  peel_refs(self: Ty<AmbigArg>): Ty {
    let final_ty = TyAmbig.as_unambig_ty(self);
    while (final_ty.kind.$ === "Ref") {
      final_ty = final_ty.kind._1;
    }
    return final_ty;
  },
};

/// Converts a `Ty` in an unambiguous position to one in an ambiguous position. This is
/// fallible as the [`TyKind::Infer`] variant is not present in ambiguous positions.
///
/// Functions accepting ambiguous types will not handle the [`TyKind::Infer`] variant, if
/// infer types are relevant to you then care should be taken to handle them separately.
// rustc: compiler/rustc_hir/src/hir.rs:3213 try_as_ambig_ty
gen.Ty.prototype.try_as_ambig_ty = function (this: Ty): Ty<AmbigArg> | undefined {
  if (this.kind.$ === "Infer") {
    return undefined;
  }

  // SAFETY: `Ty` is `repr(C)` and `TyKind` is marked `repr(u8)` so that the layout is
  // the same across different ZST type arguments. We also asserted that the `self` is
  // not a `TyKind::Infer` so there is no risk of transmuting a `()` to `AmbigArg`.
  const ptr = this as unknown as Ty<AmbigArg>;
  return ptr;
};

// rustc: compiler/rustc_hir/src/hir.rs:3237 peel_refs
gen.Ty.prototype.peel_refs = function (this: Ty): Ty {
  let final_ty: Ty = this;
  while (final_ty.kind.$ === "Ref") {
    final_ty = final_ty.kind._1;
  }
  return final_ty;
};

/// Returns `true` if `param_def_id` matches the `bounded_ty` of this predicate.
// rustc: compiler/rustc_hir/src/hir.rs:3246 as_generic_param
gen.Ty.prototype.as_generic_param = function (this: Ty): [DefId, Ident] | undefined {
  const kind = this.kind;
  if (!(kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined)) {
    return undefined;
  }
  const path = kind._0._1;
  if (path.segments.length !== 1) {
    return undefined;
  }
  const segment = path.segments[0]!;
  const res = path.res;
  if (res.$ === "Def" && res._0.$ === "TyParam") {
    return [res._1, segment.ident];
  } else if (res.$ === "SelfTyParam") {
    return [res.trait_, segment.ident];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:3261 find_self_aliases
gen.Ty.prototype.find_self_aliases = function (this: Ty): Span[] {
  class MyVisitor extends Visitor {
    constructor(public _0: Span[]) {
      super();
    }
    // rustc: compiler/rustc_hir/src/hir.rs:3265 visit_ty
    override visit_ty(t: Ty<AmbigArg>): undefined {
      const kind = t.kind;
      if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._1.res.$ === "SelfTyAlias") {
        this._0.push(t.span);
        return undefined;
      }
      return walk_ty(this, t);
    }
  }

  const my_visitor = new MyVisitor([]);
  my_visitor.visit_ty_unambig(this);
  return my_visitor._0;
};

/// Whether `ty` is a type with `_` placeholders that can be inferred. Used in diagnostics only to
/// use inference to provide suggestions for the appropriate type if possible.
// rustc: compiler/rustc_hir/src/hir.rs:3287 is_suggestable_infer_ty
gen.Ty.prototype.is_suggestable_infer_ty = function (this: Ty): boolean {
  // rustc: compiler/rustc_hir/src/hir.rs:3288 are_suggestable_generic_args
  function are_suggestable_generic_args(generic_args: readonly GenericArg[]): boolean {
    return generic_args.some((arg) => {
      switch (arg.$) {
        case "Type":
          return TyAmbig.as_unambig_ty(arg._0).is_suggestable_infer_ty();
        case "Infer":
          return true;
        default:
          return false;
      }
    });
  }
  // debug!(?self);
  const kind = this.kind;
  switch (kind.$) {
    case "Infer":
      return true;
    case "Slice":
      return kind._0.is_suggestable_infer_ty();
    case "Array": {
      const [ty, length] = [kind._0, kind._1];
      return ty.is_suggestable_infer_ty() || length.kind.$ === "Infer";
    }
    case "Tup":
      return kind._0.some((t) => t.is_suggestable_infer_ty());
    case "Ptr":
      return kind._0.is_suggestable_infer_ty();
    case "Ref":
      return kind._1.is_suggestable_infer_ty();
    case "Path": {
      const qpath = kind._0;
      if (qpath.$ === "TypeRelative") {
        const [ty, segment] = [qpath._0, qpath._1];
        return ty.is_suggestable_infer_ty() || are_suggestable_generic_args(segment.args_().args);
      } else {
        // QPath::Resolved(ty_opt, Path { segments, .. })
        const [ty_opt, segments] = [qpath._0, qpath._1.segments];
        return (
          (ty_opt !== undefined && ty_opt.is_suggestable_infer_ty()) ||
          segments.some((segment) => are_suggestable_generic_args(segment.args_().args))
        );
      }
    }
    default:
      return false;
  }
};

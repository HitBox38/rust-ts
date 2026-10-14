//! This file declares the `ScopeTree` type, which describes
//! the parent links in the region hierarchy.
//!
//! For more information about how MIR-based region-checking works,
//! see the [rustc dev guide].
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/borrow_check.html
// Port of compiler/rustc_middle/src/middle/region.rs (lane middle-traits-thir). The types are generated
// (region.gen.ts, set rustc_middle_traits_thir): `Scope` and `ScopeTree` are the generated classes, their methods are
// added below (PORTING §5 "Methods defined in another file").
import { HirId, type ItemLocalId, debug_ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import { with_ } from "../ty/context/tls.ts";
import type { TyCtxt } from "../ty/context.ts";
import { clone_Scope, FirstStatementIndex, Scope, ScopeData, ScopeTree, type TempLifetime } from "./region.gen.ts";

export * from "./region.gen.ts";

declare module "./region.gen.ts" {
  interface Scope {
    hir_id(scope_tree: ScopeTree): HirId | undefined;
    span(tcx: TyCtxt, scope_tree: ScopeTree): Span;
  }
  interface ScopeTree {
    record_scope_parent(child: Scope, parent: Scope | undefined): void;
    record_var_scope(var_: ItemLocalId, lifetime: Scope): void;
    record_extended_temp_scope(var_: ItemLocalId, lifetime: Scope | undefined): void;
    opt_encl_scope(id: Scope): Scope | undefined;
    var_scope(var_id: ItemLocalId): Scope | undefined;
    is_subscope_of(subscope: Scope, superscope: Scope): boolean;
    default_temporary_scope(inner: Scope): [Scope, Scope | undefined];
    temporary_scope(expr_id: ItemLocalId): TempLifetime;
  }
  namespace ScopeTree {
    export function default_(): ScopeTree;
  }
}

/** `#[derive(PartialEq, Eq)]` of `Scope` (`local_id`, then `data`). */
export function Scope_eq(a: Scope, b: Scope): boolean {
  return a.local_id === b.local_id && ScopeData_eq(a.data, b.data);
}
/** `#[derive(PartialEq, Eq)]` of `ScopeData`. */
export function ScopeData_eq(a: ScopeData, b: ScopeData): boolean {
  if (a.$ !== b.$) return false;
  return a.$ === "Remainder" ? a._0 === (b as typeof a)._0 : true;
}
/** PORT: the canonical key of a `Scope` (its derived `Hash`+`Eq`) for the `FxIndexMap<Scope, _>` of `ScopeTree`
 *  (rust_ts/keyed.ts `KeyedMap`). */
export function key_Scope(s: Scope): string {
  return s.data.$ === "Remainder" ? `${s.local_id}:R${s.data._0}` : `${s.local_id}:${s.data.$}`;
}

// `impl fmt::Debug for Scope`
// rustc: compiler/rustc_middle/src/middle/region.rs:91 fmt
export function debug_Scope(self: Scope, _fmt: Fmt): string {
  // PORT: `write!(fmt, "..{:?}..")` formats `local_id` with a fresh `{:?}` spec (`PLAIN`).
  const local_id = debug_ItemLocalId(self.local_id, PLAIN);
  switch (self.data.$) {
    case "Node":
      return `Node(${local_id})`;
    case "CallSite":
      return `CallSite(${local_id})`;
    case "Arguments":
      return `Arguments(${local_id})`;
    case "Destruction":
      return `Destruction(${local_id})`;
    case "IfThen":
      return `IfThen(${local_id})`;
    case "IfThenRescope":
      return `IfThen[edition2024](${local_id})`;
    case "MatchGuard":
      return `MatchGuard(${local_id})`;
    case "Remainder": {
      const fsi = self.data._0;
      return `Remainder { block: ${local_id}, first_statement_index: ${FirstStatementIndex.as_u32(fsi)}}`;
    }
  }
}

// compilation error if size of `ScopeData` is not the same as a `u32`
// (`static_assert_size!(ScopeData, 4)`: no TS counterpart.)

// rustc: compiler/rustc_middle/src/middle/region.rs:172 hir_id
Scope.prototype.hir_id = function (this: Scope, scope_tree: ScopeTree): HirId | undefined {
  const hir_id = scope_tree.root_body;
  return hir_id === undefined ? undefined : new HirId(hir_id.owner, this.local_id);
};

/// Returns the span of this `Scope`. Note that in general the
/// returned span may not correspond to the span of any `NodeId` in
/// the AST.
// rustc: compiler/rustc_middle/src/middle/region.rs:179 span
Scope.prototype.span = function (this: Scope, tcx: TyCtxt, scope_tree: ScopeTree): Span {
  const hir_id = this.hir_id(scope_tree);
  if (hir_id === undefined) {
    return DUMMY_SP;
  }
  const span = tcx.hir_span(hir_id);
  if (this.data.$ === "Remainder") {
    const first_statement_index = this.data._0;
    // Want span for scope starting after the
    // indexed statement and ending at end of
    // `blk`; reuse span of `blk` and shift `lo`
    // forward to end of indexed statement.
    //
    // (This is the special case alluded to in the
    // doc-comment for this method)
    const node = tcx.hir_node(hir_id);
    if (node.$ === "Block") {
      const blk = node._0;
      const stmt_span = blk.stmts[FirstStatementIndex.as_usize(first_statement_index)]!.span;

      // To avoid issues with macro-generated spans, the span
      // of the statement must be nested in that of the block.
      if (Span.lo(span) <= Span.lo(stmt_span) && Span.lo(stmt_span) <= Span.hi(span)) {
        return Span.with_lo(span, Span.lo(stmt_span));
      }
    }
  }
  return span;
};

/// The region scope tree encodes information about region relationships.
Object.assign(ScopeTree, {
  /** `#[derive(Default)]`. PORT: `FxIndexMap<Scope, Scope>` keys compare by value: a `KeyedMap` on `key_Scope`. */
  default_(): ScopeTree {
    return new ScopeTree(undefined, new KeyedMap<Scope, Scope>(key_Scope), new Map(), new Map(), new Map());
  },
});

// rustc: compiler/rustc_middle/src/middle/region.rs:249 record_scope_parent
ScopeTree.prototype.record_scope_parent = function (this: ScopeTree, child: Scope, parent: Scope | undefined): void {
  // debug!("{:?}.parent = {:?}", child, parent);

  if (parent !== undefined) {
    const p = parent;
    // `self.parent_map.insert(child, p)`: the previous value
    const prev = this.parent_map.get(child);
    this.parent_map.set(child, p);
    assert(prev === undefined, "assertion failed: prev.is_none()");
  }
};

// rustc: compiler/rustc_middle/src/middle/region.rs:258 record_var_scope
ScopeTree.prototype.record_var_scope = function (this: ScopeTree, var_: ItemLocalId, lifetime: Scope): void {
  // debug!("record_var_scope(sub={:?}, sup={:?})", var, lifetime);
  assert(var_ !== lifetime.local_id, "assertion failed: var != lifetime.local_id");
  this.var_map.set(var_, lifetime);
};

/// Make an association between a sub-expression and an extended lifetime
// rustc: compiler/rustc_middle/src/middle/region.rs:265 record_extended_temp_scope
ScopeTree.prototype.record_extended_temp_scope = function (
  this: ScopeTree,
  var_: ItemLocalId,
  lifetime: Scope | undefined,
): void {
  // debug!(?var, ?lifetime);
  if (lifetime !== undefined) {
    assert(var_ !== lifetime.local_id, "assertion failed: var != lifetime.local_id");
  }
  this.extended_temp_scopes.set(var_, lifetime);
};

/// Returns the narrowest scope that encloses `id`, if any.
// rustc: compiler/rustc_middle/src/middle/region.rs:274 opt_encl_scope
ScopeTree.prototype.opt_encl_scope = function (this: ScopeTree, id: Scope): Scope | undefined {
  const s = this.parent_map.get(id);
  return s === undefined ? undefined : clone_Scope(s);
};

/// Returns the lifetime of the local variable `var_id`, if any.
// rustc: compiler/rustc_middle/src/middle/region.rs:279 var_scope
ScopeTree.prototype.var_scope = function (this: ScopeTree, var_id: ItemLocalId): Scope | undefined {
  const s = this.var_map.get(var_id);
  return s === undefined ? undefined : clone_Scope(s);
};

/// Returns `true` if `subscope` is equal to or is lexically nested inside `superscope`, and
/// `false` otherwise.
///
/// Used by clippy.
// rustc: compiler/rustc_middle/src/middle/region.rs:287 is_subscope_of
ScopeTree.prototype.is_subscope_of = function (this: ScopeTree, subscope: Scope, superscope: Scope): boolean {
  let s = subscope;
  // debug!("is_subscope_of({:?}, {:?})", subscope, superscope);
  while (!Scope_eq(superscope, s)) {
    const scope = this.opt_encl_scope(s);
    if (scope === undefined) {
      // debug!("is_subscope_of({:?}, {:?}, s={:?})=false", subscope, superscope, s);
      return false;
    }
    s = scope;
  }

  // debug!("is_subscope_of({:?}, {:?})=true", subscope, superscope);

  return true;
};

/// Returns the scope of non-lifetime-extended temporaries within a given scope, as well as
/// whether we've recorded a potential backwards-incompatible change to lint on.
/// Panics if no enclosing temporary scope is found.
// rustc: compiler/rustc_middle/src/middle/region.rs:308 default_temporary_scope
ScopeTree.prototype.default_temporary_scope = function (this: ScopeTree, inner: Scope): [Scope, Scope | undefined] {
  let id = inner;
  let backwards_incompatible: Scope | undefined = undefined;

  let p: Scope | undefined;
  while ((p = this.parent_map.get(id)) !== undefined) {
    switch (p.data.$) {
      case "Destruction":
        // debug!("temporary_scope({inner:?}) = {id:?} [enclosing]");
        return [id, backwards_incompatible];
      case "IfThenRescope":
      case "MatchGuard":
        // debug!("temporary_scope({inner:?}) = {p:?} [enclosing]");
        return [p, backwards_incompatible];
      case "Node":
      case "CallSite":
      case "Arguments":
      case "IfThen":
      case "Remainder":
        // If we haven't already passed through a backwards-incompatible node,
        // then check if we are passing through one now and record it if so.
        // This is for now only working for cases where a temporary lifetime is
        // *shortened*.
        if (backwards_incompatible === undefined) {
          backwards_incompatible = this.backwards_incompatible_scope.get(p.local_id);
        }
        id = p;
    }
  }

  return span_bug(
    with_((tcx) => inner.span(tcx, this)),
    "no enclosing temporary scope",
  );
};

/// Returns the scope when the temp created by `expr_id` will be cleaned up.
/// It also emits a lint on potential backwards incompatible change to the temporary scope
/// which is *for now* always shortening.
// rustc: compiler/rustc_middle/src/middle/region.rs:346 temporary_scope
ScopeTree.prototype.temporary_scope = function (this: ScopeTree, expr_id: ItemLocalId): TempLifetime {
  // Check for a designated extended temporary scope.
  // PORT: `ItemLocalMap<Option<Scope>>`: `has` tells a recorded `None` from a missing entry.
  if (this.extended_temp_scopes.has(expr_id)) {
    const s = this.extended_temp_scopes.get(expr_id);
    // debug!("temporary_scope({expr_id:?}) = {s:?} [custom]");
    return { temp_lifetime: s, backwards_incompatible: undefined };
  }

  // Otherwise, locate the innermost terminating scope.
  const [scope, backwards_incompatible] = this.default_temporary_scope(new Scope(expr_id, ScopeData.Node));
  return { temp_lifetime: scope, backwards_incompatible };
};

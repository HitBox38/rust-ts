// Port of compiler/rustc_expand/src/placeholders.rs
//
// PORT: `MutVisitor` hooks receive the node object and edit it in place (src/rustc_ast/mut_visit.ts);
// `*expr = new_expr` (a whole-node replacement) is `Object.assign(expr, new_expr)`.
import {
  type Arm,
  type AssocItem,
  type AssocItemKind,
  type AttrVec,
  type Crate,
  DelimArgs,
  DUMMY_NODE_ID,
  Expr,
  type ExprField,
  FieldDef,
  type ForeignItem,
  type ForeignItemKind,
  GenericParam,
  Item,
  MacCall,
  type NodeId,
  Param,
  Pat,
  type PatField,
  Path,
  Stmt,
  Ty,
  type Variant,
  type Visibility,
  type WherePredicate,
} from "../rustc_ast/lib.ts";
import {
  MutVisitor,
  walk_crate,
  walk_expr,
  walk_filter_map_expr,
  walk_flat_map_arm,
  walk_flat_map_assoc_item,
  walk_flat_map_expr_field,
  walk_flat_map_field_def,
  walk_flat_map_foreign_item,
  walk_flat_map_generic_param,
  walk_flat_map_item,
  walk_flat_map_param,
  walk_flat_map_pat_field,
  walk_flat_map_stmt,
  walk_flat_map_variant,
  walk_flat_map_where_predicate,
  walk_pat,
  walk_ty,
} from "../rustc_ast/mut_visit.ts";
import { DelimSpan, TokenStream } from "../rustc_ast/tokenstream.ts";
import type { AssocCtxt } from "../rustc_ast/visit.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { Ident } from "../rustc_span/symbol.ts";
import { unwrap } from "../std/panic.ts";
import { AstFragment, type AstFragmentKind } from "./expand.ts";

// rustc: compiler/rustc_expand/src/placeholders.rs:12 placeholder
export function placeholder(kind: AstFragmentKind, id: NodeId, vis: Visibility | undefined): AstFragment {
  // rustc: compiler/rustc_expand/src/placeholders.rs:17 mac_placeholder
  function mac_placeholder(): MacCall {
    return new MacCall(
      new Path(DUMMY_SP, []),
      new DelimArgs(DelimSpan.dummy(), { $: "Parenthesis" }, TokenStream.new([])),
    );
  }

  const ident = Ident.dummy();
  const attrs: AttrVec = [];
  const vis_: Visibility = vis ?? { span: DUMMY_SP, kind: { $: "Inherited" } };
  const span = DUMMY_SP;
  const expr_placeholder = (): Expr => new Expr(id, { $: "MacCall", _0: mac_placeholder() }, span, [], undefined);
  const ty = (): Ty => new Ty(id, { $: "MacCall", _0: mac_placeholder() }, span);
  const pat = (): Pat => new Pat(id, { $: "MacCall", _0: mac_placeholder() }, span);

  switch (kind) {
    case "Crate":
      return {
        $: "Crate",
        _0: {
          attrs: [],
          items: [],
          spans: { inner_span: span, inject_use_span: DUMMY_SP },
          id,
          is_placeholder: true,
        },
      };
    case "Expr":
      return { $: "Expr", _0: expr_placeholder() };
    case "OptExpr":
      return { $: "OptExpr", _0: expr_placeholder() };
    case "MethodReceiverExpr":
      return { $: "MethodReceiverExpr", _0: expr_placeholder() };
    case "Items":
      return {
        $: "Items",
        _0: [new Item(attrs, id, span, vis_, { $: "MacCall", _0: mac_placeholder() }, undefined)],
      };
    case "TraitItems":
      return {
        $: "TraitItems",
        _0: [new Item<AssocItemKind>(attrs, id, span, vis_, { $: "MacCall", _0: mac_placeholder() }, undefined)],
      };
    case "ImplItems":
      return {
        $: "ImplItems",
        _0: [new Item<AssocItemKind>(attrs, id, span, vis_, { $: "MacCall", _0: mac_placeholder() }, undefined)],
      };
    case "TraitImplItems":
      return {
        $: "TraitImplItems",
        _0: [new Item<AssocItemKind>(attrs, id, span, vis_, { $: "MacCall", _0: mac_placeholder() }, undefined)],
      };
    case "ForeignItems":
      return {
        $: "ForeignItems",
        _0: [new Item<ForeignItemKind>(attrs, id, span, vis_, { $: "MacCall", _0: mac_placeholder() }, undefined)],
      };
    case "Pat":
      return { $: "Pat", _0: new Pat(id, { $: "MacCall", _0: mac_placeholder() }, span) };
    case "Ty":
      return { $: "Ty", _0: new Ty(id, { $: "MacCall", _0: mac_placeholder() }, span) };
    case "Stmts": {
      const mac = {
        mac: mac_placeholder(),
        style: "Braces" as const,
        attrs: [],
        tokens: undefined,
      };
      return { $: "Stmts", _0: [new Stmt(id, { $: "MacCall", _0: mac }, span)] };
    }
    case "Arms":
      return {
        $: "Arms",
        _0: [
          {
            attrs: [],
            body: expr_placeholder(),
            guard: undefined,
            id,
            pat: pat(),
            span,
            is_placeholder: true,
          },
        ],
      };
    case "ExprFields":
      return {
        $: "ExprFields",
        _0: [
          {
            attrs: [],
            expr: expr_placeholder(),
            id,
            ident,
            is_shorthand: false,
            span,
            is_placeholder: true,
          },
        ],
      };
    case "PatFields":
      return {
        $: "PatFields",
        _0: [
          {
            attrs: [],
            id,
            ident,
            is_shorthand: false,
            pat: pat(),
            span,
            is_placeholder: true,
          },
        ],
      };
    case "GenericParams":
      return {
        $: "GenericParams",
        _0: [new GenericParam(id, ident, [], [], true, { $: "Lifetime" }, undefined)],
      };
    case "Params":
      return { $: "Params", _0: [new Param([], ty(), pat(), id, span, true)] };
    case "FieldDefs":
      return { $: "FieldDefs", _0: [new FieldDef([], id, span, vis_, undefined, undefined, ty(), true)] };
    case "Variants":
      return {
        $: "Variants",
        _0: [
          {
            attrs: [],
            data: {
              $: "Struct",
              fields: [],
              recovered: { $: "No" },
            },
            disr_expr: undefined,
            id,
            ident,
            span,
            vis: vis_,
            is_placeholder: true,
          },
        ],
      };
    case "WherePredicates":
      return {
        $: "WherePredicates",
        _0: [
          {
            attrs: [],
            id,
            span,
            kind: {
              $: "BoundPredicate",
              _0: {
                bound_generic_params: [],
                bounded_ty: ty(),
                bounds: [],
              },
            },
            is_placeholder: true,
          },
        ],
      };
  }
}

export class PlaceholderExpander extends MutVisitor {
  constructor(public expanded_fragments: Map<NodeId, AstFragment>) {
    super();
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:211 with_capacity
  static with_capacity(_capacity: number): PlaceholderExpander {
    return new PlaceholderExpander(new Map());
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:217 add
  add(id: NodeId, fragment: AstFragment): void {
    AstFragment.mut_visit_with(fragment, this);
    this.expanded_fragments.set(id, fragment);
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:222 remove
  private remove(id: NodeId): AstFragment {
    const fragment = this.expanded_fragments.get(id);
    this.expanded_fragments.delete(id);
    return unwrap(fragment);
  }

  // impl MutVisitor for PlaceholderExpander
  // rustc: compiler/rustc_expand/src/placeholders.rs:228 flat_map_arm
  override flat_map_arm(arm: Arm): Arm[] {
    if (arm.is_placeholder) {
      return AstFragment.make_arms(this.remove(arm.id));
    } else {
      return walk_flat_map_arm(this, arm);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:236 flat_map_expr_field
  override flat_map_expr_field(field: ExprField): ExprField[] {
    if (field.is_placeholder) {
      return AstFragment.make_expr_fields(this.remove(field.id));
    } else {
      return walk_flat_map_expr_field(this, field);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:244 flat_map_pat_field
  override flat_map_pat_field(fp: PatField): PatField[] {
    if (fp.is_placeholder) {
      return AstFragment.make_pat_fields(this.remove(fp.id));
    } else {
      return walk_flat_map_pat_field(this, fp);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:252 flat_map_generic_param
  override flat_map_generic_param(param: GenericParam): GenericParam[] {
    if (param.is_placeholder) {
      return AstFragment.make_generic_params(this.remove(param.id));
    } else {
      return walk_flat_map_generic_param(this, param);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:263 flat_map_param
  override flat_map_param(p: Param): Param[] {
    if (p.is_placeholder) {
      return AstFragment.make_params(this.remove(p.id));
    } else {
      return walk_flat_map_param(this, p);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:271 flat_map_field_def
  override flat_map_field_def(sf: FieldDef): FieldDef[] {
    if (sf.is_placeholder) {
      return AstFragment.make_field_defs(this.remove(sf.id));
    } else {
      return walk_flat_map_field_def(this, sf);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:279 flat_map_variant
  override flat_map_variant(variant: Variant): Variant[] {
    if (variant.is_placeholder) {
      return AstFragment.make_variants(this.remove(variant.id));
    } else {
      return walk_flat_map_variant(this, variant);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:287 flat_map_where_predicate
  override flat_map_where_predicate(predicate: WherePredicate): WherePredicate[] {
    if (predicate.is_placeholder) {
      return AstFragment.make_where_predicates(this.remove(predicate.id));
    } else {
      return walk_flat_map_where_predicate(this, predicate);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:298 flat_map_item
  override flat_map_item(item: Item): Item[] {
    switch (item.kind.$) {
      case "MacCall":
        return AstFragment.make_items(this.remove(item.id));
      default:
        return walk_flat_map_item(this, item);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:305 flat_map_assoc_item
  override flat_map_assoc_item(item: AssocItem, ctxt: AssocCtxt): AssocItem[] {
    switch (item.kind.$) {
      case "MacCall": {
        const it = this.remove(item.id);
        if (ctxt.$ === "Trait") {
          return AstFragment.make_trait_items(it);
        } else if (!ctxt.of_trait) {
          return AstFragment.make_impl_items(it);
        } else {
          return AstFragment.make_trait_impl_items(it);
        }
      }
      default:
        return walk_flat_map_assoc_item(this, item, ctxt);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:323 flat_map_foreign_item
  override flat_map_foreign_item(item: ForeignItem): ForeignItem[] {
    switch (item.kind.$) {
      case "MacCall":
        return AstFragment.make_foreign_items(this.remove(item.id));
      default:
        return walk_flat_map_foreign_item(this, item);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:333 visit_expr
  override visit_expr(expr: Expr): void {
    switch (expr.kind.$) {
      case "MacCall":
        Object.assign(expr, AstFragment.make_expr(this.remove(expr.id)));
        return;
      default:
        return walk_expr(this, expr);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:340 visit_method_receiver_expr
  override visit_method_receiver_expr(expr: Expr): void {
    switch (expr.kind.$) {
      case "MacCall":
        Object.assign(expr, AstFragment.make_method_receiver_expr(this.remove(expr.id)));
        return;
      default:
        return walk_expr(this, expr);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:347 filter_map_expr
  override filter_map_expr(expr: Expr): Expr | undefined {
    switch (expr.kind.$) {
      case "MacCall":
        return AstFragment.make_opt_expr(this.remove(expr.id));
      default:
        return walk_filter_map_expr(this, expr);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:354 flat_map_stmt
  override flat_map_stmt(stmt: Stmt): Stmt[] {
    let style;
    let stmts: Stmt[];
    if (stmt.kind.$ === "MacCall") {
      const mac = stmt.kind._0;
      [style, stmts] = [mac.style, AstFragment.make_stmts(this.remove(stmt.id))];
    } else {
      return walk_flat_map_stmt(this, stmt);
    }

    if (style === "Semicolon") {
      // Implement the proposal described in
      // https://github.com/rust-lang/rust/issues/61733#issuecomment-509626449
      //
      // The macro invocation expands to the list of statements. If the
      // list of statements is empty, then 'parse' the trailing semicolon
      // on the original invocation as an empty statement. That is:
      //
      // `empty();` is parsed as a single `StmtKind::Empty`
      //
      // If the list of statements is non-empty, see if the final
      // statement already has a trailing semicolon.
      //
      // If it doesn't have a semicolon, then 'parse' the trailing
      // semicolon from the invocation as part of the final statement,
      // using `stmt.add_trailing_semicolon()`
      //
      // If it does have a semicolon, then 'parse' the trailing semicolon
      // from the invocation as a new StmtKind::Empty

      // FIXME: We will need to preserve the original semicolon token and
      // span as part of #15701
      const empty_stmt = new Stmt(DUMMY_NODE_ID, { $: "Empty" }, DUMMY_SP);

      const stmt = stmts.pop();
      if (stmt !== undefined) {
        if (stmt.has_trailing_semicolon()) {
          stmts.push(stmt);
          stmts.push(empty_stmt);
        } else {
          stmts.push(stmt.add_trailing_semicolon());
        }
      } else {
        stmts.push(empty_stmt);
      }
    }

    return stmts;
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:400 visit_pat
  override visit_pat(pat: Pat): void {
    switch (pat.kind.$) {
      case "MacCall":
        Object.assign(pat, AstFragment.make_pat(this.remove(pat.id)));
        return;
      default:
        return walk_pat(this, pat);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:407 visit_ty
  override visit_ty(ty: Ty): void {
    switch (ty.kind.$) {
      case "MacCall":
        Object.assign(ty, AstFragment.make_ty(this.remove(ty.id)));
        return;
      default:
        return walk_ty(this, ty);
    }
  }

  // rustc: compiler/rustc_expand/src/placeholders.rs:414 visit_crate
  override visit_crate(krate: Crate): void {
    if (krate.is_placeholder) {
      Object.assign(krate, AstFragment.make_crate(this.remove(krate.id)));
    } else {
      walk_crate(this, krate);
    }
  }
}

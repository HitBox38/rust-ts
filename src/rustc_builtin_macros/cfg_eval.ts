// Port of compiler/rustc_builtin_macros/src/cfg_eval.rs
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { ast, mut_visit, visit } from "../rustc_ast/lib.ts";
import { HasAttrs, HasTokens } from "../rustc_ast/lib.ts";
import type { Attribute, NodeId } from "../rustc_ast/lib.ts";
import type { AssocCtxt } from "../rustc_ast/visit.gen.ts";
import type { PResult } from "../rustc_errors/lib.ts";
import { Annotatable, type ExtCtxt } from "../rustc_expand/base.ts";
import { StripUnconfigured } from "../rustc_expand/config.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import { parser as rustc_parse_parser } from "../rustc_parse/lib.ts";
import { AllowConstBlockItems, ForceCollect } from "../rustc_parse/parser/mod.gen.ts";
import type { Session } from "../rustc_session/session.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { unreachable } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import { check_builtin_macro_attribute, warn_on_duplicate_attribute } from "./util.ts";

// rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:20 expand
export function expand(ecx: ExtCtxt, _span: Span, meta_item: ast.MetaItem, annotatable: Annotatable): Annotatable[] {
  check_builtin_macro_attribute(ecx, meta_item, sym.cfg_eval);
  warn_on_duplicate_attribute(ecx, annotatable, sym.cfg_eval);
  return [cfg_eval(ecx.sess, ecx.ecfg.features, annotatable, ecx.current_expansion.lint_node_id)];
}

// rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:31 cfg_eval
export function cfg_eval(sess: Session, features_: Features, annotatable: Annotatable, lint_node_id: NodeId): Annotatable {
  const features = features_;
  return new CfgEval(new StripUnconfigured(sess, features, true, lint_node_id)).configure_annotatable(annotatable);
}

// rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:44 has_cfg_or_cfg_attr
function has_cfg_or_cfg_attr(annotatable: Annotatable): boolean {
  class CfgFinder extends visit.Visitor<ControlFlow<null>> {
    override Result = VisitorResult.ControlFlow<null>();
    // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:49 visit_attribute
    override visit_attribute(attr: Attribute): ControlFlow<null> {
      const name = attr.name();
      if (name !== undefined && (name === sym.cfg || name === sym.cfg_attr)) {
        return ControlFlow.Break(null);
      } else {
        return ControlFlow.CONTINUE;
      }
    }
  }

  let res: ControlFlow<null>;
  switch (annotatable.$) {
    case "Item":
      res = new CfgFinder().visit_item(annotatable._0);
      break;
    case "AssocItem":
      res = new CfgFinder().visit_assoc_item(annotatable._0, annotatable._1);
      break;
    case "ForeignItem":
      res = new CfgFinder().visit_foreign_item(annotatable._0);
      break;
    case "Stmt":
      res = new CfgFinder().visit_stmt(annotatable._0);
      break;
    case "Expr":
      res = new CfgFinder().visit_expr(annotatable._0);
      break;
    default:
      return unreachable();
  }
  return res.$ === "Break";
}

// PORT: `struct CfgEval<'a>(StripUnconfigured<'a>)` with `impl MutVisitor for CfgEval` -> a subclass of
// the `MutVisitor` base class; the tuple field is `_0`. The inherent `impl CfgEval` (line 69) and the
// `MutVisitor` impl (line 154) are in the class body, in upstream order; the struct (line 42) is
// placed after `has_cfg_or_cfg_attr` (line 44), which only it uses.
class CfgEval extends mut_visit.MutVisitor {
  constructor(public _0: StripUnconfigured) {
    super();
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:70 configure
  // PORT: `T: HasTokens` (and `StripUnconfigured::configure`'s `HasAttrs`) as impl tables.
  configure<T>(node: T, T_HasTokens: HasTokens<T>, T_HasAttrs: HasAttrs<T>): T | undefined {
    return this._0.configure(node, T_HasTokens, T_HasAttrs);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:74 configure_annotatable
  configure_annotatable(annotatable: Annotatable): Annotatable {
    // Tokenizing and re-parsing the `Annotatable` can have a significant
    // performance impact, so try to avoid it if possible
    if (!has_cfg_or_cfg_attr(annotatable)) {
      return annotatable;
    }

    // The majority of parsed attribute targets will never need to have early cfg-expansion
    // run (e.g. they are not part of a `#[derive]` or `#[cfg_eval]` macro input).
    // Therefore, we normally do not capture the necessary information about `#[cfg]`
    // and `#[cfg_attr]` attributes during parsing.
    //
    // Therefore, when we actually *do* run early cfg-expansion, we need to tokenize
    // and re-parse the attribute target, this time capturing information about
    // the location of `#[cfg]` and `#[cfg_attr]` in the token stream. The tokenization
    // process is lossless, so this process is invisible to proc-macros.

    // Interesting cases:
    //
    // ```rust
    // #[cfg_eval] #[cfg] $item
    //```
    //
    // where `$item` is `#[cfg_attr] struct Foo {}`. We want to make
    // sure to evaluate *all* `#[cfg]` and `#[cfg_attr]` attributes - the simplest
    // way to do this is to do a single parse of the token stream.
    const orig_tokens = Annotatable.to_tokens(annotatable);

    // Re-parse the tokens, setting the `capture_cfg` flag to save extra information
    // to the captured `AttrTokenStream` (specifically, we capture
    // `AttrTokenTree::AttrsTarget` for all occurrences of `#[cfg]` and `#[cfg_attr]`)
    //
    // After that we have our re-parsed `AttrTokenStream`, recursively configuring
    // our attribute target will correctly configure the tokens as well.
    const parser = rustc_parse_parser.Parser.new(this._0.sess.psess, orig_tokens, undefined);
    parser.capture_cfg = true;
    // `try { .. }` block: `?` leaves the block with the `Err`.
    const res = ((): PResult<Annotatable | undefined> => {
      switch (annotatable.$) {
        case "Item": {
          const r = parser.parse_item(ForceCollect.Yes, AllowConstBlockItems.Yes);
          if (r.$ === "Err") return r;
          const item = r._0;
          if (item === undefined) return Ok(undefined);
          const it = this.flat_map_item(item).pop();
          return Ok(it === undefined ? undefined : { $: "Item", _0: it });
        }
        case "AssocItem": {
          const ctxt = annotatable._1;
          const r = parser.parse_trait_item(ForceCollect.Yes);
          if (r.$ === "Err") return r;
          // `.flatten()`
          const item = r._0 === undefined ? undefined : r._0._0;
          if (item === undefined) return Ok(undefined);
          const it = this.flat_map_assoc_item(item, ctxt).pop();
          return Ok(it === undefined ? undefined : { $: "AssocItem", _0: it, _1: ctxt });
        }
        case "ForeignItem": {
          const r = parser.parse_foreign_item(ForceCollect.Yes);
          if (r.$ === "Err") return r;
          // `.flatten()`
          const item = r._0 === undefined ? undefined : r._0._0;
          if (item === undefined) return Ok(undefined);
          const it = this.flat_map_foreign_item(item).pop();
          return Ok(it === undefined ? undefined : { $: "ForeignItem", _0: it });
        }
        case "Stmt": {
          const r = parser.parse_stmt_without_recovery(false, ForceCollect.Yes, false);
          if (r.$ === "Err") return r;
          const stmt = r._0;
          const s = this.flat_map_stmt(stmt).pop();
          return Ok(s === undefined ? undefined : { $: "Stmt", _0: s });
        }
        case "Expr": {
          const r = parser.parse_expr_force_collect();
          if (r.$ === "Err") return r;
          const expr = r._0;
          this.visit_expr(expr);
          return Ok({ $: "Expr", _0: expr });
        }
        default:
          return unreachable();
      }
    })();

    if (res.$ === "Ok") {
      const ann = res._0;
      if (ann !== undefined) return ann;
      // Parser recovery may emit errors without reconstructing an annotatable.
      // Keep the original node so cfg-eval stays best-effort instead of ICEing.
      return annotatable;
    } else {
      const err = res._0;
      err.emit();
      return annotatable;
    }
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:156 visit_expr
  override visit_expr(expr: ast.Expr): void {
    this._0.configure_expr(expr, false);
    mut_visit.walk_expr(this, expr);
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:162 visit_method_receiver_expr
  override visit_method_receiver_expr(expr: ast.Expr): void {
    this._0.configure_expr(expr, true);
    mut_visit.walk_expr(this, expr);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:167 filter_map_expr
  override filter_map_expr(expr_: ast.Expr): ast.Expr | undefined {
    // `configure!(self, expr)`
    const expr = this.configure(expr_, HasTokens.Expr, HasAttrs.Expr);
    if (expr === undefined) return undefined;
    mut_visit.walk_expr(this, expr);
    return expr;
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:173 flat_map_generic_param
  override flat_map_generic_param(param_: ast.GenericParam): ast.GenericParam[] {
    const param = this.configure(param_, HasTokens.GenericParam, HasAttrs.GenericParam);
    if (param === undefined) return [];
    return mut_visit.walk_flat_map_generic_param(this, param);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:181 flat_map_stmt
  override flat_map_stmt(stmt_: ast.Stmt): ast.Stmt[] {
    const stmt = this.configure(stmt_, HasTokens.Stmt, HasAttrs.Stmt);
    if (stmt === undefined) return [];
    return mut_visit.walk_flat_map_stmt(this, stmt);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:186 flat_map_item
  override flat_map_item(item_: ast.Item): ast.Item[] {
    const item = this.configure(item_, HasTokens.Item, HasAttrs.Item);
    if (item === undefined) return [];
    return mut_visit.walk_flat_map_item(this, item);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:191 flat_map_assoc_item
  override flat_map_assoc_item(item_: ast.AssocItem, ctxt: AssocCtxt): ast.AssocItem[] {
    const item = this.configure(item_, HasTokens.AssocItem, HasAttrs.AssocItem);
    if (item === undefined) return [];
    return mut_visit.walk_flat_map_assoc_item(this, item, ctxt);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:200 flat_map_foreign_item
  override flat_map_foreign_item(foreign_item_: ast.ForeignItem): ast.ForeignItem[] {
    const foreign_item = this.configure(foreign_item_, HasTokens.ForeignItem, HasAttrs.ForeignItem);
    if (foreign_item === undefined) return [];
    return mut_visit.walk_flat_map_foreign_item(this, foreign_item);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:208 flat_map_arm
  override flat_map_arm(arm_: ast.Arm): ast.Arm[] {
    const arm = this.configure(arm_, HasTokens.Arm, HasAttrs.Arm);
    if (arm === undefined) return [];
    return mut_visit.walk_flat_map_arm(this, arm);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:213 flat_map_expr_field
  override flat_map_expr_field(field_: ast.ExprField): ast.ExprField[] {
    const field = this.configure(field_, HasTokens.ExprField, HasAttrs.ExprField);
    if (field === undefined) return [];
    return mut_visit.walk_flat_map_expr_field(this, field);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:218 flat_map_pat_field
  override flat_map_pat_field(fp_: ast.PatField): ast.PatField[] {
    const fp = this.configure(fp_, HasTokens.PatField, HasAttrs.PatField);
    if (fp === undefined) return [];
    return mut_visit.walk_flat_map_pat_field(this, fp);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:223 flat_map_param
  override flat_map_param(p_: ast.Param): ast.Param[] {
    const p = this.configure(p_, HasTokens.Param, HasAttrs.Param);
    if (p === undefined) return [];
    return mut_visit.walk_flat_map_param(this, p);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:228 flat_map_field_def
  override flat_map_field_def(sf_: ast.FieldDef): ast.FieldDef[] {
    const sf = this.configure(sf_, HasTokens.FieldDef, HasAttrs.FieldDef);
    if (sf === undefined) return [];
    return mut_visit.walk_flat_map_field_def(this, sf);
  }

  // rustc: compiler/rustc_builtin_macros/src/cfg_eval.rs:233 flat_map_variant
  override flat_map_variant(variant_: ast.Variant): ast.Variant[] {
    const variant = this.configure(variant_, HasTokens.Variant, HasAttrs.Variant);
    if (variant === undefined) return [];
    return mut_visit.walk_flat_map_variant(this, variant);
  }
}

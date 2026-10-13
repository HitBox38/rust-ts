//! Implementation of the early lint pass.
//!
//! The early lint pass works on AST nodes after macro expansion and name
//! resolution, just before AST lowering. These lints are for purely
//! syntactical lints.
//
// Port of compiler/rustc_lint/src/early.rs.
//
// PORT: `lint_callback!(cx, check_x, args)` → `EarlyLintPass_provided.check_x(cx.pass, cx.context, args)` (the
// pass's own method if it has one, else the trait default). The `impl_early_lint_pass!` expansion of
// `RuntimeCombinedEarlyLintPass` installs one method per `EARLY_LINT_METHODS` entry.
import {
  type ast,
  type AttrVec,
  CRATE_NODE_ID,
  DUMMY_NODE_ID,
  HasAttrs,
  type NodeId,
  visit as ast_visit,
} from "../rustc_ast/lib.ts";
import { type LintBuffer, LintBuffer_default } from "../rustc_errors/lib.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import type { LintVec, RegisteredTools } from "../rustc_lint_defs/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import { assert, panic } from "../std/panic.ts";
import { type EarlyLintPassFactory, EarlyContext, type LintStore } from "./context.ts";
import { DiagAndSess_diagnostic } from "./early/diagnostics.ts";
import { EARLY_LINT_METHODS, type EarlyLintPass, EarlyLintPass_provided, type EarlyLintPassObject } from "./passes.ts";

export * as diagnostics from "./early/diagnostics.ts";

/// Implements the AST traversal for early lint passes. `T` provides the
/// `check_*` methods.
class EarlyContextAndPass<T extends EarlyLintPass> extends ast_visit.Visitor {
  constructor(
    public context: EarlyContext,
    public pass: T,
  ) {
    super();
  }

  // rustc: compiler/rustc_lint/src/early.rs:35 check_id
  check_id(id: NodeId): void {
    for (const early_lint of this.context.buffered.take(id)) {
      const { span, node_id: _, lint_id, diagnostic } = early_lint;
      this.context.opt_span_lint(lint_id.lint, span, DiagAndSess_diagnostic({ callback: diagnostic._0, sess: this.context.sess() }));
    }
  }

  /// Merge the lints specified by any lint attributes into the
  /// current lint context, call the provided function, then reset the
  /// lints in effect to their previous state.
  // rustc: compiler/rustc_lint/src/early.rs:49 with_lint_attrs
  with_lint_attrs(id: NodeId, attrs: readonly ast.Attribute[], f: (cx: this) => void): void {
    const is_crate_node = id === CRATE_NODE_ID;
    // debug!(?id);
    const push = this.context.builder.push(attrs, is_crate_node);

    // debug!("early context: enter_attrs({:?})", attrs);
    EarlyLintPass_provided.check_attributes(this.pass, this.context, attrs);
    f(this);
    // debug!("early context: exit_attrs({:?})", attrs);
    EarlyLintPass_provided.check_attributes_post(this.pass, this.context, attrs);
    this.context.builder.pop(push);
  }

  // ---- impl<'ast, 'ecx, T: EarlyLintPass> ast_visit::Visitor<'ast> for EarlyContextAndPass<'ecx, T> ----

  // rustc: compiler/rustc_lint/src/early.rs:67 visit_id
  override visit_id(id: NodeId): undefined {
    this.check_id(id);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:71 visit_param
  override visit_param(param: ast.Param): undefined {
    this.with_lint_attrs(param.id, param.attrs, (cx) => {
      EarlyLintPass_provided.check_param(cx.pass, cx.context, param);
      ast_visit.walk_param(cx, param);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:78 visit_item
  override visit_item(it: ast.Item): undefined {
    this.with_lint_attrs(it.id, it.attrs, (cx) => {
      EarlyLintPass_provided.check_item(cx.pass, cx.context, it);
      ast_visit.walk_item(cx, it, ast_visit.WalkItemKind.ItemKind);
      EarlyLintPass_provided.check_item_post(cx.pass, cx.context, it);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:86 visit_foreign_item
  override visit_foreign_item(it: ast.ForeignItem): undefined {
    this.with_lint_attrs(it.id, it.attrs, (cx) => {
      ast_visit.walk_item(cx, it, ast_visit.WalkItemKind.ForeignItemKind);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:92 visit_pat
  override visit_pat(p: ast.Pat): undefined {
    EarlyLintPass_provided.check_pat(this.pass, this.context, p);
    ast_visit.walk_pat(this, p);
    EarlyLintPass_provided.check_pat_post(this.pass, this.context, p);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:98 visit_pat_field
  override visit_pat_field(field: ast.PatField): undefined {
    this.with_lint_attrs(field.id, field.attrs, (cx) => {
      ast_visit.walk_pat_field(cx, field);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:104 visit_expr
  override visit_expr(e: ast.Expr): undefined {
    this.with_lint_attrs(e.id, e.attrs, (cx) => {
      EarlyLintPass_provided.check_expr(cx.pass, cx.context, e);
      ast_visit.walk_expr(cx, e);
      EarlyLintPass_provided.check_expr_post(cx.pass, cx.context, e);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:112 visit_expr_field
  override visit_expr_field(f: ast.ExprField): undefined {
    this.with_lint_attrs(f.id, f.attrs, (cx) => {
      ast_visit.walk_expr_field(cx, f);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:118 visit_stmt
  override visit_stmt(s: ast.Stmt): undefined {
    // Add the statement's lint attributes to our
    // current state when checking the statement itself.
    // This allows us to handle attributes like
    // `#[allow(unused_doc_comments)]`, which apply to
    // sibling attributes on the same target
    //
    // Note that statements get their attributes from
    // the AST struct that they wrap (e.g. an item)
    this.with_lint_attrs(s.id, HasAttrs.Stmt.attrs(s), (cx) => {
      EarlyLintPass_provided.check_stmt(cx.pass, cx.context, s);
      ast_visit.walk_stmt(cx, s);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:133 visit_fn
  override visit_fn(fk: ast_visit.FnKind, _: AttrVec, span: Span, id: NodeId): undefined {
    EarlyLintPass_provided.check_fn(this.pass, this.context, fk, span, id);
    ast_visit.walk_fn(this, fk);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:138 visit_field_def
  override visit_field_def(s: ast.FieldDef): undefined {
    this.with_lint_attrs(s.id, s.attrs, (cx) => {
      ast_visit.walk_field_def(cx, s);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:144 visit_variant
  override visit_variant(v: ast.Variant): undefined {
    this.with_lint_attrs(v.id, v.attrs, (cx) => {
      EarlyLintPass_provided.check_variant(cx.pass, cx.context, v);
      ast_visit.walk_variant(cx, v);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:151 visit_ty
  override visit_ty(t: ast.Ty): undefined {
    EarlyLintPass_provided.check_ty(this.pass, this.context, t);
    ast_visit.walk_ty(this, t);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:156 visit_ident
  override visit_ident(ident: Ident): undefined {
    EarlyLintPass_provided.check_ident(this.pass, this.context, ident);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:160 visit_local
  override visit_local(l: ast.Local): undefined {
    this.with_lint_attrs(l.id, l.attrs, (cx) => {
      EarlyLintPass_provided.check_local(cx.pass, cx.context, l);
      ast_visit.walk_local(cx, l);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:167 visit_block
  override visit_block(b: ast.Block): undefined {
    EarlyLintPass_provided.check_block(this.pass, this.context, b);
    ast_visit.walk_block(this, b);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:172 visit_arm
  override visit_arm(a: ast.Arm): undefined {
    this.with_lint_attrs(a.id, a.attrs, (cx) => {
      EarlyLintPass_provided.check_arm(cx.pass, cx.context, a);
      ast_visit.walk_arm(cx, a);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:179 visit_generic_arg
  override visit_generic_arg(arg: ast.GenericArg): undefined {
    EarlyLintPass_provided.check_generic_arg(this.pass, this.context, arg);
    ast_visit.walk_generic_arg(this, arg);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:184 visit_generic_param
  override visit_generic_param(param: ast.GenericParam): undefined {
    this.with_lint_attrs(param.id, param.attrs, (cx) => {
      EarlyLintPass_provided.check_generic_param(cx.pass, cx.context, param);
      ast_visit.walk_generic_param(cx, param);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:191 visit_generics
  override visit_generics(g: ast.Generics): undefined {
    EarlyLintPass_provided.check_generics(this.pass, this.context, g);
    ast_visit.walk_generics(this, g);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:196 visit_where_predicate
  override visit_where_predicate(p: ast.WherePredicate): undefined {
    EarlyLintPass_provided.check_where_predicate(this.pass, this.context, p);
    ast_visit.walk_where_predicate(this, p);
    EarlyLintPass_provided.check_where_predicate_post(this.pass, this.context, p);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:202 visit_poly_trait_ref
  override visit_poly_trait_ref(t: ast.PolyTraitRef): undefined {
    EarlyLintPass_provided.check_poly_trait_ref(this.pass, this.context, t);
    ast_visit.walk_poly_trait_ref(this, t);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:207 visit_assoc_item
  override visit_assoc_item(item: ast.AssocItem, ctxt: ast_visit.AssocCtxt): undefined {
    this.with_lint_attrs(item.id, item.attrs, (cx) => {
      switch (ctxt.$) {
        case "Trait": {
          EarlyLintPass_provided.check_trait_item(cx.pass, cx.context, item);
          break;
        }
        case "Impl": {
          EarlyLintPass_provided.check_impl_item(cx.pass, cx.context, item);
          break;
        }
      }
      ast_visit.walk_assoc_item(cx, item, ctxt, ast_visit.WalkItemKind.AssocItemKind);
      switch (ctxt.$) {
        case "Trait": {
          EarlyLintPass_provided.check_trait_item_post(cx.pass, cx.context, item);
          break;
        }
        case "Impl": {
          EarlyLintPass_provided.check_impl_item_post(cx.pass, cx.context, item);
          break;
        }
      }
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:229 visit_attribute
  override visit_attribute(attr: ast.Attribute): undefined {
    EarlyLintPass_provided.check_attribute(this.pass, this.context, attr);
    ast_visit.walk_attribute(this, attr);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:234 visit_macro_def
  override visit_macro_def(mac: ast.MacroDef): undefined {
    EarlyLintPass_provided.check_mac_def(this.pass, this.context, mac);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/early.rs:238 visit_mac_call
  override visit_mac_call(mac: ast.MacCall): undefined {
    EarlyLintPass_provided.check_mac(this.pass, this.context, mac);
    ast_visit.walk_mac(this, mac);
    return undefined;
  }
}

// Combines multiple lint passes into a single pass, at runtime. Each
// `check_foo` method in `$methods` within this pass simply calls `check_foo`
// once per `$pass`. Compare with `declare_combined_early_lint_pass`, which is
// similar, but combines lint passes at compile time.
class RuntimeCombinedEarlyLintPass implements EarlyLintPass {
  constructor(public passes: EarlyLintPassObject[]) {}

  // #[allow(rustc::lint_pass_impl_without_macro)]
  // rustc: compiler/rustc_lint/src/early.rs:254 name
  name(): string {
    return panic("explicit panic");
  }
  // rustc: compiler/rustc_lint/src/early.rs:257 get_lints
  get_lints(): LintVec {
    return panic("explicit panic");
  }
}

// macro_rules! impl_early_lint_pass { .. }  crate::early_lint_methods!(impl_early_lint_pass, []);
for (const method of EARLY_LINT_METHODS) {
  const provided = EarlyLintPass_provided[method] as (self: EarlyLintPass, ...args: unknown[]) => void;
  (RuntimeCombinedEarlyLintPass.prototype as unknown as Record<string, unknown>)[method] = function (
    this: RuntimeCombinedEarlyLintPass,
    ...args: unknown[]
  ): void {
    for (const pass of this.passes) {
      provided(pass, ...args);
    }
  };
}

/// Early lints work on different nodes - either on the crate root, or on freshly loaded modules.
/// This trait generalizes over those nodes.
export type EarlyCheckNode =
  | { readonly $: "CrateRoot"; readonly _0: ast.Crate; readonly _1: readonly ast.Attribute[] }
  | { readonly $: "LoadedMod"; readonly _0: NodeId; readonly _1: readonly ast.Attribute[]; readonly _2: readonly ast.Item[] };

export const EarlyCheckNode = {
  // rustc: compiler/rustc_lint/src/early.rs:284 id
  id(self: EarlyCheckNode): NodeId {
    switch (self.$) {
      case "CrateRoot":
        return CRATE_NODE_ID;
      case "LoadedMod":
        return self._0;
    }
  },
  // rustc: compiler/rustc_lint/src/early.rs:290 attrs
  attrs(self: EarlyCheckNode): readonly ast.Attribute[] {
    switch (self.$) {
      case "CrateRoot":
        return self._1;
      case "LoadedMod":
        return self._1;
    }
  },
  // rustc: compiler/rustc_lint/src/early.rs:296 check
  check<T extends EarlyLintPass>(self: EarlyCheckNode, cx: EarlyContextAndPass<T>): void {
    switch (self.$) {
      case "CrateRoot": {
        const crate_ = self._0;
        EarlyLintPass_provided.check_crate(cx.pass, cx.context, crate_);
        ast_visit.walk_crate(cx, crate_);
        EarlyLintPass_provided.check_crate_post(cx.pass, cx.context, crate_);
        break;
      }
      case "LoadedMod": {
        const attrs = self._1;
        const items = self._2;
        for (const attr of attrs) cx.visit_attribute(attr);
        for (const item of items) cx.visit_item(item);
        break;
      }
    }
  },
};

// rustc: compiler/rustc_lint/src/early.rs:311 check_ast_node
export function check_ast_node(
  sess: Session,
  features: Features,
  pre_expansion: boolean,
  lint_store: LintStore,
  registered_lint_tools: RegisteredTools,
  lint_buffer: LintBuffer | undefined,
  check_node: EarlyCheckNode,
): void {
  const context = EarlyContext.new(sess, features, !pre_expansion, lint_store, registered_lint_tools, lint_buffer ?? LintBuffer_default());

  let context_: EarlyContext;
  if (pre_expansion) {
    const builtin_lints = BuiltinCombinedPreExpansionLintPass().new();
    const passes = lint_store.pre_expansion_lint_passes;
    context_ = run_passes(check_node, context, builtin_lints, passes);
  } else {
    const builtin_lints = BuiltinCombinedEarlyLintPass().new();
    const passes = lint_store.early_lint_passes;
    context_ = run_passes(check_node, context, builtin_lints, passes);
  }

  // All of the buffered lints should have been emitted at this point.
  // If not, that means that we somehow buffered a lint for a node id
  // that was not lint-checked (perhaps it doesn't exist?). This is a bug.
  for (const [id, lints] of context_.buffered.map) {
    if (lints.length !== 0) {
      assert(sess.dcx().has_errors() !== undefined, `failed to process buffered lint here (dummy = ${id === DUMMY_NODE_ID})`);
      break;
    }
  }
}

// rustc: compiler/rustc_lint/src/early.rs:354 run_passes
function run_passes<T extends EarlyLintPass>(
  check_node: EarlyCheckNode,
  context: EarlyContext,
  builtin_lints: T,
  passes: readonly EarlyLintPassFactory[],
): EarlyContext {
  // Note: `passes` is often empty. In that case, it's faster to run
  // `builtin_lints` directly rather than bundling it up into the
  // `RuntimeCombinedEarlyLintPass`.
  if (passes.length === 0) {
    return run_pass(check_node, context, builtin_lints);
  } else {
    const passes_: EarlyLintPassObject[] = passes.map((mk_pass) => mk_pass());
    passes_.push(builtin_lints);
    const pass = new RuntimeCombinedEarlyLintPass(passes_);
    return run_pass(check_node, context, pass);
  }
}

// rustc: compiler/rustc_lint/src/early.rs:373 run_pass
function run_pass<T extends EarlyLintPass>(check_node: EarlyCheckNode, context: EarlyContext, pass: T): EarlyContext {
  const cx = new EarlyContextAndPass(context, pass);
  cx.with_lint_attrs(EarlyCheckNode.id(check_node), EarlyCheckNode.attrs(check_node), (cx) => EarlyCheckNode.check(check_node, cx));
  return cx.context;
}

// PORT: `crate::BuiltinCombinedPreExpansionLintPass` / `crate::BuiltinCombinedEarlyLintPass` are defined in lib.ts,
// which imports this module; they are looked up when a pass runs (after every module is loaded).
type CombinedPass = { new: () => EarlyLintPass };
let lib_passes: { pre_expansion: () => CombinedPass; early: () => CombinedPass } | undefined;
/** PORT: called by lib.ts once the combined passes exist. */
export function set_builtin_combined_passes(p: typeof lib_passes): void {
  lib_passes = p;
}
function BuiltinCombinedPreExpansionLintPass(): CombinedPass {
  return lib_passes!.pre_expansion();
}
function BuiltinCombinedEarlyLintPass(): CombinedPass {
  return lib_passes!.early();
}

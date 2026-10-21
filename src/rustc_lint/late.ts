//! Implementation of the late lint pass.
//!
//! The late lint pass Works on HIR nodes, towards the end of analysis (after
//! borrow checking, etc.). These lints have full type information available.
//
// Port of compiler/rustc_lint/src/late.rs.
//
// PORT: `lint_callback!(cx, check_x, args)` → `LateLintPass_provided.check_x(cx.pass, cx.context, args)` (the
// pass's own method if it has one, else the trait default), as early.ts. The `impl_late_lint_pass!` expansion of
// `RuntimeCombinedLateLintPass` (`crate::late_lint_methods!(impl_late_lint_pass, [])`) installs one method per
// `LATE_LINT_METHODS` entry. `Option::replace` / `Option::take` on `LateContext` fields are spelled out
// (read, then assign). `typeck_body` takes rustc_middle's pending `BodyId` stand-in: the `hir::BodyId` is cast
// (as rustc_privacy).
import { par_join } from "../rustc_data_structures/sync/parallel.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { ItemKind } from "../rustc_hir/hir.ts";
import * as hir_visit from "../rustc_hir/intravisit.ts";
import { CRATE_HIR_ID, DefId_from_OwnerId, type HirId, HirId_from_LocalModId, type OwnerId } from "../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import { All } from "../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { BodyId as MiddleBodyId } from "../rustc_middle/ty/decls.ts";
import { ParamEnv } from "../rustc_middle/ty/mod.ts";
import type { LintVec } from "../rustc_lint_defs/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { CRATE_MOD_ID, type LocalDefId, LocalModId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { panic, unwrap } from "../std/panic.ts";
import { LateContext, LintStore } from "./context.ts";
import { is_lint_pass_required } from "./lib.ts";
import { LATE_LINT_METHODS, type LateLintPass, LateLintPass_provided, type LateLintPassObject } from "./passes.ts";

/// Extract the [`LintStore`] from [`Session`].
///
/// This function exists because [`Session::lint_store`] is type-erased.
// rustc: compiler/rustc_lint/src/late.rs:25 unerased_lint_store
export function unerased_lint_store(sess: Session): LintStore {
  const store: unknown = unwrap(sess.lint_store);
  // `store.downcast_ref().unwrap()`
  if (!(store instanceof LintStore)) return panic("called `Option::unwrap()` on a `None` value");
  return store;
}

/// Implements the AST traversal for late lint passes. `T` provides the
/// `check_*` methods.
class LateContextAndPass<T extends LateLintPass> extends hir_visit.Visitor {
  // `type NestedFilter = nested_filter::All;`
  override NestedFilter = All;

  constructor(
    public context: LateContext,
    public pass: T,

    /// Rustdoc parses functions which are behind failing `#[cfg]` checks and may not pass
    /// type checking. See: <https://github.com/rust-lang/rust/pull/73566>
    /// Inlined from the session variables to avoid the indirection and cache pressure in the
    /// lint visitor.
    public actually_rustdoc: boolean,
  ) {
    super();
  }

  /// Merge the lints specified by any lint attributes into the
  /// current lint context, call the provided function, then reset the
  /// lints in effect to their previous state.
  // rustc: compiler/rustc_lint/src/late.rs:51 with_lint_attrs
  with_lint_attrs(id: HirId, f: (cx: this) => void): void {
    const attrs: readonly Attribute[] = this.context.tcx.hir_attrs(id);
    const prev = this.context.last_node_with_lint_attrs;
    this.context.last_node_with_lint_attrs = id;
    // debug!("late context: enter_attrs({:?})", attrs);
    LateLintPass_provided.check_attributes(this.pass, this.context, attrs);
    for (const attr of attrs) {
      LateLintPass_provided.check_attribute(this.pass, this.context, attr);
    }
    f(this);
    // debug!("late context: exit_attrs({:?})", attrs);
    LateLintPass_provided.check_attributes_post(this.pass, this.context, attrs);
    this.context.last_node_with_lint_attrs = prev;
  }

  // rustc: compiler/rustc_lint/src/late.rs:69 with_param_env
  with_param_env(id: OwnerId, f: (cx: this) => void): void {
    const old_param_env = this.context.param_env;
    this.context.param_env = this.context.tcx.param_env(DefId_from_OwnerId(id)) as ParamEnv;
    f(this);
    this.context.param_env = old_param_env;
  }

  // rustc: compiler/rustc_lint/src/late.rs:79 process_mod
  process_mod(module: hir.Mod, id: LocalModId): void {
    LateLintPass_provided.check_mod(this.pass, this.context, module, id);
    hir_visit.walk_mod(this, module);
  }

  // ---- impl<'tcx, T: LateLintPass<'tcx>> hir_visit::Visitor<'tcx> for LateContextAndPass<'tcx, T> ----

  /// Because lints are scoped lexically, we want to walk nested
  /// items in the context of the outer item, so enable
  /// deep-walking.
  // rustc: compiler/rustc_lint/src/late.rs:91 maybe_tcx
  override maybe_tcx(): hir_visit.HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.context.tcx);
  }

  // rustc: compiler/rustc_lint/src/late.rs:95 visit_nested_body
  override visit_nested_body(body_id: hir.BodyId): undefined {
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;

    // The body and typeck results are also set in `visit_fn`.
    // Only fetch the results if this is for a new body.
    if (!opt_body_id_eq(old_enclosing_body, body_id) && !this.actually_rustdoc) {
      const typeck_results = this.context.tcx.typeck_body(body_id as unknown as MiddleBodyId);

      // To avoid ICE, skip visiting the body if the typeck_results is tainted.
      if (typeck_results.tainted_by_errors !== undefined) {
        this.context.enclosing_body = old_enclosing_body;
        this.context.typeck_results = old_typeck_results;
        return undefined;
      }
      this.context.typeck_results = typeck_results;
    }

    const body = this.context.tcx.hir_body(body_id);
    this.visit_body(body);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:119 visit_param
  override visit_param(param: hir.Param): undefined {
    this.with_lint_attrs(param.hir_id, (cx) => {
      hir_visit.walk_param(cx, param);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:125 visit_body
  override visit_body(body: hir.Body): undefined {
    LateLintPass_provided.check_body(this.pass, this.context, body);
    hir_visit.walk_body(this, body);
    LateLintPass_provided.check_body_post(this.pass, this.context, body);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:131 visit_item
  override visit_item(it: hir.Item): undefined {
    const generics = this.context.generics;
    this.context.generics = undefined;
    this.context.generics = ItemKind.generics(it.kind);
    const old_typeck_results = this.context.typeck_results;
    this.context.typeck_results = undefined;
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = undefined;
    this.with_lint_attrs(it.hir_id(), (cx) => {
      cx.with_param_env(it.owner_id, (cx) => {
        LateLintPass_provided.check_item(cx.pass, cx.context, it);
        hir_visit.walk_item(cx, it);
        LateLintPass_provided.check_item_post(cx.pass, cx.context, it);
      });
    });
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    this.context.generics = generics;
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:148 visit_foreign_item
  override visit_foreign_item(it: hir.ForeignItem): undefined {
    this.with_lint_attrs(it.hir_id(), (cx) => {
      cx.with_param_env(it.owner_id, (cx) => {
        LateLintPass_provided.check_foreign_item(cx.pass, cx.context, it);
        hir_visit.walk_foreign_item(cx, it);
      });
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:157 visit_pat
  override visit_pat(p: hir.Pat): undefined {
    LateLintPass_provided.check_pat(this.pass, this.context, p);
    hir_visit.walk_pat(this, p);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:162 visit_lit
  override visit_lit(hir_id: HirId, lit: hir.Lit, is_negated_pat: boolean): undefined {
    LateLintPass_provided.check_lit(this.pass, this.context, hir_id, lit, is_negated_pat);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:166 visit_expr_field
  override visit_expr_field(field: hir.ExprField): undefined {
    this.with_lint_attrs(field.hir_id, (cx) => hir_visit.walk_expr_field(cx, field));
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:170 visit_expr
  override visit_expr(e: hir.Expr): undefined {
    this.with_lint_attrs(e.hir_id, (cx) => {
      LateLintPass_provided.check_expr(cx.pass, cx.context, e);
      hir_visit.walk_expr(cx, e);
      LateLintPass_provided.check_expr_post(cx.pass, cx.context, e);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:178 visit_stmt
  override visit_stmt(s: hir.Stmt): undefined {
    // See `EarlyContextAndPass::visit_stmt` for an explanation
    // of why we call `walk_stmt` outside of `with_lint_attrs`
    this.with_lint_attrs(s.hir_id, (cx) => {
      LateLintPass_provided.check_stmt(cx.pass, cx.context, s);
    });
    hir_visit.walk_stmt(this, s);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:187 visit_fn
  override visit_fn(fk: hir_visit.FnKind, decl: hir.FnDecl, body_id: hir.BodyId, span: Span, id: LocalDefId): undefined {
    // Wrap in typeck results here, not just in visit_nested_body,
    // in order for `check_fn` to be able to use them.
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    if (!this.actually_rustdoc) {
      const typeck_results = this.context.tcx.typeck_body(body_id as unknown as MiddleBodyId);

      // To avoid ICE, skip visiting the body if the typeck_results is tainted.
      if (typeck_results.tainted_by_errors !== undefined) {
        this.context.enclosing_body = old_enclosing_body;
        this.context.typeck_results = old_typeck_results;
        return undefined;
      }

      this.context.typeck_results = typeck_results;
    }
    const body = this.context.tcx.hir_body(body_id);
    LateLintPass_provided.check_fn(this.pass, this.context, fk, decl, body, span, id);
    hir_visit.walk_fn(this, fk, decl, body_id, id);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:218 visit_variant_data
  override visit_variant_data(s: hir.VariantData): undefined {
    hir_visit.walk_struct_def(this, s);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:222 visit_field_def
  override visit_field_def(s: hir.FieldDef): undefined {
    this.with_lint_attrs(s.hir_id, (cx) => {
      LateLintPass_provided.check_field_def(cx.pass, cx.context, s);
      hir_visit.walk_field_def(cx, s);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:229 visit_variant
  override visit_variant(v: hir.Variant): undefined {
    this.with_lint_attrs(v.hir_id, (cx) => {
      LateLintPass_provided.check_variant(cx.pass, cx.context, v);
      hir_visit.walk_variant(cx, v);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:236 visit_ty
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    LateLintPass_provided.check_ty(this.pass, this.context, t);
    hir_visit.walk_ty(this, t);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:241 visit_mod
  override visit_mod(m: hir.Mod, _: Span, id: LocalModId): undefined {
    if (!this.context.only_module) {
      this.process_mod(m, id);
    }
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:247 visit_local
  override visit_local(l: hir.LetStmt): undefined {
    this.with_lint_attrs(l.hir_id, (cx) => {
      LateLintPass_provided.check_local(cx.pass, cx.context, l);
      hir_visit.walk_local(cx, l);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:254 visit_block
  override visit_block(b: hir.Block): undefined {
    LateLintPass_provided.check_block(this.pass, this.context, b);
    hir_visit.walk_block(this, b);
    LateLintPass_provided.check_block_post(this.pass, this.context, b);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:260 visit_arm
  override visit_arm(a: hir.Arm): undefined {
    this.with_lint_attrs(a.hir_id, (cx) => {
      LateLintPass_provided.check_arm(cx.pass, cx.context, a);
      hir_visit.walk_arm(cx, a);
    });
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:267 visit_generic_param
  override visit_generic_param(p: hir.GenericParam): undefined {
    LateLintPass_provided.check_generic_param(this.pass, this.context, p);
    hir_visit.walk_generic_param(this, p);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:272 visit_generics
  override visit_generics(g: hir.Generics): undefined {
    LateLintPass_provided.check_generics(this.pass, this.context, g);
    hir_visit.walk_generics(this, g);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:277 visit_where_predicate
  override visit_where_predicate(p: hir.WherePredicate): undefined {
    hir_visit.walk_where_predicate(this, p);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:281 visit_poly_trait_ref
  override visit_poly_trait_ref(t: hir.PolyTraitRef): undefined {
    LateLintPass_provided.check_poly_trait_ref(this.pass, this.context, t);
    hir_visit.walk_poly_trait_ref(this, t);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:286 visit_trait_item
  override visit_trait_item(trait_item: hir.TraitItem): undefined {
    const generics = this.context.generics;
    this.context.generics = undefined;
    this.context.generics = trait_item.generics;
    this.with_lint_attrs(trait_item.hir_id(), (cx) => {
      cx.with_param_env(trait_item.owner_id, (cx) => {
        LateLintPass_provided.check_trait_item(cx.pass, cx.context, trait_item);
        hir_visit.walk_trait_item(cx, trait_item);
      });
    });
    this.context.generics = generics;
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:298 visit_impl_item
  override visit_impl_item(impl_item: hir.ImplItem): undefined {
    const generics = this.context.generics;
    this.context.generics = undefined;
    this.context.generics = impl_item.generics;
    this.with_lint_attrs(impl_item.hir_id(), (cx) => {
      cx.with_param_env(impl_item.owner_id, (cx) => {
        LateLintPass_provided.check_impl_item(cx.pass, cx.context, impl_item);
        hir_visit.walk_impl_item(cx, impl_item);
        LateLintPass_provided.check_impl_item_post(cx.pass, cx.context, impl_item);
      });
    });
    this.context.generics = generics;
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:311 visit_lifetime
  override visit_lifetime(lt: hir.Lifetime): undefined {
    hir_visit.walk_lifetime(this, lt);
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/late.rs:315 visit_path
  override visit_path(p: hir.Path, id: HirId): undefined {
    LateLintPass_provided.check_path(this.pass, this.context, p, id);
    hir_visit.walk_path(this, p);
    return undefined;
  }
}

/** `old_enclosing_body != Some(body_id)` (`BodyId` is `PartialEq` on its `hir_id`). */
function opt_body_id_eq(a: hir.BodyId | undefined, b: hir.BodyId): boolean {
  return a !== undefined && a.hir_id.owner.def_id === b.hir_id.owner.def_id && a.hir_id.local_id === b.hir_id.local_id;
}

// Combines multiple lint passes into a single pass, at runtime. Each
// `check_foo` method in `$methods` within this pass simply calls `check_foo`
// once per `$pass`. Compare with `declare_combined_late_lint_pass`, which is
// similar, but combines lint passes at compile time.
class RuntimeCombinedLateLintPass implements LateLintPass {
  constructor(public passes: LateLintPassObject[]) {}

  // #[allow(rustc::lint_pass_impl_without_macro)]
  // rustc: compiler/rustc_lint/src/late.rs:331 name
  name(): string {
    return panic("explicit panic");
  }
  // rustc: compiler/rustc_lint/src/late.rs:334 get_lints
  get_lints(): LintVec {
    return panic("explicit panic");
  }
}

// macro_rules! impl_late_lint_pass { .. }  crate::late_lint_methods!(impl_late_lint_pass, []);
for (const method of LATE_LINT_METHODS) {
  const provided = LateLintPass_provided[method] as (self: LateLintPass, ...args: unknown[]) => void;
  (RuntimeCombinedLateLintPass.prototype as unknown as Record<string, unknown>)[method] = function (
    this: RuntimeCombinedLateLintPass,
    ...args: unknown[]
  ): void {
    for (const pass of this.passes) {
      provided(pass, ...args);
    }
  };
}

// rustc: compiler/rustc_lint/src/late.rs:353 late_lint_mod
export function late_lint_mod(tcx: TyCtxt, mod_id: LocalModId, builtin_lints: LateLintPass): void {
  const context = new LateContext(
    tcx,
    /* enclosing_body */ undefined,
    /* typeck_results */ undefined,
    /* param_env */ ParamEnv.empty(),
    /* effective_visibilities */ tcx.effective_visibilities(null),
    /* last_node_with_lint_attrs */ tcx.local_def_id_to_hir_id(LocalModId.to_local_def_id(mod_id)),
    /* generics */ undefined,
    /* only_module */ true,
  );

  const skippable_lints = tcx.skippable_lints(null);

  // Note: `passes` is often empty. In that case, it's faster to run
  // `builtin_lints` directly rather than bundling it up into the
  // `RuntimeCombinedLateLintPass`.
  const passes: LateLintPassObject[] = unerased_lint_store(tcx.sess)
    .late_lint_mod_passes.map((mk_pass) => mk_pass(tcx))
    .filter((pass) => is_lint_pass_required(skippable_lints, pass.get_lints()));
  const builtin_lints_must_run = is_lint_pass_required(skippable_lints, builtin_lints.get_lints());
  if (passes.length === 0) {
    if (builtin_lints_must_run) {
      late_lint_mod_inner(tcx, mod_id, context, builtin_lints);
    }
  } else {
    if (builtin_lints_must_run) {
      passes.push(builtin_lints);
    }
    const pass = new RuntimeCombinedLateLintPass(passes);
    late_lint_mod_inner(tcx, mod_id, context, pass);
  }
}

// rustc: compiler/rustc_lint/src/late.rs:394 late_lint_mod_inner
function late_lint_mod_inner<T extends LateLintPass>(tcx: TyCtxt, mod_id: LocalModId, context: LateContext, pass: T): void {
  const cx = new LateContextAndPass<T>(context, pass, tcx.sess.opts.actually_rustdoc);

  const [module, _span] = tcx.hir_get_module(mod_id);

  cx.with_lint_attrs(HirId_from_LocalModId(mod_id), (cx) => {
    // There is no module lint that will have the crate itself as an item, so check it here.
    if (mod_id === CRATE_MOD_ID) {
      LateLintPass_provided.check_crate(cx.pass, cx.context);
    }

    cx.process_mod(module, mod_id);

    if (mod_id === CRATE_MOD_ID) {
      LateLintPass_provided.check_crate_post(cx.pass, cx.context);
    }
  });
}

// rustc: compiler/rustc_lint/src/late.rs:422 late_lint_crate
function late_lint_crate(tcx: TyCtxt): void {
  const skippable_lints = tcx.skippable_lints(null);

  // Note: `passes` is often empty after filtering.
  const passes: LateLintPassObject[] = unerased_lint_store(tcx.sess)
    .late_lint_passes.map((mk_pass) => mk_pass(tcx))
    .filter((pass) => is_lint_pass_required(skippable_lints, pass.get_lints()));
  if (passes.length === 0) {
    return;
  }

  const context = new LateContext(
    tcx,
    /* enclosing_body */ undefined,
    /* typeck_results */ undefined,
    /* param_env */ ParamEnv.empty(),
    /* effective_visibilities */ tcx.effective_visibilities(null),
    /* last_node_with_lint_attrs */ CRATE_HIR_ID,
    /* generics */ undefined,
    /* only_module */ false,
  );

  const pass = new RuntimeCombinedLateLintPass(passes);
  const cx = new LateContextAndPass(context, pass, tcx.sess.opts.actually_rustdoc);

  // Visit the whole crate.
  cx.with_lint_attrs(CRATE_HIR_ID, (cx) => {
    // Since the root module isn't visited as an item (because it isn't an
    // item), warn for it here.
    LateLintPass_provided.check_crate(cx.pass, cx.context);
    tcx.hir_walk_toplevel_module(cx);
    LateLintPass_provided.check_crate_post(cx.pass, cx.context);
  });
}

/// Performs lint checking on a crate.
// rustc: compiler/rustc_lint/src/late.rs:462 check_crate
export function check_crate(tcx: TyCtxt): void {
  par_join(
    () => {
      tcx.sess.time("crate_lints", () => {
        // Run whole crate non-incremental lints
        late_lint_crate(tcx);
      });
    },
    () => {
      tcx.sess.time("module_lints", () => {
        // Run per-module lints
        tcx.par_hir_for_each_module((module) => tcx.ensure_ok().lint_mod(module));
      });
    },
  );
}

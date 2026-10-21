// Test helper of src/rustc_lint/late_d.oracle.test.ts (lane lint-late-d). Not an upstream mirror: see run.ts.
//
// `TestLateContext` fills the `LateContext` methods still `unported` in context.ts with the upstream bodies
// (context.rs:628-975), and `LateContextAndPass` is late.rs's traversal (late.rs:36-325) reduced to what the passes of
// this lane observe. Both go away when lane lint-late-a's late.rs / context.rs land.
import type { LayoutError, TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { LayoutOf_provided } from "../../rustc_middle/ty/layout.ts";
import type { Result } from "../../std/result.ts";
import { BindingMode_eq, BindingMode } from "../../rustc_ast/lib.ts";
import { Res } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import {
  type FnKind,
  Visitor,
  walk_arm,
  walk_block,
  walk_body,
  walk_expr,
  walk_expr_field,
  walk_field_def,
  walk_fn,
  walk_foreign_item,
  walk_generic_param,
  walk_generics,
  walk_impl_item,
  walk_item,
  walk_local,
  walk_mod,
  walk_param,
  walk_pat,
  walk_path,
  walk_poly_trait_ref,
  walk_stmt,
  walk_struct_def,
  walk_trait_item,
  walk_ty,
  walk_variant,
} from "../../rustc_hir/intravisit.ts";
import { type HirId, HirId_from_OwnerId, OwnerId_eq } from "../../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ParamEnv, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import { CRATE_MOD_ID, type LocalDefId, LocalModId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { LateContext } from "../context.ts";
import type { LateLintPass } from "../passes.ts";
import { CheckTransmutes } from "../transmute.ts";
import { DanglingPointers } from "../dangling.ts";
import { DropForgetUseless } from "../drop_forget_useless.ts";
import { InvalidReferenceCasting } from "../reference_casting.ts";
import { NonLocalDefinitions } from "../non_local_def.ts";
import { NonPanicFmt } from "../non_fmt_panic.ts";
import {
  BadOptAccess,
  DefaultHashTypes,
  MissingGenericTypeVisitableDerive,
  QueryStability,
  RustcMustMatchExhaustively,
  SpanUseEqCtxt,
  SymbolInternStringLiteral,
  TyTyKind,
  TypeIr,
} from "../internal.ts";

/** The passes of this lane, by name (the `$pass: $constructor` entries of lib.rs's combined module passes). */
const PASSES: Record<string, () => LateLintPass> = {
  CheckTransmutes: () => new CheckTransmutes(),
  DanglingPointers: () => new DanglingPointers(),
  DropForgetUseless: () => new DropForgetUseless(),
  InvalidReferenceCasting: () => new InvalidReferenceCasting(),
  NonLocalDefinitions: () => NonLocalDefinitions.default(),
  NonPanicFmt: () => new NonPanicFmt(),
  BadOptAccess: () => new BadOptAccess(),
  DefaultHashTypes: () => new DefaultHashTypes(),
  MissingGenericTypeVisitableDerive: () => new MissingGenericTypeVisitableDerive(),
  QueryStability: () => new QueryStability(),
  RustcMustMatchExhaustively: () => new RustcMustMatchExhaustively(),
  SpanUseEqCtxt: () => new SpanUseEqCtxt(),
  SymbolInternStringLiteral: () => new SymbolInternStringLiteral(),
  TyTyKind: () => new TyTyKind(),
  TypeIr: () => new TypeIr(),
};

/** context.rs:628-975, the methods context.ts still leaves `unported`. */
class TestLateContext extends LateContext {
  override typing_mode(): TypingMode {
    const body_id = this.enclosing_body as hir.BodyId | undefined;
    if (body_id !== undefined && this.tcx.use_typing_mode_post_typeck_until_borrowck()) {
      const def_id = this.tcx.hir_enclosing_body_owner(body_id.hir_id);
      return TypingMode.post_borrowck_analysis(as_interner(this.tcx), def_id);
    } else {
      return TypingMode.non_body_analysis();
    }
  }

  override typing_env(): TypingEnv {
    return TypingEnv.new(this.param_env as ParamEnv, this.typing_mode());
  }

  override type_is_copy_modulo_regions(ty: Ty): boolean {
    return this.tcx.type_is_copy_modulo_regions(this.typing_env(), ty);
  }

  override qpath_res(qpath: hir.QPath, id: HirId): Res {
    switch (qpath.$) {
      case "Resolved":
        return qpath._1.res;
      case "TypeRelative": {
        let results = this.typeck_results as TypeckResults | undefined;
        if (results !== undefined && !OwnerId_eq(results.hir_owner, id.owner)) results = undefined;
        if (results === undefined && this.tcx.has_typeck_results(id.owner.def_id)) {
          results = this.tcx.typeck(id.owner.def_id) as TypeckResults;
        }
        const d = results?.type_dependent_def(id);
        return d === undefined ? Res.Err : { $: "Def", _0: d[0], _1: d[1] };
      }
    }
  }

  override expr_or_init(expr: hir.Expr): hir.Expr {
    expr = expr.peel_blocks();
    for (;;) {
      if (expr.kind.$ !== "Path") break;
      const res = this.qpath_res(expr.kind._0, expr.hir_id);
      const parent_node = res.$ === "Local" ? this.tcx.parent_hir_node(res._0) : undefined;
      if (parent_node === undefined) break;
      let init: hir.Expr | undefined;
      if (parent_node.$ === "Expr") init = parent_node._0;
      else if (
        parent_node.$ === "LetStmt" &&
        parent_node._0.pat.kind.$ === "Binding" &&
        BindingMode_eq(parent_node._0.pat.kind._0, BindingMode.NONE)
      ) {
        init = parent_node._0.init;
      }
      if (init === undefined) break;
      expr = init.peel_blocks();
    }
    return expr;
  }

  /** `impl LayoutOfHelpers for LateContext` + the blanket `LayoutOf`. */
  layout_of(ty: Ty): Result<TyAndLayout, LayoutError> {
    return LayoutOf_provided.layout_of(
      {
        data_layout: () => this.data_layout(),
        tcx_: () => this.tcx,
        typing_env_: () => this.typing_env(),
        LayoutOfResult: { from: (r: Result<TyAndLayout, LayoutError>) => r },
        layout_tcx_at_span: () => undefined as unknown as Span,
        handle_layout_err: (err: LayoutError) => err,
      } as never,
      ty,
    ) as Result<TyAndLayout, LayoutError>;
  }
}

/** late.rs:36 `LateContextAndPass` (reduced). */
class LateContextAndPass extends Visitor {
  override NestedFilter = All;

  constructor(
    public context: TestLateContext,
    public passes: LateLintPass[],
  ) {
    super();
  }

  cb(f: keyof LateLintPass, ...args: unknown[]): void {
    for (const p of this.passes) {
      const m = p[f] as ((...a: unknown[]) => void) | undefined;
      if (typeof m === "function" && f.startsWith("check_")) m.call(p, this.context, ...args);
    }
  }

  with_lint_attrs(id: HirId, f: () => void): void {
    const prev = this.context.last_node_with_lint_attrs;
    this.context.last_node_with_lint_attrs = id;
    f();
    this.context.last_node_with_lint_attrs = prev;
  }

  with_param_env(id: hir.OwnerId, f: () => void): void {
    const old = this.context.param_env;
    this.context.param_env = this.context.tcx.param_env(id);
    f();
    this.context.param_env = old;
  }

  process_mod(module: hir.Mod, id: LocalModId): void {
    this.cb("check_mod", module, id);
    walk_mod(this, module);
  }

  override maybe_tcx() {
    return TyCtxt_as_HirTyCtxt(this.context.tcx);
  }

  override visit_nested_body(body_id: hir.BodyId): undefined {
    const old_enclosing_body = this.context.enclosing_body as hir.BodyId | undefined;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    if (old_enclosing_body === undefined || !hir_id_eq(old_enclosing_body.hir_id, body_id.hir_id)) {
      const typeck_results = this.context.tcx.typeck_body(body_id as never);
      if (typeck_results.tainted_by_errors !== undefined) {
        this.context.enclosing_body = old_enclosing_body;
        this.context.typeck_results = old_typeck_results;
        return;
      }
      this.context.typeck_results = typeck_results;
    }
    const body = this.context.tcx.hir_body(body_id);
    this.visit_body(body);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
  }

  override visit_param(param: hir.Param): undefined {
    this.with_lint_attrs(param.hir_id, () => walk_param(this, param));
  }

  override visit_body(body: hir.Body): undefined {
    this.cb("check_body", body);
    walk_body(this, body);
    this.cb("check_body_post", body);
  }

  override visit_item(it: hir.Item): undefined {
    const old_typeck_results = this.context.typeck_results;
    this.context.typeck_results = undefined;
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = undefined;
    this.with_lint_attrs(it.hir_id(), () => {
      this.with_param_env(it.owner_id, () => {
        this.cb("check_item", it);
        walk_item(this, it);
        this.cb("check_item_post", it);
      });
    });
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
  }

  override visit_foreign_item(it: hir.ForeignItem): undefined {
    this.with_lint_attrs(it.hir_id(), () => {
      this.with_param_env(it.owner_id, () => {
        this.cb("check_foreign_item", it);
        walk_foreign_item(this, it);
      });
    });
  }

  override visit_pat(p: hir.Pat): undefined {
    this.cb("check_pat", p);
    walk_pat(this, p);
  }

  override visit_expr_field(field: hir.ExprField): undefined {
    this.with_lint_attrs(field.hir_id, () => walk_expr_field(this, field));
  }

  override visit_expr(e: hir.Expr): undefined {
    this.with_lint_attrs(e.hir_id, () => {
      this.cb("check_expr", e);
      walk_expr(this, e);
      this.cb("check_expr_post", e);
    });
  }

  override visit_stmt(s: hir.Stmt): undefined {
    this.with_lint_attrs(s.hir_id, () => this.cb("check_stmt", s));
    walk_stmt(this, s);
  }

  override visit_fn(fk: FnKind, decl: hir.FnDecl, body_id: hir.BodyId, span: Span, id: LocalDefId): undefined {
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    const typeck_results = this.context.tcx.typeck_body(body_id as never);
    if (typeck_results.tainted_by_errors !== undefined) {
      this.context.enclosing_body = old_enclosing_body;
      this.context.typeck_results = old_typeck_results;
      return;
    }
    this.context.typeck_results = typeck_results;
    const body = this.context.tcx.hir_body(body_id);
    this.cb("check_fn", fk, decl, body, span, id);
    walk_fn(this, fk, decl, body_id, id);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
  }

  override visit_variant_data(s: hir.VariantData): undefined {
    walk_struct_def(this, s);
  }

  override visit_field_def(s: hir.FieldDef): undefined {
    this.with_lint_attrs(s.hir_id, () => {
      this.cb("check_field_def", s);
      walk_field_def(this, s);
    });
  }

  override visit_variant(v: hir.Variant): undefined {
    this.with_lint_attrs(v.hir_id, () => {
      this.cb("check_variant", v);
      walk_variant(this, v);
    });
  }

  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    this.cb("check_ty", t);
    walk_ty(this, t);
  }

  override visit_mod(_m: hir.Mod, _s: Span, _id: LocalModId): undefined {
    // `only_module` is true for module passes: nested modules are linted on their own.
  }

  override visit_local(l: hir.LetStmt): undefined {
    this.with_lint_attrs(l.hir_id, () => {
      this.cb("check_local", l);
      walk_local(this, l);
    });
  }

  override visit_block(b: hir.Block): undefined {
    this.cb("check_block", b);
    walk_block(this, b);
    this.cb("check_block_post", b);
  }

  override visit_arm(a: hir.Arm): undefined {
    this.with_lint_attrs(a.hir_id, () => {
      this.cb("check_arm", a);
      walk_arm(this, a);
    });
  }

  override visit_generic_param(p: hir.GenericParam): undefined {
    this.cb("check_generic_param", p);
    walk_generic_param(this, p);
  }

  override visit_generics(g: hir.Generics): undefined {
    this.cb("check_generics", g);
    walk_generics(this, g);
  }

  override visit_poly_trait_ref(t: hir.PolyTraitRef): undefined {
    this.cb("check_poly_trait_ref", t);
    walk_poly_trait_ref(this, t);
  }

  override visit_trait_item(trait_item: hir.TraitItem): undefined {
    this.with_lint_attrs(trait_item.hir_id(), () => {
      this.with_param_env(trait_item.owner_id, () => {
        this.cb("check_trait_item", trait_item);
        walk_trait_item(this, trait_item);
      });
    });
  }

  override visit_impl_item(impl_item: hir.ImplItem): undefined {
    this.with_lint_attrs(impl_item.hir_id(), () => {
      this.with_param_env(impl_item.owner_id, () => {
        this.cb("check_impl_item", impl_item);
        walk_impl_item(this, impl_item);
        this.cb("check_impl_item_post", impl_item);
      });
    });
  }

  override visit_path(p: hir.Path, id: HirId): undefined {
    this.cb("check_path", p, id);
    walk_path(this, p);
  }
}

function hir_id_eq(a: HirId, b: HirId): boolean {
  return OwnerId_eq(a.owner, b.owner) && a.local_id === b.local_id;
}

/** `late_lint_mod` (late.rs:353) for every module, with the named passes. */
export function run_late_passes(tcx: TyCtxt, names: readonly string[]): void {
  tcx.par_hir_for_each_module((mod_id) => {
    const passes = names.map((n) => {
      const mk = PASSES[n];
      if (mk === undefined) throw new Error(`unknown pass ${n}`);
      return mk();
    });
    const context = new TestLateContext(
      tcx,
      undefined,
      undefined,
      ParamEnv.empty(),
      undefined,
      tcx.local_def_id_to_hir_id(LocalModId.to_local_def_id(mod_id)),
      undefined,
      true,
    );
    const cx = new LateContextAndPass(context, passes);
    const [module] = tcx.hir_get_module(mod_id);
    cx.with_lint_attrs(HirId_from_OwnerId(new hir.OwnerId(LocalModId.to_local_def_id(mod_id))), () => {
      if (mod_id === CRATE_MOD_ID) cx.cb("check_crate");
      cx.process_mod(module, mod_id);
      if (mod_id === CRATE_MOD_ID) cx.cb("check_crate_post");
    });
  });
}

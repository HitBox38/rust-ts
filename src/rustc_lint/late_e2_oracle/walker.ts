// Test glue for src/rustc_lint/late_e2_oracle/run.ts (lane lint-late-e2; not a port): a minimal copy of late.rs
// `LateContextAndPass` / `late_lint_mod` and of the `LateContext` methods (context.rs:628 `typing_mode`, :639
// `typing_env`, :663 `qpath_res`, :858 `expr_or_init`) that context.ts leaves `unported` until lane lint-late-a
// lands. Same context switching and hook order as upstream for the hooks the lane's passes implement. Delete once
// late.ts / context.ts have them.
import "../lib.ts";
import { BindingMode, BindingMode_eq } from "../../rustc_ast/lib.ts";
import { Res } from "../../rustc_hir/def.ts";
import type * as hir from "../../rustc_hir/hir.ts";
import { ItemKind } from "../../rustc_hir/hir.ts";
import { type FnKind, type HirTyCtxt, Visitor, walk_body, walk_expr, walk_fn, walk_foreign_item, walk_impl_item, walk_item, walk_local, walk_mod, walk_stmt, walk_trait_item, walk_ty } from "../../rustc_hir/intravisit.ts";
import { HirId_eq, HirId_from_LocalModId, type HirId, type OwnerId } from "../../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ParamEnv, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { BodyId as MiddleBodyId } from "../../rustc_middle/ty/decls.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId, LocalModId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { panic } from "../../std/panic.ts";
import { LateContext } from "../context.ts";
import { MapUnitFn } from "../map_unit_fn.ts";
import { MultipleSupertraitUpcastable } from "../multiple_supertrait_upcastable.ts";
import { NoopMethodCall } from "../noop_method_call.ts";
import { OpaqueHiddenInferredBound } from "../opaque_hidden_inferred_bound.ts";
import type { LateLintPass } from "../passes.ts";
import { PtrNullChecks } from "../ptr_nulls.ts";
import { RawBorrowsViaReferences } from "../raw_borrows_via_references.ts";
import { RuntimeSymbols } from "../runtime_symbols.ts";
import { ShadowedIntoIter } from "../shadowed_into_iter.ts";
import { StaticMutRefs } from "../static_mut_refs.ts";
import { DropTraitConstraints } from "../traits.ts";
import { UnitBindings } from "../unit_bindings.ts";
import { UnqualifiedLocalImports } from "../unqualified_local_imports.ts";

const PASSES: Record<string, () => LateLintPass> = {
  MapUnitFn: () => new MapUnitFn(),
  MultipleSupertraitUpcastable: () => new MultipleSupertraitUpcastable(),
  NoopMethodCall: () => new NoopMethodCall(),
  OpaqueHiddenInferredBound: () => new OpaqueHiddenInferredBound(),
  PtrNullChecks: () => new PtrNullChecks(),
  RawBorrowsViaReferences: () => new RawBorrowsViaReferences(),
  RuntimeSymbols: () => new RuntimeSymbols(),
  ShadowedIntoIter: () => new ShadowedIntoIter(),
  StaticMutRefs: () => new StaticMutRefs(),
  DropTraitConstraints: () => new DropTraitConstraints(),
  UnitBindings: () => new UnitBindings(),
  UnqualifiedLocalImports: () => new UnqualifiedLocalImports(),
};

/** `LateContext` with the context.rs methods the lane's passes call (upstream bodies). */
class TestLateContext extends LateContext {
  override typing_mode(): unknown {
    const body_id = this.enclosing_body as hir.BodyId | undefined;
    if (body_id !== undefined && this.tcx.use_typing_mode_post_typeck_until_borrowck()) {
      const def_id = this.tcx.hir_enclosing_body_owner(body_id.hir_id);
      return TypingMode.post_borrowck_analysis(as_interner(this.tcx), def_id);
    } else {
      return TypingMode.non_body_analysis();
    }
  }

  override typing_env(): unknown {
    return TypingEnv.new(this.param_env as ParamEnv, this.typing_mode() as TypingMode);
  }

  override qpath_res(qpath_: unknown, id: HirId): unknown {
    const qpath = qpath_ as hir.QPath;
    switch (qpath.$) {
      case "Resolved":
        return qpath._1.res;
      case "TypeRelative": {
        let typeck_results = this.typeck_results as TypeckResults | undefined;
        if (typeck_results !== undefined && !(typeck_results.hir_owner.def_id === id.owner.def_id)) typeck_results = undefined;
        if (typeck_results === undefined && this.tcx.has_typeck_results(id.owner.def_id)) typeck_results = this.tcx.typeck(id.owner.def_id) as TypeckResults;
        const d = typeck_results?.type_dependent_def(id);
        return d === undefined ? Res.Err : ({ $: "Def", _0: d[0], _1: d[1] } as Res);
      }
    }
  }

  override expr_or_init(expr_: unknown): unknown {
    let expr = (expr_ as hir.Expr).peel_blocks();
    for (;;) {
      if (expr.kind.$ !== "Path") break;
      const res = this.qpath_res(expr.kind._0, expr.hir_id) as Res;
      if (res.$ !== "Local") break;
      const parent_node = this.tcx.parent_hir_node(res._0);
      let init: hir.Expr | undefined;
      if (parent_node.$ === "Expr") init = parent_node._0;
      else if (parent_node.$ === "LetStmt" && parent_node._0.pat.kind.$ === "Binding" && BindingMode_eq(parent_node._0.pat.kind._0, BindingMode.NONE)) init = parent_node._0.init;
      if (init === undefined) break;
      expr = init.peel_blocks();
    }
    return expr;
  }
}

/** late.rs `LateContextAndPass` (hooks used by the lane's passes only). */
class LateWalker extends Visitor {
  override NestedFilter = All;
  constructor(
    public context: TestLateContext,
    public passes: LateLintPass[],
  ) {
    super();
  }
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.context.tcx);
  }

  with_lint_attrs(id: HirId, f: () => void): void {
    const prev = this.context.last_node_with_lint_attrs;
    this.context.last_node_with_lint_attrs = id;
    f();
    this.context.last_node_with_lint_attrs = prev;
  }
  with_param_env(id: OwnerId, f: () => void): void {
    const old_param_env = this.context.param_env;
    this.context.param_env = this.context.tcx.param_env(id.def_id);
    f();
    this.context.param_env = old_param_env;
  }
  process_mod(module: hir.Mod, id: LocalModId): void {
    for (const p of this.passes) p.check_mod?.(this.context, module, id);
    walk_mod(this, module);
  }

  override visit_nested_body(body_id: hir.BodyId): undefined {
    const old_enclosing_body = this.context.enclosing_body as hir.BodyId | undefined;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    if (old_enclosing_body === undefined || !HirId_eq(old_enclosing_body.hir_id, body_id.hir_id)) {
      const typeck_results = this.context.tcx.typeck_body(body_id as unknown as MiddleBodyId);
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
  override visit_body(body: hir.Body): undefined {
    for (const p of this.passes) p.check_body?.(this.context, body);
    walk_body(this, body);
    for (const p of this.passes) p.check_body_post?.(this.context, body);
    return undefined;
  }
  override visit_item(it: hir.Item): undefined {
    const generics = this.context.generics;
    this.context.generics = ItemKind.generics(it.kind);
    const old_typeck_results = this.context.typeck_results;
    this.context.typeck_results = undefined;
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = undefined;
    this.with_lint_attrs(it.hir_id(), () => {
      this.with_param_env(it.owner_id, () => {
        for (const p of this.passes) p.check_item?.(this.context, it);
        walk_item(this, it);
        for (const p of this.passes) p.check_item_post?.(this.context, it);
      });
    });
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    this.context.generics = generics;
    return undefined;
  }
  override visit_foreign_item(it: hir.ForeignItem): undefined {
    this.with_lint_attrs(it.hir_id(), () => {
      this.with_param_env(it.owner_id, () => {
        for (const p of this.passes) p.check_foreign_item?.(this.context, it);
        walk_foreign_item(this, it);
      });
    });
    return undefined;
  }
  override visit_expr(e: hir.Expr): undefined {
    this.with_lint_attrs(e.hir_id, () => {
      for (const p of this.passes) p.check_expr?.(this.context, e);
      walk_expr(this, e);
      for (const p of this.passes) p.check_expr_post?.(this.context, e);
    });
    return undefined;
  }
  override visit_stmt(s: hir.Stmt): undefined {
    this.with_lint_attrs(s.hir_id, () => {
      for (const p of this.passes) p.check_stmt?.(this.context, s);
    });
    walk_stmt(this, s);
    return undefined;
  }
  override visit_fn(fk: FnKind, decl: hir.FnDecl, body_id: hir.BodyId, span: Span, id: LocalDefId): undefined {
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    const typeck_results = this.context.tcx.typeck_body(body_id as unknown as MiddleBodyId);
    if (typeck_results.tainted_by_errors !== undefined) {
      this.context.enclosing_body = old_enclosing_body;
      this.context.typeck_results = old_typeck_results;
      return undefined;
    }
    this.context.typeck_results = typeck_results;
    const body = this.context.tcx.hir_body(body_id);
    for (const p of this.passes) p.check_fn?.(this.context, fk, decl, body, span, id);
    walk_fn(this, fk, decl, body_id, id);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    return undefined;
  }
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    for (const p of this.passes) p.check_ty?.(this.context, t);
    walk_ty(this, t);
    return undefined;
  }
  override visit_mod(m: hir.Mod, _: Span, id: LocalModId): undefined {
    if (!this.context.only_module) {
      this.process_mod(m, id);
    }
    return undefined;
  }
  override visit_local(l: hir.LetStmt): undefined {
    this.with_lint_attrs(l.hir_id, () => {
      for (const p of this.passes) p.check_local?.(this.context, l);
      walk_local(this, l);
    });
    return undefined;
  }
  override visit_trait_item(trait_item: hir.TraitItem): undefined {
    const generics = this.context.generics;
    this.context.generics = trait_item.generics;
    this.with_lint_attrs(trait_item.hir_id(), () => {
      this.with_param_env(trait_item.owner_id, () => {
        for (const p of this.passes) p.check_trait_item?.(this.context, trait_item);
        walk_trait_item(this, trait_item);
      });
    });
    this.context.generics = generics;
    return undefined;
  }
  override visit_impl_item(impl_item: hir.ImplItem): undefined {
    const generics = this.context.generics;
    this.context.generics = impl_item.generics;
    this.with_lint_attrs(impl_item.hir_id(), () => {
      this.with_param_env(impl_item.owner_id, () => {
        for (const p of this.passes) p.check_impl_item?.(this.context, impl_item);
        walk_impl_item(this, impl_item);
        for (const p of this.passes) p.check_impl_item_post?.(this.context, impl_item);
      });
    });
    this.context.generics = generics;
    return undefined;
  }
}

/** late.rs `check_crate`'s module half: `par_hir_for_each_module(|module| lint_mod(module))`, `late_lint_mod_inner`. */
export function run_late_passes(tcx: TyCtxt, names: readonly string[]): void {
  tcx.par_hir_for_each_module((mod_id) => {
    const passes = names.map((n) => (PASSES[n] ?? panic(`unknown pass ${n}`))());
    const context = new TestLateContext(tcx, undefined, undefined, ParamEnv.empty(), tcx.effective_visibilities(null), HirId_from_LocalModId(mod_id), undefined, true);
    const cx = new LateWalker(context, passes);
    const [module] = tcx.hir_get_module(mod_id);
    cx.with_lint_attrs(HirId_from_LocalModId(mod_id), () => {
      cx.process_mod(module, mod_id);
    });
  });
}

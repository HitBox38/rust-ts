// Port of compiler/rustc_passes/src/upvars.rs (lane typeck-gaps).
//
// PORT notes:
// - `FxHashSet<HirId>` is a `HirIdSet`, `FxIndexMap<HirId, hir::Upvar>` a `HirIdMap<Upvar>` (insertion-ordered, as the
//   IndexMap); `tcx.arena.alloc(..)` is the map itself. The `upvars_mentioned` query value is typed
//   `Map<HirId, unknown>` in queries.gen.ts (a `HirIdMap` is a `Map`).
// - The structs and their `Visitor` impls are classes over `intravisit::Visitor` (PORTING §8: methods in upstream order).
//! Upvar (closure capture) collection from cross-body HIR uses of `Res::Local`s.

import type { Body, Expr, Pat, Path, Upvar } from "../rustc_hir/hir.ts";
import { Visitor, walk_expr, walk_pat, walk_path } from "../rustc_hir/intravisit.ts";
import { type HirId, HirIdMap, HirIdSet } from "../rustc_hir_id/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";

// rustc: compiler/rustc_passes/src/upvars.rs:12 provide
export function provide(providers: Providers): void {
  providers.upvars_mentioned = (tcx: TyCtxt, def_id: DefId): Map<HirId, Upvar> | undefined => {
    if (!tcx.is_closure_like(def_id)) {
      return undefined;
    }

    const local_def_id = def_id.expect_local();
    const body: Body | undefined = tcx.hir_maybe_body_owned_by(local_def_id);
    if (body === undefined) return undefined;

    const local_collector = LocalCollector.default_();
    local_collector.visit_body(body);

    const capture_collector = new CaptureCollector(tcx, local_collector.locals, new HirIdMap<Upvar>());
    capture_collector.visit_body(body);

    if (capture_collector.upvars.size !== 0) {
      return capture_collector.upvars;
    } else {
      return undefined;
    }
  };
}

// rustc-type: compiler/rustc_passes/src/upvars.rs:40 LocalCollector
// #[derive(Default)]
class LocalCollector extends Visitor {
  constructor(
    // FIXME(eddyb) perhaps use `ItemLocalId` instead?
    public locals: HirIdSet,
  ) {
    super();
  }

  /** `#[derive(Default)]` */
  static default_(): LocalCollector {
    return new LocalCollector(new HirIdSet());
  }

  // impl<'tcx> Visitor<'tcx> for LocalCollector
  // rustc: compiler/rustc_passes/src/upvars.rs:46 visit_pat
  override visit_pat(pat: Pat): undefined {
    if (pat.kind.$ === "Binding") {
      const hir_id = pat.kind._1;
      this.locals.add(hir_id);
    }
    return walk_pat(this, pat);
  }
}

// rustc-type: compiler/rustc_passes/src/upvars.rs:54 CaptureCollector
class CaptureCollector extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public locals: HirIdSet,
    public upvars: HirIdMap<Upvar>,
  ) {
    super();
  }

  // impl CaptureCollector<'_, '_>
  // rustc: compiler/rustc_passes/src/upvars.rs:61 visit_local_use
  visit_local_use(var_id: HirId, span: Span): void {
    if (!this.locals.has(var_id)) {
      // `self.upvars.entry(var_id).or_insert(hir::Upvar { span })`
      if (!this.upvars.has(var_id)) this.upvars.set(var_id, { span });
    }
  }

  // impl<'tcx> Visitor<'tcx> for CaptureCollector<'_, 'tcx>
  // rustc: compiler/rustc_passes/src/upvars.rs:69 visit_path
  override visit_path(path: Path, _: HirId): undefined {
    if (path.res.$ === "Local") {
      const var_id = path.res._0;
      this.visit_local_use(var_id, path.span);
    }

    return walk_path(this, path);
  }

  // rustc: compiler/rustc_passes/src/upvars.rs:77 visit_expr
  override visit_expr(expr: Expr): undefined {
    if (expr.kind.$ === "Closure") {
      const closure = expr.kind._0;
      const upvars = this.tcx.upvars_mentioned(closure.def_id) as Map<HirId, Upvar> | undefined;
      if (upvars !== undefined) {
        // Every capture of a closure expression is a local in scope,
        // that is moved/copied/borrowed into the closure value, and
        // for this analysis they are like any other access to a local.
        //
        // E.g. in `|b| |c| (a, b, c)`, the upvars of the inner closure
        // are `a` and `b`, and while `a` is not directly used in the
        // outer closure, it needs to be an upvar there too, so that
        // the inner closure can take it (from the outer closure's env).
        for (const [var_id, upvar] of upvars) {
          this.visit_local_use(var_id, upvar.span);
        }
      }
    }

    return walk_expr(this, expr);
  }
}

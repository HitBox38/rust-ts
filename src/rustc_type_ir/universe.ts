// Port of compiler/rustc_type_ir/src/universe.rs (lane tyir-misc, sub-lane lib-sty).
//
// PORT (D4): the fns generic over `T: TypeFoldable<I>` take the descriptor `d_T` last; `MaxUniverse::needs_visit`
// (generic over `T: TypeVisitable<I>`) takes a `TypeVisitable<T>` descriptor.
// PORT: the const generics `VISIT_PLACEHOLDER` / `VISIT_INFER` of `MaxUniverse` are fields set by the constructor (and
// parameters of the associated fn `needs_visit`). `Infcx: InferCtxtLike<Interner = I>` is the `InferCtxtLike` object.
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import { VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { debug_Ty, type Ty } from "../rustc_middle/ty/mod.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unwrap } from "../std/panic.ts";
import type { Binder } from "./binder.ts";
import { type PredicateProxy, standin_fold_Ty, type TypeFoldable } from "./fold.ts";
import type { InferCtxtLike } from "./infer_ctxt.ts";
import { UniverseIndex } from "./lib.ts";
import { type Const, fold_Const } from "./sty/consts.ts";
import type { Region } from "./sty/mod.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "./visit.ts";

/** `impl TypeVisitable for Ty` as a descriptor: fold.ts's `standin_fold_Ty` (rustc_middle structural_impls.rs's
 *  impls are not ported; its one-line `visit_with` is upstream's, merge-w15a). */
const visit_Ty: TypeVisitable<Ty> = standin_fold_Ty;

function UniverseIndex_max(a: UniverseIndex, b: UniverseIndex): UniverseIndex {
  return a >= b ? a : b;
}

/// The largest universe a variable or placeholder was from in `t`
// rustc: compiler/rustc_type_ir/src/universe.rs:12 max_universe
export function max_universe<T>(infcx: InferCtxtLike, t: T, d_T: TypeFoldable<T>): UniverseIndex {
  return max_universe_inner(true, true, infcx, t, d_T);
}

/// The largest universe a variable was from in `t`
// rustc: compiler/rustc_type_ir/src/universe.rs:20 max_universe_of_infer_vars
export function max_universe_of_infer_vars<T>(infcx: InferCtxtLike, t: T, d_T: TypeFoldable<T>): UniverseIndex {
  return max_universe_inner(false, true, infcx, t, d_T);
}

/// The largest universe a placeholder was from in `t`
// rustc: compiler/rustc_type_ir/src/universe.rs:32 max_universe_of_placeholders
export function max_universe_of_placeholders<T>(infcx: InferCtxtLike, t: T, d_T: TypeFoldable<T>): UniverseIndex {
  return max_universe_inner(true, false, infcx, t, d_T);
}

// rustc: compiler/rustc_type_ir/src/universe.rs:43 max_universe_inner
function max_universe_inner<T>(
  VISIT_PLACEHOLDER: boolean,
  VISIT_INFER: boolean,
  infcx: InferCtxtLike,
  t: T,
  d_T: TypeFoldable<T>,
): UniverseIndex {
  if (!MaxUniverse.needs_visit(VISIT_PLACEHOLDER, VISIT_INFER, t, d_T)) {
    return UniverseIndex.ROOT;
  }

  const visitor = MaxUniverse.new(VISIT_PLACEHOLDER, VISIT_INFER, infcx);
  // FIXME: make this a debug_assert and let callers resolve vars. Then the input only needs to
  // be `TypeVisitable`.
  const t2 = infcx.deeply_resolve_ignoring_regions(t, d_T);
  d_T.visit_with(t2, visitor);
  return visitor.max_universe();
}

class MaxUniverse implements TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    readonly VISIT_PLACEHOLDER: boolean,
    readonly VISIT_INFER: boolean,
    public max_universe_: UniverseIndex,
    readonly infcx: InferCtxtLike,
    readonly cache: Set<Ty>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/universe.rs:85 new
  static new(VISIT_PLACEHOLDER: boolean, VISIT_INFER: boolean, infcx: InferCtxtLike): MaxUniverse {
    return new MaxUniverse(VISIT_PLACEHOLDER, VISIT_INFER, UniverseIndex.ROOT, infcx, new Set());
  }

  // PORT: the field `max_universe` is `max_universe_` (the method needs the name).
  // rustc: compiler/rustc_type_ir/src/universe.rs:89 max_universe
  max_universe(): UniverseIndex {
    return this.max_universe_;
  }

  // #[instrument(ret, level = "debug")]
  // rustc: compiler/rustc_type_ir/src/universe.rs:94 needs_visit
  static needs_visit<T>(VISIT_PLACEHOLDER: boolean, VISIT_INFER: boolean, t: T, d_T: TypeVisitable<T>): boolean {
    return (VISIT_PLACEHOLDER && TypeVisitableExt.has_placeholders(t, d_T)) || (VISIT_INFER && TypeVisitableExt.has_infer(t, d_T));
  }

  // ---- impl TypeVisitor<I> for MaxUniverse ----

  // rustc: compiler/rustc_type_ir/src/universe.rs:109 visit_ty
  visit_ty(t: Ty): undefined {
    if (!MaxUniverse.needs_visit(this.VISIT_PLACEHOLDER, this.VISIT_INFER, t, visit_Ty)) {
      return;
    }

    if (this.cache.has(t)) {
      return;
    }

    const k = t.kind();
    if (k.$ === "Placeholder" && this.VISIT_PLACEHOLDER) {
      const p = k._0;
      this.max_universe_ = UniverseIndex_max(this.max_universe_, p.universe);
    } else if (k.$ === "Infer" && k._0.$ === "TyVar" && this.VISIT_INFER) {
      const inf = k._0._0;
      const u = unwrap(this.infcx.universe_of_ty(inf));
      // debug!("var {inf:?} in universe {u:?}");
      this.max_universe_ = UniverseIndex_max(this.max_universe_, u);
    } else {
      standin_fold_Ty.super_visit_with(t, this);
    }

    // `assert!(self.cache.insert(t), "we shouldn't visit {t:?} twice")`
    const inserted = !this.cache.has(t);
    this.cache.add(t);
    if (!inserted) panic(`we shouldn't visit ${debug_Ty(t, PLAIN)} twice`);
  }

  // rustc: compiler/rustc_type_ir/src/universe.rs:133 visit_const
  visit_const(c: Const): undefined {
    if (!MaxUniverse.needs_visit(this.VISIT_PLACEHOLDER, this.VISIT_INFER, c, fold_Const)) {
      return;
    }

    const k = c.kind();
    if (k.$ === "Placeholder" && this.VISIT_PLACEHOLDER) {
      const p = k._0;
      this.max_universe_ = UniverseIndex_max(this.max_universe_, p.universe);
    } else if (k.$ === "Infer" && k._0.$ === "Var" && this.VISIT_INFER) {
      const inf = k._0._0;
      const u = unwrap(this.infcx.universe_of_const(inf));
      // debug!("var {inf:?} in universe {u:?}");
      this.max_universe_ = UniverseIndex_max(this.max_universe_, u);
    } else {
      fold_Const.super_visit_with(c, this);
    }
  }

  // rustc: compiler/rustc_type_ir/src/universe.rs:151 visit_region
  visit_region(r: Region): undefined {
    const k = r.kind();
    if (k.$ === "RePlaceholder" && this.VISIT_PLACEHOLDER) {
      const p = k._0;
      this.max_universe_ = UniverseIndex_max(this.max_universe_, p.universe);
    } else if (k.$ === "ReVar" && this.VISIT_INFER) {
      const var_ = k._0;
      const k2 = this.infcx.shallow_resolve_region_var(var_).kind();
      if (k2.$ === "RePlaceholder" && this.VISIT_PLACEHOLDER) {
        const p = k2._0;
        this.max_universe_ = UniverseIndex_max(this.max_universe_, p.universe);
      } else if (k2.$ === "ReVar" && this.VISIT_INFER) {
        const var2 = k2._0;
        const u = unwrap(this.infcx.universe_of_region(var2));
        // debug!("var {var:?} in universe {u:?}");
        this.max_universe_ = UniverseIndex_max(this.max_universe_, u);
      }
    }
  }

  // ---- provided `TypeVisitor` methods (PORTING §8) ----
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

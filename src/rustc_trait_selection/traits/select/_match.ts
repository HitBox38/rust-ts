// Port of compiler/rustc_trait_selection/src/traits/select/_match.rs (lane old-select-b, wave 18c).
//
// PORT: `MatchAgainstFreshVars` is the generated class of ./_match.gen.ts. Its `impl TypeRelation<TyCtxt>` is assigned
// onto the prototype (precedent: rustc_infer's `MatchAgainstHigherRankedOutlives`), `new` is a static
// (`function new_ ..; export { new_ as new }`). Methods generic over `T: Relate` take the `Relate<T>` descriptor last
// (rustc_type_ir relate.ts). Derived `PartialEq` of the interned `Ty` / `Const` is `===`. `#[instrument]` is dropped.
//
// Init order: top-level code here touches only ./_match.gen.ts and other crates.

import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { Variance } from "../../../rustc_type_ir/decls.ts";
import { ExpectedFound } from "../../../rustc_type_ir/error.ts";
import {
  type Relate,
  relate_args_invariantly,
  type RelateResult,
  structurally_relate_consts,
  structurally_relate_tys,
  type TypeRelation,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../../../rustc_type_ir/relate.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { Err, Ok } from "../../../std/result.ts";
import { MatchAgainstFreshVars } from "./_match.gen.ts";

export * from "./_match.gen.ts";

declare module "./_match.gen.ts" {
  interface MatchAgainstFreshVars extends TypeRelation {}
  namespace MatchAgainstFreshVars {
    function new_(tcx: TyCtxt): MatchAgainstFreshVars;
    export { new_ as new };
  }
}

// ---- impl<'tcx> MatchAgainstFreshVars<'tcx> ----

Object.assign(MatchAgainstFreshVars, {
  // rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:30 new
  new(tcx: TyCtxt): MatchAgainstFreshVars {
    return new MatchAgainstFreshVars(tcx);
  },
});

// ---- impl<'tcx> TypeRelation<TyCtxt<'tcx>> for MatchAgainstFreshVars<'tcx> ----

// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:36 cx
MatchAgainstFreshVars.prototype.cx = function (this: MatchAgainstFreshVars): TyCtxt {
  return this.tcx;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:40 relate_ty_args
MatchAgainstFreshVars.prototype.relate_ty_args = function (
  this: MatchAgainstFreshVars,
  a_ty: Ty,
  _b_ty: Ty,
  _def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  _mk: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  const r = relate_args_invariantly(this, a_args, b_args);
  if (r.$ === "Err") return r;
  return Ok(a_ty);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:53 relate_with_variance
MatchAgainstFreshVars.prototype.relate_with_variance = function <T>(
  this: MatchAgainstFreshVars,
  _variance: Variance,
  _info: VarianceDiagInfo,
  a: T,
  b: T,
  d: Relate<T>,
): RelateResult<T> {
  return this.relate(a, b, d);
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:64 regions
MatchAgainstFreshVars.prototype.regions = function (this: MatchAgainstFreshVars, a: Region, _b: Region): RelateResult<Region> {
  return Ok(a);
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:73 tys
MatchAgainstFreshVars.prototype.tys = function (this: MatchAgainstFreshVars, a: Ty, b: Ty): RelateResult<Ty> {
  if (a === b) {
    return Ok(a);
  }

  const ak = a.kind();
  const bk = b.kind();
  if (bk.$ === "Infer" && (bk._0.$ === "FreshTy" || bk._0.$ === "FreshIntTy" || bk._0.$ === "FreshFloatTy")) {
    return Ok(a);
  } else if (ak.$ === "Infer" || bk.$ === "Infer") {
    return Err({ $: "Sorts", _0: ExpectedFound.new(a, b) });
  } else if (ak.$ === "Error") {
    return Ok(Ty.new_error(this.cx(), ak._0));
  } else if (bk.$ === "Error") {
    return Ok(Ty.new_error(this.cx(), bk._0));
  } else {
    return structurally_relate_tys(this, a, b);
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:97 consts
MatchAgainstFreshVars.prototype.consts = function (this: MatchAgainstFreshVars, a: Const, b: Const): RelateResult<Const> {
  if (a === b) {
    return Ok(a);
  }

  const ak = a.kind();
  const bk = b.kind();
  if (bk.$ === "Infer" && bk._0.$ === "Fresh") {
    return Ok(a);
  } else if (ak.$ === "Infer" || bk.$ === "Infer") {
    return Err({ $: "ConstMismatch", _0: ExpectedFound.new(a, b) });
  }

  return structurally_relate_consts(this, a, b);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/_match.rs:121 binders
MatchAgainstFreshVars.prototype.binders = function <T>(this: MatchAgainstFreshVars, a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  const r = this.relate(Binder.skip_binder(a), Binder.skip_binder(b), d);
  if (r.$ === "Err") return r;
  return Ok(Binder.rebind(a, r._0));
};

// (provided) `TypeRelation::relate`.
MatchAgainstFreshVars.prototype.relate = function <T>(this: MatchAgainstFreshVars, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

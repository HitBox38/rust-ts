// Port of compiler/rustc_ty_utils/src/representability.rs (lane ty-utils).
//
// PORT: query values typed `unknown` in queries.gen.ts (`adt_def`, `type_of`, `generics_of`, `params_in_repr`) are
// cast to their upstream types at the read site.
import { debug_DefKind } from "../rustc_hir/def.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef } from "../rustc_middle/ty/decls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";

// rustc: compiler/rustc_ty_utils/src/representability.rs:8 provide
export function provide(providers: Providers): void {
  providers.check_representability = check_representability;
  providers.check_representability_adt_ty = (tcx, ty) => check_representability_adt_ty(tcx, ty as Ty);
  providers.params_in_repr = params_in_repr;
}

// rustc: compiler/rustc_ty_utils/src/representability.rs:17 check_representability
function check_representability(tcx: TyCtxt, def_id: LocalDefId): null {
  const def_kind = tcx.def_kind(def_id);
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum": {
      for (const variant of (tcx.adt_def(def_id) as AdtDef).variants()) {
        for (const field of variant.fields) {
          tcx.ensure_ok().check_representability(field.did.expect_local());
        }
      }
      break;
    }
    case "Field": {
      check_representability_ty(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)));
      break;
    }
    default:
      return bug(`unexpected ${debug_DefKind(def_kind, PLAIN)}`);
  }
  return null;
}

// rustc: compiler/rustc_ty_utils/src/representability.rs:36 check_representability_ty
function check_representability_ty(tcx: TyCtxt, ty: Ty): void {
  const k = ty.kind();
  switch (k.$) {
    // This one must be a query rather than a vanilla `check_representability_adt_ty` call. See
    // the comment on `check_representability_adt_ty` below for why.
    case "Adt": {
      tcx.ensure_ok().check_representability_adt_ty(ty);
      break;
    }
    // FIXME(#11924) allow zero-length arrays?
    case "Array": {
      const ty = k._0;
      check_representability_ty(tcx, ty);
      break;
    }
    case "Tuple": {
      const tys = k._0;
      for (const ty of tys) {
        check_representability_ty(tcx, ty);
      }
      break;
    }
    default:
      break;
  }
}

// The reason for this being a separate query is very subtle. Consider this
// infinitely sized struct: `struct Foo(Box<Foo>, Bar<Foo>)`. When calling
// check_representability(Foo), a query cycle will occur:
//
//   check_representability(Foo)
//     -> check_representability_adt_ty(Bar<Foo>)
//     -> check_representability(Foo)
//
// For the diagnostic output (in `check_representability`), we want to detect
// that the `Foo` in the *second* field of the struct is culpable. This
// requires traversing the HIR of the struct and calling `params_in_repr(Bar)`.
// But we can't call params_in_repr for a given type unless it is known to be
// representable. params_in_repr will cycle/panic on infinitely sized types.
// Looking at the query cycle above, we know that `Bar` is representable
// because `check_representability_adt_ty(Bar<..>)` is in the cycle and
// `check_representability(Bar)` is *not* in the cycle.
// rustc: compiler/rustc_ty_utils/src/representability.rs:72 check_representability_adt_ty
function check_representability_adt_ty(tcx: TyCtxt, ty: Ty): null {
  const k = ty.kind();
  if (k.$ !== "Adt") return bug("expected adt");
  const adt = k._0;
  const args = k._1;
  const def_id = adt.did().as_local();
  if (def_id !== undefined) {
    tcx.ensure_ok().check_representability(def_id);
  }
  // At this point, we know that the item of the ADT type is representable;
  // but the type parameters may cause a cycle with an upstream type
  const params_in_repr = tcx.params_in_repr(adt.did()) as DenseBitSet<number>;
  for (const [i, arg] of args.entries()) {
    const ak = GenericArg.kind(arg);
    if (ak.$ === "Type") {
      const ty = ak._0;
      if (params_in_repr.contains(i)) {
        check_representability_ty(tcx, ty);
      }
    }
  }
  return null;
}

// rustc: compiler/rustc_ty_utils/src/representability.rs:89 params_in_repr
function params_in_repr(tcx: TyCtxt, def_id: LocalDefId): DenseBitSet<number> {
  const adt_def = tcx.adt_def(def_id) as AdtDef;
  const generics = tcx.generics_of(def_id) as Generics;
  const params_in_repr = DenseBitSet.new_empty<number>(generics.own_params.length);
  for (const variant of adt_def.variants()) {
    for (const field of variant.fields) {
      params_in_repr_ty(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>)), params_in_repr);
    }
  }
  return params_in_repr;
}

// rustc: compiler/rustc_ty_utils/src/representability.rs:105 params_in_repr_ty
function params_in_repr_ty(tcx: TyCtxt, ty: Ty, params_in_repr: DenseBitSet<number>): void {
  const k = ty.kind();
  switch (k.$) {
    case "Adt": {
      const adt = k._0;
      const args = k._1;
      const inner_params_in_repr = tcx.params_in_repr(adt.did()) as DenseBitSet<number>;
      for (const [i, arg] of args.entries()) {
        const ak = GenericArg.kind(arg);
        if (ak.$ === "Type") {
          const ty = ak._0;
          if (inner_params_in_repr.contains(i)) {
            params_in_repr_ty(tcx, ty, params_in_repr);
          }
        }
      }
      break;
    }
    case "Array": {
      const ty = k._0;
      params_in_repr_ty(tcx, ty, params_in_repr);
      break;
    }
    case "Tuple": {
      const tys = k._0;
      tys.forEach((ty) => params_in_repr_ty(tcx, ty, params_in_repr));
      break;
    }
    case "Param": {
      const param = k._0;
      params_in_repr.insert(param.index);
      break;
    }
    default:
      break;
  }
}

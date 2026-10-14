// Port of compiler/rustc_infer/src/infer/resolve.rs (lane infer-core).
//
// PORT: `DeepResolverIgnoringRegions` is the generated class (resolve.gen.ts); its `TypeFolder` impl is on the prototype
// (augmentation below; the provided methods delegate to `TypeFolder_provided`). `FullTypeResolver` is the generated
// interface; its `FallibleTypeFolder` impl is a folder object over it (`FullTypeResolver_folder`).
// Init order: top-level code here touches only ../decls.ts, resolve.gen.ts and other crates.

import { type InferConst } from "../../rustc_type_ir/const_kind.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import { debug_Ty, type Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Clauses, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { DelayedMap } from "../../rustc_type_ir/data_structures/mod.ts";
import {
  type FallibleTypeFolder,
  FallibleTypeFolder_provided,
  type PredicateProxy,
  type TypeFoldable,
  type TypeFolder,
  TypeFolder_provided,
} from "../../rustc_type_ir/fold.ts";
import { type Const, debug_Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { InferCtxt } from "../decls.ts";
import type { FixupError, FixupResult } from "./mod.gen.ts";
import { DeepResolverIgnoringRegions, type FullTypeResolver } from "./resolve.gen.ts";

export * from "./resolve.gen.ts";

declare module "./resolve.gen.ts" {
  interface DeepResolverIgnoringRegions extends TypeFolder {}
  namespace DeepResolverIgnoringRegions {
    // infer/resolve.rs:28
    function new_(infcx: InferCtxt): DeepResolverIgnoringRegions;
    export { new_ as new };
  }
}

///////////////////////////////////////////////////////////////////////////
// DEEP VAR RESOLVER

Object.assign(DeepResolverIgnoringRegions, {
  // rustc: compiler/rustc_infer/src/infer/resolve.rs:28 new
  new(infcx: InferCtxt): DeepResolverIgnoringRegions {
    return new DeepResolverIgnoringRegions(infcx, DelayedMap.default_<Ty, Ty>());
  },
});

// ---- impl TypeFolder<TyCtxt> for DeepResolverIgnoringRegions (resolve.rs:33) ------------------------------------------

// rustc: compiler/rustc_infer/src/infer/resolve.rs:34 cx
DeepResolverIgnoringRegions.prototype.cx = function (this: DeepResolverIgnoringRegions): TyCtxt {
  return this.infcx.tcx;
};

DeepResolverIgnoringRegions.prototype.fold_binder = function <T>(this: DeepResolverIgnoringRegions, t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
  return TypeFolder_provided.fold_binder(this, t, d);
};

// rustc: compiler/rustc_infer/src/infer/resolve.rs:39 fold_ty
DeepResolverIgnoringRegions.prototype.fold_ty = function (this: DeepResolverIgnoringRegions, t: Ty): Ty {
  if (!TypeVisitableExt.has_non_region_infer(t, fold_Ty)) {
    return t; // micro-optimize -- if there is nothing in this type that this fold affects...
  } else {
    const ty = this.cache.get(t);
    if (ty !== undefined) {
      return ty;
    } else {
      const shallow = this.infcx.shallow_resolve(t);
      const res = fold_Ty.super_fold_with(shallow, this);
      assert(this.cache.insert(t, res), "assertion failed: self.cache.insert(t, res)");
      return res;
    }
  }
};

DeepResolverIgnoringRegions.prototype.fold_region = function (this: DeepResolverIgnoringRegions, r: Region): Region {
  return TypeFolder_provided.fold_region(this, r);
};

// rustc: compiler/rustc_infer/src/infer/resolve.rs:52 fold_const
DeepResolverIgnoringRegions.prototype.fold_const = function (this: DeepResolverIgnoringRegions, ct_: Const): Const {
  if (!TypeVisitableExt.has_non_region_infer(ct_, fold_Const)) {
    return ct_; // micro-optimize -- if there is nothing in this const that this fold affects...
  } else {
    const ct = this.infcx.shallow_resolve_const(ct_);
    return fold_Const.super_fold_with(ct, this);
  }
};

// rustc: compiler/rustc_infer/src/infer/resolve.rs:61 fold_predicate
DeepResolverIgnoringRegions.prototype.fold_predicate = function <P>(this: DeepResolverIgnoringRegions, p: P, d: PredicateProxy<P>): P {
  if (!TypeVisitableExt.has_non_region_infer(p, d)) {
    return p;
  } else {
    return d.super_fold_with(p, this);
  }
};

// rustc: compiler/rustc_infer/src/infer/resolve.rs:65 fold_clauses
DeepResolverIgnoringRegions.prototype.fold_clauses = function (this: DeepResolverIgnoringRegions, c: Clauses): Clauses {
  if (!TypeVisitableExt.has_non_region_infer(c, fold_Clauses)) {
    return c;
  } else {
    return fold_Clauses.super_fold_with(c, this);
  }
};

///////////////////////////////////////////////////////////////////////////
// FULL TYPE RESOLUTION

/// Full type resolution replaces all type and region variables with
/// their concrete results. If any variable cannot be replaced (never unified, etc)
/// then an `Err` result is returned.
// rustc: compiler/rustc_infer/src/infer/resolve.rs:76 deeply_resolve_via_region_graph
export function deeply_resolve_via_region_graph<T>(infcx: InferCtxt, value: T, d_T: TypeFoldable<T>): FixupResult<T> {
  return d_T.try_fold_with(value, FullTypeResolver_folder({ infcx }));
}

/// `impl FallibleTypeFolder<TyCtxt> for FullTypeResolver` (`type Error = FixupError`).
function FullTypeResolver_folder(self: FullTypeResolver): FallibleTypeFolder<FixupError> {
  const folder: FallibleTypeFolder<FixupError> = {
    // rustc: compiler/rustc_infer/src/infer/resolve.rs:90 cx
    cx(): TyCtxt {
      return self.infcx.tcx;
    },

    try_fold_binder: <T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, FixupError> => FallibleTypeFolder_provided.try_fold_binder(folder, t, d),

    // rustc: compiler/rustc_infer/src/infer/resolve.rs:94 try_fold_ty
    try_fold_ty(t_: Ty): Result<Ty, FixupError> {
      if (!TypeVisitableExt.has_infer(t_, fold_Ty)) {
        return Ok(t_); // micro-optimize -- if there is nothing in this type that this fold affects...
      } else {
        const t = self.infcx.shallow_resolve(t_);
        const k = t.kind();
        if (k.$ === "Infer") {
          switch (k._0.$) {
            case "TyVar":
              return Err({ unresolved: { $: "Ty", _0: k._0._0 } });
            case "IntVar":
              return Err({ unresolved: { $: "TyInt", _0: k._0._0 } });
            case "FloatVar":
              return Err({ unresolved: { $: "TyFloat", _0: k._0._0 } });
            default:
              return bug(`Unexpected type in full type resolver: ${debug_Ty(t, PLAIN)}`);
          }
        }
        return fold_Ty.try_super_fold_with(t, folder);
      }
    },

    // rustc: compiler/rustc_infer/src/infer/resolve.rs:117 try_fold_region
    try_fold_region(r: Region): Result<Region, FixupError> {
      switch (r.kind().$) {
        case "ReVar":
          return Ok(unwrap(self.infcx.lexical_region_resolutions, "region resolution not performed").resolve_region(self.infcx.tcx, r));
        default:
          return Ok(r);
      }
    },

    // rustc: compiler/rustc_infer/src/infer/resolve.rs:130 try_fold_const
    try_fold_const(c_: Const): Result<Const, FixupError> {
      if (!TypeVisitableExt.has_infer(c_, fold_Const)) {
        return Ok(c_); // micro-optimize -- if there is nothing in this const that this fold affects...
      } else {
        const c = self.infcx.shallow_resolve_const(c_);
        const k = c.kind();
        if (k.$ === "Infer") {
          const infer: InferConst = k._0;
          switch (infer.$) {
            case "Var":
              return Err({ unresolved: { $: "Const", _0: infer._0 } });
            case "Fresh":
              return bug(`Unexpected const in full const resolver: ${debug_Const(c, PLAIN)}`);
          }
        }
        return fold_Const.try_super_fold_with(c, folder);
      }
    },

    try_fold_predicate: <P>(p: P, d: PredicateProxy<P>): Result<P, FixupError> => FallibleTypeFolder_provided.try_fold_predicate(folder, p, d),
    try_fold_clauses: (c: Clauses): Result<Clauses, FixupError> => FallibleTypeFolder_provided.try_fold_clauses(folder, c),
  };
  return folder;
}

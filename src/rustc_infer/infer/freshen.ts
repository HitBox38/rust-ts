// Port of compiler/rustc_infer/src/infer/freshen.rs (lane infer-core).
//
//! Freshening is the process of replacing unknown variables with fresh types. The idea is that
//! the type, after freshening, contains no inference variables but instead contains either a
//! value for each variable or fresh "arbitrary" types wherever a variable would have been.
//!
//! Freshening is used primarily to get a good type for inserting into a cache. The result
//! summarizes what the type inferencer knows "so far". The primary place it is used right now is
//! in the trait matching algorithm, which needs to be able to cache whether an `impl` self type
//! matches some other type X -- *without* affecting `X`. That means that if the type `X` is in
//! fact an unbound type variable, we want the match to be regarded as ambiguous, because depending
//! on what type that type variable is ultimately assigned, the match may or may not succeed.
//!
//! To handle closures, freshened types also have to contain the signature and kind of any
//! closure in the local inference context, as otherwise the cache key might be invalidated.
//! The way this is done is somewhat hacky - the closure signature is appended to the args,
//! as well as the closure kind "encoded" as a type. Also, special handling is needed when
//! the closure signature contains a reference to the original closure.
//!
//! Note that you should be careful not to allow the output of freshening to leak to the user in
//! error messages or in any other form. Freshening is only really useful as an internal detail.
//!
//! Because of the manipulation required to handle closures, doing arbitrary operations on
//! freshened types is not recommended. However, in addition to doing equality/hash
//! comparisons (for caching), it is possible to do a `ty::_match` operation between
//! two freshened types - this works even with the closure encoding.
//!
//! __An important detail concerning regions.__ The freshener also replaces *all* free regions with
//! 'erased. The reason behind this is that, in general, we do not take region relationships into
//! account when making type-overloaded decisions. This is important because of the design of the
//! region inferencer, which is not based on unification but rather on accumulating and then
//! solving a set of constraints. In contrast, the type inferencer assigns a value to each type
//! variable only once, and it does so as soon as it can, so it is reasonable to ask what the type
//! inferencer knows "so far".
//
// PORT: `TypeFreshener` is the generated class (freshen.gen.ts); its methods and its `TypeFolder` impl are on the
// prototype (augmentation below; the provided `TypeFolder` methods delegate to `TypeFolder_provided`). The
// `FxHashMap<InferTy, _>` / `FxHashMap<InferConst, _>` keys are data enums: `KeyedMap`s on `intern_key` (PORTING §5).
// Init order: top-level code here touches only ../decls.ts, freshen.gen.ts and other crates.

import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import type { InferConst } from "../../rustc_type_ir/const_kind.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { Const, debug_Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { debug_InferTy, type InferTy } from "../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unreachable } from "../../std/panic.ts";
import type { InferCtxt } from "../decls.ts";
import { TypeFreshener } from "./freshen.gen.ts";
import { TypeVariableValue } from "./type_variable.ts";
import { ConstVariableValue, ConstVidKey_from } from "./unify_key.ts";

export * from "./freshen.gen.ts";

declare module "./freshen.gen.ts" {
  interface TypeFreshener extends TypeFolder {}
}

// ---- impl TypeFreshener (freshen.rs:52) -------------------------------------------------------------------------------

Object.assign(TypeFreshener, {
  // rustc: compiler/rustc_infer/src/infer/freshen.rs:53 new
  new(infcx: InferCtxt): TypeFreshener {
    return new TypeFreshener(infcx, 0, 0, new KeyedMap<InferTy, Ty>(intern_key), new KeyedMap<InferConst, Const>(intern_key));
  },
});

// rustc: compiler/rustc_infer/src/infer/freshen.rs:63 freshen_ty
TypeFreshener.prototype.freshen_ty = function (this: TypeFreshener, input: InferTy, mk_fresh: (_1: number) => Ty): Ty {
  // `match self.ty_freshen_map.entry(input)`
  const entry = this.ty_freshen_map.get(input);
  if (entry !== undefined) {
    return entry;
  } else {
    const index = this.ty_freshen_count;
    this.ty_freshen_count += 1;
    const t = mk_fresh(index);
    this.ty_freshen_map.set(input, t);
    return t;
  }
};

// rustc: compiler/rustc_infer/src/infer/freshen.rs:79 freshen_const
TypeFreshener.prototype.freshen_const = function (this: TypeFreshener, input: InferConst, freshener: (_1: number) => InferConst): Const {
  // `match self.const_freshen_map.entry(input)`
  const entry = this.const_freshen_map.get(input);
  if (entry !== undefined) {
    return entry;
  } else {
    const index = this.const_freshen_count;
    this.const_freshen_count += 1;
    const ct = Const.new_infer(this.infcx.tcx, freshener(index));
    this.const_freshen_map.set(input, ct);
    return ct;
  }
};

// ---- impl TypeFolder<TyCtxt> for TypeFreshener (freshen.rs:96) --------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/freshen.rs:97 cx
TypeFreshener.prototype.cx = function (this: TypeFreshener): TyCtxt {
  return this.infcx.tcx;
};

TypeFreshener.prototype.fold_binder = function <T>(this: TypeFreshener, t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
  return TypeFolder_provided.fold_binder(this, t, d);
};

// rustc: compiler/rustc_infer/src/infer/freshen.rs:101 fold_region
TypeFreshener.prototype.fold_region = function (this: TypeFreshener, r: Region): Region {
  switch (r.kind().$) {
    // Leave bound regions alone, since they affect selection via the leak check.
    case "ReBound":
      return r;
    // Leave error regions alone, since they affect selection b/c of incompleteness.
    case "ReError":
      return r;

    case "ReEarlyParam":
    case "ReLateParam":
    case "ReVar":
    case "RePlaceholder":
    case "ReStatic":
    case "ReErased":
      return this.cx().lifetimes.re_erased;
  }
};

// rustc: compiler/rustc_infer/src/infer/freshen.rs:118 fold_ty
TypeFreshener.prototype.fold_ty = function (this: TypeFreshener, t: Ty): Ty {
  if (!TypeVisitableExt.has_infer(t, fold_Ty) && !TypeVisitableExt.has_erasable_regions(t, fold_Ty)) {
    return t;
  } else {
    const k = t.kind();
    if (k.$ === "Infer") {
      return this.fold_infer_ty(k._0);
    }

    // This code is hot enough that a non-debug assertion here makes a noticeable
    // difference on benchmarks like `wg-grammar`.
    // PORT: `#[cfg(debug_assertions)] ty::Placeholder(..) | ty::Bound(..) => bug!(..)`: rustc ships without debug
    // assertions, so those kinds take the `_` arm.

    return fold_Ty.super_fold_with(t, this);
  }
};

// rustc: compiler/rustc_infer/src/infer/freshen.rs:135 fold_const
TypeFreshener.prototype.fold_const = function (this: TypeFreshener, ct: Const): Const {
  const k = ct.kind();
  switch (k.$) {
    case "Infer": {
      const infer = k._0;
      switch (infer.$) {
        case "Var": {
          const v = infer._0;
          const inner = this.infcx.inner;
          const const_ = ConstVariableValue.known(inner.const_unification_table().probe_value(ConstVidKey_from(v)));
          if (const_ !== undefined) {
            // drop(inner);
            return fold_Const.fold_with(const_, this);
          } else {
            const input: InferConst = { $: "Var", _0: inner.const_unification_table().find(ConstVidKey_from(v)).vid };
            return this.freshen_const(input, (n) => ({ $: "Fresh", _0: n }));
          }
        }
        case "Fresh":
          return bug(`trying to freshen already-freshened const ${debug_Const(ct, PLAIN)}`);
      }
      break;
    }

    case "Bound":
    case "Placeholder":
      return bug(`unexpected const ${debug_Const(ct, PLAIN)}`);

    case "Param":
    case "Value":
    case "Alias":
    case "Expr":
    case "Error":
      return fold_Const.super_fold_with(ct, this);
  }
  return unreachable();
};

TypeFreshener.prototype.fold_predicate = function <P>(this: TypeFreshener, p: P, d: PredicateProxy<P>): P {
  return TypeFolder_provided.fold_predicate(this, p, d);
};

TypeFreshener.prototype.fold_clauses = function (this: TypeFreshener, c: Clauses): Clauses {
  return TypeFolder_provided.fold_clauses(this, c);
};

// ---- impl TypeFreshener (freshen.rs:168) ------------------------------------------------------------------------------

// This is separate from `fold_ty` to keep that method small and inlinable.
// rustc: compiler/rustc_infer/src/infer/freshen.rs:171 fold_infer_ty
TypeFreshener.prototype.fold_infer_ty = function (this: TypeFreshener, ty: InferTy): Ty {
  switch (ty.$) {
    case "TyVar": {
      const v = ty._0;
      const inner = this.infcx.inner;
      const known = TypeVariableValue.known(inner.type_variables().probe(v));
      if (known !== undefined) {
        // drop(inner);
        return fold_Ty.fold_with(known, this);
      } else {
        const input: InferTy = { $: "TyVar", _0: inner.type_variables().root_var(v) };
        return this.freshen_ty(input, (n) => Ty.new_fresh(this.infcx.tcx, n));
      }
    }

    case "IntVar": {
      const v = ty._0;
      const inner = this.infcx.inner;
      const value = inner.int_unification_table().probe_value(v);
      switch (value.$) {
        case "IntType":
          return Ty.new_int(this.infcx.tcx, value._0);
        case "UintType":
          return Ty.new_uint(this.infcx.tcx, value._0);
        case "Unknown": {
          const input: InferTy = { $: "IntVar", _0: inner.int_unification_table().find(v) };
          return this.freshen_ty(input, (n) => Ty.new_fresh_int(this.infcx.tcx, n));
        }
      }
      break;
    }

    case "FloatVar": {
      const v = ty._0;
      const inner = this.infcx.inner;
      const value = inner.float_unification_table().probe_value(v);
      switch (value.$) {
        case "Known":
          return Ty.new_float(this.infcx.tcx, value._0);
        case "Unknown": {
          const input: InferTy = { $: "FloatVar", _0: inner.float_unification_table().find(v) };
          return this.freshen_ty(input, (n) => Ty.new_fresh_float(this.infcx.tcx, n));
        }
      }
      break;
    }

    case "FreshTy":
    case "FreshIntTy":
    case "FreshFloatTy":
      return bug(`trying to freshen already-freshened type ${debug_InferTy(ty, PLAIN)}`);
  }
  return unreachable();
};


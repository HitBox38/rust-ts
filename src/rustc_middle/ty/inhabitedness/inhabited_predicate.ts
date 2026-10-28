// Port of compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs (lane merge-lints).
//
// PORT: the enum's methods live on the companion const (PORTING.md section 8). `&'tcx [InhabitedPredicate; 2]`
// (`tcx.arena.alloc([a, b])`) is a frozen two-element array; the derived `PartialEq` compares through it
// (`InhabitedPredicate_eq`). `apply_inner::<!>` returns a `Result` whose `Err` never happens; the `let Ok(result) = ..`
// destructuring unwraps it. `in_module` / `reveal_opaque` are closures. `#[instrument]` is tracing only.
// `#[derive(StableHash)]` is not needed by the query engine (no incremental, M5).
import type { TyCtxt } from "../context.ts";
import type { GenericArgsRef } from "../generic_args.ts";
import type { Ty, TypingEnv } from "../mod.ts";
import { debug_Ty, fold_Ty } from "../structural_impls.ts";
import { type LocalModId, type ModId, ModId_eq, debug_ModId } from "../../../rustc_span/def_id.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { type Const, debug_Const, fold_Const } from "../../../rustc_type_ir/sty/mod.ts";
import { debug_OpaqueTypeKey, type OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type Debug, debug_list, debug_tuple } from "../../../std/fmt.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";

/// Represents whether some type is inhabited in a given context.
/// Examples of uninhabited types are `!`, `enum Void {}`, or a struct
/// containing either of those types.
/// A type's inhabitedness may depend on the `ParamEnv` as well as what types
/// are visible in the current module.
// rustc-type: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:16 InhabitedPredicate
export type InhabitedPredicate =
  /// Inhabited
  | { readonly $: "True" }
  /// Uninhabited
  | { readonly $: "False" }
  /// Uninhabited when a const value is non-zero. This occurs when there is an
  /// array of uninhabited items, but the array is inhabited if it is empty.
  | { readonly $: "ConstIsZero"; readonly _0: Const }
  /// Uninhabited if within a certain module. This occurs when an uninhabited
  /// type has restricted visibility.
  | { readonly $: "NotInModule"; readonly _0: ModId }
  /// Inhabited if some generic type is inhabited.
  /// These are replaced by calling [`Self::instantiate`].
  | { readonly $: "GenericType"; readonly _0: Ty }
  /// Inhabited if either we don't know the hidden type or we know it and it is inhabited.
  | { readonly $: "OpaqueType"; readonly _0: OpaqueTypeKey }
  /// A AND B
  | { readonly $: "And"; readonly _0: readonly [InhabitedPredicate, InhabitedPredicate] }
  /// A OR B
  | { readonly $: "Or"; readonly _0: readonly [InhabitedPredicate, InhabitedPredicate] };

type Self = InhabitedPredicate;

const TRUE: Self = Object.freeze({ $: "True" as const });
const FALSE: Self = Object.freeze({ $: "False" as const });

/** `tcx.arena.alloc([a, b])` */
function pair(a: Self, b: Self): readonly [Self, Self] {
  return Object.freeze([a, b] as const);
}

/** `#[derive(PartialEq)]` (`&'tcx [Self; 2]` compares its elements). */
export function InhabitedPredicate_eq(a: Self, b: Self): boolean {
  switch (a.$) {
    case "True":
    case "False":
      return b.$ === a.$;
    case "ConstIsZero":
      return b.$ === "ConstIsZero" && a._0 === b._0;
    case "NotInModule":
      return b.$ === "NotInModule" && ModId_eq(a._0, b._0);
    case "GenericType":
      return b.$ === "GenericType" && a._0 === b._0;
    case "OpaqueType":
      return b.$ === "OpaqueType" && a._0.def_id === b._0.def_id && a._0.args === b._0.args;
    case "And":
    case "Or":
      return b.$ === a.$ && InhabitedPredicate_eq(a._0[0], b._0[0]) && InhabitedPredicate_eq(a._0[1], b._0[1]);
  }
}

/** `#[derive(Debug)]` */
export const debug_InhabitedPredicate: Debug<InhabitedPredicate> = (v, f) => {
  switch (v.$) {
    case "True":
    case "False":
      return v.$;
    case "ConstIsZero":
      return debug_tuple(f, "ConstIsZero", [debug_Const(v._0, f)]);
    case "NotInModule":
      return debug_tuple(f, "NotInModule", [debug_ModId(v._0, f)]);
    case "GenericType":
      return debug_tuple(f, "GenericType", [debug_Ty(v._0, f)]);
    case "OpaqueType":
      return debug_tuple(f, "OpaqueType", [debug_OpaqueTypeKey(v._0, f)]);
    case "And":
    case "Or":
      return debug_tuple(f, v.$, [debug_list(f, [debug_InhabitedPredicate(v._0[0], f), debug_InhabitedPredicate(v._0[1], f)])]);
  }
};

export const InhabitedPredicate = {
  True: TRUE,
  False: FALSE,

  /// Returns true if the corresponding type is inhabited in the given `ParamEnv` and module.
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:40 apply
  apply(self: Self, tcx: TyCtxt, typing_env: TypingEnv, module_def_id: LocalModId): boolean {
    return InhabitedPredicate.apply_revealing_opaque(self, tcx, typing_env, module_def_id, (_) => undefined);
  },

  /// Returns true if the corresponding type is inhabited in the given `ParamEnv` and module,
  /// revealing opaques when possible.
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:51 apply_revealing_opaque
  apply_revealing_opaque(
    self: Self,
    tcx: TyCtxt,
    typing_env: TypingEnv,
    module_def_id: LocalModId,
    reveal_opaque: (key: OpaqueTypeKey) => Ty | undefined,
  ): boolean {
    const r = InhabitedPredicate.apply_inner<never>(self, tcx, typing_env, [], (id) => Ok(tcx.is_descendant_of(module_def_id, id)), reveal_opaque);
    // `let Ok(result) = ..` (`E = !`)
    return (r as { readonly $: "Ok"; readonly _0: boolean })._0;
  },

  /// Same as `apply`, but returns `None` if self contains a module predicate
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:69 apply_any_module
  apply_any_module(self: Self, tcx: TyCtxt, typing_env: TypingEnv): boolean | undefined {
    const r = InhabitedPredicate.apply_inner<null>(self, tcx, typing_env, [], (_) => Err(null), (_) => undefined);
    return r.$ === "Ok" ? r._0 : undefined;
  },

  /// Same as `apply`, but `NotInModule(_)` predicates yield `false`. That is,
  /// privately uninhabited types are considered always uninhabited.
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:75 apply_ignore_module
  apply_ignore_module(self: Self, tcx: TyCtxt, typing_env: TypingEnv): boolean {
    const r = InhabitedPredicate.apply_inner<never>(self, tcx, typing_env, [], (_) => Ok(true), (_) => undefined);
    // `let Ok(result) = ..` (`E = !`)
    return (r as { readonly $: "Ok"; readonly _0: boolean })._0;
  },

  // #[instrument(level = "debug", skip(tcx, typing_env, in_module, reveal_opaque), ret)]
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:84 apply_inner
  apply_inner<E>(
    self: Self,
    tcx: TyCtxt,
    typing_env: TypingEnv,
    eval_stack: Ty[], // for cycle detection
    in_module: (id: ModId) => Result<boolean, E>,
    reveal_opaque: (key: OpaqueTypeKey) => Ty | undefined,
  ): Result<boolean, E> {
    switch (self.$) {
      case "False":
        return Ok(false);
      case "True":
        return Ok(true);
      case "ConstIsZero": {
        const n = self._0.try_to_target_usize(tcx);
        return n === undefined || n === 0n ? Ok(true) : Ok(false);
      }
      case "NotInModule": {
        const r = in_module(self._0);
        return r.$ === "Ok" ? Ok(!r._0) : r;
      }
      // `t` may be a projection, for which `inhabited_predicate` returns a `GenericType`. As
      // we have a param_env available, we can do better.
      case "GenericType": {
        const t = self._0;
        const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(t), fold_Ty);
        const normalized_pred = n.$ === "Ok" ? n._0.inhabited_predicate(tcx) : self;
        switch (normalized_pred.$) {
          // We don't have more information than we started with, so consider inhabited.
          case "GenericType":
            return Ok(true);
          default: {
            const pred = normalized_pred;
            // A type which is cyclic when monomorphized can happen here since the
            // layout error would only trigger later. See e.g. `tests/ui/sized/recursive-type-2.rs`.
            if (eval_stack.includes(t)) {
              return Ok(true); // Recover; this will error later.
            }
            eval_stack.push(t);
            const ret = InhabitedPredicate.apply_inner(pred, tcx, typing_env, eval_stack, in_module, reveal_opaque);
            eval_stack.pop();
            return ret;
          }
        }
      }
      case "OpaqueType": {
        const t = reveal_opaque(self._0);
        // Unknown opaque is assumed inhabited.
        if (t === undefined) return Ok(true);
        // Known opaque type is inspected recursively.
        // A cyclic opaque type can happen in corner cases that would only error later.
        // See e.g. `tests/ui/type-alias-impl-trait/recursive-tait-conflicting-defn.rs`.
        if (eval_stack.includes(t)) {
          return Ok(true); // Recover; this will error later.
        }
        eval_stack.push(t);
        const ret = InhabitedPredicate.apply_inner(t.inhabited_predicate(tcx), tcx, typing_env, eval_stack, in_module, reveal_opaque);
        eval_stack.pop();
        return ret;
      }
      case "And": {
        const [a, b] = self._0;
        return try_and(a, b, (x) => InhabitedPredicate.apply_inner(x, tcx, typing_env, eval_stack, in_module, reveal_opaque));
      }
      case "Or": {
        const [a, b] = self._0;
        return try_or(a, b, (x) => InhabitedPredicate.apply_inner(x, tcx, typing_env, eval_stack, in_module, reveal_opaque));
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:154 and
  and(self: Self, tcx: TyCtxt, other: Self): Self {
    return InhabitedPredicate.reduce_and(self, tcx, other) ?? { $: "And", _0: pair(self, other) };
  },

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:158 or
  or(self: Self, tcx: TyCtxt, other: Self): Self {
    return InhabitedPredicate.reduce_or(self, tcx, other) ?? { $: "Or", _0: pair(self, other) };
  },

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:162 all
  all(tcx: TyCtxt, iter: Iterable<Self>): Self {
    let result: Self = TRUE;
    for (const pred of iter) {
      if (InhabitedPredicate_eq(pred, FALSE)) {
        return FALSE;
      }
      result = InhabitedPredicate.and(result, tcx, pred);
    }
    return result;
  },

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:173 any
  any(tcx: TyCtxt, iter: Iterable<Self>): Self {
    let result: Self = FALSE;
    for (const pred of iter) {
      if (InhabitedPredicate_eq(pred, TRUE)) {
        return TRUE;
      }
      result = InhabitedPredicate.or(result, tcx, pred);
    }
    return result;
  },

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:184 reduce_and
  reduce_and(self: Self, tcx: TyCtxt, other: Self): Self | undefined {
    // (Self::True, a) | (a, Self::True) => Some(a),
    if (self.$ === "True") return other;
    if (other.$ === "True") return self;
    // (Self::False, _) | (_, Self::False) => Some(Self::False),
    if (self.$ === "False" || other.$ === "False") return FALSE;
    if (self.$ === "ConstIsZero" && other.$ === "ConstIsZero" && self._0 === other._0) return { $: "ConstIsZero", _0: self._0 };
    if (self.$ === "NotInModule" && other.$ === "NotInModule") {
      const a = self._0;
      const b = other._0;
      if (ModId_eq(a, b)) return { $: "NotInModule", _0: a };
      if (tcx.is_descendant_of(a, b)) return { $: "NotInModule", _0: b };
      if (tcx.is_descendant_of(b, a)) return { $: "NotInModule", _0: a };
    }
    if (self.$ === "GenericType" && other.$ === "GenericType" && self._0 === other._0) return { $: "GenericType", _0: self._0 };
    // (Self::And(&[a, b]), c) | (c, Self::And(&[a, b]))
    let and_: [Self, Self, Self] | undefined;
    if (self.$ === "And") and_ = [self._0[0], self._0[1], other];
    else if (other.$ === "And") and_ = [other._0[0], other._0[1], self];
    if (and_ !== undefined) {
      const [a, b, c] = and_;
      const ac = InhabitedPredicate.reduce_and(a, tcx, c);
      if (ac !== undefined) {
        return InhabitedPredicate.and(ac, tcx, b);
      } else {
        const bc = InhabitedPredicate.reduce_and(b, tcx, c);
        if (bc !== undefined) {
          return { $: "And", _0: pair(a, bc) };
        } else {
          return undefined;
        }
      }
    }
    return undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:210 reduce_or
  reduce_or(self: Self, tcx: TyCtxt, other: Self): Self | undefined {
    // (Self::True, _) | (_, Self::True) => Some(Self::True),
    if (self.$ === "True" || other.$ === "True") return TRUE;
    // (Self::False, a) | (a, Self::False) => Some(a),
    if (self.$ === "False") return other;
    if (other.$ === "False") return self;
    if (self.$ === "ConstIsZero" && other.$ === "ConstIsZero" && self._0 === other._0) return { $: "ConstIsZero", _0: self._0 };
    if (self.$ === "NotInModule" && other.$ === "NotInModule") {
      const a = self._0;
      const b = other._0;
      if (ModId_eq(a, b)) return { $: "NotInModule", _0: a };
      if (tcx.is_descendant_of(a, b)) return { $: "NotInModule", _0: a };
      if (tcx.is_descendant_of(b, a)) return { $: "NotInModule", _0: b };
    }
    if (self.$ === "GenericType" && other.$ === "GenericType" && self._0 === other._0) return { $: "GenericType", _0: self._0 };
    // (Self::Or(&[a, b]), c) | (c, Self::Or(&[a, b]))
    let or_: [Self, Self, Self] | undefined;
    if (self.$ === "Or") or_ = [self._0[0], self._0[1], other];
    else if (other.$ === "Or") or_ = [other._0[0], other._0[1], self];
    if (or_ !== undefined) {
      const [a, b, c] = or_;
      const ac = InhabitedPredicate.reduce_or(a, tcx, c);
      if (ac !== undefined) {
        return InhabitedPredicate.or(ac, tcx, b);
      } else {
        const bc = InhabitedPredicate.reduce_or(b, tcx, c);
        if (bc !== undefined) {
          return { $: "Or", _0: pair(a, bc) };
        } else {
          return undefined;
        }
      }
    }
    return undefined;
  },

  /// Replaces generic types with its corresponding predicate
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:237 instantiate
  instantiate(self: Self, tcx: TyCtxt, args: GenericArgsRef): Self {
    return InhabitedPredicate.instantiate_opt(self, tcx, args) ?? self;
  },

  /// Same as [`Self::instantiate`], but if there is no generics to
  /// instantiate, returns `None`. This is useful because it lets us avoid
  /// allocating a recursive copy of everything when the result is unchanged.
  ///
  /// Only used to implement `instantiate` itself.
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:246 instantiate_opt
  instantiate_opt(self: Self, tcx: TyCtxt, args: GenericArgsRef): Self | undefined {
    switch (self.$) {
      case "ConstIsZero": {
        const c = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, self._0, fold_Const), tcx, args, fold_Const));
        const n = c.try_to_target_usize(tcx);
        const pred: Self = n === 0n ? TRUE : n !== undefined ? FALSE : { $: "ConstIsZero", _0: c };
        return pred;
      }
      case "GenericType":
        return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, self._0, fold_Ty), tcx, args, fold_Ty)).inhabited_predicate(tcx);
      case "And": {
        const [a, b] = self._0;
        const a_ = InhabitedPredicate.instantiate_opt(a, tcx, args);
        if (a_ === undefined) {
          const b_ = InhabitedPredicate.instantiate_opt(b, tcx, args);
          return b_ === undefined ? undefined : InhabitedPredicate.and(a, tcx, b_);
        } else if (a_.$ === "False") {
          return FALSE;
        } else {
          return InhabitedPredicate.and(a_, tcx, InhabitedPredicate.instantiate_opt(b, tcx, args) ?? b);
        }
      }
      case "Or": {
        const [a, b] = self._0;
        const a_ = InhabitedPredicate.instantiate_opt(a, tcx, args);
        if (a_ === undefined) {
          const b_ = InhabitedPredicate.instantiate_opt(b, tcx, args);
          return b_ === undefined ? undefined : InhabitedPredicate.or(a, tcx, b_);
        } else if (a_.$ === "True") {
          return TRUE;
        } else {
          return InhabitedPredicate.or(a_, tcx, InhabitedPredicate.instantiate_opt(b, tcx, args) ?? b);
        }
      }
      case "True":
      case "False":
      case "NotInModule":
        return undefined;
      case "OpaqueType":
        return bug("unexpected OpaqueType in InhabitedPredicate");
    }
  },
};

// this is basically like `f(a)? && f(b)?` but different in the case of
// `Ok(false) && Err(_) -> Ok(false)`
// rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:283 try_and
function try_and<T, E>(a: T, b: T, f: (x: T) => Result<boolean, E>): Result<boolean, E> {
  const a_ = f(a);
  if (a_.$ === "Ok" && a_._0 === false) {
    return Ok(false);
  }
  const b_ = f(b);
  // (_, Ok(false)) | (Ok(false), _) => Ok(false),
  if ((b_.$ === "Ok" && b_._0 === false) || (a_.$ === "Ok" && a_._0 === false)) return Ok(false);
  // (Ok(true), Ok(true)) => Ok(true),
  if (a_.$ === "Ok" && b_.$ === "Ok") return Ok(true);
  // (Err(e), _) | (_, Err(e)) => Err(e),
  return a_.$ === "Err" ? a_ : b_;
}

// rustc: compiler/rustc_middle/src/ty/inhabitedness/inhabited_predicate.rs:295 try_or
function try_or<T, E>(a: T, b: T, f: (x: T) => Result<boolean, E>): Result<boolean, E> {
  const a_ = f(a);
  if (a_.$ === "Ok" && a_._0 === true) {
    return Ok(true);
  }
  const b_ = f(b);
  // (_, Ok(true)) | (Ok(true), _) => Ok(true),
  if ((b_.$ === "Ok" && b_._0 === true) || (a_.$ === "Ok" && a_._0 === true)) return Ok(true);
  // (Ok(false), Ok(false)) => Ok(false),
  if (a_.$ === "Ok" && b_.$ === "Ok") return Ok(false);
  // (Err(e), _) | (_, Err(e)) => Err(e),
  return a_.$ === "Err" ? a_ : b_;
}

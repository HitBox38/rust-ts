//! Trait Resolution. See the [rustc dev guide] for more information on how this works.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/resolution.html
// Port of compiler/rustc_middle/src/traits/mod.rs (lane middle-traits-thir). The data types are generated
// (mod.gen.ts, set rustc_middle_traits_thir); this file holds the impls. Enum methods live on the companion consts
// (PORTING §8); `ObligationCause` is a class (the generated one), its statics are added below.
import type { Diag } from "../../rustc_errors/diagnostic.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { CRATE_DEF_ID } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { OrdSpan } from "../../rustc_span/span_encoding.ts";
import { display_Symbol, sym } from "../../rustc_span/symbol.ts";
import { fold_with_Binder, try_fold_with_Binder, visit_with_Binder } from "../../rustc_type_ir/binder.ts";
import type { FallibleTypeFolder, TypeFolder } from "../../rustc_type_ir/fold.ts";
import { fold_with_TraitClause, try_fold_with_TraitClause, visit_with_TraitClause } from "../../rustc_type_ir/predicate.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTyKind, fold_with_FnSig, try_fold_with_AliasTyKind, try_fold_with_FnSig, visit_with_AliasTyKind, visit_with_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import type { Fmt } from "../../std/fmt.ts";
import type { Hasher } from "../../vendor/rustc_stable_hash/lib.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { HostEffectClause, PolyTraitClause } from "../ty/predicate.ts";
import type { AliasTy, PolyFnSig } from "../ty/sty.gen.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import * as gen from "./mod.gen.ts";
import {
  debug_ObligationCauseCode,
  type DerivedCause,
  type DerivedHostCause,
  type ImplDerivedCause,
  type ImplDerivedHostCause,
  type ImplSourceUserDefinedData,
  ObligationCause,
} from "./mod.gen.ts";
import { SelectionError_from_OverflowError } from "./select.ts";
import { ConstraintCategory } from "../mir/query.ts";

export * as cache from "./cache.ts";
export * as query from "./query.ts";
export * as select from "./select.ts";
export * as solve from "./solve.ts";
export * as specialization_graph from "./specialization_graph.ts";
// mod structural_impls; (Debug of ImplSource / ImplSourceUserDefinedData)
export { debug_ImplSource, debug_ImplSourceUserDefinedData } from "./structural_impls.ts";

export * from "./mod.gen.ts";

export { EvaluationResult, OverflowError } from "./select.ts";
export type { EvaluationCache, SelectionCache } from "./select.ts";
export type { BuiltinImplSource } from "./solve.ts";

declare module "./mod.gen.ts" {
  interface ObligationCause {
    code_(): ObligationCauseCode;
    map_code(f: (code: ObligationCauseCodeHandle) => ObligationCauseCode): void;
    derived_cause(parent_trait_pred: PolyTraitClause, variant: (d: DerivedCause) => ObligationCauseCode): ObligationCause;
    derived_host_cause(
      parent_host_clause: Binder<HostEffectClause>,
      variant: (d: DerivedHostCause) => ObligationCauseCode,
    ): ObligationCause;
    to_constraint_category(): ConstraintCategory;
  }
  namespace ObligationCause {
    function new_(span: Span, body_def_id: LocalDefId, code: ObligationCauseCode): ObligationCause;
    export { new_ as new };
    export function misc(span: Span, body_def_id: LocalDefId): ObligationCause;
    export function dummy(): ObligationCause;
    export function dummy_with_span(span: Span): ObligationCause;
  }
}

// This custom hash function speeds up hashing for `Obligation` deduplication
// greatly by skipping the `code` field, which can be large and complex. That
// shouldn't affect hash quality much since there are several other fields in
// `Obligation` which should be unique enough, especially the predicate itself
// which is hashed as an interned pointer. See #90996.
// rustc: compiler/rustc_middle/src/traits/mod.rs:64 hash
export function hash_ObligationCause(self: ObligationCause, state: Hasher): void {
  // `self.body_def_id.hash(state)`: `LocalDefId { local_def_index: DefIndex(u32) }`
  state.write_u32(self.body_def_id);
  // `self.span.hash(state)`
  void self.span;
  unported("rustc_span::Span: Hash (the derived Hash of the compact span; the port's Span is an interner index)");
}

Object.assign(ObligationCause, {
  // rustc: compiler/rustc_middle/src/traits/mod.rs:72 new
  new(span: Span, body_def_id: LocalDefId, code: ObligationCauseCode): ObligationCause {
    return new ObligationCause(span, body_def_id, ObligationCauseCode.into(code));
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:80 misc
  misc(span: Span, body_def_id: LocalDefId): ObligationCause {
    return ObligationCause.new(span, body_def_id, gen.ObligationCauseCode.Misc);
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:85 dummy
  dummy(): ObligationCause {
    return ObligationCause.dummy_with_span(DUMMY_SP);
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:90 dummy_with_span
  dummy_with_span(span: Span): ObligationCause {
    return new ObligationCause(span, CRATE_DEF_ID, ObligationCauseCodeHandle.default_());
  },
});

// PORT: `fn code(&self)` is `code_()`: the generated class has the (private upstream) field `code` (precedent:
// rustc_hir hir.ts `args_` / `span_ext_`).
// rustc: compiler/rustc_middle/src/traits/mod.rs:95 code
ObligationCause.prototype.code_ = function (this: ObligationCause): ObligationCauseCode {
  return ObligationCauseCodeHandle.deref(this.code);
};

// rustc: compiler/rustc_middle/src/traits/mod.rs:99 map_code
ObligationCause.prototype.map_code = function (
  this: ObligationCause,
  f: (code: ObligationCauseCodeHandle) => ObligationCauseCode,
): void {
  // `std::mem::take(&mut self.code)`: the handle, leaving the default (`Misc`) behind
  const taken = this.code;
  this.code = ObligationCauseCodeHandle.default_();
  this.code = ObligationCauseCode.into(f(taken));
};

// rustc: compiler/rustc_middle/src/traits/mod.rs:106 derived_cause
ObligationCause.prototype.derived_cause = function (
  this: ObligationCause,
  parent_trait_pred: PolyTraitClause,
  variant: (d: DerivedCause) => ObligationCauseCode,
): ObligationCause {
  /*!
   * Creates a cause for obligations that are derived from
   * `obligation` by a recursive search (e.g., for a builtin
   * bound, or eventually a `auto trait Foo`). If `obligation`
   * is itself a derived obligation, this is just a clone, but
   * otherwise we create a "derived obligation" cause so as to
   * keep track of the original root obligation for error
   * reporting.
   */

  // NOTE(flaper87): As of now, it keeps track of the whole error
  // chain. Ideally, we should have a way to configure this either
  // by using -Z verbose-internals or just a CLI argument.
  this.code = ObligationCauseCode.into(variant({ parent_trait_pred, parent_code: this.code }));
  return this;
};

// rustc: compiler/rustc_middle/src/traits/mod.rs:128 derived_host_cause
ObligationCause.prototype.derived_host_cause = function (
  this: ObligationCause,
  parent_host_clause: Binder<HostEffectClause>,
  variant: (d: DerivedHostCause) => ObligationCauseCode,
): ObligationCause {
  this.code = ObligationCauseCode.into(variant({ parent_host_clause, parent_code: this.code }));
  return this;
};

// rustc: compiler/rustc_middle/src/traits/mod.rs:137 to_constraint_category
ObligationCause.prototype.to_constraint_category = function (this: ObligationCause): ConstraintCategory {
  const code = this.code_();
  switch (code.$) {
    case "MatchImpl":
      return code._0.to_constraint_category();
    case "AscribeUserTypeProvePredicate":
      return { $: "Predicate", _0: code._0, _1: code._1 };
    default:
      return ConstraintCategory.BoringNoLocation;
  }
};

/// A compact form of `ObligationCauseCode`.
export type ObligationCauseCodeHandle = gen.ObligationCauseCodeHandle;
export const ObligationCauseCodeHandle = {
  /** `#[derive(Default)]`: `code: None` (`Misc`). */
  default_(): ObligationCauseCodeHandle {
    return { code: undefined };
  },

  // `impl Deref for ObligationCauseCodeHandle`
  // rustc: compiler/rustc_middle/src/traits/mod.rs:176 deref
  deref(self: ObligationCauseCodeHandle): ObligationCauseCode {
    return self.code ?? gen.ObligationCauseCode.Misc;
  },
};

// `impl Debug for ObligationCauseCodeHandle`
// rustc: compiler/rustc_middle/src/traits/mod.rs:158 fmt
export function debug_ObligationCauseCodeHandle(self: ObligationCauseCodeHandle, f: Fmt): string {
  const cause: ObligationCauseCode = ObligationCauseCodeHandle.deref(self);
  return debug_ObligationCauseCode(cause, f);
}

export type ObligationCauseCode = gen.ObligationCauseCode;
export const ObligationCauseCode = {
  ...gen.ObligationCauseCode,

  // rustc: compiler/rustc_middle/src/traits/mod.rs:166 into
  into(self: ObligationCauseCode): ObligationCauseCodeHandle {
    // PORT: `Arc::new(self)` is the value itself (PORTING §5).
    return { code: self.$ === "Misc" ? undefined : self };
  },

  /// Returns the base obligation, ignoring derived obligations.
  // rustc: compiler/rustc_middle/src/traits/mod.rs:470 peel_derives
  peel_derives(self: ObligationCauseCode): ObligationCauseCode {
    let base_cause = self;
    let parent_code: ObligationCauseCode | undefined;
    while ((parent_code = ObligationCauseCode.parent(base_cause)) !== undefined) {
      base_cause = parent_code;
    }
    return base_cause;
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:478 parent
  parent(self: ObligationCauseCode): ObligationCauseCode | undefined {
    switch (self.$) {
      case "FunctionArg":
        return ObligationCauseCodeHandle.deref(self.parent_code);
      case "BuiltinDerived":
      case "WellFormedDerived":
        return ObligationCauseCodeHandle.deref(self._0.parent_code);
      case "ImplDerived":
        return ObligationCauseCodeHandle.deref((self._0 satisfies ImplDerivedCause).derived.parent_code);
      case "BuiltinDerivedHost":
        return ObligationCauseCodeHandle.deref(self._0.parent_code);
      case "ImplDerivedHost":
        return ObligationCauseCodeHandle.deref((self._0 satisfies ImplDerivedHostCause).derived.parent_code);
      default:
        return undefined;
    }
  },

  /// Returns the base obligation and the base trait predicate, if any, ignoring
  /// derived obligations.
  // rustc: compiler/rustc_middle/src/traits/mod.rs:496 peel_derives_with_predicate
  peel_derives_with_predicate(self: ObligationCauseCode): [ObligationCauseCode, PolyTraitClause | undefined] {
    let base_cause = self;
    let base_trait_pred: PolyTraitClause | undefined = undefined;
    let next: [ObligationCauseCode, PolyTraitClause | undefined] | undefined;
    while ((next = ObligationCauseCode.parent_with_predicate(base_cause)) !== undefined) {
      const [parent_code, parent_pred] = next;
      base_cause = parent_code;
      if (parent_pred !== undefined) {
        base_trait_pred = parent_pred;
      }
    }

    return [base_cause, base_trait_pred];
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:509 parent_with_predicate
  parent_with_predicate(self: ObligationCauseCode): [ObligationCauseCode, PolyTraitClause | undefined] | undefined {
    switch (self.$) {
      case "FunctionArg":
        return [ObligationCauseCodeHandle.deref(self.parent_code), undefined];
      case "BuiltinDerived":
      case "WellFormedDerived":
        return [ObligationCauseCodeHandle.deref(self._0.parent_code), self._0.parent_trait_pred];
      case "ImplDerived": {
        const derived = self._0.derived;
        return [ObligationCauseCodeHandle.deref(derived.parent_code), derived.parent_trait_pred];
      }
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:521 peel_match_impls
  peel_match_impls(self: ObligationCauseCode): ObligationCauseCode {
    switch (self.$) {
      case "MatchImpl":
        return self._0.code_();
      default:
        return self;
    }
  },
};

// `ObligationCauseCode` is used a lot. Make sure it doesn't unintentionally get bigger.
// (`static_assert_size!(ObligationCauseCode<'_>, 48)`: no TS counterpart.)

export type SelectionError = gen.SelectionError;
export const SelectionError = {
  ...gen.SelectionError,
  /** `impl From<OverflowError> for SelectionError` (select.rs:275, ported in select.ts). */
  from: SelectionError_from_OverflowError,
};

export type ImplSource<N> = gen.ImplSource<N>;
export const ImplSource = {
  // rustc: compiler/rustc_middle/src/traits/mod.rs:704 nested_obligations
  nested_obligations<N>(self: ImplSource<N>): N[] {
    switch (self.$) {
      case "UserDefined":
        return self._0.nested;
      case "Param":
        return self._0;
      case "Builtin":
        return self._1;
    }
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:711 borrow_nested_obligations
  borrow_nested_obligations<N>(self: ImplSource<N>): readonly N[] {
    switch (self.$) {
      case "UserDefined":
        return self._0.nested;
      case "Param":
        return self._0;
      case "Builtin":
        return self._1;
    }
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:718 borrow_nested_obligations_mut
  borrow_nested_obligations_mut<N>(self: ImplSource<N>): N[] {
    switch (self.$) {
      case "UserDefined":
        return self._0.nested;
      case "Param":
        return self._0;
      case "Builtin":
        return self._1;
    }
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:725 map
  map<N, M>(self: ImplSource<N>, f: (n: N) => M): ImplSource<M> {
    switch (self.$) {
      case "UserDefined": {
        const i: ImplSourceUserDefinedData<N> = self._0;
        return {
          $: "UserDefined",
          _0: {
            impl_def_id: i.impl_def_id,
            args: i.args,
            nested: i.nested.map((n) => f(n)),
          },
        };
      }
      case "Param":
        return { $: "Param", _0: self._0.map((n) => f(n)) };
      case "Builtin":
        return { $: "Builtin", _0: self._0, _1: self._1.map((n) => f(n)) };
    }
  },
};

export type DynCompatibilityViolation = gen.DynCompatibilityViolation;
export const DynCompatibilityViolation = {
  // rustc: compiler/rustc_middle/src/traits/mod.rs:790 error_msg
  error_msg(self: DynCompatibilityViolation): string {
    // FIXME(mgca): For method violations we just say "method ..." but for assoc const ones we
    //              say "it contains ... associated constant ...". Make it consistent.

    switch (self.$) {
      case "ExplicitlyDynIncompatible":
        return "it opted out of dyn-compatibility";
      case "SizedSelf":
        return "it requires `Self: Sized`";
      case "SupertraitSelf": {
        const spans = self._0;
        if (spans.some((sp) => sp !== DUMMY_SP)) {
          return "it uses `Self` as a type parameter";
        } else {
          return "it cannot use `Self` as a type parameter in a supertrait or `where`-clause";
        }
      }
      case "SupertraitNonLifetimeBinder":
        return "where clause cannot reference non-lifetime `for<...>` variables";
      case "SupertraitConst":
        return "it cannot have a `const` supertrait";
      case "Method": {
        const name = display_Symbol(self._0);
        switch (self._1.$) {
          case "StaticMethod":
            return `associated function \`${name}\` has no \`self\` parameter`;
          case "ReferencesSelfInput":
            if (self._2 === DUMMY_SP) {
              return `method \`${name}\` references the \`Self\` type in its parameters`;
            }
            return `method \`${name}\` references the \`Self\` type in this parameter`;
          case "ReferencesSelfOutput":
            return `method \`${name}\` references the \`Self\` type in its return type`;
          case "ReferencesImplTraitInTrait":
            return `method \`${name}\` references an \`impl Trait\` type in its return type`;
          case "AsyncFn":
            return `method \`${name}\` is \`async\``;
          case "CVariadic":
            return `method \`${name}\` is C-variadic`;
          case "WhereClauseReferencesSelf":
            return `method \`${name}\` references the \`Self\` type in its \`where\` clause`;
          case "Generic":
            return `method \`${name}\` has generic type parameters`;
          case "UndispatchableReceiver":
            return `method \`${name}\`'s \`self\` parameter cannot be dispatched on`;
        }
      }
      case "AssocConst": {
        const name = display_Symbol(self._0);
        switch (self._1) {
          case "FeatureNotEnabled":
            return `it contains associated const \`${name}\``;
          case "NonType":
            return `it contains associated const \`${name}\` that's not defined as \`#[rustc_always_gca]\``;
          case "Generic":
            return `it contains generic associated const \`${name}\``;
          case "TypeReferencesSelf":
            return `it contains associated const \`${name}\` whose type references the \`Self\` type`;
        }
      }
      case "GenericAssocTy":
        return `it contains generic associated type \`${display_Symbol(self._0)}\``;
    }
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:859 solution
  solution(self: DynCompatibilityViolation): gen.DynCompatibilityViolationSolution {
    switch (self.$) {
      case "ExplicitlyDynIncompatible":
      case "SizedSelf":
      case "SupertraitSelf":
      case "SupertraitNonLifetimeBinder":
      case "SupertraitConst":
        return gen.DynCompatibilityViolationSolution.None;
      case "Method": {
        const name = self._0;
        const mv = self._1;
        if (mv.$ === "StaticMethod" && mv._0 !== undefined) {
          const [[add_s, add_sp], [make_s, make_sp]] = mv._0;
          return {
            $: "AddSelfOrMakeSized",
            name,
            add_self_sugg: [add_s, new OrdSpan(add_sp)],
            make_sized_sugg: [make_s, new OrdSpan(make_sp)],
          };
        }
        if (mv.$ === "UndispatchableReceiver" && mv._0 !== undefined) {
          const [span, lt] = mv._0;
          return { $: "ChangeToRefSelf", _0: name, _1: new OrdSpan(span), _2: lt };
        }
        return { $: "MoveToAnotherTrait", _0: name };
      }
      case "AssocConst":
      case "GenericAssocTy":
        return { $: "MoveToAnotherTrait", _0: self._0 };
    }
  },

  // rustc: compiler/rustc_middle/src/traits/mod.rs:884 spans
  spans(self: DynCompatibilityViolation): Span[] {
    // When `span` comes from a separate crate, it'll be `DUMMY_SP`. Treat it as `None` so
    // diagnostics use a `note` instead of a `span_label`.
    switch (self.$) {
      case "ExplicitlyDynIncompatible":
      case "SizedSelf":
      case "SupertraitSelf":
      case "SupertraitNonLifetimeBinder":
      case "SupertraitConst":
        return [...self._0];
      case "Method":
      case "AssocConst":
      case "GenericAssocTy": {
        const span = self.$ === "GenericAssocTy" ? self._1 : self._2;
        if (span !== DUMMY_SP) {
          return [span];
        } else {
          return [];
        }
      }
    }
  },
};

export type DynCompatibilityViolationSolution = gen.DynCompatibilityViolationSolution;
export const DynCompatibilityViolationSolution = {
  ...gen.DynCompatibilityViolationSolution,

  // rustc: compiler/rustc_middle/src/traits/mod.rs:919 add_to
  add_to(self: DynCompatibilityViolationSolution, err: Diag): void {
    switch (self.$) {
      case "None":
        break;
      case "AddSelfOrMakeSized": {
        const { name, add_self_sugg, make_sized_sugg } = self;
        err.span_suggestion_verbose(
          add_self_sugg[1]._0,
          `consider turning \`${display_Symbol(name)}\` into a method by giving it a \`&self\` argument, so that it is accessible through the trait object's vtable`,
          add_self_sugg[0],
          "MaybeIncorrect",
        );
        err.span_suggestion_verbose(
          make_sized_sugg[1]._0,
          `alternatively, consider constraining \`${display_Symbol(name)}\` so it is explicitly marked as not applying to trait objects`,
          make_sized_sugg[0],
          "MaybeIncorrect",
        );
        break;
      }
      case "ChangeToRefSelf": {
        const name = self._0;
        const span = self._1;
        const lt = self._2;
        err.span_suggestion_verbose(
          span._0,
          `consider changing method \`${display_Symbol(name)}\`'s \`self\` parameter to be \`&self\``,
          `&${display_Symbol(lt)}${lt !== sym.empty ? " " : ""}self`,
          "MachineApplicable",
        );
        break;
      }
      case "MoveToAnotherTrait":
        err.help(`consider moving \`${display_Symbol(self._0)}\` to another trait`);
        break;
    }
  },
};

// ---- impls for the aliases the generated code traverses (type_fold.json) ------------------------------------------

/** PORT: `impl TypeVisitable for Binder<TraitClause>` (`ty::PolyTraitClause<'tcx>`): binder.rs's impl applied to
 *  TraitClause's derived one. type_fold.json points the alias here, as an alias carries no impl of its own. */
export function visit_with_PolyTraitClause<R>(self: PolyTraitClause, visitor: TypeVisitor<R>): R {
  return visit_with_Binder(self, visitor, visit_with_TraitClause);
}
export function try_fold_with_PolyTraitClause<E>(self: PolyTraitClause, folder: FallibleTypeFolder<E>): Result<PolyTraitClause, E> {
  return try_fold_with_Binder(self, folder, try_fold_with_TraitClause);
}
export function fold_with_PolyTraitClause(self: PolyTraitClause, folder: TypeFolder): PolyTraitClause {
  return fold_with_Binder(self, folder, fold_with_TraitClause);
}

/** PORT: `impl TypeVisitable for Binder<FnSig>` (`ty::PolyFnSig<'tcx>`): binder.rs's impl applied to FnSig's derived
 *  one. type_fold.json points the alias here (lane typeck-gaps; e.g. hir_typeck closure.rs `ExpectedSig`). */
export function visit_with_PolyFnSig<R>(self: PolyFnSig, visitor: TypeVisitor<R>): R {
  return visit_with_Binder(self, visitor, visit_with_FnSig);
}
export function try_fold_with_PolyFnSig<E>(self: PolyFnSig, folder: FallibleTypeFolder<E>): Result<PolyFnSig, E> {
  return try_fold_with_Binder(self, folder, try_fold_with_FnSig);
}
export function fold_with_PolyFnSig(self: PolyFnSig, folder: TypeFolder): PolyFnSig {
  return fold_with_Binder(self, folder, fold_with_FnSig);
}

/** PORT: `impl TypeVisitable for ty::AliasTy<'tcx>` (`ir::Alias<TyCtxt, AliasTyKind>`): alias.rs's derived impl applied
 *  to AliasTyKind's. type_fold.json points the alias here. */
export function visit_with_AliasTy<R>(self: AliasTy, visitor: TypeVisitor<R>): R {
  return visit_with_Alias(self, visitor, visit_with_AliasTyKind);
}
export function try_fold_with_AliasTy<E>(self: AliasTy, folder: FallibleTypeFolder<E>): Result<AliasTy, E> {
  return try_fold_with_Alias(self, folder, try_fold_with_AliasTyKind);
}
export function fold_with_AliasTy(self: AliasTy, folder: TypeFolder): AliasTy {
  return fold_with_Alias(self, folder, fold_with_AliasTyKind);
}


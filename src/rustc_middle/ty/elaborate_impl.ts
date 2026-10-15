// Port of compiler/rustc_middle/src/ty/elaborate_impl.rs (lane small-gaps-18).
//
// PORT: each `impl Elaboratable<TyCtxt<'tcx>> for X` is the D4 descriptor `Elaboratable_X: Elaboratable<X>` of
// rustc_type_ir elaborate.ts (the impl fns over `self: X`). `(ty::Clause<'tcx>, Span)` is the tuple `[Clause, Span]`.
// This module has only type imports, so any module may import it statically.
import type { Span } from "../../rustc_span/lib.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import type { Elaboratable } from "../../rustc_type_ir/elaborate.ts";
import type { TraitClause } from "../../rustc_type_ir/predicate.ts";
import type { Clause, Predicate } from "./decls.ts";

/** `impl<'tcx> Elaboratable<TyCtxt<'tcx>> for ty::Clause<'tcx>` */
export const Elaboratable_Clause: Elaboratable<Clause> = {
  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:7 predicate
  predicate(self: Clause): Predicate {
    return self.as_predicate();
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:11 child
  child(_self: Clause, clause: Clause): Clause {
    return clause;
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:15 child_with_derived_cause
  child_with_derived_cause(_self: Clause, clause: Clause, _span: Span, _parent_trait_pred: Binder<TraitClause>, _index: number): Clause {
    return clause;
  },
};

/** `impl<'tcx> Elaboratable<TyCtxt<'tcx>> for ty::Predicate<'tcx>` */
export const Elaboratable_Predicate: Elaboratable<Predicate> = {
  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:27 predicate
  predicate(self: Predicate): Predicate {
    return self;
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:31 child
  child(_self: Predicate, clause: Clause): Predicate {
    return clause.as_predicate();
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:35 child_with_derived_cause
  child_with_derived_cause(_self: Predicate, clause: Clause, _span: Span, _parent_trait_pred: Binder<TraitClause>, _index: number): Predicate {
    return clause.as_predicate();
  },
};

/** `impl<'tcx> Elaboratable<TyCtxt<'tcx>> for (ty::Predicate<'tcx>, Span)` */
export const Elaboratable_Predicate_Span: Elaboratable<[Predicate, Span]> = {
  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:47 predicate
  predicate(self: [Predicate, Span]): Predicate {
    return self[0];
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:51 child
  child(self: [Predicate, Span], clause: Clause): [Predicate, Span] {
    return [clause.as_predicate(), self[1]];
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:55 child_with_derived_cause
  child_with_derived_cause(self: [Predicate, Span], clause: Clause, _span: Span, _parent_trait_pred: Binder<TraitClause>, _index: number): [Predicate, Span] {
    return [clause.as_predicate(), self[1]];
  },
};

/** `impl<'tcx> Elaboratable<TyCtxt<'tcx>> for (ty::Clause<'tcx>, Span)` */
export const Elaboratable_Clause_Span: Elaboratable<[Clause, Span]> = {
  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:67 predicate
  predicate(self: [Clause, Span]): Predicate {
    return self[0].as_predicate();
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:71 child
  child(self: [Clause, Span], clause: Clause): [Clause, Span] {
    return [clause, self[1]];
  },

  // rustc: compiler/rustc_middle/src/ty/elaborate_impl.rs:75 child_with_derived_cause
  child_with_derived_cause(self: [Clause, Span], clause: Clause, _span: Span, _parent_trait_pred: Binder<TraitClause>, _index: number): [Clause, Span] {
    return [clause, self[1]];
  },
};

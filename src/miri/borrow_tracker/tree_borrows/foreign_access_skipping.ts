// Port of src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Its types are generated into foreign_access_skipping.gen.ts (tools/codegen set
// `miri`); this module re-exports them.
//
// PORT: `impl IdempotentForeignAccess` on the generated companion (PORTING §8). The two `&mut self` methods take a
// `MutRef` (`record_new(field_mut(state, "idempotent_foreign_access"), ..)`, PORTING §8 "single-value handles").
// The derived `PartialOrd` is `IdempotentForeignAccess_discriminant`.
import * as gen from "./foreign_access_skipping.gen.ts";
import { type AccessKind } from "../mod.ts";
import { type AccessRelatedness } from "./tree.ts";
import { type MutRef } from "../../../std/mut_ref.ts";
export * from "./foreign_access_skipping.gen.ts";

/** PORT: the methods of `impl IdempotentForeignAccess` on the generated companion (PORTING §8). */
export interface IdempotentForeignAccess_methods {
  can_skip_foreign_access(self: IdempotentForeignAccess, happening_next: IdempotentForeignAccess): boolean;
  record_new(self: MutRef<IdempotentForeignAccess>, just_happened: IdempotentForeignAccess): void;
  is_local(self: IdempotentForeignAccess): boolean;
  is_foreign(self: IdempotentForeignAccess): boolean;
  from_foreign(acc: AccessKind): IdempotentForeignAccess;
  from_acc_and_rel(acc: AccessKind, rel: AccessRelatedness): IdempotentForeignAccess;
  ensure_no_stronger_than(self: MutRef<IdempotentForeignAccess>, strongest_allowed: IdempotentForeignAccess): boolean;
}
export type IdempotentForeignAccess = gen.IdempotentForeignAccess;
export const IdempotentForeignAccess = gen.IdempotentForeignAccess as typeof gen.IdempotentForeignAccess & IdempotentForeignAccess_methods;

const discriminant = gen.IdempotentForeignAccess_discriminant;

// impl IdempotentForeignAccess
/// Returns true if a node where the strongest idempotent foreign access is `self`
/// can skip the access `happening_next`. Note that if this returns
/// `true`, then the entire subtree will be skipped.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:40 can_skip_foreign_access
IdempotentForeignAccess.can_skip_foreign_access = function (self: IdempotentForeignAccess, happening_next: IdempotentForeignAccess): boolean {
  // debug_assert!(happening_next.is_foreign());
  // This ordering is correct. Intuitively, if the last access here was
  // a foreign write, everything can be skipped, since after a foreign write,
  // all further foreign accesses are idempotent
  return discriminant[happening_next] <= discriminant[self];
};

/// Updates `self` to account for a foreign access.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:49 record_new
IdempotentForeignAccess.record_new = function (self: MutRef<IdempotentForeignAccess>, just_happened: IdempotentForeignAccess): void {
  if (IdempotentForeignAccess.is_local(just_happened)) {
    // If the access is local, reset it.
    self.value = "None";
  } else {
    // Otherwise, keep it or stengthen it.
    // `just_happened.max(*self)`
    if (discriminant[just_happened] >= discriminant[self.value]) self.value = just_happened;
  }
};

/// Returns true if this access is local.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:60 is_local
IdempotentForeignAccess.is_local = function (self: IdempotentForeignAccess): boolean {
  return self === "None";
};

/// Returns true if this access is foreign, i.e. not local.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:65 is_foreign
IdempotentForeignAccess.is_foreign = function (self: IdempotentForeignAccess): boolean {
  return !IdempotentForeignAccess.is_local(self);
};

/// Constructs a foreign access from an `AccessKind`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:70 from_foreign
IdempotentForeignAccess.from_foreign = function (acc: AccessKind): IdempotentForeignAccess {
  switch (acc) {
    case "Read":
      return "Read";
    case "Write":
      return "Write";
  }
};

/// Usually, tree traversals have an `AccessKind` and an `AccessRelatedness`.
/// This methods converts these into the corresponding `IdempotentForeignAccess`, to be used
/// to e.g. invoke `can_skip_foreign_access`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:80 from_acc_and_rel
IdempotentForeignAccess.from_acc_and_rel = function (acc: AccessKind, rel: AccessRelatedness): IdempotentForeignAccess {
  // PORT(contract): pending miri-tb-b: `rel.is_foreign()` (tree.rs:1231) is the one-arm `matches!` inlined.
  return rel === "ForeignAccess" ? IdempotentForeignAccess.from_foreign(acc) : "None";
};

/// During retags, the SIFA needs to be weakened to account for children with weaker SIFAs being inserted.
/// Thus, this method is called from the bottom up on each parent, until it returns false, which means the
/// "children have stronger SIFAs" invariant is restored.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs:87 ensure_no_stronger_than
IdempotentForeignAccess.ensure_no_stronger_than = function (self: MutRef<IdempotentForeignAccess>, strongest_allowed: IdempotentForeignAccess): boolean {
  if (discriminant[self.value] > discriminant[strongest_allowed]) {
    self.value = strongest_allowed;
    return true;
  } else {
    return false;
  }
};

// #[cfg(test)] mod tests: foreign_access_skipping.test.ts

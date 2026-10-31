// Port of src/tools/miri/src/borrow_tracker/tree_borrows/foreign_access_skipping.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into foreign_access_skipping.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
export * from "./foreign_access_skipping.gen.ts";

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl IdempotentForeignAccess (borrow_tracker/tree_borrows/foreign_access_skipping.rs:36) [IdempotentForeignAccess is not a generated class: companion fns / hand type, lane decides]: can_skip_foreign_access (:40), record_new (:49), is_local (:60), is_foreign (:65), from_foreign (:70), from_acc_and_rel (:80), ensure_no_stronger_than (:87)
// #[cfg(test)] mod tests (borrow_tracker/tree_borrows/foreign_access_skipping.rs:98): unit tests (port into a `.test.ts` next to this file)

// Port of src/tools/miri/src/shims/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
export * from "./mod.gen.ts";

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl EmulateItemResult (shims/mod.rs:45) [EmulateItemResult is not a generated class: companion fns / hand type, lane decides]: jump_to_next_block (:46)

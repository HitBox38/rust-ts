// Port of src/tools/miri/src/concurrency/data_race_handler.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-race` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into data_race_handler.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
export * from "./data_race_handler.gen.ts";

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl GlobalDataRaceHandler (concurrency/data_race_handler.rs:34) [GlobalDataRaceHandler is not a generated class: companion fns / hand type, lane decides]: is_none (:35), as_vclocks_ref (:39), as_vclocks_mut (:43), as_genmc_ref (:47)
// impl AllocDataRaceHandler (concurrency/data_race_handler.rs:52) [AllocDataRaceHandler is not a generated class: companion fns / hand type, lane decides]: as_vclocks_ref (:53), as_vclocks_mut (:57), as_weak_memory_ref (:61), as_weak_memory_mut (:65)
// impl VisitProvenance for GlobalDataRaceHandler (concurrency/data_race_handler.rs:70): visit_provenance (:71)
// impl VisitProvenance for AllocDataRaceHandler (concurrency/data_race_handler.rs:80): visit_provenance (:81)

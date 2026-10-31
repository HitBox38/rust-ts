// Port of src/tools/miri/src/bin/miri.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type EarlySession } from "../../rustc_session/session.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type Result } from "../../std/result.ts";

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl MiriCompilerCalls (bin/miri.rs:71) [MiriCompilerCalls is not a generated class: companion fns / hand type, lane decides]: new (:72)
// impl rustc_driver::Callbacks for MiriCompilerCalls (bin/miri.rs:128): config (:129), after_analysis (:138)
// impl CodegenBackend for MiriCodegenBackend (bin/miri.rs:216): name (:217), target_config (:221), target_cpu (:238), supported_crate_types (:244), codegen_crate (:248), join_codegen (:252), link (:263)
// impl rustc_driver::Callbacks for MiriDepCompilerCalls (bin/miri.rs:281): config (:283), after_analysis (:324)
// macro_rules! fatal_error (bin/miri.rs:354)
// fn run_many_seeds (bin/miri.rs:77)
// fn make_miri_codegen_backend (bin/miri.rs:112)
// fn exit (bin/miri.rs:339)
// fn fatal_error_ (bin/miri.rs:349)
// fn run_compiler_and_exit (bin/miri.rs:361)
// fn parse_comma_list (bin/miri.rs:383)
// fn parse_rate (bin/miri.rs:388)
// fn parse_range (bin/miri.rs:401)
// fn main (bin/miri.rs:408)

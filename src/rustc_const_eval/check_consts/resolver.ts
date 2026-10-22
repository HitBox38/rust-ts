// Stub module (lane mt-promote): compiler/rustc_const_eval/src/check_consts/resolver.rs is not ported yet.
// Declared by lane const-check for check.ts (`Qualifs::in_local` runs the analysis); mt-promote's port replaces this
// file. `Q` is the `Qualif` impl table (qualifs.ts).
import type { MixedBitSet } from "../../rustc_index/bit_set.ts";
import type { Body, Local, Location, Statement } from "../../rustc_middle/mir/mod.ts";
import { AnalysisBase, type Domain } from "../../rustc_mir_dataflow/framework/mod.ts";
import { unported } from "../../std/panic.ts";
import type { ConstCx } from "./mod.ts";
import type { Qualif } from "./qualifs.ts";

/// The dataflow analysis used to propagate qualifs on arbitrary CFGs.
// rustc-type: compiler/rustc_const_eval/src/check_consts/resolver.rs:241 FlowSensitiveAnalysis
export class FlowSensitiveAnalysis extends AnalysisBase<State> {
  constructor(
    public ccx: ConstCx,
    public Q: Qualif,
  ) {
    super();
  }

  // stub: compiler/rustc_const_eval/src/check_consts/resolver.rs:250 new (lane mt-promote)
  static new(_Q: Qualif, _ccx: ConstCx): FlowSensitiveAnalysis {
    return unported("rustc_const_eval::check_consts::resolver::FlowSensitiveAnalysis::new");
  }

  get Domain(): Domain<State> {
    return unported("rustc_const_eval::check_consts::resolver::FlowSensitiveAnalysis::Domain");
  }
  get NAME(): string {
    return unported("rustc_const_eval::check_consts::resolver::FlowSensitiveAnalysis::NAME");
  }
  // stub: compiler/rustc_const_eval/src/check_consts/resolver.rs:334 bottom_value (lane mt-promote)
  bottom_value(_body: Body): State {
    return unported("rustc_const_eval::check_consts::resolver::FlowSensitiveAnalysis::bottom_value");
  }
  // stub: compiler/rustc_const_eval/src/check_consts/resolver.rs:341 initialize_start_block (lane mt-promote)
  initialize_start_block(_body: Body, _state: State): void {
    unported("rustc_const_eval::check_consts::resolver::FlowSensitiveAnalysis::initialize_start_block");
  }
  // stub: compiler/rustc_const_eval/src/check_consts/resolver.rs:345 apply_primary_statement_effect (lane mt-promote)
  apply_primary_statement_effect(_state: State, _statement: Statement, _location: Location): void {
    unported("rustc_const_eval::check_consts::resolver::FlowSensitiveAnalysis::apply_primary_statement_effect");
  }
}

/// The state for the `FlowSensitiveAnalysis` dataflow analysis.
// rustc-type: compiler/rustc_const_eval/src/check_consts/resolver.rs:262 State
export class State {
  constructor(
    /// Describes whether a local contains qualif.
    public qualif: MixedBitSet<Local>,
    /// Describes whether a local's address escaped and it might become qualified as a result an
    /// indirect mutation.
    public borrow: MixedBitSet<Local>,
  ) {}

  // stub: compiler/rustc_const_eval/src/check_consts/resolver.rs:285 contains (lane mt-promote)
  contains(_local: Local): boolean {
    return unported("rustc_const_eval::check_consts::resolver::State::contains");
  }
}

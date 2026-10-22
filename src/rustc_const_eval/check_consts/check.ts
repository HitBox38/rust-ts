// Stub module (lane const-check): compiler/rustc_const_eval/src/check_consts/check.rs is not ported yet.
// Lane mt-promote declared only what check_consts/post_drop_elaboration.rs and rustc_mir_transform's lib.rs
// (`mir_const_qualif`) reference; lane const-check replaces this file with the whole port, keeping these names and
// shapes (on a merge conflict, take const-check's file). Every stub stops as UNPORTED with its upstream path.
import type { ConstQualifs, Location, Place } from "../../rustc_middle/mir/mod.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";
import type { ConstCx } from "./mod.ts";

// stub: compiler/rustc_const_eval/src/check_consts/check.rs:124 Checker (lane const-check)
export class Checker {
  constructor(public ccx: ConstCx) {}

  // stub: compiler/rustc_const_eval/src/check_consts/check.rs:148 new (lane const-check)
  static new(_ccx: ConstCx): Checker {
    return unported("rustc_const_eval::check_consts::check::Checker::new");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/check.rs:159 check_body (lane const-check)
  check_body(): void {
    return unported("rustc_const_eval::check_consts::check::Checker::check_body");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/check.rs:219 qualifs_in_return_place (lane const-check)
  qualifs_in_return_place(): ConstQualifs {
    return unported("rustc_const_eval::check_consts::check::Checker::qualifs_in_return_place");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/check.rs:391 check_drop_terminator (lane const-check)
  check_drop_terminator(_dropped_place: Place, _location: Location, _terminator_span: Span): void {
    return unported("rustc_const_eval::check_consts::check::Checker::check_drop_terminator");
  }
}

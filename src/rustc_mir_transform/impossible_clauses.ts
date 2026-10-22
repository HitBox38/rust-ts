// Stub module (lane mt-cleanup): compiler/rustc_mir_transform/src/impossible_clauses.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/impossible_clauses.rs:66 ImpossibleClauses (lane mt-cleanup)
export class ImpossibleClauses extends MirPass {
  readonly type_name = "rustc_mir_transform::impossible_clauses::ImpossibleClauses";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::impossible_clauses::ImpossibleClauses (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::impossible_clauses::ImpossibleClauses (pass not ported)");
  }
}

// stub: compiler/rustc_mir_transform/src/impossible_clauses.rs:68 has_impossible_clauses (lane mt-cleanup)
export function has_impossible_clauses(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_mir_transform::impossible_clauses::has_impossible_clauses");
}

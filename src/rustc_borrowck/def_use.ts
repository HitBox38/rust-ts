// Port of compiler/rustc_borrowck/src/def_use.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import type { PlaceContext } from "../rustc_middle/mir/visit.ts";
import { unported } from "../std/panic.ts";
import type { DefUse } from "./def_use.gen.ts";
export * from "./def_use.gen.ts";

// stub: compiler/rustc_borrowck/src/def_use.rs:13 categorize (lane bck-core)
export function categorize(context: PlaceContext): DefUse | undefined {
  return unported("rustc_borrowck::def_use::categorize");
}

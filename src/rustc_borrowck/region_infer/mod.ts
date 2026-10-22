// Port of compiler/rustc_borrowck/src/region_infer/mod.rs (lane borrowck-contract: declarations; fill lane bck-regions-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `pub(crate) use region_context::*;` is not re-exported here: region_context.ts assigns prototypes of
// region_context.gen.ts's classes at load, and a re-export would let the generated modules that import this module
// (constraints / handle_placeholders / region_errors / type_check) evaluate it mid-cycle (init-order rule, lib.ts).
// Import `RegionInferenceContext` & co. from ./region_context.ts.
// PORT: `mod dump_mir; mod graphviz; pub(crate) mod opaque_types; mod region_context; mod reverse_sccs; pub(crate) mod
// values;` are loaded by the crate root (lib.ts), not imported here.
// PORT: `Representative` has no unit variant, so the generator emits no companion; its methods live on a hand
// companion `Representative` typed by `Representative_methods` (`new` is a property: `new(..)` in an interface would be a
// construct signature).
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import type { GenericKind, VerifyBound } from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { Debug, Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import * as gen from "./mod.gen.ts";
import { BestBlame, type ConstraintSccs, type RegionDefinition, type TypeTest } from "./mod.gen.ts";

export * from "./mod.gen.ts";

export interface Representative_methods {
  // mod.rs:41 (lane bck-regions-a)
  rvid(self: Representative): RegionVid;
  // mod.rs:49 (lane bck-regions-a)
  new: (r: RegionVid, definition: RegionDefinition) => Representative;
}
export type Representative = gen.Representative;
export const Representative = {} as Representative_methods;

// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:41 rvid (lane bck-regions-a)
Representative.rvid = function (self: Representative): RegionVid {
  return unported("rustc_borrowck::region_infer::Representative::rvid");
};

// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:49 new (lane bck-regions-a)
Representative.new = function (r: RegionVid, definition: RegionDefinition): Representative {
  return unported("rustc_borrowck::region_infer::Representative::new");
};

// impl fmt::Debug for TypeTest<'_>
// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:139 fmt (lane bck-regions-a)
export const debug_TypeTest: Debug<TypeTest> = (v: TypeTest, f: Fmt): string => {
  return unported("rustc_borrowck::region_infer::TypeTest::fmt");
};

// PORT: fn-local to `<TypeTest as Debug>::fmt` (module level until filled, lib.ts header); the `&mut Formatter` it
// writes to is returned as the text.
// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:140 fmt_bound (lane bck-regions-a)
function fmt_bound(f: Fmt, generic_kind: GenericKind, lower: RegionVid, bound: VerifyBound): string {
  return unported("rustc_borrowck::region_infer::TypeTest::fmt::fmt_bound");
}
void fmt_bound;

// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:197 sccs_info (lane bck-regions-a)
export function sccs_info(infcx: BorrowckInferCtxt, sccs: ConstraintSccs): void {
  return unported("rustc_borrowck::region_infer::sccs_info");
}

declare module "./mod.gen.ts" {
  interface BestBlame {
    // mod.rs:271 (lane bck-regions-a)
    to_obligation_cause(): ObligationCause;
    // mod.rs:292 (lane bck-regions-a)
    constraint(): OutlivesConstraint;
    // mod.rs:296 (lane bck-regions-a); `path_`: the field `path` has the same name
    path_(): readonly OutlivesConstraint[];
  }
}

// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:271 to_obligation_cause (lane bck-regions-a)
BestBlame.prototype.to_obligation_cause = function (this: BestBlame): ObligationCause {
  return unported("rustc_borrowck::region_infer::BestBlame::to_obligation_cause");
};

// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:292 constraint (lane bck-regions-a)
BestBlame.prototype.constraint = function (this: BestBlame): OutlivesConstraint {
  return unported("rustc_borrowck::region_infer::BestBlame::constraint");
};

// stub: compiler/rustc_borrowck/src/region_infer/mod.rs:296 path (lane bck-regions-a)
BestBlame.prototype.path_ = function (this: BestBlame): readonly OutlivesConstraint[] {
  return unported("rustc_borrowck::region_infer::BestBlame::path");
};

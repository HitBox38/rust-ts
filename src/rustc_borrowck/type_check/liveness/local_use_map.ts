// Port of compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs (lane borrowck-contract: declarations; fill lane bck-tc-live, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LocalUseMapBuild` (impl mir `Visitor`) is a hand class extending rustc_middle mir/visit.ts's `Visitor`; its
// `&'me mut LocalUseMap` / `&'me DenseLocationMap` fields are the shared objects.
// PORT: `AppearancesIter` is a data-only struct (generated interface); its `Iterator` impl is the impl table
// `Iterator_AppearancesIter` (`next(self)` returns a JS `IteratorResult`). `impl Iterator<Item = T>` returns are
// `Iterable<T>`; the `mut live_locals: impl Iterator<Item = Local>` parameter (`.next()` is called) is a JS `Iterator`.
import type { DenseBitSet } from "../../../rustc_index/bit_set.ts";
import type { Body, Local, Location } from "../../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { DenseLocationMap, PointIndex } from "../../../rustc_mir_dataflow/points.ts";
import { unported } from "../../../std/panic.ts";
import type { AppearanceIndex, Appearances, AppearancesIter } from "./local_use_map.gen.ts";
import { LocalUseMap } from "./local_use_map.gen.ts";
export * from "./local_use_map.gen.ts";

declare module "./local_use_map.gen.ts" {
  interface LocalUseMap {
    // local_use_map.rs:111 (lane bck-tc-live)
    defs(local: Local): Iterable<PointIndex>;
    // local_use_map.rs:116 (lane bck-tc-live)
    uses(local: Local): Iterable<PointIndex>;
    // local_use_map.rs:121 (lane bck-tc-live)
    drops(local: Local): Iterable<PointIndex>;
  }
  namespace LocalUseMap {
    // local_use_map.rs:84 (lane bck-tc-live)
    function build(live_locals: Iterator<Local>, location_map: DenseLocationMap, body: Body): LocalUseMap;
  }
}

// stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:55 appearances_iter (lane bck-tc-live)
export function appearances_iter(first: AppearanceIndex | undefined, appearances: Appearances): Iterable<AppearanceIndex> {
  return unported("rustc_borrowck::type_check::liveness::local_use_map::appearances_iter");
}

// impl<'a> Iterator for AppearancesIter<'a>
export const Iterator_AppearancesIter = {
  // stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:71 next (lane bck-tc-live)
  next(self: AppearancesIter): IteratorResult<AppearanceIndex> {
    return unported("rustc_borrowck::type_check::liveness::local_use_map::AppearancesIter::next");
  },
};

//-----------------------------------------------------------------------------

// stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:84 build (lane bck-tc-live)
(LocalUseMap as unknown as { build: typeof LocalUseMap.build }).build = function (
  live_locals: Iterator<Local>,
  location_map: DenseLocationMap,
  body: Body,
): LocalUseMap {
  return unported("rustc_borrowck::type_check::liveness::local_use_map::LocalUseMap::build");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:111 defs (lane bck-tc-live)
LocalUseMap.prototype.defs = function (this: LocalUseMap, local: Local): Iterable<PointIndex> {
  return unported("rustc_borrowck::type_check::liveness::local_use_map::LocalUseMap::defs");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:116 uses (lane bck-tc-live)
LocalUseMap.prototype.uses = function (this: LocalUseMap, local: Local): Iterable<PointIndex> {
  return unported("rustc_borrowck::type_check::liveness::local_use_map::LocalUseMap::uses");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:121 drops (lane bck-tc-live)
LocalUseMap.prototype.drops = function (this: LocalUseMap, local: Local): Iterable<PointIndex> {
  return unported("rustc_borrowck::type_check::liveness::local_use_map::LocalUseMap::drops");
};

// rustc-type: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:127 LocalUseMapBuild
export class LocalUseMapBuild extends Visitor {
  constructor(
    public local_use_map: LocalUseMap,
    public location_map: DenseLocationMap,

    // Vector used in `visit_local` to signal which `Local`s do we need
    // def/use/drop information on, constructed from `live_locals` (that
    // contains the variables we'll do the liveness analysis for).
    // This vector serves optimization purposes only: we could have
    // obtained the same information from `live_locals` but we want to
    // avoid repeatedly calling `Vec::contains()` (see `LocalUseMap` for
    // the rationale on the time-memory trade-off we're favoring here).
    public locals_with_use_data: DenseBitSet<Local>,
  ) {
    super();
  }

  // impl Visitor<'_> for LocalUseMapBuild<'_>
  // stub: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:142 visit_local (lane bck-tc-live)
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::type_check::liveness::local_use_map::LocalUseMapBuild::visit_local");
  }
}

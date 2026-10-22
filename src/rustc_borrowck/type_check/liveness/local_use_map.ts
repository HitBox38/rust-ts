// Port of compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs (lane borrowck-contract: declarations; fill lane bck-tc-live, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LocalUseMapBuild` (impl mir `Visitor`) is a hand class extending rustc_middle mir/visit.ts's `Visitor`; its
// `&'me mut LocalUseMap` / `&'me DenseLocationMap` fields are the shared objects.
// PORT: `AppearancesIter` is a data-only struct (generated interface); its `Iterator` impl is the impl table
// `Iterator_AppearancesIter` (`next(self)` returns a JS `IteratorResult`). `impl Iterator<Item = T>` returns are
// `Iterable<T>`; the `mut live_locals: impl Iterator<Item = Local>` parameter (`.next()` is called) is a JS `Iterator`.
import { DenseBitSet } from "../../../rustc_index/bit_set.ts";
import { IndexVec } from "../../../rustc_index/vec.ts";
import type { Body, Local, Location } from "../../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { DenseLocationMap, PointIndex } from "../../../rustc_mir_dataflow/points.ts";
import * as def_use_mod from "../../def_use.ts";
import type { DefUse } from "../../def_use.gen.ts";
import type { Appearance, AppearanceIndex, Appearances, AppearancesIter } from "./local_use_map.gen.ts";
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

// rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:55 appearances_iter
export function appearances_iter(first: AppearanceIndex | undefined, appearances: Appearances): Iterable<AppearanceIndex> {
  const it: AppearancesIter = { appearances, current: first };
  return { [Symbol.iterator]: () => ({ next: () => Iterator_AppearancesIter.next(it) }) };
}

// Iterates over `Appearances` by following `next` fields.
// impl<'a> Iterator for AppearancesIter<'a>
export const Iterator_AppearancesIter = {
  // rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:71 next
  next(self: AppearancesIter): IteratorResult<AppearanceIndex> {
    const c = self.current;
    if (c !== undefined) {
      self.current = self.appearances[c]!.next;
      return { done: false, value: c };
    } else {
      return { done: true, value: undefined };
    }
  },
};

//-----------------------------------------------------------------------------

// rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:84 build
(LocalUseMap as unknown as { build: typeof LocalUseMap.build }).build = function (
  live_locals: Iterator<Local>,
  location_map: DenseLocationMap,
  body: Body,
): LocalUseMap {
  const nones = IndexVec.from_elem<AppearanceIndex | undefined, unknown>(undefined, body.local_decls);
  const local_use_map = new LocalUseMap(nones.slice(), nones.slice(), nones, IndexVec.new());

  const head_ = live_locals.next();
  if (head_.done) {
    return local_use_map;
  }
  const head = head_.value;

  const locals_with_use_data = DenseBitSet.new_empty<Local>(body.local_decls.length);
  locals_with_use_data.insert(head);
  for (let r = live_locals.next(); !r.done; r = live_locals.next()) {
    const local = r.value;
    locals_with_use_data.insert(local);
  }

  new LocalUseMapBuild(local_use_map, location_map, locals_with_use_data).visit_body(body);

  return local_use_map;
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:111 defs
LocalUseMap.prototype.defs = function (this: LocalUseMap, local: Local): Iterable<PointIndex> {
  return map_iter(appearances_iter(this.first_def_at[local], this.appearances), (aa) => this.appearances[aa]!.point_index);
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:116 uses
LocalUseMap.prototype.uses = function (this: LocalUseMap, local: Local): Iterable<PointIndex> {
  return map_iter(appearances_iter(this.first_use_at[local], this.appearances), (aa) => this.appearances[aa]!.point_index);
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:121 drops
LocalUseMap.prototype.drops = function (this: LocalUseMap, local: Local): Iterable<PointIndex> {
  return map_iter(appearances_iter(this.first_drop_at[local], this.appearances), (aa) => this.appearances[aa]!.point_index);
};

/** PORT: the lazy `Iterator::map` of `defs` / `uses` / `drops` (each `for` re-walks the list, as each Rust call does). */
function map_iter<T, U>(it: Iterable<T>, f: (x: T) => U): Iterable<U> {
  return {
    *[Symbol.iterator]() {
      for (const x of it) yield f(x);
    },
  };
}

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
  // rustc: compiler/rustc_borrowck/src/type_check/liveness/local_use_map.rs:142 visit_local
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    let def_use: DefUse | undefined;
    if (this.locals_with_use_data.contains(local) && (def_use = def_use_mod.categorize(context)) !== undefined) {
      // PORT: `&mut self.local_use_map.first_*_at[local]` is the array and the index.
      let first_appearance: (AppearanceIndex | undefined)[];
      switch (def_use) {
        case "Def":
          first_appearance = this.local_use_map.first_def_at;
          break;
        case "Use":
          first_appearance = this.local_use_map.first_use_at;
          break;
        case "Drop":
          first_appearance = this.local_use_map.first_drop_at;
          break;
      }
      const point_index = this.location_map.point_from_location(location);
      const appearance_index = IndexVec.push<AppearanceIndex, Appearance>(this.local_use_map.appearances, { point_index, next: first_appearance[local] });
      first_appearance[local] = appearance_index;
    }
  }
}

// Port of polonius-engine =0.13.0 `src/output/liveness.rs`.
//
//! An implementation of the origin liveness calculation logic

import { Iteration, Relation } from "../../datafrog/lib.ts";
import type { FactTypes } from "../facts.ts";
import { type BTreeSet, entry_or_default, type LivenessContext, type Output } from "./mod.ts";

// crate: polonius-engine-0.13.0/src/output/liveness.rs:21 compute_live_origins
export function compute_live_origins<T extends FactTypes>(
  ctx: LivenessContext<T>,
  cfg_edge: Relation<readonly [T["Point"], T["Point"]]>,
  var_maybe_partly_initialized_on_exit: Relation<readonly [T["Variable"], T["Point"]]>,
  output: Output<T>,
): (readonly [T["Origin"], T["Point"]])[] {
  type Origin = T["Origin"];
  type Point = T["Point"];
  type Var = T["Variable"];

  // let timer = Instant::now();
  const iteration = Iteration.new();

  // Relations
  const var_defined_at: Relation<readonly [Var, Point]> = Relation.from(ctx.var_defined_at);
  const cfg_edge_reverse: Relation<readonly [Point, Point]> = Relation.collect(
    cfg_edge.iter().map(([point1, point2]): readonly [Point, Point] => [point2, point1]),
  );
  const use_of_var_derefs_origin: Relation<readonly [Var, Origin]> = Relation.from(ctx.use_of_var_derefs_origin);
  const drop_of_var_derefs_origin: Relation<readonly [Var, Origin]> = Relation.from(ctx.drop_of_var_derefs_origin);
  const var_dropped_at: Relation<readonly [readonly [Var, Point], undefined]> = Relation.collect(
    ctx.var_dropped_at.map(([var_, point]): readonly [readonly [Var, Point], undefined] => [[var_, point], undefined]),
  );

  // Variables

  // `var_live_on_entry`: variable `var` is live upon entry at `point`
  const var_live_on_entry = iteration.variable<readonly [Var, Point]>("var_live_on_entry");
  // `var_drop_live_on_entry`: variable `var` is drop-live (will be used for a drop) upon entry in `point`
  const var_drop_live_on_entry = iteration.variable<readonly [Var, Point]>("var_drop_live_on_entry");

  // This is what we are actually calculating:
  const origin_live_on_entry = iteration.variable<readonly [Origin, Point]>("origin_live_on_entry");

  // This propagates the relation `var_live_on_entry(var, point) :- var_used_at(var, point)`:
  var_live_on_entry.insert(Relation.from(ctx.var_used_at));

  // var_maybe_partly_initialized_on_entry(var, point2) :-
  //     var_maybe_partly_initialized_on_exit(var, point1),
  //     cfg_edge(point1, point2).
  const var_maybe_partly_initialized_on_entry = Relation.from_leapjoin(
    var_maybe_partly_initialized_on_exit,
    cfg_edge.extend_with(([_var, point1]: readonly [Var, Point]) => point1),
    ([var_, _point1], point2): readonly [readonly [Var, Point], undefined] => [[var_, point2], undefined],
  );

  // var_drop_live_on_entry(var, point) :-
  //     var_dropped_at(var, point),
  //     var_maybe_partly_initialized_on_entry(var, point).
  var_drop_live_on_entry.insert(
    Relation.from_join(var_dropped_at, var_maybe_partly_initialized_on_entry, ([var_, point], _, __): readonly [Var, Point] => [
      var_,
      point,
    ]),
  );

  while (iteration.changed()) {
    // origin_live_on_entry(origin, point) :-
    //   var_drop_live_on_entry(var, point),
    //   drop_of_var_derefs_origin(var, origin).
    origin_live_on_entry.from_join(var_drop_live_on_entry, drop_of_var_derefs_origin, (_var, point, origin) => [origin, point]);

    // origin_live_on_entry(origin, point) :-
    //   var_live_on_entry(var, point),
    //   use_of_var_derefs_origin(var, origin).
    origin_live_on_entry.from_join(var_live_on_entry, use_of_var_derefs_origin, (_var, point, origin) => [origin, point]);

    // var_live_on_entry(var, point1) :-
    //     var_live_on_entry(var, point2),
    //     cfg_edge(point1, point2),
    //     !var_defined(var, point1).
    var_live_on_entry.from_leapjoin(
      var_live_on_entry,
      [
        var_defined_at.extend_anti(([var_, _point2]: readonly [Var, Point]) => var_),
        cfg_edge_reverse.extend_with(([_var, point2]: readonly [Var, Point]) => point2),
      ],
      ([var_, _point2], point1) => [var_, point1],
    );

    // var_drop_live_on_entry(Var, SourceNode) :-
    //   var_drop_live_on_entry(Var, TargetNode),
    //   cfg_edge(SourceNode, TargetNode),
    //   !var_defined_at(Var, SourceNode),
    //   var_maybe_partly_initialized_on_exit(Var, SourceNode).
    var_drop_live_on_entry.from_leapjoin(
      var_drop_live_on_entry,
      [
        var_defined_at.extend_anti(([var_, _target_node]: readonly [Var, Point]) => var_),
        cfg_edge_reverse.extend_with(([_var, target_node]: readonly [Var, Point]) => target_node),
        var_maybe_partly_initialized_on_exit.extend_with(([var_, _target_node]: readonly [Var, Point]) => var_),
      ],
      ([var_, _targetnode], source_node) => [var_, source_node],
    );
  }

  const origin_live_on_entry_rel = origin_live_on_entry.complete();

  // info!(
  //     "compute_live_origins() completed: {} tuples, {:?}",
  //     origin_live_on_entry.len(),
  //     timer.elapsed(),
  // );

  if (output.dump_enabled) {
    const var_drop_live_on_entry_rel = var_drop_live_on_entry.complete();
    for (const [var_, location] of var_drop_live_on_entry_rel.iter()) {
      entry_or_default(output.var_drop_live_on_entry, location, () => []).push(var_);
    }

    const var_live_on_entry_rel = var_live_on_entry.complete();
    for (const [var_, location] of var_live_on_entry_rel.iter()) {
      entry_or_default(output.var_live_on_entry, location, () => []).push(var_);
    }
  }

  return origin_live_on_entry_rel.elements;
}

// crate: polonius-engine-0.13.0/src/output/liveness.rs:157 make_universal_regions_live
export function make_universal_regions_live<T extends FactTypes>(
  origin_live_on_entry: (readonly [T["Origin"], T["Point"]])[],
  cfg_node: BTreeSet<T["Point"]>,
  universal_regions: readonly T["Origin"][],
): void {
  // debug!("make_universal_regions_live()");

  // origin_live_on_entry.reserve(universal_regions.len() * cfg_node.len());
  for (const origin of universal_regions) {
    for (const point of cfg_node.iter()) {
      origin_live_on_entry.push([origin, point]);
    }
  }
}

// Port of polonius-engine =0.13.0 `src/output/initialization.rs`.
//
// PORT: the tuple struct `InitializationResult<T>(Relation, Relation)` has fields `_0`, `_1`.

import { Iteration, Relation } from "../../datafrog/lib.ts";
import type { FactTypes } from "../facts.ts";
import { entry_or_default, type InitializationContext, type Output } from "./mod.ts";

// This represents the output of an intermediate elaboration step (step 1).
interface TransitivePaths<T extends FactTypes> {
  path_moved_at: Relation<readonly [T["Path"], T["Point"]]>;
  path_assigned_at: Relation<readonly [T["Path"], T["Point"]]>;
  path_accessed_at: Relation<readonly [T["Path"], T["Point"]]>;
  path_begins_with_var: Relation<readonly [T["Path"], T["Variable"]]>;
}

interface InitializationStatus<T extends FactTypes> {
  var_maybe_partly_initialized_on_exit: Relation<readonly [T["Variable"], T["Point"]]>;
  move_error: Relation<readonly [T["Path"], T["Point"]]>;
}

export interface InitializationResult<T extends FactTypes> {
  readonly _0: Relation<readonly [T["Variable"], T["Point"]]>;
  readonly _1: Relation<readonly [T["Path"], T["Point"]]>;
}

// Step 1: compute transitive closures of path operations. This would elaborate,
// for example, an access to x into an access to x.f, x.f.0, etc. We do this for:
// - access to a path
// - initialization of a path
// - moves of a path
// FIXME: transitive rooting in a variable (path_begins_with_var)
// Note that this step may not be entirely necessary!
// crate: polonius-engine-0.13.0/src/output/initialization.rs:33 compute_transitive_paths
function compute_transitive_paths<T extends FactTypes>(
  child_path_: (readonly [T["Path"], T["Path"]])[],
  path_assigned_at_base: (readonly [T["Path"], T["Point"]])[],
  path_moved_at_base: (readonly [T["Path"], T["Point"]])[],
  path_accessed_at_base: (readonly [T["Path"], T["Point"]])[],
  path_is_var: (readonly [T["Path"], T["Variable"]])[],
): TransitivePaths<T> {
  type Path = T["Path"];
  type Point = T["Point"];
  type Var = T["Variable"];

  const iteration = Iteration.new();
  const child_path: Relation<readonly [Path, Path]> = Relation.from(child_path_);

  const ancestor_path = iteration.variable<readonly [Path, Path]>("ancestor");

  // These are the actual targets:
  const path_moved_at = iteration.variable<readonly [Path, Point]>("path_moved_at");
  const path_assigned_at = iteration.variable<readonly [Path, Point]>("path_initialized_at");
  const path_accessed_at = iteration.variable<readonly [Path, Point]>("path_accessed_at");
  const path_begins_with_var = iteration.variable<readonly [Path, Var]>("path_begins_with_var");

  // ancestor_path(Parent, Child) :- child_path(Child, Parent).
  ancestor_path.extend(child_path.iter().map(([child, parent]): readonly [Path, Path] => [parent, child]));

  // path_moved_at(Path, Point) :- path_moved_at_base(Path, Point).
  path_moved_at.insert(Relation.from(path_moved_at_base));

  // path_assigned_at(Path, Point) :- path_assigned_at_base(Path, Point).
  path_assigned_at.insert(Relation.from(path_assigned_at_base));

  // path_accessed_at(Path, Point) :- path_accessed_at_base(Path, Point).
  path_accessed_at.insert(Relation.from(path_accessed_at_base));

  // path_begins_with_var(Path, Var) :- path_is_var(Path, Var).
  path_begins_with_var.insert(Relation.from(path_is_var));

  while (iteration.changed()) {
    // ancestor_path(Grandparent, Child) :-
    //    ancestor_path(Parent, Child),
    //    child_path(Parent, Grandparent).
    ancestor_path.from_join(ancestor_path, child_path, (_parent, child, grandparent) => [grandparent, child]);

    // moving a path moves its children
    // path_moved_at(Child, Point) :-
    //     path_moved_at(Parent, Point),
    //     ancestor_path(Parent, Child).
    path_moved_at.from_join(path_moved_at, ancestor_path, (_parent, p, child) => [child, p]);

    // initialising x at p initialises all x:s children
    // path_assigned_at(Child, point) :-
    //     path_assigned_at(Parent, point),
    //     ancestor_path(Parent, Child).
    path_assigned_at.from_join(path_assigned_at, ancestor_path, (_parent, p, child) => [child, p]);

    // accessing x at p accesses all x:s children at p (actually,
    // accesses should be maximally precise and this shouldn't happen?)
    // path_accessed_at(Child, point) :-
    //   path_accessed_at(Parent, point),
    //   ancestor_path(Parent, Child).
    path_accessed_at.from_join(path_accessed_at, ancestor_path, (_parent, p, child) => [child, p]);

    // path_begins_with_var(Child, Var) :-
    //   path_begins_with_var(Parent, Var)
    //   ancestor_path(Parent, Child).
    path_begins_with_var.from_join(path_begins_with_var, ancestor_path, (_parent, var_, child) => [child, var_]);
  }

  // PORT: the struct literal's fields are evaluated in their written order (`path_assigned_at` first).
  const path_assigned_at_rel = path_assigned_at.complete();
  const path_moved_at_rel = path_moved_at.complete();
  const path_accessed_at_rel = path_accessed_at.complete();
  const path_begins_with_var_rel = path_begins_with_var.complete();
  return {
    path_assigned_at: path_assigned_at_rel,
    path_moved_at: path_moved_at_rel,
    path_accessed_at: path_accessed_at_rel,
    path_begins_with_var: path_begins_with_var_rel,
  };
}

// Step 2: Compute path initialization and deinitialization across the CFG.
// crate: polonius-engine-0.13.0/src/output/initialization.rs:120 compute_move_errors
function compute_move_errors<T extends FactTypes>(
  ctx: TransitivePaths<T>,
  cfg_edge: Relation<readonly [T["Point"], T["Point"]]>,
  output: Output<T>,
): InitializationStatus<T> {
  type Path = T["Path"];
  type Point = T["Point"];
  type Var = T["Variable"];

  const iteration = Iteration.new();
  // Variables

  // var_maybe_partly_initialized_on_exit(var, point): Upon leaving `point`,
  // `var` is partially initialized for some path through the CFG, that is
  // there has been an initialization of var, and var has not been moved in
  // all paths through the CFG.
  const var_maybe_partly_initialized_on_exit = iteration.variable<readonly [Var, Point]>("var_maybe_partly_initialized_on_exit");

  // path_maybe_initialized_on_exit(path, point): Upon leaving `point`, the
  // move path `path` is initialized for some path through the CFG.
  const path_maybe_initialized_on_exit = iteration.variable<readonly [Path, Point]>("path_maybe_initialized_on_exit");

  // path_maybe_uninitialized_on_exit(Path, Point): There exists at least one
  // path through the CFG to Point such that `Path` has been moved out by the
  // time we arrive at `Point` without it being re-initialized for sure.
  const path_maybe_uninitialized_on_exit = iteration.variable<readonly [Path, Point]>("path_maybe_uninitialized_on_exit");

  // move_error(Path, Point): There is an access to `Path` at `Point`, but
  // `Path` is potentially moved (or never initialised).
  const move_error = iteration.variable<readonly [Path, Point]>("move_error");

  // Initial propagation of static relations

  // path_maybe_initialized_on_exit(path, point) :- path_assigned_at(path, point).
  path_maybe_initialized_on_exit.insert(ctx.path_assigned_at.clone());

  // path_maybe_uninitialized_on_exit(path, point) :- path_moved_at(path, point).
  path_maybe_uninitialized_on_exit.insert(ctx.path_moved_at.clone());

  while (iteration.changed()) {
    // path_maybe_initialized_on_exit(path, point2) :-
    //     path_maybe_initialized_on_exit(path, point1),
    //     cfg_edge(point1, point2),
    //     !path_moved_at(path, point2).
    path_maybe_initialized_on_exit.from_leapjoin(
      path_maybe_initialized_on_exit,
      [
        cfg_edge.extend_with(([_path, point1]: readonly [Path, Point]) => point1),
        ctx.path_moved_at.extend_anti(([path, _point1]: readonly [Path, Point]) => path),
      ],
      ([path, _point1], point2) => [path, point2],
    );

    // path_maybe_uninitialized_on_exit(path, point2) :-
    //     path_maybe_uninitialized_on_exit(path, point1),
    //     cfg_edge(point1, point2)
    //     !path_assigned_at(path, point2).
    path_maybe_uninitialized_on_exit.from_leapjoin(
      path_maybe_uninitialized_on_exit,
      [
        cfg_edge.extend_with(([_path, point1]: readonly [Path, Point]) => point1),
        ctx.path_assigned_at.extend_anti(([path, _point1]: readonly [Path, Point]) => path),
      ],
      ([path, _point1], point2) => [path, point2],
    );

    // var_maybe_partly_initialized_on_exit(var, point) :-
    //     path_maybe_initialized_on_exit(path, point).
    //     path_begins_with_var(path, var).
    var_maybe_partly_initialized_on_exit.from_leapjoin(
      path_maybe_initialized_on_exit,
      ctx.path_begins_with_var.extend_with(([path, _point]: readonly [Path, Point]) => path),
      ([_path, point], var_) => [var_, point],
    );

    // move_error(Path, TargetNode) :-
    //   path_maybe_uninitialized_on_exit(Path, SourceNode),
    //   cfg_edge(SourceNode, TargetNode),
    //   path_accessed_at(Path, TargetNode).
    move_error.from_leapjoin(
      path_maybe_uninitialized_on_exit,
      [
        cfg_edge.extend_with(([_path, source_node]: readonly [Path, Point]) => source_node),
        ctx.path_accessed_at.extend_with(([path, _source_node]: readonly [Path, Point]) => path),
      ],
      ([path, _source_node], target_node) => [path, target_node],
    );
  }

  if (output.dump_enabled) {
    for (const [path, location] of path_maybe_initialized_on_exit.complete().iter()) {
      entry_or_default(output.path_maybe_initialized_on_exit, location, () => []).push(path);
    }

    for (const [path, location] of path_maybe_uninitialized_on_exit.complete().iter()) {
      entry_or_default(output.path_maybe_uninitialized_on_exit, location, () => []).push(path);
    }
  }

  return {
    var_maybe_partly_initialized_on_exit: var_maybe_partly_initialized_on_exit.complete(),
    move_error: move_error.complete(),
  };
}

// Compute two things:
//
// - an over-approximation of the initialization of variables. This is used in
//   the origin_live_on_entry computations to determine when a drop may happen; a
//   definitely moved variable would not be actually dropped.
// - move errors.
//
// The process is split into two stages:
//
// 1. Compute the transitive closure of path accesses. That is, accessing `f.a`
//   would access `f.a.b`, etc.
// 2. Use this to compute both paths that may be initialized and paths that may
//   have been deinitialized, which in turn can be used to find move errors (an
//   access to a path that may be deinitialized).
// crate: polonius-engine-0.13.0/src/output/initialization.rs:247 compute
export function compute<T extends FactTypes>(
  ctx: InitializationContext<T>,
  cfg_edge: Relation<readonly [T["Point"], T["Point"]]>,
  output: Output<T>,
): InitializationResult<T> {
  // let timer = Instant::now();

  const transitive_paths = compute_transitive_paths<T>(
    ctx.child_path,
    ctx.path_assigned_at_base,
    ctx.path_moved_at_base,
    ctx.path_accessed_at_base,
    ctx.path_is_var,
  );
  // info!("initialization phase 1 completed: {:?}", timer.elapsed());

  const { var_maybe_partly_initialized_on_exit, move_error } = compute_move_errors<T>(transitive_paths, cfg_edge, output);
  // info!(
  //     "initialization phase 2: {} move errors in {:?}",
  //     move_error.elements.len(),
  //     timer.elapsed()
  // );

  if (output.dump_enabled) {
    for (const [var_, location] of var_maybe_partly_initialized_on_exit.iter()) {
      entry_or_default(output.var_maybe_partly_initialized_on_exit, location, () => []).push(var_);
    }
  }

  return { _0: var_maybe_partly_initialized_on_exit, _1: move_error };
}

// Port of polonius-engine =0.13.0 `src/output/datafrog_opt.rs`.

import { Iteration, type Relation, ValueFilter } from "../../datafrog/lib.ts";
import { assert } from "../../../std/panic.ts";
import type { FactTypes } from "../facts.ts";
import { BTreeMap, BTreeSet, type Context, entry_or_default, type Output, vec_retain } from "./mod.ts";

// crate: polonius-engine-0.13.0/src/output/datafrog_opt.rs:17 compute
export function compute<T extends FactTypes>(
  ctx: Context<T>,
  result: Output<T>,
): [Relation<readonly [T["Loan"], T["Point"]]>, Relation<readonly [T["Origin"], T["Origin"], T["Point"]]>] {
  type Origin = T["Origin"];
  type Loan = T["Loan"];
  type Point = T["Point"];
  type OP = readonly [Origin, Point];
  type OPP = readonly [Origin, Point, Point];
  type LP = readonly [Loan, Point];

  // let timer = Instant::now();

  const [errors, subset_errors] = ((): [Relation<readonly [Loan, Point]>, Relation<readonly [Origin, Origin, Point]>] => {
    // Static inputs
    const origin_live_on_entry_rel = ctx.origin_live_on_entry;
    const cfg_edge_rel = ctx.cfg_edge;
    const loan_killed_at = ctx.loan_killed_at;
    const known_placeholder_subset = ctx.known_placeholder_subset;
    const placeholder_origin = ctx.placeholder_origin;

    // Create a new iteration context, ...
    const iteration = Iteration.new();

    // `loan_invalidated_at` facts, stored ready for joins
    const loan_invalidated_at = iteration.variable<readonly [LP, undefined]>("loan_invalidated_at");

    // we need `origin_live_on_entry` in both variable and relation forms,
    // (respectively, for join and antijoin).
    const origin_live_on_entry_var = iteration.variable<readonly [OP, undefined]>("origin_live_on_entry");

    // `loan_issued_at` input but organized for join
    const loan_issued_at_op = iteration.variable<readonly [OP, Loan]>("loan_issued_at_op");

    // .decl subset(origin1, origin2, point)
    //
    // Indicates that `origin1: origin2` at `point`.
    const subset_o1p = iteration.variable<readonly [OP, Origin]>("subset_o1p");

    // .decl origin_contains_loan_on_entry(origin, loan, point)
    //
    // At `point`, things with `origin` may depend on data from `loan`.
    const origin_contains_loan_on_entry_op = iteration.variable<readonly [OP, Loan]>("origin_contains_loan_on_entry_op");

    // .decl loan_live_at(loan, point)
    //
    // True if the restrictions of the `loan` need to be enforced at `point`.
    const loan_live_at = iteration.variable<readonly [LP, undefined]>("loan_live_at");

    // .decl live_to_dying_regions(origin1, origin2, point1, point2)
    //
    // The origins `origin1` and `origin2` are "live to dead"
    // on the edge `point1 -> point2` if:
    //
    // - In `point1`, `origin1` <= `origin2`
    // - In `point2`, `origin1` is live but `origin2` is dead.
    //
    // In that case, `point2` would like to add all the
    // live things reachable from `origin2` to `origin1`.
    //
    const live_to_dying_regions_o2pq = iteration.variable<readonly [OPP, Origin]>("live_to_dying_regions_o2pq");

    // .decl dying_region_requires((origin, point1, point2), loan)
    //
    // The `origin` requires `loan`, but the `origin` goes dead
    // along the edge `point1 -> point2`.
    const dying_region_requires = iteration.variable<readonly [OPP, Loan]>("dying_region_requires");

    // .decl dying_can_reach_origins(origin, point1, point2)
    //
    // Contains dead origins where we are interested
    // in computing the transitive closure of things they
    // can reach.
    //
    // FIXME: this relation was named before renaming the `regions` atoms to `origins`, and
    // will need to be renamed to change "_origins" to "_ascendants", "_roots", etc.
    const dying_can_reach_origins = iteration.variable<readonly [OP, Point]>("dying_can_reach_origins");

    // .decl dying_can_reach(origin1, origin2, point1, point2)
    //
    // Indicates that `origin1`, which is dead
    // in `point2`, can reach `origin2` in `point1`.
    //
    // This is effectively the transitive subset
    // relation, but we try to limit it to origins
    // that are dying on the edge `point1 -> point2`.
    const dying_can_reach_o2q = iteration.variable<readonly [OP, OP]>("dying_can_reach");
    const dying_can_reach_1 = iteration.variable_indistinct<readonly [OP, OP]>("dying_can_reach_1");

    // .decl dying_can_reach_live(origin1, origin2, point1, point2)
    //
    // Indicates that, along the edge `point1 -> point2`, the dead (in `point2`)
    // `origin1` can reach the live (in `point2`) `origin2` via a subset
    // relation. This is a subset of the full `dying_can_reach`
    // relation where we filter down to those cases where `origin2` is
    // live in `point2`.
    const dying_can_reach_live = iteration.variable<readonly [OPP, Origin]>("dying_can_reach_live");

    // .decl dead_borrow_region_can_reach_root((origin, point), loan)
    //
    // Indicates a "borrow region" `origin` at `point` which is not live on
    // entry to `point`.
    const dead_borrow_region_can_reach_root = iteration.variable<readonly [OP, Loan]>("dead_borrow_region_can_reach_root");

    // .decl dead_borrow_region_can_reach_dead((origin2, point), loan)
    const dead_borrow_region_can_reach_dead = iteration.variable<readonly [OP, Loan]>("dead_borrow_region_can_reach_dead");
    const dead_borrow_region_can_reach_dead_1 = iteration.variable_indistinct<readonly [OP, Loan]>(
      "dead_borrow_region_can_reach_dead_1",
    );

    // .decl errors(loan, point)
    const errors = iteration.variable<readonly [Loan, Point]>("errors");
    const subset_errors = iteration.variable<readonly [Origin, Origin, Point]>("subset_errors");

    const subset_placeholder = iteration.variable<readonly [Origin, Origin, Point]>("subset_placeholder");
    const subset_placeholder_o2p = iteration.variable_indistinct<readonly [OP, Origin]>("subset_placeholder_o2p");

    // Make "variable" versions of the relations, needed for joins.
    loan_issued_at_op.extend(ctx.loan_issued_at.map(([origin, loan, point]): readonly [OP, Loan] => [[origin, point], loan]));
    loan_invalidated_at.extend(ctx.loan_invalidated_at.iter().map(([loan, point]): readonly [LP, undefined] => [[loan, point], undefined]));
    origin_live_on_entry_var.extend(
      origin_live_on_entry_rel.iter().map(([origin, point]): readonly [OP, undefined] => [[origin, point], undefined]),
    );

    // subset(origin1, origin2, point) :-
    //   subset_base(origin1, origin2, point).
    subset_o1p.extend(ctx.subset_base.map(([origin1, origin2, point]): readonly [OP, Origin] => [[origin1, point], origin2]));

    // origin_contains_loan_on_entry(origin, loan, point) :-
    //   loan_issued_at(origin, loan, point).
    origin_contains_loan_on_entry_op.extend(ctx.loan_issued_at.map(([origin, loan, point]): readonly [OP, Loan] => [[origin, point], loan]));

    // .. and then start iterating rules!
    while (iteration.changed()) {
      // Cleanup step: remove symmetries
      // - remove origins which are `subset`s of themselves
      //
      // FIXME: investigate whether is there a better way to do that without complicating
      // the rules too much, because it would also require temporary variables and
      // impact performance. Until then, the big reduction in tuples improves performance
      // a lot, even if we're potentially adding a small number of tuples
      // per round just to remove them in the next round.
      vec_retain(subset_o1p.recent.value.elements, ([[origin1, _], origin2]) => origin1 !== origin2);

      vec_retain(subset_placeholder.recent.value.elements, ([origin1, origin2, _]) => origin1 !== origin2);
      subset_placeholder_o2p.from_map(subset_placeholder, ([origin1, origin2, point]) => [[origin2, point], origin1]);

      // live_to_dying_regions(origin1, origin2, point1, point2) :-
      //   subset(origin1, origin2, point1),
      //   cfg_edge(point1, point2),
      //   origin_live_on_entry(origin1, point2),
      //   !origin_live_on_entry(origin2, point2).
      live_to_dying_regions_o2pq.from_leapjoin(
        subset_o1p,
        [
          cfg_edge_rel.extend_with(([[_, point1], __]: readonly [OP, Origin]) => point1),
          origin_live_on_entry_rel.extend_with(([[origin1, _], __]: readonly [OP, Origin]) => origin1),
          origin_live_on_entry_rel.extend_anti(([[_, __], origin2]: readonly [OP, Origin]) => origin2),
        ],
        ([[origin1, point1], origin2], point2) => [[origin2, point1, point2], origin1],
      );

      // dying_region_requires((origin, point1, point2), loan) :-
      //   origin_contains_loan_on_entry(origin, loan, point1),
      //   !loan_killed_at(loan, point1),
      //   cfg_edge(point1, point2),
      //   !origin_live_on_entry(origin, point2).
      dying_region_requires.from_leapjoin(
        origin_contains_loan_on_entry_op,
        [
          loan_killed_at.filter_anti(([[_, point1], loan]: readonly [OP, Loan]) => [loan, point1] as const),
          cfg_edge_rel.extend_with(([[_, point1], __]: readonly [OP, Loan]) => point1),
          origin_live_on_entry_rel.extend_anti(([[origin, _], __]: readonly [OP, Loan]) => origin),
        ],
        ([[origin, point1], loan], point2: Point) => [[origin, point1, point2], loan],
      );

      // dying_can_reach_origins(origin2, point1, point2) :-
      //   live_to_dying_regions(_, origin2, point1, point2).
      dying_can_reach_origins.from_map(live_to_dying_regions_o2pq, ([[origin2, point1, point2], _origin1]) => [[origin2, point1], point2]);

      // dying_can_reach_origins(origin, point1, point2) :-
      //   dying_region_requires(origin, point1, point2, _loan).
      dying_can_reach_origins.from_map(dying_region_requires, ([[origin, point1, point2], _loan]) => [[origin, point1], point2]);

      // dying_can_reach(origin1, origin2, point1, point2) :-
      //   dying_can_reach_origins(origin1, point1, point2),
      //   subset(origin1, origin2, point1).
      dying_can_reach_o2q.from_join(dying_can_reach_origins, subset_o1p, ([origin1, point1], point2, origin2) => [
        [origin2, point2],
        [origin1, point1],
      ]);

      // dying_can_reach(origin1, origin3, point1, point2) :-
      //   dying_can_reach(origin1, origin2, point1, point2),
      //   !origin_live_on_entry(origin2, point2),
      //   subset(origin2, origin3, point1).
      //
      // This is the "transitive closure" rule, but
      // note that we only apply it with the
      // "intermediate" `origin2` is dead at `point2`.
      dying_can_reach_1.from_antijoin(dying_can_reach_o2q, origin_live_on_entry_rel, ([origin2, point2], [origin1, point1]) => [
        [origin2, point1],
        [origin1, point2],
      ]);
      dying_can_reach_o2q.from_join(dying_can_reach_1, subset_o1p, ([_origin2, point1], [origin1, point2], origin3) => [
        [origin3, point2],
        [origin1, point1],
      ]);

      // dying_can_reach_live(origin1, origin2, point1, point2) :-
      //   dying_can_reach(origin1, origin2, point1, point2),
      //   origin_live_on_entry(origin2, point2).
      dying_can_reach_live.from_join(dying_can_reach_o2q, origin_live_on_entry_var, ([origin2, point2], [origin1, point1], _) => [
        [origin1, point1, point2],
        origin2,
      ]);

      // subset(origin1, origin2, point2) :-
      //   subset(origin1, origin2, point1),
      //   cfg_edge(point1, point2),
      //   origin_live_on_entry(origin1, point2),
      //   origin_live_on_entry(origin2, point2).
      //
      // Carry `origin1 <= origin2` from `point1` into `point2` if both `origin1` and
      // `origin2` are live in `point2`.
      subset_o1p.from_leapjoin(
        subset_o1p,
        [
          cfg_edge_rel.extend_with(([[_, point1], __]: readonly [OP, Origin]) => point1),
          origin_live_on_entry_rel.extend_with(([[origin1, _], __]: readonly [OP, Origin]) => origin1),
          origin_live_on_entry_rel.extend_with(([[_, __], origin2]: readonly [OP, Origin]) => origin2),
        ],
        ([[origin1, _point1], origin2], point2) => [[origin1, point2], origin2],
      );

      // subset(origin1, origin3, point2) :-
      //   live_to_dying_regions(origin1, origin2, point1, point2),
      //   dying_can_reach_live(origin2, origin3, point1, point2).
      subset_o1p.from_join(live_to_dying_regions_o2pq, dying_can_reach_live, ([_origin2, _point1, point2], origin1, origin3) => [
        [origin1, point2],
        origin3,
      ]);

      // origin_contains_loan_on_entry(origin2, loan, point2) :-
      //   dying_region_requires(origin1, loan, point1, point2),
      //   dying_can_reach_live(origin1, origin2, point1, point2).
      //
      // Communicate a `origin1 contains loan` relation across
      // an edge `point1 -> point2` where `origin1` is dead in `point2`; in
      // that case, for each origin `origin2` live in `point2`
      // where `origin1 <= origin2` in `point1`, we add `origin2 contains loan`
      // to `point2`.
      origin_contains_loan_on_entry_op.from_join(dying_region_requires, dying_can_reach_live, ([_origin1, _point1, point2], loan, origin2) => [
        [origin2, point2],
        loan,
      ]);

      // origin_contains_loan_on_entry(origin, loan, point2) :-
      //   origin_contains_loan_on_entry(origin, loan, point1),
      //   !loan_killed_at(loan, point1),
      //   cfg_edge(point1, point2),
      //   origin_live_on_entry(origin, point2).
      origin_contains_loan_on_entry_op.from_leapjoin(
        origin_contains_loan_on_entry_op,
        [
          loan_killed_at.filter_anti(([[_, point1], loan]: readonly [OP, Loan]) => [loan, point1] as const),
          cfg_edge_rel.extend_with(([[_, point1], __]: readonly [OP, Loan]) => point1),
          origin_live_on_entry_rel.extend_with(([[origin, _], __]: readonly [OP, Loan]) => origin),
        ],
        ([[origin, _], loan], point2: Point) => [[origin, point2], loan],
      );

      // dead_borrow_region_can_reach_root((origin, point), loan) :-
      //   loan_issued_at(origin, loan, point),
      //   !origin_live_on_entry(origin, point).
      dead_borrow_region_can_reach_root.from_antijoin(loan_issued_at_op, origin_live_on_entry_rel, ([origin, point], loan) => [
        [origin, point],
        loan,
      ]);

      // dead_borrow_region_can_reach_dead((origin, point), loan) :-
      //   dead_borrow_region_can_reach_root((origin, point), loan).
      dead_borrow_region_can_reach_dead.from_map(dead_borrow_region_can_reach_root, (tuple) => tuple);

      // dead_borrow_region_can_reach_dead((origin2, point), loan) :-
      //   dead_borrow_region_can_reach_dead(origin1, loan, point),
      //   subset(origin1, origin2, point),
      //   !origin_live_on_entry(origin2, point).
      dead_borrow_region_can_reach_dead_1.from_join(dead_borrow_region_can_reach_dead, subset_o1p, ([_origin1, point], loan, origin2) => [
        [origin2, point],
        loan,
      ]);
      dead_borrow_region_can_reach_dead.from_antijoin(dead_borrow_region_can_reach_dead_1, origin_live_on_entry_rel, ([origin2, point], loan) => [
        [origin2, point],
        loan,
      ]);

      // loan_live_at(loan, point) :-
      //   origin_contains_loan_on_entry(origin, loan, point),
      //   origin_live_on_entry(origin, point).
      loan_live_at.from_join(origin_contains_loan_on_entry_op, origin_live_on_entry_var, ([_origin, point], loan, _) => [
        [loan, point],
        undefined,
      ]);

      // loan_live_at(loan, point) :-
      //   dead_borrow_region_can_reach_dead(origin1, loan, point),
      //   subset(origin1, origin2, point),
      //   origin_live_on_entry(origin2, point).
      //
      // NB: the datafrog code below uses
      // `dead_borrow_region_can_reach_dead_1`, which is equal
      // to `dead_borrow_region_can_reach_dead` and `subset`
      // joined together.
      loan_live_at.from_join(dead_borrow_region_can_reach_dead_1, origin_live_on_entry_var, ([_origin2, point], loan, _) => [
        [loan, point],
        undefined,
      ]);

      // errors(loan, point) :-
      //   loan_invalidated_at(loan, point),
      //   loan_live_at(loan, point).
      errors.from_join(loan_invalidated_at, loan_live_at, ([loan, point], _, __) => [loan, point]);

      // subset_placeholder(Origin1, Origin2, Point) :-
      //     subset(Origin1, Origin2, Point),
      //     placeholder_origin(Origin1).
      subset_placeholder.from_leapjoin(
        subset_o1p,
        [
          placeholder_origin.extend_with(([[origin1, _point], _origin2]: readonly [OP, Origin]) => origin1),
          // remove symmetries:
          ValueFilter.from(([[origin1, _point], origin2]: readonly [OP, Origin], _: undefined) => origin1 !== origin2),
        ],
        ([[origin1, point], origin2], _) => [origin1, origin2, point],
      );

      // We compute the transitive closure of the placeholder origins, so we
      // maintain the invariant from the rule above that `Origin1` is a placeholder origin.
      //
      // subset_placeholder(Origin1, Origin3, Point) :-
      //     subset_placeholder(Origin1, Origin2, Point),
      //     subset(Origin2, Origin3, Point).
      subset_placeholder.from_join(subset_placeholder_o2p, subset_o1p, ([_origin2, point], origin1, origin3) => [origin1, origin3, point]);

      // subset_error(Origin1, Origin2, Point) :-
      //     subset_placeholder(Origin1, Origin2, Point),
      //     placeholder_origin(Origin2),
      //     !known_placeholder_subset(Origin1, Origin2).
      subset_errors.from_leapjoin(
        subset_placeholder,
        [
          placeholder_origin.extend_with(([_origin1, origin2, _point]: readonly [Origin, Origin, Point]) => origin2),
          known_placeholder_subset.filter_anti(([origin1, origin2, _point]: readonly [Origin, Origin, Point]) => [origin1, origin2] as const),
          // remove symmetries:
          ValueFilter.from(([origin1, origin2, _point]: readonly [Origin, Origin, Point], _: undefined) => origin1 !== origin2),
        ],
        ([origin1, origin2, point], _) => [origin1, origin2, point],
      );
    }

    if (result.dump_enabled) {
      const subset_o1p_rel = subset_o1p.complete();
      assert(subset_o1p_rel.iter().filter(([[origin1, _], origin2]) => origin1 === origin2).length === 0, "unwanted subset symmetries");
      for (const [[origin1, location], origin2] of subset_o1p_rel.iter()) {
        entry_or_default(result.subset, location, () => BTreeMap.default<Origin, BTreeSet<Origin>>())
          .entry_or_default(origin1, () => BTreeSet.default<Origin>())
          .insert(origin2);
      }

      const origin_contains_loan_on_entry_op_rel = origin_contains_loan_on_entry_op.complete();
      for (const [[origin, location], loan] of origin_contains_loan_on_entry_op_rel.iter()) {
        entry_or_default(result.origin_contains_loan_at, location, () => BTreeMap.default<Origin, BTreeSet<Loan>>())
          .entry_or_default(origin, () => BTreeSet.default<Loan>())
          .insert(loan);
      }

      const loan_live_at_rel = loan_live_at.complete();
      for (const [[loan, location], _] of loan_live_at_rel.iter()) {
        entry_or_default(result.loan_live_at, location, () => []).push(loan);
      }
    }

    return [errors.complete(), subset_errors.complete()];
  })();

  // info!(
  //     "analysis done: {} `errors` tuples, {} `subset_errors` tuples, {:?}",
  //     errors.len(),
  //     subset_errors.len(),
  //     timer.elapsed()
  // );

  return [errors, subset_errors];
}

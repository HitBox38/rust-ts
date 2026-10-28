// Port of polonius-engine =0.13.0 `src/output/location_insensitive.rs`.

import { Iteration, Relation, ValueFilter } from "../../datafrog/lib.ts";
import type { FactTypes } from "../facts.ts";
import { BTreeSet, type Context, entry_or_default, type Output } from "./mod.ts";

// crate: polonius-engine-0.13.0/src/output/location_insensitive.rs:17 compute
export function compute<T extends FactTypes>(
  ctx: Context<T>,
  result: Output<T>,
): [Relation<readonly [T["Loan"], T["Point"]]>, Relation<readonly [T["Origin"], T["Origin"]]>] {
  type Origin = T["Origin"];
  type Loan = T["Loan"];
  type Point = T["Point"];

  // let timer = Instant::now();

  const [potential_errors, potential_subset_errors] = ((): [
    Relation<readonly [Loan, Point]>,
    Relation<readonly [Origin, Origin]>,
  ] => {
    // Static inputs
    const origin_live_on_entry = ctx.origin_live_on_entry;
    const loan_invalidated_at = ctx.loan_invalidated_at;
    const placeholder_origin = ctx.placeholder_origin;
    const placeholder_loan = ctx.placeholder_loan;
    const known_contains = ctx.known_contains;

    // subset(Origin1, Origin2) :-
    //   subset_base(Origin1, Origin2, _).
    const subset = Relation.from_iter(
      ctx.subset_base.map(([origin1, origin2, _point]): readonly [Origin, Origin] => [origin1, origin2]),
    );

    // Create a new iteration context, ...
    const iteration = Iteration.new();

    // .. some variables, ..
    const origin_contains_loan_on_entry = iteration.variable<readonly [Origin, Loan]>("origin_contains_loan_on_entry");

    const potential_errors = iteration.variable<readonly [Loan, Point]>("potential_errors");
    const potential_subset_errors = iteration.variable<readonly [Origin, Origin]>("potential_subset_errors");

    // load initial facts.

    // origin_contains_loan_on_entry(Origin, Loan) :-
    //   loan_issued_at(Origin, Loan, _).
    origin_contains_loan_on_entry.extend(
      ctx.loan_issued_at.map(([origin, loan, _point]): readonly [Origin, Loan] => [origin, loan]),
    );

    // origin_contains_loan_on_entry(Origin, Loan) :-
    //   placeholder_loan(Origin, Loan).
    origin_contains_loan_on_entry.extend(placeholder_loan.iter().map(([loan, origin]): readonly [Origin, Loan] => [origin, loan]));

    // .. and then start iterating rules!
    while (iteration.changed()) {
      // origin_contains_loan_on_entry(Origin2, Loan) :-
      //   origin_contains_loan_on_entry(Origin1, Loan),
      //   subset(Origin1, Origin2).
      //
      // Note: Since `subset` is effectively a static input, this join can be ported to
      // a leapjoin. Doing so, however, was 7% slower on `clap`.
      origin_contains_loan_on_entry.from_join(origin_contains_loan_on_entry, subset, (_origin1, loan, origin2) => [origin2, loan]);

      // loan_live_at(Loan, Point) :-
      //   origin_contains_loan_on_entry(Origin, Loan),
      //   origin_live_on_entry(Origin, Point)
      //
      // potential_errors(Loan, Point) :-
      //   loan_invalidated_at(Loan, Point),
      //   loan_live_at(Loan, Point).
      //
      // Note: we don't need to materialize `loan_live_at` here
      // so we can inline it in the `potential_errors` relation.
      //
      potential_errors.from_leapjoin(
        origin_contains_loan_on_entry,
        [
          origin_live_on_entry.extend_with(([origin, _loan]: readonly [Origin, Loan]) => origin),
          loan_invalidated_at.extend_with(([_origin, loan]: readonly [Origin, Loan]) => loan),
        ],
        ([_origin, loan], point) => [loan, point],
      );

      // potential_subset_errors(Origin1, Origin2) :-
      //   placeholder(Origin1, Loan1),
      //   placeholder(Origin2, _),
      //   origin_contains_loan_on_entry(Origin2, Loan1),
      //   !known_contains(Origin2, Loan1).
      potential_subset_errors.from_leapjoin(
        origin_contains_loan_on_entry,
        [
          known_contains.filter_anti(([origin2, loan1]: readonly [Origin, Loan]) => [origin2, loan1] as const),
          placeholder_origin.filter_with(([origin2, _loan1]: readonly [Origin, Loan]) => [origin2, undefined] as const),
          placeholder_loan.extend_with(([_origin2, loan1]: readonly [Origin, Loan]) => loan1),
          // remove symmetries:
          ValueFilter.from(([origin2, _loan1]: readonly [Origin, Loan], origin1: Origin) => origin2 !== origin1),
        ],
        ([origin2, _loan1], origin1: Origin) => [origin1, origin2],
      );
    }

    if (result.dump_enabled) {
      for (const [origin1, origin2] of subset.iter()) {
        entry_or_default(result.subset_anywhere, origin1, () => BTreeSet.default<Origin>()).insert(origin2);
      }

      const origin_contains_loan_on_entry_rel = origin_contains_loan_on_entry.complete();
      for (const [origin, loan] of origin_contains_loan_on_entry_rel.iter()) {
        entry_or_default(result.origin_contains_loan_anywhere, origin, () => BTreeSet.default<Loan>()).insert(loan);
      }
    }

    return [potential_errors.complete(), potential_subset_errors.complete()];
  })();

  // info!(
  //     "analysis done: {} `potential_errors` tuples, {} `potential_subset_errors` tuples, {:?}",
  //     potential_errors.len(),
  //     potential_subset_errors.len(),
  //     timer.elapsed()
  // );

  return [potential_errors, potential_subset_errors];
}

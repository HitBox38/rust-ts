// Port of compiler/rustc_data_structures/src/obligation_forest/tests.rs.
// PORT: `impl ForestObligation for &str` is the descriptor `ForestObligation_str` (its cache key is the string itself);
// `ClosureObligationProcessor` takes the `process_obligation` closure (the backedge closure is ignored upstream too);
// `assert_eq!` on `Vec<Error<..>>` is `toEqual` on the plain `{ error, backtrace }` objects.
import { expect, test } from "bun:test";
import { unreachable, panic } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import {
  type Error,
  type ForestObligation,
  ObligationForest,
  type ObligationProcessor,
  ObligationProcessor_provided,
  type OutcomeTrait,
  type ProcessResult,
  ProcessResult as PR,
} from "./mod.ts";

const ForestObligation_str: ForestObligation<string> = {
  clone: (o) => o,
  debug: (o) => JSON.stringify(o),
  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:10 as_cache_key
  as_cache_key(o: string): string {
    return o;
  },
};

class TestOutcome<O, E> implements OutcomeTrait<O, Error<O, E>> {
  constructor(
    public completed: O[],
    public errors: Error<O, E>[],
  ) {}

  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:33 new
  static new<O, E>(): TestOutcome<O, E> {
    return new TestOutcome<O, E>([], []);
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:37 record_completed
  record_completed(outcome: O): void {
    this.completed.push(outcome);
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:41 record_error
  record_error(error: Error<O, E>): void {
    this.errors.push(error);
  }
}

class ClosureObligationProcessor<O, E> implements ObligationProcessor<O, E, TestOutcome<O, E>> {
  constructor(
    public process_obligation_: (o: O) => ProcessResult<O, E>,
    public _process_backedge: (cycle: O[]) => void,
  ) {}

  OUT_new(): TestOutcome<O, E> {
    return TestOutcome.new<O, E>();
  }

  skippable_obligations(it: Iterable<O>): number {
    return ObligationProcessor_provided.skippable_obligations(it);
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:70 needs_process_obligation
  needs_process_obligation(_obligation: O): boolean {
    return true;
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:74 process_obligation
  process_obligation(obligation: O): ProcessResult<O, E> {
    return this.process_obligation_(obligation);
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:81 process_backedge
  process_backedge(_cycle: Iterable<O>): Result<null, E> {
    return Ok(null);
  }
}

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:47 C
function C(of: (o: string) => ProcessResult<string, string>, bf: (cycle: string[]) => void): ClosureObligationProcessor<string, string> {
  return new ClosureObligationProcessor(of, bf);
}

const Changed = (children: string[]): ProcessResult<string, string> => ({ $: "Changed", _0: children });
const Err_ = (e: string): ProcessResult<string, string> => ({ $: "Error", _0: e });
const Unchanged: ProcessResult<string, string> = PR.Unchanged;

function new_forest(): ObligationForest<string> {
  return ObligationForest.new(ForestObligation_str);
}

const sorted = (v: string[]): string[] => [...v].sort();

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:94 push_pop
test("push_pop", () => {
  const forest = new_forest();
  forest.register_obligation("A");
  forest.register_obligation("B");
  forest.register_obligation("C");

  // first round, B errors out, A has subtasks, and C completes, creating this:
  //      A |-> A.1
  //        |-> A.2
  //        |-> A.3
  let { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Changed(["A.1", "A.2", "A.3"]);
          case "B":
            return Err_("B is for broken");
          case "C":
            return Changed([]);
          case "A.1":
          case "A.2":
          case "A.3":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(ok).toEqual(["C"]);
  expect(err).toEqual([{ error: "B is for broken", backtrace: ["B"] }]);

  // second round: two delays, one success, creating an uneven set of subtasks:
  //      A |-> A.1
  //        |-> A.2
  //        |-> A.3 |-> A.3.i
  //      D |-> D.1
  //        |-> D.2
  forest.register_obligation("D");
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A.1":
            return Unchanged;
          case "A.2":
            return Unchanged;
          case "A.3":
            return Changed(["A.3.i"]);
          case "D":
            return Changed(["D.1", "D.2"]);
          case "A.3.i":
          case "D.1":
          case "D.2":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok).toEqual([]);
  expect(err).toEqual([]);

  // third round: ok in A.1 but trigger an error in A.2. Check that it
  // propagates to A, but not D.1 or D.2.
  //      D |-> D.1 |-> D.1.i
  //        |-> D.2 |-> D.2.i
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A.1":
            return Changed([]);
          case "A.2":
            return Err_("A is for apple");
          case "A.3.i":
            return Changed([]);
          case "D.1":
            return Changed(["D.1.i"]);
          case "D.2":
            return Changed(["D.2.i"]);
          case "D.1.i":
          case "D.2.i":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(sorted(ok)).toEqual(["A.1", "A.3", "A.3.i"]);
  expect(err).toEqual([{ error: "A is for apple", backtrace: ["A.2", "A"] }]);

  // fourth round: error in D.1.i
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "D.1.i":
            return Err_("D is for dumb");
          case "D.2.i":
            return Changed([]);
          default:
            return panic(`unexpected obligation ${JSON.stringify(obligation)}`);
        }
      },
      () => {},
    ),
  ));
  expect(sorted(ok)).toEqual(["D.2", "D.2.i"]);
  expect(err).toEqual([{ error: "D is for dumb", backtrace: ["D.1.i", "D.1", "D"] }]);
});

// Test that if a tree with grandchildren succeeds, everything is
// reported as expected:
// A
//   A.1
//   A.2
//      A.2.i
//      A.2.ii
//   A.3
// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:183 success_in_grandchildren
test("success_in_grandchildren", () => {
  const forest = new_forest();
  forest.register_obligation("A");

  let { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Changed(["A.1", "A.2", "A.3"]);
          case "A.1":
            return Changed([]);
          case "A.2":
            return Changed(["A.2.i", "A.2.ii"]);
          case "A.3":
            return Changed([]);
          case "A.2.i":
          case "A.2.ii":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(sorted(ok)).toEqual(["A.1", "A.3"]);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A.2.i":
            return Unchanged;
          case "A.2.ii":
            return Changed([]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok).toEqual(["A.2.ii"]);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A.2.i":
            return Changed(["A.2.i.a"]);
          case "A.2.i.a":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A.2.i.a":
            return Changed([]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(sorted(ok)).toEqual(["A", "A.2", "A.2.i", "A.2.i.a"]);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      () => unreachable(),
      () => {},
    ),
  ));

  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);
});

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:245 to_errors_no_throw
test("to_errors_no_throw", () => {
  // check that converting multiple children with common parent (A)
  // yields to correct errors (and does not panic, in particular).
  const forest = new_forest();
  forest.register_obligation("A");
  const { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Changed(["A.1", "A.2", "A.3"]);
          case "A.1":
          case "A.2":
          case "A.3":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);
  const errors = forest.to_errors(null);
  expect(errors[0]!.backtrace).toEqual(["A.1", "A"]);
  expect(errors[1]!.backtrace).toEqual(["A.2", "A"]);
  expect(errors[2]!.backtrace).toEqual(["A.3", "A"]);
  expect(errors.length).toBe(3);
});

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:268 diamond
test("diamond", () => {
  // check that diamond dependencies are handled correctly
  const forest = new_forest();
  forest.register_obligation("A");
  let { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Changed(["A.1", "A.2"]);
          case "A.1":
          case "A.2":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A.1":
            return Changed(["D"]);
          case "A.2":
            return Changed(["D"]);
          case "D":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);

  let d_count = 0;
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "D":
            d_count += 1;
            return Changed([]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(d_count).toBe(1);
  expect(sorted(ok)).toEqual(["A", "A.1", "A.2", "D"]);
  expect(err.length).toBe(0);

  let errors = forest.to_errors(null);
  expect(errors.length).toBe(0);

  forest.register_obligation("A'");
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A'":
            return Changed(["A'.1", "A'.2"]);
          case "A'.1":
          case "A'.2":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A'.1":
            return Changed(["D'", "A'"]);
          case "A'.2":
            return Changed(["D'"]);
          case "D'":
          case "A'":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);

  d_count = 0;
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "D'":
            d_count += 1;
            return Err_("operation failed");
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(d_count).toBe(1);
  expect(ok.length).toBe(0);
  expect(err).toEqual([{ error: "operation failed", backtrace: ["D'", "A'.1", "A'"] }]);

  errors = forest.to_errors(null);
  expect(errors.length).toBe(0);
});

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:362 done_dependency
test("done_dependency", () => {
  // check that the local cache works
  const forest = new_forest();
  forest.register_obligation("A: Sized");
  forest.register_obligation("B: Sized");
  forest.register_obligation("C: Sized");

  let { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A: Sized":
          case "B: Sized":
          case "C: Sized":
            return Changed([]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(sorted(ok)).toEqual(["A: Sized", "B: Sized", "C: Sized"]);
  expect(err.length).toBe(0);

  forest.register_obligation("(A,B,C): Sized");
  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "(A,B,C): Sized":
            return Changed(["A: Sized", "B: Sized", "C: Sized"]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok).toEqual(["(A,B,C): Sized"]);
  expect(err.length).toBe(0);
});

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:396 orphan
test("orphan", () => {
  // check that orphaned nodes are handled correctly
  const forest = new_forest();
  forest.register_obligation("A");
  forest.register_obligation("B");
  forest.register_obligation("C1");
  forest.register_obligation("C2");

  let { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Changed(["D", "E"]);
          case "B":
            return Unchanged;
          case "C1":
            return Changed([]);
          case "C2":
            return Changed([]);
          case "D":
          case "E":
            return Unchanged;
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(sorted(ok)).toEqual(["C1", "C2"]);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "D":
          case "E":
            return Unchanged;
          case "B":
            return Changed(["D"]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err.length).toBe(0);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "D":
            return Unchanged;
          case "E":
            return Err_("E is for error");
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err).toEqual([{ error: "E is for error", backtrace: ["E", "A"] }]);

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "D":
            return Err_("D is dead");
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err).toEqual([{ error: "D is dead", backtrace: ["D"] }]);

  const errors = forest.to_errors(null);
  expect(errors.length).toBe(0);
});

// rustc: compiler/rustc_data_structures/src/obligation_forest/tests.rs:457 simultaneous_register_and_error
test("simultaneous_register_and_error", () => {
  // check that registering a failed obligation works correctly
  let forest = new_forest();
  forest.register_obligation("A");
  forest.register_obligation("B");

  let { completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Err_("An error");
          case "B":
            return Changed(["A"]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  );
  expect(ok.length).toBe(0);
  expect(err).toEqual([{ error: "An error", backtrace: ["A"] }]);

  forest = new_forest();
  forest.register_obligation("B");
  forest.register_obligation("A");

  ({ completed: ok, errors: err } = forest.process_obligations(
    C(
      (obligation) => {
        switch (obligation) {
          case "A":
            return Err_("An error");
          case "B":
            return Changed(["A"]);
          default:
            return unreachable();
        }
      },
      () => {},
    ),
  ));
  expect(ok.length).toBe(0);
  expect(err).toEqual([{ error: "An error", backtrace: ["A"] }]);
});

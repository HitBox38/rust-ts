// Unit tests of the port of compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs (no upstream tests; expectations
// traced by hand through the upstream algorithm).
import { describe, expect, test } from "bun:test";
import { PLAIN } from "../../std/fmt.ts";
import { ArgMatrix, type Compatibility, debug_Error, Error, ExpectedIdx, ProvidedIdx } from "./arg_matrix.ts";

const C: Compatibility = { $: "Compatible" };
const I: Compatibility = { $: "Incompatible", _0: undefined };

function run(provided: number, expected: number, compat: (p: number, e: number) => boolean): [string[], (number | undefined)[]] {
  const [errors, matched] = ArgMatrix.new(provided, expected, (p, e) => (compat(p, e) ? C : I)).find_errors();
  return [errors.map((e) => debug_Error(e, PLAIN)), matched];
}

describe("ArgMatrix::find_errors", () => {
  test("all compatible on the diagonal: no errors", () => {
    expect(run(2, 2, (p, e) => p === e)).toEqual([[], [0, 1]]);
  });

  test("two swapped arguments", () => {
    expect(run(2, 2, (p, e) => p !== e)).toEqual([["Swap(ProvidedIdx(0), ProvidedIdx(1), ExpectedIdx(0), ExpectedIdx(1))"], [1, 0]]);
  });

  test("missing argument", () => {
    expect(run(1, 2, (p, e) => p === 0 && e === 0)).toEqual([["Missing(ExpectedIdx(1))"], [0, undefined]]);
  });

  test("extra argument", () => {
    expect(run(2, 1, (p, e) => p === 0 && e === 0)).toEqual([["Extra(ProvidedIdx(1))"], [0]]);
  });

  test("invalid argument", () => {
    expect(run(2, 2, (p, e) => p === 0 && e === 0)).toEqual([["Invalid(ProvidedIdx(1), ExpectedIdx(1), Incompatible(None))"], [0, undefined]]);
  });

  test("three-cycle permutation", () => {
    expect(run(3, 3, (p, e) => e === (p + 1) % 3)).toEqual([
      ["Permutation([(ExpectedIdx(1), ProvidedIdx(1)), (ExpectedIdx(2), ProvidedIdx(2)), (ExpectedIdx(0), ProvidedIdx(0))])"],
      [2, 0, 1],
    ]);
  });
});

describe("Error: Ord", () => {
  test("orders by kind, then by index", () => {
    const errs: Error[] = [
      { $: "Missing", _0: ExpectedIdx.from_u32(0) },
      { $: "Extra", _0: ProvidedIdx.from_u32(3) },
      { $: "Extra", _0: ProvidedIdx.from_u32(1) },
      { $: "Invalid", _0: ProvidedIdx.from_u32(2), _1: ExpectedIdx.from_u32(2), _2: I },
    ];
    errs.sort(Error.cmp);
    expect(errs.map((e) => debug_Error(e, PLAIN))).toEqual([
      "Invalid(ProvidedIdx(2), ExpectedIdx(2), Incompatible(None))",
      "Extra(ProvidedIdx(1))",
      "Extra(ProvidedIdx(3))",
      "Missing(ExpectedIdx(0))",
    ]);
  });

  test("index conversions", () => {
    expect(ExpectedIdx.to_provided_idx(ExpectedIdx.from_u32(4))).toBe(ProvidedIdx.from_u32(4));
    expect(ProvidedIdx.to_expected_idx(ProvidedIdx.from_u32(7))).toBe(ExpectedIdx.from_u32(7));
  });
});

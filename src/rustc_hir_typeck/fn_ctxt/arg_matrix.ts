// Port of compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs (lane typeck-checks-a).
//
// The types (`ExpectedIdx`, `ProvidedIdx`, `Issue`, `Compatibility`, `Error`, `ArgMatrix`) are generated
// (arg_matrix.gen.ts).
// - `impl ExpectedIdx` / `impl ProvidedIdx` (one method each) live on the `newtype_index` companions
//   (`ExpectedIdx.to_provided_idx(idx)`), PORTING §8 "Enum methods live on the companion".
// - `impl Ord` / `impl PartialOrd for Error` are `Error.cmp(self_, other)` / `Error.partial_cmp(self_, other)` on the
//   companion `Error` (the type has no unit variants, so the generator emits no companion const).
// - `ArgMatrix`'s methods are assigned onto the generated class's prototype; `ArgMatrix::new` is the associated fn
//   `ArgMatrix.new` (namespace augmentation, decls.ts precedent).
// Init order: top-level code here touches only this file's .gen.ts and other crates.
import { assert, unwrap } from "../../std/panic.ts";
import * as gen from "./arg_matrix.gen.ts";
import { ArgMatrix, type Compatibility, clone_Compatibility, type Issue } from "./arg_matrix.gen.ts";

export * from "./arg_matrix.gen.ts";

// PORT: `core::cmp::Ordering` as the `-1 | 0 | 1` of `Array.prototype.sort` comparators (rustc_data_structures
// stable_hash.ts precedent); `a.cmp(b)` on numbers is `cmp_usize(a, b)`, `Ordering::then` is `then`.
export type Ordering = -1 | 0 | 1;
function cmp_usize(a: number, b: number): Ordering {
  return a < b ? -1 : a > b ? 1 : 0;
}
function then(self_: Ordering, other: Ordering): Ordering {
  return self_ === 0 ? other : self_;
}

// impl ExpectedIdx
export type ExpectedIdx = gen.ExpectedIdx;
export const ExpectedIdx = {
  ...gen.ExpectedIdx,

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:20 to_provided_idx
  to_provided_idx(self_: gen.ExpectedIdx): gen.ProvidedIdx {
    return gen.ProvidedIdx.from_usize(gen.ExpectedIdx.as_usize(self_));
  },
};

// impl ProvidedIdx
export type ProvidedIdx = gen.ProvidedIdx;
export const ProvidedIdx = {
  ...gen.ProvidedIdx,

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:26 to_expected_idx
  to_expected_idx(self_: gen.ProvidedIdx): gen.ExpectedIdx {
    return gen.ExpectedIdx.from_u32(gen.ProvidedIdx.as_u32(self_));
  },
};

/** Lexicographic `Ord` of `Vec<(ExpectedIdx, ProvidedIdx)>` (derived `Ord` of tuples and slices). */
function cmp_permutation(a: readonly [gen.ExpectedIdx, gen.ProvidedIdx][], b: readonly [gen.ExpectedIdx, gen.ProvidedIdx][]): Ordering {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = then(cmp_usize(a[i]![0], b[i]![0]), cmp_usize(a[i]![1], b[i]![1]));
    if (c !== 0) return c;
  }
  return cmp_usize(a.length, b.length);
}

export type Error = gen.Error;
export const Error = {
  // impl Ord for Error<'_>
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:68 cmp
  cmp(self_: gen.Error, other: gen.Error): Ordering {
    const key = (error: gen.Error): number => {
      switch (error.$) {
        case "Invalid":
          return 0;
        case "Extra":
          return 1;
        case "Missing":
          return 2;
        case "Swap":
          return 3;
        case "Permutation":
          return 4;
      }
    };
    if (self_.$ === "Invalid" && other.$ === "Invalid") {
      return cmp_usize(self_._0, other._0);
    } else if (self_.$ === "Extra" && other.$ === "Extra") {
      return cmp_usize(self_._0, other._0);
    } else if (self_.$ === "Missing" && other.$ === "Missing") {
      return cmp_usize(self_._0, other._0);
    } else if (self_.$ === "Swap" && other.$ === "Swap") {
      const [a, b, c, d] = [self_._0, self_._1, other._0, other._1];
      return then(cmp_usize(a, c), cmp_usize(b, d));
    } else if (self_.$ === "Permutation" && other.$ === "Permutation") {
      return cmp_permutation(self_._0, other._0);
    } else {
      return cmp_usize(key(self_), key(other));
    }
  },

  // impl PartialOrd for Error<'_>
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:90 partial_cmp
  partial_cmp(self_: gen.Error, other: gen.Error): Ordering | undefined {
    return Error.cmp(self_, other);
  },
};

declare module "./arg_matrix.gen.ts" {
  interface ArgMatrix {
    eliminate_provided(idx: number): void;
    eliminate_expected(idx: number): void;
    satisfy_input(provided_idx: number, expected_idx: number): void;
    eliminate_satisfied(): [gen.ProvidedIdx, gen.ExpectedIdx][];
    find_issue(): Issue | undefined;
    find_errors(): [gen.Error[], (gen.ProvidedIdx | undefined)[]];
  }
  namespace ArgMatrix {
    // fn_ctxt/arg_matrix.rs:109
    function new_(provided_count: number, expected_input_count: number, is_compatible: (_1: gen.ProvidedIdx, _2: gen.ExpectedIdx) => Compatibility): ArgMatrix;
    export { new_ as new };
  }
}

// impl<'tcx> ArgMatrix<'tcx>
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:109 new
(ArgMatrix as unknown as { new: typeof ArgMatrix.new }).new = function (
  provided_count: number,
  expected_input_count: number,
  is_compatible: (_1: gen.ProvidedIdx, _2: gen.ExpectedIdx) => Compatibility,
): ArgMatrix {
  const compatibility_matrix: Compatibility[][] = [];
  for (let i = 0; i < provided_count; i++) {
    const row: Compatibility[] = [];
    for (let j = 0; j < expected_input_count; j++) {
      row.push(is_compatible(gen.ProvidedIdx.from_usize(i), gen.ExpectedIdx.from_usize(j)));
    }
    compatibility_matrix.push(row);
  }
  const provided_indices: gen.ProvidedIdx[] = [];
  for (let i = 0; i < provided_count; i++) provided_indices.push(gen.ProvidedIdx.from_usize(i));
  const expected_indices: gen.ExpectedIdx[] = [];
  for (let j = 0; j < expected_input_count; j++) expected_indices.push(gen.ExpectedIdx.from_usize(j));
  return new ArgMatrix(provided_indices, expected_indices, compatibility_matrix);
};

/// Remove a given input from consideration
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:129 eliminate_provided
ArgMatrix.prototype.eliminate_provided = function (this: ArgMatrix, idx: number): void {
  vec_remove(this.provided_indices, idx);
  vec_remove(this.compatibility_matrix, idx);
};

/// Remove a given argument from consideration
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:135 eliminate_expected
ArgMatrix.prototype.eliminate_expected = function (this: ArgMatrix, idx: number): void {
  vec_remove(this.expected_indices, idx);
  for (const row of this.compatibility_matrix) {
    vec_remove(row, idx);
  }
};

/// "satisfy" an input with a given arg, removing both from consideration
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:143 satisfy_input
ArgMatrix.prototype.satisfy_input = function (this: ArgMatrix, provided_idx: number, expected_idx: number): void {
  this.eliminate_provided(provided_idx);
  this.eliminate_expected(expected_idx);
};

// Returns a `Vec` of (user input, expected arg) of matched arguments. These
// are inputs on the remaining diagonal that match.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:150 eliminate_satisfied
ArgMatrix.prototype.eliminate_satisfied = function (this: ArgMatrix): [gen.ProvidedIdx, gen.ExpectedIdx][] {
  const num_args = Math.min(this.provided_indices.length, this.expected_indices.length);
  const eliminated: [gen.ProvidedIdx, gen.ExpectedIdx][] = [];
  for (let i = num_args - 1; i >= 0; i--) {
    if (this.compatibility_matrix[i]![i]!.$ === "Compatible") {
      eliminated.push([this.provided_indices[i]!, this.expected_indices[i]!]);
      this.satisfy_input(i, i);
    }
  }
  return eliminated;
};

// Find some issue in the compatibility matrix
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:163 find_issue
ArgMatrix.prototype.find_issue = function (this: ArgMatrix): Issue | undefined {
  const mat = this.compatibility_matrix;
  const ai = this.expected_indices;
  const ii = this.provided_indices;

  // Issue: 100478, when we end the iteration,
  // `next_unmatched_idx` will point to the index of the first unmatched
  let next_unmatched_idx = 0;
  for (let i = 0; i < Math.max(ai.length, ii.length); i++) {
    // If we eliminate the last row, any left-over arguments are considered missing
    if (i >= mat.length) {
      return { $: "Missing", _0: next_unmatched_idx };
    }
    // If we eliminate the last column, any left-over inputs are extra
    if (mat[i]!.length === 0) {
      return { $: "Extra", _0: next_unmatched_idx };
    }

    // Make sure we don't pass the bounds of our matrix
    const is_arg = i < ai.length;
    const is_input = i < ii.length;
    if (is_arg && is_input && mat[i]![i]!.$ === "Compatible") {
      // This is a satisfied input, so move along
      next_unmatched_idx += 1;
      continue;
    }

    // If this argument can satisfy some input, then this argument is satisfiable
    const unsatisfiable = is_arg ? !mat.slice(0, ii.length).some((c) => c[i]!.$ === "Compatible") : true;
    // If this input can be satisfied by some argument, then this input is useful
    const useless = is_input ? !mat[i]!.slice(0, ai.length).some((c) => c.$ === "Compatible") : true;

    // match (is_input, is_arg, useless, unsatisfiable)
    if (is_input && is_arg && useless && unsatisfiable) {
      // If an argument is unsatisfied, and the input in its position is useless
      // then the most likely explanation is that we just got the types wrong
      return { $: "Invalid", _0: i };
    } else if (is_input && useless) {
      // Otherwise, if an input is useless then indicate that this is an extra input
      return { $: "Extra", _0: i };
    } else if (is_arg && unsatisfiable) {
      // Otherwise, if an argument is unsatisfiable, indicate that it's missing
      return { $: "Missing", _0: i };
    } else if (is_input && is_arg) {
      // The argument isn't useless, and the input isn't unsatisfied,
      // so look for a parameter we might swap it with
      // We look for swaps explicitly, instead of just falling back on permutations
      // so that cases like (A,B,C,D) given (B,A,D,C) show up as two swaps,
      // instead of a large permutation of 4 elements.
      for (let j = 0; j < Math.min(ai.length, ii.length); j++) {
        if (i === j || mat[j]![j]!.$ === "Compatible") {
          continue;
        }
        if (mat[i]![j]!.$ === "Compatible" && mat[j]![i]!.$ === "Compatible") {
          return { $: "Swap", _0: i, _1: j };
        }
      }
    } else {
      continue;
    }
  }

  // We didn't find any of the individual issues above, but
  // there might be a larger permutation of parameters, so we now check for that
  // by checking for cycles
  // We use a double option at position i in this vec to represent:
  // - None: We haven't computed anything about this argument yet
  // - Some(None): This argument definitely doesn't participate in a cycle
  // - Some(Some(x)): the i-th argument could permute to the x-th position
  // PORT: `Option<Option<usize>>` -> `{ $: "Some", _0: number | undefined } | undefined` (PORTING §5).
  const permutation: ({ $: "Some"; _0: number | undefined } | undefined)[] = new Array(mat.length).fill(undefined);
  let permutation_found = false;
  for (let i = 0; i < mat.length; i++) {
    if (permutation[i] !== undefined) {
      // We've already decided whether this argument is or is not in a loop
      continue;
    }

    const stack: number[] = [];
    let j = i;
    let last = i;
    let is_cycle = true;
    for (;;) {
      stack.push(j);
      // Look for params this one could slot into
      const compat: number[] = [];
      mat[j]!.forEach((c, i) => {
        if (c.$ === "Compatible") compat.push(i);
      });
      if (compat.length < 1) {
        // try to find a cycle even when this could go into multiple slots, see #101097
        is_cycle = false;
        break;
      }
      j = compat[0]!;
      if (stack.includes(j)) {
        last = j;
        break;
      }
    }
    if (stack.length <= 2) {
      // If we encounter a cycle of 1 or 2 elements, we'll let the
      // "satisfy" and "swap" code above handle those
      is_cycle = false;
    }
    // We've built up some chain, some of which might be a cycle
    // ex: [1,2,3,4]; last = 2; j = 2;
    // So, we want to mark 4, 3, and 2 as part of a permutation
    permutation_found = is_cycle;
    for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
      if (is_cycle) {
        permutation[x] = { $: "Some", _0: j };
        j = x;
        if (j === last) {
          // From here on out, we're a tail leading into a cycle,
          // not the cycle itself
          is_cycle = false;
        }
      } else {
        // Some(None) ensures we save time by skipping this argument again
        permutation[x] = { $: "Some", _0: undefined };
      }
    }
  }

  if (permutation_found) {
    // Map unwrap to remove the first layer of Some
    const final_permutation: (number | undefined)[] = permutation.map((x) => unwrap(x)._0);
    return { $: "Permutation", _0: final_permutation };
  }
  return undefined;
};

// Obviously, detecting exact user intention is impossible, so the goal here is to
// come up with as likely of a story as we can to be helpful.
//
// We'll iteratively removed "satisfied" input/argument pairs,
// then check for the cases above, until we've eliminated the entire grid
//
// We'll want to know which arguments and inputs these rows and columns correspond to
// even after we delete them.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs:317 find_errors
ArgMatrix.prototype.find_errors = function (this: ArgMatrix): [gen.Error[], (gen.ProvidedIdx | undefined)[]] {
  const provided_arg_count = this.provided_indices.length;

  const errors: gen.Error[] = [];
  // For each expected argument, the matched *actual* input
  const matched_inputs: (gen.ProvidedIdx | undefined)[] = new Array(this.expected_indices.length).fill(undefined);

  // Before we start looking for issues, eliminate any arguments that are already satisfied,
  // so that an argument which is already spoken for by the input it's in doesn't
  // spill over into another similarly typed input
  // ex:
  //   fn some_func(_a: i32, _b: i32) {}
  //   some_func(1, "");
  // Without this elimination, the first argument causes the second argument
  // to show up as both a missing input and extra argument, rather than
  // just an invalid type.
  for (const [provided, expected] of this.eliminate_satisfied()) {
    matched_inputs[expected] = provided;
  }

  while (this.provided_indices.length !== 0 || this.expected_indices.length !== 0) {
    const res = this.find_issue();
    if (res !== undefined && res.$ === "Invalid") {
      const idx = res._0;
      const compatibility = clone_Compatibility(this.compatibility_matrix[idx]![idx]!);
      const input_idx = this.provided_indices[idx]!;
      const arg_idx = this.expected_indices[idx]!;
      this.satisfy_input(idx, idx);
      errors.push({ $: "Invalid", _0: input_idx, _1: arg_idx, _2: compatibility });
    } else if (res !== undefined && res.$ === "Extra") {
      const idx = res._0;
      const input_idx = this.provided_indices[idx]!;
      this.eliminate_provided(idx);
      errors.push({ $: "Extra", _0: input_idx });
    } else if (res !== undefined && res.$ === "Missing") {
      const idx = res._0;
      const arg_idx = this.expected_indices[idx]!;
      this.eliminate_expected(idx);
      errors.push({ $: "Missing", _0: arg_idx });
    } else if (res !== undefined && res.$ === "Swap") {
      const [idx, other] = [res._0, res._1];
      const input_idx = this.provided_indices[idx]!;
      const other_input_idx = this.provided_indices[other]!;
      const arg_idx = this.expected_indices[idx]!;
      const other_arg_idx = this.expected_indices[other]!;
      const [min, max] = [Math.min(idx, other), Math.max(idx, other)];
      this.satisfy_input(min, max);
      // Subtract 1 because we already removed the "min" row
      this.satisfy_input(max - 1, min);
      errors.push({ $: "Swap", _0: input_idx, _1: other_input_idx, _2: arg_idx, _3: other_arg_idx });
      matched_inputs[other_arg_idx] = input_idx;
      matched_inputs[arg_idx] = other_input_idx;
    } else if (res !== undefined && res.$ === "Permutation") {
      const args = res._0;
      const idxs: number[] = args.filter((a): a is number => a !== undefined);

      const real_idxs: ([gen.ExpectedIdx, gen.ProvidedIdx] | undefined)[] = new Array(provided_arg_count).fill(undefined);
      for (let src = 0; src < args.length; src++) {
        const dst = args[src];
        if (dst === undefined) continue;
        const src_input_idx = this.provided_indices[src]!;
        const dst_input_idx = this.provided_indices[dst]!;
        const dest_arg_idx = this.expected_indices[dst]!;
        real_idxs[src_input_idx] = [dest_arg_idx, dst_input_idx];
        matched_inputs[dest_arg_idx] = src_input_idx;
      }
      idxs.sort((a, b) => a - b);
      idxs.reverse();
      for (const i of idxs) {
        this.satisfy_input(i, i);
      }
      errors.push({ $: "Permutation", _0: real_idxs.filter((x): x is [gen.ExpectedIdx, gen.ProvidedIdx] => x !== undefined) });
    } else {
      // We didn't find any issues, so we need to push the algorithm forward
      // First, eliminate any arguments that currently satisfy their inputs
      const eliminated = this.eliminate_satisfied();
      assert(eliminated.length !== 0, "didn't eliminated any indice in this round");
      for (const [inp, arg] of eliminated) {
        matched_inputs[arg] = inp;
      }
    }
  }

  // sort errors with same type by the order they appear in the source
  // so that suggestion will be handled properly, see #112507
  // PORT: `slice::sort` is stable, as is `Array.prototype.sort`.
  errors.sort(Error.cmp);
  return [errors, matched_inputs];
};

/** `Vec::remove(idx)` (panics when out of bounds, as upstream). */
function vec_remove<T>(v: T[], idx: number): T {
  assert(idx < v.length, `removal index (is ${idx}) should be < len (is ${v.length})`);
  return v.splice(idx, 1)[0]!;
}

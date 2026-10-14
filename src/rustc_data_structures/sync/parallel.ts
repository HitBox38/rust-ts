// Port of compiler/rustc_data_structures/src/sync/parallel.rs (lane tydump-subject: the tydump prefix's `par_fns` and
// `TyCtxt::par_hir_*`; see docs/handoff/tydump-subject.md).
//! This module defines parallel operations that are implemented in
//! one way for the serial compiler, and another way the parallel compiler.
//
// PORT notes (module-wide):
// - rust-ts is single-threaded: `mode::check_dyn_thread_safe()` is `None` in every process that reaches this module
//   (the parallel frontend, `-Zthreads` > 1, stops UNPORTED in rustc_interface util.rs
//   `run_in_thread_pool_with_globals`, and `set_dyn_thread_safe_mode` is not run). So the serial branches run, and the
//   parallel ones (`rustc_thread_pool`) stop as `unported(..)`.
// - `catch_unwind` / `resume_unwind`: a Rust panic is a thrown JS exception. `Unported` (a missing port, not a rustc
//   panic) and a JS stack overflow (rustc: an abort on the guard page, not an unwind) are not caught: they propagate at
//   once.
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { Unported, unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";

/** `mode::check_dyn_thread_safe()` (sync.rs:79): always `None` in rust-ts (see the module notes). */
function check_dyn_thread_safe(): undefined {
  return undefined;
}

/** Exceptions `catch_unwind` must not catch here (see the module notes). */
function is_not_an_unwind(err: unknown): boolean {
  return err instanceof Unported || (err instanceof RangeError && err.message.startsWith("Maximum call stack size exceeded"));
}

/// A guard used to hold panics that occur during a parallel section to later by unwound.
/// This is used for the parallel compiler to prevent fatal errors from non-deterministically
/// hiding errors by ensuring that everything in the section has completed executing before
/// continuing with unwinding. It's also used for the non-parallel code to ensure error message
/// output match the parallel compiler for testing purposes.
export class ParallelGuard {
  // PORT: `Mutex<Option<IntoDynSyncSend<Box<dyn Any + Send>>>>`; the payload is boxed so that any thrown value fits.
  constructor(public panic: { payload: unknown } | undefined) {}

  // rustc: compiler/rustc_data_structures/src/sync/parallel.rs:22 run
  run<R>(f: () => R): R | undefined {
    try {
      return f();
    } catch (err) {
      if (is_not_an_unwind(err)) throw err;
      if (this.panic === undefined || !(err instanceof FatalErrorMarker)) {
        this.panic = { payload: err };
      }
      return undefined;
    }
  }
}

/// This gives access to a fresh parallel guard in the closure and will unwind any panics
/// caught in it after the closure returns.
// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:37 parallel_guard
export function parallel_guard<R>(f: (guard: ParallelGuard) => R): R {
  const guard = new ParallelGuard(undefined);
  const ret = f(guard);
  if (guard.panic !== undefined) {
    throw guard.panic.payload;
  }
  return ret;
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:46 serial_join
function serial_join<RA, RB>(oper_a: () => RA, oper_b: () => RB): [RA, RB] {
  const [a, b] = parallel_guard((guard) => {
    const a = guard.run(oper_a);
    const b = guard.run(oper_b);
    return [a, b] as const;
  });
  // `(a.unwrap(), b.unwrap())`: both ran without a panic (`parallel_guard` resumed it otherwise).
  return [a as RA, b as RB];
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:59 spawn
export function spawn(func: () => void): void {
  if (check_dyn_thread_safe() !== undefined) {
    unported("rustc_thread_pool::spawn (parallel frontend)");
  } else {
    func();
  }
}

/// Runs the functions in parallel.
///
/// The first function is executed immediately on the current thread.
/// Use that for the longest running function for better scheduling.
// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:74 par_fns
export function par_fns(funcs: (() => void)[]): void {
  parallel_guard((guard: ParallelGuard) => {
    if (check_dyn_thread_safe() !== undefined) {
      unported("rustc_thread_pool::scope (parallel frontend)");
    } else {
      for (const f of funcs) {
        guard.run(() => f());
      }
    }
  });
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:106 par_join
export function par_join<RA, RB>(oper_a: () => RA, oper_b: () => RB): [RA, RB] {
  if (check_dyn_thread_safe() !== undefined) {
    return unported("rustc_thread_pool::join (parallel frontend)");
  } else {
    return serial_join(oper_a, oper_b);
  }
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:126 par_slice
function par_slice<I>(_items: I[], _guard: ParallelGuard, _for_each: (i: I) => void): void {
  // Only reached with `check_dyn_thread_safe()` = `Some(proof)` (the parallel frontend).
  unported("rustc_data_structures::sync::parallel::par_slice (parallel frontend)");
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:172 par_for_each_in
export function par_for_each_in<I>(t: Iterable<I>, for_each: (i: I) => void): void {
  parallel_guard((guard) => {
    if (check_dyn_thread_safe() !== undefined) {
      const items: I[] = [...t];
      par_slice(items, guard, (i) => for_each(i));
    } else {
      for (const i of t) {
        guard.run(() => for_each(i));
      }
    }
  });
}

// FIXME: actually make parallel and `T: DynSend`
// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:189 par_for_each_slice
export function par_for_each_slice<T>(items: T[], for_each: (i: T) => void): void {
  parallel_guard((guard) => {
    for (const i of items) {
      guard.run(() => for_each(i));
    }
  });
}

/// This runs `for_each` in parallel for each iterator item. If one or more of the
/// `for_each` calls returns `Err`, the function will also return `Err`. The error returned
/// will be non-deterministic, but this is expected to be used with `ErrorGuaranteed` which
/// are all equivalent.
// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:201 try_par_for_each_in
export function try_par_for_each_in<T, E>(t: Iterable<T>, for_each: (i: T) => Result<null, E>): Result<null, E> {
  return parallel_guard((guard) => {
    if (check_dyn_thread_safe() !== undefined) {
      // (`par_slice` with an error `Mutex`: the parallel frontend only.)
      par_slice([...t], guard, () => {});
      return unported("rustc_data_structures::sync::parallel::try_par_for_each_in (parallel frontend)");
    } else {
      // `t.into_iter().filter_map(|i| guard.run(|| for_each(&i))).fold(Ok(()), Result::and)`
      let acc: Result<null, E> = { $: "Ok", _0: null };
      for (const i of t) {
        const r = guard.run(() => for_each(i));
        if (r === undefined) continue;
        // `Result::and`: the first `Err` wins.
        if (acc.$ === "Ok") acc = r;
      }
      return acc;
    }
  });
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:232 par_map
export function par_map<I, R>(t: Iterable<I>, map: (i: I) => R): R[] {
  return parallel_guard((guard) => {
    if (check_dyn_thread_safe() !== undefined) {
      return unported("rustc_data_structures::sync::parallel::par_map (parallel frontend)");
    } else {
      // `t.into_iter().filter_map(|i| guard.run(|| map(i))).collect()`
      // PORT: `filter_map` drops the items whose `map` panicked (`guard.run` = `None`); `R` itself may be `undefined`
      // (a unit value), so a completed call is recorded by a flag, not told apart by the return value.
      const out: R[] = [];
      for (const i of t) {
        let done = false;
        const r = guard.run(() => {
          const v = map(i);
          done = true;
          return v;
        });
        if (!done) continue;
        out.push(r as R);
      }
      return out;
    }
  });
}

// rustc: compiler/rustc_data_structures/src/sync/parallel.rs:259 broadcast
export function broadcast<R>(op: (index: number) => R): R[] {
  if (check_dyn_thread_safe() !== undefined) {
    return unported("rustc_thread_pool::broadcast (parallel frontend)");
  } else {
    return [op(0)];
  }
}

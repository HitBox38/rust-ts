//! Exhaustive testing utilities.
//! (These are used in Tree Borrows `#[test]`s for thorough verification
//! of the behavior of the state machine of permissions,
//! but the contents of this file are extremely generic)
// Port of src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-a`
// (plan-m6 wave 38). `#[cfg(test)]` upstream; here `perms.ts` imports it too, because its `Exhaustive_*` tables sit beside the types they enumerate, so it
// is loaded on the default path. Only the `.test.ts` files call it.
//
// PORT: the trait is an interface and each impl an `Exhaustive_<Type>` table (borrowck-contract rules 4-5); the impls for
// generic containers are functions of the element's table, and their `T: Clone` bound is a function parameter `clone_T`
// (use `copy` for numbers, booleans and strings). `Box<dyn Iterator>` is a one-shot generator, lazily evaluated like
// upstream, and the `clone()` calls happen where upstream's do, so a test can mutate what it gets.
// PORT: `macro_rules! precondition { ($cond:expr) => { if !$cond { continue; } } }` cannot be a TS function (`continue`):
// call sites write `if (!cond) continue; // precondition!(cond);`.

export interface Exhaustive<T> {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:7 exhaustive
  exhaustive(): Iterable<T>;
}

/** `Clone` of a type whose values are immutable (numbers, booleans, strings). */
export function copy<T>(v: T): T {
  return v;
}

// Trivial impls of `Exhaustive` for the standard types with 0, 1 and 2 elements respectively.

// impl Exhaustive for !
export const Exhaustive_never: Exhaustive<never> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:22 exhaustive
  *exhaustive() {},
};

// impl Exhaustive for ()
export const Exhaustive_unit: Exhaustive<undefined> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:28 exhaustive
  *exhaustive() {
    yield undefined;
  },
};

// impl Exhaustive for bool
export const Exhaustive_bool: Exhaustive<boolean> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:34 exhaustive
  *exhaustive() {
    yield true;
    yield false;
  },
};

// Some container impls for `Exhaustive`.

// impl<T> Exhaustive for Option<T> where T: Exhaustive + 'static
export function Exhaustive_Option<T>(T: Exhaustive<T>): Exhaustive<T | undefined> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:45 exhaustive
    *exhaustive() {
      yield undefined;
      yield* T.exhaustive();
    },
  };
}

// impl<T1, T2> Exhaustive for (T1, T2) where T1: Exhaustive + Clone + 'static, T2: Exhaustive + 'static
export function Exhaustive_tuple2<T1, T2>(T1: Exhaustive<T1>, T2: Exhaustive<T2>, clone_T1: (v: T1) => T1): Exhaustive<[T1, T2]> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:55 exhaustive
    *exhaustive() {
      for (const t1 of T1.exhaustive()) {
        for (const t2 of T2.exhaustive()) {
          yield [clone_T1(t1), t2];
        }
      }
    },
  };
}

// impl<T> Exhaustive for [T; 1] where T: Exhaustive + 'static
export function Exhaustive_array1<T>(T: Exhaustive<T>): Exhaustive<[T]> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:64 exhaustive
    *exhaustive() {
      for (const t of T.exhaustive()) {
        yield [t];
      }
    },
  };
}

// impl<T> Exhaustive for [T; 2] where T: Exhaustive + Clone + 'static
export function Exhaustive_array2<T>(T: Exhaustive<T>, clone_T: (v: T) => T): Exhaustive<[T, T]> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:73 exhaustive
    *exhaustive() {
      for (const t1 of T.exhaustive()) {
        for (const t2 of T.exhaustive()) {
          yield [clone_T(t1), t2];
        }
      }
    },
  };
}

// impl<T> Exhaustive for [T; 3] where T: Exhaustive + Clone + 'static
export function Exhaustive_array3<T>(T: Exhaustive<T>, clone_T: (v: T) => T): Exhaustive<[T, T, T]> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:82 exhaustive
    *exhaustive() {
      for (const [t1, t2] of Exhaustive_array2(T, clone_T).exhaustive()) {
        for (const t3 of T.exhaustive()) {
          yield [clone_T(t1), clone_T(t2), t3];
        }
      }
    },
  };
}

// impl<T> Exhaustive for [T; 4] where T: Exhaustive + Clone + 'static
export function Exhaustive_array4<T>(T: Exhaustive<T>, clone_T: (v: T) => T): Exhaustive<[T, T, T, T]> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:94 exhaustive
    *exhaustive() {
      for (const [t1, t2] of Exhaustive_array2(T, clone_T).exhaustive()) {
        for (const [t3, t4] of Exhaustive_array2(T, clone_T).exhaustive()) {
          yield [clone_T(t1), clone_T(t2), t3, t4];
        }
      }
    },
  };
}

// impl<T> Exhaustive for [T; 5] where T: Exhaustive + Clone + 'static
export function Exhaustive_array5<T>(T: Exhaustive<T>, clone_T: (v: T) => T): Exhaustive<[T, T, T, T, T]> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/exhaustive.rs:105 exhaustive
    *exhaustive() {
      for (const [t1, t2] of Exhaustive_array2(T, clone_T).exhaustive()) {
        for (const [t3, t4, t5] of Exhaustive_array3(T, clone_T).exhaustive()) {
          yield [clone_T(t1), clone_T(t2), t3, t4, t5];
        }
      }
    },
  };
}

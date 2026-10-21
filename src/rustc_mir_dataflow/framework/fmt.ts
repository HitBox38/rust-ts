// Port of compiler/rustc_mir_dataflow/src/framework/fmt.rs (lane dataflow-contract).
//
// PORT (plan-m4 D5): `trait DebugWithContext<C>: Eq + fmt::Debug` is the impl table `DebugWithContext<T, C>`
// (`eq` / `fmt` are the supertraits); its provided methods live in `DebugWithContext_provided` (PORTING §8). The impls
// for generic types are functions of the element impl (`DebugWithContext_DenseBitSet(elem)`). `fmt::Result` is the
// written string (std/fmt.ts); `f.alternate()` is `f.alternate`.
//! Custom formatting traits used when outputting Graphviz diagrams with the results of a dataflow
//! analysis.

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type Debug, debug_set, type Fmt } from "../../std/fmt.ts";
import { assert_eq, panic } from "../../std/panic.ts";
import { display_MovePath, type HasMoveData, InitIndex, MovePathIndex } from "../move_paths/mod.ts";
import { type ChunkedBitSet, debug_DenseBitSet, DenseBitSet_eq, Local, MixedBitSet } from "../pending.ts";
import { debug_MaybeReachable, type MaybeReachable, MaybeReachable_eq } from "./lattice.ts";

/// An extension to `fmt::Debug` for data that can be better printed with some auxiliary data `C`.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/fmt.rs:12 DebugWithContext
export interface DebugWithContext<T, C> {
  /** The `Eq` supertrait (`==`). */
  eq(a: T, b: T): boolean;
  /** The `fmt::Debug` supertrait. */
  fmt(self: T, f: Fmt): string;

  // (provided) fmt.rs:13 fmt_with -> DebugWithContext_provided.fmt_with
  fmt_with(self: T, ctxt: C, f: Fmt): string;

  /// Print the difference between `self` and `old`.
  ///
  /// This should print nothing if `self == old`.
  ///
  /// `+` and `-` are typically used to indicate differences. However, these characters are
  /// fairly common and may be needed to print a types representation. If using them to indicate
  /// a diff, prefix them with the "Unit Separator"  control character (␟  U+001F).
  // (provided) fmt.rs:24 fmt_diff_with -> DebugWithContext_provided.fmt_diff_with
  fmt_diff_with(self: T, old: T, ctxt: C, f: Fmt): string;
}

/** The provided methods of `DebugWithContext` (PORTING §8; the impl table first, then `self`). */
export const DebugWithContext_provided = {
  // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:13 fmt_with
  fmt_with<T, C>(impl: DebugWithContext<T, C>, self: T, _ctxt: C, f: Fmt): string {
    return impl.fmt(self, f);
  },

  /// Print the difference between `self` and `old`.
  ///
  /// This should print nothing if `self == old`.
  ///
  /// `+` and `-` are typically used to indicate differences. However, these characters are
  /// fairly common and may be needed to print a types representation. If using them to indicate
  /// a diff, prefix them with the "Unit Separator"  control character (␟  U+001F).
  // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:24 fmt_diff_with
  fmt_diff_with<T, C>(impl: DebugWithContext<T, C>, self: T, old: T, ctxt: C, f: Fmt): string {
    if (impl.eq(self, old)) {
      return "";
    }

    let out = "";
    out += "\u{001f}+";
    out += impl.fmt_with(self, ctxt, f);

    if (f.alternate) {
      out += "\n";
    } else {
      out += "\t";
    }

    out += "\u{001f}-";
    out += impl.fmt_with(old, ctxt, f);
    return out;
  },
};

/** An impl table whose `fmt_with` / `fmt_diff_with` are the provided ones unless overridden. */
export function DebugWithContext_impl<T, C>(
  eq: (a: T, b: T) => boolean,
  fmt: Debug<T>,
  overrides: Partial<Pick<DebugWithContext<T, C>, "fmt_with" | "fmt_diff_with">> = {},
): DebugWithContext<T, C> {
  const impl: DebugWithContext<T, C> = {
    eq,
    fmt,
    fmt_with: overrides.fmt_with ?? ((self, ctxt, f) => DebugWithContext_provided.fmt_with(impl, self, ctxt, f)),
    fmt_diff_with:
      overrides.fmt_diff_with ?? ((self, old, ctxt, f) => DebugWithContext_provided.fmt_diff_with(impl, self, old, ctxt, f)),
  };
  return impl;
}

/// Implements `fmt::Debug` by deferring to `<T as DebugWithContext<C>>::fmt_with`.
// rustc-type: compiler/rustc_mir_dataflow/src/framework/fmt.rs:44 DebugWithAdapter
export interface DebugWithAdapter<T, C> {
  this: T;
  ctxt: C;
}

/** `impl<T: DebugWithContext<C>, C> fmt::Debug for DebugWithAdapter<'_, T, C>`. */
export function debug_DebugWithAdapter<T, C>(T_: DebugWithContext<T, C>): Debug<DebugWithAdapter<T, C>> {
  // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:53 fmt
  return function fmt(self: DebugWithAdapter<T, C>, f: Fmt): string {
    return T_.fmt_with(self.this, self.ctxt, f);
  };
}

/// Implements `fmt::Debug` by deferring to `<T as DebugWithContext<C>>::fmt_diff_with`.
// rustc-type: compiler/rustc_mir_dataflow/src/framework/fmt.rs:59 DebugDiffWithAdapter
export interface DebugDiffWithAdapter<T, C> {
  new: T;
  old: T;
  ctxt: C;
}

/** `impl<T: DebugWithContext<C>, C> fmt::Debug for DebugDiffWithAdapter<'_, T, C>`. */
export function debug_DebugDiffWithAdapter<T, C>(T_: DebugWithContext<T, C>): Debug<DebugDiffWithAdapter<T, C>> {
  // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:69 fmt
  return function fmt(self: DebugDiffWithAdapter<T, C>, f: Fmt): string {
    return T_.fmt_diff_with(self.new, self.old, self.ctxt, f);
  };
}

// Impls

/** `impl<T: Idx + DebugWithContext<C>, C> DebugWithContext<C> for DenseBitSet<T>`. */
export function DebugWithContext_DenseBitSet<T extends number, C>(T_: DebugWithContext<T, C>): DebugWithContext<DenseBitSet<T>, C> {
  return DebugWithContext_impl<DenseBitSet<T>, C>(DenseBitSet_eq, debug_DenseBitSet(T_.fmt), {
    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:80 fmt_with
    fmt_with(self: DenseBitSet<T>, ctxt: C, f: Fmt): string {
      return debug_set(
        f,
        [...self.iter()].map((i) => debug_DebugWithAdapter(T_)({ this: i, ctxt }, f)),
      );
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:84 fmt_diff_with
    fmt_diff_with(self: DenseBitSet<T>, old: DenseBitSet<T>, ctxt: C, f: Fmt): string {
      const size = self.domain_size();
      assert_eq(size, old.domain_size(), String);

      const set_in_self = MixedBitSet.new_empty<T>(size);
      const cleared_in_self = MixedBitSet.new_empty<T>(size);

      for (let n = 0; n < size; n++) {
        const i = n as T;
        const a = self.contains(i);
        const b = old.contains(i);
        if (a && !b) {
          MixedBitSet.insert(set_in_self, i);
        } else if (!a && b) {
          MixedBitSet.insert(cleared_in_self, i);
        } else {
          continue;
        }
      }

      return fmt_diff(set_in_self, cleared_in_self, ctxt, f, T_);
    },
  });
}

/** `impl<T: Idx + DebugWithContext<C>, C> DebugWithContext<C> for ChunkedBitSet<T>`. */
export function DebugWithContext_ChunkedBitSet<T extends number, C>(
  T_: DebugWithContext<T, C>,
  eq: (a: ChunkedBitSet<T>, b: ChunkedBitSet<T>) => boolean,
  fmt: Debug<ChunkedBitSet<T>>,
): DebugWithContext<ChunkedBitSet<T>, C> {
  return DebugWithContext_impl<ChunkedBitSet<T>, C>(eq, fmt, {
    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:107 fmt_with
    fmt_with(self: ChunkedBitSet<T>, ctxt: C, f: Fmt): string {
      return debug_set(
        f,
        [...self.iter()].map((i) => debug_DebugWithAdapter(T_)({ this: i, ctxt }, f)),
      );
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:111 fmt_diff_with
    fmt_diff_with(self: ChunkedBitSet<T>, old: ChunkedBitSet<T>, ctxt: C, f: Fmt): string {
      const size = self.domain_size();
      assert_eq(size, old.domain_size(), String);

      const set_in_self = MixedBitSet.new_empty<T>(size);
      const cleared_in_self = MixedBitSet.new_empty<T>(size);

      for (let n = 0; n < size; n++) {
        const i = n as T;
        const a = self.contains(i);
        const b = old.contains(i);
        if (a && !b) {
          MixedBitSet.insert(set_in_self, i);
        } else if (!a && b) {
          MixedBitSet.insert(cleared_in_self, i);
        } else {
          continue;
        }
      }

      return fmt_diff(set_in_self, cleared_in_self, ctxt, f, T_);
    },
  });
}

/** `impl<T: Idx + DebugWithContext<C>, C> DebugWithContext<C> for MixedBitSet<T>`. */
export function DebugWithContext_MixedBitSet<T extends number, C>(T_: DebugWithContext<T, C>): DebugWithContext<MixedBitSet<T>, C> {
  const small = DebugWithContext_DenseBitSet(T_);
  // PORT(contract): the `Large` arm's `ChunkedBitSet` Debug / `PartialEq` are pending index-ds (pending.ts).
  const large = DebugWithContext_ChunkedBitSet<T, C>(
    T_,
    () => panic("ChunkedBitSet: PartialEq (pending index-ds)"),
    () => panic("ChunkedBitSet: Debug (pending index-ds)"),
  );
  const fmt: Debug<MixedBitSet<T>> = (self, f) => (self.$ === "Small" ? small.fmt(self._0, f) : large.fmt(self._0, f));
  return DebugWithContext_impl<MixedBitSet<T>, C>(MixedBitSet.eq, fmt, {
    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:134 fmt_with
    fmt_with(self: MixedBitSet<T>, ctxt: C, f: Fmt): string {
      switch (self.$) {
        case "Small":
          return small.fmt_with(self._0, ctxt, f);
        case "Large":
          return large.fmt_with(self._0, ctxt, f);
      }
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:141 fmt_diff_with
    fmt_diff_with(self: MixedBitSet<T>, old: MixedBitSet<T>, ctxt: C, f: Fmt): string {
      if (self.$ === "Small" && old.$ === "Small") {
        return small.fmt_diff_with(self._0, old._0, ctxt, f);
      } else if (self.$ === "Large" && old.$ === "Large") {
        return large.fmt_diff_with(self._0, old._0, ctxt, f);
      } else {
        return panic("MixedBitSet size mismatch");
      }
    },
  });
}

/** `impl<S: DebugWithContext<C>, C> DebugWithContext<C> for MaybeReachable<S>`. */
export function DebugWithContext_MaybeReachable<S, C>(S_: DebugWithContext<S, C>): DebugWithContext<MaybeReachable<S>, C> {
  return DebugWithContext_impl<MaybeReachable<S>, C>(MaybeReachable_eq(S_.eq), debug_MaybeReachable(S_.fmt), {
    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:154 fmt_with
    fmt_with(self: MaybeReachable<S>, ctxt: C, f: Fmt): string {
      switch (self.$) {
        case "Unreachable": {
          return "unreachable";
        }
        case "Reachable":
          return S_.fmt_with(self._0, ctxt, f);
      }
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:163 fmt_diff_with
    fmt_diff_with(self: MaybeReachable<S>, old: MaybeReachable<S>, ctxt: C, f: Fmt): string {
      if (self.$ === "Unreachable" && old.$ === "Unreachable") {
        return "";
      } else if (self.$ === "Unreachable" && old.$ === "Reachable") {
        let out = "\u{001f}+";
        out += S_.fmt_with(old._0, ctxt, f);
        return out;
      } else if (self.$ === "Reachable" && old.$ === "Unreachable") {
        let out = "\u{001f}-";
        out += S_.fmt_with(self._0, ctxt, f);
        return out;
      } else {
        const this_ = (self as { _0: S })._0;
        const old_ = (old as { _0: S })._0;
        return S_.fmt_diff_with(this_, old_, ctxt, f);
      }
    },
  });
}

// rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:181 fmt_diff
function fmt_diff<T extends number, C>(
  inserted: MixedBitSet<T>,
  removed: MixedBitSet<T>,
  ctxt: C,
  f: Fmt,
  T_: DebugWithContext<T, C>,
): string {
  let out = "";
  let first = true;
  for (const idx of MixedBitSet.iter(inserted)) {
    const delim = first ? "\u{001f}+" : f.alternate ? "\n\u{001f}+" : ", ";

    out += delim;
    out += T_.fmt_with(idx, ctxt, f);
    first = false;
  }

  if (!f.alternate) {
    first = true;
    if (!MixedBitSet.is_empty(inserted) && !MixedBitSet.is_empty(removed)) {
      out += "\t";
    }
  }

  for (const idx of MixedBitSet.iter(removed)) {
    const delim = first ? "\u{001f}-" : f.alternate ? "\n\u{001f}-" : ", ";

    out += delim;
    out += T_.fmt_with(idx, ctxt, f);
    first = false;
  }

  return out;
}

/** `impl<T: DebugWithContext<C>, C> DebugWithContext<C> for &'_ T` (references are erased: the same table). */
export function DebugWithContext_Ref<T, C>(T_: DebugWithContext<T, C>): DebugWithContext<T, C> {
  return DebugWithContext_impl<T, C>(T_.eq, T_.fmt, {
    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:233 fmt_with
    fmt_with(self: T, ctxt: C, f: Fmt): string {
      return T_.fmt_with(self, ctxt, f);
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:237 fmt_diff_with
    fmt_diff_with(self: T, old: T, ctxt: C, f: Fmt): string {
      return T_.fmt_diff_with(self, old, ctxt, f);
    },
  });
}

/** `impl<C> DebugWithContext<C> for rustc_middle::mir::Local {}` */
export const DebugWithContext_Local: DebugWithContext<Local, unknown> = DebugWithContext_impl<Local, unknown>(
  (a, b) => a === b,
  Local.debug,
);
/** `impl<C> DebugWithContext<C> for crate::move_paths::InitIndex {}` */
export const DebugWithContext_InitIndex: DebugWithContext<InitIndex, unknown> = DebugWithContext_impl<InitIndex, unknown>(
  (a, b) => a === b,
  InitIndex.debug,
);

/** `impl<'tcx, C: HasMoveData<'tcx>> DebugWithContext<C> for crate::move_paths::MovePathIndex`. */
export const DebugWithContext_MovePathIndex: DebugWithContext<MovePathIndex, HasMoveData> = DebugWithContext_impl<
  MovePathIndex,
  HasMoveData
>((a, b) => a === b, MovePathIndex.debug, {
  // rustc: compiler/rustc_mir_dataflow/src/framework/fmt.rs:249 fmt_with
  fmt_with(self: MovePathIndex, ctxt: HasMoveData, _f: Fmt): string {
    return display_MovePath(ctxt.move_data().move_paths[self]!);
  },
});

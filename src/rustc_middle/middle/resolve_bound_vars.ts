// Port of compiler/rustc_middle/src/middle/resolve_bound_vars.rs
//! Name resolution for lifetimes and late-bound type and const variables (done by
//! `rustc_hir_analysis`): type declarations.
//
// PORT: the types are hand-written in the shape `bun tools/codegen/types.ts` emits for this file (a scratch run of a set
// holding only this file, lane collect-rbv): the file is in no codegen set yet. The generator left `DebruijnIndex`,
// `ItemLocalId` and `BoundVariableKind` unresolved (no typemap entries) and `LocalDefIdMap`'s Debug unported (hash
// order); here the first three are imported from their ports, the last stays `unported_debug`. derive(TyEncodable,
// TyDecodable, Encodable, Decodable, StableHash) are skipped (metadata encoding / incremental, PORTING §3); derive(Hash)
// of `ResolvedArg` is `key_ResolvedArg` (the canonical key for `KeyedMap`s, PORTING §5 interned handles).
import { ItemLocalId_cmp } from "../../rustc_hir/hir.ts";
import { debug_ItemLocalId, type ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { debug_DefId, debug_LocalDefId, type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { debug_ErrorGuaranteed, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { debug_SortedMap, SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import { debug_BoundVariableKind, type BoundVariableKind } from "../../rustc_type_ir/binder.gen.ts";
import { debug_DebruijnIndex, type DebruijnIndex } from "../../rustc_type_ir/lib.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
const unported_debug = (_v: unknown): string => unported("Debug without a TS impl (see types report)");

// rustc-type: compiler/rustc_middle/src/middle/resolve_bound_vars.rs:13 ResolvedArg
// #[derive(Clone, Copy, PartialEq, Eq, Hash, TyEncodable, TyDecodable, Debug, StableHash)]
export type ResolvedArg =
  | { readonly $: "StaticLifetime" }
  | { readonly $: "EarlyBound"; _0: /* decl */ LocalDefId }
  | { readonly $: "LateBound"; _0: DebruijnIndex; _1: /* late-bound index */ number; _2: /* decl */ LocalDefId }
  | { readonly $: "Free"; _0: LocalDefId; _1: /* lifetime decl */ LocalDefId }
  | { readonly $: "Error"; _0: ErrorGuaranteed };
/** Unit variants of `ResolvedArg`, shared frozen singletons. */
export const ResolvedArg = {
  StaticLifetime: Object.freeze({ $: "StaticLifetime" as const }),
};
export const debug_ResolvedArg: Debug<ResolvedArg> = (v, f) => {
  switch (v.$) {
    case "EarlyBound":
      return debug_tuple(f, "EarlyBound", [debug_LocalDefId(v._0, f)]);
    case "LateBound":
      return debug_tuple(f, "LateBound", [debug_DebruijnIndex(v._0, f), debug_int(v._1, f), debug_LocalDefId(v._2, f)]);
    case "Free":
      return debug_tuple(f, "Free", [debug_LocalDefId(v._0, f), debug_LocalDefId(v._1, f)]);
    case "Error":
      return debug_tuple(f, "Error", [debug_ErrorGuaranteed(v._0, f)]);
    case "StaticLifetime":
      return v.$;
  }
};
export function clone_ResolvedArg(v: ResolvedArg): ResolvedArg {
  switch (v.$) {
    case "EarlyBound":
      return { $: "EarlyBound", _0: v._0 };
    case "LateBound":
      return { $: "LateBound", _0: v._0, _1: v._1, _2: v._2 };
    case "Free":
      return { $: "Free", _0: v._0, _1: v._1 };
    case "Error":
      return { $: "Error", _0: v._0 };
    case "StaticLifetime":
      return v;
  }
}
/** derive(PartialEq) (`ErrorGuaranteed` is zero-sized: two `Error`s are equal, PORTING §8). */
export function ResolvedArg_eq(a: ResolvedArg, b: ResolvedArg): boolean {
  return key_ResolvedArg(a) === key_ResolvedArg(b);
}
/** derive(Hash)+derive(Eq) as a canonical key (`KeyedMap<ResolvedArg, _>`; `ErrorGuaranteed` is zero-sized). */
export function key_ResolvedArg(v: ResolvedArg): string {
  switch (v.$) {
    case "StaticLifetime":
      return "S";
    case "EarlyBound":
      return `E${v._0}`;
    case "LateBound":
      return `L${v._0},${v._1},${v._2}`;
    case "Free":
      return `F${v._0},${v._1}`;
    case "Error":
      return "X";
  }
}

// rustc-type: compiler/rustc_middle/src/middle/resolve_bound_vars.rs:25 Set1
/// A set containing, at most, one known element.
/// If two distinct values are inserted into a set, then it
/// becomes `Many`, which can be used to detect ambiguities.
// #[derive(Copy, Clone, PartialEq, Eq, TyEncodable, TyDecodable, Debug, StableHash)]
export type Set1<T> =
  | { readonly $: "Empty" }
  | { readonly $: "One"; _0: T }
  | { readonly $: "Many" };
/** Unit variants of `Set1`, shared frozen singletons. */
export const Set1 = {
  Empty: Object.freeze({ $: "Empty" as const }),
  Many: Object.freeze({ $: "Many" as const }),

  // impl<T: PartialEq> Set1<T>
  // PORT: `&mut self` that reassigns `*self` -> a `{ value }` wrapper (PORTING §8 `MutRef`); `T: PartialEq` -> `eq_T`.
  // rustc: compiler/rustc_middle/src/middle/resolve_bound_vars.rs:32 insert
  insert<T>(self: { value: Set1<T> }, value: T, eq_T: (a: T, b: T) => boolean): void {
    const cur = self.value;
    let next: Set1<T>;
    if (cur.$ === "Empty") {
      next = { $: "One", _0: value };
    } else if (cur.$ === "One" && eq_T(cur._0, value)) {
      return;
    } else {
      next = Set1.Many;
    }
    self.value = next;
  },
};
export function debug_Set1<T>(v: Set1<T>, f: Fmt, debug_T: Debug<T>): string {
  switch (v.$) {
    case "One":
      return debug_tuple(f, "One", [debug_T(v._0, f)]);
    case "Empty":
    case "Many":
      return v.$;
  }
}
export function clone_Set1<T>(v: Set1<T>, clone_T: (v: T) => T): Set1<T> {
  switch (v.$) {
    case "One":
      return { $: "One", _0: clone_T(v._0) };
    case "Empty":
    case "Many":
      return v;
  }
}

// rustc-type: compiler/rustc_middle/src/middle/resolve_bound_vars.rs:42 ObjectLifetimeDefault
// #[derive(Copy, Clone, Debug, StableHash, Encodable, Decodable)]
export type ObjectLifetimeDefault =
  | { readonly $: "Empty" }
  | { readonly $: "Static" }
  | { readonly $: "Ambiguous" }
  | { readonly $: "Param"; _0: DefId };
/** Unit variants of `ObjectLifetimeDefault`, shared frozen singletons. */
export const ObjectLifetimeDefault = {
  Empty: Object.freeze({ $: "Empty" as const }),
  Static: Object.freeze({ $: "Static" as const }),
  Ambiguous: Object.freeze({ $: "Ambiguous" as const }),
};
export const debug_ObjectLifetimeDefault: Debug<ObjectLifetimeDefault> = (v, f) => {
  switch (v.$) {
    case "Param":
      return debug_tuple(f, "Param", [debug_DefId(v._0, f)]);
    case "Empty":
    case "Static":
    case "Ambiguous":
      return v.$;
  }
};
export function clone_ObjectLifetimeDefault(v: ObjectLifetimeDefault): ObjectLifetimeDefault {
  switch (v.$) {
    case "Param":
      return { $: "Param", _0: v._0 };
    case "Empty":
    case "Static":
    case "Ambiguous":
      return v;
  }
}

// rustc-type: compiler/rustc_middle/src/middle/resolve_bound_vars.rs:52 ResolveBoundVars
/// Maps the id of each bound variable reference to the variable decl
/// that it corresponds to.
// #[derive(Debug, Default, StableHash)]
export interface ResolveBoundVars {
  // Maps from every use of a named (not anonymous) bound var to a
  // `ResolvedArg` describing how that variable is bound.
  defs: SortedMap<ItemLocalId, ResolvedArg>;

  // Maps relevant hir items to the bound vars on them. These include:
  // - function defs
  // - function pointers
  // - closures
  // - trait refs
  // - bound types (like `T` in `for<'a> T<'a>: Foo`)
  late_bound_vars: SortedMap<ItemLocalId, BoundVariableKind[]>;

  // List captured variables for each opaque type.
  opaque_captured_lifetimes: Map<LocalDefId, [ResolvedArg, LocalDefId][]>;
}
export const debug_ResolveBoundVars: Debug<ResolveBoundVars> = (v, f) =>
  debug_struct(f, "ResolveBoundVars", [
    ["defs", debug_SortedMap(v.defs, f, debug_ItemLocalId, debug_ResolvedArg)],
    ["late_bound_vars", debug_SortedMap(v.late_bound_vars, f, debug_ItemLocalId, (x, f) => debug_vec(x, f, debug_BoundVariableKind))],
    // PORT: `LocalDefIdMap` (`UnordMap`) prints in hash order (codegen: not reproducible yet).
    ["opaque_captured_lifetimes", unported_debug(v.opaque_captured_lifetimes)],
  ]);
/** derive(Default) */
export function default_ResolveBoundVars(): ResolveBoundVars {
  return {
    defs: SortedMap.default(ItemLocalId_cmp),
    late_bound_vars: SortedMap.default(ItemLocalId_cmp),
    opaque_captured_lifetimes: new Map(),
  };
}

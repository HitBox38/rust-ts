// Port of compiler/rustc_middle/src/ty/list.rs (lane ty-contract, docs/plan-m3.md D2).
//
// PORT (D2):
// - `RawList<H, T>` (an arena-allocated header + length + elements, used as `&'tcx RawList<H, T>`) is a frozen
//   **array subclass**: a `List<T>` *is* a `readonly T[]` (indexing, `length`, `for..of`, every `&[T]` API), plus
//   the `header` and the intern `id`. Lists are made only by the `CtxtInterners` slice interners (context.ts:
//   `mk_type_list`, `mk_args`, ...), one object per distinct element sequence, so equality is `===` and a list is
//   its own `Map`/`Set` key (upstream `PartialEq`/`Hash` are pointer-based).
// - `List::empty()` is one shared frozen empty list per header type (upstream: one `static EMPTY` per
//   `impl_list_empty!` instantiation, shared by every `T`).
// - `ListWithCachedTypeInfo<T>` (`Clauses`) is `RawList<TypeInfo, T>`.
// - Array methods that build arrays (`map`, `filter`, `slice`, ...) return plain arrays (`Symbol.species`), never
//   lists: a new list only comes from an interner.
// - Methods of `RawList` defined in other files (`GenericArgs`' in generic_args.rs, `List<PolyExistentialPredicate>`'s
//   in predicate.rs) are declared in decls.ts and filled by those files.
import { INTERNED, next_intern_id } from "../../rustc_data_structures/intern.ts";
import type { BoundVariableKind, DebruijnIndex, TypeFlags } from "../../rustc_type_ir/decls.ts";
import { INNERMOST, TypeFlags_empty } from "../../rustc_type_ir/decls.ts";
import type { FlagComputation } from "../../rustc_type_ir/flags.ts";
import { type Debug, debug_list, type Fmt } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import type { FxHasher } from "../../vendor/rustc_hash/lib.ts";
import type { TyCtxt } from "./context.ts";
import type { Arena } from "./decls.ts";
import type { Ordering } from "./mod.ts";

/// A list type stored in the arena with a header and a length; see `List` for docs.
// rustc-type: compiler/rustc_middle/src/ty/list.rs:38 RawList
export class RawList<H, T> extends Array<T> {
  declare readonly [INTERNED]: true;
  /** PORT: sequential intern id (rustc_data_structures/intern.ts). */
  declare readonly id: number;
  /** `ListSkeleton::header` */
  declare readonly header: H;

  static override get [globalThis.Symbol.species](): ArrayConstructor {
    return Array;
  }

  /** PORT: only the interners (and `empty`) construct; the list is frozen. */
  static of_slice<H, T>(header: H, slice: readonly T[]): RawList<H, T> {
    const list = new RawList<H, T>();
    for (let i = 0; i < slice.length; i++) list.push(slice[i]!);
    Object.defineProperty(list, "id", { value: next_intern_id(), enumerable: false });
    Object.defineProperty(list, "header", { value: header, enumerable: false });
    return Object.freeze(list) as RawList<H, T>;
  }

  // PORT: `impl<T> Default for &List<T>`; `T` is a phantom here (see `empty`).
  // rustc: compiler/rustc_middle/src/ty/list.rs:67 default
  static default<T>(): List<T> {
    return RawList.empty();
  }

  // rustc: compiler/rustc_middle/src/ty/list.rs:78 len
  len(): number {
    return this.length;
  }

  // PORT: also `impl SliceLike for &RawList` `as_slice` (list.rs:151, `(*self).as_slice()`): one method.
  // rustc: compiler/rustc_middle/src/ty/list.rs:83 as_slice
  // rustc: compiler/rustc_middle/src/ty/list.rs:151 as_slice
  as_slice(): readonly T[] {
    return this;
  }

  /// Allocates a list from `arena` and copies the contents of `slice` into it.
  ///
  /// WARNING: the contents *must be unique*, such that no list with these
  /// contents has been previously created. If not, operations such as `eq`
  /// and `hash` might give incorrect results.
  ///
  /// Panics if `T` is `Drop`, or `T` is zero-sized, or the slice is empty
  /// (because the empty list exists statically, and is available via
  /// `empty()`).
  // rustc: compiler/rustc_middle/src/ty/list.rs:97 from_arena
  static from_arena<H, T>(_arena: Arena | undefined, header: H, slice: readonly T[]): RawList<H, T> {
    // PORT: `assert!(!mem::needs_drop::<T>())` / `assert!(size_of::<T>() != 0)` hold for every element type the
    // interners use; the arena is erased (PORTING §5).
    assert(!(slice.length === 0), "assertion failed: !slice.is_empty()");
    return RawList.of_slice(header, slice);
  }

  // If this method didn't exist, we would use `slice.iter` due to
  // deref coercion.
  //
  // This would be weird, as `self.into_iter` iterates over `T` directly.
  // PORT: also `impl SliceLike for &RawList` `iter` (list.rs:147, `(*self).iter()`): one method.
  // rustc: compiler/rustc_middle/src/ty/list.rs:134 iter
  // rustc: compiler/rustc_middle/src/ty/list.rs:147 iter
  iter(): IterableIterator<T> {
    return this[globalThis.Symbol.iterator]();
  }

  // rustc: compiler/rustc_middle/src/ty/list.rs:206 eq
  /** `impl<H, T: PartialEq> PartialEq for RawList<H, T>` */
  eq(other: RawList<H, T>): boolean {
    // Pointer equality implies list equality (due to the unique contents
    // assumption).
    return this === other;
  }

  // rustc: compiler/rustc_middle/src/ty/list.rs:253 deref
  /** `impl<H, T> Deref for RawList<H, T>` (`Target = [T]`) */
  deref(): readonly T[] {
    return this.as_ref();
  }

  // PORT: the list *is* its slice (module comment): no raw-parts reconstruction.
  // rustc: compiler/rustc_middle/src/ty/list.rs:260 as_ref
  /** `impl<H, T> AsRef<[T]> for RawList<H, T>` */
  as_ref(): readonly T[] {
    return this;
  }

  // rustc: compiler/rustc_middle/src/ty/list.rs:274 into_iter
  /** `impl<'a, H, T: Copy> IntoIterator for &'a RawList<H, T>` (`self[..].iter().copied()`) */
  into_iter(): IterableIterator<T> {
    return this[globalThis.Symbol.iterator]();
  }

  // rustc: compiler/rustc_middle/src/ty/list.rs:298 flags
  flags(this: RawList<TypeInfo, T>): TypeFlags {
    return this.header.flags;
  }

  // rustc: compiler/rustc_middle/src/ty/list.rs:303 outer_exclusive_binder
  outer_exclusive_binder(this: RawList<TypeInfo, T>): DebruijnIndex {
    return this.header.outer_exclusive_binder;
  }

  // PORT: `impl_list_empty!((), ())` and `impl_list_empty!(TypeInfo, TypeInfo::empty())`: one frozen empty list
  // per header type (module comment); `T` is a phantom here.
  // rustc: compiler/rustc_middle/src/ty/list.rs:172 empty
  static empty<T>(): List<T> {
    return EMPTY_LIST as List<T>;
  }

  /** `<ListWithCachedTypeInfo<T>>::empty()` (the second `impl_list_empty!` instantiation, list.rs:308). */
  static empty_with_type_info<T>(): ListWithCachedTypeInfo<T> {
    return EMPTY_LIST_WITH_TYPE_INFO as ListWithCachedTypeInfo<T>;
  }
}
Object.defineProperty(RawList.prototype, INTERNED, { value: true });

/// `List<T>` is a bit like `&[T]`, but with some critical differences.
/// - IMPORTANT: Every `List<T>` is *required* to have unique contents. The
///   type's correctness relies on this, *and this module is the only place
///   where creation of a `List` is allowed*.
/// - It is always a thin pointer.
/// - Its contents are always copied (`T: Copy`)
///
/// Some other differences from `&[T]`:
/// - It can only be used immutably.
/// - Because of its uniqueness, pointer comparison suffices for equality.
/// - Its storage is arena-allocated in a Rust project.
///
/// Thus, `List<T>` is a valid type for interning lists of copyable things.
// rustc-type: compiler/rustc_middle/src/ty/list.rs:31 List
export type List<T> = RawList<null, T>;

// rustc-type: compiler/rustc_middle/src/ty/list.rs:294 ListWithCachedTypeInfo
export type ListWithCachedTypeInfo<T> = RawList<TypeInfo, T>;

/** `pub type Clauses<'tcx> = &'tcx ListWithCachedTypeInfo<Clause<'tcx>>` (mod.rs:999). */
export type Clauses = ListWithCachedTypeInfo<import("./predicate.ts").Clause>;

// rustc-type: compiler/rustc_middle/src/ty/list.rs:313 TypeInfo
export interface TypeInfo {
  readonly flags: TypeFlags;
  readonly outer_exclusive_binder: DebruijnIndex;
}

export const TypeInfo = {
  // rustc: compiler/rustc_middle/src/ty/list.rs:319 empty
  empty(): TypeInfo {
    return { flags: TypeFlags_empty, outer_exclusive_binder: INNERMOST };
  },

  // rustc: compiler/rustc_middle/src/ty/list.rs:325 from
  /** `impl From<FlagComputation<TyCtxt>> for TypeInfo` */
  from(computation: FlagComputation): TypeInfo {
    return {
      flags: computation.flags,
      outer_exclusive_binder: computation.outer_exclusive_binder,
    };
  },
};

const EMPTY_LIST = RawList.of_slice<null, unknown>(null, []);
const EMPTY_LIST_WITH_TYPE_INFO = RawList.of_slice<TypeInfo, unknown>(TypeInfo.empty(), []);

/** `impl BoundVarKinds<TyCtxt> for &RawList<(), BoundVariableKind>` */
// rustc: compiler/rustc_middle/src/ty/list.rs:159 from_vars
RawList.from_vars = function (tcx: TyCtxt, iter: Iterable<BoundVariableKind>): List<BoundVariableKind> {
  return tcx.mk_bound_variable_kinds_from_iter(iter);
};

// rustc: compiler/rustc_middle/src/ty/list.rs:192 fmt
/** `impl<H, T: Debug> Debug for RawList<H, T>`: the slice's Debug. */
export function debug_RawList<H, T>(v: RawList<H, T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_list(f, v.map((x) => debug_T(x, f)));
}

// rustc-skip: compiler/rustc_middle/src/ty/list.rs:199 encode Encodable impl (metadata encoding, M5)

/** `impl<H, T: Ord> Ord for RawList<H, T>`.
 *  PORT: `T: Ord` is `cmp_T` (PORTING §5 "pass function tables"); `<[T] as Ord>::cmp` is the lexicographic slice order
 *  (elements first, then length). Interned element types have no `Ord` (D2): only callers with an `Ord` element type
 *  may use this. */
// rustc: compiler/rustc_middle/src/ty/list.rs:219 cmp
export function cmp_RawList<H, T>(self: RawList<H, T>, other: RawList<H, T>, cmp_T: (a: T, b: T) => Ordering): Ordering {
  // Pointer equality implies list equality (due to the unique contents
  // assumption), but the contents must be compared otherwise.
  if (self.eq(other)) {
    return "Equal";
  } else {
    return cmp_slice(self, other, cmp_T);
  }
}

/** `impl<H, T: PartialOrd> PartialOrd for RawList<H, T>`. PORT: `T: PartialOrd` is `partial_cmp_T` (see `cmp_RawList`). */
// rustc: compiler/rustc_middle/src/ty/list.rs:230 partial_cmp
export function partial_cmp_RawList<H, T>(self: RawList<H, T>, other: RawList<H, T>, partial_cmp_T: (a: T, b: T) => Ordering | undefined): Ordering | undefined {
  // Pointer equality implies list equality (due to the unique contents
  // assumption), but the contents must be compared otherwise.
  if (self.eq(other)) {
    return "Equal";
  } else {
    return partial_cmp_slice(self, other, partial_cmp_T);
  }
}

/** PORT: `<[T] as Ord>::cmp` (core `SliceOrd`): the first non-equal element decides, else the lengths. */
function cmp_slice<T>(a: readonly T[], b: readonly T[], cmp_T: (a: T, b: T) => Ordering): Ordering {
  const l = Math.min(a.length, b.length);
  for (let i = 0; i < l; i++) {
    const c = cmp_T(a[i]!, b[i]!);
    if (c !== "Equal") return c;
  }
  return a.length < b.length ? "Less" : a.length > b.length ? "Greater" : "Equal";
}

/** PORT: `<[T] as PartialOrd>::partial_cmp` (core `SlicePartialOrd`): as `cmp_slice`, stopping at a `None`. */
function partial_cmp_slice<T>(a: readonly T[], b: readonly T[], partial_cmp_T: (a: T, b: T) => Ordering | undefined): Ordering | undefined {
  const l = Math.min(a.length, b.length);
  for (let i = 0; i < l; i++) {
    const c = partial_cmp_T(a[i]!, b[i]!);
    if (c !== "Equal") return c;
  }
  return a.length < b.length ? "Less" : a.length > b.length ? "Greater" : "Equal";
}

/** `impl<Hdr, T> Hash for RawList<Hdr, T>`.
 *  PORT: `ptr::from_ref(self).hash(s)` writes the address; the port writes the intern `id` (as `hash_Interned`,
 *  rustc_data_structures/intern.ts). As a `Map`/`Set` key the list itself is used (D2). */
// rustc: compiler/rustc_middle/src/ty/list.rs:243 hash
export function hash_RawList<H, T>(self: RawList<H, T>, s: Pick<FxHasher, "write_usize">): void {
  // Pointer hashing is sufficient (due to the unique contents
  // assumption).
  s.write_usize(self.id);
}

/** (decls) `RawList::from_vars` is `impl BoundVarKinds<TyCtxt> for &List<BoundVariableKind>` (list.rs:154). */
export type BoundVarKinds = List<BoundVariableKind>;


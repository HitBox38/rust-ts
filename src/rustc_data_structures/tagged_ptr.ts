// Port of compiler/rustc_data_structures/src/tagged_ptr.rs (partial: `TaggedRef` as HIR uses it, `TyKind::TraitObject`;
// lane hir-types).
//
// PORT: the pointer/tag packing (`Tag`, `Aligned`, `pack`, the bit counts) has no meaning in TS: a `TaggedRef` is the
// `{ pointer: &'a P, tag: T }` pair the upstream doc describes, stored unpacked. `pointer` is shared (a `&'a P`), so a
// copy of a `TaggedRef` is the same object (it is never mutated after `new`, except through `set_tag`, which is not
// ported). The other fns of the file (`Tag`, `bits_for_tags`, `pack`, `set_tag`, `Deref`, `PartialEq`/`Hash`) are not
// ported.
import type { StableHash, StableHashCtxt, StableHasher } from "./stable_hash.ts";
import { type Debug, debug_struct, type Fmt } from "../std/fmt.ts";

/// A covariant [`Copy`] tagged borrow. This is essentially `{ pointer: &'a P, tag: T }` packed
/// in a single reference.
// rustc-type: compiler/rustc_data_structures/src/tagged_ptr.rs:83 TaggedRef
export class TaggedRef<P, T> {
  private constructor(
    private readonly pointer_: P,
    private readonly tag_: T,
  ) {}

  /// Tags `pointer` with `tag`.
  // rustc: compiler/rustc_data_structures/src/tagged_ptr.rs:135 new
  static new<P, T>(pointer: P, tag: T): TaggedRef<P, T> {
    return new TaggedRef(pointer, tag);
  }

  /// Retrieves the pointer.
  // rustc: compiler/rustc_data_structures/src/tagged_ptr.rs:141 pointer
  pointer(): P {
    return this.pointer_;
  }

  /// Retrieves the tag.
  // rustc: compiler/rustc_data_structures/src/tagged_ptr.rs:148 tag
  tag(): T {
    return this.tag_;
  }
}

// impl<P, T> fmt::Debug for TaggedRef<'_, P, T>
// rustc: compiler/rustc_data_structures/src/tagged_ptr.rs:233 fmt
export function debug_TaggedRef<P, T>(self: TaggedRef<P, T>, f: Fmt, debug_P: Debug<P>, debug_T: Debug<T>): string {
  return debug_struct(f, "TaggedRef", [
    ["pointer", debug_P(self.pointer(), f)],
    ["tag", debug_T(self.tag(), f)],
  ]);
}

// impl<'a, P, T> StableHash for TaggedRef<'a, P, T>
// rustc: compiler/rustc_data_structures/src/tagged_ptr.rs:267 stable_hash
export function stable_hash_TaggedRef<P, T>(
  self: TaggedRef<P, T>,
  hcx: StableHashCtxt,
  hasher: StableHasher,
  stable_hash_P: StableHash<P>,
  stable_hash_T: StableHash<T>,
): void {
  stable_hash_P(self.pointer(), hcx, hasher);
  stable_hash_T(self.tag(), hcx, hasher);
}

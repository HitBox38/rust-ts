// Contract stub for compiler/rustc_type_ir/src/sty/consts.rs (lane ty-contract, docs/plan-m3.md D2/D3).
//
// Defines the hash-consed `Const` class (`pub struct Const<I: Interner>(pub I::InternedConstKind)`).
// PORT (D2, D3):
// - `I` is erased to rustc_middle's `TyCtxt`; `I::InternedConstKind` is
//   `Interned<'tcx, WithCachedTypeInfo<ConstKind<'tcx>>>`, so the `Const` object *is* the interned
//   `WithCachedTypeInfo` box (fields `internee`, `flags`, `outer_exclusive_binder`): one frozen instance per
//   distinct `ConstKind`, made only by `CtxtInterners::intern_const` (rustc_middle ty/context.ts). Equality is
//   `===`; a `Const` is its own `Map`/`Set` key.
// - Field renames (res-lib rule): `WithCachedTypeInfo`'s `flags` / `outer_exclusive_binder` are the fields
//   `flags_` / `outer_exclusive_binder_`, because `impl Flags for Const` (consts.rs:150) needs the method names.
// - Methods: declared in ../decls.ts (this file's) and rustc_middle ty/decls.ts (ty/consts.rs's), filled on
//   `Const.prototype` / `Const` by the owning lanes (docs/handoff/ty-contract.md "How to fill a stub").
// - Trait impls that are not methods: `Debug` (consts.rs:24) is `debug_Const`; `TypeFoldable` /
//   `TypeVisitable` / `TypeSuperFoldable` / `TypeSuperVisitable` (:168-:223) are the D4 descriptor
//   `fold_Const`; `Relate` (:239) is `relate_Const`.
import { Interned } from "../../rustc_data_structures/intern.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { ConstKind, DebruijnIndex, TypeFlags } from "../decls.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TypeSuperFoldable } from "../fold.ts";
import type { TypeSuperVisitable } from "../visit.ts";

// rustc-type: compiler/rustc_type_ir/src/sty/consts.rs:22 Const
export class Const extends Interned {
  /** `WithCachedTypeInfo::internee` */
  readonly internee: ConstKind;
  /** `WithCachedTypeInfo::flags` (renamed: module comment) */
  readonly flags_: TypeFlags;
  /** `WithCachedTypeInfo::outer_exclusive_binder` (renamed: module comment) */
  readonly outer_exclusive_binder_: DebruijnIndex;

  /** PORT: only `CtxtInterners::intern_const` constructs (D2); the kind object is frozen with it. */
  constructor(internee: ConstKind, flags: TypeFlags, outer_exclusive_binder: DebruijnIndex) {
    super();
    this.internee = Object.freeze(internee);
    this.flags_ = flags;
    this.outer_exclusive_binder_ = outer_exclusive_binder;
    Object.freeze(this);
  }

  /** Stub (`Const::new`, consts.rs:43): a class static because `new` cannot be declared in a namespace. */
  static new(_interner: TyCtxt, _kind: ConstKind): Const {
    return unported("rustc_type_ir::sty::Const::new");
  }

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:38 kind
  kind(): ConstKind {
    return this.internee;
  }

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:151 flags
  flags(): TypeFlags {
    return this.flags_;
  }

  // rustc: compiler/rustc_type_ir/src/sty/consts.rs:155 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    return this.outer_exclusive_binder_;
  }
}

unported_methods(Const.prototype, "rustc_type_ir::sty::Const", [
  // sty/consts.rs, `impl<I: Interner> Const<I>`
  "is_ct_var",
  "is_ct_error",
  "is_trivially_wf",
  "is_ct_infer",
  "ct_vid",
]);
unported_methods(Const, "rustc_type_ir::sty::Const", [
  "new_var",
  "new_infer",
  "new_bound",
  "new_anon_bound",
  "new_canonical_bound",
  "new_placeholder",
  "new_alias",
  "new_expr",
  "new_error",
  "new_param",
  "new_fresh",
  "new_misc_error",
  "new_error_with_message",
]);

/** `impl<I: Interner> fmt::Debug for Const<I>` (consts.rs:24). */
export function debug_Const(_v: Const, _f: Fmt): string {
  return unported("rustc_type_ir::sty::Const: Debug (needs Display of ty::Value / debug_ConstKind, codegen-tyir)");
}

/** D4 descriptor: the `TypeFoldable`/`TypeVisitable`/`TypeSuper*` impls of `Const` (consts.rs:168-:223). */
export const fold_Const: TypeSuperFoldable<Const> & TypeSuperVisitable<Const> = {
  visit_with(_self, _visitor) {
    return unported("rustc_type_ir::sty::Const: TypeVisitable::visit_with");
  },
  try_fold_with(_self, _folder) {
    return unported("rustc_type_ir::sty::Const: TypeFoldable::try_fold_with");
  },
  fold_with(_self, _folder) {
    return unported("rustc_type_ir::sty::Const: TypeFoldable::fold_with");
  },
  super_visit_with(_self, _visitor) {
    return unported("rustc_type_ir::sty::Const: TypeSuperVisitable::super_visit_with");
  },
  try_super_fold_with(_self, _folder) {
    return unported("rustc_type_ir::sty::Const: TypeSuperFoldable::try_super_fold_with");
  },
  super_fold_with(_self, _folder) {
    return unported("rustc_type_ir::sty::Const: TypeSuperFoldable::super_fold_with");
  },
};

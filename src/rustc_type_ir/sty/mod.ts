// Contract stub for compiler/rustc_type_ir/src/sty/mod.rs (lane ty-contract, docs/plan-m3.md D2/D3).
//
// Defines the hash-consed `Region` class (`pub struct Region<I: Interner>(pub I::InternedRegionKind)`).
// PORT (D2, D3):
// - `I` is erased to rustc_middle's `TyCtxt`; `I::InternedRegionKind` is `Interned<'tcx, RegionKind<'tcx>>`, so
//   the `Region` object *is* the interned `RegionKind` box: one frozen instance per distinct `RegionKind`,
//   made only by `CtxtInterners`' `region` set (`TyCtxt::intern_region`, rustc_middle ty/context.ts). Equality
//   is `===`; a `Region` is its own `Map`/`Set` key.
// - The `RegionKind` is the `internee` field (the name of `WithCachedTypeInfo`'s field, for uniformity with
//   `Ty` / `Const`; a region caches no flags upstream either: `type_flags()` computes them).
// - Methods: declared in ../decls.ts (`interface Region` / `namespace Region` for the statics), filled on
//   `Region.prototype` / `Region` by the lane that ports this file, which removes each name from the
//   `unported_methods(..)` lists below (see docs/handoff/ty-contract.md "How to fill a stub").
// - Trait impls that are not methods: `Debug` (sty/mod.rs:291) is `debug_Region`; `TypeVisitable` /
//   `TypeFoldable` (:297, :303) are the D4 descriptor `fold_Region`; `Relate` (:281) is `relate_Region`.
import { Interned } from "../../rustc_data_structures/intern.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { RegionKind } from "../decls.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../fold.ts";
import type { Result } from "../../std/result.ts";
import type { TypeVisitor } from "../visit.ts";
import type { LateParamRegion } from "./mod.gen.ts";

export * from "./consts.ts";
// The other types of sty/mod.rs (`LateParamRegion`) with their derived impls are generated into mod.gen.ts (set rustc_ty
// of tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./mod.gen.ts";

/// Use this rather than `RegionKind`, whenever possible.
// rustc-type: compiler/rustc_type_ir/src/sty/mod.rs:26 Region
export class Region extends Interned {
  /** PORT: the interned `RegionKind` (module comment). */
  readonly internee: RegionKind;

  /** PORT: only `CtxtInterners` constructs (D2); the kind object is frozen with it. */
  constructor(internee: RegionKind) {
    super();
    this.internee = Object.freeze(internee);
    Object.freeze(this);
  }

  // rustc: compiler/rustc_type_ir/src/sty/mod.rs:246 kind
  kind(): RegionKind {
    return this.internee;
  }
}

unported_methods(Region.prototype, "rustc_type_ir::sty::Region", [
  // sty/mod.rs, `impl<I: Interner> Region<I>`
  "get_name",
  "get_name_or_anon",
  "opt_param_def_id",
  "is_named",
  "is_bound",
  "is_error",
  "is_static",
  "is_erased",
  "is_placeholder",
  "is_param",
  "is_free",
  "is_var",
  "as_var",
  "type_flags",
  "bound_at_or_above_binder",
  // `impl Flags for Region`
  "flags",
  "outer_exclusive_binder",
]);
unported_methods(Region, "rustc_type_ir::sty::Region", [
  "new_var",
  "new_error_misc",
  "new_error_with_message",
  "new_late_param",
  "new_early_param",
  "new_error",
  "new_bound",
  "new_anon_bound",
  "new_canonical_bound",
  "new_placeholder",
  "new_static",
]);

/** `impl<I: Interner> fmt::Debug for Region<I>` (sty/mod.rs:290): `write!(f, "{:?}", self.kind())`. */
export function debug_Region(_v: Region, _f: Fmt): string {
  return unported("rustc_type_ir::sty::Region: Debug (needs debug_RegionKind, codegen-tyir)");
}

/** D4 descriptor: `impl TypeVisitable for Region` (sty/mod.rs:296) + `impl TypeFoldable for Region` (:302). */
export const fold_Region: TypeFoldable<Region> = {
  visit_with(_self, _visitor) {
    return unported("rustc_type_ir::sty::Region: TypeVisitable::visit_with");
  },
  try_fold_with(_self, _folder) {
    return unported("rustc_type_ir::sty::Region: TypeFoldable::try_fold_with");
  },
  fold_with(_self, _folder) {
    return unported("rustc_type_ir::sty::Region: TypeFoldable::fold_with");
  },
};

// PORT (merge-w13): the impl fns of `fold_Region` as tools/codegen's generated code calls them (type_fold.json shape).
export function visit_with_Region<R>(self: Region, visitor: TypeVisitor<R>): R {
  return fold_Region.visit_with(self, visitor);
}
export function try_fold_with_Region<E>(self: Region, folder: FallibleTypeFolder<E>): Result<Region, E> {
  return fold_Region.try_fold_with(self, folder);
}
export function fold_with_Region(self: Region, folder: TypeFolder): Region {
  return fold_Region.fold_with(self, folder);
}

/** Stub: `impl<I: Interner> fmt::Debug for LateParamRegion<I>` (sty/mod.rs:330), ported by the later tyir lanes. */
export function debug_LateParamRegion(_v: LateParamRegion, _f: Fmt): string {
  return unported("rustc_type_ir::sty::LateParamRegion: Debug (manual impl, compiler/rustc_type_ir/src/sty/mod.rs:330)");
}

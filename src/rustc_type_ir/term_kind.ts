// Port of compiler/rustc_type_ir/src/term_kind.rs (lane tyir-kind). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into term_kind.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir);
// this file holds the inherent methods and the `From` impls, in upstream order.
// PORT (D3): `I: Interner` is erased (see ty_kind.ts). The methods of `AliasTermKind` live on its companion const; the
// impls on `AliasTerm` (= `Alias<AliasTermKind>`) are the companion `AliasTerm`. Every `I::*Id` is `DefId`, so the
// `def_id.into()` conversions are the identity. The `From` impls are named after their source type
// (`AliasTermKind.from_AliasTyKind`, `AliasTerm.from_AliasTy`, ...).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { Term, Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { AliasConst } from "./const_kind.ts";
import type { AliasConstKind } from "./const_kind.gen.ts";
import type { Interner } from "./interner.ts";
import type { TraitRef } from "./predicate.gen.ts";
import { Const } from "./sty/consts.ts";
import * as gen from "./term_kind.gen.ts";
import { debug_AliasTermKind } from "./term_kind.gen.ts";
import type { AliasConst as AliasConstT, AliasTerm as AliasTermT, AliasTy as AliasTyT } from "./ty/alias.ts";
import { AliasTy, type AliasTyKind, type IsRigid } from "./ty_kind.ts";

export * from "./term_kind.gen.ts";

export type AliasTermKind = gen.AliasTermKind;
export const AliasTermKind = {
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:80 descr
  descr(self: AliasTermKind): string {
    switch (self.$) {
      case "ProjectionTy":
        return "associated type";
      case "ProjectionConst":
        return "associated const";
      case "InherentTy":
        return "inherent associated type";
      case "InherentConstSelf":
      case "InherentConstImpl": {
        return "inherent associated const";
      }
      case "OpaqueTy":
        return "opaque type";
      case "FreeTy":
        return "type alias";
      case "FreeConst":
        return "const alias";
      case "AnonConst":
        return "anonymous constant";
    }
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:95 is_type
  is_type(self: AliasTermKind): boolean {
    switch (self.$) {
      case "ProjectionTy":
      case "InherentTy":
      case "OpaqueTy":
      case "FreeTy":
        return true;

      case "AnonConst":
      case "ProjectionConst":
      case "InherentConstSelf":
      case "InherentConstImpl":
      case "FreeConst":
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:110 is_trait_projection
  is_trait_projection(self: AliasTermKind): boolean {
    switch (self.$) {
      case "ProjectionTy":
      case "ProjectionConst":
        return true;
      case "InherentTy":
      case "OpaqueTy":
      case "FreeTy":
      case "AnonConst":
      case "FreeConst":
      case "InherentConstSelf":
      case "InherentConstImpl":
        return false;
    }
  },

  // PORT: `impl From<ty::AliasTyKind<I>> for AliasTermKind<I>`.
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:125 from
  from_AliasTyKind(value: AliasTyKind): AliasTermKind {
    switch (value.$) {
      case "Projection":
        return { $: "ProjectionTy", def_id: value.def_id };
      case "Opaque":
        return { $: "OpaqueTy", def_id: value.def_id };
      case "Free":
        return { $: "FreeTy", def_id: value.def_id };
      case "Inherent":
        return { $: "InherentTy", def_id: value.def_id };
    }
  },

  // PORT: `impl From<ty::AliasConstKind<I>> for AliasTermKind<I>`.
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:136 from
  from_AliasConstKind(value: AliasConstKind): AliasTermKind {
    switch (value.$) {
      case "Projection":
        return { $: "ProjectionConst", def_id: value.def_id };
      case "InherentSelf": {
        return { $: "InherentConstSelf", def_id: value.def_id };
      }
      case "InherentImpl": {
        return { $: "InherentConstImpl", def_id: value.def_id };
      }
      case "Free":
        return { $: "FreeConst", def_id: value.def_id };
      case "Anon":
        return { $: "AnonConst", def_id: value.def_id };
    }
  },
};

export const AliasTerm = {
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:152 new_from_args
  new_from_args(_interner: TyCtxt, kind: AliasTermKind, args: GenericArgs): AliasTermT {
    // PORT: `if cfg!(debug_assertions) { interner.debug_assert_alias_term_args_compatible(kind, args); }`:
    // the oracle is a release build without debug assertions.
    return { kind, args, _use_alias_new_instead: null };
  },

  // PORT: `args: impl IntoIterator<Item: Into<I::GenericArg>>` is `Iterable<GenericArg>` (packing is the identity).
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:163 new
  new(interner: TyCtxt, kind: AliasTermKind, args: Iterable<GenericArg>): AliasTermT {
    const args_ = interner.mk_args_from_iter(args);
    return AliasTerm.new_from_args(interner, kind, args_);
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:172 expect_ty
  expect_ty(self: AliasTermT): AliasTyT {
    let kind: AliasTyKind;
    switch (self.kind.$) {
      case "ProjectionTy":
        kind = { $: "Projection", def_id: self.kind.def_id };
        break;
      case "InherentTy":
        kind = { $: "Inherent", def_id: self.kind.def_id };
        break;
      case "OpaqueTy":
        kind = { $: "Opaque", def_id: self.kind.def_id };
        break;
      case "FreeTy":
        kind = { $: "Free", def_id: self.kind.def_id };
        break;
      case "InherentConstSelf":
      case "InherentConstImpl":
      case "FreeConst":
      case "AnonConst":
      case "ProjectionConst": {
        const kind_ = self.kind;
        return panic(`Cannot turn \`${AliasTermKind.descr(kind_)}\` into \`AliasTy\``);
      }
    }
    return { kind, args: self.args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:189 expect_ct
  expect_ct(self: AliasTermT): AliasConstT {
    let kind: AliasConstKind;
    switch (self.kind.$) {
      case "InherentConstSelf": {
        kind = { $: "InherentSelf", def_id: self.kind.def_id };
        break;
      }
      case "InherentConstImpl": {
        kind = { $: "InherentImpl", def_id: self.kind.def_id };
        break;
      }
      case "FreeConst":
        kind = { $: "Free", def_id: self.kind.def_id };
        break;
      case "AnonConst":
        kind = { $: "Anon", def_id: self.kind.def_id };
        break;
      case "ProjectionConst":
        kind = { $: "Projection", def_id: self.kind.def_id };
        break;
      case "ProjectionTy":
      case "InherentTy":
      case "OpaqueTy":
      case "FreeTy": {
        const kind_ = self.kind;
        return panic(`Cannot turn \`${AliasTermKind.descr(kind_)}\` into \`AliasConst\``);
      }
    }
    return { kind, args: self.args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:210 to_term
  to_term(self: AliasTermT, interner: TyCtxt, is_rigid: IsRigid): Term {
    const alias_ty = (kind: AliasTyKind): Term => {
      return Term.from_Ty(Ty.new_alias(interner, is_rigid, AliasTy.new_from_args(interner, kind, self.args)));
    };
    const alias_const = (kind: AliasConstKind): Term => {
      return Term.from_Const(Const.new_alias(interner, is_rigid, AliasConst.new(interner, kind, self.args)));
    };
    switch (self.kind.$) {
      case "FreeConst":
        return alias_const({ $: "Free", def_id: self.kind.def_id });
      case "InherentConstSelf": {
        return alias_const({ $: "InherentSelf", def_id: self.kind.def_id });
      }
      case "InherentConstImpl": {
        return alias_const({ $: "InherentImpl", def_id: self.kind.def_id });
      }
      case "AnonConst":
        return alias_const({ $: "Anon", def_id: self.kind.def_id });
      case "ProjectionConst": {
        return alias_const({ $: "Projection", def_id: self.kind.def_id });
      }
      case "ProjectionTy":
        return alias_ty({ $: "Projection", def_id: self.kind.def_id });
      case "InherentTy":
        return alias_ty({ $: "Inherent", def_id: self.kind.def_id });
      case "OpaqueTy":
        return alias_ty({ $: "Opaque", def_id: self.kind.def_id });
      case "FreeTy":
        return alias_ty({ $: "Free", def_id: self.kind.def_id });
    }
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:238 with_args
  with_args(self: AliasTermT, interner: TyCtxt, args: GenericArgs): AliasTermT {
    return AliasTerm.new_from_args(interner, self.kind, args);
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:242 expect_projection_ty_def_id
  expect_projection_ty_def_id(self: AliasTermT): DefId {
    switch (self.kind.$) {
      case "ProjectionTy":
        return self.kind.def_id;
      default: {
        const kind = self.kind;
        return panic(`expected projection ty, found ${debug_AliasTermKind(kind, PLAIN)}`);
      }
    }
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:249 expect_opaque_ty_def_id
  expect_opaque_ty_def_id(self: AliasTermT): DefId {
    switch (self.kind.$) {
      case "OpaqueTy":
        return self.kind.def_id;
      default: {
        const kind = self.kind;
        return panic(`expected opaque ty, found ${debug_AliasTermKind(kind, PLAIN)}`);
      }
    }
  },

  // ---- FIXME: Replace by an impl on Alias<ProjectionAliasTermKind> ----

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:260 debug_assert_has_self
  debug_assert_has_self(_self: AliasTermT): void {
    // InherentConstImpl is deliberately omitted here, it is not self-format args
    // debug_assert_matches!(
    //     self.kind,
    //     AliasTermKind::ProjectionTy { .. }
    //         | AliasTermKind::ProjectionConst { .. }
    //         | AliasTermKind::InherentTy { .. }
    //         | AliasTermKind::InherentConstSelf { .. },
    //     "AliasTerm::self_ty is only valid on projection and inherent aliases"
    // );
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:272 self_ty
  self_ty(self: AliasTermT): Ty {
    AliasTerm.debug_assert_has_self(self);
    return self.args.type_at(0);
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:277 with_replaced_self_ty
  with_replaced_self_ty(self: AliasTermT, interner: TyCtxt, self_ty: Ty): AliasTermT {
    AliasTerm.debug_assert_has_self(self);
    return AliasTerm.new(interner, self.kind, [GenericArg.from_Ty(self_ty), ...self.args.slice(1)]);
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:286 expect_projection_def_id
  expect_projection_def_id(self: AliasTermT): DefId {
    switch (self.kind.$) {
      case "ProjectionTy":
        return self.kind.def_id;
      case "ProjectionConst":
        return self.kind.def_id;
      default: {
        const kind = self.kind;
        return panic(`expected projection alias, found ${debug_AliasTermKind(kind, PLAIN)}`);
      }
    }
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:294 trait_def_id
  trait_def_id(self: AliasTermT, interner: Interner): DefId {
    return interner.projection_parent(AliasTerm.expect_projection_def_id(self));
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:302 trait_ref_and_own_args
  trait_ref_and_own_args(self: AliasTermT, interner: Interner): [TraitRef, readonly GenericArg[]] {
    return interner.trait_ref_and_own_args_for_alias(AliasTerm.expect_projection_def_id(self), self.args);
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:313 trait_ref
  trait_ref(self: AliasTermT, interner: Interner): TraitRef {
    return AliasTerm.trait_ref_and_own_args(self, interner)[0];
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:320 own_args
  own_args(self: AliasTermT, interner: Interner): readonly GenericArg[] {
    return AliasTerm.trait_ref_and_own_args(self, interner)[1];
  },

  // ---- FIXME: Replace by an impl on Alias<InherentAliasTermKind> ----

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:328 expect_inherent_def_id
  expect_inherent_def_id(self: AliasTermT): DefId {
    switch (self.kind.$) {
      case "InherentTy":
        return self.kind.def_id;
      case "InherentConstSelf":
        return self.kind.def_id;
      case "InherentConstImpl":
        return self.kind.def_id;
      default: {
        const kind = self.kind;
        return panic(`expected inherent alias, found ${debug_AliasTermKind(kind, PLAIN)}`);
      }
    }
  },

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:347 rebase_inherent_args_onto_impl
  rebase_inherent_args_onto_impl(self: AliasTermT, impl_args: GenericArgs, interner: TyCtxt): GenericArgs {
    // debug_assert!(matches!(
    //     self.kind,
    //     AliasTermKind::InherentTy { .. } | AliasTermKind::InherentConstSelf { .. }
    // ));
    return interner.mk_args_from_iter([...impl_args, ...self.args.slice(1)]);
  },

  // ---- FIXME: Replace by an impl on Alias<FreeAliasTermKind> ----

  // rustc: compiler/rustc_type_ir/src/term_kind.rs:363 expect_free_def_id
  expect_free_def_id(self: AliasTermT): DefId {
    switch (self.kind.$) {
      case "FreeTy":
        return self.kind.def_id;
      case "FreeConst":
        return self.kind.def_id;
      default: {
        const kind = self.kind;
        return panic(`expected free alias, found ${debug_AliasTermKind(kind, PLAIN)}`);
      }
    }
  },

  // PORT: `impl From<ty::AliasTy<I>> for AliasTerm<I>`.
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:373 from
  from_AliasTy(ty: AliasTyT): AliasTermT {
    return { args: ty.args, kind: AliasTermKind.from_AliasTyKind(ty.kind), _use_alias_new_instead: null };
  },

  // PORT: `impl From<ty::AliasConst<I>> for AliasTerm<I>`.
  // rustc: compiler/rustc_type_ir/src/term_kind.rs:379 from
  from_AliasConst(ty: AliasConstT): AliasTermT {
    return { args: ty.args, kind: AliasTermKind.from_AliasConstKind(ty.kind), _use_alias_new_instead: null };
  },
};

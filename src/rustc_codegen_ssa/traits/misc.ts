// Port of compiler/rustc_codegen_ssa/src/traits/misc.rs (lane ssa-contract). Conventions: backend.ts's header.
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import type { KeyedMap } from "../../rust_ts/keyed.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";

/** PORT (ssa-contract): `rustc_session::PointerAuthSchema` (session.rs:118) is not ported: `PointerAuthConfig` exists
 *  only for `CfgAbi::Pauthtest` targets, whose session construction stops, so an `Option<&PointerAuthSchema>` is
 *  always `None`. Placed here for the traits' signatures; rustc_session owns the real type (handoff). */
export type PointerAuthSchema = never;

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/misc.rs:10 MiscCodegenMethods
export interface MiscCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  /** `&RefCell<FxHashMap<(Ty<'tcx>, Option<ty::ExistentialTraitRef<'tcx>>), Self::Value>>` (a composite key, so a
   *  `KeyedMap`, PORTING §5). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:11 vtables
  vtables(): KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], B["Value"]>;
  // (provided) traits/misc.rs:14 apply_vcall_visibility_metadata -> MiscCodegenMethods_provided.apply_vcall_visibility_metadata
  apply_vcall_visibility_metadata(ty: Ty, poly_trait_ref: ExistentialTraitRef | undefined, vtable: B["Value"]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:21 get_fn
  get_fn(instance: Instance): B["Function"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:22 get_fn_addr
  get_fn_addr(instance: Instance, pointer_auth_schema: PointerAuthSchema | undefined): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:27 eh_personality
  eh_personality(): B["Function"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:28 sess
  sess(): Session;
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:29 set_frame_pointer_type
  set_frame_pointer_type(llfn: B["Function"]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:30 apply_target_cpu_attr
  apply_target_cpu_attr(llfn: B["Function"]): void;
  /// Declares the extern "C" main function for the entry point. Returns None if the symbol
  /// already exists.
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:33 declare_c_main
  declare_c_main(fn_type: B["FunctionSignature"]): B["Function"] | undefined;

  /// Whether `codegen_intrinsic_call` expects to always have a `place_value`
  /// when emitting code for the intrinsic `name`.
  ///
  /// This is discouraged, but here for now to simplify migration to using OperandValues
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:39 intrinsic_call_expects_place_always
  intrinsic_call_expects_place_always(name: Symbol): boolean;
}

/** The provided methods of `MiscCodegenMethods` (PORTING §8; `self` first). */
export const MiscCodegenMethods_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/misc.rs:14 apply_vcall_visibility_metadata
  apply_vcall_visibility_metadata<B extends BackendTypes>(
    _self: MiscCodegenMethods<B>,
    _ty: Ty,
    _poly_trait_ref: ExistentialTraitRef | undefined,
    _vtable: B["Value"],
  ): void {},
};

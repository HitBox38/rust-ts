// compiler/rustc_codegen_ssa/src/mir/place.rs: NOT PORTED YET (lane ssa-operand-place, plan-m7 wave 41).
//
// PORT (ssa-contract): the type surface the traits (traits/*.ts) need, placed in the file lane ssa-operand-place will
// port: `PlaceValue` and `PlaceRef` with their fields (constructors take all fields in declaration order, PORTING §5),
// and typed stubs for the methods the traits' provided methods call. Stubs carry no marker; the fill lane replaces each
// with the port (and its marker) in upstream order.
import type { Align } from "../../rustc_abi/lib.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { unported } from "../../std/panic.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";

/// The location and extra runtime properties of the place.
///
/// Typically found in a [`PlaceRef`] or an [`OperandValue::Ref`].
///
/// As a location in memory, this has no specific type. If you want to
/// load or store it using a typed operation, use [`Self::with_type`].
// #[derive(Copy, Clone, Debug)]
export class PlaceValue<V> {
  constructor(
    /// A pointer to the contents of the place.
    public llval: V,

    /// This place's extra data if it is unsized, or `None` if null.
    public llextra: V | undefined,

    /// The alignment we know for this place.
    public align: Align,
  ) {}

  /** Stub (ssa-contract): `PlaceValue::with_type` (mir/place.rs:60), called by `BuilderMethods`'s provided
   *  `typed_place_copy_with_flags` and `typed_place_swap`. */
  with_type(_layout: TyAndLayout): PlaceRef<V> {
    return unported("ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/place.rs with_type");
  }
}

// #[derive(Copy, Clone, Debug)]
export class PlaceRef<V> {
  constructor(
    /// The location and extra runtime properties of the place.
    public val: PlaceValue<V>,

    /// The monomorphized type of this place, including variant information.
    ///
    /// You probably shouldn't use the alignment from this layout;
    /// rather you should use the `.val.align` of the actual place,
    /// which might be different from the type's normal alignment.
    public layout: TyAndLayout,
  ) {}

  /** Stub (ssa-contract): `PlaceRef::alloca` (mir/place.rs:111), called by `BuilderMethods`'s provided
   *  `typed_place_swap`. */
  static alloca<B extends BackendTypes>(_bx: BuilderMethods<B>, _layout: TyAndLayout): PlaceRef<B["Value"]> {
    return unported("ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/place.rs alloca");
  }
}

// Port of compiler/rustc_type_ir/src/lift.rs (lane tyir-misc, sub-lane lib-sty).
//
// PORT: rustc's `Lift` (moving a value between `TyCtxt` lifetimes) has no runtime meaning in the port, which has one
// interner per compilation and no lifetimes; its impls are skipped (PORTING §3, D4).

/// A trait implemented for all `X<'a>` types that can be safely and
/// efficiently converted to `X<'tcx>` as long as they are part of the
/// provided `TyCtxt<'tcx>`.
/// This can be done, for example, for `Ty<'tcx>` or `GenericArgsRef<'tcx>`
/// by looking them up in their respective interners.
///
/// However, this is still not the best implementation as it does
/// need to compare the components, even for interned values.
/// It would be more efficient if `TypedArena` provided a way to
/// determine whether the address is in the allocated range.
///
/// Panics if the value or one of the components is not part
/// of the provided context.
/// For `Ty`, this can happen if either the type interner doesn't
/// contain the `TyKind` key or if the address of the interned
/// pointer differs. The latter case is possible if a primitive type,
/// e.g., `()` or `u8`, was interned in a different context.
// rustc-skip: compiler/rustc_type_ir/src/lift.rs:20 lift_to_interner Lift (PORTING §3, D4)

// `impl<I> Lift<I> for ()`
// rustc-skip: compiler/rustc_type_ir/src/lift.rs:26 lift_to_interner Lift (PORTING §3, D4)

export {};

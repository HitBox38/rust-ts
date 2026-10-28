// Port of compiler/rustc_mir_transform/src/gvn.rs (lane mt-opt2-a).
//
// PORT: `ValueSet` deduplicates `(Value, Ty)` pairs in a `Map` keyed by their intern key (rust_ts/intern_key.ts: the
// derived `Hash` + `PartialEq`, interned children by identity), instead of an `FxHasher`-hashed `HashTable`: the
// `VnIndex` numbering only depends on insertion order, never on hash values, and `hashes` (only read by the table's
// rehashing) is kept as upstream fills it, with 0 for every entry (no hash is computed). Values built by
// `insert_unique` (opaque values, addresses, non-deterministic constants) are never keyed, as upstream (`VnOpaque`
// cannot be hashed or compared).
// PORT: `DroplessArena` allocations (`alloc_slice`, `alloc_from_iter`, `try_alloc_from_iter`, `alloc`) are plain
// arrays / the value itself. `&'a OpTy` is the `OpTy` object, which is never mutated once evaluated.
// PORT: `evaluated: IndexVec<VnIndex, Option<Option<&OpTy>>>` holds `{ $: "Some", _0: OpTy | undefined } | undefined`
// (PORTING §5, `Option<Option<T>>`).
// PORT: `body.basic_blocks.dominators().clone()`: the cached `Dominators` object is shared, not cloned. Upstream
// clones only to satisfy the borrow checker; GVN edits the body through `as_mut_preserves_cfg`, which keeps the CFG
// cache, and the dominators are never mutated.
// PORT: `&mut Place` / `&mut Operand` / `&mut Rvalue` are the MIR objects, edited in place (rustc_middle mir/visit.ts
// header): `*place = new_place` writes `local` and `projection`, `*operand = ..` / `*rvalue = ..` are
// `replace_in_place`, `*initial_kind = kind` writes the `Cast` rvalue's field through a `MutRef`. `Place`, `Const`
// and `ConstOperand` are `Copy`: every one written into the MIR is a fresh object (`clone_Place` / `clone_Const`),
// so no MIR node is shared (PORTING §8).
// PORT: the `Either<u128, VnIndex>` of `simplify_binary_inner` is `rustc_middle::mir::Either<bigint, VnIndex>`; its
// derived `PartialEq` compares the side and the payload.
// PORT: `ProjectionElem::ConstantIndex::offset` is a `number` (rustc_middle syntax.gen.ts): an index constant above
// 2^53 stops as `unported` rather than losing precision.
//! Global value numbering.
//!
//! MIR may contain repeated and/or redundant computations. The objective of this pass is to detect
//! such redundancies and re-use the already-computed result when possible.
//!
//! From those assignments, we construct a mapping `VnIndex -> Vec<(Local, Location)>` of available
//! values, the locals in which they are stored, and the assignment location.
//!
//! We traverse all assignments `x = rvalue` and operands.
//!
//! For each SSA one, we compute a symbolic representation of values that are assigned to SSA
//! locals. This symbolic representation is defined by the `Value` enum. Each produced instance of
//! `Value` is interned as a `VnIndex`, which allows us to cheaply compute identical values.
//!
//! For each non-SSA
//! one, we compute the `VnIndex` of the rvalue. If this `VnIndex` is associated to a constant, we
//! replace the rvalue/operand by that constant. Otherwise, if there is an SSA local `y`
//! associated to this `VnIndex`, and if its definition location strictly dominates the assignment
//! to `x`, we replace the assignment by `x = y`.
//!
//! By opportunity, this pass simplifies some `Rvalue`s based on the accumulated knowledge.
//!
//! # Operational semantic
//!
//! Operationally, this pass attempts to prove bitwise equality between locals. Given this MIR:
//! ```ignore (MIR)
//! _a = some value // has VnIndex i
//! // some MIR
//! _b = some other value // also has VnIndex i
//! ```
//!
//! We consider it to be replaceable by:
//! ```ignore (MIR)
//! _a = some value // has VnIndex i
//! // some MIR
//! _c = some other value // also has VnIndex i
//! assume(_a bitwise equal to _c) // follows from having the same VnIndex
//! _b = _a // follows from the `assume`
//! ```
//!
//! Which is simplifiable to:
//! ```ignore (MIR)
//! _a = some value // has VnIndex i
//! // some MIR
//! _b = _a
//! ```
//!
//! # Handling of references
//!
//! We handle references by assigning a different "provenance" index to each Ref/RawPtr rvalue.
//! This ensure that we do not spuriously merge borrows that should not be merged. For instance:
//! ```ignore (MIR)
//! _x = &_a;
//! _a = 0;
//! _y = &_a; // cannot be turned into `_y = _x`!
//! ```
//!
//! On top of that, we consider all the derefs of an immutable reference to a freeze type to give
//! the same value:
//! ```ignore (MIR)
//! _a = *_b // _b is &Freeze
//! _c = *_b // replaced by _c = _a
//! ```
//!
//! # Determinism of constant propagation
//!
//! When registering a new `Value`, we attempt to opportunistically evaluate it as a constant.
//! The evaluated form is inserted in `evaluated` as an `OpTy` or `None` if evaluation failed.
//!
//! The difficulty is non-deterministic evaluation of MIR constants. Some `Const` can have
//! different runtime values each time they are evaluated. This happens with valtrees that
//! generate a new allocation each time they are used. This is checked by `is_deterministic`.
//!
//! Meanwhile, we want to be able to read indirect constants. For instance:
//! ```
//! static A: &'static &'static u8 = &&63;
//! fn foo() -> u8 {
//!     **A // We want to replace by 63.
//! }
//! fn bar() -> u8 {
//!     b"abc"[1] // We want to replace by 'b'.
//! }
//! ```
//!
//! The `Value::Constant` variant stores a possibly unevaluated constant. Evaluating that constant
//! may be non-deterministic. When that happens, we assign a disambiguator to ensure that we do not
//! merge the constants. See `duplicate_slice` test in `gvn.rs`.
//!
//! Conversely, some constants cannot cross function boundaries, which could happen because of
//! inlining. For instance, constants that contain a fn pointer (`AllocId` pointing to a
//! `GlobalAlloc::Function`) point to a different symbol in each codegen unit. To avoid this,
//! when writing constants in MIR, we do not write `Const`s that contain `AllocId`s. This is
//! checked by `may_have_provenance`. See <https://github.com/rust-lang/rust/issues/128775> for
//! more information.
import { FIRST_VARIANT, FieldIdx, type VariantIdx } from "../rustc_abi/layout.ts";
import { type BackendRepr, Primitive, Scalar as abi_Scalar, Size } from "../rustc_abi/lib.ts";
import { const_eval, interpret } from "../rustc_const_eval/lib.ts";
import type { DummyMachine } from "../rustc_const_eval/const_eval/dummy_machine.ts";
import type { InterpCx, OpTy } from "../rustc_const_eval/interpret/mod.ts";
import { OpTy_from_ImmTy, OpTy_from_MPlaceTy } from "../rustc_const_eval/interpret/operand.ts";
import { clone_MPlaceTy } from "../rustc_const_eval/interpret/place.gen.ts";
import type { Dominators } from "../rustc_data_structures/graph/dominators/mod.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { AllocRange_from_Range_Size } from "../rustc_middle/mir/interpret/allocation.ts";
import { CtfeProvenance, GlobalAlloc, InterpResult, Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import { clone_Const, Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import {
  type BasicBlock,
  BinOp,
  type Body,
  type BorrowKind,
  BorrowKind as BorrowKindC,
  type CastKind,
  debug_Rvalue,
  clone_Place,
  ConstOperand,
  type ConstValue,
  type Either,
  type Local,
  type LocalDecls,
  type Location,
  type Mutability,
  Operand,
  Place,
  type PlaceElem,
  PlaceRef,
  PlaceTy,
  ProjectionElem,
  type RawPtrKind,
  RawPtrKind as RawPtrKindC,
  Rvalue,
  type RuntimeChecks,
  type Statement,
  type Terminator,
  traversal,
  UnOp,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Const as ty_Const } from "../rustc_type_ir/sty/consts.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty, visit_AdtDef } from "../rustc_middle/ty/structural_impls.ts";
import type { ResultsCursor } from "../rustc_mir_dataflow/framework/cursor.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef, replace_in_place } from "../std/mut_ref.ts";
import { assert, assert_eq, unported, unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MaybeUninitializedLocals, type SsaLocals, SsaLocals as SsaLocalsC } from "./ssa.ts";

// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:128 GVN
export class GVN extends MirPass {
  readonly type_name = "rustc_mir_transform::gvn::GVN";

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:131 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // #[instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:136 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!(def_id = ?body.source.def_id());

    const typing_env = body.typing_env(tcx);
    const ssa = SsaLocalsC.new(tcx, body, typing_env);
    // Clone dominators because we need them while mutating the body.
    const dominators = body.basic_blocks.dominators();

    const state = VnState.new(tcx, body, typing_env, ssa, dominators, body.local_decls);

    for (const local of body.args_iter()) {
      if (!ssa.is_ssa(local)) continue;
      const opaque = state.new_argument(body.local_decls[local]!.ty);
      state.assign(local, opaque);
    }

    const reverse_postorder = body.basic_blocks.reverse_postorder().slice();
    for (const bb of reverse_postorder) {
      const data = body.basic_blocks.as_mut_preserves_cfg()[bb]!;
      state.visit_basic_block_data(bb, data);
    }

    // When emitting storage statements, we want to retain the reused locals' storage statements,
    // as this enables better optimizations. For each local use location, we mark it for storage removal
    // only if it might be uninitialized at that point.
    let storage_to_remove_: DenseBitSet<Local> | undefined;
    if (tcx.sess.emit_lifetime_markers()) {
      const maybe_uninit = new MaybeUninitializedLocals().iterate_to_fixpoint(tcx, body, "mir_opt::gvn").into_results_cursor(body);

      const storage_checker = new StorageChecker(state.reused_locals, DenseBitSet.new_empty<Local>(body.local_decls.length), maybe_uninit);

      for (const [bb, data] of traversal.reachable(body)) {
        storage_checker.visit_basic_block_data(bb, data);
      }

      storage_to_remove_ = storage_checker.storage_to_remove;
    } else {
      storage_to_remove_ = undefined;
    }

    // If None, remove the storage statements of all the reused locals.
    const storage_to_remove = storage_to_remove_ ?? state.reused_locals;
    // debug!(?storage_to_remove);

    new StorageRemover(tcx, state.reused_locals, storage_to_remove).visit_body_preserves_cfg(body);
  }
}

// newtype_index! {
/// This represents a `Value` in the symbolic execution.
// #[debug_format = "_v{}"]
// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:194 VnIndex
type VnIndex = number & { readonly __brand: "VnIndex" };
// }
const debug_VnIndex: Debug<VnIndex> = (v) => `_v${v}`;

/// Marker type to forbid hashing and comparing opaque values.
/// This struct should only be constructed by `ValueSet::insert_unique` to ensure we use that
/// method to create non-unifiable values. It will ICE if used in `ValueSet::insert`.
// #[derive(Copy, Clone, Debug, Eq)]
// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:201 VnOpaque
// PORT: a zero-sized marker: one frozen instance. Its `PartialEq` / `Hash` impls (which ICE) are never reached: no
// value holding it is keyed (see the header).
type VnOpaque = typeof VnOpaque;
const VnOpaque = Object.freeze({ VnOpaque: true as const });
// rustc-skip: compiler/rustc_mir_transform/src/gvn.rs:203 eq unreachable!() impl, never reached (no opaque value is keyed)
// rustc-skip: compiler/rustc_mir_transform/src/gvn.rs:209 hash unreachable!() impl, never reached (no opaque value is keyed)

// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:216 AddressKind
type AddressKind = { readonly $: "Ref"; _0: BorrowKind } | { readonly $: "Address"; _0: RawPtrKind };

// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:222 AddressBase
type AddressBase =
  /// This address is based on this local.
  | { readonly $: "Local"; _0: Local }
  /// This address is based on the deref of this pointer.
  | { readonly $: "Deref"; _0: VnIndex };

// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:230 Value
type Value =
  // Root values.
  /// Used to represent values we know nothing about.
  | { readonly $: "Opaque"; _0: VnOpaque }
  /// The value is a argument.
  | { readonly $: "Argument"; _0: VnOpaque }
  /// Evaluated or unevaluated constant value.
  | {
      readonly $: "Constant";
      value: mir_Const;
      /// Some constants do not have a deterministic value. To avoid merging two instances of the
      /// same `Const`, we assign them an additional integer index.
      // `disambiguator` is `None` iff the constant is deterministic.
      disambiguator: VnOpaque | undefined;
    }

  // Aggregates.
  /// An aggregate value, either tuple/closure/struct/enum.
  /// This does not contain unions, as we cannot reason with the value.
  | { readonly $: "Aggregate"; _0: VariantIdx; _1: readonly VnIndex[] }
  /// A union aggregate value.
  | { readonly $: "Union"; _0: FieldIdx; _1: VnIndex }
  /// A raw pointer aggregate built from a thin pointer and metadata.
  | {
      readonly $: "RawPtr";
      /// Thin pointer component. This is field 0 in MIR.
      pointer: VnIndex;
      /// Metadata component. This is field 1 in MIR.
      metadata: VnIndex;
    }
  /// This corresponds to a `[value; count]` expression.
  | { readonly $: "Repeat"; _0: VnIndex; _1: ty_Const }
  /// The address of a place.
  | {
      readonly $: "Address";
      base: AddressBase;
      // We do not use a plain `Place` as we want to be able to reason about indices.
      // This does not contain any `Deref` projection.
      projection: readonly ProjectionElem<VnIndex, Ty>[];
      kind: AddressKind;
      /// Give each borrow and pointer a different provenance, so we don't merge them.
      provenance: VnOpaque;
    }

  // Extractions.
  /// This is the *value* obtained by projecting another value.
  | { readonly $: "Projection"; _0: VnIndex; _1: ProjectionElem<VnIndex, null> }
  /// Discriminant of the given value.
  | { readonly $: "Discriminant"; _0: VnIndex }

  // Operations.
  | { readonly $: "RuntimeChecks"; _0: RuntimeChecks }
  | { readonly $: "UnaryOp"; _0: UnOp; _1: VnIndex }
  | { readonly $: "BinaryOp"; _0: BinOp; _1: VnIndex; _2: VnIndex }
  | {
      readonly $: "Cast";
      kind: CastKind;
      value: VnIndex;
    };

/// Stores and deduplicates pairs of `(Value, Ty)` into in `VnIndex` numbered values.
///
/// This data structure is mostly a partial reimplementation of `FxIndexMap<VnIndex, (Value, Ty)>`.
/// We do not use a regular `FxIndexMap` to skip hashing values that are unique by construction,
/// like opaque values, address with provenance and non-deterministic constants.
// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:292 ValueSet
class ValueSet {
  constructor(
    /** PORT: the `HashTable<VnIndex>`, keyed by the intern key of `(value, ty)` (header). */
    public indices: Map<string, VnIndex>,
    public hashes: number[],
    public values: Value[],
    public types: Ty[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:300 new
  static new(_num_values: number): ValueSet {
    // `with_capacity(num_values)`: capacity only.
    return new ValueSet(new Map(), [], [], []);
  }

  /// Insert a `(Value, Ty)` pair without hashing or deduplication.
  /// This always creates a new `VnIndex`.
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:312 insert_unique
  insert_unique(ty: Ty, value_: (opaque: VnOpaque) => Value): VnIndex {
    const value = value_(VnOpaque);

    // debug_assert!(match value {
    //     Value::Opaque(_) | Value::Argument(_) | Value::Address { .. } => true,
    //     Value::Constant { disambiguator, .. } => disambiguator.is_some(),
    //     _ => false,
    // });

    const index = this.hashes.push(0) - 1;
    this.types.push(ty);
    // debug_assert_eq!(index, _index);
    this.values.push(value);
    // debug_assert_eq!(index, _index);
    return index as VnIndex;
  }

  /// Insert a `(Value, Ty)` pair to be deduplicated.
  /// Returns `true` as second tuple field if this value did not exist previously.
  // #[allow(rustc::disallowed_pass_by_ref)] // closures take `&VnIndex`
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:336 insert
  insert(ty: Ty, value: Value): [VnIndex, boolean] {
    // debug_assert!(match value {
    //     Value::Opaque(_) | Value::Address { .. } => false,
    //     Value::Constant { disambiguator, .. } => disambiguator.is_none(),
    //     _ => true,
    // });

    // PORT: the hash + `eq` lookup is the intern key of `(value, ty)` (header).
    const key = intern_key([value, ty]);
    const existing = this.indices.get(key);
    if (existing !== undefined) {
      const index = existing;
      return [index, false];
    } else {
      const index = (this.hashes.push(0) - 1) as VnIndex;
      this.indices.set(key, index);
      this.values.push(value);
      // debug_assert_eq!(index, _index);
      this.types.push(ty);
      // debug_assert_eq!(index, _index);
      return [index, true];
    }
  }

  /// Return the `Value` associated with the given `VnIndex`.
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:371 value
  value(index: VnIndex): Value {
    return this.values[index]!;
  }

  /// Return the type associated with the given `VnIndex`.
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:377 ty
  ty(index: VnIndex): Ty {
    return this.types[index]!;
  }
}

/** PORT: `Option<Option<&OpTy>>` (header). */
type Evaluated = { readonly $: "Some"; _0: OpTy | undefined } | undefined;

// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:382 VnState
class VnState extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public ecx: InterpCx<DummyMachine>,
    public local_decls: LocalDecls,
    public is_coroutine: boolean,
    /// Value stored in each local.
    public locals: (VnIndex | undefined)[],
    /// Locals that are assigned that value.
    // This vector does not hold all the values of `VnIndex` that we create.
    public rev_locals: Local[][],
    public values: ValueSet,
    /// Values evaluated as constants if possible.
    /// - `None` are values not computed yet;
    /// - `Some(None)` are values for which computation has failed;
    /// - `Some(Some(op))` are successful computations.
    public evaluated: Evaluated[],
    public ssa: SsaLocals,
    public dominators: Dominators<BasicBlock>,
    public reused_locals: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:405 new
  static new(
    tcx: TyCtxt,
    body: Body,
    typing_env: TypingEnv,
    ssa: SsaLocals,
    dominators: Dominators<BasicBlock>,
    local_decls: LocalDecls,
  ): VnState {
    // Compute a rough estimate of the number of values in the body from the number of
    // statements. This is meant to reduce the number of allocations, but it's all right if
    // we miss the exact amount. We estimate based on 2 values per statement (one in LHS and
    // one in RHS) and 4 values per terminator (for call operands).
    let stmts = 0;
    for (const bbdata of body.basic_blocks.deref()) stmts += bbdata.statements.length;
    const num_values = 2 * stmts + 4 * body.basic_blocks.deref().length;
    return new VnState(
      tcx,
      interpret.InterpCx.new(tcx, DUMMY_SP, typing_env, new const_eval.DummyMachine()),
      local_decls,
      body.coroutine !== undefined,
      new Array<VnIndex | undefined>(local_decls.length).fill(undefined),
      [],
      ValueSet.new(num_values),
      [],
      ssa,
      dominators,
      DenseBitSet.new_empty<Local>(local_decls.length),
    );
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:437 typing_env
  typing_env(): TypingEnv {
    return this.ecx.typing_env_();
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:441 insert_unique
  insert_unique(ty: Ty, value: (opaque: VnOpaque) => Value): VnIndex {
    const index = this.values.insert_unique(ty, value);
    this.evaluated.push(undefined);
    // debug_assert_eq!(index, _index);
    this.rev_locals.push([]);
    // debug_assert_eq!(index, _index);
    return index;
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:455 insert
  insert(ty: Ty, value: Value): VnIndex {
    const [index, new_] = this.values.insert(ty, value);
    if (new_) {
      // Grow `evaluated` and `rev_locals` here to amortize the allocations.
      this.evaluated.push(undefined);
      // debug_assert_eq!(index, _index);
      this.rev_locals.push([]);
      // debug_assert_eq!(index, _index);
    }
    return index;
  }

  /// Create a new `Value` for which we have no information at all, except that it is distinct
  /// from all the others.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:470 new_opaque
  new_opaque(ty: Ty): VnIndex {
    const index = this.insert_unique(ty, (o) => ({ $: "Opaque", _0: o }));
    this.evaluated[index] = { $: "Some", _0: undefined };
    return index;
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:477 new_argument
  new_argument(ty: Ty): VnIndex {
    const index = this.insert_unique(ty, (o) => ({ $: "Argument", _0: o }));
    this.evaluated[index] = { $: "Some", _0: undefined };
    return index;
  }

  /// Create a new `Value::Address` distinct from all the others.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:485 new_pointer
  new_pointer(place: Place, kind: AddressKind): VnIndex | undefined {
    const pty = place.ty(this.local_decls, this.tcx_).ty;
    let ty: Ty;
    switch (kind.$) {
      case "Ref":
        ty = Ty.new_ref(this.tcx_, this.tcx_.lifetimes.re_erased, pty, BorrowKindC.to_mutbl_lossy(kind._0));
        break;
      case "Address":
        ty = Ty.new_ptr(this.tcx_, pty, RawPtrKindC.to_mutbl_lossy(kind._0));
        break;
    }

    let projection_start = 0;
    let base: AddressBase;
    if (place.is_indirect_first_projection()) {
      const base_ = this.locals[place.local];
      if (base_ === undefined) return undefined;
      // Skip the initial `Deref`.
      projection_start = 1;
      base = { $: "Deref", _0: base_ };
    } else if (this.ssa.is_ssa(place.local)) {
      // Only propagate the pointer of the SSA local.
      base = { $: "Local", _0: place.local };
    } else {
      return undefined;
    }
    // Do not try evaluating inside `Index`, this has been done by `simplify_place_projection`.
    const projection: ProjectionElem<VnIndex, Ty>[] = [];
    for (let i = projection_start; i < place.projection.length; i++) {
      const proj = place.projection[i]!;
      const p = ProjectionElem.try_map<Local, Ty, VnIndex, Ty>(
        proj,
        (index) => this.locals[index],
        (ty) => ty,
      );
      if (p === undefined) return undefined;
      projection.push(p);
    }

    const index = this.insert_unique(ty, (provenance) => ({
      $: "Address",
      base,
      projection,
      kind,
      provenance,
    }));
    return index;
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:521 insert_constant
  insert_constant(value: mir_Const): VnIndex {
    if (is_deterministic(value)) {
      // The constant is deterministic, no need to disambiguate.
      const constant: Value = { $: "Constant", value, disambiguator: undefined };
      return this.insert(mir_Const.ty(value), constant);
    } else {
      // Multiple mentions of this constant will yield different values,
      // so assign a different `disambiguator` to ensure they do not get the same `VnIndex`.
      return this.insert_unique(mir_Const.ty(value), (disambiguator) => ({
        $: "Constant",
        value,
        disambiguator,
      }));
    }
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:537 get
  get(index: VnIndex): Value {
    return this.values.value(index);
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:542 ty
  ty(index: VnIndex): Ty {
    return this.values.ty(index);
  }

  /// Record that `local` is assigned `value`. `local` must be SSA.
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:548 assign
  assign(local: Local, value: VnIndex): void {
    // debug_assert!(self.ssa.is_ssa(local));
    this.locals[local] = value;
    this.rev_locals[value]!.push(local);
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:554 insert_bool
  insert_bool(flag: boolean): VnIndex {
    // Booleans are deterministic.
    const value = mir_Const.from_bool(this.tcx_, flag);
    // debug_assert!(is_deterministic(value));
    return this.insert(this.tcx_.types.bool, { $: "Constant", value, disambiguator: undefined });
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:561 insert_scalar
  insert_scalar(ty: Ty, scalar: Scalar): VnIndex {
    // Scalars are deterministic.
    const value = mir_Const.from_scalar(this.tcx_, scalar, ty);
    // debug_assert!(is_deterministic(value));
    return this.insert(ty, { $: "Constant", value, disambiguator: undefined });
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:568 insert_tuple
  insert_tuple(ty: Ty, values: readonly VnIndex[]): VnIndex {
    return this.insert(ty, { $: "Aggregate", _0: 0 as VariantIdx, _1: values.slice() });
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:573 eval_to_const_inner
  eval_to_const_inner(value: VnIndex): OpTy | undefined {
    const ty_ = this.ty(value);
    // Avoid computing layouts inside a coroutine, as that can cause cycles.
    let ty;
    if (!this.is_coroutine || ty_.is_scalar()) {
      const l = this.ecx.layout_of(ty_);
      if (l.$ === "Err") return undefined;
      ty = l._0;
    } else {
      return undefined;
    }
    let op: OpTy;
    const v = this.get(value);
    if (ty.is_zst()) {
      op = OpTy_from_ImmTy(interpret.ImmTy.uninit(ty));
    } else {
      switch (v.$) {
        case "Opaque":
        case "Argument":
          return undefined;
        // Keep runtime check constants as symbolic.
        case "RuntimeChecks":
          return undefined;

        // In general, evaluating repeat expressions just consumes a lot of memory.
        // But in the special case that the element is just Immediate::Uninit, we can evaluate
        // it without extra memory! If we don't propagate uninit values like this, LLVM can get
        // very confused: https://github.com/rust-lang/rust/issues/139355
        case "Repeat": {
          const value = this.eval_to_const(v._0);
          if (value === undefined) return undefined;
          if (value.is_immediate_uninit()) {
            op = OpTy_from_ImmTy(interpret.ImmTy.uninit(ty));
          } else {
            return undefined;
          }
          break;
        }
        case "Constant": {
          const r = InterpResult.discard_err(this.ecx.eval_mir_constant(v.value, DUMMY_SP, undefined));
          if (r === undefined) return undefined;
          op = r;
          break;
        }
        case "Aggregate": {
          const fields: OpTy[] = [];
          for (const f of v._1) {
            const c = this.eval_to_const(f);
            if (c === undefined) return undefined;
            fields.push(c);
          }
          const variant = ty.ty.is_enum() ? v._0 : undefined;
          if (!(ty.backend_repr.$ === "Scalar" || ty.backend_repr.$ === "ScalarPair")) {
            return undefined;
          }
          const dest = InterpResult.discard_err(this.ecx.allocate(ty, { $: "Stack" }));
          if (dest === undefined) return undefined;
          let variant_dest;
          if (variant !== undefined) {
            variant_dest = InterpResult.discard_err(this.ecx.project_downcast(dest, variant));
            if (variant_dest === undefined) return undefined;
          } else {
            variant_dest = clone_MPlaceTy(dest);
          }
          for (let field_index = 0; field_index < fields.length; field_index++) {
            const op = fields[field_index]!;
            const field_dest = InterpResult.discard_err(this.ecx.project_field(variant_dest, FieldIdx.from_usize(field_index)));
            if (field_dest === undefined) return undefined;
            if (discard_err_unit(this.ecx.copy_op(op, field_dest)) === undefined) return undefined;
          }
          if (discard_err_unit(this.ecx.write_discriminant(variant ?? FIRST_VARIANT, dest)) === undefined) {
            return undefined;
          }
          if (discard_err_unit(this.ecx.alloc_mark_immutable(CtfeProvenance.alloc_id(unwrap(dest.ptr().provenance)))) === undefined) {
            return undefined;
          }
          op = OpTy_from_MPlaceTy(dest);
          break;
        }
        case "Union": {
          const active_field = v._0;
          const field = this.eval_to_const(v._1);
          if (field === undefined) return undefined;
          if (field.layout.deref().is_zst()) {
            op = OpTy_from_ImmTy(interpret.ImmTy.from_immediate(interpret.Immediate.Uninit, ty));
          } else if (ty.backend_repr.$ === "Scalar" || ty.backend_repr.$ === "ScalarPair") {
            const dest = InterpResult.discard_err(this.ecx.allocate(ty, { $: "Stack" }));
            if (dest === undefined) return undefined;
            const field_dest = InterpResult.discard_err(this.ecx.project_field(dest, active_field));
            if (field_dest === undefined) return undefined;
            if (discard_err_unit(this.ecx.copy_op(field, field_dest)) === undefined) return undefined;
            if (discard_err_unit(this.ecx.alloc_mark_immutable(CtfeProvenance.alloc_id(unwrap(dest.ptr().provenance)))) === undefined) {
              return undefined;
            }
            op = OpTy_from_MPlaceTy(dest);
          } else {
            return undefined;
          }
          break;
        }
        case "RawPtr": {
          const pointer = this.eval_to_const(v.pointer);
          if (pointer === undefined) return undefined;
          const metadata = this.eval_to_const(v.metadata);
          if (metadata === undefined) return undefined;

          // Pointers don't have fields, so don't `project_field` them.
          const data = InterpResult.discard_err(this.ecx.read_pointer(pointer));
          if (data === undefined) return undefined;
          let meta: interpret.MemPlaceMeta;
          if (metadata.layout.is_zst()) {
            meta = interpret.MemPlaceMeta.None;
          } else {
            const s = InterpResult.discard_err(this.ecx.read_scalar(metadata));
            if (s === undefined) return undefined;
            meta = { $: "Meta", _0: s };
          }
          const ptr_imm = interpret.Immediate.new_pointer_with_meta(data, meta, this.ecx);
          op = OpTy_from_ImmTy(interpret.ImmTy.from_immediate(ptr_imm, ty));
          break;
        }

        case "Projection": {
          const base = this.eval_to_const(v._0);
          if (base === undefined) return undefined;
          // `Index` by constants should have been replaced by `ConstantIndex` by
          // `simplify_place_projection`.
          const elem = ProjectionElem.try_map<VnIndex, null, Local, Ty>(
            v._1,
            (_) => undefined,
            (_) => ty.ty,
          );
          if (elem === undefined) return undefined;
          const r = InterpResult.discard_err(this.ecx.project(base, elem));
          if (r === undefined) return undefined;
          op = r;
          break;
        }
        case "Address": {
          const { base, projection } = v;
          // debug_assert!(!projection.contains(&ProjectionElem::Deref));
          let pointer: OpTy;
          switch (base.$) {
            case "Deref": {
              const p = this.eval_to_const(base._0);
              if (p === undefined) return undefined;
              pointer = p;
              break;
            }
            // We have no stack to point to.
            case "Local":
              return undefined;
          }
          let mplace = InterpResult.discard_err(this.ecx.deref_pointer(pointer));
          if (mplace === undefined) return undefined;
          for (const elem_ of projection) {
            // `Index` by constants should have been replaced by `ConstantIndex` by
            // `simplify_place_projection`.
            const elem = ProjectionElem.try_map<VnIndex, Ty, Local, Ty>(
              elem_,
              (_) => undefined,
              (ty) => ty,
            );
            if (elem === undefined) return undefined;
            mplace = InterpResult.discard_err(this.ecx.project(mplace, elem));
            if (mplace === undefined) return undefined;
          }
          const pointer_ = mplace.to_ref(this.ecx);
          op = OpTy_from_ImmTy(interpret.ImmTy.from_immediate(pointer_, ty));
          break;
        }

        case "Discriminant": {
          const base = this.eval_to_const(v._0);
          if (base === undefined) return undefined;
          const variant = InterpResult.discard_err(this.ecx.read_discriminant(base));
          if (variant === undefined) return undefined;
          const discr_value = InterpResult.discard_err(this.ecx.discriminant_for_variant(base.layout.ty, variant));
          if (discr_value === undefined) return undefined;
          op = OpTy_from_ImmTy(discr_value);
          break;
        }
        case "UnaryOp": {
          const operand_ = this.eval_to_const(v._1);
          if (operand_ === undefined) return undefined;
          const operand = InterpResult.discard_err(this.ecx.read_immediate(operand_));
          if (operand === undefined) return undefined;
          const val = InterpResult.discard_err(this.ecx.unary_op(v._0, operand));
          if (val === undefined) return undefined;
          op = OpTy_from_ImmTy(val);
          break;
        }
        case "BinaryOp": {
          const lhs_ = this.eval_to_const(v._1);
          if (lhs_ === undefined) return undefined;
          const rhs_ = this.eval_to_const(v._2);
          if (rhs_ === undefined) return undefined;
          const lhs = InterpResult.discard_err(this.ecx.read_immediate(lhs_));
          if (lhs === undefined) return undefined;
          const rhs = InterpResult.discard_err(this.ecx.read_immediate(rhs_));
          if (rhs === undefined) return undefined;
          const val = InterpResult.discard_err(this.ecx.binary_op(v._0, lhs, rhs));
          if (val === undefined) return undefined;
          op = OpTy_from_ImmTy(val);
          break;
        }
        case "Cast": {
          const { kind, value: value_ } = v;
          switch (kind.$) {
            case "IntToInt":
            case "IntToFloat": {
              const value1 = this.eval_to_const(value_);
              if (value1 === undefined) return undefined;
              const value = InterpResult.discard_err(this.ecx.read_immediate(value1));
              if (value === undefined) return undefined;
              const res = InterpResult.discard_err(this.ecx.int_to_int_or_float(value, ty));
              if (res === undefined) return undefined;
              op = OpTy_from_ImmTy(res);
              break;
            }
            case "FloatToFloat":
            case "FloatToInt": {
              const value1 = this.eval_to_const(value_);
              if (value1 === undefined) return undefined;
              const value = InterpResult.discard_err(this.ecx.read_immediate(value1));
              if (value === undefined) return undefined;
              const res = InterpResult.discard_err(this.ecx.float_to_float_or_int(value, ty));
              if (res === undefined) return undefined;
              op = OpTy_from_ImmTy(res);
              break;
            }
            case "Transmute":
            case "Subtype": {
              const value = this.eval_to_const(value_);
              if (value === undefined) return undefined;
              if (value.is_immediate_uninit()) {
                return OpTy_from_ImmTy(interpret.ImmTy.uninit(ty));
              }
              // `offset` for immediates generally only supports projections that match the
              // type of the immediate. However, as a HACK, we exploit that it can also do
              // limited transmutes: it only works between types with the same layout, and
              // cannot transmute pointers to integers.
              if (value.as_mplace_or_imm().$ === "Right") {
                const s = value.layout.backend_repr;
                const t = ty.backend_repr;
                let can_transmute: boolean;
                if (s.$ === "Scalar" && t.$ === "Scalar") {
                  const [s1, s2] = [s._0, t._0];
                  can_transmute =
                    abi_Scalar.size(s1, this.ecx).bytes() === abi_Scalar.size(s2, this.ecx).bytes() &&
                    abi_Scalar.primitive(s1).$ !== "Pointer";
                } else if (s.$ === "ScalarPair" && t.$ === "ScalarPair") {
                  const { a: a1, b: b1, b_offset: b1_offset } = s;
                  const { a: a2, b: b2, b_offset: b2_offset } = t;
                  can_transmute =
                    abi_Scalar.size(a1, this.ecx).bytes() === abi_Scalar.size(a2, this.ecx).bytes() &&
                    abi_Scalar.size(b1, this.ecx).bytes() === abi_Scalar.size(b2, this.ecx).bytes() &&
                    // The first component is always at offset zero, but the offset to the second
                    // component needs to match as well for us to be able to transmute.
                    b1_offset.bytes() === b2_offset.bytes() &&
                    // None of the inputs may be a pointer.
                    abi_Scalar.primitive(a1).$ !== "Pointer" &&
                    abi_Scalar.primitive(b1).$ !== "Pointer";
                } else {
                  can_transmute = false;
                }
                if (!can_transmute) {
                  return undefined;
                }
              }
              const r = InterpResult.discard_err(value.offset(Size.ZERO, ty, this.ecx));
              if (r === undefined) return undefined;
              op = r;
              break;
            }
            case "PointerCoercion": {
              if (kind._0.$ === "Unsize") {
                const src = this.eval_to_const(value_);
                if (src === undefined) return undefined;
                const dest = InterpResult.discard_err(this.ecx.allocate(ty, { $: "Stack" }));
                if (dest === undefined) return undefined;
                if (discard_err_unit(this.ecx.unsize_into(src, ty, dest)) === undefined) return undefined;
                if (discard_err_unit(this.ecx.alloc_mark_immutable(CtfeProvenance.alloc_id(unwrap(dest.ptr().provenance)))) === undefined) {
                  return undefined;
                }
                op = OpTy_from_MPlaceTy(dest);
                break;
              } else if (kind._0.$ === "UnsafeFnPointer") {
                const src_ = this.eval_to_const(value_);
                if (src_ === undefined) return undefined;
                const src = InterpResult.discard_err(this.ecx.read_immediate(src_));
                if (src === undefined) return undefined;
                op = OpTy_from_ImmTy(interpret.ImmTy.from_immediate(src.imm, ty));
                break;
              } else {
                return undefined;
              }
            }
            case "FnPtrToPtr":
            case "PtrToPtr": {
              const src_ = this.eval_to_const(value_);
              if (src_ === undefined) return undefined;
              const src = InterpResult.discard_err(this.ecx.read_immediate(src_));
              if (src === undefined) return undefined;
              const ret = InterpResult.discard_err(this.ecx.ptr_to_ptr(src, ty));
              if (ret === undefined) return undefined;
              op = OpTy_from_ImmTy(ret);
              break;
            }
            default:
              return undefined;
          }
          break;
        }
      }
    }
    return op;
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:788 eval_to_const
  eval_to_const(index: VnIndex): OpTy | undefined {
    const op_ = this.evaluated[index];
    if (op_ !== undefined) {
      return op_._0;
    }
    const op = this.eval_to_const_inner(index);
    this.evaluated[index] = { $: "Some", _0: op };
    return unwrap(this.evaluated[index])._0;
  }

  /// Represent the *value* we obtain by dereferencing an `Address` value.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:799 dereference_address
  dereference_address(base: AddressBase, projection: readonly ProjectionElem<VnIndex, Ty>[]): VnIndex | undefined {
    let place_ty: PlaceTy;
    let value: VnIndex;
    switch (base.$) {
      // The base is a local, so we take the local's value and project from it.
      case "Local": {
        const local = this.locals[base._0];
        if (local === undefined) return undefined;
        place_ty = PlaceTy.from_ty(this.ty(local));
        value = local;
        break;
      }
      // The base is a pointer's deref, so we introduce the implicit deref.
      case "Deref": {
        const reborrow = base._0;
        const place_ty_ = PlaceTy.from_ty(this.ty(reborrow));
        const r = this.project(place_ty_, reborrow, ProjectionElem.Deref);
        if (r === undefined) return undefined;
        [place_ty, value] = r;
        break;
      }
    }
    for (const proj of projection) {
      const r = this.project(place_ty, value, proj);
      if (r === undefined) return undefined;
      [place_ty, value] = r;
    }
    return value;
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:824 project
  project(place_ty: PlaceTy, value: VnIndex, proj_: ProjectionElem<VnIndex, Ty>): [PlaceTy, VnIndex] | undefined {
    const projection_ty = place_ty.projection_ty(this.tcx_, proj_, debug_VnIndex);
    let proj: ProjectionElem<VnIndex, null>;
    switch (proj_.$) {
      case "Deref": {
        if (place_ty.ty.ref_mutability() === "Not" && projection_ty.ty.is_freeze(this.tcx_, this.typing_env())) {
          const v = this.get(value);
          if (v.$ === "Address") {
            const value_ = this.dereference_address(v.base, v.projection);
            if (value_ !== undefined) {
              return [projection_ty, value_];
            }
          }
          // We cannot unify two references produced by dereferencing the same nested reference,
          // because they may have different lifetimes.
          // ```
          // let b: &T = *a;
          // ... `a` is allowed to be modified. `c` and `b` have different borrowing lifetime.
          // Unifying them will extend the lifetime of `b`.
          // let c: &T = *a;
          // ```
          // Furthermore, unifying them can also violate Stacked Borrows or Tree Borrows.
          // We can only unify all `*b` and `*c` separately
          // because nested shared references are not read-only.
          // For more, see <https://github.com/rust-lang/rust/issues/155884> and
          // <https://github.com/rust-lang/rust/issues/130853>.
          if (this.ty_may_have_ref(projection_ty.ty)) {
            return undefined;
          }

          // An immutable borrow `_x` always points to the same value for the
          // lifetime of the borrow, so we can merge all instances of `*_x`.
          const deref = this.insert(projection_ty.ty, { $: "Projection", _0: value, _1: ProjectionElem.Deref });
          return [projection_ty, deref];
        } else {
          return undefined;
        }
      }
      case "PhantomDeref":
        return bug("PhantomDeref in GVN");
      case "Downcast":
        proj = { $: "Downcast", _0: proj_._0, _1: proj_._1 };
        break;
      case "Field": {
        const f = proj_._0;
        const v = this.get(value);
        if (v.$ === "Aggregate") {
          return [projection_ty, v._1[f]!];
        } else if (v.$ === "Union" && v._0 === f) {
          return [projection_ty, v._1];
        } else if (v.$ === "Projection" && v._1.$ === "Downcast") {
          const read_variant = v._1._1;
          const outer = this.get(v._0);
          if (
            outer.$ === "Aggregate" &&
            // This pass is not aware of control-flow, so we do not know whether the
            // replacement we are doing is actually reachable. We could be in any arm of
            // ```
            // match Some(x) {
            //     Some(y) => /* stuff */,
            //     None => /* other */,
            // }
            // ```
            //
            // In surface rust, the current statement would be unreachable.
            //
            // However, from the reference chapter on enums and RFC 2195,
            // accessing the wrong variant is not UB if the enum has repr.
            // So it's not impossible for a series of MIR opts to generate
            // a downcast to an inactive variant.
            outer._0 === read_variant
          ) {
            return [projection_ty, outer._1[f]!];
          }
        }
        proj = { $: "Field", _0: f, _1: null };
        break;
      }
      case "Index": {
        const v = this.get(value);
        if (v.$ === "Repeat") {
          return [projection_ty, v._0];
        }
        proj = { $: "Index", _0: proj_._0 };
        break;
      }
      case "ConstantIndex": {
        const { offset, min_length, from_end } = proj_;
        const v = this.get(value);
        if (v.$ === "Repeat") {
          return [projection_ty, v._0];
        } else if (v.$ === "Aggregate") {
          const operands = v._1;
          const offset_ = from_end ? operands.length - offset : offset;
          const value_ = operands[offset_];
          if (value_ === undefined) return undefined;
          return [projection_ty, value_];
        }
        proj = { $: "ConstantIndex", offset, min_length, from_end };
        break;
      }
      case "Subslice": {
        const { from, to, from_end } = proj_;
        proj = { $: "Subslice", from, to, from_end };
        break;
      }
      case "OpaqueCast":
        proj = { $: "OpaqueCast", _0: null };
        break;
      case "UnwrapUnsafeBinder":
        proj = { $: "UnwrapUnsafeBinder", _0: null };
        break;
    }

    const value_ = this.insert(projection_ty.ty, { $: "Projection", _0: value, _1: proj });
    return [projection_ty, value_];
  }

  /// Simplify the projection chain if we know better.
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:932 simplify_place_projection
  simplify_place_projection(place: Place, location: Location): void {
    // If the projection is indirect, we treat the local as a value, so can replace it with
    // another local.
    let base: VnIndex | undefined;
    let new_local: Local | undefined;
    if (
      place.is_indirect_first_projection() &&
      (base = this.locals[place.local]) !== undefined &&
      (new_local = this.try_as_local(base, location)) !== undefined &&
      place.local !== new_local
    ) {
      place.local = new_local;
      this.reused_locals.insert(new_local);
    }

    // PORT: `Cow::Borrowed(&place.projection[..])`: `owned` is the `Cow::Owned` copy, made at the first write.
    const borrowed = place.projection;
    let owned: PlaceElem[] | undefined;

    for (let i = 0; i < borrowed.length; i++) {
      const elem = (owned ?? borrowed)[i]!;
      let idx: VnIndex | undefined;
      if (elem.$ === "Index" && (idx = this.locals[elem._0]) !== undefined) {
        const idx_local = elem._0;
        let offset_: OpTy | undefined;
        let offset: bigint | undefined;
        let new_idx_local: Local | undefined;
        if (
          (offset_ = this.eval_to_const(idx)) !== undefined &&
          (offset = InterpResult.discard_err(this.ecx.read_target_usize(offset_))) !== undefined &&
          offset + 1n <= 0xffff_ffff_ffff_ffffn
        ) {
          const min_length = offset + 1n;
          if (min_length > BigInt(Number.MAX_SAFE_INTEGER)) {
            return unported("rustc_mir_transform::gvn::simplify_place_projection (ConstantIndex offset beyond 2^53)");
          }
          (owned ??= borrowed.slice())[i] = { $: "ConstantIndex", offset: Number(offset), min_length: Number(min_length), from_end: false };
        } else if ((new_idx_local = this.try_as_local(idx, location)) !== undefined && idx_local !== new_idx_local) {
          (owned ??= borrowed.slice())[i] = { $: "Index", _0: new_idx_local };
          this.reused_locals.insert(new_idx_local);
        }
      }
    }

    if (owned !== undefined) {
      place.projection = this.tcx_.mk_place_elems(owned);
    }

    // trace!(?place);
  }

  /// Represent the *value* which would be read from `place`. If we succeed, return it.
  /// If we fail, return a `PlaceRef` that contains the same value.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:976 compute_place_value
  compute_place_value(place: Place, location: Location): Either<VnIndex, PlaceRef> {
    // PORT: `Result<VnIndex, PlaceRef>` is an `Either` (`Left` = `Ok`, `Right` = `Err`).
    // Invariant: `place` and `place_ref` point to the same value, even if they point to
    // different memory locations.
    let place_ref = place.as_ref();

    // Invariant: `value` holds the value up-to the `index`th projection excluded.
    let value = this.locals[place.local];
    if (value === undefined) return { $: "Right", _0: place_ref };
    // Invariant: `value` has type `place_ty`, with optional downcast variant if needed.
    let place_ty = PlaceTy.from_ty(this.local_decls[place.local]!.ty);
    for (let index = 0; index < place.projection.length; index++) {
      const proj_ = place.projection[index]!;
      const local = this.try_as_local(value, location);
      if (local !== undefined) {
        // Both `local` and `Place { local: place.local, projection: projection[..index] }`
        // hold the same value. Therefore, following place holds the value in the original
        // `place`.
        place_ref = new PlaceRef(local, place.projection.slice(index));
      }

      const proj = ProjectionElem.try_map<Local, Ty, VnIndex, Ty>(
        proj_,
        (value) => this.locals[value],
        (ty) => ty,
      );
      if (proj === undefined) {
        return { $: "Right", _0: place_ref };
      }
      const ty_and_value = this.project(place_ty, value, proj);
      if (ty_and_value === undefined) {
        return { $: "Right", _0: place_ref };
      }
      [place_ty, value] = ty_and_value;
    }

    return { $: "Left", _0: value };
  }

  /// Represent the *value* which would be read from `place`, and point `place` to a preexisting
  /// place with the same value (if that already exists).
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1012 simplify_place_value
  simplify_place_value(place: Place, location: Location): VnIndex | undefined {
    this.simplify_place_projection(place, location);

    const r = this.compute_place_value(place, location);
    switch (r.$) {
      case "Left": {
        const value = r._0;
        const new_place = this.try_as_place(value, location, true);
        if (new_place !== undefined && (new_place.local !== place.local || new_place.projection.length < place.projection.length)) {
          set_place(place, new_place);
          this.reused_locals.insert(new_place.local);
        }
        return value;
      }
      case "Right": {
        const place_ref = r._0;
        if (place_ref.local !== place.local || place_ref.projection.length < place.projection.length) {
          // By the invariant on `place_ref`.
          set_place(place, place_ref.project_deeper([], this.tcx_));
          this.reused_locals.insert(place_ref.local);
        }
        return undefined;
      }
    }
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1044 simplify_operand
  simplify_operand(operand: Operand, location: Location): VnIndex | undefined {
    let value: VnIndex;
    switch (operand.$) {
      case "RuntimeChecks":
        value = this.insert(this.tcx_.types.bool, { $: "RuntimeChecks", _0: operand._0 });
        break;
      case "Constant":
        value = this.insert_constant(operand._0.const_);
        break;
      case "Copy":
      case "Move": {
        const v = this.simplify_place_value(operand._0, location);
        if (v === undefined) return undefined;
        value = v;
        break;
      }
    }
    const const_ = this.try_as_constant(value);
    if (const_ !== undefined) {
      replace_in_place<Operand>(operand, { $: "Constant", _0: const_ });
    } else {
      const v = this.get(value);
      if (v.$ === "RuntimeChecks") {
        replace_in_place<Operand>(operand, { $: "RuntimeChecks", _0: v._0 });
      }
    }
    return value;
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1065 simplify_rvalue
  simplify_rvalue(rvalue: Rvalue, location: Location): VnIndex | undefined {
    let value: Value;
    switch (rvalue.$) {
      // Forward values.
      case "Use":
        return this.simplify_operand(rvalue._0, location);

      // Roots.
      case "Repeat": {
        const amount = rvalue._1;
        const op = this.simplify_operand(rvalue._0, location);
        if (op === undefined) return undefined;
        value = { $: "Repeat", _0: op, _1: amount };
        break;
      }
      case "Aggregate":
        return this.simplify_aggregate(rvalue, location);
      case "Ref": {
        const borrow_kind = rvalue._1;
        const place = rvalue._2;
        this.simplify_place_projection(place, location);
        return this.new_pointer(place, { $: "Ref", _0: borrow_kind });
      }
      case "Reborrow": {
        const mutbl = rvalue._1;
        const place = rvalue._2;
        if (mutbl === "Mut") {
          // Note: this is adapted from simplify_aggregate.
          const operand: Operand = { $: "Copy", _0: clone_Place(place) };
          const val = this.simplify_operand(operand, location);
          // FIXME(reborrow): Is it correct to make these retagging assignments?
          replace_in_place<Rvalue>(rvalue, { $: "Use", _0: { $: "Copy", _0: place }, _1: "Yes" });
          return val;
        } else {
          // FIXME(reborrow): CoerceShared should perform effectively a copy followed by a
          // transmute, or possibly something more complicated in the future. For now we
          // leave this unoptimised.
          return undefined;
        }
      }
      case "RawPtr": {
        const mutbl = rvalue._0;
        const place = rvalue._1;
        this.simplify_place_projection(place, location);
        return this.new_pointer(place, { $: "Address", _0: mutbl });
      }
      case "WrapUnsafeBinder": {
        const value_ = this.simplify_operand(rvalue._0, location);
        if (value_ === undefined) return undefined;
        value = { $: "Cast", kind: { $: "Transmute" }, value: value_ };
        break;
      }

      // Operations.
      case "Cast": {
        const to = rvalue._2;
        return this.simplify_cast(field_mut(rvalue, "_0"), rvalue._1, to, location);
      }
      case "BinaryOp": {
        const op = rvalue._0;
        const [lhs, rhs] = rvalue._1;
        return this.simplify_binary(op, lhs, rhs, location);
      }
      case "UnaryOp": {
        const op = rvalue._0;
        return this.simplify_unary(op, rvalue._1, location);
      }
      case "Discriminant": {
        const place = this.simplify_place_value(rvalue._0, location);
        if (place === undefined) return undefined;
        const discr = this.simplify_discriminant(place);
        if (discr !== undefined) {
          return discr;
        }
        value = { $: "Discriminant", _0: place };
        break;
      }

      // Unsupported values.
      case "ThreadLocalRef":
        return undefined;
      case "CopyForDeref":
        return bug(`forbidden in runtime MIR: ${debug_Rvalue(rvalue, PLAIN)}`);
    }
    const ty = Rvalue.ty(rvalue, this.local_decls, this.tcx_);
    return this.insert(ty, value);
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1136 simplify_discriminant
  simplify_discriminant(place: VnIndex): VnIndex | undefined {
    const enum_ty = this.ty(place);
    const v = this.get(place);
    if (enum_ty.is_enum() && v.$ === "Aggregate") {
      const variant = v._0;
      const discr = InterpResult.discard_err(this.ecx.discriminant_for_variant(enum_ty, variant));
      if (discr === undefined) return undefined;
      return this.insert_scalar(discr.layout.ty, interpret.Immediate.to_scalar(discr.imm));
    }

    return undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1148 try_as_place_elem
  try_as_place_elem(ty: Ty, proj: ProjectionElem<VnIndex, null>, loc: Location): PlaceElem | undefined {
    return ProjectionElem.try_map<VnIndex, null, Local, Ty>(
      proj,
      (value) => {
        const local = this.try_as_local(value, loc);
        if (local === undefined) return undefined;
        this.reused_locals.insert(local);
        return local;
      },
      (_) => ty,
    );
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1164 simplify_aggregate_to_copy
  simplify_aggregate_to_copy(ty: Ty, variant_index: VariantIdx, fields: readonly VnIndex[]): VnIndex | undefined {
    const first_field = fields[0];
    if (first_field === undefined) return undefined;
    const first = this.get(first_field);
    if (first.$ !== "Projection") return undefined;
    const copy_from_value = first._0;

    // All fields must correspond one-to-one and come from the same aggregate value.
    if (
      fields.some((v, index) => {
        const val = this.get(v);
        if (val.$ === "Projection" && val._1.$ === "Field" && copy_from_value === val._0 && FieldIdx.index(val._1._0) === index) {
          return false;
        }
        return true;
      })
    ) {
      return undefined;
    }

    let copy_from_local_value = copy_from_value;
    const c = this.get(copy_from_value);
    if (c.$ === "Projection" && c._1.$ === "Downcast") {
      const pointer = c._0;
      const read_variant = c._1._1;
      if (variant_index === read_variant) {
        // When copying a variant, there is no need to downcast.
        copy_from_local_value = pointer;
      } else {
        // The copied variant must be identical.
        return undefined;
      }
    }

    // Both must be variants of the same type.
    if (this.ty(copy_from_local_value) === ty) {
      return copy_from_local_value;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1203 simplify_aggregate
  simplify_aggregate(rvalue: Rvalue, location: Location): VnIndex | undefined {
    const tcx = this.tcx_;
    const ty = Rvalue.ty(rvalue, this.local_decls, tcx);

    if (rvalue.$ !== "Aggregate") return bug();
    const kind = rvalue._0;
    const field_ops = rvalue._1;

    if (field_ops.length === 0) {
      let is_zst: boolean;
      switch (kind.$) {
        case "Array":
        case "Tuple":
        case "Closure":
        case "CoroutineClosure":
          is_zst = true;
          break;
        // Only enums can be non-ZST.
        case "Adt":
          is_zst = tcx.def_kind(kind._0).$ !== "Enum";
          break;
        // Coroutines are never ZST, as they at least contain the implicit states.
        case "Coroutine":
          is_zst = false;
          break;
        case "RawPtr":
          return bug("MIR for RawPtr aggregate must have 2 fields");
      }

      if (is_zst) {
        return this.insert_constant(mir_Const.zero_sized(ty));
      }
    }

    const fields: VnIndex[] = field_ops.map((op) => this.simplify_operand(op, location) ?? this.new_opaque(Operand.ty(op, this.local_decls, this.tcx_)));

    let variant_index: VariantIdx;
    switch (kind.$) {
      case "Array":
      case "Tuple":
        assert(!(field_ops.length === 0), "assertion failed: !field_ops.is_empty()");
        variant_index = FIRST_VARIANT;
        break;
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
        variant_index = FIRST_VARIANT;
        break;
      case "Adt": {
        if (kind._4 === undefined) {
          variant_index = kind._1;
          break;
        }
        // Do not track unions.
        const active_field = kind._4;
        const field = fields[0];
        if (field === undefined) return undefined;
        return this.insert(ty, { $: "Union", _0: active_field, _1: field });
      }
      case "RawPtr": {
        assert_eq(field_ops.length, 2, (v) => `${v}`);
        let pointer = fields[0]!;
        const metadata = fields[1]!;

        // Any thin pointer of matching mutability is fine as the data pointer.
        let was_updated = false;
        for (;;) {
          const p = this.get(pointer);
          if (p.$ !== "Cast" || p.kind.$ !== "PtrToPtr") break;
          const cast_value = p.value;
          const from_k = this.ty(cast_value).kind();
          const out_k = ty.kind();
          if (!(from_k.$ === "RawPtr" && out_k.$ === "RawPtr" && from_k._1 === out_k._1 && from_k._0.is_sized(this.tcx_, this.typing_env()))) {
            break;
          }
          pointer = cast_value;
          was_updated = true;
        }

        let op: Operand | undefined;
        if (was_updated && (op = this.try_as_operand(pointer, location)) !== undefined) {
          field_ops[FieldIdx.ZERO] = op;
        }

        return this.insert(ty, { $: "RawPtr", pointer, metadata });
      }
    }

    let first: VnIndex | undefined;
    if (ty.is_array() && fields.length > 4 && (first = all_equal_value(fields)) !== undefined) {
      const len = ty_Const.from_target_usize(this.tcx_, fields.length);
      const op = this.try_as_operand(first, location);
      if (op !== undefined) {
        replace_in_place<Rvalue>(rvalue, { $: "Repeat", _0: op, _1: len });
      }
      return this.insert(ty, { $: "Repeat", _0: first, _1: len });
    }

    const value = this.simplify_aggregate_to_copy(ty, variant_index, fields);
    if (value !== undefined) {
      const place = this.try_as_place(value, location, true);
      if (place !== undefined) {
        this.reused_locals.insert(place.local);
        // FIXME: Is it correct to make these retagging assignments?
        replace_in_place<Rvalue>(rvalue, { $: "Use", _0: { $: "Copy", _0: place }, _1: "Yes" });
      }
      return value;
    }

    return this.insert(ty, { $: "Aggregate", _0: variant_index, _1: fields });
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1299 simplify_unary
  simplify_unary(op: UnOp, arg_op: Operand, location: Location): VnIndex | undefined {
    let arg_index = this.simplify_operand(arg_op, location);
    if (arg_index === undefined) return undefined;
    const arg_ty = this.ty(arg_index);
    const ret_ty = UnOp.ty(op, this.tcx_, arg_ty);

    // PtrMetadata doesn't care about *const vs *mut vs & vs &mut,
    // so start by removing those distinctions so we can update the `Operand`
    if (op === "PtrMetadata") {
      let was_updated = false;
      for (;;) {
        const v = this.get(arg_index);
        let from: Ty | undefined;
        let to: Ty | undefined;
        let from_k;
        // Pointer casts that preserve metadata, such as
        // `*const [i32]` <-> `*mut [i32]` <-> `*mut [f32]`.
        // It's critical that this not eliminate cases like
        // `*const [T]` -> `*const T` which remove metadata.
        // We run on potentially-generic MIR, though, so unlike codegen
        // we can't always know exactly what the metadata are.
        // To allow things like `*mut (?A, ?T)` <-> `*mut (?B, ?T)`,
        // it's fine to get a projection as the type.
        if (v.$ === "Cast" && v.kind.$ === "PtrToPtr" && this.pointers_have_same_metadata(this.ty(v.value), arg_ty)) {
          arg_index = v.value;
        }

        // We have an unsizing cast, which assigns the length to wide pointer metadata.
        else if (
          v.$ === "Cast" &&
          v.kind.$ === "PointerCoercion" &&
          v.kind._0.$ === "Unsize" &&
          (from = this.ty(v.value).builtin_deref(true)) !== undefined &&
          (from_k = from.kind()).$ === "Array" &&
          (to = this.ty(arg_index).builtin_deref(true)) !== undefined &&
          to.kind().$ === "Slice"
        ) {
          return this.insert_constant({ $: "Ty", _0: this.tcx_.types.usize, _1: from_k._1 });
        }

        // `&mut *p`, `&raw *p`, etc don't change metadata.
        else if (v.$ === "Address" && v.base.$ === "Deref" && v.projection.length === 0) {
          arg_index = v.base._0;
        } else {
          break;
        }
        was_updated = true;
      }

      let op_: Operand | undefined;
      if (was_updated && (op_ = this.try_as_operand(arg_index, location)) !== undefined) {
        replace_in_place<Operand>(arg_op, op_);
      }
    }

    let value: Value;
    const v = this.get(arg_index);
    let len_k;
    if (op === "Not" && v.$ === "UnaryOp" && v._0 === "Not") {
      return v._1;
    } else if (op === "Neg" && v.$ === "UnaryOp" && v._0 === "Neg") {
      return v._1;
    } else if (op === "Not" && v.$ === "BinaryOp" && v._0 === "Eq") {
      value = { $: "BinaryOp", _0: "Ne", _1: v._1, _2: v._2 };
    } else if (op === "Not" && v.$ === "BinaryOp" && v._0 === "Ne") {
      value = { $: "BinaryOp", _0: "Eq", _1: v._1, _2: v._2 };
    } else if (op === "PtrMetadata" && v.$ === "RawPtr") {
      return v.metadata;
    }
    // We have an unsizing cast, which assigns the length to wide pointer metadata.
    else if (
      op === "PtrMetadata" &&
      v.$ === "Cast" &&
      v.kind.$ === "PointerCoercion" &&
      v.kind._0.$ === "Unsize" &&
      unwrap(arg_ty.builtin_deref(true)).kind().$ === "Slice" &&
      (len_k = unwrap(this.ty(v.value).builtin_deref(true)).kind()).$ === "Array"
    ) {
      return this.insert_constant({ $: "Ty", _0: this.tcx_.types.usize, _1: len_k._1 });
    } else {
      value = { $: "UnaryOp", _0: op, _1: arg_index };
    }
    return this.insert(ret_ty, value);
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1386 simplify_binary
  simplify_binary(op: BinOp, lhs_operand: Operand, rhs_operand: Operand, location: Location): VnIndex | undefined {
    const lhs_ = this.simplify_operand(lhs_operand, location);
    const rhs_ = this.simplify_operand(rhs_operand, location);

    // Only short-circuit options after we called `simplify_operand`
    // on both operands for side effect.
    if (lhs_ === undefined) return undefined;
    let lhs = lhs_;
    if (rhs_ === undefined) return undefined;
    let rhs = rhs_;

    const lhs_ty = this.ty(lhs);

    // If we're comparing pointers, remove `PtrToPtr` casts if the from
    // types of both casts and the metadata all match.
    const lv = this.get(lhs);
    const rv = this.get(rhs);
    let lhs_from: Ty;
    if (
      (op === "Eq" || op === "Ne" || op === "Lt" || op === "Le" || op === "Gt" || op === "Ge") &&
      lhs_ty.is_any_ptr() &&
      lv.$ === "Cast" &&
      lv.kind.$ === "PtrToPtr" &&
      rv.$ === "Cast" &&
      rv.kind.$ === "PtrToPtr" &&
      ((lhs_from = this.ty(lv.value)), lhs_from === this.ty(rv.value)) &&
      this.pointers_have_same_metadata(lhs_from, lhs_ty)
    ) {
      lhs = lv.value;
      rhs = rv.value;
      let lhs_op: Operand | undefined;
      let rhs_op: Operand | undefined;
      if ((lhs_op = this.try_as_operand(lhs, location)) !== undefined && (rhs_op = this.try_as_operand(rhs, location)) !== undefined) {
        replace_in_place<Operand>(lhs_operand, lhs_op);
        replace_in_place<Operand>(rhs_operand, rhs_op);
      }
    }

    const value_ = this.simplify_binary_inner(op, lhs_ty, lhs, rhs);
    if (value_ !== undefined) {
      return value_;
    }
    const ty = BinOp.ty(op, this.tcx_, lhs_ty, this.ty(rhs));
    const value: Value = { $: "BinaryOp", _0: op, _1: lhs, _2: rhs };
    return this.insert(ty, value);
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1431 simplify_binary_inner
  simplify_binary_inner(op: BinOp, lhs_ty: Ty, lhs: VnIndex, rhs: VnIndex): VnIndex | undefined {
    // Floats are weird enough that none of the logic below applies.
    const reasonable_ty = lhs_ty.is_integral() || lhs_ty.is_bool() || lhs_ty.is_char() || lhs_ty.is_any_ptr();
    if (!reasonable_ty) {
      return undefined;
    }

    const layout_r = this.ecx.layout_of(lhs_ty);
    if (layout_r.$ === "Err") return undefined;
    const layout = layout_r._0;

    const as_bits = (value: VnIndex): bigint | undefined => {
      const constant = this.eval_to_const(value);
      if (constant === undefined) return undefined;
      if (BackendRepr_is_scalar(layout.backend_repr)) {
        const scalar = InterpResult.discard_err(this.ecx.read_scalar(constant));
        if (scalar === undefined) return undefined;
        return InterpResult.discard_err(Scalar.to_bits(scalar, constant.layout.size));
      } else {
        // `constant` is a wide pointer. Do not evaluate to bits.
        return undefined;
      }
    };

    // Represent the values as `Left(bits)` or `Right(VnIndex)`.
    const ab = as_bits(lhs);
    const a: Either<bigint, VnIndex> = ab === undefined ? { $: "Right", _0: lhs } : { $: "Left", _0: ab };
    const bb = as_bits(rhs);
    const b: Either<bigint, VnIndex> = bb === undefined ? { $: "Right", _0: rhs } : { $: "Left", _0: bb };

    const is_left = (e: Either<bigint, VnIndex>, n: bigint): boolean => e.$ === "Left" && e._0 === n;
    const ones_ok = (e: Either<bigint, VnIndex>): boolean =>
      e.$ === "Left" && (e._0 === layout.size.truncate(U128_MAX) || (layout.ty.is_bool() && e._0 === 1n));
    const either_eq = (x: Either<bigint, VnIndex>, y: Either<bigint, VnIndex>): boolean => x.$ === y.$ && x._0 === y._0;

    let result: VnIndex;
    // Neutral elements.
    if (
      ((op === "Add" || op === "AddWithOverflow" || op === "AddUnchecked" || op === "BitOr" || op === "BitXor") &&
        is_left(a, 0n) &&
        b.$ === "Right") ||
      ((op === "Add" ||
        op === "AddWithOverflow" ||
        op === "AddUnchecked" ||
        op === "BitOr" ||
        op === "BitXor" ||
        op === "Sub" ||
        op === "SubWithOverflow" ||
        op === "SubUnchecked" ||
        op === "Offset" ||
        op === "Shl" ||
        op === "Shr") &&
        a.$ === "Right" &&
        is_left(b, 0n)) ||
      ((op === "Mul" || op === "MulWithOverflow" || op === "MulUnchecked") && is_left(a, 1n) && b.$ === "Right") ||
      ((op === "Mul" || op === "MulWithOverflow" || op === "MulUnchecked" || op === "Div") && a.$ === "Right" && is_left(b, 1n))
    ) {
      result = (a.$ === "Right" ? a._0 : (b._0 as VnIndex));
    }
    // Attempt to simplify `x & ALL_ONES` to `x`, with `ALL_ONES` depending on type size.
    else if (op === "BitAnd" && a.$ === "Right" && ones_ok(b)) {
      result = a._0;
    } else if (op === "BitAnd" && ones_ok(a) && b.$ === "Right") {
      result = b._0;
    }
    // Absorbing elements.
    else if (
      ((op === "Mul" || op === "MulWithOverflow" || op === "MulUnchecked" || op === "BitAnd") && is_left(b, 0n)) ||
      (op === "Rem" && is_left(b, 1n)) ||
      ((op === "Mul" ||
        op === "MulWithOverflow" ||
        op === "MulUnchecked" ||
        op === "Div" ||
        op === "Rem" ||
        op === "BitAnd" ||
        op === "Shl" ||
        op === "Shr") &&
        is_left(a, 0n))
    ) {
      result = this.insert_scalar(lhs_ty, Scalar.from_uint(0n, layout.size));
    }
    // Attempt to simplify `x | ALL_ONES` to `ALL_ONES`.
    else if (op === "BitOr" && ones_ok(b)) {
      result = this.insert_scalar(lhs_ty, Scalar.from_uint(b._0 as bigint, layout.size));
    } else if (op === "BitOr" && ones_ok(a)) {
      result = this.insert_scalar(lhs_ty, Scalar.from_uint(a._0 as bigint, layout.size));
    }
    // Sub/Xor with itself.
    else if ((op === "Sub" || op === "SubWithOverflow" || op === "SubUnchecked" || op === "BitXor") && either_eq(a, b)) {
      result = this.insert_scalar(lhs_ty, Scalar.from_uint(0n, layout.size));
    }
    // Comparison:
    // - if both operands can be computed as bits, just compare the bits;
    // - if we proved that both operands have the same value, we can insert true/false;
    // - otherwise, do nothing, as we do not try to prove inequality.
    else if (op === "Eq" && a.$ === "Left" && b.$ === "Left") {
      result = this.insert_bool(a._0 === b._0);
    } else if (op === "Eq" && either_eq(a, b)) {
      result = this.insert_bool(true);
    } else if (op === "Ne" && a.$ === "Left" && b.$ === "Left") {
      result = this.insert_bool(a._0 !== b._0);
    } else if (op === "Ne" && either_eq(a, b)) {
      result = this.insert_bool(false);
    } else {
      return undefined;
    }

    if (BinOp.is_overflowing(op)) {
      const ty = Ty.new_tup(this.tcx_, [this.ty(result), this.tcx_.types.bool]);
      const false_val = this.insert_bool(false);
      return this.insert_tuple(ty, [result, false_val]);
    } else {
      return result;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1554 simplify_cast
  simplify_cast(initial_kind: MutRef<CastKind>, initial_operand: Operand, to: Ty, location: Location): VnIndex | undefined {
    let kind = initial_kind.value;
    const value_ = this.simplify_operand(initial_operand, location);
    if (value_ === undefined) return undefined;
    let value = value_;
    let from = this.ty(value);
    if (from === to) {
      return value;
    }

    if (kind.$ === "PointerCoercion" && (kind._0.$ === "ReifyFnPointer" || kind._0.$ === "ClosureFnPointer")) {
      // Each reification of a generic fn may get a different pointer.
      // Do not try to merge them.
      return this.new_opaque(to);
    }

    let was_ever_updated = false;
    for (;;) {
      let was_updated_this_iteration = false;

      // Transmuting between raw pointers is just a pointer cast so long as
      // they have the same metadata type (like `*const i32` <=> `*mut u64`
      // or `*mut [i32]` <=> `*const [u64]`), including the common special
      // case of `*const T` <=> `*mut T`.
      if (kind.$ === "Transmute" && from.is_raw_ptr() && to.is_raw_ptr() && this.pointers_have_same_metadata(from, to)) {
        kind = { $: "PtrToPtr" };
        was_updated_this_iteration = true;
      }

      // If a cast just casts away the metadata again, then we can get it by
      // casting the original thin pointer passed to `from_raw_parts`
      const v1 = this.get(value);
      const to_k = to.kind();
      if (kind.$ === "PtrToPtr" && v1.$ === "RawPtr" && to_k.$ === "RawPtr" && to_k._0.is_sized(this.tcx_, this.typing_env())) {
        const pointer = v1.pointer;
        from = this.ty(pointer);
        value = pointer;
        was_updated_this_iteration = true;
        if (from === to) {
          return pointer;
        }
      }

      // Aggregate-then-Transmute can just transmute the original field value,
      // so long as the bytes of a value from only from a single field.
      const v2 = this.get(value);
      let fi: [FieldIdx, Ty] | undefined;
      if (kind.$ === "Transmute" && v2.$ === "Aggregate" && (fi = this.value_is_all_in_one_field(from, v2._0)) !== undefined) {
        const [field_idx, field_ty] = fi;
        from = field_ty;
        value = v2._1[field_idx]!;
        was_updated_this_iteration = true;
        if (field_ty === to) {
          return value;
        }
      }

      // Various cast-then-cast cases can be simplified.
      const v3 = this.get(value);
      if (v3.$ === "Cast") {
        const inner_kind = v3.kind;
        const inner_value = v3.value;
        const inner_from = this.ty(inner_value);
        let new_kind: CastKind | undefined;
        // Even if there's a narrowing cast in here that's fine, because
        // things like `*mut [i32] -> *mut i32 -> *const i32` and
        // `*mut [i32] -> *const [i32] -> *const i32` can skip the middle in MIR.
        if (inner_kind.$ === "PtrToPtr" && kind.$ === "PtrToPtr") {
          new_kind = { $: "PtrToPtr" };
        }
        // PtrToPtr-then-Transmute is fine so long as the pointer cast is identity:
        // `*const T -> *mut T -> NonNull<T>` is fine, but we need to check for narrowing
        // to skip things like `*const [i32] -> *const i32 -> NonNull<T>`.
        else if (inner_kind.$ === "PtrToPtr" && kind.$ === "Transmute" && this.pointers_have_same_metadata(inner_from, from)) {
          new_kind = { $: "Transmute" };
        }
        // Similarly, for Transmute-then-PtrToPtr. Note that we need to check different
        // variables for their metadata, and thus this can't merge with the previous arm.
        else if (inner_kind.$ === "Transmute" && kind.$ === "PtrToPtr" && this.pointers_have_same_metadata(from, to)) {
          new_kind = { $: "Transmute" };
        }
        // It would be legal to always do this, but we don't want to hide information
        // from the backend that it'd otherwise be able to use for optimizations.
        else if (inner_kind.$ === "Transmute" && kind.$ === "Transmute" && !this.transmute_may_have_niche_of_interest_to_backend(inner_from, from, to)) {
          new_kind = { $: "Transmute" };
        } else {
          new_kind = undefined;
        }
        if (new_kind !== undefined) {
          kind = new_kind;
          from = inner_from;
          value = inner_value;
          was_updated_this_iteration = true;
          if (inner_from === to) {
            return inner_value;
          }
        }
      }

      if (was_updated_this_iteration) {
        was_ever_updated = true;
      } else {
        break;
      }
    }

    let op: Operand | undefined;
    if (was_ever_updated && (op = this.try_as_operand(value, location)) !== undefined) {
      replace_in_place<Operand>(initial_operand, op);
      initial_kind.value = kind;
    }

    return this.insert(to, { $: "Cast", kind, value });
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1680 pointers_have_same_metadata
  pointers_have_same_metadata(left_ptr_ty: Ty, right_ptr_ty: Ty): boolean {
    const left_meta_ty = left_ptr_ty.pointee_metadata_ty_or_projection(this.tcx_);
    const right_meta_ty = right_ptr_ty.pointee_metadata_ty_or_projection(this.tcx_);
    if (left_meta_ty === right_meta_ty) {
      return true;
    }
    const left = this.tcx_.try_normalize_erasing_regions(this.typing_env(), Unnormalized.new_wip(left_meta_ty), fold_Ty);
    if (left.$ === "Ok") {
      const right = this.tcx_.try_normalize_erasing_regions(this.typing_env(), Unnormalized.new_wip(right_meta_ty), fold_Ty);
      if (right.$ === "Ok") {
        return left._0 === right._0;
      }
    }
    return false;
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1699 ty_may_have_ref
  ty_may_have_ref(ty: Ty): boolean {
    return ty_may_have_ref_inner(this.tcx_, ty, 0);
  }

  /// Returns `false` if we're confident that the middle type doesn't have an
  /// interesting niche so we can skip that step when transmuting.
  ///
  /// The backend will emit `assume`s when transmuting between types with niches,
  /// so we want to preserve `i32 -> char -> u32` so that that data is around,
  /// but it's fine to skip whole-range-is-value steps like `A -> u32 -> B`.
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1758 transmute_may_have_niche_of_interest_to_backend
  transmute_may_have_niche_of_interest_to_backend(from_ty: Ty, middle_ty: Ty, to_ty: Ty): boolean {
    const middle_layout_r = this.ecx.layout_of(middle_ty);
    if (middle_layout_r.$ === "Err") {
      // If it's too generic or something, then assume it might be interesting later.
      return true;
    }
    const middle_layout = middle_layout_r._0;

    if (middle_layout.uninhabited) {
      return true;
    }

    const repr = middle_layout.backend_repr;
    switch (repr.$) {
      case "Scalar": {
        const mid = repr._0;
        if (abi_Scalar.is_always_valid(mid, this.ecx)) {
          // With no niche it's never interesting, so don't bother
          // looking at the layout of the other two types.
          return false;
        }
        const from_layout = this.ecx.layout_of(from_ty);
        if (
          from_layout.$ === "Ok" &&
          !from_layout._0.uninhabited &&
          from_layout._0.size.bytes() === middle_layout.size.bytes() &&
          from_layout._0.backend_repr.$ === "Scalar"
        ) {
          const from_a = from_layout._0.backend_repr._0;
          const mid_range = abi_Scalar.valid_range(mid, this.ecx);
          const from_range = abi_Scalar.valid_range(from_a, this.ecx);
          if (mid_range.contains_range(from_range, middle_layout.size)) {
            // The `from_range` is a (non-strict) subset of `mid_range`
            // such as if we're doing `bool` -> `ascii::Char` -> `_`,
            // where `from_range: 0..=1` and `mid_range: 0..=127`,
            // and thus the middle doesn't tell us anything we don't
            // already know from the initial type.
            return false;
          }
        }
        const to_layout = this.ecx.layout_of(to_ty);
        if (
          to_layout.$ === "Ok" &&
          !to_layout._0.uninhabited &&
          to_layout._0.size.bytes() === middle_layout.size.bytes() &&
          to_layout._0.backend_repr.$ === "Scalar"
        ) {
          const to_a = to_layout._0.backend_repr._0;
          const mid_range = abi_Scalar.valid_range(mid, this.ecx);
          const to_range = abi_Scalar.valid_range(to_a, this.ecx);
          if (mid_range.contains_range(to_range, middle_layout.size)) {
            // The `to_range` is a (non-strict) subset of `mid_range`
            // such as if we're doing `_` -> `ascii::Char` -> `bool`,
            // where `mid_range: 0..=127` and `to_range: 0..=1`,
            // and thus the middle doesn't tell us anything we don't
            // already know from the final type.
            return false;
          }
        }
        return true;
      }
      case "ScalarPair": {
        const { a, b } = repr;
        // The offset is irrelevant to niches since it can only cause padding,
        // which can never have a niche since it's uninitialized.
        return !abi_Scalar.is_always_valid(a, this.ecx) || !abi_Scalar.is_always_valid(b, this.ecx);
      }
      case "SimdVector":
      case "SimdScalableVector":
      case "Memory":
        return false;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1822 value_is_all_in_one_field
  value_is_all_in_one_field(ty: Ty, variant: VariantIdx): [FieldIdx, Ty] | undefined {
    const layout = this.ecx.layout_of(ty);
    let f: [FieldIdx, TyAndLayout] | undefined;
    if (
      layout.$ === "Ok" &&
      layout._0.variants.$ === "Single" &&
      layout._0.variants.index === variant &&
      (f = layout._0.non_1zst_field(this.ecx)) !== undefined &&
      layout._0.size.bytes() === f[1].size.bytes()
    ) {
      const [field_idx, field_layout] = f;
      // We needed to check the variant to avoid trying to read the tag
      // field from an enum where no fields have variants, since that tag
      // field isn't in the `Aggregate` from which we're getting values.
      return [field_idx, field_layout.ty];
    }
    const k = ty.kind();
    if (k.$ === "Adt" && k._0.is_struct() && k._0.repr().transparent()) {
      const fields = k._0.non_enum_variant().fields;
      if (fields.length === 1) {
        const single_field = fields[0]!;
        return [FieldIdx.ZERO, Unnormalized.skip_norm_wip(single_field.ty(this.tcx_, k._1))];
      }
    }
    return undefined;
  }

  // ---- impl VnState (second block, gvn.rs:1966) ----

  /// If either [`Self::try_as_constant`] as [`Self::try_as_place`] succeeds,
  /// returns that result as an [`Operand`].
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1969 try_as_operand
  try_as_operand(index: VnIndex, location: Location): Operand | undefined {
    const const_ = this.try_as_constant(index);
    if (const_ !== undefined) {
      return { $: "Constant", _0: const_ };
    }
    const v = this.get(index);
    if (v.$ === "RuntimeChecks") {
      return { $: "RuntimeChecks", _0: v._0 };
    }
    const place = this.try_as_place(index, location, false);
    if (place !== undefined) {
      this.reused_locals.insert(place.local);
      return { $: "Copy", _0: place };
    }
    return undefined;
  }

  /// If `index` is a `Value::Constant`, return the `Constant` to be put in the MIR.
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:1983 try_as_constant
  try_as_constant(index: VnIndex): ConstOperand | undefined {
    const value = this.get(index);

    // This was already an *evaluated* constant in MIR, do not change it.
    if (value.$ === "Constant" && value.disambiguator === undefined && value.value.$ === "Val") {
      return new ConstOperand(DUMMY_SP, undefined, clone_Const(value.value));
    }

    const value_ = this.try_as_evaluated_constant(index);
    if (value_ !== undefined) {
      return new ConstOperand(DUMMY_SP, undefined, value_);
    }

    // We failed to provide an evaluated form, fallback to using the unevaluated constant.
    if (value.$ === "Constant" && value.disambiguator === undefined) {
      return new ConstOperand(DUMMY_SP, undefined, clone_Const(value.value));
    }

    return undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2005 try_as_evaluated_constant
  try_as_evaluated_constant(index: VnIndex): mir_Const | undefined {
    const op = this.eval_to_const(index);
    if (op === undefined) return undefined;
    const value = op_to_prop_const(this.ecx, op);
    if (value === undefined) return undefined;

    // Check that we do not leak a pointer.
    // Those pointers may lose part of their identity in codegen.
    // FIXME: remove this hack once https://github.com/rust-lang/rust/issues/128775 is fixed.
    if (may_have_provenance(this.tcx_, value, op.layout.size)) {
      return undefined;
    }

    return { $: "Val", _0: value, _1: op.layout.ty };
  }

  /// Construct a place which holds the same value as `index` and for which all locals strictly
  /// dominate `loc`. If you used this place, add its base local to `reused_locals` to remove
  /// storage statements.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2023 try_as_place
  try_as_place(index: VnIndex, loc: Location, allow_complex_projection: boolean): Place | undefined {
    const projection: PlaceElem[] = [];
    for (;;) {
      const local = this.try_as_local(index, loc);
      let v: Value;
      let proj: PlaceElem | undefined;
      if (local !== undefined) {
        projection.reverse();
        const place = new Place(local, this.tcx_.mk_place_elems(projection));
        return place;
      } else if (projection.length > 0 && projection[projection.length - 1]!.$ === "Deref") {
        // `Deref` can only be the first projection in a place.
        // If we are here, we failed to find a local, and we already have a `Deref`.
        // Trying to add projections will only result in an ill-formed place.
        return undefined;
      } else if (
        (v = this.get(index)).$ === "Projection" &&
        (allow_complex_projection || ProjectionElem.is_stable_offset(v._1)) &&
        (proj = this.try_as_place_elem(this.ty(index), v._1, loc)) !== undefined
      ) {
        const pointer = v._0;
        if (proj.$ === "Deref") {
          // We can introduce a new dereference if the source value cannot be changed in the body.
          // Dereferencing an immutable argument always gives the same value in the body.
          const p = this.get(pointer);
          if (p.$ === "Argument" && this.ty(pointer).ref_mutability() === "Not") {
            // ok
          } else {
            return undefined;
          }
        }
        projection.push(proj);
        index = pointer;
      } else {
        return undefined;
      }
    }
  }

  /// If there is a local which is assigned `index`, and its assignment strictly dominates `loc`,
  /// return it. If you used this local, add it to `reused_locals` to remove storage statements.
  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2066 try_as_local
  try_as_local(index: VnIndex, loc: Location): Local | undefined {
    const other = this.rev_locals[index];
    if (other === undefined) return undefined;
    return other.find((other) => this.ssa.assignment_dominates(this.dominators, other, loc));
  }

  // ---- impl MutVisitor for VnState ----

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2076 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2080 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    this.simplify_place_projection(place, location);
    this.super_place(place, context, location);
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2085 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    this.simplify_operand(operand, location);
    this.super_operand(operand, location);
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2090 visit_assign
  override visit_assign(lhs: Place, rvalue: Rvalue, location: Location): void {
    this.simplify_place_projection(lhs, location);

    const value = this.simplify_rvalue(rvalue, location);
    if (value !== undefined) {
      // FIXME: Is it correct to make these retagging assignments?
      const const_ = this.try_as_constant(value);
      let place: Place | undefined;
      if (const_ !== undefined) {
        replace_in_place<Rvalue>(rvalue, { $: "Use", _0: { $: "Constant", _0: const_ }, _1: "Yes" });
      } else if (
        (place = this.try_as_place(value, location, false)) !== undefined &&
        !(rvalue.$ === "Use" && (rvalue._0.$ === "Move" || rvalue._0.$ === "Copy") && place_eq(rvalue._0._0, place))
      ) {
        replace_in_place<Rvalue>(rvalue, { $: "Use", _0: { $: "Copy", _0: place }, _1: "Yes" });
        this.reused_locals.insert(place.local);
      }
    }

    const local = lhs.as_local();
    let rvalue_ty: Ty;
    if (
      local !== undefined &&
      this.ssa.is_ssa(local) &&
      ((rvalue_ty = Rvalue.ty(rvalue, this.local_decls, this.tcx_)), true) &&
      // FIXME(#112651) `rvalue` may have a subtype to `local`. We can only mark
      // `local` as reusable if we have an exact type match.
      this.local_decls[local]!.ty === rvalue_ty
    ) {
      const value_ = value ?? this.new_opaque(rvalue_ty);
      this.assign(local, value_);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2123 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    if (terminator.kind.$ === "Call") {
      const destination = terminator.kind.destination;
      const local = destination.as_local();
      if (local !== undefined && this.ssa.is_ssa(local)) {
        const ty = this.local_decls[local]!.ty;
        const opaque = this.new_opaque(ty);
        this.assign(local, opaque);
      }
    }
    this.super_terminator(terminator, location);
  }
}

// rustc: compiler/rustc_mir_transform/src/gvn.rs:1700 ty_may_have_ref_inner
function ty_may_have_ref_inner(tcx: TyCtxt, ty: Ty, depth_: number): boolean {
  if (!tcx.recursion_limit().value_within_limit(depth_)) {
    return true;
  }
  const depth = depth_ + 1;
  const k = ty.kind();
  switch (k.$) {
    case "Int":
    case "Uint":
    case "Float":
    case "Bool":
    case "Char":
    case "Str":
    case "Never":
    case "FnDef":
    case "Error":
    case "FnPtr":
      return false;
    case "Tuple":
      return k._0.some((field) => ty_may_have_ref_inner(tcx, field, depth));
    case "Pat":
    case "Slice":
    case "Array":
      return ty_may_have_ref_inner(tcx, k._0, depth);
    case "Adt": {
      const [adt_def, args] = [k._0, k._1];
      return (
        TypeVisitableExt.has_param(adt_def, visit_AdtDef) ||
        TypeVisitableExt.has_aliases(adt_def, visit_AdtDef) ||
        [...adt_def.all_fields()].some((field) => ty_may_have_ref_inner(tcx, Unnormalized.skip_normalization(field.ty(tcx, args)), depth))
      );
    }
    case "Ref":
    case "RawPtr":
    case "Bound":
    case "Closure":
    case "CoroutineClosure":
    case "Dynamic":
    case "Foreign":
    case "Coroutine":
    case "CoroutineWitness":
    case "UnsafeBinder":
    case "Infer":
    case "Alias":
    case "Param":
    case "Placeholder":
      return true;
  }
}

/** `Itertools::all_equal_value`: `Ok(first)` when every element equals the first (`Err` on empty / mismatch). */
function all_equal_value(xs: readonly VnIndex[]): VnIndex | undefined {
  const first = xs[0];
  if (first === undefined) return undefined;
  for (const x of xs) if (x !== first) return undefined;
  return first;
}

/** `BackendRepr::is_scalar`. */
function BackendRepr_is_scalar(r: BackendRepr): boolean {
  return r.$ === "Scalar";
}

/** PORT: `.discard_err()` of an `InterpResult<()>`: `Option<()>` is `null` (`Some(())`) / `undefined` (`None`), since the
 * unit success value is itself `undefined` (precedent known_panics_lint.ts). */
function discard_err_unit(r: InterpResult<undefined>): null | undefined {
  return InterpResult.discard_err(InterpResult.map(r, () => null));
}

/** `u128::MAX`. */
const U128_MAX = (1n << 128n) - 1n;

/** PORT: derived `PartialEq` of `mir::Place` (`local` and the interned `projection` list). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/** `*place = new_place` on a `&mut Place` (header). */
function set_place(place: Place, new_place: Place): void {
  place.local = new_place.local;
  place.projection = new_place.projection;
}

/// Return true if any evaluation of this constant in the same MIR body
/// always returns the same value, taking into account even pointer identity tests.
///
/// In other words, this answers: is "cloning" the `Const` ok?
///
/// This returns `false` for constants that synthesize new `AllocId` when they are instantiated.
/// It is `true` for anything else, since a given `AllocId` *does* have a unique runtime value
/// within the scope of a single MIR body.
// rustc: compiler/rustc_mir_transform/src/gvn.rs:1857 is_deterministic
function is_deterministic(c: mir_Const): boolean {
  // Primitive types cannot contain provenance and always have the same value.
  if (mir_Const.ty(c).is_primitive()) {
    return true;
  }

  switch (c.$) {
    // Some constants may generate fresh allocations for pointers they contain,
    // so using the same constant twice can yield two different results.
    // Notably, valtrees purposefully generate new allocations.
    case "Ty":
      return false;
    // We do not know the contents, so don't attempt to do anything clever.
    case "Unevaluated":
      return false;
    // When an evaluated constant contains provenance, it is encoded as an `AllocId`.
    // Cloning the constant will reuse the same `AllocId`. If this is in the same MIR
    // body, this same `AllocId` will result in the same pointer in codegen.
    case "Val":
      return true;
  }
}

/// Check if a constant may contain provenance information.
/// Can return `true` even if there is no provenance.
// rustc: compiler/rustc_mir_transform/src/gvn.rs:1879 may_have_provenance
function may_have_provenance(tcx: TyCtxt, value: ConstValue, size: Size): boolean {
  switch (value.$) {
    case "ZeroSized":
      return false;
    case "Scalar":
      return value._0.$ !== "Int";
    case "Slice":
      return true;
    case "Indirect": {
      const { alloc_id, offset } = value;
      return !GlobalAlloc.unwrap_memory(tcx.global_alloc(alloc_id))
        .inner()
        .provenance_()
        .range_empty(AllocRange_from_Range_Size({ start: offset, end: offset.add(size) }), tcx);
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/gvn.rs:1892 op_to_prop_const
function op_to_prop_const(ecx: InterpCx<DummyMachine>, op: OpTy): ConstValue | undefined {
  // Do not attempt to propagate unsized locals.
  if (op.layout.is_unsized()) {
    return undefined;
  }

  // This constant is a ZST, just return an empty value.
  if (op.layout.is_zst()) {
    return { $: "ZeroSized" };
  }

  // Do not synthetize too large constants. Codegen will just memcpy them, which we'd like to
  // avoid.
  // But we *do* want to synthesize any size constant if it is entirely uninit because that
  // benefits codegen, which has special handling for them.
  if (!op.is_immediate_uninit() && !(op.layout.backend_repr.$ === "Scalar" || op.layout.backend_repr.$ === "ScalarPair")) {
    return undefined;
  }

  // If this constant has scalar ABI, return it as a `ConstValue::Scalar`.
  let scalar: Scalar | undefined;
  if (
    op.layout.backend_repr.$ === "Scalar" &&
    op.layout.backend_repr._0.$ === "Initialized" &&
    (scalar = InterpResult.discard_err(ecx.read_scalar(op))) !== undefined
  ) {
    if (!(Scalar.try_to_scalar_int(scalar).$ === "Ok")) {
      // Check that we do not leak a pointer.
      // Those pointers may lose part of their identity in codegen.
      // FIXME: remove this hack once https://github.com/rust-lang/rust/issues/128775 is fixed.
      return undefined;
    }
    return { $: "Scalar", _0: scalar };
  }

  // If this constant is already represented as an `Allocation`,
  // try putting it into global memory to return it.
  const e = op.as_mplace_or_imm();
  if (e.$ === "Left") {
    const mplace = e._0;
    const r = ecx.ptr_try_get_alloc_id(mplace.ptr(), 0n);
    if (r.$ === "Err") return undefined;
    const [alloc_id, offset] = r._0;

    // Do not try interning a value that contains provenance.
    // Due to https://github.com/rust-lang/rust/issues/128775, doing so could lead to bugs.
    // FIXME: remove this hack once that issue is fixed.
    const hp = InterpResult.discard_err(ecx.has_provenance_in_alloc(alloc_id));
    if (hp === undefined) return undefined;
    if (hp) {
      return undefined;
    }

    if (discard_err_unit(interpret.intern_const_alloc_for_constprop(ecx, alloc_id)) === undefined) return undefined;

    // `alloc_id` may point to a static. Codegen will choke on an `Indirect` with anything
    // by `GlobalAlloc::Memory`, so do fall through to copying if needed.
    // FIXME: find a way to treat this more uniformly (probably by fixing codegen)
    const ga = ecx.tcx.deref().global_alloc(alloc_id);
    if (
      ga.$ === "Memory" &&
      // Transmuting a constant is just an offset in the allocation. If the alignment of the
      // allocation is not enough, fallback to copying into a properly aligned value.
      ga._0.inner().align.pow2 >= op.layout.align.abi.pow2 &&
      // If this is a packed field the offset must also be sufficiently aligned.
      offset.bytes() % op.layout.align.abi.bytes() === 0
    ) {
      return { $: "Indirect", alloc_id, offset };
    }
  }

  // Everything failed: create a new allocation to hold the data.
  const alloc_id = InterpResult.discard_err(ecx.intern_with_temp_alloc(op.layout, (ecx, dest) => ecx.copy_op(op, dest)));
  if (alloc_id === undefined) return undefined;
  return { $: "Indirect", alloc_id, offset: Size.ZERO };
}

// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:2137 StorageRemover
class StorageRemover extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public reused_locals: DenseBitSet<Local>,
    public storage_to_remove: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2144 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2148 visit_operand
  override visit_operand(operand: Operand, _: Location): void {
    if (operand.$ === "Move" && !operand._0.is_indirect_first_projection() && this.reused_locals.contains(operand._0.local)) {
      replace_in_place<Operand>(operand, { $: "Copy", _0: operand._0 });
    }
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2157 visit_statement
  override visit_statement(stmt: Statement, loc: Location): void {
    const k = stmt.kind;
    // When removing storage statements, we need to remove both (#107511).
    if ((k.$ === "StorageLive" || k.$ === "StorageDead") && this.storage_to_remove.contains(k._0)) {
      stmt.make_nop(true);
    } else {
      this.super_statement(stmt, loc);
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/gvn.rs:2170 StorageChecker
class StorageChecker extends Visitor {
  constructor(
    public reused_locals: DenseBitSet<Local>,
    public storage_to_remove: DenseBitSet<Local>,
    public maybe_uninit: ResultsCursor<DenseBitSet<Local>, MaybeUninitializedLocals>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/gvn.rs:2177 visit_local
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    switch (context.$) {
      // These mutating uses do not require the local to be initialized,
      // so we cannot use our maybe-uninit check on them.
      // However, GVN doesn't introduce or move mutations,
      // so this local must already have valid storage at this location.
      case "MutatingUse":
        if (context._0 === "AsmOutput" || context._0 === "Call" || context._0 === "Store" || context._0 === "Yield") {
          return;
        }
        // Must check validity for other mutating usages and all non-mutating uses.
        break;
      case "NonUse":
        return;
      case "NonMutatingUse":
        break;
    }

    // We only need to check reused locals which we haven't already removed storage for.
    if (!this.reused_locals.contains(local) || this.storage_to_remove.contains(local)) {
      return;
    }

    this.maybe_uninit.seek_before_primary_effect(location);

    if (this.maybe_uninit.get().contains(local)) {
      // debug!(
      //     ?location,
      //     ?local,
      //     "local is reused and is maybe uninit at this location, marking it for storage statement removal"
      // );
      this.storage_to_remove.insert(local);
    }
  }
}

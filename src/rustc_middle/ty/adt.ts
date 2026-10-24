// Port of compiler/rustc_middle/src/ty/adt.rs (lane ty-adt-assoc).
//
// PORT (D2): `AdtDef<'tcx>(Interned<'tcx, AdtDefData>)` is the hash-consed object itself (like `Ty`, `Region`): a
// frozen `AdtDef extends Interned` whose `internee` is the `AdtDefData`, made only by `TyCtxt::mk_adt_def_from_data`
// (context.rs `direct_interners!`, `CtxtInterners.adt_def`). Equality is `===`. The interner's key is
// `AdtDefData.hash()` (`impl Hash for AdtDefData` hashes only `did`), not the structural `intern_key` of the data.
// `self.0.0.x` is `this.internee.x`. The inherent methods are class methods; the methods of the later
// `impl AdtDef` block sit in the class body after the first block and the `inherent::AdtDef` impl (PORTING §8).
// `impl inherent::AdtDef for AdtDef` (rustc_type_ir inherent.ts): methods whose name the inherent impl already uses
// with the same meaning are served by it (`served by` lines); `destructor` (inherent: `Option<Destructor>`, trait:
// `Option<AdtDestructorKind>`) is the incompatible collision, `ir_destructor` (ty-contract decision 5).
//
// Defining module (docs/handoff/ty-contract.md "Init order"): it never imports an extension module and its top-level
// code touches nothing but its own classes. context.ts may import it.
//
// PORT(decls): `ConstValue::try_to_bits_for_ty` (mir/consts.rs) is reached lazily through the helper at the end of
// the file (`const_eval_poly` / `ErrorHandled`: mir/interpret, lane mir-interp-b) (lane repr-options: `ReprOptions` is rustc_abi's). (merge-w15b: `VariantDef`,
// `FieldDef`, `Destructor` are ty/mod.ts's, `Discr` / `IntTypeExt` ty/util.ts's, `ty::Value` / `ScalarInt`
// ty/consts/*.ts's; ty/mod.ts / util.ts / valtree.ts are reached lazily.)
import { Interned } from "../../rustc_data_structures/intern.ts";
import { find_attr, type Attribute as Attribute_ } from "../../rustc_attr_ir/lib.ts";
import { type CtorKind, debug_Res, type DefKind, type Res } from "../../rustc_hir/def.ts";
import type { Constness } from "../../rustc_hir/hir.ts";
import { debug_HirId, type HirId } from "../../rustc_hir_id/lib.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { to_writer } from "../../vendor/bitflags/parser.ts";
import { flags_companion } from "../../vendor/bitflags/traits.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { FieldInfo } from "../../rustc_type_ir/lib.gen.ts";
import type { AdtDestructorKind, SizedTraitKind } from "../../rustc_type_ir/solve/mod.gen.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { ConstEvalNonIntError_diagnostic } from "../diagnostics.gen.ts";
import type { TyCtxt } from "./context.ts";
import type {
  AsyncDestructor,
  Destructor,
  Discr,
  FieldIdx,
  Range,
  ReprOptions,
  ScalarInt,
  TypingEnv,
  Value,
  VariantDef,
  VariantIdx,
} from "./decls.ts";
import type { GenericArgs } from "./generic_args.ts";
import type { FieldDef, Ty } from "./mod.ts";

// rustc_abi `FIRST_VARIANT` (`VariantIdx::ZERO`)
const FIRST_VARIANT = 0 as VariantIdx;

// ---- AdtFlags ------------------------------------------------------------------------------------------------------

// PORT: `bitflags!` (`impl AdtFlags: u16`) -> branded number; flags + `Flags` API on the companion.
export type AdtFlags = number & { readonly __brand: "AdtFlags" };
export const AdtFlags = flags_companion<AdtFlags, {
  NO_ADT_FLAGS: AdtFlags;
  IS_ENUM: AdtFlags;
  IS_UNION: AdtFlags;
  IS_STRUCT: AdtFlags;
  HAS_CTOR: AdtFlags;
  IS_PHANTOM_DATA: AdtFlags;
  IS_FUNDAMENTAL: AdtFlags;
  IS_BOX: AdtFlags;
  IS_MANUALLY_DROP: AdtFlags;
  IS_VARIANT_LIST_NON_EXHAUSTIVE: AdtFlags;
  IS_UNSAFE_CELL: AdtFlags;
  IS_UNSAFE_PINNED: AdtFlags;
  IS_PIN: AdtFlags;
  IS_PIN_PROJECT: AdtFlags;
  IS_FIELD_REPRESENTING_TYPE: AdtFlags;
  IS_MAYBE_DANGLING: AdtFlags;
}>(
  16,
  {
    NO_ADT_FLAGS: 0 as AdtFlags,
    /// Indicates whether the ADT is an enum.
    IS_ENUM: (1 << 0) as AdtFlags,
    /// Indicates whether the ADT is a union.
    IS_UNION: (1 << 1) as AdtFlags,
    /// Indicates whether the ADT is a struct.
    IS_STRUCT: (1 << 2) as AdtFlags,
    /// Indicates whether the ADT is a struct and has a constructor.
    HAS_CTOR: (1 << 3) as AdtFlags,
    /// Indicates whether the type is `PhantomData`.
    IS_PHANTOM_DATA: (1 << 4) as AdtFlags,
    /// Indicates whether the type has a `#[fundamental]` attribute.
    IS_FUNDAMENTAL: (1 << 5) as AdtFlags,
    /// Indicates whether the type is `Box`.
    IS_BOX: (1 << 6) as AdtFlags,
    /// Indicates whether the type is `ManuallyDrop`.
    IS_MANUALLY_DROP: (1 << 7) as AdtFlags,
    /// Indicates whether the variant list of this ADT is `#[non_exhaustive]`.
    /// (i.e., this flag is never set unless this ADT is an enum).
    IS_VARIANT_LIST_NON_EXHAUSTIVE: (1 << 8) as AdtFlags,
    /// Indicates whether the type is `UnsafeCell`.
    IS_UNSAFE_CELL: (1 << 9) as AdtFlags,
    /// Indicates whether the type is `UnsafePinned`.
    IS_UNSAFE_PINNED: (1 << 10) as AdtFlags,
    /// Indicates whether the type is `Pin`.
    IS_PIN: (1 << 11) as AdtFlags,
    /// Indicates whether the type is `#[pin_project]`.
    IS_PIN_PROJECT: (1 << 12) as AdtFlags,
    /// Indicates whether the type is `FieldRepresentingType`.
    IS_FIELD_REPRESENTING_TYPE: (1 << 13) as AdtFlags,
    /// Indicates whether the type is `MaybeDangling<_>`.
    /// Note that this is not the only type with "maybe dangling" semantics!
    /// Use `ty.is_like_maybe_dangling()` to check for that.
    IS_MAYBE_DANGLING: (1 << 14) as AdtFlags,
  },
  [
    ["NO_ADT_FLAGS", 0 as AdtFlags],
    ["IS_ENUM", (1 << 0) as AdtFlags],
    ["IS_UNION", (1 << 1) as AdtFlags],
    ["IS_STRUCT", (1 << 2) as AdtFlags],
    ["HAS_CTOR", (1 << 3) as AdtFlags],
    ["IS_PHANTOM_DATA", (1 << 4) as AdtFlags],
    ["IS_FUNDAMENTAL", (1 << 5) as AdtFlags],
    ["IS_BOX", (1 << 6) as AdtFlags],
    ["IS_MANUALLY_DROP", (1 << 7) as AdtFlags],
    ["IS_VARIANT_LIST_NON_EXHAUSTIVE", (1 << 8) as AdtFlags],
    ["IS_UNSAFE_CELL", (1 << 9) as AdtFlags],
    ["IS_UNSAFE_PINNED", (1 << 10) as AdtFlags],
    ["IS_PIN", (1 << 11) as AdtFlags],
    ["IS_PIN_PROJECT", (1 << 12) as AdtFlags],
    ["IS_FIELD_REPRESENTING_TYPE", (1 << 13) as AdtFlags],
    ["IS_MAYBE_DANGLING", (1 << 14) as AdtFlags],
  ],
);
/** `rustc_data_structures::external_bitflags_debug! { AdtFlags }`: `bitflags::parser::to_writer(self, f)`. */
export const debug_AdtFlags: Debug<AdtFlags> = (v) => to_writer(AdtFlags.FLAGS_DESC, v);

// ---- AdtDefData ----------------------------------------------------------------------------------------------------

/// The definition of a user-defined type, e.g., a `struct`, `enum`, or `union`.
///
/// These are all interned (by `mk_adt_def`) into the global arena.
///
/// The initialism *ADT* stands for an [*algebraic data type (ADT)*][adt].
/// This is slightly wrong because `union`s are not ADTs.
/// Moreover, Rust only allows recursive data types through indirection.
///
/// [adt]: https://en.wikipedia.org/wiki/Algebraic_data_type
///
/// # Recursive types
///
/// It may seem impossible to represent recursive types using [`Ty`],
/// since [`TyKind::Adt`] includes [`AdtDef`], which includes its fields,
/// creating a cycle. However, `AdtDef` does not actually include the *types*
/// of its fields; it includes just their [`DefId`]s.
///
/// [`TyKind::Adt`]: ty::TyKind::Adt
///
/// For example, the following type:
///
/// ```
/// struct S { x: Box<S> }
/// ```
///
/// is essentially represented with [`Ty`] as the following pseudocode:
///
/// ```ignore (illustrative)
/// struct S { x }
/// ```
///
/// where `x` here represents the `DefId` of `S.x`. Then, the `DefId`
/// can be used with [`TyCtxt::type_of()`] to get the type of the field.
export class AdtDefData {
  constructor(
    /// The `DefId` of the struct, enum or union item.
    readonly did: DefId,
    /// Variants of the ADT. If this is a struct or union, then there will be a single variant.
    readonly variants: readonly VariantDef[],
    /// Flags of the ADT (e.g., is this a struct? is this non-exhaustive?).
    readonly flags: AdtFlags,
    /// Repr options provided by the user.
    readonly repr: ReprOptions,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/adt.rs:123 eq
  eq(other: AdtDefData): boolean {
    // There should be only one `AdtDefData` for each `def_id`, therefore
    // it is fine to implement `PartialEq` only based on `def_id`.
    //
    // Below, we exhaustively destructure `self` and `other` so that if the
    // definition of `AdtDefData` changes, a compile-error will be produced,
    // reminding us to revisit this assumption.

    const self_def_id = this.did;
    const other_def_id = other.did;

    const res = DefId_eq(self_def_id, other_def_id);

    // Double check that implicit assumption detailed above.
    // if cfg!(debug_assertions) && res { .. assert!(deep, "AdtDefData for the same def-id has differing data"); }
    // PORT: `cfg!(debug_assertions)` is false (rustc ships without debug assertions).

    return res;
  }

  /// There should be only one AdtDef for each `did`, therefore
  /// it is fine to implement `Hash` only based on `did`.
  // PORT: `impl Hash` as the canonical key string (rust_ts/intern_key.ts): the interner's key for `AdtDefData`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:154 hash
  hash(): string {
    return intern_key(this.did);
  }

  // rustc-skip: compiler/rustc_middle/src/ty/adt.rs:160 stable_hash hand-written StableHash impl (thread-local fingerprint cache; incremental query hashing, M5), not a codegen'd metadata/hygiene impl (PORTING §3)

  /// Creates a new `AdtDefData`.
  // PORT: from the later `impl AdtDefData` block (adt.rs:353), in the class body (PORTING §8).
  // rustc: compiler/rustc_middle/src/ty/adt.rs:355 new
  static new(tcx: TyCtxt, did: DefId, kind: AdtKind, variants: readonly VariantDef[], repr: ReprOptions): AdtDefData {
    // debug!("AdtDef::new({:?}, {:?}, {:?}, {:?})", did, kind, variants, repr);
    let flags = AdtFlags.NO_ADT_FLAGS;

    if (kind === "Enum" && find_attr(ty_mod().HasAttrs_DefId.get_attrs(did, tcx), (k) => (k.$ === "NonExhaustive" ? null : undefined)) !== undefined) {
      // debug!("found non-exhaustive variant list for {:?}", did);
      flags = AdtFlags.union(flags, AdtFlags.IS_VARIANT_LIST_NON_EXHAUSTIVE);
    }
    if (find_attr(ty_mod().HasAttrs_DefId.get_attrs(did, tcx), (k) => (k.$ === "PinV2" ? null : undefined)) !== undefined) {
      // debug!("found pin-project type {:?}", did);
      flags = AdtFlags.union(flags, AdtFlags.IS_PIN_PROJECT);
    }

    let kind_flag: AdtFlags;
    switch (kind) {
      case "Enum":
        kind_flag = AdtFlags.IS_ENUM;
        break;
      case "Union":
        kind_flag = AdtFlags.IS_UNION;
        break;
      case "Struct":
        kind_flag = AdtFlags.IS_STRUCT;
        break;
    }
    flags = AdtFlags.union(flags, kind_flag);

    if (kind === "Struct" && unwrap(variants[FIRST_VARIANT], "index out of bounds").ctor !== undefined) {
      flags = AdtFlags.union(flags, AdtFlags.HAS_CTOR);
    }

    if (find_attr(ty_mod().HasAttrs_DefId.get_attrs(did, tcx), (k) => (k.$ === "Fundamental" ? null : undefined)) !== undefined) {
      flags = AdtFlags.union(flags, AdtFlags.IS_FUNDAMENTAL);
    }
    let lang_flag: AdtFlags;
    switch (tcx.as_lang_item(did)) {
      case "PhantomData":
        lang_flag = AdtFlags.IS_PHANTOM_DATA;
        break;
      case "OwnedBox":
        lang_flag = AdtFlags.IS_BOX;
        break;
      case "ManuallyDrop":
        lang_flag = AdtFlags.IS_MANUALLY_DROP;
        break;
      case "MaybeDangling":
        lang_flag = AdtFlags.IS_MAYBE_DANGLING;
        break;
      case "UnsafeCell":
        lang_flag = AdtFlags.IS_UNSAFE_CELL;
        break;
      case "UnsafePinned":
        lang_flag = AdtFlags.IS_UNSAFE_PINNED;
        break;
      case "Pin":
        lang_flag = AdtFlags.IS_PIN;
        break;
      case "FieldRepresentingType":
        lang_flag = AdtFlags.IS_FIELD_REPRESENTING_TYPE;
        break;
      default:
        lang_flag = AdtFlags.NO_ADT_FLAGS;
        break;
    }
    flags = AdtFlags.union(flags, lang_flag);

    return new AdtDefData(did, variants, flags, repr);
  }
}

// ---- AdtDef --------------------------------------------------------------------------------------------------------

export class AdtDef extends Interned {
  /** PORT: the interned `AdtDefData` (module comment). */
  readonly internee: AdtDefData;

  /** PORT: only `TyCtxt::mk_adt_def_from_data` constructs (D2). */
  constructor(internee: AdtDefData) {
    super();
    this.internee = Object.freeze(internee);
    Object.freeze(this);
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:191 did
  did(): DefId {
    return this.internee.did;
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:196 variants
  variants(): readonly VariantDef[] {
    return this.internee.variants;
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:201 variant
  variant(idx: VariantIdx): VariantDef {
    return unwrap(this.internee.variants[idx], "index out of bounds");
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:206 flags
  flags(): AdtFlags {
    return this.internee.flags;
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:211 repr
  repr(): ReprOptions {
    return this.internee.repr;
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:215 field_representing_type_info
  // rustc: compiler/rustc_middle/src/ty/adt.rs:287 field_representing_type_info
  field_representing_type_info(tcx: TyCtxt, args: GenericArgs): FieldInfo | undefined {
    if (!this.is_field_representing_type()) {
      return undefined;
    }
    const base = args.type_at(0);
    let variant_idx: VariantIdx;
    const k1 = args.const_at(1).kind();
    if (k1.$ === "Value") {
      variant_idx = valtree_().Value.to_leaf(k1._0).to_u32() as VariantIdx;
    } else {
      return undefined;
    }
    let field_idx: FieldIdx;
    const k2 = args.const_at(2).kind();
    if (k2.$ === "Value") {
      field_idx = valtree_().Value.to_leaf(k2._0).to_u32() as FieldIdx;
    } else {
      return undefined;
    }
    let ty: Ty;
    let variant: Symbol | undefined;
    let name: Symbol;
    const base_kind = base.kind();
    switch (base_kind.$) {
      case "Adt": {
        const base_def = base_kind._0;
        const base_args = base_kind._1;
        const variant_ = base_def.variant(variant_idx);
        const field = unwrap(variant_.fields[field_idx], "index out of bounds");
        ty = Unnormalized.skip_norm_wip(field.ty(tcx, base_args));
        variant = base_def.is_enum() ? variant_.name : undefined;
        name = field.name;
        break;
      }
      case "Tuple": {
        const tys = base_kind._0;
        if (variant_idx !== FIRST_VARIANT) {
          bug(`expected variant of tuple to be FIRST_VARIANT, but found ${variant_idx}`);
        }
        const t = tys[field_idx];
        if (t !== undefined) {
          ty = t;
        } else {
          bug(`expected valid tuple index, but got ${field_idx}, tuple length: ${tys.length}`);
        }
        variant = undefined;
        name = sym.integer(field_idx);
        break;
      }
      default:
        panic();
    }
    return { base, ty, variant, variant_idx, name, field_idx };
  }

  // ---- impl rustc_type_ir::inherent::AdtDef<TyCtxt<'tcx>> for AdtDef<'tcx> ----

  // rustc: compiler/rustc_middle/src/ty/adt.rs:263 def_id
  def_id(): DefId {
    return this.did();
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:267 is_struct
  // served by the inherent `is_struct` (ty/adt.rs:406)

  // rustc: compiler/rustc_middle/src/ty/adt.rs:271 is_packed
  is_packed(): boolean {
    return this.repr().packed();
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:275 struct_tail_ty
  struct_tail_ty(interner: TyCtxt): EarlyBinder<Ty> | undefined {
    const tail = this.non_enum_variant().tail_opt();
    if (tail === undefined) return undefined;
    // PORT: the `type_of` query value is `unknown` in queries.gen.ts (`EarlyBinder<Ty>`).
    return interner.type_of(tail.did) as EarlyBinder<Ty>;
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:279 is_phantom_data
  // served by the inherent `is_phantom_data` (ty/adt.rs:493)

  // rustc: compiler/rustc_middle/src/ty/adt.rs:283 is_manually_drop
  // served by the inherent `is_manually_drop` (ty/adt.rs:517)

  // (adt.rs:287 `field_representing_type_info`: the second marker on the inherent method above, same body)

  // rustc: compiler/rustc_middle/src/ty/adt.rs:295 all_field_tys
  all_field_tys(tcx: TyCtxt): EarlyBinder<Iterable<Ty>> {
    const fields = this.all_fields();
    return EarlyBinder.bind_iter(
      (function* (): Generator<Ty> {
        for (const field of fields) yield EarlyBinder.skip_binder(tcx.type_of(field.did) as EarlyBinder<Ty>);
      })(),
    );
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:304 sizedness_constraint
  // served by the inherent `sizedness_constraint` (ty/adt.rs:753)

  // rustc: compiler/rustc_middle/src/ty/adt.rs:312 is_fundamental
  // served by the inherent `is_fundamental` (ty/adt.rs:487)

  // PORT: `inherent::AdtDef::destructor` collides with the inherent `destructor` (module comment).
  // rustc: compiler/rustc_middle/src/ty/adt.rs:316 destructor
  ir_destructor(tcx: TyCtxt): AdtDestructorKind | undefined {
    const d = this.destructor(tcx);
    if (d === undefined) return undefined;
    // PORT: the `constness` query value is `unknown` in queries.gen.ts (`hir::Constness`).
    const c = tcx.constness(d.did) as Constness;
    switch (c.$) {
      case "Const":
        if (c.always === true) panic("not implemented: FIXME(comptime)"); // `unimplemented!("FIXME(comptime)")`
        return "Const";
      case "NotConst":
        return "NotConst";
    }
  }

  // ---- the later `impl<'tcx> AdtDef<'tcx>` block (adt.rs:404; PORTING §8) ----

  /// Returns `true` if this is a struct.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:406 is_struct
  is_struct(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_STRUCT);
  }

  /// Returns `true` if this is a union.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:412 is_union
  is_union(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_UNION);
  }

  /// Returns `true` if this is an enum.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:418 is_enum
  is_enum(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_ENUM);
  }

  /// Returns `true` if the variant list of this ADT is `#[non_exhaustive]`.
  ///
  /// Note that this function will return `true` even if the ADT has been
  /// defined in the crate currently being compiled. If that's not what you
  /// want, see [`Self::variant_list_has_applicable_non_exhaustive`].
  // rustc: compiler/rustc_middle/src/ty/adt.rs:428 is_variant_list_non_exhaustive
  is_variant_list_non_exhaustive(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_VARIANT_LIST_NON_EXHAUSTIVE);
  }

  /// Returns `true` if the variant list of this ADT is `#[non_exhaustive]`
  /// and has been defined in another crate.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:435 variant_list_has_applicable_non_exhaustive
  variant_list_has_applicable_non_exhaustive(): boolean {
    return this.is_variant_list_non_exhaustive() && !this.did().is_local();
  }

  /// Returns the kind of the ADT.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:441 adt_kind
  adt_kind(): AdtKind {
    if (this.is_enum()) {
      return "Enum";
    } else if (this.is_union()) {
      return "Union";
    } else {
      return "Struct";
    }
  }

  /// Returns a description of this abstract data type.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:452 descr
  descr(): string {
    switch (this.adt_kind()) {
      case "Struct":
        return "struct";
      case "Union":
        return "union";
      case "Enum":
        return "enum";
    }
  }

  /// Returns a description of this abstract data type with the article.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:461 article
  article(): string {
    switch (this.adt_kind()) {
      case "Struct":
      case "Union":
        return "a";
      case "Enum":
        return "an";
    }
  }

  /// Returns a description of a variant of this abstract data type.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:470 variant_descr
  variant_descr(): string {
    switch (this.adt_kind()) {
      case "Struct":
        return "struct";
      case "Union":
        return "union";
      case "Enum":
        return "variant";
    }
  }

  /// If this function returns `true`, it implies that `is_struct` must return `true`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:480 has_ctor
  has_ctor(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.HAS_CTOR);
  }

  /// Returns `true` if this type is `#[fundamental]` for the purposes
  /// of coherence checking.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:487 is_fundamental
  is_fundamental(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_FUNDAMENTAL);
  }

  /// Returns `true` if this is `PhantomData<T>`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:493 is_phantom_data
  is_phantom_data(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_PHANTOM_DATA);
  }

  /// Returns `true` if this is `Box<T>`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:499 is_box
  is_box(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_BOX);
  }

  /// Returns `true` if this is `UnsafeCell<T>`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:505 is_unsafe_cell
  is_unsafe_cell(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_UNSAFE_CELL);
  }

  /// Returns `true` if this is `UnsafePinned<T>`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:511 is_unsafe_pinned
  is_unsafe_pinned(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_UNSAFE_PINNED);
  }

  /// Returns `true` if this is `ManuallyDrop<T>`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:517 is_manually_drop
  is_manually_drop(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_MANUALLY_DROP);
  }

  /// Returns `true` if this is `Pin<T>`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:523 is_pin
  is_pin(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_PIN);
  }

  /// Returns `true` is this is `#[pin_v2]` for the purposes
  /// of structural pinning.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:530 is_pin_project
  is_pin_project(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_PIN_PROJECT);
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:534 is_field_representing_type
  is_field_representing_type(): boolean {
    return AdtFlags.contains(this.flags(), AdtFlags.IS_FIELD_REPRESENTING_TYPE);
  }

  /// Returns `true` if this type has a destructor.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:539 has_dtor
  has_dtor(tcx: TyCtxt): boolean {
    return this.destructor(tcx) !== undefined;
  }

  /// Asserts this is a struct or union and returns its unique variant.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:544 non_enum_variant
  non_enum_variant(): VariantDef {
    assert(this.is_struct() || this.is_union(), "assertion failed: self.is_struct() || self.is_union()");
    return this.variant(FIRST_VARIANT);
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:550 clauses
  clauses(tcx: TyCtxt): ReturnType<TyCtxt["clauses_of"]> {
    return tcx.clauses_of(this.did());
  }

  /// Returns an iterator over all fields contained
  /// by this ADT (nested unnamed fields are not expanded).
  // rustc: compiler/rustc_middle/src/ty/adt.rs:557 all_fields
  *all_fields(): Generator<FieldDef> {
    for (const v of this.variants()) yield* v.fields;
  }

  /// Whether the ADT lacks fields. Note that this includes uninhabited enums,
  /// e.g., `enum Void {}` is considered payload free as well.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:563 is_payloadfree
  is_payloadfree(): boolean {
    // Treat the ADT as not payload-free if arbitrary_enum_discriminant is used (#88621).
    // This would disallow the following kind of enum from being casted into integer.
    // ```
    // enum Enum {
    //    Foo() = 1,
    //    Bar{} = 2,
    //    Baz = 3,
    // }
    // ```
    if (
      this.variants().some((v_) => {
        const v = v_;
        return v.discr.$ === "Explicit" && v.ctor_kind() !== "Const";
      })
    ) {
      return false;
    }
    return this.variants().every((v) => v.fields.length === 0);
  }

  /// Return a `VariantDef` given a variant id.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:582 variant_with_id
  variant_with_id(vid: DefId): VariantDef {
    const v = this.variants().find((v) => DefId_eq(v.def_id, vid));
    if (v === undefined) panic("variant_with_id: unknown variant");
    return v;
  }

  /// Return a `VariantDef` given a constructor id.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:587 variant_with_ctor_id
  variant_with_ctor_id(cid: DefId): VariantDef {
    const v = this.variants().find((v) => eq_Option_DefId(v.ctor_def_id(), cid));
    if (v === undefined) panic("variant_with_ctor_id: unknown variant");
    return v;
  }

  /// Return the index of `VariantDef` given a variant id.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:596 variant_index_with_id
  variant_index_with_id(vid: DefId): VariantIdx {
    const i = this.variants().findIndex((v) => DefId_eq(v.def_id, vid));
    if (i === -1) panic("variant_index_with_id: unknown variant");
    return i as VariantIdx;
  }

  /// Return the index of `VariantDef` given a constructor id.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:605 variant_index_with_ctor_id
  variant_index_with_ctor_id(cid: DefId): VariantIdx {
    const i = this.variants().findIndex((v) => eq_Option_DefId(v.ctor_def_id(), cid));
    if (i === -1) panic("variant_index_with_ctor_id: unknown variant");
    return i as VariantIdx;
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:613 variant_of_res
  variant_of_res(res: Res): VariantDef {
    if (res.$ === "Def") {
      const kind: DefKind = res._0;
      switch (kind.$) {
        case "Variant":
          return this.variant_with_id(res._1);
        case "Ctor":
          return this.variant_with_ctor_id(res._1);
        case "Struct":
        case "Union":
        case "TyAlias":
        case "AssocTy":
          return this.non_enum_variant();
        default:
          break;
      }
    } else if (res.$ === "SelfTyParam" || res.$ === "SelfTyAlias" || res.$ === "SelfCtor") {
      return this.non_enum_variant();
    }
    bug(`unexpected res ${debug_Res(res, PLAIN, debug_HirId as Debug<HirId>)} in variant_of_res`);
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:629 eval_explicit_discr
  eval_explicit_discr(tcx: TyCtxt, expr_did: DefId): Result<Discr, ErrorGuaranteed> {
    assert(this.is_enum(), "assertion failed: self.is_enum()");

    const repr_type = this.repr().discr_type();
    const r = tcx.const_eval_poly(expr_did);
    switch (r.$) {
      case "Ok": {
        const val = r._0;
        const typing_env = ty_mod().TypingEnv.post_analysis(tcx, expr_did);
        const ty = ty_util().IntTypeExt.to_ty(repr_type, tcx);
        const b = ConstValue_try_to_bits_for_ty(val, tcx, typing_env, ty);
        if (b !== undefined) {
          // trace!("discriminants: {} ({:?})", b, repr_type);
          return Ok(new (ty_util().Discr)(b, ty));
        } else {
          // info!("invalid enum discriminant: {:#?}", val);
          const guar = tcx.dcx().emit_err(
            ConstEvalNonIntError_diagnostic({
              span: tcx.def_span(expr_did),
            }),
          );
          return Err(guar);
        }
      }
      case "Err": {
        const err = r._0;
        let guar: ErrorGuaranteed;
        switch (err.$) {
          case "Reported":
            guar = mir_interpret_error().ErrorGuaranteed_from_ReportedErrorInfo(err._0);
            break;
          case "TooGeneric":
            guar = tcx.dcx().span_delayed_bug(tcx.def_span(expr_did), "enum discriminant depends on generics");
            break;
        }
        return Err(guar);
      }
    }
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:666 discriminants
  *discriminants(tcx: TyCtxt): Generator<[VariantIdx, Discr]> {
    assert(this.is_enum(), "assertion failed: self.is_enum()");
    const repr_type = this.repr().discr_type();
    const initial = ty_util().IntTypeExt.initial_discriminant(repr_type, tcx);
    let prev_discr: Discr | undefined = undefined;
    const variants = this.variants();
    for (let i = 0; i < variants.length; i++) {
      const v = (variants[i]!);
      let discr: Discr = prev_discr === undefined ? initial : prev_discr.wrap_incr(tcx);
      if (v.discr.$ === "Explicit") {
        const expr_did = v.discr._0;
        const new_discr = this.eval_explicit_discr(tcx, expr_did);
        if (new_discr.$ === "Ok") {
          discr = new_discr._0;
        }
      }
      prev_discr = discr;

      yield [i as VariantIdx, discr];
    }
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:688 variant_range
  variant_range(): Range<VariantIdx> {
    return { start: FIRST_VARIANT, end: this.variants().length as VariantIdx };
  }

  /// Computes the discriminant value used by a specific variant.
  /// Unlike `discriminants`, this is (amortized) constant-time,
  /// only doing at most one query for evaluating an explicit
  /// discriminant (the last one before the requested variant),
  /// assuming there are no constant-evaluation errors there.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:698 discriminant_for_variant
  discriminant_for_variant(tcx: TyCtxt, variant_index: VariantIdx): Discr {
    assert(this.is_enum(), "assertion failed: self.is_enum()");
    const [val, offset] = this.discriminant_def_for_variant(variant_index);
    let explicit_value: Discr;
    let ok: Discr | undefined;
    if (val !== undefined) {
      const expr_did = val;
      const r = this.eval_explicit_discr(tcx, expr_did);
      if (r.$ === "Ok") ok = r._0;
    }
    if (ok !== undefined) {
      explicit_value = ok;
    } else {
      explicit_value = ty_util().IntTypeExt.initial_discriminant(this.repr().discr_type(), tcx);
    }
    return explicit_value.checked_add(tcx, BigInt(offset))[0];
  }

  /// Yields a `DefId` for the discriminant and an offset to add to it
  /// Alternatively, if there is no explicit discriminant, returns the
  /// inferred discriminant directly.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:718 discriminant_def_for_variant
  discriminant_def_for_variant(variant_index: VariantIdx): [DefId | undefined, number] {
    assert(!(this.variants().length === 0), "assertion failed: !self.variants().is_empty()");
    let explicit_index: number = variant_index;
    let expr_did: DefId | undefined;
    for (;;) {
      const discr = this.variant(explicit_index as VariantIdx).discr;
      if (discr.$ === "Relative" && discr._0 === 0) {
        expr_did = undefined;
        break;
      } else if (discr.$ === "Relative") {
        const distance = discr._0;
        // PORT: `u32` subtraction; overflow panics in debug builds only (rustc ships without them).
        explicit_index = (explicit_index - distance) >>> 0;
      } else {
        const did = discr._0;
        expr_did = did;
        break;
      }
    }
    return [expr_did, (variant_index - explicit_index) >>> 0];
  }

  // rustc: compiler/rustc_middle/src/ty/adt.rs:740 destructor
  destructor(tcx: TyCtxt): Destructor | undefined {
    // PORT: the `adt_destructor` query value is `unknown` in queries.gen.ts (`Option<Destructor>`).
    return tcx.adt_destructor(this.did()) as Destructor | undefined;
  }

  // FIXME: consider combining this method with `AdtDef::destructor` and removing
  // this version
  // rustc: compiler/rustc_middle/src/ty/adt.rs:746 async_destructor
  async_destructor(tcx: TyCtxt): AsyncDestructor | undefined {
    // PORT: the `adt_async_destructor` query value is `unknown` in queries.gen.ts (`Option<AsyncDestructor>`).
    return tcx.adt_async_destructor(this.did()) as AsyncDestructor | undefined;
  }

  /// If this ADT is a struct, returns a type such that `Self: {Meta,Pointee,}Sized` if and only
  /// if that type is `{Meta,Pointee,}Sized`, or `None` if this ADT is always
  /// `{Meta,Pointee,}Sized`.
  // rustc: compiler/rustc_middle/src/ty/adt.rs:753 sizedness_constraint
  sizedness_constraint(tcx: TyCtxt, sizedness: SizedTraitKind): EarlyBinder<Ty> | undefined {
    if (this.is_struct()) {
      // PORT: the `adt_sizedness_constraint` query value is `unknown` in queries.gen.ts.
      return tcx.adt_sizedness_constraint([this.did(), sizedness]) as EarlyBinder<Ty> | undefined;
    } else {
      return undefined;
    }
  }
}

// ---- AdtKind -------------------------------------------------------------------------------------------------------

export type AdtKind = "Struct" | "Union" | "Enum";
export const AdtKind = {
  Struct: "Struct",
  Union: "Union",
  Enum: "Enum",

  // rustc: compiler/rustc_middle/src/ty/adt.rs:343 article
  article(self: AdtKind): string {
    switch (self) {
      case "Struct":
        return "a";
      // https://english.stackexchange.com/a/266324
      case "Union":
        return "a";
      case "Enum":
        return "an";
    }
  },
} as const;
/** `#[derive(Debug)]` */
export const debug_AdtKind: Debug<AdtKind> = (v) => v;

/** PORT(decls): pending rustc_session code_stats.rs:54 `DataTypeKind` (a fieldless enum; PORTING §5 shape). */
export type DataTypeKind = "Struct" | "Union" | "Enum" | "Closure" | "Coroutine";

// `impl From<AdtKind> for DataTypeKind`
// rustc: compiler/rustc_middle/src/ty/adt.rs:333 from
export function DataTypeKind_from_AdtKind(val: AdtKind): DataTypeKind {
  switch (val) {
    case "Struct":
      return "Struct";
    case "Union":
      return "Union";
    case "Enum":
      return "Enum";
  }
}

// ---- views of pending types (module comment) ----------------------------------------------------------------------

/** PORT (init order): ty/mod.ts imports modules that import this one back, and ty/util.ts is an extension module;
 * both are reached lazily (merge-w15b). */
function ty_mod(): typeof import("./mod.ts") {
  return (ty_mod__m ??= require("./mod.ts") as typeof import("./mod.ts"));
}
var ty_mod__m: typeof import("./mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function valtree_(): typeof import("./consts/valtree.ts") {
  return (valtree___m ??= require("./consts/valtree.ts") as typeof import("./consts/valtree.ts"));
}
var valtree___m: typeof import("./consts/valtree.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function ty_util(): typeof import("./util.ts") {
  return (ty_util__m ??= require("./util.ts") as typeof import("./util.ts"));
}
var ty_util__m: typeof import("./util.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** `Option<DefId> == Some(cid)` */
function eq_Option_DefId(a: DefId | undefined, b: DefId): boolean {
  return a !== undefined && DefId_eq(a, b);
}

// ---- stand-ins for fns of other upstream files that are not ported yet (not markers; repoint when they land) ----

/** PORT: stand-in for `impl HasAttrs for DefId` (ty/mod.rs:2349, lane ty-mod): the upstream body. */
export 

/** `mir::ConstValue` */
type ConstValue = import("../mir/consts.ts").ConstValue;
/** `ConstValue::try_to_bits_for_ty` (mir/consts.rs, ported by mir-body-b), read lazily (init order, module comment). */
function ConstValue_try_to_bits_for_ty(self: ConstValue, tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): bigint | undefined {
  return mir_consts().ConstValue.try_to_bits_for_ty(self, tcx, typing_env, ty);
}
function mir_consts(): typeof import("../mir/consts.ts") {
  return (mir_consts__m ??= require("../mir/consts.ts") as typeof import("../mir/consts.ts"));
}
var mir_consts__m: typeof import("../mir/consts.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** mir/interpret/error.ts (`From<ReportedErrorInfo> for ErrorGuaranteed`), read lazily (init order, module comment). */
function mir_interpret_error(): typeof import("../mir/interpret/error.ts") {
  return (mir_interpret_error__m ??= require("../mir/interpret/error.ts") as typeof import("../mir/interpret/error.ts"));
}
var mir_interpret_error__m: typeof import("../mir/interpret/error.ts") | undefined;

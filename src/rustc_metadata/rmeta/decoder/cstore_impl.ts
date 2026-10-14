// Port of compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs.
//
// PORT:
// - `trait ProcessQueryValue<'tcx, T>`: each impl is a value (`ProcessQueryValue_<impl>`). Rust picks the impl
//   statically from (decoded type, `ProvidedValue`); here each `provide!` entry names it (`process`). The
//   choice is checked against the pinned table and query types by cstore_impl.test.ts.
// - `provide_one!` / `provide!` (macros): the invocation at line 230 is the `PROVIDE_EXTERN` table below, in
//   upstream order: `name: [IntoArgs impl, arm]`. An arm is either a `{ table }` / `{ table_defaulted_array }` /
//   `{ table_direct }` descriptor (`TableArm`: the table's `FixedSizeEncoding`, its element's `decode` and the
//   `ProcessQueryValue` impl), or the `$compute` block as `(tcx, def_id, other, cdata) => ..`. `provide_one`
//   builds the macro's `fn $name` from it; `provide_extern` (line 168) installs them all.
// - `trait IntoArgs`: each impl is a value (`IntoArgs_<Key>`).
// - Arenas are erased (`tcx.arena.alloc(x)` is `x`, `alloc_from_iter` collects into an array), as in
//   rustc_middle's queries.gen.ts (`ProvidedValue` = `Value`).
// - `DefIdMap` / `FxIndexMap<DefId, _>` values are `KeyedMap(DefId_hash_key)` (src/rust_ts/keyed.ts).
// - Element types with no TS `Decodable` yet decode through `decode_unported(<type>)`, which stops at
//   `unported(..)` naming the type.
// - The `impl CStore` block (line 629) and `impl CrateStore for CStore` (line 737) are attached to creader.ts's
//   `CStore.prototype` (PORTING section 5, "Methods defined in another file"; loaded by ../../lib.ts after
//   creader.ts).
import type { AllocatorKind } from "../../../rustc_ast/expand/allocator.ts";
import type { DiagnosticItems } from "../../../rustc_attr_ir/diagnostic_items.ts";
import { clone_ExternCrate, ExternCrate, type ForeignModule, type NativeLib } from "../../../rustc_crate_store/lib.ts";
import { Res } from "../../../rustc_hir/def.ts";
import type { CtorKind, DefKind } from "../../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathHash } from "../../../rustc_hir_id/definitions.ts";
import type { AmbigModChild, ModChild } from "../../../rustc_middle/middle/resolve.ts";
import { Reexport } from "../../../rustc_middle/middle/resolve.ts";
import type { ExternProviders, ExternQuery, QueryTypes } from "../../../rustc_middle/queries.gen.ts";
import { DefId_hash_key } from "../../../rustc_middle/query/caches.ts";
import type { LocalCrate } from "../../../rustc_middle/query/keys.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Visibility } from "../../../rustc_middle/ty/mod.ts";
import type { Providers } from "../../../rustc_middle/util/mod.ts";
import { type Decodable, decode_Option, decode_String, decode_Vec } from "../../../rustc_serialize/serialize.ts";
import { CrateNum, DefId, DefId_eq, LOCAL_CRATE, type ModId, type StableCrateId, debug_CrateNum, debug_DefId, debug_StableCrateId } from "../../../rustc_span/def_id.ts";
import { decode_Ident } from "../../../rustc_span/decodable.gen.ts";
import type { ExpnId } from "../../../rustc_span/hygiene.ts";
import { decode_Span, type Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { kw, type Symbol } from "../../../rustc_span/symbol.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, panic, unported } from "../../../std/panic.ts";
import { Ok } from "../../../std/result.ts";
// rmeta-ty imports
import { decode_Clause, decode_List_BoundVariableKind, decode_Ty } from "../../../rustc_middle/ty/codec.ts";
import { type CoerceUnsizedInfo, decode_CoerceUnsizedInfo } from "../../../rustc_middle/ty/adjustment.ts";
import type { Clause } from "../../../rustc_middle/ty/predicate.ts";
import { decode_tuple } from "../../../rustc_serialize/serialize.ts";
import { type Binder, decode_EarlyBinder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { decode_AnonConstKind, decode_ConstKind } from "../../../rustc_type_ir/const_kind.ts";
import { decode_Variance } from "../../../rustc_type_ir/lib.ts";
import { decode_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { decode_Binder, decode_Const } from "../../../rustc_type_ir/serialize.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { decode_FnSig, type FnSig } from "../../../rustc_type_ir/ty_kind.ts";
// end rmeta-ty imports
import { CStore, type LoadedMacro } from "../../creader.ts";
import type { CrateMetadata, DecodeIterator, MetadataDecodeContext, SimplifiedType } from "../decoder.ts";
import { decode_Deprecation } from "../../../rustc_attr_ir/data_structures.ts";
import { decode_Generics } from "../../../rustc_middle/decodable.gen.ts";
import { decode_ConstStability, decode_DefaultBodyStability, decode_Stability } from "../../../rustc_attr_ir/stability.ts";
import { AttrFlags, type LazyArray, type LazyTable, type LazyTables, type LazyValue, type RawDefId } from "../mod.ts";
import {
  type FixedSizeEncoding,
  fse_Asyncness,
  fse_bool,
  fse_Constness,
  fse_Defaultness,
  fse_LazyArray,
  fse_Option_CoroutineKind,
  fse_Option_LazyArray,
  fse_Option_LazyValue,
  fse_Option_RawDefId,
} from "../table.ts";

declare module "../../creader.ts" {
  interface CStore {
    // impl CStore (cstore_impl.rs:629)
    ctor_untracked(tcx: TyCtxt, def: DefId): [CtorKind, DefId] | undefined;
    load_macro_untracked(tcx: TyCtxt, id: DefId): LoadedMacro;
    def_span_untracked(tcx: TyCtxt, def_id: DefId): Span;
    def_kind_untracked(def: DefId): DefKind;
    expn_that_defined_untracked(tcx: TyCtxt, def_id: DefId): ExpnId;
    ambig_module_children_untracked(tcx: TyCtxt, def_id: DefId): Iterable<AmbigModChild>;
    num_def_ids_untracked(cnum: CrateNum): number;
    get_proc_macro_quoted_span_untracked(tcx: TyCtxt, cnum: CrateNum, id: number): Span;
    set_used_recursively(cnum: CrateNum): void;
    update_extern_crate(cnum: CrateNum, name: Symbol, extern_crate: ExternCrate): void;
    update_transitive_extern_crate_diagnostics(cnum: CrateNum, extern_crate: ExternCrate): void;
    // impl CrateStore for CStore (cstore_impl.rs:737)
    as_any(): unknown;
    untracked_as_any(): unknown;
    crate_name(cnum: CrateNum): Symbol;
    stable_crate_id(cnum: CrateNum): StableCrateId;
    def_key(def: DefId): DefKey;
    def_path(def: DefId): DefPath;
    def_path_hash(def: DefId): DefPathHash;
  }
}

// ---- trait ProcessQueryValue ---------------------------------------------------------------------------------

/** `trait ProcessQueryValue<'tcx, T>` (`Self` = `S`). PORT: each impl below is a value; see the header. */
export interface ProcessQueryValue<S, T> {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:33 process_decoded
  process_decoded(self: S, _tcx: TyCtxt, _err: () => never): T;
}

/** `impl<T> ProcessQueryValue<'_, T> for T` */
export const ProcessQueryValue_T: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:38 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, _err: () => never): unknown {
    return self;
  },
};

// The `TypeVisitable` bound here is merely for `EarlyBinder`'s rigidness check.
/** `impl<'tcx, T: TypeVisitable<TyCtxt<'tcx>>> ProcessQueryValue<'tcx, ty::EarlyBinder<'tcx, T>> for T` */
export const ProcessQueryValue_EarlyBinder: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:46 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, _err: () => never): unknown {
    return EarlyBinder.bind_no_rigid_aliases(self);
  },
};

/** `impl<T> ProcessQueryValue<'_, T> for Option<T>` */
export const ProcessQueryValue_Option_T: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:53 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, err: () => never): unknown {
    if (self !== undefined) {
      const value = self;
      return value;
    } else {
      return err();
    }
  },
};

/** `impl<'tcx, T: ArenaAllocatable<'tcx>> ProcessQueryValue<'tcx, &'tcx T> for Option<T>` */
export const ProcessQueryValue_Option_ref_T: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:60 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, err: () => never): unknown {
    if (self !== undefined) {
      const value = self;
      // PORT: `tcx.arena.alloc(value)`: arenas are erased.
      return value;
    } else {
      return err();
    }
  },
};

/** `impl<T, E> ProcessQueryValue<'_, Result<Option<T>, E>> for Option<T>` */
export const ProcessQueryValue_Option_Result: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:67 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, _err: () => never): unknown {
    return Ok(self);
  },
};

/** `impl<'tcx, D: Decoder, T: Copy + Decodable<D>> ProcessQueryValue<'tcx, &'tcx [T]> for Option<DecodeIterator<T, D>>` */
export const ProcessQueryValue_DecodeIterator_slice: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:76 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, err: () => never): unknown {
    if (self !== undefined) {
      const iter = self as DecodeIterator<unknown, MetadataDecodeContext>;
      // tcx.arena.alloc_from_iter(iter)
      return [...iter];
    } else {
      return err();
    }
  },
};

/** `impl<'tcx, D: Decoder, T: Copy + Decodable<D>> ProcessQueryValue<'tcx, Option<&'tcx [T]>> for Option<DecodeIterator<T, D>>` */
export const ProcessQueryValue_DecodeIterator_Option_slice: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:85 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, _err: () => never): unknown {
    if (self !== undefined) {
      const iter = self as DecodeIterator<unknown, MetadataDecodeContext>;
      // Some(&*tcx.arena.alloc_from_iter(iter))
      return [...iter];
    } else {
      return undefined;
    }
  },
};

/** `impl ProcessQueryValue<'_, Option<DeprecationEntry>> for Option<Deprecation>` */
export const ProcessQueryValue_Deprecation: ProcessQueryValue<unknown, unknown> = {
  // #[inline(always)]
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:92 process_decoded
  process_decoded(self: unknown, _tcx: TyCtxt, _err: () => never): unknown {
    // self.map(DeprecationEntry::external)
    if (self === undefined) return undefined;
    return unported("rustc_middle::middle::stability::DeprecationEntry::external");
  },
};

// ---- macro_rules! provide_one / provide -----------------------------------------------------------------------

/** `($cdata, $tcx)`, the `MetaDecoder` of `lazy.decode(($cdata, $tcx))`. */
type CdataTcx = [CrateMetadata, TyCtxt];

/**
 * `.map(|lazy| lazy.decode(($cdata, $tcx)))`: the `decode` of the table's element type (`LazyValue<T>`,
 * `LazyArray<T>` or `RawDefId`). PORT: `what` is the element type at the pin (`T` of `LazyValue<T>` /
 * `LazyArray<T>`), checked by cstore_impl.test.ts against `define_tables!`.
 */
export interface DecodeLazy {
  readonly lazy: "LazyValue" | "LazyArray" | "RawDefId";
  readonly what: string;
  decode(lazy: unknown, meta: CdataTcx): unknown;
}

/** `LazyValue<T>::decode((cdata, tcx))` with `T`'s `Decodable`. */
function lazy_value<T>(what: string, decode_T: Decodable<T, MetadataDecodeContext>): DecodeLazy {
  return { lazy: "LazyValue", what, decode: (lazy, meta) => (lazy as LazyValue<T>).decode(meta, decode_T) };
}

/** `LazyArray<T>::decode((cdata, tcx))` with `T`'s `Decodable` (a `DecodeIterator`). */
function lazy_array<T>(what: string, decode_T: Decodable<T, MetadataDecodeContext>): DecodeLazy {
  return { lazy: "LazyArray", what, decode: (lazy, meta) => (lazy as LazyArray<T>).decode(meta, decode_T) };
}

/** `RawDefId::decode((cdata, tcx))` (mod.rs:360, "This exists so that `provide_one!` is happy"). */
const raw_def_id: DecodeLazy = { lazy: "RawDefId", what: "RawDefId", decode: (lazy, meta) => (lazy as RawDefId).decode(meta) };

/** The `Decodable` of an element type that has no TS port yet. */
function decode_unported(what: string): Decodable<never, MetadataDecodeContext> {
  return (): never => unported(`rustc_metadata::rmeta::decoder::cstore_impl: Decodable for ${what}`);
}

/** `(ty::Clause<'static>, Span)`: the tuple impl over `Decodable for Clause` (rustc_middle ty/codec.rs:226) and `Span`. */
const decode_Clause_Span: Decodable<[Clause, Span], MetadataDecodeContext> = (d) => decode_tuple(d, decode_Clause, decode_Span);
/** `ty::PolyFnSig` = `Binder<FnSig>`: rustc_type_ir serialize.rs `impl_binder_encode_decode!`. */
const decode_PolyFnSig: Decodable<Binder<FnSig>, MetadataDecodeContext> = (d) => decode_Binder(d, decode_FnSig, decode_List_BoundVariableKind);
/** `Decodable for ty::Const` (rustc_type_ir serialize.rs:130). */
const decode_Const_: Decodable<Const, MetadataDecodeContext> = (d) => decode_Const(d, decode_ConstKind);

/** `impl Decodable for Symbol` (rustc_span): `d.decode_symbol()`. */
const decode_Symbol: Decodable<Symbol, MetadataDecodeContext> = (d) => d.decode_symbol();

/** One of `provide_one!`'s `{ table }` / `{ table_defaulted_array }` / `{ table_direct }` arms. */
export interface TableArm {
  readonly $: "table" | "table_defaulted_array" | "table_direct";
  /** `T: FixedSizeEncoding` of `$cdata.root.tables.$name` (`LazyTable::get`'s dictionary). */
  readonly fse: FixedSizeEncoding<unknown>;
  /** The element's `decode` (`undefined` for `table_direct`: "We don't decode `table_direct`"). */
  readonly decode: DecodeLazy | undefined;
  /** The `ProcessQueryValue` impl Rust selects for `.process_decoded(..)`. */
  readonly process: ProcessQueryValue<unknown, unknown>;
}

/** `$name => { table }` */
function table<T>(fse: FixedSizeEncoding<T>, decode: DecodeLazy, process: ProcessQueryValue<unknown, unknown>): TableArm {
  return { $: "table", fse: fse as FixedSizeEncoding<unknown>, decode, process };
}

/** `$name => { table_defaulted_array }` */
function table_defaulted_array(decode: DecodeLazy, process: ProcessQueryValue<unknown, unknown>): TableArm {
  return { $: "table_defaulted_array", fse: fse_LazyArray as FixedSizeEncoding<unknown>, decode, process };
}

/** `$name => { table_direct }` */
function table_direct<T>(fse: FixedSizeEncoding<T>, process: ProcessQueryValue<unknown, unknown>): TableArm {
  return { $: "table_direct", fse: fse as FixedSizeEncoding<unknown>, decode: undefined, process };
}

/** `$compute` of `provide_one!` (`$tcx`, `$def_id`, `$other`, `$cdata` in scope). */
type Compute<O, V> = (tcx: TyCtxt, def_id: DefId, other: O, cdata: CrateMetadata) => V;

/** `<K as IntoArgs>::Other` */
type OtherOf<K> = K extends readonly [CrateNum, infer O] ? O : null;

/** A `provide!` entry: the key's `IntoArgs` impl and the `provide_one!` arm. */
export type ProvideEntry<N extends ExternQuery> = readonly [
  IntoArgs<QueryTypes[N]["Key"], OtherOf<QueryTypes[N]["Key"]>>,
  TableArm | Compute<OtherOf<QueryTypes[N]["Key"]>, QueryTypes[N]["ProvidedValue"]>,
];

/** `$cdata.root.tables.$name` */
function table_of(cdata: CrateMetadata, name: string): LazyTable<unknown, unknown, unknown> {
  return cdata.root.tables[name as keyof LazyTables] as LazyTable<unknown, unknown, unknown>;
}

/** The first three arms of `provide_one!` (cstore_impl.rs:98, :111, :124): each rewrites to a `$compute` block. */
function table_arm_compute(name: string, arm: TableArm): Compute<unknown, unknown> {
  const err = (def_id: DefId) => (): never => panic(`${debug_DefId(def_id, PLAIN)} does not have a ${JSON.stringify(name)}`);
  switch (arm.$) {
    case "table":
      return (tcx, def_id, _other, cdata) => {
        const lazy = table_of(cdata, name).get(arm.fse, cdata, def_id.index);
        const decoded = lazy === undefined ? undefined : arm.decode!.decode(lazy, [cdata, tcx]);
        return arm.process.process_decoded(decoded, tcx, err(def_id));
      };
    case "table_defaulted_array":
      return (tcx, def_id, _other, cdata) => {
        const lazy = table_of(cdata, name).get(arm.fse, cdata, def_id.index);
        const value = arm.fse.is_default(lazy)
          ? []
          : // $tcx.arena.alloc_from_iter(lazy.decode(($cdata, $tcx)))
            [...(arm.decode!.decode(lazy, [cdata, tcx]) as DecodeIterator<unknown, MetadataDecodeContext>)];
        return arm.process.process_decoded(value, tcx, err(def_id));
      };
    case "table_direct":
      return (tcx, def_id, _other, cdata) => {
        // We don't decode `table_direct`, since it's not a Lazy, but an actual value
        return arm.process.process_decoded(table_of(cdata, name).get(arm.fse, cdata, def_id.index), tcx, err(def_id));
      };
  }
}

/** The last arm of `provide_one!` (cstore_impl.rs:137): `fn $name<'tcx>(tcx, def_id_arg) -> ProvidedValue`. */
function provide_one<N extends ExternQuery>(name: N, entry: ProvideEntry<N>): ExternProviders[N] {
  const [into_args, arm] = entry as unknown as [IntoArgs<unknown, unknown>, TableArm | Compute<unknown, unknown>];
  const compute: Compute<unknown, unknown> = typeof arm === "function" ? arm : table_arm_compute(name, arm);
  const $name = (tcx: TyCtxt, def_id_arg: unknown): unknown => {
    const _prof_timer = tcx.prof.generic_activity(`metadata_decode_entry_${name}`);
    void _prof_timer;

    // #[allow(unused_variables)]
    const [def_id, other] = into_args.into_args(def_id_arg);
    assert(!def_id.is_local(), "assertion failed: !def_id.is_local()");

    // External query providers call `crate_hash` in order to register a dependency
    // on the crate metadata. The exception is `crate_hash` itself, which obviously
    // doesn't need to do this (and can't, as it would cause a query cycle).
    // use rustc_middle::dep_graph::DepKind;
    if (name !== "crate_hash" && tcx.dep_graph.is_fully_enabled()) {
      tcx.ensure_ok().crate_hash(def_id.krate);
    }

    const cstore = CStore.from_tcx(tcx);
    const cdata = cstore.get_crate_data(def_id.krate);

    return compute(tcx, def_id, other, cdata);
  };
  return $name as ExternProviders[N];
}

/** `fn provide_extern(providers: &mut ExternProviders)`, defined by `provide!` for the invocation at line 230. */
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:168 provide_extern
function provide_extern(providers: ExternProviders): void {
  // $(provide_one! { $tcx, $def_id, $other, $cdata, $name => { $($compute)* } })*
  const provided: Record<string, unknown> = {};
  for (const name of Object.keys(PROVIDE_EXTERN) as ExternQuery[]) {
    provided[name] = provide_one(name, PROVIDE_EXTERN[name] as ProvideEntry<typeof name>);
  }

  // *providers = ExternProviders { $($name,)* ..*providers };
  Object.assign(providers, provided);
}

// ---- trait IntoArgs ------------------------------------------------------------------------------------------

// small trait to work around different signature queries all being defined via
// the macro above.
/** `trait IntoArgs { type Other; .. }` (`Self` = `K`). PORT: each impl below is a value. */
export interface IntoArgs<K, Other> {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:185 into_args
  into_args(self: K): [DefId, Other];
}

/** `impl IntoArgs for DefId` */
export const IntoArgs_DefId: IntoArgs<DefId, null> = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:190 into_args
  into_args(self: DefId): [DefId, null] {
    return [self, null];
  },
};

/** `impl IntoArgs for ModId` */
export const IntoArgs_ModId: IntoArgs<ModId, null> = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:197 into_args
  into_args(self: ModId): [DefId, null] {
    return [self.to_def_id(), null];
  },
};

/** `impl IntoArgs for CrateNum` */
export const IntoArgs_CrateNum: IntoArgs<CrateNum, null> = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:204 into_args
  into_args(self: CrateNum): [DefId, null] {
    return [CrateNum.as_def_id(self), null];
  },
};

/** `impl IntoArgs for (CrateNum, DefId)` */
export const IntoArgs_CrateNum_DefId: IntoArgs<[CrateNum, DefId], DefId> = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:211 into_args
  into_args(self: [CrateNum, DefId]): [DefId, DefId] {
    return [CrateNum.as_def_id(self[0]), self[1]];
  },
};

/** `impl<'tcx> IntoArgs for ty::InstanceKind<'tcx>` (no `provide!` entry has this key). */
export const IntoArgs_InstanceKind: IntoArgs<unknown, null> = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:218 into_args
  into_args(_self: unknown): [DefId, null] {
    // (self.def_id(), ())
    return unported("rustc_middle::ty::InstanceKind::def_id (M3)");
  },
};

/** `impl IntoArgs for (CrateNum, SimplifiedType)` */
export const IntoArgs_CrateNum_SimplifiedType: IntoArgs<[CrateNum, SimplifiedType], SimplifiedType> = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:225 into_args
  into_args(self: [CrateNum, SimplifiedType]): [DefId, SimplifiedType] {
    return [CrateNum.as_def_id(self[0]), self[1]];
  },
};

// ---- provide! { tcx, def_id, other, cdata, .. } (cstore_impl.rs:230) -------------------------------------------

/** PORT: `ExportedSymbol<'tcx>` (rustc_middle middle/exported_symbols.rs, M3): only the variant this file matches. */
type ExportedSymbol = { readonly $: "NonGeneric"; readonly _0: DefId } | { readonly $: "Generic" | "DropGlue" | "AsyncDropGlueCtorShim" | "AsyncDropGlue" | "ThreadLocalShim" | "NoDefId" };

/** The `provide!` invocation (cstore_impl.rs:230), in upstream order. Exported for cstore_impl.test.ts. */
export const PROVIDE_EXTERN: { readonly [N in ExternQuery]?: ProvideEntry<N> } = {
  explicit_item_bounds: [IntoArgs_DefId, table_defaulted_array(lazy_array("(ty::Clause<'static>, Span)", decode_Clause_Span), ProcessQueryValue_EarlyBinder)],
  explicit_item_self_bounds: [IntoArgs_DefId, table_defaulted_array(lazy_array("(ty::Clause<'static>, Span)", decode_Clause_Span), ProcessQueryValue_EarlyBinder)],
  explicit_clauses_of: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::GenericClauses<'static>", decode_unported("ty::GenericClauses<'static>")), ProcessQueryValue_Option_T)],
  generics_of: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::Generics", decode_Generics), ProcessQueryValue_Option_T)],
  inferred_outlives_of: [IntoArgs_DefId, table_defaulted_array(lazy_array("(ty::Clause<'static>, Span)", decode_Clause_Span), ProcessQueryValue_T)],
  explicit_super_clauses_of: [IntoArgs_DefId, table_defaulted_array(lazy_array("(ty::Clause<'static>, Span)", decode_Clause_Span), ProcessQueryValue_EarlyBinder)],
  explicit_implied_clauses_of: [IntoArgs_DefId, table_defaulted_array(lazy_array("(ty::Clause<'static>, Span)", decode_Clause_Span), ProcessQueryValue_EarlyBinder)],
  type_of: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::EarlyBinder<'static, Ty<'static>>", (d) => decode_EarlyBinder(d, decode_Ty)), ProcessQueryValue_Option_T)],
  type_alias_is_checked: [IntoArgs_DefId, table_direct(fse_bool, ProcessQueryValue_T)],
  variances_of: [IntoArgs_DefId, table(fse_Option_LazyArray, lazy_array("ty::Variance", decode_Variance), ProcessQueryValue_DecodeIterator_slice)],
  fn_sig: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::EarlyBinder<'static, ty::PolyFnSig<'static>>", (d) => decode_EarlyBinder(d, decode_PolyFnSig)), ProcessQueryValue_Option_T)],
  codegen_fn_attrs: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("CodegenFnAttrs", decode_unported("CodegenFnAttrs")), ProcessQueryValue_Option_T)],
  impl_trait_header: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::ImplTraitHeader<'static>", decode_unported("ty::ImplTraitHeader<'static>")), ProcessQueryValue_Option_T)],
  impl_is_fully_generic_for_reflection: [IntoArgs_DefId, table_direct(fse_bool, ProcessQueryValue_T)],
  const_param_default: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::EarlyBinder<'static, rustc_middle::ty::Const<'static>>", (d) => decode_EarlyBinder(d, decode_Const_)), ProcessQueryValue_Option_T)],
  object_lifetime_default: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ObjectLifetimeDefault", decode_unported("ObjectLifetimeDefault")), ProcessQueryValue_Option_T)],
  thir_abstract_const: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::EarlyBinder<'static, ty::Const<'static>>", (d) => decode_EarlyBinder(d, decode_Const_)), ProcessQueryValue_Option_Result)],
  optimized_mir: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("mir::Body<'static>", decode_unported("mir::Body<'static>")), ProcessQueryValue_Option_ref_T)],
  mir_for_ctfe: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("mir::Body<'static>", decode_unported("mir::Body<'static>")), ProcessQueryValue_Option_ref_T)],
  trivial_const: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("(ConstValue, Ty<'static>)", decode_unported("(ConstValue, Ty<'static>)")), ProcessQueryValue_T)],
  closure_saved_names_of_captured_variables: [
    IntoArgs_DefId,
    // `IndexVec<FieldIdx, Symbol>` decodes as `Vec<Symbol>` (`IndexVec::from_raw`)
    table(fse_Option_LazyValue, lazy_value("IndexVec<FieldIdx, Symbol>", (d) => decode_Vec(d, decode_Symbol)), ProcessQueryValue_Option_T),
  ],
  mir_coroutine_witnesses: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("mir::CoroutineLayout<'static>", decode_unported("mir::CoroutineLayout<'static>")), ProcessQueryValue_T)],
  promoted_mir: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("IndexVec<mir::Promoted, mir::Body<'static>>", decode_unported("IndexVec<mir::Promoted, mir::Body<'static>>")), ProcessQueryValue_Option_ref_T)],
  def_span: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("Span", decode_Span), ProcessQueryValue_Option_T)],
  def_ident_span: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("Span", decode_Span), ProcessQueryValue_T)],
  lookup_stability: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("Stability", decode_Stability), ProcessQueryValue_T)],
  lookup_const_stability: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ConstStability", decode_ConstStability), ProcessQueryValue_T)],
  lookup_default_body_stability: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("DefaultBodyStability", decode_DefaultBodyStability), ProcessQueryValue_T)],
  lookup_deprecation_entry: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("Deprecation", decode_Deprecation), ProcessQueryValue_Deprecation)],
  params_in_repr: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("DenseBitSet<u32>", decode_unported("DenseBitSet<u32>")), ProcessQueryValue_Option_T)],
  def_kind: [IntoArgs_DefId, (_tcx, def_id, _other, cdata) => cdata.def_kind(def_id.index)],
  impl_parent: [IntoArgs_DefId, table(fse_Option_RawDefId, raw_def_id, ProcessQueryValue_T)],
  defaultness: [IntoArgs_DefId, table_direct(fse_Defaultness, ProcessQueryValue_T)],
  constness: [IntoArgs_DefId, table_direct(fse_Constness, ProcessQueryValue_T)],
  const_conditions: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::ConstConditions<'static>", decode_unported("ty::ConstConditions<'static>")), ProcessQueryValue_Option_T)],
  explicit_implied_const_bounds: [IntoArgs_DefId, table_defaulted_array(lazy_array("(ty::PolyTraitRef<'static>, Span)", (d) => decode_tuple(d, (d) => decode_Binder(d, decode_TraitRef, decode_List_BoundVariableKind), decode_Span)), ProcessQueryValue_EarlyBinder)],
  coerce_unsized_info: [
    IntoArgs_DefId,
    (tcx, def_id, _other, cdata) => {
      const lazy = cdata.root.tables.coerce_unsized_info.get(fse_Option_LazyValue, cdata, def_id.index) as LazyValue<CoerceUnsizedInfo> | undefined;
      return Ok(
        ProcessQueryValue_Option_T.process_decoded(lazy === undefined ? undefined : lazy.decode([cdata, tcx], decode_CoerceUnsizedInfo), tcx, () =>
          panic(`${debug_DefId(def_id, PLAIN)} does not have coerce_unsized_info`),
        ) as CoerceUnsizedInfo,
      );
    },
  ],
  mir_const_qualif: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("mir::ConstQualifs", decode_unported("mir::ConstQualifs")), ProcessQueryValue_Option_T)],
  rendered_const: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("String", decode_String), ProcessQueryValue_Option_T)],
  rendered_precise_capturing_args: [IntoArgs_DefId, table(fse_Option_LazyArray, lazy_array("PreciseCapturingArgKind<Symbol, Symbol>", decode_unported("PreciseCapturingArgKind<Symbol, Symbol>")), ProcessQueryValue_DecodeIterator_Option_slice)],
  asyncness: [IntoArgs_DefId, table_direct(fse_Asyncness, ProcessQueryValue_T)],
  fn_arg_idents: [IntoArgs_DefId, table(fse_Option_LazyArray, lazy_array("Option<Ident>", (d) => decode_Option(d, decode_Ident)), ProcessQueryValue_DecodeIterator_slice)],
  coroutine_kind: [IntoArgs_DefId, table_direct(fse_Option_CoroutineKind, ProcessQueryValue_T)],
  coroutine_for_closure: [IntoArgs_DefId, table(fse_Option_RawDefId, raw_def_id, ProcessQueryValue_Option_T)],
  coroutine_by_move_body_def_id: [IntoArgs_DefId, table(fse_Option_RawDefId, raw_def_id, ProcessQueryValue_Option_T)],
  eval_static_initializer: [
    IntoArgs_DefId,
    (tcx, def_id, _other, cdata) => {
      const lazy = cdata.root.tables.eval_static_initializer.get(fse_Option_LazyValue, cdata, def_id.index);
      if (lazy === undefined) return panic(`${debug_DefId(def_id, PLAIN)} does not have eval_static_initializer`);
      return Ok(lazy.decode([cdata, tcx], decode_unported("mir::interpret::ConstAllocation<'static>")));
    },
  ],
  trait_def: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::TraitDef", decode_unported("ty::TraitDef")), ProcessQueryValue_Option_T)],
  deduced_param_attrs: [
    IntoArgs_DefId,
    (tcx, def_id, _other, cdata) => {
      // FIXME: `deduced_param_attrs` has some sketchy encoding settings,
      // where we don't encode unless we're optimizing, doing codegen,
      // and not incremental (see `encoder.rs`). I don't think this is right!
      const lazy = cdata.root.tables.deduced_param_attrs.get(fse_Option_LazyArray, cdata, def_id.index);
      if (lazy === undefined) return [];
      return [...lazy.decode([cdata, tcx], decode_unported("DeducedParamAttrs"))];
    },
  ],
  opaque_ty_origin: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("hir::OpaqueTyOrigin<DefId>", decode_unported("hir::OpaqueTyOrigin<DefId>")), ProcessQueryValue_Option_T)],
  assumed_wf_types_for_rpitit: [IntoArgs_DefId, table(fse_Option_LazyArray, lazy_array("(Ty<'static>, Span)", (d) => decode_tuple(d, decode_Ty, decode_Span)), ProcessQueryValue_DecodeIterator_slice)],
  collect_return_position_impl_trait_in_trait_tys: [
    IntoArgs_DefId,
    (tcx, def_id, _other, cdata) => {
      const lazy = cdata.root.tables.collect_return_position_impl_trait_in_trait_tys.get(fse_Option_LazyValue, cdata, def_id.index);
      return Ok(
        ProcessQueryValue_Option_ref_T.process_decoded(lazy === undefined ? undefined : lazy.decode([cdata, tcx], decode_unported("DefIdMap<ty::EarlyBinder<'static, Ty<'static>>>")), tcx, () =>
          panic(`${debug_DefId(def_id, PLAIN)} does not have collect_return_position_impl_trait_in_trait_tys`),
        ) as Map<DefId, unknown>,
      );
    },
  ],

  associated_types_for_impl_traits_in_trait_or_impl: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("DefIdMap<Vec<DefId>>", decode_unported("DefIdMap<Vec<DefId>>")), ProcessQueryValue_Option_T)],

  visibility: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_visibility(tcx, def_id.index)],
  adt_def: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_adt_def(tcx, def_id.index)],
  adt_destructor: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::Destructor", decode_unported("ty::Destructor")), ProcessQueryValue_T)],
  adt_async_destructor: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::AsyncDestructor", decode_unported("ty::AsyncDestructor")), ProcessQueryValue_T)],
  associated_item_def_ids: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => [...cdata.get_associated_item_or_field_def_ids(tcx, def_id.index)]],
  associated_item: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_associated_item(tcx, def_id.index)],
  inherent_impls: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_inherent_implementations_for_type(tcx, def_id.index)],
  attrs_for_def: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => [...cdata.get_item_attrs(tcx, def_id.index)]],
  is_mir_available: [IntoArgs_DefId, (_tcx, def_id, _other, cdata) => cdata.is_item_mir_available(def_id.index)],
  cross_crate_inlinable: [IntoArgs_DefId, table_direct(fse_bool, ProcessQueryValue_T)],

  dylib_dependency_formats: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_dylib_dependency_formats(tcx)],
  is_private_dep: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.private_dep],
  is_panic_runtime: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.panic_runtime],
  is_compiler_builtins: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.compiler_builtins],

  // FIXME: to be replaced with externally_implementable_items below
  has_global_allocator: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.has_global_allocator],
  // FIXME: to be replaced with externally_implementable_items below
  has_alloc_error_handler: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.has_alloc_error_handler],
  // FIXME: to be replaced with externally_implementable_items below
  has_panic_handler: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.has_panic_handler],

  externally_implementable_items: [
    IntoArgs_CrateNum,
    (tcx, _def_id, _other, cdata) => {
      // PORT: `EiiMapEncodedKeyValue` = `(DefId, (EiiDecl, Vec<(DefId, EiiImpl)>))` (eii.rs:9); `EiiDecl` /
      // `EiiImpl` are not ported (`unknown`).
      const map = new KeyedMap<DefId, [unknown, Map<DefId, unknown>]>(DefId_hash_key);
      for (const [decl_did, [decl, impls]] of cdata.get_externally_implementable_items(tcx) as Iterable<[DefId, [unknown, [DefId, unknown][]]]>) {
        map.set(decl_did, [decl, new KeyedMap<DefId, unknown>(DefId_hash_key, impls)]);
      }
      return map;
    },
  ],

  is_profiler_runtime: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.profiler_runtime],
  required_panic_strategy: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.required_panic_strategy],
  panic_in_drop_strategy: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.panic_in_drop_strategy],
  // PORT: `&*tcx.arena.alloc(c)` of the `Copy` value: a copy (PORTING section 8).
  extern_crate: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => (cdata.extern_crate === undefined ? undefined : clone_ExternCrate(cdata.extern_crate))],
  is_no_builtins: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.no_builtins],
  symbol_mangling_version: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.symbol_mangling_version],
  specialization_enabled_in: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.specialization_enabled_in],
  reachable_non_generics: [
    IntoArgs_CrateNum,
    (tcx, _def_id, _other, cdata) => {
      const reachable_non_generics = new KeyedMap<DefId, unknown>(DefId_hash_key);
      for (const [exported_symbol, export_info] of tcx.exported_non_generic_symbols(cdata.cnum) as [ExportedSymbol, unknown][]) {
        if (exported_symbol.$ === "NonGeneric") {
          const def_id = exported_symbol._0;
          reachable_non_generics.set(def_id, export_info);
        }
      }

      return reachable_non_generics;
    },
  ],
  native_libraries: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => [...cdata.get_native_libraries(tcx)]],
  foreign_modules: [
    IntoArgs_CrateNum,
    (tcx, _def_id, _other, cdata) => {
      const map = new KeyedMap<DefId, ForeignModule>(DefId_hash_key);
      for (const m of cdata.get_foreign_modules(tcx)) map.set(m.def_id, m);
      return map;
    },
  ],
  crate_hash: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.hash()],
  crate_host_hash: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.host_hash],
  crate_name: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.root.header.name],
  num_extern_def_ids: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.num_def_ids()],

  extra_filename: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.unhashed.extra_filename],

  traits: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => [...cdata.get_traits(tcx)]],
  trait_impls_in_crate: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => [...cdata.get_trait_impls(tcx)]],
  implementations_of_trait: [IntoArgs_CrateNum_DefId, (tcx, _def_id, other, cdata) => cdata.get_implementations_of_trait(tcx, other)],
  // PORT: queries.gen.ts keys `crate_incoherent_impls` by `(CrateNum, unknown)` (the query key impls of `SimplifiedType` are
  // not generated); the value is the `SimplifiedType` the key was built from.
  crate_incoherent_impls: [IntoArgs_CrateNum_SimplifiedType, (tcx, _def_id, other, cdata) => cdata.get_incoherent_impls(tcx, other as SimplifiedType)],

  // PORT: the field `dep_kind` is `dep_kind_` (decoder.ts).
  crate_dep_kind: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.dep_kind_],
  module_children: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => [...cdata.get_module_children(tcx, def_id.index)]],
  lib_features: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_lib_features(tcx)],
  stability_implications: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => new Map(cdata.get_stability_implications(tcx))],
  stripped_cfg_items: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_stripped_cfg_items(tcx, cdata.cnum)],
  intrinsic_raw: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_intrinsic(tcx, def_id.index)],
  defined_lang_items: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_lang_items(tcx)],
  // PORT: the `as` casts in this table narrow decoder.ts's `unknown` declarations to the query types (queries.gen.ts).
  diagnostic_items: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_diagnostic_items(tcx) as DiagnosticItems],
  canonical_symbols: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_canonical_symbols(tcx)],
  fake_doc_items: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_fake_doc_items(tcx)],
  missing_lang_items: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_missing_lang_items(tcx)],

  missing_extern_crate_item: [
    IntoArgs_CrateNum,
    (_tcx, _def_id, _other, cdata) => {
      // matches!(cdata.extern_crate, Some(extern_crate) if !extern_crate.is_direct())
      const extern_crate = cdata.extern_crate;
      return extern_crate !== undefined && !extern_crate.is_direct();
    },
  ],

  // PORT: the field `source` is `source_` (decoder.ts); `Arc::clone` shares it.
  used_crate_source: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => cdata.source_],
  debugger_visualizers: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.get_debugger_visualizers(tcx)],

  exportable_items: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => [...cdata.get_exportable_items(tcx)]],
  stable_order_of_exportable_impls: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => new KeyedMap<DefId, number>(DefId_hash_key, cdata.get_stable_order_of_exportable_impls(tcx))],
  exported_non_generic_symbols: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.exported_non_generic_symbols(tcx) as [ExportedSymbol, unknown][]],
  exported_generic_symbols: [IntoArgs_CrateNum, (tcx, _def_id, _other, cdata) => cdata.exported_generic_symbols(tcx) as [ExportedSymbol, unknown][]],

  // PORT: `tcx.arena.alloc_path(p)` is the path itself.
  crate_extern_paths: [IntoArgs_CrateNum, (_tcx, _def_id, _other, cdata) => [...cdata.source().paths()]],
  expn_that_defined: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_expn_that_defined(tcx, def_id.index)],
  default_field: [IntoArgs_DefId, (tcx, def_id, _other, cdata) => cdata.get_default_field(tcx, def_id.index)],
  is_doc_hidden: [IntoArgs_DefId, (_tcx, def_id, _other, cdata) => AttrFlags.contains(cdata.get_attr_flags(def_id.index), AttrFlags.IS_DOC_HIDDEN)],
  doc_link_resolutions: [IntoArgs_ModId, (tcx, def_id, _other, cdata) => cdata.get_doc_link_resolutions(tcx, def_id.index)],
  doc_link_traits_in_scope: [IntoArgs_ModId, (tcx, def_id, _other, cdata) => [...cdata.get_doc_link_traits_in_scope(tcx, def_id.index)]],
  anon_const_kind: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("ty::AnonConstKind", decode_AnonConstKind), ProcessQueryValue_Option_T)],
  const_of_item: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("Option<ty::EarlyBinder<'static, ty::Const<'static>>>", (d) => decode_Option(d, (d) => decode_EarlyBinder(d, decode_Const_))), ProcessQueryValue_Option_T)],
  args_known_to_outlive_alias_params: [IntoArgs_DefId, table(fse_Option_LazyValue, lazy_value("Vec<(usize, DenseBitSet<u32>)>", decode_unported("Vec<(usize, DenseBitSet<u32>)>")), ProcessQueryValue_Option_T)],
};

// ---- provide -------------------------------------------------------------------------------------------------

/** `native_libs::relevant_lib` (native_libs.rs, not ported). */
function native_libs_relevant_lib(..._args: unknown[]): boolean {
  return unported("rustc_metadata::native_libs::relevant_lib");
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:436 provide
export function provide(providers: Providers): void {
  provide_cstore_hooks(providers);
  providers.queries = {
    ...providers.queries,
    allocator_kind: (tcx, _: null): AllocatorKind | undefined => CStore.from_tcx(tcx).allocator_kind(),
    alloc_error_handler_kind: (tcx, _: null): AllocatorKind | undefined => CStore.from_tcx(tcx).alloc_error_handler_kind(),
    is_private_dep: (_tcx, _: LocalCrate) => false,
    native_library: (tcx, id) => {
      for (const lib of tcx.native_libraries(id.krate) as NativeLib[]) {
        if (!native_libs_relevant_lib(tcx.sess, lib)) continue;
        const found = ((): boolean => {
          const fm_id = lib.foreign_module;
          if (fm_id === undefined) {
            return false;
          }
          const map = tcx.foreign_modules(id.krate) as Map<DefId, ForeignModule>;
          const fm = map.get(fm_id);
          if (fm === undefined) return panic("failed to find foreign module");
          return fm.foreign_items.some((item) => DefId_eq(item, id));
        })();
        if (found) return lib;
      }
      return undefined;
    },
    native_libraries: (_tcx, _) => unported("rustc_metadata::native_libs::collect"),
    foreign_modules: (_tcx, _) => unported("rustc_metadata::foreign_modules::collect"),
    externally_implementable_items: (_tcx, _) => unported("rustc_metadata::eii::collect"),

    // Returns a map from a sufficiently visible external item (i.e., an
    // external item that is visible from at least one local module) to a
    // sufficiently visible parent (considering modules that re-export the
    // external item to be parents).
    visible_parent_map: (tcx, _: null) => {
      // use std::collections::hash_map::Entry;
      // use std::collections::vec_deque::VecDeque;

      const visible_parent_map: Map<DefId, DefId> = new KeyedMap<DefId, DefId>(DefId_hash_key);
      // This is a secondary visible_parent_map, storing the DefId of
      // parents that re-export the child as `_`, module parents
      // which are `#[doc(hidden)]`, or `use` items that are themselves
      // `#[doc(hidden)]`. Since we prefer paths that don't do this,
      // merge this map at the end, only if we're missing keys from
      // the former.
      // This is a rudimentary check that does not catch all cases,
      // just the easiest.
      const fallback_map: Map<DefId, DefId> = new KeyedMap<DefId, DefId>(DefId_hash_key);

      // Issue 46112: We want the map to prefer the shortest
      // paths when reporting the path to an item. Therefore we
      // build up the map via a breadth-first search (BFS),
      // which naturally yields minimal-length paths.
      //
      // Note that it needs to be a BFS over the whole forest of
      // crates, not just each individual crate; otherwise you
      // only get paths that are locally minimal with respect to
      // whatever crate we happened to encounter first in this
      // traversal, but not globally minimal across all crates.
      const bfs_queue: DefId[] = [];

      for (const cnum of tcx.crates(null)) {
        // Ignore crates without a corresponding local `extern crate` item.
        if (tcx.missing_extern_crate_item(cnum)) {
          continue;
        }

        bfs_queue.push(CrateNum.as_def_id(cnum));
      }

      const add_child = (bfs_queue: DefId[], child: ModChild, parent: DefId): void => {
        if (!Visibility.is_public(child.vis)) {
          return;
        }

        const def_id = Res.opt_def_id(child.res);
        if (def_id !== undefined) {
          let fallback = false;

          if (child.ident.name === kw.Underscore) {
            fallback = true;
          }

          if (tcx.is_doc_hidden(parent)) {
            fallback = true;
          }

          // If the re-export itself is `#[doc(hidden)]`, deprioritize it.
          // See PR #99698 for the case where the *parent* is doc-hidden.
          const first = child.reexport_chain[0];
          const id = first === undefined ? undefined : Reexport.id(first);
          if (id !== undefined && tcx.is_doc_hidden(id)) {
            fallback = true;
          }

          // match visible_parent_map.entry(def_id)
          const occupied = visible_parent_map.get(def_id);
          if (occupied !== undefined) {
            // Entry::Occupied(mut entry)
            if (!fallback) {
              // If `child` is defined in crate `cnum`, ensure
              // that it is mapped to a parent in `cnum`.
              if (def_id.is_local() && occupied.is_local()) {
                visible_parent_map.set(def_id, parent);
              }
            }
          } else {
            // Entry::Vacant(entry)
            if (!fallback) {
              visible_parent_map.set(def_id, parent);
            }

            // Make sure that we have not already explored this child
            // through a previous fallback entry further up the BFS,
            // in which case we do not want to put it back into the BFS queue,
            // nor record a new fallback parent.
            if (fallback_map.has(def_id)) {
              return;
            }

            if (fallback) {
              // We do all of the same steps to fallback entries as to
              // preferred entries, except for recording them in a separate map.
              // It is important to not return early in the fallback cases to
              // ensure that we extend the BFS to the children of fallback items.
              fallback_map.set(def_id, parent);
            }

            if (Res.module_like_def_id(child.res) !== undefined) {
              bfs_queue.push(def_id);
            }
          }
        }
      };

      for (let def = bfs_queue.shift(); def !== undefined; def = bfs_queue.shift()) {
        for (const child of tcx.module_children(def)) {
          add_child(bfs_queue, child, def);
        }
      }

      // Fill in any missing entries with the less preferable path.
      // If this path re-exports the child as `_`, we still use this
      // path in a diagnostic that suggests importing `::*`.
      // We must extend the fallback map with items from the visible parent map
      // as the extend call overrides existing entries from the latter map,
      // which we prefer over fallback entries.
      // FIXME: The Unord* APIs lack an efficient way of merging
      //        the values of one map for only the missing keys of the other map,
      //        which is required to merge the fallback map into the visible parent map.
      //        In the meantime, use an "ordered" map internally for fallback entries.
      // #[allow(rustc::potential_query_instability)]
      for (const [child, parent] of fallback_map) {
        // visible_parent_map.entry(child).or_insert(parent);
        if (!visible_parent_map.has(child)) visible_parent_map.set(child, parent);
      }

      return visible_parent_map;
    },

    dependency_formats: (_tcx, _: null) => unported("rustc_metadata::dependency_format::calculate"),
    has_global_allocator: (tcx, _: LocalCrate) => CStore.from_tcx(tcx).has_global_allocator(),
    has_alloc_error_handler: (tcx, _: LocalCrate) => CStore.from_tcx(tcx).has_alloc_error_handler(),
    postorder_cnums: (tcx, _: null) => {
      // tcx.arena.alloc_from_iter(..into_iter())
      return [...CStore.from_tcx(tcx).crate_dependencies_in_postorder(LOCAL_CRATE)];
    },
    crates: (tcx, _: null) => {
      // The loaded-crate list is now frozen in the query cache; stop
      // mutating the cstore and stable crate id map from here on.
      tcx.untracked().freeze_cstore();
      return CStore.from_tcx(tcx)
        .iter_crate_data()
        .map(([cnum, _]) => cnum);
    },
    used_crates: (tcx, _: null) => {
      // The loaded-crate list is now frozen in the query cache; stop
      // mutating the cstore and stable crate id map from here on.
      tcx.untracked().freeze_cstore();
      const used: CrateNum[] = [];
      for (const [cnum, data] of CStore.from_tcx(tcx).iter_crate_data()) {
        if (data.used()) used.push(cnum);
      }
      return used;
    },
    duplicate_crate_names: (tcx, c: CrateNum) => {
      const name = tcx.crate_name(c);
      return tcx.crates(null).filter((k) => tcx.crate_name(k) === name && k !== c);
    },
  };
  provide_extern(providers.extern_queries);
}

// ---- impl CStore ---------------------------------------------------------------------------------------------

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:630 ctor_untracked
CStore.prototype.ctor_untracked = function (this: CStore, tcx: TyCtxt, def: DefId): [CtorKind, DefId] | undefined {
  return this.get_crate_data(def.krate).get_ctor(tcx, def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:634 load_macro_untracked
CStore.prototype.load_macro_untracked = function (this: CStore, tcx: TyCtxt, id: DefId): LoadedMacro {
  const sess = tcx.sess;
  const _prof_timer = sess.prof.generic_activity("metadata_load_macro");
  void _prof_timer;

  const cdata = this.get_crate_data(id.krate);
  if (cdata.root.is_proc_macro_crate()) {
    return { $: "ProcMacro", _0: cdata.load_proc_macro(tcx, id.index) };
  } else {
    return {
      $: "MacroDef",
      def: cdata.get_macro(tcx, id.index),
      ident: cdata.item_ident(tcx, id.index),
      attrs: [...cdata.get_item_attrs(tcx, id.index)],
      span: cdata.get_span(tcx, id.index),
      edition: cdata.root.edition,
    };
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:652 def_span_untracked
CStore.prototype.def_span_untracked = function (this: CStore, tcx: TyCtxt, def_id: DefId): Span {
  return this.get_crate_data(def_id.krate).get_span(tcx, def_id.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:656 def_kind_untracked
CStore.prototype.def_kind_untracked = function (this: CStore, def: DefId): DefKind {
  return this.get_crate_data(def.krate).def_kind(def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:660 expn_that_defined_untracked
CStore.prototype.expn_that_defined_untracked = function (this: CStore, tcx: TyCtxt, def_id: DefId): ExpnId {
  return this.get_crate_data(def_id.krate).get_expn_that_defined(tcx, def_id.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:664 ambig_module_children_untracked
CStore.prototype.ambig_module_children_untracked = function (this: CStore, tcx: TyCtxt, def_id: DefId): Iterable<AmbigModChild> {
  return this.get_crate_data(def_id.krate).get_ambig_module_children(tcx, def_id.index);
};

/// Only public-facing way to traverse all the definitions in a non-local crate.
/// Critically useful for this third-party project: <https://github.com/hacspec/hacspec>.
/// See <https://github.com/rust-lang/rust/pull/85889> for context.
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:675 num_def_ids_untracked
CStore.prototype.num_def_ids_untracked = function (this: CStore, cnum: CrateNum): number {
  return this.get_crate_data(cnum).num_def_ids();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:679 get_proc_macro_quoted_span_untracked
CStore.prototype.get_proc_macro_quoted_span_untracked = function (this: CStore, tcx: TyCtxt, cnum: CrateNum, id: number): Span {
  return this.get_crate_data(cnum).get_proc_macro_quoted_span(tcx, id);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:688 set_used_recursively
CStore.prototype.set_used_recursively = function (this: CStore, cnum: CrateNum): void {
  const cdata = this.get_crate_data_mut(cnum);
  if (!cdata.used_) {
    cdata.used_ = true;
    // `mem::take(&mut cdata.cnum_map)`
    const cnum_map = cdata.cnum_map;
    cdata.cnum_map = [];
    for (const dep_cnum of cnum_map) {
      this.set_used_recursively(dep_cnum);
    }
    this.get_crate_data_mut(cnum).cnum_map = cnum_map;
  }
};

/// Track how an extern crate has been loaded. Called after resolving an import in the local crate.
///
/// * the `name` is for [`Self::set_resolved_extern_crate_name`] saving `--extern name=`
/// * `extern_crate` is for diagnostics
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:704 update_extern_crate
CStore.prototype.update_extern_crate = function (this: CStore, cnum: CrateNum, name: Symbol, extern_crate: ExternCrate): void {
  // debug_assert_eq!(extern_crate.dependency_of, LOCAL_CRATE, "this function should not be called on transitive dependencies");
  this.set_resolved_extern_crate_name(name, cnum);
  this.update_transitive_extern_crate_diagnostics(cnum, extern_crate);
};

/// `CrateMetadata` uses `ExternCrate` only for diagnostics
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:719 update_transitive_extern_crate_diagnostics
CStore.prototype.update_transitive_extern_crate_diagnostics = function (this: CStore, cnum: CrateNum, extern_crate: ExternCrate): void {
  const cdata = this.get_crate_data_mut(cnum);
  if (cdata.update_extern_crate_diagnostics(extern_crate)) {
    // Propagate the extern crate info to dependencies if it was updated.
    const extern_crate_ = new ExternCrate(extern_crate.src, extern_crate.span, extern_crate.path_len, cnum);
    // `mem::take(&mut cdata.cnum_map)`
    const cnum_map = cdata.cnum_map;
    cdata.cnum_map = [];
    for (const dep_cnum of cnum_map) {
      // PORT: `ExternCrate: Copy` -> a clone per call (PORTING section 8).
      this.update_transitive_extern_crate_diagnostics(dep_cnum, clone_ExternCrate(extern_crate_));
    }
    this.get_crate_data_mut(cnum).cnum_map = cnum_map;
  }
};

// ---- impl CrateStore for CStore ------------------------------------------------------------------------------

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:738 as_any
CStore.prototype.as_any = function (this: CStore): unknown {
  return this;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:742 untracked_as_any
CStore.prototype.untracked_as_any = function (this: CStore): unknown {
  return this;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:746 crate_name
CStore.prototype.crate_name = function (this: CStore, cnum: CrateNum): Symbol {
  return this.get_crate_data(cnum).root.header.name;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:750 stable_crate_id
CStore.prototype.stable_crate_id = function (this: CStore, cnum: CrateNum): StableCrateId {
  return this.get_crate_data(cnum).root.stable_crate_id_;
};

/// Returns the `DefKey` for a given `DefId`. This indicates the
/// parent `DefId` as well as some idea of what kind of data the
/// `DefId` refers to.
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:757 def_key
CStore.prototype.def_key = function (this: CStore, def: DefId): DefKey {
  return this.get_crate_data(def.krate).def_key(def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:761 def_path
CStore.prototype.def_path = function (this: CStore, def: DefId): DefPath {
  return this.get_crate_data(def.krate).def_path(def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:765 def_path_hash
CStore.prototype.def_path_hash = function (this: CStore, def: DefId): DefPathHash {
  return this.get_crate_data(def.krate).def_path_hash(def.index);
};

// ---- provide_cstore_hooks ------------------------------------------------------------------------------------

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:770 provide_cstore_hooks
function provide_cstore_hooks(providers: Providers): void {
  providers.hooks.def_path_hash_to_def_id_extern = (tcx, hash, stable_crate_id) => {
    // If this is a DefPathHash from an upstream crate, let the CrateStore map
    // it to a DefId.
    const cstore = CStore.from_tcx(tcx);
    const cnum_ = tcx.untracked().stable_crate_ids.get(stable_crate_id);
    const cnum = cnum_ !== undefined ? cnum_ : bug(`uninterned StableCrateId: ${debug_StableCrateId(stable_crate_id, PLAIN)}`);
    if (cnum === LOCAL_CRATE) {
      panic(`assertion \`left != right\` failed\n  left: ${debug_CrateNum(cnum, PLAIN)}\n right: ${debug_CrateNum(LOCAL_CRATE, PLAIN)}`);
    }
    const def_index = cstore.get_crate_data(cnum).def_path_hash_to_def_index(hash);
    if (def_index === undefined) return undefined;
    return new DefId(def_index, cnum);
  };

  providers.hooks.expn_hash_to_expn_id = (tcx, cnum, index_guess, hash) => {
    const cstore = CStore.from_tcx(tcx);
    return cstore.get_crate_data(cnum).expn_hash_to_expn_id(tcx, index_guess, hash);
  };
  providers.hooks.import_source_files = (tcx, cnum) => {
    const cstore = CStore.from_tcx(tcx);
    const cdata = cstore.get_crate_data(cnum);
    for (let file_index = 0; file_index < cdata.root.source_map.size(); file_index++) {
      cdata.imported_source_file(tcx, file_index);
    }
    return null;
  };
}

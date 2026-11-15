// Port of compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs (lane cg-di-b, plan-m7 wave 40s).
//
// PORT (cg-di-b):
// - `mod private { struct HiddenZst; }` is a module-private frozen value of the branded type `HiddenZst`: nothing outside
//   this module can make one, so a `UniqueTypeId` is only made by the `for_*` constructors, as upstream intends.
// - `UniqueTypeId` is a `$`-tagged union with its tuple fields `_0`..`_2`. Its derived `PartialEq`/`Hash` (the `TypeMap`'s
//   key) is `key_UniqueTypeId`: the variant, the interned `Ty`'s `id`, the `VariantIdx`, and an `ExistentialTraitRef`'s
//   `DefId` and interned args list `id` (`HiddenZst` is a ZST and always equal). Its derived `StableHash` is
//   `stable_hash_UniqueTypeId`, written as `rustc_macros::StableHash` expands: the discriminant (`isize`), then each field
//   (`HiddenZst` hashes nothing). The derive is hand-written because its result is visible: `generate_unique_id_string` is
//   the `identifier:` of composite types in the IR.
// - `TypeMap`'s `RefCell<FxHashMap<UniqueTypeId, &DIType>>` is a `KeyedMap`; it is never iterated, so its order is invisible.
// - `AdtStackPopGuard` (a `Drop` guard) is a class whose `drop()` runs in a `finally` at the end of
//   `build_type_with_children`, where upstream drops `_adt_stack_pop_guard`.
// - The `members`/`generics` closures return arrays (`SmallVec`); `(size, align): (Size, Align)` is a `[Size, Align]`.
// - `assert_eq!(.., None)` on `Option<&DIType>` compares with `undefined`.
import type { Align, Size } from "../../../rustc_abi/lib.ts";
import { VariantIdx } from "../../../rustc_abi/layout.ts";
import { Fingerprint } from "../../../rustc_data_structures/fingerprint.ts";
import { type StableHashCtxt, StableHasher, stable_hash_Discriminant, stable_hash_Option, stable_hash_u32 } from "../../../rustc_data_structures/stable_hash.ts";
import { stable_hash_Ty } from "../../../rustc_middle/stable_hash.gen.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { fold_Option, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import {
  debug_ExistentialTraitRef,
  type ExistentialTraitRef,
  fold_with_ExistentialTraitRef,
  try_fold_with_ExistentialTraitRef,
  visit_with_ExistentialTraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import { stable_hash_ExistentialTraitRef } from "../../../rustc_type_ir/ty_stable_hash.gen.ts";
import { type Debug, debug_option, debug_tuple, PLAIN } from "../../../std/fmt.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import type { CodegenCx } from "../../context.ts";
import * as llvm from "../../llvm/mod.ts";
import type { DIFlags, DIScope, DIType, Metadata } from "../../llvm/mod.ts";
import { create_DIArray, DIB, debug_context } from "../utils.ts";
import { type DefinitionLocation, UNKNOWN_LINE_NUMBER, unknown_file_metadata } from "../metadata.ts";
import { utf8_len } from "../../../std/str.ts";

// mod private {
// This type cannot be constructed outside of this module because
// it has a private field. We make use of this in order to prevent
// `UniqueTypeId` from being constructed directly, without asserting
// the preconditions.
// #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, StableHash)]
export type HiddenZst = { readonly __HiddenZst: never };
const HiddenZst: HiddenZst = Object.freeze({}) as HiddenZst;
// }

const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

/// A unique identifier for anything that we create a debuginfo node for.
/// The types it contains are expected to already be normalized (which
/// is asserted in the constructors).
///
/// Note that there are some things that only show up in debuginfo, like
/// the separate type descriptions for each enum variant. These get an ID
/// too because they have their own debuginfo node in LLVM IR.
// #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, StableHash)]
export type UniqueTypeId =
  /// The ID of a regular type as it shows up at the language level.
  | { readonly $: "Ty"; readonly _0: Ty; readonly _1: HiddenZst }
  /// The ID for the single DW_TAG_variant_part nested inside the top-level
  /// DW_TAG_structure_type that describes enums and coroutines.
  | { readonly $: "VariantPart"; readonly _0: Ty; readonly _1: HiddenZst }
  /// The ID for the artificial struct type describing a single enum variant.
  | { readonly $: "VariantStructType"; readonly _0: Ty; readonly _1: VariantIdx; readonly _2: HiddenZst }
  /// The ID for the additional wrapper struct type describing an enum variant in CPP-like mode.
  | { readonly $: "VariantStructTypeCppLikeWrapper"; readonly _0: Ty; readonly _1: VariantIdx; readonly _2: HiddenZst }
  /// The ID of the artificial type we create for VTables.
  | { readonly $: "VTableTy"; readonly _0: Ty; readonly _1: ExistentialTraitRef | undefined; readonly _2: HiddenZst };

const UniqueTypeId__discriminant = { Ty: 0, VariantPart: 1, VariantStructType: 2, VariantStructTypeCppLikeWrapper: 3, VTableTy: 4 } as const;

/** The derived `PartialEq`/`Hash` of `UniqueTypeId` (header). */
export function key_UniqueTypeId(self: UniqueTypeId): string {
  switch (self.$) {
    case "Ty":
      return `T${self._0.id}`;
    case "VariantPart":
      return `P${self._0.id}`;
    case "VariantStructType":
      return `S${self._0.id},${self._1}`;
    case "VariantStructTypeCppLikeWrapper":
      return `W${self._0.id},${self._1}`;
    case "VTableTy": {
      const t = self._1;
      return t === undefined ? `V${self._0.id},None` : `V${self._0.id},${t.def_id.krate}:${t.def_id.index}:${t.args.id}`;
    }
  }
}

/** The derived `Debug` of `UniqueTypeId`. */
export const debug_UniqueTypeId: Debug<UniqueTypeId> = (self, f) => {
  const ty = debug_Ty(self._0, f);
  switch (self.$) {
    case "Ty":
    case "VariantPart":
      return debug_tuple(f, self.$, [ty, "HiddenZst"]);
    case "VariantStructType":
    case "VariantStructTypeCppLikeWrapper":
      return debug_tuple(f, self.$, [ty, VariantIdx.debug(self._1, f), "HiddenZst"]);
    case "VTableTy":
      return debug_tuple(f, self.$, [ty, debug_option(self._1, f, debug_ExistentialTraitRef), "HiddenZst"]);
  }
};

/** The derived `StableHash` of `UniqueTypeId` (header). */
function stable_hash_UniqueTypeId(self: UniqueTypeId, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Discriminant(UniqueTypeId__discriminant[self.$], hcx, hasher);
  switch (self.$) {
    case "Ty":
    case "VariantPart":
      stable_hash_Ty(self._0, hcx, hasher);
      // (HiddenZst)
      break;
    case "VariantStructType":
    case "VariantStructTypeCppLikeWrapper":
      stable_hash_Ty(self._0, hcx, hasher);
      stable_hash_u32(VariantIdx.as_u32(self._1), hcx, hasher);
      // (HiddenZst)
      break;
    case "VTableTy":
      stable_hash_Ty(self._0, hcx, hasher);
      stable_hash_Option(self._1, hcx, hasher, stable_hash_ExistentialTraitRef);
      // (HiddenZst)
      break;
  }
}

export const UniqueTypeId = {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:52 for_ty
  for_ty(tcx: TyCtxt, t: Ty): UniqueTypeId {
    tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), t, fold_Ty);
    return { $: "Ty", _0: t, _1: HiddenZst };
  },

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:57 for_enum_variant_part
  for_enum_variant_part(tcx: TyCtxt, enum_ty: Ty): UniqueTypeId {
    tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), enum_ty, fold_Ty);
    return { $: "VariantPart", _0: enum_ty, _1: HiddenZst };
  },

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:62 for_enum_variant_struct_type
  for_enum_variant_struct_type(tcx: TyCtxt, enum_ty: Ty, variant_idx: VariantIdx): UniqueTypeId {
    tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), enum_ty, fold_Ty);
    return { $: "VariantStructType", _0: enum_ty, _1: variant_idx, _2: HiddenZst };
  },

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:71 for_enum_variant_struct_type_wrapper
  for_enum_variant_struct_type_wrapper(tcx: TyCtxt, enum_ty: Ty, variant_idx: VariantIdx): UniqueTypeId {
    tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), enum_ty, fold_Ty);
    return { $: "VariantStructTypeCppLikeWrapper", _0: enum_ty, _1: variant_idx, _2: HiddenZst };
  },

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:80 for_vtable_ty
  for_vtable_ty(tcx: TyCtxt, self_type: Ty, implemented_trait: ExistentialTraitRef | undefined): UniqueTypeId {
    tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), self_type, fold_Ty);
    tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), implemented_trait, fold_Option(d_ExistentialTraitRef));
    return { $: "VTableTy", _0: self_type, _1: implemented_trait, _2: HiddenZst };
  },

  /// Generates a string version of this [UniqueTypeId], which can be used as the `UniqueId`
  /// argument of the various `LLVMRustDIBuilderCreate*Type()` methods.
  ///
  /// Right now this takes the form of a hex-encoded opaque hash value.
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:94 generate_unique_id_string
  generate_unique_id_string(self: UniqueTypeId, tcx: TyCtxt): string {
    const hasher = StableHasher.new();
    tcx.with_stable_hashing_context((hcx) => {
      hcx.while_hashing_spans(false, (hcx) => stable_hash_UniqueTypeId(self, hcx, hasher));
    });
    return Fingerprint.to_hex(hasher.finish(Fingerprint));
  },

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:102 expect_ty
  expect_ty(self: UniqueTypeId): Ty {
    switch (self.$) {
      case "Ty":
        return self._0;
      default:
        return bug(`Expected \`UniqueTypeId::Ty\` but found \`${debug_UniqueTypeId(self, PLAIN)}\``);
    }
  },
};

/// The `TypeMap` is where the debug context holds the type metadata nodes
/// created so far. The debuginfo nodes are identified by `UniqueTypeId`.
// #[derive(Default)]
export class TypeMap {
  constructor(public unique_id_to_di_node: KeyedMap<UniqueTypeId, DIType>) {}

  /** `#[derive(Default)]` */
  static default(): TypeMap {
    return new TypeMap(new KeyedMap(key_UniqueTypeId));
  }

  /// Adds a `UniqueTypeId` to metadata mapping to the `TypeMap`. The method will
  /// fail if the mapping already exists.
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:120 insert
  insert(unique_type_id: UniqueTypeId, metadata: DIType): void {
    // `HashMap::insert(..).is_some()`: the old value is replaced either way
    const had = this.unique_id_to_di_node.has(unique_type_id);
    this.unique_id_to_di_node.set(unique_type_id, metadata);
    if (had) {
      bug(`type metadata for unique ID '${debug_UniqueTypeId(unique_type_id, PLAIN)}' is already in the \`TypeMap\`!`);
    }
  }

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:126 di_node_for_unique_id
  di_node_for_unique_id(unique_type_id: UniqueTypeId): DIType | undefined {
    return this.unique_id_to_di_node.get(unique_type_id);
  }
}

/** `TypeMap::default()`, as debuginfo/mod.rs's `CodegenUnitDebugContext::new` calls it. */
export function TypeMap_default(): TypeMap {
  return TypeMap.default();
}

export class DINodeCreationResult {
  constructor(
    public di_node: DIType,
    public already_stored_in_typemap: boolean,
  ) {}

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:140 new
  static new(di_node: DIType, already_stored_in_typemap: boolean): DINodeCreationResult {
    return new DINodeCreationResult(di_node, already_stored_in_typemap);
  }
}

// #[derive(Debug, Copy, Clone, Eq, PartialEq)]
export type Stub = { readonly $: "Struct" } | { readonly $: "Union" } | { readonly $: "VTableTy"; readonly vtable_holder: DIType };
export const Stub = {
  Struct: Object.freeze({ $: "Struct" }) as Stub,
  Union: Object.freeze({ $: "Union" }) as Stub,
} as const;

export class StubInfo {
  constructor(
    public metadata: DIType,
    public unique_type_id: UniqueTypeId,
  ) {}

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:158 new
  static new(cx: CodegenCx, unique_type_id: UniqueTypeId, build: (cx: CodegenCx, unique_type_id_str: string) => DIType): StubInfo {
    const unique_type_id_str = UniqueTypeId.generate_unique_id_string(unique_type_id, cx.tcx);
    const di_node = build(cx, unique_type_id_str);
    return new StubInfo(di_node, unique_type_id);
  }
}

/// Create a stub debuginfo node onto which fields and nested types can be attached.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:170 stub
export function stub(
  cx: CodegenCx,
  kind: Stub,
  unique_type_id: UniqueTypeId,
  name: string,
  def_location: DefinitionLocation | undefined,
  [size, align]: readonly [Size, Align],
  containing_scope: DIScope | undefined,
  flags: DIFlags,
): StubInfo {
  const no_elements: readonly (Metadata | undefined)[] = [];
  const unique_type_id_str = UniqueTypeId.generate_unique_id_string(unique_type_id, cx.tcx);

  let file_metadata: Metadata;
  let line_number: number;
  if (def_location !== undefined) {
    [file_metadata, line_number] = [def_location[0], def_location[1]];
  } else {
    [file_metadata, line_number] = [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];
  }

  let metadata: DIType;
  switch (kind.$) {
    case "Struct":
    case "VTableTy": {
      const vtable_holder = kind.$ === "VTableTy" ? kind.vtable_holder : undefined;
      metadata = llvm.LLVMDIBuilderCreateStructType(
        DIB(cx),
        containing_scope,
        name,
        utf8_len(name),
        file_metadata,
        line_number,
        BigInt(size.bits()),
        align.bits() >>> 0,
        flags,
        undefined,
        no_elements,
        no_elements.length >>> 0,
        0, // (Objective-C runtime version; default is 0)
        vtable_holder,
        unique_type_id_str,
        utf8_len(unique_type_id_str),
      );
      break;
    }
    case "Union":
      metadata = llvm.LLVMDIBuilderCreateUnionType(
        DIB(cx),
        containing_scope,
        name,
        utf8_len(name),
        file_metadata,
        line_number,
        BigInt(size.bits()),
        align.bits() >>> 0,
        flags,
        no_elements,
        no_elements.length >>> 0,
        0, // (Objective-C runtime version; default is 0)
        unique_type_id_str,
        utf8_len(unique_type_id_str),
      );
      break;
  }
  return new StubInfo(metadata, unique_type_id);
}

class AdtStackPopGuard {
  constructor(public cx: CodegenCx) {}

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:243 drop
  drop(): void {
    debug_context(this.cx).adt_stack.pop();
  }
}

/// This function enables creating debuginfo nodes that can recursively refer to themselves.
/// It will first insert the given stub into the type map and only then execute the `members`
/// and `generics` closures passed in. These closures have access to the stub so they can
/// directly attach fields to them. If the type of a field transitively refers back
/// to the type currently being built, the stub will already be found in the type map,
/// which effectively breaks the recursion cycle.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs:254 build_type_with_children
export function build_type_with_children(
  cx: CodegenCx,
  stub_info: StubInfo,
  members: (cx: CodegenCx, owner: DIType) => DIType[],
  generics: (cx: CodegenCx) => (DIType | undefined)[],
): DINodeCreationResult {
  if (debug_context(cx).type_map.di_node_for_unique_id(stub_info.unique_type_id) !== undefined) {
    bug(`assertion \`left == right\` failed\n  left: Some(..)\n right: None`);
  }

  let _adt_stack_pop_guard: AdtStackPopGuard | undefined = undefined;
  try {
    const uid = stub_info.unique_type_id;
    const k = uid.$ === "Ty" ? uid._0.kind() : undefined;
    if (k !== undefined && k.$ === "Adt") {
      const adt_def = k._0;
      const args = k._1;
      const def_id = adt_def.did();
      // If any child type references the original type definition and the child type has a type
      // parameter that strictly contains the original parameter, the original type is a recursive
      // type that can expanding indefinitely. Example,
      // ```
      // enum Recursive<T> {
      //     Recurse(*const Recursive<Wrap<T>>),
      //     Item(T),
      // }
      // ```
      const is_expanding_recursive = ((): boolean => {
        const stack = debug_context(cx).adt_stack;
        // `stack.iter().enumerate().rev().skip(1).filter(..).any(..)`
        for (let ancestor_index = stack.length - 2; ancestor_index >= 0; ancestor_index--) {
          const [ancestor_def_id, ancestor_args] = stack[ancestor_index]!;
          if (!def_id_eq(def_id, ancestor_def_id)) continue;
          const n = Math.min(args.length, ancestor_args.length);
          for (let j = 0; j < n; j++) {
            const arg = GenericArg.as_type(args[j]!);
            const ancestor_arg = GenericArg.as_type(ancestor_args[j]!);
            if (arg === undefined || ancestor_arg === undefined) continue;
            if (
              // Strictly contains.
              arg !== ancestor_arg &&
              arg.contains(ancestor_arg) &&
              // Check all types between current and ancestor use the
              // ancestor_arg.
              // Otherwise, duplicate wrappers in normal recursive type may be
              // regarded as expanding.
              // ```
              // struct Recursive {
              //     a: Box<Box<Recursive>>,
              // }
              // ```
              // It can produce an ADT stack like this,
              // - Box<Recursive>
              // - Recursive
              // - Box<Box<Recursive>>
              stack.slice(ancestor_index + 1, stack.length).every(([, intermediate_args]) => any_type_contains(intermediate_args, ancestor_arg))
            ) {
              return true;
            }
          }
        }
        return false;
      })();
      if (is_expanding_recursive) {
        // FIXME: indicate that this is an expanding recursive type in stub metadata?
        return DINodeCreationResult.new(stub_info.metadata, false);
      } else {
        debug_context(cx).adt_stack.push([def_id, args]);
        _adt_stack_pop_guard = new AdtStackPopGuard(cx);
      }
    }

    debug_context(cx).type_map.insert(stub_info.unique_type_id, stub_info.metadata);

    const members_: (DIType | undefined)[] = members(cx, stub_info.metadata).map((node) => node);
    const generics_ = generics(cx);

    if (!(members_.length === 0 && generics_.length === 0)) {
      const members_array = create_DIArray(DIB(cx), members_);
      const generics_array = create_DIArray(DIB(cx), generics_);
      llvm.LLVMRustDICompositeTypeReplaceArrays(DIB(cx), stub_info.metadata, members_array, generics_array);
    }

    return new DINodeCreationResult(stub_info.metadata, true);
  } finally {
    if (_adt_stack_pop_guard !== undefined) _adt_stack_pop_guard.drop();
  }
}

/** `DefId`'s derived `PartialEq`. */
function def_id_eq(a: DefId, b: DefId): boolean {
  return a.krate === b.krate && a.index === b.index;
}

/** `intermediate_args.iter().filter_map(|arg| arg.as_type()).any(|mid_arg| mid_arg.contains(ancestor_arg))` */
function any_type_contains(intermediate_args: GenericArgs, ancestor_arg: Ty): boolean {
  for (const arg of intermediate_args) {
    const mid_arg = GenericArg.as_type(arg);
    if (mid_arg !== undefined && mid_arg.contains(ancestor_arg)) return true;
  }
  return false;
}

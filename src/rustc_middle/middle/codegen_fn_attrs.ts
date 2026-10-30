// Port of compiler/rustc_middle/src/middle/codegen_fn_attrs.rs.
//
// PORT: hand-written types (the typedefs probe cannot parse this file's `const impl Default for SanitizerFnAttrs`,
// like middle/privacy.rs), so the derives (`Debug`, `Clone`, `PartialEq`, and `TyDecodable` for crate metadata's
// `codegen_fn_attrs`, as rustc_macros/src/serialize.rs `decodable_body` emits it: fields in declaration order, enum tag
// `read_u8`) are written here next to each type. `mono::Visibility`'s `TyDecodable` too (declared here).
// `TyEncodable` likewise mirrors each decoder (lane encoder-c: crate metadata's `codegen_fn_attrs` table).
// `CodegenFnAttrFlags` is a branded number with the `bitflags!` API on its companion, as tools/codegen emits for
// `struct X(u32)` + `bitflags! { impl X: u32 { .. } }` (e.g. rustc_abi `ReprFlags`).
// `Cow<'tcx, CodegenFnAttrs>` (`codegen_instance_attrs`) is the borrowed query value or an owned clone.
// The `TyCtxt` method `codegen_instance_attrs` is the free function `TyCtxt_codegen_instance_attrs` (the `TyCtxt` class
// lives in ty/context.ts, which is not this lane's file).
import { Align, Align_max, debug_Align } from "../../rustc_abi/lib.ts";
import {
  clone_InlineAttr,
  debug_InlineAttr,
  decode_InlineAttr,
  decode_InstructionSetAttr,
  decode_InstrumentFnAttr,
  decode_Linkage,
  decode_OptimizeAttr,
  decode_RtsanSetting,
  encode_InlineAttr,
  encode_InstructionSetAttr,
  encode_InstrumentFnAttr,
  encode_Linkage,
  encode_OptimizeAttr,
  encode_RtsanSetting,
  debug_InstructionSetAttr,
  debug_InstrumentFnAttr,
  debug_Linkage,
  debug_OptimizeAttr,
  debug_RtsanSetting,
  type InlineAttr,
  type InstructionSetAttr,
  type InstrumentFnAttr,
  type Linkage,
  type OptimizeAttr,
  type RtsanSetting,
} from "../../rustc_attr_ir/data_structures.gen.ts";
import { debug_DefId, type DefId } from "../../rustc_span/def_id.ts";
import { debug_Symbol, type Symbol } from "../../rustc_span/symbol.ts";
import { debug_SanitizerSet, decode_SanitizerSet, encode_SanitizerSet, SanitizerSet } from "../../rustc_structures/sanitizer_set.ts";
import {
  decode_bool,
  decode_Option,
  decode_tuple,
  decode_u16,
  decode_u32,
  decode_u8,
  decode_Vec,
  encode_bool,
  encode_Option,
  encode_tuple,
  encode_u16,
  encode_u32,
  encode_u8,
  encode_Vec,
} from "../../rustc_serialize/serialize.ts";
import type { SpanDecoder, SpanEncoder } from "../../rustc_span/lib.ts";
import { type Debug, debug_bool, debug_int, debug_option, debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import { to_writer } from "../../vendor/bitflags/parser.ts";
import { flags_companion } from "../../vendor/bitflags/traits.ts";
import { InstanceKind as InstanceKindC, type InstanceKind } from "../ty/instance.ts";
import type { TyCtxt } from "../ty/context.ts";

/**
 * `rustc_middle::mono::Visibility` (compiler/rustc_middle/src/mono.rs; mono.rs is not ported).
 * PORT: declared here because `CodegenFnAttrs::foreign_item_symbol_aliases` names it.
 */
// #[derive(Copy, Clone, PartialEq, Debug, StableHash, TyEncodable, TyDecodable)]
export type Visibility = "Default" | "Hidden" | "Protected" | "Interposable";
export const Visibility = { Default: "Default", Hidden: "Hidden", Protected: "Protected", Interposable: "Interposable" } as const;
export const debug_Visibility: Debug<Visibility> = (v) => v;
/** `#[derive(TyDecodable)]` (mono.rs:384) */
export function decode_Visibility(__decoder: SpanDecoder): Visibility {
  const __tag = __decoder.read_u8();
  switch (__tag) {
    case 0:
      return "Default";
    case 1:
      return "Hidden";
    case 2:
      return "Protected";
    case 3:
      return "Interposable";
    default:
      return panic(`invalid enum variant tag while decoding \`Visibility\`, expected 0..4, actual ${__tag}`);
  }
}
/** `#[derive(TyEncodable)]` (mono.rs:384) */
export function encode_Visibility(self: Visibility, __encoder: SpanEncoder): void {
  switch (self) {
    case "Default":
      __encoder.emit_u8(0);
      break;
    case "Hidden":
      __encoder.emit_u8(1);
      break;
    case "Protected":
      __encoder.emit_u8(2);
      break;
    case "Interposable":
      __encoder.emit_u8(3);
      break;
  }
}

// impl<'tcx> TyCtxt<'tcx>
// rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:16 codegen_instance_attrs
export function TyCtxt_codegen_instance_attrs(self: TyCtxt, instance_kind: InstanceKind): CodegenFnAttrs {
  // NOTE: we try to not clone the `CodegenFnAttrs` when that is not needed.
  // The `to_mut` method used below clones the inner value.
  // PORT: `Cow::Borrowed` / `to_mut`: `owned` is the clone once one was made.
  const borrowed = self.codegen_fn_attrs(InstanceKindC.def_id(instance_kind)) as CodegenFnAttrs;
  let owned: CodegenFnAttrs | undefined = undefined;
  const attrs = (): CodegenFnAttrs => owned ?? borrowed;
  const to_mut = (): CodegenFnAttrs => (owned ??= clone_CodegenFnAttrs(borrowed));
  const kind = instance_kind;

  // Drop the `#[naked]` attribute on non-item `InstanceKind`s, like the shims that
  // are generated for indirect function calls.
  if (!(kind.$ === "Item")) {
    if (CodegenFnAttrFlags.contains(attrs().flags, CodegenFnAttrFlags.NAKED)) {
      const a = to_mut();
      a.flags = CodegenFnAttrFlags.remove(a.flags, CodegenFnAttrFlags.NAKED);
    }
  }

  // A shim created by `#[track_caller]` should not inherit any attributes
  // that modify the symbol name. Failing to remove these attributes from
  // the shim leads to errors like `symbol `foo` is already defined`.
  //
  // A `ClosureOnceShim` with the track_caller attribute does not have a symbol,
  // and therefore can be skipped here.
  if (kind.$ === "Shim" && kind._0.$ === "Reify" && CodegenFnAttrFlags.contains(attrs().flags, CodegenFnAttrFlags.TRACK_CALLER)) {
    if (CodegenFnAttrFlags.contains(attrs().flags, CodegenFnAttrFlags.NO_MANGLE)) {
      const a = to_mut();
      a.flags = CodegenFnAttrFlags.remove(a.flags, CodegenFnAttrFlags.NO_MANGLE);
    }

    if (CodegenFnAttrFlags.contains(attrs().flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL)) {
      const a = to_mut();
      a.flags = CodegenFnAttrFlags.remove(a.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL);
    }

    if (CodegenFnAttrFlags.contains(attrs().flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM)) {
      const a = to_mut();
      a.flags = CodegenFnAttrFlags.remove(a.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM);
    }

    if (attrs().symbol_name !== undefined) {
      to_mut().symbol_name = undefined;
    }
  }

  // Ensure closure shims have the optimization properties of their closure applied to them.
  if (kind.$ === "Shim" && kind._0.$ === "ClosureOnce") {
    const closure = kind._0.closure;
    const closure_attrs = self.codegen_fn_attrs(closure) as CodegenFnAttrs;
    to_mut().optimize = closure_attrs.optimize;
  }

  return attrs();
}

// rustc-type: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:71 CodegenFnAttrs
// #[derive(Clone, TyEncodable, TyDecodable, StableHash, Debug)]
export interface CodegenFnAttrs {
  flags: CodegenFnAttrFlags;
  /// Parsed representation of the `#[inline]` attribute
  inline: InlineAttr;
  /// Parsed representation of the `#[optimize]` attribute
  optimize: OptimizeAttr;
  /// The name this function will be imported/exported under. This can be set
  /// using the `#[export_name = "..."]` or `#[link_name = "..."]` attribute
  /// depending on if this is a function definition or foreign function.
  symbol_name: Symbol | undefined;
  /// Defids of foreign items somewhere that this function should "satisfy".
  /// i.e., if a foreign function has some symbol foo,
  /// generate this function under its real name,
  /// but *also* under the same name as this foreign function so that the foreign function has an implementation.
  // FIXME: make "SymbolName<'tcx>"
  foreign_item_symbol_aliases: [DefId, Linkage, Visibility][];
  /// The `#[link_ordinal = "..."]` attribute, indicating an ordinal an
  /// imported function has in the dynamic library. Note that this must not
  /// be set when `link_name` is set. This is for foreign items with the
  /// "raw-dylib" kind.
  link_ordinal: number | undefined;
  /// The `#[target_feature(enable = "...")]` attribute and the enabled
  /// features (only enabled features are supported right now).
  /// Implied target features have already been applied.
  target_features: TargetFeature[];
  /// Whether the function was declared safe, but has target features
  safe_target_features: boolean;
  /// The `#[linkage = "..."]` attribute on Rust-defined items and the value we found.
  linkage: Linkage | undefined;
  /// The `#[linkage = "..."]` attribute on foreign items and the value we found.
  import_linkage: Linkage | undefined;
  /// The `#[link_section = "..."]` attribute, or what executable section this
  /// should be placed in.
  link_section: Symbol | undefined;
  /// The `#[sanitize(xyz = "off")]` attribute. Indicates the settings for each
  /// sanitizer for this function.
  sanitizers: SanitizerFnAttrs;
  /// The `#[instruction_set(set)]` attribute. Indicates if the generated code should
  /// be generated against a specific instruction set. Only usable on architectures which allow
  /// switching between multiple instruction sets.
  instruction_set: InstructionSetAttr | undefined;
  /// The `#[align(...)]` attribute. Determines the alignment of the function body.
  // FIXME(#82232, #143834): temporarily renamed to mitigate `#[align]` nameres ambiguity
  alignment: Align | undefined;
  /// The `#[patchable_function_entry(...)]` attribute. Indicates how many nops should be around
  /// the function entry, or override default section to record entry location.
  patchable_function_entry: PatchableFunctionEntry | undefined;
  /// The `#[rustc_objc_class = "..."]` attribute.
  objc_class: Symbol | undefined;
  /// The `#[rustc_objc_selector = "..."]` attribute.
  objc_selector: Symbol | undefined;
  /// The `#[instrument_fn]` attribute.
  instrument_fn: InstrumentFnAttr | undefined;
}
/** `#[derive(Debug)]` */
export const debug_CodegenFnAttrs: Debug<CodegenFnAttrs> = (v, f) =>
  debug_struct(f, "CodegenFnAttrs", [
    ["flags", debug_CodegenFnAttrFlags(v.flags, f)],
    ["inline", debug_InlineAttr(v.inline, f)],
    ["optimize", debug_OptimizeAttr(v.optimize, f)],
    ["symbol_name", debug_option(v.symbol_name, f, debug_Symbol)],
    [
      "foreign_item_symbol_aliases",
      debug_vec(v.foreign_item_symbol_aliases, f, (t, f) => debug_tuple(f, "", [debug_DefId(t[0], f), debug_Linkage(t[1], f), debug_Visibility(t[2], f)])),
    ],
    ["link_ordinal", debug_option(v.link_ordinal, f, debug_int)],
    ["target_features", debug_vec(v.target_features, f, debug_TargetFeature)],
    ["safe_target_features", debug_bool(v.safe_target_features, f)],
    ["linkage", debug_option(v.linkage, f, debug_Linkage)],
    ["import_linkage", debug_option(v.import_linkage, f, debug_Linkage)],
    ["link_section", debug_option(v.link_section, f, debug_Symbol)],
    ["sanitizers", debug_SanitizerFnAttrs(v.sanitizers, f)],
    ["instruction_set", debug_option(v.instruction_set, f, debug_InstructionSetAttr)],
    ["alignment", debug_option(v.alignment, f, debug_Align)],
    ["patchable_function_entry", debug_option(v.patchable_function_entry, f, debug_PatchableFunctionEntry)],
    ["objc_class", debug_option(v.objc_class, f, debug_Symbol)],
    ["objc_selector", debug_option(v.objc_selector, f, debug_Symbol)],
    ["instrument_fn", debug_option(v.instrument_fn, f, debug_InstrumentFnAttr)],
  ]);
/** `#[derive(Clone)]` */
export function clone_CodegenFnAttrs(v: CodegenFnAttrs): CodegenFnAttrs {
  return {
    flags: v.flags,
    inline: clone_InlineAttr(v.inline),
    optimize: v.optimize,
    symbol_name: v.symbol_name,
    foreign_item_symbol_aliases: v.foreign_item_symbol_aliases.map(([d, l, vis]) => [d, l, vis]),
    link_ordinal: v.link_ordinal,
    target_features: v.target_features.map((t) => ({ name: t.name, kind: t.kind })),
    safe_target_features: v.safe_target_features,
    linkage: v.linkage,
    import_linkage: v.import_linkage,
    link_section: v.link_section,
    sanitizers: { disabled: v.sanitizers.disabled, rtsan_setting: v.sanitizers.rtsan_setting },
    instruction_set: v.instruction_set,
    alignment: v.alignment,
    patchable_function_entry: v.patchable_function_entry,
    objc_class: v.objc_class,
    objc_selector: v.objc_selector,
    instrument_fn: v.instrument_fn,
  };
}
/** `#[derive(TyDecodable)]` */
export function decode_CodegenFnAttrs(__decoder: SpanDecoder): CodegenFnAttrs {
  const flags = decode_CodegenFnAttrFlags(__decoder);
  const inline = decode_InlineAttr(__decoder);
  const optimize = decode_OptimizeAttr(__decoder);
  const symbol_name = decode_Option(__decoder, (d) => d.decode_symbol());
  const foreign_item_symbol_aliases = decode_Vec(__decoder, (d) => decode_tuple(d, (d) => d.decode_def_id(), decode_Linkage, decode_Visibility));
  const link_ordinal = decode_Option(__decoder, decode_u16);
  const target_features = decode_Vec(__decoder, decode_TargetFeature);
  const safe_target_features = decode_bool(__decoder);
  const linkage = decode_Option(__decoder, decode_Linkage);
  const import_linkage = decode_Option(__decoder, decode_Linkage);
  const link_section = decode_Option(__decoder, (d) => d.decode_symbol());
  const sanitizers = decode_SanitizerFnAttrs(__decoder);
  const instruction_set = decode_Option(__decoder, decode_InstructionSetAttr);
  const alignment = decode_Option(__decoder, (d) => new Align(decode_u8(d)));
  const patchable_function_entry = decode_Option(__decoder, decode_PatchableFunctionEntry);
  const objc_class = decode_Option(__decoder, (d) => d.decode_symbol());
  const objc_selector = decode_Option(__decoder, (d) => d.decode_symbol());
  const instrument_fn = decode_Option(__decoder, decode_InstrumentFnAttr);
  return {
    flags,
    inline,
    optimize,
    symbol_name,
    foreign_item_symbol_aliases,
    link_ordinal,
    target_features,
    safe_target_features,
    linkage,
    import_linkage,
    link_section,
    sanitizers,
    instruction_set,
    alignment,
    patchable_function_entry,
    objc_class,
    objc_selector,
    instrument_fn,
  };
}
/** `#[derive(TyEncodable)]` */
export function encode_CodegenFnAttrs(self: CodegenFnAttrs, __encoder: SpanEncoder): void {
  encode_CodegenFnAttrFlags(self.flags, __encoder);
  encode_InlineAttr(self.inline, __encoder);
  encode_OptimizeAttr(self.optimize, __encoder);
  encode_Option(self.symbol_name, __encoder, (v, e) => e.encode_symbol(v));
  encode_Vec(self.foreign_item_symbol_aliases, __encoder, (v, e) => encode_tuple(v, e, (v, e) => e.encode_def_id(v), encode_Linkage, encode_Visibility));
  encode_Option(self.link_ordinal, __encoder, encode_u16);
  encode_Vec(self.target_features, __encoder, encode_TargetFeature);
  encode_bool(self.safe_target_features, __encoder);
  encode_Option(self.linkage, __encoder, encode_Linkage);
  encode_Option(self.import_linkage, __encoder, encode_Linkage);
  encode_Option(self.link_section, __encoder, (v, e) => e.encode_symbol(v));
  encode_SanitizerFnAttrs(self.sanitizers, __encoder);
  encode_Option(self.instruction_set, __encoder, encode_InstructionSetAttr);
  encode_Option(self.alignment, __encoder, (v, e) => encode_u8(v.pow2, e));
  encode_Option(self.patchable_function_entry, __encoder, encode_PatchableFunctionEntry);
  encode_Option(self.objc_class, __encoder, (v, e) => e.encode_symbol(v));
  encode_Option(self.objc_selector, __encoder, (v, e) => e.encode_symbol(v));
  encode_Option(self.instrument_fn, __encoder, encode_InstrumentFnAttr);
}

// rustc-type: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:131 TargetFeatureKind
// #[derive(Copy, Clone, Debug, TyEncodable, TyDecodable, StableHash, PartialEq, Eq)]
export type TargetFeatureKind =
  /// The feature is implied by another feature, rather than explicitly added by the
  /// `#[target_feature]` attribute
  | "Implied"
  /// The feature is added by the regular `target_feature` attribute.
  | "Enabled"
  /// The feature is added by the unsafe `force_target_feature` attribute.
  | "Forced";
export const TargetFeatureKind = { Implied: "Implied", Enabled: "Enabled", Forced: "Forced" } as const;
export const debug_TargetFeatureKind: Debug<TargetFeatureKind> = (v) => v;
/** `#[derive(TyDecodable)]` */
export function decode_TargetFeatureKind(__decoder: SpanDecoder): TargetFeatureKind {
  const __tag = __decoder.read_u8();
  switch (__tag) {
    case 0:
      return "Implied";
    case 1:
      return "Enabled";
    case 2:
      return "Forced";
    default:
      return panic(`invalid enum variant tag while decoding \`TargetFeatureKind\`, expected 0..3, actual ${__tag}`);
  }
}
/** `#[derive(TyEncodable)]` */
export function encode_TargetFeatureKind(self: TargetFeatureKind, __encoder: SpanEncoder): void {
  switch (self) {
    case "Implied":
      __encoder.emit_u8(0);
      break;
    case "Enabled":
      __encoder.emit_u8(1);
      break;
    case "Forced":
      __encoder.emit_u8(2);
      break;
  }
}

// rustc-type: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:143 TargetFeature
// #[derive(Copy, Clone, Debug, Eq, PartialEq, TyEncodable, TyDecodable, StableHash)]
export interface TargetFeature {
  /// The name of the target feature (e.g. "avx")
  name: Symbol;
  /// The way this feature was enabled.
  kind: TargetFeatureKind;
}
export const debug_TargetFeature: Debug<TargetFeature> = (v, f) =>
  debug_struct(f, "TargetFeature", [
    ["name", debug_Symbol(v.name, f)],
    ["kind", debug_TargetFeatureKind(v.kind, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function TargetFeature_eq(a: TargetFeature, b: TargetFeature): boolean {
  return a.name === b.name && a.kind === b.kind;
}
/** `#[derive(TyDecodable)]` */
export function decode_TargetFeature(__decoder: SpanDecoder): TargetFeature {
  const name = __decoder.decode_symbol();
  const kind = decode_TargetFeatureKind(__decoder);
  return { name, kind };
}
/** `#[derive(TyEncodable)]` */
export function encode_TargetFeature(self: TargetFeature, __encoder: SpanEncoder): void {
  __encoder.encode_symbol(self.name);
  encode_TargetFeatureKind(self.kind, __encoder);
}

// rustc-type: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:150 PatchableFunctionEntry
// #[derive(Copy, Clone, Debug, TyEncodable, TyDecodable, StableHash)]
// PORT: the fields are private upstream; the getters below are the API.
export interface PatchableFunctionEntry {
  /// Nops to prepend to the function
  readonly prefix: number | undefined;
  /// Nops after entry, but before body
  readonly entry: number | undefined;
  /// Optional, specific section to record entry location in
  readonly section: Symbol | undefined;
}
export const debug_PatchableFunctionEntry: Debug<PatchableFunctionEntry> = (v, f) =>
  debug_struct(f, "PatchableFunctionEntry", [
    ["prefix", debug_option(v.prefix, f, debug_int)],
    ["entry", debug_option(v.entry, f, debug_int)],
    ["section", debug_option(v.section, f, debug_Symbol)],
  ]);
/** `#[derive(TyDecodable)]` */
export function decode_PatchableFunctionEntry(__decoder: SpanDecoder): PatchableFunctionEntry {
  const prefix = decode_Option(__decoder, decode_u8);
  const entry = decode_Option(__decoder, decode_u8);
  const section = decode_Option(__decoder, (d) => d.decode_symbol());
  return { prefix, entry, section };
}
/** `#[derive(TyEncodable)]` */
export function encode_PatchableFunctionEntry(self: PatchableFunctionEntry, __encoder: SpanEncoder): void {
  encode_Option(self.prefix, __encoder, encode_u8);
  encode_Option(self.entry, __encoder, encode_u8);
  encode_Option(self.section, __encoder, (v, e) => e.encode_symbol(v));
}

export const PatchableFunctionEntry = {
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:159 from_prefix_entry_and_section
  from_prefix_entry_and_section(prefix: number | undefined, entry: number | undefined, section: Symbol | undefined): PatchableFunctionEntry {
    return { prefix, entry, section };
  },
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:166 from_prefix_and_entry
  from_prefix_and_entry(prefix: number, entry: number): PatchableFunctionEntry {
    return { prefix: prefix, entry: entry, section: undefined };
  },
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:169 prefix
  prefix(self: PatchableFunctionEntry): number | undefined {
    return self.prefix;
  },
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:172 entry
  entry(self: PatchableFunctionEntry): number | undefined {
    return self.entry;
  },
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:175 section
  section(self: PatchableFunctionEntry): Symbol | undefined {
    return self.section;
  },
} as const;

// rustc-type: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:180 CodegenFnAttrFlags
// #[derive(Clone, Copy, PartialEq, Eq, TyEncodable, TyDecodable, StableHash)]
// pub struct CodegenFnAttrFlags(u32);
// PORT: `bitflags!` (`impl CodegenFnAttrFlags: u32`) -> branded number; flags + `Flags` API on the companion.
export type CodegenFnAttrFlags = number & { readonly __brand: "CodegenFnAttrFlags" };
export const CodegenFnAttrFlags = flags_companion<
  CodegenFnAttrFlags,
  {
    COLD: CodegenFnAttrFlags;
    NEVER_UNWIND: CodegenFnAttrFlags;
    NAKED: CodegenFnAttrFlags;
    NO_MANGLE: CodegenFnAttrFlags;
    RUSTC_STD_INTERNAL_SYMBOL: CodegenFnAttrFlags;
    THREAD_LOCAL: CodegenFnAttrFlags;
    USED_COMPILER: CodegenFnAttrFlags;
    USED_LINKER: CodegenFnAttrFlags;
    TRACK_CALLER: CodegenFnAttrFlags;
    FFI_PURE: CodegenFnAttrFlags;
    FFI_CONST: CodegenFnAttrFlags;
    ALLOCATOR: CodegenFnAttrFlags;
    DEALLOCATOR: CodegenFnAttrFlags;
    REALLOCATOR: CodegenFnAttrFlags;
    ALLOCATOR_ZEROED: CodegenFnAttrFlags;
    NO_BUILTINS: CodegenFnAttrFlags;
    FOREIGN_ITEM: CodegenFnAttrFlags;
    OFFLOAD_KERNEL: CodegenFnAttrFlags;
    EXTERNALLY_IMPLEMENTABLE_ITEM: CodegenFnAttrFlags;
  }
>(
  32,
  {
    /// `#[cold]`: a hint to LLVM that this function, when called, is never on
    /// the hot path.
    COLD: (1 << 0) as CodegenFnAttrFlags,
    /// `#[rustc_nounwind]`: An indicator that function will never unwind.
    NEVER_UNWIND: (1 << 1) as CodegenFnAttrFlags,
    /// `#[naked]`: an indicator to LLVM that no function prologue/epilogue
    /// should be generated.
    NAKED: (1 << 2) as CodegenFnAttrFlags,
    /// `#[no_mangle]`: an indicator that the function's name should be the same
    /// as its symbol.
    NO_MANGLE: (1 << 3) as CodegenFnAttrFlags,
    /// `#[rustc_std_internal_symbol]`: an indicator that this symbol is a
    /// "weird symbol" for the standard library in that it has slightly
    /// different linkage, visibility, and reachability rules.
    RUSTC_STD_INTERNAL_SYMBOL: (1 << 4) as CodegenFnAttrFlags,
    /// `#[thread_local]`: indicates a static is actually a thread local
    /// piece of memory
    THREAD_LOCAL: (1 << 5) as CodegenFnAttrFlags,
    /// `#[used(compiler)]`: indicates that LLVM can't eliminate this function (but the
    /// linker can!).
    USED_COMPILER: (1 << 6) as CodegenFnAttrFlags,
    /// `#[used(linker)]`:
    /// indicates that neither LLVM nor the linker will eliminate this function.
    USED_LINKER: (1 << 7) as CodegenFnAttrFlags,
    /// `#[track_caller]`: allow access to the caller location
    TRACK_CALLER: (1 << 8) as CodegenFnAttrFlags,
    /// #[ffi_pure]: applies clang's `pure` attribute to a foreign function
    /// declaration.
    FFI_PURE: (1 << 9) as CodegenFnAttrFlags,
    /// #[ffi_const]: applies clang's `const` attribute to a foreign function
    /// declaration.
    FFI_CONST: (1 << 10) as CodegenFnAttrFlags,
    /// `#[rustc_allocator]`: a hint to LLVM that the pointer returned from this
    /// function is never null and the function has no side effects other than allocating.
    ALLOCATOR: (1 << 11) as CodegenFnAttrFlags,
    /// `#[rustc_deallocator]`: a hint to LLVM that the function only deallocates memory.
    DEALLOCATOR: (1 << 12) as CodegenFnAttrFlags,
    /// `#[rustc_reallocator]`: a hint to LLVM that the function only reallocates memory.
    REALLOCATOR: (1 << 13) as CodegenFnAttrFlags,
    /// `#[rustc_allocator_zeroed]`: a hint to LLVM that the function only allocates zeroed memory.
    ALLOCATOR_ZEROED: (1 << 14) as CodegenFnAttrFlags,
    /// `#[no_builtins]`: indicates that disable implicit builtin knowledge of functions for the function.
    NO_BUILTINS: (1 << 15) as CodegenFnAttrFlags,
    /// Marks foreign items, to make `contains_extern_indicator` cheaper.
    FOREIGN_ITEM: (1 << 16) as CodegenFnAttrFlags,
    /// `#[rustc_offload_kernel]`: indicates that this is an offload kernel, an extra ptr arg will be added.
    OFFLOAD_KERNEL: (1 << 17) as CodegenFnAttrFlags,
    /// Externally implementable item symbols act a little like `RUSTC_STD_INTERNAL_SYMBOL`.
    /// When a crate declares an EII and dependencies expect the symbol to exist,
    /// they will refer to this symbol name before a definition is given.
    /// As such, we must make sure these symbols really do exist in the final binary/library.
    /// This flag is put on both the implementations of EIIs and the foreign item they implement.
    EXTERNALLY_IMPLEMENTABLE_ITEM: (1 << 18) as CodegenFnAttrFlags,
  },
  [
    ["COLD", (1 << 0) as CodegenFnAttrFlags],
    ["NEVER_UNWIND", (1 << 1) as CodegenFnAttrFlags],
    ["NAKED", (1 << 2) as CodegenFnAttrFlags],
    ["NO_MANGLE", (1 << 3) as CodegenFnAttrFlags],
    ["RUSTC_STD_INTERNAL_SYMBOL", (1 << 4) as CodegenFnAttrFlags],
    ["THREAD_LOCAL", (1 << 5) as CodegenFnAttrFlags],
    ["USED_COMPILER", (1 << 6) as CodegenFnAttrFlags],
    ["USED_LINKER", (1 << 7) as CodegenFnAttrFlags],
    ["TRACK_CALLER", (1 << 8) as CodegenFnAttrFlags],
    ["FFI_PURE", (1 << 9) as CodegenFnAttrFlags],
    ["FFI_CONST", (1 << 10) as CodegenFnAttrFlags],
    ["ALLOCATOR", (1 << 11) as CodegenFnAttrFlags],
    ["DEALLOCATOR", (1 << 12) as CodegenFnAttrFlags],
    ["REALLOCATOR", (1 << 13) as CodegenFnAttrFlags],
    ["ALLOCATOR_ZEROED", (1 << 14) as CodegenFnAttrFlags],
    ["NO_BUILTINS", (1 << 15) as CodegenFnAttrFlags],
    ["FOREIGN_ITEM", (1 << 16) as CodegenFnAttrFlags],
    ["OFFLOAD_KERNEL", (1 << 17) as CodegenFnAttrFlags],
    ["EXTERNALLY_IMPLEMENTABLE_ITEM", (1 << 18) as CodegenFnAttrFlags],
  ],
);
// rustc_data_structures::external_bitflags_debug! { CodegenFnAttrFlags }
// PORT: the macro expands to `impl Debug for CodegenFnAttrFlags { fn fmt(..) { bitflags::parser::to_writer(self, f) } }`
// (compiler/rustc_data_structures/src/lib.rs; see rustc_structures sanitizer_set.ts).
export const debug_CodegenFnAttrFlags: Debug<CodegenFnAttrFlags> = (v, _f) => to_writer(CodegenFnAttrFlags.FLAGS_DESC, v);
/** `#[derive(TyDecodable)]` of `struct CodegenFnAttrFlags(u32)` */
export function decode_CodegenFnAttrFlags(__decoder: SpanDecoder): CodegenFnAttrFlags {
  return decode_u32(__decoder) as CodegenFnAttrFlags;
}
/** `#[derive(TyEncodable)]` of `struct CodegenFnAttrFlags(u32)` */
export function encode_CodegenFnAttrFlags(self: CodegenFnAttrFlags, __encoder: SpanEncoder): void {
  encode_u32(self, __encoder);
}

// impl CodegenFnAttrs
export const CodegenFnAttrs = {
  // pub const EMPTY: &'static Self = &Self::new();
  // PORT: a getter returning a fresh value (callers never mutate `EMPTY`; a shared object could be).
  get EMPTY(): CodegenFnAttrs {
    return CodegenFnAttrs.new();
  },

  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:244 new
  new(): CodegenFnAttrs {
    return {
      flags: CodegenFnAttrFlags.empty(),
      inline: { $: "None" },
      optimize: "Default",
      symbol_name: undefined,
      link_ordinal: undefined,
      target_features: [],
      foreign_item_symbol_aliases: [],
      safe_target_features: false,
      linkage: undefined,
      import_linkage: undefined,
      link_section: undefined,
      sanitizers: SanitizerFnAttrs.default(),
      instruction_set: undefined,
      alignment: undefined,
      patchable_function_entry: undefined,
      objc_class: undefined,
      objc_selector: undefined,
      instrument_fn: undefined,
    };
  },

  /// Returns `true` if it looks like this symbol needs to be exported, for example:
  ///
  /// * `#[no_mangle]` is present
  /// * `#[export_name(...)]` is present
  /// * `#[linkage]` is present
  ///
  /// Keep this in sync with [`AttributeKind::is_extern_indicator`].
  ///
  /// [`AttributeKind::is_extern_indicator`]: rustc_attr_ir::AttributeKind::is_extern_indicator
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:276 contains_extern_indicator
  contains_extern_indicator(self: CodegenFnAttrs): boolean {
    if (CodegenFnAttrFlags.contains(self.flags, CodegenFnAttrFlags.FOREIGN_ITEM)) {
      return false;
    }

    return (
      CodegenFnAttrFlags.contains(self.flags, CodegenFnAttrFlags.NO_MANGLE) ||
      CodegenFnAttrFlags.contains(self.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL) ||
      // note: for these we do also set a symbol name so technically also handled by the
      // condition below. However, I think that regardless these should be treated as extern.
      CodegenFnAttrFlags.contains(self.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM) ||
      // `#[rustc_offload_kernel]`: this item is an externally-launched kernel entry point.
      CodegenFnAttrFlags.contains(self.flags, CodegenFnAttrFlags.OFFLOAD_KERNEL) ||
      self.symbol_name !== undefined ||
      // These are private, so make sure we don't try to consider
      // them external.
      (self.linkage === undefined || self.linkage === "Internal" ? false : true)
    );
  },
} as const;

// rustc-type: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:298 SanitizerFnAttrs
// #[derive(Clone, Copy, Debug, StableHash, TyEncodable, TyDecodable, Eq, PartialEq)]
export interface SanitizerFnAttrs {
  disabled: SanitizerSet;
  rtsan_setting: RtsanSetting;
}
export const debug_SanitizerFnAttrs: Debug<SanitizerFnAttrs> = (v, f) =>
  debug_struct(f, "SanitizerFnAttrs", [
    ["disabled", debug_SanitizerSet(v.disabled, f)],
    ["rtsan_setting", debug_RtsanSetting(v.rtsan_setting, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function SanitizerFnAttrs_eq(a: SanitizerFnAttrs, b: SanitizerFnAttrs): boolean {
  return a.disabled === b.disabled && a.rtsan_setting === b.rtsan_setting;
}
/** `#[derive(TyDecodable)]` */
export function decode_SanitizerFnAttrs(__decoder: SpanDecoder): SanitizerFnAttrs {
  const disabled = decode_SanitizerSet(__decoder);
  const rtsan_setting = decode_RtsanSetting(__decoder);
  return { disabled, rtsan_setting };
}
/** `#[derive(TyEncodable)]` */
export function encode_SanitizerFnAttrs(self: SanitizerFnAttrs, __encoder: SpanEncoder): void {
  encode_SanitizerSet(self.disabled, __encoder);
  encode_RtsanSetting(self.rtsan_setting, __encoder);
}

// const impl Default for SanitizerFnAttrs
export const SanitizerFnAttrs = {
  // rustc: compiler/rustc_middle/src/middle/codegen_fn_attrs.rs:305 default
  default(): SanitizerFnAttrs {
    // PORT: `RtsanSetting::default()` is `Caller` (`#[derive_const(Default)]`, `#[default] Caller`).
    return { disabled: SanitizerSet.empty(), rtsan_setting: "Caller" };
  },
} as const;

/** `Ord::max` on `Option<Align>` (`None < Some(_)`; ties return the second argument). */
export function Option_Align_max(a: Align | undefined, b: Align | undefined): Align | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Align_max(a, b);
}

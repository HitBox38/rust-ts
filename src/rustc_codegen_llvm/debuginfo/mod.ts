// Port of compiler/rustc_codegen_llvm/src/debuginfo/mod.rs (skeleton: lane cg-contract; bodies: lane cg-di-a, plan-m7 wave 40p).
// #![doc = include_str!("doc.md")]
//
// `impl Builder` (`get_dbg_loc`), `impl DebugInfoBuilderMethods for Builder`, `impl CodegenCx` and
// `impl DebugInfoCodegenMethods for CodegenCx` are attached with PORTING §5's extension pattern (lib.ts imports this file after
// the classes' own modules). `metadata.rs` is mostly wave 44's (plan-m7 D9): its fns called here are typed stops in
// debuginfo/metadata.ts, so a `-Cdebuginfo>0` case stops by name there (or at the IR model's `LLVMDI*` stubs).
//
// PORT (cg-di-a):
// - `mod di_builder; mod dwarf_const; mod gdb; pub(crate) mod metadata; mod namespace; mod utils;` are the sibling files,
//   imported where used. The `pub(crate) use` re-exports (`DIBuilderExt`, `build_global_var_di_node`) are re-exported here;
//   consts.ts still calls `build_global_var_di_node` from debuginfo/metadata.ts (its header).
// - Free fns taking `&CodegenCx` called with a `Builder` (deref coercion) are passed `this.cx_` (cg-contract's rule, as
//   `cx.scx` for a `&SimpleCx`). `self.typing_env()` is `HasTypingEnv::typing_env_()` (context.ts header); `self.llcx` (an `SCx`
//   field reached through the derefs) is the accessor `llcx()`.
// - `name: String` handed to `type_names` as `&mut String` is a `MutRef<string>` (ssa-debuginfo's type_names.ts);
//   `String::with_capacity(64)` is the empty string. `x.as_ptr(), x.len()` is the string and its UTF-8 length (`utf8_len`).
// - The nested fns of `dbg_scope_fn` (`get_function_signature`, `get_template_parameters`, `get_parameter_names`,
//   `get_containing_scope`) stay nested, after the `return`, with markers (ssa-debuginfo's convention for type_names.rs).
// - Bitflags: `a | b` is `union`, `a & !b` is `intersection(a, complement(b))` (vendor bitflags).
// - `&Option<Range<Size>>` is `readonly [Size, Size] | undefined` (traits/debuginfo.ts); `SmallVec<[u64; 8]>` of address
//   operations is a `bigint[]` (`LLVMDIBuilderCreateExpression` takes `readonly bigint[]`), each `Size::bytes()`/`bits()`
//   converted with `BigInt`.
// - `CodegenUnitDebugContext`'s fields:
//   - `created_files: RefCell<UnordMap<Option<(StableSourceFileId, SourceFileHash)>, &DIFile>>` is a `KeyedMap` keyed by the
//     derived `Eq` of the key: `None`, or the id's `Hash128` and the hash's kind and bytes (`key_created_files`).
//   - `type_map: metadata::TypeMap` is metadata/type_map.rs's (wave 44): an opaque type whose `Default` is a typed stop.
//   - `adt_stack` is a `[DefId, GenericArgsRef][]`; `namespace_map` a `DefIdMap`; `recursion_marker_type: OnceCell<&DIType>`
//     is `DIType | undefined`.
// - `Instance`'s methods are its companion's (`Instance.def_id(instance)`). `args.terms().next().is_none()` asks the iterator for
//   its first item (`Symbol` is rustc_span's in this file, so the JS one is `globalThis.Symbol`).
// - `tracing::debug!` is a comment.
import type { Size } from "../../rustc_abi/lib.ts";
import { push_generic_args, push_item_name } from "../../rustc_codegen_ssa/debuginfo/type_names.ts";
import type { VariableKind } from "../../rustc_codegen_ssa/mir/debuginfo.ts";
import { fold_GenericArgs, type GenericArgs, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { debug_FnAbiError } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Session } from "../../rustc_session/session.ts";
import { DefId, DefIdMap, DefId_eq } from "../../rustc_span/def_id.ts";
import { type BytePos, RelativeBytePos, type SourceFile, type SourceFileHash, Span, type StableSourceFileId } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { FnAbi } from "../../rustc_target/callconv/mod.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { unwrap } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { utf8, utf8_len } from "../../std/str.ts";
import { Builder } from "../builder.ts";
import { CodegenCx } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import type { DIArray, DIFile, DILexicalBlock, DILocation, DIScope, DITemplateTypeParameter, DIType, DIVariable, Metadata, Module, Value } from "../llvm/mod.ts";
import { DIBuilderBox, DIBuilderExt_for_DIBuilder } from "./di_builder.ts";
import { DW_OP_LLVM_fragment, DW_OP_deref, DW_OP_plus_uconst, DW_OP_stack_value } from "./dwarf_const.ts";
import * as gdb from "./gdb.ts";
import * as metadata from "./metadata.ts";
import { UNKNOWN_COLUMN_NUMBER, UNKNOWN_LINE_NUMBER, create_subroutine_type, file_metadata, spanned_type_di_node, type_di_node, type TypeMap } from "./metadata.ts";
import * as namespace from "./namespace.ts";
import { mangled_name_of_instance } from "./namespace.ts";
import { DIB, create_DIArray, is_node_local_to_unit } from "./utils.ts";

// pub(crate) use self::di_builder::DIBuilderExt;
export type { DIBuilderExt } from "./di_builder.ts";
// pub(crate) use self::metadata::build_global_var_di_node;
export { build_global_var_di_node } from "./metadata.ts";

/** The key of `created_files` (header): the derived `Eq` of `Option<(StableSourceFileId, SourceFileHash)>`. */
function key_created_files(k: readonly [StableSourceFileId, SourceFileHash] | undefined): string {
  if (k === undefined) return "None";
  const [id, hash] = k;
  let hex = "";
  for (const b of hash.value) hex += b.toString(16).padStart(2, "0");
  return `Some(${id.hash().toString(16)},${hash.kind},${hex})`;
}

/// A context object for maintaining all state needed by the debuginfo module.
export class CodegenUnitDebugContext {
  constructor(
    public builder: DIBuilderBox,
    public created_files: KeyedMap<readonly [StableSourceFileId, SourceFileHash] | undefined, DIFile>,

    public type_map: TypeMap,
    public adt_stack: [DefId, GenericArgs][],
    public namespace_map: DefIdMap<DIScope>,
    public recursion_marker_type: DIType | undefined,
  ) {}

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:64 new
  static new(llmod: Module, sess: Session): CodegenUnitDebugContext {
    // debug!("CodegenUnitDebugContext::new");

    switch (sess.target.debuginfo_kind) {
      case "Dwarf":
      case "DwarfDsym": {
        // Debuginfo generation in LLVM by default uses a higher
        // version of dwarf than macOS currently understands. We can
        // instruct LLVM to emit an older version of dwarf, however,
        // for macOS to understand. For more info see #11352
        // This can be overridden using --llvm-opts -dwarf-version,N.
        // Android has the same issue (#22398)
        llvm.add_module_flag_u32(
          llmod,
          // In the case where multiple CGUs with different dwarf version
          // values are being merged together, such as with cross-crate
          // LTO, then we want to use the highest version of dwarf
          // we can. This matches Clang's behavior as well.
          llvm.ModuleFlagMergeBehavior.Max,
          "Dwarf Version",
          sess.dwarf_version(),
        );
        break;
      }
      case "Pdb": {
        // Indicate that we want CodeView debug information
        llvm.add_module_flag_u32(llmod, llvm.ModuleFlagMergeBehavior.Warning, "CodeView", 1);
        break;
      }
    }

    // Prevent bitcode readers from deleting the debug info.
    llvm.add_module_flag_u32(llmod, llvm.ModuleFlagMergeBehavior.Warning, "Debug Info Version", llvm.LLVMRustDebugMetadataVersion());

    const builder = DIBuilderBox.new(llmod);
    // DIBuilder inherits context from the module, so we'd better use the same one
    return new CodegenUnitDebugContext(
      /* builder */ builder,
      /* created_files */ new KeyedMap(key_created_files),
      /* type_map */ metadata.TypeMap_default(),
      /* adt_stack */ [],
      /* namespace_map */ new DefIdMap(),
      /* recursion_marker_type */ undefined,
    );
  }

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:117 finalize
  finalize(): void {
    llvm.LLVMDIBuilderFinalize(this.builder.as_ref());
  }
}

// ---- impl<'ll> Builder<'_, 'll, '_> (debuginfo/mod.rs:122) ----
declare module "../builder.ts" {
  interface Builder {
    get_dbg_loc(): DILocation | undefined;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:123 get_dbg_loc
Builder.prototype.get_dbg_loc = function (this: Builder): DILocation | undefined {
  return llvm.LLVMGetCurrentDebugLocation2(this.llbuilder);
};

// ---- impl<'ll, 'tcx> DebugInfoBuilderMethods<'tcx> for Builder<'_, 'll, 'tcx> (debuginfo/mod.rs:128) ----
declare module "../builder.ts" {
  interface Builder {
    dbg_scope_fn(instance: Instance, fn_abi: FnAbi<Ty>, maybe_definition_llfn: Value | undefined): DIScope;
    dbg_create_lexical_block(pos: BytePos, parent_scope: DIScope): DIScope;
    dbg_location_clone_with_discriminator(loc: DILocation, discriminator: number): DILocation | undefined;
    dbg_loc(scope: DIScope, inlined_at: DILocation | undefined, span: Span): DILocation;
    extend_scope_to_file(scope_metadata: DIScope, file: SourceFile): DIScope;
    create_dbg_var(variable_name: Symbol, variable_type: Ty, scope_metadata: DIScope, variable_kind: VariableKind, span: Span): DIVariable;
    dbg_var_addr(dbg_var: DIVariable, dbg_loc: DILocation, variable_alloca: Value, direct_offset: Size, indirect_offsets: readonly Size[], fragment: readonly [Size, Size] | undefined): void;
    dbg_var_value(dbg_var: DIVariable, dbg_loc: DILocation, value: Value, direct_offset: Size, indirect_offsets: readonly Size[], fragment: readonly [Size, Size] | undefined): void;
    set_dbg_loc(dbg_loc: DILocation): void;
    clear_dbg_loc(): void;
    insert_reference_to_gdb_debug_scripts_section_global(): void;
    set_var_name(value: Value, name: string): void;
    with_move_annotation<R>(instance: Instance, f: (self: this) => R): R;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:129 dbg_scope_fn
Builder.prototype.dbg_scope_fn = function (this: Builder, instance: Instance, fn_abi: FnAbi<Ty>, maybe_definition_llfn: Value | undefined): DIScope {
  const tcx = this.tcx;

  const def_id = Instance.def_id(instance);
  const [containing_scope, is_method] = get_containing_scope(this.cx_, instance);
  const span = tcx.def_span(def_id);
  const loc = this.lookup_debug_loc(Span.lo(span));
  const file_metadata_ = file_metadata(this.cx_, loc.file);

  const function_type_metadata = create_subroutine_type(this.cx_, get_function_signature(this.cx_, fn_abi, span));

  const name = { value: "" };
  push_item_name(tcx, def_id, false, name);

  // Find the enclosing function, in case this is a closure.
  const enclosing_fn_def_id = tcx.typeck_root_def_id(def_id);

  // We look up the generics of the enclosing function and truncate the args
  // to their length in order to cut off extra stuff that might be in there for
  // closures or coroutines.
  const generics = tcx.generics_of(enclosing_fn_def_id) as Generics;
  const args = instance.args.truncate_to(tcx, generics);

  push_generic_args(tcx, tcx.normalize_erasing_regions(this.typing_env_(), Unnormalized.new_wip(args), fold_GenericArgs), name);

  const template_parameters = get_template_parameters(this.cx_, generics, args);

  const linkage_name0 = mangled_name_of_instance(this.cx_, instance).name;
  // Omit the linkage_name if it is the same as subprogram name.
  const linkage_name = name.value === linkage_name0 ? "" : linkage_name0;

  // FIXME(eddyb) does this need to be separate from `loc.line` for some reason?
  const scope_line = loc.line;

  let flags = llvm.DIFlags.FlagPrototyped;

  if (fn_abi.ret.layout.is_uninhabited()) {
    flags = llvm.DIFlags.union(flags, llvm.DIFlags.FlagNoReturn);
  }

  let spflags = llvm.DISPFlags.SPFlagDefinition;
  if (is_node_local_to_unit(this.cx_, def_id)) {
    spflags = llvm.DISPFlags.union(spflags, llvm.DISPFlags.SPFlagLocalToUnit);
  }
  if (this.sess().opts.optimize !== "No") {
    spflags = llvm.DISPFlags.union(spflags, llvm.DISPFlags.SPFlagOptimized);
  }
  const entry = tcx.entry_fn(null) as readonly [DefId, unknown] | undefined;
  if (entry !== undefined) {
    const [id] = entry;
    if (DefId_eq(id, def_id)) {
      spflags = llvm.DISPFlags.union(spflags, llvm.DISPFlags.SPFlagMainSubprogram);
    }
  }

  // When we're adding a method to a type DIE, we only want a DW_AT_declaration there, because
  // LLVM LTO can't unify type definitions when a child DIE is a full subprogram definition.
  // When we use this `decl` below, the subprogram definition gets created at the CU level
  // with a DW_AT_specification pointing back to the type's declaration.
  const decl = is_method
    ? llvm.LLVMRustDIBuilderCreateMethod(
        DIB(this.cx_),
        containing_scope,
        name.value,
        utf8_len(name.value),
        linkage_name,
        utf8_len(linkage_name),
        file_metadata_,
        loc.line,
        function_type_metadata,
        flags,
        llvm.DISPFlags.intersection(spflags, llvm.DISPFlags.complement(llvm.DISPFlags.SPFlagDefinition)),
        template_parameters,
      )
    : undefined;

  return llvm.LLVMRustDIBuilderCreateFunction(
    DIB(this.cx_),
    containing_scope,
    name.value,
    utf8_len(name.value),
    linkage_name,
    utf8_len(linkage_name),
    file_metadata_,
    loc.line,
    function_type_metadata,
    scope_line,
    flags,
    spflags,
    maybe_definition_llfn,
    template_parameters,
    decl,
  );

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:233 get_function_signature
  function get_function_signature(cx: CodegenCx, fn_abi: FnAbi<Ty>, span: Span): (Metadata | undefined)[] {
    if (cx.sess().opts.debuginfo !== "Full") {
      return [];
    }

    const signature: (Metadata | undefined)[] = [];

    // Return type -- llvm::DIBuilder wants this at index 0
    signature.push(fn_abi.ret.is_ignore() ? undefined : spanned_type_di_node(cx, fn_abi.ret.layout.ty, span));

    // Arguments types
    if (cx.sess().target.is_like_msvc) {
      // FIXME(#42800):
      // There is a bug in MSDIA that leads to a crash when it encounters
      // a fixed-size array of `u8` or something zero-sized in a
      // function-type (see #40477).
      // As a workaround, we replace those fixed-size arrays with a
      // pointer-type. So a function `fn foo(a: u8, b: [u8; 4])` would
      // appear as `fn foo(a: u8, b: *const u8)` in debuginfo,
      // and a function `fn bar(x: [(); 7])` as `fn bar(x: *const ())`.
      // This transformed type is wrong, but these function types are
      // already inaccurate due to ABI adjustments (see #42800).
      signature.push(
        ...fn_abi.args.map((arg) => {
          const t0 = arg.layout.ty;
          const k = t0.kind();
          const t = k.$ === "Array" && (k._0 === cx.tcx.types.u8 || cx.layout_of(k._0).is_zst()) ? Ty.new_imm_ptr(cx.tcx, k._0) : t0;
          return spanned_type_di_node(cx, t, span);
        }),
      );
    } else {
      signature.push(...fn_abi.args.map((arg) => spanned_type_di_node(cx, arg.layout.ty, span)));
    }

    return signature;
  }

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:287 get_template_parameters
  function get_template_parameters(cx: CodegenCx, generics: Generics, args: GenericArgs): DIArray {
    if (args.terms()[globalThis.Symbol.iterator]().next().done === true) {
      return create_DIArray(DIB(cx), []);
    }

    // Again, only create type information if full debuginfo is enabled
    let template_params: (DITemplateTypeParameter | undefined)[];
    if (cx.sess().opts.debuginfo === "Full") {
      const names = get_parameter_names(cx, generics);
      template_params = [];
      const n = Math.min(args.length, names.length);
      for (let i = 0; i < n; i++) {
        const kind = args[i]!;
        const name = names[i]!;
        // FIXME: debug info for consts (using `createTemplateValueParameter`?)
        const ty = GenericArg.as_type(kind);
        if (ty !== undefined) {
          const actual_type = cx.tcx.normalize_erasing_regions(cx.typing_env_(), Unnormalized.new_wip(ty), fold_Ty);
          const actual_type_metadata = type_di_node(cx, actual_type);
          template_params.push(cx.create_template_type_parameter(Symbol.as_str(name), actual_type_metadata));
        }
      }
    } else {
      template_params = [];
    }

    return create_DIArray(DIB(cx), template_params);
  }

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:322 get_parameter_names
  function get_parameter_names(cx: CodegenCx, generics: Generics): Symbol[] {
    const names = generics.parent === undefined ? [] : get_parameter_names(cx, cx.tcx.generics_of(generics.parent) as Generics);
    names.push(...generics.own_params.map((param) => param.name));
    return names;
  }

  /// Returns a scope, plus `true` if that's a type scope for "class" methods,
  /// otherwise `false` for plain namespace scopes.
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:332 get_containing_scope
  function get_containing_scope(cx: CodegenCx, instance: Instance): [DIScope, boolean] {
    // First, let's see if this is a method within an inherent impl. Because
    // if yes, we want to make the result subroutine DIE a child of the
    // subroutine's self-type.
    // For trait method impls we still use the "parallel namespace"
    // strategy
    const imp_def_id = cx.tcx.inherent_impl_of_assoc(Instance.def_id(instance));
    if (imp_def_id !== undefined) {
      const impl_self_ty = cx.tcx.instantiate_and_normalize_erasing_regions(
        instance.args,
        cx.typing_env_(),
        cx.tcx.type_of(imp_def_id) as EarlyBinder<Ty>,
        fold_Ty,
      );

      // Only "class" methods are generally understood by LLVM,
      // so avoid methods on other types (e.g., `<*mut T>::null`).
      const k = impl_self_ty.kind();
      if (k.$ === "Adt" && !k._0.is_box()) {
        const def = k._0;
        // Again, only create type information if full debuginfo is enabled
        if (cx.sess().opts.debuginfo === "Full" && !TypeVisitableExt.has_param(impl_self_ty, fold_Ty)) {
          return [type_di_node(cx, impl_self_ty), true];
        } else {
          return [namespace.item_namespace(cx, def.did()), false];
        }
      }
    }

    const scope = namespace.item_namespace(
      cx,
      new DefId(
        /* index */ unwrap(cx.tcx.def_key(Instance.def_id(instance)).parent, "get_containing_scope: missing parent?"),
        /* krate */ Instance.def_id(instance).krate,
      ),
    );
    return [scope, false];
  }
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:377 dbg_create_lexical_block
Builder.prototype.dbg_create_lexical_block = function (this: Builder, pos: BytePos, parent_scope: DIScope): DIScope {
  const loc = this.lookup_debug_loc(pos);
  const file_metadata_ = file_metadata(this.cx_, loc.file);
  return llvm.LLVMDIBuilderCreateLexicalBlock(DIB(this.cx_), parent_scope, file_metadata_, loc.line, loc.col);
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:395 dbg_location_clone_with_discriminator
Builder.prototype.dbg_location_clone_with_discriminator = function (this: Builder, loc: DILocation, discriminator: number): DILocation | undefined {
  return llvm.LLVMRustDILocationCloneWithBaseDiscriminator(loc, discriminator);
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:403 dbg_loc
Builder.prototype.dbg_loc = function (this: Builder, scope: DIScope, inlined_at: DILocation | undefined, span: Span): DILocation {
  let line: number;
  let col: number;
  if (Span.is_dummy(span)) {
    [line, col] = [0, 0];
  } else {
    const { line: line_, col: col_ } = this.lookup_debug_loc(Span.lo(span));
    [line, col] = [line_, col_];
  }

  return llvm.LLVMDIBuilderCreateDebugLocation(this.llcx(), line, col, scope, inlined_at);
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:419 extend_scope_to_file
Builder.prototype.extend_scope_to_file = function (this: Builder, scope_metadata: DIScope, file: SourceFile): DILexicalBlock {
  return metadata.extend_scope_to_file(this.cx_, scope_metadata, file);
};

// FIXME(eddyb) find a common convention for all of the debuginfo-related
// names (choose between `dbg`, `debug`, `debuginfo`, `debug_info` etc.).
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:429 create_dbg_var
Builder.prototype.create_dbg_var = function (
  this: Builder,
  variable_name: Symbol,
  variable_type: Ty,
  scope_metadata: DIScope,
  variable_kind: VariableKind,
  span: Span,
): DIVariable {
  const loc = this.lookup_debug_loc(Span.lo(span));
  const file_metadata_ = file_metadata(this.cx_, loc.file);

  const type_metadata = spanned_type_di_node(this.cx_, variable_type, span);

  const align = this.align_of(variable_type);

  const name = Symbol.as_str(variable_name);

  switch (variable_kind.$) {
    case "ArgumentVariable": {
      const arg_index = variable_kind._0;
      return llvm.LLVMDIBuilderCreateParameterVariable(
        DIB(this.cx_),
        scope_metadata,
        name,
        utf8_len(name),
        arg_index >>> 0,
        file_metadata_,
        loc.line,
        type_metadata,
        llvm.Bool.TRUE, // (preserve descriptor during optimizations)
        llvm.DIFlags.FlagZero,
      );
    }
    case "LocalVariable":
      return llvm.LLVMDIBuilderCreateAutoVariable(
        DIB(this.cx_),
        scope_metadata,
        name,
        utf8_len(name),
        file_metadata_,
        loc.line,
        type_metadata,
        llvm.Bool.TRUE, // (preserve descriptor during optimizations)
        llvm.DIFlags.FlagZero,
        align.bits() >>> 0,
      );
  }
};

// FIXME(eddyb) find a common convention for all of the debuginfo-related
// names (choose between `dbg`, `debug`, `debuginfo`, `debug_info` etc.).
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:480 dbg_var_addr
Builder.prototype.dbg_var_addr = function (
  this: Builder,
  dbg_var: DIVariable,
  dbg_loc: DILocation,
  variable_alloca: Value,
  direct_offset: Size,
  indirect_offsets: readonly Size[],
  fragment: readonly [Size, Size] | undefined,
): void {
  // use dwarf_const::{DW_OP_LLVM_fragment, DW_OP_deref, DW_OP_plus_uconst};

  // Convert the direct and indirect offsets and fragment byte range to address ops.
  const addr_ops: bigint[] = [];

  if (direct_offset.bytes() > 0) {
    addr_ops.push(DW_OP_plus_uconst);
    addr_ops.push(BigInt(direct_offset.bytes()));
  }
  for (const offset of indirect_offsets) {
    addr_ops.push(DW_OP_deref);
    if (offset.bytes() > 0) {
      addr_ops.push(DW_OP_plus_uconst);
      addr_ops.push(BigInt(offset.bytes()));
    }
  }
  if (fragment !== undefined) {
    const [start, end] = fragment;
    // `DW_OP_LLVM_fragment` takes as arguments the fragment's
    // offset and size, both of them in bits.
    addr_ops.push(DW_OP_LLVM_fragment);
    addr_ops.push(BigInt(start.bits()));
    addr_ops.push(BigInt(end.sub(start).bits()));
  }

  const di_builder = DIB(this.cx());
  const addr_expr = DIBuilderExt_for_DIBuilder.create_expression(di_builder, addr_ops);
  llvm.LLVMDIBuilderInsertDeclareRecordAtEnd(di_builder, variable_alloca, dbg_var, addr_expr, dbg_loc, this.llbb());
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:527 dbg_var_value
Builder.prototype.dbg_var_value = function (
  this: Builder,
  dbg_var: DIVariable,
  dbg_loc: DILocation,
  value: Value,
  direct_offset: Size,
  indirect_offsets: readonly Size[],
  fragment: readonly [Size, Size] | undefined,
): void {
  // use dwarf_const::{DW_OP_LLVM_fragment, DW_OP_deref, DW_OP_plus_uconst, DW_OP_stack_value};

  // Convert the direct and indirect offsets and fragment byte range to address ops.
  const addr_ops: bigint[] = [];

  if (direct_offset.bytes() > 0) {
    addr_ops.push(DW_OP_plus_uconst);
    addr_ops.push(BigInt(direct_offset.bytes()));
    addr_ops.push(DW_OP_stack_value);
  }
  for (const offset of indirect_offsets) {
    addr_ops.push(DW_OP_deref);
    if (offset.bytes() > 0) {
      addr_ops.push(DW_OP_plus_uconst);
      addr_ops.push(BigInt(offset.bytes()));
    }
  }
  if (fragment !== undefined) {
    const [start, end] = fragment;
    // `DW_OP_LLVM_fragment` takes as arguments the fragment's
    // offset and size, both of them in bits.
    addr_ops.push(DW_OP_LLVM_fragment);
    addr_ops.push(BigInt(start.bits()));
    addr_ops.push(BigInt(end.sub(start).bits()));
  }

  const di_builder = DIB(this.cx());
  const addr_expr = llvm.LLVMDIBuilderCreateExpression(di_builder, addr_ops, addr_ops.length);
  llvm.LLVMDIBuilderInsertDbgValueRecordAtEnd(di_builder, value, dbg_var, addr_expr, dbg_loc, this.llbb());
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:577 set_dbg_loc
Builder.prototype.set_dbg_loc = function (this: Builder, dbg_loc: DILocation): void {
  llvm.LLVMSetCurrentDebugLocation2(this.llbuilder, dbg_loc);
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:583 clear_dbg_loc
Builder.prototype.clear_dbg_loc = function (this: Builder): void {
  llvm.LLVMSetCurrentDebugLocation2(this.llbuilder, undefined);
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:589 insert_reference_to_gdb_debug_scripts_section_global
Builder.prototype.insert_reference_to_gdb_debug_scripts_section_global = function (this: Builder): void {
  gdb.insert_reference_to_gdb_debug_scripts_section_global(this);
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:593 set_var_name
Builder.prototype.set_var_name = function (this: Builder, value: Value, name: string): void {
  // Avoid wasting time if LLVM value names aren't even enabled.
  if (this.sess().fewer_names()) {
    return;
  }

  // Only function parameters and instructions are local to a function,
  // don't change the name of anything else (e.g. globals).
  const param_or_inst = llvm.LLVMIsAArgument(value) !== undefined || llvm.LLVMIsAInstruction(value) !== undefined;
  if (!param_or_inst) {
    return;
  }

  // Avoid replacing the name if it already exists.
  // While we could combine the names somehow, it'd
  // get noisy quick, and the usefulness is dubious.
  if (llvm.get_value_name(value).length === 0) {
    llvm.set_value_name(value, utf8(name));
  }
};

/// Annotate move/copy operations with debug info for profiling.
///
/// This creates a temporary debug scope that makes the move/copy appear as an inlined call to
/// `compiler_move<T, SIZE>()` or `compiler_copy<T, SIZE>()`. The provided closure is executed
/// with this temporary debug location active.
///
/// The `instance` parameter should be the monomorphized instance of the `compiler_move` or
/// `compiler_copy` function with the actual type and size.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:624 with_move_annotation
Builder.prototype.with_move_annotation = function <R>(this: Builder, instance: Instance, f: (self: Builder) => R): R {
  // Save the current debug location
  const saved_loc = this.get_dbg_loc();

  // Create a DIScope for the compiler_move/compiler_copy function
  // We use the function's FnAbi for debug info generation
  const fn_abi = unwrap_result(this.cx().tcx.fn_abi_of_instance(this.cx().typing_env_().as_query_input([instance, RawList.empty<Ty>()])), debug_FnAbiError);

  const di_scope = this.dbg_scope_fn(instance, fn_abi, undefined);

  // Create an inlined debug location:
  // - scope: the compiler_move/compiler_copy function
  // - inlined_at: the current location (where the move/copy actually occurs)
  // - span: use the function's definition span
  const fn_span = this.cx().tcx.def_span(Instance.def_id(instance));
  const inlined_loc = this.dbg_loc(di_scope, saved_loc, fn_span);

  // Set the temporary debug location
  this.set_dbg_loc(inlined_loc);

  // Execute the closure (which will generate the memcpy)
  const result = f(this);

  // Restore the original debug location
  if (saved_loc !== undefined) {
    this.set_dbg_loc(saved_loc);
  } else {
    this.clear_dbg_loc();
  }

  return result;
};

/// A source code location used to generate debug information.
// FIXME(eddyb) rename this to better indicate it's a duplicate of
// `rustc_span::Loc` rather than `DILocation`, perhaps by making
// `lookup_char_pos` return the right information instead.
export interface DebugLoc {
  /// Information about the original source file.
  file: SourceFile;
  /// The (1-based) line number.
  line: number;
  /// The (1-based) column number.
  col: number;
}

// ---- impl<'ll> CodegenCx<'ll, '_> (debuginfo/mod.rs:681) ----
declare module "../context.ts" {
  interface CodegenCx {
    lookup_debug_loc(pos: BytePos): DebugLoc;
    create_template_type_parameter(name: string, actual_type_metadata: DIType): DITemplateTypeParameter;
    debuginfo_finalize(): void;
  }
}

/// Looks up debug source information about a `BytePos`.
// FIXME(eddyb) rename this to better indicate it's a duplicate of
// `lookup_char_pos` rather than `dbg_loc`, perhaps by making
// `lookup_char_pos` return the right information instead.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:686 lookup_debug_loc
CodegenCx.prototype.lookup_debug_loc = function (this: CodegenCx, pos: BytePos): DebugLoc {
  let file: SourceFile;
  let line: number;
  let col: number;
  const r = this.sess().source_map().lookup_line(pos);
  if (r.$ === "Ok") {
    const { sf: file_, line: line0 } = r._0;
    const line_pos = file_.lines()[line0]!;

    // Use 1-based indexing.
    const line_ = (line0 + 1) >>> 0;
    const col_ = (RelativeBytePos.to_u32(RelativeBytePos.sub(file_.relative_position(pos), line_pos)) + 1) >>> 0;

    [file, line, col] = [file_, line_, col_];
  } else {
    [file, line, col] = [r._0, UNKNOWN_LINE_NUMBER, UNKNOWN_COLUMN_NUMBER];
  }

  // For MSVC, omit the column number.
  // Otherwise, emit it. This mimics clang behaviour.
  // See discussion in https://github.com/rust-lang/rust/issues/42921
  if (this.sess().target.is_like_msvc) {
    return { file, line, col: UNKNOWN_COLUMN_NUMBER };
  } else {
    return { file, line, col };
  }
};

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:710 create_template_type_parameter
CodegenCx.prototype.create_template_type_parameter = function (this: CodegenCx, name: string, actual_type_metadata: DIType): DITemplateTypeParameter {
  return llvm.LLVMRustDIBuilderCreateTemplateTypeParameter(DIB(this), undefined, name, utf8_len(name), actual_type_metadata);
};

/// Creates any deferred debug metadata nodes
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:727 debuginfo_finalize
CodegenCx.prototype.debuginfo_finalize = function (this: CodegenCx): void {
  const dbg_cx = this.dbg_cx;
  if (dbg_cx !== undefined) {
    // debug!("finalize");

    if (gdb.needs_gdb_debug_scripts_section(this)) {
      // Add a .debug_gdb_scripts section to this compile-unit. This will
      // cause GDB to try and load the gdb_load_rust_pretty_printers.py file,
      // which activates the Rust pretty printers for binary this section is
      // contained in.
      gdb.get_or_insert_gdb_debug_scripts_section_global(this);
    }

    dbg_cx.finalize();
  }
};

// ---- impl<'ll, 'tcx> DebugInfoCodegenMethods<'tcx> for CodegenCx<'ll, 'tcx> (debuginfo/mod.rs:744) ----
declare module "../context.ts" {
  interface CodegenCx {
    create_vtable_debuginfo(ty: Ty, trait_ref: ExistentialTraitRef | undefined, vtable: Value): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs:745 create_vtable_debuginfo
CodegenCx.prototype.create_vtable_debuginfo = function (this: CodegenCx, ty: Ty, trait_ref: ExistentialTraitRef | undefined, vtable: Value): void {
  metadata.create_vtable_di_node(this, ty, trait_ref, vtable);
};

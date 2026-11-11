// compiler/rustc_codegen_llvm/src/debuginfo/mod.rs: the SKELETON (lane cg-contract). The fill lane of debuginfo/mod.rs (cg-di-a or cg-di-b, plan-m7 §8 wave 44; root's split) owns this file and ports
// debuginfo/mod.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl DebugInfoBuilderMethods for Builder`, `impl DebugInfoCodegenMethods for CodegenCx`, and the type
// `CodegenUnitDebugContext` (an opaque placeholder, for `FullCx.dbg_cx`), as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { Size } from "../../rustc_abi/lib.ts";
import type { VariableKind } from "../../rustc_codegen_ssa/mir/debuginfo.ts";
import type { DebugInfoBuilderMethods, DebugInfoCodegenMethods } from "../../rustc_codegen_ssa/traits/debuginfo.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { BytePos, SourceFile, Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { FnAbi } from "../../rustc_target/callconv/mod.ts";
import type { ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import type { DILocation, DIScope, DIVariable, Module, Value } from "../llvm/mod.ts";
import type { Session } from "../../rustc_session/session.ts";
import { unported } from "../../std/panic.ts";
import { Builder } from "../builder.ts";
import { CodegenCx } from "../context.ts";

/** `pub(crate) struct CodegenUnitDebugContext<'ll, 'tcx>` (debuginfo/mod.rs:51), for `FullCx.dbg_cx`. Its fields are the debuginfo
 *  lane's to add; the methods other fill lanes call are typed stubs (review F2). */
export class CodegenUnitDebugContext {
  private constructor() {}

  // Stub (cg-contract): new (debuginfo/mod.rs:64)
  static new(_llmod: Module, _sess: Session): CodegenUnitDebugContext {
    return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs new");
  }

  // Stub (cg-contract): finalize (debuginfo/mod.rs:117)
  finalize(): void {
    return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs finalize");
  }
}

// ---- impl Builder (debuginfo/mod.rs:122): Cross-lane surface (cg-contract, review F2) ----
declare module "../builder.ts" {
  interface Builder {
    get_dbg_loc(): DILocation | undefined;
  }
}

// Stub (cg-contract): get_dbg_loc (debuginfo/mod.rs:123)
Builder.prototype.get_dbg_loc = function (this: Builder): DILocation | undefined {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs get_dbg_loc");
};

// ---- impl CodegenCx (debuginfo/mod.rs:681): Cross-lane surface (cg-contract, review F2) ----
declare module "../context.ts" {
  interface CodegenCx {
    debuginfo_finalize(): void;
  }
}

// Stub (cg-contract): debuginfo_finalize (debuginfo/mod.rs:727)
CodegenCx.prototype.debuginfo_finalize = function (this: CodegenCx): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs debuginfo_finalize");
};


// ---- impl DebugInfoCodegenMethods for CodegenCx (debuginfo/mod.rs:744) ----
declare module "../context.ts" {
  interface CodegenCx {
    create_vtable_debuginfo(ty: Ty, trait_ref: ExistentialTraitRef | undefined, vtable: Value): void;
  }
}

// Stub (cg-contract): DebugInfoCodegenMethods::create_vtable_debuginfo
CodegenCx.prototype.create_vtable_debuginfo = function (this: CodegenCx, _ty: Ty, _trait_ref: ExistentialTraitRef | undefined, _vtable: Value): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs create_vtable_debuginfo");
};

// ---- impl DebugInfoBuilderMethods for Builder (debuginfo/mod.rs:128) ----
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

// Stub (cg-contract): DebugInfoBuilderMethods::dbg_scope_fn
Builder.prototype.dbg_scope_fn = function (this: Builder, _instance: Instance, _fn_abi: FnAbi<Ty>, _maybe_definition_llfn: Value | undefined): DIScope {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs dbg_scope_fn");
};

// Stub (cg-contract): DebugInfoBuilderMethods::dbg_create_lexical_block
Builder.prototype.dbg_create_lexical_block = function (this: Builder, _pos: BytePos, _parent_scope: DIScope): DIScope {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs dbg_create_lexical_block");
};

// Stub (cg-contract): DebugInfoBuilderMethods::dbg_location_clone_with_discriminator
Builder.prototype.dbg_location_clone_with_discriminator = function (this: Builder, _loc: DILocation, _discriminator: number): DILocation | undefined {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs dbg_location_clone_with_discriminator");
};

// Stub (cg-contract): DebugInfoBuilderMethods::dbg_loc
Builder.prototype.dbg_loc = function (this: Builder, _scope: DIScope, _inlined_at: DILocation | undefined, _span: Span): DILocation {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs dbg_loc");
};

// Stub (cg-contract): DebugInfoBuilderMethods::extend_scope_to_file
Builder.prototype.extend_scope_to_file = function (this: Builder, _scope_metadata: DIScope, _file: SourceFile): DIScope {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs extend_scope_to_file");
};

// Stub (cg-contract): DebugInfoBuilderMethods::create_dbg_var
Builder.prototype.create_dbg_var = function (this: Builder, _variable_name: Symbol, _variable_type: Ty, _scope_metadata: DIScope, _variable_kind: VariableKind, _span: Span): DIVariable {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs create_dbg_var");
};

// Stub (cg-contract): DebugInfoBuilderMethods::dbg_var_addr
Builder.prototype.dbg_var_addr = function (this: Builder, _dbg_var: DIVariable, _dbg_loc: DILocation, _variable_alloca: Value, _direct_offset: Size, _indirect_offsets: readonly Size[], _fragment: readonly [Size, Size] | undefined): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs dbg_var_addr");
};

// Stub (cg-contract): DebugInfoBuilderMethods::dbg_var_value
Builder.prototype.dbg_var_value = function (this: Builder, _dbg_var: DIVariable, _dbg_loc: DILocation, _value: Value, _direct_offset: Size, _indirect_offsets: readonly Size[], _fragment: readonly [Size, Size] | undefined): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs dbg_var_value");
};

// Stub (cg-contract): DebugInfoBuilderMethods::set_dbg_loc
Builder.prototype.set_dbg_loc = function (this: Builder, _dbg_loc: DILocation): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs set_dbg_loc");
};

// Stub (cg-contract): DebugInfoBuilderMethods::clear_dbg_loc
Builder.prototype.clear_dbg_loc = function (this: Builder): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs clear_dbg_loc");
};

// Stub (cg-contract): DebugInfoBuilderMethods::insert_reference_to_gdb_debug_scripts_section_global
Builder.prototype.insert_reference_to_gdb_debug_scripts_section_global = function (this: Builder): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs insert_reference_to_gdb_debug_scripts_section_global");
};

// Stub (cg-contract): DebugInfoBuilderMethods::set_var_name
Builder.prototype.set_var_name = function (this: Builder, _value: Value, _name: string): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs set_var_name");
};

// Stub (cg-contract): DebugInfoBuilderMethods::with_move_annotation
Builder.prototype.with_move_annotation = function <R>(this: Builder, _instance: Instance, _f: (self: Builder) => R): R {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/mod.rs with_move_annotation");
};

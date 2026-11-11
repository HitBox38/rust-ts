// Port of compiler/rustc_codegen_ssa/src/traits/debuginfo.rs (lane ssa-contract). Conventions: backend.ts's header.
import type { Size } from "../../rustc_abi/lib.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { BytePos, SourceFile, Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { FnAbi } from "../../rustc_target/callconv/mod.ts";
import type { ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import type { VariableKind } from "../mir/debuginfo.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:11 DebugInfoCodegenMethods
export interface DebugInfoCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:12 create_vtable_debuginfo
  create_vtable_debuginfo(ty: Ty, trait_ref: ExistentialTraitRef | undefined, vtable: B["Value"]): void;
}

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:20 DebugInfoBuilderMethods
export interface DebugInfoBuilderMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // FIXME(eddyb) find a common convention for all of the debuginfo-related
  // names (choose between `dbg`, `debug`, `debuginfo`, `debug_info` etc.).
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:23 dbg_scope_fn
  dbg_scope_fn(instance: Instance, fn_abi: FnAbi<Ty>, maybe_definition_llfn: B["Function"] | undefined): B["DIScope"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:30 dbg_create_lexical_block
  dbg_create_lexical_block(pos: BytePos, parent_scope: B["DIScope"]): B["DIScope"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:36 dbg_location_clone_with_discriminator
  dbg_location_clone_with_discriminator(loc: B["DILocation"], discriminator: number): B["DILocation"] | undefined;

  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:42 dbg_loc
  dbg_loc(scope: B["DIScope"], inlined_at: B["DILocation"] | undefined, span: Span): B["DILocation"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:49 extend_scope_to_file
  extend_scope_to_file(scope_metadata: B["DIScope"], file: SourceFile): B["DIScope"];

  // FIXME(eddyb) find a common convention for all of the debuginfo-related
  // names (choose between `dbg`, `debug`, `debuginfo`, `debug_info` etc.).
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:57 create_dbg_var
  create_dbg_var(
    variable_name: Symbol,
    variable_type: Ty,
    scope_metadata: B["DIScope"],
    variable_kind: VariableKind,
    span: Span,
  ): B["DIVariable"];

  // FIXME(eddyb) find a common convention for all of the debuginfo-related
  // names (choose between `dbg`, `debug`, `debuginfo`, `debug_info` etc.).
  /** `fragment: &Option<Range<Size>>`: a `Range` is `[start, end)` as a pair. */
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:68 dbg_var_addr
  dbg_var_addr(
    dbg_var: B["DIVariable"],
    dbg_loc: B["DILocation"],
    variable_alloca: B["Value"],
    direct_offset: Size,
    // NB: each offset implies a deref (i.e. they're steps in a pointer chain).
    indirect_offsets: readonly Size[],
    // Byte range in the `dbg_var` covered by this fragment,
    // if this is a fragment of a composite `DIVariable`.
    fragment: readonly [Size, Size] | undefined,
  ): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:80 dbg_var_value
  dbg_var_value(
    dbg_var: B["DIVariable"],
    dbg_loc: B["DILocation"],
    value: B["Value"],
    direct_offset: Size,
    // NB: each offset implies a deref (i.e. they're steps in a pointer chain).
    indirect_offsets: readonly Size[],
    // Byte range in the `dbg_var` covered by this fragment,
    // if this is a fragment of a composite `DIVariable`.
    fragment: readonly [Size, Size] | undefined,
  ): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:92 set_dbg_loc
  set_dbg_loc(dbg_loc: B["DILocation"]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:93 clear_dbg_loc
  clear_dbg_loc(): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:94 insert_reference_to_gdb_debug_scripts_section_global
  insert_reference_to_gdb_debug_scripts_section_global(): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:95 set_var_name
  set_var_name(value: B["Value"], name: string): void;

  /// Hook to allow move/copy operations to be annotated for profiling.
  ///
  /// The `instance` parameter should be the monomorphized instance of the
  /// `compiler_move` or `compiler_copy` function with the actual type and size.
  ///
  /// Default implementation does no annotation (just executes the closure).
  // (provided) traits/debuginfo.rs:103 with_move_annotation -> DebugInfoBuilderMethods_provided.with_move_annotation
  with_move_annotation<R>(instance: Instance, f: (self: this) => R): R;
}

/** The provided methods of `DebugInfoBuilderMethods` (PORTING §8; `self` first). */
export const DebugInfoBuilderMethods_provided = {
  /// Hook to allow move/copy operations to be annotated for profiling.
  ///
  /// The `instance` parameter should be the monomorphized instance of the
  /// `compiler_move` or `compiler_copy` function with the actual type and size.
  ///
  /// Default implementation does no annotation (just executes the closure).
  // rustc: compiler/rustc_codegen_ssa/src/traits/debuginfo.rs:103 with_move_annotation
  with_move_annotation<S, R>(self: S, _instance: Instance, f: (self: S) => R): R {
    return f(self);
  },
};

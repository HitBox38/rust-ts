// Port of compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs (lane cg-di-a, plan-m7 wave 40p).
//
// PORT (cg-di-a):
// - `DIBuilderBox`'s `Drop` impl is the method `drop()`, called where upstream drops the box (the convention of
//   `OwnedTargetMachine::drop`); `ptr::NonNull::new(raw).unwrap()` is `unwrap(raw)`.
// - `trait DIBuilderExt<'ll>` is implemented for the foreign `&DIBuilder` (an opaque model handle, not a class), so it is an
//   interface of functions taking `self` with one impl table, `DIBuilderExt_for_DIBuilder` (PORTING §5, trait dispatch by
//   tables). The required method's marker sits on the interface member, as ssa-contract's traits do; the provided methods live
//   in `DIBuilderExt_provided` (PORTING §8), and the impl table forwards to them. Call sites write
//   `DIBuilderExt_for_DIBuilder.create_expression(di_builder, ..)` for upstream's `di_builder.create_expression(..)`.
// - `&[u64]` address operations are `readonly bigint[]` (ffi.ts's type for `LLVMDIBuilderCreateExpression`); `c_uint` is `number`.
// - `name.as_ptr(), name.len()` is the string and its UTF-8 length (`utf8_len`), as declare.ts.
import type { Align } from "../../rustc_abi/lib.ts";
import { unwrap } from "../../std/panic.ts";
import { utf8_len } from "../../std/str.ts";
import * as llvm from "../llvm/mod.ts";
import type { DIBuilder, Metadata, Module, Value } from "../llvm/mod.ts";

/// Owning pointer to a `DIBuilder<'ll>` that will dispose of the builder
/// when dropped. Use `.as_ref()` to get the underlying `&DIBuilder`
/// needed for debuginfo FFI calls.
export class DIBuilderBox {
  constructor(private readonly raw: DIBuilder) {}

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:17 new
  static new(llmod: Module): DIBuilderBox {
    const raw0 = llvm.LLVMCreateDIBuilder(llmod);
    const raw = unwrap(raw0);
    return new DIBuilderBox(raw);
  }

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:23 as_ref
  as_ref(): DIBuilder {
    // SAFETY: This is an owning pointer, so `&DIBuilder` is valid
    // for as long as `&self` is.
    return this.raw;
  }

  // ---- impl<'ll> Drop for DIBuilderBox<'ll> (di_builder.rs:30) ----
  // PORT: upstream's only drop is implicit: the box goes with `cx`'s `dbg_cx` when `cx` leaves scope at the end of
  // `module_codegen`'s block (base.rs:216, right after `debuginfo_finalize`). base.ts has no call yet. Nothing reaches it today
  // (under `-g` the model stops first at `LLVMCreateDIBuilder`), so the call belongs with llir-di (review cg-di-a N3).
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:31 drop
  drop(): void {
    llvm.LLVMDisposeDIBuilder(this.raw);
  }
}

/// Extension trait for defining safe wrappers and helper methods on
/// `&DIBuilder<'ll>`, without requiring it to be defined in the same crate.
export interface DIBuilderExt<Self> {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:39 as_di_builder
  as_di_builder(self: Self): DIBuilder;

  // (provided) di_builder.rs:41 create_expression -> DIBuilderExt_provided.create_expression
  create_expression(self: Self, addr_ops: readonly bigint[]): Metadata;

  // (provided) di_builder.rs:46 create_static_variable -> DIBuilderExt_provided.create_static_variable
  create_static_variable(
    self: Self,
    scope: Metadata | undefined,
    name: string,
    linkage_name: string,
    file: Metadata,
    line_number: number,
    ty: Metadata,
    is_local_to_unit: boolean,
    val: Value,
    decl: Metadata | undefined,
    align: Align | undefined,
  ): Metadata;
}

/** The provided methods of `DIBuilderExt` (PORTING §8; the impl table and `self` first). */
export const DIBuilderExt_provided = {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:41 create_expression
  create_expression<Self>(t: DIBuilderExt<Self>, self: Self, addr_ops: readonly bigint[]): Metadata {
    const this_ = t.as_di_builder(self);
    return llvm.LLVMDIBuilderCreateExpression(this_, addr_ops, addr_ops.length);
  },

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:46 create_static_variable
  create_static_variable<Self>(
    t: DIBuilderExt<Self>,
    self: Self,
    scope: Metadata | undefined,
    name: string,
    linkage_name: string,
    file: Metadata,
    line_number: number,
    ty: Metadata,
    is_local_to_unit: boolean,
    val: Value,
    decl: Metadata | undefined,
    align: Align | undefined,
  ): Metadata {
    const this_ = t.as_di_builder(self);
    const align_in_bits = align === undefined ? 0 : align.bits() >>> 0;

    // `LLVMDIBuilderCreateGlobalVariableExpression` would assert if we
    // gave it a null `Expr` pointer, so give it an empty expression
    // instead, which is what the C++ `createGlobalVariableExpression`
    // method would do if given a null `DIExpression` pointer.
    const expr = t.create_expression(self, []);

    const global_var_expr = llvm.LLVMDIBuilderCreateGlobalVariableExpression(
      this_,
      scope,
      name,
      utf8_len(name),
      linkage_name,
      utf8_len(linkage_name),
      file,
      line_number,
      ty,
      llvm.to_llvm_bool(is_local_to_unit),
      expr,
      decl,
      align_in_bits,
    );

    llvm.LLVMGlobalSetMetadata(val, llvm.MD_dbg, global_var_expr);

    return global_var_expr;
  },
};

// ---- impl<'ll> DIBuilderExt<'ll> for &DIBuilder<'ll> (di_builder.rs:92) ----
export const DIBuilderExt_for_DIBuilder: DIBuilderExt<DIBuilder> = {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs:93 as_di_builder
  as_di_builder(self: DIBuilder): DIBuilder {
    return self;
  },

  // All other methods have default bodies that rely on `as_di_builder`.
  create_expression(self: DIBuilder, addr_ops: readonly bigint[]): Metadata {
    return DIBuilderExt_provided.create_expression(DIBuilderExt_for_DIBuilder, self, addr_ops);
  },
  create_static_variable(self, scope, name, linkage_name, file, line_number, ty, is_local_to_unit, val, decl, align): Metadata {
    return DIBuilderExt_provided.create_static_variable(DIBuilderExt_for_DIBuilder, self, scope, name, linkage_name, file, line_number, ty, is_local_to_unit, val, decl, align);
  },
};


// Tests of the cg-contract skeleton (lane cg-contract): what tsc cannot see. tsc checks that `CodegenCx` implements
// `CodegenMethods<LlvmTypes>` and `MiscCodegenMethods<LlvmTypes>`, that `Builder` implements `BuilderMethods<LlvmTypes,
// CodegenCx>`, and that `Builder` is a `BuilderMethodsStatic`, without casts; it does not check that every declared member
// is attached at run time, nor the auto-deref forwarders lib.ts installs. The member lists are the ssa-contract interfaces'
// members (rustc_codegen_ssa/traits/*.ts), per implementing class.
import { describe, expect, test } from "bun:test";
import { Unported } from "../std/panic.ts";
import { LlvmCodegenBackend } from "./lib.ts";
import { Builder } from "./builder.ts";
import { CodegenCx, FullCx, GenericCx, SCx, SimpleCx } from "./context.ts";

/** Members of `BaseTypeCodegenMethods` (on `GenericCx`). */
const GENERIC_CX = [
  "type_i8", "type_i16", "type_i32", "type_i64", "type_i128", "type_isize", "type_f16", "type_f16b", "type_f32",
  "type_f64", "type_f128", "type_ppcf128", "type_array", "type_func", "type_kind", "type_ptr", "type_ptr_ext",
  "element_type", "vector_length", "float_width", "int_width", "val_ty",
];
/** Members of the other traits `CodegenCx` implements. */
const CODEGEN_CX = [
  "vtables", "apply_vcall_visibility_metadata", "get_fn", "get_fn_addr", "eh_personality", "sess",
  "set_frame_pointer_type", "apply_target_cpu_attr", "declare_c_main", "intrinsic_call_expects_place_always",
  "type_int", "type_from_integer", "type_from_float", "type_needs_drop", "type_is_sized", "type_is_freeze",
  "type_from_primitive", "type_from_scalar", "const_null", "const_undef", "const_poison", "const_bool", "const_i8",
  "const_i16", "const_i32", "const_i64", "const_int", "const_u8", "const_u32", "const_u64", "const_u128",
  "const_usize", "const_uint", "const_uint_big", "const_real", "const_str", "const_struct", "const_vector",
  "const_to_opt_uint", "const_to_opt_u128", "scalar_to_backend", "scalar_to_backend_with_pac",
  "const_ptr_byte_offset", "backend_type", "cast_backend_type", "fn_decl_backend_type", "fn_ptr_backend_type",
  "reg_backend_type", "immediate_backend_type", "scalar_pair_element_backend_type", "add_type_metadata",
  "set_type_metadata", "add_kcfi_type_metadata", "set_kcfi_type_metadata", "predefine_static", "predefine_fn",
  "static_addr_of", "codegen_static", "codegen_global_asm", "mangled_name", "create_vtable_debuginfo",
];
/** Members of the traits `Builder` implements itself. */
const BUILDER = [
  "cx", "llbb", "set_span", "append_sibling_block", "switch_to_block", "ret_void", "ret", "br", "br_with_attrs",
  "cond_br", "cond_br_with_expect", "switch", "switch_with_weights", "invoke", "unreachable",
  "unreachable_nonterminator", "add", "fadd", "fadd_fast", "fadd_algebraic", "sub", "fsub", "fsub_fast",
  "fsub_algebraic", "mul", "fmul", "fmul_fast", "fmul_algebraic", "udiv", "exactudiv", "sdiv", "exactsdiv", "fdiv",
  "fdiv_fast", "fdiv_algebraic", "urem", "srem", "frem", "frem_fast", "frem_algebraic", "shl", "lshr", "ashr",
  "unchecked_sadd", "unchecked_uadd", "unchecked_suadd", "unchecked_ssub", "unchecked_usub", "unchecked_susub",
  "unchecked_smul", "unchecked_umul", "unchecked_sumul", "and", "or", "or_disjoint", "xor", "neg", "fneg", "not",
  "checked_binop", "from_immediate", "to_immediate_scalar", "alloca", "alloca_with_ty", "load", "volatile_load",
  "atomic_load", "load_from_place", "load_operand", "write_operand_repeatedly", "assume_integer_range",
  "assume_nonnull", "range_metadata", "nonnull_metadata", "store", "store_to_place", "store_with_flags",
  "store_to_place_with_flags", "atomic_store", "gep", "inbounds_gep", "inbounds_nuw_gep", "ptradd",
  "inbounds_ptradd", "trunc", "unchecked_utrunc", "unchecked_strunc", "sext", "fptoui_sat", "fptosi_sat", "fptoui",
  "fptosi", "uitofp", "sitofp", "fptrunc", "fpext", "ptrtoint", "inttoptr", "bitcast", "intcast", "pointercast",
  "cast_float_to_int", "icmp", "fcmp", "three_way_compare", "memcpy", "memmove", "memset", "vscale",
  "typed_place_copy", "typed_place_copy_with_flags", "typed_place_swap", "select", "va_arg", "extract_element",
  "vector_splat", "extract_value", "insert_value", "set_personality_fn", "cleanup_landing_pad", "filter_landing_pad",
  "resume", "cleanup_pad", "cleanup_ret", "catch_pad", "catch_switch", "get_funclet_cleanuppad", "atomic_cmpxchg",
  "atomic_rmw", "atomic_fence", "set_invariant_load", "lifetime_start", "lifetime_end", "call", "tail_call", "zext",
  "apply_attrs_to_cleanup_callsite", "get_static", "store_fn_arg", "store_arg", "get_param",
  "codegen_intrinsic_call", "codegen_llvm_intrinsic_call", "abort_immediate", "assume", "expect", "ctpop",
  "type_checked_load", "va_start", "retag_mem", "retag_reg", "codegen_inline_asm", "dbg_scope_fn",
  "dbg_create_lexical_block", "dbg_location_clone_with_discriminator", "dbg_loc", "extend_scope_to_file",
  "create_dbg_var", "dbg_var_addr", "dbg_var_value", "set_dbg_loc", "clear_dbg_loc",
  "insert_reference_to_gdb_debug_scripts_section_global", "set_var_name", "with_move_annotation", "add_coverage",
];

function stops(f: () => unknown, what: RegExp): void {
  let e: unknown;
  try {
    f();
  } catch (x) {
    e = x;
  }
  expect(e).toBeInstanceOf(Unported);
  expect((e as Unported).what).toMatch(what);
}

describe("trait methods are attached at run time", () => {
  test("GenericCx: BaseTypeCodegenMethods (type_.ts)", () => {
    for (const name of GENERIC_CX) expect(typeof (GenericCx.prototype as unknown as Record<string, unknown>)[name]).toBe("function");
  });
  test("CodegenCx: every other CodegenCx trait", () => {
    for (const name of [...GENERIC_CX, ...CODEGEN_CX]) expect(typeof (CodegenCx.prototype as unknown as Record<string, unknown>)[name]).toBe("function");
  });
  test("Builder: its own traits, and every CodegenCx method through the deref forwarders", () => {
    for (const name of [...BUILDER, ...GENERIC_CX, ...CODEGEN_CX]) expect(typeof (Builder.prototype as unknown as Record<string, unknown>)[name]).toBe("function");
    expect(typeof Builder.build).toBe("function");
    expect(typeof Builder.append_block).toBe("function");
  });
});

describe("stubs name their fill lane", () => {
  test("one stub per owning file", () => {
    const cx = Object.create(CodegenCx.prototype) as CodegenCx;
    stops(() => cx.type_i8(), /^cg-types-attrs: compiler\/rustc_codegen_llvm\/src\/type_\.rs type_i8$/);
    stops(() => cx.const_bool(true), /^cg-context: .*\/common\.rs const_bool$/);
    stops(() => cx.sess(), /^cg-context: .*\/context\.rs sess$/);
    stops(() => cx.codegen_static(undefined as never), /^cg-abi-consts: .*\/consts\.rs codegen_static$/);
    stops(() => cx.mangled_name(undefined as never), /^cg-asm: .*\/asm\.rs mangled_name$/);
    stops(() => cx.predefine_fn(undefined as never, undefined as never, undefined as never, ""), /^cg-types-attrs: .*\/mono_item\.rs predefine_fn$/);
    const bx = Object.create(Builder.prototype) as Builder;
    stops(() => bx.ret_void(), /^cg-builder: .*\/builder\.rs ret_void$/);
    stops(() => bx.get_param(0), /^cg-abi-consts: .*\/abi\.rs get_param$/);
    stops(() => bx.abort_immediate(), /^cg-intrinsic-a: .*\/intrinsic\.rs abort_immediate$/);
    stops(() => bx.clear_dbg_loc(), /^cg-di-a: .*\/debuginfo\/mod\.rs clear_dbg_loc$/);
  });
});

describe("auto-deref", () => {
  /** A `FullCx` with marker values (`CodegenCx::new`, which builds real ones, is cg-context's). */
  function full_cx(): FullCx {
    const scx = new SimpleCx(new SCx("llmod" as never, "llcx" as never, "isize" as never));
    const args: unknown[] = Array.from({ length: 31 }, (_, i) => `field${i}`);
    args[0] = "tcx";
    args[2] = scx;
    return new (FullCx as unknown as new (...a: unknown[]) => FullCx)(...args);
  }

  test("CodegenCx reads and writes FullCx fields; Borrow / Deref reach the SCx", () => {
    const full = full_cx();
    const cx = new CodegenCx(full);
    expect(cx.tcx as unknown).toBe("tcx");
    expect(cx.scx).toBe(full.scx);
    cx.local_gen_sym_counter = 7;
    expect(full.local_gen_sym_counter).toBe(7);
    // Not forwarded (the name is also a method): reached through `_0`.
    expect(Object.getOwnPropertyDescriptor(CodegenCx.prototype, "vtables")?.get).toBeUndefined();
    expect(full.borrow().llmod as unknown).toBe("llmod");
    expect(full.deref()).toBe(full.scx);
    expect(cx.deref()).toBe(full);
  });

  test("Builder forwards CodegenCx members to its cx, and keeps its own", () => {
    const cx = new CodegenCx(full_cx());
    const bx = new Builder("llbuilder" as never, cx, 0 as never);
    expect(bx.tcx as unknown).toBe("tcx");
    expect(bx.deref()).toBe(cx);
    // CodegenCx trait methods, through the forwarders.
    stops(() => bx.type_i8(), /^cg-types-attrs: .* type_i8$/);
    stops(() => bx.const_usize(1n), /^cg-context: .* const_usize$/);
    // Builder's own `data_layout` (builder.rs:213), not the cx's (context.rs:1254).
    stops(() => bx.data_layout(), /^cg-builder: .* data_layout$/);
    // The Debug members of the associated types reach value.rs's impl.
    expect(bx.debug_Value).toBe(cx.debug_Value);
  });
});

describe("LlvmCodegenBackend", () => {
  test("name (llvm_backend.rs:176)", () => {
    expect(LlvmCodegenBackend.new().name()).toBe("llvm");
  });

  // What `rustc +nightly-2026-10-11 --print <kind>` prints on aarch64-apple-darwin (relocation-models, code-models,
  // tls-models, stack-protector-strategies): rustc_driver_impl prints what `print` appends, verbatim.
  const ORACLE: [string, string][] = [
  [
    "RelocationModels",
    "Available relocation models:\n    static\n    pic\n    pie\n    dynamic-no-pic\n    ropi\n    rwpi\n    ropi-rwpi\n    default\n\n"
  ],
  [
    "CodeModels",
    "Available code models:\n    tiny\n    small\n    kernel\n    medium\n    large\n\n"
  ],
  [
    "TlsModels",
    "Available TLS models:\n    global-dynamic\n    local-dynamic\n    initial-exec\n    local-exec\n    emulated\n\n"
  ],
  [
    "StackProtectorStrategies",
    "Available stack protector strategies:\n    all\n        Generate stack canaries in all functions.\n\n    strong\n        Generate stack canaries in a function if it either:\n        - has a local variable of `[T; N]` type, regardless of `T` and `N`\n        - takes the address of a local variable.\n\n          (Note that a local variable being borrowed is not equivalent to its\n          address being taken: e.g. some borrows may be removed by optimization,\n          while by-value argument passing may be implemented with reference to a\n          local stack variable in the ABI.)\n\n    basic\n        Generate stack canaries in functions with local variables of `[T; N]`\n        type, where `T` is byte-sized and `N` >= 8.\n\n    none\n        Do not generate stack canaries.\n\n"
  ]
];
  test.each(ORACLE)("print %s (llvm_backend.rs:257) matches the oracle", (kind, expected) => {
    const out = { value: "" };
    new LlvmCodegenBackend().print({ kind } as never, out, undefined as never);
    expect(out.value).toBe(expected);
  });

  test("what reaches an unported lane stops there, naming it", () => {
    const b = new LlvmCodegenBackend();
    stops(() => b.init(undefined as never), /^cg-write: .*\/llvm_util\.rs init$/);
    stops(() => b.print({ kind: "TargetCPUs" } as never, { value: "" }, undefined as never), /^cg-write: .*\/llvm_util\.rs print$/);
    stops(() => b.has_zstd(), /^llir: LLVMRustLLVMHasZstdCompression$/);
  });
});

// Tests of the cg-contract skeleton (lane cg-contract): what tsc cannot see. tsc checks that `CodegenCx` implements
// `CodegenMethods<LlvmTypes>` and `MiscCodegenMethods<LlvmTypes>`, that `Builder` implements `BuilderMethods<LlvmTypes,
// CodegenCx>`, and that `Builder` is a `BuilderMethodsStatic`, without casts; it does not check that every declared member
// is attached at run time, nor the auto-deref forwarders lib.ts installs. The member lists are the ssa-contract interfaces'
// members (rustc_codegen_ssa/traits/*.ts), per implementing class.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Align } from "../rustc_abi/lib.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { TyAndLayout as TyAndLayout_ } from "../rustc_abi/layout/ty.ts";
import "../rustc_target/lib.ts";
import { FnAbi } from "../rustc_target/callconv/mod.ts";
import { Unported } from "../std/panic.ts";
import { LlvmCodegenBackend } from "./lib.ts";
import * as attributes from "./attributes.ts";
import { Builder, GenericBuilder } from "./builder.ts";
import * as common from "./common.ts";
import { CodegenCx, FullCx, GenericCx, SCx, SimpleCx } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";

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
    // cg-context ported context.rs and common.rs: `const_bool` (common.rs) now reaches `type_i1` (type_.rs, cg-types-attrs).
    stops(() => cx.const_bool(true), /^cg-types-attrs: .*\/type_\.rs type_i1$/);
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

describe("stub counts per lane", () => {
  // Every `unported("<lane>: ...")` in the crate's sources, by lane: trait methods, the cross-lane surface (review F2) and the
  // callees of back/llvm_backend.ts. A fill lane that ports a stub lowers its count here.
  const EXPECTED: Record<string, number> = {
    "cg-abi-consts": 20,
    "cg-asm": 4,
    "cg-builder": 151,
    "cg-di-a": 21,
    "cg-intrinsic-a": 10,
    "cg-intrinsic-b": 2,
    "cg-lto-diag": 8,
    "cg-types-attrs": 80,
    "cg-write": 21,
    // cg-context: `CguCoverageContext::new` in `CodegenCx::new` (review cg-contract-recheck N1).
    "excluded (plan-m7 D18)": 11,
    // cg-context: `LLVMGetFirstFunction` / `LLVMGetNextFunction` (llvm/enzyme_ffi.rs) in `get_functions`.
    "llir": 4,
    "rustc_codegen_llvm": 3,
    // cg-context: `StableHash for Allocation` in `alloc_to_backend`.
    "rustc_middle": 1,
    // cg-context: `SanitizerIgnoreList::new`, `typename_for_ignore_list` (rustc_sanitizers is out of scope).
    "rustc_sanitizers": 2,
    // cg-context: `Session::{needs_plt, must_emit_unwind_tables, branch_protection}` (not in rustc_session yet).
    "rustc_session": 3,
    // cg-context: `wants_msvc_seh` (base.rs) in `eh_personality`.
    "ssa-base": 2,
    "ssa-write": 5,
  };
  test("matches the table in docs/handoff/cg-contract.md", () => {
    const counts: Record<string, number> = {};
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
          for (const m of readFileSync(p, "utf8").matchAll(/unported\("([^:"]+):/g)) counts[m[1]!] = (counts[m[1]!] ?? 0) + 1;
        }
      }
    };
    walk(import.meta.dir);
    expect(counts).toEqual(EXPECTED);
  });
});

/** A fill lane's view (review F2): `cx.llcx()` and calls into other lanes' files typecheck as upstream reads. Each line is the
 *  upstream form it stands for. tsc checks this function; the test below runs it over marker objects. */
function fill_lane_sketch(cx: CodegenCx, bx: Builder, layout: TyAndLayout, fn_abi: FnAbi<Ty>, align: Align): unknown[] {
  const out: unknown[] = [];
  const step = (f: () => unknown): void => {
    try {
      out.push(f());
    } catch (e) {
      out.push(e instanceof Unported ? e.what : e);
    }
  };
  step(() => cx.llcx()); // cx.llcx (type_.rs:152, ported)
  step(() => bx.cx_.llmod()); // self.cx.llmod (field read written as the accessor)
  step(() => bx.isize_ty()); // bx.isize_ty(), through Builder's deref to CodegenCx
  step(() => cx.statics_to_rauw()); // context.rs:734, ported
  step(() => bx.type_i1()); // bx.type_i1() (type_.rs, cg-types-attrs)
  step(() => layout.llvm_type(cx)); // layout.llvm_type(cx) (type_of.rs LayoutLlvmExt)
  step(() => fn_abi.llvm_type(cx)); // fn_abi.llvm_type(cx) (abi.rs FnAbiLlvmExt)
  step(() => cx.declare_global("g", cx.type_i8())); // declare.rs
  step(() => cx.const_bytes(new Uint8Array([1]))); // common.rs
  step(() => cx.get_intrinsic("llvm.trap", [])); // context.rs:1087
  step(() => attributes.apply_to_llfn(undefined as never, llvm.AttributePlace.Function, [])); // attributes::apply_to_llfn
  step(() => common.val_ty(undefined as never)); // common::val_ty
  step(() => bx.load_inherent(cx.type_i8(), undefined as never, align)); // bx.load(..) on a concrete Builder (review F1)
  step(() => bx.call_intrinsic("llvm.trap", [], [])); // builder.rs:1881
  step(() => Builder.build_inherent(cx, undefined as never)); // Builder::build(cx, llbb): the inherent fn, typed `Builder`
  step(() => llvm_util.get_version()); // llvm_util::get_version
  const built: () => Builder = () => Builder.build_inherent(cx, undefined as never);
  void built;
  return out;
}

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
    stops(() => bx.const_bool(true), /^cg-types-attrs: .* type_i1$/); // common.rs const_bool (ported) through the forwarder
    // Builder's own `data_layout` (builder.rs:213), not the cx's (context.rs:1254).
    stops(() => bx.data_layout(), /^cg-builder: .* data_layout$/);
    // The Debug members of the associated types reach value.rs's impl.
    expect(bx.debug_Value).toBe(cx.debug_Value);
  });

  test("the fill-lane sketch: ported accessors answer, cross-lane calls stop in their owner's stub", () => {
    const cx = new CodegenCx(full_cx());
    const bx = new Builder("llbuilder" as never, cx, 0 as never);
    const layout = Object.create(TyAndLayout_.prototype) as TyAndLayout;
    const fn_abi = Object.create(FnAbi.prototype) as FnAbi<Ty>;
    expect(fill_lane_sketch(cx, bx, layout, fn_abi, undefined as never)).toEqual([
      "llcx",
      "llmod",
      "isize",
      "field11",
      "cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i1",
      expect.stringMatching(/^cg-types-attrs: .*\/type_of\.rs llvm_type$/) as unknown as string,
      expect.stringMatching(/^cg-abi-consts: .*\/abi\.rs llvm_type$/) as unknown as string,
      "cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i8",
      // cg-context ported `const_bytes` and `get_intrinsic`: they no longer stop in a stub (the marker `FullCx` has no real
      // LLVM context or maps, so they fail on its marker values instead).
      expect.not.stringMatching(/^cg-context:/) as unknown as string,
      expect.not.stringMatching(/^cg-context:/) as unknown as string,
      "cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs apply_to_llfn",
      expect.not.stringMatching(/^cg-context:/) as unknown as string, // common::val_ty, ported (cg-context)
      "cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i8",
      "cg-builder: compiler/rustc_codegen_llvm/src/builder.rs call_intrinsic",
      "cg-builder: compiler/rustc_codegen_llvm/src/builder.rs build",
      "cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs get_version",
    ]);
  });

  test("inherent before trait (review F1): GenericBuilder's inherent methods keep the `_inherent` names", () => {
    const names = ["trunc", "bitcast", "ret_void", "ret", "inbounds_gep", "store", "load", "va_arg"];
    for (const n of names) {
      expect(typeof (GenericBuilder.prototype as unknown as Record<string, unknown>)[`${n}_inherent`]).toBe("function");
      // The trait method is a different member of `Builder`.
      expect((Builder.prototype as unknown as Record<string, unknown>)[n]).not.toBe((GenericBuilder.prototype as unknown as Record<string, unknown>)[`${n}_inherent`]);
    }
    expect(typeof GenericBuilder.build_inherent).toBe("function");
    expect(typeof GenericBuilder.append_block_inherent).toBe("function");
    const bx = Object.create(Builder.prototype) as Builder;
    stops(() => bx.load_inherent(undefined as never, undefined as never, undefined as never), /^cg-builder: .*\/builder\.rs load$/);
    stops(() => bx.load(undefined as never, undefined as never, undefined as never), /^cg-builder: .*\/builder\.rs load$/);
    expect(typeof (GenericCx.prototype as unknown as Record<string, unknown>).const_null_inherent).toBe("function");
    expect(typeof (SimpleCx.prototype as unknown as Record<string, unknown>).val_ty_inherent).toBe("function");
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

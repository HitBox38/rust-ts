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
import { printValueToString } from "../rust_ts/llvm/printer.ts";
import { llvm_cl_args, with_fresh_llvm_options_for_tests } from "../rust_ts/llvm/target.ts";
import { Unported } from "../std/panic.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import "../rustc_session/lib.ts";
import { LlvmCodegenBackend } from "./lib.ts";
import * as attributes from "./attributes.ts";
import { Builder, GenericBuilder } from "./builder.ts";
import * as common from "./common.ts";
import * as debuginfo_metadata from "./debuginfo/metadata.ts";
import { CodegenCx, FullCx, GenericCx, SCx, SimpleCx } from "./context.ts";
import { generic_simd_intrinsic } from "./intrinsic.ts";
import type { Value } from "./llvm/mod.ts";
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
    // cg-types-attrs (type_.ts, ...) and cg-context (context.ts, common.ts) are ported: their members no longer stop
    // (type_of.test.ts, attributes.test.ts, context.test.ts).
    // cg-abi-consts (wave 41) ported abi.rs and consts.rs whole: no stub of its own is left (abi_consts.test.ts).
    stops(() => cx.mangled_name(undefined as never), /^cg-asm: .*\/asm\.rs mangled_name$/);
    const bx = Object.create(Builder.prototype) as Builder;
    // cg-builder (wave 41) ported builder.rs and allocator.rs whole: no stub of its own is left (builder.test.ts).
    // cg-intrinsic-a (wave 41) ported intrinsic.rs's scalar half (:1-2046); the SIMD half's entry stays cg-intrinsic-b's.
    stops(() => generic_simd_intrinsic(bx, undefined as never, undefined as never, [], undefined as never, undefined as never, undefined as never), /^cg-intrinsic-b: .*\/intrinsic\.rs generic_simd_intrinsic$/);
    // cg-di-a (wave 40p) ported debuginfo/{mod,utils,namespace,di_builder,dwarf_const,gdb}.rs whole, and metadata.rs's fns a
    // compile without `-g` reaches; the rest of metadata.rs stays a typed stop (wave 44, plan-m7 D9).
    stops(() => debuginfo_metadata.type_di_node(cx, undefined as never), /^cg-di-a: .*\/debuginfo\/metadata\.rs type_di_node$/);
  });
});

describe("stub counts per lane", () => {
  // Every `unported("<lane>: ...")` in the crate's sources, by lane: trait methods, the cross-lane surface (review F2) and the
  // callees of back/llvm_backend.ts. A fill lane that ports a stub lowers its count here.
  const EXPECTED: Record<string, number> = {
    "cg-asm": 4,
    // 21 cg-contract left; cg-di-a (wave 40p) ported debuginfo/mod.rs's 18 and 3 of metadata.rs (`build_global_var_di_node`,
    // `apply_vcall_visibility_metadata`, `create_vtable_di_node`). Left: the 9 metadata.rs fns that debuginfo/mod.rs and those
    // three call past their `-g` checks (wave 44, plan-m7 D9).
    "cg-di-a": 9,
    // cg-di-a: `TypeMap::default` (metadata/type_map.rs), in `CodegenUnitDebugContext::new` (wave 44).
    "cg-di-b": 1,
    "cg-intrinsic-b": 2,
    // cg-lto-diag (wave 40p) ported back/lto.rs, diagnostics.rs's hand impls and llvm/diagnostic.rs whole: no stub of its own is
    // left.
    // cg-write (wave 40o) ported back/write.rs, llvm_util.rs, back/owned_*, back/profiling.rs and back/archive.rs whole: no stub
    // of its own is left.
    // The 10 cg-contract left (plan-m7 D18), plus cg-context's `CguCoverageContext::new` in `CodegenCx::new` (review
    // cg-contract-recheck N1), plus cg-intrinsic-a's `OffloadMetadata::handle_abi` (rustc_middle ty/offload_meta.rs) in
    // `codegen_offload`, plus cg-write's 5 in back/write.ts (`EnzymeWrapper::get_instance`, three `RustOffloadWrapper` calls,
    // `gpu_offload::scalar_width`), plus cg-lto-diag's 2 in back/lto.ts (`EnzymeWrapper::get_instance` in
    // `enable_autodiff_settings`, `LLVMDumpModule` for `-Zautodiff=PrintModFinal`).
    "excluded (plan-m7 D18)": 19,
    // 2, plus cg-context's `LLVMGetFirstFunction` / `LLVMGetNextFunction` (llvm/enzyme_ffi.rs) in `get_functions` (cg-write's
    // `rustc_llvm::initialize_available_targets` stop became the IR model's port at integ-w56).
    "llir": 4,
    // 3, plus cg-types-attrs's 2, plus cg-intrinsic-a's 2 in intrinsic.ts (`i32 as u64` of a negative index,
    // `str::from_utf8(..).unwrap()`'s panic text; its third, `assert_matches!`'s message, is a template literal this count skips),
    // plus cg-write's non-UTF-8 symbol name in `create_msvc_imps`, plus cg-lto-diag's 4 in back/lto.ts (two `ThinLtoInput::Green`,
    // -C incremental; `-Clto=thin`; `ThinLTOKeysMap::from_thin_lto_modules` under the ThinLocal no-op with -C incremental).
    "rustc_codegen_llvm": 12,
    // cg-write: the self-profiler (`-Z self-profile`) in back/profiling.ts (`TimingGuard::start`) and back/write.ts
    // (`get_self_profiler`, `llvm_recording_enabled`, `artifact_size`).
    "rustc_data_structures": 4,
    // cg-write: `link_or_copy` in back/write.ts (`--emit=obj` of bitcode).
    "rustc_fs_util": 1,
    // "rustc_middle": 0 (entry dropped): stable-hash-alloc (wave 40o) made cg-context's `StableHash for Allocation` stop in
    // `alloc_to_backend` a call of the generated derive.
    // cg-context's 2 (`SanitizerIgnoreList::new`, `typename_for_ignore_list`) and cg-types-attrs's 3 (rustc_sanitizers is out
    // of scope).
    "rustc_sanitizers": 5,
    // cg-write: `filesearch::dll_path` in `configure_llvm`'s version-mismatch error.
    "rustc_session": 1,
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
    expect(bx.type_isize() as unknown).toBe("isize"); // type_.rs:209, ported (cg-types-attrs)
    // Builder's own `data_layout` (builder.rs:214, ported by cg-builder) forwards to the cx's (context.rs:1254, ported by
    // cg-context), which reads the marker `FullCx`'s tcx.
    expect(() => bx.data_layout()).toThrow(/this\.tcx\.data_layout is not a function/);
    // The Debug members of the associated types reach value.rs's impl.
    expect(bx.debug_Value).toBe(cx.debug_Value);
  });

  test("the fill-lane sketch: ported accessors answer, cross-lane calls stop in their owner's stub", () => {
    // cg-types-attrs's fns are ported, so the `SCx` holds real IR-model handles (a `FullCx` with markers elsewhere).
    const llcx = llvm.LLVMContextCreate();
    const llmod = llvm.LLVMModuleCreateWithNameInContext("sketch", llcx);
    const isize = llvm.LLVMInt64TypeInContext(llcx);
    const full = full_cx();
    full.scx = new SimpleCx(new SCx(llmod, llcx, isize));
    const cx = new CodegenCx(full);
    const bx = new Builder("llbuilder" as never, cx, 0 as never);
    const layout = Object.create(TyAndLayout_.prototype) as TyAndLayout;
    const fn_abi = Object.create(FnAbi.prototype) as FnAbi<Ty>;
    const out = fill_lane_sketch(cx, bx, layout, fn_abi, undefined as never);
    // Errors as `<name>: <message>`, so each expected failure names the marker value it fails on.
    const shown = out.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : x));
    const typeError = (re: RegExp): string => expect.stringMatching(new RegExp(`^TypeError: .*${re.source}`)) as unknown as string;
    expect(shown).toEqual([
      llcx,
      llmod,
      isize,
      "field11",
      llvm.LLVMInt1TypeInContext(llcx), // type_.rs:168, ported
      typeError(/this\.layout\.internee/), // type_of.rs:234, ported; a layout with no fields (type_of.test.ts has real ones)
      typeError(/this\.ret\.mode/), // abi.rs:364 FnAbiLlvmExt::llvm_type, ported (cg-abi-consts): a marker FnAbi with no fields
      llvm.LLVMRustGetNamedValue(llmod, "g", 1), // declare.rs:94, ported (cg-types-attrs)
      out[8], // common.rs const_bytes, ported (cg-context): checked below
      typeError(/intrinsics\.get is not a function/), // context.rs get_intrinsic, ported (cg-context): the marker `FullCx` has no intrinsic map
      undefined, // attributes.rs:29, ported: no attributes, no call
      typeError(/evaluating 'Val\.type'/), // common.rs val_ty, ported (cg-context): the marker value has no `type`
      typeError(/B\.createLoad is not a function/), // builder.rs load, ported (cg-builder): the marker llbuilder is no IR-model builder
      typeError(/intrinsics\.get is not a function/), // builder.rs:1881 call_intrinsic (cg-builder) reaches get_intrinsic, as above
      typeError(/evaluating 'Block\.insts'/), // builder.rs:130 build (cg-builder): the IR model rejects the marker basic block
      [23, 1, 3], // llvm_util.rs:469 get_version, ported (cg-write): the IR model's LLVMGetVersion (back/write.test.ts checks the oracle's)
    ]);
    expect(out[7]).toBeDefined();
    expect(printValueToString(out[8] as Value)).toBe("[1 x i8] c\"\\01\""); // const_bytes: a real constant in the real llcx
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
    // The bodies of `load` / `load_inherent` (and `store` / `store_inherent`) differ in the alignment clamp: builder.test.ts.
    expect(typeof (GenericCx.prototype as unknown as Record<string, unknown>).const_null_inherent).toBe("function");
    expect(typeof (SimpleCx.prototype as unknown as Record<string, unknown>).val_ty_inherent).toBe("function");
  });
});

/** Runs the port's driver for `rustc --crate-type lib context_oracle/empty.rs` with `backend` as its codegen backend
 *  (`Config::make_codegen_backend`), so that `run_compiler` calls `backend.init(early_sess)` as it does for any backend. */
function drive_init(backend: LlvmCodegenBackend): void {
  class CaptureConfig extends Error {}
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", "--crate-type", "lib", join(import.meta.dir, "context_oracle", "empty.rs")], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  config.make_codegen_backend = () => backend as never;
  run_compiler(config, () => {});
}

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
    // llvm_util.rs init, ported (cg-write), called by the driver on its early session. Since llir-init (root at integ-w56),
    // `configure_llvm` runs through the IR model's init, `initialize_available_targets` and `LLVMRustSetLLVMOptions`. With `CI`
    // set (the gate's unit step sets it, scripts/lib/unit-steps.ts) it also calls `LLVMRustDisableSystemDialogsOnCrash`, a no-op
    // on Unix since fixers-57 (Signals.inc:991), so `init` completes either way (review root-w56-check 1). The options are set on
    // fresh ones and put back after, as LLVM's are process-wide (target.ts `with_fresh_llvm_options_for_tests`).
    const args = with_fresh_llvm_options_for_tests(() => {
      drive_init(b);
      return llvm_cl_args();
    });
    // `configure_llvm` returned through `LLVMRustSetLLVMOptions`, its last call: these two are added unconditionally
    // (llvm_util.rs:136, :139). Then `require_inited` passes, which needs `INIT` completed (review root-w56-check 2): `print`
    // throws past it on the `undefined` session, but not "LLVM is not initialized".
    expect(args).toContain("-preserve-alignment-assumptions-during-inlining=false");
    expect(args).toContain("-import-cold-multiplier=0.1");
    expect(() => b.print({ kind: "TargetCPUs" } as never, { value: "" }, undefined as never)).not.toThrow(/LLVM is not initialized/);
    stops(() => b.has_zstd(), /^llir: LLVMRustLLVMHasZstdCompression$/);
  });
});

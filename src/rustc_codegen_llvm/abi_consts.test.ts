// Tests of lane cg-abi-consts (abi.rs, consts.rs) against the pinned rustc's `--emit=llvm-ir` for x86_64-unknown-linux-gnu.
//
// Each fixture (abi_consts_test/*.rs) is compiled twice: by the oracle (`-Cno-prepopulate-passes -Ccodegen-units=1`, its IR
// text), and in-process by the port's front end with the same flags, on a real `TyCtxt`. The port then builds the same LLVM
// items through this lane's code over the IR model and prints them (src/rust_ts/llvm/printer.ts):
// 1. **fn signatures** (sigs.rs): for each `#[no_mangle]` fn, `fn_abi_of_instance` -> `FnAbiLlvmExt::llvm_type` /
//    `llvm_cconv` -> a declaration -> `apply_attrs_llfn(cx, llfn, None)`. Compared with the oracle's `define` line: the calling
//    convention, the return type and its attributes, each parameter's type and attributes, at `-Copt-level=0` and `=1`.
//    Of the function attributes in the attribute group `#N`, only `noreturn` and `nounwind` (`apply_attrs_llfn`'s,
//    abi.rs:465-484) are compared; the group's other attributes are `apply_attrs_llfn`'s instance attributes
//    (`llfn_attrs_from_instance`, cg-types-attrs), which are not. **Attributes compare as sets**: the IR model prints them in insertion order, LLVM sorts them
//    (docs/handoff/cg-types-attrs.md, "For the llir lanes").
// 2. **call sites** (sigs.rs `call_*`): `apply_attrs_callsite` on a call built with the IR model, against the oracle's `call`
//    line, with `noreturn` / `nounwind` read through the call's attribute group (abi.rs:641-648); it then stops in the IR
//    model's `LLVMRustGetElementTypeArgIndex`.
// 2b. **arguments spilled to memory** (sigs.rs `spill_*`): `ArgAbiExt::store_fn_arg` into an alloca, as rustc_codegen_ssa's
//    `arg_local_refs` calls it, against the first instructions of the oracle's entry block (Pair, Direct, a `bool`).
// 3. **statics** (statics.rs): the CGU's items in `items_in_deterministic_order`, `predefine_static` (cg-types-attrs) then
//    `codegen_static` for each static, then `llvm.used` / `llvm.compiler.used` and the static RAUW, as `base::module_codegen`
//    does. Compared with the oracle's global lines, in order, with `-Zfewer-names=yes` and without it: then the anonymous
//    allocations are named `alloc_<stable hash>` (cg-context's `alloc_to_backend`, the derive of `StableHash for Allocation`).
// 4. **allocation names** (alloc_names.rs, lane stable-hash-alloc): the same, for anonymous allocations of each kind: bytes
//    only, uninit padding (one init-mask block, and several), and relocations to a static, to another allocation and to a fn.
//
// Test scaffolding (each listed in docs/handoff/cg-abi-consts.md):
// - `CodegenCx::new` needs a target machine (cg-write): the cx is built over an IR-model module with `FullCx`'s fields as
//   `CodegenCx::new` (context.rs:599) initialises them.
// - Doubles that are line-by-line copies of upstream bodies, installed for the duration of each test: `llvm_util::get_version`
//   (llvm_util.rs:469, cg-write; `get_attrs` reads it when optimizing) and `Session::direct_access_external_data`
//   (session.rs:1092, attributes.ts's `SESSION_STOPS`; `should_assume_dso_local` reads it for a `pub static`); and
//   `debuginfo::build_global_var_di_node`'s first statement (metadata.rs:1478, cg-di-a: return when there is no `dbg_cx`),
//   which `codegen_static_item` calls for every static.
// - The CGU's fns are predefined as `declare_raw_fn` would without its attributes (`declare_simple_fn`), and entered in
//   `cx.instances` as `predefine_fn` does: `predefine_fn` itself stops in `Session::needs_plt` (attributes.ts `SESSION_STOPS`).
//   A static's relocation to a fn only needs that declaration (`get_fn` finds it in `instances`).
// - LLVM's own additions to the oracle's text are dropped: `!guid` attachments, the `anon.<hash>.N` names its `name-anon-globals`
//   pass gives unnamed globals (the model prints `@N`; both become `@anon.N`, numbered in order of appearance), and value names.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import "../rustc_session/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { PlaceRef } from "../rustc_codegen_ssa/mir/place.ts";
import { MonoItem, type CodegenUnit, type MonoItemPartitions } from "../rustc_middle/mono.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Session } from "../rustc_session/session.ts";
import { DefIdMap, LocalDefId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import * as ffi from "../rust_ts/llvm/ffi.ts";
import { printModule } from "../rust_ts/llvm/printer.ts";
import { Unported, unported } from "../std/panic.ts";
import "./lib.ts";
import { Builder } from "./builder.ts";
import { CodegenCx, FullCx, SimpleCx } from "./context.ts";
import * as debuginfo_metadata from "./debuginfo/metadata.ts";
import { declare_simple_fn } from "./declare.ts";
import * as llvm from "./llvm/mod.ts";
import type { ThreadLocalMode, Value } from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";

const DIR = join(import.meta.dir, "abi_consts_test");
const TARGET = "x86_64-unknown-linux-gnu";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0", RUSTUP_AUTO_INSTALL: "0" };
const SYSROOT = (() => {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: ENV });
  if (r.exitCode !== 0) throw new Error("ERROR: the oracle toolchain is missing (rustc +nightly --print sysroot)");
  return r.stdout.toString().trim();
})();
const COMMON = ["--sysroot", SYSROOT, "--target", TARGET, "--edition=2021", "--emit=llvm-ir", "-Cno-prepopulate-passes", "-Ccodegen-units=1"];

// ---- the oracle ----
function oracle_ir(file: string, flags: readonly string[]): string {
  const out = mkdtempSync(join(tmpdir(), "rust-ts-cg-abi-consts-"));
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...COMMON, ...flags, "-o", join(out, "out.ll"), join(DIR, file)], { env: ENV, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`ERROR: oracle failed on ${file}: ${r.stderr.toString()}`);
    return readFileSync(join(out, "out.ll"), "utf8");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// ---- the port's front end, for a real TyCtxt (context.test.ts's pattern) ----
class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

function with_tcx<R>(file: string, flags: readonly string[], f: (tcx: TyCtxt) => R): R {
  let out: R | undefined;
  run_compiler(config_from_args([...COMMON, ...flags, join(DIR, file)]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      out = f(tcx);
    });
  });
  return out as R;
}

// ---- scaffolding (header) ----
/** context.rs `to_llvm_tls_model` (private there). */
function to_llvm_tls_model(tls_model: ReturnType<Session["tls_model"]>): ThreadLocalMode {
  switch (tls_model) {
    case "GeneralDynamic":
      return "GeneralDynamic";
    case "LocalDynamic":
      return "LocalDynamic";
    case "InitialExec":
      return "InitialExec";
    case "LocalExec":
      return "LocalExec";
    case "Emulated":
      return "GeneralDynamic";
  }
}

/** A `CodegenCx` over an IR-model module, its `FullCx` fields as `CodegenCx::new` (context.rs:599) sets them. */
function make_cx(tcx: TyCtxt, codegen_unit: CodegenUnit | undefined): CodegenCx {
  const llcx = llvm.LLVMContextCreate();
  const llmod = llvm.LLVMModuleCreateWithNameInContext("abi_consts", llcx);
  return new CodegenCx(
    new FullCx(
      /* tcx */ tcx,
      /* bitcode_needed */ false,
      /* scx */ SimpleCx.new(llmod, llcx, tcx.data_layout().pointer_size()),
      /* use_dll_storage_attrs */ tcx.sess.target.is_like_windows,
      /* tls_model */ to_llvm_tls_model(tcx.sess.tls_model()),
      /* codegen_unit */ codegen_unit as CodegenUnit,
      /* instances */ new KeyedMapOf<Instance, Value>(),
      /* intrinsic_instances */ new KeyedMapOf<Instance, Value>(),
      /* vtables */ new KeyedMapOf(),
      /* const_str_cache */ new Map(),
      /* const_globals */ new Map(),
      /* statics_to_rauw */ [],
      /* used_statics */ [],
      /* compiler_used_statics */ [],
      /* type_lowering */ new KeyedMapOf(),
      /* scalar_lltypes */ new Map(),
      /* coverage_cx */ undefined,
      /* dbg_cx */ undefined,
      /* sanitizer_ignorelist */ undefined,
      /* eh_personality */ undefined,
      /* rust_try_fn */ undefined,
      /* intrinsics: not reached here */ new KeyedMapOf(),
      /* local_gen_sym_counter */ 0,
      /* global_gen_sym_counter */ 0,
      /* renamed_statics */ new DefIdMap(),
      /* objc_class_t */ undefined,
      /* objc_classrefs */ new Map(),
      /* objc_selrefs */ new Map(),
      /* offload_globals */ undefined,
      /* offload_kernel_cache */ new Map(),
    ),
  );
}
/** A `KeyedMap` on `intern_key`, as `CodegenCx::new` makes its maps. */
class KeyedMapOf<K, V> extends KeyedMap<K, V> {
  constructor() {
    super(intern_key);
  }
}

let restore: (() => void)[] = [];
afterEach(() => {
  for (const r of restore.reverse()) r();
  restore = [];
});
function install_doubles(): void {
  // llvm_util.rs:469 get_version
  const s = spyOn(llvm_util, "get_version").mockImplementation(() => {
    const llvm_major = { value: 0 };
    const llvm_minor = { value: 0 };
    const llvm_patch = { value: 0 };
    ffi.LLVMGetVersion(llvm_major, llvm_minor, llvm_patch);
    return [llvm_major.value, llvm_minor.value, llvm_patch.value];
  });
  restore.push(() => s.mockRestore());
  // rustc_session's `direct_access_external_data` is the real method (ssa-mir-rest; root dropped its double at integ-w54).
  // debuginfo/metadata.rs:1473 build_global_var_di_node: its first statement, `if cx.dbg_cx.is_none() { return; }`; past it,
  // cg-di-a's stub as before (never reached here: the cx has no `dbg_cx`).
  const di = spyOn(debuginfo_metadata, "build_global_var_di_node").mockImplementation((cx: CodegenCx, _def_id, _global) => {
    if (cx.dbg_cx === undefined) {
      return;
    }
    unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs build_global_var_di_node");
  });
  restore.push(() => di.mockRestore());
}

/** The local fns of the crate whose names match `re`, in definition order. */
function local_fns(tcx: TyCtxt, re: RegExp): [Instance, string][] {
  const out: [Instance, string][] = [];
  for (const local of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    const def_id = LocalDefId.to_def_id(local);
    if (tcx.def_kind(def_id).$ !== "Fn") continue;
    const name = Symbol.as_str(tcx.item_name(def_id));
    if (re.test(name)) out.push([Instance.mono(tcx, def_id), name]);
  }
  return out;
}

/** `declare_raw_fn` without its attributes (header), with `apply_attrs_llfn(cx, llfn, None)`. */
function declare_sig(cx: CodegenCx, instance: Instance, name: string): Value {
  const fn_abi = cx.fn_abi_of_instance(instance, RawList.empty<Ty>());
  const llfn = declare_simple_fn(cx.scx, name, fn_abi.llvm_cconv(cx), "Global", "Default", fn_abi.llvm_type(cx));
  fn_abi.apply_attrs_llfn(cx, llfn, undefined);
  return llfn;
}

// ---- the IR-text side: signatures and call lines, attribute sets ----
/** Splits at depth-0 occurrences of `sep`, with `()`, `[]`, `{}` and `<>` nesting. */
function split_top(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out.map((t) => t.trim()).filter((t) => t !== "");
}

/** `<type> <attrs..>` (parameters) or `<attrs..> <type>` (returns) as `type [sorted attrs]`; `align N` is one attribute. */
function canon_typed(tokens: string[], type_first: boolean): string {
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "align" && i + 1 < tokens.length) merged.push(`align ${tokens[++i]}`);
    else merged.push(tokens[i]!);
  }
  const ty = type_first ? merged.shift()! : merged.pop()!;
  return `${ty} [${merged.sort().join(" ")}]`;
}

/** The calling-convention keywords LLVM's printer writes for the conventions sigs.rs uses (llvm/lib/IR/AsmWriter.cpp:355,
 *  :390, :391 `PrintCallingConv`), by number (ffi.rs `CallConv`, LLVM's CallingConv.h values). The IR model prints `cc <N>`
 *  for every non-C convention (a printer gap, docs/handoff/cg-abi-consts.md); both become `cc<N>`. */
const CC_KEYWORDS: Record<string, number> = {
  preserve_mostcc: llvm.CallConv_discriminant.PreserveMost,
  x86_64_sysvcc: llvm.CallConv_discriminant.X86_64_SysV,
  win64cc: llvm.CallConv_discriminant.X86_64_Win64,
};

/** The function attributes of `apply_attrs_llfn` (abi.rs:465-484) and `apply_attrs_callsite` (abi.rs:641-648) that the
 *  tests compare (review cg-abi-consts N1). The `cmse` and `interrupt` strings are not reachable on x86_64. */
const FN_FLAGS = ["noreturn", "nounwind"];

/** The attribute groups of a module's text: `attributes #N = { a b .. }` as `N -> [a, b, ..]`. */
function attr_groups(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of text.matchAll(/^attributes #(\d+) = \{ (.*) \}$/gm)) out.set(m[1]!, m[2]!.split(/\s+/));
  return out;
}

/** The `FN_FLAGS` among the function attributes after a line's parameter list (inline, or through its `#N` group). */
function fn_flags(tail: string, groups: Map<string, string[]>): string {
  const attrs = tail.split(/\s+/).flatMap((t) => (/^#\d+$/.test(t) ? (groups.get(t.slice(1)) ?? [`<no group ${t}>`]) : [t]));
  return FN_FLAGS.filter((a) => attrs.includes(a)).join(" ");
}

/** A `define` / `declare` / `call` line as `cc=<cc> ret=<canon> (<param canon>; ..) fn=[<FN_FLAGS>]`. Value names / operands
 *  are dropped. */
function canon_sig(line_: string, kind: "def" | "call", groups: Map<string, string[]>): string {
  const line = line_.replace(/\b(\w+cc) /, (w, k: string) => (CC_KEYWORDS[k] !== undefined ? `cc${CC_KEYWORDS[k]} ` : w)).replace(/\bcc (\d+) /, "cc$1 ");
  const m = kind === "def" ? /^(?:define|declare) (.*?)@"?([\w.$]+)"?\((.*)\)([^)]*)$/.exec(line) : /call (.*?)@"?([\w.$]+)"?\((.*)\)([^)]*)$/.exec(line);
  if (m === null) throw new Error(`ERROR: not a ${kind} line: ${line}`);
  const pre = split_top(m[1]!, " ").filter((t) => !["internal", "private", "dso_local", "hidden", "unnamed_addr"].includes(t));
  const cc = pre.length > 1 && /^(\w+cc|cc\d+)$/.test(pre[0]!) ? pre.shift()! : "ccc";
  const params = split_top(m[3]!, ",").map((p) => {
    const toks = split_top(p, " ");
    // Drop the value: `%name` / `%N` in a definition, the operand of a call.
    if (kind === "call" || (toks.length > 1 && toks[toks.length - 1]!.startsWith("%"))) toks.pop();
    return canon_typed(toks, true);
  });
  return `cc=${cc} ret=${canon_typed(pre, false)} (${params.join("; ")}) fn=[${fn_flags(m[4]!, groups)}]`;
}

function oracle_sigs(ir: string): Map<string, string> {
  const out = new Map<string, string>();
  const groups = attr_groups(ir);
  for (const line of ir.split("\n")) {
    const m = /^define .*?@"?([\w.$]+)"?\(/.exec(line);
    if (m) out.set(m[1]!, canon_sig(line, "def", groups));
  }
  return out;
}

function port_sigs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const groups = attr_groups(text);
  for (const line of text.split("\n")) {
    const m = /^declare .*?@"?([\w.$]+)"?\(/.exec(line);
    if (m) out.set(m[1]!, canon_sig(line, "def", groups));
  }
  return out;
}

// ---- 1. fn signatures ----
describe("FnAbiLlvmExt: fn signatures against the oracle (sigs.rs, x86_64-unknown-linux-gnu)", () => {
  // At -O1, `apply_range_attr` reaches the IR model's `LLVMRustCreateRangeAttribute` for a scalar with a valid range (`char`;
  // the slice length's computed range), and an `Indirect` argument's `dead_on_return` reaches
  // `LLVMRustCreateAttrNoValue(DeadOnReturn)`. Both were model stops until lane llir-folder, which emptied this table and
  // raised the -O1 count from 23 to 26 (r_char, r_slice and r_big are now compared).
  const STOPS_O1: Record<string, string> = {};
  for (const opt of ["0", "1"]) {
    test(`-Copt-level=${opt}`, () => {
      const flags = [`-Copt-level=${opt}`];
      const oracle = oracle_sigs(oracle_ir("sigs.rs", flags));
      install_doubles();
      const stops: Record<string, string> = {};
      const text = with_tcx("sigs.rs", flags, (tcx) => {
        const cx = make_cx(tcx, undefined);
        for (const [instance, name] of local_fns(tcx, /^(c|r|cc)_/)) {
          try {
            declare_sig(cx, instance, name);
          } catch (e) {
            if (!(e instanceof Unported)) throw e;
            stops[name] = e.what;
          }
        }
        return printModule(cx.llmod());
      });
      expect(stops).toEqual(opt === "0" ? {} : STOPS_O1);
      const ours = port_sigs(text);
      const names = [...oracle.keys()].filter((n) => /^(c|r|cc)_/.test(n) && stops[n] === undefined);
      expect(names.length).toBe(26);
      for (const n of names) expect(`${n}: ${ours.get(n)}`).toBe(`${n}: ${oracle.get(n)}`);
    }, 120_000);
  }
});

// ---- 2. call sites ----
describe("FnAbiLlvmExt::apply_attrs_callsite against the oracle's call lines (sigs.rs `call_*`)", () => {
  // `apply_attrs_callsite` ran into the IR model's `LLVMRustGetElementTypeArgIndex` stop after the attributes until lane
  // llir-folder implemented it; now no call stops.
  test("-Copt-level=0: the attributes", () => {
    const flags = ["-Copt-level=0"];
    const ir = oracle_ir("sigs.rs", flags);
    const callees = ["c_sret", "c_byval", "c_u8", "c_i16", "r_big", "c_intfloat", "cc_win64"];
    const oracle = new Map<string, string>();
    const oracle_groups = attr_groups(ir);
    for (const line of ir.split("\n")) {
      const m = /call .*?@([\w.$]+)\(/.exec(line);
      if (m && callees.includes(m[1]!)) oracle.set(m[1]!, canon_sig(line.trim(), "call", oracle_groups));
    }
    expect([...oracle.keys()].sort()).toEqual([...callees].sort());
    install_doubles();
    const stops: string[] = [];
    const text = with_tcx("sigs.rs", flags, (tcx) => {
      const cx = make_cx(tcx, undefined);
      const caller = declare_simple_fn(cx.scx, "caller", llvm.CallConv.CCallConv, "Global", "Default", cx.type_func([], cx.type_void()));
      const llbb = llvm.LLVMAppendBasicBlockInContext(cx.llcx(), caller, "start");
      const bx = Builder.build_inherent(cx, llbb);
      for (const [instance, name] of local_fns(tcx, /^(c|r|cc)_/)) {
        if (!callees.includes(name)) continue;
        const fn_abi = cx.fn_abi_of_instance(instance, RawList.empty<Ty>());
        const llty = fn_abi.llvm_type(cx);
        const llfn = declare_simple_fn(cx.scx, name, fn_abi.llvm_cconv(cx), "Global", "Default", llty);
        const args = cx.func_params_types(llty).map((t) => llvm.LLVMGetPoison(t));
        const call = llvm.LLVMBuildCallWithOperandBundles(bx.llbuilder, llty, llfn, args, args.length, [], 0, "");
        try {
          fn_abi.apply_attrs_callsite(bx, call);
        } catch (e) {
          if (!(e instanceof Unported)) throw e;
          stops.push(e.what);
        }
      }
      return printModule(cx.llmod());
    });
    // llir-folder made `LLVMRustGetElementTypeArgIndex` real: no call site stops (root at integ-w55).
    expect(stops).toEqual([]);
    const port_groups = attr_groups(text);
    for (const line of text.split("\n")) {
      const m = /call .*?@([\w.$]+)\(/.exec(line);
      if (m && callees.includes(m[1]!)) expect(`${m[1]}: ${canon_sig(line.trim(), "call", port_groups)}`).toBe(`${m[1]}: ${oracle.get(m[1]!)}`);
    }
  }, 120_000);
});

// ---- 2b. arguments spilled to memory ----
describe("ArgAbiExt::store_fn_arg against the oracle's entry blocks (sigs.rs `spill_*`)", () => {
  test("-Copt-level=0: Pair, Direct, and a bool (i1 -> i8)", () => {
    const flags = ["-Copt-level=0"];
    const ir = oracle_ir("sigs.rs", flags);
    const oracle = new Map<string, string[]>();
    for (const m of ir.matchAll(/^define .*?@(spill_\w+)\(.*\nstart:\n((?:  .*\n)*?)}/gm)) oracle.set(m[1]!, m[2]!.split("\n").filter((l) => l !== ""));
    expect([...oracle.keys()].sort()).toEqual(["spill_bool", "spill_direct", "spill_pair"]);
    install_doubles();
    const text = with_tcx("sigs.rs", flags, (tcx) => {
      const cx = make_cx(tcx, undefined);
      for (const [instance, name] of local_fns(tcx, /^spill_/)) {
        const fn_abi = cx.fn_abi_of_instance(instance, RawList.empty<Ty>());
        const llfn = declare_sig(cx, instance, name);
        const bx = Builder.build_inherent(cx, llvm.LLVMAppendBasicBlockInContext(cx.llcx(), llfn, "start"));
        // rustc_codegen_ssa's `arg_local_refs` (mir/mod.rs, ssa-mir-core): an alloca for the argument's layout, named after
        // the local, then `bx.store_fn_arg(arg, &mut llarg_idx, place)`.
        const arg = fn_abi.args[0]!;
        const alloca = bx.alloca(arg.layout.size, arg.layout.align.abi);
        llvm.set_value_name(alloca, new TextEncoder().encode(name === "spill_pair" ? "p" : name === "spill_direct" ? "x" : "b"));
        const idx = { value: 0 };
        bx.store_fn_arg(arg, idx, PlaceRef.new_sized(alloca, arg.layout));
        expect(idx.value).toBe(arg.mode.$ === "Pair" ? 2 : 1);
      }
      return printModule(cx.llmod());
    });
    const port = new Map<string, string[]>();
    for (const m of text.matchAll(/^define .*?@(spill_\w+)\(.*\nstart:\n((?:  .*\n)*?)}/gm)) port.set(m[1]!, m[2]!.split("\n").filter((l) => l !== ""));
    // Every `spill_*` fn has a block, of the length `store_fn_arg` gives (review cg-abi-consts N2): the alloca, then for
    // the Pair a store, a GEP and a store (abi.rs `store_fn_arg`'s `PassMode::Pair` arm), for the Direct a store, and for
    // the `bool` a `zext` to `i8` and a store. The oracle's lines after these are the fn's body.
    expect([...port.keys()].sort()).toEqual(["spill_bool", "spill_direct", "spill_pair"]);
    expect(Object.fromEntries([...port].map(([n, l]) => [n, l.length]))).toEqual({ spill_pair: 4, spill_direct: 2, spill_bool: 3 });
    for (const [name, ours] of port) {
      expect(`${name}:\n${ours.join("\n")}`).toBe(`${name}:\n${oracle.get(name)!.slice(0, ours.length).join("\n")}`);
    }
  }, 120_000);
});

// ---- 3. statics ----
/** The global lines (`@x = ...`), LLVM's additions dropped and anonymous names numbered in order (header). */
function globals(text: string, anon: RegExp): string[] {
  const names = new Map<string, string>();
  const lines = text.split("\n").filter((l) => l.startsWith("@"));
  return lines.map((l) =>
    l
      .replace(/, !guid !\d+$/, "")
      .replace(anon, (n) => {
        if (!names.has(n)) names.set(n, `@anon.${names.size}`);
        return names.get(n)!;
      }),
  );
}

/** `base::module_codegen`'s item loop and epilogue (base.rs), for the statics of the one CGU (header). */
function codegen_statics(tcx: TyCtxt): string {
  const parts = tcx.collect_and_partition_mono_items(null) as MonoItemPartitions;
  expect(parts.codegen_units.length).toBe(1);
  const cgu = parts.codegen_units[0]!;
  const cx = make_cx(tcx, cgu);
  const items = cgu.items_in_deterministic_order(tcx);
  for (const [item, data] of items) {
    const symbol_name = MonoItem.symbol_name(item, tcx).name;
    if (item.$ === "Static") cx.predefine_static(item._0, data.linkage, data.visibility, symbol_name);
    else if (item.$ === "Fn") {
      cx.instances.set(item._0, declare_simple_fn(cx.scx, symbol_name, llvm.CallConv.CCallConv, "Global", "Default", cx.fn_abi_of_instance(item._0, RawList.empty<Ty>()).llvm_type(cx)));
    }
  }
  for (const [item] of items) if (item.$ === "Static") cx.codegen_static(item._0);
  if (cx.used_statics.length !== 0) cx.create_used_variable_impl("llvm.used", cx.used_statics);
  if (cx.compiler_used_statics.length !== 0) cx.create_used_variable_impl("llvm.compiler.used", cx.compiler_used_statics);
  for (const [old_g, new_g] of cx.statics_to_rauw()) {
    llvm.LLVMReplaceAllUsesWith(old_g, new_g);
    llvm.LLVMDeleteGlobal(old_g);
  }
  return printModule(cx.llmod());
}

describe("consts.rs: statics against the oracle (statics.rs, x86_64-unknown-linux-gnu)", () => {
  test("-Zfewer-names=yes: every global line, in order", () => {
    const flags = ["-Copt-level=0", "-Zfewer-names=yes"];
    const oracle = globals(oracle_ir("statics.rs", flags), /@anon\.[0-9a-f]+\.\d+/g);
    install_doubles();
    const ours = globals(with_tcx("statics.rs", flags, codegen_statics), /@\d+\b/g);
    expect(oracle.length).toBe(24);
    expect(ours).toEqual(oracle);
  }, 120_000);

  // stable-hash-alloc (wave 40o): without -Zfewer-names `alloc_to_backend` names each anonymous allocation
  // `alloc_<StableHash of the Allocation>` (common.rs:253), so the names are compared as they are.
  test("without -Zfewer-names: every global line, in order, with the `alloc_<hash>` names", () => {
    const flags = ["-Copt-level=0"];
    const oracle = globals(oracle_ir("statics.rs", flags), /(?!)/g);
    install_doubles();
    const ours = globals(with_tcx("statics.rs", flags, codegen_statics), /(?!)/g);
    expect(oracle.length).toBe(24);
    expect(oracle.filter((l) => /^@alloc_[0-9a-f]{32} = /.test(l)).length).toBe(3);
    expect(ours).toEqual(oracle);
  }, 120_000);
});

describe("common.rs alloc_to_backend: `alloc_<hash>` names against the oracle (alloc_names.rs, x86_64-unknown-linux-gnu)", () => {
  test("every global line, in order", () => {
    const flags = ["-Copt-level=0"];
    const oracle = globals(oracle_ir("alloc_names.rs", flags), /(?!)/g);
    install_doubles();
    const ours = globals(with_tcx("alloc_names.rs", flags, codegen_statics), /(?!)/g);
    // `A_STR`'s "hello", `A_PAD`, `A_BIG`, `A_REF`, `A_REFSTR` and its "hi", `A_FN`, `A_DYN`, its `5u32` and its vtable
    expect(oracle.filter((l) => /^@alloc_[0-9a-f]{32} = /.test(l)).length).toBe(10);
    expect(ours).toEqual(oracle);
  }, 120_000);
});

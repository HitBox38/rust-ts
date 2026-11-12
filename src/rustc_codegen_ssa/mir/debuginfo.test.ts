// Tests of lane ssa-debuginfo: mir/debuginfo.rs (value names, debuginfo variables, spill slots and scopes) and
// debuginfo/type_names.rs (`compute_debuginfo_type_name`) over real MIR bodies.
//
// How it runs: the fixture debuginfo_oracle/debuginfo.rs (no_core) is compiled to `analysis` by the port, in-process. Then,
// for each `#[no_mangle]` fn, the real `codegen_mir` (mod.ts, with every ported `impl FunctionCx` block, and this lane's
// installed by `install_FunctionCx_debuginfo`) runs over a mock backend. The mock records:
// - the name `set_var_name` gives each value, with cg_llvm's rule (rustc_codegen_llvm/src/builder.rs `set_var_name`: only
//   arguments and instructions, and only a value that has no name yet; values here are the mock's `%argI` parameters and
//   `%N` instructions, so the rule is "first name wins");
// - every `alloca` (as `%N`), so the named allocas of a fn can be listed;
// - every `create_dbg_var` (name, `VariableKind`) and `dbg_var_addr` (the address value, the variable, the offsets).
// The debuginfo entries of mod.ts's `xlane`, block.ts's `block_xlane` and statement.ts's `stmt_xlane` are pointed at this
// lane's methods for the run (root repoints them for good at integration).
//
// Where the expected values come from: the oracle. debuginfo_oracle/{gnu,gnu-g,msvc-g}.ll are the pinned nightly's IR for
// the fixture (commands in debuginfo_oracle/README.md); value names are kept by `--emit=llvm-ir`. Per fn:
// - each parameter's name in the `define` line (`%self`, `%x`, `%p.0`/`%p.1`, `%_1`; `%0` when the argument went to an
//   alloca, which then carries the name) = the name the mock's `%argI` got;
// - the named allocas (`%x = alloca`, `%x.dbg.spill = alloca`) = the mock's named allocas, in order;
// - with -Cdebuginfo=2, the `#dbg_declare` records in order: the address operand's name, the variable's `name:` and
//   `arg:` (`!DILocalVariable`), and the `!DIExpression(...)` = the mock's `dbg_var_addr` calls, with the expression built
//   from the offsets as cg_llvm's `dbg_var_addr` does (rustc_codegen_llvm/src/debuginfo/mod.rs:480);
// - type names: `compute_debuginfo_type_name` of each user variable's type, with the `qualified` flag cg_llvm's
//   metadata.rs passes for that kind of type (`true` for pointers, references and `dyn`, :177/:382; `false` for the rest,
//   :1077/:1296/:1344/:326/enums), is one of the IR's `name: "..."` fields, and equals the `TYPE_NAMES` table below (read
//   off the same IR), for the gnu and msvc (`cpp_like_debuginfo`) forms.
//
// The test runs no rustc and reads no environment variable.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Align, Size } from "../../rustc_abi/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type { Compiler } from "../../rustc_interface/interface.ts";
import { CodegenFnAttrFlags } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { wants_wasm_eh } from "../base.ts";
import { compute_debuginfo_type_name } from "../debuginfo/type_names.ts";
import { BuilderMethods_provided } from "../traits/builder.ts";
import { block_xlane } from "./block.ts";
import { install_FunctionCx_debuginfo } from "./debuginfo.ts";
import { codegen_mir, FunctionCx, xlane } from "./mod.ts";
import { OperandRef } from "./operand.ts";
import type { PlaceRef, PlaceValue } from "./place.ts";
import { stmt_xlane } from "./statement.ts";
import type { StmtDebugInfos } from "../../rustc_middle/mir/statement.gen.ts";
import "../../rustc_middle/mir/statement.ts";

type Any = any; // PORT: test mock; backend values, types and metadata are strings.

const DIR = join(import.meta.dir, "debuginfo_oracle");
const FIXTURE = join(DIR, "debuginfo.rs");
// `--emit=llvm-ir` as the oracle's command: it is what keeps value names (`Session::fewer_names`); the run stops after
// analysis, so nothing is written.
const COMMON_ARGS = ["--edition=2021", "-Copt-level=0", "-Cno-prepopulate-passes", "--emit=llvm-ir", "-Awarnings"];
const GNU = ["--target", "x86_64-unknown-linux-gnu"];
const MSVC = ["--target", "x86_64-pc-windows-msvc"];
const G = ["-Cdebuginfo=2"];

// ---- The oracle's IR -------------------------------------------------------------------------------------------------

interface OracleFn {
  params: string[];
  allocas: string[];
  declares: string[];
}

/** Per `#[no_mangle]` fn: parameter names, named allocas, and `#dbg_declare` records rendered as `Declare` strings. */
function read_oracle(file: string): { fns: Map<string, OracleFn>; names: Set<string> } {
  const ll = readFileSync(join(DIR, file), "utf8");
  const vars = new Map<string, string>();
  // An unnamed argument's variable (`sym::empty`) is printed without `name:`.
  for (const m of ll.matchAll(/^(!\d+) = !DILocalVariable\((?:name: "([^"]*)", )?(?:arg: (\d+),)?/gm)) {
    vars.set(m[1]!, `${m[2] ?? ""}${m[3] === undefined ? "" : `@${m[3]}`}`);
  }
  const names = new Set<string>();
  // LLVM prints `"` and other special bytes in metadata strings as `\XX` (hex).
  for (const m of ll.matchAll(/[( ]name: "([^"]*)"/g)) names.add(m[1]!.replace(/\\([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  const fns = new Map<string, OracleFn>();
  let cur: OracleFn | undefined;
  for (const l of ll.split("\n")) {
    const d = /^define .*?@([A-Za-z_][A-Za-z0-9_]*)\((.*)\) unnamed_addr/.exec(l);
    if (d !== null) {
      cur = undefined;
      if (d[1]!.startsWith("_R")) continue;
      const params = d[2]! === "" ? [] : d[2]!.split(", ").map((p) => p.slice(p.lastIndexOf(" %") + 2));
      cur = { params, allocas: [], declares: [] };
      fns.set(d[1]!, cur);
      continue;
    }
    if (cur === undefined) continue;
    if (l === "}") {
      cur = undefined;
      continue;
    }
    const a = /^\s+%([A-Za-z_][A-Za-z0-9_.]*) = alloca /.exec(l);
    if (a !== null) cur.allocas.push(a[1]!);
    const dd = /#dbg_declare\(ptr %([A-Za-z0-9_.]+), (!\d+), !DIExpression\(([^)]*)\)/.exec(l);
    if (dd !== null) cur.declares.push(`${/^\d+$/.test(dd[1]!) ? "%N" : dd[1]} ${vars.get(dd[2]!)} [${dd[3]}]`);
  }
  return { fns, names };
}

// ---- The mock backend ------------------------------------------------------------------------------------------------

/** One fn's recording. */
class Rec {
  n = 0;
  readonly names = new Map<string, string>();
  readonly allocas: string[] = [];
  readonly dbg_vars = new Map<string, string>();
  readonly declares: string[] = [];
  readonly params: string[] = [];
  fresh(): string {
    return `%${this.n++}`;
  }
}

function fmt(a: unknown): string {
  if (a instanceof Align) return `align${a.bytes()}`;
  if (a instanceof Size) return `${a.bytes()}`;
  if (Array.isArray(a)) return `[${a.map(fmt).join(", ")}]`;
  if (typeof a === "string" || typeof a === "number" || typeof a === "bigint" || typeof a === "boolean") return String(a);
  if (a === undefined) return "None";
  return "_";
}

/** cg_llvm's `dbg_var_addr` address ops (rustc_codegen_llvm/src/debuginfo/mod.rs:494-511), printed as LLVM prints them. */
function di_expression(direct_offset: Size, indirect_offsets: readonly Size[], fragment: readonly [Size, Size] | undefined): string {
  const ops: string[] = [];
  if (direct_offset.bytes() > 0) ops.push("DW_OP_plus_uconst", `${direct_offset.bytes()}`);
  for (const offset of indirect_offsets) {
    ops.push("DW_OP_deref");
    if (offset.bytes() > 0) ops.push("DW_OP_plus_uconst", `${offset.bytes()}`);
  }
  if (fragment !== undefined) ops.push("DW_OP_LLVM_fragment", `${fragment[0].bits()}`, `${fragment[1].bits() - fragment[0].bits()}`);
  return ops.join(", ");
}

function make_mock(tcx: TyCtxt, rec: Rec) {
  const typing_env = TypingEnv.fully_monomorphized();
  const layout_of = (ty: Ty): TyAndLayout => {
    const r = tcx.layout_of(typing_env.as_query_input(ty));
    if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
    return r._0;
  };
  const name_of = (instance: Instance): string => `@${Symbol.as_str(tcx.item_name(Instance.def_id(instance)))}`;
  const tyname = (l: TyAndLayout): string => display_Ty(l.ty);
  const own: Record<string, unknown> = {
    debug_Value: (v: string) => v,
    debug_Type: (v: string) => v,
    debug_Function: (v: string) => v,
    debug_FunctionSignature: (v: string) => v,
    tcx_: () => tcx,
    typing_env_: () => typing_env,
    sess: () => tcx.sess,
    data_layout: () => tcx.data_layout(),
    layout_of,
    spanned_layout_of: (ty: Ty) => layout_of(ty),
    fn_abi_of_instance: (instance: Instance, extra: Any) => {
      const r = tcx.fn_abi_of_instance(typing_env.as_query_input([instance, extra]));
      if (r.$ !== "Ok") throw new Error("ERROR: fn_abi_of_instance failed");
      return r._0;
    },
    type_needs_drop: (ty: Ty) => ty.needs_drop(tcx, typing_env),
    intrinsic_call_expects_place_always: (name: Symbol) => name === sym.black_box,
    get_fn: name_of,
    get_fn_addr: name_of,
    eh_personality: () => "@personality",
    type_ptr: () => "ptr",
    type_ptr_ext: () => "ptr",
    backend_type: (l: TyAndLayout) => `T(${tyname(l)})`,
    immediate_backend_type: (l: TyAndLayout) => `I(${tyname(l)})`,
    scalar_pair_element_backend_type: (l: TyAndLayout, i: number) => `P${i}(${tyname(l)})`,
    is_backend_immediate: (l: TyAndLayout) => l.backend_repr.$ === "Scalar" || l.backend_repr.$ === "SimdVector",
    is_backend_scalar_pair: (l: TyAndLayout) => l.backend_repr.$ === "ScalarPair",
    const_usize: (i: bigint) => `${i}usize`,
    const_i32: (i: number) => `${i}i32`,
    const_u8: (i: number) => `${i}u8`,
    const_uint_big: (_t: string, v: bigint) => `const:${v}`,
    const_undef: (t: string) => `undef:${t}`,
    const_null: () => "null",
    const_poison: (t: string) => `poison:${t}`,
    const_to_opt_u128: (v: string) => (v.startsWith("const:") ? BigInt(v.slice(6)) : undefined),
    cx: () => proxy,
    llbb: () => "bb",
    set_span: () => {},
    append_sibling_block: (name: string) => name,
    switch_to_block: () => {},
    get_param: (i: number) => {
      const v = `%arg${i}`;
      rec.params.push(v);
      return v;
    },
    // cg_llvm's `store_fn_arg` (rustc_codegen_llvm/src/abi.rs:299): `get_param` twice for `PassMode::Pair`, none for
    // `Ignore`, once otherwise; the parameters it reads stay unnamed (the alloca gets the name).
    store_fn_arg: (arg: Any, idx: { value: number }, _dst: PlaceRef<string>) => {
      const n = arg.mode.$ === "Pair" ? 2 : arg.mode.$ === "Ignore" ? 0 : 1;
      for (let k = 0; k < n; k++) rec.params.push(`%arg${idx.value++}`);
    },
    alloca: (_size: Size, _align: Align) => {
      const r = rec.fresh();
      rec.allocas.push(r);
      return r;
    },
    load_operand: (place: PlaceRef<string>) => {
      const l = place.layout;
      if (l.is_zst()) return OperandRef.zero_sized(l);
      const repr = l.backend_repr;
      if (repr.$ === "Scalar" || repr.$ === "SimdVector") return new OperandRef<string>({ $: "Immediate", _0: rec.fresh() }, l, undefined);
      if (repr.$ === "ScalarPair") return new OperandRef<string>({ $: "Pair", _0: rec.fresh(), _1: rec.fresh() }, l, undefined);
      return new OperandRef<string>({ $: "Ref", _0: place.val }, l, undefined);
    },
    with_move_annotation: (_i: unknown, f: (bx: unknown) => unknown) => f(proxy),
    typed_place_copy_with_flags: () => {},
    typed_place_copy: (dst: Any, src: Any, layout: Any) => BuilderMethods_provided.typed_place_copy(proxy, dst, src, layout),
    cond_br_with_expect: (c: Any, t: Any, e: Any, x: Any) => BuilderMethods_provided.cond_br_with_expect(proxy, c, t, e, x),
    br_with_attrs: (d: Any, a: Any) => BuilderMethods_provided.br_with_attrs(proxy, d, a),
    switch_with_weights: (v: Any, e: Any, c: Any, cs: Any) => BuilderMethods_provided.switch_with_weights(proxy, v, e, c, cs),
    // Debuginfo (traits/debuginfo.rs).
    set_var_name: (value: string, name: string) => {
      // cg_llvm: arguments and instructions only, and never rename (header).
      if (typeof value !== "string" || !value.startsWith("%")) return;
      if (!rec.names.has(value)) rec.names.set(value, name);
    },
    dbg_scope_fn: (instance: Instance) => `!scope(${name_of(instance)})`,
    dbg_create_lexical_block: (_pos: Any, parent: string) => `!block(${parent})`,
    dbg_loc: (scope: string) => `!loc(${scope})`,
    extend_scope_to_file: (scope: string) => scope,
    dbg_location_clone_with_discriminator: (loc: string, d: number) => `${loc}#${d}`,
    create_dbg_var: (name: Symbol, _ty: Ty, _scope: string, kind: Any) => {
      const v = `!var${rec.dbg_vars.size}`;
      rec.dbg_vars.set(v, `${Symbol.as_str(name)}${kind.$ === "ArgumentVariable" ? `@${kind._0}` : ""}`);
      return v;
    },
    dbg_var_addr: (dbg_var: string, _loc: string, alloca: string, direct: Size, indirect: readonly Size[], fragment: Any) => {
      const n = rec.names.get(alloca);
      rec.declares.push(`${n ?? "%N"} ${rec.dbg_vars.get(dbg_var)} [${di_expression(direct, indirect, fragment)}]`);
    },
    set_dbg_loc: () => {},
    clear_dbg_loc: () => {},
  };
  const proxy: Any = new Proxy(own, {
    get(target, prop) {
      if (typeof prop === "string" && prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then" || prop === "__backend_types") return undefined;
      return (..._args: unknown[]) => rec.fresh();
    },
  });
  const Bx_ = {
    build: () => proxy,
    append_block: (_cx: unknown, _llfn: string, name: string) => name,
  };
  return { cx: proxy, Bx_ };
}

// ---- The driver ------------------------------------------------------------------------------------------------------

interface FnResult {
  params: string[];
  allocas: string[];
  declares: string[];
  /** Per user variable (`var_debug_info`): name -> [type name per cg_llvm's flag, the type's kind]. */
  type_names: Map<string, string>;
}

/** cg_llvm's `qualified` flag for a variable's type (header). */
function qualified_for(ty: Ty): boolean {
  const k = ty.kind().$;
  return k === "Ref" || k === "RawPtr" || k === "Dynamic" || k === "UnsafeBinder";
}

function install_debuginfo_stubs(): () => void {
  install_FunctionCx_debuginfo(FunctionCx);
  const saved_x: Record<string, unknown> = { ...xlane };
  const saved_b: Record<string, unknown> = { ...block_xlane };
  const saved_s: Record<string, unknown> = { ...stmt_xlane };
  const X = xlane as Any;
  const Bk = block_xlane as Any;
  const St = stmt_xlane as Any;
  X.fill_function_debug_context = (fx: Any, bx: Any) => fx.fill_function_debug_context(bx);
  X.compute_per_local_var_debug_info = (fx: Any, bx: Any) => fx.compute_per_local_var_debug_info(bx);
  X.debug_introduce_locals = (fx: Any, bx: Any, consts: Any) => fx.debug_introduce_locals(bx, consts);
  for (const T of [Bk, St]) {
    T.set_debug_loc = (fx: Any, bx: Any, si: Any) => fx.set_debug_loc(bx, si);
    T.debug_introduce_local = (fx: Any, bx: Any, local: Any) => fx.debug_introduce_local(bx, local);
  }
  Bk.codegen_stmt_debuginfos = (fx: Any, bx: Any, d: Any) => fx.codegen_stmt_debuginfos(bx, d);
  // statement.rs passes `&statement.debuginfos` (a `StmtDebugInfos`), which derefs to the slice upstream.
  St.codegen_stmt_debuginfos = (fx: Any, bx: Any, d: StmtDebugInfos) => fx.codegen_stmt_debuginfos(bx, d.deref());
  X.wants_new_eh_instructions = (t: Target) => wants_wasm_eh(t) || t.is_like_msvc;
  Bk.wants_msvc_seh = (t: Target) => t.is_like_msvc;
  Bk.is_call_from_compiler_builtins_to_upstream_monomorphization = () => false;
  return () => {
    Object.assign(X, saved_x);
    Object.assign(Bk, saved_b);
    Object.assign(St, saved_s);
  };
}

/** Compiles the fixture with `args` and runs `codegen_mir` on each `#[no_mangle]` fn (header). */
function run(args: string[]): Map<string, FnResult> {
  const out = new Map<string, FnResult>();
  const restore = install_debuginfo_stubs();
  let ran = false;
  try {
    compiler_entrypoint(["rustc", ...args, ...COMMON_ARGS, FIXTURE], {
      config() {},
      after_analysis(_compiler: Compiler, tcx: TyCtxt) {
        ran = true;
        for (const def_id of tcx.mir_keys(null)) {
          const did = LocalDefId.to_def_id(def_id);
          if (tcx.def_kind(did).$ !== "Fn" && tcx.def_kind(did).$ !== "AssocFn") continue;
          if (tcx.generics_of(did).count() !== 0) continue;
          if (!CodegenFnAttrFlags.contains(tcx.codegen_fn_attrs(did).flags, CodegenFnAttrFlags.NO_MANGLE)) continue;
          const name = Symbol.as_str(tcx.item_name(did));
          const instance = Instance.mono(tcx, did);
          const rec = new Rec();
          const { cx, Bx_ } = make_mock(tcx, rec);
          codegen_mir(Bx_ as Any, cx, instance);
          const named = (v: string): string => rec.names.get(v) ?? v;
          const type_names = new Map<string, string>();
          const mir = tcx.instance_mir(instance.def);
          for (const v of mir.var_debug_info) {
            if (v.composite !== undefined) continue;
            // A ZST variable's debuginfo is a constant (`VarDebugInfoContents::Const`).
            const ty = v.value.$ === "Place" ? mir.local_decls[v.value._0.local]!.ty : v.value._0.ty();
            type_names.set(Symbol.as_str(v.name), compute_debuginfo_type_name(tcx, ty, qualified_for(ty)));
          }
          out.set(name, {
            params: rec.params.map((p) => (rec.names.has(p) ? named(p) : "%N")),
            // cg_llvm's `alloca` (rustc_codegen_llvm/src/builder.rs:667) positions at the start of the entry block, so each
            // new alloca is printed before the earlier ones: the IR lists them in reverse creation order.
            allocas: rec.allocas.filter((a) => rec.names.has(a)).map(named).reverse(),
            declares: rec.declares,
            type_names,
          });
        }
        return "Stop";
      },
    });
  } finally {
    restore();
  }
  if (!ran) throw new Error("ERROR: the fixture did not reach analysis");
  return out;
}

const FNS = ["big", "borrowed", "closure", "locals", "pair", "pair_by_value", "pair_closure", "pair_first", "scalar", "types", "unnamed"];

function check_names(args: string[], file: string, with_declares: boolean): void {
  const results = run(args);
  const oracle = read_oracle(file).fns;
  expect([...results.keys()].sort()).toEqual(FNS);
  expect([...oracle.keys()].sort()).toEqual(FNS);
  for (const name of FNS) {
    const r = results.get(name)!;
    const o = oracle.get(name)!;
    // An oracle parameter printed as `%0` was not named (`%N` on the mock's side).
    expect({ name, params: r.params }).toEqual({ name, params: o.params.map((p) => (/^\d+$/.test(p) ? "%N" : p)) });
    expect({ name, allocas: r.allocas }).toEqual({ name, allocas: o.allocas });
    if (with_declares) expect({ name, declares: r.declares }).toEqual({ name, declares: o.declares });
    else expect({ name, declares: r.declares }).toEqual({ name, declares: [] });
  }
}

test("value names without debuginfo (x86_64-unknown-linux-gnu): parameters and allocas as the oracle's IR", () => {
  check_names(GNU, "gnu.ll", false);
});

test("value names, spill slots and #dbg_declare records with -Cdebuginfo=2 (x86_64-unknown-linux-gnu)", () => {
  check_names([...GNU, ...G], "gnu-g.ll", true);
});

test("value names, spill slots and #dbg_declare records with -Cdebuginfo=2 (x86_64-pc-windows-msvc)", () => {
  check_names([...MSVC, ...G], "msvc-g.ll", true);
});

// `compute_debuginfo_type_name` of each user variable's type: [gnu, msvc], read off gnu-g.ll and msvc-g.ll.
const TYPE_NAMES: Record<string, [string, string]> = {
  "types.w": ["Wrap<u32>", "Wrap<u32>"],
  "types.ww": ["&debuginfo::Wrap<debuginfo::Wrap<u8>>", "ref$<debuginfo::Wrap<debuginfo::Wrap<u8> > >"],
  "types.t": ["(u32, bool)", "tuple$<u32,bool>"],
  "types.unit": ["()", "tuple$<>"],
  "types.r": ["&mut u64", "ref_mut$<u64>"],
  "types.p": ["*const u8", "ptr_const$<u8>"],
  "types.m": ["*mut debuginfo::Wrap<u8>", "ptr_mut$<debuginfo::Wrap<u8> >"],
  "types.d": ["&dyn debuginfo::Tr", "ref$<dyn$<debuginfo::Tr> >"],
  "types.ds": ["&(dyn debuginfo::Tr + debuginfo::Send)", "ref$<dyn$<debuginfo::Tr,debuginfo::Send> >"],
  "types.da": ["&dyn debuginfo::WithAssoc<Out=u32>", "ref$<dyn$<debuginfo::WithAssoc<assoc$<Out,u32> > > >"],
  "types.e": ["CLike", "CLike"],
  "types.o": ["Opt<u32>", "enum2$<debuginfo::Opt<u32> >"],
  "types.i": ["In", "In"],
  "types.f": ["fn(u32) -> bool", "bool (*)(u32)"],
  "types.fu": ['unsafe extern "C" fn()', "void (*)()"],
  "types.arr": ["Wrap<[u8; 4]>", "Wrap<array$<u8,4> >"],
  "types.sl": ["&[u32]", "ref$<slice2$<u32> >"],
  "types.s": ["&str", "ref$<str$>"],
  "types.cu": ["ConstU<4>", "ConstU<4>"],
  "types.ci": ["ConstI<-3>", "ConstI<-3>"],
  "types.cb": ["ConstB<true>", "ConstB<true>"],
  "closure.x": ["u32", "u32"],
  "closure.c": ["{closure_env#0}", "closure_env$0"],
  "closure.rc": ["&debuginfo::closure::{closure_env#0}", "ref$<debuginfo::closure::closure_env$0>"],
  "pair_closure.self": ["&debuginfo::Pair", "ref$<debuginfo::Pair>"],
  "pair_closure.c": ["{closure_env#0}", "closure_env$0"],
  "pair_closure.w": ["Wrap<debuginfo::{impl#15}::pair_closure::{closure_env#0}>", "Wrap<debuginfo::impl$15::pair_closure::closure_env$0>"],
  "pair_closure.rw": ["&debuginfo::Wrap<debuginfo::{impl#15}::pair_closure::{closure_env#0}>", "ref$<debuginfo::Wrap<debuginfo::impl$15::pair_closure::closure_env$0> >"],
  "pair.p": ["Pair", "Pair"],
  "big.b": ["Big", "Big"],
};

function check_type_names(args: string[], file: string, col: 0 | 1): void {
  const results = run(args);
  const names = read_oracle(file).names;
  const got: Record<string, string> = {};
  for (const [fn, r] of results) {
    for (const [v, n] of r.type_names) if (`${fn}.${v}` in TYPE_NAMES) got[`${fn}.${v}`] = n;
  }
  const want: Record<string, string> = {};
  for (const [k, v] of Object.entries(TYPE_NAMES)) want[k] = v[col];
  expect(got).toEqual(want);
  for (const [k, v] of Object.entries(want)) expect({ k, in_oracle: names.has(v) }).toEqual({ k, in_oracle: true });
}

test("compute_debuginfo_type_name: the gnu forms are the oracle's DI names", () => {
  check_type_names([...GNU, ...G], "gnu-g.ll", 0);
});

test("compute_debuginfo_type_name: the msvc (cpp_like_debuginfo) forms are the oracle's DI names", () => {
  check_type_names([...MSVC, ...G], "msvc-g.ll", 1);
});

// Tests of lane ssa-block: mir/block.rs (`codegen_block`, `codegen_terminator` and its arms, `codegen_argument`,
// `landing_pad_for`, `terminate_block`, `make_return_dest`, `store_return`) over real MIR bodies, through the real driver
// in-process, and a logging mock backend.
//
// How it runs: the fixture block_oracle/block.rs (no_core) is compiled to `analysis` by the port; then, for each
// `#[no_mangle]` fn, the real `codegen_mir` (mod.ts) runs with this lane's `codegen_block` installed. The mock backend
// records every builder call into the block it was made in, and the blocks in creation order.
//
// Stand-ins for lanes that have not landed (each is the minimum the fixture's MIR needs; none is under test):
// - statement.rs (ssa-mir-rest): `Assign` to a pending SSA local defines it as a fresh operand of the layout's shape
//   (`%_N`, or `%_N.0`/`%_N.1`); other statements are logged as `stmt ...`.
// - constant.rs (ssa-mir-rest): a constant operand of a ZST type (every callee here) is `OperandRef::zero_sized`;
//   operand.ts's `eval_mir_constant_to_operand` stub is otherwise left in place.
// - debuginfo.rs (ssa-debuginfo): `set_debug_loc` and `codegen_stmt_debuginfos` do nothing; `debug_introduce_local`
//   is logged.
// - base.rs (ssa-base): `wants_new_eh_instructions` / `wants_msvc_seh` are upstream's bodies (base.rs:385, :392);
//   `is_call_from_compiler_builtins_to_upstream_monomorphization` is `false` (its `tcx.is_compiler_builtins(LOCAL_CRATE)`
//   conjunct is false for this crate).
//
// Where the expected values come from:
// 1. The oracle. block_oracle/host.ll and msvc.ll are the pinned nightly's IR for the fixture (command in
//    block_oracle/README.md). The order of a function's blocks in LLVM IR is their creation order (`append_block` and
//    `append_sibling_block` both append), and each block ends in the terminator `codegen_terminator` emitted. So for
//    every fn, [block name, terminator shape] in creation order must equal the oracle's [label, terminator] in print
//    order (`shapes` below normalizes both sides).
// 2. The source. `EXPECT` spells out the full call sequence of selected fns, derived step by step from block.rs (cited
//    per fn). Value names differ from the oracle's (debuginfo names values; ssa-debuginfo is not ported), so these are
//    checked against the source, and only their shape against the oracle.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Align, Size } from "../../rustc_abi/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type { Compiler } from "../../rustc_interface/interface.ts";
import { CodegenFnAttrFlags } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Operand, Statement } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { wants_wasm_eh } from "../base.ts";
import type { BackendTypes } from "../traits/backend.ts";
import { BuilderMethods_provided } from "../traits/builder.ts";
import { block_xlane, install_FunctionCx_block } from "./block.ts";
import { codegen_mir, FunctionCx, xlane } from "./mod.ts";
import { OperandRef, OperandValue } from "./operand.ts";
import type { PlaceRef, PlaceValue } from "./place.ts";

type Any = any; // PORT: test mock; backend values, types and blocks are strings.

const DIR = join(import.meta.dir, "block_oracle");
const FIXTURE = join(DIR, "block.rs");
const COMMON_ARGS = ["--edition=2021", "-Copt-level=0", "-Coverflow-checks=on", "-Cpanic=unwind", "-Awarnings"];

// ---- The mock backend ------------------------------------------------------------------------------------------------

/** One fn's recording: blocks in creation order, each with its instructions. */
class Rec {
  readonly order: string[] = [];
  readonly blocks = new Map<string, string[]>();
  n = 0;
  fresh(): string {
    return `%${this.n++}`;
  }
  new_block(name: string): string {
    let id = name;
    for (let k = 1; this.blocks.has(id); k++) id = `${name}${k}`;
    this.order.push(id);
    this.blocks.set(id, []);
    return id;
  }
  push(block: string | undefined, line: string): void {
    const b = block === undefined ? undefined : this.blocks.get(block);
    if (b === undefined) throw new Error(`ERROR: instruction outside a block: ${line}`);
    b.push(line);
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

/** Builder calls that produce no value. */
const VOID = new Set([
  "br",
  "cond_br",
  "switch",
  "ret",
  "ret_void",
  "unreachable",
  "resume",
  "store",
  "lifetime_start",
  "lifetime_end",
  "memcpy",
  "memset",
  "store_arg",
  "abort_immediate",
  "apply_attrs_to_cleanup_callsite",
  "filter_landing_pad",
  "range_metadata",
  "tail_call",
  "set_personality_fn",
]);

function make_mock(tcx: TyCtxt, rec: Rec) {
  const typing_env = TypingEnv.fully_monomorphized();
  const layout_of = (ty: Ty): TyAndLayout => {
    const r = tcx.layout_of(typing_env.as_query_input(ty));
    if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
    return r._0;
  };
  const name_of = (instance: Instance): string => `@${Symbol.as_str(tcx.item_name(Instance.def_id(instance)))}`;
  const tyname = (l: TyAndLayout): string => display_Ty(l.ty);

  const make = (block: string | undefined): Any => {
    const st = { cur: block };
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
      fn_abi_of_fn_ptr: (sig: Any, extra: Any) => {
        const r = tcx.fn_abi_of_fn_ptr(typing_env.as_query_input([sig, extra]));
        if (r.$ !== "Ok") throw new Error("ERROR: fn_abi_of_fn_ptr failed");
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
      fn_decl_backend_type: () => "fnty",
      fn_ptr_backend_type: () => "fnptr",
      cast_backend_type: () => "cast",
      reg_backend_type: () => "reg",
      const_usize: (i: bigint) => `${i}usize`,
      const_i32: (i: number) => `${i}i32`,
      const_u8: (i: number) => `${i}u8`,
      const_uint_big: (_t: string, v: bigint) => `const:${v}`,
      const_undef: (t: string) => `undef:${t}`,
      const_null: () => "null",
      const_poison: (t: string) => `poison:${t}`,
      const_to_opt_u128: (v: string) => (v.startsWith("const:") ? BigInt(v.slice(6)) : undefined),
      scalar_to_backend: () => "@alloc_loc",
      const_str: () => ["@str", "len"],
      cx: () => proxy,
      llbb: () => st.cur,
      set_span: () => {},
      append_sibling_block: (name: string) => rec.new_block(name),
      switch_to_block: (llbb: string) => {
        st.cur = llbb;
      },
      get_param: (i: number) => `%arg${i}`,
      store_fn_arg: (_arg: Any, idx: { value: number }, dst: PlaceRef<string>) => {
        rec.push(st.cur, `store_fn_arg(${idx.value}, ${dst.val.llval})`);
        idx.value += 1;
      },
      alloca: (size: Size, align: Align) => {
        const r = rec.fresh();
        rec.push(st.cur, `${r} = alloca(${fmt(size)}, ${fmt(align)})`);
        return r;
      },
      load_operand: (place: PlaceRef<string>) => {
        const l = place.layout;
        if (l.is_zst()) return OperandRef.zero_sized(l);
        const repr = l.backend_repr;
        if (repr.$ === "Scalar" || repr.$ === "SimdVector") {
          const r = rec.fresh();
          rec.push(st.cur, `${r} = load_operand(${place.val.llval}, ${tyname(l)})`);
          return new OperandRef<string>({ $: "Immediate", _0: r }, l, undefined);
        }
        if (repr.$ === "ScalarPair") {
          const a = rec.fresh();
          const b = rec.fresh();
          rec.push(st.cur, `${a}, ${b} = load_operand(${place.val.llval}, ${tyname(l)})`);
          return new OperandRef<string>({ $: "Pair", _0: a, _1: b }, l, undefined);
        }
        return new OperandRef<string>({ $: "Ref", _0: place.val }, l, undefined);
      },
      with_move_annotation: (_i: unknown, f: (bx: unknown) => unknown) => f(proxy),
      typed_place_copy_with_flags: (dst: PlaceValue<string>, src: PlaceValue<string>, layout: TyAndLayout) => {
        rec.push(st.cur, `copy(${dst.llval}, ${src.llval}, ${layout.size.bytes()})`);
      },
      typed_place_copy: (dst: Any, src: Any, layout: Any) => BuilderMethods_provided.typed_place_copy(proxy, dst, src, layout),
      cond_br_with_expect: (c: Any, t: Any, e: Any, x: Any) => BuilderMethods_provided.cond_br_with_expect(proxy, c, t, e, x),
      br_with_attrs: (d: Any, a: Any) => BuilderMethods_provided.br_with_attrs(proxy, d, a),
      switch_with_weights: (v: Any, e: Any, c: Any, cs: Any) => BuilderMethods_provided.switch_with_weights(proxy, v, e, c, cs),
      invoke: (_t: Any, _a: Any, _abi: Any, f: string, rs: Any, args: string[], then: string, catch_: string, funclet: string | undefined) => {
        const r = rec.fresh();
        rec.push(st.cur, `${r} = invoke ${f}(${args.join(", ")})${rs.$ === "Indirect" ? ` sret ${rs._0}` : ""} to ${then} unwind ${catch_}${funclet === undefined ? "" : ` funclet ${funclet}`}`);
        return r;
      },
      call: (_t: Any, _a: Any, _abi: Any, f: string, rs: Any, args: string[], funclet: string | undefined) => {
        const r = rec.fresh();
        rec.push(st.cur, `${r} = call ${f}(${args.join(", ")})${rs.$ === "Indirect" ? ` sret ${rs._0}` : ""}${funclet === undefined ? "" : ` funclet ${funclet}`}`);
        return r;
      },
      cleanup_landing_pad: () => {
        const a = rec.fresh();
        const b = rec.fresh();
        rec.push(st.cur, `${a}, ${b} = landingpad cleanup`);
        return [a, b];
      },
      cleanup_pad: (parent: string | undefined, args: string[]) => {
        const r = rec.fresh();
        rec.push(st.cur, `${r} = cleanuppad(${fmt(parent)}, ${fmt(args)})`);
        return r;
      },
      cleanup_ret: (funclet: string, unwind: string | undefined) => {
        rec.push(st.cur, `cleanupret(${funclet}, ${unwind ?? "caller"})`);
      },
    };
    const proxy: Any = new Proxy(own, {
      get(target, prop) {
        if (typeof prop === "string" && prop in target) return target[prop];
        if (typeof prop !== "string" || prop === "then" || prop === "__backend_types") return undefined;
        return (...args: unknown[]) => {
          if (VOID.has(prop)) {
            rec.push(st.cur, `${prop}(${args.map(fmt).join(", ")})`);
            return undefined;
          }
          const r = rec.fresh();
          rec.push(st.cur, `${r} = ${prop}(${args.map(fmt).join(", ")})`);
          return r;
        };
      },
    });
    return proxy;
  };
  const Bx_ = {
    build: (_cx: unknown, llbb: string) => make(llbb),
    append_block: (_cx: unknown, _llfn: string, name: string) => rec.new_block(name),
  };
  return { cx: make(undefined), Bx_ };
}

// ---- Stand-ins for other lanes (header) ------------------------------------------------------------------------------

function install_stubs(rec_of: () => Rec): () => void {
  const saved_x: Record<string, unknown> = { ...xlane };
  const saved_b: Record<string, unknown> = { ...block_xlane };
  const X = xlane as Any;
  const Bk = block_xlane as Any;
  X.wants_new_eh_instructions = (t: Target) => wants_wasm_eh(t) || t.is_like_msvc;
  X.fill_function_debug_context = () => {};
  X.compute_per_local_var_debug_info = () => undefined;
  X.debug_introduce_locals = () => {};
  X.codegen_block = (fx: Any, bb: Any) => fx.codegen_block(bb);
  X.codegen_block_as_unreachable = (fx: Any, bb: Any) => fx.codegen_block_as_unreachable(bb);
  Bk.set_debug_loc = () => {};
  Bk.codegen_stmt_debuginfos = () => {};
  Bk.debug_introduce_local = (_fx: Any, bx: Any, local: number) => rec_of().push(bx.llbb(), `debug_introduce_local(_${local})`);
  Bk.wants_msvc_seh = (t: Target) => t.is_like_msvc;
  Bk.is_call_from_compiler_builtins_to_upstream_monomorphization = () => false;
  Bk.codegen_statement = (fx: FunctionCx<BackendTypes>, bx: Any, statement: Statement) => {
    const kind = statement.kind;
    if (kind.$ !== "Assign") return;
    const place = kind._0[0];
    const local = place.as_local();
    if (local !== undefined && fx.locals.index(local).$ === "PendingOperand") {
      const layout: TyAndLayout = bx.layout_of(fx.monomorphize(fx.mir.local_decls[local]!.ty, fold_Ty));
      const repr = layout.backend_repr;
      const val: OperandValue<string> =
        repr.$ === "ScalarPair" ? { $: "Pair", _0: `%_${local}.0`, _1: `%_${local}.1` } : { $: "Immediate", _0: `%_${local}` };
      fx.overwrite_local(local, { $: "Operand", _0: new OperandRef<unknown>(val, layout, undefined) });
    } else {
      rec_of().push(bx.llbb(), `stmt _${place.local}${place.projection.length === 0 ? "" : ".."} = ${kind._0[1].$}`);
    }
  };
  // constant.rs stand-in (header): ZST constants only.
  const proto = FunctionCx.prototype as Any;
  const codegen_operand = proto.codegen_operand;
  proto.codegen_operand = function (this: FunctionCx<BackendTypes>, bx: Any, operand: Operand) {
    if (operand.$ === "Constant") {
      const layout: TyAndLayout = bx.layout_of(this.monomorphize(operand._0.ty(), fold_Ty));
      if (layout.is_zst()) return OperandRef.zero_sized(layout);
    }
    return codegen_operand.call(this, bx, operand);
  };
  return () => {
    Object.assign(X, saved_x);
    Object.assign(Bk, saved_b);
    proto.codegen_operand = codegen_operand;
  };
}

// ---- The driver ------------------------------------------------------------------------------------------------------

interface FnResult {
  order: string[];
  blocks: Map<string, string[]>;
}

/** Compiles the fixture for `target_args` and runs `codegen_mir` on each `#[no_mangle]` fn (header). */
function run(target_args: string[]): Map<string, FnResult> {
  install_FunctionCx_block(FunctionCx);
  const out = new Map<string, FnResult>();
  let rec = new Rec();
  const restore = install_stubs(() => rec);
  let ran = false;
  try {
    compiler_entrypoint(["rustc", ...target_args, ...COMMON_ARGS, FIXTURE], {
      config() {},
      after_analysis(_compiler: Compiler, tcx: TyCtxt) {
        for (const def_id of tcx.mir_keys(null)) {
          const did = LocalDefId.to_def_id(def_id);
          if (tcx.def_kind(did).$ !== "Fn" || tcx.generics_of(did).count() !== 0) continue;
          if (!CodegenFnAttrFlags.contains(tcx.codegen_fn_attrs(did).flags, CodegenFnAttrFlags.NO_MANGLE)) continue;
          rec = new Rec();
          const { cx, Bx_ } = make_mock(tcx, rec);
          codegen_mir(Bx_ as Any, cx, Instance.mono(tcx, did));
          out.set(Symbol.as_str(tcx.item_name(did)), { order: rec.order, blocks: rec.blocks });
        }
        ran = true;
        return "Stop";
      },
    });
  } finally {
    restore();
  }
  expect(ran).toBe(true);
  return out;
}

// ---- Shapes: [block, terminator] on both sides (header, point 1) -----------------------------------------------------

/** The mock's terminator line normalized. */
function mock_term(line: string | undefined): string {
  if (line === undefined) return "<none>";
  let m: RegExpExecArray | null;
  if ((m = /^br\((\S+), \[\]\)$/.exec(line)) || (m = /^br\((\S+)\)$/.exec(line))) return `br ${m[1]}`;
  if ((m = /^cond_br\(\S+, (\S+), (\S+)\)$/.exec(line))) return `cond_br ${m[1]} ${m[2]}`;
  if ((m = /^switch\(\S+, (\S+), \[(.*)\]\)$/.exec(line))) {
    const cases = [...m[2]!.matchAll(/\[(\d+), (\S+?)\]/g)].map((c) => `${c[1]}:${c[2]}`);
    return `switch ${m[1]} [${cases.join(",")}]`;
  }
  if (/^ret\(/.test(line)) return line === "ret_void()" ? "ret_void" : "ret";
  if (line === "ret_void()") return "ret_void";
  if (line === "unreachable()") return "unreachable";
  if (/^resume\(/.test(line)) return "resume";
  if ((m = /= invoke .* to (\S+) unwind (\S+)/.exec(line))) return `invoke ${m[1]} ${m[2]}`;
  if ((m = /^cleanupret\(\S+, (\S+)\)$/.exec(line))) return `cleanupret ${m[1]}`;
  return `?${line}`;
}

function mock_shapes(r: FnResult): string[] {
  return r.order.map((b) => {
    // `apply_attrs_to_cleanup_callsite` follows an `invoke` in its block (block.rs:289).
    const lines = r.blocks.get(b)!.filter((l) => !l.startsWith("apply_attrs_to_cleanup_callsite("));
    return `${b}: ${mock_term(lines[lines.length - 1])}`;
  });
}

/** The oracle IR's [label, terminator] per fn, in print order. */
function oracle_shapes(ll: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let fn: string | undefined;
  let cur: string[] = [];
  let label = "";
  let insts: string[] = [];
  const flush = () => {
    if (fn === undefined) return;
    const text = insts.join(" ");
    let t: string;
    let m: RegExpExecArray | null;
    const last = insts[insts.length - 1] ?? "";
    if ((m = /invoke .* to label %(\S+) unwind label %(\S+)$/.exec(text.slice(text.lastIndexOf("invoke "))))) t = `invoke ${m[1]} ${m[2]}`;
    else if ((m = /^br label %(\S+)$/.exec(last))) t = `br ${m[1]}`;
    else if ((m = /^br i1 \S+, label %(\S+), label %(\S+)$/.exec(last))) t = `cond_br ${m[1]} ${m[2]}`;
    else if (/^switch /.test(text.slice(text.lastIndexOf("switch ")))) {
      const sw = text.slice(text.lastIndexOf("switch "));
      const d = /label %(\S+) \[/.exec(sw)!;
      const cases = [...sw.matchAll(/i\d+ (\d+), label %(\S+)/g)].map((c) => `${c[1]}:${c[2]}`);
      t = `switch ${d[1]} [${cases.join(",")}]`;
    } else if (last === "ret void") t = "ret_void";
    else if (/^ret /.test(last)) t = "ret";
    else if (last === "unreachable") t = "unreachable";
    else if (/^resume /.test(last)) t = "resume";
    else if ((m = /^cleanupret from \S+ unwind (?:to caller|label %(\S+))$/.exec(last))) t = `cleanupret ${m[1] ?? "caller"}`;
    else t = `?${last}`;
    cur.push(`${label}: ${t}`);
  };
  for (const raw of ll.split("\n")) {
    const d = /^define .*?@([A-Za-z_][A-Za-z0-9_]*)\(/.exec(raw);
    if (d !== null) {
      fn = d[1]!;
      cur = [];
      label = "start";
      insts = [];
      continue;
    }
    if (fn === undefined) continue;
    if (raw === "}") {
      flush();
      out.set(fn, cur);
      fn = undefined;
      continue;
    }
    const l = /^([A-Za-z_][A-Za-z0-9_.]*):/.exec(raw);
    if (l !== null) {
      if (label !== "start" || insts.length > 0) flush();
      label = l[1]!;
      insts = [];
      continue;
    }
    const s = raw.trim();
    if (s === "" || s.startsWith(";") || s.startsWith("start:")) continue;
    insts.push(s);
  }
  return out;
}

// ---- Expected sequences, derived from block.rs (header, point 2) -----------------------------------------------------

const EXPECT: Record<string, Record<string, string[]>> = {
  // codegen_switchint_terminator (block.rs:428), one target and `switch_ty == bool` (:459): test value 0, so
  // `cond_br_with_expect(discr, llotherwise, lltarget, None)` (:464), `target_cold == otherwise_cold` (:458). The
  // provided `cond_br_with_expect` with `None` is `cond_br` (traits/builder.rs:113). `lltarget` (bb2) is made before
  // `llotherwise` (bb1) (:451-:452).
  // (`_0` is assigned in two blocks, so it is a memory local: the `alloca` is codegen_mir's, mod.rs:298.)
  sw_bool: { start: ["%0 = alloca(4, align4)", "cond_br(%arg0, bb1, bb2)"], bb3: ["%1 = load_operand(%0, u32)", "ret(%1)"] },
  // One target, not bool (:471): `immediate_backend_type`, `const_uint_big(switch_llty, 7)`, `icmp(IntEQ, ..)`,
  // `cond_br_with_expect(cmp, lltarget, llotherwise, None)`.
  sw_one: { start: ["%0 = alloca(4, align4)", "%1 = icmp(IntEQ, %arg0, const:7)", "cond_br(%1, bb2, bb1)"] },
  // Three targets, none cold (:541): `switch(discr, otherwise, cases)`; `otherwise` (bb1) is made first (:548), then the
  // cases in order (:549).
  sw_int: { start: ["%0 = alloca(4, align4)", "switch(%arg0, bb1, [[1, bb4], [5, bb3], [9, bb2]])"] },
  // codegen_return_terminator (block.rs:566), `PassMode::Direct` (:602): `codegen_consume(_0)` is the operand
  // `Immediate(%_0)` (an SSA local, defined by the statement stand-in), so `immediate_or_packed_pair` is the immediate.
  ret_direct: { start: ["ret(%_0)"] },
  // `PassMode::Pair` (:602): `immediate_or_packed_pair` packs the pair (operand.rs:345): `const_poison`, two
  // `insert_value`s; `ret`.
  ret_pair: { start: ["%0 = insert_value(poison:I((u32, u32)), %_0.0, 0)", "%1 = insert_value(%0, %_0.1, 1)", "ret(%1)"] },
  // `PassMode::Indirect` (:597): the return place is the sret pointer (mod.rs:286); `ret_void`.
  ret_indirect: { start: ["stmt _0 = Use", "ret_void()"] },
  // `PassMode::Cast` (:611): `_0` is a `Place` (an `alloca_size` of max(cast size, 6) = 8, mod.rs:291), so `op` is
  // `Ref(cg_place.val)` (:615); its align equals the layout's (:629); `load_cast` with no `rest_offset` is one `load`
  // of the cast type at that align (:2583); `ret`.
  // (The argument's alloca comes first: `arg_local_refs` runs before `allocate_local(RETURN_PLACE)`, mod.rs:276.)
  ret_cast: { start: ["%0 = alloca(6, align2)", "store_fn_arg(0, %0)", "%1 = alloca(8, align2)", "stmt _0 = Use", "%2 = load(cast, %1, align2)", "ret(%2)"] },
  // codegen_call_terminator (block.rs:960) with `callee(copy _1, copy _2)`: `x` is `PassMode::Direct` (:2022);
  // `b: Big` is `Indirect { mode: Pointer }` from a `Ref` and not by-move, so it is copied to a scratch alloca (:2040):
  // `PlaceValue::alloca(32, 8)`, `lifetime_start`, the typed copy, and a `lifetime_end` after the call (:295/:323).
  // The return goes to the pending `_0` (`DirectOperand`, :2478; `store_return`, :2531), then the merged `bb1` returns it.
  call_move: {
    start: [
      "%0 = alloca(32, align8)",
      "lifetime_start(%0, 32)",
      "copy(%0, %arg1, 32)",
      "%1 = call @callee(%arg0, %0)",
      "lifetime_end(%0, 32)",
      "debug_introduce_local(_0)",
      "ret(%1)",
    ],
  },
  // `callee(copy _1, move _3)`: `_3` is by-move, so its own place is passed (:2049) with no copy and no lifetimes.
  call_copy: { start: ["%0 = alloca(32, align8)", "stmt _3 = Use", "%1 = call @callee(%arg0, %0)", "debug_introduce_local(_0)", "ret(%1)"] },
  // codegen_drop_terminator (block.rs:653), unwind continue: drop glue by address (:718), `do_call` with no unwind block
  // is a `call` (:308); `funclet_br` merges `bb1` (:146); `Return` with `PassMode::Ignore` is `ret_void` (:597).
  drop_one: { start: ["%0 = alloca(4, align4)", "store_fn_arg(0, %0)", "%1 = call @drop_glue(%0)", "ret_void()"] },
  // Unwind to a cleanup block (host): `landing_pad_for_uncached` (block.rs:2226) makes `cleanup` with a landing pad that
  // saves the exception pair in the personality slot; `invoke` (:276); the cleanup block's drop has
  // `unwind terminate(cleanup)`, so `terminate_block` (:2261) with `filter_landing_pad` and `panic_in_cleanup`; `resume`
  // reloads the pair (:413).
  drop_two: {
    // codegen_mir sets the personality (a cleanup block is reachable, mod.rs:233). The cleanup block and the terminate
    // block are filled while `bb0`'s and `bb3`'s terminators run, so their instructions take the numbers in between.
    start: ["set_personality_fn(@personality)", "%0 = alloca(4, align4)", "store_fn_arg(0, %0)", "%1 = alloca(4, align4)", "store_fn_arg(1, %1)", "%10 = invoke @drop_glue(%1) to bb1 unwind cleanup"],
    // `get_personality_slot` allocates `(*mut u8, i32)` (:2203); `storage_live`; `Pair(exn0, exn1).store` (operand.rs's
    // pair arm: `from_immediate` + `store_with_flags` of each half, the second at offset 8).
    cleanup: [
      "%2, %3 = landingpad cleanup",
      "%4 = alloca(16, align8)",
      "lifetime_start(%4, 16)",
      "%5 = from_immediate(%2)",
      "%6 = store_with_flags(%5, %4, align8, 0)",
      "%7 = inbounds_ptradd(%4, 8usize)",
      "%8 = from_immediate(%3)",
      "%9 = store_with_flags(%8, %7, align8, 0)",
      "br(bb3)",
    ],
    bb1: ["%11 = call @drop_glue(%0)", "ret_void()"],
    terminate: ["filter_landing_pad(@personality)", "%12 = call @panic_in_cleanup()", "apply_attrs_to_cleanup_callsite(%12)", "unreachable()"],
    bb3: ["%13 = invoke @drop_glue(%0) to bb4 unwind terminate", "apply_attrs_to_cleanup_callsite(%13)"],
    // `codegen_resume_terminator` without a funclet: load both fields of the slot, `storage_dead`, `resume`.
    bb4: ["%14 = load_operand(%4, *mut u8)", "%15 = inbounds_ptradd(%4, 8usize)", "%16 = load_operand(%15, i32)", "lifetime_end(%4, 16)", "resume(%14, %16)"],
  },
  // codegen_assert_terminator (block.rs:753), overflow check: `expected == false`, so `cond_br(cond, panic, lltarget)`
  // (:791); the panic block calls the lang item `panic_const_add_overflow` with the caller location (:835) and, with no
  // destination, ends in `unreachable` (:329).
  add_u32: { start: ["cond_br(%_3.1, panic, bb1)"], bb1: ["ret(%_0)"], panic: ["%0 = call @panic_const_add_overflow(@alloc_loc)", "unreachable()"] },
};

const EXPECT_MSVC: Record<string, Record<string, string[]>> = {
  // Funclets (x86_64-pc-windows-msvc): `landing_pad_for_uncached` makes `funclet_bb3` with `cleanuppad within none []`
  // and a `br` to bb3 (:2229). The cleanup block's drop has `unwind terminate(cleanup)`, which MSVC drops (:238), so it
  // is a `call` in the funclet; bb4 (`resume`) is merged and becomes `cleanupret` to the caller (:415).
  drop_two: {
    start: ["set_personality_fn(@personality)", "%0 = alloca(4, align4)", "store_fn_arg(0, %0)", "%1 = alloca(4, align4)", "store_fn_arg(1, %1)", "%3 = invoke @drop_glue(%1) to bb1 unwind funclet_bb3"],
    funclet_bb3: ["%2 = cleanuppad(None, [])", "br(bb3)"],
    bb3: ["%5 = call @drop_glue(%0) funclet %2", "apply_attrs_to_cleanup_callsite(%5)", "cleanupret(%2, caller)"],
    bb1: ["%4 = call @drop_glue(%0)", "ret_void()"],
  },
};

// ---- Tests -----------------------------------------------------------------------------------------------------------

function check(target_args: string[], ll_file: string, expect_seq: Record<string, Record<string, string[]>>): void {
  const results = run(target_args);
  const oracle = oracle_shapes(readFileSync(join(DIR, ll_file), "utf8"));
  const names = [...results.keys()].sort();
  expect(names).toEqual([...oracle.keys()].filter((k) => results.has(k)).sort());
  expect(names.length).toBe(12);
  for (const name of names) {
    expect({ name, shapes: mock_shapes(results.get(name)!) }).toEqual({ name, shapes: oracle.get(name)! });
  }
  for (const [name, blocks] of Object.entries(expect_seq)) {
    const r = results.get(name)!;
    for (const [b, lines] of Object.entries(blocks)) {
      expect({ name, b, lines: r.blocks.get(b) }).toEqual({ name, b, lines });
    }
  }
}

test("block.rs on the host: block order and terminators match the oracle; call sequences match the source", () => {
  check([], "host.ll", EXPECT);
}, 60_000);

test("block.rs on x86_64-pc-windows-msvc: funclets", () => {
  check(["--target", "x86_64-pc-windows-msvc"], "msvc.ll", EXPECT_MSVC);
}, 60_000);

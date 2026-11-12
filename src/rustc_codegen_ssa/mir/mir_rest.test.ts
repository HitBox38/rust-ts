// Unit tests of lane ssa-mir-rest: mir/statement.ts, mir/coverageinfo.ts, mir/retag.ts, meth.ts, size_of_val.ts and
// mono_item.ts, over a logging mock backend and the layouts the port computes for a small crate (std, `-Zcodegen-emit-retag`
// so the retag paths run). Upstream has no unit tests for these files; every expectation is read off the upstream source
// at the pin (cited per case) and the real layouts.
//
// The mock (as operand_place.test.ts's): backend values and types are strings; a method the mock does not define logs
// `name(args)` and returns a fresh `%N`, so a test compares the exact sequence of backend calls the ported code makes.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { oracleSysroot } from "../../../scripts/lib/oracle.ts";
import { Align, Size, WrappingRange } from "../../rustc_abi/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import type { ConstAllocation } from "../../rustc_middle/mir/interpret/allocation.ts";
import { type Body, debug_Rvalue, debug_StatementKind, type Operand, Place, type Rvalue, Statement, type StatementKind } from "../../rustc_middle/mir/mod.ts";
import { MonoItem, type MonoItemData } from "../../rustc_middle/mono.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { typeid_for_trait_ref } from "../../rustc_symbol_mangling/lib.ts";
import { type ExistentialTraitRef, fold_with_ExistentialTraitRef, try_fold_with_ExistentialTraitRef, visit_with_ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { plain_bug } from "../../rust_ts/test_bug.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { RetagInfo } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import { type BuilderMethods, BuilderMethods_provided } from "../traits/builder.ts";
import * as meth from "../meth.ts";
import { size_and_align_of_dst } from "../size_of_val.ts";
import { MonoItemExt, mono_item_xlane } from "../mono_item.ts";
import { install_FunctionCx_coverageinfo } from "./coverageinfo.ts";
import { install_FunctionCx_constant } from "./constant.ts";
import { Locals } from "./locals.ts";
import { FunctionCx, type LocalRef } from "./mod.ts";
import { debug_OperandValue, OperandRef, type OperandValue } from "./operand.ts";
import { PlaceRef, PlaceValue } from "./place.ts";
import { install_FunctionCx_retag, rvalue_needs_retag } from "./retag.ts";
import { install_FunctionCx_statement, stmt_xlane } from "./statement.ts";

// mod.ts does not call this lane's installers yet (root adds them at integration); the test does, once.
install_FunctionCx_constant(FunctionCx);
install_FunctionCx_statement(FunctionCx);
install_FunctionCx_coverageinfo(FunctionCx);
install_FunctionCx_retag(FunctionCx);

interface MockTypes extends BackendTypes {
  Value: string;
  Type: string;
  Function: string;
  BasicBlock: string;
  FunctionSignature: string;
}
type V = string;

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

const SRC = [
  "use std::cell::Cell;",
  "pub trait Tr { fn m(&self); }",
  "pub struct W { pub a: u8, pub s: [u16] }",
  "#[repr(packed(2))] pub struct PK { pub a: u8, pub s: [u32] }",
  "impl Tr for u8 { fn m(&self) {} }",
  "pub static S: u32 = 5;",
  "#[unsafe(naked)] pub extern \"C\" fn nk() { core::arch::naked_asm!(\"ret\") }",
  "pub fn f(_r: &u32, _m: &mut u32, _c: &(u32, Cell<u32>), _t: (&u32, &mut u8), _a: [&u32; 3], _b: u8, _d: &dyn Tr, _s: &[f32], _st: &str, _w: &W, _pk: &PK, _o: Option<&u32>, _c2: &Cell<u32>, _ds: &dyn Send) {}",
  "pub fn g(x: u32, p: *mut u64, r: &u32) -> u32 { let y = x; let z = r; unsafe { *p = 7; } let _ = z; y }",
].join("\n");

/** Formats a mock call argument. */
function fmt_arg(a: unknown): string {
  if (a instanceof Align) return `align${a.bytes()}`;
  if (a instanceof Size) return `size${a.bytes()}`;
  if (Array.isArray(a)) return `[${a.map(fmt_arg).join(", ")}]`;
  if (typeof a === "string" || typeof a === "number" || typeof a === "bigint" || typeof a === "boolean") return String(a);
  if (a === undefined) return "None";
  if (a instanceof WrappingRange) return `${a.start}..=${a.end}`;
  if (typeof a === "object" && a !== null && "llval" in a) return `pv(${String((a as { llval: unknown }).llval)})`;
  return "<obj>";
}

function fmt_info(info: RetagInfo<V>): string {
  return `{size${info.size.bytes()}, flags=${info.flags}, im=${info.im_layout}, pin=${info.pin_layout}}`;
}

/** The logging mock builder (and its own `cx`). `overrides` replace or add members. */
function mock_bx(tcx: TyCtxt, overrides: Record<string, unknown> = {}): { bx: BuilderMethods<MockTypes>; log: string[]; allocs: ConstAllocation[] } {
  const log: string[] = [];
  const allocs: ConstAllocation[] = [];
  let n = 0;
  const layout_of = (ty: Ty): TyAndLayout => {
    const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
    if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
    return r._0;
  };
  const tyname = (l: TyAndLayout): string => display_Ty(l.ty);
  const own: Record<string, unknown> = {
    debug_Value: (v: V) => v,
    debug_Type: (v: V) => v,
    debug_Function: (v: V) => v,
    debug_FunctionSignature: (v: V) => v,
    tcx_: () => tcx,
    typing_env_: () => TypingEnv.fully_monomorphized(),
    layout_of,
    spanned_layout_of: (ty: Ty) => layout_of(ty),
    data_layout: () => tcx.data_layout(),
    sess: () => tcx.sess,
    const_usize: (i: bigint) => `usize ${i}`,
    const_uint: (t: string, i: bigint) => `${t} ${i}`,
    const_uint_big: (t: string, i: bigint) => `${t} ${i}`,
    const_i32: (i: number) => `i32 ${i}`,
    const_to_opt_uint: (v: V) => (v.startsWith("usize ") ? BigInt(v.slice(6)) : undefined),
    const_to_opt_u128: (v: V) => (v.startsWith("usize ") ? BigInt(v.slice(6)) : undefined),
    const_null: (t: string) => `null:${t}`,
    immediate_backend_type: (l: TyAndLayout) => `ity:${tyname(l)}`,
    backend_type: (l: TyAndLayout) => `bty:${tyname(l)}`,
    scalar_pair_element_backend_type: (l: TyAndLayout, i: number, imm: boolean) => `pair${i}${imm ? "i" : ""}:${tyname(l)}`,
    fn_ptr_backend_type: () => "fnptr",
    type_ptr: () => "ptr",
    type_isize: () => "isize",
    type_i64: () => "i64",
    const_poison: (t: string) => `poison:${t}`,
    const_undef: (t: string) => `undef:${t}`,
    static_addr_of: (alloc: ConstAllocation, kind: string | undefined) => {
      allocs.push(alloc);
      const r = `%${n++}`;
      log.push(`${r} = static_addr_of(alloc${allocs.length - 1}, ${fmt_arg(kind)})`);
      return r;
    },
    retag_mem: (place: V, info: RetagInfo<V>) => {
      log.push(`retag_mem(${place}, ${fmt_info(info)})`);
    },
    retag_reg: (ptr: V, info: RetagInfo<V>) => {
      const r = `%${n++}`;
      log.push(`${r} = retag_reg(${ptr}, ${fmt_info(info)})`);
      return r;
    },
    load_operand: (place: PlaceRef<V>) => {
      log.push(`load_operand(${place.val.llval}, ${tyname(place.layout)})`);
      return new OperandRef<V>({ $: "Immediate", _0: `load(${place.val.llval})` }, place.layout, undefined);
    },
    typed_place_copy_with_flags: (dst: PlaceValue<V>, src: PlaceValue<V>, layout: TyAndLayout, flags: number) =>
      BuilderMethods_provided.typed_place_copy_with_flags(proxy, dst, src, layout, flags),
    ...overrides,
  };
  const proxy: BuilderMethods<MockTypes> = new Proxy(own, {
    get(target, prop) {
      if (prop === "cx") return () => proxy;
      if (typeof prop === "string" && prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then" || prop === "__backend_types") return undefined;
      return (...args: unknown[]) => {
        const r = `%${n++}`;
        log.push(`${r} = ${prop}(${args.map(fmt_arg).join(", ")})`);
        return r;
      };
    },
  }) as unknown as BuilderMethods<MockTypes>;
  return { bx: proxy, log, allocs };
}

interface Fixture {
  tcx: TyCtxt;
  f: Body;
  g: Body;
  g_instance: Instance;
  defs: Map<string, DefId>;
}

function with_tcx(run: (fx: Fixture) => void): void {
  const file = join(DATA, "tmp", "ssa-mir-rest", "mir_rest.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  // The deliberate `bug!` checks leave ICE errors in the session's DiagCtxt, so the compiler aborts once the closure
  // is done ("aborting due to N previous errors"); that abort is expected only after every check has run.
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", "--sysroot", oracleSysroot(), "-Zcodegen-emit-retag", file]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        const bodies = new Map<string, Body>();
        const defs = new Map<string, DefId>();
        for (const def of tcx.mir_keys(null)) {
          const name = tcx.def_path_str(LocalDefId.to_def_id(def));
          defs.set(name, LocalDefId.to_def_id(def));
          if (name === "f" || name === "g") bodies.set(name, tcx.mir_built(def).borrow());
        }
        run({ tcx, f: bodies.get("f")!, g: bodies.get("g")!, g_instance: Instance.mono(tcx, defs.get("g")!), defs });
        ran = true;
      });
    });
  } catch (e) {
    if (!ran) throw e;
  }
  expect(ran).toBe(true);
}

function fx_of(fields: Record<string, unknown>): FunctionCx<MockTypes> {
  const fx = Object.create(FunctionCx.prototype) as FunctionCx<MockTypes>;
  Object.assign(fx, fields);
  return fx;
}


const DUMP = false;
const d_ExistentialTraitRef = { visit_with: visit_with_ExistentialTraitRef, try_fold_with: try_fold_with_ExistentialTraitRef, fold_with: fold_with_ExistentialTraitRef };
function dump(name: string, log: unknown): void {
  if (DUMP) console.log(name, JSON.stringify(log, null, 1));
}

test("statement.rs / coverageinfo.rs / constant.rs over a mock backend", () => {
  with_tcx(({ tcx, g, g_instance }) => {
    const layout = (ty: Ty) => {
      const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
      if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
      return r._0;
    };
    const lty = g.local_decls.map((d) => d.ty);
    const stmts = g.basic_blocks.deref()[0]!.statements;
    // `g`'s locals: _0 u32, _1 x: u32, _2 p: *mut u64, _3 r: &u32, _4 y: u32, _5 z: &u32, _6 (). bb0 (mir_built):
    // 0 StorageLive(_4)  1 _4 = copy _1  2 FakeRead  3 StorageLive(_5)  4 _5 = copy _3  5 FakeRead  6 StorageLive(_6)
    // 7 (*_2) = const 7_u64  8 _6 = const ()  9 StorageDead(_6)  10 PlaceMention(_5)  11 _0 = copy _4  12 StorageDead(_5)
    // 13 StorageDead(_4)
    expect(stmts.map((s) => debug_StatementKind(s.kind, PLAIN))).toEqual([
      "StorageLive(_4)",
      "_4 = copy _1",
      "FakeRead(ForLet(None), _4)",
      "StorageLive(_5)",
      "_5 = copy _3",
      "FakeRead(ForLet(None), _5)",
      "StorageLive(_6)",
      "(*_2) = const 7_u64",
      "_6 = const ()",
      "StorageDead(_6)",
      "PlaceMention(_5)",
      "_0 = copy _4",
      "StorageDead(_5)",
      "StorageDead(_4)",
    ]);
    const { bx, log } = mock_bx(tcx, {
      add_coverage: (instance: Instance, _kind: unknown) => {
        log.push(`add_coverage(${instance === g_instance ? "g" : "?"})`);
      },
    });
    const locals: LocalRef<V>[] = [
      { $: "Place", _0: PlaceRef.new_sized<V>("%ret", layout(lty[0]!)) },
      { $: "Operand", _0: new OperandRef<V>({ $: "Immediate", _0: "%x" }, layout(lty[1]!), undefined) },
      { $: "Operand", _0: new OperandRef<V>({ $: "Immediate", _0: "%p" }, layout(lty[2]!), undefined) },
      { $: "Operand", _0: new OperandRef<V>({ $: "Immediate", _0: "%r" }, layout(lty[3]!), undefined) },
      { $: "PendingOperand" },
      { $: "PendingOperand" },
      { $: "Operand", _0: OperandRef.zero_sized<V>(layout(lty[6]!)) },
    ];
    const fx = fx_of({ instance: g_instance, mir: g, cx: bx, locals: new Locals<V>(locals) });
    // The cross-lane callees (debuginfo.rs, rvalue.rs) are recorders; `codegen_rvalue_operand` of a `Use` is the operand
    // (rvalue.rs's `Use` arm).
    const saved = { ...stmt_xlane };
    stmt_xlane.codegen_stmt_debuginfos = () => void log.push("dbg");
    stmt_xlane.set_debug_loc = () => void log.push("loc");
    stmt_xlane.debug_introduce_local = (_fx, _bx, local) => void log.push(`debug_introduce_local(_${local})`);
    stmt_xlane.codegen_rvalue = (_fx, _bx, dest, rvalue) => void log.push(`codegen_rvalue(${dest.val.llval}, ${debug_Rvalue(rvalue, PLAIN)})`);
    stmt_xlane.codegen_rvalue_operand = ((fx_: FunctionCx<MockTypes>, bx_: BuilderMethods<MockTypes>, rvalue: Rvalue) => {
      log.push(`codegen_rvalue_operand(${debug_Rvalue(rvalue, PLAIN)})`);
      if (rvalue.$ !== "Use") throw new Error("ERROR: not a Use");
      // operand.ts's `codegen_operand` still reaches constant.rs through its stub (root repoints it at integration):
      // a constant goes to this lane's `eval_mir_constant_to_operand` directly, as operand.rs:1194 does.
      const o = rvalue._0;
      return o.$ === "Constant" ? fx_.eval_mir_constant_to_operand(bx_, o._0) : fx_.codegen_operand(bx_, o);
    }) as typeof stmt_xlane.codegen_rvalue_operand;
    try {
      const run = (i: number): string[] => {
        log.length = 0;
        fx.codegen_statement(bx, stmts[i]!);
        return [...log];
      };
      // StorageLive / StorageDead of an operand local: nothing past the debuginfo calls (statement.rs:73-86).
      expect(run(0)).toEqual(["dbg", "loc"]);
      // `_4 = copy _1` into a PendingOperand local (statement.rs:36): the operand, then retag (`-Zcodegen-emit-retag`,
      // `Use(.., Yes)`), which builds no plan for a `u32` (smaller than a pointer, retag.rs:77); `overwrite_local`, then
      // `debug_introduce_local`.
      expect(run(1)).toEqual(["dbg", "loc", "codegen_rvalue_operand(copy _1)", "debug_introduce_local(_4)"]);
      const l4 = fx.locals.index(4 as never);
      expect(l4.$ === "Operand" && l4._0.val).toEqual({ $: "Immediate", _0: "%x" });
      // FakeRead / PlaceMention: nothing (statement.rs:117).
      expect(run(2)).toEqual(["dbg", "loc"]);
      expect(run(10)).toEqual(["dbg", "loc"]);
      // `_5 = copy _3` (`&u32`): the retag of an immediate reference (retag.rs:399 -> :437): `retag_reg` with
      // flags IS_FREEZE (8; not mutable, not a fn-entry retag), no interior-mutable or pinned ranges (null pointers).
      const r4 = run(4);
      expect(r4).toEqual(["dbg", "loc", "codegen_rvalue_operand(copy _3)", "%0 = retag_reg(%r, {size4, flags=8, im=null:ptr, pin=null:ptr})", "debug_introduce_local(_5)"]);
      const l5 = fx.locals.index(5 as never);
      expect(l5.$ === "Operand" && l5._0.val).toEqual({ $: "Immediate", _0: "%0" });
      // `(*_2) = const 7_u64`: a projection place (statement.rs:62): `codegen_place` derefs the operand local `_2`;
      // `u64` is not smaller than a pointer but holds none (`walk_value` of a primitive: no plan).
      expect(run(7)).toEqual(["dbg", "loc", "codegen_rvalue(%p, const 7_u64)"]);
      // `_6 = const ()` into a ZST operand local (statement.rs:44): the operand is still codegenned
      // (constant.rs `eval_mir_constant_to_operand` -> `OperandRef::from_const`, a ZST), and no plan for a ZST.
      expect(run(8)).toEqual(["dbg", "loc", "codegen_rvalue_operand(const ())"]);
      // `_0 = copy _4` into a Place local (statement.rs:22).
      expect(run(11)).toEqual(["dbg", "loc", "codegen_rvalue(%ret, copy _4)"]);
      // Assigning a non-ZST operand local twice is a `span_bug!` (statement.rs:46).
      expect(() => plain_bug(() => run(1))).toThrow("operand copy _1 already assigned");

      // Statements the fixture's MIR has no instance of, built from its parts.
      const si = stmts[0]!.source_info;
      const dbg = stmts[0]!.debuginfos;
      const place0 = stmts[11]!.kind.$ === "Assign" ? stmts[11]!.kind._0[0] : undefined!;
      const copy1 = stmts[1]!.kind.$ === "Assign" && stmts[1]!.kind._0[1].$ === "Use" ? stmts[1]!.kind._0[1]._0 : undefined!;
      const op = (l: number): Operand => ({ $: "Copy", _0: new Place(l as never, copy1.$ === "Copy" ? copy1._0.projection : undefined!) });
      const st = (kind: StatementKind) => new Statement(si, kind, dbg);
      const runk = (kind: StatementKind): string[] => {
        log.length = 0;
        fx.codegen_statement(bx, st(kind));
        return [...log];
      };
      // StorageLive / StorageDead of a Place local: `lifetime_start` / `lifetime_end` (place.rs:320, :324).
      expect(runk({ $: "StorageLive", _0: 0 as never })).toEqual(["dbg", "loc", "%1 = lifetime_start(%ret, size4)"]);
      expect(runk({ $: "StorageDead", _0: 0 as never })).toEqual(["dbg", "loc", "%2 = lifetime_end(%ret, size4)"]);
      // `Intrinsic(Assume(op))`: `bx.assume(op.immediate())` (statement.rs:90).
      expect(runk({ $: "Intrinsic", _0: { $: "Assume", _0: op(1) } })).toEqual(["dbg", "loc", "%3 = assume(%x)"]);
      // `Intrinsic(CopyNonOverlapping { count: _1, src: _2, dst: _2 })` (statement.rs:94): dst, src, count; the byte
      // count is `count * size_of::<u64>()` (unchecked_sumul), and both alignments are `u64`'s.
      expect(runk({ $: "Intrinsic", _0: { $: "CopyNonOverlapping", _0: { count: op(1), src: op(2), dst: op(2) } } })).toEqual([
        "dbg",
        "loc",
        "%4 = unchecked_sumul(%x, usize 8)",
        "%5 = memcpy(%p, align8, %p, align8, %4, 0, None)",
      ]);
      // ... and a `dst` that is not a raw pointer is a `bug!`.
      expect(() => plain_bug(() => runk({ $: "Intrinsic", _0: { $: "CopyNonOverlapping", _0: { count: op(1), src: op(2), dst: op(1) } } }))).toThrow("expected pointer");
      // `Coverage(kind)` (statement.rs:87 -> coverageinfo.rs:8): not inlined (outermost scope), so `fx.instance`.
      expect(runk({ $: "Coverage", _0: { $: "VirtualCounter", bcb: 0 as never } })).toEqual(["dbg", "loc", "add_coverage(g)"]);
      // `Nop`, `ConstEvalCounter`: nothing.
      expect(runk({ $: "Nop" })).toEqual(["dbg", "loc"]);
      expect(runk({ $: "ConstEvalCounter" })).toEqual(["dbg", "loc"]);
      // An `UnsizedPlace` destination is a `span_bug!` (statement.rs:28).
      const unsized = { $: "UnsizedPlace", _0: PlaceRef.new_sized<V>("%u", layout(tcx.types.u8)) } as LocalRef<V>;
      fx.locals.values[0] = unsized;
      expect(() => plain_bug(() => runk(stmts[11]!.kind))).toThrow("cannot reallocate from `UnsizedPlace(u8)` into `copy _4`; dynamic alloca is not supported");
      // StorageLive of an `UnsizedPlace` local: `lifetime_start` on its pointer.
      expect(runk({ $: "StorageLive", _0: 0 as never })).toEqual(["dbg", "loc", "%6 = lifetime_start(%u, size1)"]);
      void place0;
    } finally {
      Object.assign(stmt_xlane, saved);
    }
    // Without the stubs replaced, the first cross-lane call stops by name.
    expect(() => fx.codegen_statement(bx, stmts[0]!)).toThrow("ssa-debuginfo: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs codegen_stmt_debuginfos");
  });
});

test("meth.rs / size_of_val.rs / retag.rs / mono_item.rs over a mock backend", () => {
  with_tcx(({ tcx, f, g_instance, defs }) => {
    const layout = (ty: Ty) => {
      const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
      if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
      return r._0;
    };
    // `f`'s argument types (_1.._14).
    const [R_u32, M_u32, R_cell_pair, T_refs, A_refs, U8, R_dyn, R_slice, R_str, R_w, R_pk, O_ref, R_cell, R_send] = f.local_decls
      .slice(1, 15)
      .map((d) => d.ty) as [Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty];
    const deref = (t: Ty): Ty => t.builtin_deref(true)!;
    const sections: Record<string, unknown> = {};

    // ---- meth.rs ----
    {
      const { bx, log } = mock_bx(tcx);
      sections.get_fn = [meth.VirtualIndex.from_index(3).get_fn(bx, "%vt", R_dyn, {} as never), [...log]];
      log.length = 0;
      sections.get_optional_fn = [meth.VirtualIndex.from_index(4).get_optional_fn(bx, "%vt", R_dyn, {} as never), [...log]];
      log.length = 0;
      sections.get_usize = [meth.VirtualIndex.from_index(1).get_usize(bx, "%vt", R_dyn), [...log]];
    }
    // VFE path (meth.rs:136): `-Zvirtual-function-elimination` with fat LTO, through a stand-in session.
    {
      const vfe_sess = { opts: { unstable_opts: { virtual_function_elimination: true } }, lto: () => "Fat" };
      const { bx, log } = mock_bx(tcx, {
        sess: () => vfe_sess,
        type_checked_load: (vt: V, off: number, typeid: Uint8Array) => {
          log.push(`type_checked_load(${vt}, ${off}, ${new TextDecoder().decode(typeid)})`);
          return "%tcl";
        },
      });
      sections.vfe_get_fn = [meth.VirtualIndex.from_index(3).get_fn(bx, "%vt", R_dyn, {} as never), [...log]];
      log.length = 0;
      sections.vfe_get_optional_fn_no_principal = [meth.VirtualIndex.from_index(3).get_optional_fn(bx, "%vt", R_send, {} as never), [...log]];
      sections.vfe_get_fn_no_principal = String((() => { try { plain_bug(() => meth.VirtualIndex.from_index(3).get_fn(bx, "%vt", R_send, {} as never)); return "no throw"; } catch (e) { return (e as Error).message; } })());
      sections.vfe_not_dyn = String((() => { try { plain_bug(() => meth.VirtualIndex.from_index(3).get_fn(bx, "%vt", U8, {} as never)); return "no throw"; } catch (e) { return (e as Error).message; } })());
      const dk = deref(R_dyn).kind();
      const principal = dk.$ === "Dynamic" ? dk._0.principal() : undefined;
      sections.vfe_typeid = principal === undefined ? "none" : typeid_for_trait_ref(tcx, tcx.instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef));
    }
    // get_vtable (meth.rs:103): the cache, then the allocation.
    {
      const vtables = new KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], V>(intern_key);
      const { bx, log, allocs } = mock_bx(tcx, { vtables: () => vtables });
      const v1 = meth.get_vtable(bx, U8, undefined);
      const l1 = [...log];
      log.length = 0;
      const v2 = meth.get_vtable(bx, U8, undefined);
      sections.get_vtable = [v1, l1, v2, [...log], allocs.map((a) => [a.inner().size().bytes(), a.inner().align.bytes()])];
    }

    // ---- size_of_val.rs ----
    {
      const sv = (t: Ty, info: V | undefined) => {
        const { bx, log } = mock_bx(tcx, {
          range_metadata: (v: V, r: WrappingRange) => void log.push(`range_metadata(${v}, ${r.start}..=${r.end})`),
        });
        const r = size_and_align_of_dst(bx, t, info, DUMMY_SP);
        return [r, [...log]];
      };
      sections.sv_u32 = sv(tcx.types.u32, undefined);
      sections.sv_slice = sv(deref(R_slice), "%len");
      sections.sv_str = sv(deref(R_str), "%len");
      sections.sv_dyn = sv(deref(R_dyn), "%vt");
      sections.sv_w = sv(deref(R_w), "%len");
      sections.sv_pk = sv(deref(R_pk), "%len");
    }

    // ---- retag.rs ----
    {
      const rp = (t: Ty, ll: V, is_fn_entry: boolean, overrides: Record<string, unknown> = {}) => {
        const { bx, log, allocs } = mock_bx(tcx, overrides);
        const fx = fx_of({ instance: g_instance, mir: f, cx: bx, locals: new Locals<V>([]) });
        try {
          fx.codegen_retag_place(bx, PlaceRef.new_sized<V>(ll, layout(t)), is_fn_entry);
        } catch (e) {
          log.push(`THROW ${(e as Error).message}`);
        }
        return [log, allocs.map((a) => Array.from(a.inner().inspect_with_uninit_and_ptr_outside_interpreter({ start: 0, end: a.inner().size().bytes() })).join(" "))];
      };
      sections.rp_ref = rp(R_u32, "%p", false);
      sections.rp_ref_entry = rp(R_u32, "%p", true);
      sections.rp_mut_entry = rp(M_u32, "%p", true);
      sections.rp_cell_pair = rp(R_cell_pair, "%p", false);
      sections.rp_cell = rp(R_cell, "%p", false);
      sections.rp_refs = rp(T_refs, "%t", false);
      sections.rp_array = rp(A_refs, "%a", false);
      sections.rp_u8 = rp(U8, "%b", false);
      sections.rp_option = rp(O_ref, "%o", false);
      const ro = (t: Ty, val: OperandValue<V>, overrides: Record<string, unknown> = {}) => {
        const { bx, log } = mock_bx(tcx, overrides);
        const fx = fx_of({ instance: g_instance, mir: f, cx: bx, locals: new Locals<V>([]) });
        try {
          const r = fx.codegen_retag_operand(bx, new OperandRef<V>(val, layout(t), undefined), false);
          return [debug_OperandValue(r.val, PLAIN, (v) => v), log];
        } catch (e) {
          return [`THROW ${(e as Error).message}`, log];
        }
      };
      sections.ro_ref = ro(R_u32, { $: "Immediate", _0: "%r" });
      sections.ro_refs = ro(T_refs, { $: "Pair", _0: "%a", _1: "%b" });
      sections.ro_array_ref = ro(A_refs, { $: "Ref", _0: new PlaceValue<V>("%a", undefined, Align.EIGHT) });
      sections.ro_option = ro(O_ref, { $: "Immediate", _0: "%o" });
      sections.ro_option_const = String((() => { try { return JSON.stringify(ro(O_ref, { $: "Immediate", _0: "%o" }, { const_to_opt_u128: () => 1n })); } catch (e) { return (e as Error).message; } })());
    }

    // ---- mono_item.rs ----
    {
      const { bx, log } = mock_bx(tcx, {
        predefine_fn: (inst: Instance, linkage: string, vis: string, sym: string) => void log.push(`predefine_fn(${inst === g_inst ? "g" : inst === nk_inst ? "nk" : "?"}, ${linkage}, ${vis}, ${sym})`),
        predefine_static: (id: DefId, linkage: string, vis: string, sym: string) => void log.push(`predefine_static(${id === S ? "S" : "?"}, ${linkage}, ${vis}, ${sym})`),
        codegen_static: (id: DefId) => void log.push(`codegen_static(${id === S ? "S" : "?"})`),
      });
      const S = defs.get("S")!;
      const g_inst = g_instance;
      const nk_inst = Instance.mono(tcx, defs.get("nk")!);
      const catch_ = (f: () => unknown): string => {
        try {
          f();
          return "ok";
        } catch (e) {
          return `THROW ${(e as Error).message}`;
        }
      };
      const fn_g: MonoItem = { $: "Fn", _0: g_inst };
      const fn_nk: MonoItem = { $: "Fn", _0: nk_inst };
      const st: MonoItem = { $: "Static", _0: S };
      MonoItemExt.predefine<MockTypes>(fn_g, bx, "cgu", "External", "Hidden");
      MonoItemExt.predefine<MockTypes>(fn_nk, bx, "cgu", "External", "Default");
      MonoItemExt.predefine<MockTypes>(st, bx, "cgu", "Internal", "Default");
      const item_data: MonoItemData = { inlined: false, linkage: "External", visibility: "Default", size_estimate: 1 };
      // `Bx_` (the builder's static side) is only handed on to the `codegen_instance` stub.
      const define = (m: MonoItem) => MonoItemExt.define<MockTypes, CodegenMethods<MockTypes>, BuilderMethods<MockTypes>>(m, {} as never, bx, "cgu", item_data);
      // base.rs / naked_asm.rs are ported now (root at integ-w54): `mono_item_xlane`'s entries forward to them. Recorders
      // stand in for them here, so the test checks mono_item.rs's dispatch, not those callees over this mock.
      const saved = { ...mono_item_xlane };
      mono_item_xlane.codegen_instance = ((_Bx: unknown, _cx: unknown, inst: Instance) => void log.push(`codegen_instance(${inst === g_inst ? "g" : "?"})`)) as never;
      mono_item_xlane.codegen_naked_asm = ((_cx: unknown, inst: Instance) => void log.push(`codegen_naked_asm(${inst === nk_inst ? "nk" : "?"})`)) as never;
      mono_item_xlane.codegen_global_asm = (() => void log.push("codegen_global_asm")) as never;
      sections.mono_item = [
        [...log],
        [MonoItem.symbol_name(fn_g, tcx).name, MonoItem.symbol_name(st, tcx).name],
        catch_(() => define(st)),
        catch_(() => define(fn_g)),
        catch_(() => define(fn_nk)),
        catch_(() => define({ $: "GlobalAsm", _0: {} as never })),
        MonoItemExt.to_raw_string(st),
        catch_(() => MonoItemExt.to_raw_string(fn_g)),
        log.slice(2),
      ];
      Object.assign(mono_item_xlane, saved);
    }
    dump("sections", sections);

    const n = "null:ptr";
    // The array retag loop (retag.rs:551 -> within_loop :605), over `[&u32; 3]` at `%a`: a usize counter alloca with its
    // lifetime, `0` stored, a `retag_loop` block entered by `br`, the counter loaded as `isize`, the element projected
    // (place.rs `project_index`: `inbounds_nuw_gep` of the element type), retagged, `counter + 1` stored, `retag_loop_exit`
    // appended, `icmp eq next, 3`, `cond_br(exit, body)`, then the exit block and the counter's lifetime end.
    const loop_a = [
      "%0 = alloca(size8, align8)",
      "%1 = lifetime_start(%0, size8)",
      "%2 = store_to_place(usize 0, pv(%0))",
      "%3 = append_sibling_block(retag_loop)",
      "%4 = br(%3)",
      "%5 = switch_to_block(%3)",
      "%6 = load_from_place(isize, pv(%0))",
      "%7 = inbounds_nuw_gep(bty:&u32, %a, [%6])",
      `retag_mem(%7, {size4, flags=8, im=${n}, pin=${n}})`,
      "%8 = unchecked_uadd(%6, usize 1)",
      "%9 = store_to_place(%8, pv(%0))",
      "%10 = append_sibling_block(retag_loop_exit)",
      "%11 = icmp(IntEQ, %8, usize 3)",
      "%12 = cond_br(%11, %10, %3)",
      "%13 = switch_to_block(%10)",
      "%14 = lifetime_end(%0, size8)",
    ];
    const [sym_g, sym_s] = [MonoItem.symbol_name({ $: "Fn", _0: g_instance }, tcx).name, MonoItem.symbol_name({ $: "Static", _0: defs.get("S")! }, tcx).name];
    const { mono_item, vfe_typeid, ...rest } = sections as { mono_item: unknown[]; vfe_typeid: string } & Record<string, unknown>;
    expect(rest).toEqual({
      // meth.rs:46 get_fn: slot 3 at `3 * 8` bytes (:31), a pointer-aligned load (:149), invariant (:151), nonnull (:153).
      get_fn: ["%1", ["%0 = inbounds_ptradd(%vt, usize 24)", "%1 = load(fnptr, %0, align8)", "%2 = set_invariant_load(%1)", "%3 = nonnull_metadata(%1)"]],
      // meth.rs:36 get_optional_fn: the same without `nonnull_metadata`.
      get_optional_fn: ["%5", ["%4 = inbounds_ptradd(%vt, usize 32)", "%5 = load(fnptr, %4, align8)", "%6 = set_invariant_load(%5)"]],
      // meth.rs:56 get_usize: an `isize` load, never nonnull.
      get_usize: ["%8", ["%7 = inbounds_ptradd(%vt, usize 8)", "%8 = load(isize, %7, align8)", "%9 = set_invariant_load(%8)"]],
      // meth.rs:136-145: with VFE and fat LTO, the principal trait's typeid and `type_checked_load` at the byte offset.
      vfe_get_fn: ["%tcl", [`type_checked_load(%vt, 24, ${vfe_typeid})`]],
      // `dyn Send` has no principal: an optional fn falls through to the plain load ...
      vfe_get_optional_fn_no_principal: ["%1", ["%0 = inbounds_ptradd(%vt, usize 24)", "%1 = load(fnptr, %0, align8)", "%2 = set_invariant_load(%1)"]],
      // ... and a nonnull one is a `bug!` (:144); a receiver without a `dyn` is `dyn_trait_in_self`'s `bug!` (:91).
      vfe_get_fn_no_principal: "load nonnull value from a vtable without a principal trait",
      vfe_not_dyn: "expected a `dyn Trait` ty, found u8",
      // meth.rs:103 get_vtable(u8, None): `static_addr_of(alloc, Some("vtable"))`, the vcall metadata, the debuginfo, then
      // the cache: the second call returns the same value with no backend call. The allocation is the 3 common entries.
      get_vtable: ["%0", ["%0 = static_addr_of(alloc0, vtable)", "%1 = apply_vcall_visibility_metadata(<obj>, None, %0)", "%2 = create_vtable_debuginfo(<obj>, None, %0)"], "%0", [], [[24, 8]]],
      // size_of_val.rs:22: a sized type is its constant size and alignment.
      sv_u32: [["usize 4", "usize 4"], []],
      // :46 `[f32]` / `str`: `len * unit size` (unchecked_sumul) and the unit's alignment.
      sv_slice: [["%0", "usize 4"], ["%0 = unchecked_sumul(%len, usize 4)"]],
      sv_str: [["%0", "usize 1"], ["%0 = unchecked_sumul(%len, usize 1)"]],
      // :28 `dyn Tr`: vtable slots 1 (size) and 2 (align), then `range_metadata` 0..=isize::MAX and 1..=2^29
      // (`Align::max_for_target` of a 64-bit target: min(2^63, Align::MAX = 2^29)).
      sv_dyn: [
        ["%1", "%4"],
        [
          "%0 = inbounds_ptradd(%vt, usize 8)",
          "%1 = load(isize, %0, align8)",
          "%2 = set_invariant_load(%1)",
          "%3 = inbounds_ptradd(%vt, usize 16)",
          "%4 = load(isize, %3, align8)",
          "%5 = set_invariant_load(%4)",
          "range_metadata(%1, 0..=9223372036854775807)",
          "range_metadata(%4, 1..=536870912)",
        ],
      ],
      // :91 `W { a: u8, s: [u16] }`: the tail at offset 2, sized align 2; the tail's size `len * 2`; both aligns constant
      // (2, 2) so `full_align = 2` (:139); `(2 + size + (2 - 1)) & -2`.
      sv_w: [
        ["%5", "usize 2"],
        ["%0 = unchecked_sumul(%len, usize 2)", "%1 = add(usize 2, %0)", "%2 = sub(usize 2, usize 1)", "%3 = add(%1, %2)", "%4 = neg(usize 2)", "%5 = and(%3, %4)"],
      ],
      // `#[repr(packed(2))] PK { a: u8, s: [u32] }`: the tail at offset 2, sized align 2; packed to 2, not 1, so
      // `min(4, 2)` by `icmp ult` + `select` (:123); that is not a constant, so `full_align` is `icmp ugt` + `select` (:141).
      sv_pk: [
        ["%9", "%4"],
        [
          "%0 = unchecked_sumul(%len, usize 4)",
          "%1 = icmp(IntULT, usize 4, usize 2)",
          "%2 = select(%1, usize 4, usize 2)",
          "%3 = icmp(IntUGT, usize 2, %2)",
          "%4 = select(%3, usize 2, %2)",
          "%5 = add(usize 2, %0)",
          "%6 = sub(%4, usize 1)",
          "%7 = add(%5, %6)",
          "%8 = neg(%4)",
          "%9 = and(%7, %8)",
        ],
      ],
      // retag.rs flags: IS_PROTECTED 1, IS_MUTABLE 2, IS_BOX 4, IS_FREEZE 8 (lib.rs `RetagFlags`).
      // `&u32`: freeze, not mutable, no ranges (null pointers, :276); a fn-entry retag is also protected (:208).
      rp_ref: [[`retag_mem(%p, {size4, flags=8, im=${n}, pin=${n}})`], []],
      rp_ref_entry: [[`retag_mem(%p, {size4, flags=9, im=${n}, pin=${n}})`], []],
      // `&mut u32` at fn entry: mutable and `Unpin`, so protected: 1 | 2 | 8.
      rp_mut_entry: [[`retag_mem(%p, {size4, flags=11, im=${n}, pin=${n}})`], []],
      // `&(u32, Cell<u32>)`: not `Freeze`; the `UnsafeCell` range is (4, 4) (:343-351), not the whole 8 bytes, so it is a
      // global array of native-endian `u64` pairs (:280), `static_addr_of(.., None)`.
      rp_cell_pair: [["%0 = static_addr_of(alloc0, None)", `retag_mem(%p, {size8, flags=0, im=%0, pin=${n}})`], ["4 0 0 0 0 0 0 0 4 0 0 0 0 0 0 0"]],
      // `&Cell<u32>`: the range covers the whole pointee, so no array (:245).
      rp_cell: [[`retag_mem(%p, {size4, flags=0, im=${n}, pin=${n}})`], []],
      // `(&u32, &mut u8)`: fields in memory order (:106); the second at offset 8 (`inbounds_ptradd`); `&mut u8` is 2 | 8.
      rp_refs: [[`retag_mem(%t, {size4, flags=8, im=${n}, pin=${n}})`, "%0 = inbounds_ptradd(%t, usize 8)", `retag_mem(%0, {size1, flags=10, im=${n}, pin=${n}})`], []],
      rp_array: [loop_a, []],
      // `u8`: smaller than a pointer, no plan (:77).
      rp_u8: [[], []],
      // `Option<&u32>`: a variant plan (:125); the place is loaded and its discriminant read, and
      // `codegen_get_discr`'s `extract_field` of the niche reaches rvalue.rs's stub (ssa-rvalue-intrinsic).
      // (root at integ-w54) The `Option<&u32>` place: loaded, `codegen_get_discr` as for `ro_option` below, then the
      // `retag_variant` block retags the place in memory and the entry block `switch`es to it.
      rp_option: [
        [
          "load_operand(%o, std::option::Option<&u32>)",
          "%0 = val_ty(load(%o))",
          "%1 = type_kind(%0)",
          "%2 = type_from_integer(I64)",
          "%3 = ptrtoint(load(%o), %2)",
          "%4 = icmp(IntEQ, %3, %2 0)",
          "%5 = select(%4, ity:isize 0, ity:isize 1)",
          "%6 = llbb()",
          "%7 = append_sibling_block(retag_join)",
          "%8 = append_sibling_block(retag_variant)",
          "%9 = switch_to_block(%8)",
          `retag_mem(%o, {size4, flags=8, im=${n}, pin=${n}})`,
          "%10 = br(%7)",
          "%11 = switch_to_block(%6)",
          "%12 = switch(%5, %7, [[1, %8]])",
          "%13 = switch_to_block(%7)",
        ],
        [],
      ],
      // Operands (:399): an immediate reference is `retag_reg`'d and the builder rebuilds the immediate (:437-440).
      ro_ref: ["Immediate(%0)", [`%0 = retag_reg(%r, {size4, flags=8, im=${n}, pin=${n}})`]],
      // A scalar pair: each field extracted and retagged, `update_imm` at offsets 0 and 8.
      ro_refs: ["Pair(%0, %1)", [`%0 = retag_reg(%a, {size4, flags=8, im=${n}, pin=${n}})`, `%1 = retag_reg(%b, {size1, flags=10, im=${n}, pin=${n}})`]],
      // A `Ref` operand is retagged as its place (:405) and returned unchanged.
      ro_array_ref: ["Ref(PlaceValue { llval: %a, llextra: None, align: Align(8 bytes) })", loop_a],
      // An `Option<&u32>` immediate (root at integ-w54: rvalue.rs `codegen_transmute_operand` is ported, so these run on).
      // `codegen_get_discr` (place.rs, :481) reads the niche: `ptrtoint` to `i64`, `icmp eq 0`, `select` of the
      // discriminant. Not a constant: the operand is spilled to an `alloca` (:483-486), `retag_join` / `retag_variant`
      // blocks are appended, the `Some` variant's place is retagged in `retag_variant` (`br` to the join), the entry block
      // `switch`es on the discriminant, and the join block reloads the operand and ends the spill's lifetime.
      ro_option: [
        "Immediate(load(%6))",
        [
          "%0 = val_ty(%o)",
          "%1 = type_kind(%0)",
          "%2 = type_from_integer(I64)",
          "%3 = ptrtoint(%o, %2)",
          "%4 = icmp(IntEQ, %3, %2 0)",
          "%5 = select(%4, ity:isize 0, ity:isize 1)",
          "%6 = alloca(size8, align8)",
          "%7 = lifetime_start(%6, size8)",
          "%8 = from_immediate(%o)",
          "%9 = store_with_flags(%8, %6, align8, 0)",
          "%10 = llbb()",
          "%11 = append_sibling_block(retag_join)",
          "%12 = append_sibling_block(retag_variant)",
          "%13 = switch_to_block(%12)",
          `retag_mem(%6, {size4, flags=8, im=${n}, pin=${n}})`,
          "%14 = br(%11)",
          "%15 = switch_to_block(%10)",
          "%16 = switch(%5, %11, [[1, %12]])",
          "%17 = switch_to_block(%11)",
          "load_operand(%6, std::option::Option<&u32>)",
          "%18 = lifetime_end(%6, size8)",
        ],
      ],
      // A constant discriminant (`const_to_opt_u128` gives 1, `Some`): no blocks; the variant's field is retagged as a
      // register (`retag_reg`) and the immediate rebuilt.
      ro_option_const: JSON.stringify([
        "Immediate(%8)",
        [
          "%0 = val_ty(%o)",
          "%1 = type_kind(%0)",
          "%2 = type_from_integer(I64)",
          "%3 = ptrtoint(%o, %2)",
          "%4 = icmp(IntEQ, %3, %2 0)",
          "%5 = select(%4, ity:isize 0, ity:isize 1)",
          "%6 = val_ty(%o)",
          "%7 = type_kind(%6)",
          `%8 = retag_reg(%o, {size4, flags=8, im=${n}, pin=${n}})`,
        ],
      ]),
    });
    // The typeid is the port's v0 `typeid_for_trait_ref` of `Tr` (not this lane's code), in UTF-8.
    expect(vfe_typeid).toMatch(/mir_rest2Tr$/);
    // mono_item.rs:57 predefine: `predefine_fn` / `predefine_static` with the item's symbol name; a naked fn is not
    // predefined (:77). :29 define: a static is `codegen_static`; a fn and a naked fn go to base.rs / naked_asm.rs (recorded
    // through `mono_item_xlane`), global asm to base.rs. :89 to_raw_string of a static; of a fn it stops.
    expect(mono_item.slice(0, 6)).toEqual([
      [`predefine_fn(g, External, Hidden, ${sym_g})`, `predefine_static(S, Internal, Default, ${sym_s})`],
      [sym_g, sym_s],
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(mono_item[6]).toMatch(/^Static\(DefId\(0:\d+ ~ mir_rest\[[0-9a-f]{4}\]::S\)\)$/);
    expect(mono_item.slice(7)).toEqual([
      "THROW unported: rustc_codegen_ssa::mono_item::to_raw_string: the address of an interned `GenericArgs` list",
      ["codegen_static(S)", "codegen_instance(g)", "codegen_naked_asm(nk)", "codegen_global_asm"],
    ]);
  });
});

test("retag.rs:26 rvalue_needs_retag", () => {
  const op = { $: "Copy", _0: undefined } as unknown as Operand;
  // `Ref` retags internally; `Use(.., WithRetag::No)` asks for none; everything else is retagged.
  expect(rvalue_needs_retag({ $: "Ref" } as unknown as Rvalue)).toBe(false);
  expect(rvalue_needs_retag({ $: "Use", _0: op, _1: "No" })).toBe(false);
  expect(rvalue_needs_retag({ $: "Use", _0: op, _1: "Yes" })).toBe(true);
  expect(rvalue_needs_retag({ $: "Repeat" } as unknown as Rvalue)).toBe(true);
  expect(rvalue_needs_retag({ $: "RawPtr" } as unknown as Rvalue)).toBe(true);
});

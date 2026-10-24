// Lane interp-memory: interpret/memory.rs on hand-built `Memory` states (upstream has no unit tests for it). Expected
// values are worked out from the upstream code at the pin: allocation and the alloc-info table, scalar reads and writes
// with provenance through `AllocRef(Mut)`, `mem_copy(_repeatedly)` with init masks and provenance, bounds / dangling /
// use-after-free / alignment errors, deallocation, global root pointers and global allocations, function pointers,
// leak collection, ghost mode and `DumpAllocs`.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import {
  type AllocId,
  Allocation,
  alloc_range,
  CtfeProvenance,
  display_InterpErrorKind,
  type InterpErrorKind,
  type InterpResult,
  Pointer,
  Pointer_from_AllocId,
  Pointer_Option_from_Pointer,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { DummyMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import { type AllocRef, type AllocRefMut, debug_DumpAllocs, type MemoryKind } from "./memory.ts";
import type { CtfeMemoryKind } from "./machine.ts";

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
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
  "pub const C: u8 = 7;",
].join("\n");

/** `DummyMachine` with the two hooks of lane ctfe-a's stubs these tests reach given upstream's values for a machine that
 * checks alignment and reads globals: `enforce_alignment` (configurable) and `before_access_global` (the provided no-op). */
class TestMachine extends DummyMachine {
  constructor(public align: boolean) {
    super();
  }
  override enforce_alignment(): boolean {
    return this.align;
  }
  override before_access_global(): InterpResult {
    return { $: "Ok", _0: undefined };
  }
}

const STACK: MemoryKind<CtfeMemoryKind> = { $: "Stack" };
const CALLER: MemoryKind<CtfeMemoryKind> = { $: "CallerLocation" };
const S = (n: number): Size => Size.from_bytes(n);
const A = (n: number): Align => {
  const r = Align.from_bytes(n);
  if (r.$ === "Err") throw new Error("ERROR: align");
  return r._0;
};
const opt = (p: Pointer): Pointer<CtfeProvenance | undefined> => Pointer_Option_from_Pointer(p);
const at = (p: Pointer, off: number): Pointer<CtfeProvenance | undefined> => opt(Pointer.new(p.provenance, S(off)));
const id_of = (p: Pointer): AllocId => CtfeProvenance.alloc_id(p.provenance);
function ok<T>(r: InterpResult<T>): T {
  if (r.$ === "Err") throw new Error(`ERROR: unexpected interp error: ${display_InterpErrorKind(r._0._0.kind)}`);
  return r._0;
}
function err(r: InterpResult<unknown>): InterpErrorKind {
  if (r.$ === "Ok") throw new Error("ERROR: expected an interp error");
  return r._0._0.kind;
}
function panics(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  throw new Error("ERROR: expected a panic");
}
const int = (v: number, size: number): Scalar => ({ $: "Int", _0: ScalarInt.try_from_uint(BigInt(v), S(size))! });

function with_ecx(f: (ecx: InterpCx, tcx: TyCtxt, machine: TestMachine) => void): void {
  const file = join(DATA, "tmp", "interp-memory", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "interp_memory.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const machine = new TestMachine(false);
      const ecx = InterpCx.new(tcx, DUMMY_SP, TypingEnv.fully_monomorphized(), machine) as unknown as InterpCx;
      f(ecx, tcx, machine);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

test("interp-memory: hand-built memory states against upstream semantics", () => {
  with_ecx((ecx, tcx, machine) => {
    const ptr_size = tcx.data_layout().pointer_size().bytes();
    expect(ptr_size).toBe(8);

    // ---- allocate_ptr / insert_allocation / get_alloc_info ----
    const a = ok(ecx.allocate_ptr(S(8), A(4), STACK, "Uninit"));
    expect(a.offset.bytes()).toBe(0);
    const a_id = id_of(a);
    expect(ecx.is_alloc_live(a_id)).toBe(true);
    const info = ecx.get_alloc_info(a_id);
    expect([info.size.bytes(), info.align.bytes(), info.kind, info.mutbl]).toEqual([8, 4, "LiveData", "Mut"]);
    expect(ecx.memory.alloc_map.get(a_id)![0]).toEqual(STACK);
    // a zero-sized access is `None` (no allocation lookup)
    expect(ok(ecx.get_ptr_alloc(opt(a), S(0)))).toBeUndefined();

    // ---- write / read scalars through AllocRefMut / AllocRef ----
    const wa = ok(ecx.get_ptr_alloc_mut(at(a, 2), S(4))) as AllocRefMut;
    expect(wa.range.start.bytes()).toBe(2);
    ok(wa.write_scalar(alloc_range(S(0), S(2)), int(0xbeef, 2)));
    // little-endian bytes at 2..4; 0..2 and 4..8 stay uninit
    expect([...ecx.memory.alloc_map.get(a_id)![1].get_bytes_unchecked(alloc_range(S(2), S(2)))]).toEqual([0xef, 0xbe]);
    const ra = ok(ecx.get_ptr_alloc(at(a, 2), S(2))) as AllocRef;
    expect(ok(ra.read_integer(alloc_range(S(0), S(2))))).toEqual(int(0xbeef, 2));
    // reading uninit bytes: InvalidUninitBytes with the alloc id
    const ra8 = ok(ecx.get_ptr_alloc(opt(a), S(8))) as AllocRef;
    const e1 = err(ra8.read_integer(alloc_range(S(0), S(4))));
    expect(e1.$).toBe("UndefinedBehavior");
    expect(e1.$ === "UndefinedBehavior" && e1._0.$ === "InvalidUninitBytes" && e1._0._0?.[0]).toBe(a_id);
    expect(ok(ecx.read_bytes_ptr_strip_provenance(at(a, 2), S(2)))).toEqual(Uint8Array.from([0xef, 0xbe]));
    expect(ok(ecx.read_bytes_ptr_strip_provenance(at(a, 7), S(0)))).toEqual(new Uint8Array(0));

    // ---- pointers: provenance is stored and read back ----
    const b = ok(ecx.allocate_ptr(S(16), A(8), STACK, "Zero"));
    const b_id = id_of(b);
    expect(b_id).not.toBe(a_id);
    const wb = ok(ecx.get_ptr_alloc_mut(opt(b), S(16))) as AllocRefMut;
    ok(wb.write_ptr_sized(S(8), Scalar.from_pointer(Pointer.new(a.provenance, S(3)), tcx)));
    const rb = wb.as_ref();
    expect(rb.has_provenance()).toBe(true);
    const p = ok(rb.read_pointer(S(8)));
    expect(p.$).toBe("Ptr");
    if (p.$ === "Ptr") {
      expect(id_of(p._0)).toBe(a_id);
      expect(p._0.offset.bytes()).toBe(3);
    }
    // reading a pointer as an integer is unsupported
    const e2 = err(rb.read_integer(alloc_range(S(8), S(8))));
    expect(e2.$ === "Unsupported" && e2._0.$).toBe("ReadPointerAsInt");
    expect(ok(ecx.has_provenance_in_alloc(b_id))).toBe(true);
    expect(ok(ecx.has_provenance_in_alloc(a_id))).toBe(false);
    // write_bytes_ptr / read_bytes_ptr_strip_provenance
    ok(ecx.write_bytes_ptr(opt(b), [1, 2, 3, 4][Symbol.iterator]()));
    expect(ok(ecx.read_bytes_ptr_strip_provenance(opt(b), S(6)))).toEqual(Uint8Array.from([1, 2, 3, 4, 0, 0]));
    const e3 = err(ecx.read_bytes_ptr_strip_provenance(at(b, 4), S(8)));
    expect(e3.$ === "Unsupported" && e3._0.$).toBe("ReadPointerAsInt");

    // ---- mem_copy: bytes, init mask and provenance ----
    const c = ok(ecx.allocate_ptr(S(16), A(8), STACK, "Uninit"));
    const c_id = id_of(c);
    ok(ecx.mem_copy(opt(b), opt(c), S(16), true));
    const c_alloc = ecx.memory.alloc_map.get(c_id)![1];
    expect([...c_alloc.get_bytes_unchecked(alloc_range(S(0), S(8)))]).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
    const pc = ok((ok(ecx.get_ptr_alloc(at(c, 8), S(8))) as AllocRef).read_pointer(S(0)));
    expect(pc.$ === "Ptr" && id_of(pc._0)).toBe(a_id);
    // copying uninit bytes de-initializes the destination (fast path: everything uninit)
    ok(ecx.mem_copy(opt(a), opt(c), S(2), true));
    expect(err((ok(ecx.get_ptr_alloc(opt(c), S(2))) as AllocRef).read_integer(alloc_range(S(0), S(1)))).$).toBe("UndefinedBehavior");
    // a partially-init source keeps its mask: a[2..4] init, a[0..2] uninit
    ok(ecx.mem_copy(opt(a), opt(c), S(4), true));
    expect(ok((ok(ecx.get_ptr_alloc(at(c, 2), S(2))) as AllocRef).read_integer(alloc_range(S(0), S(2))))).toEqual(int(0xbeef, 2));
    expect(err((ok(ecx.get_ptr_alloc(opt(c), S(2))) as AllocRef).read_integer(alloc_range(S(0), S(2)))).$).toBe("UndefinedBehavior");
    // overlapping ranges in one allocation
    const e4 = err(ecx.mem_copy(opt(b), at(b, 2), S(4), true));
    expect(e4.$ === "UndefinedBehavior" && e4._0.$ === "Ub" && e4._0._0).toBe("`copy_nonoverlapping` called on overlapping ranges");
    ok(ecx.mem_copy(opt(b), at(b, 2), S(4), false)); // memmove: 1 2 3 4 0 0 -> 1 2 1 2 3 4
    expect(ok(ecx.read_bytes_ptr_strip_provenance(opt(b), S(6)))).toEqual(Uint8Array.from([1, 2, 1, 2, 3, 4]));
    // mem_copy_repeatedly: a 1-byte memset and a 2-byte pattern
    const d = ok(ecx.allocate_ptr(S(6), A(1), STACK, "Uninit"));
    ok(ecx.mem_copy_repeatedly(at(b, 5), opt(d), S(1), 6n, true));
    expect(ok(ecx.read_bytes_ptr_strip_provenance(opt(d), S(6)))).toEqual(Uint8Array.from([4, 4, 4, 4, 4, 4]));
    ok(ecx.mem_copy_repeatedly(opt(b), opt(d), S(2), 3n, true));
    expect(ok(ecx.read_bytes_ptr_strip_provenance(opt(d), S(6)))).toEqual(Uint8Array.from([1, 2, 1, 2, 1, 2]));
    // a pointer copied three times carries its provenance at each copy
    const e = ok(ecx.allocate_ptr(S(24), A(8), STACK, "Uninit"));
    ok(ecx.mem_copy_repeatedly(at(b, 8), opt(e), S(8), 3n, true));
    for (const off of [0, 8, 16]) {
      const pe = ok((ok(ecx.get_ptr_alloc(at(e, off), S(8))) as AllocRef).read_pointer(S(0)));
      expect(pe.$ === "Ptr" && id_of(pe._0)).toBe(a_id);
    }

    // ---- bounds, dangling pointers, alignment ----
    const e5 = err(ecx.get_ptr_alloc(at(a, 6), S(4)));
    expect(e5).toEqual({ $: "UndefinedBehavior", _0: { $: "PointerOutOfBounds", alloc_id: a_id, alloc_size: S(8), ptr_offset: 6, inbounds_size: 4, msg: { $: "MemoryAccess" } } });
    expect(ok(ecx.check_ptr_access_signed(at(a, 6), -6n, { $: "InboundsPointerArithmetic" }))).toBeUndefined();
    const e6 = err(ecx.check_ptr_access_signed(at(a, 2), -3n, { $: "InboundsPointerArithmetic" }));
    expect(e6.$ === "UndefinedBehavior" && e6._0.$ === "PointerOutOfBounds" && [e6._0.ptr_offset, e6._0.inbounds_size]).toEqual([2, -3]);
    const e7 = err(ecx.get_ptr_alloc(Pointer.without_provenance<CtfeProvenance>(16n), S(4)));
    expect(e7).toEqual({ $: "UndefinedBehavior", _0: { $: "DanglingIntPointer", addr: 16, inbounds_size: 4, msg: { $: "MemoryAccess" } } });
    expect(display_InterpErrorKind(err(ecx.ptr_get_alloc_id(Pointer.without_provenance<CtfeProvenance>(0n), 0n)))).toBe(
      "pointer not dereferenceable: pointer must point to some allocation, but got null pointer",
    );
    expect(ecx.is_ptr_misaligned(at(a, 2), A(4))).toBeUndefined(); // enforce_alignment is off
    machine.align = true;
    expect(ecx.is_ptr_misaligned(at(a, 2), A(4))).toEqual({ has: A(2), required: A(4) });
    expect(ecx.is_ptr_misaligned(at(a, 4), A(8))).toEqual({ has: A(4), required: A(8) }); // the allocation's alignment
    expect(ecx.is_ptr_misaligned(at(a, 4), A(4))).toBeUndefined();
    expect(ecx.is_ptr_misaligned(Pointer.without_provenance<CtfeProvenance>(12n), A(8))).toEqual({ has: A(4), required: A(8) });
    expect(err(ecx.check_ptr_align(at(a, 1), A(2)))).toEqual({ $: "UndefinedBehavior", _0: { $: "AlignmentCheckFailed", _0: { has: A(1), required: A(2) }, _1: "AccessedPtr" } });
    machine.align = false;

    // ---- scalar_may_be_null ----
    expect(ok(ecx.scalar_may_be_null(int(0, 8)))).toBe(true);
    expect(ok(ecx.scalar_may_be_null(int(5, 8)))).toBe(false);
    expect(ok(ecx.scalar_may_be_null(Scalar.from_pointer(Pointer.new(a.provenance, S(8)), tcx)))).toBe(false);
    expect(ok(ecx.scalar_may_be_null(Scalar.from_pointer(Pointer.new(a.provenance, S(10)), tcx)))).toBe(false); // 10 % 4 != 0
    expect(ok(ecx.scalar_may_be_null(Scalar.from_pointer(Pointer.new(a.provenance, S(12)), tcx)))).toBe(true);

    // ---- reallocate / deallocate ----
    const r = ok(ecx.reallocate_ptr(opt(b), undefined, S(20), A(8), STACK, "Zero"));
    expect(ecx.get_alloc_info(b_id).kind).toBe("Dead");
    expect(ecx.get_alloc_info(b_id).size.bytes()).toBe(16);
    expect(ok(ecx.read_bytes_ptr_strip_provenance(opt(r), S(6)))).toEqual(Uint8Array.from([1, 2, 1, 2, 3, 4]));
    expect(ok(ecx.read_bytes_ptr_strip_provenance(at(r, 16), S(4)))).toEqual(Uint8Array.from([0, 0, 0, 0]));
    expect(err(ecx.get_ptr_alloc(opt(b), S(1)))).toEqual({ $: "UndefinedBehavior", _0: { $: "PointerUseAfterFree", _0: b_id, _1: { $: "MemoryAccess" } } });
    expect(err(ecx.deallocate_ptr(opt(b), undefined, STACK))).toEqual({ $: "UndefinedBehavior", _0: { $: "PointerUseAfterFree", _0: b_id, _1: { $: "MemoryAccess" } } });
    expect(display_InterpErrorKind(err(ecx.deallocate_ptr(at(c, 1), undefined, STACK)))).toBe(`deallocating alloc${c_id}+0x1 which does not point to the beginning of an object`);
    expect(display_InterpErrorKind(err(ecx.deallocate_ptr(opt(c), undefined, CALLER)))).toBe(
      `deallocating alloc${c_id}, which is stack variable memory, using caller location deallocation operation`,
    );
    const d_id = id_of(d);
    expect(display_InterpErrorKind(err(ecx.deallocate_ptr(opt(d), [S(4), A(1)], STACK)))).toBe(
      `incorrect layout on deallocation: alloc${d_id} has size 6 and alignment 1, but gave size 4 and alignment 1`,
    );
    expect(ecx.memory.alloc_map.get(d_id)).toBeUndefined(); // removed before the layout check, as upstream

    // ---- global allocations, root pointers, function pointers ----
    const g_alloc = Allocation.from_bytes(Uint8Array.from([9, 8, 7]), A(1), "Not", null);
    const g_id = tcx.reserve_and_set_memory_alloc(tcx.mk_const_alloc(g_alloc));
    const g = ok(ecx.global_root_pointer(Pointer_from_AllocId(g_id)));
    expect(id_of(g)).toBe(g_id);
    const g_info = ecx.get_alloc_info(g_id);
    expect([g_info.size.bytes(), g_info.align.bytes(), g_info.kind, g_info.mutbl]).toEqual([3, 1, "LiveData", "Not"]);
    const g_global = tcx.global_alloc(g_id);
    if (g_global.$ !== "Memory") throw new Error("ERROR: not a memory alloc");
    expect(ok(ecx.get_alloc_raw(g_id))).toBe(g_global._0.inner()); // the interned allocation itself (`Cow::Borrowed`)
    expect(ecx.memory.alloc_map.get(g_id)).toBeUndefined(); // reads do not copy globals into the local map
    expect(ok(ecx.read_bytes_ptr_strip_provenance(opt(g), S(3)))).toEqual(Uint8Array.from([9, 8, 7]));
    expect(ok(ecx.get_alloc_mutability(g_id))).toBe("Not");
    // writing to a global with `GLOBAL_KIND = None` is a bug in the machine (the panic of `expect`)
    expect(panics(() => ecx.get_ptr_alloc_mut(opt(g), S(1)))).toBe("I got a global allocation that I have to copy but the machine does not expect that to happen");
    expect(display_InterpErrorKind(err(ecx.deallocate_ptr(opt(g), undefined, STACK)))).toBe(`deallocating alloc${g_id}, which is static memory`);
    // a global id that is neither global, va_list nor fn ptr
    const fresh = tcx.reserve_alloc_id();
    expect(panics(() => ecx.global_root_pointer(Pointer_from_AllocId(fresh)))).toBe(`alloc${fresh} is neither global, va_list nor a function pointer`);
    // function pointers
    let c_def: LocalDefId | undefined;
    for (const id of tcx.hir_free_items()) {
      const item = tcx.hir_item(id);
      if (item.kind.$ === "Const") c_def = item.owner_id.def_id;
    }
    const inst = Instance.mono(tcx, LocalDefId.to_def_id(c_def!));
    const f = ecx.fn_ptr({ $: "Instance", _0: inst });
    const f_id = id_of(f);
    expect(ecx.get_alloc_info(f_id).kind).toBe("Function");
    expect(ecx.get_alloc_info(f_id).size.bytes()).toBe(0);
    expect(ok(ecx.get_ptr_fn(opt(f)))).toEqual({ $: "Instance", _0: inst });
    expect(err(ecx.get_ptr_fn(at(f, 1))).$).toBe("UndefinedBehavior");
    expect(err(ecx.get_ptr_fn(opt(a))).$).toBe("UndefinedBehavior");
    expect(err(ecx.get_alloc_raw(f_id))).toEqual({ $: "UndefinedBehavior", _0: { $: "DerefFunctionPointer", _0: f_id } });
    expect(display_InterpErrorKind(err(ecx.deallocate_ptr(opt(f), undefined, STACK)))).toBe(`deallocating alloc${f_id}, which is a function`);

    // ---- reachability, leaks, ghost mode, dumps ----
    const x = ok(ecx.allocate_ptr(S(8), A(8), STACK, "Zero"));
    const y = ok(ecx.allocate_ptr(S(8), A(8), STACK, "Zero"));
    const z = ok(ecx.allocate_ptr(S(1), A(1), CALLER, "Zero"));
    ok((ok(ecx.get_ptr_alloc_mut(opt(y), S(8))) as AllocRefMut).write_ptr_sized(S(0), Scalar.from_pointer(x, tcx)));
    const seen: AllocId[] = [];
    ok(ecx.visit_reachable_allocs([id_of(y)], (_ecx, id, i) => {
      seen.push(id);
      expect(i.kind).toBe("LiveData");
      return { $: "Ok", _0: undefined };
    }));
    expect(seen).toEqual([id_of(y), id_of(x)]);
    // `a`, `r`, `e` (stack) leak; `x` is reachable from the root `y`; `z` (caller location) may leak. The map is an
    // `FxIndexMap` whose `remove` is `swap_remove`: freeing `b` moved `r` into its slot; the failed deallocations of `c`
    // (wrong kind) and `d` (wrong layout) removed them anyway (upstream removes first), `e` moving into `c`'s slot.
    expect(ecx.memory.alloc_map.filter_map_collect((id) => id)).toEqual([a_id, id_of(r), id_of(e), id_of(x), id_of(y), id_of(z)]);
    const leaked = ecx.take_leaked_allocations(() => [id_of(y)]);
    expect(leaked.map(([id, kind]) => [id, kind.$])).toEqual([a_id, id_of(r), id_of(e)].map((id) => [id, "Stack"]));
    expect(ecx.memory.alloc_map.filter_map_collect((id) => id)).toEqual([id_of(z), id_of(y), id_of(x)]);
    // ghost mode cannot be nested
    expect(ecx.validation_in_progress()).toBe(false);
    expect(ecx.ghost_run((ecx2) => ecx2.validation_in_progress())).toBe(true);
    expect(panics(() => ecx.ghost_run_mut((ecx2) => ecx2.ghost_run(() => 0)))).toBe("`ghost_mode` was already set");
    ecx.memory.ghost_mode = false;
    // DumpAllocs: sorted, deduplicated, following provenance
    const dump = debug_DumpAllocs(ecx.dump_allocs([id_of(y), id_of(y)]), PLAIN);
    expect(dump.split("\n")[0]).toBe(`alloc${id_of(y)} (stack variable, size: 8, align: 8) {`);
    expect(dump).toContain(`\nalloc${id_of(x)} (stack variable, size: 8, align: 8) {\n`);
    expect(debug_DumpAllocs(ecx.dump_alloc(g_id), PLAIN)).toBe(`alloc${g_id} (unchanged global, size: 3, align: 1) {\n    09 08 07                                        │ ...\n}\n`);
    expect(ecx.print_alloc_bytes_for_diagnostics(g_id)).toBe("\n    09 08 07                                        │ ...\n");
    // mark immutable, then deallocation is UB
    ok(ecx.alloc_mark_immutable(id_of(x)));
    expect(display_InterpErrorKind(err(ecx.deallocate_ptr(opt(x), undefined, STACK)))).toBe(`deallocating immutable allocation alloc${id_of(x)}`);
    ok(ecx.deallocate_ptr(opt(y), undefined, STACK));
    ecx.remove_unreachable_allocs(new Set([b_id]));
    expect([...ecx.memory.dead_alloc_map.keys()]).toEqual([b_id]);
  });
}, 120_000);

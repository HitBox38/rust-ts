// Lane interp-generic (plan-m6 D3 / A1): the interpreter's dispatch through a second machine's associated types.
// Not a port (upstream has no such test). Two stand-ins:
// - `TestProv`, an object-valued `Provenance` with `OFFSET_IS_ADDR = true` and a wildcard (the shape of Miri's
//   `Provenance::Concrete { .. } | Wildcard`), on rustc_middle's `Allocation` / `ProvenanceMap` / `Pointer`;
// - `AddrMachine`, a `DummyMachine` whose `M::Provenance` impl says `OFFSET_IS_ADDR = true` (values stay CTFE's), on
//   the interpreter: `is_ptr_misaligned`, `ptr_try_get_alloc_id`, `ptr_offset_from`.
// Each check runs the CTFE impl too, which takes upstream's `false` arm, so the two outcomes differ. Expected values are
// worked out from the upstream code at the pin.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Align, Size, TargetDataLayout } from "../../rustc_abi/lib.ts";
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
  type ObjectProvenance,
  Pointer,
  Pointer_Option_from_Pointer,
  type Provenance,
  Provenance_CtfeProvenance,
  provenance_eq,
  provenance_of,
  register_object_provenance,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { Fmt } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { DummyMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import type { CtfeMemoryKind } from "./machine.ts";
import type { MemoryKind } from "./memory.ts";
import { ImmTy, OpTy_from_ImmTy } from "./operand.ts";
import { PlaceTy_from_MPlaceTy } from "./place.ts";

function panics(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  throw new Error("ERROR: expected a panic");
}
const S = (n: number): Size => Size.from_bytes(n);
const A = (n: number): Align => unwrap_result(Align.from_bytes(n), () => "align");

// ---- an object-valued provenance with `OFFSET_IS_ADDR = true` ----

interface TestProv {
  readonly test_prov: true;
  readonly alloc_id: AllocId | undefined; // `undefined`: the wildcard
}
const WILDCARD: TestProv = Object.freeze({ test_prov: true, alloc_id: undefined });
const Provenance_TestProv: ObjectProvenance<TestProv> = {
  OFFSET_IS_ADDR: true,
  WILDCARD,
  fmt: (ptr: Pointer<TestProv>, _f: Fmt) => `T(${ptr.provenance.alloc_id ?? "*"})+${ptr.offset.bytes()}`,
  get_alloc_id: (p) => p.alloc_id,
  eq: (a, b) => a.alloc_id === b.alloc_id,
  debug: (p) => `T(${p.alloc_id ?? "*"})`,
  owns: (p) => (p as Partial<TestProv>).test_prov === true,
};
register_object_provenance(Provenance_TestProv);
const tp = (id: number): TestProv => ({ test_prov: true, alloc_id: id as AllocId });

const dl = TargetDataLayout.default();
dl.endian = "Little";
const cx = { data_layout: () => dl };

test("interp-generic: object provenance dispatch (provenance_of, PartialEq, Debug, Pointer::addr)", () => {
  expect(provenance_of(tp(3))).toBe(Provenance_TestProv as unknown as Provenance<TestProv>);
  expect(provenance_of(5n as CtfeProvenance)).toBe(Provenance_CtfeProvenance);
  // `==` is the impl's `PartialEq` for distinct but equal values (identity for CTFE's bigints)
  expect(provenance_eq(tp(3), tp(3))).toBe(true);
  expect(provenance_eq(tp(3), tp(4))).toBe(false);
  expect(provenance_eq(5n as CtfeProvenance, 5n as CtfeProvenance)).toBe(true);
  // `Pointer<Option<Prov>>::addr` (pointer.rs:305): `assert!(Prov::OFFSET_IS_ADDR)`
  const no_prov = Pointer.without_provenance<TestProv>(0x40n);
  expect(no_prov.addr(Provenance_TestProv).bytes()).toBe(0x40);
  expect(panics(() => Pointer.without_provenance<CtfeProvenance>(0x40n).addr(Provenance_CtfeProvenance))).toBe("assertion failed: Prov::OFFSET_IS_ADDR");
  // `impl Debug for Pointer<Option<Prov>>` prints through `Provenance::fmt`
  expect(`${Pointer.new(tp(7), S(2)).provenance.alloc_id}`).toBe("7");
});

test("interp-generic: Allocation / ProvenanceMap take the OFFSET_IS_ADDR = true arms", () => {
  // An allocation of 16 bytes holding a pointer (provenance `p`, address 0x1234) at offset 0.
  function alloc_with_ptr<P>(p: P): Allocation<P> {
    const a = Allocation.new<P>(S(16), A(8), "Zero", null);
    const w = a.write_scalar(cx, alloc_range(S(0), S(8)), Scalar.from_pointer(Pointer.new(p, S(0x1234)), cx));
    expect(w.$).toBe("Ok");
    return a;
  }
  const t = alloc_with_ptr(tp(9));
  const c = alloc_with_ptr(9n as CtfeProvenance);

  // read_scalar without provenance (allocation.rs:719): `Prov::OFFSET_IS_ADDR` strips the provenance
  expect(t.read_scalar(cx, alloc_range(S(0), S(8)), false, Provenance_TestProv)).toEqual({ $: "Ok", _0: Scalar.from_uint<TestProv>(0x1234n, S(8)) });
  expect(c.read_scalar(cx, alloc_range(S(0), S(8)), false, Provenance_CtfeProvenance)).toEqual({ $: "Err", _0: { $: "ReadPointerAsInt", _0: undefined } });

  // get_bytes_strip_provenance (allocation.rs:597): no `ReadPointerAsInt` with `OFFSET_IS_ADDR`
  const tb = t.get_bytes_strip_provenance(cx, alloc_range(S(0), S(4)), Provenance_TestProv);
  expect(tb.$ === "Ok" ? [...tb._0] : tb).toEqual([0x34, 0x12, 0, 0]);
  expect(c.get_bytes_strip_provenance(cx, alloc_range(S(0), S(4)), Provenance_CtfeProvenance).$).toBe("Err");

  // get_bytes_unchecked_raw(_mut) (allocation.rs:653 / :661): `assert!(Prov::OFFSET_IS_ADDR)`
  expect(t.get_bytes_unchecked_raw(Provenance_TestProv).length).toBe(16);
  expect(t.get_bytes_unchecked_raw_mut(Provenance_TestProv).length).toBe(16);
  expect(panics(() => c.get_bytes_unchecked_raw(Provenance_CtfeProvenance))).toBe("assertion failed: Prov::OFFSET_IS_ADDR");

  // A pointer-sized read across the pointer's end (offset 4): per-byte provenance that does not add up
  // (provenance_map.rs:239): with `OFFSET_IS_ADDR` it is no provenance, without it `ReadPartialPointer`.
  const tr = t.read_scalar(cx, alloc_range(S(4), S(8)), true, Provenance_TestProv);
  expect(tr).toEqual({ $: "Ok", _0: Scalar.from_uint<TestProv>(0n, S(8)) });
  expect(c.read_scalar(cx, alloc_range(S(4), S(8)), true, Provenance_CtfeProvenance)).toEqual({ $: "Err", _0: { $: "ReadPartialPointer", _0: S(4) } });

  // process_native_write / write_wildcards (allocation.rs:779, provenance_map.rs:354): wildcard bytes read back as a
  // pointer with `Prov::WILDCARD` (provenance_map.rs:237).
  t.process_native_write(cx, alloc_range(S(8), S(8)), Provenance_TestProv);
  const tw = t.read_scalar(cx, alloc_range(S(8), S(8)), true, Provenance_TestProv);
  expect(tw.$ === "Ok" && tw._0.$ === "Ptr" ? tw._0._0.provenance : tw).toBe(WILDCARD);
  // CTFE has no wildcard: `Prov::WILDCARD.unwrap()` panics
  expect(panics(() => c.process_native_write(cx, alloc_range(S(8), S(8)), Provenance_CtfeProvenance))).toBe("called `Option::unwrap()` on a `None` value");
});

// ---- a second interpreter machine: CTFE's values, `M::Provenance::OFFSET_IS_ADDR = true` ----

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
  "#![feature(no_core, lang_items, intrinsics, rustc_attrs)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  "#[rustc_intrinsic] pub const unsafe fn ptr_offset_from<T>(ptr: *const T, base: *const T) -> isize;",
].join("\n");

/** The CTFE stand-in of memory.test.ts (`DummyMachine` checking alignment); `addr` makes `M::Provenance` say
 *  `OFFSET_IS_ADDR = true`, and `no_alloc` makes `ptr_get_alloc` find no allocation (as Miri's does for an address that
 *  is in no allocation). */
class StandInMachine extends DummyMachine {
  override readonly Provenance: Provenance<CtfeProvenance>;
  constructor(
    addr: boolean,
    public no_alloc = false,
  ) {
    super();
    this.Provenance = addr ? { ...Provenance_CtfeProvenance, OFFSET_IS_ADDR: true } : Provenance_CtfeProvenance;
  }
  override enforce_alignment(): boolean {
    return true;
  }
  override ptr_get_alloc(ecx: InterpCx, ptr: Pointer, size: bigint): [AllocId, Size, boolean] | undefined {
    return this.no_alloc ? undefined : super.ptr_get_alloc(ecx, ptr, size);
  }
}

function with_ecxs(f: (tcx: TyCtxt, mk: (m: StandInMachine) => InterpCx) => void): void {
  const file = join(DATA, "tmp", "interp-generic", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "interp_generic.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      f(tcx, (m) => InterpCx.new(tcx, DUMMY_SP, TypingEnv.fully_monomorphized(), m) as unknown as InterpCx);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

const STACK: MemoryKind<CtfeMemoryKind> = { $: "Stack" };
function ok<T>(r: InterpResult<T>): T {
  if (r.$ === "Err") throw new Error(`ERROR: unexpected interp error: ${display_InterpErrorKind(r._0._0.kind)}`);
  return r._0;
}
function err(r: InterpResult<unknown>): InterpErrorKind {
  if (r.$ === "Ok") throw new Error("ERROR: expected an interp error");
  return r._0._0.kind;
}

test("interp-generic: a machine with OFFSET_IS_ADDR = true takes the restored interpreter arms", () => {
  with_ecxs((tcx, mk) => {
    const ctfe = mk(new StandInMachine(false));
    const addr = mk(new StandInMachine(true));
    expect(ctfe.machine.Provenance.OFFSET_IS_ADDR).toBe(false);
    expect(addr.machine.Provenance.OFFSET_IS_ADDR).toBe(true);

    // ---- is_ptr_misaligned (memory.rs:612): an align-1 allocation, a pointer at offset 4 checked for align 4.
    // CTFE: the allocation's alignment (1) is too small; OFFSET_IS_ADDR: the address (4) is aligned.
    for (const [ecx, expected] of [
      [ctfe, { has: A(1), required: A(4) }],
      [addr, undefined],
    ] as const) {
      const p = ok(ecx.allocate_ptr(S(8), A(1), STACK, "Uninit"));
      expect(ecx.is_ptr_misaligned(Pointer_Option_from_Pointer(Pointer.new(p.provenance, S(4))), A(4))).toEqual(expected);
    }

    // ---- ptr_try_get_alloc_id (memory.rs:1698): `M::ptr_get_alloc` finding nothing is only allowed with OFFSET_IS_ADDR
    // (the offset is then the absolute address).
    const addr_none = mk(new StandInMachine(true, true));
    const ctfe_none = mk(new StandInMachine(false, true));
    const q = ok(addr_none.allocate_ptr(S(8), A(8), STACK, "Uninit"));
    expect(addr_none.ptr_try_get_alloc_id(Pointer_Option_from_Pointer(Pointer.new(q.provenance, S(5))), 0n)).toEqual({ $: "Err", _0: 5n });
    const q2 = ok(ctfe_none.allocate_ptr(S(8), A(8), STACK, "Uninit"));
    expect(panics(() => ctfe_none.ptr_try_get_alloc_id(Pointer_Option_from_Pointer(Pointer.new(q2.provenance, S(5))), 0n))).toBe("assertion failed: M::Provenance::OFFSET_IS_ADDR");

    // ---- ptr_offset_from (intrinsics.rs:409): pointers into two different allocations. CTFE: UB (not derived from the
    // same allocation); OFFSET_IS_ADDR: the distance of the two addresses (`a.addr() - b.addr()`, here 8 - 0).
    let def: LocalDefId | undefined;
    for (const id of tcx.hir_free_items()) {
      const item = tcx.hir_item(id);
      if (item.kind.$ === "Fn" && Symbol.as_str(tcx.item_name(LocalDefId.to_def_id(item.owner_id.def_id))) === "ptr_offset_from") def = item.owner_id.def_id;
    }
    const inst = Instance.new_raw(LocalDefId.to_def_id(def!), tcx.mk_args([GenericArg.from_Ty(tcx.types.u8)]));
    const ptr_layout = unwrap_result(ctfe.layout_of(Ty.new_imm_ptr(tcx, tcx.types.u8)), () => "layout");
    const isize_layout = unwrap_result(ctfe.layout_of(tcx.types.isize), () => "layout");
    // `eval_intrinsic` with no return block (`ret = None`) ends in `return_to_block(None)`, UB "entering unreachable
    // code", after the result was written to `dest`.
    const run = (ecx: InterpCx): [string, bigint | undefined] => {
      const a = ok(ecx.allocate_ptr(S(16), A(8), STACK, "Uninit"));
      const b = ok(ecx.allocate_ptr(S(16), A(8), STACK, "Uninit"));
      const op = (p: Pointer, off: number) => OpTy_from_ImmTy(ImmTy.from_scalar(Scalar.from_pointer(Pointer.new(p.provenance, S(off)), ecx), ptr_layout));
      const dest = ok(ecx.allocate(isize_layout, STACK));
      const r = ecx.eval_intrinsic(inst, [op(a, 8), op(b, 0)], PlaceTy_from_MPlaceTy(dest), undefined);
      const v = ecx.read_scalar(dest);
      return [display_InterpErrorKind(err(r)), v.$ === "Ok" ? unwrap_result(Scalar.to_target_isize(v._0, ecx), () => "isize") : undefined];
    };
    expect(run(ctfe)).toEqual(["`ptr_offset_from` called on two different pointers that are not both derived from the same allocation", undefined]);
    expect(run(addr)).toEqual(["entering unreachable code", 8n]);
  });
});

// Lane interp-miri-reconcile (plan-m6 D3, miri-contract review M1-M7, interp-generic review B2; not a port): the
// interpreter <-> Miri machine contract.
// - N1: loading Miri never replaces a method rustc_const_eval defined on `InterpCx.prototype` (or a provided-method base).
// - M1/M7: `MiriMachine` is a `Machine<MiriMachineTypes>`: associated items on its prototype, the provided defaults it does
//   not override, `unported` stubs for the fns of `impl Machine for MiriMachine`; `MonoHashMap` is an `AllocMap`.
// - M3: Miri's provenance is registered (`provenance_of`, `provenance_eq`).
// - B2/M6: the machine's `MayLeak` / `Display` / `Eq` of `M::MemoryKind` drive `take_leaked_allocations` (upstream
//   memory.rs:1173, the leak check Miri runs after every successful run), the deallocation error and `DumpAllocs`. The
//   machine is a CTFE stand-in (`DummyMachine`, CTFE provenance) with Miri's memory kinds and `GLOBAL_KIND`. Expected
//   values are worked out from upstream memory.rs and machine.rs:222 / :245 at the pin.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA, REPO } from "../../scripts/lib/common.ts";
import "./lib.ts";
import { Align, Size } from "../rustc_abi/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { DummyMachine } from "../rustc_const_eval/const_eval/mod.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { AllocMap_provided, Machine_provided, type MachineTypesOf, type ProvOf } from "../rustc_const_eval/interpret/machine.ts";
import { type AllocRefMut, debug_DumpAllocs } from "../rustc_const_eval/interpret/memory.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import {
  type AllocId,
  CtfeProvenance,
  display_InterpErrorKind,
  type InterpResult,
  Pointer,
  Pointer_Option_from_Pointer,
  provenance_eq,
  provenance_of,
  Scalar,
} from "../rustc_middle/mir/interpret/mod.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { PLAIN } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { AllocBytes_MiriAllocBytes, MiriAllocBytes } from "./alloc/alloc_bytes.ts";
import type { BorTag } from "./borrow_tracker/mod.ts";
import { MonoHashMap } from "./data_structures/mono_hash_map.ts";
import { type MiriInterpCx, MiriMachine, type MiriMachineTypes, type MiriMemoryKind, Provenance, Provenance_Provenance } from "./machine.ts";

// ---- type-level: `MiriInterpCx` reads Miri's associated types (M1) ----
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _types: [Equal<ProvOf<MiriMachine>, Provenance>, Equal<MachineTypesOf<MiriInterpCx["machine"]>, MiriMachineTypes>] = [true, true];
void _types;

test("N1: loading Miri replaces no method of InterpCx.prototype or of the provided-method bases", () => {
  const script = `
    await import("./src/rustc_const_eval/lib.ts");
    const { InterpCx } = await import("./src/rustc_const_eval/interpret/eval_context.ts");
    const { Machine_provided, AllocMap_provided } = await import("./src/rustc_const_eval/interpret/machine.ts");
    const targets = { InterpCx: InterpCx.prototype, Machine_provided: Machine_provided.prototype, AllocMap_provided: AllocMap_provided.prototype };
    const snap = (o) => new Map(Object.getOwnPropertyNames(o).map((n) => [n, Object.getOwnPropertyDescriptor(o, n)]));
    const before = Object.fromEntries(Object.entries(targets).map(([k, o]) => [k, snap(o)]));
    await import("./src/miri/lib.ts");
    const changed = [];
    let n = 0;
    for (const [k, o] of Object.entries(targets)) {
      for (const [name, d] of before[k]) {
        n++;
        const d2 = Object.getOwnPropertyDescriptor(o, name);
        if (d2 === undefined || d2.value !== d.value || d2.get !== d.get || d2.set !== d.set) changed.push(k + "." + name);
      }
    }
    const added = Object.getOwnPropertyNames(InterpCx.prototype).length - before.InterpCx.size;
    console.log(JSON.stringify({ n, changed, added }));
  `;
  const r = Bun.spawnSync(["bun", "-e", script], { cwd: REPO });
  expect(r.stderr.toString().split("\n").find((l) => /Error/.test(l))).toBeUndefined();
  const out = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!) as { n: number; changed: string[]; added: number };
  expect(out.changed).toEqual([]);
  expect(out.n).toBeGreaterThan(250); // rustc_const_eval's own InterpCx methods were snapshotted
  expect(out.added).toBeGreaterThan(390); // Miri's extension methods (ported or stubs) were added beside them
}, 120_000);

test("M1/M7: MiriMachine's associated items, provided defaults and impl stubs; MonoHashMap is an AllocMap", () => {
  const m = MiriMachine.prototype;
  expect(m.Provenance).toBe(Provenance_Provenance);
  expect(m.Bytes).toBe(AllocBytes_MiriAllocBytes);
  expect(m.GLOBAL_KIND).toBe("Global");
  expect(m.PANIC_ON_ALLOC_FAIL).toBe(false);
  expect(m.ALL_CONSTS_ARE_PRECHECKED).toBe(true);
  expect(m.MayLeak_MemoryKind.may_leak("Tls")).toBe(true);
  expect(m.display_MemoryKind("Mmap", PLAIN)).toBe("mmap");
  expect([m.MemoryKind_eq("C", "C"), m.MemoryKind_eq("C", "Rust")]).toEqual([true, false]);
  // not overridden by machine.rs:1133: the trait's defaults
  for (const n of ["load_mir", "increment_const_eval_counter", "before_access_global", "before_alloc_access"] as const) {
    expect(m[n]).toBe(Machine_provided.prototype[n]);
  }
  // overridden (and the required fns): lane miri-machine's, `unported` until ported
  const unported_msg = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      if (e instanceof Unported) return e.message;
      throw e;
    }
    return "no error";
  };
  expect(m.alignment_check).not.toBe(Machine_provided.prototype.alignment_check);
  expect(unported_msg(() => (m.enforce_alignment as () => unknown)())).toContain(
    "miri::machine::MiriMachine (impl Machine)::enforce_alignment (src/tools/miri/src/machine.rs; lane miri-machine)",
  );
  expect(unported_msg(() => (m.stack_ as () => unknown)())).toContain("::stack_ (");
  expect(unported_msg(() => m.MemoryMap_default())).toContain("MonoHashMap::default (");
  expect(unported_msg(() => AllocBytes_MiriAllocBytes.zeroed(Size.ZERO, Align.ONE, { $: "Global" }))).toContain("MiriAllocBytes::zeroed (");
  // MonoHashMap: `get` is the impl's (machine.rs `impl AllocMap for MonoHashMap` :98), `get_mut` the default
  expect(MonoHashMap.prototype.get_mut).toBe(AllocMap_provided.prototype.get_mut);
  expect(MonoHashMap.prototype.get).not.toBe(AllocMap_provided.prototype.get);
  expect(unported_msg(() => new MonoHashMap(new Map()).insert(1, 2))).toContain("(impl AllocMap)::insert (");
  // N5: `M::Bytes` values are `Uint8Array`s; their views are plain ones
  const b = new MiriAllocBytes(4);
  expect(b).toBeInstanceOf(Uint8Array);
  expect(b.subarray(1).constructor).toBe(Uint8Array);
});

test("M3: Miri's provenance is registered: provenance_of / provenance_eq / Debug", () => {
  const a: Provenance = { $: "Concrete", alloc_id: 3 as AllocId, tag: 9 as BorTag };
  const a2: Provenance = { $: "Concrete", alloc_id: 3 as AllocId, tag: 9 as BorTag };
  const b: Provenance = { $: "Concrete", alloc_id: 3 as AllocId, tag: 10 as BorTag };
  const w: Provenance = Provenance.Wildcard;
  expect(provenance_of(a) as unknown).toBe(Provenance_Provenance);
  expect(provenance_of(w) as unknown).toBe(Provenance_Provenance);
  expect([provenance_eq<Provenance>(a, a2), provenance_eq<Provenance>(a, b), provenance_eq<Provenance>(a, w), provenance_eq<Provenance>(w, w)]).toEqual([
    true,
    false,
    false,
    true,
  ]);
  expect(provenance_of(a).debug(a, PLAIN)).toBe("[alloc3]<9>");
});

// ---- B2 / M6: a Miri-shaped machine's `MemoryKind` impls on the interpreter's memory ----

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
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
].join("\n");

/** A CTFE stand-in machine (CTFE provenance and bytes) whose `M::MemoryKind` is Miri's: `MiriMemoryKind` with
 * `MiriMachine`'s `MayLeak` / `Display` / `Eq` impls and `GLOBAL_KIND = Some(Global)`. */
class MiriKindsMachine extends DummyMachine {
  constructor() {
    super();
    const m = MiriMachine.prototype;
    Object.assign(this, {
      MayLeak_MemoryKind: m.MayLeak_MemoryKind,
      display_MemoryKind: m.display_MemoryKind,
      MemoryKind_eq: m.MemoryKind_eq,
      GLOBAL_KIND: m.GLOBAL_KIND,
    });
  }
  override enforce_alignment(): boolean {
    return false;
  }
}

function with_ecx(f: (ecx: InterpCx) => void): void {
  const file = join(DATA, "tmp", "interp-miri-reconcile", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "miri_kinds.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      f(InterpCx.new(tcx, DUMMY_SP, TypingEnv.fully_monomorphized(), new MiriKindsMachine()) as unknown as InterpCx);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

function ok<T>(r: InterpResult<T>): T {
  if (r.$ === "Err") throw new Error(`ERROR: unexpected interp error: ${display_InterpErrorKind(r._0._0.kind)}`);
  return r._0;
}
const S = (n: number): Size => Size.from_bytes(n);
const A8 = ((): Align => {
  const r = Align.from_bytes(8);
  if (r.$ === "Err") throw new Error("ERROR: align");
  return r._0;
})();
/** `MemoryKind::Machine(kind)` of a Miri kind (machine.rs:215 `From<MiriMemoryKind> for MemoryKind`). */
const miri = (kind: MiriMemoryKind): never => ({ $: "Machine", _0: kind }) as never;
const id_of = (p: Pointer): AllocId => CtfeProvenance.alloc_id(p.provenance);

test("B2/M6: a Miri-shaped machine's MayLeak / Display / Eq of M::MemoryKind drive the leak check, dealloc errors and dumps", () => {
  with_ecx((ecx) => {
    const tcx = ecx.tcx.deref();
    const alloc = (kind: never): Pointer => ok(ecx.allocate_ptr(S(8), A8, kind, "Zero"));
    // deallocate_ptr (memory.rs:418): `alloc_kind != kind` through the machine's `Eq`, both kinds through its `Display`
    const d = alloc(miri("Rust"));
    const e = ecx.deallocate_ptr(Pointer_Option_from_Pointer(d), undefined, miri("C"));
    expect(e.$ === "Err" ? display_InterpErrorKind(e._0._0.kind) : "Ok").toBe(
      `deallocating alloc${id_of(d)}, which is Rust heap memory, using C heap deallocation operation`,
    );
    const d2 = alloc(miri("Rust"));
    ok(ecx.deallocate_ptr(Pointer_Option_from_Pointer(d2), undefined, miri("Rust")));

    const global = alloc(miri("Global")); // a root (`GLOBAL_KIND`)
    const reached = alloc(miri("Rust")); // reachable from `global`
    const rust = alloc(miri("Rust"));
    const c = alloc(miri("C"));
    const machine = alloc(miri("Machine")); // may leak
    const tls = alloc(miri("Tls")); // may leak
    const runtime = alloc(miri("Runtime"));
    const stack = alloc({ $: "Stack" } as never);
    ok((ok(ecx.get_ptr_alloc_mut(Pointer_Option_from_Pointer(global), S(8))) as AllocRefMut).write_ptr_sized(S(0), Scalar.from_pointer(reached, tcx)));

    // DumpAllocs (memory.rs:1291): `({kind}, ..` through the machine's `Display`
    expect(debug_DumpAllocs(ecx.dump_alloc(id_of(global)), PLAIN).split("\n")[0]).toBe(`alloc${id_of(global)} (global (static or const), size: 8, align: 8) {`);

    // take_leaked_allocations (memory.rs:1173): roots are the `GLOBAL_KIND` allocations (the machine's `Eq`), and a
    // `may_leak` kind (machine.rs:222: Machine / Global / ExternStatic / Tls / Mmap / SocketAddress) is never a leak.
    // (The first `Rust` allocation `d` was removed by its failed deallocation, as upstream removes first.)
    const leaked = ecx.take_leaked_allocations(() => []);
    expect(leaked.map(([id, kind]) => [id, kind.$ === "Machine" ? (kind._0 as unknown as string) : kind.$] as [AllocId, string])).toEqual([
      [id_of(rust), "Rust"],
      [id_of(c), "C"],
      [id_of(runtime), "Runtime"],
      [id_of(stack), "Stack"],
    ]);
    const left = ecx.memory.alloc_map.filter_map_collect((id) => id);
    expect([...left].sort((a, b) => a - b)).toEqual([id_of(global), id_of(reached), id_of(machine), id_of(tls)].sort((a, b) => a - b));
  });
}, 120_000);

// Oracle test of Miri's address assignment (lane miri-alloc): replays the scripted allocations / frees of
// `addresses.oracle.txt` through the ported `addr_from_alloc_id` (-> `addr_from_alloc_id_uncached` -> `ReusePool::take_addr`
// / `AddressGenerator::generate` / `address_space_shortage`) and `MiriMachine::free_alloc_id` (-> `ReusePool::add_addr`)
// with the vendored `StdRng`, and compares every address, every cross-thread synchronisation and the next rng word.
//
// The fixture is the output of the registered probe tools/probes/miriaddr (upstream's address_generator.rs / reuse_pool.rs
// logic and the reuse-or-generate choice of alloc_addresses/mod.rs, built against the real rand 0.10.1 through upstream's
// Cargo.lock); `bun scripts/probes.ts fixture miriaddr` regenerates it and tools/probes/fixtures.test.ts checks it.
//
// The interpreter around these fns is a test double: `get_alloc_info` answers from the script, `active_thread()` is the
// op's thread, `acquire_clock` records the clock, and the data-race `release_clock` returns a clock tagged with the
// donating thread (the real one clones the thread's clock, lane miri-race).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import "../lib.ts";
import { AddressGenerator } from "./address_generator.ts";
import { GlobalStateInner } from "./mod.ts";
import { ReusePool } from "./reuse_pool.ts";
import { type MiriConfig } from "../eval.ts";
import { MiriMachine, type MemoryKind, type MiriInterpCx } from "../machine.ts";
import { ThreadId } from "../concurrency/thread.ts";
import { VClock } from "../concurrency/vector_clock.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { AllocInfo } from "../../rustc_const_eval/interpret/memory.ts";
import { type AllocId, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unwrap_result } from "../../std/result.ts";
import { StdRng } from "../../vendor/rand/rngs/std.ts";

interface Scenario {
  name: string;
  seed: bigint;
  start: bigint;
  end: bigint;
  reuse: number;
  cross: number;
  lines: string[];
  tail: number;
}

function parse(text: string): Scenario[] {
  const out: Scenario[] = [];
  let cur: Scenario | undefined;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const m = /^scenario (\S+) seed=(\d+) start=(\d+) end=(\d+) reuse=(\S+) cross=(\S+)$/.exec(line);
    if (m) {
      cur = { name: m[1]!, seed: BigInt(m[2]!), start: BigInt(m[3]!), end: BigInt(m[4]!), reuse: Number(m[5]), cross: Number(m[6]), lines: [], tail: -1 };
      out.push(cur);
    } else if (line.startsWith("tail=")) {
      cur!.tail = Number(line.slice(5));
    } else {
      cur!.lines.push(line);
    }
  }
  return out;
}

function memory_kind(k: string): MemoryKind {
  return k === "Stack" ? { $: "Stack" } : { $: "Machine", _0: "Rust" };
}

/** A data-race clock standing for "the clock of thread `t`". */
class TaggedClock extends VClock {
  constructor(readonly donor: number) {
    super([]);
  }
}

/** The pieces of `MiriInterpCx` / `MiriMachine` the replayed fns read (header). */
function replay(sc: Scenario): string[] {
  const rng = StdRng.seed_from_u64(sc.seed);
  const config = { address_reuse_rate: sc.reuse, address_reuse_cross_thread_rate: sc.cross, provenance_mode: "Default", native_lib: [], genmc_config: undefined } as unknown as MiriConfig;
  let global_state: GlobalStateInner;
  if (sc.end === (1n << 64n) - 1n) {
    // The real constructor: `end` is `tcx.target_usize_max()` of a 64-bit target.
    const tcx = { data_layout: () => ({ pointer_size: () => Size.from_bytes(8) }) } as unknown as TyCtxt;
    global_state = GlobalStateInner.new(config, sc.start, tcx);
  } else {
    global_state = new GlobalStateInner([], new Map(), new Set(), "Default", [AddressGenerator.new({ start: sc.start, end: sc.end }), ReusePool.new(config)], undefined);
  }
  const infos = new Map<AllocId, AllocInfo>();
  let thread = 0;
  let synced: VClock[] = [];
  const machine = {
    alloc_addresses: global_state,
    rng,
    native_lib: [],
    borrow_tracker: undefined,
    threads: { active_thread_: () => new ThreadId(thread) },
    data_race: { $: "Vclocks", _0: { release_clock: (_threads: unknown, _cb: unknown) => new TaggedClock(thread) } },
  };
  const ecx = {
    machine,
    eval_context_ref() {
      return this;
    },
    get_alloc_info: (id: AllocId) => infos.get(id)!,
    active_thread: () => new ThreadId(thread),
    acquire_clock: (c: VClock) => {
      synced.push(c);
      return interp_ok(undefined);
    },
    addr_from_alloc_id_uncached: InterpCx.prototype.addr_from_alloc_id_uncached,
  } as unknown as MiriInterpCx;
  const free_alloc_id = MiriMachine.prototype.free_alloc_id;
  const kinds = new Map<AllocId, MemoryKind>();
  const got: string[] = [];
  for (const line of sc.lines) {
    const a = /^alloc (\d+) size=(\d+) align=(\d+) kind=(\S+) thread=(\d+) -> /.exec(line);
    if (a) {
      const id = (Number(a[1]) + 1) as AllocId;
      const [size, align, kind] = [Number(a[2]), Number(a[3]), a[4]!];
      thread = Number(a[5]);
      infos.set(id, new AllocInfo(Size.from_bytes(size), unwrap_result(Align.from_bytes(align)), "LiveData", "Mut"));
      kinds.set(id, memory_kind(kind));
      synced = [];
      const r = InterpCx.prototype.addr_from_alloc_id.call(ecx, id, memory_kind(kind));
      let res: string;
      if (r.$ === "Err") {
        const k = r._0.kind();
        expect(k.$ === "ResourceExhaustion" && k._0 === "AddressSpaceFull").toBe(true);
        res = "full";
      } else {
        // The address is cached and the inverse map stays sorted.
        expect(InterpCx.prototype.addr_from_alloc_id.call(ecx, id, undefined)).toEqual(r);
        res = `${r._0}`;
        if (synced.length > 0) res += ` sync=${(synced[0] as TaggedClock).donor}`;
      }
      got.push(`${a[0]}${res}`);
      if (res === "full") break;
      continue;
    }
    const f = /^free (\d+) thread=(\d+)$/.exec(line);
    if (f) {
      const id = (Number(f[1]) + 1) as AllocId;
      thread = Number(f[2]);
      const info = infos.get(id)!;
      free_alloc_id.call(machine as unknown as MiriMachine, id, info.size, info.align, kinds.get(id)!);
      got.push(line);
      continue;
    }
    throw new Error(`bad fixture line: ${line}`);
  }
  // Sorted, and only live allocations.
  const map = global_state.int_to_ptr_map;
  for (let i = 1; i < map.length; i++) expect(map[i - 1]![0] < map[i]![0]).toBe(true);
  got.push(`tail=${rng.next_u32()}`);
  return got;
}

const scenarios = parse(readFileSync(new URL("./addresses.oracle.txt", import.meta.url), "utf8"));

test("the fixture has the six scenarios", () => {
  expect(scenarios.map((s) => s.name)).toEqual(["default", "seed42", "reuse", "noreuse", "tiny", "poolfull"]);
});

for (const sc of scenarios) {
  test(`address assignment matches the oracle: ${sc.name}`, () => {
    const got = replay(sc);
    const want = [...sc.lines, `tail=${sc.tail}`];
    // First difference, not the whole list.
    for (let i = 0; i < Math.max(got.length, want.length); i++) {
      if (got[i] !== want[i]) {
        expect(`${i}: ${got[i]}`).toBe(`${i}: ${want[i]}`);
      }
    }
    expect(got.length).toBe(want.length);
  });
}

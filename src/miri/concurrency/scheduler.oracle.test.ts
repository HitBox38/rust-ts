// Oracle test of Miri's thread choice (lane miri-threads-fix, review miri-threads finding 1): replays the scripted thread
// sets of `scheduler.oracle.txt` through the ported `schedule` (scheduler.ts) and `maybe_preempt_active_thread` /
// `yield_active_thread` (thread.ts) with the vendored `StdRng`, and asserts every scheduling decision, every preemption
// draw's outcome, and the rng's next word after the run (`tail=`), so a missing or extra draw anywhere fails.
//
// The fixture is the output of the probe in docs/handoff/miri-threads-probe (upstream's scheduler.rs `schedule` and
// thread.rs `maybe_preempt_active_thread` transcribed verbatim over the same std iterator chain, built against the real
// rand 0.10.1 through upstream's Cargo.lock, seeded as MiriMachine::new seeds it). PORT: until a registered probe
// regenerates it (a harness item), the fixture is committed, as alloc_addresses/addresses.oracle.txt is.
//
// The interpreter around these fns is a test double (as in threads.test.ts): a real `ThreadManager`, `BlockingIoManager`
// and `StdRng`, data race detection off, isolation on, no deadlines. The scripted events (spawn, block, unblock, yield,
// terminate) are performed with the ported `create_thread` / `block_thread` / `unblock_thread` / `yield_active_thread` /
// `terminate_active_thread`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import "../lib.ts";
import { TerminationInfoStop, TerminationInfo_into_machine_stop } from "../diagnostics.ts";
import { type MiriConfig } from "../eval.ts";
import { type MiriInterpCx } from "../machine.ts";
import { DelayedReadinessUpdates } from "../shims/readiness.ts";
import { BlockingIoManager } from "./blocking_io.ts";
import { GlobalDataRaceHandler } from "./data_race_handler.ts";
import { type DynUnblockCallback, type StackEmptyCallback, ThreadId, ThreadManager, TlsAllocAction } from "./thread.ts";
import { Poll } from "../../std/task.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { InterpErrorInfo_from_InterpErrorKind, interp_ok, type MachineStopType } from "../../rustc_middle/mir/interpret/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Err } from "../../std/result.ts";
import { StdRng } from "../../vendor/rand/rngs/std.ts";

interface Scenario {
  name: string;
  seed: bigint;
  rate: number;
  fixed: boolean;
  initial: number;
  lines: string[];
  tail: number;
}

function parse(text: string): Scenario[] {
  const out: Scenario[] = [];
  let cur: Scenario | undefined;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const m = /^scenario (\S+) seed=(\d+) rate=(\S+) fixed=([01]) initial=(\d+)$/.exec(line);
    if (m) {
      cur = { name: m[1]!, seed: BigInt(m[2]!), rate: Number(m[3]), fixed: m[4] === "1", initial: Number(m[5]), lines: [], tail: -1 };
      out.push(cur);
    } else if (line.startsWith("tail=")) {
      cur!.tail = Number(line.slice(5));
    } else {
      cur!.lines.push(line);
    }
  }
  return out;
}

const SCENARIOS = parse(readFileSync(new URL("./scheduler.oracle.txt", import.meta.url), "utf8"));

let orig_process: typeof DelayedReadinessUpdates.process;
beforeAll(() => {
  orig_process = DelayedReadinessUpdates.process;
  // shims/readiness.rs:465 with no delayed updates (lane miri-shims-c)
  DelayedReadinessUpdates.process = () => interp_ok(undefined);
});
afterAll(() => {
  DelayedReadinessUpdates.process = orig_process;
});

const READY: StackEmptyCallback = () => interp_ok(Poll.Ready_unit);
const EXIT: StackEmptyCallback = () => Err(InterpErrorInfo_from_InterpErrorKind(TerminationInfo_into_machine_stop({ $: "Exit", code: 0, leak_check: false })));
const NOOP: DynUnblockCallback = { visit_provenance() {}, call: () => interp_ok(undefined) };

function make_ecx(s: Scenario): MiriInterpCx {
  const machine = {
    threads: ThreadManager.new({ fixed_scheduling: s.fixed } as MiriConfig),
    data_race: GlobalDataRaceHandler.None,
    // machine.rs:721 `StdRng::seed_from_u64(config.seed.unwrap_or(0))`
    rng: StdRng.seed_from_u64(s.seed),
    preemption_rate: s.rate,
    blocking_io: (BlockingIoManager.new(false) as { _0: BlockingIoManager })._0,
    static_roots: [],
    communicate: () => false,
    current_user_relevant_span: () => DUMMY_SP,
  };
  const ecx = Object.create(InterpCx.prototype) as MiriInterpCx;
  Object.assign(ecx, { machine, tcx: { deref: () => ({ sess: { target: { os: { $: "Linux" } } } }) } });
  ThreadManager.init(ecx, EXIT);
  for (let i = 1; i < s.initial; i++) ecx.machine.threads.create_thread(READY);
  return ecx;
}

/** Replays one scenario; returns the first mismatch (`undefined`: every line and the tail agree). */
function replay(s: Scenario): string | undefined {
  const ecx = make_ecx(s);
  const threads = ecx.machine.threads;
  const at = (i: number, got: string) => `${s.name}: line ${i + 1} of the scenario: expected '${s.lines[i]}', got '${got}'`;
  for (let i = 0; i < s.lines.length; i++) {
    const line = s.lines[i]!;
    const [op, ...rest] = line.split(" ");
    const arg = rest[rest.length - 1]!;
    switch (op) {
      case "sched": {
        const r = ecx.schedule();
        let got: string;
        if (r.$ === "Ok") {
          expect(r._0.$).toBe("ExecuteStep");
          got = `sched -> ${ecx.active_thread().index()}`;
        } else {
          const kind = r._0._0.kind as { $: string; _0: MachineStopType };
          const info = kind.$ === "MachineStop" ? TerminationInfoStop.downcast_ref(kind._0) : undefined;
          got = `sched -> ${info?.$ ?? kind.$}`;
        }
        if (got !== line) return at(i, got);
        break;
      }
      case "preempt": {
        ecx.maybe_preempt_active_thread();
        const got = `preempt -> ${threads.yield_active_thread}`;
        if (got !== line) return at(i, got);
        break;
      }
      case "spawn": {
        const id = threads.create_thread(READY);
        if (`spawn -> ${id.index()}` !== line) return at(i, `spawn -> ${id.index()}`);
        break;
      }
      case "block": {
        if (ecx.active_thread().index() !== Number(arg)) return at(i, `block ${ecx.active_thread().index()}`);
        ecx.block_thread({ $: "Sleep" }, undefined, NOOP);
        break;
      }
      case "unblock": {
        const r = ecx.unblock_thread(ThreadId.new(Number(arg)), { $: "Sleep" });
        expect(r.$).toBe("Ok");
        break;
      }
      case "yield":
        ecx.yield_active_thread();
        break;
      case "terminate": {
        if (ecx.active_thread().index() !== Number(arg)) return at(i, `terminate ${ecx.active_thread().index()}`);
        expect(ecx.terminate_active_thread(TlsAllocAction.Leak).$).toBe("Ok");
        break;
      }
      case "step":
        break;
      default:
        throw new Error(`unknown fixture line '${line}'`);
    }
  }
  const tail = (ecx.machine.rng as StdRng).next_u32();
  if (tail !== s.tail) return `${s.name}: tail: expected ${s.tail}, got ${tail} (a missing or extra rng draw)`;
  return undefined;
}

test("scheduler oracle fixture: 7 scenarios, each with decisions and a tail", () => {
  expect(SCENARIOS.map((s) => s.name)).toEqual(["default", "preempt-half", "seed42", "always", "never", "fixed", "deadlock"]);
  for (const s of SCENARIOS) {
    expect(s.tail).toBeGreaterThanOrEqual(0);
    expect(s.lines.filter((l) => l.startsWith("sched ")).length).toBeGreaterThan(50);
  }
  // The deadlock scenario ends in a GlobalDeadlock; random choice switches threads in every random scenario.
  expect(SCENARIOS.find((s) => s.name === "deadlock")!.lines.at(-1)).toBe("sched -> GlobalDeadlock");
});

for (const s of SCENARIOS) {
  test(`schedule / maybe_preempt_active_thread match the probe: ${s.name} (seed ${s.seed}, rate ${s.rate}${s.fixed ? ", fixed" : ""})`, () => {
    expect(replay(s)).toBeUndefined();
  });
}

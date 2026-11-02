// Tests of src/miri/shims/env.ts and src/miri/shims/alloc.ts (lane miri-shims-a) on small fake interpreter contexts:
// which host variables `EnvVars::init` forwards (isolation on / off, `-Zmiri-env-forward`, `-Zmiri-env-set`), the
// pid / tid mapping, `malloc_align`'s table and `check_rust_alloc_request`'s errors. Expectations follow upstream's
// code (env.rs:30-129, alloc.rs:13-112).
import { expect, test } from "bun:test";
import "../lib.ts";
import { EnvVars } from "./env.ts";
import { UnixEnvVars } from "./unix/env.ts";
import { ThreadId } from "../concurrency/thread.ts";
import { type MiriConfig } from "../eval.ts";
import { type MiriInterpCx } from "../machine.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { TargetDataLayout } from "../../rustc_abi/lib.ts";
import { Err, Ok } from "../../std/result.ts";

const dl = TargetDataLayout.default(); // 64-bit pointers

function fake_ecx(opts: { communicate: boolean; unix: boolean; os: string; arch?: string; thread_count?: number }): MiriInterpCx {
  const fake = {
    machine: {
      communicate: () => opts.communicate,
      env_vars: EnvVars.Uninit as unknown,
      threads: {
        thread_id_try_from: (id: number | bigint) =>
          Number(id) < (opts.thread_count ?? 1) ? Ok(ThreadId.new(Number(id))) : Err({ $: "InvalidId" }),
      },
    },
    target_os_is_unix: () => opts.unix,
    tcx: { deref: () => ({ sess: { target: { os: { $: opts.os }, arch: { $: opts.arch ?? "X86_64" }, families: opts.unix ? ["unix"] : [] } } }) },
    data_layout: () => dl,
    eval_context_ref() {
      return this;
    },
    eval_context_mut() {
      return this;
    },
  };
  Object.setPrototypeOf(fake, InterpCx.prototype);
  return fake as unknown as MiriInterpCx;
}

function config(env: [string, string][], forwarded: string[], set: [string, string][]): MiriConfig {
  return { env, forwarded_env_vars: forwarded, set_env_vars: new Map(set) } as unknown as MiriConfig;
}

/** Runs `EnvVars::init` with `UnixEnvVars::new` (lane miri-shims-c) replaced by a probe that records its map. */
function init_unix(ecx: MiriInterpCx, cfg: MiriConfig): [string, string][] {
  let seen: Map<string, string> | undefined;
  const ns = UnixEnvVars as unknown as { new: unknown };
  const saved = ns.new;
  ns.new = (_ecx: MiriInterpCx, vars: Map<string, string>) => {
    seen = vars;
    return Ok({ fake: "UnixEnvVars" });
  };
  try {
    expect(EnvVars.init(ecx, cfg).$).toBe("Ok");
  } finally {
    ns.new = saved;
  }
  expect((ecx.machine.env_vars as { $: string }).$).toBe("Unix");
  return [...seen!.entries()].sort();
}

const HOST_ENV: [string, string][] = [
  ["A", "1"],
  ["B", "2"],
  ["C", "3"],
];

test("EnvVars::init: isolation forwards only -Zmiri-env-forward vars, then applies -Zmiri-env-set", () => {
  const ecx = fake_ecx({ communicate: false, unix: true, os: "Linux" });
  expect(init_unix(ecx, config(HOST_ENV, [], []))).toEqual([]);
  expect(init_unix(ecx, config(HOST_ENV, ["B"], []))).toEqual([["B", "2"]]);
  expect(init_unix(ecx, config(HOST_ENV, ["B"], [["D", "4"], ["B", "9"]]))).toEqual([
    ["B", "9"],
    ["D", "4"],
  ]);
});

test("EnvVars::init: isolation off forwards the whole host env", () => {
  const ecx = fake_ecx({ communicate: true, unix: true, os: "Linux" });
  expect(init_unix(ecx, config(HOST_ENV, [], [["C", "x"]]))).toEqual([
    ["A", "1"],
    ["B", "2"],
    ["C", "x"],
  ]);
});

test("EnvVars::init: an OS-less target gets `Uninit`; get_env_var then finds nothing", () => {
  const ecx = fake_ecx({ communicate: false, unix: false, os: "None" });
  expect(EnvVars.init(ecx, config(HOST_ENV, ["A"], [])).$).toBe("Ok");
  expect(ecx.machine.env_vars).toBe(EnvVars.Uninit);
  expect(ecx.get_env_var("A")).toEqual({ $: "Ok", _0: undefined });
  expect(() => EnvVars.unix(EnvVars.Uninit)).toThrow("internal error: entered unreachable code");
});

test("pid is 1000 under isolation; tid = pid + thread index, and back", () => {
  const ecx = fake_ecx({ communicate: false, unix: true, os: "Linux", thread_count: 2 });
  expect(ecx.get_pid()).toBe(1000);
  expect(ecx.get_tid(ThreadId.new(0))).toBe(1000);
  expect(ecx.get_tid(ThreadId.new(3))).toBe(1003);
  expect(ecx.get_thread_id_from_linux_tid(1001)).toBe(ThreadId.new(1));
  expect(ecx.get_thread_id_from_linux_tid(1002)).toBeUndefined(); // no such thread
  expect(ecx.get_thread_id_from_linux_tid(999)).toBeUndefined(); // below the pid
});

test("malloc_align: fundamental alignment by arch, rounded down to a power of two below it", () => {
  const x86_64 = fake_ecx({ communicate: false, unix: true, os: "Linux", arch: "X86_64" });
  const align = (ecx: MiriInterpCx, size: bigint): number => ecx.malloc_align(size).bytes();
  expect([0n, 1n, 2n, 3n, 4n, 7n, 8n, 15n, 16n, 1000n].map((s) => align(x86_64, s))).toEqual([1, 1, 2, 2, 4, 4, 8, 8, 16, 16]);
  const x86 = fake_ecx({ communicate: false, unix: true, os: "Linux", arch: "X86" });
  expect([7n, 8n, 1000n].map((s) => align(x86, s))).toEqual([4, 8, 8]);
  const esp = fake_ecx({ communicate: false, unix: true, os: "EspIdf", arch: "RiscV32" });
  expect([3n, 4n, 1000n].map((s) => align(esp, s))).toEqual([2, 4, 4]);
});

test("check_rust_alloc_request: size 0, too large, non-power-of-two and too-large alignments", () => {
  const ecx = fake_ecx({ communicate: false, unix: true, os: "Linux" });
  const text = (size: bigint, align: bigint): string => {
    const r = ecx.check_rust_alloc_request(size, align);
    return r.$ === "Ok" ? "ok" : JSON.stringify(r._0, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  };
  expect(text(8n, 8n)).toBe("ok");
  expect(text(0n, 8n)).toContain("creating allocation with size 0");
  expect(text(1n << 63n, 8n)).toContain("creating an allocation larger than half the address space");
  expect(text(8n, 3n)).toContain("creating allocation with non-power-of-two alignment 3");
  expect(text(8n, 1n << 30n)).toContain("creating allocation with alignment 1073741824 exceeding rustc's maximum supported value");
});

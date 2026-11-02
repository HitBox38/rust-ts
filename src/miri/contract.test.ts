// The Miri skeleton contract (lane miri-contract, plan-m6 D2; docs/handoff/miri-contract.md):
// - layout: every in-scope upstream file of src/tools/miri/src has its module `src/miri/<path>.ts`, whose header names its
//   fill lane; no module mirrors an out-of-scope file (plan-m6 D2 + amendment A3 + decisions C6/C7);
// - markers: every `// rustc: src/tools/miri/src/..` marker names the upstream fn at that line (scripts/coverage.ts
//   `--check` only checks `compiler/` markers until the harness lane counts crate `miri`);
// - init order: the crate root and every module load as a fresh entry point (no TDZ), and `install_miri_stubs()` defines
//   every placeholder without a collision (a Miri method shadowing a rustc_const_eval one, or two traits declaring one name);
// - every method a module declares on `InterpCx` is a function after load (ported, or its placeholder stops `unported`);
// - the core types' ported impls (`Provenance`, `ProvenanceExtra`, `BorTag`, `MiriMemoryKind`, `FrameExtra`, `AllocExtra`,
//   `MiriInterpCxExt`) and sym.rs's extra symbols.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import "./lib.ts";
import { MIRI_STUBS, stub_message } from "../rust_ts/miri_stub.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { Pointer } from "../rustc_middle/mir/interpret/mod.ts";
import type { AllocId } from "../rustc_middle/mir/interpret/mod.ts";
import { Size } from "../rustc_abi/lib.ts";
import { create_session_globals_then } from "../rustc_span/lib.ts";
import { DEFAULT_EDITION } from "../rustc_span/edition.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { BorTag, debug_BorTag } from "./borrow_tracker/mod.ts";
import {
  clone_AllocExtra,
  debug_FrameExtra,
  debug_Provenance,
  debug_ProvenanceExtra,
  display_MiriMemoryKind,
  MayLeak_MiriMemoryKind,
  MemoryKind_from_MiriMemoryKind,
  MiriMemoryKind,
  type MiriInterpCx,
  Provenance,
  Provenance_Provenance,
  ProvenanceExtra,
} from "./machine.ts";
import { EXTRA_SYMBOLS, sym, sys_mutex_lock, sys_mutex_try_lock, sys_mutex_unlock } from "./sym.ts";

const MIRI = "src/tools/miri/src/";

/** Out of scope (plan-m6 D2, A3; decisions C6, C7): no TS module mirrors these upstream files. */
const OUT_OF_SCOPE: RegExp[] = [
  /^concurrency\/genmc\/(?!dummy\.rs$)/, // C7: built without `genmc`, so `mod genmc` is genmc/dummy.rs
  /^shims\/native_lib\//,
  /^shims\/windows\//,
  /^shims\/unix\/(android|freebsd|macos|netbsd|solarish)\//,
  /^shims\/unix\/(socket_address|tcp_socket|virtual_socket)\.rs$/, // A3: socket.rs stays (isolation errors)
  /^bin\/log\/tracing_chrome\.rs$/,
  /^intrinsics\/(aarch64|loongarch)\.rs$/, // D12: not reachable on x86_64-unknown-linux-gnu
  /^alloc\/isolated_alloc\.rs$/, // C6: compiled only with `native-lib`
];
/** Not scaffolded by this lane: `#[cfg(test)]` unit tests, ported as `.test.ts` by their lane (tree_borrows/tree/tests.rs: miri-tb-b). */
const TEST_FILES = /(^|\/)tests\.rs$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".rs")) out.push(p);
  }
  return out;
}
const UPSTREAM_FILES = walk(join(UPSTREAM, MIRI))
  .map((f) => relative(join(UPSTREAM, MIRI), f).replaceAll("\\", "/"))
  .sort();
const IN_SCOPE = UPSTREAM_FILES.filter((f) => !OUT_OF_SCOPE.some((r) => r.test(f)) && !TEST_FILES.test(f));
const tsOf = (rel: string) => `src/miri/${rel.replace(/\.rs$/, ".ts")}`;
const MODULES = IN_SCOPE.map(tsOf);
const LANES = new Set([
  "miri-contract", "miri-machine", "miri-eval", "miri-driver", "miri-alloc", "miri-sb", "miri-threads", "miri-race",
  "miri-shims-a", "miri-shims-b", "miri-shims-c", "miri-shims-d", "miri-shims-e", "miri-fs",
  "miri-x86-a", "miri-x86-b", "miri-tb-a", "miri-tb-b",
]);

test("every in-scope upstream file has its module, naming its fill lane; no module for an out-of-scope file", () => {
  expect(IN_SCOPE.length).toBe(101);
  const missing = MODULES.filter((m) => !existsSync(join(REPO, m)));
  expect(missing).toEqual([]);
  const noLane: string[] = [];
  for (const m of MODULES) {
    const head = readFileSync(join(REPO, m), "utf8").split("\n").slice(0, 12).join("\n");
    const lane = (/Fill lane: `(miri-[a-z0-9-]+)`/.exec(head) ?? /plan-m6 D2; lane (miri-contract), wave 35\)/.exec(head))?.[1];
    if (lane === undefined || !LANES.has(lane)) noLane.push(m);
  }
  expect(noLane).toEqual([]);
  const extra = walkTs(join(REPO, "src/miri"))
    .filter((f) => !f.endsWith(".gen.ts") && !f.endsWith(".test.ts"))
    .filter((f) => !MODULES.includes(f));
  expect(extra).toEqual([]);
});

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith(".ts")) out.push(relative(REPO, p).replaceAll("\\", "/"));
  }
  return out;
}

test("every `// rustc: src/tools/miri/src/..` marker names the upstream fn at its line", () => {
  const re = /\/\/ rustc(?:-skip)?: (src\/tools\/miri\/src\/\S+):(\d+) (\S+)/g;
  const fns = new Map<string, Map<number, string>>();
  const bad: string[] = [];
  let n = 0;
  for (const f of walkTs(join(REPO, "src/miri"))) {
    for (const m of readFileSync(join(REPO, f), "utf8").matchAll(re)) {
      n++;
      const path = m[1]!;
      if (!fns.has(path)) fns.set(path, new Map(upstreamFns(path).map((u) => [u.line, u.name])));
      if (fns.get(path)!.get(Number(m[2])) !== m[3]) bad.push(`${f}: ${path}:${m[2]} ${m[3]}`);
    }
  }
  expect(bad).toEqual([]);
  expect(n).toBeGreaterThanOrEqual(24);
});

test("the crate root and every module load as a fresh entry point (init order)", () => {
  const failed: string[] = [];
  for (const f of ["src/miri/lib.ts", ...MODULES]) {
    const r = Bun.spawnSync(["bun", "-e", `await import(${JSON.stringify("./" + f)})`], { cwd: REPO });
    if (r.exitCode !== 0) failed.push(`${f}: ${r.stderr.toString().split("\n").find((l) => /Error/.test(l)) ?? r.exitCode}`);
  }
  expect(failed).toEqual([]);
}, 300_000);

test("placeholders: installed once, no name registered twice per target, each stops `unported` with its path and lane", () => {
  const seen = new Map<object, Set<string>>();
  const dups: string[] = [];
  for (const s of MIRI_STUBS) {
    const t = s.target();
    if (!seen.has(t)) seen.set(t, new Set());
    for (const n of s.names) {
      if (seen.get(t)!.has(n)) dups.push(`${s.path}::${n}`);
      seen.get(t)!.add(n);
    }
  }
  expect(dups).toEqual([]);
  // Fill lanes delete placeholders, so no count or sample is fixed: every placeholder still installed (none once the
  // last lane lands) must name a known lane and stop `unported` with its path, upstream file and lane.
  for (const s of MIRI_STUBS) {
    expect(LANES.has(s.lane)).toBe(true);
    const t = s.target() as Record<string, (() => unknown) | undefined>;
    for (const name of s.names) {
      expect(typeof t[name]).toBe("function");
      let caught: unknown;
      try {
        t[name]!.call(undefined);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Unported);
      expect((caught as Error).message).toContain(`${s.path}::${name} (${s.upstream}; lane ${s.lane})`);
      expect(stub_message(s, name)).toBe(`${s.path}::${name} (${s.upstream}; lane ${s.lane})`);
    }
  }
});

test("every method a module declares on `InterpCx` is a function after load", () => {
  const proto = InterpCx.prototype as unknown as Record<string, unknown>;
  const missing: string[] = [];
  let n = 0;
  for (const m of MODULES) {
    const text = readFileSync(join(REPO, m), "utf8");
    const block = /declare module "[^"]*rustc_const_eval\/interpret\/eval_context\.ts" \{\n {2}interface InterpCx<[^>]*> \{\n([\s\S]*?)\n {2}\}\n\}/.exec(text);
    if (!block) continue;
    for (const d of block[1]!.matchAll(/^ {4}([A-Za-z_]\w*)\s*[<(:]/gm)) {
      n++;
      if (typeof proto[d[1]!] !== "function") missing.push(`${m}: ${d[1]}`);
    }
  }
  expect(missing).toEqual([]);
  expect(n).toBeGreaterThan(390);
});

test("core types: Provenance / ProvenanceExtra / BorTag Debug and the `interpret::Provenance` impl", () => {
  const tag = BorTag.new(7)!;
  expect(BorTag.new(0)).toBeUndefined();
  expect(BorTag.get(tag)).toBe(7);
  expect(BorTag.succ(tag)).toBe(8 as BorTag);
  expect(BorTag.one()).toBe(1 as BorTag);
  expect(BorTag.default()).toBe(1 as BorTag);
  expect(debug_BorTag(tag, PLAIN)).toBe("<7>");
  const prov: Provenance = { $: "Concrete", alloc_id: 5 as AllocId, tag };
  // machine.rs:316: `[{alloc_id:?}]` (`alloc5`, alternate `a5`) then `{tag:?}`
  expect(debug_Provenance(prov, PLAIN)).toBe("[alloc5]<7>");
  expect(debug_Provenance(prov, PRETTY)).toBe("[a5]<7>");
  expect(debug_Provenance(Provenance.Wildcard, PLAIN)).toBe("[wildcard]");
  expect(Provenance_Provenance.OFFSET_IS_ADDR).toBe(true);
  expect(Provenance_Provenance.WILDCARD).toBe(Provenance.Wildcard);
  expect(Provenance_Provenance.get_alloc_id(prov)).toBe(5 as AllocId);
  expect(Provenance_Provenance.get_alloc_id(Provenance.Wildcard)).toBeUndefined();
  // machine.rs:350: `{:#x}` of the absolute address, then the provenance
  expect(Provenance_Provenance.fmt(Pointer.new(prov, Size.from_bytes(0x1f00)), PLAIN)).toBe("0x1f00[alloc5]<7>");
  expect(debug_ProvenanceExtra({ $: "Concrete", _0: tag }, PLAIN)).toBe("<7>");
  expect(debug_ProvenanceExtra(ProvenanceExtra.Wildcard, PLAIN)).toBe("<wildcard>");
  expect(ProvenanceExtra.and_then({ $: "Concrete", _0: tag }, (t) => BorTag.get(t) + 1)).toBe(8);
  expect(ProvenanceExtra.and_then(ProvenanceExtra.Wildcard, () => 1)).toBeUndefined();
});

test("core types: MiriMemoryKind impls, FrameExtra Debug, AllocExtra never clones, MiriInterpCxExt", () => {
  expect(MemoryKind_from_MiriMemoryKind(MiriMemoryKind.C)).toEqual({ $: "Machine", _0: "C" });
  const leaks = Object.values(gen_kinds()).filter((k) => MayLeak_MiriMemoryKind.may_leak(k));
  expect(leaks).toEqual(["Machine", "Global", "ExternStatic", "Tls", "Mmap", "SocketAddress"]);
  const spans = Object.values(gen_kinds()).filter((k) => MiriMemoryKind.should_save_allocation_span(k));
  expect(spans).toEqual(["Rust", "Miri", "C", "WinHeap", "WinLocal", "Mmap"]);
  expect(display_MiriMemoryKind("Global")).toBe("global (static or const)");
  expect(display_MiriMemoryKind("Rust")).toBe("Rust heap");
  // machine.rs:156: struct name `FrameData`, `timing` omitted
  expect(debug_FrameExtra({ borrow_tracker: undefined, catch_unwind: undefined, timing: undefined, user_relevance: 3, data_race: undefined }, PLAIN)).toBe(
    "FrameData { borrow_tracker: None, catch_unwind: None, user_relevance: 3, data_race: None }",
  );
  expect(() => clone_AllocExtra(undefined as never)).toThrow("our allocations should never be cloned");
  const proto = InterpCx.prototype as unknown as { eval_context_ref(this: unknown): unknown; eval_context_mut(this: unknown): unknown };
  const fake = Object.create(InterpCx.prototype) as MiriInterpCx;
  expect(proto.eval_context_ref.call(fake)).toBe(fake);
  expect(proto.eval_context_mut.call(fake)).toBe(fake);
});

function gen_kinds(): Record<string, MiriMemoryKind> {
  const out: Record<string, MiriMemoryKind> = {};
  for (const [k, v] of Object.entries(MiriMemoryKind)) if (typeof v === "string") out[k] = v as MiriMemoryKind;
  return out;
}

test("sym.rs: the extra symbols are interned right after the predefined ones", () => {
  expect(EXTRA_SYMBOLS).toEqual(["sys_mutex_lock", "sys_mutex_try_lock", "sys_mutex_unlock"]);
  expect(sym.sys_mutex_try_lock).toBe(sys_mutex_try_lock);
  create_session_globals_then(DEFAULT_EDITION, EXTRA_SYMBOLS, undefined, () => {
    expect(Symbol.intern("sys_mutex_lock")).toBe(sys_mutex_lock);
    expect(Symbol.intern("sys_mutex_try_lock")).toBe(sys_mutex_try_lock);
    expect(Symbol.intern("sys_mutex_unlock")).toBe(sys_mutex_unlock);
    expect(Symbol.intern("main")).toBe(sym.main);
  });
});

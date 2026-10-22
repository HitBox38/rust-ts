// The interpreter contract (lane interp-contract, docs/handoff/interp-contract.md) against upstream:
// - every fn of compiler/rustc_const_eval/src/{interpret,const_eval,util}/** and lib.rs is either ported (a `// rustc:`
//   marker) or declared (a `// stub: <path>:<line> <name> (lane <lane>)` comment over a declaration whose body calls
//   `unported(..)` with a path in the fn's own module), never both; the stubs per fill lane are the handoff's split table;
// - init order: every hand module of the contract loads as a fresh entry point (no TDZ: the extension modules assign to
//   `InterpCx.prototype` and the generated classes' prototypes at load);
// - runtime: `InterpCx::new` with both machines, the layout cache, `try_destructure_mir_constant_for_user_output` of
//   `()` (the MIR printer's `const ()`), `mk_eval_cx_for_const_val` of a scalar, and where const evaluation stops now.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import { DATA, REPO, UPSTREAM } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import type { ConstValue, DestructuredConstant } from "../../rustc_middle/mir/mod.ts";
import { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { GlobalId } from "../../rustc_middle/mir/interpret/mod.ts";
import { Unported } from "../../std/panic.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine, DummyMachine, mk_eval_cx_for_const_val } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";

const CRATE = "compiler/rustc_const_eval/src/";

/** The scope files: interpret/**, const_eval/**, util/** (sorted walk) and lib.rs. */
function scope_files(): string[] {
  const out: string[] = [];
  const w = (d: string) => {
    for (const e of readdirSync(join(UPSTREAM, d)).sort()) {
      const p = `${d}/${e}`;
      if (statSync(join(UPSTREAM, p)).isDirectory()) w(p);
      else if (p.endsWith(".rs")) out.push(p);
    }
  };
  w(`${CRATE}const_eval`);
  w(`${CRATE}interpret`);
  w(`${CRATE}util`);
  out.push(`${CRATE}lib.rs`);
  return out;
}
const FILES = scope_files();

/** `compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs` -> `rustc_const_eval::interpret::intrinsics::simd`. */
const module_of = (file: string) =>
  ["rustc_const_eval", ...file.slice(CRATE.length).replace(/\.rs$/, "").replace(/\/mod$/, "").replace(/^lib$/, "").split("/")]
    .filter(Boolean)
    .join("::");
const MODULES = FILES.map(module_of);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Decl {
  file: string;
  path: string;
  line: number;
  name: string;
  lane: string | undefined;
  /** the `unported("..")` path of the body below a stub */
  unported: string | undefined;
}
const markers: Decl[] = [];
const stubs: Decl[] = [];
for (const f of walk(join(REPO, "src"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /\/\/ (rustc|rustc-skip|stub): (\S+):(\d+) (\w+)(?: \(lane ([^)]+)\))?/.exec(lines[i]!);
    if (!m || !FILES.includes(m[2]!)) continue;
    const d: Decl = { file: relative(REPO, f), path: m[2]!, line: Number(m[3]), name: m[4]!, lane: m[5], unported: undefined };
    if (m[1] !== "stub") {
      markers.push(d);
      continue;
    }
    // the body of the declaration below: the first `unported("..")` before the next marker
    for (let j = i + 1; j < Math.min(lines.length, i + 24); j++) {
      if (/\/\/ (rustc|stub): /.test(lines[j]!)) break;
      const u = /unported\(["`]([^"`]+)["`]/.exec(lines[j]!);
      if (u) {
        d.unported = u[1];
        break;
      }
    }
    stubs.push(d);
  }
}

test("every fn of interpret/**, const_eval/**, util/** and lib.rs is ported or declared as a stub, never both", () => {
  expect(FILES.length).toBe(38);
  let total = 0;
  for (const file of FILES) {
    const fns = upstreamFns(file);
    total += fns.length;
    const mod = module_of(file);
    for (const fn of fns) {
      const key = `${fn.path}:${fn.line} ${fn.name}`;
      const same = (d: Decl) => d.path === fn.path && d.line === fn.line && d.name === fn.name;
      const m = markers.filter(same);
      const s = stubs.filter(same);
      expect(`${key}: ${m.length + s.length}`).toBe(`${key}: 1`);
      for (const d of s) {
        // the stub's body stops with a path in the fn's own module (the longest scope module that prefixes it)
        const owner = MODULES.filter((p) => d.unported?.startsWith(`${p}::`)).sort((a, b) => b.length - a.length)[0];
        expect(`${key}: ${owner ?? `no unported(..) in ${d.file}`}`).toBe(`${key}: ${mod}`);
        expect(`${key}: ${d.lane !== undefined}`).toBe(`${key}: true`);
      }
    }
    // a stub / marker names an upstream fn of its file
    for (const d of [...stubs, ...markers].filter((d) => d.path === file)) {
      expect(`${d.path}:${d.line} ${d.name}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(`${d.path}:${d.line} ${d.name}: true`);
    }
  }
  expect(total).toBe(657);
  expect(markers.length).toBe(474);
  expect(stubs.length).toBe(183);
});

test("the stubs per fill lane are the handoff's split table", () => {
  const per_lane: Record<string, number> = {};
  for (const d of stubs) per_lane[d.lane!] = (per_lane[d.lane!] ?? 0) + 1;
  expect(per_lane).toEqual({
    // wave 23b (interp-memory: done)
    "interp-place-operand": 112,
    "ctfe-a": 37,
    // wave 24
    // interp-step-call: done (0)
    // interp-ops: done (lane interp-ops, wave 23c)
    "interp-intrinsics": 28,
    // interp-validity-intern: done (wave 23c)
    // ctfe-util: done (wave 23c)
    "interp-simd": 6,
  });
});

// The hand modules of the contract (fn_queries.ts predates it and does not load as a fresh entry at base either).
const ENTRIES = walk(join(REPO, "src/rustc_const_eval"))
  .map((f) => relative(REPO, f))
  .filter((f) => !f.endsWith(".test.ts") && !f.includes("_oracle/") && !f.includes("fn_queries") && !f.includes("check_consts/"))
  .sort();

test("every module of the contract loads as a fresh entry point (init order)", () => {
  expect(ENTRIES.length).toBeGreaterThan(50);
  const failed: string[] = [];
  for (const f of ENTRIES) {
    const r = Bun.spawnSync(["bun", "-e", `await import(${JSON.stringify("./" + f)})`], { cwd: REPO });
    if (r.exitCode !== 0) failed.push(`${f}: ${r.stderr.toString().split("\n").find((l) => /Error/.test(l)) ?? r.exitCode}`);
  }
  expect(failed).toEqual([]);
}, 300_000);

function stops(f: () => unknown, what: string): void {
  let err: unknown;
  try {
    f();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Unported);
  expect((err as Unported).what).toBe(what);
}

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

test("InterpCx::new, the layout cache and the trivial-const entry points run; non-trivial CTFE stops at its fill lane", () => {
  const file = join(DATA, "tmp", "interp-contract", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "interp_contract.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const typing_env = TypingEnv.fully_monomorphized();

      // `InterpCx::new` with both machines; `cur_span` of an empty stack is the root span.
      const ecx = InterpCx.new(tcx, DUMMY_SP, typing_env, CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      expect(ecx.stack().length).toBe(0);
      expect(ecx.cur_span()).toBe(DUMMY_SP);
      expect(ecx.memory.alloc_map_().filter_map_collect((k) => k)).toEqual([]);
      const dummy = InterpCx.new(tcx, DUMMY_SP, typing_env, new DummyMachine());
      expect(dummy.cur_span()).toBe(DUMMY_SP);
      expect(dummy.machine.ALL_CONSTS_ARE_PRECHECKED).toBe(false);
      expect(ecx.machine.ALL_CONSTS_ARE_PRECHECKED).toBe(true);

      // the layout cache: the second `layout_of` is served from `layout_cache` (the same interned `Layout`)
      const l1 = ecx.layout_of(tcx.types.u8);
      const l2 = ecx.layout_of(tcx.types.u8);
      if (l1.$ !== "Ok" || l2.$ !== "Ok") throw new Error("ERROR: layout_of(u8) failed");
      expect(l1._0.size.bytes()).toBe(1);
      expect(l2._0.layout).toBe(l1._0.layout);
      expect(ecx.layout_cache.size).toBe(1);

      // the MIR printer's `const ()`: no fields to destructure
      const unit = tcx.try_destructure_mir_constant_for_user_output({ $: "ZeroSized" } satisfies ConstValue, tcx.types.unit) as
        | DestructuredConstant
        | undefined;
      expect(unit).toEqual({ variant: undefined, fields: [] });

      // a scalar constant becomes an immediate operand of its type's layout
      const r = mk_eval_cx_for_const_val(tcx.at(DUMMY_SP), typing_env, { $: "Scalar", _0: { $: "Int", _0: ScalarInt.from_u8(7) } }, tcx.types.u8);
      if (r === undefined) throw new Error("ERROR: mk_eval_cx_for_const_val failed");
      expect(r[1].op.$).toBe("Immediate");
      expect(r[1].layout.ty).toBe(tcx.types.u8);

      // where const evaluation stops now (the first stub on each path; re-pin as the fill lanes port)
      let c: LocalDefId | undefined;
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Const") c = item.owner_id.def_id;
      }
      if (c === undefined) throw new Error("ERROR: no const C");
      const cid = new GlobalId(Instance.mono(tcx, LocalDefId.to_def_id(c)), undefined);
      stops(
        () => tcx.eval_to_allocation_raw(typing_env.as_query_input(cid)),
        "rustc_const_eval::const_eval::eval_queries::eval_in_interpreter",
      );
      ran = true;
    });
  });
  expect(ran).toBe(true);
}, 120_000);

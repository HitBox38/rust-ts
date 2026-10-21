// The MIR contract (lane mir-contract, docs/handoff/mir-contract.md; plan-m4 D3 / D4) against upstream:
// - every fn of rustc_middle mir/{mod, basic_blocks, traversal, statement, terminator, consts, query, coverage, syntax,
//   visit, pretty}.rs and mir/interpret/{mod, allocation, allocation/init_mask, allocation/provenance_map, value, pointer,
//   error, queries}.rs is ported (`// rustc:` / `// rustc-skip:` marker) or declared as a stub (`// stub: <path>:<line>
//   <name> (lane <lane>)` over a declaration whose body calls `unported(..)` with a path in the fn's own module), never
//   both; visit.rs's `make_mir_visitor!` fns are declared once per expansion (`Visitor`, `MutVisitor`; D4);
// - the stubs per fill lane (the split table of the handoff);
// - every mir module that may be imported from outside mir/ loads as a fresh entry point (init order);
// - runtime: stubs stop as UNPORTED; `BasicBlocks` caches and invalidates; `tcx.mk_place_elem` interns the projection
//   and builds a `mir::Place`; the generated `clone_Body` / Debug / companions exist.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import { DATA, REPO } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import "../lib.ts";
import {
  BasicBlock,
  BasicBlockData,
  BasicBlocks,
  Body,
  clone_Body,
  debug_Location,
  HasLocalDecls,
  Local,
  LocalDecl,
  Location,
  Operand,
  Place,
  RETURN_PLACE,
  START_BLOCK,
  TerminatorKind,
  type PlaceElem,
} from "./mod.ts";
import { AllocId, CtfeProvenance, debug_AllocId, display_AllocId, InterpResult } from "./interpret/mod.ts";
import { MirWriter, write_mir_pretty } from "./pretty.ts";
import { MutVisitor, Visitor } from "./visit.ts";

const MIR = "compiler/rustc_middle/src/mir/";
/** Scope files -> the module path their stubs' `unported(..)` paths start with. */
const FILES: [string, string][] = [
  ["mod.rs", "rustc_middle::mir::"],
  ["basic_blocks.rs", "rustc_middle::mir::basic_blocks::"],
  ["traversal.rs", "rustc_middle::mir::traversal::"],
  ["statement.rs", "rustc_middle::mir::statement::"],
  ["terminator.rs", "rustc_middle::mir::terminator::"],
  ["consts.rs", "rustc_middle::mir::consts::"],
  ["query.rs", "rustc_middle::mir::query::"],
  ["coverage.rs", "rustc_middle::mir::coverage::"],
  ["syntax.rs", "rustc_middle::mir::syntax::"],
  ["visit.rs", "rustc_middle::mir::visit::"],
  ["pretty.rs", "rustc_middle::mir::pretty::"],
  ["interpret/mod.rs", "rustc_middle::mir::interpret::"],
  ["interpret/allocation.rs", "rustc_middle::mir::interpret::allocation::"],
  ["interpret/allocation/init_mask.rs", "rustc_middle::mir::interpret::allocation::init_mask::"],
  ["interpret/allocation/provenance_map.rs", "rustc_middle::mir::interpret::allocation::provenance_map::"],
  ["interpret/value.rs", "rustc_middle::mir::interpret::value::"],
  ["interpret/pointer.rs", "rustc_middle::mir::interpret::pointer::"],
  ["interpret/error.rs", "rustc_middle::mir::interpret::error::"],
  ["interpret/queries.rs", "rustc_middle::mir::interpret::queries::"],
].map(([f, m]) => [MIR + f, m] as [string, string]);

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
  kind: "rustc" | "rustc-skip" | "stub";
  path: string;
  line: number;
  name: string;
  lane: string | undefined;
  /** the `unported("..")` path of the body below a stub */
  unported: string | undefined;
}
const decls: Decl[] = [];
for (const f of walk(join(REPO, "src"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /\/\/ (rustc|rustc-skip|stub): (\S+):(\d+) (\w+)(?: \(lane ([\w-]+)\))?/.exec(lines[i]!);
    if (!m || !m[2]!.startsWith(MIR)) continue;
    const d: Decl = { file: relative(REPO, f), kind: m[1] as Decl["kind"], path: m[2]!, line: Number(m[3]), name: m[4]!, lane: m[5], unported: undefined };
    if (d.kind === "stub") {
      for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
        if (/\/\/ (rustc|rustc-skip|stub): /.test(lines[j]!)) break;
        const u = /unported\(["`]([^"`]+)["`]/.exec(lines[j]!);
        if (u) {
          d.unported = u[1];
          break;
        }
      }
    }
    decls.push(d);
  }
}

test("every fn of the mir files is ported or declared as a stub (visit.rs: once per expansion), never both", () => {
  let total = 0;
  for (const [file, prefix] of FILES) {
    const fns = upstreamFns(file);
    total += fns.length;
    for (const fn of fns) {
      const key = `${fn.path}:${fn.line} ${fn.name}`;
      const ds = decls.filter((d) => d.path === fn.path && d.line === fn.line && d.name === fn.name);
      const kinds = new Set(ds.map((d) => (d.kind === "stub" ? "stub" : "marker")));
      // one declaration; visit.rs's macro fns one per `Visitor` / `MutVisitor`, all of one kind
      const ok = ds.length === 1 || (file.endsWith("visit.rs") && ds.length === 2 && kinds.size === 1);
      expect(`${key}: ${ds.length} ${[...kinds].join("+")}`).toBe(`${key}: ${ok ? ds.length : "1 (2 for visit.rs)"} ${[...kinds].join("+")}`);
      for (const d of ds.filter((d) => d.kind === "stub")) {
        expect(`${key}: ${d.lane !== undefined && d.unported?.startsWith(prefix.replace(/::$/, ""))}`).toBe(`${key}: true`);
      }
    }
    // a declaration names an upstream fn of its file
    for (const d of decls.filter((d) => d.path === file)) {
      expect(`${d.path}:${d.line} ${d.name}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(`${d.path}:${d.line} ${d.name}: true`);
    }
  }
  for (const d of decls) expect(FILES.some(([f]) => f === d.path)).toBe(true);
  expect(total).toBe(715);
});

test("stubs per fill lane (the split table of docs/handoff/mir-contract.md)", () => {
  const per = new Map<string, number>();
  for (const d of decls.filter((d) => d.kind === "stub")) per.set(d.lane!, (per.get(d.lane!) ?? 0) + 1);
  expect(Object.fromEntries([...per].sort())).toEqual({
    "mir-body-a": 103,
    "mir-body-b": 181,
    "mir-interp-a": 91,
    // mir-interp-b: 0 (lane mir-interp-b ported its 184)
    "mir-pretty": 43,
    "mir-visit": 125,
  });
});

/** Modules that may be imported from outside mir/ (mir/mod.ts header): each loads as a fresh entry point. */
const ENTRIES = [
  "src/rustc_middle/lib.ts",
  "src/rustc_middle/ty/context.ts",
  "src/rustc_middle/mir/mod.ts",
  "src/rustc_middle/mir/query.ts",
  "src/rustc_middle/mir/consts.ts",
  "src/rustc_middle/mir/statement.ts",
  "src/rustc_middle/mir/terminator.ts",
  "src/rustc_middle/mir/basic_blocks.ts",
  "src/rustc_middle/mir/traversal.ts",
  "src/rustc_middle/mir/visit.ts",
  "src/rustc_middle/mir/pretty.ts",
  "src/rustc_middle/mir/coverage.ts",
  "src/rustc_middle/mir/interpret/mod.ts",
  "src/rustc_middle/mir/interpret/allocation.ts",
  "src/rustc_middle/mir/interpret/error.ts",
  "src/rustc_middle/mir/interpret/pointer.ts",
  "src/rustc_middle/mir/interpret/value.ts",
];
test("mir modules load as fresh entry points (init order)", () => {
  for (const m of ENTRIES) {
    const r = Bun.spawnSync(["bun", "-e", `await import(${JSON.stringify(join(REPO, m))})`], { stdout: "pipe", stderr: "pipe" });
    expect(`${m}: ${r.exitCode === 0 ? "ok" : r.stderr.toString().split("\n").find((l) => /Error/.test(l))}`).toBe(`${m}: ok`);
  }
}, 120000);

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

test("stubs stop as UNPORTED with their own path", () => {
  stops(() => Body.new_cfg_only([]), "rustc_middle::mir::Body::new_cfg_only");
  stops(() => LocalDecl.new(null as never, DUMMY_SP), "rustc_middle::mir::LocalDecl::new");
  stops(() => Local.arg(0), "rustc_middle::mir::Local::arg");
  stops(() => Operand.is_move(null as never), "rustc_middle::mir::statement::Operand::is_move");
  stops(() => TerminatorKind.successors(null as never), "rustc_middle::mir::terminator::TerminatorKind::successors");
  stops(() => new MirWriter(null as never, () => null as never, null as never).write_mir_fn(null as never, null as never), "rustc_middle::mir::pretty::MirWriter::write_mir_fn");
  stops(() => write_mir_pretty(null as never, null as never), "rustc_middle::mir::pretty::write_mir_pretty");
  // (lane mir-interp-b: interpret/{mod, value, pointer, error, queries}.rs are ported, no stubs left)
  expect(CtfeProvenance.alloc_id(1n as CtfeProvenance)).toBe(1 as AllocId);
  expect(InterpResult.unwrap({ $: "Ok", _0: 1 })).toBe(1);
  class V extends Visitor {}
  stops(() => new V().visit_body(null as never), "rustc_middle::mir::visit::Visitor::visit_body");
  class M extends MutVisitor {
    tcx(): never {
      throw new Error("unused");
    }
  }
  stops(() => new M().visit_local({ value: RETURN_PLACE }, null as never, null as never), "rustc_middle::mir::visit::MutVisitor::visit_local");
});

test("ported glue: HasLocalDecls, Location / AllocId Debug, BasicBlocks caches", () => {
  expect(HasLocalDecls.local_decls([])).toEqual([]);
  expect(debug_Location(new Location(BasicBlock.from_u32(3), 2), PLAIN)).toBe("bb3[2]");
  expect(debug_AllocId(7 as AllocId, PLAIN)).toBe("alloc7");
  expect(display_AllocId(7 as AllocId, { alternate: true })).toBe("a7");
  expect(Location.START.block).toBe(START_BLOCK);
  // `as_mut()` invalidates the CFG caches, `as_mut_preserves_cfg()` keeps them; a clone shares the cache (`Arc`)
  const bbs = BasicBlocks.new([Object.create(BasicBlockData.prototype) as BasicBlockData]);
  bbs.cache.predecessors = [[]];
  const cache = bbs.cache;
  bbs.as_mut_preserves_cfg();
  expect(bbs.cache).toBe(cache);
  expect(bbs.predecessors()).toEqual([[]]);
  expect(bbs.num_nodes()).toBe(1);
  expect(bbs.start_node()).toBe(START_BLOCK);
  bbs.as_mut();
  expect(bbs.cache).not.toBe(cache);
  expect(bbs.cache.predecessors).toBeUndefined();
  expect(typeof clone_Body).toBe("function");
});

const WORK = join(DATA, "tmp", "mir-contract", process.env.RUST_TS_AGENT ?? "default");
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

test("tcx.mk_place_elems interns; mk_place_deref / mk_place_index build a mir::Place", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "mir_contract.rs");
  writeFileSync(file, "#![feature(no_core)]\n#![no_core]\npub fn f() {}\n");
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      const deref: PlaceElem = { $: "Deref" };
      const a = tcx.mk_place_elems([deref, { $: "Index", _0: Local.from_u32(1) }]);
      const b = tcx.mk_place_elems([{ $: "Deref" }, { $: "Index", _0: Local.from_u32(1) }]);
      expect(a).toBe(b);
      const base = new Place(RETURN_PLACE, tcx.mk_place_elems([]));
      const p = tcx.mk_place_index(tcx.mk_place_deref(base), Local.from_u32(1));
      expect(p).toBeInstanceOf(Place);
      expect(p.projection).toBe(a);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}, 120000);

// The rustc_borrowck contract (lane borrowck-contract, docs/handoff/borrowck-contract.md, plan-m4 wave 23) against
// upstream:
// - every fn of compiler/rustc_borrowck/src/** is either ported (a `// rustc:` marker) or declared (a `// stub:
//   <path>:<line> <name> (lane <lane>)` comment over a declaration whose body calls `unported(..)` with a path in the
//   fn's own module), never both; the stubs per fill lane are the handoff's split table;
// - every module of the crate loads as a fresh entry point (init order: lib.ts's header);
// - the `mir_borrowck` hub (`provide`, `mir_borrowck`, root_cx.rs, `borrowck_collect_region_constraints`): a trivial
//   const and a typeck-tainted body return without borrowck, a real body reaches the first stub on its path.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { DATA, REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, DEFAULT_QUERY_PROVIDERS, parse } from "../rustc_interface/passes.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Unported } from "../std/panic.ts";
import { InitializationRequiringAction } from "./lib.ts";

const CRATE = "compiler/rustc_borrowck/src/";

/** Every upstream file of the crate (upstream module order of the walk). */
function scope_files(): string[] {
  const out: string[] = [];
  const w = (d: string) => {
    for (const e of readdirSync(join(UPSTREAM, d)).sort()) {
      const p = `${d}/${e}`;
      if (statSync(join(UPSTREAM, p)).isDirectory()) w(p);
      else if (p.endsWith(".rs")) out.push(p);
    }
  };
  w(CRATE.slice(0, -1));
  return out;
}
const FILES = scope_files();

/** `compiler/rustc_borrowck/src/type_check/mod.rs` -> `rustc_borrowck::type_check`; lib.rs -> `rustc_borrowck`. */
const module_of = (file: string) =>
  ["rustc_borrowck", ...file.slice(CRATE.length).replace(/\.rs$/, "").replace(/(^|\/)(mod|lib)$/, "").split("/").filter((s) => s !== "")].join("::");
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
    const m = /\/\/ (rustc|stub): (\S+):(\d+) (\w+)(?: \(lane ([^)]+)\))?/.exec(lines[i]!);
    if (!m || !FILES.includes(m[2]!)) continue;
    const d: Decl = { file: relative(REPO, f), path: m[2]!, line: Number(m[3]), name: m[4]!, lane: m[5], unported: undefined };
    if (m[1] === "rustc") {
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

test("every fn of rustc_borrowck is ported or declared as a stub, never both", () => {
  expect(FILES.length).toBe(62);
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
        // the stub's body stops with a path in the fn's own module (the longest crate module that prefixes it)
        const owner = MODULES.filter((p) => d.unported === p || d.unported?.startsWith(`${p}::`)).sort((a, b) => b.length - a.length)[0];
        expect(`${key}: ${owner ?? `no unported(..) in ${d.file}`}`).toBe(`${key}: ${mod}`);
        expect(`${key}: ${d.lane !== undefined}`).toBe(`${key}: true`);
      }
    }
    // a stub / marker names an upstream fn of its file
    for (const d of [...stubs, ...markers].filter((d) => d.path === file)) {
      expect(`${d.path}:${d.line} ${d.name}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(`${d.path}:${d.line} ${d.name}: true`);
    }
  }
  expect(total).toBe(901);
  expect(markers.length).toBe(42);
  expect(stubs.length).toBe(859);
});

test("the stubs per fill lane are the handoff's split table", () => {
  const per_lane: Record<string, number> = {};
  for (const d of stubs) per_lane[d.lane!] = (per_lane[d.lane!] ?? 0) + 1;
  expect(per_lane).toEqual({
    "bck-lib-a": 8,
    "bck-lib-b": 22,
    "bck-core": 64,
    "bck-nll": 64,
    "bck-tc-a": 39,
    "bck-tc-b": 68,
    "bck-tc-live": 34,
    "bck-regions-a": 85,
    "bck-regions-b": 94,
    "bck-polonius": 39,
    "bck-diag-a": 34,
    "bck-diag-b": 42,
    "bck-diag-c": 37,
    "bck-diag-d": 70,
    "bck-diag-e": 48,
    "bck-diag-f": 70,
    "bck-polonius-legacy": 41,
  });
  // lib.rs is split at line 1400 (bck-lib-a / bck-lib-b), conflict_errors.rs at line 2469 (bck-diag-a / bck-diag-b)
  for (const d of stubs.filter((d) => d.path === `${CRATE}lib.rs`)) {
    expect(`${d.line} ${d.name}: ${d.lane}`).toBe(`${d.line} ${d.name}: ${d.line < 1400 ? "bck-lib-a" : "bck-lib-b"}`);
  }
  for (const d of stubs.filter((d) => d.path === `${CRATE}diagnostics/conflict_errors.rs`)) {
    expect(`${d.line} ${d.name}: ${d.lane}`).toBe(`${d.line} ${d.name}: ${d.line < 2469 ? "bck-diag-a" : "bck-diag-b"}`);
  }
  // the legacy polonius fns every borrowck run reaches belong to an M4b lane (bck-nll), the rest to wave 26
  for (const d of stubs.filter((d) => d.path.startsWith(`${CRATE}polonius/legacy/`))) {
    const main_path = d.path.endsWith("/location.rs") || (d.path.endsWith("/facts.rs") && d.name === "enabled") || (d.path.endsWith("/legacy/mod.rs") && d.name === "emit_facts");
    expect(`${d.path}:${d.line} ${d.name}: ${d.lane}`).toBe(`${d.path}:${d.line} ${d.name}: ${main_path ? "bck-nll" : "bck-polonius-legacy"}`);
  }
});

test("every rustc_borrowck module loads as a fresh entry point (init order)", async () => {
  // hand modules only: a `.gen.ts` is entered through its hand module (tools/codegen/types.ts `viaHand`); the generated
  // modules that import their own hand module's manual impls (constraints/mod.gen.ts, region_infer/mod.gen.ts) are not
  // entry points
  const entries = walk(join(REPO, "src/rustc_borrowck")).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".gen.ts")).sort();
  expect(entries.length).toBe(62);
  const results: string[] = [];
  // a few processes at a time
  for (let i = 0; i < entries.length; i += 8) {
    const batch = entries.slice(i, i + 8).map(async (m) => {
      const p = Bun.spawn(["bun", "-e", `await import(${JSON.stringify(m)})`], { stdout: "pipe", stderr: "pipe" });
      const code = await p.exited;
      const err = code === 0 ? "ok" : (await new Response(p.stderr).text()).split("\n").find((l) => /Error/.test(l));
      return `${relative(REPO, m)}: ${err}`;
    });
    results.push(...(await Promise.all(batch)));
  }
  expect(results.filter((r) => !r.endsWith(": ok"))).toEqual([]);
}, 600000);

test("ported enum methods: InitializationRequiringAction", () => {
  expect(InitializationRequiringAction.as_noun("MatchOn")).toBe("use");
  expect(InitializationRequiringAction.as_verb_in_past_tense("PartialAssignment")).toBe("partially assigned");
  expect(InitializationRequiringAction.as_general_verb_in_past_tense("Borrow")).toBe("used");
});

test("provide installs the crate's providers", () => {
  const providers = DEFAULT_QUERY_PROVIDERS();
  for (const q of ["mir_borrowck", "mir_borrowck_implied_outlives_bounds"] as const) {
    expect(String(providers.queries[q])).not.toContain("provider (not ported)");
  }
});

const WORK = join(DATA, "tmp", "borrowck-contract", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`);

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

// A no_core crate: a trivial const (no borrowck), a body whose typeck is tainted (E0308: `mir_built` is
// `construct_error`'s body, `mir_borrowck` returns its `ErrorGuaranteed`), and a real fn.
const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
  "#[lang = \"copy\"] pub trait Copy {}",
  "impl Copy for u8 {}",
  "pub const C: u8 = 1;",
  "pub fn bad() -> u8 { true }",
  "pub fn f(x: u8) -> u8 { x }",
].join("\n");

test("mir_borrowck: trivial const and tainted body return early; a real body reaches the first stub", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "borrowck_contract.rs");
  writeFileSync(file, SRC);
  let ran = false;
  let fatal: unknown;
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", "-Zui-testing", file]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        const items = new Map<string, LocalDefId>();
        for (const id of tcx.hir_free_items()) {
          const item = tcx.hir_item(id);
          const k = item.kind as { $: string; ident?: { name: Symbol }; _0?: { name: Symbol } };
          const ident = k.$ === "Fn" ? k.ident : k.$ === "Const" ? k._0 : undefined;
          if (ident !== undefined) items.set(Symbol.as_str(ident.name), item.owner_id.def_id);
        }

        // `is_trivial_const`: `Ok` with no hidden types, before `mir_promoted`
        const c = tcx.mir_borrowck(items.get("C")!);
        expect(c.$).toBe("Ok");
        expect(c.$ === "Ok" && c._0.size).toBe(0);

        // typeck reported E0308: the built body is tainted, so borrowck is skipped with that error
        const bad = tcx.mir_borrowck(items.get("bad")!);
        expect(bad.$).toBe("Err");

        // a real body: `BorrowCheckRootCtxt::do_mir_borrowck` -> `borrowck_collect_region_constraints` -> the
        // `BorrowckInferCtxt`, the promoted MIR, then the first stub (lane bck-nll)
        stops(() => tcx.mir_borrowck(items.get("f")!), "rustc_borrowck::nll::replace_regions_in_mir");
        ran = true;
      });
    });
  } catch (e) {
    fatal = e;
  }
  expect(ran).toBe(true);
  // the session ends with the E0308 error: rustc aborts ("aborting due to 1 previous error"), an unwind
  expect(fatal).toBeDefined();
  expect(fatal).not.toBeInstanceOf(Unported);
});


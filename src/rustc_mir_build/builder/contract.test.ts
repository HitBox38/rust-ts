// The `Builder` contract (lane builder-contract, docs/handoff/builder-contract.md) against upstream:
// - every fn of compiler/rustc_mir_build/src/builder/** and check_tail_calls.rs is either ported (a `// rustc:` marker) or
//   declared (a `// stub: <path>:<line> <name> (lane <lane>)` comment over a declaration whose body calls `unported(..)`
//   with a path in the fn's own module), never both; the stubs per fill lane are the split table of the handoff;
// - `construct_error` (ported) builds the error body rustc builds; the `build_mir_inner_impl` hook (set by `provide`)
//   reaches the real `check_tail_calls` provider and `construct_fn`, then stops at the first stub on its path.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import { DATA, REPO, UPSTREAM } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import "../../rustc_middle/lib.ts";
import { type Body, START_BLOCK } from "../../rustc_middle/mir/mod.ts";
import type { ExprId, Thir } from "../../rustc_middle/thir.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Unported } from "../../std/panic.ts";
import "../lib.ts";
import { construct_error, construct_fn } from "./mod.ts";

const CRATE = "compiler/rustc_mir_build/src/";

/** The scope files: builder/** (upstream module order of the walk) and check_tail_calls.rs. */
function scope_files(): string[] {
  const out: string[] = [];
  const w = (d: string) => {
    for (const e of readdirSync(join(UPSTREAM, d)).sort()) {
      const p = `${d}/${e}`;
      if (statSync(join(UPSTREAM, p)).isDirectory()) w(p);
      else if (p.endsWith(".rs")) out.push(p);
    }
  };
  w(`${CRATE}builder`);
  out.push(`${CRATE}check_tail_calls.rs`);
  return out;
}
const FILES = scope_files();

/** `compiler/rustc_mir_build/src/builder/expr/mod.rs` -> `rustc_mir_build::builder::expr`. */
const module_of = (file: string) => "rustc_mir_build::" + file.slice(CRATE.length).replace(/\.rs$/, "").replace(/\/mod$/, "").split("/").join("::");
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

test("every fn of builder/** and check_tail_calls.rs is ported or declared as a stub, never both", () => {
  expect(FILES.length).toBe(25);
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
  expect(total).toBe(313);
  expect(markers.length).toBe(101);
  expect(stubs.length).toBe(212);
});

test("the stubs per fill lane are the handoff's split table", () => {
  const per_lane: Record<string, number> = {};
  for (const d of stubs) per_lane[d.lane!] = (per_lane[d.lane!] ?? 0) + 1;
  expect(per_lane).toEqual({
    "mb-mod": 25,
    "mb-scope": 54,
    "mb-expr-a": 42,
    "mb-expr-b": 11,
    "mb-matches-a": 28,
    "mb-matches-b": 21,
    "mb-matches-c": 31,
  });
  // matches/mod.rs is split at line 1500 between mb-matches-a and mb-matches-b
  for (const d of stubs.filter((d) => d.path === `${CRATE}builder/matches/mod.rs`)) {
    expect(`${d.line} ${d.name}: ${d.lane}`).toBe(`${d.line} ${d.name}: ${d.line < 1500 ? "mb-matches-a" : "mb-matches-b"}`);
  }
});

const WORK = join(DATA, "tmp", "builder-contract", process.env.RUST_TS_AGENT ?? "default");

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

test("construct_error builds rustc's error body; build_mir_inner_impl reaches construct_fn and stops at a stub", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "builder_contract.rs");
  writeFileSync(
    file,
    "#![feature(no_core, lang_items)]\n#![no_core]\n#![allow(internal_features)]\n" +
      '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
      "pub fn f(x: u8, y: bool) -> u8 { x }\n",
  );
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      let f: LocalDefId | undefined;
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn" && Symbol.as_str(item.kind.ident.name) === "f") f = item.owner_id.def_id;
      }
      if (f === undefined) throw new Error("ERROR: no fn f");

      // construct_error: locals `[return, args..]`, one block terminated by `Unreachable`, tainted by the error
      const guar = ErrorGuaranteed.unchecked_error_guaranteed();
      const body: Body = construct_error(tcx, f, guar);
      expect(body.arg_count).toBe(2);
      expect(body.local_decls.map((d) => d.ty)).toEqual([tcx.types.u8, tcx.types.u8, tcx.types.bool]);
      expect(body.basic_blocks.basic_blocks.length).toBe(1);
      expect(body.basic_blocks.basic_blocks[START_BLOCK as unknown as number]!.statements.length).toBe(0);
      expect(body.basic_blocks.basic_blocks[START_BLOCK as unknown as number]!.terminator!.kind.$).toBe("Unreachable");
      expect(body.source_scopes.length).toBe(1);
      expect(body.tainted_by_errors).toBe(guar);
      expect(body.coroutine).toBeUndefined();

      // the hook (set by `provide`) runs; it stops at `check_match` (lane thir-pattern), before check_tail_calls / thir_body
      stops(() => tcx.build_mir_inner_impl(f), "rustc_mir_build::thir::pattern::check_match::check_match (lane thir-pattern)");
      // the rest of its path: the `check_tail_calls` provider (ported) accepts a body without `become`
      expect(tcx.check_tail_calls(f)).toEqual({ $: "Ok", _0: null });
      // `thir_body` -> `construct_fn` -> `Builder::new` (ported) -> the first stub on the path
      const r = tcx.thir_body(f) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
      if (r.$ !== "Ok") throw new Error("ERROR: thir_body failed");
      const [thir, expr] = r._0;
      const thir_ = thir.borrow();
      if (thir_.body_type.$ !== "Fn") throw new Error("ERROR: not a fn body");
      const sig = thir_.body_type._0;
      stops(() => construct_fn(tcx, f!, thir_, expr, sig), "rustc_mir_build::builder::scope::Builder::in_scope"); // lane mb-scope
      ran = true;
    });
  });
  expect(ran).toBe(true);
});

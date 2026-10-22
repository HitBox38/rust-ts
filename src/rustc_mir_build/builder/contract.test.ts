// The `Builder` contract (lane builder-contract, docs/handoff/builder-contract.md) against upstream:
// - every fn of compiler/rustc_mir_build/src/builder/** and check_tail_calls.rs is either ported (a `// rustc:` marker) or
//   declared (a `// stub: <path>:<line> <name> (lane <lane>)` comment over a declaration whose body calls `unported(..)`
//   with a path in the fn's own module), never both; the stubs per fill lane are the split table of the handoff;
// - `construct_error` (ported) builds the error body rustc builds; the `build_mir_inner_impl` hook (set by `provide`)
//   runs `check_match` (stopping at rustc_pattern_analysis's `lower_pat` until lane pat-c lands); `construct_fn` builds
//   the MIR of real fns, and the pass manager's `-Zdump-mir=built` dump of it (`dump_mir_for_phase_change`, as
//   `mir_built` dumps it) is byte-identical to the pinned rustc's.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import { DATA, PIN, REPO, UPSTREAM } from "../../../scripts/lib/common.ts";
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
import { dump_mir_for_phase_change } from "../../rustc_mir_transform/pass_manager.ts";
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
  expect(markers.length).toBe(313);
  expect(stubs.length).toBe(0);
});

test("the stubs per fill lane are the handoff's split table", () => {
  const per_lane: Record<string, number> = {};
  for (const d of stubs) per_lane[d.lane!] = (per_lane[d.lane!] ?? 0) + 1;
  // every fill lane is done (wave 22; merge-w22 ported mb-matches-b's `static_pattern_match[_inner]` once pat-b declared
  // rustc_pattern_analysis): no stub is left
  expect(per_lane).toEqual({});
  // matches/mod.rs is split at line 1500 between mb-matches-a and mb-matches-b
  for (const d of stubs.filter((d) => d.path === `${CRATE}builder/matches/mod.rs`)) {
    expect(`${d.line} ${d.name}: ${d.lane}`).toBe(`${d.line} ${d.name}: ${d.line < 1500 ? "mb-matches-a" : "mb-matches-b"}`);
  }
});

const WORK = join(DATA, "tmp", "builder-contract", process.env.RUST_TS_AGENT ?? "default");

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

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

/** The `.mir` files of a dump directory: name -> text. */
function dumps(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of readdirSync(dir).sort()) out.set(n, readFileSync(join(dir, n), "utf8"));
  return out;
}

// A no_core crate with the lang items MIR building needs (`Copy`: `consume_by_copy_or_move`; the operator traits),
// and bodies covering arguments, an `if` (switchInt, temps with StorageLive/Dead, scopes), `let` bindings and a
// destructuring `let`, overflow-checked arithmetic (`Assert`), a tuple aggregate and a field read, a call, a `loop`
// with `break`, `&&` / `||` / `!`, a `match` on a tuple with integer ranges, a bool and wildcards, and trait methods
// (`*self`, the `eq` / `add` / `not` lang-item impls). No body has a `()`-typed constant: printing `const ()` goes
// through rustc_const_eval's `try_destructure_mir_constant_for_user_output` (not ported yet).
const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
  "#[lang = \"copy\"] pub trait Copy {}",
  "impl Copy for u8 {}",
  "impl Copy for bool {}",
  "#[lang = \"add\"] pub trait Add<Rhs = Self> { type Output; fn add(self, rhs: Rhs) -> Self::Output; }",
  "impl Add for u8 { type Output = u8; fn add(self, rhs: u8) -> u8 { self + rhs } }",
  "#[lang = \"legacy_receiver\"] pub trait LegacyReceiver {}",
  "impl<T: ?Sized> LegacyReceiver for &T {}",
  "#[lang = \"eq\"] pub trait PartialEq<Rhs: ?Sized = Self> { fn eq(&self, other: &Rhs) -> bool; }",
  "impl PartialEq for u8 { fn eq(&self, other: &u8) -> bool { *self == *other } }",
  "#[lang = \"not\"] pub trait Not { type Output; fn not(self) -> Self::Output; }",
  "impl Not for bool { type Output = bool; fn not(self) -> bool { !self } }",
  "pub fn f(x: u8, y: bool) -> u8 { x }",
  "pub fn g(x: u8, y: bool) -> u8 { if y { x } else { 5 } }",
  "pub fn h(a: u8, b: u8) -> u8 { let c = a + b; let d = (c, a); d.0 }",
  "pub fn k(n: u8) -> u8 { let mut i = 0; loop { i = h(i, 1); match i == n { true => break i, false => continue } } }",
  "pub fn m(n: u8, b: bool) -> u8 { match (n, b) { (0, _) => 1, (1..=9, true) => 2, (_, false) => 3, _ => 4 } }",
  "pub struct S { pub a: u8, pub b: bool }",
  "pub fn s(x: S) -> u8 { let S { a, b } = x; if b && a == 2 || !b { a } else { 0 } }",
].join("\n");

test.skipIf(SKIP)("construct_error builds rustc's error body; construct_fn's MIR is the oracle's -Zdump-mir=built", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "builder_contract.rs");
  writeFileSync(file, SRC);
  const oracle_dir = join(WORK, "oracle");
  const port_dir = join(WORK, "port");
  for (const d of [oracle_dir, port_dir]) {
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
  }
  const flags = ["--crate-type", "lib", "--edition", "2024", "-Zdump-mir=built"];
  // the oracle: the files `mir_built` dumps
  const o = Bun.spawnSync([...RUSTC, ...flags, `-Zdump-mir-dir=${oracle_dir}`, "--emit=metadata", "-o", join(WORK, "libbuilder_contract.rmeta"), file], {
    cwd: WORK,
    env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
  });
  if (o.exitCode !== 0) throw new Error(`ERROR: oracle failed: ${o.stderr.toString()}`);
  const oracle = dumps(oracle_dir);
  expect(oracle.size).toBe(9);

  let ran = false;
  run_compiler(config_from_args([...flags, `-Zdump-mir-dir=${port_dir}`, file]), (compiler) => {
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

      // the hook (set by `provide`) runs `check_match`, which checks the params `x`, `y` and stops at
      // rustc_pattern_analysis's `lower_pat` (lane pat-c; move this pin when it lands), before check_tail_calls / thir_body
      stops(() => tcx.build_mir_inner_impl(f), "rustc_pattern_analysis::rustc::RustcPatCtxt::lower_pat");
      // the rest of its path: the `check_tail_calls` provider accepts a body without `become`
      expect(tcx.check_tail_calls(f)).toEqual({ $: "Ok", _0: null });

      // every body: `thir_body` -> `construct_fn`, then the dump `mir_built` writes (pass_manager.rs
      // `dump_mir_for_phase_change`)
      tcx.par_hir_body_owners((def) => {
        const r = tcx.thir_body(def) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
        if (r.$ !== "Ok") throw new Error("ERROR: thir_body failed");
        const [thir, expr] = r._0;
        const thir_ = thir.borrow();
        if (thir_.body_type.$ !== "Fn") throw new Error("ERROR: not a fn body");
        const built = construct_fn(tcx, def, thir_, expr, thir_.body_type._0);
        dump_mir_for_phase_change(tcx, built);
      });
      ran = true;
    });
  });
  expect(ran).toBe(true);
  const port = dumps(port_dir);
  expect([...port.keys()]).toEqual([...oracle.keys()]);
  for (const [n, text] of oracle) expect(`${n}:\n${port.get(n)}`).toBe(`${n}:\n${text}`);
});

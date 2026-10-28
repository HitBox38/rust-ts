// Oracle test for lane meta-mir: MIR bodies decoded from crate metadata (the `optimized_mir` / `mir_for_ctfe` /
// `promoted_mir` / `trivial_const` tables of cstore_impl.rs, through the generated `derive(TyDecodable)` of the
// rustc_middle_mir set, rustc_middle ty/codec.rs and the crate's `AllocDecodingSession`).
//
// The pinned rustc compiles an aux crate (`AUX` below) twice, with the same flags: once with `--emit=metadata
// -Zalways-encode-mir` (the `.rmeta` the port then loads), once with `-Zunpretty=mir` (its MIR, pretty-printed by the
// oracle from the local queries). The port compiles `extern crate mm_aux;` against that `.rmeta` and pretty-prints every
// body of the aux crate through `MirWriter` exactly as `write_mir_pretty` (mir/pretty.rs:318) does for local items,
// but for the extern `DefId`s, whose bodies come from crate metadata. The two outputs are compared item by item (the
// blank-line-separated blocks of `write_mir_pretty`, as a sorted list: the oracle walks `mir_keys`, the port the aux
// crate's `DefIndex`es; constructors: see `render_items`). The only normalisation: the port's paths of aux items carry the crate name (`mm_aux::f`),
// which the oracle prints crate-relative (`f`), so `mm_aux::` is removed from the port's text.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import { type ConstValue, display_Const } from "../../rustc_middle/mir/consts.ts";
import { MirWriter } from "../../rustc_middle/mir/pretty.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty, with_forced_impl_filename_line } from "../../rustc_middle/ty/print/pretty.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type CrateNum, DefId, DefIndex } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { VecU8 } from "../../vendor/anstream/stream.ts";
import { creader } from "../lib.ts";
import { fse_Option_LazyValue } from "./table.ts";

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

const WORK = join(DATA, "tmp", "rmeta-mir-oracle", process.env.RUST_TS_AGENT ?? "default");
const TUPLE = "x86_64-unknown-linux-gnu";
const AUX_NAME = "mm_aux";

/** The aux crate: scalar arithmetic and checked ops (`Assert`), loops and `match` (`SwitchInt`), references, slices
 *  and arrays (projections), structs / enums / tuples (aggregates, downcasts), generics, consts with and without
 *  bodies, statics, string / byte-string literals and promoteds (allocations with provenance), `core` calls, const fns.
 *  No closures: the MIR printer renders a non-local closure differently from a local one by design (`{closure@<def
 *  path>}` and positional upvar names instead of the span and the upvars' names, ty/print/pretty.rs / mir/pretty.rs).
 *  No tuple variants: trimmed paths (`trimmed_def_paths`) shorten a visible foreign variant's path (`Circle`), never a
 *  local one (`Shape::Circle`); the tuple struct `Wrap` covers constructors. */
const AUX = `#![no_std]
pub struct Point { pub x: i32, pub y: i32 }
pub enum Shape { Circle { r: u32 }, Rect { w: u16, h: u16 }, Empty }
pub struct Wrap(pub u8, pub bool);
pub const ANSWER: i32 = 42;
pub const COMPUTED: u64 = (1u64 << 40) + ANSWER as u64;
pub const NAME: &str = "meta-mir";
pub const BYTES: &[u8; 3] = b"abc";
pub const PAIR: (i8, char) = (i8::MIN, 'z');
pub static TABLE: [u16; 4] = [1, 2, 3, 0xffff];
pub static GREETING: &str = "hello";
pub fn add(a: i32, b: i32) -> i32 { a + b }
pub fn div(a: u32, b: u32) -> u32 { a / b }
pub fn sum(xs: &[i64]) -> i64 { let mut s = 0; let mut i = 0; while i < xs.len() { s += xs[i]; i += 1; } s }
pub fn area(s: &Shape) -> u64 {
    match *s { Shape::Circle { r } => 3 * (r as u64) * (r as u64), Shape::Rect { w, h } => w as u64 * h as u64, Shape::Empty => 0 }
}
pub fn swap(p: Point) -> Point { Point { x: p.y, y: p.x } }
pub fn first(p: &mut Point) -> &mut i32 { &mut p.x }
pub fn pick<T: Copy>(c: bool, a: T, b: T) -> T { if c { a } else { b } }
pub fn promoted() -> &'static i32 { &(ANSWER + 1) }
pub fn text(i: usize) -> u8 { NAME.as_bytes()[i] }
pub fn opt(o: Option<u8>) -> u8 { o.unwrap_or(7) }
pub fn tuple() -> (u8, bool, Wrap) { (1, true, Wrap(2, false)) }
pub fn cast(f: f64) -> i16 { f as i16 }
pub const fn cfn(x: u32) -> u32 { x.wrapping_mul(3) }
pub fn arr() -> [i32; 3] { [ANSWER; 3] }
`;

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
}
function common_args(): string[] {
  return ["--target", TUPLE, "--sysroot", sysroot(), "--edition", "2024"];
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
  if (config === undefined) throw new globalThis.Error("ERROR: no config");
  return config;
}

function out(f: (w: VecU8) => Result<undefined | void, unknown>): string {
  const w = new VecU8();
  const r = f(w);
  if (r.$ === "Err") throw new globalThis.Error("ERROR: io error");
  return new TextDecoder().decode(w.bytes());
}

/** The `DefKind`s `mir_keys` (rustc_mir_transform lib.rs) yields (body owners and the ADT constructors), but statics:
 *  crate metadata holds no MIR of a static (encoder.rs `should_encode_mir`: "The others don't have MIR"), so `items_of`
 *  drops the oracle's `static` blocks too. */
function has_body(kind: DefKind): boolean {
  switch (kind.$) {
    case "Fn":
    case "AssocFn":
    case "Const":
    case "AssocConst":
    case "Closure":
    case "AnonConst":
      return true;
    case "Ctor":
      // `mir_keys` adds the constructors of tuple structs / variants (`CtorKind::Fn`)
      return kind._1 === "Fn";
    default:
      return false;
  }
}

/** `write_mir_pretty`'s item loop (mir/pretty.rs:326) over the aux crate's `DefId`s (in `DefIndex` order), without the
 *  header. Constructors: crate metadata holds only their `mir_for_ctfe` (encoder.rs `should_encode_mir`: "instance_mir
 *  uses mir_for_ctfe rather than optimized_mir for constructors"; a constructor is a `const fn`), so the port renders
 *  it in both halves of the `const fn` branch; the oracle renders the same constructor shim twice. */
function render_items(tcx: TyCtxt, cnum: CrateNum): string {
  const writer = MirWriter.new(tcx);
  const items: string[] = [];
  const n = creader.CStore.from_tcx(tcx).num_def_ids_untracked(cnum);
  for (let i = 0; i < n; i++) {
    const def_id = new DefId(DefIndex.from_usize(i), cnum);
    const kind = tcx.def_kind(def_id) as DefKind;
    if (!has_body(kind)) continue;
    const render_body = (w: VecU8, body: Body) => {
      writer.write_mir_fn(body, w);
      for (const p of tcx.promoted_mir(def_id) as readonly Body[]) {
        w.write_fmt(["\n"]);
        writer.write_mir_fn(p, w);
      }
    };
    items.push(
      out((w) => {
        if (tcx.is_const_fn(def_id)) {
          render_body(w, (kind.$ === "Ctor" ? tcx.mir_for_ctfe(def_id) : tcx.optimized_mir(def_id)) as Body);
          w.write_fmt(["\n"]);
          w.write_fmt(["// MIR FOR CTFE\n"]);
          writer.write_mir_fn(tcx.mir_for_ctfe(def_id) as Body, w);
        } else {
          const trivial = tcx.trivial_const(def_id) as [ConstValue, Ty] | undefined;
          if (trivial !== undefined) {
            const [val, ty] = trivial;
            w.write_fmt([with_forced_impl_filename_line(() => `const ${tcx.def_path_str(def_id)}`)]);
            w.write_fmt([`: ${display_Ty(ty)} = const ${display_Const({ $: "Val", _0: val, _1: ty })};\n`]);
          } else {
            render_body(w, tcx.instance_mir({ $: "Item", _0: def_id }) as Body);
          }
        }
        return { $: "Ok", _0: undefined };
      }),
    );
  }
  return items.join("\n");
}

/** The item blocks of `write_mir_pretty`'s output (header lines removed): an empty line followed by a top-level item
 *  header starts a block; promoteds (`const f::promoted[0]`) and `// MIR FOR CTFE` stay with the item before them. */
function items_of(body: string): string[] {
  return body
    .split(/\n\n(?=(?:fn |static |const (?!\S*promoted\[)))/)
    .map((b) => (b.endsWith("\n") ? b : `${b}\n`))
    .filter((b) => !b.startsWith("static "))
    .sort();
}

test.skipIf(SKIP)("rmeta-mir oracle: MIR bodies of an extern crate equal its -Zunpretty=mir", () => {
  mkdirSync(WORK, { recursive: true });
  const aux = join(WORK, `${AUX_NAME}.rs`);
  writeFileSync(aux, AUX);
  const aux_args = [...common_args(), "--crate-type", "lib", "--crate-name", AUX_NAME, "-Zalways-encode-mir", aux];
  const meta = Bun.spawnSync([...RUSTC, ...aux_args, "--emit=metadata", "--out-dir", WORK], { stdout: "pipe", stderr: "pipe" });
  if (meta.exitCode !== 0) throw new globalThis.Error(`ERROR: oracle aux build failed: ${meta.stderr.toString().slice(0, 2000)}`);
  const pretty = Bun.spawnSync([...RUSTC, ...aux_args, "-Zunpretty=mir"], { stdout: "pipe", stderr: "pipe" });
  if (pretty.exitCode !== 0) throw new globalThis.Error(`ERROR: oracle -Zunpretty=mir failed: ${pretty.stderr.toString().slice(0, 2000)}`);
  const expected = items_of(pretty.stdout.toString().split("\n").slice(3).join("\n"));

  const main = join(WORK, "main.rs");
  writeFileSync(main, `#![no_std]\nextern crate ${AUX_NAME};\n`);
  let ours: string[] = [];
  // `-Zunpretty=mir` as on the oracle side (the port's run only queries; the option keeps `record_trimmed_def_paths`,
  // session.rs:675, from expecting a diagnostic)
  const config = config_from_args([...common_args(), "--crate-type", "lib", "-L", WORK, "-Zunpretty=mir", main]);
  // rustc_driver_impl lib.rs:167 (`TimePassesCallbacks::config`, the oracle's callbacks): trimmed paths in the MIR text
  config.opts.trimmed_def_paths = true;
  run_compiler(config, (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const cnum = (tcx.crates(null) as readonly CrateNum[]).find((c) => Symbol.as_str(tcx.crate_name(c)) === AUX_NAME);
      if (cnum === undefined) throw new globalThis.Error(`ERROR: crate ${AUX_NAME} is not loaded`);
      ours = items_of(render_items(tcx, cnum).replaceAll(`${AUX_NAME}::`, ""));
    });
  });
  writeFileSync(join(WORK, "oracle.txt"), expected.join("\n"));
  writeFileSync(join(WORK, "ours.txt"), ours.join("\n"));
  expect(expected.length).toBeGreaterThanOrEqual(20);
  expect(ours).toEqual(expected);
});

/** Every MIR body `core` and `alloc` carry in their metadata decodes: `optimized_mir` / `mir_for_ctfe` /
 *  `promoted_mir` of each `DefIndex` whose table entry is present, and `trivial_const` (a structural check: each body's
 *  basic blocks end in a terminator and its locals have types). The one known stop: inline-asm operands
 *  (`InlineAsmOperand::{In, Out, InOut}.reg: InlineAsmRegOrRegClass`, rustc_target asm/mod.rs, which has no TS
 *  `Decodable` yet); bodies stopping there are counted (`MAX_ASM_STOPS`, measured by lane meta-mir), any other error
 *  fails the test. */
const MAX_ASM_STOPS = 38;
test.skipIf(SKIP)("rmeta-mir: every MIR body of core and alloc decodes", () => {
  mkdirSync(WORK, { recursive: true });
  const main = join(WORK, "alloc_main.rs");
  writeFileSync(main, "#![no_std]\nextern crate alloc;\n");
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const check = (body: Body) => {
    for (const bb of body.basic_blocks.deref()) expect(bb.terminator).toBeDefined();
    for (const decl of body.local_decls) expect(decl.ty).toBeDefined();
  };
  let asm_stops = 0;
  const decoded = (what: string, f: () => void) => {
    try {
      f();
      bump(what);
    } catch (e) {
      if (!(e instanceof Unported) || !(e.stack ?? "").includes("decode_InlineAsmOperand")) throw e;
      asm_stops++;
    }
  };
  run_compiler(config_from_args([...common_args(), "--crate-type", "lib", main]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const cstore = creader.CStore.from_tcx(tcx);
      for (const want of ["core", "alloc"]) {
        const cnum = (tcx.crates(null) as readonly CrateNum[]).find((c) => Symbol.as_str(tcx.crate_name(c)) === want);
        if (cnum === undefined) throw new globalThis.Error(`ERROR: crate ${want} is not loaded`);
        const cdata = cstore.get_crate_data(cnum);
        const tables = cdata.root.tables;
        const n = cstore.num_def_ids_untracked(cnum);
        for (let i = 0; i < n; i++) {
          const index = DefIndex.from_usize(i);
          const def_id = new DefId(index, cnum);
          if (tables.optimized_mir.get(fse_Option_LazyValue, cdata, index) !== undefined) decoded(`${want} optimized_mir`, () => check(tcx.optimized_mir(def_id) as Body));
          if (tables.mir_for_ctfe.get(fse_Option_LazyValue, cdata, index) !== undefined) decoded(`${want} mir_for_ctfe`, () => check(tcx.mir_for_ctfe(def_id) as Body));
          if (tables.promoted_mir.get(fse_Option_LazyValue, cdata, index) !== undefined) {
            decoded(`${want} promoted_mir`, () => {
              for (const p of tcx.promoted_mir(def_id) as readonly Body[]) check(p);
            });
          }
          if (tables.trivial_const.get(fse_Option_LazyValue, cdata, index) !== undefined) decoded(`${want} trivial_const`, () => void tcx.trivial_const(def_id));
        }
      }
    });
  });
  writeFileSync(join(WORK, "core-alloc-counts.txt"), [...counts, ["asm stops", asm_stops] as const].map(([k, v]) => `${k}: ${v}`).join("\n") + "\n");
  expect(counts.get("core optimized_mir") ?? 0).toBeGreaterThan(20000);
  expect(counts.get("core mir_for_ctfe") ?? 0).toBeGreaterThan(15000);
  expect(counts.get("alloc optimized_mir") ?? 0).toBeGreaterThan(3000);
  expect(asm_stops).toBeLessThanOrEqual(MAX_ASM_STOPS);
});

// rustc_ty_utils layout.rs (`layout_of_uncached`, `map_error`), layout/invariant.rs (`layout_sanity_check`) and, through
// them, rustc_abi's layout calculator (layout.rs, layout/simple.rs, layout/ty.rs, lib.rs) and rustc_middle ty/layout.rs,
// end to end against the oracle.
//
// The oracle: the pinned rustc on small no_core libraries whose items carry `#[rustc_dump_layout(debug)]`; rustc's
// rustc_passes layout_test.rs prints `layout_of(<ty>) = <LayoutData as {:#?}>` per item, in `hir_crate_items` order.
// rust-ts compiles the same source in-process and does what `dump_layout_of` (layout_test.rs:59) does for every such item
// (`TypingEnv::codegen`, `type_of(..).instantiate_identity()`, `tcx.layout_of`, the `normalize_erasing_regions` Display);
// `ensure_wf` is left out (every case is well-formed) and layout_test.rs itself is not ported. The two outputs must be
// byte-identical, randomization seeds included.
//
// (lane ty-utils-layout wrote the first version with test-only scaffolds for the then-unported rustc_abi / rustc_middle
// stubs; merge-layout removed them once every stub was filled and widened the cases: scalars, thin / wide pointers,
// `Pointee::Metadata`, tuples with field reordering and niche bias, structs in every repr, unions, arrays (incl. sizes
// at the `obj_size_bound` / `usize::MAX` edges), ZSTs, `!`,
// enums (niche-filling, tagged, repr(u8) / repr(i32) / repr(C), C-like with explicit discriminants), `Option<&T>`,
// `UnsafeCell`. Coroutines are not reachable: their layout needs `mir::CoroutineLayout`, M4.)
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { AbiAlign, Align, debug_LayoutData, LayoutData, Size, TyAndLayout, type VariantIdx } from "../rustc_abi/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { display_LayoutError, LayoutCx, type LayoutError, SimdLayoutError } from "../rustc_middle/ty/layout.ts";
import { HasAttrs_LocalDefId, Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import { layout_of_uncached, map_error } from "./layout.ts";
import { layout_sanity_check } from "./layout/invariant.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "ty-utils-layout", process.env.RUST_TS_AGENT ?? "default");

// ---- the sources ----

const PRELUDE = [
  "#![feature(no_core, lang_items, rustc_attrs, transparent_unions)]",
  "#![no_core]",
  "#![allow(dead_code)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
];
const aliases = (tys: string[]): string[] => tys.map((t, i) => `#[rustc_dump_layout(debug)] type T${i} = ${t};`);
/** scalars, thin / wide pointers (no `Pointee` lang item: the struct-tail path of `layout_of_uncached`), `!` */
const SCALARS = [
  ...PRELUDE,
  ...aliases(["u8", "bool", "char", "usize", "i32", "f64", "i128", "&'static u8", "*const u8", "!", "&'static str", "*mut [u16]"]),
];
/** with mini_core's `Pointee::Metadata` lang items: wide pointers take the `metadata_type` path */
const POINTEE = [
  ...PRELUDE,
  '#[lang = "pointee_trait"] pub trait Pointee: PointeeSized { #[lang = "metadata_type"] type Metadata; }',
  ...aliases(["&'static u8", "&'static str", "*const [u8]"]),
];
/** aggregates: tuples, structs (all reprs), ZSTs, unsized tails, unions, arrays, enums, `Option` / `Result`, `UnsafeCell` */
const AGGREGATES = [
  ...PRELUDE,
  "#[lang = \"copy\"] pub trait Copy {}",
  "impl Copy for u8 {}",
  "impl Copy for u16 {}",
  "impl Copy for u32 {}",
  "impl Copy for bool {}",
  "#[lang = \"unsafe_cell\"] #[repr(transparent)] pub struct UnsafeCell<T: ?Sized> { value: T }",
  "#[lang = \"phantom_data\"] pub struct PhantomData<T: ?Sized>;",
  "pub enum Option<T> { None, Some(T) }",
  "pub enum Result<T, E> { Ok(T), Err(E) }",
  "",
  "#[rustc_dump_layout(debug)] type A0 = ();",
  "#[rustc_dump_layout(debug)] type A1 = f32;",
  "#[rustc_dump_layout(debug)] type A2 = u128;",
  "#[rustc_dump_layout(debug)] type A3 = fn(u8) -> u8;",
  "#[rustc_dump_layout(debug)] type A4 = &'static [u32];",
  "#[rustc_dump_layout(debug)] type A5 = [u8];",
  "#[rustc_dump_layout(debug)] type A6 = str;",
  "#[rustc_dump_layout(debug)] type B0 = (u8, u32, u16);",
  "#[rustc_dump_layout(debug)] type B1 = (bool, u32);",
  "#[rustc_dump_layout(debug)] type B2 = (u8, bool, u16, char, u64);",
  "#[rustc_dump_layout(debug)] type B3 = (u8, [u8; 16], bool);",
  "#[rustc_dump_layout(debug)] type B4 = ((u8, u8, u8, bool), (u8, bool, u8));",
  "#[rustc_dump_layout(debug)] type B5 = ((), u32, ());",
  "#[rustc_dump_layout(debug)] type B6 = (char, u8, bool);",
  "#[rustc_dump_layout(debug)] type B7 = (u8, !);",
  "#[rustc_dump_layout(debug)] type B8 = (u64, u8);",
  "#[rustc_dump_layout(debug)] struct S1 { a: u8, b: u32, c: u16 }",
  "#[rustc_dump_layout(debug)] #[repr(C)] struct S2 { a: u8, b: u32, c: u16 }",
  "#[rustc_dump_layout(debug)] #[repr(packed)] struct S3 { a: u8, b: u32, c: u16 }",
  "#[rustc_dump_layout(debug)] #[repr(packed(2))] struct S4 { a: u8, b: u32, c: u16 }",
  "#[rustc_dump_layout(debug)] #[repr(transparent)] struct S5((), u16);",
  "#[rustc_dump_layout(debug)] #[repr(align(8))] struct S6(u8, bool);",
  "#[rustc_dump_layout(debug)] #[repr(C)] struct S7 { a: bool, b: u16 }",
  "#[rustc_dump_layout(debug)] struct Z;",
  "#[rustc_dump_layout(debug)] struct Z2((), [u8; 0], PhantomData<u32>);",
  "#[rustc_dump_layout(debug)] struct Unsized { a: u16, b: [u8] }",
  "pub struct Wrap<T>(T, u8);",
  "#[rustc_dump_layout(debug)] type W0 = Wrap<u16>;",
  "#[rustc_dump_layout(debug)] union U1 { a: u32, b: u32 }",
  "#[rustc_dump_layout(debug)] union U2 { a: u32, b: u8 }",
  "#[rustc_dump_layout(debug)] #[repr(C)] union U3 { a: u16, b: bool }",
  "#[rustc_dump_layout(debug)] #[repr(transparent)] union U4 { a: u32 }",
  "#[rustc_dump_layout(debug)] type C0 = [bool; 3];",
  "#[rustc_dump_layout(debug)] type C1 = [u32; 0];",
  "#[rustc_dump_layout(debug)] type C2 = [(); 4];",
  "#[rustc_dump_layout(debug)] type C3 = [[u8; 2]; 3];",
  "#[rustc_dump_layout(debug)] enum E0 {}",
  "#[rustc_dump_layout(debug)] enum E1 { A }",
  "#[rustc_dump_layout(debug)] enum E2 { A, B, C }",
  "#[rustc_dump_layout(debug)] #[repr(u8)] enum E3 { A, B }",
  "#[rustc_dump_layout(debug)] #[repr(i32)] enum E4 { A, B(u8) }",
  "#[rustc_dump_layout(debug)] #[repr(C)] enum E5 { A(u32), B(u8) }",
  "#[rustc_dump_layout(debug)] enum E6 { A(bool), B }",
  "#[rustc_dump_layout(debug)] enum E7 { A(u32), B(u64), C }",
  "#[rustc_dump_layout(debug)] enum E8 { A(u32, bool), B(u16), C }",
  "#[rustc_dump_layout(debug)] enum E9 { A(u8, !), B(u16) }",
  "#[rustc_dump_layout(debug)] enum E10 { A(u32) }",
  "#[rustc_dump_layout(debug)] type O0 = Option<&'static u8>;",
  "#[rustc_dump_layout(debug)] type O1 = Option<bool>;",
  "#[rustc_dump_layout(debug)] type O2 = Option<char>;",
  "#[rustc_dump_layout(debug)] type O3 = Option<u32>;",
  "#[rustc_dump_layout(debug)] type O4 = Option<Option<bool>>;",
  "#[rustc_dump_layout(debug)] type O5 = Option<(bool, u8)>;",
  "#[rustc_dump_layout(debug)] type O6 = Option<!>;",
  "#[rustc_dump_layout(debug)] type O7 = Result<u32, ()>;",
  "#[rustc_dump_layout(debug)] type O8 = Option<&'static str>;",
  "#[rustc_dump_layout(debug)] type O9 = Result<[u32; 0], bool>;",
  "#[rustc_dump_layout(debug)] type K0 = UnsafeCell<bool>;",
  "#[rustc_dump_layout(debug)] type K1 = Option<UnsafeCell<bool>>;",
  "#[rustc_dump_layout(debug)] type K2 = UnsafeCell<(bool, char)>;",
];
/** C-like enums with explicit (and negative) discriminants */
const DISCRIMINANTS = [
  ...PRELUDE,
  "#[lang = \"neg\"] pub trait Neg { type Output; fn neg(self) -> Self::Output; }",
  "impl Neg for isize { type Output = isize; fn neg(self) -> isize { loop {} } }",
  "impl Neg for i16 { type Output = i16; fn neg(self) -> i16 { loop {} } }",
  "#[rustc_dump_layout(debug)] enum D0 { A = 3, B = 10 }",
  "#[rustc_dump_layout(debug)] #[repr(u8)] enum D1 { A = 1, B = 200 }",
  "#[rustc_dump_layout(debug)] enum D2 { A = -1, B = 1 }",
  "#[rustc_dump_layout(debug)] #[repr(i16)] enum D3 { A = -300, B, C = 7 }",
];
/** array sizes at the edges: `usize::MAX` ZSTs, `obj_size_bound` overflows (`SizeOverflow`), a size just below 2^52 */
const SIZES = [
  ...PRELUDE,
  ...aliases(["[(); 18446744073709551615]", "[u16; 1152921504606846976]", "[[u8; 4294967296]; 4294967296]", "[u8; 4503599627370495]"]),
];
const SOURCES: [string, string[]][] = [
  ["layout_scalars", SCALARS],
  ["layout_pointee", POINTEE],
  ["layout_aggregates", AGGREGATES],
  ["layout_discriminants", DISCRIMINANTS],
  ["layout_sizes", SIZES],
];
const text = (lines: string[]): string => [...lines, ""].join("\n");

// ---- the oracle ----

let have_oracle = false;
/** per source: the `layout_of(<ty>) = Layout { .. }` messages (or a layout error's Display) in emission order, unindented */
const oracle_msgs = new Map<string, string[]>();

function parse_msgs(stderr: string): string[] {
  const msgs: string[] = [];
  const lines = stderr.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const e = /^error: (.*)$/.exec(lines[i]!);
    if (!e || e[1]!.startsWith("aborting due to")) continue;
    const m = /^(layout_of\(.*\) = Layout \{)$/.exec(e[1]!);
    if (!m) {
      msgs.push(e[1]!);
      continue;
    }
    const out = [m[1]!];
    for (i++; i < lines.length && lines[i] !== "       }"; i++) out.push(lines[i]!.slice(7));
    out.push("}");
    msgs.push(out.join("\n"));
  }
  return msgs;
}

beforeAll(async () => {
  mkdirSync(WORK, { recursive: true });
  const oracle = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  const probe = Bun.spawnSync(oracle.oracleRustcCmd(["-vV"]));
  if (probe.exitCode !== 0) {
    if (REQUIRE) throw new Error("ERROR: the pinned rustc is not runnable and RUST_TS_REQUIRE_PROBES=1");
    console.log("SKIP: pinned rustc not runnable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
    return;
  }
  await oracle.verifyOraclePin();
  for (const [name, lines] of SOURCES) {
    writeFileSync(join(WORK, `${name}.rs`), text(lines));
    const p = Bun.spawnSync(oracle.oracleRustcCmd(["--edition", "2024", "--crate-type", "lib", "-Ainternal_features", `${name}.rs`]), { cwd: WORK });
    const msgs = parse_msgs(p.stderr.toString());
    // every `#[rustc_dump_layout(debug)]` item printed one message (a layout or its layout error), and nothing else did
    const items = lines.filter((l) => l.startsWith("#[rustc_dump_layout(debug)]")).length;
    if (msgs.length !== items) throw new Error(`ERROR: oracle printed ${msgs.length} layouts for ${items} items of ${name}.rs`);
    oracle_msgs.set(name, msgs);
  }
  have_oracle = true;
}, 120_000);

// ---- in-process ----

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
function with_tcx(name: string, lines: string[], f: (tcx: TyCtxt) => void): void {
  // same file name as the oracle's (the crate name, hence the `StableCrateId` and the def-path hashes that seed ADT
  // layouts, comes from it), in its own directory
  const dir = join(WORK, "inproc");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.rs`);
  writeFileSync(file, text(lines));
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", "-Ainternal_features", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      f(tcx);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

/** What layout_test.rs `test_layout` + `dump_layout_of` print for `RustcDumpLayoutKind::Debug` (minus `ensure_wf`). */
function dump_layouts(tcx: TyCtxt): string[] {
  const out: string[] = [];
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    const kinds = find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), (k) => (k.$ === "RustcDumpLayout" ? k._0 : undefined));
    if (kinds === undefined) continue;
    const dk = tcx.def_kind(id).$;
    if (!(dk === "TyAlias" || dk === "Enum" || dk === "Struct" || dk === "Union")) continue;
    expect(kinds).toEqual(["Debug"]);
    const typing_env = TypingEnv.codegen(tcx, id);
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(id) as EarlyBinder<Ty>));
    try {
      const r = tcx.layout_of(typing_env.as_query_input(ty));
      if (r.$ === "Err") {
        out.push(display_LayoutError(r._0));
        continue;
      }
      const normalized_ty = tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty), fold_Ty);
      out.push(`layout_of(${display_Ty(normalized_ty)}) = ${debug_LayoutData(r._0.deref(), PRETTY)}`);
    } catch (e) {
      // keep going so that one stop shows up as one differing entry (a query left unfinished by `Unported` may
      // report a cycle for a later item that needs the same type)
      if (!(e instanceof Unported)) throw e;
      out.push(`ERROR: unported: ${e.what}`);
    }
  }
  return out;
}

/** Sources whose every item still stops before its layout (the exact stop; promote to a match when it moves). */
const PENDING: Record<string, string> = {
  // explicit discriminants: `AdtDef::discriminants` -> `eval_explicit_discr` -> `const_eval_poly` (ported, lane
  // mir-interp-b) -> the `eval_to_const_value_raw` provider (CTFE, M4); the implicit ones (`E2`, `E3`, ... in
  // layout_aggregates.rs) match
  layout_discriminants: "rustc_const_eval::const_eval::eval_to_const_value_raw_provider",
};

for (const [name, lines] of SOURCES) {
  const pending = PENDING[name];
  test(`layout_of on ${name}.rs ${pending === undefined ? "equals rustc's #[rustc_dump_layout(debug)]" : "stops at its pinned stop"}`, () => {
    if (!have_oracle) return;
    const want = oracle_msgs.get(name)!;
    with_tcx(name, lines, (tcx) => {
      expect(dump_layouts(tcx)).toEqual(pending === undefined ? want : want.map(() => `ERROR: unported: ${pending}`));
    });
  });
}

test("layout_of_uncached: generic types are TooGeneric; map_error builds the upstream LayoutError", () => {
  with_tcx("layout_scalars", SCALARS, (tcx) => {
    const env = TypingEnv.fully_monomorphized();
    const cx = LayoutCx.new(tcx, env);
    const t = Ty.new_param(tcx, 0, Symbol.intern("T"));
    const r = layout_of_uncached(cx, t);
    expect(r.$ === "Err" && r._0.$ === "TooGeneric" && r._0._0 === t).toBe(true);
    const e = (err: Parameters<typeof map_error>[2]): LayoutError => map_error(cx, t, err);
    expect(e({ $: "SizeOverflow" })).toEqual({ $: "SizeOverflow", _0: t });
    expect(e({ $: "ZeroLengthSimdType" })).toEqual({ $: "InvalidSimd", ty: t, kind: SimdLayoutError.ZeroLength });
    const o = e({ $: "OversizedSimdType", max_lanes: 7 });
    expect(o.$ === "InvalidSimd" && o.kind.$ === "TooManyLanes" && o.kind._0._0 === 7).toBe(true);
  });
});

test("layout_sanity_check: the release-mode size % align check", () => {
  with_tcx("layout_scalars", SCALARS, (tcx) => {
    const cx = LayoutCx.new(tcx, TypingEnv.fully_monomorphized());
    const mk = (size: number, align_pow2: number) =>
      new TyAndLayout(
        tcx.types.u8,
        tcx.mk_layout(
          new LayoutData(
            { $: "Arbitrary", offsets: [], in_memory_order: [] },
            { $: "Single", index: 0 as VariantIdx },
            { $: "Memory", sized: true },
            undefined,
            false,
            AbiAlign.new(new Align(align_pow2)),
            Size.from_bytes(size),
            undefined,
            new Align(align_pow2),
            false,
            Hash64.ZERO,
          ),
        ),
      );
    expect(() => layout_sanity_check(cx, mk(4, 1))).not.toThrow();
    expect(() => layout_sanity_check(cx, mk(3, 1))).toThrow(/size is not a multiple of align, in the following layout:\nTyAndLayout \{/);
  });
});

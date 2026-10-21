// The layout contract (lane layout-contract, docs/handoff/layout-contract.md) against upstream:
// - every fn of the layout files (rustc_abi lib.rs / layout.rs / layout/{coroutine,simple,ty}.rs / wrapping_range.rs /
//   callconv.rs / callconv/reg.rs, rustc_ty_utils layout.rs / layout/invariant.rs, rustc_middle ty/layout.rs) is either
//   ported (a `// rustc:` marker) or declared (a `// stub: <path>:<line> <name> (lane <lane>)` comment over a declaration
//   whose body calls `unported(..)` with a path in the fn's own crate module), never both;
// - the stubs stop as UNPORTED at runtime (representative calls), and a `layout_of` query reaches the real provider and
//   then its `layout_of_uncached` stub;
// - the Debug impls print what rustc prints (tests/ui/layout/debug.stderr), `TyCtxt::mk_layout` interns (one object per
//   value, deep-frozen) and `TyAndLayout` derefs to its `LayoutData`.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { DATA, REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import {
  AbiAlign,
  Align,
  BackendRepr,
  debug_BackendRepr,
  debug_LayoutData,
  debug_Scalar,
  FieldsShape,
  FIRST_VARIANT,
  Layout,
  LayoutCalculator,
  LayoutData,
  Niche,
  ReprFlags,
  ReprOptions,
  Scalar,
  Size,
  TargetDataLayout,
  TyAndLayout,
  VariantLayout,
  WrappingRange,
  type FieldIdx,
  type Primitive,
  type VariantIdx,
} from "../rustc_abi/lib.ts";
import { coroutine_saved_local_eligibility } from "../rustc_abi/layout/coroutine.ts";
import { ty_abi_interface } from "../rustc_abi/layout/ty.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import { IntegerExt, LayoutCx, LayoutOf_provided, SizeSkeleton, TyAbiInterface_Ty } from "../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import { layout_of_uncached } from "./layout.ts";
import { layout_sanity_check } from "./layout/invariant.ts";

const FILES: [string, string][] = [
  ["compiler/rustc_abi/src/lib.rs", "rustc_abi::"],
  ["compiler/rustc_abi/src/layout.rs", "rustc_abi::layout::"],
  ["compiler/rustc_abi/src/layout/coroutine.rs", "rustc_abi::layout::coroutine::"],
  ["compiler/rustc_abi/src/layout/simple.rs", "rustc_abi::layout::simple::"],
  ["compiler/rustc_abi/src/layout/ty.rs", "rustc_abi::layout::ty::"],
  ["compiler/rustc_abi/src/wrapping_range.rs", "rustc_abi::wrapping_range::"],
  ["compiler/rustc_abi/src/callconv.rs", "rustc_abi::callconv::"],
  ["compiler/rustc_abi/src/callconv/reg.rs", "rustc_abi::callconv::reg::"],
  ["compiler/rustc_ty_utils/src/layout.rs", "rustc_ty_utils::layout::"],
  ["compiler/rustc_ty_utils/src/layout/invariant.rs", "rustc_ty_utils::layout::invariant::"],
  ["compiler/rustc_middle/src/ty/layout.rs", "rustc_middle::ty::layout::"],
];

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
  /** the `unported("..")` path of the body below a stub */
  unported: string | undefined;
}
const markers: Decl[] = [];
const stubs: Decl[] = [];
for (const f of walk(join(REPO, "src"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /\/\/ (rustc|stub): (\S+):(\d+) (\w+)/.exec(lines[i]!);
    if (!m) continue;
    const d: Decl = { file: relative(REPO, f), path: m[2]!, line: Number(m[3]), name: m[4]!, unported: undefined };
    if (m[1] === "rustc") {
      markers.push(d);
      continue;
    }
    // the body of the declaration below: the first `unported("..")` within the next lines (before the next stub)
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
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

/** Stubs without a body of their own: a nested fn of a ported fn that the port never reaches. */
const BODYLESS = ["compiler/rustc_abi/src/lib.rs:914 overflow"];

test("every fn of the layout files is ported or declared as a stub, never both", () => {
  let total = 0;
  for (const [file, prefix] of FILES) {
    const fns = upstreamFns(file);
    total += fns.length;
    for (const fn of fns) {
      const key = `${fn.path}:${fn.line} ${fn.name}`;
      const m = markers.filter((d) => d.path === fn.path && d.line === fn.line && d.name === fn.name);
      const s = stubs.filter((d) => d.path === fn.path && d.line === fn.line && d.name === fn.name);
      expect(`${key}: ${m.length + s.length}`).toBe(`${key}: 1`);
      for (const d of s.filter((d) => !BODYLESS.includes(key))) {
        // the stub's body stops with a path in the fn's own crate module
        expect(`${key}: ${d.unported?.startsWith(prefix.replace(/::$/, "")) ?? "no unported(..)"}`).toBe(`${key}: true`);
      }
    }
    // a stub names an upstream fn of a scope file
    for (const d of stubs.filter((d) => d.path === file)) {
      expect(fns.some((fn) => fn.line === d.line && fn.name === d.name)).toBe(true);
    }
  }
  // stubs only for the scope files
  for (const d of stubs) expect(FILES.some(([f]) => f === d.path)).toBe(true);
  expect(total).toBe(320);
  expect(stubs.length).toBe(149);
});

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

const u8_: Primitive = { $: "Int", _0: "I8", _1: false };
const i32_: Primitive = { $: "Int", _0: "I32", _1: true };
const sz = (n: number) => Size.from_bytes(n);
const al = (pow2: number) => new Align(pow2);
const scalar = (value: Primitive, start: bigint, end: bigint): Scalar => ({ $: "Initialized", value, valid_range: new WrappingRange(start, end) });
const SEED = 1234n as Hash64;

/** `layout_of(Option<bool>)` of tests/ui/layout/debug.rs:93 (debug.stderr:509), built by hand. */
function option_bool(): LayoutData {
  return new LayoutData(
    { $: "Arbitrary", offsets: [sz(0)], in_memory_order: [0 as FieldIdx] },
    {
      $: "Multiple",
      tag: scalar(u8_, 0n, 2n),
      tag_encoding: { $: "Niche", untagged_variant: 1 as VariantIdx, niche_variants: { start: 0 as VariantIdx, last: 0 as VariantIdx }, niche_start: 2n },
      tag_field: 0 as FieldIdx,
      variants: [
        new VariantLayout(sz(0), { $: "Memory", sized: true }, [], [], undefined, false),
        new VariantLayout(sz(1), { $: "Scalar", _0: scalar(u8_, 0n, 1n) }, [sz(0)], [0 as FieldIdx], new Niche(sz(0), u8_, new WrappingRange(0n, 1n)), false),
      ],
    },
    { $: "Scalar", _0: scalar(u8_, 0n, 2n) },
    new Niche(sz(0), u8_, new WrappingRange(0n, 2n)),
    false,
    new AbiAlign(al(0)),
    sz(1),
    undefined,
    al(0),
    false,
    SEED,
  );
}

/** The `{:#?}` block of `layout_of(<what>)` in debug.stderr, unindented, with `$SEED`. */
function oracle_block(what: string): string {
  const lines = readFileSync(join(UPSTREAM, "tests/ui/layout/debug.stderr"), "utf8").split("\n");
  const start = lines.findIndex((l) => l === `error: layout_of(${what}) = Layout {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const out = ["Layout {"];
  for (let i = start + 1; lines[i] !== "       }"; i++) out.push(lines[i]!.slice(7));
  out.push("}");
  return out.join("\n");
}
const with_seed = (s: string) => s.replace(`randomization_seed: ${SEED},`, "randomization_seed: $SEED,");

test("Debug of LayoutData / Layout / Scalar / BackendRepr is rustc's (tests/ui/layout/debug.stderr)", () => {
  expect(with_seed(debug_LayoutData(option_bool(), PRETTY))).toBe(oracle_block("Option<bool>"));
  // layout_of(i32): `Scalar(i32 is ..)`, `fields: Primitive`, `variants: Single { index: 0 }`
  const i32_layout = new LayoutData(FieldsShape.Primitive, { $: "Single", index: FIRST_VARIANT }, { $: "Scalar", _0: scalar(i32_, 0n, 0xffff_ffffn) }, undefined, false, new AbiAlign(al(2)), sz(4), undefined, al(2), false, SEED);
  expect(with_seed(debug_LayoutData(i32_layout, PRETTY))).toBe(oracle_block("i32"));
  // layout_of(V): `fields: Union(2)`
  const v = new LayoutData({ $: "Union", _0: 2 }, { $: "Single", index: FIRST_VARIANT }, { $: "Memory", sized: true }, undefined, false, new AbiAlign(al(1)), sz(2), undefined, al(1), false, SEED);
  expect(with_seed(debug_LayoutData(v, PRETTY))).toBe(oracle_block("V"));
  // single-line forms
  expect(debug_Scalar(scalar(i32_, 0n, 0xffff_ffffn), PLAIN)).toBe("i32 is ..");
  expect(debug_Scalar(scalar(i32_, 0xffff_fffen, 3n), PLAIN)).toBe("i32 is -2..=3");
  expect(debug_Scalar(scalar(i32_, 3n, 0xffff_fffen), PLAIN)).toBe("i32 is (..=-2) | (3..)");
  expect(debug_Scalar(scalar(u8_, 254n, 2n), PLAIN)).toBe("u8 is (..=2) | (254..)");
  expect(debug_Scalar({ $: "Union", value: { $: "Pointer", _0: 1 as never } }, PLAIN)).toBe("union pointer(AddressSpace(1))");
  expect(debug_BackendRepr({ $: "ScalarPair", a: scalar(i32_, 0n, 0xffff_ffffn), b: scalar(i32_, 0n, 0xffff_ffffn), b_offset: sz(4) }, PLAIN)).toBe(
    "ScalarPair { a: i32 is .., b: i32 is .., b_offset: Size(4 bytes) }",
  );
});

test("the stubs stop as UNPORTED with their own path", () => {
  const l = option_bool();
  stops(() => l.is_zst(), "rustc_abi::LayoutData::is_zst");
  // `LayoutData::scalar` (abi-layout-a) is ported: its first call is `Niche::from_scalar` (lane abi-lib)
  stops(() => LayoutData.scalar({ data_layout: () => unreachable_dl() }, scalar(u8_, 0n, 1n)), "rustc_abi::Niche::from_scalar");
  stops(() => BackendRepr.is_unsized(l.backend_repr), "rustc_abi::BackendRepr::is_unsized");
  stops(() => Scalar.primitive(scalar(u8_, 0n, 1n)), "rustc_abi::Scalar::primitive");
  stops(() => new WrappingRange(0n, 1n).contains(0n), "rustc_abi::wrapping_range::WrappingRange::contains");
  // `layout_of_union` (abi-layout-a) is ported: a union with no fields is `EmptyUnion`; `layout_of_enum` is still a stub
  const dl = TargetDataLayout.default();
  const repr = new ReprOptions(undefined, undefined, undefined, ReprFlags.empty(), undefined, Hash64.ZERO);
  expect(LayoutCalculator.new(dl).layout_of_union(repr, [[]])).toEqual({ $: "Err", _0: { $: "EmptyUnion" } });
  stops(() => LayoutCalculator.new(dl).layout_of_enum(repr, [], null as never, []), "rustc_abi::layout::LayoutCalculator::layout_of_enum");
  stops(() => coroutine_saved_local_eligibility(0, [], null as never), "rustc_abi::layout::coroutine::coroutine_saved_local_eligibility");
  stops(() => layout_of_uncached(null as never, null as never), "rustc_ty_utils::layout::layout_of_uncached");
  stops(() => layout_sanity_check(null as never, null as never), "rustc_ty_utils::layout::invariant::layout_sanity_check");
  stops(() => SizeSkeleton.compute(null as never, null as never, null as never, null as never), "rustc_middle::ty::layout::SizeSkeleton::compute");
  stops(() => IntegerExt.discr_range_of_repr(null as never, null as never, null as never, 0n, 0n), "rustc_middle::ty::layout::IntegerExt::discr_range_of_repr");
  // `Ty: TyAbiInterface` is rustc_middle's table, registered at load
  expect(ty_abi_interface()).toBe(TyAbiInterface_Ty as never);
  const tl = new TyAndLayout(null as never, new Layout(option_bool()));
  stops(() => tl.field(null, 0), "rustc_abi::layout::ty::TyAndLayout::field");
  stops(() => TyAbiInterface_Ty.ty_and_layout_field(tl, null as never, 0), "rustc_middle::ty::layout::TyAbiInterface::ty_and_layout_field");
});

function unreachable_dl(): never {
  throw new Error("not reached");
}

test("TyAndLayout derefs to its LayoutData; Layout deep-freezes it", () => {
  const data = option_bool();
  const layout = new Layout(data);
  const tl = new TyAndLayout("ty", layout);
  expect(tl.deref()).toBe(data);
  expect(tl.as_ref()).toBe(data);
  expect(layout.deref_()).toBe(data);
  expect(tl.size).toBe(data.size);
  expect(tl.variants).toBe(data.variants);
  expect(layout.size()).toBe(data.size);
  expect(layout.backend_repr()).toBe(data.backend_repr);
  expect(Object.isFrozen(data)).toBe(true);
  expect(Object.isFrozen(data.variants)).toBe(true);
  expect(() => {
    (data as { size: Size }).size = sz(2);
  }).toThrow();
  // forwarded methods reach the LayoutData's (stub) method
  stops(() => tl.is_1zst(), "rustc_abi::LayoutData::is_1zst");
});

// ---- in-process: TyCtxt::mk_layout, the layout_of provider, LayoutCx ----

const WORK = join(DATA, "tmp", "layout-contract", process.env.RUST_TS_AGENT ?? "default");
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

test("mk_layout interns; tcx.layout_of reaches the provider and stops at layout_of_uncached; LayoutCx::layout_of too", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "layout_contract.rs");
  writeFileSync(file, "#![feature(no_core)]\n#![no_core]\npub fn f() {}\n");
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      const a = tcx.mk_layout(option_bool());
      const b = tcx.mk_layout(option_bool());
      expect(a).toBe(b);
      expect(tcx.mk_layout(option_bool())).not.toBe(new Layout(option_bool()));
      expect(Object.isFrozen(a.internee)).toBe(true);

      const env = TypingEnv.fully_monomorphized();
      stops(() => tcx.layout_of(env.as_query_input(tcx.types.u8)), "rustc_ty_utils::layout::layout_of_uncached");
      const cx = LayoutCx.new(tcx, env);
      expect(cx.tcx_()).toBe(tcx);
      expect(cx.typing_env_()).toBe(env);
      expect(cx.data_layout()).toBe(tcx.data_layout());
      stops(() => cx.layout_of(tcx.types.bool), "rustc_ty_utils::layout::layout_of_uncached");
      stops(() => LayoutOf_provided.spanned_layout_of(cx, tcx.types.i32, cx.layout_tcx_at_span()), "rustc_ty_utils::layout::layout_of_uncached");
      // `Ty::new_array` -> `Const::from_target_usize` -> `Const::from_bits` asks `layout_of(usize)` (was a stand-in; moved here
      // from rustc_middle ty/sty.test.ts, whose mock `tcx` has no query system)
      stops(() => Ty.new_array(tcx, tcx.types.u8, 3), "rustc_ty_utils::layout::layout_of_uncached");
      ran = true;
    });
  });
  expect(ran).toBe(true);
});

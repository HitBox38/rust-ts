// Lane ty-utils-layout: rustc_ty_utils layout.rs (`layout_of_uncached`, `map_error`) and layout/invariant.rs
// (`layout_sanity_check`) against the oracle.
//
// The oracle: the pinned rustc on a small no_core library whose type aliases carry `#[rustc_dump_layout(debug)]`;
// rustc prints `layout_of(<ty>) = <LayoutData as {:#?}>` per alias. rust-ts computes the same types in-process with
// `tcx.layout_of` (the real provider -> `layout_of_uncached` -> `layout_sanity_check`) and prints the same Debug.
//
// SCAFFOLDING (test-only, lanes abi-lib / abi-layout-a own the real ports): the scalar layouts cross a few rustc_abi
// fns that are still `// stub:`s on this lane's base (`Primitive::size`, `Scalar::primitive`, `LayoutData::scalar`, ..;
// also rustc_middle's `FloatExt::from_float_ty`, lane middle-layout).
// For the duration of one test, each of them that still stops UNPORTED with its own stub path is replaced by a
// test-local copy of its upstream body (rustc_abi lib.rs / wrapping_range.rs / layout/simple.rs at the pin); a fn that
// is ported by then is used as is. The scaffolds are restored afterwards and never touch src.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import {
  AbiAlign,
  Align,
  Align_max,
  BackendRepr,
  debug_LayoutData,
  FieldsShape,
  Float,
  type HasDataLayout,
  Integer,
  LayoutData,
  Niche,
  Primitive,
  Scalar,
  Size,
  TyAndLayout,
  Variants,
  WrappingRange,
  type FieldIdx,
  type VariantIdx,
} from "../rustc_abi/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import type { FloatTy } from "../rustc_ast_ir/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { FloatExt, LayoutCx, type LayoutError, SimdLayoutError } from "../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PRETTY } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { Panic, unported, Unported } from "../std/panic.ts";
import "./lib.ts";
import { layout_of_uncached, map_error } from "./layout.ts";
import { layout_sanity_check } from "./layout/invariant.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "ty-utils-layout", process.env.RUST_TS_AGENT ?? "default");

// ---- the oracle ----

const PRELUDE = [
  "#![feature(no_core, lang_items, rustc_attrs, never_type)]",
  "#![no_core]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
];
/** `[alias, how rust-ts builds the type]`; the oracle names each by its Display (`layout_of(<ty>)`). */
const CASES: [string, (tcx: TyCtxt) => Ty][] = [
  ["u8", (tcx) => tcx.types.u8],
  ["bool", (tcx) => tcx.types.bool],
  ["char", (tcx) => tcx.types.char],
  ["usize", (tcx) => tcx.types.usize],
  ["i32", (tcx) => tcx.types.i32],
  ["f64", (tcx) => tcx.types.f64],
  ["i128", (tcx) => tcx.types.i128],
  ["&'static u8", (tcx) => Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, tcx.types.u8)],
  ["*const u8", (tcx) => Ty.new_imm_ptr(tcx, tcx.types.u8)],
  ["!", (tcx) => tcx.types.never],
  ["&'static str", (tcx) => Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, tcx.types.str_)],
  ["*mut [u16]", (tcx) => Ty.new_mut_ptr(tcx, Ty.new_slice(tcx, tcx.types.u16))],
];
/** With `Pointee::Metadata` (mini_core's lang items): wide pointers take the `metadata_type` path of `layout_of_uncached`. */
const PRELUDE_POINTEE = [
  ...PRELUDE,
  '#[lang = "pointee_trait"] pub trait Pointee: PointeeSized { #[lang = "metadata_type"] type Metadata; }',
];
const CASES_POINTEE: [string, (tcx: TyCtxt) => Ty][] = [
  ["&'static u8", (tcx) => Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, tcx.types.u8)],
  ["&'static str", (tcx) => Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, tcx.types.str_)],
  ["*const [u8]", (tcx) => Ty.new_imm_ptr(tcx, Ty.new_slice(tcx, tcx.types.u8))],
];
const source = (prelude: string[], cases: [string, unknown][]): string =>
  [...prelude, ...cases.map(([alias], i) => `#[rustc_dump_layout(debug)] type T${i} = ${alias};`), ""].join("\n");
const SOURCE = source(PRELUDE, CASES);
const SOURCE_POINTEE = source(PRELUDE_POINTEE, CASES_POINTEE);

let have_oracle = false;
/** per source: `layout_of(<display>)` -> its `{:#?}` block, unindented */
const oracle_blocks = new Map<string, Map<string, string>>();

function parse_blocks(stderr: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = stderr.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^error: layout_of\((.*)\) = Layout \{$/.exec(lines[i]!);
    if (!m) continue;
    const out = ["Layout {"];
    for (i++; i < lines.length && lines[i] !== "       }"; i++) out.push(lines[i]!.slice(7));
    out.push("}");
    blocks.set(m[1]!, out.join("\n"));
  }
  return blocks;
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
  for (const [name, src] of [["layout_oracle", SOURCE], ["layout_oracle_pointee", SOURCE_POINTEE]] as const) {
    writeFileSync(join(WORK, `${name}.rs`), src);
    const p = Bun.spawnSync(oracle.oracleRustcCmd(["--edition", "2024", "--crate-type", "lib", "-Ainternal_features", `${name}.rs`]), { cwd: WORK });
    oracle_blocks.set(src, parse_blocks(p.stderr.toString()));
  }
  have_oracle = true;
}, 120_000);

// ---- scaffolding (module comment) ----

type Patch = { obj: Record<string, unknown>; key: string; old: unknown };
const patches: Patch[] = [];
function stops_at(f: () => unknown, what: string): boolean {
  try {
    f();
  } catch (e) {
    return e instanceof Unported && e.what === what;
  }
  return false;
}
/** Install `impl_` as `obj[key]` if `probe()` still stops at the stub `what`. */
function scaffold(obj: object, key: string, what: string, probe: () => unknown, impl_: unknown): void {
  if (!stops_at(probe, what)) return;
  const o = obj as Record<string, unknown>;
  patches.push({ obj: o, key, old: o[key] });
  o[key] = impl_;
}
function restore(): void {
  for (const p of patches.reverse()) p.obj[p.key] = p.old;
  patches.length = 0;
}

function install_scaffolds(cx: HasDataLayout): void {
  const u8_: Primitive = { $: "Int", _0: "I8", _1: false };
  const s = (): Scalar => ({ $: "Initialized", value: u8_, valid_range: new WrappingRange(0n, 1n) });
  // lib.rs:1545 Primitive::size
  scaffold(Primitive, "size", "rustc_abi::Primitive::size", () => Primitive.size(u8_, cx), (self: Primitive, cx: HasDataLayout): Size => {
    const dl = cx.data_layout();
    switch (self.$) {
      case "Int":
        return Integer.size(self._0);
      case "Float":
        return Float.size(self._0);
      case "Pointer":
        return dl.pointer_size_in(self._0);
    }
  });
  // lib.rs:1450 Float::align
  scaffold(Float, "align", "rustc_abi::Float::align", () => Float.align("F64", cx), (self: Float, cx: HasDataLayout): AbiAlign => {
    const dl = cx.data_layout();
    switch (self) {
      case "F16":
      case "F16B":
        return AbiAlign.new(dl.f16_align);
      case "F32":
        return AbiAlign.new(dl.f32_align);
      case "F64":
        return AbiAlign.new(dl.f64_align);
      case "F128":
      case "PpcF128":
        return AbiAlign.new(dl.f128_align);
    }
  });
  // rustc_middle ty/layout.rs:157 FloatExt::from_float_ty
  scaffold(FloatExt, "from_float_ty", "rustc_middle::ty::layout::FloatExt::from_float_ty", () => FloatExt.from_float_ty("F64"), (fty: FloatTy): Float => {
    switch (fty) {
      case "F16":
        return "F16";
      case "F32":
        return "F32";
      case "F64":
        return "F64";
      case "F128":
        return "F128";
    }
  });
  // lib.rs:1560 Primitive::default_align
  scaffold(Primitive, "default_align", "rustc_abi::Primitive::default_align", () => Primitive.default_align(u8_, cx), (self: Primitive, cx: HasDataLayout): AbiAlign => {
    const dl = cx.data_layout();
    switch (self.$) {
      case "Int":
        return Integer.align(self._0, dl);
      case "Float":
        return Float.align(self._0, dl);
      case "Pointer":
        return dl.pointer_align_in(self._0);
    }
  });
  // lib.rs:1627 Scalar::primitive, :1637 default_align, :1641 size, :1651 valid_range, :1661 valid_range_mut
  scaffold(Scalar, "primitive", "rustc_abi::Scalar::primitive", () => Scalar.primitive(s()), (self: Scalar) => self.value);
  scaffold(Scalar, "default_align", "rustc_abi::Scalar::default_align", () => Scalar.default_align(s(), cx), (self: Scalar, cx: HasDataLayout) =>
    Primitive.default_align(Scalar.primitive(self), cx),
  );
  scaffold(Scalar, "size", "rustc_abi::Scalar::size", () => Scalar.size(s(), cx), (self: Scalar, cx: HasDataLayout) => Primitive.size(Scalar.primitive(self), cx));
  scaffold(Scalar, "valid_range", "rustc_abi::Scalar::valid_range", () => Scalar.valid_range(s(), cx), (self: Scalar, cx: HasDataLayout) =>
    self.$ === "Initialized" ? self.valid_range : WrappingRange.full(Primitive.size(self.value, cx)),
  );
  scaffold(Scalar, "valid_range_mut", "rustc_abi::Scalar::valid_range_mut", () => Scalar.valid_range_mut(s()), (self: Scalar): MutRef<WrappingRange> => {
    if (self.$ !== "Initialized") throw new Panic("cannot change the valid range of a union");
    return {
      get value() {
        return self.valid_range;
      },
      set value(v: WrappingRange) {
        self.valid_range = v;
      },
    };
  });
  // wrapping_range.rs:89 with_start, :96 with_end
  const wr = WrappingRange.prototype as unknown as object;
  scaffold(wr, "with_start", "rustc_abi::wrapping_range::WrappingRange::with_start", () => new WrappingRange(0n, 1n).with_start(0n), function (this: WrappingRange, start: bigint) {
    return new WrappingRange(start, this.end);
  });
  scaffold(wr, "with_end", "rustc_abi::wrapping_range::WrappingRange::with_end", () => new WrappingRange(0n, 1n).with_end(0n), function (this: WrappingRange, end: bigint) {
    return new WrappingRange(this.start, end);
  });
  // lib.rs:2128 Niche::available, :2122 Niche::from_scalar
  const np = Niche.prototype as unknown as object;
  scaffold(np, "available", "rustc_abi::Niche::available", () => new Niche(Size.ZERO, u8_, new WrappingRange(0n, 1n)).available(cx), function (this: Niche, cx: HasDataLayout): bigint {
    const size = Primitive.size(this.value, cx);
    if (!(size.bits() <= 128)) throw new Panic("assertion failed: size.bits() <= 128");
    const max_value = size.unsigned_int_max();
    // Find out how many values are outside the valid range.
    const start = BigInt.asUintN(128, this.valid_range.end + 1n);
    const end = this.valid_range.start;
    return BigInt.asUintN(128, end - start) & max_value;
  });
  scaffold(Niche, "from_scalar", "rustc_abi::Niche::from_scalar", () => Niche.from_scalar(cx, Size.ZERO, s()), (cx: HasDataLayout, offset: Size, scalar: Scalar): Niche | undefined => {
    if (scalar.$ !== "Initialized") return undefined;
    const niche = new Niche(offset, scalar.value, scalar.valid_range);
    return niche.available(cx) > 0n ? niche : undefined;
  });
  // lib.rs:1006 `impl Add for Size`
  scaffold(Size.prototype as unknown as object, "add", "rustc_abi::Size::add", () => Size.ZERO.add(Size.ZERO), function (this: Size, other: Size): Size {
    const r = this.bytes() + other.bytes();
    if (r > Number.MAX_SAFE_INTEGER) return unported("Size beyond 2^53 (test scaffold)");
    return Size.from_bytes(r);
  });
  // lib.rs:1886 BackendRepr::is_unsized, :1902 is_sized; :2396 LayoutData::is_unsized, :2401 is_sized, :2406 is_1zst
  scaffold(BackendRepr, "is_unsized", "rustc_abi::BackendRepr::is_unsized", () => BackendRepr.is_unsized({ $: "Memory", sized: true }), (self: BackendRepr): boolean => {
    switch (self.$) {
      case "Scalar":
      case "ScalarPair":
      case "SimdScalableVector":
      case "SimdVector":
        return false;
      case "Memory":
        return !self.sized;
    }
  });
  scaffold(BackendRepr, "is_sized", "rustc_abi::BackendRepr::is_sized", () => BackendRepr.is_sized({ $: "Memory", sized: true }), (self: BackendRepr) => !BackendRepr.is_unsized(self));
  const lp = LayoutData.prototype as unknown as object;
  const probe_l = () => LayoutData.prototype;
  scaffold(lp, "is_unsized", "rustc_abi::LayoutData::is_unsized", () => probe_l().is_unsized.call({ backend_repr: { $: "Memory", sized: true } } as never), function (this: LayoutData) {
    return BackendRepr.is_unsized(this.backend_repr);
  });
  scaffold(lp, "is_sized", "rustc_abi::LayoutData::is_sized", () => probe_l().is_sized.call({ backend_repr: { $: "Memory", sized: true } } as never), function (this: LayoutData) {
    return BackendRepr.is_sized(this.backend_repr);
  });
  scaffold(lp, "is_1zst", "rustc_abi::LayoutData::is_1zst", () => probe_l().is_1zst.call({ backend_repr: { $: "Memory", sized: true }, size: Size.ZERO, align: AbiAlign.new(new Align(0)) } as never), function (this: LayoutData) {
    return this.is_sized() && this.size.bytes() === 0 && this.align.abi.bytes() === 1;
  });
  // layout/simple.rs:33 never_type, :51 scalar, :91 scalar_pair
  const L = LayoutData as unknown as object;
  scaffold(L, "never_type", "rustc_abi::layout::simple::LayoutData::never_type", () => LayoutData.never_type(cx), (cx: HasDataLayout): LayoutData => {
    const dl = cx.data_layout();
    // This is also used for uninhabited enums, so we use `Variants::Empty`.
    return new LayoutData(FieldsShape.Primitive, Variants.Empty, { $: "Memory", sized: true }, undefined, true, AbiAlign.new(dl.i8_align), Size.ZERO, undefined, dl.i8_align, false, Hash64.ZERO);
  });
  scaffold(L, "scalar", "rustc_abi::layout::simple::LayoutData::scalar", () => LayoutData.scalar(cx, s()), (cx: HasDataLayout, scalar: Scalar): LayoutData => {
    const largest_niche = Niche.from_scalar(cx, Size.ZERO, scalar);
    const size = Scalar.size(scalar, cx);
    const align = Scalar.default_align(scalar, cx);
    const range = Scalar.valid_range(scalar, cx);
    const p = Scalar.primitive(scalar);
    const tag = p.$ === "Int" ? (p._1 ? 1n : 2n) : p.$ === "Float" ? 3n : 4n;
    const rotr16 = (x: bigint): bigint => {
      const v = BigInt.asUintN(64, x);
      return BigInt.asUintN(64, (v >> 16n) | (v << 48n));
    };
    const seed = BigInt.asUintN(64, BigInt.asUintN(64, BigInt.asUintN(64, BigInt(size.bytes()) + BigInt.asUintN(64, tag << 32n)) + rotr16(range.start)) + rotr16(range.end));
    return new LayoutData(FieldsShape.Primitive, { $: "Single", index: 0 as VariantIdx }, { $: "Scalar", _0: scalar }, largest_niche, false, align, size, undefined, align.abi, false, Hash64.new(seed));
  });
  scaffold(L, "scalar_pair", "rustc_abi::layout::simple::LayoutData::scalar_pair", () => LayoutData.scalar_pair(cx, s(), s()), (cx: HasDataLayout, a: Scalar, b: Scalar): LayoutData => {
    const dl = cx.data_layout();
    const b_align = Scalar.default_align(b, dl).abi;
    const align = Align_max(Align_max(Scalar.default_align(a, dl).abi, b_align), dl.aggregate_align);
    const b_offset = Scalar.size(a, dl).align_to(b_align);
    const size = b_offset.add(Scalar.size(b, dl)).align_to(align);
    // HACK(nox): We iter on `b` and then `a` because `max_by_key` returns the last maximum.
    let largest_niche: Niche | undefined;
    for (const n of [Niche.from_scalar(dl, b_offset, b), Niche.from_scalar(dl, Size.ZERO, a)]) {
      if (n !== undefined && (largest_niche === undefined || n.available(dl) >= largest_niche.available(dl))) largest_niche = n;
    }
    const combined_seed = BigInt(Scalar.size(a, dl).bytes() + Scalar.size(b, dl).bytes());
    return new LayoutData(
      { $: "Arbitrary", offsets: [Size.ZERO, b_offset], in_memory_order: [0 as FieldIdx, 1 as FieldIdx] },
      { $: "Single", index: 0 as VariantIdx },
      { $: "ScalarPair", a, b, b_offset },
      largest_niche,
      false,
      AbiAlign.new(align),
      size,
      undefined,
      align,
      false,
      Hash64.new(combined_seed),
    );
  });
}

afterAll(restore);

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
function with_tcx(src: string, f: (tcx: TyCtxt) => void): void {
  const file = join(WORK, src === SOURCE ? "layout_inproc.rs" : "layout_inproc_pointee.rs");
  writeFileSync(file, src);
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

function check_against_oracle(src: string, cases: [string, (tcx: TyCtxt) => Ty][]): void {
  if (!have_oracle) return;
  const blocks = oracle_blocks.get(src)!;
  expect(blocks.size).toBe(cases.length);
  with_tcx(src, (tcx) => {
    install_scaffolds(tcx);
    try {
      const env = TypingEnv.fully_monomorphized();
      for (const [alias, mk] of cases) {
        const display = alias.replace("'static ", "");
        const r = tcx.layout_of(env.as_query_input(mk(tcx)));
        expect(r.$).toBe("Ok");
        if (r.$ !== "Ok") continue;
        expect([display, debug_LayoutData(r._0.deref(), PRETTY)]).toEqual([display, blocks.get(display)!]);
      }
    } finally {
      restore();
    }
  });
}

test("layout_of of scalars, pointers and `!` equals rustc's #[rustc_dump_layout(debug)] (scaffolded rustc_abi stubs)", () => {
  check_against_oracle(SOURCE, CASES);
});

test("wide pointers through `<T as Pointee>::Metadata` equal rustc's #[rustc_dump_layout(debug)] (scaffolded rustc_abi stubs)", () => {
  check_against_oracle(SOURCE_POINTEE, CASES_POINTEE);
});

test("layout_of_uncached: generic types are TooGeneric; map_error builds the upstream LayoutError", () => {
  with_tcx(SOURCE, (tcx) => {
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
  with_tcx(SOURCE, (tcx) => {
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

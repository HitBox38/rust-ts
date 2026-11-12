// Unit tests of mir/place.ts, mir/operand.ts (lane ssa-operand-place) and rustc_middle ty/typetree.ts, over a logging
// mock backend and the layouts the port computes for a small no_core crate. Upstream has no unit tests for these
// files; every expectation is derived from the upstream source at the pin (cited per case) and the real layouts.
//
// The mock: backend values and types are strings; a method the mock does not define logs `name(args)` and returns a
// fresh `%N`, so a test compares the exact sequence of builder calls the ported code makes.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Align, FieldsShape, Size, type VariantIdx } from "../../rustc_abi/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { Kind, Type, TypeTree } from "../../rustc_ast/expand/typetree.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { debug_Scalar, type Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import { debug_CtfeProvenance } from "../../rustc_middle/mir/interpret/pointer.ts";
import type { Local } from "../../rustc_middle/mir/mod.ts";
import { PlaceRef as mir_PlaceRef } from "../../rustc_middle/mir/statement.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { typetree_from_ty } from "../../rustc_middle/ty/typetree.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { MemFlags } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import { type BuilderMethods, BuilderMethods_provided } from "../traits/builder.ts";
import { Locals } from "./locals.ts";
import { FunctionCx, type LocalRef } from "./mod.ts";
import { debug_OperandRef, debug_OperandValue, OperandRef, OperandRefBuilder, OperandValue } from "./operand.ts";
import { codegen_tag_value, PlaceRef, PlaceValue } from "./place.ts";

interface MockTypes extends BackendTypes {
  Value: string;
  Type: string;
  Function: string;
  BasicBlock: string;
  FunctionSignature: string;
}
type V = string;

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
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "pub struct S { pub a: u8, pub b: u32, pub c: u16 }",
  "pub struct SF { pub a: u8, pub b: f64 }",
  "pub enum E { A, B(u32) }",
  "pub enum N { A(bool), B, C }",
  "pub struct L { pub next: *const L, pub v: f32 }",
  "pub fn f(_s: S, _sf: SF, _e: E, _n: N, _l: L, _t: (u8, u32), _a: [u16; 4], _r: &f32, _sl: &[f32], _tf: (u8, f64), _b: bool, _c: char, _d: f64, _r7: &&&&&&&u8) {}",
].join("\n");

/** Formats a mock call argument. */
function fmt_arg(a: unknown): string {
  if (a instanceof Align) return `align${a.bytes()}`;
  if (a instanceof Size) return `size${a.bytes()}`;
  if (Array.isArray(a)) return `[${a.map(fmt_arg).join(", ")}]`;
  if (typeof a === "string" || typeof a === "number" || typeof a === "bigint" || typeof a === "boolean") return String(a);
  if (a === undefined) return "None";
  return "<obj>";
}

/** The logging mock builder (and its own `cx`). */
function mock_bx(tcx: TyCtxt): { bx: BuilderMethods<MockTypes>; log: string[] } {
  const log: string[] = [];
  let n = 0;
  const layout_of = (ty: Ty): TyAndLayout => {
    const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
    if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
    return r._0;
  };
  const tyname = (l: TyAndLayout): string => display_Ty(l.ty);
  const own: Record<string, unknown> = {
    debug_Value: (v: V) => v,
    debug_Type: (v: V) => v,
    debug_Function: (v: V) => v,
    debug_FunctionSignature: (v: V) => v,
    tcx_: () => tcx,
    typing_env_: () => TypingEnv.fully_monomorphized(),
    layout_of,
    data_layout: () => tcx.data_layout(),
    sess: () => tcx.sess,
    const_usize: (i: bigint) => `usize ${i}`,
    const_uint: (t: string, i: bigint) => `${t} ${i}`,
    const_uint_big: (t: string, i: bigint) => `${t} ${i}`,
    const_i32: (i: number) => `i32 ${i}`,
    const_to_opt_uint: (v: V) => (v.startsWith("usize ") ? BigInt(v.slice(6)) : undefined),
    immediate_backend_type: (l: TyAndLayout) => `ity:${tyname(l)}`,
    backend_type: (l: TyAndLayout) => `bty:${tyname(l)}`,
    scalar_pair_element_backend_type: (l: TyAndLayout, i: number, imm: boolean) => `pair${i}${imm ? "i" : ""}:${tyname(l)}`,
    type_from_integer: () => "int_ptr",
    type_ptr: () => "ptr",
    type_i64: () => "i64",
    const_poison: (t: string) => `poison:${t}`,
    const_undef: (t: string) => `undef:${t}`,
    type_from_scalar: () => "scalar_ty",
    scalar_to_backend: (cv: Scalar, _s: unknown, ty: string) => `scalar(${debug_Scalar(cv, PLAIN, debug_CtfeProvenance)}):${ty}`,
    from_immediate: (v: V) => `fromimm(${v})`,
    load_operand: (place: PlaceRef<V>) => {
      log.push(`load_operand(${place.val.llval}, ${tyname(place.layout)})`);
      return new OperandRef<V>({ $: "Immediate", _0: `load(${place.val.llval})` }, place.layout, undefined);
    },
    with_move_annotation: (_i: unknown, f: (bx: unknown) => unknown) => f(proxy),
    typed_place_copy_with_flags: (dst: PlaceValue<V>, src: PlaceValue<V>, layout: TyAndLayout, flags: MemFlags) =>
      BuilderMethods_provided.typed_place_copy_with_flags(proxy, dst, src, layout, flags),
  };
  const proxy: BuilderMethods<MockTypes> = new Proxy(own, {
    get(target, prop) {
      if (prop === "cx") return () => proxy;
      if (typeof prop === "string" && prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then" || prop === "__backend_types") return undefined;
      return (...args: unknown[]) => {
        const r = `%${n++}`;
        log.push(`${r} = ${prop}(${args.map(fmt_arg).join(", ")})`);
        return r;
      };
    },
  }) as unknown as BuilderMethods<MockTypes>;
  return { bx: proxy, log };
}

function with_tcx(f: (tcx: TyCtxt, tys: Ty[]) => void): void {
  const file = join(DATA, "tmp", "ssa-operand-place", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "operand_place.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  // The deliberate `bug!` checks leave ICE errors in the session's DiagCtxt, so the compiler aborts once the closure
  // is done ("aborting due to N previous errors"); that abort is expected only after every check has run.
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        for (const def of tcx.mir_keys(null)) {
          if (tcx.def_path_str(LocalDefId.to_def_id(def)) !== "f") continue;
          const body = tcx.mir_built(def).borrow();
          const tys = body.local_decls.slice(1, 15).map((d) => d.ty);
          f(tcx, tys);
          ran = true;
        }
      });
    });
  } catch (e) {
    if (!ran) throw e;
  }
  expect(ran).toBe(true);
}

test("operand.rs / place.rs / typetree.rs over a mock backend", () => {
  with_tcx((tcx, tys) => {
    const [S, SF, E, N, L, T_u8_u32, A_u16_4, R_f32, R_slice_f32, T_u8_f64, BOOL, CHAR, F64, R7] = tys as [Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty, Ty];
    const layout = (ty: Ty) => {
      const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
      if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
      return r._0;
    };

    // ---- PlaceRef::project_field (place.rs:175) on `S { a: u8, b: u32, c: u16 }` --------------------------------
    {
      const { bx, log } = mock_bx(tcx);
      const ls = layout(S);
      // The port's layout reorders by alignment: b (u32) at 0, c (u16) at 4, a (u8) at 6; size 8, align 4.
      expect([0, 1, 2].map((i) => FieldsShape.offset(ls.fields, i).bytes())).toEqual([6, 0, 4]);
      const base = PlaceRef.new_sized<V>("%s", ls);
      expect(base.val.align.bytes()).toBe(4);
      // field 1 (b) is at offset 0: `simple()` keeps `llval`, no ptradd; align = 4.restrict_for_offset(0) = 4.
      const b = base.project_field(bx, 1);
      expect([b.val.llval, b.val.llextra, b.val.align.bytes(), display_Ty(b.layout.ty)]).toEqual(["%s", undefined, 4, "u32"]);
      expect(log).toEqual([]);
      // field 0 (a) at offset 6: `inbounds_ptradd(llval, const_usize(6))`; align = restrict_for_offset(6) = 2.
      const a = base.project_field(bx, 0);
      expect([a.val.llval, a.val.align.bytes(), display_Ty(a.layout.ty)]).toEqual(["%0", 2, "u8"]);
      // field 2 (c) at offset 4: align 4.
      const c = base.project_field(bx, 2);
      expect([c.val.llval, c.val.align.bytes()]).toEqual(["%1", 4]);
      expect(log).toEqual(["%0 = inbounds_ptradd(%s, usize 6)", "%1 = inbounds_ptradd(%s, usize 4)"]);
      // An underaligned place: align 1 stays 1 at any offset.
      const c1 = base.unaligned().project_field(bx, 2);
      expect(c1.val.align.bytes()).toBe(1);
      expect(base.val.align.bytes()).toBe(4); // `unaligned` built a copy (readonly fields, PORT decision)
    }

    // ---- PlaceRef::project_index (place.rs:281) on `[u16; 4]` ------------------------------------------------------
    {
      const { bx, log } = mock_bx(tcx);
      const la = layout(A_u16_4);
      const base = PlaceRef.new_sized<V>("%arr", la);
      expect(base.val.align.bytes()).toBe(2);
      // constant index 3: offset = 2 * 3 = 6, align = 2.restrict_for_offset(6) = 2.
      const e3 = base.project_index(bx, "usize 3");
      expect([e3.val.llval, e3.val.align.bytes(), display_Ty(e3.layout.ty)]).toEqual(["%0", 2, "u16"]);
      // non-constant index: offset = element size (2), align 2.
      const ei = base.project_index(bx, "%i");
      expect(ei.val.align.bytes()).toBe(2);
      expect(log).toEqual(["%0 = inbounds_nuw_gep(bty:u16, %arr, [usize 3])", "%1 = inbounds_nuw_gep(bty:u16, %arr, [%i])"]);
      // From an align-8 place: index 1 -> offset 2 -> align 2; index 4 -> offset 8 -> align 8.
      const base8 = PlaceRef.new_sized_aligned<V>("%a8", la, Align.EIGHT);
      expect(base8.project_index(bx, "usize 1").val.align.bytes()).toBe(2);
      expect(base8.project_index(bx, "usize 4").val.align.bytes()).toBe(8);
      // PlaceRef::len (place.rs:146): sized array -> const_usize(count).
      expect(base.len(bx)).toBe("usize 4");
    }

    // ---- OperandValue::store_with_flags (operand.rs:1029): Immediate, Pair, ZeroSized, Ref ------------------------
    {
      const { bx, log } = mock_bx(tcx);
      // Immediate u32: one store of `from_immediate(v)` at the place's alignment.
      OperandValue.store<MockTypes>({ $: "Immediate", _0: "%v" }, bx, PlaceRef.new_sized("%d", layout(tcx.types.u32)));
      expect(log.splice(0)).toEqual(["%0 = store_with_flags(fromimm(%v), %d, align4, 0)"]);

      // Pair on `(u8, u32)`: ScalarPair { a: u8, b: u32, b_offset: 4 }; second store at +4, align
      // 4.restrict_for_offset(4) = 4, flags without CAPTURES_READ_ONLY (8): VOLATILE|CAPTURES (9) -> 1.
      const lt = layout(T_u8_u32);
      expect(lt.backend_repr.$).toBe("ScalarPair");
      OperandValue.store_with_flags<MockTypes>(
        { $: "Pair", _0: "%a", _1: "%b" },
        bx,
        PlaceRef.new_sized("%d", lt),
        MemFlags.VOLATILE | MemFlags.CAPTURES_READ_ONLY,
      );
      expect(log.splice(0)).toEqual([
        "%1 = store_with_flags(fromimm(%a), %d, align4, 9)",
        "%2 = inbounds_ptradd(%d, usize 4)",
        "%3 = store_with_flags(fromimm(%b), %2, align4, 1)",
      ]);

      // ZeroSized: no code at all.
      OperandValue.store<MockTypes>(OperandValue.ZeroSized, bx, PlaceRef.new_sized("%d", layout(tcx.types.unit)));
      expect(log.splice(0)).toEqual([]);

      // Ref of the Memory-repr `S` at -O0 (not scalar): `typed_place_copy_with_flags` -> memcpy of 8 bytes with the
      // typetree (empty: no -Zautodiff), through the provided method (traits/builder.ts) and `typetree_from_ty`.
      OperandValue.store<MockTypes>({ $: "Ref", _0: PlaceValue.new_sized("%src", Align.EIGHT) }, bx, PlaceRef.new_sized("%d", layout(S)));
      expect(log.splice(0)).toEqual(["%4 = memcpy(%d, align4, %src, align8, usize 8, 0, <obj>)"]);

      // volatile_store / nontemporal_store flags.
      OperandValue.volatile_store<MockTypes>({ $: "Immediate", _0: "%v" }, bx, PlaceRef.new_sized("%d", layout(tcx.types.u8)));
      expect(log.splice(0)).toEqual(["%5 = store_with_flags(fromimm(%v), %d, align1, 1)"]);

      // Unsized source: `bug!("cannot directly store unsized values")` (an ICE, Panic).
      expect(() =>
        OperandValue.store<MockTypes>({ $: "Ref", _0: new PlaceValue("%src", "%len", Align.ONE) }, bx, PlaceRef.new_sized("%d", layout(S))),
      ).toThrow(Panic);
    }

    // ---- OperandValue helpers (operand.rs:95-138, :980) -------------------------------------------------------------
    {
      const { bx } = mock_bx(tcx);
      expect(OperandValue.try_pointer_parts<V>({ $: "Immediate", _0: "%p" })).toEqual(["%p", undefined]);
      expect(OperandValue.try_pointer_parts<V>({ $: "Pair", _0: "%p", _1: "%m" })).toEqual(["%p", "%m"]);
      expect(OperandValue.try_pointer_parts<V>(OperandValue.ZeroSized)).toBeUndefined();
      expect(() => OperandValue.pointer_parts<V>(OperandValue.ZeroSized, (v) => v)).toThrow(); // bug!: ExplicitBug (the text goes to stderr)
      const pv = OperandValue.deref<V>({ $: "Pair", _0: "%p", _1: "%m" }, Align.EIGHT);
      expect([pv.llval, pv.llextra, pv.align.bytes()]).toEqual(["%p", "%m", 8]);
      // PlaceValue::address is the inverse.
      expect(pv.address()).toEqual({ $: "Pair", _0: "%p", _1: "%m" });
      expect(PlaceValue.new_sized("%q", Align.ONE).address()).toEqual({ $: "Immediate", _0: "%q" });
      // is_expected_variant_for_type
      expect(OperandValue.is_expected_variant_for_type<V>({ $: "Pair", _0: "a", _1: "b" }, layout(T_u8_u32))).toBe(true);
      expect(OperandValue.is_expected_variant_for_type<V>({ $: "Immediate", _0: "a" }, layout(T_u8_u32))).toBe(false);
      expect(OperandValue.is_expected_variant_for_type<V>(OperandValue.ZeroSized, layout(tcx.types.unit))).toBe(true);
      expect(OperandValue.is_expected_variant_for_type<V>({ $: "Ref", _0: PlaceValue.new_sized("p", Align.ONE) }, layout(S))).toBe(true);
      // poison: per backend_repr.
      expect(OperandValue.poison(bx, layout(tcx.types.unit))).toBe(OperandValue.ZeroSized);
      expect(OperandValue.poison(bx, layout(tcx.types.u32))).toEqual({ $: "Immediate", _0: "poison:ity:u32" });
      expect(OperandValue.poison(bx, layout(T_u8_u32))).toEqual({ $: "Pair", _0: "poison:pair0i:(u8, u32)", _1: "poison:pair1i:(u8, u32)" });
      const pr = OperandValue.poison(bx, layout(S));
      expect(pr.$ === "Ref" && [pr._0.llval, pr._0.align.bytes()]).toEqual(["poison:ptr", 4]);
    }

    // ---- OperandRef: packed pairs, immediate, Debug (operand.rs:163, :282, :345, :366) ----------------------------
    {
      const { bx, log } = mock_bx(tcx);
      const lt = layout(T_u8_u32);
      const o = OperandRef.from_immediate_or_packed_pair(bx, "%agg", lt);
      expect(o.val).toEqual({ $: "Pair", _0: "%0", _1: "%1" });
      expect(o.immediate_or_packed_pair(bx)).toBe("%3");
      expect(log).toEqual([
        "%0 = extract_value(%agg, 0)",
        "%1 = extract_value(%agg, 1)",
        "%2 = insert_value(poison:ity:(u8, u32), %0, 0)",
        "%3 = insert_value(%2, %1, 1)",
      ]);
      const u32 = OperandRef.from_immediate_or_packed_pair(bx, "%x", layout(tcx.types.u32));
      expect(u32.immediate()).toBe("%x");
      expect(u32.immediate_or_packed_pair(bx)).toBe("%x");
      expect(() => o.immediate((v) => v)).toThrow(); // bug!("not immediate: {:?}")
      expect(debug_OperandRef(o, PLAIN, (v) => v).startsWith("OperandRef(Pair(%0, %1) @ TyAndLayout { ty: (u8, u32), layout: Layout {")).toBe(true);
      expect(debug_OperandValue<V>({ $: "Ref", _0: new PlaceValue("%p", "%m", Align.EIGHT) }, PLAIN, (v) => v)).toBe(
        "Ref(PlaceValue { llval: %p, llextra: Some(%m), align: Align(8 bytes) })",
      );
      expect(debug_OperandValue<V>(OperandValue.ZeroSized, PLAIN, (v) => v)).toBe("ZeroSized");
      expect(debug_OperandRef(u32, PLAIN, (v) => v).startsWith("OperandRef(Immediate(%x) @ TyAndLayout { ty: u32, layout: Layout {")).toBe(true);
      expect(OperandRef.zero_sized<V>(layout(tcx.types.unit)).val).toBe(OperandValue.ZeroSized);
      expect(() => OperandRef.zero_sized<V>(layout(tcx.types.u8))).toThrow("assertion failed: layout.is_zst()");
    }

    // ---- OperandRef::extract_field (operand.rs:384) on a pair --------------------------------------------------------
    {
      const { bx, log } = mock_bx(tcx);
      const fx = fx_of({ span: DUMMY_SP } as never, bx, new Locals<V>([]));
      const o = new OperandRef<V>({ $: "Pair", _0: "%a", _1: "%b" }, layout(T_u8_u32), undefined);
      // field 1 (u32) at b_offset 4: `(Some(b), b_llval)`; in_scalar == out_scalar -> `imm` unchanged.
      const f1 = o.extract_field(fx, bx, 1);
      expect([f1.val, display_Ty(f1.layout.ty)]).toEqual([{ $: "Immediate", _0: "%b" }, "u32"]);
      const f0 = o.extract_field(fx, bx, 0);
      expect(f0.val).toEqual({ $: "Immediate", _0: "%a" });
      expect(log).toEqual([]);
    }

    // ---- codegen_tag_value / codegen_set_discr (place.rs:262, :482) ---------------------------------------------------
    {
      const { bx, log } = mock_bx(tcx);
      const le = layout(E);
      const ln = layout(N);
      // E { A, B(u32) }: Direct tag (field 0), discr(B) = 1.
      expect(le.variants.$ === "Multiple" && le.variants.tag_encoding.$).toBe("Direct");
      const tb = codegen_tag_value(bx, 1 as VariantIdx, le);
      expect(tb as unknown).toEqual({ $: "Ok", _0: [0, "ity:u32 1"] });
      // N { A(bool), B, C }: niche in A's bool; untagged A -> Ok(None); B -> (1 - 1) + niche_start (2) = 2.
      const v = ln.variants;
      if (v.$ !== "Multiple" || v.tag_encoding.$ !== "Niche") throw new Error("ERROR: N is not niche-encoded");
      expect<unknown[]>([v.tag_encoding.untagged_variant, v.tag_encoding.niche_variants.start, v.tag_encoding.niche_variants.last, v.tag_encoding.niche_start]).toEqual([0, 1, 2, 2n]);
      expect(codegen_tag_value(bx, 0 as VariantIdx, ln) as unknown).toEqual({ $: "Ok", _0: undefined });
      expect(codegen_tag_value(bx, 2 as VariantIdx, ln) as unknown).toEqual({ $: "Ok", _0: [0, "scalar(0x03):ity:u8"] });
      // Single-variant struct: Ok(None).
      expect(codegen_tag_value(bx, 0 as VariantIdx, layout(S)) as unknown).toEqual({ $: "Ok", _0: undefined });
      // set_discr(E::B): project_field(0) (offset 0: no ptradd), then store the immediate.
      PlaceRef.new_sized<V>("%e", le).codegen_set_discr(bx, 1 as VariantIdx);
      expect(log.splice(0)).toEqual(["%0 = store_with_flags(fromimm(ity:u32 1), %e, align4, 0)"]);
      // set_discr(N::A): nothing to store.
      PlaceRef.new_sized<V>("%n", ln).codegen_set_discr(bx, 0 as VariantIdx);
      expect(log.splice(0)).toEqual([]);
    }

    // ---- OperandRef::codegen_get_discr (operand.rs:459) ---------------------------------------------------------------
    {
      const { bx, log } = mock_bx(tcx);
      const fx = fx_of({ span: DUMMY_SP } as never, bx, new Locals<V>([]));
      // E as a Pair (ScalarPair { tag u32, u32 }): extract_field(0) -> `%t`; Direct, unsigned, -O0 (no assume).
      expect(layout(E).backend_repr.$).toBe("ScalarPair");
      const oe = new OperandRef<V>({ $: "Pair", _0: "%t", _1: "%x" }, layout(E), undefined);
      expect(oe.codegen_get_discr(fx, bx, tcx.types.isize)).toBe("%0");
      expect(log.splice(0)).toEqual(["%0 = intcast(%t, ity:isize, false)"]);
      // N by reference: project_field(0) at offset 0, load_operand, then the niche path. relative_max = 1; tag range
      // 0..=3 (u8) does not wrap and niche_start (2) != range start (0): `icmp UGE tag, 2`; delta = 1.
      const on = new OperandRef<V>({ $: "Ref", _0: PlaceValue.new_sized("%n", Align.ONE) }, layout(N), undefined);
      expect(on.codegen_get_discr(fx, bx, tcx.types.isize)).toBe("%5");
      expect(log.splice(0)).toEqual([
        "load_operand(%n, u8)", // the tag field of `Variants::Multiple` is `tag.primitive().to_ty()` (ty/layout.rs field_ty_or_layout)
        "%1 = sub(load(%n), ity:u8 2)",
        "%2 = intcast(%1, ity:isize, false)",
        "%3 = icmp(IntUGE, load(%n), ity:u8 2)",
        "%4 = add(%2, ity:isize 1)",
        "%5 = select(%3, %4, ity:isize 0)",
      ]);
    }

    // ---- OperandRefBuilder (operand.rs:748-965) ----------------------------------------------------------------------
    {
      const { bx } = mock_bx(tcx);
      // A pair with nothing inserted: u8 and u32 are initialized scalars, so `build` ICEs (no uninit-valid scalar).
      const b = OperandRefBuilder.new<V>(layout(T_u8_u32));
      expect(() => b.build(bx)).toThrow(); // bug!
      // insert_imm / update_imm on a pair.
      b.insert_imm(0 as never, "%x");
      b.insert_imm(1 as never, "%y");
      expect(b.build(bx).val).toEqual({ $: "Pair", _0: "%x", _1: "%y" });
      b.update_imm(Size.from_bytes(4), "%z");
      expect(b.build(bx).val).toEqual({ $: "Pair", _0: "%x", _1: "%z" });
      expect(() => b.insert_imm(0 as never, "%w", (v) => v)).toThrow(); // bug!
      // from_existing: ZeroSized; a Memory type ICEs.
      expect(OperandRefBuilder.from_existing<V>(OperandRef.zero_sized(layout(tcx.types.unit))).build(bx).val).toBe(OperandValue.ZeroSized);
      expect(() => OperandRefBuilder.new<V>(layout(S))).toThrow(); // bug!
    }

    // ---- FunctionCx::codegen_place (place.rs:338): Field, ConstantIndex, Downcast over a `Place` local ---------------
    {
      const { bx, log } = mock_bx(tcx);
      const locals: LocalRef<V>[] = [
        { $: "Place", _0: PlaceRef.new_sized<V>("%s", layout(S)) },
        { $: "Place", _0: PlaceRef.new_sized<V>("%arr", layout(A_u16_4)) },
        { $: "Place", _0: PlaceRef.new_sized<V>("%n", layout(N)) },
        LocalRefPending(),
      ];
      const fx = fx_of({ span: DUMMY_SP } as never, bx, new Locals<V>(locals));
      const p0 = fx.codegen_place(bx, new mir_PlaceRef(0 as Local, [{ $: "Field", _0: 0 as never, _1: tcx.types.u8 }]));
      expect([p0.val.llval, p0.val.align.bytes()]).toEqual(["%0", 2]);
      const p1 = fx.codegen_place(bx, new mir_PlaceRef(1 as Local, [{ $: "ConstantIndex", offset: 1n, min_length: 4n, from_end: true }]));
      expect(p1.val.align.bytes()).toBe(2); // non-constant index (`sub(len, 1)`): offset = element size
      const p2 = fx.codegen_place(bx, new mir_PlaceRef(2 as Local, [{ $: "Downcast", _0: undefined, _1: 1 as VariantIdx }]));
      expect<unknown[]>([p2.val.llval, p2.layout.variants.$ === "Single" && p2.layout.variants.index]).toEqual(["%n", 1]);
      expect(log).toEqual([
        "%0 = inbounds_ptradd(%s, usize 6)",
        "%1 = sub(usize 4, usize 1)",
        "%2 = inbounds_nuw_gep(bty:u16, %arr, [%1])",
      ]);
      expect(() => fx.codegen_place(bx, new mir_PlaceRef(3 as Local, []))).toThrow(); // bug!
    }

    // ---- typetree_from_ty (typetree.rs:43) ----------------------------------------------------------------------------
    {
      const tt = (ty: Ty) => typetree_from_ty(tcx, ty);
      const T = (offset: number, size: number, kind: Kind, child: TypeTree = TypeTree.new()) => new Type(offset, size, kind, child);
      // Without -Zautodiff=Enable: always empty, whatever the type.
      expect(tt(F64)).toEqual(TypeTree.new());
      expect(tt(SF)).toEqual(TypeTree.new());
      const opts = tcx.sess.opts.unstable_opts;
      const saved = opts.autodiff;
      try {
        opts.autodiff = [{ $: "Enable" }];
        // Scalars: offset -1 (not a reference target).
        expect(tt(tcx.types.u32)).toEqual(new TypeTree([T(-1, 4, Kind.Integer)]));
        expect(tt(BOOL)).toEqual(new TypeTree([T(-1, 1, Kind.Integer)]));
        expect(tt(CHAR)).toEqual(new TypeTree([T(-1, 4, Kind.Integer)]));
        expect(tt(F64)).toEqual(new TypeTree([T(-1, 8, Kind.Double)]));
        expect(tt(tcx.types.f32)).toEqual(new TypeTree([T(-1, 4, Kind.Float)]));
        expect(tt(tcx.types.unit)).toEqual(TypeTree.new()); // empty tuple
        // &f32: Pointer (pointer size 8), child described as a reference target (offset 0).
        expect(tt(R_f32)).toEqual(new TypeTree([T(-1, 8, Kind.Pointer, new TypeTree([T(0, 4, Kind.Float)]))]));
        // &[f32]: slice tail, `[f32]` has size 0 -> child from the element, not a reference target.
        expect(tt(R_slice_f32)).toEqual(new TypeTree([T(-1, 8, Kind.RustSlice, new TypeTree([T(-1, 4, Kind.Float)]))]));
        // [u16; 4]: one entry with offset -1 (`Type::from_ty(-1, ..)`, not one per element).
        expect(tt(A_u16_4)).toEqual(new TypeTree([T(-1, 2, Kind.Integer)]));
        // (u8, f64): offsets from the running sum of element sizes (0, then 1), not the layout's field offsets.
        expect(tt(T_u8_f64)).toEqual(new TypeTree([T(0, 1, Kind.Integer), T(1, 8, Kind.Double)]));
        // SF { a: u8, b: f64 }: the layout's field offsets (b at 0, a at 8), in declaration order.
        expect([0, 1].map((i) => FieldsShape.offset(layout(SF).fields, i).bytes())).toEqual([8, 0]);
        expect(tt(SF)).toEqual(new TypeTree([T(8, 1, Kind.Integer), T(0, 8, Kind.Double)]));
        // L { next: *const L, v: f32 }: `*const L` -> Pointer whose child revisits `L` (cycle -> empty); v at offset 8.
        expect(tt(L)).toEqual(new TypeTree([T(0, 8, Kind.Pointer, TypeTree.new()), T(8, 4, Kind.Float)]));
        // Enums are not described (the `_` arm).
        expect(tt(E)).toEqual(TypeTree.new());
        // &&&&&&&u8: `handle_indirection` at depths 0..=5 makes six Pointer nodes (offset -1 each); the inner call at
        // depth 6 hits MAX_TYPETREE_DEPTH and returns an empty tree.
        let expect_r7 = TypeTree.new();
        for (let i = 0; i < 6; i++) expect_r7 = new TypeTree([T(-1, 8, Kind.Pointer, expect_r7)]);
        expect(tt(R7)).toEqual(expect_r7);
        // NoTT disables it again.
        opts.autodiff = [{ $: "Enable" }, { $: "NoTT" }];
        expect(tt(F64)).toEqual(TypeTree.new());

        // typed_place_copy_with_flags passes [tt.add_indirection() clone, tt] to memcpy (traits/builder.rs:514).
        opts.autodiff = [{ $: "Enable" }];
        const { bx } = mock_bx(tcx);
        let seen: unknown;
        (bx as unknown as Record<string, unknown>).memcpy = (...args: unknown[]) => {
          seen = args[6];
        };
        BuilderMethods_provided.typed_place_copy_with_flags(bx, PlaceValue.new_sized("%d", Align.EIGHT), PlaceValue.new_sized("%s", Align.EIGHT), layout(SF), MemFlags.empty());
        const sf_tt = new TypeTree([T(8, 1, Kind.Integer), T(0, 8, Kind.Double)]);
        const ind = new TypeTree([T(0, 1, Kind.Pointer, sf_tt)]); // TypeTree::add_indirection (rustc_ast typetree.rs:63)
        expect(seen).toEqual({ args: [ind, ind], ret: TypeTree.new() });
      } finally {
        opts.autodiff = saved;
      }
    }
  });
}, 240_000);

/** A `FunctionCx` with only the fields place.rs and operand.rs read here (`mir`, `cx`, `locals`); the rest stay unset. */
function fx_of(mir: unknown, cx: unknown, locals: Locals<V>): FunctionCx<MockTypes> {
  const fx = Object.create(FunctionCx.prototype) as FunctionCx<MockTypes>;
  Object.assign(fx, { mir, cx, locals });
  return fx;
}

function LocalRefPending(): LocalRef<V> {
  return { $: "PendingOperand" };
}

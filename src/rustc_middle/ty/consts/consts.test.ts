// Lane ty-results: rustc_middle ty/consts.rs, ty/consts/{int,kind,lit,valtree}.rs unit tests.
//
// - The probe lines `display_int`, `value_preds`, `valtree_consts` are also checked here against
//   consts_oracle/expected.json (written while lane ty-sty's `Ty` predicates were stubs, which these tests mocked with
//   upstream's bodies; since merge-w15b the oracle test compares them end to end too).
// - Panics and the hand-written decode of `ScalarInt`.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../../lib.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Size } from "../../../rustc_abi/lib.ts";
import { Limit } from "../../../rustc_structures/limit.ts";
import type { Decoder } from "../../../rustc_serialize/serialize.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { Panic } from "../../../std/panic.ts";
import { CommonConsts, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../context.ts";
import { Ty } from "../mod.ts";
import { FmtPrinter } from "../print/pretty.ts";
import { decode_ScalarInt, ScalarInt } from "./int.ts";
import { Expr } from "./kind.ts";
import { const_lit_matches_ty } from "./lit.ts";
import { debug_ValTree, ValTree, Value } from "./valtree.ts";
import { GenericArg } from "../generic_args.ts";

/** A `TyCtxt` over fresh interners with the `sess` fields the printer reads. */
function mk_tcx(verbose: boolean): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let consts: CommonConsts | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get consts() {
      return (consts ??= CommonConsts.new(interners, this.types));
    },
    sess: {
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: false } },
      verbose_internals: () => verbose,
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  const TP = Ty.prototype as unknown as Record<string, (this: Ty) => boolean>;
  // ty/sty.rs `is_ptr_sized_integral`: `matches!(self.kind(), Int(ty::IntTy::Isize) | Uint(ty::UintTy::Usize))`
  spies.push(
    spyOn(TP, "is_ptr_sized_integral").mockImplementation(function (this: Ty) {
      const k = this.kind();
      return (k.$ === "Int" && k._0 === "Isize") || (k.$ === "Uint" && k._0 === "Usize");
    }),
  );
  // ty/sty.rs `is_bool`: `*self.kind() == Bool`
  spies.push(
    spyOn(TP, "is_bool").mockImplementation(function (this: Ty) {
      return this.kind().$ === "Bool";
    }),
  );
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

const EXPECTED = JSON.parse(readFileSync(join(import.meta.dir, "consts_oracle/expected.json"), "utf8")) as Record<string, { stdout: string }>;
/** The lines of section `== name` of a probe output. */
function section(stdout: string, name: string): string[] {
  const lines = stdout.split("\n");
  const i = lines.indexOf(`== ${name}`);
  expect(i).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && !lines[j]!.startsWith("== ") && lines[j] !== ""; j++) out.push(lines[j]!);
  return out;
}

function print(tcx: TyCtxt, f: (p: FmtPrinter) => { $: string }): string {
  const p = FmtPrinter.new_with_limit(tcx, "TypeNS", Limit.new(2 ** 24));
  expect(f(p).$).toBe("Ok");
  return p.into_buffer();
}
function print_value(tcx: TyCtxt, c: Const): string {
  const p = FmtPrinter.new_with_limit(tcx, "ValueNS", Limit.new(2 ** 24));
  expect(p.pretty_print_const_valtree(c.to_value(), true).$).toBe("Ok");
  return p.into_buffer();
}

function int_consts(tcx: TyCtxt): Const[] {
  const ints: [ScalarInt, Ty][] = [
    [ScalarInt.from_u8(42), tcx.types.u8],
    [ScalarInt.from_i32(-5), tcx.types.i32],
    [ScalarInt.from_i8(-128), tcx.types.i8],
    [ScalarInt.from_u64((1n << 64n) - 1n), tcx.types.u64],
    [ScalarInt.from_u64(3n), tcx.types.usize],
    [ScalarInt.from_i64(-1n), tcx.types.isize],
    [ScalarInt.from_i64((1n << 63n) - 1n), tcx.types.isize],
    [ScalarInt.from_u128((1n << 128n) - 1n), tcx.types.u128],
  ];
  return ints.map(([i, t]) => Const.new_value(tcx, ValTree.from_scalar_int(tcx, i) as never, t));
}

describe("probe lines blocked on lane ty-sty's Ty predicates (consts_oracle/expected.json)", () => {
  // (Under `-Zverbose-internals` the oracle test compares `display_int` / `valtree_consts` itself; only `value_preds` is
  // blocked there, and it prints the same as in the plain run.)
  for (const verbose of [false]) {
    const name = verbose ? "verbose" : "plain";
    test(`display_int / value_preds / valtree_consts (${name})`, () => {
      const tcx = mk_tcx(verbose);
      const want = EXPECTED[name]!.stdout;
      expect(int_consts(tcx).map((c) => `${print(tcx, (p) => p.print_const(c))} ${print_value(tcx, c)}`)).toEqual(section(want, "display_int"));

      const c42 = Const.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u8(42)) as never, tcx.types.u8);
      const b = (v: boolean | undefined): string => (v === undefined ? "None" : `Some(${v})`);
      expect([`${b(Value.try_to_bool(tcx.consts.true_.to_value()))} ${b(Value.try_to_bool(c42.to_value()))}`]).toEqual(section(want, "value_preds"));

      const c = (n: number) => Const.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u8(n)) as never, tcx.types.u8);
      const br = ValTree.from_branches(tcx, [c(1), c(2)]);
      const raw = ValTree.from_raw_bytes(tcx, new TextEncoder().encode("hi"));
      // `{:?}` of a value `Const` is `ConstKind`'s Debug: `Value(v) => write!(f, "{v}")` (const_kind.rs), i.e. the
      // `Display` of `ty::Value` (`with_` needs an ImplicitCtxt, so the printer is called directly).
      const dbg_const = (k: Const): string => print_value(tcx, k);
      const dbg_vt = (v: ValTree): string => `Branch([${(v.kind()._0 as unknown as Const[]).map(dbg_const).join(", ")}])`;
      expect([`${dbg_vt(br)} ${dbg_vt(raw)}`]).toEqual(section(want, "valtree_consts"));
      expect(debug_ValTree(ValTree.zst(tcx), { alternate: false })).toBe("Branch([])");
    });
  }
});

describe("ScalarInt panics and decode", () => {
  test("to_bits with the wrong size panics with upstream's message", () => {
    expect(() => ScalarInt.from_u8(1).to_bits(Size.from_bytes(4))).toThrow(new Panic("ScalarInt has size 1 but expected 4"));
    expect(() => ScalarInt.from_u32(9).to_atomic_ordering()).toThrow(new Panic("not a valid atomic ordering"));
    expect(() => ScalarInt.from_u32(3).to_simd_alignment()).toThrow(new Panic("not a valid simd alignment"));
  });

  test("decode reads the size byte and that many little-endian bytes", () => {
    const bytes = [2, 0x34, 0x12, 9, 9];
    let pos = 0;
    const d = {
      read_u8: () => bytes[pos++]!,
      read_raw_bytes: (n: number) => {
        const r = Uint8Array.from(bytes.slice(pos, pos + n));
        pos += n;
        return r;
      },
    } as unknown as Decoder;
    const s = decode_ScalarInt(d);
    expect(s.data).toBe(0x1234n);
    expect(s.size().bytes()).toBe(2);
    expect(pos).toBe(3);
  });
});

describe("Const / Expr / lit", () => {
  test("to_value of a non-value const is a bug; try_to_value is None", () =>
    expect(() => {
      const tcx = mk_tcx(false);
      const infer = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 1 as never } });
      expect(infer.try_to_value()).toBeUndefined();
      infer.to_value();
    }).toThrow(Panic));

  test("Expr binop / unop / cast / call args round-trip through the GenericArgs", () => {
    const tcx = mk_tcx(false);
    const { u8, i32 } = tcx.types;
    const one = Const.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u8(1)) as never, u8);
    const e = Expr.new_binop(tcx, "Add" as never, u8, i32, one, tcx.consts.true_);
    expect(Expr.binop_args(e)).toEqual([u8, i32, one, tcx.consts.true_]);
    expect(Expr.args(e)).toBe(tcx.mk_args([GenericArg.from_Ty(u8), GenericArg.from_Ty(i32), GenericArg.from_Const(one), GenericArg.from_Const(tcx.consts.true_)]));
    expect(Expr.unop_args(Expr.new_unop(tcx, "Neg" as never, i32, one))).toEqual([i32, one]);
    expect(Expr.cast_args(Expr.new_cast(tcx, "As" as never, u8, one, i32))).toEqual([u8, one, i32]);
    expect(Expr.call_args(Expr.new_call(tcx, u8, one, [one, tcx.consts.unit]))).toEqual([u8, one, [one, tcx.consts.unit]]);
    expect(() => Expr.unop_args(e)).toThrow(Panic);
  });

  test("const_lit_matches_ty", () => {
    const tcx = mk_tcx(false);
    const { u8, i32, bool, char } = tcx.types;
    expect(const_lit_matches_ty(tcx, { $: "Int", _0: 1n, _1: { $: "Unsuffixed" } }, u8, false)).toBe(true);
    expect(const_lit_matches_ty(tcx, { $: "Int", _0: 1n, _1: { $: "Unsuffixed" } }, u8, true)).toBe(false);
    expect(const_lit_matches_ty(tcx, { $: "Int", _0: 1n, _1: { $: "Unsuffixed" } }, i32, true)).toBe(true);
    expect(const_lit_matches_ty(tcx, { $: "Int", _0: 1n, _1: { $: "Signed", _0: "I32" } }, i32, false)).toBe(true);
    expect(const_lit_matches_ty(tcx, { $: "Int", _0: 1n, _1: { $: "Unsigned", _0: "U16" } }, u8, false)).toBe(false);
    expect(const_lit_matches_ty(tcx, { $: "Bool", _0: true }, bool, false)).toBe(true);
    expect(const_lit_matches_ty(tcx, { $: "Char", _0: 0x61 }, char, false)).toBe(true);
    expect(const_lit_matches_ty(tcx, { $: "Byte", _0: 1 }, u8, false)).toBe(true);
    expect(const_lit_matches_ty(tcx, { $: "Char", _0: 0x61 }, u8, false)).toBe(false);
  });
});

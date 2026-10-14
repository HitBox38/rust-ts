// Test driver for src/rustc_middle/ty/consts/consts.oracle.test.ts (not a port).
//   bun src/rustc_middle/ty/consts/consts_oracle/run.ts <rustc arguments...>
//
// Subject side of ./probe.rs (its header documents the output): runs the ported driver and, in `after_expansion`,
// prints the same sections with lane ty-results' `ScalarInt` / `ConstInt` / `ValTree` / `Value` / `Const` ports, then
// stops (`Compilation::Stop`).
// One difference from the probe, forced by rustc_interface/limits.ts (its `hir_krate_attrs` stand-in, a merge-w14 root
// item; lane ty-print-b's pretty_oracle/run.ts has the same one): `FmtPrinter::new` is replaced in this process by
// `FmtPrinter::new_with_limit(tcx, ns, Limit::new(2^24))`, the `type_length_limit` limits.rs:24 gives a crate without
// `#![type_length_limit]`, instead of reading the `limits` query. No case comes near the limit. The sections
// `display_int`, `valtree_consts` (printing an integer `Const` needs `Ty::is_ptr_sized_integral`) and `value_preds`
// (`Ty::is_bool`) are not printed (the first two are under `-Zverbose-internals`): those `Ty` predicates are lane
// ty-sty's stubs; consts.test.ts checks those lines.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../context.ts";
import { Panic, Unported } from "../../../../std/panic.ts";
import { ensure_stack } from "../../../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../../../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../../../../rustc_session/config.ts");
  const { Size, debug_Size } = await import("../../../../rustc_abi/lib.ts");
  const { PLAIN, PRETTY, debug_option, debug_char } = await import("../../../../std/fmt.ts");
  const int = await import("../int.ts");
  const { ScalarInt, ConstInt, debug_ConstInt, debug_ScalarInt, lower_hex_ScalarInt, upper_hex_ScalarInt, display_ScalarInt, ScalarInt_eq } = int;
  const { ValTree, debug_ValTree, debug_Value, display_Value } = await import("../valtree.ts");
  const { Const } = await import("../../../../rustc_type_ir/sty/consts.ts");
  const { display_Const } = await import("../../../../rustc_type_ir/ir_print.ts");
  const { FmtPrinter } = await import("../../print/pretty.ts");
  const { Limit } = await import("../../../../rustc_structures/limit.ts");
  (FmtPrinter as unknown as { new: unknown }).new = (tcx: TyCtxt, ns: import("../../../../rustc_hir/def.ts").Namespace) => FmtPrinter.new_with_limit(tcx, ns, Limit.new(2 ** 24));
  type ScalarIntT = import("../int.ts").ScalarInt;
  type Ty = import("../../mod.ts").Ty;
  type ValTreeT = import("../valtree.ts").ValTree;
  type ConstT = import("../../../../rustc_type_ir/sty/consts.ts").Const;

  const dbg = (s: ScalarIntT): string => debug_ScalarInt(s, PLAIN);
  const opt = (s: ScalarIntT | undefined): string => debug_option(s, PLAIN, debug_ScalarInt);
  const pair = ([s, b]: [ScalarIntT, boolean]): string => `(${dbg(s)}, ${b})`;
  const res_bool = (r: import("../../../../std/result.ts").Result<boolean, null>): string => (r.$ === "Ok" ? `Ok(${r._0})` : "Err(())");
  const res_char = (r: import("../../../../std/result.ts").Result<number, string>): string => (r.$ === "Ok" ? `Ok(${debug_char(r._0)})` : `Err(${r._0})`);
  const new_value = (tcx: TyCtxt, vt: ValTreeT, ty: Ty): ConstT => Const.new_value(tcx, vt as never, ty);
  const value_of = (c: ConstT) => c.to_value();

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      let out = "";

      out += "== scalar_int\n";
      const sis: [string, ScalarIntT][] = [
        ["u8_42", ScalarInt.from_u8(42)],
        ["u16_7", ScalarInt.from_u16(7)],
        ["i32_m1", ScalarInt.from_i32(-1)],
        ["i16_m300", ScalarInt.from_i16(-300)],
        ["u64_big", ScalarInt.from_u64(0x1234_5678_9abc_def0n)],
        ["u128_max", ScalarInt.from_u128((1n << 128n) - 1n)],
        ["bool_t", ScalarInt.from_bool(true)],
        ["char_a", ScalarInt.from_char(0x61)],
        ["null8", ScalarInt.null(Size.from_bytes(8))],
      ];
      for (const [n, s] of sis) {
        out += `${n} ${dbg(s)} ${lower_hex_ScalarInt(s, PLAIN)} ${lower_hex_ScalarInt(s, PRETTY)} ${upper_hex_ScalarInt(s, PLAIN)} ${display_ScalarInt(s)}\n`;
      }

      out += "== scalar_ops\n";
      const s1 = Size.from_bytes(1);
      const s4 = Size.from_bytes(4);
      out += `try_from_uint(300, 1) ${opt(ScalarInt.try_from_uint(300n, s1))}\n`;
      out += `try_from_uint(255, 1) ${opt(ScalarInt.try_from_uint(255n, s1))}\n`;
      out += `truncate_from_uint(0x1ff, 1) ${pair(ScalarInt.truncate_from_uint(0x1ffn, s1))}\n`;
      out += `try_from_int(-128, 1) ${opt(ScalarInt.try_from_int(-128n, s1))}\n`;
      out += `try_from_int(-129, 1) ${opt(ScalarInt.try_from_int(-129n, s1))}\n`;
      out += `truncate_from_int(-129, 1) ${pair(ScalarInt.truncate_from_int(-129n, s1))}\n`;
      out += `truncate_from_int(200, 1) ${pair(ScalarInt.truncate_from_int(200n, s1))}\n`;
      const m1 = ScalarInt.from_i32(-1);
      out += `to_int(-1i32, 4) ${m1.to_int(s4)} to_uint ${m1.to_uint(s4)} to_i32 ${m1.to_i32()} to_u32 ${m1.to_u32()}\n`;
      out += `to_i8(0x80u8) ${ScalarInt.from_u8(0x80).to_i8()} to_u8 ${ScalarInt.from_u8(0x80).to_u8()}\n`;
      const i128_min = ScalarInt.from_i128(-(1n << 127n));
      out += `i128::MIN to_i128 ${i128_min.to_i128()} to_u128 ${i128_min.to_u128()}\n`;
      out += `try_to_bool 0 ${res_bool(ScalarInt.from_u8(0).try_to_bool())} 1 ${res_bool(ScalarInt.from_u8(1).try_to_bool())} 2 ${res_bool(ScalarInt.from_u8(2).try_to_bool())}\n`;
      out += `char 0x61 ${res_char(ScalarInt.try_into_char(ScalarInt.from_u32(0x61)))} 0xd800 ${res_char(ScalarInt.try_into_char(ScalarInt.from_u32(0xd800)))} 0x110000 ${res_char(ScalarInt.try_into_char(ScalarInt.from_u32(0x110000)))}\n`;
      out += `is_null ${ScalarInt.null(s4).is_null()} ${ScalarInt.from_u8(1).is_null()} size ${debug_Size(ScalarInt.from_u16(5).size(), PLAIN)}\n`;
      out += `ordering ${dbg(ScalarInt.from_Ordering(-1))} ${dbg(ScalarInt.from_Ordering(1))}\n`;
      out += `atomic ${ScalarInt.from_u32(4).to_atomic_ordering()} simd ${ScalarInt.from_u32(2).to_simd_alignment()}\n`;
      out += `eq ${ScalarInt_eq(ScalarInt.from_u8(1), ScalarInt.TRUE)} ${ScalarInt_eq(ScalarInt.from_u16(1), ScalarInt.TRUE)}\n`;

      out += "== const_int\n";
      const cis: [ScalarIntT, boolean, boolean][] = [
        [ScalarInt.from_i8(-128), true, false],
        [ScalarInt.from_i8(127), true, false],
        [ScalarInt.from_i32(-5), true, false],
        [ScalarInt.from_i16(7), true, false],
        [ScalarInt.from_i64(-(1n << 63n)), true, true],
        [ScalarInt.from_i64((1n << 63n) - 1n), true, true],
        [ScalarInt.from_i64(-3n), true, true],
        [ScalarInt.from_i128(-(1n << 127n)), true, false],
        [ScalarInt.from_u8(255), false, false],
        [ScalarInt.from_u16(7), false, false],
        [ScalarInt.from_u32(0xffff_ffff), false, false],
        [ScalarInt.from_u64(3n), false, true],
        [ScalarInt.from_u64((1n << 64n) - 1n), false, true],
        [ScalarInt.from_u128(12345678901234567890123n), false, false],
      ];
      for (const [i, signed, ptr] of cis) {
        const ci = ConstInt.new(i, signed, ptr);
        out += `${debug_ConstInt(ci, PLAIN)} ${debug_ConstInt(ci, PRETTY)}\n`;
      }

      out += "== valtree\n";
      const vt42 = ValTree.from_scalar_int(tcx, ScalarInt.from_u8(42));
      const c1 = new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u8(1)), tcx.types.u8);
      const c2 = new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u8(2)), tcx.types.u8);
      const br = ValTree.from_branches(tcx, [c1, c2]);
      const zst = ValTree.zst(tcx);
      out += `${debug_ValTree(vt42, PLAIN)} ${vt42.is_zst()} ${vt42 === ValTree.from_scalar_int(tcx, ScalarInt.from_u8(42))}\n`;
      out += `${br.is_zst()} ${br === ValTree.from_branches(tcx, [c1, c2])}\n`;
      out += `${debug_ValTree(zst, PLAIN)} ${zst.is_zst()} ${zst === ValTree.from_branches(tcx, [])}\n`;

      out += "== value\n";
      const c42 = new_value(tcx, vt42, tcx.types.u8);
      out += `${debug_Value(value_of(c42), PLAIN)}\n`;
      out += `${debug_Value(value_of(tcx.consts.unit), PLAIN)}\n`;
      const leaf = (c: ConstT) => c.try_to_leaf() as unknown as ScalarIntT | undefined;
      const branch_len = c42.try_to_branch();
      out += `${opt(leaf(c42))} ${branch_len === undefined ? "None" : `Some(${branch_len.length})`} ${dbg(c42.to_leaf() as unknown as ScalarIntT)}\n`;
      const cbr = new_value(tcx, br, tcx.types.u8);
      out += `${opt(leaf(cbr))} ${cbr.to_branch().length}\n`;
      out += `${tcx.consts.true_ === new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_bool(true)), tcx.types.bool)} ${Const.zero_sized(tcx, tcx.types.unit) === tcx.consts.unit}\n`;

      out += "== display\n";
      const ca = new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_char(0x61)), tcx.types.char);
      const cq = new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_char(0x27)), tcx.types.char);
      const cn = new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_char(0x0a)), tcx.types.char);
      out += `${display_Const(tcx.consts.true_)} ${display_Const(tcx.consts.false_)} ${display_Const(tcx.consts.unit)} ${display_Const(ca)} ${display_Const(cq)} ${display_Const(cn)}\n`;
      out += `${display_Value(value_of(tcx.consts.true_))} ${display_Value(value_of(ca))}\n`;

      // `display_int` / `valtree_consts` print integers through `Ty::is_ptr_sized_integral` (lane ty-sty's stub) except under
      // `-Zverbose-internals`, where a value const prints as `ValTree(..: ty)`.
      if (tcx.sess.verbose_internals()) {
        out += "== display_int\n";
        const ints: [ScalarIntT, Ty][] = [
          [ScalarInt.from_u8(42), tcx.types.u8],
          [ScalarInt.from_i32(-5), tcx.types.i32],
          [ScalarInt.from_i8(-128), tcx.types.i8],
          [ScalarInt.from_u64((1n << 64n) - 1n), tcx.types.u64],
          [ScalarInt.from_u64(3n), tcx.types.usize],
          [ScalarInt.from_i64(-1n), tcx.types.isize],
          [ScalarInt.from_i64((1n << 63n) - 1n), tcx.types.isize],
          [ScalarInt.from_u128((1n << 128n) - 1n), tcx.types.u128],
        ];
        for (const [i, t] of ints) {
          const c = new_value(tcx, ValTree.from_scalar_int(tcx, i), t);
          out += `${display_Const(c)} ${display_Value(value_of(c))}\n`;
        }

        out += "== valtree_consts\n";
        const raw = ValTree.from_raw_bytes(tcx, new TextEncoder().encode("hi"));
        out += `${debug_ValTree(br, PLAIN)} ${debug_ValTree(raw, PLAIN)}\n`;
      }

      std_print(out);
      return "Stop";
    },
  };

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}

// Unit tests of the interp-validity-intern lane (interpret/validity.ts) for the parts reachable before the other CTFE
// fill lanes land: the message formatting (byte-exact copies of validity.rs's `format!`s), `RefTracking`, and the
// `ValidityVisitor` paths that do not read memory (`visit_scalar`, `aggregate_field_path_elem`, `with_elem`).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { WrappingRange } from "../../rustc_abi/wrapping_range.ts";
import "../../rustc_hir_analysis/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import type { InterpErrorInfo, InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import { key_MPlaceTy } from "./place.ts";
import {
  CtfeValidationMode,
  display_ExpectedKind,
  display_PtrKind,
  ExpectedKind_from_PtrKind,
  fmt_range,
  Path,
  PathElem,
  PtrKind,
  RefTracking,
  ValidationErrorKind,
  ValidityVisitor,
  write_path,
} from "./validity.ts";

test("fmt_range: every case of validity.rs:212", () => {
  const max = 255n;
  expect(fmt_range(new WrappingRange(10n, 2n), max)).toBe("less or equal to 2, or greater or equal to 10");
  expect(fmt_range(new WrappingRange(3n, 3n), max)).toBe("equal to 3");
  expect(fmt_range(new WrappingRange(0n, 1n), max)).toBe("less or equal to 1");
  expect(fmt_range(new WrappingRange(1n, 255n), max)).toBe("greater or equal to 1");
  expect(fmt_range(new WrappingRange(2n, 7n), max)).toBe("in the range 2..=7");
  expect(() => fmt_range(new WrappingRange(0n, 255n), max)).toThrow("should not be printing if the range covers everything");
});

test("Display impls, From<PtrKind>, ValidationErrorKind::to_string / ptr_bytes_warning", () => {
  expect(display_PtrKind({ $: "Ref", _0: "Not" }, PLAIN)).toBe("reference");
  expect(display_PtrKind(PtrKind.Box, PLAIN)).toBe("box");
  expect(ExpectedKind_from_PtrKind(PtrKind.Box)).toBe("Box");
  expect(ExpectedKind_from_PtrKind({ $: "Ref", _0: "Mut" })).toBe("Reference");
  expect(display_ExpectedKind("Char", PLAIN)).toBe("expected a unicode scalar value");
  expect(display_ExpectedKind("Int", PLAIN)).toBe("expected an integer");
  expect(ValidationErrorKind.to_string({ $: "Uninit", expected: "Bool" })).toBe("encountered uninitialized memory, but expected a boolean");
  expect(ValidationErrorKind.to_string({ $: "PointerAsInt", expected: "Float" })).toBe(
    "encountered a pointer, but expected a floating point number",
  );
  expect(ValidationErrorKind.to_string(ValidationErrorKind.PartialPointer)).toBe("encountered a partial pointer or a mix of pointers");
  expect(ValidationErrorKind.to_string({ $: "GeneralError", msg: "m" })).toBe("m");
  expect(ValidationErrorKind.ptr_bytes_warning({ $: "PointerAsInt", expected: "Int" })).toBe(true);
  expect(ValidationErrorKind.ptr_bytes_warning(ValidationErrorKind.PartialPointer)).toBe(true);
  expect(ValidationErrorKind.ptr_bytes_warning({ $: "Uninit", expected: "Int" })).toBe(false);
  expect(CtfeValidationMode.allow_immutable_unsafe_cell({ $: "Const", allow_immutable_unsafe_cell: true })).toBe(true);
  expect(CtfeValidationMode.allow_immutable_unsafe_cell({ $: "Static", mutbl: "Not" })).toBe(false);
  expect(CtfeValidationMode.allow_immutable_unsafe_cell(CtfeValidationMode.Promoted)).toBe(false);
});

test("RefTracking: `new` seeds todo and seen, `track` dedups by value, `next` pops", () => {
  const key = (s: { k: string }) => s.k;
  const rt = RefTracking.empty<{ k: string }, number>(key);
  expect(rt.next()).toBeUndefined();
  let made = 0;
  rt.track({ k: "a" }, () => ++made);
  rt.track({ k: "a" }, () => ++made); // the same value: no second path
  rt.track({ k: "b" }, () => ++made);
  expect(made).toBe(2);
  expect(rt.next()).toEqual([{ k: "b" }, 2]);
  expect(rt.next()).toEqual([{ k: "a" }, 1]);
  expect(rt.next()).toBeUndefined();
});

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
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
].join("\n");

function validation_error(r: InterpResult): { path: string | undefined; msg: string } {
  if (r.$ !== "Err") throw new Error("ERROR: expected a validation error");
  const kind = (r._0 as InterpErrorInfo).kind();
  if (kind.$ !== "UndefinedBehavior" || kind._0.$ !== "ValidationError") throw new Error("ERROR: not a ValidationError");
  return { path: kind._0.path, msg: kind._0.msg };
}

test("ValidityVisitor: visit_scalar messages, paths, aggregate_field_path_elem", () => {
  const file = join(DATA, "tmp", "interp-validity-intern", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "validity.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    create_and_enter_global_ctxt(compiler, parse(compiler.sess), (tcx) => {
      void tcx.resolver_for_lowering();
      const typing_env = TypingEnv.fully_monomorphized();
      const ecx = InterpCx.new(tcx, DUMMY_SP, typing_env, CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      const bool_l = ecx.layout_of(tcx.types.bool);
      if (bool_l.$ !== "Ok" || bool_l._0.backend_repr.$ !== "Scalar") throw new Error("ERROR: bool layout");
      const bool_scalar = bool_l._0.backend_repr._0;
      const v = new ValidityVisitor(Path.new(tcx.types.bool), RefTracking.empty(key_MPlaceTy), undefined, ecx, false, undefined, false);

      // in range
      expect(v.visit_scalar({ $: "Int", _0: ScalarInt.from_u8(1) }, bool_scalar).$).toBe("Ok");
      // out of range, no path
      expect(validation_error(v.visit_scalar({ $: "Int", _0: ScalarInt.from_u8(2) }, bool_scalar))).toEqual({
        path: undefined,
        msg: "encountered 2, but expected something less or equal to 1",
      });

      // with_elem pushes and pops; the path is printed by write_path
      const r = v.with_elem({ $: "Field", _0: Symbol.intern("inner") }, (v) =>
        v.with_elem({ $: "TupleElem", _0: 1 }, (v) =>
          v.with_elem(PathElem.Deref, (v) => v.with_elem({ $: "ArrayElem", _0: 3 }, (v) => v.visit_scalar({ $: "Int", _0: ScalarInt.from_u8(9) }, bool_scalar))),
        ),
      );
      expect(validation_error(r)).toEqual({ path: ".inner.1.<deref>[3]", msg: "encountered 9, but expected something less or equal to 1" });
      expect(v.path.projs.length).toBe(4); // an error leaves the path as it was at the failure (the `?` skips the truncate)
      v.path.projs.length = 0;
      expect(v.with_elem(PathElem.EnumTag, () => ({ $: "Ok", _0: 5 }) as InterpResult<number>)).toEqual({ $: "Ok", _0: 5 });
      expect(v.path.projs.length).toBe(0);

      const out: MutRef<string> = { value: "" };
      write_path(out, [
        PathElem.EnumTag,
        { $: "Variant", _0: Symbol.intern("Some") },
        PathElem.CoroutineTag,
        { $: "CapturedVar", _0: Symbol.intern("x") },
        PathElem.Vtable,
        { $: "DynDowncast", _0: tcx.types.u8 },
      ]);
      expect(out.value).toBe(".<enum-tag>.<enum-variant(Some)>.<coroutine-tag>.<captured-var(x)>.<vtable>.<dyn-downcast(u8)>");

      // tuples and arrays
      const tup = Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool]);
      const tup_l = ecx.layout_of(tup);
      if (tup_l.$ !== "Ok") throw new Error("ERROR: tuple layout");
      expect(v.aggregate_field_path_elem(tup_l._0, 1, tcx.types.bool)).toEqual({ $: "TupleElem", _0: 1 });
      ran = true;
    });
  });
  expect(ran).toBe(true);
}, 120_000);

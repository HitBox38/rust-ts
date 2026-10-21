// Port of compiler/rustc_middle/src/ty/pattern.rs (lane small-gaps-19).
//
// PORT (D2): `Pattern(Interned<PatternKind>)` is the frozen class `Pattern extends Interned`, made only by
// `TyCtxt::mk_pat` (ty/context.ts). `impl Deref for Pattern` (`**self` / `&*pat`, the interned `PatternKind`) is
// `pat.kind()` (the `IntoKind` impl returns the same value; `Interned` already owns the name `deref`).
// `impl IrPrint<PatternKind> for TyCtxt` is the `IR_PRINT.PatternKind` slot of rustc_type_ir's registry
// (ir_print.ts header), assigned at module load. `StableHash` is not needed yet (no query hashes a pattern).
import { Interned } from "../../rustc_data_structures/intern.ts";
import type { DebruijnIndex } from "../../rustc_type_ir/lib.gen.ts";
import { INNERMOST } from "../../rustc_type_ir/lib.gen.ts";
import { FlagComputation } from "../../rustc_type_ir/flags.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.gen.ts";
import { display_Const, IR_PRINT, type IrPrint } from "../../rustc_type_ir/ir_print.ts";
import type { PatternKind as ir_PatternKind } from "../../rustc_type_ir/pattern.gen.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { ScalarInt, ScalarInt_eq } from "./consts/int.ts";
import { Value } from "./consts/valtree.ts";
import "./consts.ts";

export type PatternKind = ir_PatternKind;

// #[derive(Copy, Clone, PartialEq, Eq, Hash, StableHash)]
// #[rustc_pass_by_value]
// rustc-type: compiler/rustc_middle/src/ty/pattern.rs:16 Pattern
export class Pattern extends Interned {
  /** PORT: the interned `PatternKind` (module comment). */
  readonly internee: PatternKind;

  /** PORT: only `tcx.mk_pat` constructs (D2); the kind object is frozen with it. */
  constructor(internee: PatternKind) {
    super();
    this.internee = Object.freeze(internee);
    Object.freeze(this);
  }

  // ---- impl Flags for Pattern ----

  // rustc: compiler/rustc_middle/src/ty/pattern.rs:19 flags
  flags(): TypeFlags {
    const k = this.kind();
    switch (k.$) {
      case "Range":
        return (FlagComputation.for_const_kind(k.start.kind()).flags | FlagComputation.for_const_kind(k.end.kind()).flags) as TypeFlags;
      case "Or": {
        const pats = k._0;
        let flags = pats[0]!.flags();
        for (const pat of pats.slice(1)) {
          flags = (flags | pat.flags()) as TypeFlags;
        }
        return flags;
      }
      case "NotNull":
        return TypeFlags.empty();
    }
  }

  // rustc: compiler/rustc_middle/src/ty/pattern.rs:36 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    const k = this.kind();
    switch (k.$) {
      case "Range":
        return Math.max(k.start.outer_exclusive_binder(), k.end.outer_exclusive_binder()) as DebruijnIndex;
      case "Or": {
        const pats = k._0;
        let idx = pats[0]!.outer_exclusive_binder();
        for (const pat of pats.slice(1)) {
          idx = Math.max(idx, pat.outer_exclusive_binder()) as DebruijnIndex;
        }
        return idx;
      }
      case "NotNull":
        return INNERMOST;
    }
  }

  // ---- impl IntoKind for Pattern (`impl Deref for Pattern`: `Pattern_deref` below) ----

  // rustc: compiler/rustc_middle/src/ty/pattern.rs:119 kind
  kind(): PatternKind {
    return this.internee;
  }
}

// rustc: compiler/rustc_middle/src/ty/pattern.rs:56 deref
export function Pattern_deref(self: Pattern): PatternKind {
  return self.internee;
}

/** `impl Debug for Pattern`: `write!(f, "{:?}", **self)` (the `PatternKind` Debug is `IrPrint::print_debug`). */
// rustc: compiler/rustc_middle/src/ty/pattern.rs:62 fmt
export function debug_Pattern(self: Pattern, f: Fmt): string {
  return print_debug_PatternKind(Pattern_deref(self), f);
}

/** `<Pattern as Display>` through auto-deref: `pat.to_string()` is `PatternKind`'s `Display` (`IrPrint::print`). */
export function display_Pattern(self: Pattern): string {
  return print_PatternKind(Pattern_deref(self), PLAIN);
}

/** `char::MAX` */
const CHAR_MAX = 0x10ffffn;

// ---- impl IrPrint<PatternKind> for TyCtxt ----

// rustc: compiler/rustc_middle/src/ty/pattern.rs:68 print
function print_PatternKind(t: PatternKind, _f: Fmt): string {
  switch (t.$) {
    case "Range": {
      const { start, end } = t;
      let out = display_Const(start);

      const c = end.try_to_value();
      if (c !== undefined) {
        const end = Value.to_leaf(c);
        const size = end.size();
        let max: [ScalarInt, boolean] | undefined;
        const k = c.ty.kind();
        switch (k.$) {
          case "Int":
            max = ScalarInt.truncate_from_int(size.signed_int_max(), size);
            break;
          case "Uint":
            max = ScalarInt.truncate_from_uint(size.unsigned_int_max(), size);
            break;
          case "Char":
            max = ScalarInt.truncate_from_uint(CHAR_MAX, size);
            break;
          default:
            max = undefined;
        }
        if (max !== undefined && ScalarInt_eq(end, max[0])) {
          return out + "..";
        }
      }

      out += `..=${display_Const(end)}`;
      return out;
    }
    case "NotNull":
      return "!null";
    case "Or": {
      const patterns = t._0;
      let out = "(";
      let first = true;
      for (const pat of patterns) {
        if (first) {
          first = false;
        } else {
          out += " | ";
        }
        out += debug_Pattern(pat, PLAIN);
      }
      return out + ")";
    }
  }
}

// rustc: compiler/rustc_middle/src/ty/pattern.rs:112 print_debug
function print_debug_PatternKind(t: PatternKind, fmt: Fmt): string {
  return print_PatternKind(t, fmt);
}

const IrPrint_PatternKind: IrPrint<PatternKind> = { print: print_PatternKind, print_debug: print_debug_PatternKind };
IR_PRINT.PatternKind = IrPrint_PatternKind;

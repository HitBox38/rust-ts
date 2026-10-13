// Port of compiler/rustc_builtin_macros/src/format_foreign/printf/tests.rs
// PORT: `assert_eq!` on `Option<(Substitution, &str)>` compares the derived Debug of both sides
// (`Substitution` derives Debug and PartialEq over the same fields).
import { expect, test } from "bun:test";
import { InnerSpan } from "../../../rustc_span/lib.ts";
import { debug_option, debug_str, debug_tuple, PLAIN } from "../../../std/fmt.ts";
import { Str } from "../../../std/str.ts";
import {
  Format as F,
  Num as N,
  type Num,
  Substitution as S,
  type Substitution,
  debug_Substitution,
  iter_subs,
  parse_next_substitution as pns_,
} from "./mod.ts";

const pns = (s: string): [Substitution, string] | undefined => {
  const r = pns_(Str.from(s));
  return r === undefined ? undefined : [r[0], r[1].toString()];
};

const dbg = (v: [Substitution, string] | undefined): string =>
  debug_option(v, PLAIN, (x, f) => debug_tuple(f, "", [debug_Substitution(x[0], f), debug_str(x[1])]));

function assert_eq_pnsat(lhs: string, rhs: string | undefined): void {
  const r = pns(lhs);
  let got: string | undefined;
  if (r !== undefined) {
    const t = S.translate(r[0]);
    got = t.$ === "Ok" ? t._0 : undefined;
  }
  expect(got).toBe(rhs);
}

// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/tests.rs:13 test_escape
test("test_escape", () => {
  expect(dbg(pns("has no escapes"))).toBe(dbg(undefined));
  expect(dbg(pns("has no escapes, either %"))).toBe(dbg(undefined));
  expect(dbg(pns("*so* has a %% escape"))).toBe(dbg([{ $: "Escape", _0: [11, 13] }, " escape"]));
  expect(dbg(pns("%% leading escape"))).toBe(dbg([{ $: "Escape", _0: [0, 2] }, " leading escape"]));
  expect(dbg(pns("trailing escape %%"))).toBe(dbg([{ $: "Escape", _0: [16, 18] }, ""]));
});

// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/tests.rs:22 test_parse
test("test_parse", () => {
  const assert_pns_eq_sub = (
    in_: string,
    [param, flags, width, prec, len, type_, pos]: [
      number | undefined,
      string,
      Num | undefined,
      Num | undefined,
      string | undefined,
      string,
      [number, number],
    ],
  ): void => {
    expect(dbg(pns(in_ + "!"))).toBe(
      dbg([{ $: "Format", _0: new F(in_, param, flags, width, prec, len, type_, InnerSpan.new(pos[0], pos[1])) }, "!"]),
    );
  };
  const Num = (n: number): Num => ({ $: "Num", _0: n });
  const Arg = (n: number): Num => ({ $: "Arg", _0: n });
  const Next = N.Next;

  assert_pns_eq_sub("%!", [undefined, "", undefined, undefined, undefined, "!", [0, 2]]);
  assert_pns_eq_sub("%c", [undefined, "", undefined, undefined, undefined, "c", [0, 2]]);
  assert_pns_eq_sub("%s", [undefined, "", undefined, undefined, undefined, "s", [0, 2]]);
  assert_pns_eq_sub("%06d", [undefined, "0", Num(6), undefined, undefined, "d", [0, 4]]);
  assert_pns_eq_sub("%4.2f", [undefined, "", Num(4), Num(2), undefined, "f", [0, 5]]);
  assert_pns_eq_sub("%#x", [undefined, "#", undefined, undefined, undefined, "x", [0, 3]]);
  assert_pns_eq_sub("%-10s", [undefined, "-", Num(10), undefined, undefined, "s", [0, 5]]);
  assert_pns_eq_sub("%*s", [undefined, "", Next, undefined, undefined, "s", [0, 3]]);
  assert_pns_eq_sub("%-10.*s", [undefined, "-", Num(10), Next, undefined, "s", [0, 7]]);
  assert_pns_eq_sub("%-*.*s", [undefined, "-", Next, Next, undefined, "s", [0, 6]]);
  assert_pns_eq_sub("%.6i", [undefined, "", undefined, Num(6), undefined, "i", [0, 4]]);
  assert_pns_eq_sub("%+i", [undefined, "+", undefined, undefined, undefined, "i", [0, 3]]);
  assert_pns_eq_sub("%08X", [undefined, "0", Num(8), undefined, undefined, "X", [0, 4]]);
  assert_pns_eq_sub("%lu", [undefined, "", undefined, undefined, "l", "u", [0, 3]]);
  assert_pns_eq_sub("%Iu", [undefined, "", undefined, undefined, "I", "u", [0, 3]]);
  assert_pns_eq_sub("%I32u", [undefined, "", undefined, undefined, "I32", "u", [0, 5]]);
  assert_pns_eq_sub("%I64u", [undefined, "", undefined, undefined, "I64", "u", [0, 5]]);
  assert_pns_eq_sub("%'d", [undefined, "'", undefined, undefined, undefined, "d", [0, 3]]);
  assert_pns_eq_sub("%10s", [undefined, "", Num(10), undefined, undefined, "s", [0, 4]]);
  assert_pns_eq_sub("%-10.10s", [undefined, "-", Num(10), Num(10), undefined, "s", [0, 8]]);
  assert_pns_eq_sub("%1$d", [1, "", undefined, undefined, undefined, "d", [0, 4]]);
  assert_pns_eq_sub("%2$.*3$d", [2, "", undefined, Arg(3), undefined, "d", [0, 8]]);
  assert_pns_eq_sub("%1$*2$.*3$d", [1, "", Arg(2), Arg(3), undefined, "d", [0, 11]]);
  assert_pns_eq_sub("%-8ld", [undefined, "-", Num(8), undefined, "l", "d", [0, 5]]);
});

// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/tests.rs:99 test_iter
test("test_iter", () => {
  const s = "The %d'th word %% is: `%.*s` %!\n";
  const subs = [...iter_subs(Str.from(s), 0)].map((sub) => {
    const t = S.translate(sub);
    return t.$ === "Ok" ? t._0 : undefined;
  });
  expect(subs).toEqual(["{}", undefined, "{:.*}", undefined]);
});

/// Checks that the translations are what we expect.
// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/tests.rs:110 test_translation
test("test_translation", () => {
  assert_eq_pnsat("%c", "{}");
  assert_eq_pnsat("%d", "{}");
  assert_eq_pnsat("%u", "{}");
  assert_eq_pnsat("%x", "{:x}");
  assert_eq_pnsat("%X", "{:X}");
  assert_eq_pnsat("%e", "{:e}");
  assert_eq_pnsat("%E", "{:E}");
  assert_eq_pnsat("%f", "{}");
  assert_eq_pnsat("%g", "{:e}");
  assert_eq_pnsat("%G", "{:E}");
  assert_eq_pnsat("%s", "{}");
  assert_eq_pnsat("%p", "{:p}");

  assert_eq_pnsat("%06d", "{:06}");
  assert_eq_pnsat("%4.2f", "{:4.2}");
  assert_eq_pnsat("%#x", "{:#x}");
  assert_eq_pnsat("%-10s", "{:<10}");
  assert_eq_pnsat("%*s", undefined);
  assert_eq_pnsat("%-10.*s", "{:<10.*}");
  assert_eq_pnsat("%-*.*s", undefined);
  assert_eq_pnsat("%.6i", "{:06}");
  assert_eq_pnsat("%+i", "{:+}");
  assert_eq_pnsat("%08X", "{:08X}");
  assert_eq_pnsat("%lu", "{}");
  assert_eq_pnsat("%Iu", "{}");
  assert_eq_pnsat("%I32u", "{}");
  assert_eq_pnsat("%I64u", "{}");
  assert_eq_pnsat("%'d", undefined);
  assert_eq_pnsat("%10s", "{:>10}");
  assert_eq_pnsat("%-10.10s", "{:<10.10}");
  assert_eq_pnsat("%1$d", "{0}");
  assert_eq_pnsat("%2$.*3$d", "{1:02$}");
  assert_eq_pnsat("%1$*2$.*3$s", "{0:>1$.2$}");
  assert_eq_pnsat("%-8ld", "{:<8}");
});

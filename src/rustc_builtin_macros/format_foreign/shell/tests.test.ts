// Port of compiler/rustc_builtin_macros/src/format_foreign/shell/tests.rs
// PORT: `assert_eq!` on `Option<(Substitution, &str)>` compares the derived Debug of both sides
// (`Substitution` derives Debug and PartialEq over the same fields).
import { expect, test } from "bun:test";
import { debug_option, debug_str, debug_tuple, PLAIN } from "../../../std/fmt.ts";
import { Str } from "../../../std/str.ts";
import { Substitution as S, type Substitution, debug_Substitution, iter_subs, parse_next_substitution as pns_ } from "./mod.ts";

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

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/tests.rs:13 test_escape
test("test_escape", () => {
  expect(dbg(pns("has no escapes"))).toBe(dbg(undefined));
  expect(dbg(pns("has no escapes, either $"))).toBe(dbg(undefined));
  expect(dbg(pns("*so* has a $$ escape"))).toBe(dbg([{ $: "Escape", _0: [11, 13] }, " escape"]));
  expect(dbg(pns("$$ leading escape"))).toBe(dbg([{ $: "Escape", _0: [0, 2] }, " leading escape"]));
  expect(dbg(pns("trailing escape $$"))).toBe(dbg([{ $: "Escape", _0: [16, 18] }, ""]));
});

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/tests.rs:22 test_parse
test("test_parse", () => {
  const assert_pns_eq_sub = (in_: string, sub: Substitution): void => {
    expect(dbg(pns(in_ + "!"))).toBe(dbg([sub, "!"]));
  };

  assert_pns_eq_sub("$0", { $: "Ordinal", _0: 0, _1: [0, 2] });
  assert_pns_eq_sub("$1", { $: "Ordinal", _0: 1, _1: [0, 2] });
  assert_pns_eq_sub("$9", { $: "Ordinal", _0: 9, _1: [0, 2] });
  assert_pns_eq_sub("$N", { $: "Name", _0: "N", _1: [0, 2] });
  assert_pns_eq_sub("$NAME", { $: "Name", _0: "NAME", _1: [0, 5] });
});

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/tests.rs:37 test_iter
test("test_iter", () => {
  const s = "The $0'th word $$ is: `$WORD` $!\n";
  const subs = [...iter_subs(Str.from(s), 0)].map((sub) => {
    const t = S.translate(sub);
    return t.$ === "Ok" ? t._0 : undefined;
  });
  expect(subs).toEqual(["{0}", undefined, "{WORD}"]);
});

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/tests.rs:48 test_translation
test("test_translation", () => {
  assert_eq_pnsat("$0", "{0}");
  assert_eq_pnsat("$9", "{9}");
  assert_eq_pnsat("$1", "{1}");
  assert_eq_pnsat("$10", "{1}");
  assert_eq_pnsat("$stuff", "{stuff}");
  assert_eq_pnsat("$NAME", "{NAME}");
  assert_eq_pnsat("$PREFIX/bin", "{PREFIX}");
});

// Tests for state/expr.ts and state/item.ts (compiler/rustc_ast_pretty/src/pprust/state/{expr,item}.rs)
// against the real rustc.
//
// Expectations: `expr_item.oracle.json`, produced by the scratch program `expr_item.oracle.rs.txt`
// (a copy of $RUST_TS_DATA/tmp/pprust-ei/oracle/main.rs), built and run with
//   rustc +nightly-2026-10-11 --edition 2024 main.rs -o oracle
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib ./oracle > expr_item.oracle.json
// using the toolchain's rustc-dev component. It parses each snippet with `rustc_parse` (session
// edition 2024), optionally strips every `ExprKind::Paren` (cases with `unparen: true`, which makes
// the printer re-insert parentheses through `FixupContext`), and records the printed output of
// `pprust::{expr_to_string, item_to_string, crate_to_string_for_macros}` plus the AST as JSON.
//
// The JSON already has the rust-ts AST shape (rust-ts mirrors rustc_ast field-for-field), so this
// test only revives it: `{"#": "<Struct>"}` becomes an instance of the generated class of that name
// (or a plain object for interface types), `{"#sym"}`/`{"#ident"}`/`{"#bytes"}` are interned,
// `{"#map"}` is an empty `Map` (`FormatArguments::names`, unused by the printer), `"§SP"`/`"§ID"`/`"§AT"`
// are `DUMMY_SP`/`DUMMY_NODE_ID`/`AttrId(0)` and `null` is `undefined`. A few expressions the parser
// never produces (`FormatArgs`, `IncludedBytes`) are built by hand in the oracle program.
//
// Temporary: delete this test (and its two fixture files) once the parser is ported and the
// printer can be tested from source text directly.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ast } from "../../../rustc_ast/lib.ts";
import * as ast_gen from "../../../rustc_ast/ast.gen.ts";
import * as format_gen from "../../../rustc_ast/format.gen.ts";
import * as token_gen from "../../../rustc_ast/token.gen.ts";
import * as tokenstream_gen from "../../../rustc_ast/tokenstream.gen.ts";
import { Edition } from "../../../rustc_span/edition.ts";
import { AttrId, DUMMY_SP, create_session_globals_then } from "../../../rustc_span/lib.ts";
import { ByteSymbol, Ident, Symbol } from "../../../rustc_span/symbol.ts";
import { crate_to_string_for_macros, expr_to_string, item_to_string } from "../mod.ts";

interface Oracle {
  exprs: { src: string; unparen: boolean; expected: string; ast: unknown }[];
  items: { src: string; expected: string; ast: unknown }[];
  crates: { src: string; expected: string; attrs: unknown; items: unknown }[];
}

const ORACLE: Oracle = JSON.parse(readFileSync(join(import.meta.dir, "expr_item.oracle.json"), "utf8"));

// Generated AST classes by name (the JSON "#" tag is the Rust struct name).
const CLASSES = new Map<string, { prototype: object }>();
for (const mod of [ast_gen, format_gen, token_gen, tokenstream_gen] as Record<string, unknown>[]) {
  for (const [name, v] of Object.entries(mod)) {
    if (typeof v === "function" && /^[A-Z]/.test(name) && !CLASSES.has(name)) {
      CLASSES.set(name, v as { prototype: object });
    }
  }
}

function revive(j: unknown): unknown {
  if (j === null) return undefined;
  if (typeof j === "string") {
    switch (j) {
      case "§SP":
        return DUMMY_SP;
      case "§ID":
        return ast.DUMMY_NODE_ID;
      case "§AT":
        return AttrId.from_u32(0);
      default:
        return j;
    }
  }
  if (Array.isArray(j)) return j.map(revive);
  if (typeof j === "object") {
    const o = j as Record<string, unknown>;
    if ("#sym" in o) return Symbol.intern(o["#sym"] as string);
    if ("#ident" in o) return Ident.new(Symbol.intern(o["#ident"] as string), DUMMY_SP);
    if ("#bytes" in o) return ByteSymbol.intern(new Uint8Array(o["#bytes"] as number[]));
    if ("#map" in o) return new Map();
    const cls = typeof o["#"] === "string" ? CLASSES.get(o["#"]) : undefined;
    const out: Record<string, unknown> = cls !== undefined ? Object.create(cls.prototype) : {};
    for (const [k, v] of Object.entries(o)) {
      if (k !== "#") out[k] = revive(v);
    }
    return out;
  }
  return j;
}

function with_globals<R>(f: () => R): R {
  return create_session_globals_then(Edition.Edition2024, [], undefined, f);
}

test("oracle fixture is non-trivial", () => {
  expect(ORACLE.exprs.length).toBeGreaterThanOrEqual(40);
  expect(ORACLE.items.length).toBeGreaterThanOrEqual(30);
  expect(ORACLE.exprs.some((e) => e.unparen)).toBe(true);
});

for (const [i, c] of ORACLE.exprs.entries()) {
  test(`expr_to_string #${i}: ${c.src}${c.unparen ? " (unparen)" : ""}`, () => {
    with_globals(() => {
      const e = revive(c.ast) as ast.Expr;
      expect(expr_to_string(e)).toBe(c.expected);
    });
  });
}

for (const [i, c] of ORACLE.items.entries()) {
  test(`item_to_string #${i}: ${c.src}`, () => {
    with_globals(() => {
      const it = revive(c.ast) as ast.Item;
      expect(item_to_string(it)).toBe(c.expected);
    });
  });
}

for (const [i, c] of ORACLE.crates.entries()) {
  test(`crate_to_string_for_macros #${i}`, () => {
    with_globals(() => {
      const krate: ast.Crate = {
        id: ast.DUMMY_NODE_ID,
        attrs: revive(c.attrs) as ast.Attribute[],
        items: revive(c.items) as ast.Item[],
        spans: { inner_span: DUMMY_SP, inject_use_span: DUMMY_SP },
        is_placeholder: false,
      };
      expect(crate_to_string_for_macros(krate)).toBe(c.expected);
    });
  });
}

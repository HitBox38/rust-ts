// Unit tests for quote.rs and to_tokens.rs over a mock bridge.
//
// Expectations for `quote` come from the oracle: quote_oracle/expected.json holds, for each `input`, the body of
// `fn main` in `rustc +nightly-2026-10-11 --edition 2021 -Zunpretty=expanded` of
//   #![feature(proc_macro_quote)] #![crate_type = "proc-macro"] extern crate proc_macro;
//   fn main() { proc_macro::quote! { <input> } }
// with all whitespace removed and `::core::panicking::panic("internal error: entered unreachable code")` written
// back as `unreachable!()` (the pretty printer shows `unreachable!()` expanded); `,)` is compared as `)`. The test lexes `input` the way
// rustc hands it to a proc macro (spacing `Joint` iff a punct is directly followed by a punct, or `'` by a
// lifetime's ident), runs the port's `quote` against the mock bridge, and prints the result without whitespace.
//
// PORT(test): the mock stands in for pm-bridge's client (the `PORT(contract)` block in lib.ts): token streams are
// arrays of client trees in a handle store, symbols a string table, spans numbers, `span_save_span` a counter.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Panic } from "../std/panic.ts";
import { Err, Ok } from "../std/result.ts";
import type { LitKind, TokenTree as BridgeTokenTree } from "./bridge/mod.ts";
import {
  BridgeMethods,
  type ClientMethods,
  client_Span,
  client_Symbol,
  client_TokenStream,
  Ident,
  Literal,
  Punct,
  quote,
  Span,
  TokenStream,
} from "./lib.ts";
import {
  ToTokens_for_bool,
  ToTokens_for_char,
  ToTokens_for_Option,
  ToTokens_for_str,
  ToTokens_for_TokenStream,
  ToTokens_for_u8,
  ToTokens_for_u128,
} from "./to_tokens.ts";

type CTree = BridgeTokenTree<client_TokenStream, client_Span, client_Symbol>;

const DEF_SITE = 1 as client_Span;
const CALL_SITE = 2 as client_Span;
const MIXED_SITE = 3 as client_Span;

// ---- mock bridge -----------------------------------------------------------------------------------------------
const store = new Map<number, CTree[]>();
let next_handle = 1;
const strings: string[] = [];
const names = new Map<string, client_Symbol>();
let saved = 0;
let input_span = 100;
const log: string[] = [];

function intern(s: string): client_Symbol {
  let n = names.get(s);
  if (n === undefined) {
    strings.push(s);
    n = strings.length as client_Symbol;
    names.set(s, n);
  }
  return n;
}
function sym_str(s: client_Symbol): string {
  return strings[s - 1]!;
}
function alloc(trees: CTree[]): client_TokenStream {
  const h = next_handle++;
  store.set(h, trees);
  return new client_TokenStream(h);
}
function take(t: client_TokenStream): CTree[] {
  const v = store.get(t.handle);
  if (v === undefined) throw new Error(`use-after-free of token stream ${t.handle}`);
  store.delete(t.handle);
  return v;
}
function get(t: client_TokenStream): CTree[] {
  const v = store.get(t.handle);
  if (v === undefined) throw new Error(`use-after-free of token stream ${t.handle}`);
  return v;
}
function deep_clone(trees: CTree[]): CTree[] {
  return trees.map((t): CTree => {
    if (t.$ !== "Group") return { $: t.$, _0: { ...t._0 } } as CTree;
    const stream = t._0.stream === undefined ? undefined : alloc(deep_clone(get(t._0.stream)));
    return { $: "Group", _0: { ...t._0, stream } };
  });
}

function lit_of(text: string): { kind: LitKind; symbol: string; suffix: string | undefined } {
  let m: RegExpMatchArray | null;
  if ((m = /^(b|c)?(r)(#*)"([\s\S]*)"\3$/.exec(text))) {
    const n = m[3]!.length;
    const kind: LitKind = m[1] === "b" ? { $: "ByteStrRaw", _0: n } : m[1] === "c" ? { $: "CStrRaw", _0: n } : { $: "StrRaw", _0: n };
    return { kind, symbol: m[4]!, suffix: undefined };
  }
  if ((m = /^(b|c)?"((?:[^"\\]|\\.)*)"$/.exec(text))) {
    const kind: LitKind = m[1] === "b" ? { $: "ByteStr" } : m[1] === "c" ? { $: "CStr" } : { $: "Str" };
    return { kind, symbol: m[2]!, suffix: undefined };
  }
  if ((m = /^(b)?'((?:[^'\\]|\\.)+)'$/.exec(text))) {
    return { kind: m[1] === "b" ? { $: "Byte" } : { $: "Char" }, symbol: m[2]!, suffix: undefined };
  }
  if ((m = /^(0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+)([a-z][a-z0-9]*)?$/.exec(text))) {
    return { kind: { $: "Integer" }, symbol: m[1]!, suffix: m[2] };
  }
  if ((m = /^([0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9_]+)?)([a-z][a-z0-9]*)?$/.exec(text))) {
    const float = /[.eE]/.test(m[1]!);
    return { kind: float ? { $: "Float" } : { $: "Integer" }, symbol: m[1]!, suffix: m[2] };
  }
  throw new Error(`mock lexer: not a literal: ${text}`);
}

const PUNCT = "=<>!~+-*/%^&|@.,;:#$?'";

/** Lexes `src` into client trees (proc-macro view of rustc's token trees, for the inputs used here). */
function lex(src: string): CTree[] {
  let i = 0;
  function trees(close: string | undefined): CTree[] {
    const out: CTree[] = [];
    while (i < src.length) {
      const c = src[i]!;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === close) {
        i++;
        return out;
      }
      const span = input_span++ as client_Span;
      if ("([{".includes(c)) {
        i++;
        const close_c = c === "(" ? ")" : c === "[" ? "]" : "}";
        const inner = trees(close_c);
        const delimiter = c === "(" ? "Parenthesis" : c === "[" ? "Bracket" : "Brace";
        out.push({ $: "Group", _0: { delimiter, stream: alloc(inner), span: { open: span, close: span, entire: span } } });
        continue;
      }
      const rest = src.slice(i);
      const lit = /^(?:(?:b|c)?r(#*)"[\s\S]*?"\1|(?:b|c)?"(?:[^"\\]|\\.)*"|b?'(?:[^'\\]|\\.)'|[0-9][0-9a-zA-Z_.]*(?:[eE][+-]?[0-9]+[a-z0-9]*)?)/.exec(rest);
      if (lit && !(c === "'" && /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(rest) && !/^'.'/.test(rest))) {
        i += lit[0].length;
        const l = lit_of(lit[0]);
        out.push({ $: "Literal", _0: { kind: l.kind, symbol: intern(l.symbol), suffix: l.suffix === undefined ? undefined : intern(l.suffix), span } });
        continue;
      }
      const id = /^(r#)?[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
      if (id) {
        i += id[0].length;
        const raw = id[1] !== undefined;
        out.push({ $: "Ident", _0: { sym: intern(raw ? id[0].slice(2) : id[0]), kind: raw ? "Raw" : "Normal", span } });
        continue;
      }
      if (PUNCT.includes(c)) {
        i++;
        const n = src[i];
        const joint = n !== undefined && (PUNCT.includes(n) || (c === "'" && /[A-Za-z_]/.test(n)));
        out.push({ $: "Punct", _0: { ch: c.charCodeAt(0), joint, span } });
        continue;
      }
      throw new Error(`mock lexer: unexpected ${c}`);
    }
    return out;
  }
  return trees(undefined);
}

function print(trees: CTree[]): string {
  let s = "";
  for (const t of trees) {
    switch (t.$) {
      case "Group": {
        const inner = t._0.stream === undefined ? "" : print(get(t._0.stream));
        const [o, c] =
          t._0.delimiter === "Parenthesis" ? ["(", ")"] : t._0.delimiter === "Bracket" ? ["[", "]"] : t._0.delimiter === "Brace" ? ["{", "}"] : ["", ""];
        s += o + inner + c;
        break;
      }
      case "Punct":
        s += String.fromCharCode(t._0.ch);
        break;
      case "Ident":
        s += (t._0.kind === "Raw" ? "r#" : "") + sym_str(t._0.sym);
        break;
      case "Literal":
        s += new Literal({ ...t._0 }).to_string();
        break;
    }
  }
  return s;
}

const mock: Partial<ClientMethods> = {
  literal_from_str(s) {
    log.push(`literal_from_str ${s}`);
    const l = lit_of(s);
    return Ok({ kind: l.kind, symbol: intern(l.symbol), suffix: l.suffix === undefined ? undefined : intern(l.suffix), span: CALL_SITE });
  },
  ts_drop(t) {
    take(t);
  },
  ts_clone(t) {
    return alloc(deep_clone(get(t)));
  },
  ts_is_empty(t) {
    return get(t).length === 0;
  },
  ts_from_str(src) {
    return Ok(alloc(lex(src)));
  },
  ts_to_string(t) {
    return print(get(t));
  },
  ts_from_token_tree(tree) {
    return alloc([tree]);
  },
  ts_concat_trees(base, trees) {
    log.push(`ts_concat_trees ${trees.length}`);
    return alloc([...(base === undefined ? [] : take(base)), ...trees]);
  },
  ts_concat_streams(base, streams) {
    log.push(`ts_concat_streams ${streams.length}`);
    return alloc([...(base === undefined ? [] : take(base)), ...streams.flatMap(take)]);
  },
  ts_into_trees(t) {
    log.push("ts_into_trees");
    return take(t);
  },
  span_debug(s) {
    return `#${s}`;
  },
  span_save_span(s) {
    log.push(`span_save_span #${s}`);
    return saved++;
  },
  span_recover_proc_macro_span(_id) {
    return CALL_SITE;
  },
  symbol_normalize_and_validate_ident(_s) {
    return Err(undefined);
  },
};

const saved_methods = { ...BridgeMethods };
const saved_span = { ...client_Span };
const saved_symbol = { ...client_Symbol };
beforeAll(() => {
  Object.assign(BridgeMethods, mock);
  Object.assign(client_Span, { def_site: () => DEF_SITE, call_site: () => CALL_SITE, mixed_site: () => MIXED_SITE });
  Object.assign(client_Symbol, {
    new: intern,
    // PORT(test): symbol.rs `new_ident`'s ASCII fast path; the inputs here are ASCII.
    new_ident: (s: string, _is_raw: boolean) => intern(s),
    with: <R>(sym: client_Symbol, f: (s: string) => R): R => f(sym_str(sym)),
  });
});
afterAll(() => {
  Object.assign(BridgeMethods, saved_methods);
  Object.assign(client_Span, saved_span);
  Object.assign(client_Symbol, saved_symbol);
});

function reset(): void {
  store.clear();
  strings.length = 0;
  names.clear();
  saved = 0;
  input_span = 100;
  log.length = 0;
}

function quote_str(input: string): string {
  const out = quote(new TokenStream(alloc(lex(input))));
  return out._0 === undefined ? "" : print(get(out._0));
}

// ---- tests -----------------------------------------------------------------------------------------------------
const ORACLE: { input: string; expected: string }[] = JSON.parse(
  readFileSync(join(import.meta.dir, "quote_oracle", "expected.json"), "utf8"),
);

test("quote matches the oracle's quote! expansions", () => {
  for (const { input, expected } of ORACLE) {
    reset();
    // The pretty printer drops a call's trailing comma (`f(a, b,)` prints as `f(a, b)`); quote.rs's templates
    // have them (`(@ ..),\n)`), so they are dropped here too.
    expect([input, quote_str(input).replaceAll(",)", ")")]).toEqual([input, expected]);
  }
});

test("quote of an empty stream", () => {
  // quote.rs:280: `minimal_quote!(crate::TokenStream::new())`
  reset();
  expect(print(get(quote(TokenStream.new())._0!))).toEqual("crate::TokenStream::new()");
  reset();
  expect(quote_str("")).toEqual("crate::TokenStream::new()");
});

test("quote saves one span per quoted ident/literal, in token order", () => {
  reset();
  quote_str(`a "s" b`);
  expect(log.filter((l) => l.startsWith("span_save_span"))).toEqual([
    "span_save_span #100",
    "span_save_span #101",
    "span_save_span #102",
  ]);
});

test("quote panics as upstream", () => {
  for (const [input, msg] of [
    ["a $", "unexpected trailing `$` in `quote!`"],
    ["$(a)", "`$(...)` must be followed by `*` in `quote!`"],
    ["$(a) +", "`$(...)` must be followed by `*` in `quote!`"],
    ["$1", "`$` must be followed by an ident or `$` or a repetition group in `quote!`"],
  ] as const) {
    reset();
    let got: unknown;
    try {
      quote_str(input);
    } catch (e) {
      got = e;
    }
    expect(got).toBeInstanceOf(Panic);
    expect((got as Panic).message).toEqual(msg);
  }
});

test("ToTokens impls (to_tokens.rs)", () => {
  reset();
  const ts = TokenStream.new();
  ToTokens_for_u8.to_tokens(5, ts);
  ToTokens_for_u128.to_tokens(340282366920938463463374607431768211455n, ts);
  ToTokens_for_bool.to_tokens(true, ts);
  ToTokens_for_char.to_tokens(0x27, ts);
  ToTokens_for_str.to_tokens('a"b\n', ts);
  ToTokens_for_Option(ToTokens_for_bool).to_tokens(undefined, ts);
  ToTokens_for_Option(ToTokens_for_bool).to_tokens(false, ts);
  expect(print(get(ts._0!))).toEqual(`5u8340282366920938463463374607431768211455u128true'\\''"a\\"b\\n"false`);
  // `impl ToTokens for TokenStream`: `tokens.extend(self.clone())` goes through the trees (`Extend<TokenTree>`).
  log.length = 0;
  const into = TokenStream.new();
  ToTokens_for_TokenStream.to_tokens(ts, into);
  expect(log).toEqual(["ts_into_trees", "ts_concat_trees 6"]);
  expect(print(get(into._0!))).toEqual(print(get(ts._0!)));
  // `into_token_stream` of a `TokenStream` is the stream itself.
  expect(ToTokens_for_TokenStream.into_token_stream(ts)).toBe(ts);
});

test("Literal / Ident / Punct constructors", () => {
  reset();
  expect(Literal.string("tab\t\u{300}").to_string()).toEqual('"tab\\t\\u{300}"');
  expect(Literal.character(0x22).to_string()).toEqual(`'"'`);
  expect(Literal.byte_character(0xff).to_string()).toEqual(`b'\\xff'`);
  expect(Literal.byte_string(Uint8Array.of(0x27, 0x22, 0x00)).to_string()).toEqual(`b"'\\"\\0"`);
  expect(Literal.c_string(Uint8Array.of(0x61, 0xff)).to_string()).toEqual(`c"a\\xff"`);
  expect(Literal.i32_unsuffixed(-3).to_string()).toEqual("-3");
  expect(Literal.f64_unsuffixed(1).to_string()).toEqual("1.0");
  expect(Literal.f64_suffixed(0.1).to_string()).toEqual("0.1f64");
  expect(Literal.u8_suffixed(7).u8_value()).toEqual(Ok(7));
  expect(Literal.new({ $: "Integer" }, "0x_ff", undefined).u8_value()).toEqual(Ok(255));
  expect(Literal.new({ $: "Integer" }, "256", undefined).u8_value()).toEqual(Err({ $: "InvalidLiteralKind" }));
  expect(Literal.new({ $: "Str" }, "a\\nb", undefined).str_value()).toEqual(Ok("a\nb"));
  expect(Literal.new({ $: "StrRaw", _0: 2 }, "x", undefined).to_string()).toEqual('r##"x"##');
  expect(Ident.new_raw("fn", Span.call_site()).to_string()).toEqual("r#fn");
  expect(Punct.new(0x2b, "Joint").to_string()).toEqual("+");
  expect(() => Punct.new(0x60, "Alone")).toThrow("unsupported character `'`'`");
});

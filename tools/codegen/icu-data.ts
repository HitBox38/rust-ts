// ICU4X baked-data generator: translates the databake output used on rustc's list-formatting path
// into TS, mechanically.
//
//   bun tools/codegen/icu-data.ts [--check]
//
// Inputs and outputs:
//   upstream compiler/rustc_baked_icu_data/src/data/list_and_v1.rs.data
//       -> src/rustc_baked_icu_data/data/list_and_v1.ts      (TRIE store, VALUES)
//   icu_locale_fallback_data 2.3.0 data/locale_likely_subtags_language_v1.rs.data,
//   data/locale_parents_v1.rs.data (located with `bun scripts/crate-src.ts`)
//       -> src/vendor/icu_locale_fallback_data/data.ts       (the two singletons)
//
// The `.rs.data` files are macro definitions. Only the data expressions are translated; every other
// token of each macro (the `DataProvider::load` impls, which are hand-ported in
// src/rustc_baked_icu_data/data/mod.ts and src/vendor/icu_locale_fallback/lib.ts) is compared
// against the token text recorded below, so a change upstream is an ERROR, never silently ignored.
//
// Data representation (PORT):
//   - `ZeroTrieSimpleAscii { store: b".." }` → `new ZeroTrieSimpleAscii(bytes)` (read at runtime by the
//     ported zerotrie reader).
//   - `VarZeroCow::from_bytes_unchecked(b"..")` (a `VarZeroCow<str>`) → the decoded string.
//   - `SerdeDFA::from_dfa_bytes_unchecked(if cfg!(target_endian = "little") { A } else { B })` → the
//     little-endian bytes A (the oracle hosts are little-endian), read at runtime by the ported
//     regex-automata sparse DFA.
//   - `ZeroMap::from_parts_unchecked(keys, values)` → `ZeroMap.from_parts_unchecked(keys, values)` with
//     keys as their ULE bytes (fixed-width `ZeroVec` items, or `VarZeroVec16` items) and values decoded
//     by the declared value type (subtags via `from_raw_unchecked`, `Option<T>` ULE = tag byte + T).
//   - `language!("en")` / `script!(..)` / `region!(..)` → the same macro functions in TS.
//
// --check regenerates in memory and exits 1 with an ERROR line if an output differs.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function crateSrc(name: string, version: string): string {
  const r = Bun.spawnSync(["bun", join(ROOT, "scripts", "crate-src.ts"), name, "--version", version], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) die(`crate-src ${name} ${version}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

function upstream(): string {
  const r = Bun.spawnSync(["bun", "-e", `import { UPSTREAM } from ${JSON.stringify(join(ROOT, "scripts", "lib", "common.ts"))}; console.log(UPSTREAM)`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) die(`cannot locate upstream: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

// ---------------------------------------------------------------------------------------------
// Tokenizer (the subset of Rust that databake emits)
// ---------------------------------------------------------------------------------------------

type Tok =
  | { k: "ident"; v: string }
  | { k: "int"; v: string; suffix: string }
  | { k: "str"; v: string }
  | { k: "bytes"; v: Uint8Array }
  | { k: "punct"; v: string }
  | { k: "eof"; v: "" };

const PUNCTS = ["::", "=>", "->", "(", ")", "[", "]", "{", "}", ",", ";", ":", ".", "!", "&", "=", "<", ">", "#", "$", "'", "*", "+", "-", "/", "?", "@", "|"];

function unescape(src: string, i: number, bytes: boolean): [number[], number] {
  // returns (code units / bytes, index after the closing quote)
  const out: number[] = [];
  while (src[i] !== '"') {
    const c = src[i]!;
    if (c === "\\") {
      const e = src[i + 1]!;
      if (e === "x") {
        out.push(parseInt(src.slice(i + 2, i + 4), 16));
        i += 4;
      } else if (e === "0") {
        out.push(0);
        i += 2;
      } else if (e === "n") {
        out.push(10);
        i += 2;
      } else if (e === "t") {
        out.push(9);
        i += 2;
      } else if (e === "r") {
        out.push(13);
        i += 2;
      } else if (e === "\\" || e === '"' || e === "'") {
        out.push(e.charCodeAt(0));
        i += 2;
      } else {
        die(`unsupported escape \\${e}`);
      }
    } else {
      const cp = src.codePointAt(i)!;
      if (bytes && cp > 0x7f) die("non-ASCII character in a byte string");
      if (cp > 0x7f) out.push(...new TextEncoder().encode(String.fromCodePoint(cp)));
      else out.push(cp);
      i += cp > 0xffff ? 2 : 1;
    }
  }
  return [out, i + 1];
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "b" && src[i + 1] === '"') {
      const [b, j] = unescape(src, i + 2, true);
      out.push({ k: "bytes", v: new Uint8Array(b) });
      i = j;
    } else if (c === '"') {
      const [b, j] = unescape(src, i + 1, false);
      out.push({ k: "str", v: new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(b)) });
      i = j;
    } else if (c === "'" && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
      // a lifetime
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ k: "ident", v: src.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ k: "ident", v: src.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9_]/.test(src[j]!)) j++;
      let k = j;
      while (k < src.length && /[A-Za-z0-9]/.test(src[k]!)) k++;
      out.push({ k: "int", v: src.slice(i, j).replaceAll("_", ""), suffix: src.slice(j, k) });
      i = k;
    } else {
      const p = PUNCTS.find((p) => src.startsWith(p, i));
      if (!p) die(`unexpected character ${JSON.stringify(c)}`);
      out.push({ k: "punct", v: p });
      i += p.length;
    }
  }
  out.push({ k: "eof", v: "" });
  return out;
}

function tokText(t: Tok): string {
  switch (t.k) {
    case "bytes":
      return "b\"<bytes>\"";
    case "str":
      return JSON.stringify(t.v);
    case "int":
      return t.v + t.suffix;
    default:
      return t.v;
  }
}

// ---------------------------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------------------------

type Expr =
  | { e: "bytes"; v: Uint8Array }
  | { e: "str"; v: string }
  | { e: "int"; v: string; suffix: string }
  | { e: "path"; v: string }
  | { e: "call"; callee: string; args: Expr[] }
  | { e: "macro"; name: string; args: Tok[] }
  | { e: "struct"; path: string; fields: [string, Expr][] }
  | { e: "tuple"; items: Expr[] }
  | { e: "array"; items: Expr[] }
  | { e: "ref"; inner: Expr }
  | { e: "unsafe"; inner: Expr }
  | { e: "if"; cond: Tok[]; then: Expr; else_: Expr };

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(o = 0): Tok {
    return this.toks[this.i + o]!;
  }
  next(): Tok {
    return this.toks[this.i++]!;
  }
  isP(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === "punct" && t.v === v;
  }
  isI(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === "ident" && t.v === v;
  }
  expectP(v: string): void {
    const t = this.next();
    if (t.k !== "punct" || t.v !== v) die(`expected '${v}', found '${tokText(t)}'`);
  }
  expectI(v: string): void {
    const t = this.next();
    if (t.k !== "ident" || t.v !== v) die(`expected '${v}', found '${tokText(t)}'`);
  }
  /** Skips `#[...]` attributes. */
  attrs(): void {
    while (this.isP("#") && this.isP("[", 1)) {
      this.next();
      this.balanced("[", "]");
    }
  }
  /** Consumes a balanced group starting at the current opener; returns the inner tokens. */
  balanced(open: string, close: string): Tok[] {
    this.expectP(open);
    const start = this.i;
    let depth = 1;
    for (;;) {
      const t = this.next();
      if (t.k === "eof") die("unbalanced group");
      if (t.k === "punct" && t.v === open) depth++;
      if (t.k === "punct" && t.v === close && --depth === 0) return this.toks.slice(start, this.i - 1);
    }
  }
  path(): string {
    const parts: string[] = [];
    const t = this.next();
    if (t.k !== "ident") die(`expected a path, found '${tokText(t)}'`);
    parts.push(t.v);
    while (this.isP("::") && this.peek(1).k === "ident") {
      this.next();
      parts.push((this.next() as { v: string }).v);
    }
    return parts.join("::");
  }
  expr(): Expr {
    this.attrs();
    const t = this.peek();
    if (t.k === "bytes") {
      this.next();
      return { e: "bytes", v: t.v };
    }
    if (t.k === "str") {
      this.next();
      return { e: "str", v: t.v };
    }
    if (t.k === "int") {
      this.next();
      return { e: "int", v: t.v, suffix: t.suffix };
    }
    if (this.isP("&")) {
      this.next();
      return { e: "ref", inner: this.expr() };
    }
    if (this.isP("[")) {
      return { e: "array", items: this.list("[", "]") };
    }
    if (this.isP("(")) {
      const items = this.list("(", ")");
      return { e: "tuple", items };
    }
    if (this.isI("unsafe") && this.isP("{", 1)) {
      this.next();
      this.expectP("{");
      const inner = this.expr();
      this.expectP("}");
      return { e: "unsafe", inner };
    }
    if (this.isI("if")) {
      this.next();
      const cond: Tok[] = [];
      while (!this.isP("{")) cond.push(this.next());
      this.expectP("{");
      const then = this.expr();
      this.expectP("}");
      this.expectI("else");
      this.expectP("{");
      const else_ = this.expr();
      this.expectP("}");
      return { e: "if", cond, then, else_ };
    }
    if (t.k === "ident") {
      const p = this.path();
      if (this.isP("!")) {
        this.next();
        return { e: "macro", name: p, args: this.balanced("(", ")") };
      }
      if (this.isP("(")) return { e: "call", callee: p, args: this.list("(", ")") };
      if (this.isP("{")) {
        this.expectP("{");
        const fields: [string, Expr][] = [];
        while (!this.isP("}")) {
          const f = this.next();
          if (f.k !== "ident") die(`expected a field name, found '${tokText(f)}'`);
          this.expectP(":");
          fields.push([f.v, this.expr()]);
          if (this.isP(",")) this.next();
        }
        this.expectP("}");
        return { e: "struct", path: p, fields };
      }
      return { e: "path", v: p };
    }
    return die(`unexpected token '${tokText(t)}'`);
  }
  list(open: string, close: string): Expr[] {
    this.expectP(open);
    const items: Expr[] = [];
    while (!this.isP(close)) {
      items.push(this.expr());
      if (this.isP(",")) this.next();
      else if (!this.isP(close)) die(`expected ',' or '${close}', found '${tokText(this.peek())}'`);
    }
    this.expectP(close);
    return items;
  }
}

/**
 * Finds `const NAME: <type> = <expr>;` or `pub const NAME: <type> = <expr>;` in the token stream.
 * Returns the parsed expression and the token range [start, end) of the expression.
 */
function findConst(toks: Tok[], name: string): { expr: Expr; start: number; end: number } {
  for (let i = 0; i < toks.length - 2; i++) {
    const a = toks[i]!;
    const b = toks[i + 1]!;
    if (a.k === "ident" && a.v === "const" && b.k === "ident" && b.v === name) {
      let j = i + 2;
      let depth = 0;
      for (; j < toks.length; j++) {
        const t = toks[j]!;
        if (t.k === "punct" && (t.v === "<" || t.v === "(" || t.v === "[")) depth++;
        if (t.k === "punct" && (t.v === ">" || t.v === ")" || t.v === "]")) depth--;
        if (t.k === "punct" && t.v === "=" && depth === 0) break;
      }
      const p = new Parser(toks);
      p.i = j + 1;
      const expr = p.expr();
      if (!p.isP(";")) die(`expected ';' after const ${name}`);
      return { expr, start: j + 1, end: p.i };
    }
  }
  return die(`const ${name} not found`);
}

/** The macro's tokens with each translated data expression replaced by `<NAME>`, joined by spaces. */
function skeleton(toks: Tok[], ranges: { name: string; start: number; end: number }[]): string {
  const out: string[] = [];
  let i = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    for (; i < r.start; i++) out.push(tokText(toks[i]!));
    out.push(`<${r.name}>`);
    i = r.end;
  }
  for (; i < toks.length - 1; i++) out.push(tokText(toks[i]!));
  return out.join(" ");
}

function checkSkeleton(what: string, got: string, expected: string): void {
  if (process.env.ICU_DATA_PRINT_SKELETON) console.log(`${what}:\n${got}\n`);
  if (got !== expected) {
    const g = got.split(" ");
    const e = expected.split(" ");
    let k = 0;
    while (k < g.length && g[k] === e[k]) k++;
    die(`${what}: macro text differs from the recorded text at token ${k}: got '${g.slice(k, k + 12).join(" ")}', expected '${e.slice(k, k + 12).join(" ")}'`);
  }
}

// ---------------------------------------------------------------------------------------------
// Emission helpers
// ---------------------------------------------------------------------------------------------

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function strip(e: Expr): Expr {
  while (e.e === "unsafe" || e.e === "ref") e = e.inner;
  return e;
}

function expectCall(e: Expr, callee: string, n: number): Expr[] {
  e = strip(e);
  if (e.e !== "call" || e.callee !== callee || e.args.length !== n) die(`expected ${callee}(${n} args), found ${JSON.stringify(e).slice(0, 120)}`);
  return e.args.map(strip);
}

function expectStruct(e: Expr, path: string, names: string[]): Expr[] {
  e = strip(e);
  if (e.e !== "struct" || e.path !== path) die(`expected ${path} { .. }, found ${JSON.stringify(e).slice(0, 120)}`);
  const got = e.fields.map(([n]) => n);
  if (got.join(",") !== names.join(",")) die(`${path}: fields ${got.join(",")}, expected ${names.join(",")}`);
  return e.fields.map(([, v]) => strip(v));
}

function bytesOf(e: Expr): Uint8Array {
  e = strip(e);
  if (e.e !== "bytes") die(`expected a byte string, found ${JSON.stringify(e).slice(0, 120)}`);
  return e.v;
}

const utf8dec = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);

// ---------------------------------------------------------------------------------------------
// list_and_v1.rs.data
// ---------------------------------------------------------------------------------------------

// The `__impl_list_and_v1` macro text with the data expressions replaced (tokens joined by spaces).
const LIST_AND_V1_SKELETON =
  "# [ doc ( hidden ) ] # [ macro_export ] macro_rules ! __impl_list_and_v1 { ( $ provider : ty ) => { # [ clippy :: msrv = \"1.88\" ] const _ : ( ) = < $ provider > :: MUST_USE_MAKE_PROVIDER_MACRO ; # [ clippy :: msrv = \"1.88\" ] impl $ provider { const DATA_LIST_AND_V1 : icu_provider :: baked :: zerotrie :: Data < icu_list :: provider :: ListAndV1 > = { const TRIE : icu_provider :: baked :: zerotrie :: ZeroTrieSimpleAscii < & 'static [ u8 ] > = <TRIE> ; const VALUES : & 'static [ < icu_list :: provider :: ListAndV1 as icu_provider :: baked :: zerotrie :: DynamicDataMarker > :: DataStruct ] = <VALUES> ; unsafe { icu_provider :: baked :: zerotrie :: Data :: from_trie_and_values_unchecked ( TRIE , VALUES ) } } ; } # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DataProvider < icu_list :: provider :: ListAndV1 > for $ provider { fn load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponse < icu_list :: provider :: ListAndV1 > , icu_provider :: DataError > { let mut metadata = icu_provider :: DataResponseMetadata :: default ( ) ; let payload = if let Some ( payload ) = icu_provider :: baked :: DataStore :: get ( & Self :: DATA_LIST_AND_V1 , req . id , req . metadata . attributes_prefix_match ) { payload } else { const FALLBACKER : icu_locale_fallback :: LocaleFallbackerWithConfig < 'static > = icu_locale_fallback :: LocaleFallbacker :: new ( ) . for_config ( < icu_list :: provider :: ListAndV1 as icu_provider :: DataMarker > :: INFO . fallback_config ) ; let mut fallback_iterator = FALLBACKER . fallback_for ( req . id . locale . clone ( ) ) ; loop { if let Some ( payload ) = icu_provider :: baked :: DataStore :: get ( & Self :: DATA_LIST_AND_V1 , icu_provider :: DataIdentifierBorrowed :: for_marker_attributes_and_locale ( req . id . marker_attributes , fallback_iterator . get ( ) ) , req . metadata . attributes_prefix_match ) { metadata . locale = Some ( fallback_iterator . take ( ) ) ; break payload ; } if fallback_iterator . get ( ) . is_unknown ( ) { return Err ( icu_provider :: DataErrorKind :: IdentifierNotFound . with_req ( < icu_list :: provider :: ListAndV1 as icu_provider :: DataMarker > :: INFO , req ) ) ; } fallback_iterator . step ( ) ; } } ; Ok ( icu_provider :: DataResponse { payload , metadata } ) } } } ; ( $ provider : ty , ITER ) => { __impl_list_and_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: IterableDataProvider < icu_list :: provider :: ListAndV1 > for $ provider { fn iter_ids ( & self ) -> Result < std :: collections :: BTreeSet < icu_provider :: DataIdentifierCow < 'static > > , icu_provider :: DataError > { Ok ( icu_provider :: baked :: DataStore :: iter ( & Self :: DATA_LIST_AND_V1 ) . collect ( ) ) } } } ; ( $ provider : ty , DRY ) => { } ; ( $ provider : ty , DRY , ITER ) => { __impl_list_and_v1 ! ( $ provider , ITER ) ; } ; } # [ doc ( inline ) ] pub use __impl_list_and_v1 as impl_list_and_v1 ;";

function joinerPattern(e: Expr): string {
  const [s, n] = expectCall(e, "icu_list::provider::ListJoinerPattern::from_parts", 2);
  const str = utf8dec(bytesOf(expectCall(s!, "zerovec::VarZeroCow::from_bytes_unchecked", 1)[0]!));
  if (n!.e !== "int" || n!.suffix !== "u8") die("ListJoinerPattern::from_parts: expected a u8 literal");
  return `ListJoinerPattern.from_parts(${JSON.stringify(str)}, ${Number(n!.v)})`;
}

function option(e: Expr, some: (e: Expr) => string): string {
  e = strip(e);
  if (e.e === "path" && e.v === "None") return "undefined";
  if (e.e === "call" && e.callee === "Some" && e.args.length === 1) return some(e.args[0]!);
  return die(`expected None or Some(..), found ${JSON.stringify(e).slice(0, 120)}`);
}

function serdeDfa(e: Expr): string {
  const [arg] = expectCall(e, "icu_list::provider::SerdeDFA::from_dfa_bytes_unchecked", 1);
  if (arg!.e !== "if") die("SerdeDFA: expected `if cfg!(target_endian = \"little\") { .. } else { .. }`");
  const cond = arg!.cond.map(tokText).join(" ");
  if (cond !== 'cfg ! ( target_endian = "little" )') die(`SerdeDFA: unexpected condition ${cond}`);
  // PORT: the little-endian serialization (the oracle hosts are little-endian).
  return `SerdeDFA.from_dfa_bytes_unchecked(hex(${JSON.stringify(hex(bytesOf(arg!.then)))}))`;
}

function conditional(e: Expr): string {
  const [def, sc] = expectStruct(e, "icu_list::provider::ConditionalListJoinerPattern", ["default", "special_case"]);
  const special = option(sc!, (x) => {
    const [condition, pattern] = expectStruct(x, "icu_list::provider::SpecialCasePattern", ["condition", "pattern"]);
    return `new SpecialCasePattern(${serdeDfa(condition!)}, ${joinerPattern(pattern!)})`;
  });
  return `new ConditionalListJoinerPattern(${joinerPattern(def!)}, ${special})`;
}

function genListAndV1(src: string): string {
  const toks = tokenize(src);
  const trie = findConst(toks, "TRIE");
  const values = findConst(toks, "VALUES");
  const macroStart = toks.findIndex((t, i) => t.k === "punct" && t.v === "#" && toks[i + 2]?.k === "ident" && (toks[i + 2] as { v: string }).v === "doc");
  if (macroStart < 0) die("list_and_v1: macro not found");
  checkSkeleton(
    "list_and_v1.rs.data",
    skeleton(toks.slice(macroStart), [
      { name: "TRIE", start: trie.start - macroStart, end: trie.end - macroStart },
      { name: "VALUES", start: values.start - macroStart, end: values.end - macroStart },
    ]),
    LIST_AND_V1_SKELETON,
  );

  const [store] = expectStruct(trie.expr, "icu_provider::baked::zerotrie::ZeroTrieSimpleAscii", ["store"]);
  const v = strip(values.expr);
  if (v.e !== "array") die("VALUES: expected an array");
  const items = v.items.map((it) => {
    const [start, middle, end, pair] = expectStruct(it, "icu_list::provider::ListFormatterPatterns", ["start", "middle", "end", "pair"]);
    const mid = utf8dec(bytesOf(expectCall(middle!, "zerovec::VarZeroCow::from_bytes_unchecked", 1)[0]!));
    return `  new ListFormatterPatterns(\n    ${joinerPattern(start!)},\n    ${JSON.stringify(mid)},\n    ${conditional(end!)},\n    ${option(pair!, conditional)},\n  ),`;
  });

  return `// GENERATED by tools/codegen/icu-data.ts from compiler/rustc_baked_icu_data/src/data/list_and_v1.rs.data. Do not edit.
//
// The data of \`__impl_list_and_v1!\` (\`DATA_LIST_AND_V1\`): the trie of data identifiers
// (\`<locale>\\x1E<attributes>\` → index) and the ${items.length} unique \`ListFormatterPatterns\`.
// PORT: \`VarZeroCow<str>\` is a string; the \`SerdeDFA\` bytes are the little-endian serialization.
import { ConditionalListJoinerPattern, ListFormatterPatterns, ListJoinerPattern, SerdeDFA, SpecialCasePattern } from "../../vendor/icu_list/provider/mod.ts";
import { ZeroTrieSimpleAscii } from "../../vendor/zerotrie/zerotrie.ts";

function hex(s: string): Uint8Array {
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return b;
}

// const TRIE: icu_provider::baked::zerotrie::ZeroTrieSimpleAscii<&'static [u8]>
export const TRIE: ZeroTrieSimpleAscii = new ZeroTrieSimpleAscii(hex(${JSON.stringify(hex(bytesOf(store!)))}));

// const VALUES: &'static [<icu_list::provider::ListAndV1 as DynamicDataMarker>::DataStruct]
export const VALUES: readonly ListFormatterPatterns[] = [
${items.join("\n")}
];
`;
}

// ---------------------------------------------------------------------------------------------
// icu_locale_fallback_data
// ---------------------------------------------------------------------------------------------

const LIKELY_SKELETON =
  "# [ doc ( hidden ) ] # [ macro_export ] macro_rules ! __impl_locale_likely_subtags_language_v1 { ( $ provider : ty ) => { # [ clippy :: msrv = \"1.88\" ] const _ : ( ) = < $ provider > :: MUST_USE_MAKE_PROVIDER_MACRO ; # [ clippy :: msrv = \"1.88\" ] impl $ provider { # [ doc ( hidden ) ] pub const SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1 : & 'static < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 as icu_provider :: DynamicDataMarker > :: DataStruct = <LIKELY> ; } # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DataProvider < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 > for $ provider { fn load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponse < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 > , icu_provider :: DataError > { if req . id . locale . is_unknown ( ) { Ok ( icu_provider :: DataResponse { payload : icu_provider :: DataPayload :: from_static_ref ( Self :: SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1 ) , metadata : icu_provider :: DataResponseMetadata :: default ( ) } ) } else { Err ( icu_provider :: DataErrorKind :: InvalidRequest . with_req ( < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 as icu_provider :: DataMarker > :: INFO , req ) ) } } } } ; ( $ provider : ty , ITER ) => { __impl_locale_likely_subtags_language_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: IterableDataProvider < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 > for $ provider { fn iter_ids ( & self ) -> Result < std :: collections :: BtreeSet < icu_provider :: DataIdentifierCow < 'static > > , icu_provider :: DataError > { Ok ( [ Default :: default ( ) ] . into_iter ( ) . collect ( ) ) } } } ; ( $ provider : ty , DRY ) => { __impl_locale_likely_subtags_language_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DryDataProvider < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 > for $ provider { fn dry_load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponseMetadata , icu_provider :: DataError > { if req . id . locale . is_unknown ( ) { Ok ( icu_provider :: DataResponseMetadata :: default ( ) ) } else { Err ( icu_provider :: DataErrorKind :: InvalidRequest . with_req ( < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 as icu_provider :: DataMarker > :: INFO , req ) ) } } } } ; ( $ provider : ty , DRY , ITER ) => { __impl_locale_likely_subtags_language_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DryDataProvider < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 > for $ provider { fn dry_load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponseMetadata , icu_provider :: DataError > { if req . id . locale . is_unknown ( ) { Ok ( icu_provider :: DataResponseMetadata :: default ( ) ) } else { Err ( icu_provider :: DataErrorKind :: InvalidRequest . with_req ( < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 as icu_provider :: DataMarker > :: INFO , req ) ) } } } # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: IterableDataProvider < icu :: locale :: fallback :: provider :: LocaleLikelySubtagsLanguageV1 > for $ provider { fn iter_ids ( & self ) -> Result < std :: collections :: BtreeSet < icu_provider :: DataIdentifierCow < 'static > > , icu_provider :: DataError > { Ok ( [ Default :: default ( ) ] . into_iter ( ) . collect ( ) ) } } } ; } # [ doc ( inline ) ] pub use __impl_locale_likely_subtags_language_v1 as impl_locale_likely_subtags_language_v1 ;";
const PARENTS_SKELETON =
  "# [ doc ( hidden ) ] # [ macro_export ] macro_rules ! __impl_locale_parents_v1 { ( $ provider : ty ) => { # [ clippy :: msrv = \"1.88\" ] const _ : ( ) = < $ provider > :: MUST_USE_MAKE_PROVIDER_MACRO ; # [ clippy :: msrv = \"1.88\" ] impl $ provider { # [ doc ( hidden ) ] pub const SINGLETON_LOCALE_PARENTS_V1 : & 'static < icu :: locale :: fallback :: provider :: LocaleParentsV1 as icu_provider :: DynamicDataMarker > :: DataStruct = <PARENTS> ; } # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DataProvider < icu :: locale :: fallback :: provider :: LocaleParentsV1 > for $ provider { fn load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponse < icu :: locale :: fallback :: provider :: LocaleParentsV1 > , icu_provider :: DataError > { if req . id . locale . is_unknown ( ) { Ok ( icu_provider :: DataResponse { payload : icu_provider :: DataPayload :: from_static_ref ( Self :: SINGLETON_LOCALE_PARENTS_V1 ) , metadata : icu_provider :: DataResponseMetadata :: default ( ) } ) } else { Err ( icu_provider :: DataErrorKind :: InvalidRequest . with_req ( < icu :: locale :: fallback :: provider :: LocaleParentsV1 as icu_provider :: DataMarker > :: INFO , req ) ) } } } } ; ( $ provider : ty , ITER ) => { __impl_locale_parents_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: IterableDataProvider < icu :: locale :: fallback :: provider :: LocaleParentsV1 > for $ provider { fn iter_ids ( & self ) -> Result < std :: collections :: BtreeSet < icu_provider :: DataIdentifierCow < 'static > > , icu_provider :: DataError > { Ok ( [ Default :: default ( ) ] . into_iter ( ) . collect ( ) ) } } } ; ( $ provider : ty , DRY ) => { __impl_locale_parents_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DryDataProvider < icu :: locale :: fallback :: provider :: LocaleParentsV1 > for $ provider { fn dry_load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponseMetadata , icu_provider :: DataError > { if req . id . locale . is_unknown ( ) { Ok ( icu_provider :: DataResponseMetadata :: default ( ) ) } else { Err ( icu_provider :: DataErrorKind :: InvalidRequest . with_req ( < icu :: locale :: fallback :: provider :: LocaleParentsV1 as icu_provider :: DataMarker > :: INFO , req ) ) } } } } ; ( $ provider : ty , DRY , ITER ) => { __impl_locale_parents_v1 ! ( $ provider ) ; # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: DryDataProvider < icu :: locale :: fallback :: provider :: LocaleParentsV1 > for $ provider { fn dry_load ( & self , req : icu_provider :: DataRequest ) -> Result < icu_provider :: DataResponseMetadata , icu_provider :: DataError > { if req . id . locale . is_unknown ( ) { Ok ( icu_provider :: DataResponseMetadata :: default ( ) ) } else { Err ( icu_provider :: DataErrorKind :: InvalidRequest . with_req ( < icu :: locale :: fallback :: provider :: LocaleParentsV1 as icu_provider :: DataMarker > :: INFO , req ) ) } } } # [ clippy :: msrv = \"1.88\" ] impl icu_provider :: IterableDataProvider < icu :: locale :: fallback :: provider :: LocaleParentsV1 > for $ provider { fn iter_ids ( & self ) -> Result < std :: collections :: BtreeSet < icu_provider :: DataIdentifierCow < 'static > > , icu_provider :: DataError > { Ok ( [ Default :: default ( ) ] . into_iter ( ) . collect ( ) ) } } } ; } # [ doc ( inline ) ] pub use __impl_locale_parents_v1 as impl_locale_parents_v1 ;";

/** Splits a fixed-width `ZeroVec` byte store into items. */
function chunks(b: Uint8Array, width: number): Uint8Array[] {
  if (b.length % width !== 0) die(`ZeroVec: ${b.length} bytes is not a multiple of ${width}`);
  const out: Uint8Array[] = [];
  for (let i = 0; i < b.length; i += width) out.push(b.subarray(i, i + width));
  return out;
}

/** Splits a `VarZeroVec16` byte store (u16 length, u16 indices for items 1.., then data) into items. */
function varZeroVec16(b: Uint8Array): Uint8Array[] {
  const u16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const len = u16(0);
  if (len === 0) return [];
  const idx = [0];
  for (let k = 1; k < len; k++) idx.push(u16(2 * k));
  const data = b.subarray(2 * len);
  idx.push(data.length);
  const out: Uint8Array[] = [];
  for (let k = 0; k < len; k++) {
    if (!(idx[k]! <= idx[k + 1]!)) die("VarZeroVec16: indices are not increasing");
    out.push(data.subarray(idx[k]!, idx[k + 1]!));
  }
  return out;
}

/** A subtag ULE (its `[u8; N]` raw bytes) → TS. */
function subtagRaw(kind: "L" | "S" | "R", b: Uint8Array): string {
  const s = String.fromCharCode(...b).replace(/\0+$/, "");
  if (!/^[A-Za-z0-9]+$/.test(s)) die(`invalid ${kind} subtag ULE ${hex(b)}`);
  return `${kind}(${JSON.stringify(s)})`;
}

/** `Option<T>` ULE: a tag byte (0 = None, 1 = Some) followed by T's ULE bytes. */
function optionUle(b: Uint8Array, some: (b: Uint8Array) => string): string {
  if (b[0] === 0) {
    if (b.subarray(1).some((x) => x !== 0)) die("Option ULE: None with non-zero payload");
    return "undefined";
  }
  if (b[0] !== 1) die(`Option ULE: bad tag ${b[0]}`);
  return some(b.subarray(1));
}

function keyLit(b: Uint8Array): string {
  return `k(${JSON.stringify(hex(b))})`;
}

function zeroMap(e: Expr, keyKind: "fixed" | "var16", keyWidth: number, valueWidth: number, value: (b: Uint8Array) => string): string {
  const [keys, values] = expectCall(e, "zerovec::ZeroMap::from_parts_unchecked", 2);
  const keyItems =
    keyKind === "fixed"
      ? chunks(bytesOf(expectCall(keys!, "zerovec::ZeroVec::from_bytes_unchecked", 1)[0]!), keyWidth)
      : varZeroVec16(bytesOf(expectCall(keys!, "zerovec::vecs::VarZeroVec16::from_bytes_unchecked", 1)[0]!));
  const valueItems = chunks(bytesOf(expectCall(values!, "zerovec::ZeroVec::from_bytes_unchecked", 1)[0]!), valueWidth);
  if (keyItems.length !== valueItems.length) die("ZeroMap: key/value length mismatch");
  for (let i = 1; i < keyItems.length; i++) {
    const a = keyItems[i - 1]!;
    const b = keyItems[i]!;
    let c = 0;
    for (let j = 0; j < Math.min(a.length, b.length) && c === 0; j++) c = a[j]! - b[j]!;
    if (c === 0) c = a.length - b.length;
    if (c >= 0) die("ZeroMap: keys are not strictly increasing");
  }
  const lines = keyItems.map((kb, i) => `    [${keyLit(kb)}, ${value(valueItems[i]!)}],`);
  return `zero_map([\n${lines.join("\n")}\n  ])`;
}

function subtagMacro(e: Expr): string {
  e = strip(e);
  if (e.e !== "macro") die("expected a subtag macro");
  const m: Record<string, string> = {
    "icu_locale_core::subtags::language": "language",
    "icu_locale_core::subtags::script": "script",
    "icu_locale_core::subtags::region": "region",
  };
  const kind = m[e.name] ?? die(`unexpected macro ${e.name}`);
  if (e.args.length !== 1 || e.args[0]!.k !== "str") die(`${e.name}!: expected one string literal`);
  return `${kind}(${JSON.stringify(e.args[0]!.v)})`;
}

function genFallbackData(likelySrc: string, parentsSrc: string): string {
  const lt = tokenize(likelySrc);
  const lc = findConst(lt, "SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1");
  const lStart = lt.findIndex((t, i) => t.k === "punct" && t.v === "#" && lt[i + 2]?.k === "ident" && (lt[i + 2] as { v: string }).v === "doc");
  checkSkeleton("locale_likely_subtags_language_v1.rs.data", skeleton(lt.slice(lStart), [{ name: "LIKELY", start: lc.start - lStart, end: lc.end - lStart }]), LIKELY_SKELETON);

  const pt = tokenize(parentsSrc);
  const pc = findConst(pt, "SINGLETON_LOCALE_PARENTS_V1");
  const pStart = pt.findIndex((t, i) => t.k === "punct" && t.v === "#" && pt[i + 2]?.k === "ident" && (pt[i + 2] as { v: string }).v === "doc");
  checkSkeleton("locale_parents_v1.rs.data", skeleton(pt.slice(pStart), [{ name: "PARENTS", start: pc.start - pStart, end: pc.end - pStart }]), PARENTS_SKELETON);

  const [ls, lr, l, und] = expectStruct(lc.expr, "icu_locale_fallback::provider::LikelySubtagsForLanguage", ["language_script", "language_region", "language", "und"]);
  const language_script = zeroMap(ls!, "fixed", 7, 3, (b) => subtagRaw("R", b));
  const language_region = zeroMap(lr!, "fixed", 6, 4, (b) => subtagRaw("S", b));
  const language = zeroMap(l!, "fixed", 3, 7, (b) => `[${subtagRaw("S", b.subarray(0, 4))}, ${subtagRaw("R", b.subarray(4, 7))}]`);
  const u = strip(und!);
  if (u.e !== "tuple" || u.items.length !== 3) die("und: expected a 3-tuple");
  const undLit = `[${u.items.map(subtagMacro).join(", ")}]`;

  const [parents] = expectStruct(pc.expr, "icu_locale_fallback::provider::Parents", ["parents"]);
  const parentsMap = zeroMap(
    parents!,
    "var16",
    0,
    12,
    (b) =>
      `[${subtagRaw("L", b.subarray(0, 3))}, ${optionUle(b.subarray(3, 8), (x) => subtagRaw("S", x))}, ${optionUle(b.subarray(8, 12), (x) => subtagRaw("R", x))}]`,
  );

  return `// GENERATED by tools/codegen/icu-data.ts from icu_locale_fallback_data 2.3.0
// data/locale_likely_subtags_language_v1.rs.data and data/locale_parents_v1.rs.data. Do not edit.
//
// PORT: the zerovec stores are decoded here: map keys are the keys' ULE bytes (hex), values are
// decoded subtags (\`from_raw_unchecked\` of the stored raw bytes). The singletons are built on first
// use (\`Baked::SINGLETON_*\` in icu_locale_fallback/provider.ts).
import { Language, language } from "../icu_locale_core/subtags/language.ts";
import { Region, region } from "../icu_locale_core/subtags/region.ts";
import { Script, script } from "../icu_locale_core/subtags/script.ts";
import type { LikelySubtagsForLanguage, Parents } from "../icu_locale_fallback/provider.ts";
import { ZeroMap } from "../zerovec/map/map.ts";

function k(s: string): Uint8Array {
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return b;
}
function raw(s: string, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
const L = (s: string) => Language.from_raw_unchecked(raw(s, 3));
const S = (s: string) => Script.from_raw_unchecked(raw(s, 4));
const R = (s: string) => Region.from_raw_unchecked(raw(s, 3));
function zero_map<V>(entries: [Uint8Array, V][]): ZeroMap<V> {
  return ZeroMap.from_parts_unchecked(
    entries.map(([key]) => key),
    entries.map(([, v]) => v),
  );
}

let likely: LikelySubtagsForLanguage | undefined;
let parents: Parents | undefined;

/** \`SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1\` */
export function BAKED_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1(): LikelySubtagsForLanguage {
  return (likely ??= {
  language_script: ${language_script},
  language_region: ${language_region},
  language: ${language},
  und: ${undLit},
  });
}

/** \`SINGLETON_LOCALE_PARENTS_V1\` */
export function BAKED_LOCALE_PARENTS_V1(): Parents {
  return (parents ??= {
  parents: ${parentsMap},
  });
}
`;
}

// ---------------------------------------------------------------------------------------------

const check = process.argv.includes("--check");
const outputs: [string, string][] = [];
{
  const src = readFileSync(join(upstream(), "compiler", "rustc_baked_icu_data", "src", "data", "list_and_v1.rs.data"), "utf8");
  outputs.push([join(ROOT, "src", "rustc_baked_icu_data", "data", "list_and_v1.ts"), genListAndV1(src)]);
}
{
  const dir = crateSrc("icu_locale_fallback_data", "2.3.0");
  const likely = readFileSync(join(dir, "data", "locale_likely_subtags_language_v1.rs.data"), "utf8");
  const parents = readFileSync(join(dir, "data", "locale_parents_v1.rs.data"), "utf8");
  outputs.push([join(ROOT, "src", "vendor", "icu_locale_fallback_data", "data.ts"), genFallbackData(likely, parents)]);
}
let stale = 0;
for (const [p, text] of outputs) {
  if (check) {
    let cur = "";
    try {
      cur = readFileSync(p, "utf8");
    } catch {}
    if (cur !== text) {
      console.error(`ERROR: ${p} is out of date (run bun tools/codegen/icu-data.ts)`);
      stale++;
    }
  } else {
    writeFileSync(p, text);
  }
}
if (check && stale) process.exit(1);
console.log(check ? `ok: ${outputs.length} icu data files up to date` : `wrote ${outputs.length} icu data files`);

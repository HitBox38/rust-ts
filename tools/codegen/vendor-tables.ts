// Vendor table generator: translates the generated-data Rust files of vendored crates into TS,
// mechanically, from the crate sources at the versions locked by upstream's Cargo.lock.
//
//   bun tools/codegen/vendor-tables.ts [--check]
//
// Inputs (located with `bun scripts/crate-src.ts <crate>`) and outputs:
//   unic-langid-impl 0.9.6  src/likelysubtags/tables.rs -> src/vendor/unic_langid_impl/likelysubtags/tables.ts
//   unic-langid-impl 0.9.6  src/layout_table.rs         -> src/vendor/unic_langid_impl/layout_table.ts
//   intl_pluralrules 7.0.2  src/rules.rs                -> src/vendor/intl_pluralrules/rules.ts
//
// The Rust items are tokenized and parsed with a small Rust expression parser (literals, paths,
// calls, macro calls, tuples, arrays, closures, if/else, unary/binary operators, ranges, method
// calls, field access) and emitted per the item's declared type:
//   - integers: `u64` → bigint literal (`24929n`; u64 values can exceed 2^53), `u32`/`usize` → number;
//   - `Option<T>`: `None` → `undefined`, `Some(x)` → `x`; tuples → arrays; `&str` → string.
// In rules.rs every `|po| ...` closure is translated expression by expression. Operand fields are
// typed as in intl_pluralrules' `PluralOperands` (`n: f64`, `i/f/t: u64` → bigint, `v/w: usize` →
// number); integer literals take the type of the operand they meet (`po.i % 10 == 2` →
// `po.i % 10n === 2n`); `(a..=b).contains(&(e))` → `range_inclusive_contains(a, b, e)`.
// Table order is kept exactly (lookups binary-search these tables).
//
// --check regenerates in memory and exits 1 with an ERROR line if an output differs.
// Any construct outside this grammar is an ERROR (never guessed).
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

// ---------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------

type Tok =
  | { k: "ident"; v: string }
  | { k: "int"; v: string; suffix: string }
  | { k: "float"; v: string }
  | { k: "str"; v: string }
  | { k: "punct"; v: string }
  | { k: "eof"; v: "" };

const PUNCTS = ["..=", "::", "==", "!=", "<=", ">=", "&&", "||", "->", "=>", "..", "(", ")", "[", "]", "{", "}", ",", ";", ":", ".", "!", "&", "|", "%", "=", "<", ">", "#", "$", "*", "+", "-", "/", "?", "@"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("/*", i)) {
      const e = src.indexOf("*/", i + 2);
      if (e < 0) die("unterminated block comment");
      i = e + 2;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ k: "ident", v: src.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9_]/.test(src[j]!)) j++;
      // A float needs a digit after the dot (`1.0`); `0..=1` is int, range, int.
      if (src[j] === "." && /[0-9]/.test(src[j + 1] ?? "")) {
        j++;
        while (j < src.length && /[0-9_]/.test(src[j]!)) j++;
        if (/[A-Za-z_]/.test(src[j] ?? "")) die(`float literal with suffix near ${src.slice(i, j + 4)}`);
        out.push({ k: "float", v: src.slice(i, j).replaceAll("_", "") });
        i = j;
        continue;
      }
      const digits = src.slice(i, j).replaceAll("_", "");
      let k = j;
      while (k < src.length && /[A-Za-z0-9_]/.test(src[k]!)) k++;
      const suffix = src.slice(j, k);
      if (suffix !== "" && !/^(u8|u16|u32|u64|usize|i8|i16|i32|i64|isize)$/.test(suffix)) die(`bad int suffix ${suffix}`);
      out.push({ k: "int", v: digits, suffix });
      i = k;
    } else if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\") die("escape in string literal not supported");
        s += src[j];
        j++;
      }
      out.push({ k: "str", v: s });
      i = j + 1;
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

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

type Ty =
  | { t: "prim"; name: string }
  | { t: "option"; inner: Ty }
  | { t: "tuple"; elems: Ty[] }
  | { t: "array"; elem: Ty; len?: number }
  | { t: "path"; name: string };

type Expr =
  | { e: "lit"; kind: "int" | "float" | "str"; v: string; suffix?: string }
  | { e: "path"; segs: string[] }
  | { e: "call"; callee: Expr; args: Expr[] }
  | { e: "macro"; name: string; args: Expr[] }
  | { e: "method"; recv: Expr; name: string; args: Expr[] }
  | { e: "field"; recv: Expr; name: string }
  | { e: "unary"; op: "!" | "&"; expr: Expr }
  | { e: "binary"; op: string; l: Expr; r: Expr }
  | { e: "range"; lo: Expr; hi: Expr; inclusive: boolean }
  | { e: "paren"; expr: Expr }
  | { e: "tuple"; elems: Expr[] }
  | { e: "array"; elems: Expr[] }
  | { e: "closure"; params: string[]; body: Expr }
  | { e: "block"; expr: Expr }
  | { e: "if"; cond: Expr; then: Expr; else_?: Expr };

type Item =
  | { item: "static"; name: string; ty: Ty; value: Expr; kw: "static" | "const" }
  | { item: "type"; name: string; text: string }
  | { item: "macro"; name: string; text: string }
  | { item: "use"; text: string }
  | { item: "attr"; text: string };

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}

  peek(o = 0): Tok {
    return this.toks[this.i + o]!;
  }
  next(): Tok {
    return this.toks[this.i++]!;
  }
  is(v: string, o = 0): boolean {
    const t = this.peek(o);
    return (t.k === "punct" || t.k === "ident") && t.v === v;
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(v: string): void {
    if (!this.eat(v)) die(`expected '${v}', found '${this.peek().v}' (token ${this.i})`);
  }
  ident(): string {
    const t = this.next();
    if (t.k !== "ident") die(`expected identifier, found '${t.v}'`);
    return t.v;
  }
  /** Raw token text up to the matching close of the group starting at the current `(`/`[`/`{`. */
  skipGroup(): string {
    const open = this.next();
    const close = { "(": ")", "[": "]", "{": "}" }[open.v];
    if (!close) die(`expected a group, found '${open.v}'`);
    const parts: string[] = [open.v];
    let depth = 1;
    while (depth > 0) {
      const t = this.next();
      if (t.k === "eof") die("unterminated group");
      if (t.v === open.v) depth++;
      else if (t.v === close) depth--;
      parts.push(t.k === "int" ? t.v + t.suffix : t.k === "str" ? JSON.stringify(t.v) : t.v);
    }
    return parts.join(" ");
  }

  items(): Item[] {
    const out: Item[] = [];
    while (this.peek().k !== "eof") {
      if (this.is("#")) {
        this.next();
        this.eat("!");
        out.push({ item: "attr", text: this.skipGroup() });
      } else if (this.is("use")) {
        const parts: string[] = [];
        while (!this.is(";")) parts.push(this.next().v);
        this.expect(";");
        out.push({ item: "use", text: parts.join("") });
      } else if (this.is("macro_rules")) {
        this.next();
        this.expect("!");
        const name = this.ident();
        out.push({ item: "macro", name, text: this.skipGroup() });
      } else {
        this.expect("pub");
        if (this.eat("type")) {
          const name = this.ident();
          this.expect("=");
          const parts: string[] = [];
          while (!this.is(";")) parts.push(this.next().v);
          this.expect(";");
          out.push({ item: "type", name, text: parts.join(" ") });
        } else {
          const kw = this.ident();
          if (kw !== "static" && kw !== "const") die(`unexpected item keyword ${kw}`);
          const name = this.ident();
          this.expect(":");
          const ty = this.type();
          this.expect("=");
          const value = this.expr();
          this.expect(";");
          out.push({ item: "static", name, ty, value, kw });
        }
      }
    }
    return out;
  }

  type(): Ty {
    if (this.eat("&")) {
      if (this.is("[")) {
        this.expect("[");
        const elem = this.type();
        this.expect("]");
        return { t: "array", elem };
      }
      const name = this.ident();
      if (name !== "str") die(`unsupported reference type &${name}`);
      return { t: "prim", name: "&str" };
    }
    if (this.eat("[")) {
      const elem = this.type();
      this.expect(";");
      const n = this.next();
      if (n.k !== "int") die("expected array length");
      this.expect("]");
      return { t: "array", elem, len: Number(n.v) };
    }
    if (this.eat("(")) {
      const elems: Ty[] = [];
      while (!this.eat(")")) {
        elems.push(this.type());
        if (!this.is(")")) this.expect(",");
      }
      return { t: "tuple", elems };
    }
    const name = this.ident();
    if (name === "Option") {
      this.expect("<");
      const inner = this.type();
      this.expect(">");
      return { t: "option", inner };
    }
    if (/^(u8|u16|u32|u64|usize)$/.test(name)) return { t: "prim", name };
    return { t: "path", name };
  }

  // Precedence climbing (Rust's binary operator precedence, subset).
  static PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "%": 5 };

  expr(): Expr {
    // Ranges bind loosest.
    const lo = this.binary(0);
    if (this.is("..=") || this.is("..")) {
      const inclusive = this.next().v === "..=";
      const hi = this.binary(0);
      return { e: "range", lo, hi, inclusive };
    }
    return lo;
  }

  binary(minPrec: number): Expr {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      const prec = t.k === "punct" ? Parser.PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) break;
      this.next();
      // comparisons are non-associative; others left-associative
      const r = this.binary(prec + 1);
      l = { e: "binary", op: t.v, l, r };
    }
    return l;
  }

  unary(): Expr {
    if (this.eat("!")) {
      return { e: "unary", op: "!", expr: this.unary() };
    }
    if (this.eat("&")) {
      if (this.is("[")) {
        // `&[ ... ]` slice literal
        return this.postfix(this.primary());
      }
      return { e: "unary", op: "&", expr: this.unary() };
    }
    return this.postfix(this.primary());
  }

  postfix(e: Expr): Expr {
    for (;;) {
      if (this.is(".") && this.peek(1).k === "ident") {
        this.next();
        const name = this.ident();
        if (this.is("(")) {
          e = { e: "method", recv: e, name, args: this.args("(", ")") };
        } else {
          e = { e: "field", recv: e, name };
        }
      } else if (this.is("(")) {
        e = { e: "call", callee: e, args: this.args("(", ")") };
      } else {
        return e;
      }
    }
  }

  args(open: string, close: string): Expr[] {
    this.expect(open);
    const out: Expr[] = [];
    while (!this.eat(close)) {
      out.push(this.expr());
      if (!this.is(close)) this.expect(",");
    }
    return out;
  }

  block(): Expr {
    this.expect("{");
    const expr = this.blockBody();
    this.expect("}");
    return { e: "block", expr };
  }

  blockBody(): Expr {
    if (this.is("if")) return this.ifExpr();
    return this.expr();
  }

  ifExpr(): Expr {
    this.expect("if");
    const cond = this.exprNoStruct();
    const then = this.block();
    let else_: Expr | undefined;
    if (this.eat("else")) {
      else_ = this.is("if") ? this.ifExpr() : this.block();
    }
    return { e: "if", cond, then, else_ };
  }

  /** An `if` condition: an expression that stops before the block's `{`. */
  exprNoStruct(): Expr {
    return this.expr();
  }

  primary(): Expr {
    const t = this.peek();
    if (t.k === "int") {
      this.next();
      return { e: "lit", kind: "int", v: t.v, suffix: t.suffix };
    }
    if (t.k === "float") {
      this.next();
      return { e: "lit", kind: "float", v: t.v };
    }
    if (t.k === "str") {
      this.next();
      return { e: "lit", kind: "str", v: t.v };
    }
    if (this.is("(")) {
      this.next();
      if (this.eat(")")) return { e: "tuple", elems: [] };
      const first = this.expr();
      if (this.eat(")")) return { e: "paren", expr: first };
      const elems = [first];
      while (this.eat(",")) {
        if (this.is(")")) break;
        elems.push(this.expr());
      }
      this.expect(")");
      return { e: "tuple", elems };
    }
    if (this.is("[")) {
      return { e: "array", elems: this.args("[", "]") };
    }
    if (this.is("|")) {
      this.next();
      const params: string[] = [];
      while (!this.eat("|")) {
        params.push(this.ident());
        if (!this.is("|")) this.expect(",");
      }
      const body = this.is("{") ? this.block() : this.expr();
      return { e: "closure", params, body };
    }
    if (this.is("{")) return this.block();
    if (this.is("if")) return this.ifExpr();
    if (t.k === "ident") {
      if (this.peek(1).v === "!" && this.peek(1).k === "punct" && this.peek(2).v === "(") {
        const name = this.ident();
        this.expect("!");
        return { e: "macro", name, args: this.args("(", ")") };
      }
      const segs = [this.ident()];
      while (this.eat("::")) segs.push(this.ident());
      return { e: "path", segs };
    }
    die(`unexpected token '${t.v}' (token ${this.i})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------------------------

function tsType(ty: Ty): string {
  switch (ty.t) {
    case "prim":
      return ty.name === "u64" ? "bigint" : ty.name === "&str" ? "string" : "number";
    case "option":
      return `${tsType(ty.inner)} | undefined`;
    case "tuple":
      return `readonly [${ty.elems.map(tsType).join(", ")}]`;
    case "array": {
      const inner = tsType(ty.elem);
      return `readonly (${inner})[]`;
    }
    case "path":
      return ty.name;
  }
}

/** A data value of type `ty` (tables). */
function emitValue(e: Expr, ty: Ty): string {
  switch (ty.t) {
    case "prim":
      if (ty.name === "&str") {
        if (e.e !== "lit" || e.kind !== "str") die("expected string literal");
        return JSON.stringify(e.v);
      }
      if (e.e !== "lit" || e.kind !== "int") die(`expected integer literal for ${ty.name}`);
      if (e.suffix && e.suffix !== ty.name) die(`literal suffix ${e.suffix} does not match ${ty.name}`);
      return ty.name === "u64" ? `${BigInt(e.v)}n` : String(Number(e.v));
    case "option":
      if (e.e === "path" && e.segs.join("::") === "None") return "undefined";
      if (e.e === "call" && e.callee.e === "path" && e.callee.segs.join("::") === "Some" && e.args.length === 1) return emitValue(e.args[0]!, ty.inner);
      die("expected Some(..) or None");
    case "tuple":
      if (e.e !== "tuple" || e.elems.length !== ty.elems.length) die("tuple arity mismatch");
      return `[${e.elems.map((x, i) => emitValue(x, ty.elems[i]!)).join(", ")}]`;
    case "array": {
      if (e.e !== "array") die("expected array literal");
      if (ty.len !== undefined && e.elems.length !== ty.len) die(`array length ${e.elems.length} != declared ${ty.len}`);
      return `[\n${e.elems.map((x) => "  " + emitValue(x, ty.elem) + ",\n").join("")}]`;
    }
    case "path":
      die(`no value emitter for type ${ty.name}`);
  }
}

function header(crate: string, file: string): string {
  return `// GENERATED by tools/codegen/vendor-tables.ts from ${crate}/${file}. Do not edit.\n`;
}

function genTables(items: Item[], crate: string, file: string, preamble: string): string {
  let out = header(crate, file) + preamble;
  for (const it of items) {
    if (it.item === "attr" || it.item === "use") continue;
    if (it.item !== "static") die(`unexpected item in ${file}: ${it.item}`);
    out += `\nexport const ${it.name}: ${tsType(it.ty)} = ${emitValue(it.value, it.ty)};\n`;
  }
  return out;
}

// --- rules.rs ---------------------------------------------------------------------------------

type NumTy = "f64" | "u64" | "usize";
const OPERAND_TY: Record<string, NumTy> = { n: "f64", i: "u64", v: "usize", w: "usize", f: "u64", t: "u64" };

function litFor(e: Expr, ty: NumTy): string {
  if (e.e !== "lit") die("expected literal");
  if (ty === "f64") {
    if (e.kind !== "float") die(`f64 operand compared with ${e.kind} literal ${e.v}`);
    return e.v;
  }
  if (e.kind !== "int") die(`${ty} operand compared with ${e.kind} literal ${e.v}`);
  if (e.suffix) die("unexpected suffix in rule literal");
  return ty === "u64" ? `${BigInt(e.v)}n` : String(Number(e.v));
}

/** Type of a numeric operand expression (`po.x` or `po.x % N`), or undefined for a literal. */
function numTy(e: Expr, param: string): NumTy | undefined {
  if (e.e === "lit") return undefined;
  if (e.e === "paren") return numTy(e.expr, param);
  if (e.e === "field" && e.recv.e === "path" && e.recv.segs.length === 1 && e.recv.segs[0] === param) {
    const ty = OPERAND_TY[e.name];
    if (!ty) die(`unknown operand field ${e.name}`);
    return ty;
  }
  if (e.e === "binary" && e.op === "%") {
    const ty = numTy(e.l, param);
    if (!ty) die("literal on the left of %");
    if (ty === "f64") die("% on f64 operand not expected");
    return ty;
  }
  die(`unsupported numeric expression ${e.e}`);
}

function emitNum(e: Expr, param: string, ty: NumTy): string {
  switch (e.e) {
    case "lit":
      return litFor(e, ty);
    case "paren":
      return `(${emitNum(e.expr, param, ty)})`;
    case "field":
      return `${param}.${e.name}`;
    case "binary":
      if (e.op !== "%") die(`unexpected numeric operator ${e.op}`);
      return `${emitNum(e.l, param, ty)} % ${emitNum(e.r, param, ty)}`;
    default:
      die(`unsupported numeric expression ${e.e}`);
  }
}

function emitCond(e: Expr, param: string): string {
  switch (e.e) {
    case "paren":
      return `(${emitCond(e.expr, param)})`;
    case "unary":
      if (e.op !== "!") die("unexpected & in condition");
      return `!${emitCond(e.expr, param)}`;
    case "binary": {
      if (e.op === "&&" || e.op === "||") return `${emitCond(e.l, param)} ${e.op} ${emitCond(e.r, param)}`;
      if (e.op === "==" || e.op === "!=") {
        const ty = numTy(e.l, param) ?? numTy(e.r, param);
        if (!ty) die("comparison of two literals");
        return `${emitNum(e.l, param, ty)} ${e.op === "==" ? "===" : "!=="} ${emitNum(e.r, param, ty)}`;
      }
      die(`unsupported operator ${e.op} in condition`);
    }
    case "method": {
      // `(lo..=hi).contains(&(x))`
      if (e.name !== "contains" || e.args.length !== 1) die(`unsupported method ${e.name}`);
      const recv = e.recv.e === "paren" ? e.recv.expr : e.recv;
      if (recv.e !== "range" || !recv.inclusive) die("contains on something other than an inclusive range");
      const arg = e.args[0]!;
      if (arg.e !== "unary" || arg.op !== "&") die("contains argument is not a reference");
      const ty = numTy(arg.expr, param);
      if (!ty) die("contains on a literal");
      return `range_inclusive_contains(${litFor(recv.lo, ty)}, ${litFor(recv.hi, ty)}, ${emitNum(arg.expr, param, ty)})`;
    }
    default:
      die(`unsupported condition ${e.e}`);
  }
}

function emitCategory(e: Expr): string {
  if (e.e === "block") return emitCategory(e.expr);
  if (e.e !== "path" || e.segs.length !== 2 || e.segs[0] !== "PluralCategory") die("expected PluralCategory::X");
  return `PluralCategory.${e.segs[1]}`;
}

function emitRuleBody(e: Expr, param: string, indent: string): string {
  // `if c { X } else if c { Y } else { Z }` → return statements
  let out = "";
  let cur: Expr | undefined = e;
  let first = true;
  while (cur) {
    if (cur.e === "if") {
      const c = cur.cond.e === "paren" ? emitCond(cur.cond.expr, param) : emitCond(cur.cond, param);
      out += `${first ? indent : " else "}if (${c}) {\n${indent}  return ${emitCategory(cur.then)};\n${indent}}`;
      cur = cur.else_;
      first = false;
    } else {
      if (first) return `${indent}return ${emitCategory(cur)};\n`;
      out += ` else {\n${indent}  return ${emitCategory(cur)};\n${indent}}\n`;
      cur = undefined;
    }
  }
  return out;
}

function emitClosure(e: Expr): string {
  if (e.e !== "closure" || e.params.length !== 1) die("expected |po| closure");
  const p = e.params[0]!;
  const body = e.body.e === "block" ? e.body.expr : e.body;
  if (body.e === "if") return `(${p}) => {\n${emitRuleBody(body, p, "      ")}    }`;
  return `(${p}) => ${emitCategory(body)}`;
}

/** `subtags::Language::from_raw_unchecked(26209u64)` etc. inside `langid!(..)`. */
function emitSubtag(e: Expr, kind: "Language" | "Script" | "Region"): string {
  if (e.e !== "call" || e.callee.e !== "path" || e.args.length !== 1) die(`expected subtags::${kind}::from_raw_unchecked(..)`);
  const path = e.callee.segs.join("::");
  if (path !== `subtags::${kind}::from_raw_unchecked`) die(`unexpected call ${path}`);
  const arg = e.args[0]!;
  const ty = kind === "Language" ? "u64" : "u32";
  if (arg.e !== "lit" || arg.kind !== "int" || arg.suffix !== ty) die(`expected ${ty} literal in ${path}`);
  return `subtags.${kind}.from_raw_unchecked(${ty === "u64" ? `${BigInt(arg.v)}n` : String(Number(arg.v))})`;
}

function emitOptSubtag(e: Expr, kind: "Script" | "Region"): string {
  if (e.e === "path" && e.segs.join("::") === "None") return "undefined";
  if (e.e === "call" && e.callee.e === "path" && e.callee.segs.join("::") === "Some" && e.args.length === 1) return emitSubtag(e.args[0]!, kind);
  die("expected Some(..) or None");
}

function emitLangid(e: Expr): string {
  if (e.e !== "macro" || e.name !== "langid" || e.args.length !== 3) die("expected langid!(lang, script, region)");
  return `langid(${emitSubtag(e.args[0]!, "Language")}, ${emitOptSubtag(e.args[1]!, "Script")}, ${emitOptSubtag(e.args[2]!, "Region")})`;
}

// The only macro rules.rs defines; checked token-for-token so a different body is an ERROR.
const LANGID_MACRO =
  "{ ( $ lang : expr , $ script : expr , $ region : expr ) => { { unsafe { LanguageIdentifier :: from_raw_parts_unchecked ( $ lang , $ script , $ region , None ) } } } ; }";

function genRules(items: Item[], crate: string, file: string): string {
  let out = header(crate, file);
  out += `// Locale → plural rule tables. Each closure is a mechanical translation of the Rust closure
// (see tools/codegen/vendor-tables.ts); entries keep upstream's order (\`PluralRules::create\`
// binary-searches them).
import { LanguageIdentifier, subtags } from "../unic_langid/lib.ts";
import { PluralCategory } from "./lib.ts";
import type { PluralOperands } from "./operands.ts";
`;
  for (const it of items) {
    switch (it.item) {
      case "attr":
      case "use":
        break;
      case "type":
        if (it.name !== "PluralRule" || it.text !== "fn ( & PluralOperands ) -> PluralCategory") die(`unexpected type item ${it.name} = ${it.text}`);
        out += `\nexport type PluralRule = (po: PluralOperands) => PluralCategory;\n`;
        break;
      case "macro":
        if (it.name !== "langid" || it.text !== LANGID_MACRO) die(`unexpected macro ${it.name}: ${it.text}`);
        out += `
// PORT: \`macro_rules! langid { ($lang, $script, $region) => unsafe {
//   LanguageIdentifier::from_raw_parts_unchecked($lang, $script, $region, None) } }\`
function langid(
  lang: subtags.Language,
  script: subtags.Script | undefined,
  region: subtags.Region | undefined,
): LanguageIdentifier {
  return LanguageIdentifier.from_raw_parts_unchecked(lang, script, region, undefined);
}

/** \`RangeInclusive::contains\` (\`(start..=end).contains(&item)\`) */
function range_inclusive_contains<T extends number | bigint>(start: T, end: T, item: T): boolean {
  return start <= item && item <= end;
}
`;
        break;
      case "static": {
        if (it.name === "CLDR_VERSION") {
          out += `\nexport const CLDR_VERSION: number = ${emitValue(it.value, it.ty)};\n`;
          break;
        }
        if (!/^PRS_(CARDINAL|ORDINAL)$/.test(it.name)) die(`unexpected static ${it.name}`);
        const arr = it.value.e === "unary" && it.value.op === "&" ? it.value.expr : it.value;
        if (arr.e !== "array") die(`${it.name} is not an array`);
        out += `\nexport const ${it.name}: readonly (readonly [LanguageIdentifier, PluralRule])[] = [\n`;
        for (const entry of arr.elems) {
          if (entry.e !== "tuple" || entry.elems.length !== 2) die(`${it.name} entry is not a pair`);
          out += `  [\n    ${emitLangid(entry.elems[0]!)},\n    ${emitClosure(entry.elems[1]!)},\n  ],\n`;
        }
        out += `];\n`;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

const check = process.argv.includes("--check");
const outputs: [string, string][] = [];

{
  const crate = "unic-langid-impl-0.9.6";
  const dir = crateSrc("unic-langid-impl", "0.9.6");
  const t = new Parser(tokenize(readFileSync(join(dir, "src/likelysubtags/tables.rs"), "utf8"))).items();
  outputs.push([
    "src/vendor/unic_langid_impl/likelysubtags/tables.ts",
    genTables(t, crate, "src/likelysubtags/tables.rs", "// Likely-subtags data (CLDR). Keys are subtags as little-endian integers (`u64` → bigint).\n"),
  ]);
  const l = new Parser(tokenize(readFileSync(join(dir, "src/layout_table.rs"), "utf8"))).items();
  outputs.push(["src/vendor/unic_langid_impl/layout_table.ts", genTables(l, crate, "src/layout_table.rs", "")]);
}
{
  const crate = "intl_pluralrules-7.0.2";
  const dir = crateSrc("intl_pluralrules", "7.0.2");
  const r = new Parser(tokenize(readFileSync(join(dir, "src/rules.rs"), "utf8"))).items();
  outputs.push(["src/vendor/intl_pluralrules/rules.ts", genRules(r, crate, "src/rules.rs")]);
}

let stale = 0;
for (const [rel, text] of outputs) {
  const p = join(ROOT, rel);
  if (check) {
    let cur = "";
    try {
      cur = readFileSync(p, "utf8");
    } catch {}
    if (cur !== text) {
      console.error(`ERROR: ${rel} is stale; run bun tools/codegen/vendor-tables.ts`);
      stale++;
    }
  } else {
    writeFileSync(p, text);
    console.log(`wrote ${rel} (${text.split("\n").length} lines)`);
  }
}
if (stale) process.exit(1);
if (check) console.log(`ok: ${outputs.length} vendor tables up to date`);

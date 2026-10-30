// Generates the rustc_session option tables from the upstream sources (PORTING.md §5 "Macros inside rustc"):
//   compiler/rustc_session/src/options.rs
//     `top_level_options!`   -> `Options`, `OptionsTargetModifiers`             (options.gen.ts)
//     `mod desc`             -> `desc` (the type descriptions of the parsers)   (options.gen.ts)
//     `options!` x2          -> `CodegenOptions`/`UnstableOptions` (fields, defaults, build,
//                               dep_tracking_hash, gather_target_modifiers), `*TargetModifiers`, the setter modules
//                               `cgopts`/`dbopts`, the `CG_OPTIONS`/`Z_OPTIONS` tables (options.gen.ts)
//     `POLONIUS_HELP`        -> the `const .. = match .. { .. }` used as a description (options.gen.ts)
//   compiler/rustc_session/src/options/mitigation_coverage.rs
//     `denied_partial_mitigations!` -> `DeniedPartialMitigationKind` and its fns (mitigation_coverage.gen.ts)
//   compiler/rustc_target/src/spec/mod.rs
//     `linker_flavor_cli_impls!` -> the value of `LinkerFlavorCli::one_of()` (desc.parse_linker_flavor)
//
// Each expansion follows the file's own `macro_rules!` (`options`, `top_level_options`, `setter_for`,
// `redirect_field`, `denied_partial_mitigations`); the shapes the generator relies on are checked and
// anything else is an ERROR, never a guess. Default value expressions are translated mechanically
// (literals, `None`/`Some`, `String::new()`, `"..".to_string()`, `Vec::new()`, `vec![]`, `A::B`,
// `A::B(..)` variants and `A::f(..)` associated fns); a Rust type the type table below does not know
// is an ERROR. `dep_tracking_hash` expands `hash_opt!`/`insert!`/`hash_substruct!` with each option's
// `DepTrackingHash` impl from config.ts `dep_tracking` (by the option's Rust type; a type without one is an ERROR).
//
//   bun tools/codegen/options.ts           write the files
//   bun tools/codegen/options.ts --check   ERROR if a committed file is stale
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FrontmatterAllowed, tokenize, type Token } from "../../src/rustc_lexer/lib.ts";
import { Str, utf8_len } from "../../src/std/str.ts";
import { unescape_str } from "../../src/vendor/rustc_literal_escaper/lib.ts";
import { PIN, REPO, UPSTREAM, die, requireUpstream } from "../../scripts/lib/common.ts";
import { parseIntLit } from "./types.ts";

const OPTIONS_RS = "compiler/rustc_session/src/options.rs";
const MITIGATION_RS = "compiler/rustc_session/src/options/mitigation_coverage.rs";
const TARGET_SPEC_RS = "compiler/rustc_target/src/spec/mod.rs";
const OUT_OPTIONS = "src/rustc_session/options.gen.ts";
const OUT_MITIGATION = "src/rustc_session/options/mitigation_coverage.gen.ts";

// ---- tokens --------------------------------------------------------------------------------

interface Tok {
  kind: Token["kind"];
  text: string;
  line: number;
}

class GenError extends Error {}

function fail(path: string, t: Tok | undefined, msg: string): never {
  throw new GenError(`${path}:${t?.line ?? "?"}: ${msg}${t ? ` (at \`${t.text}\`)` : ""}`);
}

/** Tokens of `src`; whitespace and block comments dropped, line comments kept (docs and plain). */
function lex(src: Str): Tok[] {
  const out: Tok[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    const text = src.slice(pos, pos + tok.len).toString();
    if (k !== "Whitespace" && k !== "BlockComment") out.push({ kind: tok.kind, text, line });
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return out;
}

function load(path: string): Tok[] {
  const bytes = readFileSync(join(UPSTREAM, path));
  return lex(Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
}

const isComment = (t: Tok): boolean => t.kind.$ === "LineComment";
const isOuterDoc = (t: Tok): boolean => t.kind.$ === "LineComment" && t.kind.doc_style === "Outer";
const isStr = (t: Tok | undefined): boolean => t !== undefined && t.kind.$ === "Literal" && (t.kind.kind.$ === "Str" || t.kind.kind.$ === "RawStr");

/** The value of a `"..."` or `r#"..."#` literal (no suffix). */
function strValue(path: string, t: Tok): string {
  const k = t.kind;
  if (k.$ !== "Literal") fail(path, t, "expected a string literal");
  const lit = k.kind;
  if (k.suffix_start !== utf8_len(t.text)) fail(path, t, "string literal suffixes are not supported");
  if (lit.$ === "RawStr") {
    const n = lit.n_hashes;
    if (n === undefined) fail(path, t, "invalid raw string literal");
    const body = t.text.slice(2 + n, t.text.length - 1 - n);
    if (body.includes("\r")) fail(path, t, "bare CR in raw string literal");
    return body;
  }
  if (lit.$ !== "Str" || !lit.terminated) fail(path, t, "expected a string literal");
  let out = "";
  let err: string | undefined;
  unescape_str(Str.from(t.text.slice(1, -1)), (_s, _e, res) => {
    if (res.$ === "Err") err ??= res._0;
    else out += String.fromCodePoint(res._0);
  });
  if (err !== undefined) fail(path, t, `string literal escape error ${err}`);
  return out;
}

/** Index of the delimiter closing the group opening at `open`. */
function group(path: string, toks: Tok[], open: number): number {
  const pairs: Record<string, string> = { OpenParen: "CloseParen", OpenBracket: "CloseBracket", OpenBrace: "CloseBrace" };
  const stack: string[] = [];
  for (let i = open; i < toks.length; i++) {
    const k = toks[i]!.kind.$;
    if (k in pairs) stack.push(pairs[k]!);
    else if (k === "CloseParen" || k === "CloseBracket" || k === "CloseBrace") {
      if (stack.pop() !== k) fail(path, toks[i], "unbalanced delimiters");
      if (stack.length === 0) return i;
    }
  }
  fail(path, toks[open], "unterminated delimiter");
}

class Parser {
  i: number;
  constructor(
    readonly path: string,
    readonly toks: Tok[],
    start: number,
    readonly end: number,
  ) {
    this.i = start;
  }
  peek(o = 0): Tok | undefined {
    return this.i + o < this.end ? this.toks[this.i + o] : undefined;
  }
  next(): Tok {
    const t = this.peek();
    if (t === undefined) fail(this.path, this.toks[this.end], "unexpected end of macro input");
    this.i++;
    return t;
  }
  is(kind: string, text?: string, o = 0): boolean {
    const t = this.peek(o);
    return t !== undefined && t.kind.$ === kind && (text === undefined || t.text === text);
  }
  eat(kind: string, text?: string): boolean {
    if (this.is(kind, text)) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(kind: string, text?: string): Tok {
    const t = this.next();
    if (t.kind.$ !== kind || (text !== undefined && t.text !== text)) fail(this.path, t, `expected ${text ?? kind}`);
    return t;
  }
  /** `=>` (two tokens for rustc_lexer) */
  fatArrow(): void {
    this.expect("Eq");
    const t = this.expect("Gt");
    if (this.toks[this.i - 2]!.line !== t.line) fail(this.path, t, "expected `=>`");
  }
  ident(text?: string): Tok {
    const t = this.next();
    if (t.kind.$ !== "Ident" || (text !== undefined && t.text !== text)) fail(this.path, t, `expected ${text ?? "identifier"}`);
    return t;
  }
  /** Skips a delimited group starting at the cursor; returns [open, close]. */
  groupAt(): [number, number] {
    const open = this.i;
    const close = group(this.path, this.toks, open);
    this.i = close + 1;
    return [open, close];
  }
}

/** Leading docs, plain comments and `#[..]` attributes at the cursor. */
function leading(p: Parser): { docs: string[]; comments: string[]; attrs: string[] } {
  const docs: string[] = [];
  const comments: string[] = [];
  const attrs: string[] = [];
  for (;;) {
    const t = p.peek();
    if (t === undefined) break;
    if (isComment(t)) {
      if (isOuterDoc(t)) docs.push(t.text.slice(3).replace(/\r$/, ""));
      else if (t.kind.$ === "LineComment" && t.kind.doc_style !== undefined) fail(p.path, t, "unexpected inner doc comment");
      else comments.push(t.text.trimEnd());
      p.i++;
    } else if (t.kind.$ === "Pound" && p.is("OpenBracket", undefined, 1)) {
      p.i++;
      const [o, c] = p.groupAt();
      attrs.push("#[" + joinToks(p.toks.slice(o + 1, c)) + "]");
    } else break;
  }
  return { docs, comments, attrs };
}

/** Token texts joined the way rustfmt would print simple attribute/type token streams. */
function joinToks(ts: Tok[]): string {
  let s = "";
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    const prev = ts[i - 1];
    const tight = prev === undefined || ["(", "[", "<", ":", "::", "&", "!", "."].includes(prev.text) || [")", "]", ">", ",", ":", "(", "<", "!", "."].includes(t.text);
    s += (tight ? "" : " ") + t.text;
  }
  return s.replace(/: :/g, "::");
}

/** Line of each `fn <name>` inside `macro_rules! <mac>` of `toks`, in order. */
function macroFnLines(path: string, toks: Tok[], mac: string): { name: string; line: number }[] {
  const def = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 1]?.kind.$ === "Bang" && toks[i + 2]?.text === mac);
  if (def < 0) fail(path, undefined, `no macro_rules! ${mac}`);
  const end = group(path, toks, def + 3);
  const out: { name: string; line: number }[] = [];
  for (let i = def; i < end; i++) if (toks[i]!.text === "fn" && toks[i + 1]?.kind.$ === "Ident") out.push({ name: toks[i + 1]!.text, line: toks[i]!.line });
  return out;
}
function macroFnLine(path: string, toks: Tok[], mac: string, name: string): number {
  const f = macroFnLines(path, toks, mac).filter((x) => x.name === name);
  if (f.length !== 1) fail(path, undefined, `expected exactly one fn ${name} in macro_rules! ${mac}, found ${f.length}`);
  return f[0]!.line;
}

/** [open, close] of the delimited input of every invocation `name!{..}` (not the macro_rules definition). */
function invocations(path: string, toks: Tok[], name: string): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.kind.$ !== "Ident" || t.text !== name || toks[i + 1]?.kind.$ !== "Bang" || toks[i - 1]?.kind.$ === "Bang") continue;
    if (toks[i - 1]?.text === "::" || toks[i - 1]?.kind.$ === "Colon") continue; // `crate::name!` is not used here
    const open = i + 2;
    const k = toks[open]?.kind.$;
    if (k !== "OpenParen" && k !== "OpenBrace" && k !== "OpenBracket") fail(path, toks[open], "expected a delimited macro input");
    out.push([open, group(path, toks, open)]);
  }
  return out;
}

// ---- Rust types ----------------------------------------------------------------------------

type Ty = { k: "tuple"; elems: Ty[] } | { k: "path"; name: string; args: Ty[]; text: string };

/** A type from the token range [p.i, end). */
function parseType(p: Parser): Ty {
  if (p.is("OpenParen")) {
    const [o, c] = p.groupAt();
    const q = new Parser(p.path, p.toks, o + 1, c);
    const elems: Ty[] = [];
    while (q.peek() !== undefined) {
      elems.push(parseType(q));
      if (!q.eat("Comma")) break;
    }
    if (q.peek() !== undefined) fail(p.path, q.peek(), "unexpected token in tuple type");
    return { k: "tuple", elems };
  }
  const segs: string[] = [];
  if (p.is("Colon") && p.is("Colon", undefined, 1)) p.i += 2;
  segs.push(p.ident().text);
  while (p.is("Colon") && p.is("Colon", undefined, 1)) {
    p.i += 2;
    segs.push(p.ident().text);
  }
  const args: Ty[] = [];
  if (p.eat("Lt")) {
    for (;;) {
      args.push(parseType(p));
      if (p.eat("Comma")) continue;
      p.expect("Gt");
      break;
    }
  }
  return { k: "path", name: segs[segs.length - 1]!, args, text: segs.join("::") };
}

interface Named {
  /** module (relative to src/rustc_session/) */
  mod: string;
  /** derive(PartialEq) is `===` on the TS value (fieldless enums, numbers, interned) */
  prim?: boolean;
  /** `<Name>_eq` exists */
  eq?: boolean;
  /** `Default::default()` expression */
  default?: string;
  /** the module exports `debug_<Name>` */
  debug?: boolean;
}
const CONFIG = "./config.ts";
const STAND = "./stand_ins.ts";
const fieldless = (mod: string, debug = true): Named => ({ mod, prim: true, debug });
const NAMED: Record<string, Named> = {
  // config.rs (ported subset)
  Strip: fieldless(CONFIG),
  CFGuard: fieldless(CONFIG),
  CFProtection: fieldless(CONFIG),
  OptLevel: fieldless(CONFIG),
  LtoCli: fieldless(CONFIG),
  InstrumentCoverage: fieldless(CONFIG),
  CoverageOptions: { mod: CONFIG, debug: true },
  Offload: { mod: CONFIG, debug: true },
  CodegenRetagOptions: { mod: CONFIG, debug: true },
  AutoDiff: { mod: CONFIG, debug: true },
  AnnotateMoves: { mod: CONFIG, debug: true },
  InstrumentMcount: { mod: CONFIG, debug: true },
  InstrumentXRay: { mod: CONFIG, debug: true },
  LinkerPluginLto: { mod: CONFIG, debug: true },
  LinkSelfContained: { mod: CONFIG, debug: true },
  LinkerFeaturesCli: { mod: CONFIG, debug: true },
  IncrementalStateAssertion: fieldless(CONFIG),
  LocationDetail: { mod: CONFIG, debug: true },
  FmtDebug: fieldless(CONFIG),
  SwitchWithOptPath: { mod: CONFIG, debug: true },
  SymbolManglingVersion: fieldless(CONFIG),
  DebugInfo: fieldless(CONFIG),
  DebugInfoCompression: fieldless(CONFIG),
  MirStripDebugInfo: fieldless(CONFIG),
  SplitDwarfKind: fieldless(CONFIG),
  ErrorOutputType: { mod: CONFIG, debug: true },
  ResolveDocLinks: fieldless(CONFIG),
  NextSolverConfig: fieldless(CONFIG),
  Passes: { mod: CONFIG, debug: true },
  BranchProtection: { mod: CONFIG, debug: true, eq: true, default: "BranchProtection.default()" },
  PointerAuthOption: fieldless(CONFIG),
  JsonUnusedExterns: fieldless(CONFIG, false),
  WasiExecModel: fieldless(CONFIG),
  ProcMacroExecutionStrategy: fieldless(CONFIG),
  DumpMonoStatsFormat: fieldless(CONFIG),
  PatchableFunctionEntry: { mod: CONFIG, debug: true },
  Polonius: fieldless(CONFIG),
  InliningThreshold: { mod: CONFIG, debug: true },
  FunctionReturn: fieldless(CONFIG),
  MirIncludeSpans: fieldless(CONFIG),
  // stand-ins (not ported crates / modules)
  CodeModel: fieldless(STAND),
  FramePointer: fieldless(STAND),
  LinkerFlavorCli: { mod: STAND },
  MergeFunctions: fieldless(STAND, false),
  OnBrokenPipe: fieldless(STAND, false),
  PanicStrategy: fieldless(STAND, false),
  RelocModel: fieldless(STAND, false),
  RelroLevel: fieldless(STAND, false),
  SplitDebuginfo: fieldless(STAND, false),
  StackProtector: fieldless(STAND),
  SymbolVisibility: fieldless(STAND, false),
  TlsModel: fieldless(STAND, false),
  SanitizerSet: { mod: STAND, prim: true, debug: true, default: "SanitizerSet.default()" },
  CollapseMacroDebuginfo: fieldless(STAND, false),
  CrateType: { mod: STAND },
  Align: { mod: STAND },
  TimePassesFormat: fieldless(STAND, false),
  TargetTuple: { mod: STAND },
  OutputTypes: { mod: STAND },
  SearchPath: { mod: STAND },
  Sysroot: { mod: STAND },
  PrintRequest: { mod: STAND },
  Externs: { mod: STAND },
  PpMode: { mod: STAND },
  Jobs: { mod: STAND },
  // ported crates
  TerminalUrl: { mod: "../rustc_errors/lib.ts", prim: true, debug: true },
  ColorConfig: { mod: "../rustc_errors/emitter.ts", prim: true, debug: true },
  SourceFileHashAlgorithm: { mod: "../rustc_span/lib.ts", prim: true },
  RealFileName: { mod: "../rustc_span/lib.ts", debug: true },
  RemapPathScopeComponents: { mod: "../rustc_span/lib.ts", prim: true },
  Edition: { mod: "../rustc_span/edition.ts", prim: true, debug: true },
  RustcVersion: { mod: "../rustc_ast/attr/version.ts", debug: true },
  UnstableFeatures: { mod: "../rustc_feature/lib.ts", prim: true },
  Level: { mod: "../rustc_lint_defs/lib.ts", debug: true },
  NativeLib: { mod: "./utils.ts", debug: true },
};
const INTS: Record<string, { ts: string; from_str: string; zero: string }> = {
  usize: { ts: "number", from_str: "usize_from_str", zero: "0" },
  u32: { ts: "number", from_str: "u32_from_str", zero: "0" },
  u8: { ts: "number", from_str: "u8_from_str", zero: "0" },
  u64: { ts: "bigint", from_str: "u64_from_str", zero: "0n" },
};

/** Collected imports: module -> name -> value use (true) or type-only (false). */
class Imports {
  m = new Map<string, Map<string, boolean>>();
  add(mod: string, name: string, value: boolean): void {
    let e = this.m.get(mod);
    if (!e) this.m.set(mod, (e = new Map()));
    e.set(name, (e.get(name) ?? false) || value);
  }
  render(order: string[]): string[] {
    const out: string[] = [];
    const mods = [...this.m.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a < b ? -1 : a > b ? 1 : 0);
    });
    for (const mod of mods) {
      const names = [...this.m.get(mod)!.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const allTypes = names.every(([, v]) => !v);
      const list = names.map(([n, v]) => (allTypes || v ? n : `type ${n}`)).join(", ");
      out.push(`import ${allTypes ? "type " : ""}{ ${list} } from "${mod}";`);
    }
    return out;
  }
}

const LOCAL_TYPES = new Set(["CodegenOptions", "UnstableOptions"]);
/** The Rust types of `impl_dep_tracking_hash_via_hash!` (config.rs), the keys of config.ts `dep_tracking.via_hash`
 * (by last path segment). */
const DTH_VIA_HASH = new Set([
  "AnnotateMoves", "AutoDiff", "Offload", "bool", "usize", "u64", "Hash64", "String", "PathBuf", "Level", "WasiExecModel", "u32",
  "FramePointer", "RelocModel", "CodeModel", "TlsModel", "InstrumentCoverage", "CoverageOptions", "InstrumentMcount",
  "InstrumentMcountOpts", "InstrumentXRay", "CrateType", "MergeFunctions", "OnBrokenPipe", "PanicStrategy", "RelroLevel",
  "OptLevel", "LtoCli", "DebugInfo", "DebugInfoCompression", "MirStripDebugInfo", "CollapseMacroDebuginfo", "UnstableFeatures",
  "NativeLib", "SanitizerSet", "CFGuard", "CFProtection", "TargetTuple", "Edition", "LinkerPluginLto", "ResolveDocLinks",
  "SplitDebuginfo", "SplitDwarfKind", "StackProtector", "SwitchWithOptPath", "SymbolManglingVersion", "SymbolVisibility",
  "RemapPathScopeComponents", "SourceFileHashAlgorithm", "OutFileName", "OutputType", "RealFileName", "LocationDetail",
  "FmtDebug", "BranchProtection", "LanguageIdentifier", "NextSolverConfig", "PatchableFunctionEntry", "Polonius",
  "InliningThreshold", "FunctionReturn", "Align", "CodegenRetagOptions", "RustcVersion", "PointerAuthOption",
]);

/** `hash_opt!($opt, &self.$opt, &mut sub_hashes, for_crate_hash, [$marker])` (options.rs:40) for each entry, then the
 * `StableHasher` over `dep_tracking::stable_hash`; the shared body of both `dep_tracking_hash` fns. */
function genHashOpts(tc: TyCtx, entries: Entry[], body: string[], indent: string): void {
  tc.imp.add(CONFIG, "DynDepTrackingHash", false);
  body.push(`${indent}const sub_hashes = new Map<string, DynDepTrackingHash>();`);
  for (const e of entries) {
    switch (e.marker) {
      case "UNTRACKED":
      case "SUBSTRUCT":
        break;
      case "TRACKED":
        body.push(`${indent}insert(${lit(e.name)}, dep_tracking.dyn(this.${e.name}, ${tc.dth(e.ty)}), sub_hashes);`);
        break;
      case "TRACKED_NO_CRATE_HASH":
        body.push(`${indent}if (!for_crate_hash) {`);
        body.push(`${indent}  insert(${lit(e.name)}, dep_tracking.dyn(this.${e.name}, ${tc.dth(e.ty)}), sub_hashes);`);
        body.push(`${indent}}`);
        break;
      default:
        fail(OPTIONS_RS, undefined, `unknown dep-tracking marker [${e.marker}] on ${e.name}`);
    }
  }
}

class TyCtx {
  constructor(
    readonly path: string,
    readonly imp: Imports,
  ) {}
  named(ty: Ty & { k: "path" }): Named {
    const n = NAMED[ty.name];
    if (!n) fail(this.path, undefined, `type \`${ty.text}\` is not in the type table of tools/codegen/options.ts`);
    if (ty.args.length) fail(this.path, undefined, `generic type \`${ty.text}\` is not supported`);
    return n;
  }
  ts(ty: Ty): string {
    if (ty.k === "tuple") return ty.elems.length === 0 ? "undefined" : `[${ty.elems.map((e) => this.ts(e)).join(", ")}]`;
    const a = ty.args;
    switch (ty.name) {
      case "Option":
        return `${this.ts(a[0]!)} | undefined`;
      case "Vec": {
        const inner = this.ts(a[0]!);
        return inner.includes("|") ? `(${inner})[]` : `${inner}[]`;
      }
      case "NonZero":
        if (a[0]?.k !== "path" || a[0].name !== "usize") fail(this.path, undefined, "only NonZero<usize> is supported");
        return "number";
      case "BTreeMap":
        return `Map<${this.ts(a[0]!)}, ${this.ts(a[1]!)}>`;
      case "bool":
        return "boolean";
      case "String":
      case "PathBuf":
        return "string";
    }
    if (ty.name in INTS) return INTS[ty.name]!.ts;
    if (LOCAL_TYPES.has(ty.name)) return ty.name;
    const n = this.named(ty);
    this.imp.add(n.mod, ty.name, false);
    return ty.name;
  }
  /** Debug of `v` (formatter expression `f`). */
  debug(ty: Ty, v: string, f: string): string {
    if (ty.k === "tuple") {
      if (ty.elems.length === 0) return `"()"`;
      this.imp.add("../std/fmt.ts", "debug_tuple", true);
      return `debug_tuple(${f}, "", [${ty.elems.map((e, i) => this.debug(e, `${v}[${i}]`, f)).join(", ")}])`;
    }
    const a = ty.args;
    const lam = (inner: Ty) => `(x, f) => ${this.debug(inner, "x", "f")}`;
    switch (ty.name) {
      case "Option":
        this.imp.add("../std/fmt.ts", "debug_option", true);
        return `debug_option(${v}, ${f}, ${lam(a[0]!)})`;
      case "Vec":
        this.imp.add("../std/fmt.ts", "debug_vec", true);
        return `debug_vec(${v}, ${f}, ${lam(a[0]!)})`;
      case "bool":
        this.imp.add("../std/fmt.ts", "debug_bool", true);
        return `debug_bool(${v}, ${f})`;
      case "String":
      case "PathBuf":
        this.imp.add("../std/fmt.ts", "debug_str", true);
        return `debug_str(${v})`;
    }
    if (ty.name in INTS) {
      this.imp.add("../std/fmt.ts", "debug_int", true);
      return `debug_int(${v}, ${f})`;
    }
    const n = this.named(ty);
    if (!n.debug) fail(this.path, undefined, `no Debug for \`${ty.text}\` in the type table`);
    this.imp.add(n.mod, `debug_${ty.name}`, true);
    return `debug_${ty.name}(${v}, ${f})`;
  }
  /** `a == b` (derived PartialEq). */
  eq(ty: Ty, a: string, b: string): string {
    if (this.isPrim(ty)) return `${a} === ${b}`;
    if (ty.k === "tuple") return ty.elems.map((e, i) => this.eq(e, `${a}[${i}]`, `${b}[${i}]`)).join(" && ");
    const lam = (inner: Ty) => `(x, y) => ${this.eq(inner, "x", "y")}`;
    switch (ty.name) {
      case "Option":
        this.imp.add("./options.ts", "option_eq", true);
        return `option_eq(${a}, ${b}, ${lam(ty.args[0]!)})`;
      case "Vec":
        this.imp.add("./options.ts", "vec_eq", true);
        return `vec_eq(${a}, ${b}, ${lam(ty.args[0]!)})`;
    }
    const n = this.named(ty);
    if (!n.eq) fail(this.path, undefined, `no PartialEq for \`${ty.text}\` in the type table`);
    this.imp.add(n.mod, `${ty.name}_eq`, true);
    return `${ty.name}_eq(${a}, ${b})`;
  }
  isPrim(ty: Ty): boolean {
    if (ty.k === "tuple") return ty.elems.length === 0;
    if (["bool", "String", "PathBuf"].includes(ty.name) || ty.name in INTS) return true;
    if (ty.name === "Option") return this.isPrim(ty.args[0]!);
    if (ty.name === "Vec" || ty.name === "NonZero") return ty.name === "NonZero";
    return this.named(ty).prim === true;
  }
  /** `Default::default()` */
  default(ty: Ty): string {
    if (ty.k === "tuple") return ty.elems.length === 0 ? "undefined" : `[${ty.elems.map((e) => this.default(e)).join(", ")}]`;
    switch (ty.name) {
      case "Option":
        return "undefined";
      case "Vec":
        return "[]";
      case "bool":
        return "false";
      case "String":
      case "PathBuf":
        return `""`;
    }
    if (ty.name in INTS) return INTS[ty.name]!.zero;
    const n = this.named(ty);
    if (n.default === undefined) fail(this.path, undefined, `no Default for \`${ty.text}\` in the type table`);
    this.imp.add(n.mod, ty.name, true);
    return n.default;
  }
  /** The `DepTrackingHash` impl of `ty` (config.ts `dep_tracking`), as a TS expression. */
  dth(ty: Ty): string {
    this.imp.add(CONFIG, "dep_tracking", true);
    if (ty.k === "tuple") {
      if (ty.elems.length === 0) return "dep_tracking.via_hash.unit";
      if (ty.elems.length !== 2 && ty.elems.length !== 3) fail(this.path, undefined, `no DepTrackingHash for a ${ty.elems.length}-tuple`);
      return `dep_tracking.tuple${ty.elems.length}(${ty.elems.map((e) => this.dth(e)).join(", ")})`;
    }
    const a = ty.args;
    switch (ty.name) {
      case "Option":
        return `dep_tracking.Option(${this.dth(a[0]!)})`;
      case "Vec":
        return `dep_tracking.Vec(${this.dth(a[0]!)})`;
      case "FxIndexMap":
        return `dep_tracking.FxIndexMap(${this.dth(a[0]!)}, ${this.dth(a[1]!)})`;
      case "OutputTypes":
        return "dep_tracking.OutputTypes";
      case "NonZero":
        if (a[0]?.k !== "path" || a[0].name !== "usize") fail(this.path, undefined, "only NonZero<usize> is supported");
        return "dep_tracking.via_hash.NonZero_usize";
    }
    if (ty.args.length) fail(this.path, undefined, `no DepTrackingHash for generic type \`${ty.text}\``);
    if (!DTH_VIA_HASH.has(ty.name)) fail(this.path, undefined, `type \`${ty.text}\` has no DepTrackingHash in config.ts \`dep_tracking.via_hash\``);
    return `dep_tracking.via_hash.${ty.name}`;
  }
  /** The `FromStr` fn of `T` for `parse_number::<T>` (or of the `Option<T>` inner for `parse_opt_number`). */
  fromStr(ty: Ty): string {
    if (ty.k !== "path" || !(ty.name in INTS)) fail(this.path, undefined, `no FromStr for \`${ty.k === "path" ? ty.text : "tuple"}\``);
    const fs = INTS[ty.name]!.from_str;
    this.imp.add("./options.ts", fs, true);
    return fs;
  }
}

// ---- expressions ---------------------------------------------------------------------------

/** Translates a default-value expression (token range of `p`) to TS. */
function translateExpr(p: Parser, ty: Ty | undefined, tc: TyCtx): string {
  const t = p.next();
  const intTy = ty?.k === "path" && ty.name in INTS ? INTS[ty.name]! : undefined;
  if (t.kind.$ === "OpenParen") {
    p.i--;
    const [o, c] = p.groupAt();
    if (c !== o + 1) fail(p.path, t, "only `()` is supported as a parenthesized default");
    return "undefined";
  }
  if (t.kind.$ === "Literal") {
    if (t.kind.kind.$ === "Int") {
      const n = parseIntLit(t.text);
      if (n === undefined || !/^[0-9_]+$/.test(t.text)) fail(p.path, t, "unsupported integer literal");
      return intTy?.ts === "bigint" ? `${n}n` : String(n);
    }
    if (isStr(t)) {
      const s = strValue(p.path, t);
      // `"..".to_string()`
      if (p.is("Dot") && p.is("Ident", "to_string", 1) && p.is("OpenParen", undefined, 2)) {
        p.i += 2;
        const [o, c] = p.groupAt();
        if (c !== o + 1) fail(p.path, t, "to_string takes no arguments");
      }
      return JSON.stringify(s);
    }
    fail(p.path, t, "unsupported literal");
  }
  if (t.kind.$ !== "Ident") fail(p.path, t, "unsupported default expression");
  if (t.text === "true" || t.text === "false") return t.text;
  if (t.text === "None") return "undefined";
  if (t.text === "Some") {
    p.expect("OpenParen");
    const inner = ty?.k === "path" && ty.name === "Option" ? ty.args[0] : undefined;
    const e = translateExpr(p, inner, tc);
    p.expect("CloseParen");
    return e;
  }
  if (t.text === "vec" && p.is("Bang")) {
    p.i++;
    const [o, c] = p.groupAt();
    if (c !== o + 1) fail(p.path, t, "only `vec![]` is supported");
    return "[]";
  }
  // a path `A::B` / `A::B(..)` / `A::f(..)`
  const segs = [t.text];
  while (p.is("Colon") && p.is("Colon", undefined, 1)) {
    p.i += 2;
    segs.push(p.ident().text);
  }
  if (segs.length !== 2) fail(p.path, t, `unsupported path expression \`${segs.join("::")}\``);
  const [head, last] = segs as [string, string];
  let args: string[] | undefined;
  if (p.is("OpenParen")) {
    const [o, c] = p.groupAt();
    const q = new Parser(p.path, p.toks, o + 1, c);
    args = [];
    while (q.peek() !== undefined) {
      args.push(translateExpr(q, undefined, tc));
      if (!q.eat("Comma")) break;
    }
    if (q.peek() !== undefined) fail(p.path, q.peek(), "unexpected token in arguments");
  }
  if (head === "String" && last === "new" && args?.length === 0) return `""`;
  if (head === "String" && last === "from" && args?.length === 1 && args[0]!.startsWith('"')) return args[0]!;
  if (head === "Vec" && last === "new" && args?.length === 0) return "[]";
  const n = NAMED[head];
  if (!n) fail(p.path, t, `\`${head}\` is not in the type table`);
  tc.imp.add(n.mod, head, true);
  if (args === undefined) return `${head}.${last}`;
  if (/^[A-Z]/.test(last)) {
    // a tuple variant constructor
    return `{ $: ${JSON.stringify(last)}, ${args.map((a, i) => `_${i}: ${a}`).join(", ")} }`;
  }
  return `${head}.${last}(${args.join(", ")})`;
}

// ---- options.rs: macros ------------------------------------------------------------------

/** `redirect_field!` special arms: `($cg:ident.<from>) => { $cg.<to> }`. */
function parseRedirectField(path: string, toks: Tok[]): Map<string, string> {
  const def = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 2]?.text === "redirect_field");
  if (def < 0) fail(path, undefined, "no macro_rules! redirect_field");
  const end = group(path, toks, def + 3);
  const p = new Parser(path, toks, def + 4, end);
  const out = new Map<string, string>();
  let generic = false;
  while (p.peek() !== undefined) {
    const [mo, mc] = p.groupAt();
    p.fatArrow();
    const [bo, bc] = p.groupAt();
    p.eat("Semi");
    const m = joinToks(toks.slice(mo + 1, mc)).replace(/\s+/g, "");
    const b = joinToks(toks.slice(bo + 1, bc)).replace(/\s+/g, "");
    const sm = /^\$cg:ident\.([a-z_]\w*)$/.exec(m);
    const sb = /^\$cg\.([a-z_]\w*)$/.exec(b);
    if (sm && sb) out.set(sm[1]!, sb[1]!);
    else if (m === "$cg:ident.$field:ident" && b === "$cg.$field") generic = true;
    else fail(path, toks[mo], "unexpected redirect_field! arm");
  }
  if (!generic) fail(path, toks[def], "redirect_field! has no `$cg.$field` arm");
  return out;
}

interface SpecialSetter {
  name: string;
  line: number;
  allowed: boolean;
}
/** `setter_for!` arms: special named arms (`collected.mitigations.handle_allowdeny_mitigation_option(v, index, <bool>)`) and the generic one. */
function parseSetterFor(path: string, toks: Tok[]): Map<string, SpecialSetter> {
  const def = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 2]?.text === "setter_for");
  if (def < 0) fail(path, undefined, "no macro_rules! setter_for");
  const end = group(path, toks, def + 3);
  const p = new Parser(path, toks, def + 4, end);
  const out = new Map<string, SpecialSetter>();
  let generic = false;
  for (;;) {
    leading(p);
    if (p.peek() === undefined) break;
    const [mo, mc] = p.groupAt();
    p.fatArrow();
    const [bo, bc] = p.groupAt();
    p.eat("Semi");
    const m = joinToks(toks.slice(mo + 1, mc).filter((t) => !isComment(t))).replace(/\s+/g, "");
    const body = toks.slice(bo + 1, bc).filter((t) => !isComment(t));
    const b = body.map((t) => t.text).join("");
    const special = /^([a-z_]\w*),\$struct_name:ident,\$parse:ident$/.exec(m);
    if (special) {
      const name = special[1]!;
      const want = new RegExp(
        `^pub\\(super\\)fn${name}\\(_cg:&mutsuper::\\$struct_name,collected:&mutsuper::CollectedOptions,v:Option<&str>,index:usize,\\)->bool\\{collected\\.mitigations\\.handle_allowdeny_mitigation_option\\(v,index,(true|false)\\)\\}$`,
      );
      const w = want.exec(b);
      if (!w) fail(path, toks[bo], `unexpected body of setter_for! arm ${name}`);
      const fnTok = body.find((t) => t.text === "fn")!;
      out.set(name, { name, line: fnTok.line, allowed: w[1] === "true" });
    } else if (m === "$opt:ident,$struct_name:ident,$parse:ident") {
      const want =
        "pub(super)fn$opt(cg:&mutsuper::$struct_name,_collected:&mutsuper::CollectedOptions,v:Option<&str>,_index:usize,)->bool{super::parse::$parse(&mutredirect_field!(cg.$opt),v)}";
      if (b !== want) fail(path, toks[bo], "unexpected body of the generic setter_for! arm");
      generic = true;
    } else fail(path, toks[mo], "unexpected setter_for! arm");
  }
  if (!generic) fail(path, toks[def], "setter_for! has no generic arm");
  return out;
}

/** Names of the fns of `pub mod parse`. */
function parseFnNames(path: string, toks: Tok[]): Set<string> {
  const at = toks.findIndex((t, i) => t.text === "mod" && toks[i + 1]?.text === "parse" && toks[i + 2]?.kind.$ === "OpenBrace");
  if (at < 0) fail(path, undefined, "no `mod parse`");
  const end = group(path, toks, at + 2);
  const out = new Set<string>();
  for (let i = at; i < end; i++) if (toks[i]!.text === "fn" && toks[i + 1]?.kind.$ === "Ident") out.add(toks[i + 1]!.text);
  return out;
}

interface DescConst {
  name: string;
  expr: { k: "str"; v: string } | { k: "alias"; name: string } | { k: "linker_flavor_one_of" } | { k: "mitigation_kinds" };
  line: number;
}
/** `mod desc { pub(crate) const NAME: &str = EXPR; .. }` */
function parseDesc(path: string, toks: Tok[]): DescConst[] {
  const at = toks.findIndex((t, i) => t.text === "mod" && toks[i + 1]?.text === "desc" && toks[i + 2]?.kind.$ === "OpenBrace");
  if (at < 0) fail(path, undefined, "no `mod desc`");
  const end = group(path, toks, at + 2);
  const p = new Parser(path, toks, at + 3, end);
  const out: DescConst[] = [];
  for (;;) {
    leading(p);
    if (p.peek() === undefined) break;
    p.ident("pub");
    if (p.is("OpenParen")) p.groupAt();
    p.ident("const");
    const name = p.ident();
    p.expect("Colon");
    p.expect("And");
    p.ident("str");
    p.expect("Eq");
    const start = p.i;
    while (!p.is("Semi")) p.next();
    const e = toks.slice(start, p.i).filter((t) => !isComment(t));
    p.expect("Semi");
    const text = e.map((t) => t.text).join("");
    let expr: DescConst["expr"];
    if (e.length === 1 && isStr(e[0])) expr = { k: "str", v: strValue(path, e[0]!) };
    else if (e.length === 1 && e[0]!.kind.$ === "Ident") {
      if (!out.some((d) => d.name === e[0]!.text)) fail(path, e[0], "alias of an unknown desc const");
      expr = { k: "alias", name: e[0]!.text };
    } else if (text === "::rustc_target::spec::LinkerFlavorCli::one_of()") expr = { k: "linker_flavor_one_of" };
    else if (text === "super::mitigation_coverage::DeniedPartialMitigationKind::KINDS") expr = { k: "mitigation_kinds" };
    else fail(path, e[0], `unsupported desc expression \`${text}\``);
    out.push({ name: name.text, expr, line: name.line });
  }
  return out;
}

/** `LinkerFlavorCli::one_of()`: `concat!("one of: ", $($string, " ",)*)` over `linker_flavor_cli_impls!`. */
function linkerFlavorOneOf(): string {
  const path = TARGET_SPEC_RS;
  const toks = load(path);
  const def = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 2]?.text === "linker_flavor_cli_impls");
  if (def < 0) fail(path, undefined, "no macro_rules! linker_flavor_cli_impls");
  const dend = group(path, toks, def + 3);
  const f = toks.findIndex((t, i) => i > def && i < dend && t.text === "fn" && toks[i + 1]?.text === "one_of");
  if (f < 0) fail(path, toks[def], "no fn one_of in linker_flavor_cli_impls!");
  const bodyOpen = toks.findIndex((t, i) => i > f && t.kind.$ === "OpenBrace");
  const bodyClose = group(path, toks, bodyOpen);
  const body = toks.slice(bodyOpen + 1, bodyClose);
  const shape = body.map((t) => t.text).join("");
  const m = /^concat!\(("[^"]*"),\$\(\$string,("[^"]*"),\)\*\)$/.exec(shape);
  if (!m) fail(path, toks[bodyOpen], "unexpected body of LinkerFlavorCli::one_of");
  const lits = body.filter((t) => isStr(t)).map((t) => strValue(path, t));
  const [prefix, sep] = lits as [string, string];
  const inv = invocations(path, toks, "linker_flavor_cli_impls");
  if (inv.length !== 1) fail(path, undefined, "expected one linker_flavor_cli_impls! invocation");
  const [o, c] = inv[0]!;
  const strings: string[] = [];
  const p = new Parser(path, toks, o + 1, c);
  for (;;) {
    leading(p);
    if (p.peek() === undefined) break;
    if (!p.is("OpenParen")) fail(path, p.peek(), "expected `($($flavor)*)`");
    p.groupAt();
    const s = p.next();
    if (!isStr(s)) fail(path, s, "expected the flavor string");
    strings.push(strValue(path, s));
  }
  return prefix + strings.map((s) => s + sep).join("");
}

interface Entry {
  line: number;
  docs: string[];
  comments: string[];
  attrs: string[];
  name: string;
  ty: Ty;
  tyText: string;
  /** default expression token range (options! only) */
  init?: [number, number];
  parse?: string;
  marker: string;
  tmod?: string;
  tmodEnum?: string;
  mitigation?: string;
  desc?: { k: "str"; v: string } | { k: "const"; name: string };
  removed?: string;
}

interface OptionsInvocation {
  struct_name: string;
  tmod_enum: string;
  stat: string;
  optmod: string;
  prefix: string;
  outputname: string;
  entries: Entry[];
  line: number;
}

function typeRange(p: Parser, stop: (p: Parser) => boolean): [number, number] {
  const start = p.i;
  let depth = 0;
  while (p.peek() !== undefined) {
    if (depth === 0 && stop(p)) break;
    const t = p.next();
    if (t.kind.$ === "Lt") depth++;
    else if (t.kind.$ === "Gt") depth--;
    else if (t.kind.$ === "OpenParen") {
      p.i--;
      p.groupAt();
    }
  }
  return [start, p.i];
}

function parseOptionsInvocation(path: string, toks: Tok[], open: number, close: number): OptionsInvocation {
  const p = new Parser(path, toks, open + 1, close);
  const hdr: string[] = [];
  for (let k = 0; k < 6; k++) {
    leading(p);
    const t = p.next();
    hdr.push(k >= 4 ? strValue(path, t) : t.kind.$ === "Ident" ? t.text : fail(path, t, "expected identifier"));
    p.expect("Comma");
  }
  const [struct_name, tmod_enum, stat, optmod, prefix, outputname] = hdr as [string, string, string, string, string, string];
  const entries: Entry[] = [];
  for (;;) {
    const { docs, comments, attrs } = leading(p);
    if (p.peek() === undefined) break;
    const name = p.ident();
    p.expect("Colon");
    const [ts, te] = typeRange(p, (q) => q.is("Eq"));
    const ty = parseType(new Parser(path, toks, ts, te));
    p.expect("Eq");
    const [go, gc] = p.groupAt();
    p.expect("Comma");
    // ( $init:expr, $parse:ident, [$marker] {TARGET_MODIFIER: v}? {MITIGATION: v}?, $desc:expr (, removed: $r)? )
    const inner = toks.slice(go + 1, gc).filter((t) => !isComment(t));
    const q = new Parser(path, inner, 0, inner.length);
    const initStart = q.i;
    let depth = 0;
    while (q.peek() !== undefined && !(depth === 0 && q.is("Comma"))) {
      const t = q.next();
      if (t.kind.$ === "OpenParen" || t.kind.$ === "OpenBracket" || t.kind.$ === "OpenBrace") depth++;
      else if (t.kind.$ === "CloseParen" || t.kind.$ === "CloseBracket" || t.kind.$ === "CloseBrace") depth--;
    }
    const initToks = inner.slice(initStart, q.i);
    q.expect("Comma");
    const parse = q.ident().text;
    q.expect("Comma");
    q.expect("OpenBracket");
    const marker = q.ident().text;
    q.expect("CloseBracket");
    const e: Entry = { line: name.line, docs, comments, attrs, name: name.text, ty, tyText: joinToks(toks.slice(ts, te)), parse, marker };
    if (q.is("OpenBrace") && q.is("Ident", "TARGET_MODIFIER", 1)) {
      q.i += 2;
      q.expect("Colon");
      e.tmod = q.ident().text;
      q.expect("CloseBrace");
    }
    if (q.is("OpenBrace") && q.is("Ident", "MITIGATION", 1)) {
      q.i += 2;
      q.expect("Colon");
      e.mitigation = q.ident().text;
      q.expect("CloseBrace");
    }
    q.expect("Comma");
    const d = q.next();
    if (isStr(d)) e.desc = { k: "str", v: strValue(path, d) };
    else if (d.kind.$ === "Ident") e.desc = { k: "const", name: d.text };
    else fail(path, d, "expected the description");
    if (q.eat("Comma")) {
      if (q.peek() !== undefined) {
        q.ident("removed");
        q.expect("Colon");
        e.removed = q.ident().text;
        if (e.removed !== "Warn" && e.removed !== "Err") fail(path, d, "unknown RemovedOption");
      }
    }
    if (q.peek() !== undefined) fail(path, q.peek(), "unexpected token in option entry");
    // Keep the init tokens for translation (a separate token array).
    (e as Entry & { initToks: Tok[] }).initToks = initToks;
    entries.push(e);
  }
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) fail(path, undefined, `duplicate option ${e.name}`);
    seen.add(e.name);
  }
  return { struct_name, tmod_enum, stat, optmod, prefix, outputname, entries, line: toks[open]!.line };
}

function parseTopLevel(path: string, toks: Tok[], open: number, close: number): { docs: string[]; attrs: string[]; entries: Entry[] } {
  const p = new Parser(path, toks, open + 1, close);
  const { docs, attrs } = leading(p);
  p.ident("pub");
  p.ident("struct");
  p.ident("Options");
  const [bo, bc] = p.groupAt();
  if (p.peek() !== undefined) fail(path, p.peek(), "unexpected token after `pub struct Options { .. }`");
  const q = new Parser(path, toks, bo + 1, bc);
  const entries: Entry[] = [];
  for (;;) {
    const l = leading(q);
    if (q.peek() === undefined) break;
    const name = q.ident();
    q.expect("Colon");
    const [ts, te] = typeRange(q, (r) => r.is("OpenBracket"));
    const ty = parseType(new Parser(path, toks, ts, te));
    q.expect("OpenBracket");
    const marker = q.ident().text;
    q.expect("CloseBracket");
    const e: Entry = { line: name.line, docs: l.docs, comments: l.comments, attrs: l.attrs, name: name.text, ty, tyText: joinToks(toks.slice(ts, te)), marker };
    if (q.is("OpenBrace")) {
      const [mo, mc] = q.groupAt();
      const m = new Parser(path, toks, mo + 1, mc);
      m.ident("TARGET_MODIFIER");
      m.expect("Colon");
      e.tmod = m.ident().text;
      m.expect("OpenParen");
      e.tmodEnum = m.ident().text;
      m.expect("CloseParen");
    }
    q.expect("Comma");
    entries.push(e);
  }
  return { docs, attrs, entries };
}

/** `const NAME: &str = match A::B { A::V => "..", A::W => panic!(".."), .. };` */
function parseMatchConst(path: string, toks: Tok[], name: string): { scrutinee: [string, string]; arms: { variant: string; value: { k: "str" | "panic"; v: string } }[]; line: number } {
  const at = toks.findIndex((t, i) => t.text === "const" && toks[i + 1]?.text === name);
  if (at < 0) fail(path, undefined, `no const ${name}`);
  const p = new Parser(path, toks, at + 2, toks.length);
  p.expect("Colon");
  p.expect("And");
  p.ident("str");
  p.expect("Eq");
  p.ident("match");
  const a = p.ident().text;
  p.expect("Colon");
  p.expect("Colon");
  const b = p.ident().text;
  const [o, c] = p.groupAt();
  p.expect("Semi");
  const q = new Parser(path, toks, o + 1, c);
  const arms: { variant: string; value: { k: "str" | "panic"; v: string } }[] = [];
  while (q.peek() !== undefined) {
    q.ident(a);
    q.expect("Colon");
    q.expect("Colon");
    const variant = q.ident().text;
    q.fatArrow();
    let value: { k: "str" | "panic"; v: string };
    if (isStr(q.peek())) value = { k: "str", v: strValue(path, q.next()) };
    else {
      q.ident("panic");
      q.expect("Bang");
      q.expect("OpenParen");
      const s = q.next();
      if (!isStr(s)) fail(path, s, "expected a panic message literal");
      const v = strValue(path, s);
      if (v.includes("{") || v.includes("}")) fail(path, s, "formatted panic messages are not supported");
      q.expect("CloseParen");
      value = { k: "panic", v };
    }
    arms.push({ variant, value });
    if (!q.eat("Comma")) break;
  }
  if (q.peek() !== undefined) fail(path, q.peek(), "unexpected token in match");
  return { scrutinee: [a, b], arms, line: toks[at]!.line };
}

// ---- emission: options.gen.ts --------------------------------------------------------------

function header(src: string, what: string): string[] {
  return [`// GENERATED by tools/codegen/options.ts from ${src} (${what}) at ${PIN.commit.slice(0, 12)}. Do not edit.`];
}

const lit = (s: string): string => JSON.stringify(s);
const marker = (path: string, line: number, name: string): string => `// rustc: ${path}:${line} ${name}`;

function docLines(indent: string, e: { comments: string[]; docs: string[]; attrs: string[] }): string[] {
  return [...e.comments.map((c) => indent + c), ...e.docs.map((d) => `${indent}///${d}`), ...e.attrs.filter((a) => !a.startsWith("#[doc")).map((a) => `${indent}// ${a}`)];
}

function genOptions(): Map<string, string> {
  const path = OPTIONS_RS;
  const toks = load(path);
  const imp = new Imports();
  const tc = new TyCtx(path, imp);
  const body: string[] = [];
  const v = (mod: string, name: string) => imp.add(mod, name, true);
  const t = (mod: string, name: string) => imp.add(mod, name, false);

  const redirects = parseRedirectField(path, toks);
  const specials = parseSetterFor(path, toks);
  const parseFns = parseFnNames(path, toks);
  const descs = parseDesc(path, toks);
  const descNames = new Set(descs.map((d) => d.name));
  const tl = invocations(path, toks, "top_level_options");
  if (tl.length !== 1) fail(path, undefined, "expected one top_level_options! invocation");
  const top = parseTopLevel(path, toks, tl[0]![0], tl[0]![1]);
  const opts = invocations(path, toks, "options");
  if (opts.length !== 2) fail(path, undefined, `expected two options! invocations, found ${opts.length}`);
  const groups = opts.map(([o, c]) => parseOptionsInvocation(path, toks, o, c));
  const tlLines = Object.fromEntries(["reparse", "is_target_modifier", "dep_tracking_hash", "gather_target_modifiers"].map((n) => [n, macroFnLine(path, toks, "top_level_options", n)]));
  const opLines = Object.fromEntries(
    ["reparse", "is_target_modifier", "default", "build", "dep_tracking_hash", "gather_target_modifiers"].map((n) => [n, macroFnLine(path, toks, "options", n)]),
  );
  // `$tmod_enum`s named by the top-level struct must be the ones the `options!` invocations define.
  const tmodFields = top.entries.filter((e) => e.tmod);
  for (const f of tmodFields) {
    const g = groups.find((g) => g.tmod_enum === f.tmodEnum);
    if (!g || f.ty.k !== "path" || f.ty.name !== g.struct_name) fail(path, undefined, `top-level target modifier ${f.name} does not match an options! invocation`);
  }

  // -- top_level_options! --
  // -- macro_rules! insert --
  const insertTok = toks.find((tk, i) => tk.text === "insert" && toks[i - 1]?.text === "!" && toks[i - 2]?.text === "macro_rules");
  if (!insertTok) fail(path, undefined, "`macro_rules! insert` not found");
  t(CONFIG, "DynDepTrackingHash");
  v("../std/panic.ts", "panic");
  body.push(`// \`macro_rules! insert\` (${path}:${insertTok.line}), used by \`hash_opt!\` of the \`dep_tracking_hash\` fns.`);
  body.push("function insert(opt_name: string, opt_expr: DynDepTrackingHash, sub_hashes: Map<string, DynDepTrackingHash>): void {");
  body.push("  const prev = sub_hashes.get(opt_name);");
  body.push("  sub_hashes.set(opt_name, opt_expr);");
  body.push("  if (prev !== undefined) {");
  body.push("    panic(`duplicate key in CLI DepTrackingHash: ${opt_name}`);");
  body.push("  }");
  body.push("}");
  body.push("");
  body.push(`// ---- top_level_options! (${path}:${toks[tl[0]![0]]!.line}) ----`);
  body.push("");
  body.push("/** `#[derive(PartialEq, Eq, PartialOrd, Ord, Debug, Copy, Clone)]` */");
  body.push("export type OptionsTargetModifiers =");
  for (const f of tmodFields) body.push(`  | { readonly $: ${lit(f.tmod!)}; readonly _0: ${f.tmodEnum} }`);
  body[body.length - 1] += ";";
  body.push("// PORT: values are interned (one frozen object per value), so `===`, `Map` keys and `Set`");
  body.push("// membership compare by value, like the derived `PartialEq`/`Ord` keys of the `BTreeMap`s.");
  body.push("const OptionsTargetModifiers_interned = new Map<string, OptionsTargetModifiers>();");
  body.push("function OptionsTargetModifiers_intern(v: OptionsTargetModifiers): OptionsTargetModifiers {");
  body.push("  const k = `${v.$}::${v._0}`;");
  body.push("  let e = OptionsTargetModifiers_interned.get(k);");
  body.push("  if (e === undefined) OptionsTargetModifiers_interned.set(k, (e = Object.freeze(v)));");
  body.push("  return e;");
  body.push("}");
  body.push("export const OptionsTargetModifiers = {");
  for (const f of tmodFields) body.push(`  ${f.tmod}: (_0: ${f.tmodEnum}): OptionsTargetModifiers => OptionsTargetModifiers_intern({ $: ${lit(f.tmod!)}, _0 }),`);
  body.push("");
  body.push(`  ${marker(path, tlLines.reparse!, "reparse")}`);
  body.push("  reparse(self: OptionsTargetModifiers, user_value: string): ExtendedTargetModifierInfo {");
  body.push("    switch (self.$) {");
  for (const f of tmodFields) {
    body.push(`      case ${lit(f.tmod!)}:`);
    body.push(`        return ${f.tmodEnum}.reparse(self._0, user_value);`);
  }
  body.push("    }");
  body.push("    // #[allow(unreachable_patterns)]");
  body.push("    return panic(`unknown target modifier option: ${debug_OptionsTargetModifiers(self, PLAIN)}`);");
  body.push("  },");
  body.push("");
  body.push(`  ${marker(path, tlLines.is_target_modifier!, "is_target_modifier")}`);
  body.push("  is_target_modifier(flag_name: string): boolean {");
  for (const f of tmodFields) {
    body.push(`    if (${f.tmodEnum}.is_target_modifier(flag_name)) {`);
    body.push("      return true;");
    body.push("    }");
  }
  body.push("    return false;");
  body.push("  },");
  body.push("} as const;");
  body.push(`export const OptionsTargetModifiers_discriminant: Record<OptionsTargetModifiers["$"], number> = { ${tmodFields.map((f, i) => `${f.tmod}: ${i}`).join(", ")} };`);
  body.push("/** `#[derive(PartialOrd, Ord)]` */");
  body.push("export function OptionsTargetModifiers_cmp(a: OptionsTargetModifiers, b: OptionsTargetModifiers): number {");
  body.push("  const d = OptionsTargetModifiers_discriminant[a.$] - OptionsTargetModifiers_discriminant[b.$];");
  body.push("  if (d !== 0) return d < 0 ? -1 : 1;");
  for (const f of tmodFields) {
    body.push(`  if (a.$ === ${lit(f.tmod!)} && b.$ === ${lit(f.tmod!)}) return Math.sign(${f.tmodEnum}_discriminant[a._0] - ${f.tmodEnum}_discriminant[b._0]);`);
  }
  body.push("  return 0;");
  body.push("}");
  v("../std/fmt.ts", "debug_tuple");
  body.push("export const debug_OptionsTargetModifiers: Debug<OptionsTargetModifiers> = (v, f) => debug_tuple(f, v.$, [v._0]);");
  body.push("");
  body.push(...top.docs.map((d) => `///${d}`));
  body.push(...top.attrs.filter((a) => !a.startsWith("#[doc")).map((a) => `// ${a}`));
  body.push("export class Options {");
  body.push("  constructor(");
  for (const e of top.entries) {
    body.push(...docLines("    ", e));
    body.push(`    public ${e.name}: ${tc.ts(e.ty)},`);
  }
  t("../std/fmt.ts", "Debug");
  t("./options/mitigation_coverage.ts", "MitigationCoverageMap");
  body.push("    // PORT: `BTreeMap<OptionsTargetModifiers, String>` -> `Map` (see CollectedOptions in options.ts).");
  body.push("    public target_modifiers: Map<OptionsTargetModifiers, string>,");
  body.push("    public mitigation_coverage_map: MitigationCoverageMap,");
  body.push("  ) {}");
  body.push("");
  v("../rustc_hashes/lib.ts", "Hash64");
  v("../rustc_data_structures/stable_hash.ts", "StableHasher");
  body.push(`  ${marker(path, tlLines.dep_tracking_hash!, "dep_tracking_hash")}`);
  body.push("  dep_tracking_hash(for_crate_hash: boolean): Hash64 {");
  genHashOpts(tc, top.entries, body, "    ");
  body.push("    const hasher = StableHasher.new();");
  body.push("    dep_tracking.stable_hash(sub_hashes, hasher, this.error_format, for_crate_hash);");
  for (const e of top.entries) {
    if (e.marker !== "SUBSTRUCT") continue;
    // hash_substruct! (options.rs:51): `$opt_expr.dep_tracking_hash(..).hash(hasher, error_format, for_crate_hash)`
    body.push(`    dep_tracking.via_hash.Hash64(this.${e.name}.dep_tracking_hash(for_crate_hash, this.error_format), hasher, this.error_format, for_crate_hash);`);
  }
  body.push("    return hasher.finish(Hash64);");
  body.push("  }");
  body.push("");
  t("./options.ts", "TargetModifier");
  body.push(`  ${marker(path, tlLines.gather_target_modifiers!, "gather_target_modifiers")}`);
  body.push("  gather_target_modifiers(): TargetModifier[] {");
  body.push("    const mods: TargetModifier[] = [];");
  for (const f of tmodFields) {
    body.push("    // Only expand for flags that have `TARGET_MODIFIER`.");
    body.push(`    this.${f.name}.gather_target_modifiers(mods, this.target_modifiers);`);
  }
  body.push("    // `sort_by` is stable, like `Array.prototype.sort`.");
  body.push("    mods.sort((a, b) => OptionsTargetModifiers_cmp(a.opt, b.opt));");
  body.push("    return mods;");
  body.push("  }");
  body.push("}");
  body.push("");

  // -- mod desc --
  const descLine = toks.find((tk, i) => tk.text === "mod" && toks[i + 1]?.text === "desc")!.line;
  body.push(`// ---- mod desc (${path}:${descLine}) ----`);
  body.push("");
  for (const d of descs) {
    let rhs: string;
    switch (d.expr.k) {
      case "str":
        rhs = lit(d.expr.v);
        break;
      case "alias":
        rhs = `desc_${d.expr.name}`;
        break;
      case "linker_flavor_one_of":
        body.push(`// \`::rustc_target::spec::LinkerFlavorCli::one_of()\`: computed from \`linker_flavor_cli_impls!\` (${TARGET_SPEC_RS}).`);
        rhs = lit(linkerFlavorOneOf());
        break;
      case "mitigation_kinds":
        v("./options/mitigation_coverage.gen.ts", "DeniedPartialMitigationKind");
        rhs = "DeniedPartialMitigationKind.KINDS";
        break;
    }
    body.push(`const desc_${d.name}: string = ${rhs};`);
  }
  body.push("// #[allow(non_upper_case_globals)]");
  body.push("export const desc = {");
  for (const d of descs) body.push(`  ${d.name}: desc_${d.name},`);
  body.push("} as const;");
  body.push("");

  // -- options! --
  const consts = new Map<string, number>(); // desc consts other than strings: POLONIUS_HELP
  const emittedConsts = new Set<string>();
  for (const g of groups) {
    // descriptions that name a const: emit the const before the invocation (upstream order)
    for (const e of g.entries) {
      if (e.desc?.k !== "const" || emittedConsts.has(e.desc.name)) continue;
      const c = parseMatchConst(path, toks, e.desc.name);
      const [a, b] = c.scrutinee;
      const n = NAMED[a];
      if (!n) fail(path, undefined, `\`${a}\` is not in the type table`);
      v(n.mod, a);
      body.push(`// ---- ${e.desc.name} (${path}:${c.line}) ----`);
      body.push(`const ${e.desc.name}: string = ((): string => {`);
      body.push(`  switch (${a}.${b}) {`);
      for (const arm of c.arms) {
        body.push(`    case ${lit(arm.variant)}:`);
        if (arm.value.k === "str") body.push(`      return ${lit(arm.value.v)};`);
        else {
          v("../std/panic.ts", "panic");
          body.push(`      return panic(${lit(arm.value.v)});`);
        }
      }
      body.push("  }");
      body.push("})();");
      body.push("");
      emittedConsts.add(e.desc.name);
      consts.set(e.desc.name, c.line);
    }
    genOptionsGroup(path, g, tc, body, { redirects, specials, parseFns, descNames, opLines });
  }

  // imports
  v("../std/fmt.ts", "PLAIN");
  v("../std/panic.ts", "panic");
  const order = ["../rustc_ast/attr/version.ts", "../rustc_errors/emitter.ts", "../rustc_errors/lib.ts", "../rustc_feature/lib.ts", "../rustc_hashes/lib.ts", "../rustc_lint_defs/lib.ts", "../rustc_span/edition.ts", "../rustc_span/hygiene.ts", "../rustc_span/lib.ts", "../std/fmt.ts", "../std/panic.ts", "./config.ts", "./stand_ins.ts", "./utils.ts", "./options.ts", "./options/mitigation_coverage.gen.ts", "./options/mitigation_coverage.ts"];
  const lines = header(path, "top_level_options! / mod desc / options! expansions");
  lines.push("// Import through options.ts, never this file directly (module evaluation order, see options.ts).");
  lines.push(...imp.render(order));
  lines.push("");
  lines.push(...body);
  return new Map([[OUT_OPTIONS, lines.join("\n") + "\n"]]);
}

function genOptionsGroup(
  path: string,
  g: OptionsInvocation,
  tc: TyCtx,
  body: string[],
  ctx: { redirects: Map<string, string>; specials: Map<string, SpecialSetter>; parseFns: Set<string>; descNames: Set<string>; opLines: Record<string, number> },
): void {
  const v = (mod: string, name: string) => tc.imp.add(mod, name, true);
  const t = (mod: string, name: string) => tc.imp.add(mod, name, false);
  const S = g.struct_name;
  const E = g.tmod_enum;
  const tmods = g.entries.filter((e) => e.tmod);
  const initOf = (e: Entry): string => {
    const it = (e as Entry & { initToks: Tok[] }).initToks;
    const p = new Parser(path, it, 0, it.length);
    const s = translateExpr(p, e.ty, tc);
    if (p.peek() !== undefined) fail(path, p.peek(), `unsupported default expression for ${e.name}`);
    return s;
  };
  const fieldOf = (e: Entry): Entry => {
    const to = ctx.redirects.get(e.name);
    if (to === undefined) return e;
    const f = g.entries.find((x) => x.name === to);
    if (!f) fail(path, undefined, `redirect_field! target ${to} is not an option of ${S}`);
    return f;
  };
  /** extra arguments of `parse::$parse` for a field of type `ty` (the `FromStr` of the generic parsers) */
  const parseArgs = (parse: string, ty: Ty): string => {
    if (parse === "parse_number") return `, ${tc.fromStr(ty)}`;
    if (parse === "parse_opt_number") {
      if (ty.k !== "path" || ty.name !== "Option") fail(path, undefined, "parse_opt_number on a non-Option field");
      return `, ${tc.fromStr(ty.args[0]!)}`;
    }
    return "";
  };

  body.push(`// ---- options! { ${S}, ${E}, ${g.stat}, ${g.optmod}, ${lit(g.prefix)}, ${lit(g.outputname)}, .. } (${path}:${g.line}) ----`);
  body.push("");
  // struct
  body.push("// #[derive(Clone)]");
  body.push("// #[rustc_lint_opt_ty]");
  body.push(`export class ${S} {`);
  body.push("  constructor(");
  for (const e of g.entries) {
    body.push(...docLines("    ", e));
    body.push(`    public ${e.name}: ${tc.ts(e.ty)},`);
  }
  body.push("  ) {}");
  body.push("");
  // impl Default
  body.push(`  ${marker(path, ctx.opLines.default!, "default")}`);
  body.push(`  static default(): ${S} {`);
  body.push(`    return new ${S}(`);
  for (const e of g.entries) body.push(`      /* ${e.name} */ ${initOf(e)},`);
  body.push("    );");
  body.push("  }");
  body.push("");
  // build
  t("./stand_ins.ts", "EarlyDiagCtxt");
  t("./stand_ins.ts", "Matches");
  t("./options.ts", "CollectedOptions");
  v("./options.ts", "build_options");
  body.push(`  ${marker(path, ctx.opLines.build!, "build")}`);
  body.push(`  static build(early_dcx: EarlyDiagCtxt, matches: Matches, target_modifiers: CollectedOptions): ${S} {`);
  body.push(`    return build_options(early_dcx, matches, target_modifiers, ${g.stat}, ${lit(g.prefix)}, ${lit(g.outputname)}, ${S}.default);`);
  body.push("  }");
  body.push("");
  t("./config.ts", "ErrorOutputType");
  body.push(`  ${marker(path, ctx.opLines.dep_tracking_hash!, "dep_tracking_hash")}`);
  body.push("  dep_tracking_hash(for_crate_hash: boolean, error_format: ErrorOutputType): Hash64 {");
  genHashOpts(tc, g.entries, body, "    ");
  body.push("    const hasher = StableHasher.new();");
  body.push("    dep_tracking.stable_hash(sub_hashes, hasher, error_format, for_crate_hash);");
  body.push("    return hasher.finish(Hash64);");
  body.push("  }");
  body.push("");
  v("./options.ts", "tmod_push_impl");
  body.push(`  ${marker(path, ctx.opLines.gather_target_modifiers!, "gather_target_modifiers")}`);
  body.push("  gather_target_modifiers(_mods: TargetModifier[], _tmod_vals: Map<OptionsTargetModifiers, string>): void {");
  for (const e of tmods) {
    body.push(`    if (!(${tc.eq(e.ty, `this.${e.name}`, initOf(e))})) {`);
    body.push(`      tmod_push_impl(OptionsTargetModifiers.${S}(${lit(e.tmod!)}), _tmod_vals, _mods);`);
    body.push("    }");
  }
  body.push("  }");
  body.push("}");
  body.push("");

  // $tmod_enum
  body.push("/** `#[derive(PartialEq, Eq, PartialOrd, Ord, Debug, Copy, Clone)]` */");
  body.push(`export type ${E} = ${tmods.length ? tmods.map((e) => lit(e.tmod!)).join(" | ") : "never"};`);
  body.push(`export const ${E}_discriminant: Record<${E}, number> = { ${tmods.map((e, i) => `${e.tmod}: ${i}`).join(", ")} };`);
  body.push(`export const debug_${E}: Debug<${E}> = (v) => v;`);
  t("./options.ts", "ExtendedTargetModifierInfo");
  t("../rustc_span/hygiene.ts", "MutRef");
  body.push(`export const ${E} = {`);
  for (const e of tmods) body.push(`  ${e.tmod}: ${lit(e.tmod!)},`);
  body.push("");
  body.push(`  ${marker(path, ctx.opLines.reparse!, "reparse")}`);
  body.push(`  reparse(self: ${E}, _user_value: string): ExtendedTargetModifierInfo {`);
  body.push("    switch (self) {");
  for (const e of tmods) {
    body.push(`      case ${lit(e.tmod!)}: {`);
    body.push(`        const parsed: MutRef<${tc.ts(e.ty)}> = { value: ${tc.default(e.ty)} };`);
    body.push("        const val = _user_value.length === 0 ? undefined : _user_value;");
    body.push(`        ${setterCall(e, e.ty, "parsed", "val", tc, ctx, parseArgs)};`);
    body.push("        return {");
    body.push(`          prefix: ${lit(g.prefix)},`);
    body.push(`          name: ${lit(e.name)}.replaceAll("_", "-"),`);
    body.push(`          tech_value: ${tc.debug(e.ty, "parsed.value", "PLAIN")},`);
    body.push("        };");
    body.push("      }");
  }
  body.push("    }");
  body.push("    // #[allow(unreachable_patterns)]");
  body.push(`    return panic(\`unknown target modifier option: \${debug_${E}(self, PLAIN)}\`);`);
  body.push("  },");
  body.push("");
  body.push(`  ${marker(path, ctx.opLines.is_target_modifier!, "is_target_modifier")}`);
  body.push("  is_target_modifier(flag_name: string): boolean {");
  body.push('    switch (flag_name.replaceAll("-", "_")) {');
  for (const e of tmods) {
    body.push("      // Only expand for flags that have `TARGET_MODIFIER`.");
    body.push(`      case ${lit(e.name)}:`);
    body.push("        return true;");
  }
  body.push("      default:");
  body.push("        return false;");
  body.push("    }");
  body.push("  },");
  body.push("} as const;");
  body.push("");

  // mod $optmod (emitted before the table: the table refers to the setters while it is evaluated)
  body.push(`// mod ${g.optmod}`);
  body.push(`// PORT: emitted before \`${g.stat}\` (upstream: after), which refers to these setters while it is evaluated.`);
  body.push(`export const ${g.optmod} = {`);
  for (const e of g.entries) {
    const sp = ctx.specials.get(e.name);
    if (sp) {
      body.push(`  ${marker(path, sp.line, sp.name)}`);
      body.push(`  ${e.name}(_cg: ${S}, collected: CollectedOptions, v: string | undefined, index: number): boolean {`);
      body.push(`    return collected.mitigations.handle_allowdeny_mitigation_option(v, index, ${sp.allowed});`);
      body.push("  },");
      continue;
    }
    const f = fieldOf(e);
    body.push(`  ${e.name}(cg: ${S}, _collected: CollectedOptions, v: string | undefined, _index: number): boolean {`);
    body.push(`    const slot = { value: cg.${f.name} };`);
    body.push(`    const r = ${setterCall(e, f.ty, "slot", "v", tc, ctx, parseArgs)};`);
    body.push(`    cg.${f.name} = slot.value;`);
    body.push("    return r;");
    body.push("  },");
  }
  body.push("} as const;");
  body.push("");

  // the table
  t("./options.ts", "OptionDescrs");
  body.push(`export const ${g.stat}: OptionDescrs<${S}> = [`);
  for (const e of g.entries) {
    if (!ctx.descNames.has(e.parse!)) fail(path, undefined, `no desc::${e.parse} (option ${e.name})`);
    const d = e.desc!.k === "str" ? lit(e.desc!.v) : e.desc!.name;
    const removed = e.removed ? lit(e.removed) : "undefined";
    const tmod = e.tmod ? `OptionsTargetModifiers.${S}(${lit(e.tmod)})` : "undefined";
    if (e.mitigation) t("./options/mitigation_coverage.gen.ts", "DeniedPartialMitigationKind");
    const mit = e.mitigation ? `${lit(e.mitigation)} satisfies DeniedPartialMitigationKind` : "undefined";
    body.push(`  {`);
    body.push(`    name: ${lit(e.name)},`);
    body.push(`    setter: ${g.optmod}.${e.name},`);
    body.push(`    type_desc: desc.${e.parse},`);
    body.push(`    desc: ${d},`);
    body.push(`    removed: ${removed},`);
    body.push(`    tmod: ${tmod},`);
    body.push(`    mitigation: ${mit},`);
    body.push(`  },`);
  }
  body.push("];");
  body.push("");
}

function setterCall(
  e: Entry,
  ty: Ty,
  slot: string,
  val: string,
  tc: TyCtx,
  ctx: { redirects: Map<string, string>; parseFns: Set<string> },
  parseArgs: (parse: string, ty: Ty) => string,
): string {
  const parse = e.parse!;
  if (!ctx.parseFns.has(parse)) fail(OPTIONS_RS, undefined, `option ${e.name}: no fn parse::${parse}`);
  tc.imp.add("./options.ts", parse, true);
  return `${parse}(${slot}, ${val}${parseArgs(parse, ty)})`;
}

// ---- emission: mitigation_coverage.gen.ts --------------------------------------------------

function genMitigation(): Map<string, string> {
  const path = MITIGATION_RS;
  const toks = load(path);
  const inv = invocations(path, toks, "denied_partial_mitigations");
  if (inv.length !== 1) fail(path, undefined, "expected one denied_partial_mitigations! invocation");
  const [o, c] = inv[0]!;
  const p = new Parser(path, toks, o + 1, c);
  // [$self:ident] enum $kind:ident { $(($name:ident, $text:expr, $since:ident, $code:expr)),* }
  const [so, sc] = p.groupAt();
  if (sc !== so + 2 || toks[so + 1]!.kind.$ !== "Ident") fail(path, toks[so], "expected `[$self]`");
  p.ident("enum");
  const kind = p.ident().text;
  if (kind !== "DeniedPartialMitigationKind") fail(path, toks[so], "the macro defines `DeniedPartialMitigationKind` whatever `$kind` is; expected that name");
  const [bo, bc] = p.groupAt();
  if (p.peek() !== undefined) fail(path, p.peek(), "unexpected token after the enum body");
  const q = new Parser(path, toks, bo + 1, bc);
  const ms: { name: string; text: string; since: string; code: string; comments: string[] }[] = [];
  for (;;) {
    const { comments } = leading(q);
    if (q.peek() === undefined) break;
    const [to, tcl] = q.groupAt();
    const r = new Parser(path, toks, to + 1, tcl);
    const name = r.ident().text;
    r.expect("Comma");
    const ts = r.next();
    if (!isStr(ts)) fail(path, ts, "expected the mitigation text");
    const text = strValue(path, ts);
    if (text.includes("{") || text.includes("}")) fail(path, ts, "`write!(f, $text)`: format arguments are not supported");
    r.expect("Comma");
    const since = r.ident().text;
    r.expect("Comma");
    const code = joinToks(toks.slice(r.i, tcl));
    ms.push({ name, text, since, code, comments });
    if (!q.eat("Comma")) {
      leading(q);
      break;
    }
  }
  if (q.peek() !== undefined) fail(path, q.peek(), "unexpected token in the enum body");
  if (ms.length === 0) fail(path, toks[bo], "no mitigations");
  // KINDS = concat!(<prefix>, intersperse!(<sep>, ($(concat!(<open>, $text, <close>)),*)), <suffix>)
  const def = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 2]?.text === "denied_partial_mitigations");
  const dend = group(path, toks, def + 3);
  const k = toks.findIndex((t, i) => i > def && i < dend && t.text === "KINDS" && toks[i - 1]?.text === "const");
  if (k < 0) fail(path, toks[def], "no const KINDS in denied_partial_mitigations!");
  const ke = toks.findIndex((t, i) => i > k && t.kind.$ === "Semi");
  const kt = toks.slice(k, ke);
  const shape = kt.map((t) => (isStr(t) ? "S" : t.text)).join("");
  if (shape !== `KINDS:&'staticstr=concat!(S,intersperse!(S,($(concat!(S,$text,S)),*)),S)`) fail(path, toks[k], `unexpected KINDS expression ${shape}`);
  const [prefix, sep, open, close, suffix] = kt.filter((t) => isStr(t)).map((t) => strValue(path, t)) as [string, string, string, string, string];
  const kinds = prefix + ms.map((m) => open + m.text + close).join(sep) + suffix;
  const fns = macroFnLines(path, toks, "denied_partial_mitigations");
  const line = (n: string) => {
    const f = fns.filter((x) => x.name === n);
    if (f.length !== 1) fail(path, toks[def], `expected one fn ${n} in denied_partial_mitigations!`);
    return f[0]!.line;
  };

  const l = header(path, "denied_partial_mitigations! expansion");
  l.push('import { type Edition, Edition_discriminant } from "../../rustc_span/edition.ts";');
  l.push('import type { Debug } from "../../std/fmt.ts";');
  // `$code` of each mitigation -> [`From::from` impl, TS expression] (MITIGATION_LEVEL_CODE); any other
  // expression keeps the `unported` body.
  const levels = ms.map((m) => MITIGATION_LEVEL_CODE[m.code.replace(/\s+/g, "")]);
  const allLevels = levels.every((x) => x !== undefined);
  if (!allLevels) l.push('import { unported } from "../../std/panic.ts";');
  l.push('import { Err, Ok, type Result } from "../../std/result.ts";');
  l.push('import type { Session } from "../lib.ts";');
  l.push('import type { Options } from "../options.gen.ts";');
  l.push('import type { DeniedPartialMitigation, DeniedPartialMitigationKindParseError } from "./mitigation_coverage.ts";');
  l.push("");
  l.push(`// ---- denied_partial_mitigations! (${path}:${toks[o]!.line}) ----`);
  l.push("");
  l.push("/** `#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]` */");
  l.push(`export type ${kind} =`);
  for (const m of ms) {
    l.push(...m.comments.map((cm) => "  " + cm));
    l.push(`  | ${lit(m.name)}`);
  }
  l[l.length - 1] += ";";
  l.push(`export const ${kind}_discriminant: Record<${kind}, number> = { ${ms.map((m, i) => `${m.name}: ${i}`).join(", ")} };`);
  l.push(`export const debug_${kind}: Debug<${kind}> = (v) => v;`);
  l.push("");
  l.push("/** `impl std::fmt::Display for DeniedPartialMitigationKind` */");
  l.push(marker(path, line("fmt"), "fmt"));
  l.push(`export function display_${kind}(self: ${kind}): string {`);
  l.push("  switch (self) {");
  for (const m of ms) {
    l.push(`    case ${lit(m.name)}:`);
    l.push(`      return ${lit(m.text)};`);
  }
  l.push("  }");
  l.push("}");
  l.push("");
  l.push(`export const ${kind} = {`);
  for (const m of ms) l.push(`  ${m.name}: ${lit(m.name)},`);
  l.push("");
  l.push(`  KINDS: ${lit(kinds)},`);
  l.push("");
  l.push("  /** `impl FromStr for DeniedPartialMitigationKind` */");
  l.push(`  ${marker(path, line("from_str"), "from_str")}`);
  l.push(`  from_str(v: string): Result<${kind}, DeniedPartialMitigationKindParseError> {`);
  l.push("    switch (v) {");
  for (const m of ms) {
    l.push(`      case ${lit(m.text)}:`);
    l.push(`        return Ok(${lit(m.name)});`);
  }
  l.push("      default:");
  l.push("        return Err(undefined);");
  l.push("    }");
  l.push("  },");
  l.push("");
  l.push(`  ${marker(path, line("allowed_by_default_at"), "allowed_by_default_at")}`);
  l.push(`  allowed_by_default_at(self: ${kind}, edition: Edition): boolean {`);
  l.push("    let denied_since: Edition;");
  l.push("    switch (self) {");
  l.push("      // Should change the denied-since edition of StackProtector to 2015");
  l.push("      // (all editions) when `-C stack-protector` is stabilized.");
  for (const m of ms) {
    l.push(`      case ${lit(m.name)}:`);
    l.push(`        denied_since = ${lit(m.since)};`);
    l.push("        break;");
  }
  l.push("    }");
  l.push("    return Edition_discriminant[edition] < Edition_discriminant[denied_since];");
  l.push("  },");
  l.push("} as const;");
  l.push("");
  l.push("/** `impl Options` (attached to `Options.prototype` by mitigation_coverage.ts) */");
  l.push(marker(path, line("all_denied_partial_mitigations"), "all_denied_partial_mitigations"));
  l.push(`export function all_denied_partial_mitigations(_self: Options): ${kind}[] {`);
  l.push(`  return [${ms.map((m) => lit(m.name)).join(", ")}];`);
  l.push("}");
  l.push("");
  l.push("/** `impl Session` */");
  l.push(marker(path, line("gather_enabled_denied_partial_mitigations"), "gather_enabled_denied_partial_mitigations"));
  if (allLevels) {
    l.push("export function gather_enabled_denied_partial_mitigations(self: Session): DeniedPartialMitigation[] {");
    l.push("  const mitigations: DeniedPartialMitigation[] = [");
    ms.forEach((m, i) => {
      const [variant, expr] = levels[i]!;
      l.push("    {");
      l.push(`      kind: ${lit(m.name)},`);
      l.push(`      level: { $: ${lit(variant)}, _0: ${expr} },`);
      l.push("    },");
    });
    l.push("  ];");
    l.push("  // PORT: derived `Ord` of `DeniedPartialMitigation` (kind, then level); every kind occurs once here.");
    l.push(`  mitigations.sort((a, b) => ${kind}_discriminant[a.kind] - ${kind}_discriminant[b.kind]);`);
    l.push("  return mitigations;");
    l.push("}");
  } else {
    l.push("export function gather_enabled_denied_partial_mitigations(_self: Session): DeniedPartialMitigation[] {");
    l.push("  // PORT: the levels are Session expressions without a translation in MITIGATION_LEVEL_CODE:");
    for (const m of ms) l.push(`  //   ${m.name}: ${m.code}`);
    l.push('  return unported("rustc_session::Session::gather_enabled_denied_partial_mitigations");');
    l.push("}");
  }
  return new Map([[OUT_MITIGATION, l.join("\n") + "\n"]]);
}

/**
 * `denied_partial_mitigations!` `$code` expressions (whitespace removed) -> [the `DeniedPartialMitigationLevel`
 * variant its `From::from` impl builds (`From<StackProtector>` / `From<bool>`, mitigation_coverage.rs), the TS
 * expression]. The variant is written as an object literal: importing mitigation_coverage.ts here would evaluate
 * it before options.ts (load order, see options.ts).
 */
const MITIGATION_LEVEL_CODE: Record<string, [string, string]> = {
  "self.stack_protector()": ["StackProtector", "self.stack_protector()"],
  "self.opts.cg.control_flow_guard==CFGuard::Checks": ["Enabled", 'self.opts.cg.control_flow_guard === "Checks"'],
};

/** Output path (relative to the repo) -> text. Throws `GenError` on malformed input. */
export function generate(): Map<string, string> {
  return new Map([...genOptions(), ...genMitigation()]);
}

function main(): void {
  requireUpstream();
  let head = "";
  try {
    head = execFileSync("git", ["-C", UPSTREAM, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    head = "";
  }
  if (head !== PIN.commit) die(`upstream checkout ${UPSTREAM} is at ${head || "?"}, UPSTREAM.json pins ${PIN.commit}`);
  let files: Map<string, string>;
  try {
    files = generate();
  } catch (e) {
    if (e instanceof GenError) die(e.message);
    throw e;
  }
  const check = process.argv.includes("--check");
  for (const [rel, text] of files) {
    const out = join(REPO, rel);
    if (check) {
      let cur = "";
      try {
        cur = readFileSync(out, "utf8");
      } catch {}
      if (cur !== text) die(`${rel} is stale; run: bun tools/codegen/options.ts`);
    } else writeFileSync(out, text);
  }
  console.log(`${check ? "up to date" : "wrote"}: ${[...files.keys()].join(", ")}`);
}

if (import.meta.main) main();

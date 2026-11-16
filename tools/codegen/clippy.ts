// Generates clippy's macro expansions at the pin (plan-m8 D5, lane codegen-clippy-macros; PORTING §5 "Macros inside rustc":
// macros are generated, never hand-ported). Sources: the sparse checkout's src/tools/clippy (tools-prep-m8).
//
// Outputs (D4's path mapping, src/tools/clippy/<crate>/src/<path>.rs -> src/<crate>/<path>.ts):
//   - src/clippy_lints/<path>.lints.gen.ts for every clippy_lints module with lint macros (re-exported by the hand module
//     <path>.ts, as for rustc_lint): each `declare_clippy_lint!` expanded through `declare_clippy_lint_inner!` into
//     `declare_tool_lint!` (the `Lint` static, field by field, by lints.ts's `declare_tool_lint!` expansion) plus the
//     `<NAME>_INFO` `LintInfo` static (category, explanation = the doc lines, location = `file!()#L<line!()>` with the
//     oracle build's path remapping, version); `declare_lint_pass!` unit-struct classes and `impl_lint_pass!` impls as
//     `<Ty>_impl_lint_pass`, with `lint_vec`, as lints.ts emits them for rustc_lint.
//   - src/clippy_utils/sym.gen.ts: sym.rs's `generate!` (`EXTRA_SYMBOLS`, one `Symbol` const per entry, `sym` table).
//   - src/clippy_utils/msrvs.gen.ts: msrvs.rs's `msrv_aliases!` (`RustcVersion` consts).
//   - src/clippy_lints/lib.gen.ts: lib.rs's `early_lint_methods!(crate::combined_early_lint_pass, ..)` and
//     `late_lint_methods!(crate::combined_late_lint_pass, ..)` (combined_{early,late}_pass.rs), fully expanded.
//   - src/clippy_config/conf.gen.ts: conf.rs's `define_Conf!`, the part with no trait dispatch: `enum ConfField` and its
//     impl (NAMES, FIELDS, SUGG_NAMES, name, new_field, parse). `struct Conf`, its `Default`, `get_metadata` and
//     `deserialize` call de.rs/types.rs's `FromDefault`/`DeserializeOrDefault` impls chosen by each field's type; they wait
//     for clippy-contract-b's port of those impls (docs/handoff/codegen-clippy-macros.md).
//   - src/clippy_lints/lint_tables.gen.ts: plan-m8 §2d's tables (sub-pass <-> lints <-> implementing files; lint group
//     <-> member lints), derived from lib.rs's registrations, the lint-pass macros and declared_lints.rs.
//
// lib.gen.ts names hand-ported items (every pass type's module, `Conf`, the storages); it is written only once every hand
// module it imports exists (clippy-contract-a/-b land those, then rerun this generator), and until then the generator
// lists it as pending and `--check` requires it absent (decision: see docs/handoff/codegen-clippy-macros.md).
//
// Every macro_rules body expanded here is fingerprinted: if upstream changes one, the generator stops with an ERROR.
//
//   bun tools/codegen/clippy.ts           write the files
//   bun tools/codegen/clippy.ts --check   ERROR if a committed file is stale
//   ... --pending-out <dir>                also write the pending files under <dir> (tools/codegen/clippy-oracle.ts type-checks them)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { PIN, REPO, UPSTREAM, die, requireUpstream } from "../../scripts/lib/common.ts";
import {
  Cursor,
  EDITION_PATH,
  GenError,
  LIB_PATH,
  TOOL_LINT_FINGERPRINT,
  fail,
  isComment,
  lex,
  lintDefault,
  macroFingerprint,
  parseDeclareToolLint,
  setup,
  strValue,
  walkRs,
  type LintDecl,
  type Tok,
} from "./lints.ts";

export const CLIPPY = "src/tools/clippy";
export const DCL_PATH = `${CLIPPY}/declare_clippy_lint/src/lib.rs`;
export const LINTS_SRC = `${CLIPPY}/clippy_lints/src`;
export const LINTS_OUT = "src/clippy_lints";
export const SYM_PATH = `${CLIPPY}/clippy_utils/src/sym.rs`;
export const MSRVS_PATH = `${CLIPPY}/clippy_utils/src/msrvs.rs`;
export const CONF_PATH = `${CLIPPY}/clippy_config/src/conf.rs`;
export const LINTS_LIB_PATH = `${LINTS_SRC}/lib.rs`;
export const DECLARED_LINTS_PATH = `${LINTS_SRC}/declared_lints.rs`;
export const EARLY_PASS_PATH = `${LINTS_SRC}/combined_early_pass.rs`;
export const LATE_PASS_PATH = `${LINTS_SRC}/combined_late_pass.rs`;
export const RUSTC_PASSES_PATH = "compiler/rustc_lint/src/passes.rs";

/// The oracle's clippy-driver is built with `--remap-path-prefix=<checkout>=/rustc/<commit>`, so `file!()` in
/// `declare_clippy_lint_inner!`'s `location` is this prefix plus the upstream path (checked against the oracle binary's
/// strings and the `-Zunpretty=expanded` check, tools/codegen/clippy-oracle.ts).
export const FILE_PREFIX = `/rustc/${PIN.commit}/`;

/// sha1 of the token texts (joined by one space) of the macro_rules bodies this generator implements (lints.ts's scheme).
/// A mismatch means upstream changed the macro: re-read it and update the expansion here.
export const MACRO_FINGERPRINTS: Record<string, [path: string, sha1: string]> = {
  declare_clippy_lint_inner: [DCL_PATH, "2e8c49f4e2d47a6b4b04c6d057dcd5d27f0231d7"],
  declare_clippy_lint: [DCL_PATH, "e08ce1ace858f4e57ebd6930b5bb4ceafdfa48ff"],
  val: [SYM_PATH, "7f85d44412d5dfb8304a5dbe301cfb89b750f05d"],
  generate: [SYM_PATH, "9f90be44311e82f61015058b564fa88d3378942e"],
  msrv_aliases: [MSRVS_PATH, "43302883d53f1842b2bebc1565e589eada3b972a"],
  run_combined_early_lint_pass_field: [EARLY_PASS_PATH, "3b6a388e0e9a4b39cb5be5c7737435cc449f7734"],
  expand_combined_early_lint_pass_method: [EARLY_PASS_PATH, "88393f1dfbbc2f1df6e2a9f64dfd268db1291258"],
  expand_combined_early_lint_pass_methods: [EARLY_PASS_PATH, "c9e63f29d34df1694d8e9aa0a27b7ab12e7acdd6"],
  combined_early_lint_pass: [EARLY_PASS_PATH, "7814f236a2c406e218bff69d2759785d9a394050"],
  run_combined_late_lint_pass_field: [LATE_PASS_PATH, "b2d5413470a6cafdc800a76b3f5e2387f9ccecc3"],
  expand_combined_late_lint_pass_method: [LATE_PASS_PATH, "9f4bd496c96abd298228349fc8c6f3be4006770d"],
  expand_combined_late_lint_pass_methods: [LATE_PASS_PATH, "e0d8225f09fdce1d62f03c7ca20d4e4f5bb313de"],
  combined_late_lint_pass: [LATE_PASS_PATH, "7baed21132a600046e43453c218979bff830988c"],
  early_lint_methods: [RUSTC_PASSES_PATH, "4488f902541cde6fa7498c8cc593b68999c34c96"],
  late_lint_methods: [RUSTC_PASSES_PATH, "67ac4a014fb499c0300a6563f42f9c0c215835fa"],
  first_expr: [CONF_PATH, "d30fcdab179400f47fb3f0c1c88224af0934b2af"],
  filtered_names: [CONF_PATH, "6ad3e099b280973a94306ca8783e418444d989aa"],
  define_Conf: [CONF_PATH, "4bacf6e83980af8657f2f046a31f7dbfb99ee8fb"],
};

export type Read = (upstreamPath: string) => string;

function checkFingerprints(read: Read, only?: (name: string) => boolean): void {
  const toks = new Map<string, Tok[]>();
  for (const [name, [path, want]] of Object.entries(MACRO_FINGERPRINTS)) {
    if (only !== undefined && !only(name)) continue;
    if (!toks.has(path)) toks.set(path, lex(read(path)));
    const got = macroFingerprint(path, toks.get(path)!, name);
    if (got !== want) fail(path, undefined, `macro_rules! ${name} changed upstream (fingerprint ${got}, expected ${want}); re-read it and update tools/codegen/clippy.ts`);
  }
}

// ---- small helpers ----------------------------------------------------------------------------------------------

const GEN = (tool: string, from: string): string => `// GENERATED by tools/codegen/${tool} from ${from} @ ${PIN.commit.slice(0, 12)}. Do not edit.`;

/** `import` specifier from repo-relative file `from` to repo-relative file `to`. */
export function relImport(from: string, to: string): string {
  let r = relative(dirname(from), to).replaceAll("\\", "/");
  if (!r.startsWith(".")) r = `./${r}`;
  return r;
}

/** Index of the token after `macro_rules ! name`, or -1. */
function macroRulesAt(toks: Tok[], name: string): number {
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i]!.text === "macro_rules" && toks[i + 1]!.text === "!" && toks[i + 2]!.text === name) return i + 3;
  }
  return -1;
}

/** The invocations `name! <group>` outside macro_rules bodies, in source order. */
function invocations(path: string, toks: Tok[], names: ReadonlySet<string>): { name: string; tok: Tok; body: Cursor; delim: string }[] {
  const out: { name: string; tok: Tok; body: Cursor; delim: string }[] = [];
  // Block doc comments (`/** .. */`) outside the invocations are dropped; inside one they are an error (none upstream).
  const blockDocLines = toks.filter((t) => t.kind.$ === "BlockComment").map((t) => t.line);
  toks = toks.filter((t) => t.kind.$ !== "BlockComment");
  const top = new Cursor(path, toks);
  while (!top.atEnd()) {
    const t = top.next();
    if (t.kind.$ !== "Ident" || top.peek()?.text !== "!") continue;
    // `a::b!` paths: the last segment names the macro (`rustc_lint::early_lint_methods!`).
    if (t.text === "macro_rules") {
      top.expect("!");
      top.ident();
      top.group(top.next());
      continue;
    }
    if (!names.has(t.text)) continue;
    top.expect("!");
    const open = top.next();
    const body = top.group(open);
    const endLine = toks[body.end]!.line;
    const bad = blockDocLines.find((l) => l >= open.line && l <= endLine);
    if (bad !== undefined) fail(path, { line: bad }, `block doc comments are not supported in ${t.text}!`);
    out.push({ name: t.text, tok: t, body, delim: open.text });
  }
  return out;
}

/** Comma-separated list of identifiers in a cursor (trailing comma allowed). */
function identList(c: Cursor, comments?: string[]): Tok[] {
  const out: Tok[] = [];
  while (!c.atEnd(comments)) {
    out.push(c.ident(comments));
    if (!c.atEnd(comments)) c.expect(",", comments);
  }
  return out;
}

const tokText = (toks: Tok[]): string => toks.map((t) => t.text).join("");

// ---- declare_clippy_lint ----------------------------------------------------------------------------------------

export interface ClippyCtx {
  /** `declare_clippy_lint!` arm keyword (`correctness`, ...) -> [`Level` variant, `LintCategory` variant]. */
  arms: Map<string, [level: string, category: string]>;
  categories: string[];
  lintCtx: ReturnType<typeof setup>;
}

/** Reads declare_clippy_lint's lib.rs: the arms of `declare_clippy_lint!` and `enum LintCategory`. */
export function clippyCtx(read: Read): ClippyCtx {
  checkFingerprints(read, (n) => n.startsWith("declare_clippy_lint"));
  const libSrc = read(LIB_PATH);
  const lintCtx = setup(libSrc, read(EDITION_PATH));
  const got = macroFingerprint(LIB_PATH, lex(libSrc), "declare_tool_lint");
  if (got !== TOOL_LINT_FINGERPRINT) fail(LIB_PATH, undefined, `macro_rules! declare_tool_lint changed upstream (fingerprint ${got}); update tools/codegen/lints.ts`);
  const toks = lex(read(DCL_PATH));
  // arms: `( $(#[$($meta:tt)*])* $vis:vis $lint_name:ident, <arm>, $($rest:tt)* ) => { $crate::declare_clippy_lint_inner! {
  //   $(#[$($meta)*])* $vis $lint_name, <Level>, <Category>, $($rest)* } };`
  const at = macroRulesAt(toks, "declare_clippy_lint");
  const c = new Cursor(DCL_PATH, toks);
  c.i = at;
  const body = c.group(c.expect("{"));
  const arms = new Map<string, [string, string]>();
  while (!body.atEnd()) {
    const m = body.group(body.expect("("));
    body.expect("=");
    body.expect(">");
    const t = body.group(body.expect("{"));
    body.eat(";");
    const mt = m.toks.slice(m.i, m.end).filter((x) => !isComment(x)).map((x) => x.text);
    const tt = t.toks.slice(t.i, t.end).filter((x) => !isComment(x)).map((x) => x.text);
    const mi = mt.indexOf("lint_name");
    // `$ lint_name : ident , <arm> ,`
    if (mi < 0 || mt[mi + 1] !== ":" || mt[mi + 2] !== "ident" || mt[mi + 3] !== "," || mt[mi + 5] !== ",") fail(DCL_PATH, undefined, "unexpected declare_clippy_lint! arm matcher");
    const ti = tt.indexOf("lint_name");
    if (ti < 0 || tt[ti + 1] !== "," || tt[ti + 3] !== "," || tt[ti + 5] !== ",") fail(DCL_PATH, undefined, "unexpected declare_clippy_lint! arm transcriber");
    if (!lintCtx.ctx.levels.includes(tt[ti + 2]!)) fail(DCL_PATH, undefined, `unknown lint level ${tt[ti + 2]}`);
    arms.set(mt[mi + 4]!, [tt[ti + 2]!, tt[ti + 4]!]);
  }
  // enum LintCategory { .. }
  const e = toks.findIndex((x, i) => x.text === "enum" && toks[i + 1]?.text === "LintCategory");
  const ec = new Cursor(DCL_PATH, toks);
  ec.i = e + 2;
  const categories = identList(ec.group(ec.expect("{"))).map((x) => x.text);
  for (const [arm, [, cat]] of arms) if (!categories.includes(cat)) fail(DCL_PATH, undefined, `arm ${arm}: unknown LintCategory ${cat}`);
  return { arms, categories, lintCtx };
}

export interface ClippyLint {
  decl: LintDecl;
  /** Line of `declare_clippy_lint!` (`line!()` in the macro expansion). */
  invocationLine: number;
  category: string;
  /** `#[doc = ..]` values, in order (`///` text after the slashes). */
  docLines: string[];
  version: string;
}

/** One `declare_clippy_lint! { .. }`: `declare_clippy_lint!`'s arm, then `declare_clippy_lint_inner!`. */
function parseDeclareClippyLint(path: string, inv: Tok, c: Cursor, cx: ClippyCtx): ClippyLint {
  const comments: string[] = [];
  // declare_clippy_lint_inner!: `$(#[doc = $docs:literal])* #[clippy::version = $version:literal]`
  const docLines: string[] = [];
  const docSrc: string[] = [];
  let version: string | undefined;
  for (;;) {
    const t = c.peek(comments);
    if (t === undefined) fail(path, inv, "empty declare_clippy_lint!");
    if (t.doc !== undefined) {
      if (version !== undefined) fail(path, t, "declare_clippy_lint_inner!: a doc line after #[clippy::version] does not match");
      docLines.push(t.doc);
      docSrc.push(t.text);
      c.i++;
      continue;
    }
    if (t.text !== "#") break;
    c.i++;
    const g = c.group(c.expect("["));
    const inner = g.toks.slice(g.i, g.end).filter((x) => !isComment(x));
    if (inner.length === 3 && inner[0]!.text === "doc" && inner[1]!.text === "=") {
      if (version !== undefined) fail(path, t, "declare_clippy_lint_inner!: a doc attribute after #[clippy::version] does not match");
      docLines.push(strValue(path, inner[2]!));
      docSrc.push(`#[doc = ${inner[2]!.text}]`);
      continue;
    }
    if (inner.length === 6 && tokText(inner.slice(0, 5)) === "clippy::version=") {
      if (version !== undefined) fail(path, t, "declare_clippy_lint_inner!: a second #[clippy::version] does not match");
      version = strValue(path, inner[5]!);
      continue;
    }
    fail(path, t, `declare_clippy_lint_inner!: attribute #[${tokText(inner)}] does not match`);
  }
  if (version === undefined) fail(path, inv, "declare_clippy_lint_inner!: #[clippy::version = ..] is missing");
  // $vis:vis $lint_name:ident, <arm>, $desc:literal $(, @eval_always = $eval_always:literal)?
  const visStart = c.i;
  if (c.eat("pub", comments) && c.peek(comments)?.text === "(") c.group(c.next());
  const vis = tokText(c.toks.slice(visStart, c.i).filter((x) => !isComment(x)));
  const name = c.ident(comments);
  c.expect(",", comments);
  const armTok = c.ident(comments);
  const arm = cx.arms.get(armTok.text);
  if (arm === undefined) fail(path, armTok, `declare_clippy_lint!: no arm for category \`${armTok.text}\``);
  c.expect(",", comments);
  const desc = c.next(comments);
  if (desc.kind.$ !== "Literal") fail(path, desc, "declare_clippy_lint_inner!: $desc must be a literal");
  let evalAlways: Tok | undefined;
  if (c.eat(",", comments)) {
    c.expect("@", comments);
    c.expect("eval_always", comments);
    c.expect("=", comments);
    evalAlways = c.next(comments);
    if (evalAlways.kind.$ !== "Literal" && evalAlways.text !== "true" && evalAlways.text !== "false") fail(path, evalAlways, "@eval_always must be a literal");
  }
  if (!c.atEnd(comments)) fail(path, c.peek(), `declare_clippy_lint_inner!: unexpected \`${c.peek()!.text}\``);
  // `$crate::rustc_lint::declare_tool_lint! { $(#[doc = $docs])* #[clippy::version = $version] $vis clippy::$lint_name,
  //   $level, $desc, report_in_external_macro:true $(, @eval_always = $eval_always)? }`
  const src = [
    ...docSrc,
    `#[clippy::version = ${JSON.stringify(version)}]`,
    `${vis} clippy::${name.text}, ${arm[0]}, ${desc.text}, report_in_external_macro:true${evalAlways ? `, @eval_always = ${evalAlways.text}` : ""}`,
  ].join("\n");
  const decl = parseDeclareToolLint(path, new Cursor(path, lex(src)), cx.lintCtx.ctx, cx.lintCtx.lintFields);
  decl.line = name.line;
  decl.comments.push(...comments);
  return { decl, invocationLine: inv.line, category: arm[1], docLines, version };
}

// ---- declare_lint_pass! / impl_lint_pass! -----------------------------------------------------------------------

export interface ClippyPass {
  line: number;
  kind: "declare" | "impl";
  name: string;
  /** `<'tcx>` etc. on `impl_lint_pass!($ty => ..)` (erased in TS). */
  generics: string;
  docs: string[];
  lints: string[];
}

/** `declare_lint_pass!($(#[$m:meta])* $name:ident => [$($lint:expr),* $(,)?])` / `impl_lint_pass!($ty:ty => [..])`. */
function parseClippyLintPass(path: string, kind: ClippyPass["kind"], line: number, g: Cursor): ClippyPass {
  const comments: string[] = [];
  const docs: string[] = [];
  for (;;) {
    const t = g.peek(comments);
    if (t?.doc !== undefined) {
      docs.push(`///${t.doc}`);
      g.i++;
    } else if (t?.text === "#" && kind === "declare") {
      g.i++;
      const inner = g.group(g.expect("["));
      docs.push(`// #[${tokText(inner.toks.slice(inner.i, inner.end).filter((x) => !isComment(x)))}]`);
    } else break;
  }
  const name = g.ident(comments);
  let generics = "";
  if (kind === "impl" && g.peek(comments)?.text === "<") {
    // `$ty:ty` with only lifetime arguments (`Foo<'_>`, `Foo<'tcx>`): erased in TS.
    const start = g.i;
    g.next();
    for (;;) {
      const t = g.next(comments);
      if (t.text === ">") break;
      if (t.kind.$ !== "Lifetime" && t.text !== ",") fail(path, t, "impl_lint_pass!: only lifetime arguments are supported on the type");
    }
    generics = tokText(g.toks.slice(start, g.i));
  }
  g.expect("=", comments);
  g.expect(">", comments);
  const list = g.group(g.expect("[", comments));
  if (!g.atEnd(comments)) fail(path, g.peek(), `unexpected tokens in ${kind}_lint_pass!`);
  return { line, kind, name: name.text, generics, docs, lints: identList(list, comments).map((t) => t.text) };
}

// ---- one clippy_lints module ------------------------------------------------------------------------------------

export interface ClippyModule {
  /** Upstream path (`src/tools/clippy/clippy_lints/src/...`). */
  path: string;
  /** Repo-relative output path. */
  out: string;
  lints: ClippyLint[];
  passes: ClippyPass[];
  items: ({ k: "lint"; l: ClippyLint } | { k: "pass"; p: ClippyPass })[];
}

const LINT_MACROS = new Set(["declare_clippy_lint", "declare_lint_pass", "impl_lint_pass"]);

/** Parses one module; `undefined` if it has no lint macro invocation. */
export function parseModule(path: string, src: string, cx: ClippyCtx): ClippyModule | undefined {
  const items: ClippyModule["items"] = [];
  for (const inv of invocations(path, lex(src), LINT_MACROS)) {
    if (inv.name === "declare_clippy_lint") items.push({ k: "lint", l: parseDeclareClippyLint(path, inv.tok, inv.body, cx) });
    else items.push({ k: "pass", p: parseClippyLintPass(path, inv.name === "declare_lint_pass" ? "declare" : "impl", inv.tok.line, inv.body) });
  }
  if (items.length === 0) return undefined;
  const rel = path.slice(CLIPPY.length + 1).replace(/^([^/]+)\/src\//, "$1/").replace(/\.rs$/, "");
  return {
    path,
    out: `src/${rel}.lints.gen.ts`,
    lints: items.flatMap((x) => (x.k === "lint" ? [x.l] : [])),
    passes: items.flatMap((x) => (x.k === "pass" ? [x.p] : [])),
    items,
  };
}

/** The `.lints.gen.ts` text of a module; `owner` maps every clippy lint ident to the module declaring it. */
export function emitModule(m: ClippyModule, owner: ReadonlyMap<string, ClippyModule>): string {
  const declared = new Set(m.lints.map((l) => l.decl.name));
  const L: string[] = [];
  const hand = m.out.replace(/\.lints\.gen\.ts$/, ".ts").split("/").pop();
  L.push(GEN("clippy.ts", m.path));
  L.push(`// \`declare_clippy_lint!\` (${DCL_PATH}) -> \`declare_clippy_lint_inner!\` -> \`declare_tool_lint!\` (${LIB_PATH}):`);
  L.push("// the `Lint` static field by field (struct order) and the `<NAME>_INFO` `LintInfo` static; `declare_lint_pass!` unit");
  L.push(`// structs; \`impl_lint_pass!\` impls as \`<Ty>_impl_lint_pass\`. Hand module: ${hand}.`);
  // Imported names are aliased when the module declares the same name (misc.rs's pass `LintPass`).
  const locals = new Set<string>([...m.lints.flatMap((l) => [l.decl.name, `${l.decl.name}_INFO`]), ...m.passes.flatMap((p) => [p.name, `${p.name}_impl_lint_pass`])]);
  const as = (name: string, crate: string): string => (locals.has(name) ? `${crate}_${name}` : name);
  const spec = (name: string, crate: string): string => (locals.has(name) ? `${name} as ${crate}_${name}` : name);
  const Lint = as("Lint", "rustc_lint_defs");
  const LintPass = as("LintPass", "rustc_lint_defs");
  const LintVec = as("LintVec", "rustc_lint_defs");
  const types = [spec("Lint", "rustc_lint_defs")];
  if (m.passes.some((p) => p.kind === "declare")) types.push(spec("LintPass", "rustc_lint_defs"));
  if (m.passes.length) types.push(spec("LintVec", "rustc_lint_defs"));
  const up = "../".repeat(m.out.split("/").length - 2);
  L.push(`import type { ${types.join(", ")} } from "${up}rustc_lint_defs/lib.ts";`);
  if (m.lints.some((l) => l.decl.fields.has("feature_gate"))) {
    if (locals.has("sym")) fail(m.path, undefined, "a lint named `sym` and a feature gate");
    L.push(`import { sym } from "${up}rustc_span/symbol.ts";`);
  }
  // Lints of the pass lists declared in other modules (`use crate::x::LINT` / `super::LINT`): from their generated files.
  const ext = new Map<string, string[]>();
  for (const p of m.passes) {
    for (const l of p.lints) {
      if (declared.has(l)) continue;
      const o = owner.get(l);
      if (o === undefined) fail(m.path, p, `${p.kind}_lint_pass!(${p.name}) lists ${l}, which no declare_clippy_lint! declares`);
      const spec = relImport(m.out, o.out);
      const xs = ext.get(spec) ?? [];
      if (!xs.includes(l)) xs.push(l);
      ext.set(spec, xs);
    }
  }
  for (const [spec, xs] of [...ext].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) L.push(`import { ${xs.join(", ")} } from "${spec}";`);
  for (const it of m.items) {
    L.push("");
    if (it.k === "lint") {
      const { decl: l, category, docLines, version, invocationLine } = it.l;
      L.push(`// rustc-lint: ${m.path}:${l.line} ${l.name}`);
      for (const d of l.docs) L.push(d);
      for (const cm of l.comments) L.push(cm);
      L.push(`export const ${l.name}: ${Lint} = Object.freeze<${Lint}>({`);
      for (const f of it.l.decl.fields.keys()) if (lintDefault(f) === undefined) fail(m.path, l, `Lint has no default for ${f}`);
      for (const f of LINT_FIELDS) L.push(`  ${f}: ${l.fields.get(f) ?? lintDefault(f)},`);
      L.push("});");
      L.push(`// declare_clippy_lint_inner!: \`pub(crate) static ${l.name}_INFO: &'static LintInfo\``);
      L.push(`export const ${l.name}_INFO = Object.freeze({`);
      L.push(`  lint: ${l.name},`);
      L.push(`  category: ${JSON.stringify(category)} as const,`);
      L.push(`  explanation: ${JSON.stringify(docLines.map((d) => `${d}\n`).join(""))},`);
      L.push(`  location: ${JSON.stringify(`${FILE_PREFIX}${m.path}#L${invocationLine}`)},`);
      L.push(`  version: ${JSON.stringify(version)},`);
      L.push("});");
      continue;
    }
    const p = it.p;
    const list = p.lints.join(", ");
    L.push(`// rustc-lint-pass: ${m.path}:${p.line} ${p.name}`);
    if (p.kind === "declare") {
      for (const d of p.docs) L.push(d);
      L.push(`// declare_lint_pass!(${p.name} => [${list}]): \`#[derive(Copy, Clone)] pub struct ${p.name};\` + impl_lint_pass! (${LIB_PATH}).`);
      L.push(`export class ${p.name} implements ${LintPass} {`);
      L.push(`  name(): string {`);
      L.push(`    return ${JSON.stringify(p.name)};`);
      L.push(`  }`);
      L.push(`  get_lints(): ${LintVec} {`);
      L.push(`    return [${list}];`);
      L.push(`  }`);
      L.push(`  static lint_vec(): ${LintVec} {`);
      L.push(`    return [${list}];`);
      L.push(`  }`);
      L.push(`}`);
    } else {
      L.push(`// impl_lint_pass!(${p.name}${p.generics} => [${list}]): \`impl LintPass for ${p.name}${p.generics}\` (name, get_lints) + inherent \`lint_vec\` (${LIB_PATH}).`);
      L.push(`export const ${p.name}_impl_lint_pass = {`);
      L.push(`  name(): string {`);
      L.push(`    return ${JSON.stringify(p.name)};`);
      L.push(`  },`);
      L.push(`  get_lints(): ${LintVec} {`);
      L.push(`    return [${list}];`);
      L.push(`  },`);
      L.push(`  lint_vec(): ${LintVec} {`);
      L.push(`    return [${list}];`);
      L.push(`  },`);
      L.push(`};`);
    }
  }
  return L.join("\n") + "\n";
}

let LINT_FIELDS: string[] = [];

// ---- sym.rs: generate! ------------------------------------------------------------------------------------------

export interface SymEntry {
  name: string;
  value: string;
  line: number;
}

/** sym.rs's `generate! { $($name:ident $(: $value:literal)? ,)* }`, values per `val!`. */
export function parseSym(src: string): SymEntry[] {
  const invs = invocations(SYM_PATH, lex(src), new Set(["generate"]));
  if (invs.length !== 1) fail(SYM_PATH, undefined, `expected one generate! invocation, found ${invs.length}`);
  const c = invs[0]!.body;
  const out: SymEntry[] = [];
  while (!c.atEnd()) {
    const name = c.ident();
    let value = name.text; // val!($name) => stringify!($name)
    if (c.eat(":")) value = strValue(SYM_PATH, c.next()); // val!($name $value) => $value
    c.expect(","); // the matcher requires the trailing comma
    out.push({ name: name.text, value, line: name.line });
  }
  return out;
}

export function emitSym(entries: SymEntry[], predefined: readonly string[]): string {
  const pre = new Set(predefined);
  const seen = new Set<string>();
  for (const e of entries) {
    // Interner::prefill asserts that the extra symbols repeat neither each other nor the predefined ones.
    if (pre.has(e.value) || seen.has(e.value)) fail(SYM_PATH, e, `extra symbol ${JSON.stringify(e.value)} (${e.name}) is already interned`);
    seen.add(e.value);
  }
  const L: string[] = [];
  L.push(GEN("clippy.ts", SYM_PATH));
  L.push("// `generate! { .. }` expanded per `macro_rules! generate` / `val!`: `EXTRA_SYMBOLS` (given to `rustc_interface::Config`");
  L.push("// by the driver), and entry i as `Symbol::new(PREDEFINED_SYMBOLS_COUNT + ${index()})`, the index the session's interner");
  L.push("// gives the i-th extra symbol. `pub use rustc_span::sym::*` plus these is the `sym` table (explicit items after the glob,");
  L.push("// as src/miri/sym.ts). Hand module: sym.ts.");
  // a namespace import: clippy has extra symbols named like rustc_span's exports (`Symbol`)
  if (entries.some((e) => e.name === "rustc_span_symbol")) fail(SYM_PATH, undefined, "an extra symbol named rustc_span_symbol");
  L.push(`import * as rustc_span_symbol from "../rustc_span/symbol.ts";`);
  L.push("");
  L.push("/// To be supplied to `rustc_interface::Config`");
  L.push("export const EXTRA_SYMBOLS: readonly string[] = [");
  for (const e of entries) L.push(`  ${JSON.stringify(e.value)},`);
  L.push("];");
  L.push("");
  for (const [i, e] of entries.entries()) L.push(`export const ${e.name}: rustc_span_symbol.Symbol = rustc_span_symbol.Symbol.new(rustc_span_symbol.PREDEFINED_SYMBOLS_COUNT + ${i});`);
  L.push("");
  L.push("/** `clippy_utils::sym::*`: every rustc_span `sym::*` symbol, then clippy's extra ones. */");
  L.push("export const sym = {");
  L.push("  ...rustc_span_symbol.sym,");
  for (const e of entries) L.push(`  ${e.name},`);
  L.push("} as const;");
  return L.join("\n") + "\n";
}

// ---- msrvs.rs: msrv_aliases! ------------------------------------------------------------------------------------

export interface MsrvAlias {
  name: string;
  version: [number, number, number];
  line: number;
}

/** `msrv_aliases! { $($major:literal,$minor:literal,$patch:literal { $($name:ident),* $(,)? })* }` */
export function parseMsrvs(src: string): { aliases: MsrvAlias[]; comments: string[] } {
  const invs = invocations(MSRVS_PATH, lex(src), new Set(["msrv_aliases"]));
  if (invs.length !== 1) fail(MSRVS_PATH, undefined, `expected one msrv_aliases! invocation, found ${invs.length}`);
  const c = invs[0]!.body;
  const out: MsrvAlias[] = [];
  const comments: string[] = [];
  const int = (t: Tok): number => {
    if (t.kind.$ !== "Literal" || t.kind.kind.$ !== "Int" || !/^[0-9]+$/.test(t.text)) fail(MSRVS_PATH, t, `expected an unsuffixed integer, found \`${t.text}\``);
    return Number(t.text);
  };
  while (!c.atEnd(comments)) {
    const major = int(c.next(comments));
    c.expect(",", comments);
    const minor = int(c.next(comments));
    c.expect(",", comments);
    const patch = int(c.next(comments));
    for (const n of identList(c.group(c.expect("{", comments)), comments)) out.push({ name: n.text, version: [major, minor, patch], line: n.line });
  }
  return { aliases: out, comments };
}

export function emitMsrvs(aliases: MsrvAlias[]): string {
  const L: string[] = [];
  L.push(GEN("clippy.ts", MSRVS_PATH));
  L.push("// `msrv_aliases! { .. }` expanded per `macro_rules! msrv_aliases`: `pub const $name: RustcVersion = RustcVersion { major,");
  L.push("// minor, patch };` for each name, in source order. Hand module: msrvs.ts.");
  L.push(`import { RustcVersion } from "../rustc_ast/attr/version.ts";`);
  L.push("");
  L.push("// names may refer to stabilized feature flags or library items");
  for (const a of aliases) L.push(`export const ${a.name}: RustcVersion = Object.freeze(new RustcVersion(${a.version.join(", ")}));`);
  return L.join("\n") + "\n";
}

// ---- lib.rs: the registrations (combined passes, pre-expansion passes) ------------------------------------------

export interface CombinedEntry {
  field: string;
  /** Rust type path tokens (`utils::dump_hir::DumpHir`, `significant_drop_tightening::SignificantDropTightening<'tcx>`). */
  ty: string;
  /** Module path segments and type name (lifetime arguments dropped). */
  module: string[];
  tyName: string;
  ctor: Tok[];
  line: number;
}

export interface CombinedPass {
  kind: "early" | "late";
  /** `early_lint_methods!` / `late_lint_methods!` line. */
  line: number;
  name: string;
  params: { name: string; ty: string }[];
  entries: CombinedEntry[];
  /** `// ...` comments inside the entry list (kept in the output). */
  comments: string[];
}

/** Splits a type path `a::b::C<'x>` (or `<a::b::C<'_>>`) into module segments and the type name. */
function splitTypePath(path: string, toks: Tok[]): { module: string[]; tyName: string } {
  const segs: string[] = [];
  let i = 0;
  if (toks[0]?.text === "<") i = 1;
  for (; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.kind.$ === "Ident") segs.push(t.text);
    else if (t.text === ":" || t.text === "<" || t.text === ">" || t.kind.$ === "Lifetime" || t.text === ",") {
      if (t.text === "<" || t.text === ">") {
        // lifetime arguments only
        continue;
      }
      continue;
    } else fail(path, t, `unsupported type path token \`${t.text}\``);
  }
  if (segs.length === 0) fail(path, toks[0], "empty type path");
  return { module: segs.slice(0, -1), tyName: segs[segs.length - 1]! };
}

/** `rustc_lint::{early,late}_lint_methods!(crate::combined_{early,late}_lint_pass, [$name, ($($p: $ty),*), [$($field: $fty = $ctor,)*]]);` */
export function parseCombinedPasses(src: string): CombinedPass[] {
  const out: CombinedPass[] = [];
  for (const inv of invocations(LINTS_LIB_PATH, lex(src), new Set(["early_lint_methods", "late_lint_methods"]))) {
    const kind = inv.name === "early_lint_methods" ? "early" : "late";
    const c = inv.body;
    // $macro:path
    for (const x of ["crate", ":", ":", `combined_${kind}_lint_pass`, ","]) c.expect(x);
    const args = c.group(c.expect("["));
    if (!c.atEnd()) fail(LINTS_LIB_PATH, c.peek(), "unexpected tokens after the combined pass arguments");
    const name = args.ident();
    args.expect(",");
    const ps = args.group(args.expect("("));
    const params: CombinedPass["params"] = [];
    while (!ps.atEnd()) {
      const p = ps.ident();
      ps.expect(":");
      const ty = ps.exprUntilComma();
      params.push({ name: p.text, ty: ty.map((t) => t.text).join(" ").replace(/ :: /g, "::").replace(/& '/g, "&'").replace(/ < /g, "<").replace(/ >/g, ">") });
      ps.eat(",");
    }
    args.expect(",");
    const comments: string[] = [];
    const es = args.group(args.expect("["));
    if (!args.atEnd()) fail(LINTS_LIB_PATH, args.peek(), "unexpected tokens after the entry list");
    const entries: CombinedEntry[] = [];
    while (!es.atEnd(comments)) {
      const field = es.ident(comments);
      es.expect(":");
      // $fty:ty up to the `=` at depth 0
      const tyToks: Tok[] = [];
      let depth = 0;
      for (;;) {
        const t = es.next();
        if (depth === 0 && t.text === "=") break;
        if (t.text === "<") depth++;
        if (t.text === ">") depth--;
        tyToks.push(t);
      }
      const ctor = es.exprUntilComma();
      es.expect(",");
      const { module, tyName } = splitTypePath(LINTS_LIB_PATH, tyToks);
      entries.push({ field: field.text, ty: tokText(tyToks), module, tyName, ctor, line: field.line });
    }
    out.push({ kind, line: inv.tok.line, name: name.text, params, entries, comments });
  }
  if (out.length !== 2 || out[0]!.kind !== "early" || out[1]!.kind !== "late") fail(LINTS_LIB_PATH, undefined, "expected early_lint_methods! then late_lint_methods!");
  return out;
}

/** `store.register_pre_expansion_lint_pass(Box::new(move || Box::new(<path>::<Ty>::new(conf))))` in lib.rs: the type paths. */
export function parsePreExpansionPasses(src: string): { module: string[]; tyName: string; line: number }[] {
  const toks = lex(src);
  const out: { module: string[]; tyName: string; line: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.text !== "register_pre_expansion_lint_pass" || toks[i + 1]?.text !== "(") continue;
    const c = new Cursor(LINTS_LIB_PATH, toks);
    c.i = i + 2;
    const g = c.group(toks[i + 1]!);
    const inner = g.toks.slice(g.i, g.end).filter((x) => !isComment(x));
    // the path after the second `Box :: new (`
    let boxes = 0;
    let j = 0;
    for (; j + 3 < inner.length; j++) {
      if (inner[j]!.text === "Box" && inner[j + 1]!.text === ":" && inner[j + 2]!.text === ":" && inner[j + 3]!.text === "new") {
        boxes++;
        if (boxes === 2) break;
      }
    }
    if (boxes !== 2) fail(LINTS_LIB_PATH, toks[i], "unexpected register_pre_expansion_lint_pass argument");
    const segs: string[] = [];
    for (let k = j + 5; k < inner.length && (inner[k]!.kind.$ === "Ident" || inner[k]!.text === ":"); k++) if (inner[k]!.kind.$ === "Ident") segs.push(inner[k]!.text);
    // drop the constructor (`new` / `default`)
    if (segs.length < 2) fail(LINTS_LIB_PATH, toks[i], "unexpected pre-expansion pass constructor");
    const path = segs.slice(0, -1);
    out.push({ module: path.slice(0, -1), tyName: path[path.length - 1]!, line: toks[i]!.line });
  }
  return out;
}

/** declared_lints.rs: `pub static LINTS: &[&::declare_clippy_lint::LintInfo] = &[ crate::<path>::<NAME>_INFO, .. ];` */
export function parseDeclaredLints(src: string): { module: string[]; name: string }[] {
  const toks = lex(src).filter((t) => !isComment(t));
  const at = toks.findIndex((t, i) => t.text === "LINTS" && toks[i - 1]?.text === "static");
  if (at < 0) fail(DECLARED_LINTS_PATH, undefined, "static LINTS not found");
  let i = toks.findIndex((t, k) => k > at && t.text === "[" && toks[k - 1]?.text === "&" && toks[k - 2]?.text === "=");
  if (i < 0) fail(DECLARED_LINTS_PATH, undefined, "LINTS initializer not found");
  i++;
  const out: { module: string[]; name: string }[] = [];
  while (toks[i]!.text !== "]") {
    const segs: string[] = [];
    while (toks[i]!.text !== "," && toks[i]!.text !== "]") {
      if (toks[i]!.kind.$ === "Ident") segs.push(toks[i]!.text);
      i++;
    }
    if (toks[i]!.text === ",") i++;
    if (segs[0] !== "crate" || !segs[segs.length - 1]!.endsWith("_INFO")) fail(DECLARED_LINTS_PATH, toks[i], `unexpected LINTS entry ${segs.join("::")}`);
    out.push({ module: segs.slice(1, -1), name: segs[segs.length - 1]!.slice(0, -"_INFO".length) });
  }
  return out;
}

// ---- module paths -> upstream files -----------------------------------------------------------------------------

/** Upstream file of clippy_lints module `segs` (`a::b` -> `a/b.rs` or `a/b/mod.rs`); `files` = upstream paths present. */
export function moduleFile(segs: readonly string[], files: ReadonlySet<string>): string {
  if (segs.length === 0) return LINTS_LIB_PATH;
  const base = `${LINTS_SRC}/${segs.join("/")}`;
  if (files.has(`${base}.rs`)) return `${base}.rs`;
  if (files.has(`${base}/mod.rs`)) return `${base}/mod.rs`;
  fail(LINTS_LIB_PATH, undefined, `module ${segs.join("::")} has no file (${base}.rs or ${base}/mod.rs)`);
}

/** TS file of an upstream clippy file (D4): `src/tools/clippy/<crate>/src/<p>.rs` -> `src/<crate>/<p>.ts`. */
export function tsFile(upstream: string): string {
  const m = /^src\/tools\/clippy\/([^/]+)\/src\/(.*)\.rs$/.exec(upstream);
  if (m === null) throw new GenError(`ERROR: ${upstream}: not under a clippy crate's src/`);
  return `src/${m[1]}/${m[2]}.ts`;
}

// ---- §2d tables -------------------------------------------------------------------------------------------------

export interface SubPassRow {
  kind: "pre-expansion" | "early" | "late";
  /** Field of the combined pass (the type name for pre-expansion passes). */
  field: string;
  /** Type path relative to clippy_lints (`utils::dump_hir::DumpHir`). */
  ty: string;
  /** Upstream file holding the pass's `declare_lint_pass!`/`impl_lint_pass!`. */
  declared_in: string;
  /** `clippy::<name>` (lower case), in `lint_vec` order. */
  lints: string[];
  /** Upstream files implementing the pass (see `subPassFiles`). */
  files: string[];
}

export interface Tables {
  sub_passes: SubPassRow[];
  /** Group name -> members (`clippy::<name>`), in registration order (`LintListBuilder::insert(declared_lints::LINTS)`). */
  groups: [string, string[]][];
  /** `register_group_alias(name, alias)`. */
  group_aliases: [alias: string, group: string][];
  /** clippy_lints files with no lint pass of their own and outside every pass's directory (shared helpers). */
  unowned_files: string[];
}

const lower = (l: ClippyLint | undefined, name: string): string => {
  if (l === undefined) throw new GenError(`ERROR: lint ${name} is not declared`);
  return l.decl.fields.get("name") !== undefined ? JSON.parse(l.decl.fields.get("name")!).toLowerCase() : name;
};

/**
 * The files implementing each pass: the file of its lint-pass macro and, when that file is a directory module
 * (`d/mod.rs`, or `d.rs` with a `d/` directory), every file under `d/` except subtrees owned by another pass (a file or
 * directory module with a lint-pass macro of its own). Shared files of a directory with several passes go to each of
 * them. PORT: this follows the module tree, not calls: a pass that calls into another module's functions (other than
 * clippy_utils) counts only its own tree; such helper modules are listed in `unowned_files`.
 */
function subPassFiles(declaredIn: string, allFiles: readonly string[], passFiles: ReadonlySet<string>): string[] {
  const out = [declaredIn];
  let dir: string | undefined;
  if (declaredIn.endsWith("/mod.rs")) dir = declaredIn.slice(0, -"/mod.rs".length);
  else if (allFiles.some((f) => f.startsWith(`${declaredIn.slice(0, -3)}/`))) dir = declaredIn.slice(0, -3);
  if (dir === undefined || declaredIn === LINTS_LIB_PATH) return out;
  // directories owned by another pass under `dir`
  const ownedDirs = [...passFiles].filter((f) => f !== declaredIn).flatMap((f) => (f.endsWith("/mod.rs") ? [f.slice(0, -"/mod.rs".length)] : allFiles.some((g) => g.startsWith(`${f.slice(0, -3)}/`)) ? [f.slice(0, -3)] : []));
  for (const f of allFiles) {
    if (f === declaredIn || !f.startsWith(`${dir}/`)) continue;
    if (passFiles.has(f)) continue;
    if (ownedDirs.some((d) => d.startsWith(`${dir}/`) && f.startsWith(`${d}/`))) continue;
    out.push(f);
  }
  return out;
}

/** The `crate::..` paths a file names (in `use` trees and expressions), as segment lists. */
export function cratePaths(path: string, src: string): string[][] {
  const toks = lex(src).filter((t) => !isComment(t));
  const out: string[][] = [];
  // use-tree after `crate ::`: `a::b::c` | `a::{tree, ..}` | `{tree, ..}` | `*`
  const tree = (i: number, prefix: string[]): number => {
    const t = toks[i];
    if (t === undefined) return i;
    if (t.text === "{") {
      let j = i + 1;
      while (toks[j] !== undefined && toks[j]!.text !== "}") {
        j = tree(j, prefix);
        if (toks[j]?.text === ",") j++;
        else if (toks[j]?.text !== "}") {
          // `as name` or anything else: skip to the next `,`/`}` at this depth
          let depth = 0;
          while (toks[j] !== undefined && !(depth === 0 && (toks[j]!.text === "," || toks[j]!.text === "}"))) {
            if (toks[j]!.text === "{") depth++;
            if (toks[j]!.text === "}") depth--;
            j++;
          }
          if (toks[j]?.text === ",") j++;
        }
      }
      return j + 1;
    }
    if (t.kind.$ !== "Ident") {
      if (prefix.length) out.push(prefix);
      return t.text === "*" ? i + 1 : i;
    }
    const segs = [...prefix, t.text];
    if (toks[i + 1]?.text === ":" && toks[i + 2]?.text === ":") return tree(i + 3, segs);
    out.push(segs);
    return i + 1;
  };
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i]!.text === "crate" && toks[i + 1]!.text === ":" && toks[i + 2]!.text === ":" && toks[i - 1]?.text !== "$" && toks[i - 1]?.text !== "pub" && toks[i - 1]?.text !== "(") tree(i + 3, []);
  }
  void path;
  return out;
}

/** Self-type names of the `impl` blocks of a file (`impl<'tcx> Foo<'tcx>`, `impl LateLintPass<'_> for Foo`). */
export function implSelfTypes(src: string): string[] {
  const toks = lex(src).filter((t) => !isComment(t));
  const out: string[] = [];
  const skipAngle = (i: number): number => {
    let depth = 0;
    do {
      if (toks[i]!.text === "<") depth++;
      else if (toks[i]!.text === ">") depth--;
      i++;
    } while (depth > 0 && i < toks.length);
    return i;
  };
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.text !== "impl" || toks[i]!.kind.$ !== "Ident") continue;
    let j = i + 1;
    if (toks[j]?.text === "<") j = skipAngle(j);
    let last: string | undefined;
    for (; j < toks.length; j++) {
      const t = toks[j]!;
      if (t.text === "{" || t.text === "where" || t.text === ";") break;
      if (t.text === "for") last = undefined;
      else if (t.text === "<") {
        j = skipAngle(j) - 1;
      } else if (t.kind.$ === "Ident" && t.text !== "dyn" && t.text !== "mut" && t.text !== "const") last = t.text;
    }
    if (last !== undefined) out.push(last);
  }
  return out;
}

export function buildTables(
  mods: ClippyModule[],
  combined: CombinedPass[],
  pre: { module: string[]; tyName: string }[],
  declaredOrder: { module: string[]; name: string }[],
  allFiles: string[],
  read: Read,
  groupNames: { categories: Map<string, string>; all: { name: string; alias: string; members: string[] } },
): Tables {
  const fileSet = new Set(allFiles);
  const lintByName = new Map<string, ClippyLint>();
  for (const m of mods) for (const l of m.lints) lintByName.set(l.decl.name, l);
  const passByFile = new Map<string, ClippyPass[]>();
  for (const m of mods) if (m.passes.length) passByFile.set(m.path, m.passes);
  const passFiles = new Set(passByFile.keys());
  const rows: SubPassRow[] = [];
  const used = new Set<string>();
  const row = (kind: SubPassRow["kind"], field: string, module: string[], tyName: string): void => {
    const file = moduleFile(module, fileSet);
    const p = passByFile.get(file)?.find((x) => x.name === tyName);
    if (p === undefined) fail(file, undefined, `${kind} pass ${[...module, tyName].join("::")}: no declare_lint_pass!/impl_lint_pass! for ${tyName} in its module`);
    used.add(`${file}#${tyName}`);
    rows.push({
      kind,
      field,
      ty: [...module, tyName].join("::"),
      declared_in: file,
      lints: p.lints.map((l) => lower(lintByName.get(l), l)),
      files: subPassFiles(file, allFiles, passFiles),
    });
  };
  // `crate::a::b..` references: the longest prefix that is a module file (clippy_lints's own items; lib.rs excluded).
  const refsOf = new Map<string, string[]>();
  const refs = (f: string): string[] => {
    let r = refsOf.get(f);
    if (r === undefined) {
      const set = new Set<string>();
      for (const segs of cratePaths(f, read(f))) {
        for (let k = segs.length; k >= 1; k--) {
          const base = `${LINTS_SRC}/${segs.slice(0, k).join("/")}`;
          const hit = fileSet.has(`${base}.rs`) ? `${base}.rs` : fileSet.has(`${base}/mod.rs`) ? `${base}/mod.rs` : undefined;
          if (hit !== undefined) {
            // naming only lint statics (generated, nothing to port) does not tie the files together
            const rest = segs.slice(k);
            if (hit !== f && !(rest.length === 1 && lintByName.has(rest[0]!))) set.add(hit);
            break;
          }
        }
      }
      r = [...set].sort();
      refsOf.set(f, r);
    }
    return r;
  };
  for (const p of pre) row("pre-expansion", p.tyName, p.module, p.tyName);
  for (const c of combined) for (const e of c.entries) row(c.kind, e.field, e.module, e.tyName);
  for (const [file, ps] of passByFile) for (const p of ps) if (!used.has(`${file}#${p.name}`)) fail(file, p, `lint pass ${p.name} is not registered in lib.rs`);
  // `impl <pass type>` blocks outside the pass's own tree (e.g. manual_let_else.rs's `impl QuestionMark`).
  const rowsByTy = new Map<string, SubPassRow[]>();
  for (const r of rows) {
    const n = r.ty.split("::").pop()!;
    rowsByTy.set(n, [...(rowsByTy.get(n) ?? []), r]);
  }
  for (const f of allFiles) {
    for (const n of new Set(implSelfTypes(read(f)))) {
      for (const r of rowsByTy.get(n) ?? []) {
        // a same-named type in another module is a different type unless the file names this pass's module
        if (rowsByTy.get(n)!.length > 1 && !cratePaths(f, read(f)).some((segs) => segs.join("::") === r.ty)) continue;
        if (!r.files.includes(f)) r.files.push(f);
      }
    }
  }
  for (const r of rows) {
    const own = new Set(r.files);
    const todo = [...r.files];
    while (todo.length) {
      for (const g of refs(todo.pop()!)) {
        if (own.has(g)) continue;
        own.add(g);
        r.files.push(g);
        todo.push(g);
      }
    }
  }
  // every declared lint is in declared_lints.rs, once, and only those
  const order: string[] = [];
  const seen = new Set<string>();
  for (const d of declaredOrder) {
    if (seen.has(d.name)) fail(DECLARED_LINTS_PATH, undefined, `${d.name} listed twice`);
    seen.add(d.name);
    const l = lintByName.get(d.name);
    if (l === undefined) fail(DECLARED_LINTS_PATH, undefined, `${d.name}_INFO: no such lint`);
    const declaredFile = mods.find((m) => m.lints.includes(l))!.path;
    if (moduleFile(d.module, fileSet) !== declaredFile) fail(DECLARED_LINTS_PATH, undefined, `${d.name}_INFO: crate::${d.module.join("::")} is not ${declaredFile}`);
    order.push(d.name);
  }
  for (const n of lintByName.keys()) if (!seen.has(n)) fail(DECLARED_LINTS_PATH, undefined, `${n} is declared but not in LINTS`);
  // groups (LintListBuilder::insert / register)
  const members = new Map<string, string[]>();
  for (const g of [groupNames.all.name, ...groupNames.categories.values()]) members.set(g, []);
  for (const n of order) {
    const l = lintByName.get(n)!;
    const name = lower(l, n);
    if (groupNames.all.members.includes(l.category)) members.get(groupNames.all.name)!.push(name);
    members.get(groupNames.categories.get(l.category)!)!.push(name);
  }
  // files that belong to no pass
  const owned = new Set(rows.flatMap((r) => r.files));
  const unowned = allFiles.filter((f) => !owned.has(f));
  return { sub_passes: rows, groups: [...members], group_aliases: [[groupNames.all.alias, groupNames.all.name]], unowned_files: unowned };
}

/** `LintListBuilder::register` (declare_clippy_lint): the group names, and `insert`'s `all` membership. */
export function parseGroups(src: string, cx: ClippyCtx): { categories: Map<string, string>; all: { name: string; alias: string; members: string[] } } {
  const toks = lex(src).filter((t) => !isComment(t));
  const fnAt = (name: string): Cursor => {
    const i = toks.findIndex((t, k) => t.text === "fn" && toks[k + 1]?.text === name);
    if (i < 0) fail(DCL_PATH, undefined, `fn ${name} not found`);
    const c = new Cursor(DCL_PATH, toks);
    c.i = i + 2;
    c.group(c.expect("("));
    while (c.peek()?.text !== "{") c.next();
    return c.group(c.expect("{"));
  };
  // insert: `Complexity => (Some(&mut self.all), &mut self.complexity),` / `Cargo => (None, &mut self.cargo),`
  const ins = fnAt("insert");
  const field = new Map<string, string>();
  const inAll: string[] = [];
  for (let i = ins.i; i < ins.end; i++) {
    const t = toks[i]!;
    if (cx.categories.includes(t.text) && toks[i + 1]?.text === "=" && toks[i + 2]?.text === ">") {
      const tc = new Cursor(DCL_PATH, toks);
      tc.i = i + 3;
      const tg = tc.group(tc.expect("("));
      const txt = tokText(toks.slice(tg.i, tg.end));
      const m = /^(Some\(&mutself\.all\)|None),&mutself\.(\w+)$/.exec(txt);
      if (m === null) fail(DCL_PATH, t, `unexpected insert arm ${txt}`);
      if (m[1] !== "None") inAll.push(t.text);
      field.set(t.text, m[2]!);
    }
  }
  if (field.size !== cx.categories.length) fail(DCL_PATH, undefined, "insert does not map every LintCategory");
  // register: `store.register_group(true, "<name>", Some("<id>"), self.<field>);` / `store.register_group_alias("<g>", "<alias>");`
  const reg = fnAt("register");
  const byField = new Map<string, string>();
  let alias: [string, string] | undefined;
  for (let i = reg.i; i < reg.end; i++) {
    if (toks[i]!.text === "register_group" && toks[i + 1]!.text === "(") {
      const ac = new Cursor(DCL_PATH, toks);
      ac.i = i + 1;
      const ag = ac.group(ac.expect("("));
      const args: Tok[][] = [];
      while (!ag.atEnd()) {
        args.push(ag.exprUntilComma());
        ag.eat(",");
      }
      // (true, "<name>", Some("<id>"), self.<field>)
      if (args.length !== 4 || tokText(args[3]!.slice(0, 2)) !== "self." || args[3]!.length !== 3) fail(DCL_PATH, toks[i], "unexpected register_group call");
      byField.set(args[3]![2]!.text, strValue(DCL_PATH, args[1]![0]!));
    }
    if (toks[i]!.text === "register_group_alias") alias = [strValue(DCL_PATH, toks[i + 2]!), strValue(DCL_PATH, toks[i + 4]!)];
  }
  const allName = byField.get("all");
  if (allName === undefined || alias === undefined || alias[0] !== allName) fail(DCL_PATH, undefined, "register: unexpected `all` group registration");
  const categories = new Map<string, string>();
  for (const c of cx.categories) {
    const g = byField.get(field.get(c)!);
    if (g === undefined) fail(DCL_PATH, undefined, `register: no group for ${c}`);
    categories.set(c, g);
  }
  return { categories, all: { name: allName, alias: alias[1], members: inAll } };
}

export function emitTables(t: Tables): string {
  const L: string[] = [];
  L.push(`// GENERATED by tools/codegen/clippy.ts from ${LINTS_LIB_PATH}, ${DECLARED_LINTS_PATH}, the lint-pass macros and ${DCL_PATH} @ ${PIN.commit.slice(0, 12)}. Do not edit.`);
  L.push("// plan-m8 §2d's tables for the clippy-ui-lane harness: sub-pass <-> lints <-> implementing files, and lint group <-> members.");
  L.push("// Not a port of an upstream file. Lints are `clippy::<name>` in lower case; files are upstream paths (`coverage.ts --missing`).");
  L.push("// `files`: the pass's own module tree (tools/codegen/clippy.ts `subPassFiles`); `UNOWNED_FILES`: clippy_lints files in no");
  L.push("// pass's tree (helpers a pass may call; not counted in any pass).");
  L.push("");
  L.push("export interface ClippySubPass {");
  L.push('  readonly kind: "pre-expansion" | "early" | "late";');
  L.push("  readonly field: string;");
  L.push("  readonly ty: string;");
  L.push("  readonly declared_in: string;");
  L.push("  readonly lints: readonly string[];");
  L.push("  readonly files: readonly string[];");
  L.push("}");
  L.push("");
  L.push("/** Pre-expansion passes (lib.rs `register_pre_expansion_lint_pass`), then the combined early and late passes' fields, in order. */");
  L.push("export const SUB_PASSES: readonly ClippySubPass[] = [");
  for (const r of t.sub_passes) {
    L.push("  {");
    L.push(`    kind: ${JSON.stringify(r.kind)},`);
    L.push(`    field: ${JSON.stringify(r.field)},`);
    L.push(`    ty: ${JSON.stringify(r.ty)},`);
    L.push(`    declared_in: ${JSON.stringify(r.declared_in)},`);
    L.push(`    lints: [${r.lints.map((x) => JSON.stringify(x)).join(", ")}],`);
    L.push(`    files: [${r.files.map((x) => JSON.stringify(x)).join(", ")}],`);
    L.push("  },");
  }
  L.push("];");
  L.push("");
  L.push("/** `LintListBuilder::register`: group -> members, in `LintListBuilder::insert(declared_lints::LINTS)` order. */");
  L.push("export const LINT_GROUPS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([");
  for (const [g, ms] of t.groups) L.push(`  [${JSON.stringify(g)}, [${ms.map((x) => JSON.stringify(x)).join(", ")}]],`);
  L.push("]);");
  L.push("");
  L.push("/** `register_group_alias(group, alias)`: alias -> group. */");
  L.push("export const LINT_GROUP_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([");
  for (const [a, g] of t.group_aliases) L.push(`  [${JSON.stringify(a)}, ${JSON.stringify(g)}],`);
  L.push("]);");
  L.push("");
  L.push("export const UNOWNED_FILES: readonly string[] = [");
  for (const f of t.unowned_files) L.push(`  ${JSON.stringify(f)},`);
  L.push("];");
  return L.join("\n") + "\n";
}

// ---- lib.rs: the combined passes, expanded -------------------------------------------------------------------

/// `combined_{early,late}_lint_pass!`'s `new`'s parameter types (lib.rs), by their Rust text: [TS type, repo-relative module,
/// exported name]. An unknown type stops the generator.
const PARAM_TYPES: Record<string, [ts: string, module: string, name: string]> = {
  "&'static Conf": ["Conf", "src/clippy_config/lib.ts", "Conf"],
  FormatArgsStorage: ["FormatArgsStorage", "src/clippy_utils/macros.ts", "FormatArgsStorage"],
  AttrStorage: ["AttrStorage", "src/clippy_lints/utils/attr_collector.ts", "AttrStorage"],
  "TyCtxt<'tcx>": ["TyCtxt", "src/rustc_middle/ty/context.ts", "TyCtxt"],
};

/** Upstream fn lines of `fn <name>` inside `macro_rules! <mac>` (the markers of the expansion's methods). */
function macroFnLines(path: string, src: string, mac: string, names: string[]): Map<string, number> {
  const toks = lex(src);
  const at = macroRulesAt(toks, mac);
  if (at < 0) fail(path, undefined, `macro_rules! ${mac} not found`);
  const c = new Cursor(path, toks);
  c.i = at;
  const body = c.group(c.expect("{"));
  const out = new Map<string, number>();
  for (let j = body.i; j < body.end; j++) {
    const t = toks[j]!;
    if (t.text === "fn" && names.includes(toks[j + 1]?.text ?? "") && !out.has(toks[j + 1]!.text)) out.set(toks[j + 1]!.text, t.line);
  }
  for (const n of names) if (!out.has(n)) fail(path, undefined, `macro_rules! ${mac}: fn ${n} not found`);
  return out;
}

export interface LintMethod {
  name: string;
  params: string[];
}

/** `macro_rules! {early,late}_lint_methods`'s method list (`fn $name($($param:ident: $arg:ty),*);`). */
export function parseLintMethods(src: string, mac: "early_lint_methods" | "late_lint_methods"): LintMethod[] {
  const toks = lex(src);
  const at = macroRulesAt(toks, mac);
  if (at < 0) fail(RUSTC_PASSES_PATH, undefined, `macro_rules! ${mac} not found`);
  // the `[ .. ]` after `$macro!($args,`
  let i = at;
  while (!(toks[i]!.text === "[" && toks[i - 1]?.text === "," && toks[i - 2]?.text === "args")) i++;
  const c = new Cursor(RUSTC_PASSES_PATH, toks);
  c.i = i + 1;
  const list = c.group(toks[i]!);
  const out: LintMethod[] = [];
  while (!list.atEnd()) {
    list.expect("fn");
    const name = list.ident();
    const ps = list.group(list.expect("("));
    list.expect(";");
    const params: string[] = [];
    while (!ps.atEnd()) {
      params.push(ps.ident().text);
      ps.expect(":");
      ps.exprUntilComma();
      ps.eat(",");
    }
    out.push({ name: name.text, params });
  }
  return out;
}

const modNs = (module: readonly string[]): string => `mod_${module.join("_")}`;

/** A combined-pass entry's `$ctor` (`T::new(..)`, `T`, `T::default()`, `<T>::default()`) in TS. */
function ctorTs(e: CombinedEntry, params: ReadonlySet<string>): string {
  const t = e.ctor;
  const path = tokText(t);
  const ty = `${modNs(e.module)}.${e.tyName}`;
  const tyPath = [...e.module, e.tyName].join("::");
  const arg = (toks: Tok[]): string => {
    // `x` or `x.clone()` of a parameter. PORT: the storages are `Arc` newtypes (`AttrStorage(Arc<OnceLock<..>>)`,
    // `FormatArgsStorage(Arc<..>)`), so `.clone()` shares the value: the same object in TS.
    const txt = tokText(toks);
    const m = /^(\w+)(\.clone\(\))?$/.exec(txt);
    if (m === null || !params.has(m[1]!)) fail(LINTS_LIB_PATH, e, `${e.field}: unsupported constructor argument \`${txt}\``);
    return m[1]!;
  };
  if (path === tyPath) return `new ${ty}()`; // a unit struct value
  if (path === `${tyPath}::default()` || path === `<${tyPath}>::default()` || path === `<${e.ty.replace(/<'tcx>$/, "<'_>")}>::default()`) return `${ty}.default()`;
  if (path.startsWith(`${tyPath}::new(`) && t[t.length - 1]!.text === ")") {
    // past `a :: b :: T :: new (`; the group ends at the last token
    const open = t.findIndex((x, k) => x.text === "(" && t[k - 1]?.text === "new");
    if (tokText(t.slice(0, open)) !== `${tyPath}::new`) fail(LINTS_LIB_PATH, e, `${e.field}: unsupported constructor \`${path}\``);
    const args = new Cursor(LINTS_LIB_PATH, t, t.length - 1);
    args.i = open + 1;
    const out: string[] = [];
    while (!args.atEnd()) {
      out.push(arg(args.exprUntilComma()));
      args.eat(",");
    }
    return `${ty}.new(${out.join(", ")})`;
  }
  fail(LINTS_LIB_PATH, e, `${e.field}: unsupported constructor \`${path}\``);
}

/** lib.gen.ts: both combined passes, per `combined_{early,late}_lint_pass!` with `{early,late}_lint_methods!`. */
export function emitCombined(combined: CombinedPass[], read: Read, fileSet: ReadonlySet<string>): Output {
  const OUT = `${LINTS_OUT}/lib.gen.ts`;
  const L: string[] = [];
  const needs = new Set<string>();
  const imports = new Map<string, string>(); // module file -> namespace
  const typeImports = new Map<string, Set<string>>();
  const early = combined.find((c) => c.kind === "early")!;
  const late = combined.find((c) => c.kind === "late")!;
  const methods = {
    early: parseLintMethods(read(RUSTC_PASSES_PATH), "early_lint_methods"),
    late: parseLintMethods(read(RUSTC_PASSES_PATH), "late_lint_methods"),
  };
  const body: string[] = [];
  for (const c of [early, late]) {
    const macPath = c.kind === "early" ? EARLY_PASS_PATH : LATE_PASS_PATH;
    const fnLines = macroFnLines(macPath, read(macPath), `combined_${c.kind}_lint_pass`, ["new", "name", "get_lints"]);
    const Ctx = c.kind === "early" ? "EarlyContext" : "LateContext";
    const Pass = c.kind === "early" ? "EarlyLintPass" : "LateLintPass";
    const params = new Set(c.params.map((p) => p.name));
    const sig: string[] = [];
    for (const p of c.params) {
      const m = PARAM_TYPES[p.ty];
      if (m === undefined) fail(LINTS_LIB_PATH, c, `combined pass parameter \`${p.name}: ${p.ty}\` has no TS type in PARAM_TYPES`);
      const set = typeImports.get(m[1]) ?? new Set<string>();
      set.add(m[2]);
      typeImports.set(m[1], set);
      if (m[1].startsWith("src/clippy")) needs.add(m[1]);
      sig.push(`${p.name}: ${m[0]}`);
    }
    for (const e of c.entries) {
      const file = tsFile(moduleFile(e.module, fileSet));
      imports.set(file, modNs(e.module));
      needs.add(file);
    }
    const ty = (e: CombinedEntry): string => `${modNs(e.module)}.${e.tyName}`;
    body.push("");
    body.push(`// rustc-expansion: ${LINTS_LIB_PATH}:${c.line} ${c.kind}_lint_methods!(crate::combined_${c.kind}_lint_pass, [${c.name}, ..])`);
    body.push(`/// ${c.kind === "early" ? "The statically-combined early pass: one field per pass, every `check_*` forwarded to each field in order." : "The statically-combined late pass: one optional field per pass (`None` when `is_active` rejects its `lint_vec`), every `check_*` forwarded to each present field in order."}`);
    body.push(`export class ${c.name} implements ${Pass} {`);
    body.push("  constructor(");
    for (const e of c.entries) body.push(`    public ${e.field}: ${ty(e)}${c.kind === "late" ? " | undefined" : ""},`);
    body.push("  ) {}");
    body.push("");
    body.push(`  // rustc: ${macPath}:${fnLines.get("new")} new`);
    if (c.kind === "early") {
      body.push(`  static new(${sig.join(", ")}): ${c.name} {`);
      body.push(`    return new ${c.name}(`);
      for (const e of c.entries) body.push(`      ${ctorTs(e, params)},`);
    } else {
      body.push(`  static new(${[...sig, "is_active: (lints: LintVec) => boolean"].join(", ")}): ${c.name} {`);
      body.push(`    return new ${c.name}(`);
      // `$($field: is_active(&<$fty>::lint_vec()).then(|| $ctor),)*`
      for (const e of c.entries) body.push(`      is_active(${ty(e)}.lint_vec()) ? ${ctorTs(e, params)} : undefined,`);
    }
    body.push("    );");
    body.push("  }");
    body.push("");
    body.push(`  // rustc: ${macPath}:${fnLines.get("name")} name`);
    body.push("  name(): string {");
    body.push(`    return ${JSON.stringify(c.name)};`);
    body.push("  }");
    body.push(`  // rustc: ${macPath}:${fnLines.get("get_lints")} get_lints`);
    body.push("  get_lints(): LintVec {");
    body.push("    // Reserve at least one slot per pass up front to skip the early reallocations.");
    body.push("    const lints: LintVec = [];");
    for (const e of c.entries) body.push(`    lints.push(...${ty(e)}.lint_vec());`);
    body.push("    return lints;");
    body.push("  }");
    // expand_combined_*_lint_pass_methods!: `fn $name(&mut self, cx, $($param: $arg),*) { $( <field call> )* }`
    for (const m of methods[c.kind]) {
      body.push("");
      const ps = m.params.map((p, i) => `${p}: ${c.kind === "early" ? "EarlyArgs" : "LateArgs"}<"${m.name}">[${i + 1}]`);
      body.push(`  ${m.name}(${[`cx: ${Ctx}`, ...ps].join(", ")}): void {`);
      const args = ["cx", ...m.params].join(", ");
      for (const e of c.entries) {
        if (c.kind === "early") body.push(`    ${Pass}_provided.${m.name}(this.${e.field}, ${args});`);
        else body.push(`    if (this.${e.field} !== undefined) ${Pass}_provided.${m.name}(this.${e.field}, ${args});`);
      }
      body.push("  }");
    }
    body.push("}");
  }
  L.push(GEN("clippy.ts", LINTS_LIB_PATH));
  L.push(`// The two \`{early,late}_lint_methods!(crate::combined_{early,late}_lint_pass, [..])\` invocations (${RUSTC_PASSES_PATH} supplies the`);
  L.push(`// method list) expanded per \`combined_early_lint_pass!\` (${EARLY_PASS_PATH}) and \`combined_late_lint_pass!\``);
  L.push(`// (${LATE_PASS_PATH}). Each field call is \`rustc_lint::{Early,Late}LintPass::$name(..)\`: the trait method, so a pass without`);
  L.push("// the method runs the provided (empty) default (`*_provided`, PORTING §8). Hand module: lib.ts.");
  L.push(`import type { LintVec } from "../rustc_lint_defs/lib.ts";`);
  L.push(`import type { EarlyContext, LateContext } from "../rustc_lint/context.ts";`);
  L.push(`import { type EarlyLintPass, EarlyLintPass_provided, type LateLintPass, LateLintPass_provided } from "../rustc_lint/passes.ts";`);
  for (const [m, names] of [...typeImports].sort()) L.push(`import type { ${[...names].join(", ")} } from "${relImport(OUT, m)}";`);
  for (const [f, ns] of [...imports].sort((a, b) => (a[1] < b[1] ? -1 : 1))) L.push(`import * as ${ns} from "${relImport(OUT, f)}";`);
  L.push("");
  L.push("type EarlyArgs<K extends keyof EarlyLintPass> = Parameters<NonNullable<EarlyLintPass[K]>>;");
  L.push("type LateArgs<K extends keyof LateLintPass> = Parameters<NonNullable<LateLintPass[K]>>;");
  L.push(...body);
  return { path: OUT, text: L.join("\n") + "\n", needs: [...needs].sort() };
}

// ---- conf.rs: define_Conf! --------------------------------------------------------------------------------------

export interface ConfEntry {
  line: number;
  name: string;
  name_str: string;
  docs: string[];
  default_text?: string;
  rename?: string;
  lints?: string[];
  /** `$ty` / `$default` as Rust token text (deprecated fields have neither). */
  ty?: string;
  default?: string;
}

/** The `define_Conf! { .. }` invocation's entries, per the macro's matcher. */
export function parseConf(src: string): ConfEntry[] {
  const invs = invocations(CONF_PATH, lex(src), new Set(["define_Conf"]));
  if (invs.length !== 1) fail(CONF_PATH, undefined, `expected one define_Conf! invocation, found ${invs.length}`);
  const c = invs[0]!.body;
  const out: ConfEntry[] = [];
  const attr = (want: string): Tok[] | undefined => {
    // `#[<want> ..]`
    const t = c.peek();
    if (t?.text !== "#" || c.toks[c.i + 1]?.text !== "[" || c.toks[c.i + 2]?.text !== want) return undefined;
    c.next();
    const g = c.group(c.next());
    g.expect(want);
    return g.toks.slice(g.i, g.end).filter((x) => !isComment(x));
  };
  while (!c.atEnd()) {
    const docs: string[] = [];
    for (;;) {
      const t = c.peek();
      if (t?.doc !== undefined) {
        docs.push(t.doc);
        c.i++;
        continue;
      }
      const d = attr("doc");
      if (d === undefined) break;
      if (d.length !== 2 || d[0]!.text !== "=") fail(CONF_PATH, t, "define_Conf!: #[doc] must be `#[doc = \"..\"]`");
      docs.push(strValue(CONF_PATH, d[1]!));
    }
    const e: Partial<ConfEntry> = { docs };
    const dt = attr("default_text");
    if (dt !== undefined) {
      if (dt.length !== 2 || dt[0]!.text !== "=") fail(CONF_PATH, c.peek(), "define_Conf!: bad #[default_text]");
      e.default_text = strValue(CONF_PATH, dt[1]!);
    }
    const rn = attr("rename");
    if (rn !== undefined) {
      if (rn.length !== 2 || rn[0]!.text !== "=" || rn[1]!.kind.$ !== "Ident") fail(CONF_PATH, c.peek(), "define_Conf!: bad #[rename]");
      e.rename = rn[1]!.text;
    }
    const li = attr("lints");
    if (li !== undefined) {
      const g = new Cursor(CONF_PATH, li, li.length - 1);
      g.i = 1;
      e.lints = identList(g).map((t) => t.text);
    }
    const t = c.peek();
    if (t?.text === "#") fail(CONF_PATH, t, "define_Conf!: attribute out of the matcher's order (doc, default_text, rename, lints)");
    const name = c.ident();
    const ns = c.group(c.expect("("));
    const lit = ns.next();
    if (!ns.atEnd()) fail(CONF_PATH, lit, "define_Conf!: one literal name expected");
    e.line = name.line;
    e.name = name.text;
    e.name_str = strValue(CONF_PATH, lit);
    if (c.eat(":")) {
      const ty: Tok[] = [];
      let depth = 0;
      for (;;) {
        const x = c.peek()!;
        if (depth === 0 && (x.text === "=" || x.text === ",")) break;
        if (x.text === "<" || x.text === "[" || x.text === "(") depth++;
        if (x.text === ">" || x.text === "]" || x.text === ")") depth--;
        ty.push(c.next());
      }
      e.ty = ty.map((x) => x.text).join(" ").replace(/ ?:: ?/g, "::").replace(/ ?< ?/g, "<").replace(/ >/g, ">").replace(/\[ /g, "[").replace(/ \]/g, "]").replace(/ ;/g, ";");
      if (c.eat("=")) e.default = c.exprUntilComma().map((x) => x.text).join(" ").replace(/ ?:: ?/g, "::");
    }
    c.expect(",");
    out.push(e as ConfEntry);
  }
  return out;
}

/** conf.gen.ts: `define_Conf!`'s `enum ConfField` and its impl (NAMES, FIELDS, SUGG_NAMES, name, new_field, parse). */
export function emitConf(entries: ConfEntry[], read: Read): string {
  const src = read(CONF_PATH);
  const fl = macroFnLines(CONF_PATH, src, "define_Conf", ["name", "new_field", "parse", "check_conf_order", "check_conf_names"]);
  const names = entries.map((e) => e.name);
  const variants = [...names, "ThirdParty"];
  const reserved = new Set(["NAMES", "FIELDS", "SUGG_NAMES", "name", "new_field", "parse"]);
  for (const v of variants) if (reserved.has(v)) fail(CONF_PATH, undefined, `ConfField variant ${v} collides with a companion member`);
  for (const e of entries) if (e.rename !== undefined && !names.includes(e.rename)) fail(CONF_PATH, e, `#[rename = ${e.rename}]: no such field`);
  if (new Set(names).size !== names.length) fail(CONF_PATH, undefined, "define_Conf!: a field is defined twice");
  const L: string[] = [];
  L.push(GEN("clippy.ts", CONF_PATH));
  L.push("// `define_Conf! { .. }` expanded per `macro_rules! define_Conf` (with `first_expr!`, `filtered_names!`): `enum ConfField`");
  L.push("// and its inherent impl. The rest of the expansion (`struct Conf`, `impl Default for Conf`, `Conf::get_metadata`,");
  L.push("// `Conf::deserialize`) dispatches on each field's type through de.rs/types.rs's `FromDefault`/`DeserializeOrDefault`");
  L.push("// impls and is generated once clippy-contract-b has ported those (docs/handoff/codegen-clippy-macros.md). Hand module: conf.ts.");
  L.push("");
  L.push("// #[allow(non_camel_case_types)] #[derive(Clone, Copy)]");
  L.push(`export type ConfField =`);
  for (const [i, v] of variants.entries()) L.push(`  | ${JSON.stringify(v)}${i === variants.length - 1 ? ";" : ""}`);
  L.push("");
  L.push("const DISCRIMINANT: { readonly [K in ConfField]: number } = {");
  for (const [i, v] of variants.entries()) L.push(`  ${v}: ${i},`);
  L.push("};");
  L.push("");
  L.push("/** `self as usize` */");
  L.push("export function ConfField_discriminant(self: ConfField): number {");
  L.push("  return DISCRIMINANT[self];");
  L.push("}");
  L.push("");
  L.push("export const ConfField = {");
  for (const v of variants) L.push(`  ${v}: ${JSON.stringify(v)},`);
  L.push("");
  L.push("  // const NAMES: &'static [&'static str] = &[$($name_str,)* \"third-party\"];");
  L.push(`  NAMES: [${[...entries.map((e) => JSON.stringify(e.name_str)), '"third-party"'].join(", ")}] as readonly string[],`);
  L.push("  // const FIELDS: &'static [Self] = &[$(first_expr!($(Self::$new_name,)? Self::$name),)* Self::ThirdParty];");
  L.push(`  FIELDS: [${[...entries.map((e) => JSON.stringify(e.rename ?? e.name)), '"ThirdParty"'].join(", ")}] as readonly ConfField[],`);
  L.push("  // const SUGG_NAMES: &'static [&'static str] = filtered_names!(() $($($new_name)? $name_str)* \"third-party\");");
  L.push(`  SUGG_NAMES: [${[...entries.filter((e) => e.rename === undefined).map((e) => JSON.stringify(e.name_str)), '"third-party"'].join(", ")}] as readonly string[],`);
  L.push("");
  L.push(`  // rustc: ${CONF_PATH}:${fl.get("name")} name`);
  L.push("  name(self: ConfField): string {");
  L.push("    return ConfField.NAMES[ConfField_discriminant(self)]!;");
  L.push("  },");
  L.push("");
  L.push(`  // rustc: ${CONF_PATH}:${fl.get("new_field")} new_field`);
  L.push("  new_field(self: ConfField): ConfField {");
  L.push("    return ConfField.FIELDS[ConfField_discriminant(self)]!;");
  L.push("  },");
  L.push("");
  L.push(`  // rustc: ${CONF_PATH}:${fl.get("parse")} parse`);
  L.push("  parse(s: string): ConfField | undefined {");
  L.push("    switch (s) {");
  for (const e of entries) L.push(`      case ${JSON.stringify(e.name_str)}:`, `        return ${JSON.stringify(e.name)};`);
  L.push('      case "third-party":');
  L.push('        return "ThirdParty";');
  L.push("      default:");
  L.push("        return undefined;");
  L.push("    }");
  L.push("  },");
  L.push("} as const;");
  L.push("");
  L.push(`// rustc-skip: ${CONF_PATH}:${fl.get("check_conf_order")} check_conf_order #[test] of the define_Conf! expansion; tools/codegen/clippy.test.ts checks the same order`);
  L.push(`// rustc-skip: ${CONF_PATH}:${fl.get("check_conf_names")} check_conf_names #[test] of the define_Conf! expansion; tools/codegen/clippy.test.ts checks the same names`);
  return L.join("\n") + "\n";
}

// ---- driver -----------------------------------------------------------------------------------------------------

export interface Output {
  path: string;
  text: string;
  /** Hand modules (repo-relative) that must exist before the file is written; missing ones make it pending. */
  needs: string[];
}

export interface GenerateResult {
  outputs: Output[];
  mods: ClippyModule[];
  combined: CombinedPass[];
  tables: Tables;
  sym: SymEntry[];
  msrvs: MsrvAlias[];
  conf: ConfEntry[];
}

export function generateAll(read: Read, lintFiles: string[], predefined: readonly string[]): GenerateResult {
  checkFingerprints(read);
  const cx = clippyCtx(read);
  LINT_FIELDS = cx.lintCtx.lintFields;
  const mods: ClippyModule[] = [];
  for (const f of lintFiles) {
    const m = parseModule(f, read(f), cx);
    if (m !== undefined) mods.push(m);
  }
  const owner = new Map<string, ClippyModule>();
  for (const m of mods) {
    for (const l of m.lints) {
      if (owner.has(l.decl.name)) fail(m.path, l.decl, `${l.decl.name} is also declared in ${owner.get(l.decl.name)!.path}`);
      owner.set(l.decl.name, m);
    }
  }
  const outputs: Output[] = mods.map((m) => ({ path: m.out, text: emitModule(m, owner), needs: [] }));
  const sym = parseSym(read(SYM_PATH));
  outputs.push({ path: "src/clippy_utils/sym.gen.ts", text: emitSym(sym, predefined), needs: [] });
  const msrvs = parseMsrvs(read(MSRVS_PATH)).aliases;
  outputs.push({ path: "src/clippy_utils/msrvs.gen.ts", text: emitMsrvs(msrvs), needs: [] });
  const libSrc = read(LINTS_LIB_PATH);
  const combined = parseCombinedPasses(libSrc);
  const pre = parsePreExpansionPasses(libSrc);
  const tables = buildTables(mods, combined, pre, parseDeclaredLints(read(DECLARED_LINTS_PATH)), lintFiles, read, parseGroups(read(DCL_PATH), cx));
  outputs.push({ path: `${LINTS_OUT}/lint_tables.gen.ts`, text: emitTables(tables), needs: [] });
  outputs.push(emitCombined(combined, read, new Set(lintFiles)));
  const conf = parseConf(read(CONF_PATH));
  outputs.push({ path: "src/clippy_config/conf.gen.ts", text: emitConf(conf, read), needs: [] });
  return { outputs, mods, combined, tables, sym, msrvs, conf };
}

/** The clippy_lints `.rs` files (upstream paths), sorted. */
export function lintFilesOf(): string[] {
  return walkRs(join(UPSTREAM, LINTS_SRC), "", []).map((f) => `${LINTS_SRC}/${f}`);
}

async function main(): Promise<void> {
  requireUpstream();
  const read: Read = (p) => readFileSync(join(UPSTREAM, p), "utf8");
  const { PREFILL } = await import("../../src/rustc_span/symbol.gen.ts");
  let g: GenerateResult;
  try {
    g = generateAll(read, lintFilesOf(), PREFILL);
  } catch (e) {
    if (e instanceof GenError) die(e.message.replace(/^ERROR: /, ""));
    throw e;
  }
  const check = process.argv.includes("--check");
  // `--pending-out <dir>`: also write the pending outputs there (at their repo paths), to inspect or type-check them.
  const po = process.argv.indexOf("--pending-out");
  const pendingOut = po >= 0 ? process.argv[po + 1] : undefined;
  const pending: [string, string[]][] = [];
  for (const o of g.outputs) {
    const missing = o.needs.filter((n) => !existsSync(join(REPO, n)));
    const abs = join(REPO, o.path);
    if (missing.length) {
      pending.push([o.path, missing]);
      if (pendingOut !== undefined) {
        mkdirSync(dirname(join(pendingOut, o.path)), { recursive: true });
        writeFileSync(join(pendingOut, o.path), o.text);
      }
      if (check && existsSync(abs)) die(`${o.path} exists but its hand modules do not (first: ${missing[0]}); run: bun tools/codegen/clippy.ts`);
      if (!check) rmSync(abs, { force: true });
      continue;
    }
    if (check) {
      let cur = "";
      try {
        cur = readFileSync(abs, "utf8");
      } catch {}
      if (cur !== o.text) die(`${o.path} is stale; run: bun tools/codegen/clippy.ts`);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, o.text);
    }
  }
  const nLints = g.mods.reduce((n, m) => n + m.lints.length, 0);
  const nPasses = g.mods.reduce((n, m) => n + m.passes.length, 0);
  const [early, late] = g.combined;
  console.log(
    `${check ? "up to date" : "wrote"}: ${g.mods.length} clippy_lints modules (${nLints} lints, ${nPasses} lint passes); combined passes ${early!.entries.length} early + ${late!.entries.length} late; ${g.sym.length} extra symbols; ${g.msrvs.length} msrv aliases`,
  );
  for (const [p, missing] of pending) console.log(`pending: ${p} (${missing.length} hand modules missing, first: ${missing[0]})`);
}

if (import.meta.main) await main();

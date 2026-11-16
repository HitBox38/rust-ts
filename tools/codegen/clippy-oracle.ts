// Oracle check of tools/codegen/clippy.ts (plan-m8 D5, lane codegen-clippy-macros). Not part of the unit step (it runs the
// oracle rustc and clippy-driver, about a minute); run by hand after changing the generator or the pin:
//
//   bun tools/codegen/clippy-oracle.ts [--work <dir>]   one summary line per check; details in the scratch directory
//
// The scratch directory is a new `$RUST_TS_DATA/tmp/codegen-clippy-oracle-XXXXXX` per run (review N7: two users must not
// share one), or `--work <dir>`, which must not exist yet or be empty. Nothing is ever deleted; remove it when done.
//
// 1. `-Zunpretty=expanded` with the oracle rustc and its rustc-dev: a scratch copy of the clippy sources in which every byte
//    outside the expanded macros is blanked (newlines kept, so `line!()` is unchanged; the scratch root is remapped to
//    `/rustc/<commit>` as in the oracle's own build, so `file!()` is too) is expanded with the real macro definitions:
//    declare_clippy_lint's lib.rs (built to an rmeta), rustc_lint_defs's `declare_tool_lint!`/`declare_lint_pass!`/
//    `impl_lint_pass!` and rustc_lint's `{early,late}_lint_methods!` from the sysroot, clippy's combined_*_pass.rs, sym.rs's
//    `generate!`, msrvs.rs's `msrv_aliases!` and conf.rs's `define_Conf!`. Every lint static, `_INFO` static, lint-pass
//    impl, extra symbol, msrv alias, combined-pass field and define_Conf table is then compared with the generator's model,
//    and the combined passes' TS (each field's constructor and `is_active` guard, each call's trait method, guard and
//    arguments) is rebuilt from the expansion and compared line by line with the emitted lib.gen.ts.
// 2. The oracle clippy-driver's `-W help` (the clippy-preview tarball unpacked under $RUST_TS_DATA/tools): every clippy lint's
//    name, default level and description, and every clippy lint group's members in order, against the generated statics and
//    lint_tables.gen.ts's LINT_GROUPS.
// 3. The emitted files (review N3): every written `.lints.gen.ts`, sym.gen.ts, msrvs.gen.ts and lint_tables.gen.ts is
//    imported, and its values (lint statics, `_INFO`, lint passes' `name`/`get_lints`/`lint_vec`, symbols, versions, the
//    sub-pass rows and groups) are compared with what was read from the oracle in 1 and 2, not with the generator's model.
// 4. A type-check of the pending lib.gen.ts against stub hand modules.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, requireUpstream } from "../../scripts/lib/common.ts";
import { FrontmatterAllowed, tokenize } from "../../src/rustc_lexer/lib.ts";
import { Str } from "../../src/std/str.ts";
import { CONF_PATH, DCL_PATH, LINTS_LIB_PATH, MSRVS_PATH, RUSTC_PASSES_PATH, SYM_PATH, generateAll, lintFilesOf, moduleFile, parseLintMethods, type GenerateResult, type Read } from "./clippy.ts";
import { lintDefault } from "./lints.ts";
import { Cursor, isComment, lex, strValue, type Tok } from "./lints.ts";

// set by main: `--work <dir>` or a new directory per run
let WORK = "";
let SCRATCH = "";

/** What 1 and 2 read from the oracle, for 3 (the emitted files). */
const ORACLE = {
  lints: new Map<string, Map<string, string>>(),
  infos: new Map<string, Map<string, string>>(),
  passes: new Map<string, { kind: "declare" | "impl"; lints: string[]; lint_vec?: string[] }>(),
  combined: new Map<string, [field: string, ty: string][]>(),
  symValues: [] as string[],
  symConsts: [] as [string, string][],
  msrvs: [] as [string, string][],
  groups: [] as [string, string[]][],
};

interface PTok {
  start: number;
  end: number;
  text: string;
  kind: string;
}

/** rustc_lexer tokens with byte offsets, whitespace and comments dropped. */
function ptoks(src: string): PTok[] {
  const s = Str.from(src);
  const out: PTok[] = [];
  let pos = 0;
  for (const tok of tokenize(s, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") out.push({ start: pos, end: pos + tok.len, text: s.slice(pos, pos + tok.len).toString(), kind: k });
    pos += tok.len;
  }
  return out;
}

function closeOf(t: PTok[], i: number): number {
  let depth = 0;
  for (let j = i; j < t.length; j++) {
    const x = t[j]!.text;
    if (x === "(" || x === "[" || x === "{") depth++;
    else if (x === ")" || x === "]" || x === "}") if (--depth === 0) return j;
  }
  throw new Error(`unclosed delimiter at ${t[i]!.start}`);
}

interface KeepSpec {
  macroRules: ReadonlySet<string>;
  invocations: ReadonlySet<string>;
  /** `mod x;` items (to reach the module files). */
  mods: boolean;
  /** `#![feature(..)]` crate attributes. */
  features: boolean;
  /** `extern crate x;` (with a preceding `#[macro_use]`) for these crates. */
  externs: ReadonlySet<string>;
}

/** The source with every byte outside the kept items replaced by a space (newlines kept). */
export function blank(src: string, spec: KeepSpec): string {
  const t = ptoks(src);
  const keep: [number, number][] = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i]!;
    if (x.text === "macro_rules" && t[i + 1]?.text === "!" && spec.macroRules.has(t[i + 2]?.text ?? "")) {
      const c = closeOf(t, i + 3);
      keep.push([x.start, t[c]!.end]);
      i = c;
      continue;
    }
    if (x.kind === "Ident" && t[i + 1]?.text === "!" && spec.invocations.has(x.text) && t[i - 1]?.text !== "macro_rules") {
      // include a `path::` prefix
      let s = i;
      while (t[s - 1]?.text === ":" && t[s - 2]?.text === ":" && t[s - 3]?.kind === "Ident") s -= 3;
      let c = closeOf(t, i + 2);
      if (t[c + 1]?.text === ";") c++;
      keep.push([t[s]!.start, t[c]!.end]);
      i = c;
      continue;
    }
    if (spec.features && x.text === "#" && t[i + 1]?.text === "!" && t[i + 2]?.text === "[" && t[i + 3]?.text === "feature") {
      const c = closeOf(t, i + 2);
      keep.push([x.start, t[c]!.end]);
      i = c;
      continue;
    }
    if (spec.mods && x.text === "mod" && t[i + 1]?.kind === "Ident" && t[i + 2]?.text === ";") {
      let s = i;
      if (t[s - 1]?.text === "pub") s--;
      else if (t[s - 1]?.text === ")" && t[s - 4]?.text === "pub") s -= 4;
      keep.push([t[s]!.start, t[i + 2]!.end]);
      i += 2;
      continue;
    }
    if (x.text === "extern" && t[i + 1]?.text === "crate" && spec.externs.has(t[i + 2]?.text ?? "") && t[i + 3]?.text === ";") {
      let s = i;
      if (t[s - 1]?.text === "]" && t[s - 2]?.text === "macro_use") s -= 4;
      keep.push([t[s]!.start, t[i + 3]!.end]);
      i += 3;
    }
  }
  const b = Buffer.from(src, "utf8");
  const out = Buffer.alloc(b.length, 0x20);
  for (let i = 0; i < b.length; i++) if (b[i] === 0x0a) out[i] = 0x0a;
  for (const [s, e] of keep) b.copy(out, s, s, e);
  return out.toString("utf8");
}

function put(rel: string, text: string): string {
  const p = join(SCRATCH, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

function rustc(args: string[], out: string): { ok: boolean; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...args], { cwd: SCRATCH, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  const stdout = r.stdout.toString();
  const stderr = r.stderr.toString();
  writeFileSync(join(WORK, `${out}.stdout`), stdout);
  writeFileSync(join(WORK, `${out}.stderr`), stderr);
  return { ok: r.exitCode === 0, stdout, stderr };
}

const LINT_MACROS = new Set(["declare_clippy_lint", "declare_lint_pass", "impl_lint_pass"]);

/** Builds the scratch tree and expands the four crates; returns the expanded texts. */
function expand(read: Read): Record<"lints" | "sym" | "msrvs" | "conf", string> {
  mkdirSync(SCRATCH, { recursive: true });
  const remap = `--remap-path-prefix=${SCRATCH}=/rustc/${PIN.commit}`;
  const base = ["--edition=2024", "--crate-type=lib", "-Awarnings", remap];
  // declare_clippy_lint: verbatim, to an rmeta
  const dcl = put(DCL_PATH, read(DCL_PATH));
  const r0 = rustc([...base, "--crate-name=declare_clippy_lint", "--emit=metadata", "-o", join(WORK, "libdeclare_clippy_lint.rmeta"), dcl], "dcl");
  if (!r0.ok) die(`declare_clippy_lint did not build (${join(WORK, "dcl.stderr")})`);
  // clippy_lints: lint macros in every module, the combined passes in lib.rs, combined_*_pass.rs verbatim
  for (const f of lintFilesOf()) {
    const src = read(f);
    if (f.endsWith("/combined_early_pass.rs") || f.endsWith("/combined_late_pass.rs")) {
      put(f, src);
      continue;
    }
    const isLib = f === LINTS_LIB_PATH;
    let text = blank(src, {
      macroRules: new Set(),
      invocations: isLib ? new Set(["early_lint_methods", "late_lint_methods"]) : LINT_MACROS,
      mods: true,
      features: isLib,
      externs: isLib ? new Set(["declare_clippy_lint", "rustc_lint"]) : new Set(),
    });
    // after the last line, so no line moves: the crate whose `#[macro_export]` lint-pass macros the modules import by `use`
    if (isLib) text += "\n#[macro_use] extern crate rustc_lint_defs;\n";
    put(f, text);
  }
  const r1 = rustc([...base, "--crate-name=clippy_lints", "-Zunpretty=expanded", `--extern=declare_clippy_lint=${join(WORK, "libdeclare_clippy_lint.rmeta")}`, join(SCRATCH, LINTS_LIB_PATH)], "lints");
  // sym.rs, msrvs.rs, conf.rs: each its own crate root (their lines do not matter)
  const one = (path: string, name: string, macroRules: string[], invs: string[], prefix: string, out: string): string => {
    const text = prefix + blank(read(path), { macroRules: new Set(macroRules), invocations: new Set(invs), mods: false, features: false, externs: new Set() });
    const p = put(path, text);
    return rustc([...base, `--crate-name=${name}`, "-Zunpretty=expanded", p], out).stdout;
  };
  const sym = one(SYM_PATH, "sym", ["val", "generate"], ["generate"], "#![feature(rustc_private, macro_metavar_expr)] extern crate rustc_span; use rustc_span::symbol::PREDEFINED_SYMBOLS_COUNT;", "sym");
  const msrvs = one(MSRVS_PATH, "msrvs", ["msrv_aliases"], ["msrv_aliases"], "", "msrvs");
  const conf = one(CONF_PATH, "conf", ["first_expr", "filtered_names", "define_Conf"], ["define_Conf"], "", "conf");
  return { lints: r1.stdout, sym, msrvs, conf };
}

// ---- reading the expanded output -------------------------------------------------------------------------------

/** Non-comment tokens of an expanded crate, each with the module path it is in (`mod x { .. }` nesting). */
function modTokens(src: string): { toks: Tok[]; mods: string[][] } {
  const toks = lex(src).filter((t) => !isComment(t) && t.doc === undefined);
  const mods: string[][] = [];
  const stack: { name: string; depth: number }[] = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    mods.push(stack.map((x) => x.name));
    if (t.text === "{" || t.text === "(" || t.text === "[") {
      if (t.text === "{" && toks[i - 2]?.text === "mod" && toks[i - 1]?.kind.$ === "Ident") stack.push({ name: toks[i - 1]!.text, depth });
      depth++;
    } else if (t.text === "}" || t.text === ")" || t.text === "]") {
      depth--;
      if (t.text === "}" && stack.length && stack[stack.length - 1]!.depth === depth) stack.pop();
    }
  }
  return { toks, mods };
}

const txt = (toks: Tok[]): string => toks.map((t) => t.text).join(" ");

/** A Rust value in an expanded static, in the generator's TS notation. */
function value(toks: Tok[]): string {
  const t = toks.filter((x) => x.text !== "&");
  if (t.length === 1 && t[0]!.kind.$ === "Literal" && /^r?#*"/.test(t[0]!.text)) return JSON.stringify(strValue("expanded", t[0]!));
  if (t.length === 1 && (t[0]!.text === "true" || t[0]!.text === "false")) return t[0]!.text;
  if (t.length === 1 && t[0]!.text === "None") return "undefined";
  // `::rustc_lint_defs::Allow`, `::declare_clippy_lint::LintCategory::Style`
  if (t.every((x) => x.kind.$ === "Ident" || x.text === ":")) return JSON.stringify(t[t.length - 1]!.text);
  return `<${txt(toks)}>`;
}

/** `Name { f: v, .. }` struct-literal fields from the token after `{`. */
function structFields(toks: Tok[], open: number): Map<string, string> {
  const c = new Cursor("expanded", toks);
  c.i = open + 1;
  const g = c.group(toks[open]!);
  const out = new Map<string, string>();
  while (!g.atEnd()) {
    if (g.peek()!.text === ".") break; // `..Default::default_fields_for_macro()`
    const f = g.ident();
    g.expect(":");
    out.set(f.text, value(g.exprUntilComma()));
    g.eat(",");
  }
  return out;
}

class Report {
  checked = 0;
  errors: string[] = [];
  eq(what: string, got: unknown, want: unknown): void {
    this.checked++;
    const a = JSON.stringify(got) ?? "undefined";
    const b = JSON.stringify(want) ?? "undefined";
    if (a === b) return;
    if (Array.isArray(got) && Array.isArray(want)) {
      const i = got.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(want[k]));
      const at = i < 0 ? Math.min(got.length, want.length) : i;
      this.errors.push(`${what}: [${at}] oracle ${(JSON.stringify(got[at]) ?? "undefined").slice(0, 300)} generator ${(JSON.stringify(want[at]) ?? "undefined").slice(0, 300)} (lengths ${got.length}, ${want.length})`);
      return;
    }
    this.errors.push(`${what}: oracle ${a.slice(0, 300)} generator ${b.slice(0, 300)}`);
  }
}

// ---- 1a. lints: statics, _INFO, lint passes ---------------------------------------------------------------------

function checkLints(r: Report, expanded: string, g: GenerateResult, files: ReadonlySet<string>): string {
  const { toks, mods } = modTokens(expanded);
  const lints = new Map<string, Map<string, string>>();
  const infos = new Map<string, Map<string, string>>();
  const passes = new Map<string, { kind: "declare" | "impl"; lints: string[]; lint_vec?: string[] }>();
  const unitStructs = new Set<string>();
  const listOf = (from: number, to: number): string[] => {
    // the last `[ .. ]` group in toks[from..to)
    let close = -1;
    for (let j = to - 1; j > from; j--) if (toks[j]!.text === "]") { close = j; break; }
    if (close < 0) return []; // `vec![]` expands to `Vec::new()`
    let open = close;
    while (toks[open]!.text !== "[") open--;
    if (toks[open - 1]?.text === "#") return []; // `#[allow(unused)]` on `lint_vec`: the list is `Vec::new()`
    return toks.slice(open + 1, close).filter((x) => x.text !== ",").map((x) => x.text);
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const file = (): string => moduleFile(mods[i]!, files);
    if (t.text === "static" && toks[i + 2]?.text === ":") {
      const name = toks[i + 1]!.text;
      const eq = toks.findIndex((x, k) => k > i && x.text === "=");
      const open = toks.findIndex((x, k) => k > eq && x.text === "{");
      const head = txt(toks.slice(eq + 1, open)).replaceAll(" ", "");
      if (head === "&::rustc_lint_defs::Lint") lints.set(name, structFields(toks, open));
      else if (head === "&::declare_clippy_lint::LintInfo") infos.set(name, structFields(toks, open));
    }
    if (t.text === "struct" && toks[i - 1]?.text === "pub" && toks[i + 2]?.text === ";") unitStructs.add(`${file()}#${toks[i + 1]!.text}`);
    if (t.text === "impl" && txt(toks.slice(i + 1, i + 7)).replaceAll(" ", "") === "::rustc_lint_defs::LintPass" && toks[i + 7]?.text === "for") {
      const ty = toks[i + 8]!.text;
      const open = toks.findIndex((x, k) => k > i && x.text === "{");
      const c = new Cursor("expanded", toks);
      c.i = open + 1;
      c.group(toks[open]!);
      const key = `${file()}#${ty}`;
      passes.set(key, { kind: "impl", lints: listOf(open, c.i) });
      // `impl Ty { pub fn lint_vec() -> LintVec { .. } }` right after
      if (toks[c.i]?.text === "impl" && toks[c.i + 1]?.text === ty) {
        const o2 = toks.findIndex((x, k) => k > c.i && x.text === "{");
        const c2 = new Cursor("expanded", toks);
        c2.i = o2 + 1;
        c2.group(toks[o2]!);
        passes.get(key)!.lint_vec = listOf(o2, c2.i);
      }
    }
  }
  for (const [k, p] of passes) if (unitStructs.has(k)) p.kind = "declare";
  ORACLE.lints = lints;
  ORACLE.infos = infos;
  ORACLE.passes = passes;
  // compare
  let n = 0;
  for (const m of g.mods) {
    for (const l of m.lints) {
      n++;
      const name = l.decl.name;
      const o = lints.get(name);
      if (o === undefined) {
        r.errors.push(`lint ${name}: not in the oracle expansion`);
        continue;
      }
      // explicit fields equal; the rest come from `default_fields_for_macro` on both sides
      r.eq(`lint ${name} fields`, Object.fromEntries([...o].sort()), Object.fromEntries([...l.decl.fields].sort()));
      const info = infos.get(`${name}_INFO`);
      r.eq(`lint ${name}_INFO`, info === undefined ? undefined : Object.fromEntries(info), {
        lint: JSON.stringify(name),
        category: JSON.stringify(l.category),
        explanation: JSON.stringify(l.docLines.map((d) => `${d}\n`).join("")),
        location: JSON.stringify(`/rustc/${PIN.commit}/${m.path}#L${l.invocationLine}`),
        version: JSON.stringify(l.version),
      });
    }
    for (const p of m.passes) {
      const o = passes.get(`${m.path}#${p.name}`);
      r.eq(`pass ${m.path}#${p.name}`, o, { kind: p.kind, lints: p.lints, lint_vec: p.lints });
    }
  }
  r.eq("lint statics count", lints.size, n);
  r.eq("lint pass impls count", passes.size, g.mods.reduce((a, m) => a + m.passes.length, 0));
  return `${lints.size} lint statics, ${infos.size} _INFO, ${passes.size} lint passes`;
}

// ---- 1b. the combined passes ------------------------------------------------------------------------------------

/**
 * The TS a combined-pass constructor should be, written independently of clippy.ts's `ctorTs`/`modNs` so that a slip there
 * is caught (review N2): `a::b::T::new(x, y.clone())` -> `mod_a_b.T.new(x, y)`, `a::T` -> `new mod_a.T()`,
 * `a::T::default()` / `<a::T>::default()` / `<a::T<'_>>::default()` -> `mod_a.T.default()`. The storages' `.clone()` is
 * the shared value (both are `Arc` newtypes).
 */
function oracleCtorTs(rust: string): string {
  const ns = (path: string): string => {
    const segs = path.replace(/<'[\w_]+>$/, "").split("::");
    return `mod_${segs.slice(0, -1).join("_")}.${segs[segs.length - 1]}`;
  };
  let m = /^<(.+)>::default\(\)$/.exec(rust);
  if (m !== null) return `${ns(m[1]!)}.default()`;
  m = /^(.+)::default\(\)$/.exec(rust);
  if (m !== null) return `${ns(m[1]!)}.default()`;
  m = /^(.+)::new\((.*)\)$/.exec(rust);
  if (m !== null) return `${ns(m[1]!)}.new(${m[2]!.split(",").filter((a) => a !== "").map((a) => a.replace(/\.clone\(\)$/, "")).join(", ")})`;
  if (/^\w+(::\w+)*$/.test(rust)) return `new ${ns(rust)}()`;
  return `<unknown constructor ${rust}>`;
}

function checkCombined(r: Report, expanded: string, g: GenerateResult, read: Read): string {
  const toks = lex(expanded).filter((t) => !isComment(t) && t.doc === undefined);
  const out: string[] = [];
  for (const c of g.combined) {
    const si = toks.findIndex((t, k) => t.text === "struct" && toks[k + 1]?.text === c.name);
    const so = toks.findIndex((t, k) => k > si && t.text === "{");
    const sc = new Cursor("expanded", toks);
    sc.i = so + 1;
    const sg = sc.group(toks[so]!);
    const fields: [string, string][] = [];
    while (!sg.atEnd()) {
      const f = sg.ident();
      sg.expect(":");
      fields.push([f.text, txt(sg.exprUntilComma()).replaceAll(" ", "")]);
      sg.eat(",");
    }
    const unwrap = (ty: string): string => (c.kind === "late" ? ty.replace(/^Option<(.*)>$/, "$1") : ty);
    r.eq(`${c.name} fields`, fields.map(([f, t]) => [f, unwrap(t)]), c.entries.map((e) => [e.field, e.ty]));
    ORACLE.combined.set(c.kind, fields.map(([f, t]) => [f, unwrap(t)]));
    // new: `pub fn new(params) -> Self { Self { field: ctor, .. } }`
    const ni = toks.findIndex((t, k) => k > sc.i && t.text === "fn" && toks[k + 1]?.text === "new");
    // past `<F: Fn(&rustc_lint::LintVec) -> bool>` (late); a `>` after `-` is part of `->`
    let po = ni + 2;
    if (toks[po]!.text === "<") {
      for (let d = 0; ; po++) {
        if (toks[po]!.text === "<") d++;
        else if (toks[po]!.text === ">" && toks[po - 1]!.text !== "-") d--;
        if (d === 0) break;
      }
      po++;
    }
    const pc = new Cursor("expanded", toks);
    pc.i = po + 1;
    const pg = pc.group(toks[po]!);
    const params: string[] = [];
    while (!pg.atEnd()) {
      const p = pg.ident();
      pg.expect(":");
      params.push(`${p.text}: ${txt(pg.exprUntilComma()).replace(/ :: /g, "::").replace(/: :/g, "::").replace(/ :: /g, "::").replace(/& /g, "&").replace(/ < /g, "<").replace(/ >/g, ">")}`);
      pg.eat(",");
    }
    const want = c.params.map((p) => `${p.name}: ${p.ty}`);
    if (c.kind === "late") want.push("is_active: &F");
    r.eq(`${c.name}::new params`, params, want);
    const bo = toks.findIndex((t, k) => k > pc.i && t.text === "Self" && toks[k + 1]?.text === "{" && toks[k - 1]?.text === "{");
    const bc = new Cursor("expanded", toks);
    bc.i = bo + 2;
    const bg = bc.group(toks[bo + 1]!);
    const ctors: [string, string][] = [];
    const ctorToks: Tok[][] = [];
    while (!bg.atEnd()) {
      const f = bg.ident();
      bg.expect(":");
      const e = bg.exprUntilComma();
      ctorToks.push(e);
      ctors.push([f.text, txt(e).replaceAll(" ", "")]);
      bg.eat(",");
    }
    const wantCtor = (e: (typeof c.entries)[number]): string => {
      const ct = e.ctor.map((t) => t.text).join("").replaceAll(",)", ")"); // the printer drops a trailing comma
      return c.kind === "early" ? ct : `is_active(&<${e.ty}>::lint_vec()).then(||${ct})`;
    };
    r.eq(`${c.name}::new body`, ctors, c.entries.map((e) => [e.field, wantCtor(e)]));
    // get_lints: `lints.extend(<T>::lint_vec());` per field
    const gi = toks.findIndex((t, k) => k > bc.i && t.text === "fn" && toks[k + 1]?.text === "get_lints");
    const ext: string[] = [];
    for (let k = gi; toks[k]!.text !== "fn" || k === gi; k++) {
      if (toks[k]!.text === "extend" && toks[k + 2]?.text === "<") {
        let j = k + 3;
        let s = "";
        let d = 1;
        for (; d > 0; j++) {
          if (toks[j]!.text === "<") d++;
          if (toks[j]!.text === ">") d--;
          if (d > 0) s += toks[j]!.text;
        }
        ext.push(s);
      }
    }
    r.eq(`${c.name}::get_lints`, ext, c.entries.map((e) => e.ty));
    // the check_* methods: names, parameters, and the field calls in order
    const ii = toks.findIndex((t, k) => k > gi && t.text === "impl" && toks.slice(k, k + 12).some((x) => x.text === (c.kind === "early" ? "EarlyLintPass" : "LateLintPass")) && toks.slice(k, k + 14).some((x) => x.text === c.name));
    const io = toks.findIndex((t, k) => k > ii && t.text === "{");
    const ic = new Cursor("expanded", toks);
    ic.i = io + 1;
    const ig = ic.group(toks[io]!);
    const methods: { name: string; params: string[]; calls: string[] }[] = [];
    // each call as [field, called trait method, arguments after the pass]
    const oracleCalls: [string, string, string[]][][] = [];
    while (!ig.atEnd()) {
      const t = ig.next();
      if (t.text !== "fn") continue;
      const name = ig.ident().text;
      const ps = ig.group(ig.expect("("));
      const params: string[] = [];
      let first = true;
      while (!ps.atEnd()) {
        const toksP = ps.exprUntilComma();
        ps.eat(",");
        if (toksP[0]?.text === "&" && toksP[1]?.text === "mut") continue; // &mut self
        if (first) {
          first = false;
          continue; // cx
        }
        params.push(toksP[0]!.text);
      }
      const body = ig.group(ig.expect("{"));
      const calls: string[] = [];
      const exact: [string, string, string[]][] = [];
      let field = "";
      for (let k = body.i; k < body.end; k++) {
        // early: `EarlyLintPass :: check_x ( & mut self . FIELD ,`; late: `if let Some ( pass ) = & mut self . FIELD`
        if (toks[k]!.text === "self" && toks[k + 1]?.text === "." && toks[k - 1]?.text === "mut") calls.push((field = toks[k + 2]!.text));
        // `rustc_lint :: {Early,Late}LintPass :: NAME ( <pass> , args.. )`
        if ((toks[k]!.text === "EarlyLintPass" || toks[k]!.text === "LateLintPass") && toks[k + 1]?.text === ":" && toks[k + 2]?.text === ":") {
          const ac = new Cursor("expanded", toks);
          ac.i = k + 5;
          const ag = ac.group(toks[k + 4]!);
          const args: string[] = [];
          while (!ag.atEnd()) {
            args.push(txt(ag.exprUntilComma()));
            ag.eat(",");
          }
          // early: the pass is the first argument (`&mut self.FIELD`); late: `pass`, bound from `self.FIELD` just before
          const first = args[0]!.split(" ");
          exact.push([first[0] === "&" ? first[first.length - 1]! : field, toks[k + 3]!.text, args.slice(1)]);
        }
      }
      methods.push({ name, params, calls });
      oracleCalls.push(exact);
    }
    const lm = parseLintMethods(read(RUSTC_PASSES_PATH), c.kind === "early" ? "early_lint_methods" : "late_lint_methods");
    r.eq(`${c.name} methods`, methods, lm.map((m) => ({ name: m.name, params: m.params, calls: c.entries.map((e) => e.field) })));
    // the generated TS (written or pending) has the same methods, each calling every field in order
    const ts = g.outputs.find((o) => o.path.endsWith("clippy_lints/lib.gen.ts"))!.text;
    const cls = ts.slice(ts.indexOf(`export class ${c.name} `));
    const clsEnd = cls.indexOf("\n}\n");
    const body = cls.slice(0, clsEnd);
    const tsMethods = [...body.matchAll(/^  (check_\w+)\(cx: \w+(?:, (.*))?\): void \{\n((?:    .*\n)*)  \}/gm)].map((m) => ({
      name: m[1]!,
      params: m[2] === undefined ? [] : m[2].split(", ").map((x) => x.split(":")[0]!),
      calls: [...m[3]!.matchAll(/_provided\.\w+\(this\.(\w+),/g)].map((x) => x[1]!),
      lines: m[3]!.split("\n").filter((l) => l !== ""),
    }));
    r.eq(`${c.name} TS methods`, tsMethods.map(({ lines: _, ...m }) => m), methods);
    // review N2: every TS call line rebuilt from the oracle's call (trait method, field, guard, arguments)
    const Pass = c.kind === "early" ? "EarlyLintPass" : "LateLintPass";
    const wantLines = methods.map((m, i) =>
      oracleCalls[i]!.map(([f, called, args]) => {
        const call = `${Pass}_provided.${called}(this.${f}, ${args.join(", ")});`;
        return c.kind === "early" ? `    ${call}` : `    if (this.${f} !== undefined) ${call}`;
      }),
    );
    r.eq(`${c.name} TS call lines`, wantLines, tsMethods.map((m) => m.lines)); // (oracle-derived, emitted)
    // review N2: each field's TS constructor (and late `is_active` guard) rebuilt from the oracle's `Self { .. }`
    const wantNew = fields.map((_, i) => {
      let ctor = txt(ctorToks[i]!).replaceAll(" ", "");
      if (c.kind === "early") return `      ${oracleCtorTs(ctor)},`;
      // `is_active(&<T>::lint_vec()).then(||CTOR)`
      const m = /^is_active\(&<(.+)>::lint_vec\(\)\)\.then\(\|\|(.*)\)$/.exec(ctor);
      if (m === null) return `<unexpected late field ${ctor}>`;
      ctor = m[2]!;
      const guard = oracleCtorTs(m[1]!.replace(/<'\w+>$/, "")).replace(/^new (.*)\(\)$/, "$1"); // the type path, lifetimes erased
      return `      is_active(${guard}.lint_vec()) ? ${oracleCtorTs(ctor)} : undefined,`;
    });
    const newAt = body.indexOf("  static new(");
    const newBody = body.slice(body.indexOf("\n", body.indexOf(`return new ${c.name}(`, newAt)) + 1, body.indexOf("\n    );", newAt)).split("\n");
    r.eq(`${c.name} TS new`, wantNew, newBody); // (oracle-derived, emitted)
    out.push(`${c.name} ${fields.length} fields, ${methods.length} methods`);
  }
  return out.join("; ");
}

// ---- 1c. sym, msrvs, conf ---------------------------------------------------------------------------------------

function checkSym(r: Report, expanded: string, g: GenerateResult): string {
  const toks = lex(expanded).filter((t) => !isComment(t) && t.doc === undefined);
  // the macro_rules bodies are printed too, before their expansion: take the last match
  const ei = toks.findLastIndex((t) => t.text === "EXTRA_SYMBOLS");
  const eo = toks.findIndex((t, k) => k > ei && t.text === "[" && toks[k - 1]?.text === "&" && toks[k - 2]?.text === "=");
  const ec = new Cursor("expanded", toks);
  ec.i = eo + 1;
  const eg = ec.group(toks[eo]!);
  const values: string[] = [];
  while (!eg.atEnd()) {
    values.push(strValue("expanded", eg.next()));
    eg.eat(",");
  }
  r.eq("EXTRA_SYMBOLS", values, g.sym.map((e) => e.value));
  ORACLE.symValues = values;
  const consts: [string, string][] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.text === "const" && txt(toks.slice(i + 2, i + 8)).replaceAll(" ", "") === ":rustc_span::Symbol=") {
      const end = toks.findIndex((t, k) => k > i && t.text === ";");
      consts.push([toks[i + 1]!.text, txt(toks.slice(i + 8, end)).replaceAll(" ", "")]);
    }
  }
  ORACLE.symConsts = consts;
  r.eq("sym consts", consts, g.sym.map((e, i) => [e.name, `rustc_span::Symbol::new(PREDEFINED_SYMBOLS_COUNT+${i})`]));
  return `${values.length} extra symbols`;
}

function checkMsrvs(r: Report, expanded: string, g: GenerateResult): string {
  const toks = lex(expanded).filter((t) => !isComment(t) && t.doc === undefined);
  const out: [string, string][] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.text === "const" && toks[i + 2]?.text === ":" && toks[i + 3]?.text === "RustcVersion") {
      const end = toks.findIndex((t, k) => k > i && t.text === ";");
      out.push([toks[i + 1]!.text, txt(toks.slice(i + 5, end)).replaceAll(" ", "").replace(",}", "}")]);
    }
  }
  ORACLE.msrvs = out;
  r.eq("msrv aliases", out, g.msrvs.map((a) => [a.name, `RustcVersion{major:${a.version[0]},minor:${a.version[1]},patch:${a.version[2]}}`]));
  return `${out.length} msrv aliases`;
}

function checkConf(r: Report, expanded: string, g: GenerateResult): string {
  const toks = lex(expanded).filter((t) => !isComment(t) && t.doc === undefined);
  const group = (i: number): Tok[] => {
    const c = new Cursor("expanded", toks);
    c.i = i + 1;
    const gg = c.group(toks[i]!);
    return toks.slice(gg.i, gg.end);
  };
  // the macro_rules bodies are printed too, before their expansion: take the last match
  const ei = toks.findLastIndex((t, k) => t.text === "enum" && toks[k + 1]?.text === "ConfField");
  const variants = group(ei + 2).filter((t) => t.text !== ",").map((t) => t.text);
  r.eq("ConfField variants", variants, [...g.conf.map((e) => e.name), "ThirdParty"]);
  const arr = (name: string): string[] => {
    const i = toks.findLastIndex((t, k) => t.text === name && toks[k - 1]?.text === "const");
    const o = toks.findIndex((t, k) => k > i && t.text === "[" && toks[k - 1]?.text === "&" && toks[k - 2]?.text === "=");
    return group(o).filter((t) => t.text !== ",").map((t) => (t.kind.$ === "Literal" ? strValue("expanded", t) : t.text)).filter((x) => x !== "Self" && x !== ":");
  };
  r.eq("ConfField::NAMES", arr("NAMES"), [...g.conf.map((e) => e.name_str), "third-party"]);
  r.eq("ConfField::FIELDS", arr("FIELDS"), [...g.conf.map((e) => e.rename ?? e.name), "ThirdParty"]);
  r.eq("ConfField::SUGG_NAMES", arr("SUGG_NAMES"), [...g.conf.filter((e) => e.rename === undefined).map((e) => e.name_str), "third-party"]);
  // parse: `match s { "x" => Some(Self::x), .. "third-party" => Some(Self::ThirdParty), _ => None, }`
  const mi = toks.findLastIndex((t, k) => t.text === "match" && toks[k + 1]?.text === "s");
  const arms: [string, string][] = [];
  const m = group(mi + 2);
  for (let k = 0; k < m.length; k++) if (m[k]!.kind.$ === "Literal" && m[k + 1]?.text === "=") arms.push([strValue("expanded", m[k]!), m[k + 8]!.text]); // `"x" => Some(Self::x)`
  r.eq("ConfField::parse", arms, [...g.conf.map((e): [string, string] => [e.name_str, e.name]), ["third-party", "ThirdParty"]]);
  // the generated TS uses the same tables
  const ts = g.outputs.find((o) => o.path === "src/clippy_config/conf.gen.ts")!.text;
  const line = (k: string): string => ts.split("\n").find((l) => l.startsWith(`  ${k}: [`))!;
  r.eq("conf.gen.ts NAMES", JSON.parse(line("NAMES").replace(/^  NAMES: /, "").replace(/ as readonly string\[\],$/, "")), arr("NAMES"));
  r.eq("conf.gen.ts FIELDS", JSON.parse(line("FIELDS").replace(/^  FIELDS: /, "").replace(/ as readonly ConfField\[\],$/, "")), arr("FIELDS"));
  r.eq("conf.gen.ts SUGG_NAMES", JSON.parse(line("SUGG_NAMES").replace(/^  SUGG_NAMES: /, "").replace(/ as readonly string\[\],$/, "")), arr("SUGG_NAMES"));
  return `${variants.length} ConfField variants`;
}

// ---- 2. clippy-driver -W help ------------------------------------------------------------------------------------

function clippyDriver(): string {
  const host = process.env.RUST_TS_HOST_TUPLE ?? "aarch64-apple-darwin";
  const root = join(DATA, "tools");
  for (const d of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, d, `clippy-nightly-${host}`);
    const bin = join(dir, "clippy-preview", "bin", "clippy-driver");
    if (existsSync(bin) && readFileSync(join(dir, "git-commit-hash"), "utf8").trim() === PIN.commit) return bin;
  }
  die(`no clippy-preview for ${PIN.commit} under ${root}`);
}

function checkWHelp(r: Report, g: GenerateResult): string {
  const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } }).stdout.toString().trim();
  const p = Bun.spawnSync([clippyDriver(), "--sysroot", sysroot, "-W", "help"], { env: { ...process.env, DYLD_LIBRARY_PATH: join(sysroot, "lib") }, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString();
  writeFileSync(join(WORK, "whelp.txt"), out);
  const lines = out.split("\n");
  const at = (h: string): number => lines.findIndex((l) => l === h);
  // lints: `<name>  <level>  <desc>` under "Lint checks loaded by this crate:"
  const lintRows = new Map<string, [string, string]>();
  for (let i = at("Lint checks loaded by this crate:") + 4; i < lines.length && lines[i]!.trim() !== ""; i++) {
    const m = /^\s*(\S+)  (\w+) {2,}(.*)$/.exec(lines[i]!);
    if (m === null) r.errors.push(`-W help: unparsed lint row ${JSON.stringify(lines[i])}`);
    else lintRows.set(m[1]!, [m[2]!, m[3]!]);
  }
  const want = new Map<string, [string, string]>();
  for (const m of g.mods) {
    for (const l of m.lints) {
      const name = (JSON.parse(l.decl.fields.get("name")!) as string).toLowerCase().replaceAll("_", "-");
      want.set(name, [(JSON.parse(l.decl.fields.get("default_level")!) as string).toLowerCase(), JSON.parse(l.decl.fields.get("desc")!) as string]);
    }
  }
  r.eq("-W help lints", Object.fromEntries([...lintRows].sort()), Object.fromEntries([...want].sort()));
  // groups: `<name>  <member>, <member>, ..` under "Lint groups loaded by this crate:"
  const groups: [string, string[]][] = [];
  for (let i = at("Lint groups loaded by this crate:") + 4; i < lines.length && lines[i]!.trim() !== ""; i++) {
    const m = /^\s*(\S+)  (.*)$/.exec(lines[i]!);
    if (m === null) r.errors.push(`-W help: unparsed group row ${JSON.stringify(lines[i])}`);
    else groups.push([m[1]!, m[2]!.split(", ")]);
  }
  ORACLE.groups = groups;
  const wantGroups = g.tables.groups.map(([n, ms]): [string, string[]] => [n, ms.map((x) => x.replaceAll("_", "-"))]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  r.eq("-W help groups", groups, wantGroups);
  return `${lintRows.size} lints, ${groups.length} groups`;
}

// ---- 3. the emitted files, against what 1 and 2 read from the oracle (review N3) ---------------------------------

async function checkEmitted(r: Report, g: GenerateResult): Promise<string> {
  const ts = (v: unknown): string => (v === undefined ? "undefined" : JSON.stringify(v));
  const id = (l: { name: string }): string => l.name.slice("clippy::".length);
  type Any = Record<string, any>; // PORT: the emitted modules' exports, read generically
  let nLints = 0;
  let nPasses = 0;
  for (const m of g.mods) {
    const mod = (await import(join(REPO, m.out))) as Any;
    for (const l of m.lints) {
      nLints++;
      const name = l.decl.name;
      const obj = mod[name] as Any | undefined;
      const o = ORACLE.lints.get(name);
      if (obj === undefined || o === undefined) {
        r.errors.push(`emitted ${m.out}: ${name} missing (or not in the oracle)`);
        continue;
      }
      // explicit fields as the oracle expanded them; the others as `default_fields_for_macro`
      r.eq(`emitted ${name}`, Object.fromEntries(Object.keys(obj).sort().map((f) => [f, ts(obj[f])])), Object.fromEntries(Object.keys(obj).sort().map((f) => [f, o.get(f) ?? lintDefault(f)])));
      r.eq(`emitted ${name} field set`, [...o.keys()].every((f) => Object.hasOwn(obj, f)), true);
      const info = mod[`${name}_INFO`] as Any | undefined;
      r.eq(
        `emitted ${name}_INFO`,
        info === undefined ? undefined : { lint: info.lint === obj ? JSON.stringify(name) : "<another object>", category: ts(info.category), explanation: ts(info.explanation), location: ts(info.location), version: ts(info.version) },
        ORACLE.infos.has(`${name}_INFO`) ? Object.fromEntries(ORACLE.infos.get(`${name}_INFO`)!) : undefined,
      );
    }
    for (const p of m.passes) {
      nPasses++;
      const o = ORACLE.passes.get(`${m.path}#${p.name}`);
      const imp = mod[`${p.name}_impl_lint_pass`] as Any | undefined;
      const cls = mod[p.name] as (new () => Any) & Any;
      const got =
        imp !== undefined
          ? { kind: "impl", name: imp.name(), lints: imp.get_lints().map(id), lint_vec: imp.lint_vec().map(id) }
          : typeof cls === "function"
            ? { kind: "declare", name: new cls().name(), lints: new cls().get_lints().map(id), lint_vec: cls.lint_vec().map(id) }
            : undefined;
      r.eq(`emitted pass ${m.path}#${p.name}`, got, o === undefined ? undefined : { kind: o.kind, name: p.name, lints: o.lints, lint_vec: o.lint_vec });
    }
  }
  // sym.gen.ts
  const sym = (await import(join(REPO, "src/clippy_utils/sym.gen.ts"))) as Any;
  const { PREDEFINED_SYMBOLS_COUNT } = await import("../../src/rustc_span/symbol.gen.ts");
  r.eq("emitted EXTRA_SYMBOLS", sym.EXTRA_SYMBOLS, ORACLE.symValues);
  r.eq(
    "emitted sym consts",
    ORACLE.symConsts.map(([n]) => [n, (sym[n] as number) - PREDEFINED_SYMBOLS_COUNT, sym.sym[n] === sym[n]]),
    ORACLE.symConsts.map(([n, v]) => [n, Number(/PREDEFINED_SYMBOLS_COUNT\+(\d+)\)$/.exec(v)![1]), true]),
  );
  // msrvs.gen.ts
  const msrvs = (await import(join(REPO, "src/clippy_utils/msrvs.gen.ts"))) as Any;
  r.eq("emitted msrvs", ORACLE.msrvs.map(([n]) => [n, msrvs[n] === undefined ? "missing" : `RustcVersion{major:${msrvs[n].major},minor:${msrvs[n].minor},patch:${msrvs[n].patch}}`]), ORACLE.msrvs);
  // lint_tables.gen.ts as written
  const tables = (await import(join(REPO, "src/clippy_lints/lint_tables.gen.ts"))) as Any;
  const groups = [...(tables.LINT_GROUPS as Map<string, string[]>)].map(([n, ms]): [string, string[]] => [n, ms.map((x) => x.replaceAll("_", "-"))]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  r.eq("emitted LINT_GROUPS vs -W help", groups, ORACLE.groups);
  const rows = tables.SUB_PASSES as { kind: string; field: string; ty: string; declared_in: string; lints: string[] }[];
  for (const kind of ["early", "late"]) {
    const strip = (t: string): string => t.replace(/<[^<>]*>$/, "");
    r.eq(`emitted SUB_PASSES ${kind}`, rows.filter((x) => x.kind === kind).map((x) => [x.field, x.ty]), ORACLE.combined.get(kind)!.map(([f, t]) => [f, strip(t)]));
  }
  for (const x of rows) {
    const o = ORACLE.passes.get(`${x.declared_in}#${x.ty.split("::").pop()}`);
    r.eq(`emitted SUB_PASSES ${x.kind} ${x.field} lints`, x.lints, o === undefined ? undefined : o.lints.map((l) => `clippy::${l.toLowerCase()}`));
  }
  return `${nLints} lint statics, ${nPasses} lint passes, ${ORACLE.symValues.length} symbols, ${ORACLE.msrvs.length} msrvs, ${rows.length} sub-pass rows, ${groups.length} groups`;
}

// ---- 4. type-check the pending lib.gen.ts against stub hand modules ---------------------------------------------

function checkPendingTsc(r: Report, g: GenerateResult): string {
  const root = join(WORK, "tsc");
  const lib = g.outputs.find((o) => o.path.endsWith("clippy_lints/lib.gen.ts"))!;
  const missing = lib.needs.filter((n) => !existsSync(join(REPO, n)));
  // src/: the repo's crates symlinked, the clippy crates as real directories with the generated files linked in
  const own = new Set(["clippy_lints", "clippy_utils", "clippy_config"]);
  mkdirSync(join(root, "src"), { recursive: true });
  for (const e of readdirSync(join(REPO, "src"))) if (!own.has(e)) symlinkSync(join(REPO, "src", e), join(root, "src", e));
  const link = (rel: string): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    if (!existsSync(join(root, rel))) symlinkSync(join(REPO, rel), join(root, rel));
  };
  const walk = (d: string): void => {
    if (!existsSync(join(REPO, d))) return;
    for (const e of readdirSync(join(REPO, d), { withFileTypes: true })) (e.isDirectory() ? walk : link)(`${d}/${e.name}`);
  };
  for (const c of own) walk(`src/${c}`);
  // stubs: per missing module, the names lib.gen.ts takes from it
  const names = new Map<string, Set<string>>();
  for (const m of lib.text.matchAll(/^import (type )?\{ ([^}]+) \} from "(\.[^"]+)";$/gm)) {
    const f = join("src/clippy_lints", m[3]!).replaceAll("\\", "/");
    names.set(f, new Set([...(names.get(f) ?? []), ...m[2]!.split(", ").map((x) => `type:${x}`)]));
  }
  for (const m of lib.text.matchAll(/^import \* as (\w+) from "(\.[^"]+)";$/gm)) {
    const f = join("src/clippy_lints", m[2]!).replaceAll("\\", "/");
    const used = new Set([...lib.text.matchAll(new RegExp(`\\b${m[1]}\\.(\\w+)`, "g"))].map((x) => `class:${x[1]}`));
    names.set(f, new Set([...(names.get(f) ?? []), ...used]));
  }
  for (const f of missing) {
    const L = [`// stub for the tsc check of the pending lib.gen.ts (tools/codegen/clippy-oracle.ts)`, `import type { LintVec } from "${relative(dirname(join(root, f)), join(root, "src/rustc_lint_defs/lib.ts")).replaceAll("\\", "/")}";`];
    for (const n of names.get(f) ?? []) {
      const [kind, name] = n.split(":") as [string, string];
      if (kind === "type") L.push(`export type ${name} = { readonly __stub: "${name}" };`);
      else L.push(`export class ${name} {`, `  static new(..._: unknown[]): ${name} { return new ${name}(); }`, `  static default(): ${name} { return new ${name}(); }`, `  static lint_vec(): LintVec { return []; }`, `  name(): string { return "${name}"; }`, `  get_lints(): LintVec { return []; }`, `}`);
    }
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), L.join("\n") + "\n");
  }
  writeFileSync(join(root, lib.path), lib.text);
  const base = JSON.parse(readFileSync(join(REPO, "tsconfig.json"), "utf8"));
  base.include = [lib.path];
  base.compilerOptions.typeRoots = [join(REPO, "node_modules", "@types")];
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(base, null, 2));
  const p = Bun.spawnSync(["bunx", "tsc", "-p", join(root, "tsconfig.json")], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString() + p.stderr.toString();
  writeFileSync(join(WORK, "tsc.txt"), out);
  // only the clippy files: the repo's own files are checked without their crates' extension modules here (tsc of lib.gen.ts
  // alone does not load the `declare module` augmentations the crate roots import), which the repo's tsc covers
  const errs = out.split("\n").filter((l) => / error TS/.test(l) && /\/src\/clippy_/.test(l));
  r.checked++;
  if (errs.length) r.errors.push(`tsc on the pending lib.gen.ts: ${errs.length} errors, first: ${errs[0]}`);
  return `lib.gen.ts with ${missing.length} stub modules: ${errs.length ? `${errs.length} errors` : "no errors"} in clippy files`;
}

async function main(): Promise<void> {
  requireUpstream();
  const wi = process.argv.indexOf("--work");
  if (wi >= 0) {
    WORK = process.argv[wi + 1] ?? die("--work needs a directory");
    if (existsSync(WORK) && readdirSync(WORK).length > 0) die(`--work ${WORK} is not empty; give a new or empty directory (nothing is deleted)`);
    mkdirSync(WORK, { recursive: true });
  } else {
    mkdirSync(join(DATA, "tmp"), { recursive: true });
    WORK = mkdtempSync(join(DATA, "tmp", "codegen-clippy-oracle-"));
  }
  SCRATCH = join(WORK, "s");
  const read: Read = (p) => readFileSync(join(UPSTREAM, p), "utf8");
  const { PREFILL } = await import("../../src/rustc_span/symbol.gen.ts");
  const g: GenerateResult = generateAll(read, lintFilesOf(), PREFILL);
  const x = expand(read);
  const files = new Set(lintFilesOf());
  const lines: string[] = [];
  let bad = 0;
  const run = async (what: string, f: (r: Report) => string | Promise<string>): Promise<void> => {
    const r = new Report();
    const summary = await f(r);
    writeFileSync(join(WORK, `${what}.errors.txt`), r.errors.join("\n") + "\n");
    if (r.errors.length) bad++;
    lines.push(`${r.errors.length ? "ERROR: " : "ok "}${what}: ${summary}; ${r.checked} comparisons, ${r.errors.length} mismatches${r.errors.length ? ` (first: ${r.errors[0]!.slice(0, 200)})` : ""}`);
  };
  await run("expanded-lints", (r) => checkLints(r, x.lints, g, files));
  await run("expanded-combined", (r) => checkCombined(r, x.lints, g, read));
  await run("expanded-sym", (r) => checkSym(r, x.sym, g));
  await run("expanded-msrvs", (r) => checkMsrvs(r, x.msrvs, g));
  await run("expanded-conf", (r) => checkConf(r, x.conf, g));
  await run("w-help", (r) => checkWHelp(r, g));
  await run("emitted", (r) => checkEmitted(r, g));
  await run("tsc-pending", (r) => checkPendingTsc(r, g));
  for (const l of lines) console.log(l);
  console.log(`details: ${WORK}`);
  if (bad) process.exit(1);
}

if (import.meta.main) await main();

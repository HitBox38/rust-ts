// The rustc_next_trait_solver contract against upstream (lane evalctxt-contract):
// 1. every fn of every `impl EvalCtxt` block, in every file of the crate, is declared in decls.ts at its `file:line`;
// 2. every other upstream fn of the crate has its place: a `// rustc:` marker (ported), a comment line in decls.ts (fns
//    of structs local to an `EvalCtxt` method), or a stub with its name in the mirrored TS module;
// 3. once lib.ts is loaded, every declared `EvalCtxt` method (and static) exists, and a stub stops as UNPORTED;
// 4. the three `GoalKind` impl tables implement every trait item, and each upstream impl fn is an entry of its table;
// 5. the ported delegate.rs provided methods behave like upstream.
//
// Upstream fns come from the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an impl-block scan over the same
// rustc_lexer tokens (the scan is checked against the finder), so `fn` in comments or strings never counts.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { FrontmatterAllowed, tokenize } from "../rustc_lexer/lib.ts";
import { CanonicalizerState } from "../rustc_type_ir/canonical.ts";
import { Str } from "../std/str.ts";
import { solve } from "./lib.ts";
import { type SolverDelegate, SolverDelegate_provided } from "./delegate.ts";
import { GoalKind_provided } from "./solve/assembly/mod.ts";
import { GoalKind_HostEffectClause } from "./solve/effect_goals.ts";
import { GoalKind_NormalizesTo } from "./solve/normalizes_to.ts";
import { GoalKind_TraitClause } from "./solve/trait_goals.ts";

const SRC = "compiler/rustc_next_trait_solver/src/";
const EvalCtxt = solve.EvalCtxt;
const CRATE_DIR = join(UPSTREAM, SRC);

function rsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) rsFiles(p, out);
    else if (e.name.endsWith(".rs")) out.push(relative(CRATE_DIR, p));
  }
  return out.sort();
}
const FILES = rsFiles(CRATE_DIR);

interface ImplFn {
  file: string;
  /** The `impl` (or `trait`) block's self type (`trait X` for trait declarations), or `free` / `nested`. */
  self_ty: string;
  trait_: string | undefined;
  line: number;
  name: string;
}

/** Every fn of `file` with the `impl` / `trait` block directly containing it (`free` at top level, `nested` inside a
 * fn body or a block that is not an impl). */
function implFns(file: string): ImplFn[] {
  const bytes = readFileSync(join(CRATE_DIR, file));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const toks: { k: string; t: string; line: number }[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") {
      const keep = k === "Ident" || k === "OpenBrace" || k === "CloseBrace" || k === "Semi" || k === "Lt" || k === "Gt";
      toks.push({ k, t: keep ? src.slice(pos, pos + tok.len).toString() : k, line });
    }
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  const out: ImplFn[] = [];
  const stack: { self_ty: string; trait_: string | undefined; depth: number }[] = [];
  let depth = 0;
  let pending: { self_ty: string; trait_: string | undefined } | undefined;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    const prev = i === 0 ? "{" : toks[i - 1]!.t;
    if ((x.t === "impl" || x.t === "trait") && ["{", "}", ";", "CloseBracket", "pub", "unsafe", "CloseParen"].includes(prev)) {
      // header up to the block: `impl<..> [Trait<..> for] Type<..> [where ..] {` / `trait Name<..>: .. {`
      let ang = 0;
      const head: string[] = [];
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "<") ang++;
        else if (t === ">") ang--;
        else if (ang === 0 && (t === "{" || t === ";")) break;
        if (ang === 0 && t !== ">") head.push(t);
      }
      const where = head.indexOf("where");
      const words = (where >= 0 ? head.slice(0, where) : head).filter((w) => /^[A-Za-z_]\w*$/.test(w) && w !== "mut" && w !== "dyn");
      if (x.t === "trait") pending = { self_ty: `trait ${words[0]}`, trait_: undefined };
      else {
        const forAt = words.indexOf("for");
        pending = { self_ty: forAt >= 0 ? words[forAt + 1]! : words[words.length - 1]!, trait_: forAt >= 0 ? words[forAt - 1] : undefined };
      }
    }
    if (x.t === "{") {
      depth++;
      if (pending) {
        stack.push({ ...pending, depth });
        pending = undefined;
      }
    } else if (x.t === "}") {
      if (stack.length && stack[stack.length - 1]!.depth === depth) stack.pop();
      depth--;
    } else if (x.t === "fn" && toks[i + 1]?.k === "Ident") {
      const top = stack[stack.length - 1];
      const self_ty = top === undefined ? (depth === 0 ? "free" : "nested") : top.depth === depth ? top.self_ty : "nested";
      out.push({ file, self_ty, trait_: top?.depth === depth ? top.trait_ : undefined, line: x.line, name: toks[i + 1]!.t });
    }
  }
  return out;
}

const ALL: ImplFn[] = FILES.flatMap(implFns);
const DECLS = readFileSync(join(import.meta.dir, "decls.ts"), "utf8").split("\n");

/** `// <file>:<line>` comment -> the declaration (or comment) on the same line after the location, or the next line. */
function declIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < DECLS.length; i++) {
    const r = /^\s*\/\/ ((?:\w+\/)*\w+\.rs):(\d+)\b(.*)$/.exec(DECLS[i]!);
    if (r) m.set(`${r[1]}:${r[2]}`, r[3]!.trim() !== "" ? r[3]!.trim() : (DECLS[i + 1] ?? "").trim());
  }
  return m;
}

/** The TS module mirroring an upstream file (PORTING §2). */
function tsModule(file: string): string {
  return readFileSync(join(import.meta.dir, file.replace(/\.rs$/, ".ts")), "utf8");
}

test("the impl-block scan agrees with coverage.ts's fn finder", () => {
  const finder = FILES.flatMap((f) => upstreamFns(SRC + f).map((x) => `${f}:${x.line} ${x.name}`)).sort();
  const scan = ALL.map((x) => `${x.file}:${x.line} ${x.name}`).sort();
  expect(scan).toEqual(finder);
  expect(scan.length).toBe(425);
});

test("every fn of every `impl EvalCtxt` block (all files) is declared in decls.ts", () => {
  const idx = declIndex();
  const missing: string[] = [];
  let n = 0;
  for (const f of ALL) {
    if (f.self_ty !== "EvalCtxt") continue;
    n++;
    const d = idx.get(`${f.file}:${f.line}`);
    if (d === undefined || !new RegExp(`^(declare static )?${f.name}\\b|^${f.name} \\(static`).test(d)) missing.push(`${f.file}:${f.line} ${f.name}`);
  }
  expect(missing).toEqual([]);
  // eval_ctxt/mod 51, probe 3, solver_region_constraints 6, solve/mod 15, assembly 13, effect_goals 1,
  // normalizes_to 5, project_goals 7, trait_goals 15
  expect(n).toBe(116);
});

test("every other upstream fn is ported, declared, or stubbed in its mirrored module", () => {
  const idx = declIndex();
  const missing: string[] = [];
  for (const f of ALL) {
    if (f.self_ty === "EvalCtxt") continue;
    const marker = `// rustc: ${SRC}${f.file}:${f.line} ${f.name}`;
    const ts = f.file === "lib.rs" ? "" : tsModule(f.file);
    if (ts.includes(marker)) continue;
    // fns of structs local to an `EvalCtxt` method (or nested fns): a comment line in decls.ts or the module header
    const d = idx.get(`${f.file}:${f.line}`);
    if (d !== undefined && d.includes(f.name)) continue;
    if (f.self_ty === "nested" && ts.length > 0) continue; // ported inside the enclosing fn (named in the module header)
    // a stub with its final signature: a method / function / object entry of that name
    if (new RegExp(`(^|\\s|\\.)${f.name}(<[^(]*>)?\\(`, "m").test(ts) || ts.includes(`"${f.name}"`)) continue;
    // `impl From<X>` is the companion entry `from_X` (tyir-solve decision 7)
    if (f.trait_ === "From" && /(^|\s)from_\w+\(/m.test(ts)) continue;
    // a fn of a struct local to a free fn: a `// <file>:<line> <Type>::<name>` comment in the module
    if (ts.includes(`// ${f.file}:${f.line} ${f.self_ty}::${f.name}`)) continue;
    missing.push(`${f.file}:${f.line} ${f.self_ty}${f.trait_ ? ` as ${f.trait_}` : ""}::${f.name}`);
  }
  expect(missing).toEqual([]);
});

/** Method names declared (not commented out) in `export interface EvalCtxt {` .. `}` of decls.ts. */
function declaredEvalCtxtMethods(): string[] {
  const start = DECLS.findIndex((l) => /^export interface EvalCtxt \{/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const names: string[] = [];
  for (let i = start + 1; i < DECLS.length && DECLS[i] !== "}"; i++) {
    const m = /^ {2}(\w+)(<[^(]*>)?\(/.exec(DECLS[i]!);
    if (m) names.push(m[1]!);
  }
  return names;
}

test("every declared EvalCtxt method and static exists once lib.ts is loaded", () => {
  const names = declaredEvalCtxtMethods();
  expect(names.length).toBe(114); // 116 minus the two statics
  const absent = names.filter((n) => typeof (EvalCtxt.prototype as unknown as Record<string, unknown>)[n] !== "function");
  expect(absent).toEqual([]);
  expect(typeof EvalCtxt.enter_root).toBe("function");
  expect(typeof EvalCtxt.enter_canonical).toBe("function");
  // (merge-w16a: every EvalCtxt method is ported, so the former "a stub stops as UNPORTED" example is gone)
});

test("the GoalKind impl tables implement every trait item and every upstream impl fn", () => {
  const src = readFileSync(join(import.meta.dir, "solve/assembly/mod.ts"), "utf8");
  const body = src.slice(src.indexOf("export interface GoalKind<G>"), src.indexOf("\n}\n", src.indexOf("export interface GoalKind<G>")));
  const items = [...body.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]!);
  const traitFns = ALL.filter((f) => f.self_ty === "trait GoalKind").map((f) => f.name);
  expect(items.filter((n) => n !== "eq" && n !== "display")).toEqual(traitFns);
  expect(Object.keys(GoalKind_provided)).toEqual([
    "probe_and_consider_implied_clause",
    "probe_and_consider_object_bound_candidate",
    "probe_and_consider_param_env_candidate",
    "probe_and_match_goal_against_assumption",
  ]);
  const tables: [string, Record<string, unknown>][] = [
    ["TraitClause", GoalKind_TraitClause as unknown as Record<string, unknown>],
    ["ty", GoalKind_HostEffectClause as unknown as Record<string, unknown>],
    ["NormalizesTo", GoalKind_NormalizesTo as unknown as Record<string, unknown>],
  ];
  for (const [self_ty, table] of tables) {
    for (const n of [...items, "visit_with", "try_fold_with", "fold_with"]) expect(typeof table[n]).toBe("function");
    const implFnNames = ALL.filter((f) => f.self_ty === self_ty && f.trait_ === "GoalKind").map((f) => f.name);
    expect(implFnNames.length).toBeGreaterThanOrEqual(31);
    for (const n of implFnNames) expect(Object.keys(table)).toContain(n);
  }
});

test("delegate.rs: the provided SolverDelegate methods", () => {
  const tcx = { tcx: true };
  const infcx = { cx: () => tcx };
  const delegate = { deref: () => infcx } as unknown as SolverDelegate;
  // `(**self).cx()`
  expect(SolverDelegate_provided.cx(delegate) as unknown).toBe(tcx);
  // `Default::default()`: a fresh, empty state each time
  const a = SolverDelegate_provided.obtain_canonicalizer_state(delegate);
  const b = SolverDelegate_provided.obtain_canonicalizer_state(delegate);
  expect(a).toBeInstanceOf(CanonicalizerState);
  expect(a).not.toBe(b);
  expect(a.variables).toEqual([]);
  expect(a.var_kinds).toEqual([]);
  expect(a.variable_lookup_table.size).toBe(0);
  expect(a.sub_root_lookup_table.size).toBe(0);
  expect(SolverDelegate_provided.release_canonicalizer_state(delegate, a)).toBeUndefined();
});

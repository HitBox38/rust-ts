// The rustc_ast_lowering contract (decls.ts, lane lowering-contract) against upstream:
// - every fn of every rustc_ast_lowering file is declared in decls.ts at its `file:line` (a method of
//   `LoweringContext` / `DelegationResolver`, a `FreeFns` member, a `declare static`, or a comment-only
//   declaration for the helper types, trait impls and nested fns);
// - at runtime every declared method / static / free fn exists (ported, or an `unported` placeholder of the
//   owning stub module), and the placeholders stop as UNPORTED;
// - the stub modules' `unported_methods` lists name only their own file's methods, and lib.ts's two lists
//   split lib.rs at line 1757 (lanes lower-lib-a / lower-lib-b).
//
// The upstream fns come from the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an impl-block
// scan over the same rustc_lexer tokens, so `fn` in comments or strings never counts.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { FrontmatterAllowed, tokenize } from "../rustc_lexer/lib.ts";
import { Unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";
import type { FreeFns } from "./decls.ts";
import * as Lib from "./lib.ts";
import { DelegationResolver, LoweringContext } from "./lib.ts";
import * as Resolution from "./delegation/resolution.ts";
import * as Format from "./format.ts";
import * as Index from "./index.ts";
import * as Item from "./item.ts";
import * as Stability from "./stability.ts";

const SRC = "compiler/rustc_ast_lowering/src/";
/** Upstream file -> the TS module that ports it (relative to this directory). */
const FILES: Record<string, string> = {
  "lib.rs": "lib.ts",
  "asm.rs": "asm.ts",
  "block.rs": "block.ts",
  "contract.rs": "contract.ts",
  "delegation/mod.rs": "delegation/mod.ts",
  "delegation/attributes.rs": "delegation/attributes.ts",
  "delegation/generics.rs": "delegation/generics.ts",
  "delegation/resolution.rs": "delegation/resolution.ts",
  "diagnostics.rs": "diagnostics.ts",
  "expr.rs": "expr.ts",
  "expr/closure.rs": "expr/closure.ts",
  "format.rs": "format.ts",
  "index.rs": "index.ts",
  "item.rs": "item.ts",
  "pat.rs": "pat.ts",
  "path.rs": "path.ts",
  "stability.rs": "stability.ts",
};
/** lib.rs is ported by two lanes: lower-lib-a (lines < LIB_SPLIT) and lower-lib-b (lines >= LIB_SPLIT). */
const LIB_SPLIT = 1757;

interface ScannedFn {
  file: string;
  line: number;
  name: string;
  /** the innermost `impl` block's self type at the fn's own brace depth; `undefined` for free/nested fns */
  self_ty: string | undefined;
  trait_: string | undefined;
  has_self: boolean;
}

/** Every `fn` of `file`, with the self type of the `impl` block it is directly inside (if any). */
function scan(file: string): ScannedFn[] {
  const bytes = readFileSync(join(UPSTREAM, SRC + file));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const toks: { k: string; t: string; line: number }[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") {
      const keep = k === "Ident" || k === "OpenBrace" || k === "CloseBrace" || k === "Semi" || k === "Lt" || k === "Gt" || k === "OpenParen" || k === "CloseParen";
      toks.push({ k, t: keep ? src.slice(pos, pos + tok.len).toString() : k, line });
    }
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  const out: ScannedFn[] = [];
  const stack: { self_ty: string; trait_: string | undefined; depth: number }[] = [];
  let depth = 0;
  let pending: { self_ty: string; trait_: string | undefined } | undefined;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    if (x.t === "impl" && (i === 0 || ["{", "}", ";", "CloseBracket"].includes(toks[i - 1]!.t))) {
      let ang = 0;
      const head: string[] = [];
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "<") ang++;
        else if (t === ">") ang--;
        else if (ang === 0 && (t === "{" || t === ";")) break;
        if (ang === 0 && t !== ">") head.push(t);
      }
      const words = head.filter((w) => /^[A-Za-z_]\w*$/.test(w) && w !== "where" && w !== "mut" && w !== "dyn");
      const forAt = words.indexOf("for");
      pending = { self_ty: forAt >= 0 ? words[forAt + 1]! : words[words.length - 1]!, trait_: forAt >= 0 ? words[forAt - 1] : undefined };
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
      const direct = top !== undefined && top.depth === depth;
      // `self` among the parameters: `(self`, `(&self`, `(&mut self`, `(&'a self`, `(mut self`
      let has_self = false;
      for (let j = i + 2, d = 0; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "(") {
          d++;
          if (d === 1) {
            for (let k = j + 1; k < j + 5 && k < toks.length; k++) {
              if (toks[k]!.t === "self") has_self = true;
              if (toks[k]!.t === "," || toks[k]!.t === ")" || toks[k]!.k === "Colon") break;
            }
            break;
          }
        }
      }
      out.push({ file, line: x.line, name: toks[i + 1]!.t, self_ty: direct ? top.self_ty : undefined, trait_: direct ? top.trait_ : undefined, has_self });
    }
  }
  return out;
}

const ALL: ScannedFn[] = Object.keys(FILES).flatMap(scan);
const here = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
const DECLS = here("decls.ts").split("\n");

/** `// <file>:<line>` comment -> the declaration (or commented declaration) on the next line. */
function declIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < DECLS.length; i++) {
    const r = /^\s*\/\/ ((?:\w+\/)?\w+\.rs):(\d+)\b/.exec(DECLS[i]!);
    if (r) m.set(`${r[1]}:${r[2]}`, DECLS[i + 1] ?? "");
  }
  return m;
}

/** Method names declared (not commented out) in the block `<header> {` .. `}` of decls.ts. */
function declaredMethods(header: RegExp): string[] {
  const start = DECLS.findIndex((l) => header.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const names: string[] = [];
  for (let i = start + 1; i < DECLS.length && DECLS[i] !== "}"; i++) {
    const m = /^\s*(\w+)(<[^(]*>)?\(/.exec(DECLS[i]!);
    if (m) names.push(m[1]!);
  }
  return names;
}

test("the impl scan agrees with coverage.ts's fn finder", () => {
  for (const file of Object.keys(FILES)) {
    const a = upstreamFns(SRC + file).map((f) => `${f.line} ${f.name}`);
    const b = ALL.filter((f) => f.file === file).map((f) => `${f.line} ${f.name}`);
    expect(b).toEqual(a);
  }
  expect(ALL.length).toBe(419);
});

test("every rustc_ast_lowering fn is declared in decls.ts at its file:line", () => {
  const idx = declIndex();
  const missing: string[] = [];
  for (const f of ALL) {
    const d = idx.get(`${f.file}:${f.line}`);
    // `name(`, `// name(`, `declare static name:`, or the `<SelfTy>_<name>` free fn of an extension trait
    if (d === undefined || !new RegExp(`^\\s*(// )?(declare static )?(\\w+_)?${f.name}\\b`).test(d)) missing.push(`${f.file}:${f.line} ${f.name}`);
  }
  expect(missing).toEqual([]);
});

test("every `impl LoweringContext` / `impl DelegationResolver` method is a real declaration", () => {
  const lc = new Set(declaredMethods(/^export interface LoweringContext \{/));
  const dr = new Set(declaredMethods(/^export interface DelegationResolver \{/));
  const missing: string[] = [];
  let n_lc = 0;
  let n_dr = 0;
  for (const f of ALL) {
    if (f.self_ty === "LoweringContext") {
      n_lc++;
      if (f.has_self ? !lc.has(f.name) : typeof (LoweringContext as unknown as Record<string, unknown>)[f.name] !== "function") missing.push(`${f.file}:${f.line} ${f.name}`);
    } else if (f.self_ty === "DelegationResolver") {
      n_dr++;
      if (f.has_self ? !dr.has(f.name) : typeof (DelegationResolver as unknown as Record<string, unknown>)[f.name] !== "function") missing.push(`${f.file}:${f.line} ${f.name}`);
    }
  }
  expect(missing).toEqual([]);
  // lib 94 (lib-a 36 incl. `new`, lib-b 58), item 50, expr 75, expr/closure 7, pat 15, path 8, block 6, asm 1,
  // format 5, delegation/{mod 12, generics 4, attributes 2}, contract 9
  expect(n_lc).toBe(288);
  expect(n_dr).toBe(19);
  expect(lc.size).toBe(287);
  expect(dr.size).toBe(17);
});

test("every declared method exists on its prototype once lib.ts is loaded", () => {
  const absent: string[] = [];
  for (const [header, proto] of [
    [/^export interface LoweringContext \{/, LoweringContext.prototype],
    [/^export interface DelegationResolver \{/, DelegationResolver.prototype],
  ] as const) {
    for (const name of declaredMethods(header)) {
      if (typeof (proto as unknown as Record<string, unknown>)[name] !== "function") absent.push(`${header.source} ${name}`);
    }
  }
  expect(absent).toEqual([]);
});

test("the free fns exist with their FreeFns signatures", () => {
  // Type-level: tsc checks every stub against the declared signature.
  const fns: FreeFns = {
    provide: Lib.provide,
    ResolverAstLowering_legacy_const_generic_args: Lib.ResolverAstLowering_legacy_const_generic_args,
    index_ast: Lib.index_ast,
    lower_to_hir: Lib.lower_to_hir,
    add_ty_alias_where_clause: Item.add_ty_alias_where_clause,
    flatten_format_args: Format.flatten_format_args,
    make_argument: Format.make_argument,
    make_count: Format.make_count,
    expand_format_args: Format.expand_format_args,
    for_all_argument_indexes: Format.for_all_argument_indexes,
    resolve_type_relative_delegations: Resolution.resolve_type_relative_delegations,
    index_hir: Index.index_hir,
    enabled_names: Stability.enabled_names,
    extern_abi_enabled: Stability.extern_abi_enabled,
    gate_unstable_abi: Stability.gate_unstable_abi,
    extern_abi_stability: Stability.extern_abi_stability,
  };
  const declared = declaredMethods(/^export interface FreeFns \{/);
  expect(Object.keys(fns).sort()).toEqual([...declared].sort());
  for (const [name, f] of Object.entries(fns)) expect([name, typeof f]).toEqual([name, "function"]);
  // Every free fn upstream (outside an impl, not nested) is a FreeFns member.
  const free = ALL.filter((f) => f.self_ty === undefined && !["with_lctx", "is_ordinary"].includes(f.name)).map((f) => f.name);
  expect(free.filter((n) => !declared.includes(n))).toEqual([]);
});

test("placeholders stop as UNPORTED with the upstream path", () => {
  const stop = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      expect(e).toBeInstanceOf(Unported);
      return (e as Error).message;
    }
    throw new Error("expected Unported");
  };
  const lctx = Object.create(LoweringContext.prototype) as LoweringContext;
  // A method that is still a placeholder reports its module path; once ported it no longer stops here,
  // so only placeholders are probed.
  const probes: [object, string, string][] = [
    [lctx, "lower_ty", "rustc_ast_lowering::LoweringContext::lower_ty"],
    [lctx, "lower_item", "rustc_ast_lowering::item::LoweringContext::lower_item"],
    [lctx, "lower_expr", "rustc_ast_lowering::expr::LoweringContext::lower_expr"],
    [lctx, "lower_pat", "rustc_ast_lowering::pat::LoweringContext::lower_pat"],
    [lctx, "lower_delegation", "rustc_ast_lowering::delegation::LoweringContext::lower_delegation"],
  ];
  for (const [obj, name, path] of probes) {
    const fn = (obj as Record<string, () => unknown>)[name]!;
    if (fn.toString().includes("unported(`")) expect(stop(() => fn.call(obj))).toContain(path);
  }
});

/** The names in every `unported_methods(<Class>.prototype, ..., [..])` list of a TS module, per list. */
function stubLists(text: string, cls: string): { at: number; names: string[] }[] {
  const out: { at: number; names: string[] }[] = [];
  const re = new RegExp(`unported_methods\\(${cls}\\.prototype, "[^"]*", \\[([^\\]]*)\\]\\)`, "g");
  for (const m of text.matchAll(re)) out.push({ at: m.index!, names: [...m[1]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!) });
  return out;
}

test("each stub module's placeholder lists name only that file's methods", () => {
  const wrong: string[] = [];
  for (const [file, ts] of Object.entries(FILES)) {
    const text = here(ts);
    for (const cls of ["LoweringContext", "DelegationResolver"]) {
      const own = new Set(ALL.filter((f) => f.file === file && f.self_ty === cls && f.has_self).map((f) => f.name));
      for (const list of stubLists(text, cls)) for (const n of list.names) if (!own.has(n)) wrong.push(`${ts}: ${cls}::${n}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("lib.ts's two placeholder lists split lib.rs at line 1757 (lanes lower-lib-a / lower-lib-b)", () => {
  const text = here("lib.ts");
  const a_at = text.indexOf("// ==== lane lower-lib-a: lib.rs:1..1756 ====");
  const b_at = text.indexOf("// ==== lane lower-lib-b: lib.rs:1757..3401 ====");
  expect(a_at).toBeGreaterThan(0);
  expect(b_at).toBeGreaterThan(a_at);
  const lib = ALL.filter((f) => f.file === "lib.rs" && f.self_ty === "LoweringContext" && f.has_self);
  const line = new Map(lib.map((f) => [f.name, f.line]));
  const wrong: string[] = [];
  for (const list of stubLists(text, "LoweringContext")) {
    const in_b = list.at > b_at;
    for (const n of list.names) if ((line.get(n)! >= LIB_SPLIT) !== in_b) wrong.push(`${n} (lib.rs:${line.get(n)}) in the ${in_b ? "-b" : "-a"} list`);
  }
  expect(wrong).toEqual([]);
  // the split point is a method boundary: `lower_ty` ends before `emit_bad_gca_macro`
  expect(lib.find((f) => f.line === LIB_SPLIT)?.name).toBe("emit_bad_gca_macro");
});

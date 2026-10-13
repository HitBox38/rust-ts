// The rustc_resolve contract (decls.ts) against upstream: every fn of every `impl` block of the
// contract's types, in every rustc_resolve file, is declared in decls.ts (as `// <file>:<line>` + the
// declaration, or a comment line for statics and trait impls), and at runtime every declared method
// exists on its prototype (ported, or an `unported` placeholder of the owning stub file).
//
// The upstream fns are found with the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an
// impl-block scan over the same rustc_lexer tokens, so `fn` in comments or strings never counts.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import type { ResolverExpand } from "../rustc_expand/base.ts";
import { FrontmatterAllowed, tokenize } from "../rustc_lexer/lib.ts";
import { Str } from "../std/str.ts";
import * as Lib from "./lib.ts";
import { DefCollector, LateResolutionVisitor, Resolver } from "./lib.ts";
import * as CheckUnused from "./check_unused.ts";
import * as Imports from "./imports.ts";
import * as Late from "./late.ts";
import * as LateDiag from "./late/diagnostics.ts";

const FILES = [
  "lib.rs",
  "ident.rs",
  "imports.rs",
  "build_reduced_graph.rs",
  "def_collector.rs",
  "macros.rs",
  "check_unused.rs",
  "effective_visibilities.rs",
  "rustdoc.rs",
  "diagnostics/mod.rs",
  "diagnostics/impls.rs",
  "late.rs",
  "late/diagnostics.rs",
];
const SRC = "compiler/rustc_resolve/src/";

/** The self type of every `impl` block of `file` and the lines of the fns directly inside it. */
function implFns(file: string): { self_ty: string; trait_: string | undefined; line: number; name: string }[] {
  const bytes = readFileSync(join(UPSTREAM, SRC + file));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const toks: { k: string; t: string; line: number }[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") {
      toks.push({ k, t: k === "Ident" || k === "OpenBrace" || k === "CloseBrace" || k === "Semi" || k === "Lt" || k === "Gt" ? src.slice(pos, pos + tok.len).toString() : k, line });
    }
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  const out: { self_ty: string; trait_: string | undefined; line: number; name: string }[] = [];
  const stack: { self_ty: string | undefined; trait_: string | undefined; depth: number }[] = [];
  let depth = 0;
  let pending: { self_ty: string; trait_: string | undefined } | undefined;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    if (x.t === "impl" && (i === 0 || ["{", "}", ";", "CloseBracket"].includes(toks[i - 1]!.t))) {
      // header up to the block: `impl<..> [Trait<..> for] Type<..> [where ..] {`
      let j = i + 1;
      let ang = 0;
      const head: string[] = [];
      for (; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "<") ang++;
        else if (t === ">") ang--;
        else if (ang === 0 && (t === "{" || t === ";")) break;
        if (ang === 0 && t !== ">" ) head.push(t);
      }
      const words = head.filter((w) => /^[A-Za-z_]\w*$/.test(w) && w !== "where" && w !== "mut" && w !== "dyn");
      const forAt = words.indexOf("for");
      const self_ty = forAt >= 0 ? words[forAt + 1]! : words[words.length - 1]!;
      pending = { self_ty, trait_: forAt >= 0 ? words[forAt - 1] : undefined };
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
      if (top && top.depth === depth && top.self_ty) out.push({ self_ty: top.self_ty, trait_: top.trait_, line: x.line, name: toks[i + 1]!.t });
    }
  }
  return out;
}

/** The types whose methods (all files) are declared in decls.ts. */
const CONTRACT_TYPES = new Set([
  "Resolver",
  "DefCollector",
  "LateResolutionVisitor",
  "ModuleData",
  "Module",
  "LocalModule",
  "ExternModule",
  "DeclData",
  "IdentKey",
  "ExternPreludeEntry",
  "ImportData",
  "NameResolution",
  "UnusedImport",
  "UnusedImportCheckVisitor",
  "EffectiveVisibilitiesVisitor",
  "StructCtor",
  "OnUnknownData",
  "TypoSuggestion",
  "UsePlacementFinder",
  "BindingVisitor",
  "ItemInfoCollector",
  "ParentPathVisitor",
  "LifetimeFinder",
  "RefPrefixSpanFinder",
]);
/** Trait impls on contract types that are not methods (`Debug`/`Deref` become `debug_<T>` / companion fns). */
const NOT_METHODS = new Set(["Debug", "Deref"]);

const DECLS = readFileSync(join(import.meta.dir, "decls.ts"), "utf8").split("\n");

/** `// <file>:<line>` comment -> the declaration (or commented declaration) on the next line. */
function declIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < DECLS.length; i++) {
    const r = /^\s*\/\/ ((?:\w+\/)?\w+\.rs):(\d+)\b/.exec(DECLS[i]!);
    if (r) m.set(`${r[1]}:${r[2]}`, DECLS[i + 1] ?? "");
  }
  return m;
}

test("every fn of every `impl Resolver` block (all rustc_resolve files) is declared in decls.ts", () => {
  const idx = declIndex();
  const missing: string[] = [];
  let n = 0;
  for (const file of FILES) {
    const all = new Set(upstreamFns(SRC + file).map((f) => `${f.line} ${f.name}`));
    for (const f of implFns(file)) {
      if (f.self_ty !== "Resolver") continue;
      expect(all.has(`${f.line} ${f.name}`)).toBe(true); // the scan agrees with coverage.ts's fn finder
      n++;
      const d = idx.get(`${file}:${f.line}`);
      if (d === undefined || !new RegExp(`^\\s*(// )?(declare static )?${f.name}\\b`).test(d)) missing.push(`${file}:${f.line} ${f.name}`);
    }
  }
  expect(missing).toEqual([]);
  expect(n).toBe(194); // lib 55, ident 21, imports 22, build_reduced_graph 14, macros 35, check_unused 1, effective_visibilities 2, diagnostics/impls 43, late 1
});

test("every fn of the other contract types' impl blocks is declared in decls.ts", () => {
  const idx = declIndex();
  const missing: string[] = [];
  for (const file of FILES) {
    for (const f of implFns(file)) {
      if (f.self_ty === "Resolver" || !CONTRACT_TYPES.has(f.self_ty)) continue;
      if (f.trait_ !== undefined && NOT_METHODS.has(f.trait_)) continue;
      const d = idx.get(`${file}:${f.line}`);
      if (d === undefined || !new RegExp(`^\\s*(// )?${f.name}\\b`).test(d)) missing.push(`${file}:${f.line} ${f.self_ty}::${f.name}`);
    }
  }
  expect(missing).toEqual([]);
});

/** Method names declared (not commented out) in a block `<header> {` .. `}` of decls.ts. */
function declaredMethods(header: RegExp): string[] {
  const start = DECLS.findIndex((l) => header.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const indent = /^\s*/.exec(DECLS[start]!)![0];
  const names: string[] = [];
  for (let i = start + 1; i < DECLS.length && DECLS[i] !== `${indent}}`; i++) {
    const m = /^\s*(\w+)(<[^(]*>)?\(/.exec(DECLS[i]!);
    if (m) names.push(m[1]!);
  }
  return names;
}

test("every declared method exists on its prototype once lib.ts is loaded", () => {
  const cases: [RegExp, object][] = [
    [/^export interface Resolver \{/, Resolver.prototype],
    [/^export interface DefCollector \{/, DefCollector.prototype],
    [/^export interface LateResolutionVisitor \{/, LateResolutionVisitor.prototype],
    [/^ {2}interface ModuleData \{/, Lib.ModuleData.prototype],
    [/^ {2}interface DeclData \{/, Lib.DeclData.prototype],
    [/^ {2}interface IdentKey \{/, Lib.IdentKey.prototype],
    [/^ {2}interface ExternPreludeEntry \{/, Lib.ExternPreludeEntry.prototype],
    [/^ {2}interface ImportData \{/, Imports.ImportData.prototype],
    [/^ {2}interface NameResolution \{/, Imports.NameResolution.prototype],
    [/^ {2}interface UnusedImport \{/, CheckUnused.UnusedImport.prototype],
    [/^ {2}interface UnusedImportCheckVisitor \{/, CheckUnused.UnusedImportCheckVisitor.prototype],
    [/^ {2}interface ItemInfoCollector \{/, Late.ItemInfoCollector.prototype],
    [/^ {2}interface ParentPathVisitor \{/, LateDiag.ParentPathVisitor.prototype],
  ];
  const absent: string[] = [];
  let n = 0;
  for (const [header, proto] of cases) {
    for (const name of declaredMethods(header)) {
      n++;
      if (typeof (proto as Record<string, unknown>)[name] !== "function") absent.push(`${header.source} ${name}`);
    }
  }
  expect(absent).toEqual([]);
  expect(n).toBeGreaterThan(400);
});

test("Resolver implements rustc_expand's ResolverExpand", () => {
  // Type-level: `impl ResolverExpand for Resolver` (macros.rs:172). tsc checks this assignment.
  const as_expand = (r: Resolver): ResolverExpand => r;
  expect(typeof as_expand).toBe("function");
});

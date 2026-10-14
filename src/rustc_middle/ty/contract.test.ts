// The ty contract (lane ty-contract, docs/plan-m3.md D2-D5) against upstream:
// 1. every fn of every `impl` block of the contract types (`Ty`, `RawList`/`List`/`GenericArgs`/`Clauses`,
//    `Predicate`, `Clause`, `Const`, `Region`, and `TyCtxt` outside context.rs / mod.rs) in rustc_middle/src/ty and
//    rustc_type_ir/src/sty is listed in ty/decls.ts or rustc_type_ir/decls.ts at its `file:line` (a declaration,
//    or a comment line saying where it went);
// 2. once rustc_middle/lib.ts is loaded, every declared method exists on its prototype (or constructor, for
//    statics): ported, or an `unported` placeholder of the owning stub file, which stops as UNPORTED;
// 3. every `TyCtxt` fn of ty/mod.rs is a `TyCtxt` method delegating to an exported `TyCtxt_<name>` (decision 6);
// 4. every item of `trait Interner` (interner.rs) is in the `Interner` interface with its marker, and `TyCtxt`
//    has every `Interner` method except the ones the inherent context.rs methods will serve (lane ty-ctxt).
//
// Upstream fns are found with the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an impl-block scan
// over the same rustc_lexer tokens (as rustc_resolve/contract.test.ts), so `fn` in comments never counts.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import { UPSTREAM } from "../../../scripts/lib/common.ts";
import { FrontmatterAllowed, tokenize } from "../../rustc_lexer/lib.ts";
import { Unported } from "../../std/panic.ts";
import { unported_stub_path } from "../../rust_ts/stubs.ts";
import { Str } from "../../std/str.ts";
import "../lib.ts";
import { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { TyCtxt } from "./context.ts";
import { RawList } from "./list.ts";
import * as TyMod from "./mod.ts";
import { Ty } from "./mod.ts";
import { Clause, Predicate } from "./predicate.ts";

const MIDDLE = "compiler/rustc_middle/src/";
const TYPE_IR = "compiler/rustc_type_ir/src/";

interface ImplFn {
  self_ty: string;
  trait_: string | undefined;
  line: number;
  name: string;
}

/** The self type (last path segment) of every `impl` / `trait` block of `rel` and the fns directly inside it. */
function implFns(rel: string): ImplFn[] {
  const bytes = readFileSync(join(UPSTREAM, rel));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const toks: { k: string; t: string; line: number }[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") toks.push({ k, t: src.slice(pos, pos + tok.len).toString(), line });
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  const out: ImplFn[] = [];
  const stack: { self_ty: string; trait_: string | undefined; depth: number }[] = [];
  let depth = 0;
  let pending: { self_ty: string; trait_: string | undefined } | undefined;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    if ((x.t === "impl" || x.t === "trait") && (i === 0 || ["{", "}", ";", "]", "pub", ")"].includes(toks[i - 1]!.t))) {
      if (x.t === "trait") {
        if (toks[i + 1]?.k === "Ident") pending = { self_ty: "<trait>", trait_: toks[i + 1]!.t };
        continue;
      }
      // header up to the block: `impl<..> [Trait<..> for] Type<..> [where ..] {`
      const head: string[] = [];
      let ang = 0;
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "<") ang++;
        else if (t === ">") ang--;
        else if (ang === 0 && (t === "{" || t === ";")) break;
        if (ang === 0 && t !== ">") head.push(t);
      }
      const ident = (w: string | undefined): boolean => w !== undefined && /^[A-Za-z_]\w*$/.test(w);
      const lastSeg = (k: number): string | undefined => {
        while (head[k] === "&" || head[k]?.startsWith("'") || head[k] === "mut" || head[k] === "dyn") k++;
        let last = head[k];
        while (head[k + 1] === ":" && head[k + 2] === ":") {
          k += 3;
          last = head[k];
        }
        return ident(last) ? last : undefined;
      };
      const forAt = head.indexOf("for");
      const words = head.filter((w) => ident(w) && w !== "where" && w !== "mut" && w !== "dyn");
      const self_ty = forAt >= 0 ? lastSeg(forAt + 1) : words[words.length - 1];
      const traitWords = forAt >= 0 ? head.slice(0, forAt).filter((w) => ident(w)) : [];
      pending = { self_ty: self_ty ?? "?", trait_: forAt >= 0 ? traitWords[traitWords.length - 1] : undefined };
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
      if (top && top.depth === depth) out.push({ self_ty: top.self_ty, trait_: top.trait_, line: x.line, name: toks[i + 1]!.t });
    }
  }
  return out;
}

function rsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(join(UPSTREAM, dir)).sort()) {
    const p = join(dir, e);
    if (statSync(join(UPSTREAM, p)).isDirectory()) rsFiles(p, acc);
    else if (p.endsWith(".rs") && !p.endsWith("tests.rs")) acc.push(p);
  }
  return acc;
}

const MIDDLE_DECLS = readFileSync(join(import.meta.dir, "decls.ts"), "utf8").split("\n");
const TYPE_IR_DECLS = readFileSync(join(import.meta.dir, "../../rustc_type_ir/decls.ts"), "utf8").split("\n");

/** `// <file>:<line>` -> the declaration on the next line, or the comment's own text after the location. */
function declIndex(lines: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const r = /^\s*\/\/ ((?:[\w]+\/)*\w+\.rs):(\d+)(?: (.*))?$/.exec(lines[i]!);
    if (r) m.set(`${r[1]}:${r[2]}`, r[3] !== undefined ? `// ${r[3]}` : (lines[i + 1] ?? "").trim());
  }
  return m;
}

const MIDDLE_TYPES = new Set(["Ty", "RawList", "List", "ListWithCachedTypeInfo", "GenericArgs", "GenericArgsRef", "Clauses", "Predicate", "Clause", "Const", "Region", "TyCtxt"]);

function checkListed(files: string[], root: string, rel: (f: string) => string, idx: Map<string, string>, types: Set<string>, skipTcx: (f: string) => boolean): { missing: string[]; n: number } {
  const missing: string[] = [];
  let n = 0;
  for (const f of files) {
    const all = new Set(upstreamFns(f).map((x) => `${x.line} ${x.name}`));
    for (const x of implFns(f)) {
      if (!types.has(x.self_ty)) continue;
      if (x.self_ty === "TyCtxt" && skipTcx(f)) continue;
      expect(all.has(`${x.line} ${x.name}`)).toBe(true); // the scan agrees with coverage.ts's fn finder
      n++;
      const d = idx.get(`${rel(f)}:${x.line}`);
      const ok = d !== undefined && (d.startsWith(`// ${x.name} `) || new RegExp(`^(function )?(ir_)?${x.name}\\b`).test(d));
      if (!ok) missing.push(`${rel(f)}:${x.line} ${x.self_ty}::${x.name}`);
    }
    void root;
  }
  return { missing, n };
}

test("every fn of every impl block of the contract types (rustc_middle/src/ty) is listed in ty/decls.ts", () => {
  const files = rsFiles(MIDDLE + "ty");
  const { missing, n } = checkListed(files, MIDDLE, (f) => f.slice(MIDDLE.length), declIndex(MIDDLE_DECLS), MIDDLE_TYPES, (f) => f.endsWith("ty/context.rs") || f.endsWith("ty/mod.rs"));
  expect(missing).toEqual([]);
  expect(n).toBe(COUNT_MIDDLE);
});

test("every fn of every impl block of Region / Const (rustc_type_ir/src/sty) is listed in rustc_type_ir/decls.ts", () => {
  const files = [TYPE_IR + "sty/mod.rs", TYPE_IR + "sty/consts.rs"];
  const { missing, n } = checkListed(files, TYPE_IR, (f) => f.slice(TYPE_IR.length), declIndex(TYPE_IR_DECLS), new Set(["Region", "Const"]), () => false);
  expect(missing).toEqual([]);
  expect(n).toBe(COUNT_TYPE_IR);
});

/** Declared (not commented-out) names of `interface X {` / `namespace X {` blocks inside `declare module` blocks. */
function declared(lines: readonly string[]): { module: string; cls: string; isStatic: boolean; name: string }[] {
  const out: { module: string; cls: string; isStatic: boolean; name: string }[] = [];
  let mod = "";
  let cls = "";
  let st = false;
  for (const l of lines) {
    let m = /^declare module "(.*)" \{/.exec(l);
    if (m) {
      mod = m[1]!;
      continue;
    }
    m = /^ {2}(interface|namespace) (\w+)/.exec(l);
    if (m) {
      st = m[1] === "namespace";
      cls = m[2]!;
      continue;
    }
    m = /^ {4}(?:function )?(\w+)(<[^(]*>)?\(/.exec(l);
    if (m && cls) out.push({ module: mod, cls, isStatic: st, name: m[1]! });
  }
  return out;
}

const TARGETS: Record<string, { proto: object; ctor: object }> = {
  Ty: { proto: Ty.prototype, ctor: Ty },
  RawList: { proto: RawList.prototype, ctor: RawList },
  Predicate: { proto: Predicate.prototype, ctor: Predicate },
  Clause: { proto: Clause.prototype, ctor: Clause },
  Const: { proto: Const.prototype, ctor: Const },
  Region: { proto: Region.prototype, ctor: Region },
  TyCtxt: { proto: TyCtxt.prototype, ctor: TyCtxt },
};

test("every declared method exists on its prototype (or constructor) once rustc_middle/lib.ts is loaded", () => {
  const absent: string[] = [];
  let n = 0;
  for (const d of [...declared(MIDDLE_DECLS), ...declared(TYPE_IR_DECLS)]) {
    const t = TARGETS[d.cls];
    expect(t).toBeDefined();
    const o = (d.isStatic ? t!.ctor : t!.proto) as Record<string, unknown>;
    n++;
    if (typeof o[d.name] !== "function") absent.push(`${d.cls}${d.isStatic ? "." : ".prototype."}${d.name}`);
  }
  expect(absent).toEqual([]);
  expect(n).toBe(COUNT_DECLARED);
});

test("a stub stops as UNPORTED", () => {
  expect(() => (Ty.prototype as unknown as { is_bool(): boolean }).is_bool.call(undefined)).toThrow(Unported);
  expect(() => (TyCtxt.prototype as unknown as { trait_is_marker(): boolean }).trait_is_marker.call(undefined)).toThrow(Unported);
  // `Region::new_static` (sty/mod.rs:135) is ported now (lane tyir-misc): it is the interner's pre-interned `'static`; a
  // rustc_middle `Const` static stands in as the static-stub example.
  const re_static = {} as Region;
  expect(Region.new_static({ get_re_static_lifetime: () => re_static } as unknown as TyCtxt)).toBe(re_static);
  expect(() => (Const as unknown as { zero_sized(): unknown }).zero_sized()).toThrow(Unported);
});

test("every TyCtxt fn of ty/mod.rs is a TyCtxt method delegating to TyCtxt_<name> in mod.ts (decision 6)", () => {
  const missing: string[] = [];
  const mod = TyMod as unknown as Record<string, unknown>;
  for (const x of implFns(MIDDLE + "ty/mod.rs")) {
    if (x.self_ty !== "TyCtxt" || x.trait_ !== undefined) continue;
    if (typeof (TyCtxt.prototype as unknown as Record<string, unknown>)[x.name] !== "function") missing.push(`TyCtxt.prototype.${x.name}`);
    if (typeof mod[`TyCtxt_${x.name}`] !== "function") missing.push(`mod.ts TyCtxt_${x.name}`);
  }
  expect(missing).toEqual([]);
});

const INTERNER_TS = readFileSync(join(import.meta.dir, "../../rustc_type_ir/interner.ts"), "utf8");

test("every item of `trait Interner` is in the Interner interface; TyCtxt has its methods", () => {
  const missing: string[] = [];
  const lacking: string[] = [];
  const iface = INTERNER_TS.slice(INTERNER_TS.indexOf("export interface Interner {"), INTERNER_TS.indexOf("\n}\n", INTERNER_TS.indexOf("export interface Interner {")));
  for (const x of implFns(TYPE_IR + "interner.rs")) {
    if (x.self_ty !== "<trait>" || x.trait_ !== "Interner") continue;
    const marked = iface.includes(`// rustc: compiler/rustc_type_ir/src/interner.rs:${x.line} ${x.name}`) || iface.includes(`// (provided) interner.rs:${x.line} ${x.name}`);
    if (!marked) missing.push(`interner.rs:${x.line} ${x.name}`);
    const name = new RegExp(`\\n {2}(ir_${x.name}|${x.name})[<(]`).exec(iface)?.[1];
    if (name === undefined) missing.push(`interface member ${x.name}`);
    else {
      const f = (TyCtxt.prototype as unknown as Record<string, unknown>)[name];
      // context.ts's placeholders for the inherent methods (merge-w14) still count as missing
      if (typeof f !== "function" || unported_stub_path(f) === "rustc_middle::ty::context::TyCtxt") lacking.push(name);
    }
  }
  expect(missing).toEqual([]);
  // served by inherent `TyCtxt` methods of context.rs that lane ty-ctxt ports into the class body
  expect(lacking.sort()).toEqual(INHERENT_CONTEXT_RS.slice().sort());
});

// Pinned counts (update together with the declarations).
const COUNT_MIDDLE = 608;
const COUNT_TYPE_IR = 66;
const COUNT_DECLARED = 408;
const INHERENT_CONTEXT_RS = [
  "assumptions_on_binders",
  "check_alias_term_args_compatible",
  "coroutine_is_async",
  "coroutine_is_async_gen",
  "coroutine_is_gen",
  "coroutine_movability",
  "debug_assert_alias_term_args_compatible",
  "debug_assert_args_compatible",
  "is_default_trait",
  "is_general_coroutine",
  "is_impl_trait_in_trait",
  "is_sizedness_trait",
  "next_trait_solver_globally",
  "renormalize_rigid_aliases",
];

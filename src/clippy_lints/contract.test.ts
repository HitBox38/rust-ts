// The clippy_lints contract (lane clippy-contract-a; root decision "codegen-clippy-macros N5"), checked so that it holds while the
// fill lanes replace stubs (review clippy-contract-a N1: nothing here pins how many stubs are left):
// - the contract's upstream fns (every fn of the `EarlyLintPass`/`LateLintPass` impls of the sub-pass types, and each type's `new`
//   that lib.rs calls; found by a token scan of the pinned sources) each carry a `// stub:` marker or a `// rustc:` marker, never
//   both; every `// stub: <path>:<line> <name> (lane <group>)` names an upstream fn;
// - every sub-pass of lib.rs (lint_tables.gen.ts `SUB_PASSES`) is exported by its hand module with the generated `lint_vec`;
// - every method or constructor carrying a `// stub:` marker (and every `#[derive(Default)]` stub) stops `unported`; a dual
//   early/late pass's method is called with the context of the side the marker is on.
// (contract.d.ts and its check were removed at integ-w66, when clippy_config/lib.ts and lib.gen.ts landed.)
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { rustFns } from "../../scripts/lib/rust-fns.ts";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../rustc_lexer/lib.ts";
import { LateContext } from "../rustc_lint/context.ts";
import { Unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";
import { SUB_PASSES } from "./lint_tables.gen.ts";

const SRC = resolve(import.meta.dir, "..");
const REPO = resolve(SRC, "..");
const LINTS_SRC = "src/tools/clippy/clippy_lints/src";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".gen.ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const FILES = [...walk(join(SRC, "clippy_lints")), join(SRC, "clippy_utils/macros.ts")];
const STUB = /^\s*\/\/ stub: (\S+):(\d+) (\w+) \(lane (always-running|dispatch|dispatch-methods|lint-files)\)$/;
const RUSTC = /^\s*\/\/ rustc: (src\/tools\/clippy\/\S+):(\d+) (\w+)$/;

interface Tok {
  t: string;
  ident: boolean;
  line: number;
}
/** The pinned file's tokens, comments and whitespace left out (rustc_lexer). */
function lex(root: string, rel: string): Tok[] {
  const bytes = readFileSync(join(root, rel));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const out: Tok[] = [];
  let pos = strip_shebang(src) ?? 0;
  let line = 1;
  for (let i = 0; i < pos; i++) if (src.byte(i) === 0x0a) line++;
  for (const tok of tokenize(src.slice(pos), FrontmatterAllowed.Yes)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") out.push({ t: src.slice(pos, pos + tok.len).toString(), ident: k === "Ident", line });
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return out;
}

/** Each `impl [<..>] [Trait for] Type { .. }` of a file: trait and self type (last path segment) and the `fn`s at its top level. */
function impls(toks: Tok[]): { trait: string | undefined; self: string; fns: { name: string; line: number }[] }[] {
  const out: ReturnType<typeof impls> = [];
  const last = (ts: Tok[]): string => {
    let d = 0;
    let r = "";
    for (const x of ts) {
      if (x.t === "<") d++;
      else if (x.t === ">") d--;
      else if (d === 0 && x.ident && x.t !== "dyn" && x.t !== "mut") r = x.t;
    }
    return r;
  };
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.t !== "impl" || !toks[i]!.ident) continue;
    let j = i + 1;
    let ang = 0;
    const hdr: Tok[] = [];
    for (; j < toks.length; j++) {
      const x = toks[j]!;
      if (x.t === "<") ang++;
      else if (x.t === ">" && toks[j - 1]!.t !== "-") ang--;
      else if ((x.t === "{" || x.t === ";") && ang <= 0) break;
      hdr.push(x);
    }
    if (toks[j]?.t !== "{") continue;
    let h = hdr;
    if (h[0]?.t === "<") {
      let d = 0;
      let q = 0;
      for (; q < h.length; q++) {
        if (h[q]!.t === "<") d++;
        else if (h[q]!.t === ">" && --d === 0) break;
      }
      h = h.slice(q + 1);
    }
    const w = h.findIndex((x) => x.t === "where");
    if (w >= 0) h = h.slice(0, w);
    const f = h.findIndex((x) => x.t === "for");
    const fns: { name: string; line: number }[] = [];
    let depth = 0;
    for (let k = j; k < toks.length; k++) {
      const x = toks[k]!;
      if (x.t === "{") depth++;
      else if (x.t === "}" && --depth === 0) break;
      else if (depth === 1 && x.t === "fn" && toks[k + 1]?.ident) fns.push({ name: toks[k + 1]!.t, line: x.line });
    }
    out.push({ trait: f >= 0 ? last(h.slice(0, f)) : undefined, self: last(f >= 0 ? h.slice(f + 1) : h), fns });
  }
  return out;
}

test("the contract's upstream fns each carry a stub or a rustc marker; stubs name upstream fns", async () => {
  const { UPSTREAM } = await import("../../scripts/lib/common.ts");
  const lib_rs = readFileSync(join(UPSTREAM, LINTS_SRC, "lib.rs"), "utf8");
  // upstream: the contract's fns, `<path>:<line> <name>`
  const want = new Set<string>();
  const lexed = new Map<string, ReturnType<typeof impls>>();
  for (const row of SUB_PASSES) {
    const ty = row.ty.split("::").pop()!;
    const needs_new = lib_rs.includes(`${row.ty}::new(`);
    for (const file of row.files) {
      let is = lexed.get(file);
      if (is === undefined) lexed.set(file, (is = impls(lex(UPSTREAM, file))));
      for (const i of is) {
        if (i.self !== ty) continue;
        if (i.trait === "EarlyLintPass" || i.trait === "LateLintPass") for (const f of i.fns) want.add(`${file}:${f.line} ${f.name}`);
        else if (i.trait === undefined && needs_new) for (const f of i.fns) if (f.name === "new") want.add(`${file}:${f.line} ${f.name}`);
      }
    }
  }
  expect(want.size).toBe(747); // at the pin: 604 `check_*` fns of the 368 impls, and 143 `new`s
  // the port: `// stub:` and `// rustc:` markers under src/clippy_lints and src/clippy_utils
  const stubs = new Set<string>();
  const ported = new Set<string>();
  const fns = new Map<string, Set<string>>();
  for (const f of [...walk(join(SRC, "clippy_lints")), ...walk(join(SRC, "clippy_utils"))]) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const r = RUSTC.exec(line);
      if (r !== null) ported.add(`${r[1]}:${r[2]} ${r[3]}`);
      if (!line.trimStart().startsWith("// stub: ")) continue;
      const m = STUB.exec(line);
      expect([relative(REPO, f), line, m !== null]).toEqual([relative(REPO, f), line, true]);
      const path = m![1]!;
      let set = fns.get(path);
      if (set === undefined) fns.set(path, (set = new Set(rustFns(path, UPSTREAM).map((x) => `${x.line} ${x.name}`))));
      expect([path, set.has(`${m![2]} ${m![3]}`)]).toEqual([path, true]);
      stubs.add(`${path}:${m![2]} ${m![3]}`);
    }
  }
  expect([...want].filter((k) => !stubs.has(k) && !ported.has(k))).toEqual([]);
  expect([...stubs].filter((k) => ported.has(k))).toEqual([]);
});

/** The hand module of a sub-pass type path (`a::b::T`): `a/b.ts` or `a/b/mod.ts`. */
function moduleOf(ty: string): [string, string] {
  const parts = ty.split("::");
  const name = parts.pop()!;
  const base = join(SRC, "clippy_lints", ...parts);
  return [existsSync(`${base}.ts`) ? `${base}.ts` : `${base}/mod.ts`, name];
}

test("every sub-pass type is exported with its lint_vec", async () => {
  for (const row of SUB_PASSES) {
    const [file, name] = moduleOf(row.ty);
    const m = (await import(file)) as Record<string, unknown>;
    const T = m[name] as { lint_vec(): { name: string }[] };
    expect([row.ty, typeof T]).toEqual([row.ty, "function"]);
    expect([row.ty, T.lint_vec().map((l) => l.name.toLowerCase())]).toEqual([row.ty, [...row.lints]]);
  }
  // the pre-expansion passes register_lint_passes builds
  const lib = readFileSync(join(SRC, "clippy_lints/lib.ts"), "utf8");
  expect(lib).toContain("attrs.EarlyAttributes.new(conf)");
  expect(lib).toContain("nonstandard_macro_braces.MacroBraces.new(conf)");
});

test("every method or constructor carrying a stub marker stops unported", async () => {
  let checked = 0;
  for (const file of FILES) {
    const lines = readFileSync(file, "utf8").split("\n");
    if (!lines.some((l) => l.trimStart().startsWith("// stub: ") || /^\s+static default\(\)/.test(l))) continue;
    const m = (await import(file)) as Record<string, new () => object>;
    let cls: string | undefined; // the class whose body the line is in
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const c = /^export class (\w+)/.exec(line);
      if (c !== null) cls = c[1];
      else if (line.startsWith("}")) cls = undefined;
      const where = `${relative(REPO, file)}:${i + 1}`;
      // `#[derive(Default)]` stubs have no upstream fn to mark: their body is the `unported` call
      if (cls !== undefined && /^\s+static default\(\)/.test(line) && /^\s+return unported\(/.test(lines[i + 1]!)) {
        expect([where, () => (m[cls!] as unknown as { default(): unknown }).default()]).toEqual([where, expect.any(Function)]);
        expect(() => (m[cls!] as unknown as { default(): unknown }).default()).toThrow(Unported);
        checked++;
        continue;
      }
      if (!line.trimStart().startsWith("// stub: ")) continue;
      const next = lines[i + 1]!;
      const prev = lines[i - 1]!;
      const ctor = /^\s+static new\(/.exec(next);
      const method = /^(\w+)\.prototype\.(\w+) = function/.exec(next);
      if (ctor !== null && cls !== undefined) {
        expect(() => (m[cls!] as unknown as { new: () => unknown }).new()).toThrow(Unported);
      } else if (method !== null) {
        const self = new m[method[1]!]!() as Record<string, (...args: unknown[]) => void>;
        expect([where, () => self[method[2]!]!.call(self)]).toEqual([where, expect.any(Function)]);
        expect(() => self[method[2]!]!.call(self)).toThrow(Unported);
      } else if (/if \(cx instanceof LateContext\) \{$/.test(prev) || /^\s+\} else \{$/.test(prev)) {
        // a dual early/late pass: the marker is inside the one method, on the side it implements
        let a = i;
        while (a > 0 && !/^\w+\.prototype\.\w+ = function/.test(lines[a]!)) a--;
        const d = /^(\w+)\.prototype\.(\w+) = function/.exec(lines[a]!)!;
        const self = new m[d[1]!]!() as Record<string, (...args: unknown[]) => void>;
        const cx = prev.includes("instanceof LateContext") ? (Object.create(LateContext.prototype) as unknown) : {};
        expect(() => self[d[2]!]!.call(self, cx)).toThrow(Unported);
      } else {
        expect([where, "a stub marker over `static new(`, `T.prototype.f = function` or a dual pass's branch"]).toEqual([where, ""]);
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

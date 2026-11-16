// The clippy_lints contract (lane clippy-contract-a; root decision "codegen-clippy-macros N5"), checked:
// - every `// stub: <path>:<line> <name> (lane <group>)` marker names an upstream fn at that line;
// - every sub-pass of lib.rs (lint_tables.gen.ts `SUB_PASSES`) is exported by its hand module with the generated `lint_vec`, and
//   its constructor form exists (`new`, `default` or a unit value);
// - every stub stops `unported` (a dual early/late pass's method only on the side that implements it);
// - contract.d.ts's ambient blocks name modules that do not exist yet, and every import of a declared specifier resolves to that
//   module from the importing file, so no block hides a wrong path.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { rustFns } from "../../scripts/lib/rust-fns.ts";
import { LateContext } from "../rustc_lint/context.ts";
import { Unported } from "../std/panic.ts";
import { SUB_PASSES } from "./lint_tables.gen.ts";

const SRC = resolve(import.meta.dir, "..");
const REPO = resolve(SRC, "..");

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

test("every stub marker names an upstream fn", async () => {
  const { UPSTREAM } = await import("../../scripts/lib/common.ts");
  const fns = new Map<string, Set<string>>();
  let n = 0;
  for (const f of FILES) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trimStart().startsWith("// stub: ")) continue;
      const m = STUB.exec(line);
      expect([relative(REPO, f), line, m !== null]).toEqual([relative(REPO, f), line, true]);
      const path = m![1]!;
      let set = fns.get(path);
      if (set === undefined) fns.set(path, (set = new Set(rustFns(path, UPSTREAM).map((x) => `${x.line} ${x.name}`))));
      expect([path, set.has(`${m![2]} ${m![3]}`)]).toEqual([path, true]);
      n++;
    }
  }
  expect(n).toBe(747); // 604 `check_*` + 143 `new` (the 28 `#[derive(Default)]` stubs have no upstream fn, so no marker)
});

/** The hand module of a sub-pass type path (`a::b::T`): `a/b.ts` or `a/b/mod.ts`. */
function moduleOf(ty: string): [string, string] {
  const parts = ty.split("::");
  const name = parts.pop()!;
  const base = join(SRC, "clippy_lints", ...parts);
  return [existsSync(`${base}.ts`) ? `${base}.ts` : `${base}/mod.ts`, name];
}

test("every sub-pass type is exported with its lint_vec, and its stubs stop unported", async () => {
  const lib = readFileSync(join(SRC, "clippy_lints/lib.ts"), "utf8");
  const seen = new Set<string>();
  let methods = 0;
  for (const row of SUB_PASSES) {
    const [file, name] = moduleOf(row.ty);
    const m = (await import(file)) as Record<string, unknown>;
    const T = m[name] as (new () => object) & { lint_vec(): { name: string }[]; new?: unknown; default?: unknown };
    expect([row.ty, typeof T]).toEqual([row.ty, "function"]);
    expect([row.ty, T.lint_vec().map((l) => l.name.toLowerCase())]).toEqual([row.ty, [...row.lints]]);
    if (seen.has(row.ty)) continue;
    seen.add(row.ty);
    // constructors: a stub `new` / `default` stops unported
    for (const ctor of ["new", "default"] as const) {
      const f = (T as unknown as Record<string, unknown>)[ctor];
      if (typeof f === "function") expect(() => (f as () => unknown).call(T)).toThrow(Unported);
    }
    // the `check_*` stubs: every prototype method assigned in the module
    const text = readFileSync(file, "utf8");
    const self = new T();
    for (const a of text.matchAll(new RegExp(`^${name}\\.prototype\\.(\\w+) = function`, "gm"))) {
      const method = (self as Record<string, (...args: unknown[]) => void>)[a[1]!]!;
      const body = text.slice(a.index!, text.indexOf("\n};\n", a.index!));
      if (body.includes("if (cx instanceof LateContext)")) {
        // dual: one side may be the other trait's provided default
        const late = Object.create(LateContext.prototype) as unknown;
        const sides: [unknown, boolean][] = [
          [late, /instanceof LateContext\) \{\n\s+\/\/ stub:/.test(body)],
          [{}, /\} else \{\n\s+\/\/ stub:/.test(body)],
        ];
        for (const [cx, stub] of sides) {
          if (stub) expect(() => method.call(self, cx)).toThrow(Unported);
          else expect(method.call(self, cx)).toBe(undefined);
        }
      } else {
        expect(() => method.call(self)).toThrow(Unported);
      }
      methods++;
    }
  }
  expect(seen.size).toBe(365);
  expect(methods).toBe(SUB_PASSES_METHODS);
  // the pre-expansion passes register_lint_passes builds
  expect(lib).toContain("attrs.EarlyAttributes.new(conf)");
  expect(lib).toContain("nonstandard_macro_braces.MacroBraces.new(conf)");
});
/** Prototype methods over the 365 types: the 368 `EarlyLintPass`/`LateLintPass` impls have 604 `check_*` fns, and the dual
 * `Documentation`'s two `check_attributes` share one method. With 143 `new` and 28 `#[derive(Default)]` stubs: 604 + 143 + 28 = 775. */
const SUB_PASSES_METHODS = 603;

const CONTRACT = join(SRC, "clippy_lints/contract.d.ts");
/** Each ambient block's specifier and the module it stands for. */
const BLOCKS: Record<string, string> = {
  "../clippy_config/lib.ts": "clippy_config/lib.ts",
  "../../clippy_config/lib.ts": "clippy_config/lib.ts",
  "./lib.gen.ts": "clippy_lints/lib.gen.ts",
};

test("contract.d.ts names missing modules, and no block hides a wrong path", () => {
  const blocks = [...readFileSync(CONTRACT, "utf8").matchAll(/^declare module "(.+)\*" \{/gm)].map((m) => m[1]!);
  expect(blocks.sort()).toEqual(Object.keys(BLOCKS).sort());
  for (const target of new Set(Object.values(BLOCKS))) expect([target, existsSync(join(SRC, target))]).toEqual([target, false]);
  const all: string[] = [];
  const walk_all = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk_all(p);
      else if (e.name.endsWith(".ts")) all.push(p);
    }
  };
  walk_all(SRC);
  let uses = 0;
  for (const f of all) {
    if (f === CONTRACT || f === import.meta.path) continue;
    const text = readFileSync(f, "utf8");
    for (const [spec, target] of Object.entries(BLOCKS)) {
      if (!text.includes(`"${spec}"`)) continue;
      // a specifier that resolves to an existing file never reaches the block
      if (existsSync(resolve(dirname(f), spec))) continue;
      expect([relative(REPO, f), spec, resolve(dirname(f), spec)]).toEqual([relative(REPO, f), spec, join(SRC, target)]);
      uses++;
    }
  }
  expect(uses).toBeGreaterThan(100);
});

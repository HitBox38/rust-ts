// Not ported code: guards for src/rustfmt/'s module conventions (lane rustfmt-contract-1, review rustfmt-contract-1 N2, N3, N8).
// - N2: the config's load order. A generated config module that imports its hand module back (`macro_names.gen.ts`,
//   `file_lines.gen.ts`, and `create_config.gen.ts` through them) must not be evaluated before that hand module, so nothing
//   outside src/rustfmt/config/ imports a `config/*.gen.ts`; config/mod.ts imports the hand modules first.
// - N3: the hand-written contract src/rustfmt/contract_lib.d.ts (and the generated contract.gen.d.ts): a block names a module that
//   does not exist yet, and every import written with a block's specifier resolves, from the importing file, to the module the
//   block declares (`*` makes the name a pattern, which would otherwise also accept a wrong-depth import).
// - N8: only test files import a `*.test_support.ts`.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";
import { STUBS } from "./config/serde_stubs.test_support.ts";

const SRC = resolve(import.meta.dir, "..");
const RUSTFMT = join(SRC, "rustfmt");
const CONFIG = join(RUSTFMT, "config");

/** Every `.ts` file under src/ with its text, keyed by absolute path. */
function src_files(): Map<string, string> {
  const files = new Map<string, string>();
  for (const f of new Bun.Glob("**/*.ts").scanSync({ cwd: SRC })) {
    // this file: its probe texts are strings, not imports
    if (join(SRC, f) !== import.meta.path) files.set(join(SRC, f), readFileSync(join(SRC, f), "utf8"));
  }
  return files;
}

/** The module specifiers a file names: `from "x"`, `import "x"`, `import("x")`, `require("x")`. */
function specifiers(text: string): { spec: string; type_only: boolean }[] {
  const out: { spec: string; type_only: boolean }[] = [];
  for (const m of text.matchAll(/\b(import|export)\s+(type\s+)?[^;'"]*?\bfrom\s*["']([^"']+)["']/g)) out.push({ spec: m[3]!, type_only: m[2] !== undefined });
  for (const m of text.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push({ spec: m[1]!, type_only: false });
  for (const m of text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1]!, type_only: false });
  return out;
}

// ---- N2 ----------------------------------------------------------------------------------------------------------

/** Files outside src/rustfmt/config/ that import a `config/*.gen.ts` (a type-only import is erased, so it is allowed). */
function gen_import_violations(files: Map<string, string>): string[] {
  const bad: string[] = [];
  for (const [file, text] of files) {
    if (dirname(file) === CONFIG) continue;
    for (const { spec, type_only } of specifiers(text)) {
      if (type_only || !spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      if (dirname(target) === CONFIG && target.endsWith(".gen.ts")) bad.push(`${relative(SRC, file)} imports ${spec}`);
    }
  }
  return bad;
}

test("N2: nothing outside src/rustfmt/config/ imports a config/*.gen.ts (load order)", () => {
  expect(gen_import_violations(src_files())).toEqual([]);
  // the scan catches one
  const probe = new Map([[join(RUSTFMT, "zz_probe.ts"), 'import { MacroName } from "./config/macro_names.gen.ts";\n']]);
  expect(gen_import_violations(probe)).toEqual(['rustfmt/zz_probe.ts imports ./config/macro_names.gen.ts']);
  const type_only = new Map([[join(RUSTFMT, "zz_probe.ts"), 'import type { MacroName } from "./config/macro_names.gen.ts";\n']]);
  expect(gen_import_violations(type_only)).toEqual([]);
});

const SCRATCH = test_scratch_dir("rustfmt-load-order");
const PLUGIN = join(SCRATCH, "serde_stubs_plugin.ts");
writeFileSync(
  PLUGIN,
  `import { plugin } from "bun";
const STUBS = ${JSON.stringify(STUBS)};
plugin({
  name: "serde-stubs",
  setup(build) {
    build.onResolve({ filter: /\\/vendor\\/serde/ }, (args) => (args.path in STUBS ? { path: args.path, namespace: "serdestub" } : undefined));
    build.onLoad({ filter: /.*/, namespace: "serdestub" }, (args) => ({
      contents: STUBS[args.path].map((n) => "export const " + n + " = () => { throw new Error('serde stub'); };").join("\\n") + "\\nexport {};",
      loader: "js",
    }));
  },
});
`,
);

/** Loads `module` (under src/rustfmt/config/) first, in a fresh process with the serde stubs; the first error line or "OK". */
function load_first(module: string): string {
  const entry = join(SCRATCH, `entry_${module.replaceAll(/\W/g, "_")}.ts`);
  writeFileSync(entry, `await import(${JSON.stringify(join(CONFIG, module))});\nconsole.log("OK");\n`);
  const r = Bun.spawnSync(["bun", "--preload", PLUGIN, entry], { cwd: SCRATCH });
  const out = r.stdout.toString() + r.stderr.toString();
  return out.includes("OK") && r.exitCode === 0 ? "OK" : (out.match(/ReferenceError: [^\n]*/)?.[0] ?? `exit ${r.exitCode}: ${out.slice(0, 200)}`);
}

test("N2: which config modules may be evaluated first", () => {
  const SERDE_EXISTS = Object.keys(STUBS).some((s) => existsSync(join(CONFIG, s)));
  if (SERDE_EXISTS) return; // the probe stubs serde; once vendor-serde-de lands the plugin no longer matches every module
  // The three that import their hand module back fail; config/mod.ts, the hand modules and the others do not.
  expect(load_first("macro_names.gen.ts")).toBe("ReferenceError: Cannot access 'MacroName' before initialization.");
  expect(load_first("file_lines.gen.ts")).toBe("ReferenceError: Cannot access 'Range' before initialization.");
  expect(load_first("create_config.gen.ts")).toBe("ReferenceError: Cannot access 'MacroName' before initialization.");
  expect(load_first("options.gen.ts")).toBe("OK");
  expect(load_first("lists.gen.ts")).toBe("OK");
  expect(load_first("mod.ts")).toBe("OK");
  expect(load_first("macro_names.ts")).toBe("OK");
});

// ---- N3 ----------------------------------------------------------------------------------------------------------

interface Block {
  contract: string;
  /** the block's name without the trailing `*` */
  spec: string;
  /** the file the block declares (absolute) */
  module: string;
}

/** The blocks of the two contracts. contract_lib.d.ts names `../rustfmt/<path>` (users: files directly in src/rustfmt/),
 *  contract.gen.d.ts names `../../<path under src/>` (users: files two directories below src/). */
function contract_blocks(): Block[] {
  const blocks: Block[] = [];
  for (const [name, base] of [
    ["contract_lib.d.ts", RUSTFMT],
    ["contract.gen.d.ts", join(SRC, "x", "y")],
  ] as const) {
    const text = readFileSync(join(RUSTFMT, name), "utf8");
    for (const m of text.matchAll(/^declare module "([^"]+)" \{/gm)) {
      const n = m[1]!;
      expect(n.endsWith("*")).toBe(true);
      const spec = n.slice(0, -1);
      blocks.push({ contract: name, spec, module: resolve(base, spec) });
    }
  }
  return blocks;
}

/** Imports that a block's pattern matches but that do not resolve, from the importing file, to the block's module. */
function contract_violations(files: Map<string, string>, blocks: readonly Block[]): string[] {
  const bad: string[] = [];
  for (const [file, text] of files) {
    if (file.endsWith(".d.ts") && dirname(file) === RUSTFMT) continue; // the contracts themselves
    for (const { spec } of specifiers(text)) {
      for (const b of blocks) {
        if (!spec.startsWith(b.spec)) continue;
        if (spec !== b.spec || resolve(dirname(file), spec) !== b.module) {
          bad.push(`${relative(SRC, file)}: ${spec} (${b.contract} declares ${relative(SRC, b.module)})`);
        }
      }
    }
  }
  return bad;
}

test("N3: contract_lib.d.ts blocks name missing modules as ../rustfmt/<path> or ../vendor/<crate>/<path>", () => {
  const blocks = contract_blocks().filter((b) => b.contract === "contract_lib.d.ts");
  expect(blocks.length).toBeGreaterThan(0);
  for (const b of blocks) {
    expect(b.spec).toMatch(/^\.\.\/(rustfmt|vendor\/\w+)\/[\w/]+\.ts$/); // vendor blocks: root decision \"rustfmt crate-wide rules\" (4)
    // a stale block (its module has landed) must be deleted
    expect({ spec: b.spec, exists: existsSync(b.module) }).toEqual({ spec: b.spec, exists: false });
  }
});

test("N3: every import a contract block matches resolves to the block's module", () => {
  const blocks = contract_blocks();
  expect(contract_violations(src_files(), blocks)).toEqual([]);
  // the reviewer's case: a wrong-depth import from config/ type-checks through the `*` pattern, and fails here
  // (utils.ts has landed, so the probe uses visitor.ts's block; integ-w67, review rustfmt-contract-2 N1)
  const probe = new Map([[join(CONFIG, "zz_probe.ts"), 'import { SnippetProvider } from "../rustfmt/visitor.ts";\n']]);
  expect(contract_violations(probe, blocks)).toEqual(["rustfmt/config/zz_probe.ts: ../rustfmt/visitor.ts (contract_lib.d.ts declares rustfmt/visitor.ts)"]);
  // and for the generated contract inside src/rustfmt/: `../../vendor/...` from src/rustfmt/ itself is one level too far
  const gen_probe = new Map([[join(RUSTFMT, "zz_probe.ts"), 'import { deserialize_String } from "../../vendor/serde_core/de/impls.ts";\n']]);
  expect(contract_violations(gen_probe, blocks)).toEqual([
    "rustfmt/zz_probe.ts: ../../vendor/serde_core/de/impls.ts (contract.gen.d.ts declares vendor/serde_core/de/impls.ts)",
  ]);
});

// ---- N8 ----------------------------------------------------------------------------------------------------------

function test_support_violations(files: Map<string, string>): string[] {
  const bad: string[] = [];
  for (const [file, text] of files) {
    if (file.endsWith(".test.ts") || file.endsWith(".test_support.ts")) continue;
    for (const { spec } of specifiers(text)) if (spec.endsWith(".test_support.ts")) bad.push(`${relative(SRC, file)} imports ${spec}`);
  }
  return bad;
}

test("N8: only test files import a *.test_support.ts", () => {
  expect(test_support_violations(src_files())).toEqual([]);
  const probe = new Map([[join(CONFIG, "zz_probe.ts"), 'import { install_serde_stubs } from "./serde_stubs.test_support.ts";\n']]);
  expect(test_support_violations(probe)).toEqual(["rustfmt/config/zz_probe.ts imports ./serde_stubs.test_support.ts"]);
});

// tools/codegen item-macro expansion (newtype_index!, bitflags!) and the rustc_ast golden.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { debugFormatTemplate, evalFlagExpr, macroBody, parseBitflags, parseNewtypeIndex } from "./macros.ts";
import { generate, loadSet, loadTypeMap, REPO } from "./types.ts";

test("newtype_index! body", () => {
  const src = `x\nrustc_index::newtype_index! {\n    /// Doc.\n    #[orderable]\n    #[debug_format = "N({})"] // c\n    #[max = 0xFFFF_FFFF]\n    pub struct N {\n        /// First.\n        const FIRST = 1;\n    }\n}\n`;
  const d = parseNewtypeIndex(macroBody(src, 2)!);
  expect(d.name).toBe("N");
  expect(d.docs).toEqual([" Doc."]);
  expect(d.attrs.map((a) => [a.name, a.value])).toEqual([["orderable", undefined], ["debug_format", '"N({})"'], ["max", "0xFFFF_FFFF"]]);
  expect(d.consts).toEqual([{ docs: [" First."], attrs: [], name: "FIRST", expr: "1" }]);
  expect(debugFormatTemplate('"N({})"')).toBe("`N(${n})`");
  expect(debugFormatTemplate('"{}"')).toBe("`${n}`");
  expect(debugFormatTemplate('"{{x}}{}"')).toBe("`{x}${n}`");
  expect(() => debugFormatTemplate('"{:?}"')).toThrow();
});

test("bitflags! bodies and flag expressions", () => {
  const src = `bitflags::bitflags! {\n    #[derive(Debug)]\n    pub struct A: u8 {\n        const X = 1 << 0;\n        // c\n        const Y = 1 << 1;\n        const XY = Self::X.bits() | Self::Y.bits();\n        const _ = !0;\n    }\n    impl B: u16 { const Z = 0x8000; }\n}\n`;
  const ds = parseBitflags(macroBody(src, 1)!);
  expect(ds.map((d) => [d.form, d.name, d.bits, d.flags.map((f) => f.name)])).toEqual([
    ["struct", "A", "u8", ["X", "Y", "XY", "_"]],
    ["impl", "B", "u16", ["Z"]],
  ]);
  const known = new Map([["X", 1n], ["Y", 2n]]);
  expect(evalFlagExpr("Self::X.bits() | Self::Y.bits()", known, 8)).toBe(3n);
  expect(evalFlagExpr("!0", known, 8)).toBe(255n);
  expect(evalFlagExpr("(1 << 3) & !(1 << 3)", known, 16)).toBe(0n);
  expect(() => evalFlagExpr("foo()", known, 8)).toThrow();
});

// Missing upstream checkout: a visible skip, or a failure under RUST_TS_REQUIRE_PROBES=1.
const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler/rustc_ast/src/node_id.rs"));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
if (!HAVE_UPSTREAM && !REQUIRE_PROBES) console.log("SKIP: rustc_ast golden needs the upstream checkout; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

/** Generated files of the rustc_ast set on disk (`*.gen.ts` under src/rustc_ast and src/rustc_ast_ir). */
function genFilesOnDisk(src: string): string[] {
  const out: string[] = [];
  for (const dir of ["rustc_ast", "rustc_ast_ir"]) {
    for (const f of readdirSync(join(src, dir), { recursive: true }) as string[]) {
      if (f.endsWith(".gen.ts")) out.push(resolve(src, dir, f));
    }
  }
  return out.sort();
}

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("golden: generator reproduces src/rustc_ast + src/rustc_ast_ir", () => {
  if (!HAVE_UPSTREAM) throw new Error(`ERROR: upstream checkout missing (${UPSTREAM}) and RUST_TS_REQUIRE_PROBES=1`);
  const probe = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_ast.typedefs.json"), "utf8"));
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);
  const src = join(REPO, "src");
  const res = generate(probe, loadSet("rustc_ast"), loadTypeMap(), { set: "rustc_ast", out: src, srcRoot: src, pin, upstream: UPSTREAM });
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  expect(res.files.size).toBe(22); // 20 type modules + walkable.gen.ts + mut_walkable.gen.ts
  for (const [file, content] of res.files) expect(content).toBe(readFileSync(file, "utf8"));
  // no stale generated file left on disk
  expect(genFilesOnDisk(src)).toEqual([...res.files.keys()].map((f) => resolve(f)).sort());
});

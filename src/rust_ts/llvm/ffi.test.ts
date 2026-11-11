// rust-ts: the contract's completeness check (lane llir-core-a). ffi.ts must have one export per `fn` of ffi.rs at the pin, in
// ffi.rs's order, with ffi.rs's arity, and must be what ffi_gen.ts writes today (so an implementation added without
// regenerating, or a parser that drops a fn, fails here). The ffi.rs side is read by a separate, simpler scan than the
// generator's parser.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../../scripts/lib/common.ts";
import { Unported } from "../../std/panic.ts";
import { FFI_PATH, genFns, genTypes, implMap, parseFfi } from "../../../tools/llir/ffi_gen.ts";
import * as L from "./ffi.ts";

const FFI = join(UPSTREAM, FFI_PATH);
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HAVE = existsSync(FFI);
if (!HAVE && !REQUIRE) console.log(`SKIP: no upstream checkout at ${UPSTREAM}; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

/** `fn LLVM...(` declarations of ffi.rs, with their line and parameter count, by a scan independent of ffi_gen's parser. */
function scanFfi(src: string): { name: string; line: number; arity: number }[] {
  const out: { name: string; line: number; arity: number }[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*pub(?:\(crate\))? (?:safe |unsafe )?fn (LLVM\w+)/.exec(lines[i]!);
    if (!m) continue;
    // The parameter list runs to the `)` that closes the first `(` after the name; count top-level commas.
    let text = "";
    for (let j = i; j < lines.length; j++) {
      text += `${lines[j]!.replace(/\/\/.*$/, "")}\n`;
      if (/\)\s*(->[^;]*)?;\s*$/.test(lines[j]!.replace(/\/\/.*$/, ""))) break;
    }
    const open = text.indexOf("(", text.indexOf(m[1]!));
    let depth = 0;
    let params = "";
    for (let k = open; k < text.length; k++) {
      const c = text[k];
      if (c === "(") depth++;
      if (c === ")" && --depth === 0) break;
      if (k > open) params += c;
    }
    let commas = 0;
    let d = 0;
    for (let k = 0; k < params.length; k++) {
      const c = params[k];
      if (c === "(" || c === "<") d++;
      else if (c === ")" || (c === ">" && params[k - 1] !== "-")) d--;
      else if (c === "," && d === 0) commas++;
    }
    const arity = params.trim() === "" ? 0 : commas + 1 - (params.trim().endsWith(",") ? 1 : 0);
    out.push({ name: m[1]!, line: i + 1, arity });
  }
  return out;
}

describe.skipIf(!HAVE && !REQUIRE)("llir contract", () => {
  const src = HAVE ? readFileSync(FFI, "utf8") : "";
  const contract = readFileSync(join(import.meta.dir, "ffi.ts"), "utf8");

  test("one export per ffi.rs fn, in order, with its line and arity", () => {
    const want = scanFfi(src);
    expect(want.length).toBe(381);
    const got = [...contract.matchAll(/\/\/ rustc: \S+:(\d+) (\w+)\nexport const (\w+): \((.*)\) => .* = (?:bind|stub)\(/g)].map((m) => ({
      name: m[3]!,
      line: Number(m[1]),
      // Parameters are `Name: Type`; a type never holds `, Word: `.
      arity: m[4]!.trim() === "" ? 0 : m[4]!.split(/, (?=[A-Za-z_]\w*: )/).length,
    }));
    expect(got).toEqual(want);
  });

  test("every export exists at run time, and stubs stop with their name", () => {
    const lib = L as unknown as Record<string, unknown>;
    for (const f of scanFfi(src)) expect(typeof lib[f.name]).toBe("function");
    const stubbed = scanFfi(src).find((f) => !L.IMPLEMENTED.has(f.name))!;
    expect(() => (lib[stubbed.name] as () => unknown)()).toThrow(Unported);
    expect(() => (lib[stubbed.name] as () => unknown)()).toThrow(`llir: ${stubbed.name}`);
  });

  test("ffi.ts and ffi_types.ts are what the generator writes now", async () => {
    const items = parseFfi(src);
    expect(readFileSync(join(import.meta.dir, "ffi_types.ts"), "utf8")).toBe(genTypes(items));
    expect(contract).toBe(genFns(items, await implMap(items, import.meta.dir)));
  });

  test("`// rustc:` markers into ffi.rs outside the generated files name the item on their line", () => {
    const lines = src.split("\n");
    for (const f of ["support.ts"]) {
      const text = readFileSync(join(import.meta.dir, f), "utf8");
      for (const m of text.matchAll(/\/\/ rustc: compiler\/rustc_codegen_llvm\S+:(\d+) (\w+)/g)) expect(lines[Number(m[1]) - 1]).toContain(m[2]!);
    }
  });
});

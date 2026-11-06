// The generated long descriptions (tools/codegen/error_codes.ts): byte-identical to the pin's `.md` files, in a module nothing
// imports statically. A string module is easy to corrupt with non-ASCII (docs/reviews/fixers-40.md section 7), so this hashes
// the text as UTF-8 against each file's bytes.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { display_ErrCode, ErrCodeDescription, ErrCode, ERROR_CODES, try_find_description } from "../../src/rustc_errors/codes.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const GEN = join(REPO, "src", "rustc_errors", "error_codes_text.gen.ts");
const { ERROR_CODE_TEXT } = (await import(GEN)) as typeof import("../../src/rustc_errors/error_codes_text.gen.ts");
const sha = (b: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const mdDir = join(UPSTREAM, "compiler", "rustc_error_codes", "src", "error_codes");

describe("error_codes_text.gen.ts", () => {
  test("every code of error_codes! has its file's exact bytes, and nothing else is there", () => {
    expect(Object.keys(ERROR_CODE_TEXT).map(Number).sort((a, b) => a - b)).toEqual(ERROR_CODES.map((c) => ErrCode.as_u32(c)).sort((a, b) => a - b));
    let bytes = 0;
    let nonAscii = 0;
    for (const c of ERROR_CODES) {
      const file = readFileSync(join(mdDir, `${display_ErrCode(c)}.md`));
      const text = new TextEncoder().encode(ERROR_CODE_TEXT[ErrCode.as_u32(c)]!);
      expect([display_ErrCode(c), sha(text)]).toEqual([display_ErrCode(c), sha(file)]);
      bytes += file.length;
      if (file.some((b) => b >= 0x80)) nonAscii++;
    }
    expect(ERROR_CODES.length).toBe(518);
    expect(bytes).toBe(418_411);
    // The files that could break a string module exist, so this comparison would see it.
    expect(nonAscii).toBe(12);
    expect(readdirSync(mdDir).filter((f) => f.endsWith(".md")).length).toBe(518);
  });
  test("the module itself is ASCII and imports nothing", () => {
    const src = readFileSync(GEN, "utf8");
    expect(/[^\x00-\x7f]/.test(src)).toBe(false);
    expect(/^\s*import\b/m.test(src)).toBe(false);
  });
  test("the comparison can fail: one changed character changes the hash", () => {
    const t = ERROR_CODE_TEXT[80]!;
    expect(sha(t.replace("a", "b"))).not.toBe(sha(t));
  });
  test("text() returns it, through try_find_description", () => {
    const r = try_find_description(ERROR_CODES[0]!);
    if (r.$ !== "Ok") throw new Error("no description");
    expect(r._0).toBeInstanceOf(ErrCodeDescription);
    expect(r._0.text()).toBe(ERROR_CODE_TEXT[ErrCode.as_u32(ERROR_CODES[0]!)]!);
    expect(try_find_description(ErrCode.from_u32(9999)).$).toBe("Err");
  });
  test("no file imports it statically: it must stay out of every startup", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith(".ts") && p !== GEN && /(?:from\s+|import\s+)["'][^"']*error_codes_text\.gen\.ts["']/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(join(REPO, "src"));
    expect(hits).toEqual([]);
    expect(existsSync(GEN)).toBe(true);
  });
});

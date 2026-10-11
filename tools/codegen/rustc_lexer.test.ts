// Validation of tools/codegen/types.ts against the hand port of rustc_lexer (src/rustc_lexer/lib.ts).
//  - golden: regenerating from the committed probe JSON reproduces fixtures/src/rustc_lexer/lib.gen.ts
//  - runtime: generated debug_* === hand-written debug_* on every token of library/core (+ synthetic values)
//  - types: generated and hand-written types are mutually assignable (checked by `tsc --noEmit -p .`)
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLAIN, PRETTY } from "../../src/std/fmt.ts";
import { Str } from "../../src/std/str.ts";
import * as H from "../../src/rustc_lexer/lib.ts";
import * as G from "./fixtures/src/rustc_lexer/lib.gen.ts";
import { generate, loadSet, loadTypeMap, parseIntLit, REPO } from "./types.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

// ---- type-level: mutual assignability ----
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const yes = <T extends true>(): T | undefined => undefined;
yes<Same<H.Token, G.Token>>();
yes<Same<H.TokenKind, G.TokenKind>>();
yes<Same<H.DocStyle, G.DocStyle>>();
yes<Same<H.LiteralKind, G.LiteralKind>>();
yes<Same<H.GuardedStr, G.GuardedStr>>();
yes<Same<H.RawStrError, G.RawStrError>>();
yes<Same<H.Base, G.Base>>();
yes<Same<H.FrontmatterAllowed, G.FrontmatterAllowed>>();
// Cursor: the hand class also has methods; compare its data fields.
yes<Same<Pick<H.Cursor, keyof G.Cursor>, G.Cursor>>();
// companion consts
yes<Same<typeof H.TokenKind, typeof G.TokenKind>>();
yes<Same<typeof H.DocStyle, typeof G.DocStyle>>();
yes<Same<typeof H.Base, typeof G.Base>>();
yes<Same<typeof H.FrontmatterAllowed, typeof G.FrontmatterAllowed>>();
yes<Same<typeof H.Base_discriminant, typeof G.Base_discriminant>>();
yes<Same<typeof H.debug_Token, typeof G.debug_Token>>();
yes<Same<typeof H.debug_TokenKind, typeof G.debug_TokenKind>>();
yes<Same<typeof H.debug_RawStrError, typeof G.debug_RawStrError>>();

test("golden: generator reproduces the committed rustc_lexer fixture", () => {
  const probe = JSON.parse(readFileSync(join(FIXTURES, "rustc_lexer.typedefs.json"), "utf8"));
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);
  const out = join(FIXTURES, "src");
  const res = generate(probe, loadSet("rustc_lexer"), loadTypeMap(), { set: "rustc_lexer", out, srcRoot: join(REPO, "src"), pin });
  const file = join(out, "rustc_lexer", "lib.gen.ts");
  expect(res.files.get(file)).toBe(readFileSync(file, "utf8"));
  expect(res.report.unknown_types).toEqual({});
  expect(res.report.errors).toEqual([]);
});

test("companion consts and discriminants equal the hand port", () => {
  expect(G.TokenKind).toEqual(H.TokenKind);
  expect(Object.values(G.TokenKind).every((v) => Object.isFrozen(v))).toBe(true);
  expect(G.DocStyle).toEqual(H.DocStyle);
  expect(G.Base).toEqual(H.Base);
  expect(G.Base_discriminant).toEqual(H.Base_discriminant);
  expect(G.FrontmatterAllowed).toEqual(H.FrontmatterAllowed);
});

test("debug of synthetic RawStrError / GuardedStr / LiteralKind values", () => {
  const errs: H.RawStrError[] = [
    { $: "InvalidStarter", bad_char: 0x7e },
    { $: "InvalidStarter", bad_char: 0x27 },
    { $: "InvalidStarter", bad_char: 0x301 },
    { $: "NoTerminator", expected: 3, found: 1, possible_terminator_offset: undefined },
    { $: "NoTerminator", expected: 3, found: 1, possible_terminator_offset: 7 },
    { $: "TooManyDelimiters", found: 256 },
  ];
  const kinds: H.LiteralKind[] = [];
  for (const b of Object.values(H.Base)) {
    kinds.push({ $: "Int", base: b, empty_int: false }, { $: "Float", base: b, empty_exponent: true });
  }
  for (const $ of ["Char", "Byte", "Str", "ByteStr", "CStr"] as const) kinds.push({ $, terminated: true }, { $, terminated: false });
  for (const $ of ["RawStr", "RawByteStr", "RawCStr"] as const) kinds.push({ $, n_hashes: undefined }, { $, n_hashes: 2 });
  for (const f of [PLAIN, PRETTY]) {
    for (const e of errs) expect(G.debug_RawStrError(e, f)).toBe(H.debug_RawStrError(e, f));
    for (const k of kinds) expect(G.debug_LiteralKind(k, f)).toBe(H.debug_LiteralKind(k, f));
    const g = { n_hashes: 2, terminated: false, token_len: 9 };
    expect(G.debug_GuardedStr(g, f)).toBe(H.debug_GuardedStr(g, f));
  }
});

function* rsFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* rsFiles(p);
    else if (e.endsWith(".rs")) yield p;
  }
}

test(
  "debug_Token: generated === hand-written on every token of library/core",
  async () => {
    const { UPSTREAM } = await import("../../scripts/lib/common.ts");
    const core = join(UPSTREAM, "library", "core");
    if (!existsSync(core)) {
      console.log(`SKIP: ${core} missing`);
      return;
    }
    let files = 0;
    let tokens = 0;
    for (const p of rsFiles(core)) {
      const src = Str.from(readFileSync(p, "utf8"));
      files++;
      for (const tok of H.tokenize(src, H.FrontmatterAllowed.Yes)) {
        tokens++;
        const h = H.debug_Token(tok, PLAIN);
        const g = G.debug_Token(tok, PLAIN);
        if (h !== g) expect(`${p}: ${g}`).toBe(`${p}: ${h}`);
        const hp = H.debug_Token(tok, PRETTY);
        const gp = G.debug_Token(tok, PRETTY);
        if (hp !== gp) expect(`${p}: ${gp}`).toBe(`${p}: ${hp}`);
      }
    }
    console.log(`library/core: ${files} files, ${tokens} tokens, generated debug_Token identical (plain + pretty)`);
    expect(files).toBeGreaterThan(100);
  },
  600_000,
);

test("parseIntLit", () => {
  expect(parseIntLit("2")).toBe(2n);
  expect(parseIntLit("0x1F_u8")).toBe(31n);
  expect(parseIntLit("- 1")).toBe(-1n);
  expect(parseIntLit("0o17")).toBe(15n);
  expect(parseIntLit("1 << 2")).toBeUndefined();
});

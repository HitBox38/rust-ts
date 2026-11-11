// tools/codegen/options.ts: the committed src/rustc_session/options.gen.ts and
// options/mitigation_coverage.gen.ts are what the generator produces from the upstream checkout
// (skips visibly without the checkout).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { emitEnumCodecs, generate } from "./options.ts";

const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler", "rustc_session")) && existsSync(join(UPSTREAM, "compiler", "rustc_target"));
if (!HAVE_UPSTREAM) console.log(`SKIP: upstream checkout missing at ${UPSTREAM}`);

test.skipIf(!HAVE_UPSTREAM)("rustc_session option tables are up to date", () => {
  const files = generate();
  expect([...files.keys()].sort()).toEqual(["src/rustc_session/options.gen.ts", "src/rustc_session/options/mitigation_coverage.gen.ts"]);
  for (const [rel, text] of files) expect([rel, readFileSync(join(REPO, rel), "utf8") === text]).toEqual([rel, true]);
});

// The enum codec shapes of rustc_macros serialize.rs (`decodable_body` / `encodable_body`) for the variant counts that
// options.rs does not reach today (driver-cli-2; docs/reviews/driver-cli.md N3): no variant decodes as the
// `has no variants` panic without reading and encodes nothing; one unit variant reads and writes nothing; from
// `u8::MAX` variants on the tag is a `usize`.
test("enum codec shapes by variant count", () => {
  const gen = (n: number, field = false): string => {
    const body: string[] = [];
    const variants = Array.from({ length: n }, (_, i) => ({ name: `V${i}`, field: field ? { enc: "encode_X", dec: "decode_X" } : undefined }));
    emitEnumCodecs(body, "E", "E", variants, (v, x) => (x === undefined ? JSON.stringify(v) : `E.${v}(${x})`), "self.$", "self._0");
    return body.join("\n");
  };
  const zero = gen(0);
  expect(zero).toContain('return panic("`E` has no variants to decode");');
  expect(zero).not.toContain("read_");
  expect(zero).not.toContain("emit_");
  const one = gen(1);
  expect(one).toContain('return "V0";');
  expect(one).not.toContain("read_");
  expect(one).not.toContain("emit_");
  const oneField = gen(1, true);
  expect(oneField).toContain("return E.V0(decode_X(__decoder));");
  expect(oneField).toContain("encode_X(self._0, __encoder);");
  expect(oneField).not.toContain("read_u8");
  expect(oneField).not.toContain("emit_u8");
  const two = gen(2);
  expect(two).toContain("const __tag = __decoder.read_u8();");
  expect(two).toContain("__encoder.emit_u8(E_discriminant[self.$]);");
  expect(two).toContain("expected 0..2, actual ${__tag}");
  expect(two).not.toContain("switch (self.$)");
  expect(gen(254)).toContain("read_u8()");
  expect(gen(255)).toContain("const __tag = __decoder.read_usize();");
  expect(gen(255)).toContain("__encoder.emit_usize(E_discriminant[self.$]);");
});

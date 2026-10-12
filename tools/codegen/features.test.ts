// tools/codegen/features.ts: the committed src/rustc_feature/*.gen.ts are what the generator
// produces from the upstream checkout (skips visibly without the checkout).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { generate } from "./features.ts";

const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler", "rustc_feature"));
if (!HAVE_UPSTREAM) console.log(`SKIP: upstream checkout missing at ${UPSTREAM}`);

test.skipIf(!HAVE_UPSTREAM)("rustc_feature generated tables are up to date", () => {
  const files = generate();
  expect([...files.keys()].sort()).toEqual([
    "src/rustc_feature/accepted.gen.ts",
    "src/rustc_feature/builtin_attrs.gen.ts",
    "src/rustc_feature/removed.gen.ts",
    "src/rustc_feature/unstable.gen.ts",
  ]);
  for (const [rel, text] of files) expect([rel, readFileSync(join(REPO, rel), "utf8") === text]).toEqual([rel, true]);
});

// tools/codegen/options.ts: the committed src/rustc_session/options.gen.ts and
// options/mitigation_coverage.gen.ts are what the generator produces from the upstream checkout
// (skips visibly without the checkout).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { generate } from "./options.ts";

const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler", "rustc_session")) && existsSync(join(UPSTREAM, "compiler", "rustc_target"));
if (!HAVE_UPSTREAM) console.log(`SKIP: upstream checkout missing at ${UPSTREAM}`);

test.skipIf(!HAVE_UPSTREAM)("rustc_session option tables are up to date", () => {
  const files = generate();
  expect([...files.keys()].sort()).toEqual(["src/rustc_session/options.gen.ts", "src/rustc_session/options/mitigation_coverage.gen.ts"]);
  for (const [rel, text] of files) expect([rel, readFileSync(join(REPO, rel), "utf8") === text]).toEqual([rel, true]);
});

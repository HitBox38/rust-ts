// `short_string_namespace`'s long-type file (ty/error.rs:277) against the oracle, in long_type_oracle/. Regenerate with
//   rustc +nightly long_type.rs --diagnostic-width=60 -Zwrite-long-types-to-disk=yes --emit=metadata --out-dir d
// run in that directory, `long-type-<digits>` and `d/` removed from its stderr as below; the file's contents go to long_type.txt.
// The oracle's hash is of an address, so the name's digits are the one thing that can't be compared.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";

const HERE = join(import.meta.dir, "long_type_oracle");
const MAIN = join(import.meta.dir, "../../rust_ts/main.ts");
const ROOT = join(DATA, "tmp", "long-type-oracle");
let out = "";

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
  out = mkdtempSync(join(ROOT, "t"));
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

test("the note, the short type and the file are the oracle's", () => {
  const r = Bun.spawnSync([process.execPath, MAIN, "long_type.rs", "--diagnostic-width=60", "-Zwrite-long-types-to-disk=yes", "--emit=metadata", "--out-dir", out], {
    cwd: HERE,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = r.stderr.toString().replaceAll(`${out}/`, "").replace(/long-type-\d+/g, "long-type-HASH");
  expect(stderr).toBe(readFileSync(join(HERE, "long_type.stderr"), "utf8"));
  expect(r.exitCode).toBe(1);
  const files = readdirSync(out);
  expect(files.map((f) => f.replace(/\d+/, "HASH"))).toEqual(["long_type.long-type-HASH.txt"]);
  expect(readFileSync(join(out, files[0]!), "utf8")).toBe(readFileSync(join(HERE, "long_type.txt"), "utf8"));
});

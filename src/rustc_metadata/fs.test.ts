// `TempDirBuilder::tempdir_in` (fs.ts) against what tempfile 3.23.0 does (lane fixers-46; docs/reviews/root-w41-check.md N5,
// N6): one `mkdir` of `<dir>/<prefix><6 alphanumerics><suffix>`, so it fails exactly where `mkdir` of a name that long fails,
// with the same error, and leaves nothing behind. Node's `mkdtempSync` under Bun made a directory with a shorter name there
// (N5), and the suffix's rename left `<prefix>XXXXXX` behind when it failed (N6).
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";
import { IoError_raw_os_error } from "../std/io.ts";
import { TempDirBuilder } from "./fs.ts";

const SCRATCH = test_scratch_dir("metadata-fs");
/** `PATH_MAX`, counting the NUL: the longest path `mkdir` takes is one byte shorter. */
const PATH_MAX = process.platform === "darwin" ? 1024 : 4096;

/** A new directory under `SCRATCH` whose absolute path is `len` bytes, in components of at most 200 bytes. */
function dir_of_length(tag: string, len: number): string {
  let d = join(SCRATCH, tag);
  while (d.length < len) {
    // Each step adds `/` and the name; a step never leaves one byte, which no component could fill.
    const rest = len - d.length;
    if (rest < 2) throw new Error(`ERROR: cannot extend ${d.length} bytes to ${len}`);
    let n = Math.min(200, rest - 1);
    if (rest - 1 - n === 1) n -= 1;
    d = join(d, "d".repeat(n));
  }
  expect(d.length).toBe(len);
  mkdirSync(d, { recursive: true });
  return d;
}

test("the suffix path: <prefix><6 alphanumerics><suffix>, a directory, the only entry, removed on drop (N6)", () => {
  const dir = dir_of_length("suffix", SCRATCH.length + 20);
  const r = TempDirBuilder.new().prefix("rmeta").suffix(".sfx").tempdir_in(dir);
  if (r.$ !== "Ok") throw new Error("tempdir_in failed");
  const name = basename(r._0.path());
  expect(name).toMatch(/^rmeta[A-Za-z0-9]{6}\.sfx$/);
  expect(readdirSync(dir)).toEqual([name]);
  expect(statSync(r._0.path()).isDirectory()).toBe(true);
  r._0.drop();
  expect(readdirSync(dir)).toEqual([]);
});

test("at the path length limit it fails where mkdir does, with mkdir's error, and leaves nothing (N5, N6)", () => {
  let failed = 0;
  for (const suffix of ["", ".sfx"]) {
    // `total` is the new directory's path length: 1,019 to 1,029 bytes on darwin, of which 1,024 and up fail.
    for (let total = PATH_MAX - 5; total <= PATH_MAX + 5; total++) {
      const name_len = "rmeta".length + 6 + suffix.length;
      const dir = dir_of_length(`limit${suffix}${total}`, total - 1 - name_len);
      let plain: number | undefined;
      try {
        mkdirSync(join(dir, "p".repeat(name_len)));
        rmdirSync(join(dir, "p".repeat(name_len)));
      } catch (e) {
        plain = (e as { errno: number }).errno;
      }
      const r = TempDirBuilder.new().prefix("rmeta").suffix(suffix).tempdir_in(dir);
      if (plain === undefined) {
        expect(r.$).toBe("Ok");
        if (r.$ === "Ok") expect(r._0.path().length).toBe(total);
        if (r.$ === "Ok") r._0.drop();
      } else {
        failed++;
        expect(r.$).toBe("Err");
        // node's `errno` is negative.
        if (r.$ === "Err") expect(IoError_raw_os_error(r._0)).toBe(Math.abs(plain));
      }
      expect(readdirSync(dir)).toEqual([]);
    }
  }
  // The range crosses the limit on this host, for both suffixes.
  expect(failed).toBe(2 * 6);
});

// fixers-50 (fixers-48 review O2): `tempfile_with_suffix` opens its file as tempfile 3.23.0's `create_named` does
// (src/file/imp/unix.rs:14: `read(true).write(true).create_new(true)`, mode 0o600): readable as well as writable,
// created exclusively, in `env::temp_dir()`, named `.tmpXXXXXX<suffix>`.
import { expect, test } from "bun:test";
import { closeSync, fstatSync, mkdirSync, readdirSync, readSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { remove_var, set_var, var_os } from "../../std/env.ts";
import { tempfile_with_suffix } from "./archive.ts";

test("tempfile_with_suffix opens read+write, exclusive, 0o600, in TMPDIR", () => {
  const dir = join(DATA, "tmp", "archive-test", process.env.RUST_TS_AGENT ?? "default");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // `env::temp_dir()` reads libc's environment: set it through `set_var`.
  const saved = var_os("TMPDIR");
  set_var("TMPDIR", dir);
  try {
    const r = tempfile_with_suffix("libfat.a");
    if (r.$ === "Err") throw new Error("tempfile_with_suffix failed");
    const [fd, path] = r._0;
    try {
      expect(path.startsWith(join(dir, ".tmp"))).toBe(true);
      expect(path.endsWith("libfat.a")).toBe(true);
      expect(path.length).toBe(join(dir, ".tmp").length + 6 + "libfat.a".length);
      expect(fstatSync(fd).mode & 0o777).toBe(0o600);
      expect(writeSync(fd, new Uint8Array([1, 2, 3]))).toBe(3);
      // A write-only descriptor fails here with EBADF.
      const buf = new Uint8Array(3);
      expect(readSync(fd, buf, 0, 3, 0)).toBe(3);
      expect([...buf]).toEqual([1, 2, 3]);
    } finally {
      closeSync(fd);
    }
    expect(readdirSync(dir).length).toBe(1);
  } finally {
    if (saved === undefined) remove_var("TMPDIR");
    else set_var("TMPDIR", saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

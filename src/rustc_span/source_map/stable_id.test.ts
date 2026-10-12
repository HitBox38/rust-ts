// rust-ts regression test (review w23a, batch 3 finding 1): `SourceMap` dedups files by
// `StableSourceFileId`, a hash of the `FileName` that goes through `impl Hash for Path`, which
// never hashes the root. With `--remap-path-prefix <dir>=/`, `include!("x.rs")` and
// `include!("<dir>/x.rs")` therefore load one `SourceFile`. Oracle (rustc 1.101.0-nightly
// 6f5da406b): main.rs = `include!("x.rs"); include!("<dir>/x.rs"); fn main() {}`, x.rs =
// `const _: u32 = "a";` prints one E0308 at `x.rs:1:16` with the remap, two without it.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { create_default_session_globals_then, type PathBuf, RemapPathScopeComponents } from "../lib.ts";
import { FilePathMapping, RealFileLoader, SourceMap } from "../source_map.ts";
import { Ok, unwrap_result } from "../../std/result.ts";
import type { IoResult } from "../../std/io.ts";
import type { Str } from "../../std/str.ts";

/** `RealFileLoader` as if the process ran in `dir` (relative paths resolve against it). */
class LoaderIn extends RealFileLoader {
  constructor(readonly dir: string) {
    super();
  }
  override read_file(path: PathBuf): IoResult<Str> {
    return super.read_file(isAbsolute(path) ? path : join(this.dir, path));
  }
  override current_directory(): IoResult<PathBuf> {
    return Ok(this.dir);
  }
}

function with_dir(f: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-stable-id-"));
  try {
    writeFileSync(join(dir, "x.rs"), 'const _: u32 = "a";\n');
    create_default_session_globals_then(() => f(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function source_map(dir: string, mapping: [PathBuf, PathBuf][]): SourceMap {
  return SourceMap.with_inputs({
    file_loader: new LoaderIn(dir),
    path_mapping: FilePathMapping.new(mapping, RemapPathScopeComponents.all()),
    hash_kind: "Md5",
    checksum_hash_kind: undefined,
  });
}

test("remap to `/`: relative and absolute include of one file load the same SourceFile", () => {
  with_dir((dir) => {
    const sm = source_map(dir, [[dir, "/"]]);
    const a = unwrap_result(sm.load_file("x.rs"));
    const b = unwrap_result(sm.load_file(join(dir, "x.rs")));
    expect(b).toBe(a);
    expect(sm.files().deref().length).toBe(1);
  });
});

test("without the remap they stay two files (two errors in the oracle)", () => {
  with_dir((dir) => {
    const sm = source_map(dir, []);
    const a = unwrap_result(sm.load_file("x.rs"));
    const b = unwrap_result(sm.load_file(join(dir, "x.rs")));
    expect(b).not.toBe(a);
    expect(sm.files().deref().length).toBe(2);
  });
});

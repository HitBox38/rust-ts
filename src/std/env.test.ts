// `std::env` on the host: `var_os`, `var_` and `vars_os` read C's `environ`, not `process.env` (src/std/env.ts).
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environ_entries, remove_var, set_var, temp_dir, var_, var_os, vars_os } from "./env.ts";

const text = (b: Uint8Array | undefined) => (b === undefined ? undefined : new TextDecoder().decode(b));

test.skipIf(process.platform === "win32")("set_var and remove_var reach C's environ and process.env; reads ignore a process.env-only name", () => {
  const name = `RUST_TS_ENV_TEST_${process.pid}`;
  set_var(name, "v=1");
  expect(text(var_os(name))).toBe("v=1");
  expect(var_(name)).toEqual({ $: "Ok", _0: "v=1" });
  expect(process.env[name]).toBe("v=1");
  expect(vars_os().some(([k, v]) => text(k) === name && text(v) === "v=1")).toBe(process.platform === "darwin"); // Linux: as of `execve`.
  remove_var(name);
  expect(var_os(name)).toBeUndefined();
  expect(var_(name)).toEqual({ $: "Err", _0: { $: "NotPresent" } });
  expect(process.env[name]).toBeUndefined();

  process.env[name] = "only in the JS map";
  expect(var_os(name)).toBeUndefined();
  delete process.env[name];
});

test.skipIf(process.platform === "win32")("a name with a NUL is absent, and vars_os splits at the first `=` after the first byte", () => {
  expect(var_os("PATH\0")).toBeUndefined();
  const parsed = vars_os([new TextEncoder().encode("A=b=c"), new TextEncoder().encode("=x=y"), new TextEncoder().encode("none"), new Uint8Array(0), new TextEncoder().encode("E=")]);
  expect(parsed.map(([k, v]) => [text(k), text(v)])).toEqual([
    ["A", "b=c"],
    ["=x", "y"],
    ["E", ""],
  ]);
  expect(environ_entries()!.length).toBeGreaterThan(0);
});

// `Current directory is invalid: Result too large (os error 34)` from `process.cwd()` (docs/reviews/fixers-42.md, "Seen"). In a child, as
// it changes the cwd. `process.cwd()` stops working at 1,024 bytes, so the path is reached one relative step at a time.
test.skipIf(process.platform === "win32")("current_dir and set_current_dir past 1,024 bytes, and their errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-cwd-"));
  try {
    const script = `
      import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
      import { join, resolve } from "node:path";
      import { current_dir_str, set_current_dir } from ${JSON.stringify(join(import.meta.dir, "env.ts"))};
      import { debug_IoError } from ${JSON.stringify(join(import.meta.dir, "io.ts"))};
      import { PLAIN } from ${JSON.stringify(join(import.meta.dir, "fmt.ts"))};
      const cwd = () => { const r = current_dir_str(); if (r.$ === "Err") throw new Error(); return r._0; };
      const err = (p) => { const r = set_current_dir(p); return r.$ === "Err" ? debug_IoError(r._0, PLAIN) : "Ok"; };
      const out = [];
      writeFileSync("file", "");
      out.push(err("file"), err("nosuch"), err(new Uint8Array([0x61, 0xff, 0x62])));
      const start = cwd();
      // Bun's own copy of the cwd, which is what these two read.
      mkdirSync("near");
      out.push(err("near"), resolve("x") === join(start, "near", "x"), realpathSync(".") === join(start, "near"), err(start));
      while (cwd().length < 1100) {
        mkdirSync("d".repeat(200));
        if (err("d".repeat(200)) !== "Ok") throw new Error();
      }
      const deep = cwd();
      out.push(deep.startsWith(start) && deep.endsWith("/" + "d".repeat(200)));
      out.push(new TextDecoder().decode(Bun.spawnSync(["/bin/pwd"]).stdout).trim() === deep);
      out.push(err(".."), cwd() === deep.slice(0, -201));
      out.push(err(start), new TextDecoder().decode(Bun.spawnSync(["/bin/pwd"]).stdout).trim() === start, process.cwd() === start);
      console.log(JSON.stringify(out));
    `;
    const r = Bun.spawnSync([process.execPath, "-e", script], { cwd: dir });
    expect(r.stderr.toString()).toBe("");
    expect(JSON.parse(r.stdout.toString())).toEqual([
      // First: the reader of `errno` must be ready before the failing call, as `dlopen` overwrites it.
      'Os { code: 20, kind: NotADirectory, message: "Not a directory" }',
      'Os { code: 2, kind: NotFound, message: "No such file or directory" }',
      'Os { code: 2, kind: NotFound, message: "No such file or directory" }',
      "Ok",
      true,
      true,
      "Ok",
      true,
      true,
      "Ok",
      true,
      "Ok",
      true,
      true,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// `fs::canonicalize` is `realpath(3)` on the path's bytes (docs/reviews/fixers-45.md F1): in a cwd of 1,015 bytes, a short relative path
// resolves, where joining it to the cwd first gave `ENAMETOOLONG`. The answers are those of `std::fs::canonicalize` from the oracle
// toolchain in the same layout (docs/handoff/fixers-47.md). In a child, as it changes the cwd.
test.skipIf(process.platform === "win32")("host_canonicalize resolves a relative path against a cwd near PATH_MAX", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-canon-"));
  try {
    const script = `
      import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
      import { current_dir_str, set_current_dir } from ${JSON.stringify(join(import.meta.dir, "env.ts"))};
      import { host_canonicalize } from ${JSON.stringify(join(import.meta.dir, "path.ts"))};
      import { debug_IoError } from ${JSON.stringify(join(import.meta.dir, "io.ts"))};
      import { PLAIN } from ${JSON.stringify(join(import.meta.dir, "fmt.ts"))};
      const cwd = () => { const r = current_dir_str(); if (r.$ === "Err") throw new Error(); return r._0; };
      const canon = (p) => { const r = host_canonicalize(p); return r.$ === "Ok" ? r._0 : debug_IoError(r._0, PLAIN); };
      mkdirSync("short");
      writeFileSync("short/f", "");
      const short = realpathSync("short");
      while (cwd().length + 201 < 1015) { mkdirSync("d".repeat(200)); if (set_current_dir("d".repeat(200)).$ !== "Ok") throw new Error(); }
      const last = "e".repeat(1015 - cwd().length - 1);
      mkdirSync(last);
      if (set_current_dir(last).$ !== "Ok") throw new Error();
      symlinkSync(short, "link");
      const out = [cwd().length, canon("link/f") === short + "/f", canon("link") === short, canon("link/nope"), canon(""), canon("./link/../link/f"), canon("a\\0b")];
      console.log(JSON.stringify(out));
    `;
    const r = Bun.spawnSync([process.execPath, "-e", script], { cwd: dir });
    expect(r.stderr.toString()).toBe("");
    expect(JSON.parse(r.stdout.toString())).toEqual([
      1015,
      true,
      true,
      'Os { code: 2, kind: NotFound, message: "No such file or directory" }',
      'Os { code: 2, kind: NotFound, message: "No such file or directory" }',
      // `link/..` is the parent of `short`, which holds no `link`.
      'Os { code: 2, kind: NotFound, message: "No such file or directory" }',
      'Error { kind: InvalidInput, message: "file name contained an unexpected NUL byte" }',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("home_dir: HOME's bytes, and the passwd home when it is empty or unset", () => {
  // In a directory of its own: given an empty HOME, Bun makes a `Library/Caches` in the cwd.
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-home-"));
  try {
    const home_bytes = (entries: string[]): string => {
      const script = `import { home_dir } from ${JSON.stringify(join(import.meta.dir, "env.ts"))}; console.log(JSON.stringify([...home_dir()!]));`;
      const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "rust_ts", "exec_with_env.ts"), JSON.stringify(entries), process.execPath, "-e", script], { cwd: dir });
      expect(r.stderr.toString()).toBe("");
      return Buffer.from(JSON.parse(r.stdout.toString()) as number[]).toString("latin1");
    };
    expect(home_bytes(["HOME=/a\xffb"])).toBe("/a\xffb");
    // The passwd entry's, by `getpwuid_r`.
    const passwd = home_bytes(["HOME="]);
    expect(passwd.startsWith("/")).toBe(true);
    expect(home_bytes([])).toBe(passwd);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("temp_dir: TMPDIR as it is, even empty; unset, the darwin per-user dir or /tmp (review link-rlib-native N3)", () => {
  const saved = var_os("TMPDIR");
  try {
    // Its bytes, not UTF-8 or not.
    set_var("TMPDIR", Uint8Array.of(0x2f, 0x78, 0xff, 0x79));
    expect([...temp_dir()]).toEqual([0x2f, 0x78, 0xff, 0x79]);
    set_var("TMPDIR", "");
    expect(text(temp_dir())).toBe("");
    remove_var("TMPDIR");
    // `confstr(_CS_DARWIN_USER_TEMP_DIR)`, which `getconf DARWIN_USER_TEMP_DIR` prints too.
    const want = process.platform === "darwin" ? Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"]).stdout.toString().trimEnd() : "/tmp";
    expect(want.length).toBeGreaterThan(0);
    expect(text(temp_dir())).toBe(want);
  } finally {
    if (saved === undefined) remove_var("TMPDIR");
    else set_var("TMPDIR", saved);
  }
});

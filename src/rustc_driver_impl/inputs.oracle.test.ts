// Oracle checks of the driver's input paths (review parser-a batch 1 findings 1-2, parser-b batch 1
// finding 1 and batch 5 findings 3, 4, 9): `bun src/rust_ts/main.ts <args>` against the pinned rustc,
// stdout + stderr + exit code byte for byte.
//   - main-file load errors (`couldn't find file` + the "you might have meant" suggestion,
//     directories, permissions, invalid UTF-8 contents);
//   - argfiles (UTF-8 BOM, final `\r`, missing / directory argfile);
//   - non-UTF-8 command-line arguments (`args_os`), with `RUST_BACKTRACE` set (an error) and unset
//     (std's `env::args()` panics in `install_ice_hook`: exit code only, the panic text is std's);
//   - stdin input `-` (invalid UTF-8);
//   - deep nesting within rustc's stack (must parse), and far beyond it (both die by the same signal).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
const UNIX = process.platform !== "win32";

const WORK = join(DATA, "tmp", "inputs-oracle", process.env.RUST_TS_AGENT ?? "default");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE", "RUST_MIN_STACK"].includes(k)) {
    ENV[k] = v;
  }
}

interface Out {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
}
function run(cmd: string[], env: Record<string, string> = {}, stdin?: Uint8Array): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: { ...ENV, ...env }, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode, signal: r.signalCode ?? null };
}
const ORACLE = (): string[] => RUSTC;
const OURS = (): string[] => [process.execPath, join(REPO, "src/rust_ts/main.ts")];

function setup(): void {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, "sub"), { recursive: true });
  mkdirSync(join(WORK, "adir"), { recursive: true });
  const w = (p: string, b: string | Uint8Array): void => writeFileSync(join(WORK, p), b);
  w("ok.rs", "fn main() {}\n");
  w("mian.rs", "fn main() {}\n");
  w("sub/lib.rs", "fn main() {}\n");
  w("noperm.rs", "fn main() {}\n");
  if (UNIX) chmodSync(join(WORK, "noperm.rs"), 0o000);
  w("bad1.rs", Uint8Array.from([...new TextEncoder().encode('fn main() { let s = "'), 0xff, 0xfe, ...new TextEncoder().encode('"; }\n')]));
  w("bad2.rs", Uint8Array.from([...new TextEncoder().encode('fn main() { let s = "'), 0xe2, 0x82, ...new TextEncoder().encode('"; }')]));
  w("bad3.rs", Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("fn main() {\n  \"x"), 0xc3, 0x28, ...new TextEncoder().encode('"\n}\n')]));
  w("bad4.rs", Uint8Array.from([...new TextEncoder().encode("fn main() {} "), 0xf0, 0x9f, 0x98]));
  w("bom.txt", Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("-Zunpretty=ast-tree\nok.rs\n")]));
  w("cr.txt", "-Zunpretty=ast-tree\nok.rs\r");
  w("crlf.txt", "-Zunpretty=ast-tree\r\nok.rs\r\n");
  w("bad.txt", Uint8Array.from([...new TextEncoder().encode("-Zunpretty=ast-tree\n"), 0xff, 0x0a]));
  const nest = (n: number, open: string, mid: string, close: string): string => open.repeat(n) + mid + close.repeat(n);
  w("dp7000.rs", `fn main() { let x = ${nest(7000, "(", "1", ")")}; }\n`);
  w("dm5000.rs", `${nest(5000, "mod a {", "", "}")}\n`);
  w("dc4000.rs", `fn main() { let f = ${"|x| ".repeat(4000)}1; }\n`);
  w("du6000.rs", `fn main() { let x = ${"-".repeat(6000)}1; }\n`);
  w("dp100000.rs", `fn main() { let x = ${nest(100000, "(", "1", ")")}; }\n`);
}

const CASES: string[][] = [
  ["-Zunpretty=ast-tree", "main.rs"],
  ["-Zunpretty=ast-tree", "sub/lin.rs"],
  ["-Zunpretty=ast-tree", "/main.rs"],
  ["-Zunpretty=ast-tree", "./mian"],
  ["-Zunpretty=ast-tree", "./sub/../mian.rs"],
  ["-Zunpretty=ast-tree", "nonexist/x.rs"],
  ["-Zunpretty=ast-tree", "adir"],
  ["-Zunpretty=ast-tree", "sub/"],
  ["-Zunpretty=ast-tree", "."],
  ["-Zunpretty=ast-tree", "sub/."],
  ["-Zunpretty=ast-tree", "bad1.rs"],
  ["-Zunpretty=ast-tree", "bad2.rs"],
  ["-Zunpretty=ast-tree", "bad3.rs"],
  ["-Zunpretty=ast-tree", "bad4.rs"],
  ["-Zunpretty=ast-tree", "--error-format=short", "bad1.rs"],
  ["@bom.txt"],
  ["@cr.txt"],
  ["@crlf.txt"],
  ["@bad.txt"],
  ["@missing.txt"],
  ["@adir"],
  ["-Zparse-crate-root-only", "dp7000.rs"],
  ["-Zparse-crate-root-only", "dm5000.rs"],
  ["-Zparse-crate-root-only", "dc4000.rs"],
  ["-Zparse-crate-root-only", "du6000.rs"],
];
if (UNIX && process.getuid?.() !== 0) CASES.push(["-Zunpretty=ast-tree", "noperm.rs"]);

test.skipIf(SKIP)("driver input paths match the oracle", () => {
  setup();
  const bad: string[] = [];
  for (const args of CASES) {
    const o = run([...ORACLE(), ...args]);
    const t = run([...OURS(), ...args]);
    if (o.stdout !== t.stdout || o.stderr !== t.stderr || o.code !== t.code) {
      bad.push(`${args.join(" ")}: oracle ${o.code} ${JSON.stringify(o.stderr.slice(0, 200))} / rust-ts ${t.code} ${JSON.stringify(t.stderr.slice(0, 200))}`);
    }
  }
  expect(bad).toEqual([]);
}, 300_000);

test.skipIf(SKIP)("stdin input: invalid UTF-8 matches the oracle", () => {
  setup();
  const input = Uint8Array.from([...new TextEncoder().encode("fn main() { "), 0xff, ...new TextEncoder().encode(" }")]);
  const o = run([...ORACLE(), "-Zunpretty=ast-tree", "-"], {}, input);
  const t = run([...OURS(), "-Zunpretty=ast-tree", "-"], {}, input);
  expect(t).toEqual(o);
}, 120_000);

// Arguments are raw bytes: pass them through `sh` with printf escapes.
const sh = (prefix: string[], argsSh: string): string[] => ["/bin/sh", "-c", `exec "$@" ${argsSh}`, "sh", ...prefix];

test.skipIf(SKIP || !UNIX)("non-UTF-8 arguments (RUST_BACKTRACE set): rustc's error", () => {
  setup();
  const args = `-Zunpretty=ast-tree "$(printf '\\377.rs')" ok.rs "$(printf 'a\\376\\303\\251\\n"')"`;
  for (const bt of ["0", "1"]) {
    const o = run(sh(ORACLE(), args), { RUST_BACKTRACE: bt });
    const t = run(sh(OURS(), args), { RUST_BACKTRACE: bt });
    expect(t).toEqual(o);
  }
}, 120_000);

test.skipIf(SKIP || !UNIX)("non-UTF-8 arguments (RUST_BACKTRACE unset): std's args() panics (exit 101)", () => {
  setup();
  const args = `-Zunpretty=ast-tree "$(printf '\\377.rs')"`;
  const o = run(sh(ORACLE(), args));
  const t = run(sh(OURS(), args));
  expect(o.code).toBe(101);
  expect(t.code).toBe(101);
  expect(t.stdout).toBe(o.stdout);
  expect(t.stderr).toContain('called `Result::unwrap()` on an `Err` value: "\\xFF.rs"');
}, 120_000);

test.skipIf(SKIP || !UNIX)("nesting far beyond rustc's stack: both die by the same signal", () => {
  setup();
  const o = run([...ORACLE(), "-Zparse-crate-root-only", "dp100000.rs"]);
  const t = run([...OURS(), "-Zparse-crate-root-only", "dp100000.rs"]);
  expect(o.signal).not.toBeNull();
  expect(t.signal).toBe(o.signal);
  expect(t.stdout).toBe(o.stdout);
  expect(t.stderr.split("\n")[0]).toBe(o.stderr.split("\n")[0]);
}, 300_000);

test.skipIf(!UNIX)("Bun's readdirSync keeps the directory's own order (std::fs::read_dir), see rustc_parse/lib.ts", () => {
  setup();
  const ls = Bun.spawnSync(["ls", "-f", WORK]).stdout.toString().split("\n").filter((n) => n !== "" && n !== "." && n !== "..");
  expect(readdirSync(WORK)).toEqual(ls);
});

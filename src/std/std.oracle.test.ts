// Oracle checks of src/std helpers against the pinned toolchain's std: a small Rust program built with
// the oracle rustc prints, per case, what the std function returns; the TS port must print the same.
// Covers `str::from_utf8` (`Utf8Error` Debug/Display), `str::lines`, `<OsStr as Debug>` (unix bytes),
// `Path::parent`/`Path::file_name`, and `io::Error::from_raw_os_error` (kind/Display/Debug) for every
// errno 0..=150 of the host. Skips (visibly) if rustc is unavailable; fails under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { PLAIN } from "./fmt.ts";
import { debug_IoError, display_IoError, ErrorKind_as_str, IoError_kind, type IoError } from "./io.ts";
import { path_file_name, path_parent } from "./path.ts";
import { debug_os_bytes, from_utf8, str_lines } from "./str.ts";

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

const WORK = join(DATA, "tmp", "std-oracle", process.env.RUST_TS_AGENT ?? "default");

const PROBE = String.raw`
use std::io::Read;
use std::os::unix::ffi::OsStrExt;
fn hex(s: &str) -> Vec<u8> { (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect() }
fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    for line in input.lines() {
        let (kind, arg) = line.split_once(' ').unwrap();
        match kind {
            "utf8" => {
                let b = hex(arg);
                match std::str::from_utf8(&b) {
                    Ok(s) => println!("Ok {:?}", s),
                    Err(e) => println!("Err {:?} / {} / {}", e, e.valid_up_to(), e),
                }
                println!("{:?}", std::ffi::OsStr::from_bytes(&b));
            }
            "lines" => {
                let b = hex(arg);
                let s = std::str::from_utf8(&b).unwrap();
                println!("{:?}", s.lines().collect::<Vec<_>>());
            }
            "path" => {
                let b = hex(arg);
                let p = std::path::Path::new(std::str::from_utf8(&b).unwrap());
                println!("{:?} {:?}", p.parent(), p.file_name());
            }
            "errno" => {
                let e = std::io::Error::from_raw_os_error(arg.parse().unwrap());
                println!("{:?} | {} | {} | {:?}", e.kind(), e.kind(), e, e);
            }
            _ => panic!(),
        }
    }
}
`;

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (...xs: (number | string)[]): Uint8Array =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === "number" ? [x] : Array.from(new TextEncoder().encode(x)))));

const UTF8_CASES: Uint8Array[] = [
  bytes(),
  bytes("abc"),
  bytes(0xef, 0xbb, 0xbf, "x"),
  bytes(0xff),
  bytes("a", 0xff, "b"),
  bytes(0xc3),
  bytes(0xc3, 0x28),
  bytes(0xe2, 0x82),
  bytes(0xe2, 0x82, 0x28),
  bytes(0xe2, 0x28, 0xa1),
  bytes(0xe0, 0x80, 0x80),
  bytes(0xe0, 0xa0),
  bytes(0xed, 0xa0, 0x80),
  bytes(0xed, 0x9f, 0xbf),
  bytes(0xf0, 0x9f, 0x98),
  bytes(0xf0, 0x9f, 0x98, 0x80),
  bytes(0xf0, 0x9f, 0x28, 0x80),
  bytes(0xf0, 0x9f, 0x98, 0x28),
  bytes(0xf0, 0x80, 0x80, 0x80),
  bytes(0xf4, 0x90, 0x80, 0x80),
  bytes(0xf5, 0x80),
  bytes(0xc0, 0xaf),
  bytes(0xc1, 0xbf),
  bytes(0x80),
  bytes(0xbf, 0xbf),
  bytes("é\n\"\\\t'", 0xfe, "\u{301}x\u{7f}\u{200b}"),
  bytes(0xfe, 0xff, 0xc3),
  bytes("\u{1f600}", 0xf0),
];
const LINES_CASES = ["", "a", "a\n", "a\r\n", "a\r", "\n", "\r\n", "a\n\nb", "a\r\r\n", "\ra\r\nb\r", "x\n\r", "\u{feff}a\r\nb"];
const PATH_CASES = [
  "", "/", "//", "a", "a/", "a//", "/a", "a/b", "a/b/", "a/./b", "a/.", "./a", ".", "./", "..", "../a", "a/..",
  "/a/b/c.rs", "foo/.", "foo/./", "/.", "./.", "a/b/./", "a/../b", "///a///b///", "main.rs", "./main.rs", "/main.rs",
];

test.skipIf(SKIP)("src/std helpers vs the oracle std", () => {
  mkdirSync(WORK, { recursive: true });
  const src = join(WORK, "probe.rs");
  const exe = join(WORK, "probe");
  writeFileSync(src, PROBE);
  const c = Bun.spawnSync([...RUSTC, "--edition=2024", "-o", exe, src], { stderr: "pipe" });
  if (c.exitCode !== 0) throw new Error(`ERROR: probe build failed: ${c.stderr.toString()}`);

  const lines: string[] = [];
  const ours: string[] = [];
  for (const b of UTF8_CASES) {
    lines.push(`utf8 ${hex(b)}`);
    const r = from_utf8(b);
    ours.push(r.$ === "Ok" ? `Ok ${debug_os_bytes(b)}` : `Err ${r._0.debug()} / ${r._0.valid_up_to()} / ${r._0}`);
    ours.push(debug_os_bytes(b));
  }
  for (const s of LINES_CASES) {
    lines.push(`lines ${hex(new TextEncoder().encode(s))}`);
    ours.push(`[${str_lines(s).map((l) => debug_os_bytes(new TextEncoder().encode(l))).join(", ")}]`);
  }
  for (const p of PATH_CASES) {
    lines.push(`path ${hex(new TextEncoder().encode(p))}`);
    const parent = path_parent(p);
    const name = path_file_name(p);
    const dbg = (s: string): string => debug_os_bytes(new TextEncoder().encode(s));
    ours.push(`${parent === undefined ? "None" : `Some(${dbg(parent)})`} ${name === undefined ? "None" : `Some(${dbg(name)})`}`);
  }
  for (let errno = 0; errno <= 150; errno++) {
    lines.push(`errno ${errno}`);
    const e: IoError = { $: "Os", errno, code: "" };
    const kind = IoError_kind(e);
    ours.push(`${kind} | ${ErrorKind_as_str(kind)} | ${display_IoError(e)} | ${debug_IoError(e, PLAIN)}`);
  }
  const r = Bun.spawnSync([exe], { stdin: new TextEncoder().encode(`${lines.join("\n")}\n`), stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(0);
  const expected = r.stdout.toString().split("\n").slice(0, -1);
  expect(ours).toEqual(expected);
});

// rust-ts checks for termize =0.2.1 (upstream's only test, `test_shell`, compares with `stty` on a
// real terminal and is skipped; see platform/unix.ts).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isatty } from "node:tty";
import { dimensions, dimensions_stderr, dimensions_stdin, dimensions_stdout } from "./lib.ts";

function check(d: [number, number] | undefined, fd: number | undefined): void {
  if (fd !== undefined && !isatty(fd)) expect(d).toBeUndefined();
  if (d !== undefined) {
    expect(Number.isInteger(d[0]) && d[0] > 0).toBe(true);
    expect(Number.isInteger(d[1]) && d[1] > 0).toBe(true);
  }
}

test("dimensions: None for non-terminals, positive sizes otherwise", () => {
  check(dimensions_stdout(), 1);
  check(dimensions_stdin(), 0);
  check(dimensions_stderr(), 2);
  check(dimensions(), undefined);
});

// Review w456b E1: every `dimensions()` call used to leak one fd (Bun's tty `WriteStream` was never
// destroyed), and destroying the stream wrapped around the `/dev/tty` fd would close that fd a
// second time, asynchronously, after its `closeSync`. A child runs `dimensions()` 300 times under a
// pty (`script`), once with stdio on the pty and once with stdio redirected (the `/dev/tty` branch),
// and reports the `/dev/fd` count before and after plus whether an fd opened afterwards survives a
// tick. Skipped when no pty can be made (no `script`, or the child sees no terminal).

const FD_CHILD = `
import { closeSync, openSync, readdirSync, fstatSync, writeFileSync } from "node:fs";
import { isatty } from "node:tty";
import { dimensions } from ${JSON.stringify(join(import.meta.dir, "lib.ts"))};
const n = () => readdirSync("/dev/fd").length;
const tick = () => new Promise((r) => setTimeout(r, 30));
await tick();
const before = n();
let last;
for (let i = 0; i < 300; i++) last = dimensions();
const after = n();
const x = openSync("/dev/null", "r");
await tick();
const afterTick = n() - 1;
let sentinel = true;
try { fstatSync(x); } catch { sentinel = false; }
let devtty = false;
try { closeSync(openSync("/dev/tty", "r")); devtty = true; } catch {}
writeFileSync(process.env.FD_OUT, JSON.stringify({ before, after, afterTick, sentinel, last: last ?? null,
  stdioTty: [0, 1, 2].some((fd) => isatty(fd)), devtty }));
`;

function run_under_pty(redirect: boolean): { before: number; after: number; afterTick: number; sentinel: boolean; last: unknown; stdioTty: boolean; devtty: boolean } | undefined {
  const dir = mkdtempSync(join(tmpdir(), "termize-fd-"));
  try {
    const child = join(dir, "child.ts");
    const out = join(dir, "out.json");
    writeFileSync(child, FD_CHILD);
    const inner = `stty cols 80 rows 24 2>/dev/null; ${JSON.stringify(process.execPath)} ${JSON.stringify(child)}` +
      (redirect ? " </dev/null >/dev/null 2>/dev/null" : "");
    const args = process.platform === "darwin" ? ["-q", "/dev/null", "sh", "-c", inner] : ["-qec", inner, "/dev/null"];
    const r = spawnSync("script", args, { env: { ...process.env, FD_OUT: out }, stdio: ["ignore", "ignore", "ignore"], timeout: 60_000 });
    if (r.error !== undefined) return undefined;
    try {
      return JSON.parse(readFileSync(out, "utf8"));
    } catch {
      return undefined;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const redirect of [false, true]) {
  const res = run_under_pty(redirect);
  const reached = res !== undefined && (redirect ? !res.stdioTty && res.devtty : res.stdioTty);
  test.skipIf(!reached)(`dimensions: no fd leak under a pty (${redirect ? "/dev/tty branch" : "stdio branch"})`, () => {
    expect(res!.last).toEqual([80, 24]);
    expect(res!.after).toBe(res!.before);
    expect(res!.afterTick).toBe(res!.before);
    expect(res!.sentinel).toBe(true);
  });
}

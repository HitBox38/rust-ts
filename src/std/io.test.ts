// rust-ts: io::Error Debug/Display against the oracle (rustc 1.101.0-nightly 6f5da406b, scratch
// program: `io::Error::other(..)` and the `read_to_string` invalid-UTF-8 error).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { PLAIN, PRETTY } from "./fmt.ts";
import { debug_IoError, display_IoError, handle_ebadf, INVALID_UTF8, type IoError, io_error_other, is_ebadf } from "./io.ts";
import { Ok } from "./result.ts";

test("Custom and SimpleMessage io::Error Debug/Display", () => {
  const other = io_error_other("text files larger than 5 bytes are unsupported");
  expect(debug_IoError(other, PLAIN)).toBe('Custom { kind: Other, error: "text files larger than 5 bytes are unsupported" }');
  expect(display_IoError(other)).toBe("text files larger than 5 bytes are unsupported");
  expect(debug_IoError(INVALID_UTF8, PLAIN)).toBe('Error { kind: InvalidData, message: "stream did not contain valid UTF-8" }');
  expect(display_IoError(INVALID_UTF8)).toBe("stream did not contain valid UTF-8");
  expect(debug_IoError(INVALID_UTF8, PRETTY)).toBe('Error {\n    kind: InvalidData,\n    message: "stream did not contain valid UTF-8",\n}');
});

// std `handle_ebadf` (lane followups-33): `io::stdout()` swallows EBADF. The rustc behaviour it mirrors: with fd 1
// opened read-only (`1</dev/null`), `rustc --emit=metadata -o -` and `--print crate-name` exit 0 silently.
test.skipIf(process.platform === "win32")("handle_ebadf swallows EBADF only", () => {
  const ebadf: IoError = { $: "Os", errno: constants.errno.EBADF, code: "EBADF" };
  const epipe: IoError = { $: "Os", errno: constants.errno.EPIPE, code: "EPIPE" };
  expect(is_ebadf(ebadf)).toBe(true);
  expect(is_ebadf(epipe)).toBe(false);
  expect(is_ebadf(INVALID_UTF8)).toBe(false);
  expect(handle_ebadf<number>({ $: "Err", _0: ebadf }, () => Ok(7))).toEqual(Ok(7));
  expect(handle_ebadf<number>({ $: "Err", _0: epipe }, () => Ok(7))).toEqual({ $: "Err", _0: epipe });
  expect(handle_ebadf<number>(Ok(3), () => Ok(7))).toEqual(Ok(3));
});

test.skipIf(process.platform === "win32")("stdout_write_all on a read-only fd 1 is Ok (EBADF swallowed)", () => {
  const io = join(import.meta.dir, "io.ts");
  const script = `const { stdout_write_all } = await import(${JSON.stringify(io)}); const r = stdout_write_all(new TextEncoder().encode("x")); process.stderr.write(JSON.stringify(r));`;
  const r = Bun.spawnSync(["sh", "-c", 'exec "$0" -e "$1" 1</dev/null', process.execPath, script], { stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe(JSON.stringify(Ok(null)));
  expect(r.exitCode).toBe(0);
});

// miri-x86-a review O1. `process.stderr.write` on a pipe writes what fits and queues the rest for the event loop, so a
// later synchronous write overtakes it and `process.exit` loses the queue; touching the stream makes the pipe non-blocking.
// `write_stdout` / `write_stderr` have none of that, on a real pipe (the shell's: Bun's own hold far more).
const IO_TS = join(import.meta.dir, "io.ts");
const BIG = 1 << 20;
function child_through_pipe(fd: 1 | 2, body: string): string {
  const script = `import { writeSync } from "node:fs";
    import { write_stdout, write_stderr } from ${JSON.stringify(IO_TS)};
    const write = ${fd === 1 ? "write_stdout" : "write_stderr"};
    ${body}
    writeSync(${fd}, "AFTER\\n");
    process.exit(3);`;
  const redirect = fd === 1 ? `2>/dev/null` : `2>&1 >/dev/null`;
  // `cat` starts reading late, so the pipe fills while the child writes.
  const r = Bun.spawnSync(["/bin/sh", "-c", `"$@" ${redirect} | (sleep 0.3; cat)`, "sh", process.execPath, "-e", script], { stdout: "pipe", stderr: "inherit" });
  return r.stdout.toString();
}
for (const fd of [1, 2] as const) {
  const name = fd === 1 ? "write_stdout" : "write_stderr";
  test(`${name}: a large write on a pipe is whole and in order`, () => {
    const out = child_through_pipe(fd, `write("x".repeat(${BIG}) + "\\n");`);
    expect(out.length).toBe(BIG + 7);
    expect(out.endsWith("\nAFTER\n")).toBe(true);
  });
  test(`${name}: a pipe made non-blocking does not lose or fail a write`, () => {
    const out = child_through_pipe(fd, `void process.std${fd === 1 ? "out" : "err"}; write(new TextEncoder().encode("y".repeat(${BIG}) + "\\n"));`);
    expect(out.length).toBe(BIG + 7);
    expect(out.endsWith("\nAFTER\n")).toBe(true);
  });
}

test("nothing under src/ writes through process.stdout or process.stderr", () => {
  const offenders: string[] = [];
  const src = join(import.meta.dir, "..");
  for (const f of new Bun.Glob("**/*.{ts,mts}").scanSync({ cwd: src })) {
    if (/\.test\.m?ts$/.test(f) || f === "std/io.ts") continue;
    const text = readFileSync(join(src, f), "utf8");
    if (!text.includes("process.std")) continue;
    for (const line of text.split("\n")) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      if (/process\.std(out|err)\.write\b/.test(line)) offenders.push(`${f}: ${line.trim()}`);
    }
  }
  expect(offenders).toEqual([]);
});

// Host stdout line buffering (std's LineWriterShim, which Miri's `Stdout` file description writes through).
// Oracle (the pinned Miri, `libc::write(1, "a\n" + 2000 bytes)`, miri-shims-b review M1): the write flushes the
// completed line, does not buffer a tail at least as long as the 1024-byte buffer, and returns 2.
import { expect, test } from "bun:test";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../../..");

test("Stdout write: a tail >= the buffer capacity after the last newline is not buffered (linewritershim.rs:199)", () => {
  const script = `
    await import(${JSON.stringify(join(REPO, "src/miri/lib.ts"))});
    const { Stdout } = await import(${JSON.stringify(join(REPO, "src/miri/shims/files.ts"))});
    const s = Stdout.new();
    const buf = new Uint8Array(2002).fill(0x62); buf[0] = 0x61; buf[1] = 0x0a;
    const r = s.stdout.write(buf);
    process.stderr.write(JSON.stringify(r));
  `;
  const r = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(0);
  // Only the completed line reached stdout; the 2000-byte tail was neither written nor buffered.
  expect(r.stdout.toString()).toBe("a\n");
  expect(JSON.parse(r.stderr.toString())).toEqual({ $: "Ok", _0: 2 });
});

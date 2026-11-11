// Tests of src/std/thread.ts and thread.c beyond the channel tests in sync/mpsc.test.ts.
import { ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import * as thread from "./thread.ts";

const NATIVE = process.platform === "darwin" || process.platform === "linux";

// docs/reviews/pm-cross-thread.md N2: when the page-rounded retry of `pthread_attr_setstacksize` fails, std's
// `Thread::new` returns `Err(InvalidInput, "invalid stack size")` (a panic in `spawn`), so thread.c reports it rather
// than aborting the process. A size just below 2^64 is not a page multiple (EINVAL), and rounding it up wraps to 0,
// which the retry rejects. thread.ts never passes such a size (it stops above 2^53), so this calls thread.c directly.
test.skipIf(!NATIVE)("rts_thread_spawn: a failed page-rounded retry is the invalid-stack-size error, not an abort", () => {
  const err = new Int32Array([12345]);
  // 2^64 - 2048 is exact as a double and reaches thread.c as 0xffff_ffff_ffff_f800.
  const t = thread.native_sync().rts_thread_spawn(0, 0, 2 ** 64 - 2048, ptr(err));
  expect(t === 0 || t === null).toBe(true);
  expect(err[0]).toBe(-1);
  expect(thread.spawn_error(err[0]!)).toBe("failed to spawn thread: invalid stack size");
});

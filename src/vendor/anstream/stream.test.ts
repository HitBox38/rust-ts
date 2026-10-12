// Port of the `#[cfg(test)] mod tests` of anstream =0.6.21 `src/stream.rs`, plus rust-ts checks of
// the `std::io::Write` shim.
import { expect, test } from "bun:test";
import { Ok } from "../../std/result.ts";
import type { IoResult } from "../../std/io.ts";
import { AutoStream } from "./auto.ts";
import { VecU8, Write_default, dyn_write, stderr, type AsLockedWrite, type FmtArguments, type RawStream, type Write } from "./stream.ts";

// crate: anstream-0.6.21/src/stream.rs:292 assert_raw_stream
function assert_raw_stream<T extends RawStream & AsLockedWrite>(_raw?: T): void {
  // `crate::AutoStream<T>: std::io::Write`
  const _check: Write | undefined = undefined as AutoStream<T> | undefined;
  void _check;
}

// crate: anstream-0.6.21/src/stream.rs:299 test
test("test", () => {
  assert_raw_stream(dyn_write(new VecU8()));
  assert_raw_stream<VecU8>();
  assert_raw_stream(stderr());
});

/** Accepts one byte per `write`; `zero_after` writes later return Ok(0). */
class Trickle implements Write {
  readonly out = new VecU8();
  calls = 0;
  constructor(readonly zero_after: number) {}
  write(buf: Uint8Array): IoResult<number> {
    if (this.calls++ >= this.zero_after) return Ok(0);
    this.out.write_all(buf.subarray(0, 1));
    return Ok(Math.min(1, buf.length));
  }
  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }
  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }
  flush(): IoResult<void> {
    return Ok(undefined);
  }
}

test("rust-ts: Write_default.write_all loops and reports WriteZero", () => {
  const ok = new Trickle(100);
  expect(ok.write_all(new TextEncoder().encode("hello")).$).toBe("Ok");
  expect(new TextDecoder().decode(ok.out.bytes())).toBe("hello");

  const short = new Trickle(2);
  const r = short.write_all(new TextEncoder().encode("hello"));
  expect(r).toEqual({ $: "Err", _0: { $: "SimpleMessage", kind: "WriteZero", message: "failed to write whole buffer" } });
});

test("rust-ts: AutoStream over a dyn writer", () => {
  const inner = new VecU8();
  const always = AutoStream.new(dyn_write(inner), "AlwaysAnsi");
  expect(always.current_choice()).toBe("AlwaysAnsi");
  expect(always.write_fmt(["\x1b[1m", "x", "\x1b[0m"]).$).toBe("Ok");
  expect(new TextDecoder().decode(inner.bytes())).toBe("\x1b[1mx\x1b[0m");

  const inner2 = new VecU8();
  const never = AutoStream.new(dyn_write(inner2), "Never");
  expect(never.current_choice()).toBe("Never");
  expect(never.is_terminal()).toBe(false);
  expect(never.write_all(new TextEncoder().encode("\x1b[1mx\x1b[0m")).$).toBe("Ok");
  expect(new TextDecoder().decode(inner2.bytes())).toBe("x");
});

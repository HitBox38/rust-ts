// Tests of the src/std/sync/mpsc.ts and src/std/thread.ts stand-ins (lane pm-cross-thread): the bounded channel on
// one thread, its disconnect rules, and the two-channel pipe of the proc-macro bridge with the client end on a
// native second thread (mpsc_test_echo.c).
import { cc, FFIType, ptr, read, toArrayBuffer } from "bun:ffi";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Unported } from "../panic.ts";
import { MessagePipe } from "../../proc_macro/bridge/server.ts";
import * as thread from "../thread.ts";
import { chan_fns, type NativeCodec, sync_channel } from "./mpsc.ts";

/** A message of two words: `[tag, value]`. */
type Msg = [number, number];
const MSG: NativeCodec<Msg> = {
  words: 2,
  write(v: Msg, out: number): void {
    const dst = new BigUint64Array(toArrayBuffer(out, 0, 16));
    dst[0] = BigInt(v[0]);
    dst[1] = BigInt(v[1]);
  },
  read(p: number): Msg {
    return [Number(read.u64(p, 0)), Number(read.u64(p, 8))];
  },
};

test("sync_channel: messages arrive in order, up to the bound without blocking", () => {
  const [tx, rx] = sync_channel<Msg>(2, MSG);
  expect(tx.send([1, 10]).$).toBe("Ok");
  expect(tx.send([2, 20]).$).toBe("Ok");
  expect(rx.recv()).toEqual({ $: "Ok", _0: [1, 10] });
  expect(tx.send([3, 30]).$).toBe("Ok");
  expect(rx.recv()).toEqual({ $: "Ok", _0: [2, 20] });
  expect(rx.recv()).toEqual({ $: "Ok", _0: [3, 30] });
  tx.drop();
  rx.drop();
});

test("sync_channel: recv after the sender is gone drains, then is Err(RecvError)", () => {
  const [tx, rx] = sync_channel<Msg>(1, MSG);
  expect(tx.send([7, 70]).$).toBe("Ok");
  tx.drop();
  expect(rx.recv()).toEqual({ $: "Ok", _0: [7, 70] });
  expect(rx.recv()).toEqual({ $: "Err", _0: "RecvError" });
  rx.drop();
});

test("sync_channel: send after the receiver is gone is Err(SendError(value))", () => {
  const [tx, rx] = sync_channel<Msg>(1, MSG);
  rx.drop();
  expect(tx.send([5, 50])).toEqual({ $: "Err", _0: { _0: [5, 50] } });
  tx.drop();
});

test("sync_channel: dropping a receiver with messages left stops (no drop of T in native memory)", () => {
  const [tx, rx] = sync_channel<Msg>(1, MSG);
  expect(tx.send([1, 1]).$).toBe("Ok");
  expect(() => rx.drop()).toThrow(Unported);
  expect(rx.recv()).toEqual({ $: "Ok", _0: [1, 1] });
  rx.drop();
  tx.drop();
});

test("sync_channel: bound 0 (rendezvous) is not ported", () => {
  expect(() => sync_channel<Msg>(0, MSG)).toThrow("unported: std::sync::mpsc::sync_channel (bound 0");
});

test("an end moved to native code cannot be used or dropped from TS", () => {
  const [tx, rx] = sync_channel<Msg>(1, MSG);
  const raw = tx.into_raw();
  expect(raw).not.toBe(0);
  expect(() => tx.send([1, 1])).toThrow("use of a moved or dropped SyncSender");
  tx.drop(); // no-op
  // Give the end back to the channel's owner so the test frees it.
  rx.drop();
  const n = thread.native_sync();
  n.rts_chan_drop_sender(raw);
});

interface Echo {
  echo_new(tx: number, rx: number, fns: number): number;
  echo_start(): number;
  echo_finish(e: number): number;
}
let ECHO: Echo | undefined;
function echo(): Echo {
  ECHO ??= cc({
    source: join(import.meta.dir, "mpsc_test_echo.c"),
    symbols: {
      echo_new: { args: ["ptr", "ptr", "ptr"], returns: "ptr" },
      echo_start: { args: [], returns: "ptr" },
      echo_finish: { args: ["ptr"], returns: FFIType.i64_fast },
    },
  }).symbols as unknown as Echo;
  return ECHO;
}

/** Spawns the echo thread on `client`'s ends (moved into it), as the bridge's cross-thread strategy does. */
function spawn_echo(client: MessagePipe<Msg>): thread.JoinHandle<number> {
  const e = echo();
  const fns = new BigUint64Array(chan_fns().map(BigInt));
  const st = e.echo_new(client.tx.into_raw(), client.rx.into_raw(), ptr(fns));
  return thread.spawn({ start: e.echo_start(), arg: st, take_result: () => e.echo_finish(st) });
}

test("MessagePipe with the client on a native thread: ping-pong in order, then the server sees the disconnect", () => {
  const [server, client] = MessagePipe.new<Msg>(MSG);
  const join_handle = spawn_echo(client);
  for (let i = 0; i < 1000; i++) {
    server.send([i, i * 2]);
    expect(server.recv()).toEqual([i, i * 2 + 1]);
  }
  // Dropping the server's sender ends the client's loop; the client drops its ends, so `recv` is `None`.
  server.tx.drop();
  expect(server.recv()).toBeUndefined();
  expect(join_handle.join()).toEqual({ $: "Ok", _0: 1000 });
  server.drop();
});

test("MessagePipe: the client blocks in recv until the server answers (the server may take its time)", () => {
  const [server, client] = MessagePipe.new<Msg>(MSG);
  const join_handle = spawn_echo(client);
  server.send([1, 100]);
  const t0 = performance.now();
  while (performance.now() - t0 < 20) {
    // busy: the client is waiting for the next message meanwhile
  }
  expect(server.recv()).toEqual([1, 101]);
  server.send([2, 200]);
  expect(server.recv()).toEqual([2, 201]);
  server.tx.drop();
  expect(server.recv()).toBeUndefined();
  expect(join_handle.join()).toEqual({ $: "Ok", _0: 2 });
  server.drop();
});

test("nested pipes: a second client thread runs while the first one waits for its reply", () => {
  const [s1, c1] = MessagePipe.new<Msg>(MSG);
  const j1 = spawn_echo(c1);
  s1.send([1, 0]);
  // While client 1 waits for a reply on s1 (it already echoed), a second pipe and thread run to completion.
  const [s2, c2] = MessagePipe.new<Msg>(MSG);
  const j2 = spawn_echo(c2);
  for (let i = 0; i < 10; i++) {
    s2.send([2, i]);
    expect(s2.recv()).toEqual([2, i + 1]);
  }
  s2.tx.drop();
  expect(s2.recv()).toBeUndefined();
  expect(j2.join()).toEqual({ $: "Ok", _0: 10 });
  s2.drop();
  expect(s1.recv()).toEqual([1, 1]);
  s1.tx.drop();
  expect(s1.recv()).toBeUndefined();
  expect(j1.join()).toEqual({ $: "Ok", _0: 1 });
  s1.drop();
});

test("a thread spawned with many nested levels (the recursion-limit case) all join", () => {
  // expand-expr.rs's `recursive_expand!` nests one cross-thread client per level up to the recursion limit (128).
  const levels: { s: MessagePipe<Msg>; j: thread.JoinHandle<number> }[] = [];
  for (let i = 0; i < 130; i++) {
    const [s, c] = MessagePipe.new<Msg>(MSG);
    levels.push({ s, j: spawn_echo(c) });
    s.send([i, i]);
  }
  for (let i = levels.length - 1; i >= 0; i--) {
    const { s, j } = levels[i]!;
    expect(s.recv()).toEqual([i, i + 1]);
    s.tx.drop();
    expect(s.recv()).toBeUndefined();
    expect(j.join()).toEqual({ $: "Ok", _0: 1 });
    s.drop();
  }
});

// `BlockingIoManager` with isolation off and no host poller (blocking_io.ts header): the empty poller is ported, and anything
// that would reach the host's still stops.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { BlockingIoManager } from "./blocking_io.ts";
import { type MiriInterpCx } from "../machine.ts";
import { miri_fixture_expected, miri_fixture_port } from "../../rust_ts/miri_fixture.ts";
import { miri_program_problem } from "../../rust_ts/miri_program.ts";
import { Unported } from "../../std/panic.ts";
import { Duration } from "../../std/time.ts";

const manager = (communicate: boolean): BlockingIoManager => {
  const r = BlockingIoManager.new(communicate);
  if (r.$ !== "Ok") throw new Error("BlockingIoManager::new failed");
  return r._0;
};
const ecx_of = (m: BlockingIoManager): MiriInterpCx => ({ machine: { blocking_io: m } }) as unknown as MiriInterpCx;

test("new: `poll` is `None` exactly with isolation on", () => {
  expect(manager(false).poll).toBeUndefined();
  expect(manager(true).poll).toBeDefined();
});

test("poll on an empty poller: no event; with isolation on it panics as upstream's `expect`", () => {
  const r = BlockingIoManager.poll(ecx_of(manager(true)), Duration.ZERO);
  expect(r).toEqual({ $: "Ok", _0: { $: "Ok", _0: null } });
  expect(() => BlockingIoManager.poll(ecx_of(manager(false)), Duration.ZERO)).toThrow("Blocking I/O should not be called with isolation enabled");
});

test("a real poll or registration still stops", () => {
  const m = manager(true);
  expect(() => BlockingIoManager.poll(ecx_of(m), undefined)).toThrow(Unported);
  expect(() => m.register(undefined as never)).toThrow(Unported);
  m.sources.set(undefined as never, undefined as never);
  expect(() => BlockingIoManager.poll(ecx_of(m), Duration.ZERO)).toThrow(Unported);
});

const problem = miri_program_problem();
if (problem !== undefined) console.log(`blocking_io.test.ts: skipped: ${problem}`);
test.skipIf(problem !== undefined)(
  "no_sources.rs matches the oracle",
  () => {
    const file = join(import.meta.dir, "blocking_io_oracle", "no_sources.rs");
    expect(miri_fixture_port(file)).toEqual(miri_fixture_expected(file));
  },
  600_000,
);

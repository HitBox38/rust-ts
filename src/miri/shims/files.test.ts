// Tests of src/miri/shims/files.ts (lane miri-shims-b): FdTable allocation order (shims/files.rs:591-659) and the
// FileDescriptionRef / WeakFileDescriptionRef Rc protocol of the module header.
import { expect, test } from "bun:test";
import "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import {
  type DynFileDescriptionRef,
  FdTable,
  type FileDescription,
  FileDescription_provided,
  FileDescriptionRef,
  NullOutput,
  Stderr,
  Stdin,
  Stdout,
} from "./files.ts";
import { Panic, Unported } from "../../std/panic.ts";

/** A minimal description with a counting drop glue. */
class TestFd implements FileDescription {
  drops = 0;
  constructor(readonly label: string) {}
  name(): string {
    return this.label;
  }
  drop_glue(): void {
    this.drops++;
  }
  read = FileDescription_provided.read;
  write = FileDescription_provided.write;
  short_fd_operations = FileDescription_provided.short_fd_operations;
  seek = FileDescription_provided.seek;
  metadata = FileDescription_provided.metadata;
  is_tty = FileDescription_provided.is_tty;
  as_unix = FileDescription_provided.as_unix;
  readiness_watched = FileDescription_provided.readiness_watched;
  readiness = FileDescription_provided.readiness;
}
class OtherFd extends TestFd {}

const ids = (t: FdTable): [number, number][] => [...t.fds.entries()].sort((a, b) => a[0] - b[0]).map(([n, r]) => [n, r._0.id._0]);

test("FdTable::init: stdin, stdout, stderr at 0, 1, 2 with description ids 0, 1, 2", () => {
  const t = FdTable.init(false);
  expect(ids(t)).toEqual([[0, 0], [1, 1], [2, 2]]);
  expect(t.fds.get(0)!.deref()).toBeInstanceOf(Stdin);
  expect(t.fds.get(1)!.deref()).toBeInstanceOf(Stdout);
  expect(t.fds.get(2)!.deref()).toBeInstanceOf(Stderr);
  expect(t.next_file_description_id._0).toBe(3);
  const muted = FdTable.init(true);
  expect(muted.fds.get(1)!.deref()).toBeInstanceOf(NullOutput);
  expect(muted.fds.get(2)!.deref()).toBeInstanceOf(NullOutput);
  expect(muted.fds.get(1)!.deref().name()).toBe("null output");
  expect(t.fds.get(0)!.deref().name()).toBe("stdin");
  expect(t.fds.get(1)!.deref().readiness()).toEqual({ readable: false, writable: true, read_closed: false, write_closed: false, error: false });
  expect(t.fds.get(0)!.deref().readiness()).toEqual({ readable: true, writable: true, read_closed: false, write_closed: false, error: false });
  expect(t.fds.get(0)!.deref().is_tty(false)).toBe(false);
});

test("FdTable allocation: lowest free number >= min, gaps reused, ids never reused", () => {
  const t = FdTable.new();
  for (const l of ["0", "1", "2"]) t.insert_new(new TestFd(l));
  expect(t.insert_new(new TestFd("a"))).toBe(3);
  expect(t.insert_new(new TestFd("b"))).toBe(4);
  const one = t.remove(1)!;
  expect(one.id()._0).toBe(1);
  expect(t.is_fd_num(1)).toBe(false);
  // The gap at 1 is the lowest free number.
  expect(t.insert_new(new TestFd("c"))).toBe(1);
  expect(t.fds.get(1)!.id()._0).toBe(5);
  // `insert_with_min_num` skips the solid block 3, 4 and takes 5; then 10 above everything.
  const a = t.get(3)!;
  expect(t.insert_with_min_num(a, 3)).toBe(5);
  expect(t.fds.get(5)!.id()._0).toBe(3); // a dup shares the description id
  expect(t.insert_with_min_num(t.get(4)!, 10)).toBe(10);
  // Insertion order of the Map differs from key order; allocation still walks keys in order.
  t.remove(0)!.drop();
  expect(t.insert(t.get(2)!)).toBe(0);
  expect(ids(t)).toEqual([[0, 2], [1, 5], [2, 2], [3, 3], [4, 4], [5, 3], [10, 4]]);
  expect(t.get(7)).toBeUndefined();
  expect(t.remove(7)).toBeUndefined();
  one.drop();
});

test("Rc protocol: clones count, the last drop runs the drop glue once, weak refs see it", () => {
  const t = FdTable.new();
  const fd = new TestFd("x");
  const n = t.insert_new(fd);
  const r = t.get(n)!; // a clone: 2 strong
  const weak = FileDescriptionRef.downgrade(r);
  expect(weak.is_closed()).toBe(false);
  const up = weak.upgrade()!; // 3 strong
  expect(up.eq(r)).toBe(true);
  up.drop();
  r.drop();
  expect(fd.drops).toBe(0);
  expect(() => r.drop()).toThrow(Panic); // a released handle
  expect(() => r.deref()).toThrow(Panic);
  t.remove(n)!.drop(); // the table's handle: 0 strong
  expect(fd.drops).toBe(1);
  expect(weak.is_closed()).toBe(true);
  expect(weak.upgrade()).toBeUndefined();
});

test("downcast: an exact type test; the handle moves into the result, or is dropped on a mismatch", () => {
  const t = FdTable.new();
  const fd = new TestFd("y");
  t.insert_new(fd);
  const is_other = (v: FileDescription): v is OtherFd => v.constructor === OtherFd;
  const is_test = (v: FileDescription): v is TestFd => v.constructor === TestFd;
  const a: DynFileDescriptionRef = t.get(0)!;
  expect(a.downcast(is_other)).toBeUndefined();
  expect(() => a.deref()).toThrow(Panic); // moved
  const b = t.get(0)!.downcast(is_test)!;
  expect(b.deref()).toBe(fd);
  b.drop();
  t.remove(0)!.drop();
  expect(fd.drops).toBe(1);
});

test("provided FileDescription methods: upstream's unsupported / panic messages", () => {
  const fd = new TestFd("thing");
  const ecx = {} as MiriInterpCx;
  const r = fd.read(FdTable.new().new_ref(fd), false, undefined as never, 0, ecx, undefined as never);
  expect(r.$).toBe("Err");
  expect(JSON.stringify(r)).toContain("cannot read from thing");
  expect(JSON.stringify(fd.seek(false, { $: "Start", _0: 0n }))).toContain("cannot seek on thing");
  expect(() => fd.readiness()).toThrow("FD type thing implements `readiness_watched` but not `readiness`");
  expect(() => fd.as_unix(undefined as never)).toThrow("Not a unix file description: thing");
  expect(fd.short_fd_operations()).toBe(false);
  expect(fd.readiness_watched()).toBeUndefined();
});

test("dropping a stdio description runs ReadinessWatched's Drop (lane miri-shims-c; unported until it lands)", () => {
  const t = FdTable.init(false);
  let stop: unknown;
  try {
    t.remove(1)!.drop();
  } catch (e) {
    stop = e;
  }
  // Once shims-c ports `impl Drop for ReadinessWatched` as `drop`, the drop succeeds (no watchers).
  if (stop !== undefined) {
    expect(stop).toBeInstanceOf(Unported);
    expect((stop as Unported).what).toBe("miri::shims::readiness::ReadinessWatched: Drop (shims/readiness.rs:379; lane miri-shims-c)");
  }
});

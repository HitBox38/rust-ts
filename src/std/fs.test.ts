// Unit tests of src/std/fs.ts's host implementation (lane miri-host-fs, plan-m6 D14): every host operation against the
// host itself. Expected values come from `node:fs` (libuv's own calls into the same libc), the OS errno names of
// `node:os`, and std's documented results (error kinds and messages from library/std/src/sys/fs/unix.rs).
// The libc layouts in fs.ts are aarch64-apple-darwin's; elsewhere the host operations stop `unported` (checked below).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { fstatSync, lstatSync, mkdirSync, mkdtempSync, opendirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "./fs.ts";
import { type IoError, IoError_kind, type IoResult } from "./io.ts";
import { Unported } from "./panic.ts";
import { Duration, SystemTime } from "./time.ts";

const HOST = process.platform === "darwin" && process.arch === "arm64";
const E = constants.errno;

let dir = "";
beforeAll(() => {
  if (HOST) dir = realpathSync(mkdtempSync(join(tmpdir(), "rust-ts-fs-test-")));
});
afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

function ok<T>(r: IoResult<T>): T {
  if (r.$ === "Err") throw new Error(`unexpected Err: ${JSON.stringify(r._0)}`);
  return r._0;
}
function err<T>(r: IoResult<T>): IoError {
  if (r.$ === "Ok") throw new Error("unexpected Ok");
  return r._0;
}
const errno = (e: IoError) => (e.$ === "Os" ? e.errno : undefined);
const enc = new TextEncoder();
/** The nanoseconds since the epoch of a `SystemTime`. */
const ns = (t: SystemTime) => t.t.tv_sec * 1_000_000_000n + BigInt(t.t.tv_nsec);
const at = (secs: bigint, nanos = 0) => SystemTime.UNIX_EPOCH.checked_add(Duration.new(secs, nanos))!;

test("host operations: the host's answer on aarch64-apple-darwin, `unported` on another host", () => {
  if (HOST) expect(ok(fs.metadata("/")).is_dir()).toBe(true);
  else expect(() => fs.metadata("/")).toThrow(Unported);
});

test.skipIf(!HOST)("metadata / symlink_metadata / File::metadata match the host's stat", () => {
  const p = join(dir, "meta.txt");
  writeFileSync(p, "Hello, meta-World!\n");
  const n = statSync(p, { bigint: true });
  for (const m of [ok(fs.metadata(p)), ok(fs.symlink_metadata(p)), ok(ok(fs.File.open(p)).metadata())]) {
    expect(m.is_file()).toBe(true);
    expect(m.is_dir() || m.is_symlink()).toBe(false);
    expect(m.len()).toBe(n.size);
    expect(m.permissions().mode()).toBe(Number(n.mode));
    expect([m.dev(), m.ino(), m.nlink(), m.uid(), m.gid(), m.blksize(), m.blocks()]).toEqual([n.dev, n.ino, n.nlink, Number(n.uid), Number(n.gid), n.blksize, n.blocks]);
    expect(ns(ok(m.modified()))).toBe(n.mtimeNs);
    expect(ns(ok(m.accessed()))).toBe(n.atimeNs);
    expect(ns(ok(m.created()))).toBe(n.birthtimeNs);
  }
  const d = ok(fs.metadata(dir));
  expect([d.is_dir(), d.is_file(), d.file_type().is_dir()]).toEqual([true, false, true]);
  const e = err(fs.metadata(join(dir, "missing")));
  expect([errno(e), IoError_kind(e)]).toEqual([E.ENOENT, "NotFound"]);
  // An interior NUL never reaches libc (`run_path_with_cstr`).
  expect(err(fs.metadata("a\0b"))).toEqual({ $: "SimpleMessage", kind: "InvalidInput", message: "file name contained an unexpected NUL byte" });
});

test.skipIf(!HOST)("open passes the mode through the variadic argument (open and openat)", () => {
  const umask = process.umask();
  for (const mode of [0o640, 0o600, 0o755]) {
    const p = join(dir, `mode-${mode.toString(8)}`);
    ok(fs.OpenOptions.new().write(true).create_new(true).mode(mode).open(p)).drop();
    expect(Number(statSync(p).mode) & 0o777).toBe(mode & ~umask);
    const d = ok(fs.Dir.open(dir));
    ok(d.open_file_with(`at-${mode.toString(8)}`, fs.OpenOptions.new().write(true).create_new(true).mode(mode))).drop();
    expect(Number(statSync(join(dir, `at-${mode.toString(8)}`)).mode) & 0o777).toBe(mode & ~umask);
    d.drop();
  }
});

test.skipIf(!HOST)("OpenOptions: access / creation mode errors and host errors", () => {
  const p = join(dir, "opts.txt");
  expect(err(fs.OpenOptions.new().open(p))).toEqual({ $: "Custom", kind: "InvalidInput", error: "must specify at least one of read, write, or append access" });
  expect(err(fs.OpenOptions.new().create(true).open(p))).toEqual({ $: "Custom", kind: "InvalidInput", error: "creating or truncating a file requires write or append access" });
  expect(err(fs.OpenOptions.new().append(true).truncate(true).open(p))).toEqual({ $: "Custom", kind: "InvalidInput", error: "append and truncate cannot both be enabled" });
  expect(errno(err(fs.File.open(p)))).toBe(E.ENOENT);
  ok(fs.OpenOptions.new().write(true).create_new(true).open(p)).drop();
  const exists = err(fs.OpenOptions.new().write(true).create_new(true).open(p));
  expect([errno(exists), IoError_kind(exists)]).toEqual([E.EEXIST, "AlreadyExists"]);
  // A directory opens for reading, not for writing.
  ok(fs.File.open(dir)).drop();
  const isdir = err(fs.OpenOptions.new().write(true).open(dir));
  expect([errno(isdir), IoError_kind(isdir)]).toEqual([E.EISDIR, "IsADirectory"]);
});

test.skipIf(!HOST)("File: write, read, seek, tell, set_len, try_clone, is_terminal, drop", () => {
  const p = join(dir, "rw.txt");
  const f = ok(fs.OpenOptions.new().read(true).write(true).create(true).open(p));
  expect(ok(f.write(new Uint8Array(0)))).toBe(0);
  expect(ok(f.write(enc.encode("Hello, World!\n")))).toBe(14);
  expect(ok(f.stream_position())).toBe(14n);
  expect(ok(f.seek({ $: "Start", _0: 7n }))).toBe(7n);
  const buf = new Uint8Array(32);
  expect(ok(f.read(buf))).toBe(7);
  expect(new TextDecoder().decode(buf.subarray(0, 7))).toBe("World!\n");
  expect(ok(f.read(buf))).toBe(0);
  expect(ok(f.seek({ $: "End", _0: -1n }))).toBe(13n);
  expect(ok(f.seek({ $: "Current", _0: -3n }))).toBe(10n);
  // `SeekFrom::Start(i64::MAX as u64 + 1)` is a negative `off_t`: EINVAL (Miri's issue-miri-3680).
  const big = err(f.seek({ $: "Start", _0: 1n << 63n }));
  expect([errno(big), IoError_kind(big)]).toEqual([E.EINVAL, "InvalidInput"]);
  ok(f.set_len(20n));
  expect(statSync(p).size).toBe(20);
  // A clone shares the file offset.
  const g = ok(f.try_clone());
  ok(g.seek({ $: "Start", _0: 3n }));
  expect(ok(f.stream_position())).toBe(3n);
  expect(f.is_terminal()).toBe(false);
  ok(f.sync_all());
  ok(f.sync_data());
  // Writing to a file opened read-only is EBADF.
  const r = ok(fs.File.open(p));
  expect(errno(err(r.write(enc.encode("x"))))).toBe(E.EBADF);
  // Dropping closes the host fd.
  const fd = f.inner._0.fd;
  f.drop();
  expect(() => fstatSync(fd)).toThrow();
  expect(() => f.metadata()).toThrow();
  g.drop();
  r.drop();
});

test.skipIf(!HOST)("permissions: set_permissions, File::set_permissions, set_readonly", () => {
  const p = join(dir, "perm.txt");
  const f = ok(fs.OpenOptions.new().write(true).create_new(true).open(p));
  const perm = ok(fs.metadata(p)).permissions();
  expect(perm.readonly()).toBe(false);
  perm.set_readonly(true);
  ok(fs.set_permissions(p, perm.clone()));
  expect(Number(statSync(p).mode) & 0o222).toBe(0);
  expect(ok(fs.metadata(p)).permissions().readonly()).toBe(true);
  ok(f.set_permissions(fs.Permissions.from_mode(0o640)));
  expect(Number(statSync(p).mode) & 0o777).toBe(0o640);
  expect(errno(err(fs.set_permissions(join(dir, "missing"), perm)))).toBe(E.ENOENT);
  f.drop();
});

test.skipIf(!HOST)("set_times, set_times_nofollow and File::set_times through setattrlist", () => {
  const p = join(dir, "times.txt");
  writeFileSync(p, "hello");
  ok(fs.set_times(p, fs.FileTimes.new().set_accessed(at(1_000_000_000n)).set_modified(at(1_234_567_890n, 5))));
  let n = statSync(p, { bigint: true });
  expect([n.atimeNs, n.mtimeNs]).toEqual([1_000_000_000n * 1_000_000_000n, 1_234_567_890n * 1_000_000_000n + 5n]);
  // Only the modification time: the access time stays.
  ok(fs.set_times(p, fs.FileTimes.new().set_modified(at(2_000_000_000n))));
  n = statSync(p, { bigint: true });
  expect([n.atimeNs, n.mtimeNs]).toEqual([1_000_000_000n * 1_000_000_000n, 2_000_000_000n * 1_000_000_000n]);
  const f = ok(fs.OpenOptions.new().write(true).open(p));
  ok(f.set_times(fs.FileTimes.new().set_modified(at(1_500_000_000n))));
  expect(statSync(p, { bigint: true }).mtimeNs).toBe(1_500_000_000n * 1_000_000_000n);
  f.drop();
  const l = join(dir, "times-link");
  symlinkSync(p, l);
  ok(fs.set_times_nofollow(l, fs.FileTimes.new().set_modified(at(1_234_567_890n))));
  expect(lstatSync(l, { bigint: true }).mtimeNs).toBe(1_234_567_890n * 1_000_000_000n);
  expect(statSync(p, { bigint: true }).mtimeNs).toBe(1_500_000_000n * 1_000_000_000n);
  expect(errno(err(fs.set_times(join(dir, "missing"), fs.FileTimes.new().set_modified(at(1n)))))).toBe(E.ENOENT);
});

test.skipIf(!HOST)("flock: try_lock / try_lock_shared / unlock", () => {
  const p = join(dir, "lock.txt");
  writeFileSync(p, "x");
  const a = ok(fs.OpenOptions.new().read(true).write(true).open(p));
  const b = ok(fs.OpenOptions.new().read(true).write(true).open(p));
  ok(a.lock_shared());
  expect(ok(b.try_lock_shared() as IoResult<null>)).toBe(null);
  expect(err(a.try_lock() as IoResult<null>)).toEqual({ $: "WouldBlock" } as never);
  ok(a.unlock());
  ok(b.unlock());
  ok(a.lock());
  expect(err(b.try_lock() as IoResult<null>)).toEqual({ $: "WouldBlock" } as never);
  expect(err(b.try_lock_shared() as IoResult<null>)).toEqual({ $: "WouldBlock" } as never);
  ok(a.unlock());
  a.drop();
  b.drop();
});

test.skipIf(!HOST)("read_dir: the host readdir order, d_type, ino, entry metadata; closedir on drop", () => {
  const d = join(dir, "rd");
  mkdirSync(d);
  for (const name of ["b_file", "a_file", "c_file"]) writeFileSync(join(d, name), name);
  mkdirSync(join(d, "sub"));
  symlinkSync("a_file", join(d, "link"));
  // libuv's `uv_fs_readdir` reads the stream with readdir(3) too (and skips `.` / `..` as std does).
  const node = opendirSync(d);
  const expected: string[] = [];
  for (let e = node.readSync(); e !== null; e = node.readSync()) expected.push(e.name);
  node.closeSync();
  const rd = ok(fs.read_dir(d));
  const got: [string, string, boolean][] = [];
  for (let e = rd.next(); e !== undefined; e = rd.next()) {
    const entry = ok(e);
    const name = entry.file_name();
    const ft = ok(entry.file_type());
    expect(entry.ino()).toBe(lstatSync(join(d, name), { bigint: true }).ino);
    const m = ok(entry.metadata());
    expect(m.ino()).toBe(entry.ino());
    got.push([name, ft.is_dir() ? "dir" : ft.is_symlink() ? "link" : ft.is_file() ? "file" : "?", m.is_symlink()]);
  }
  expect(rd.next()).toBeUndefined();
  expect(got.map((g) => g[0])).toEqual(expected);
  expect(got.toSorted()).toEqual([["a_file", "file", false], ["b_file", "file", false], ["c_file", "file", false], ["link", "link", true], ["sub", "dir", false]]);
  rd.drop();
  expect(() => rd.drop()).toThrow();
  expect(errno(err(fs.read_dir(join(dir, "missing"))))).toBe(E.ENOENT);
});

test.skipIf(!HOST)("rename, remove_file, remove_dir, hard_link, symlink, read_link, canonicalize, DirBuilder", () => {
  const a = join(dir, "ren-a");
  const b = join(dir, "ren-b");
  writeFileSync(a, "hello");
  ok(fs.rename(a, b));
  expect(errno(err(fs.metadata(a)))).toBe(E.ENOENT);
  expect(errno(err(fs.rename(a, b)))).toBe(E.ENOENT);
  const h = join(dir, "hard");
  ok(fs.hard_link(b, h));
  expect(ok(fs.metadata(h)).ino()).toBe(ok(fs.metadata(b)).ino());
  expect(ok(fs.metadata(h)).nlink()).toBe(2n);
  expect(IoError_kind(err(fs.hard_link(b, h)))).toBe("AlreadyExists");
  const s = join(dir, "soft");
  ok(fs.unix_symlink(b, s));
  expect(ok(fs.symlink_metadata(s)).file_type().is_symlink()).toBe(true);
  expect(ok(fs.metadata(s)).is_file()).toBe(true);
  expect(ok(fs.read_link(s))).toBe(b);
  // A target longer than readlink's first buffer (256 bytes) takes the growing loop.
  const long = "x".repeat(300);
  const s2 = join(dir, "soft-long");
  ok(fs.unix_symlink(long, s2));
  expect(ok(fs.read_link(s2))).toBe(long);
  expect(ok(fs.canonicalize(`${dir}/./ren-b`))).toBe(b);
  const sub = join(dir, "made");
  ok(fs.DirBuilder.new().mode(0o750).create(sub));
  expect(Number(statSync(sub).mode) & 0o777).toBe(0o750 & ~process.umask());
  expect(IoError_kind(err(fs.DirBuilder.new().create(sub)))).toBe("AlreadyExists");
  writeFileSync(join(sub, "f"), "");
  expect(IoError_kind(err(fs.remove_dir(sub)))).toBe("DirectoryNotEmpty");
  ok(fs.remove_file(join(sub, "f")));
  ok(fs.remove_dir(sub));
  // `remove_dir` on a symlink to a directory is ENOTDIR; `remove_file` removes the link.
  mkdirSync(join(dir, "target-dir"));
  ok(fs.unix_symlink("target-dir", join(dir, "dir-link")));
  expect(IoError_kind(err(fs.remove_dir(join(dir, "dir-link"))))).toBe("NotADirectory");
  ok(fs.remove_file(join(dir, "dir-link")));
  ok(fs.remove_file(s));
  ok(fs.remove_file(s2));
  ok(fs.remove_file(h));
  ok(fs.remove_file(b));
  expect(errno(err(fs.remove_file(b)))).toBe(E.ENOENT);
});

test.skipIf(!HOST)("Dir: open, self_metadata, metadata at a path, try_clone, open on a file", () => {
  const d = join(dir, "dh");
  mkdirSync(d);
  writeFileSync(join(d, "file.txt"), "hello");
  const h = ok(fs.Dir.open(d));
  expect(ok(h.self_metadata()).is_dir()).toBe(true);
  const st = ok(h.metadata("file.txt"));
  expect([st.is_file(), st.len()]).toEqual([true, 5n]);
  expect(ok(h.metadata(join(d, "file.txt"))).len()).toBe(5n);
  expect(errno(err(h.metadata("missing")))).toBe(E.ENOENT);
  const c = ok(h.try_clone());
  expect(c.inner._0.fd).not.toBe(h.inner._0.fd);
  expect(c.inner._0.fd).toBeGreaterThanOrEqual(3);
  expect(ok(c.self_metadata()).ino()).toBe(ok(h.self_metadata()).ino());
  const f = ok(h.open_file_with("file.txt", fs.OpenOptions.new().read(true)));
  const buf = new Uint8Array(16);
  expect(ok(f.read(buf))).toBe(5);
  expect(IoError_kind(err(h.open_file_with("file.txt", fs.OpenOptions.new().write(true).create_new(true))))).toBe("AlreadyExists");
  const notdir = err(fs.Dir.open(join(d, "file.txt")));
  expect([errno(notdir), IoError_kind(notdir)]).toEqual([E.ENOTDIR, "NotADirectory"]);
  // A `File` turned into a `Dir` keeps the fd (Miri's `open_file_or_dir`).
  const asfile = ok(fs.File.open(d));
  const fd = asfile.inner._0.fd;
  const asdir = fs.Dir.from_owned_fd(asfile.into_owned_fd());
  expect(asdir.inner._0.fd).toBe(fd);
  expect(() => asfile.metadata()).toThrow();
  expect(ok(asdir.self_metadata()).is_dir()).toBe(true);
  for (const x of [asdir, f, c, h]) x.drop();
});

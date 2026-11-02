// Tests of src/miri/shims/io_error.ts (lane miri-shims-b): the errno tables and the host <-> target errno mapping.
//
// ORACLE_X86_64_LINUX is the output of the pinned oracle Miri (`$RUST_TS_DATA/rustup-miri`, target
// x86_64-unknown-linux-gnu, the Miri sysroot) running a program that prints `libc::<NAME>` for every name of
// `UNIX_ERRNO_TABLE` (`#![feature(rustc_private)] extern crate libc;`; the program is in docs/handoff/miri-shims-b.md).
// Those are the target values `eval_libc` reads, and also the glibc host values of `LIBC_ERRNO_LINUX_GNU`.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { IoError, IoError_from_ErrorKind, LIBC_ERRNO_APPLE, LIBC_ERRNO_LINUX_GNU, LibcError, UNIX_ERRNO_NAMES } from "./io_error.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type IoError as io_Error } from "../../std/io.ts";

const ORACLE_X86_64_LINUX =
  "E2BIG=7 EACCES=13 EADDRINUSE=98 EADDRNOTAVAIL=99 EAFNOSUPPORT=97 EAGAIN=11 EALREADY=114 EBADF=9 EBADMSG=74 EBUSY=16 ECANCELED=125 ECHILD=10 ECONNABORTED=103 ECONNREFUSED=111 ECONNRESET=104 EDEADLK=35 EDESTADDRREQ=89 EDOM=33 EDQUOT=122 EEXIST=17 EFAULT=14 EFBIG=27 EHOSTUNREACH=113 EIDRM=43 EILSEQ=84 EINPROGRESS=115 EINTR=4 EINVAL=22 EIO=5 EISCONN=106 EISDIR=21 ELOOP=40 EMFILE=24 EMLINK=31 EMSGSIZE=90 EMULTIHOP=72 ENAMETOOLONG=36 ENETDOWN=100 ENETRESET=102 ENETUNREACH=101 ENFILE=23 ENOBUFS=105 ENODEV=19 ENOENT=2 ENOEXEC=8 ENOLCK=37 ENOLINK=67 ENOMEM=12 ENOMSG=42 ENOPROTOOPT=92 ENOSPC=28 ENOSYS=38 ENOTCONN=107 ENOTDIR=20 ENOTEMPTY=39 ENOTRECOVERABLE=131 ENOTSOCK=88 ENOTSUP=95 ENOTTY=25 ENXIO=6 EOPNOTSUPP=95 EOVERFLOW=75 EOWNERDEAD=130 EPERM=1 EPIPE=32 EPROTO=71 EPROTONOSUPPORT=93 EPROTOTYPE=91 ERANGE=34 EROFS=30 ESOCKTNOSUPPORT=94 ESPIPE=29 ESRCH=3 ESTALE=116 ETIMEDOUT=110 ETXTBSY=26 EWOULDBLOCK=11 EXDEV=18";
const TARGET = new Map(ORACLE_X86_64_LINUX.split(" ").map((kv) => [kv.split("=")[0]!, Number(kv.split("=")[1])]));

test("UNIX_ERRNO_TABLE names are upstream's, in order", () => {
  const data = process.env.RUST_TS_DATA;
  expect(data).toBeDefined();
  const src = readFileSync(join(data!, "rust/src/tools/miri/src/shims/io_error.rs"), "utf8");
  const table = src.slice(src.indexOf("const UNIX_ERRNO_TABLE"), src.indexOf("];", src.indexOf("const UNIX_ERRNO_TABLE")));
  const names = [...table.matchAll(/\("(E[A-Z0-9]+)", libc::\1\)/g)].map((m) => m[1]);
  expect(names).toEqual([...UNIX_ERRNO_NAMES]);
  expect(LIBC_ERRNO_APPLE.length).toBe(UNIX_ERRNO_NAMES.length);
  expect(LIBC_ERRNO_LINUX_GNU.length).toBe(UNIX_ERRNO_NAMES.length);
});

test("LIBC_ERRNO_LINUX_GNU equals the oracle Miri's x86_64-unknown-linux-gnu libc constants", () => {
  expect(UNIX_ERRNO_NAMES.map((n, i) => `${n}=${LIBC_ERRNO_LINUX_GNU[i]}`).join(" ")).toBe(ORACLE_X86_64_LINUX);
});

test("the host table equals the host's errno constants (node:os) and the pinned libc source", () => {
  const E = constants.errno as Record<string, number | undefined>;
  const host = process.platform === "darwin" ? LIBC_ERRNO_APPLE : LIBC_ERRNO_LINUX_GNU;
  // node:os lacks a few names on macOS (ENOTRECOVERABLE, EOWNERDEAD, ESOCKTNOSUPPORT); every name it has must agree.
  const known = UNIX_ERRNO_NAMES.map((n, i) => [n, host[i]!, E[n]] as const).filter(([, , e]) => e !== undefined);
  expect(known.length).toBeGreaterThan(70);
  for (const [n, v, e] of known) expect(`${n}=${v}`).toBe(`${n}=${e}`);
  // libc-0.2.189 (the rust workspace's Cargo.lock): the Apple values, when the crate source is unpacked here.
  const libc = join(process.env.HOME ?? "", ".cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libc-0.2.189/src/unix/bsd/apple/mod.rs");
  if (existsSync(libc)) {
    const src = readFileSync(libc, "utf8");
    const resolve = (n: string): number => {
      const m = new RegExp(`pub const ${n}: c_int = ([^;]+);`).exec(src)!;
      return /^\d+$/.test(m[1]!) ? Number(m[1]) : resolve(m[1]!);
    };
    expect(UNIX_ERRNO_NAMES.map((n, i) => `${n}=${LIBC_ERRNO_APPLE[i]}`)).toEqual(UNIX_ERRNO_NAMES.map((n) => `${n}=${resolve(n)}`));
  }
});

/** A unix-target `MiriInterpCx` whose `eval_libc` returns the oracle's x86_64-linux values. */
function fake_linux_ecx(): MiriInterpCx {
  const target = { families: ["unix"], os: { $: "Linux" } };
  const ecx = {
    tcx: { deref: () => ({ sess: { target } }) },
    eval_context_ref: () => ecx,
    eval_context_mut: () => ecx,
    eval_libc: (name: string) => interp_Scalar.from_i32(TARGET.get(name)!),
    eval_libc_i32: (name: string) => TARGET.get(name)!,
    host_error_to_errnum: InterpCx.prototype.host_error_to_errnum,
    io_error_to_errnum: InterpCx.prototype.io_error_to_errnum,
    try_errnum_to_io_error: InterpCx.prototype.try_errnum_to_io_error,
  };
  return ecx as unknown as MiriInterpCx;
}
const scalar_i32 = (s: unknown): number => {
  const r = interp_Scalar.to_i32(s as never);
  if (r.$ === "Err") throw new Error("not an i32");
  return r._0;
};
const host = (name: string): number => (constants.errno as Record<string, number>)[name]!;

test("host_error_to_errnum: a host errno maps by name to the target's (EAGAIN, ENOENT, EWOULDBLOCK first match)", () => {
  const ecx = fake_linux_ecx();
  const os_err = (name: string): io_Error => ({ $: "Os", errno: host(name), code: name });
  for (const n of ["ENOENT", "EAGAIN", "EBADF", "EINVAL", "EPERM", "ENOTSUP"]) {
    const r = ecx.host_error_to_errnum(os_err(n));
    expect(r.$).toBe("Ok");
    // EWOULDBLOCK == EAGAIN and ENOTSUP vs EOPNOTSUPP: the first name with that host value wins, then the target value.
    expect(scalar_i32(r.$ === "Ok" ? r._0 : undefined)).toBe(TARGET.get(n)!);
  }
  // A kind-only error (`ErrorKind::WouldBlock.into()`) goes through `UNIX_IO_ERROR_TABLE`: EWOULDBLOCK.
  const k = ecx.io_error_to_errnum(IoError_from_ErrorKind("WouldBlock"));
  expect(k.$ === "Ok" && scalar_i32(k._0)).toBe(11);
  const l = ecx.io_error_to_errnum(LibcError("EISDIR"));
  expect(l.$ === "Ok" && scalar_i32(l._0)).toBe(21);
  expect(IoError.LibcError("EBADF")).toEqual({ $: "LibcError", _0: "EBADF" });
});

test("try_errnum_to_io_error: a target errno maps back to the host errno of the same name", () => {
  const ecx = fake_linux_ecx();
  for (const [n, v] of [["EAGAIN", 11], ["ENOENT", 2], ["ETIMEDOUT", 110]] as const) {
    const r = ecx.try_errnum_to_io_error(interp_Scalar.from_i32(v));
    expect(r.$).toBe("Ok");
    const e = r.$ === "Ok" ? r._0 : undefined;
    expect(e?.$ === "Os" ? e.errno : undefined).toBe(host(n));
  }
  const none = ecx.try_errnum_to_io_error(interp_Scalar.from_i32(4095));
  expect(none.$ === "Ok" && none._0).toBeUndefined();
});

test("into_ntstatus", () => {
  expect(IoError.into_ntstatus(LibcError("EBADF"))).toBe(0xc0000185 | 0);
  expect(IoError.into_ntstatus(IoError_from_ErrorKind("PermissionDenied"))).toBe(0xc0000022 | 0);
});

// Port of jobserver =0.1.34 `src/unix.rs`: only what `Client::from_env_ext` reaches (`open` and its checks).
// See error.ts on the `crate-pending:` markers.
//
// PORT: rust-ts holds no jobserver file descriptors. Upstream keeps the fds it opens for its helper thread and for
// acquiring tokens, which codegen's parallelism uses; the port is single-threaded (plan-m7 D15) and acquires nothing
// (D11), so the fifo is opened only to report the same error and closed again, and `R,W` is only checked.
import { closeSync, fstatSync, openSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";
import { Err, Ok, type Result } from "../../std/result.ts";
import { io_error_from_node } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { FromEnvErrorInner } from "./error.ts";

/** PORT: stands for jobserver's `imp::Client`, which rust-ts never reads or writes (see the module comment). */
export interface Client {
  readonly creation_arg: { readonly $: "Fifo"; readonly path: string } | { readonly $: "Fds"; readonly read: number; readonly write: number };
}

// crate-pending: jobserver-0.1.34/src/unix.rs:90 open
export function Client_open(s: string, check_pipe: boolean): Result<Client, FromEnvErrorInner> {
  const fifo = Client_from_fifo(s);
  if (fifo.$ === "Err") return fifo;
  if (fifo._0 !== undefined) return Ok(fifo._0);
  const pipe = Client_from_pipe(s, check_pipe);
  if (pipe.$ === "Err") return pipe;
  if (pipe._0 !== undefined) return Ok(pipe._0);
  return Err({ $: "CannotParse", _0: `expected \`fifo:PATH\` or \`R,W\`, found \`${s}\`` });
}

/** `--jobserver-auth=fifo:PATH` */
// crate-pending: jobserver-0.1.34/src/unix.rs:103 from_fifo
function Client_from_fifo(s: string): Result<Client | undefined, FromEnvErrorInner> {
  // `s.splitn(2, ':')`
  const colon = s.indexOf(":");
  if ((colon < 0 ? s : s.slice(0, colon)) !== "fifo") {
    return Ok(undefined);
  }
  if (colon < 0) {
    return Err({ $: "CannotParse", _0: "expected a path after `fifo:`" });
  }
  const path_str = s.slice(colon + 1);

  // Opening with read write is necessary, since opening with
  // read-only or write-only could block the thread until another
  // thread opens it with write-only or read-only (or RDWR)
  // correspondingly.
  // PORT: upstream opens it twice, keeping both; opening once reports the same error (see the module comment).
  try {
    closeSync(openSync(path_str, "r+"));
  } catch (err) {
    return Err({ $: "CannotOpenPath", _0: path_str, _1: io_error_from_node(err) });
  }

  return Ok({ creation_arg: { $: "Fifo", path: path_str } });
}

/**
 * `<i32 as FromStr>::from_str` (core/src/num/mod.rs `from_ascii_radix`), with its `ParseIntError`'s `Display`.
 * Upstream checks a digit before the overflow it may have computed, so `99999999999x` is an invalid digit.
 */
function parse_i32(src: string): Result<number, string> {
  const INVALID_DIGIT = "invalid digit found in string";
  if (src === "") return Err("cannot parse integer from empty string");
  if (src === "+" || src === "-") return Err(INVALID_DIGIT);
  const negative = src[0] === "-";
  const digits = src[0] === "+" || src[0] === "-" ? src.slice(1) : src;
  let result = 0;
  for (let i = 0; i < digits.length; i++) {
    const x = digits.charCodeAt(i) - 0x30;
    if (x < 0 || x > 9) return Err(INVALID_DIGIT);
    result = result * 10 + (negative ? -x : x);
    if (result > 0x7fffffff) return Err("number too large to fit in target type");
    if (result < -0x80000000) return Err("number too small to fit in target type");
  }
  return Ok(result + 0); // (`-0` is 0)
}

/** `--jobserver-auth=R,W` */
// crate-pending: jobserver-0.1.34/src/unix.rs:134 from_pipe
function Client_from_pipe(s: string, check_pipe: boolean): Result<Client | undefined, FromEnvErrorInner> {
  // `s.splitn(2, ',')`
  const comma = s.indexOf(",");
  if (comma < 0) return Ok(undefined);
  const read_s = s.slice(0, comma);
  const write_s = s.slice(comma + 1);
  const read = parse_i32(read_s);
  if (read.$ === "Err") return Err({ $: "CannotParse", _0: `cannot parse \`read\` fd: ${read._0}` });
  const write = parse_i32(write_s);
  if (write.$ === "Err") return Err({ $: "CannotParse", _0: `cannot parse \`write\` fd: ${write._0}` });

  // If either or both of these file descriptors are negative,
  // it means the jobserver is disabled for this process.
  if (read._0 < 0) {
    return Err({ $: "NegativeFd", _0: read._0 });
  }
  if (write._0 < 0) {
    return Err({ $: "NegativeFd", _0: write._0 });
  }

  // Ok so we've got two integers that look like file descriptors, but
  // for extra sanity checking let's see if they actually look like
  // valid files and instances of a pipe if feature enabled before we
  // return the client.
  //
  // If we're called from `make` *without* the leading + on our rule
  // then we'll have `MAKEFLAGS` env vars but won't actually have
  // access to the file descriptors.
  //
  // `NotAPipe` is a worse error, return it if it's reported for any of the two fds.
  const read_err = fd_check(read._0, check_pipe);
  const write_err = fd_check(write._0, check_pipe);
  if (read_err !== undefined && read_err.$ === "NotAPipe") return Err(read_err);
  if (write_err !== undefined && write_err.$ === "NotAPipe") return Err(write_err);
  if (read_err !== undefined) return Err(read_err);
  if (write_err !== undefined) return Err(write_err);

  // PORT: `clone_fd_and_set_cloexec` is not called (see the module comment). It fails only when the process has no
  // free descriptors, and this runs before the compiler opens any.
  return Ok({ creation_arg: { $: "Fds", read: read._0, write: write._0 } });
}

let FCNTL: ((fd: number, cmd: number) => number) | undefined;

/**
 * PORT: whether `fd` is open with `FD_CLOEXEC` set. Unlike the oracle's small runtime, Bun has descriptors of its own
 * by the time this runs (a pipe at 3, for one), so a closed number in the variable can name one of them and look open.
 * Nothing that came through `exec` can have `FD_CLOEXEC` set, so such a descriptor is the runtime's, and to the
 * program that was started it is not open.
 */
function runtime_owned_fd(fd: number): boolean {
  if (FCNTL === undefined) {
    const lib = dlopen(process.platform === "linux" ? "libc.so.6" : "libSystem.B.dylib", { fcntl: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    FCNTL = (fd, cmd) => lib.symbols.fcntl(fd, cmd) as number;
  }
  const F_GETFD = 1;
  const FD_CLOEXEC = 1;
  const flags = FCNTL(fd, F_GETFD);
  return flags !== -1 && (flags & FD_CLOEXEC) !== 0;
}

const EBADF = { $: "Os", errno: 9, code: "EBADF" } as const;

// crate-pending: jobserver-0.1.34/src/unix.rs:480 fd_check
function fd_check(fd: number, check_pipe: boolean): FromEnvErrorInner | undefined {
  if (!check_pipe) return unported("jobserver::imp::fd_check (check_pipe false: rustc always passes true)");
  if (runtime_owned_fd(fd)) return { $: "CannotOpenFd", _0: fd, _1: EBADF };
  let mode: number;
  try {
    mode = fstatSync(fd).mode;
  } catch (err) {
    // PORT: `fcntl_check` after a failed `fstat`. `fstat` on a usable fd fails only with errors the `fcntl` cannot
    // be asked about without guessing; `EBADF`, the only one that names a closed fd, is what `fcntl` reports too.
    const e = io_error_from_node(err);
    if (e.$ === "Os" && e.code === "EBADF") return { $: "CannotOpenFd", _0: fd, _1: e };
    return unported(`jobserver::imp::fd_check (fstat failed with ${e.$ === "Os" ? e.code : e.$})`);
  }
  const S_IFIFO = 0o010000;
  if ((mode & S_IFIFO) === S_IFIFO) {
    return undefined;
  }
  return { $: "NotAPipe", _0: fd, _1: undefined };
}

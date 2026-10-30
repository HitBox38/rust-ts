// Port of anstream =0.6.21 `src/stream.rs` (non-windows: `RawStream` has no
// `anstyle_wincon::WinconStream` supertrait), plus the `std::io::Write` shim anstream sits on.
//
//! Higher-level traits to describe writeable streams
//
// PORT: the `std::io::Write` shim (trait + provided methods, `std::io::Stdout`/`Stderr`,
// `Vec<u8>`, `Box<dyn Write + Send>`) lives here until root moves it to src/std/io.ts.
// - `std::fmt::Arguments` is pre-rendered (`FmtArguments`): the `write_str` calls
//   `core::fmt::write` makes, in order.
// - Locking is the identity: `as_locked_write()`/`lock()` return the stream itself.
// - `private::Sealed` is erased. The forwarding impls for `&T`, `&mut T` and `Box<T>` are erased
//   with the reference/box (§5: `Box<T>`/`&T` → `T`):
// crate-skip: anstream-0.6.21/src/stream.rs:44 is_terminal forwarding impl for &T (erased)
// crate-skip: anstream-0.6.21/src/stream.rs:51 is_terminal forwarding impl for &mut T (erased)
// crate-skip: anstream-0.6.21/src/stream.rs:58 is_terminal forwarding impl for Box<T> (erased)
// crate-skip: anstream-0.6.21/src/stream.rs:152 as_locked_write forwarding impl for &mut T (erased)
// crate-skip: anstream-0.6.21/src/stream.rs:164 as_locked_write forwarding impl for Box<T> (erased)
// - `std::fs::File` is not a stream rust-ts writes diagnostics to, and `crate::Buffer` is the
//   deprecated `buffer.rs` (not ported):
// crate-skip: anstream-0.6.21/src/stream.rs:121 is_terminal impl for std::fs::File (File streams not modelled)
// crate-skip: anstream-0.6.21/src/stream.rs:129 is_terminal impl for the deprecated crate::Buffer (buffer.rs not ported)
// crate-skip: anstream-0.6.21/src/stream.rs:245 as_locked_write impl for std::fs::File (File streams not modelled)
// crate-skip: anstream-0.6.21/src/stream.rs:255 as_locked_write impl for the deprecated crate::Buffer (buffer.rs not ported)

import { writeSync, writevSync } from "node:fs";
import { isatty } from "node:tty";
import { io_error_from_node, type IoError, type IoResult } from "../../std/io.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";

/** `std::fmt::Arguments`, pre-rendered: the sequence of `write_str` calls `core::fmt::write` makes. */
export type FmtArguments = readonly string[];

/** `std::fmt::Error` */
export type FmtError = "fmt::Error";
/** `std::fmt::Result` */
export type FmtResult = Result<undefined, FmtError>;

/** `std::fmt::Write`, reduced to the required method. */
export interface FmtWrite {
  write_str(s: string): FmtResult;
}

/** `core::fmt::write(output, args)` over pre-rendered arguments. */
export function fmt_write(output: FmtWrite, args: FmtArguments): FmtResult {
  for (const piece of args) {
    const r = output.write_str(piece);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
}

/** `std::io::Write` */
export interface Write {
  write(buf: Uint8Array): IoResult<number>;
  /** Optional: absent means the provided `default_write_vectored`. Call through `write_vectored(w, bufs)`. */
  write_vectored?(bufs: readonly Uint8Array[]): IoResult<number>;
  /** std default: loop on `write`; 0 → `WriteZero` "failed to write whole buffer". */
  write_all(buf: Uint8Array): IoResult<void>;
  /** std default: adapter calling `write_all` per piece. */
  write_fmt(args: FmtArguments): IoResult<void>;
  flush(): IoResult<void>;
}

/** `io::Error::WRITE_ALL_EOF` (core/src/io/error.rs:125): `const_error!(ErrorKind::WriteZero, "failed to write whole buffer")` */
export const WRITE_ALL_EOF: IoError = {
  $: "SimpleMessage",
  kind: "WriteZero",
  message: "failed to write whole buffer",
};

/** `io::Error::is_interrupted` (core/src/io/error.rs:484); OS errors: `EINTR`. */
export function is_interrupted(e: IoError): boolean {
  switch (e.$) {
    case "Os":
      return e.code === "EINTR";
    case "Custom":
    case "SimpleMessage":
      return e.kind === "Interrupted";
  }
}

/** The provided methods of `std::io::Write` (core/src/io/write.rs). */
export const Write_default = {
  /** `Write::write_vectored` → `default_write_vectored(|b| self.write(b), bufs)` (write.rs:135, 373) */
  write_vectored(self: Write, bufs: readonly Uint8Array[]): IoResult<number> {
    const buf = bufs.find((b) => b.length !== 0) ?? new Uint8Array(0);
    return self.write(buf);
  },

  /** `Write::write_all` (write.rs:214) */
  write_all(self: Write, buf: Uint8Array): IoResult<void> {
    while (buf.length !== 0) {
      const r = self.write(buf);
      if (r.$ === "Ok") {
        if (r._0 === 0) {
          return Err(WRITE_ALL_EOF);
        }
        buf = buf.subarray(r._0);
      } else if (is_interrupted(r._0)) {
        // retry
      } else {
        return r;
      }
    }
    return Ok(undefined);
  },

  /** `Write::write_fmt` (write.rs:331) → `default_write_fmt` (write.rs:381). */
  write_fmt(self: Write, args: FmtArguments): IoResult<void> {
    // Create a shim which translates a `Write` to a `fmt::Write` and saves off
    // I/O errors, instead of discarding them.
    const output: FmtWrite & { error: IoResult<void> } = {
      error: Ok(undefined),
      write_str(s: string): FmtResult {
        const r = self.write_all(utf8(s));
        if (r.$ === "Ok") return Ok(undefined);
        this.error = r;
        return Err("fmt::Error");
      },
    };
    const r = fmt_write(output, args);
    if (r.$ === "Ok") return Ok(undefined);
    // Check whether the error came from the underlying `Write`.
    if (output.error.$ === "Err") {
      return output.error;
    } else {
      // This shouldn't happen: the underlying stream did not error,
      // but somehow the formatter still errored?
      return panic("a formatting trait implementation returned an error when the underlying stream did not");
    }
  },
} as const;

/** `w.write_vectored(bufs)` for any `Write` (the provided method when `w` has none). */
export function write_vectored(w: Write, bufs: readonly Uint8Array[]): IoResult<number> {
  return w.write_vectored !== undefined ? w.write_vectored(bufs) : Write_default.write_vectored(w, bufs);
}

/// Required functionality for underlying [`std::io::Write`] for adaptation
// (#[cfg(not(all(windows, feature = "wincon")))])
export interface RawStream extends Write, IsTerminal {}

/// Trait to determine if a descriptor/handle refers to a terminal/tty.
export interface IsTerminal {
  /// Returns `true` if the descriptor/handle refers to a terminal/tty.
  // crate: anstream-0.6.21/src/stream.rs:39 is_terminal
  is_terminal(): boolean;
}

/// Lock a stream
export interface AsLockedWrite {
  /// Lock a stream
  // PORT: the `Write<'w>` associated type is `RawStream`.
  // crate: anstream-0.6.21/src/stream.rs:142 as_locked_write
  as_locked_write(): RawStream;
}

// ---------------------------------------------------------------------------------------------
// std::io::Stdout / std::io::Stderr (library/std/src/io/stdio.rs)
// ---------------------------------------------------------------------------------------------

/** `std::sys::stdio::unix::{Stdout, Stderr}`: `write(2)` on the fd. */
class FdRaw implements Write {
  constructor(readonly fd: number) {}

  write(buf: Uint8Array): IoResult<number> {
    for (;;) {
      try {
        return Ok(writeSync(this.fd, buf));
      } catch (e) {
        // PORT: the host may leave the fd non-blocking (Bun/Node stdio); a blocking `write(2)`
        // would wait, so `EAGAIN` is retried.
        if ((e as { code?: string }).code === "EAGAIN") continue;
        return Err(io_error_from_node(e));
      }
    }
  }

  write_vectored(bufs: readonly Uint8Array[]): IoResult<number> {
    for (;;) {
      try {
        return Ok(writevSync(this.fd, bufs as Uint8Array[]));
      } catch (e) {
        if ((e as { code?: string }).code === "EAGAIN") continue;
        return Err(io_error_from_node(e));
      }
    }
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

/** `handle_ebadf` (stdio.rs:224): a closed stdio fd swallows output. */
function handle_ebadf<T>(r: IoResult<T>, default_: () => IoResult<T>): IoResult<T> {
  if (r.$ === "Err" && r._0.$ === "Os" && r._0.code === "EBADF") return default_();
  return r;
}

/** `StdoutRaw`/`StderrRaw` + the `Stdout`/`Stderr` handles over them. */
abstract class StdioStream implements RawStream, AsLockedWrite {
  readonly raw: FdRaw;

  constructor(fd: number) {
    this.raw = new FdRaw(fd);
  }

  write(buf: Uint8Array): IoResult<number> {
    return handle_ebadf(this.raw.write(buf), () => Ok(buf.length));
  }

  write_vectored(bufs: readonly Uint8Array[]): IoResult<number> {
    const total = (): IoResult<number> => Ok(bufs.reduce((n, b) => n + b.length, 0));
    return handle_ebadf(this.raw.write_vectored(bufs), total);
  }

  flush(): IoResult<void> {
    return handle_ebadf(this.raw.flush(), () => Ok(undefined));
  }

  write_all(buf: Uint8Array): IoResult<void> {
    return handle_ebadf(this.raw.write_all(buf), () => Ok(undefined));
  }

  /** `StdoutLock`/`StderrLock` keep the provided `write_fmt` (each piece → `write_all`). */
  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }

  // impl IsTerminal for std::io::{Stdout, StdoutLock, Stderr, StderrLock}
  // (`is_terminal_polyfill` → std's `IsTerminal` → `libc::isatty(fd) != 0`)
  abstract is_terminal(): boolean;

  // impl AsLockedWrite for std::io::{Stdout, StdoutLock, Stderr, StderrLock}
  abstract as_locked_write(): RawStream;
}

/**
 * `std::io::Stdout`.
 *
 * PORT: std's stdout is a `LineWriter`; this one is unbuffered (each write goes straight to fd 1).
 * The bytes are the same; only their interleaving with stderr on a shared pipe can differ.
 */
export class Stdout extends StdioStream {
  constructor() {
    super(1);
  }

  // crate: anstream-0.6.21/src/stream.rs:65 is_terminal
  // crate: anstream-0.6.21/src/stream.rs:72 is_terminal
  is_terminal(): boolean {
    return isatty(1);
  }

  // crate: anstream-0.6.21/src/stream.rs:173 as_locked_write
  // crate: anstream-0.6.21/src/stream.rs:182 as_locked_write
  as_locked_write(): Stdout {
    return this.lock();
  }

  /** `Stdout::lock` (identity). */
  lock(): Stdout {
    return this;
  }
}

/** `std::io::Stderr`: unbuffered, writes bytes synchronously to fd 2. */
export class Stderr extends StdioStream {
  constructor() {
    super(2);
  }

  // crate: anstream-0.6.21/src/stream.rs:79 is_terminal
  // crate: anstream-0.6.21/src/stream.rs:86 is_terminal
  is_terminal(): boolean {
    return isatty(2);
  }

  // crate: anstream-0.6.21/src/stream.rs:191 as_locked_write
  // crate: anstream-0.6.21/src/stream.rs:200 as_locked_write
  as_locked_write(): Stderr {
    return this.lock();
  }

  /** `Stderr::lock` (identity). */
  lock(): Stderr {
    return this;
  }
}

/** `std::io::stdout()` */
export function stdout(): Stdout {
  return new Stdout();
}

/** `std::io::stderr()` */
export function stderr(): Stderr {
  return new Stderr();
}

// ---------------------------------------------------------------------------------------------
// Vec<u8> (library/alloc/src/io/impls.rs:396)
// ---------------------------------------------------------------------------------------------

const VEC_U8_ENCODER = new TextEncoder();

/** `Vec<u8>` as a writer. */
export class VecU8 implements RawStream, AsLockedWrite {
  private buf: Uint8Array = new Uint8Array(64);
  private len = 0;

  write(buf: Uint8Array): IoResult<number> {
    const r = this.write_all(buf);
    if (r.$ === "Err") return r;
    return Ok(buf.length);
  }

  write_vectored(bufs: readonly Uint8Array[]): IoResult<number> {
    const len = bufs.reduce((n, b) => n + b.length, 0);
    this.reserve(len);
    for (const buf of bufs) {
      const r = this.write_all(buf);
      if (r.$ === "Err") return r;
    }
    return Ok(len);
  }

  write_all(buf: Uint8Array): IoResult<void> {
    this.reserve(buf.length);
    this.buf.set(buf, this.len);
    this.len += buf.length;
    return Ok(undefined);
  }

  write_fmt(args: FmtArguments): IoResult<void> {
    // PORT: (perf) `Write_default.write_fmt` (the `write_all(utf8(piece))` shim) with each piece UTF-8-encoded
    // straight into the buffer: `Vec<u8>`'s `write_all` cannot fail, so the result is always `Ok`.
    for (let i = 0; i < args.length; i++) this.push_str(args[i]!);
    return Ok(undefined);
  }

  /** PORT: (perf) `write_all(s.as_bytes())` without the intermediate `Uint8Array`. */
  private push_str(s: string): void {
    const n = s.length;
    // A UTF-16 code unit takes at most 3 UTF-8 bytes (a surrogate pair: 4 bytes for 2 units).
    this.reserve(3 * n);
    const buf = this.buf;
    let len = this.len;
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80) {
        len += VEC_U8_ENCODER.encodeInto(s.slice(i), buf.subarray(len)).written;
        break;
      }
      buf[len++] = c;
    }
    this.len = len;
  }

  flush(): IoResult<void> {
    return Ok(undefined);
  }

  // crate: anstream-0.6.21/src/stream.rs:114 is_terminal
  is_terminal(): boolean {
    return false;
  }

  // crate: anstream-0.6.21/src/stream.rs:236 as_locked_write
  as_locked_write(): VecU8 {
    return this;
  }

  /** The bytes written so far (a view; valid until the next write). */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  /** `Vec::clear` */
  clear(): void {
    this.len = 0;
  }

  private reserve(additional: number): void {
    if (this.len + additional <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + additional));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
}

// ---------------------------------------------------------------------------------------------
// Box<dyn Write + Send>
// ---------------------------------------------------------------------------------------------

/** `Box<dyn Write + Send>` as a `RawStream`: forwards every `Write` method to the inner writer. */
export function dyn_write(w: Write): RawStream & AsLockedWrite {
  const s: RawStream & AsLockedWrite = {
    write: (buf) => w.write(buf),
    write_vectored: (bufs) => write_vectored(w, bufs),
    write_all: (buf) => w.write_all(buf),
    write_fmt: (args) => w.write_fmt(args),
    flush: () => w.flush(),

    // impl IsTerminal for dyn std::io::Write {, + Send, + Send + Sync}
    // crate: anstream-0.6.21/src/stream.rs:93 is_terminal
    // crate: anstream-0.6.21/src/stream.rs:100 is_terminal
    // crate: anstream-0.6.21/src/stream.rs:107 is_terminal
    is_terminal: () => false,

    // impl AsLockedWrite for dyn std::io::Write {, + Send, + Send + Sync}
    // crate: anstream-0.6.21/src/stream.rs:209 as_locked_write
    // crate: anstream-0.6.21/src/stream.rs:218 as_locked_write
    // crate: anstream-0.6.21/src/stream.rs:227 as_locked_write
    as_locked_write: () => s,
  };
  return s;
}

// Port of anstream =0.6.21 `src/fmt.rs`.

import { io_error_other, type IoResult } from "../../std/io.ts";
import { Err, Ok } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { fmt_write, type FmtArguments, type FmtResult, type FmtWrite } from "./stream.ts";

/// A shim which allows a [`std::io::Write`] to be implemented in terms of a [`std::fmt::Write`]
///
/// This saves off I/O errors. instead of discarding them
export class Adapter implements FmtWrite {
  constructor(
    public writer: (buf: Uint8Array) => IoResult<void>,
    public error: IoResult<void>,
  ) {}

  // crate: anstream-0.6.21/src/fmt.rs:16 new
  static new(writer: (buf: Uint8Array) => IoResult<void>): Adapter {
    return new Adapter(writer, Ok(undefined));
  }

  // crate: anstream-0.6.21/src/fmt.rs:23 write_fmt
  write_fmt(fmt: FmtArguments): IoResult<void> {
    const r = fmt_write(this, fmt);
    if (r.$ === "Ok") {
      return Ok(undefined);
    } else {
      // check if the error came from the underlying `Write` or not
      if (this.error.$ === "Err") {
        return this.error;
      } else {
        return Err(io_error_other("formatter error"));
      }
    }
  }

  // impl<W> std::fmt::Write for Adapter<W>
  // crate: anstream-0.6.21/src/fmt.rs:45 write_str
  write_str(s: string): FmtResult {
    const r = this.writer(utf8(s));
    if (r.$ === "Ok") {
      return Ok(undefined);
    } else {
      this.error = r;
      return Err("fmt::Error");
    }
  }
}

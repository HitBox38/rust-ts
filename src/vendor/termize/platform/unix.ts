// Port of termize =0.2.1 `src/platform/unix.rs`.
//
// PORT: `ioctl(fd, TIOCGWINSZ, &mut window)` → `ioctl_tiocgwinsz(fd, window)`: `tty.isatty(fd)`
// false (not a terminal: the ioctl fails with ENOTTY) → -1; otherwise the size comes from
// `new tty.WriteStream(fd).getWindowSize()` (`[columns, rows]`, the TIOCGWINSZ values), any throw
// → -1. Opening `/dev/tty` uses `fs.openSync("/dev/tty", "r")` in try/catch (the
// `File::options().read(true).open` failure arm) and closes the fd afterwards (the `File` drop).
// `winsize` keeps its four fields; the pixel fields are left 0 (nothing reads them).
// The upstream test spawns `stty` against the real terminal; it is not ported:
// crate-skip: termize-0.2.1/src/platform/unix.rs:197 stty_size test helper spawning stty on the real terminal
// crate-skip: termize-0.2.1/src/platform/unix.rs:208 stty_size test helper spawning stty on the real terminal
// crate-skip: termize-0.2.1/src/platform/unix.rs:219 test_shell needs a real terminal (stty)

import { closeSync, openSync } from "node:fs";
import { WriteStream, isatty } from "node:tty";

const STDIN_FILENO = 0;
const STDOUT_FILENO = 1;
const STDERR_FILENO = 2;

/** `libc::winsize` */
interface winsize {
  ws_row: number;
  ws_col: number;
  ws_xpixel: number;
  ws_ypixel: number;
}

/** `mem::zeroed::<winsize>()` */
function zeroed(): winsize {
  return { ws_row: 0, ws_col: 0, ws_xpixel: 0, ws_ypixel: 0 };
}

/** `libc::ioctl(fd, TIOCGWINSZ, window)`: 0 on success, -1 on failure. */
function ioctl_tiocgwinsz(fd: number, window: winsize): number {
  if (!isatty(fd)) return -1;
  try {
    const [cols, rows] = new WriteStream(fd).getWindowSize();
    window.ws_col = cols & 0xffff;
    window.ws_row = rows & 0xffff;
    return 0;
  } catch {
    return -1;
  }
}

/// Runs the ioctl command. Returns (0, 0) if all of the streams are not to a terminal, or
/// there is an error. (0, 0) is an invalid size to have anyway, which is why
/// it can be used as a nil value.
/// If none of `stdout`, `stdin` and `stderr` is a terminal, `/dev/tty` will be queried.
// crate: termize-0.2.1/src/platform/unix.rs:11 get_dimensions_any
function get_dimensions_any(): winsize {
  let window: winsize = zeroed();
  let result = ioctl_tiocgwinsz(STDOUT_FILENO, window);

  if (result === -1) {
    window = zeroed();
    result = ioctl_tiocgwinsz(STDIN_FILENO, window);
    if (result === -1) {
      window = zeroed();
      result = ioctl_tiocgwinsz(STDERR_FILENO, window);
      if (result === -1) {
        window = zeroed();
        let tty: number;
        try {
          tty = openSync("/dev/tty", "r");
        } catch {
          return zeroed();
        }
        try {
          result = ioctl_tiocgwinsz(tty, window);
        } finally {
          closeSync(tty);
        }
        if (result === -1) {
          return zeroed();
        }
      }
    }
  }
  return window;
}

/// Runs the ioctl command. Returns (0, 0) if the output is not to a terminal, or
/// there is an error. (0, 0) is an invalid size to have anyway, which is why
/// it can be used as a nil value.
// crate: termize-0.2.1/src/platform/unix.rs:39 get_dimensions_out
function get_dimensions_out(): winsize {
  const window: winsize = zeroed();
  const result = ioctl_tiocgwinsz(STDOUT_FILENO, window);

  if (result !== -1) {
    return window;
  }
  return zeroed();
}

/// Runs the ioctl command. Returns (0, 0) if the input is not to a terminal, or
/// there is an error. (0, 0) is an invalid size to have anyway, which is why
/// it can be used as a nil value.
// crate: termize-0.2.1/src/platform/unix.rs:52 get_dimensions_in
function get_dimensions_in(): winsize {
  const window: winsize = zeroed();
  const result = ioctl_tiocgwinsz(STDIN_FILENO, window);

  if (result !== -1) {
    return window;
  }
  return zeroed();
}

/// Runs the ioctl command. Returns (0, 0) if the error is not to a terminal, or
/// there is an error. (0, 0) is an invalid size to have anyway, which is why
/// it can be used as a nil value.
// crate: termize-0.2.1/src/platform/unix.rs:65 get_dimensions_err
function get_dimensions_err(): winsize {
  const window: winsize = zeroed();
  const result = ioctl_tiocgwinsz(STDERR_FILENO, window);

  if (result !== -1) {
    return window;
  }
  return zeroed();
}

/// Query the current processes's output (`stdout`), input (`stdin`), and error (`stderr`) in
/// that order, in the attempt to determine terminal width. If one of those streams is actually
/// a tty, this function returns its width and height as a number of characters.
///
/// # Errors
///
/// If *all* of the streams are not ttys or return any errors this function will return `None`.
///
/// # Example
///
/// To get the dimensions of your terminal window, simply use the following:
///
/// ```no_run
/// if let Some((w, h)) = termize::dimensions() {
///     println!("Width: {}\nHeight: {}", w, h);
/// } else {
///     println!("Unable to get term size :(");
/// }
/// ```
// crate: termize-0.2.1/src/platform/unix.rs:94 dimensions
export function dimensions(): [number, number] | undefined {
  const w = get_dimensions_any();

  if (w.ws_col === 0 || w.ws_row === 0) {
    return undefined;
  } else {
    return [w.ws_col, w.ws_row];
  }
}

/// Query the current processes's output (`stdout`) *only*, in the attempt to determine
/// terminal width. If that stream is actually a tty, this function returns its width
/// and height as a number of characters.
///
/// # Errors
///
/// If the stream is not a tty or return any errors this function will return `None`.
///
/// # Example
///
/// To get the dimensions of your terminal window, simply use the following:
///
/// ```no_run
/// if let Some((w, h)) = termize::dimensions_stdout() {
///     println!("Width: {}\nHeight: {}", w, h);
/// } else {
///     println!("Unable to get term size :(");
/// }
/// ```
// crate: termize-0.2.1/src/platform/unix.rs:123 dimensions_stdout
export function dimensions_stdout(): [number, number] | undefined {
  const w = get_dimensions_out();

  if (w.ws_col === 0 || w.ws_row === 0) {
    return undefined;
  } else {
    return [w.ws_col, w.ws_row];
  }
}

/// Query the current processes's input (`stdin`) *only*, in the attempt to determine
/// terminal width. If that stream is actually a tty, this function returns its width
/// and height as a number of characters.
///
/// # Errors
///
/// If the stream is not a tty or return any errors this function will return `None`.
///
/// # Example
///
/// To get the dimensions of your terminal window, simply use the following:
///
/// ```no_run
/// if let Some((w, h)) = termize::dimensions_stdin() {
///     println!("Width: {}\nHeight: {}", w, h);
/// } else {
///     println!("Unable to get term size :(");
/// }
/// ```
// crate: termize-0.2.1/src/platform/unix.rs:152 dimensions_stdin
export function dimensions_stdin(): [number, number] | undefined {
  const w = get_dimensions_in();

  if (w.ws_col === 0 || w.ws_row === 0) {
    return undefined;
  } else {
    return [w.ws_col, w.ws_row];
  }
}

/// Query the current processes's error output (`stderr`) *only*, in the attempt to dtermine
/// terminal width. If that stream is actually a tty, this function returns its width
/// and height as a number of characters.
///
/// # Errors
///
/// If the stream is not a tty or return any errors this function will return `None`.
///
/// # Example
///
/// To get the dimensions of your terminal window, simply use the following:
///
/// ```no_run
/// if let Some((w, h)) = termize::dimensions_stderr() {
///     println!("Width: {}\nHeight: {}", w, h);
/// } else {
///     println!("Unable to get term size :(");
/// }
/// ```
// crate: termize-0.2.1/src/platform/unix.rs:181 dimensions_stderr
export function dimensions_stderr(): [number, number] | undefined {
  const w = get_dimensions_err();

  if (w.ws_col === 0 || w.ws_row === 0) {
    return undefined;
  } else {
    return [w.ws_col, w.ws_row];
  }
}

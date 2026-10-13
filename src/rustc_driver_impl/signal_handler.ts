// Port of compiler/rustc_driver_impl/src/signal_handler.rs.
//! Signal handler for rustc
//! Primarily used to extract a backtrace from stack overflow
//
// PORT: rust-ts cannot take a hardware fault: a JS stack overflow is a `RangeError` ("Maximum call
// stack size exceeded"), which src/rust_ts/main.ts hands to `on_stack_overflow`. That stands for the
// fault rustc takes on its thread's guard page: SIGBUS on macOS, SIGSEGV elsewhere (both observed
// with the oracle). `print_stack_trace` then runs as the installed handler would, and the signal is
// re-raised with its default action (`SA_RESETHAND`), so the process dies by the same signal (exit
// status 128 + signum, e.g. 138 on macOS). The backtrace frames themselves (`libc::backtrace`, symbol
// names and addresses) and the cycle analysis over return addresses cannot be reproduced; they are
// left out, so stderr differs from rustc's in those lines only. On non-unix hosts upstream installs
// nothing (`#[cfg(not(unix))] fn install() {}`), and a stack overflow stays an ICE in main.ts.

import { writeSync } from "node:fs";
import { DEFAULT_STACK_SIZE, STACK_SIZE } from "../rustc_interface/util.ts";
import { Err, Ok, type Result } from "../std/result.ts";

/// Signals that represent that we have a bug, and our prompt termination has
/// been ordered.
const KILL_SIGNALS: readonly [NodeJS.Signals, string][] = [
  ["SIGILL", "SIGILL"],
  ["SIGBUS", "SIGBUS"],
  ["SIGSEGV", "SIGSEGV"],
];

/// Unbuffered, unsynchronized writer to stderr.
///
/// Only acceptable because everything will end soon anyways.
const RawStderr = {
  // rustc: compiler/rustc_driver_impl/src/signal_handler.rs:33 write_str
  write_str(s: string): Result<undefined, undefined> {
    // `libc::write(STDERR_FILENO, ..)`: synchronous, so it lands before the signal is re-raised.
    try {
      writeSync(2, s);
      return Ok(undefined);
    } catch {
      return Err(undefined);
    }
  },
};

/// We don't really care how many bytes we actually get out. SIGSEGV comes for our head.
/// Splash stderr with letters of our own blood to warn our friends about the monster.
function raw_errln(s: string): void {
  void RawStderr.write_str(s);
  void RawStderr.write_str("\n");
}

/// Signal handler installed for SIGSEGV
///
/// # Safety
///
/// Caller must ensure that this function is not re-entered.
// rustc: compiler/rustc_driver_impl/src/signal_handler.rs:51 print_stack_trace
function print_stack_trace(signum: NodeJS.Signals): void {
  const MAX_FRAMES = 256;

  const signame = ((): string => {
    let signame = "<unknown>";
    for (const sig of KILL_SIGNALS) {
      if (sig[0] === signum) {
        signame = sig[1];
      }
    }
    return signame;
  })();

  // PORT: `libc::backtrace` of a stack overflow: the frames are not available in JS. A stack overflow
  // trace is a cycle of recursing frames that fills the whole buffer, so `stack.len() == MAX_FRAMES`
  // and `cyclic` are taken as true; the frame lines themselves are not printed.
  const stack_len = MAX_FRAMES;
  const cyclic = true;

  // Just a stack trace is cryptic. Explain what we're doing.
  raw_errln(`error: rustc interrupted by ${signame}, printing backtrace\n`);

  // (backtrace frames and the `### cycle encountered ...` / `### recursed ...` lines: see PORT above)
  raw_errln("");

  const random_depth = (): number => 8 * 16; // chosen by random diceroll (2d20)
  const maybe_stack_overflow = (cyclic || stack_len > random_depth()) && signum === "SIGSEGV";
  if (maybe_stack_overflow) {
    // technically speculation, but assert it with confidence anyway.
    // rustc only arrived in this signal handler because bad things happened
    // and this message is for explaining it's not the programmer's fault
    raw_errln("note: rustc unexpectedly overflowed its stack! this is a bug");
  }
  if (stack_len === MAX_FRAMES) {
    raw_errln("note: maximum backtrace depth reached, frames may have been lost");
  }
  raw_errln("note: we would appreciate a report at https://github.com/rust-lang/rust");
  if (maybe_stack_overflow) {
    // get the current stack size WITHOUT blocking and double it
    const new_size = (STACK_SIZE.value ?? DEFAULT_STACK_SIZE) * 2;
    raw_errln(`help: you can increase rustc's stack size by setting RUST_MIN_STACK=${new_size}`);
  }
  // `if written > 24 { raw_errln!("note: backtrace dumped due to {signame}! resuming signal") }`:
  // `written` counts the frame lines, which are not known (see PORT above).
}

let INSTALLED = false;

/// When one of the KILL signals is delivered to the process, print a stack trace and then exit.
// rustc: compiler/rustc_driver_impl/src/signal_handler.rs:147 install
export function install(): void {
  // `#[cfg(not(unix))]`: upstream's `install` is empty.
  if (process.platform === "win32") return;
  // PORT: the alternate signal stack and `sigaction(SA_NODEFER | SA_RESETHAND | SA_ONSTACK)` for
  // KILL_SIGNALS: see the file comment; `on_stack_overflow` is the handler's entry point.
  INSTALLED = true;
}

/** rust-ts glue: a JS stack overflow, delivered as the fault rustc's thread would take. Returns
 *  `false` when no handler is installed (the caller reports an ICE). */
export function on_stack_overflow(): boolean {
  if (!INSTALLED) return false;
  const signum: NodeJS.Signals = process.platform === "darwin" ? "SIGBUS" : "SIGSEGV";
  print_stack_trace(signum);
  // `SA_RESETHAND`: the default action runs when the faulting access is retried.
  process.kill(process.pid, signum);
  return true;
}

// `min_sigstack_size` (signal_handler.rs:168/179): not needed (no alternate signal stack, see `install`).

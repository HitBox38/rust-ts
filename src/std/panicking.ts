// `std::panicking` and `std::panic`'s hook plumbing (library/std/src/panicking.rs at the pin), as far as rustc's ICE
// hook needs it. Only a driver that installs a hook loads this, through `update_hook`.
import { panic_stack, resolve_panic_stack } from "../rust_ts/track_caller.ts";
import { write_stderr } from "./io.ts";
import { Panic, panic_count_get, set_panic_with_hook, while_unwinding } from "./panic.ts";

/** `std::panic::Location`: `{file}:{line}:{col}` when displayed. */
export interface Location {
  file: string;
  line: number;
  col: number;
}

export function display_location(l: Location): string {
  return `${l.file}:${l.line}:${l.col}`;
}

/** A panic's location was refused: there is nothing reliable to print (src/rust_ts/track_caller.ts). */
export class LocationRefused extends Error {
  override name = "LocationRefused";
}

/** `std::panic::PanicHookInfo`. PORT: the payload is the `Panic` itself. `location` is resolved on demand, since a
 *  delayed bug never asks, and throws `LocationRefused` rather than guess. */
export class PanicHookInfo {
  private location_: Location | undefined;

  constructor(
    readonly payload: Panic,
    private readonly stack: string,
  ) {}

  location(): Location {
    if (this.location_ === undefined) {
      const r = resolve_panic_stack(this.stack);
      if (!r.ok) throw new LocationRefused(r.why);
      this.location_ = r;
    }
    return this.location_;
  }
}

/** `std::panic::update_hook`'s closure, with `default_hook` as its first argument. */
export type PanicHook = (default_hook: (info: PanicHookInfo) => void, info: PanicHookInfo) => void;

let HOOK: PanicHook | undefined;

// std: library/std/src/panicking.rs:213 update_hook
export function update_hook(hook_fn: PanicHook): void {
  HOOK = hook_fn;
  set_panic_with_hook(panic_with_hook);
}

let panic_in_hook = false;

// std: library/std/src/panicking.rs:775 panic_with_hook
function panic_with_hook(payload: Panic): void {
  // PORT: `Location::caller()` is taken here, where the stack is the panic's own.
  const stack = panic_stack();
  // Check if we need to abort immediately.
  if (panic_in_hook) {
    // `MustAbort::PanicInHook`. Don't try to format the message in this case, perhaps that is causing the recursive
    // panics. However if the message is just a string, no user-defined code is involved in printing it, so that is
    // risk-free.
    // PORT: a refused location prints no guess.
    const r = resolve_panic_stack(stack);
    const at = r.ok ? display_location(r) : `<location refused: ${r.why}>`;
    write_stderr(`panicked at ${at}:\n${payload.payload_as_str() ?? ""}\nthread panicked while processing panic. aborting.\n`);
    process.abort();
  }
  panic_in_hook = true;
  try {
    // `panic_count::increase`: `panicking()` is true inside the hook. PORT: the port has no later decrease, as
    // `while_unwinding` raises the count for drop code separately (std/panic.ts).
    while_unwinding(() => HOOK!(default_hook, new PanicHookInfo(payload, stack)));
    payload.reported = true;
  } catch (e) {
    // PORT: Rust's hook has no such exit: the report could not finish (a refused location, an `Unported` path while
    // printing it, ...). The panic stays a panic, exit 101, with the reason visible, so a port crash still shows as a
    // CRASH and nothing is guessed (plan-ice-report D5). The JS stack is what a developer needs here.
    const why = e instanceof Error ? (e instanceof LocationRefused ? `location refused: ${e.message}` : String(e)) : String(e);
    write_stderr(`rust-ts: internal compiler error: ${payload.message}\nrust-ts: the ICE report stopped: ${why}\n${payload.stack ?? ""}\n`);
    payload.reported = true;
  } finally {
    panic_in_hook = false;
  }
}

export type BacktraceStyle = "Off" | "Short" | "Full";

let BACKTRACE_STYLE: BacktraceStyle | undefined;

// std: library/std/src/panic.rs:473 set_backtrace_style
export function set_backtrace_style(style: BacktraceStyle): void {
  BACKTRACE_STYLE = style;
}

// std: library/std/src/panic.rs:502 get_backtrace_style
export function get_backtrace_style(): BacktraceStyle {
  if (BACKTRACE_STYLE === undefined) {
    const v = process.env.RUST_BACKTRACE;
    BACKTRACE_STYLE = v === undefined || v === "0" ? "Off" : v === "full" ? "Full" : "Short";
  }
  return BACKTRACE_STYLE;
}

/** `std::thread::current().name()`. PORT: no thread exists; rustc_interface `run_in_thread_with_globals` names the one
 *  it stands in for, and the thread id is the pid (masked when compared, plan-ice-report D7). */
export const CURRENT_THREAD: { name: string } = { name: "main" };

let FIRST_PANIC = true;

/** The default panic handler. */
// std: library/std/src/panicking.rs:237 default_hook
function default_hook(info: PanicHookInfo): void {
  // If this is a double panic, make sure that we print a backtrace
  // for this panic. Otherwise only print it if logging is enabled.
  // PORT: the count includes this panic's own raise (`panic_with_hook`), as upstream's does.
  const backtrace: BacktraceStyle = panic_count_get() >= 2 ? "Full" : get_backtrace_style();

  // The current implementation always returns `Some`.
  const location = info.location();

  const msg = info.payload.payload_as_str() ?? "Box<dyn Any>";

  // PORT: `tid` is the pid: an OS thread id needs FFI and is masked when compared (plan-ice-report D7).
  // We add a newline to ensure the panic message appears at the start of a line.
  write_stderr(`\nthread '${CURRENT_THREAD.name}' (${process.pid}) panicked at ${display_location(location)}:\n${msg}\n`);

  switch (backtrace) {
    case "Short":
    case "Full":
      // PORT: no Rust frames exist. The JS stack, labelled as such (plan-ice-report D9).
      write_stderr(`stack backtrace:\n${js_backtrace(info.payload)}`);
      break;
    case "Off":
      if (FIRST_PANIC) {
        FIRST_PANIC = false;
        write_stderr("note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n");
      }
      break;
  }
}

/** The panic's JS stack in place of a Rust backtrace (plan-ice-report D9). */
export function js_backtrace(payload: Panic): string {
  const frames = (payload.stack ?? "").split("\n").filter((l) => /^\s*at /.test(l));
  return `note: rust-ts prints the JS stack, not a Rust backtrace\n${frames.join("\n")}\n`;
}

/**
 * The last thing an entry point does for an uncaught JS exception, before exiting 101. The panic hook has reported a
 * `Panic` already (rustc's panic output, or why it could not be printed), and only a developer debugging the port wants
 * its JS stack too (`RUST_TS_JS_BACKTRACE=1`). Anything else is a bug in the port, or a panic of a run without a hook, and
 * gets the banner. The exit code stays the signal: `classify` (scripts/difftest.ts) calls a panic the oracle does not
 * have a CRASH by 101 alone.
 */
export function report_uncaught(e: unknown): void {
  if (e instanceof Panic && e.reported) {
    if (process.env.RUST_TS_JS_BACKTRACE === "1") write_stderr(`${e.stack ?? ""}\n`);
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    write_stderr(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
  }
}

//! This crate allows tools to enable rust logging without having to magically
//! match rustc's tracing crate version.
//!
//! (The upstream crate doc's example and rationale are not repeated here.)
//
// PORT: rustc_log is excluded from harness/scope.json ("tracing setup"), so its markers are not counted; they are
// kept for greppability. The tracing stack it builds is modelled by src/rust_ts/tracing.ts (dispatch, filter) and
// src/rust_ts/tracing_tree.ts (the `HierarchicalLayer` event path). Ported: the default configuration rustc uses
// when `RUSTC_LOG` is unset (WARN and ERROR events on stderr) and the env options that only change that output.
// Not ported (`unported`): a `RUSTC_LOG` filter (EnvFilter directives), `RUSTC_LOG_FORMAT_JSON`,
// `RUSTC_LOG_BACKTRACE` output and `RUSTC_LOG_THREAD_IDS` output.
import { openSync } from "node:fs";
import { isatty } from "node:tty";
import { PLAIN } from "../std/fmt.ts";
import { debug_IoError, io_error_from_node } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { type Event, type Layer, LayeredSubscriber, type SetGlobalDefaultError, display_SetGlobalDefaultError, set_global_default } from "../rust_ts/tracing.ts";
import { HierarchicalLayer, type Writer, fd_writer, stderr_writer } from "../rust_ts/tracing_tree.ts";

/** `std::env::VarError` */
export type VarError = { $: "NotPresent" } | { $: "NotUnicode"; _0: Uint8Array };

/**
 * `env::var(name)`. PORT: `process.env` holds strings only, so `VarError::NotUnicode` is never produced (a
 * non-UTF-8 value reaches rust-ts already decoded lossily).
 */
function env_var(name: string): Result<string, VarError> {
  const v = process.env[name];
  return v === undefined ? Err({ $: "NotPresent" }) : Ok(v);
}

function is_ok_and(r: Result<string, VarError>, f: (v: string) => boolean): boolean {
  return r.$ === "Ok" && f(r._0);
}

/// The values of all the environment variables that matter for configuring a logger.
/// Errors are explicitly preserved so that we can share error handling.
export class LoggerConfig {
  constructor(
    public filter: Result<string, VarError>,
    public color_logs: Result<string, VarError>,
    public verbose_entry_exit: Result<string, VarError>,
    public verbose_thread_ids: Result<string, VarError>,
    public backtrace: Result<string, VarError>,
    public json: Result<string, VarError>,
    public output_target: Result<string, VarError>,
    public wraptree: Result<string, VarError>,
    public lines: Result<string, VarError>,
  ) {}

  // rustc: compiler/rustc_log/src/lib.rs:69 from_env
  static from_env(env: string): LoggerConfig {
    // NOTE: documented in the dev guide. If you change this, also update it!
    // PORT: the struct literal's fields are evaluated in source order (filter, color_logs, verbose_entry_exit,
    // verbose_thread_ids, backtrace, wraptree, lines, json, output_target); reading env vars has no side effects.
    const filter = env_var(env);
    const color_logs = env_var(`${env}_COLOR`);
    const verbose_entry_exit = env_var(`${env}_ENTRY_EXIT`);
    const verbose_thread_ids = env_var(`${env}_THREAD_IDS`);
    const backtrace = env_var(`${env}_BACKTRACE`);
    const wraptree = env_var(`${env}_WRAPTREE`);
    const lines = env_var(`${env}_LINES`);
    const json = env_var(`${env}_FORMAT_JSON`);
    const output_target = env_var(`${env}_OUTPUT_TARGET`);
    return new LoggerConfig(filter, color_logs, verbose_entry_exit, verbose_thread_ids, backtrace, json, output_target, wraptree, lines);
  }
}

/// Initialize the logger with the given values for the filter, coloring, and other options env variables.
// rustc: compiler/rustc_log/src/lib.rs:86 init_logger
export function init_logger(cfg: LoggerConfig): Result<null, Error> {
  return init_logger_with_additional_layer(cfg, Registry_default);
}

/** `Registry::default()`: a subscriber with no layers yet (the layers and the filter are added by `.with(..)`). */
function Registry_default(): Layer[] {
  return [];
}

/// Initialize the logger with the given values for the filter, coloring, and other options env variables.
/// Additionally add a custom layer to collect logging and tracing events via `build_subscriber`,
/// for example: `|| Registry::default().with(custom_layer)`.
// rustc: compiler/rustc_log/src/lib.rs:109 init_logger_with_additional_layer
export function init_logger_with_additional_layer(cfg: LoggerConfig, build_subscriber: () => Layer[]): Result<null, Error> {
  // PORT: `EnvFilter` is reduced to the default case's single static directive (a max level).
  let filter: "WARN";
  if (cfg.filter.$ === "Ok") {
    // `EnvFilter::new(env)`
    return unported("tracing_subscriber::EnvFilter::new (a RUSTC_LOG filter)");
  } else {
    // `EnvFilter::default().add_directive(Directive::from(LevelFilter::WARN))`
    filter = "WARN";
  }

  let color_logs: boolean;
  if (cfg.color_logs.$ === "Ok") {
    const value = cfg.color_logs._0;
    switch (value) {
      case "always":
        color_logs = true;
        break;
      case "never":
        color_logs = false;
        break;
      case "auto":
        color_logs = stderr_isatty();
        break;
      default:
        return Err({ $: "InvalidColorValue", _0: value });
    }
  } else if (cfg.color_logs._0.$ === "NotPresent") {
    color_logs = stderr_isatty();
  } else {
    return Err({ $: "NonUnicodeColorValue" });
  }

  const verbose_entry_exit = is_ok_and(cfg.verbose_entry_exit, (v) => v !== "0");
  const verbose_thread_ids = is_ok_and(cfg.verbose_thread_ids, (v) => v === "1");
  const lines = is_ok_and(cfg.lines, (v) => v === "1");
  const json = is_ok_and(cfg.json, (v) => v === "1");

  let output_target: () => Writer;
  if (cfg.output_target.$ === "Ok") {
    const v = cfg.output_target._0;
    // `File::options().create(true).write(true).truncate(true).open(&v)`
    let fd: number | undefined;
    try {
      fd = openSync(v, "w");
    } catch (e) {
      // `eprintln!("couldn't open {v} as a log target: {e:?}");`
      stderr_writer().write_all(`couldn't open ${v} as a log target: ${debug_IoError(io_error_from_node(e), PLAIN)}\n`);
    }
    if (fd !== undefined) {
      const file = fd_writer(fd);
      output_target = () => file;
    } else {
      output_target = stderr_writer;
    }
  } else {
    output_target = stderr_writer;
  }

  let layer: Layer;
  if (json) {
    // `tracing_subscriber::fmt::layer().json()..` wrapped in `NonrecursiveLayer`
    return unported("tracing_subscriber::fmt::format::Json (RUSTC_LOG_FORMAT_JSON)");
  } else {
    const l = HierarchicalLayer.default()
      .with_writer(output_target)
      .with_ansi(color_logs)
      .with_targets(true)
      .with_verbose_exit(verbose_entry_exit)
      .with_verbose_entry(verbose_entry_exit)
      .with_indent_amount(2)
      .with_indent_lines(lines)
      .with_thread_ids(verbose_thread_ids)
      .with_thread_names(verbose_thread_ids);

    if (cfg.wraptree.$ === "Ok") {
      const v = cfg.wraptree._0;
      const parsed = parse_usize(v);
      if (parsed !== undefined) {
        l.with_wraparound(parsed);
      } else {
        return Err({ $: "InvalidWraptree", _0: v });
      }
    }

    layer = l;
  }

  const subscriber = build_subscriber();
  // NOTE: It is important to make sure that the filter is applied on the last layer
  let r: Result<null, SetGlobalDefaultError>;
  if (cfg.backtrace.$ === "Ok") {
    const backtrace_target = cfg.backtrace._0;
    // `tracing_subscriber::fmt::layer().with_writer(io::stderr).without_time().event_format(BacktraceFormatter { .. })`
    const fmt_layer: Layer = { on_event: (event) => BacktraceFormatter_format_event({ backtrace_target }, event) };
    r = set_global_default(new LayeredSubscriber([...subscriber, layer, fmt_layer], filter));
  } else {
    r = set_global_default(new LayeredSubscriber([...subscriber, layer], filter));
  }
  if (r.$ === "Err") return Err({ $: "AlreadyInit", _0: r._0 });

  return Ok(null);
}

/** `usize::from_str` (an optional `+`, then decimal digits, no overflow). */
function parse_usize(s: string): number | undefined {
  if (!/^\+?[0-9]+$/.test(s)) return undefined;
  const n = BigInt(s.startsWith("+") ? s.slice(1) : s);
  if (n > 0xffff_ffff_ffff_ffffn) return undefined;
  // PORT: values above 2^53 only ever act as the `%` divisor of tiny indents; `usize::MAX` behaves the same.
  return n > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(n);
}

interface BacktraceFormatter {
  backtrace_target: string;
}

// rustc: compiler/rustc_log/src/lib.rs:216 format_event
function BacktraceFormatter_format_event(self: BacktraceFormatter, event: Event): void {
  const target = event.target;
  if (!target.includes(self.backtrace_target)) {
    return;
  }
  // Use Backtrace::force_capture because we don't want to depend on the
  // RUST_BACKTRACE environment variable being set.
  // `writeln!(writer, "stack backtrace: \n{backtrace:?}")`
  unported("rustc_log::BacktraceFormatter (a Rust backtrace, RUSTC_LOG_BACKTRACE)");
}

// rustc: compiler/rustc_log/src/lib.rs:233 stdout_isatty
export function stdout_isatty(): boolean {
  return isatty(1);
}

// rustc: compiler/rustc_log/src/lib.rs:237 stderr_isatty
export function stderr_isatty(): boolean {
  return isatty(2);
}

/** `#[derive(Debug)] pub enum Error` */
export type Error =
  | { $: "InvalidColorValue"; _0: string }
  | { $: "NonUnicodeColorValue" }
  | { $: "InvalidWraptree"; _0: string }
  | { $: "AlreadyInit"; _0: SetGlobalDefaultError };

// rustc: compiler/rustc_log/src/lib.rs:252 fmt
export function display_Error(self: Error): string {
  switch (self.$) {
    case "InvalidColorValue":
      return `invalid log color value '${self._0}': expected one of always, never, or auto`;
    case "NonUnicodeColorValue":
      return "non-Unicode log color value: expected one of always, never, or auto";
    case "InvalidWraptree":
      return `invalid log WRAPTREE value '${self._0}': expected a non-negative integer`;
    case "AlreadyInit":
      return display_SetGlobalDefaultError(self._0);
  }
}

// `impl From<SetGlobalDefaultError> for Error` (272): `Error::AlreadyInit(e)`, inlined at the `?` above.
// rustc-skip: compiler/rustc_log/src/lib.rs:272 from inlined at its one use (`set_global_default(..)?`)
// `NonrecursiveGuard` / `NonrecursiveLayer` (277-377): only wrap the JSON layer (unported above).

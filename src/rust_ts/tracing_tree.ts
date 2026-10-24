// rust-ts glue (not an upstream mirror): the event path of `tracing_tree::HierarchicalLayer`
// (tracing-tree 0.4.1 at the pin's Cargo.lock), the layer rustc_log installs for rustc's default logger
// (src/rustc_log/lib.ts), and the `nu_ansi_term` 0.50.3 painting it uses for `RUSTC_LOG_COLOR`.
//
// PORT: tracing-tree is not a harness/scope.json vendor crate, so the functions below carry plain
// `// ref: <crate>-<ver>/<path>:<line> <name>` references instead of `// crate:` markers. Only the event path
// is here: under rustc's default filter (WARN) no span is ever enabled (rustc has no span at WARN or above),
// so `ctx.current_span()` / `ctx.event_scope(event)` are always `None`; the span callbacks (`on_new_span`,
// `on_close`, `on_record`, `write_span_info`, `write_retrace_span`, `write_timestamp`) are not reached.
// The `tracing-log` feature (default on) only affects events that came from the `log` crate, which rustc
// never bridges.
import { writeSync } from "node:fs";
import { isatty } from "node:tty";
import { panic, unported } from "../std/panic.ts";
import { type Event, type Layer, type Level, display_Level } from "./tracing.ts";

// ---- nu_ansi_term (0.50.3) ------------------------------------------------------------------------------------------

/** The parts of a `nu_ansi_term::Style` tracing-tree uses: bold, dimmed and a foreground colour code. */
interface Style {
  readonly is_bold: boolean;
  readonly is_dimmed: boolean;
  /** `Color::write_foreground_code` (ansi.rs:123), e.g. `31` (Red), `38;2;252;234;160` (Rgb). */
  readonly foreground: string | undefined;
}

// ref: nu-ansi-term-0.50.3/src/display.rs:318 write_to_any (`style.prefix()`, the text, `style.suffix()`)
function paint(style: Style, text: string): string {
  // `write_prefix` (ansi.rs:8): nothing for a plain style; else `ESC [` codes joined by `;` then `m`
  // (bold 1, dimmed 2, ..., then the foreground; no background here). `write_suffix`: `RESET`.
  const codes: string[] = [];
  if (style.is_bold) codes.push("1");
  if (style.is_dimmed) codes.push("2");
  if (style.foreground !== undefined) codes.push(style.foreground);
  if (codes.length === 0) return text;
  return `\x1B[${codes.join(";")}m${text}\x1B[0m`;
}

// ---- format.rs ------------------------------------------------------------------------------------------------------

const LINE_VERT = "│";
const LINE_HORIZ = "─";
const LINE_BRANCH = "├";
const LINE_CLOSE = "┘";
const LINE_CLOSE2 = "┌";
const LINE_OPEN = "┐";
const LINE_OPEN2 = "└";

/** `SpanMode` (format.rs:20). */
type SpanMode =
  | { $: "PreOpen" }
  | { $: "Open"; verbose: boolean }
  | { $: "Close"; verbose: boolean }
  | { $: "Retrace"; verbose: boolean }
  | { $: "PostClose" }
  | { $: "Event" };

/** `usize::MAX`, the default `wraparound` (only ever the right operand of `%` on small indents). */
const USIZE_MAX = Number.MAX_SAFE_INTEGER;

/** `Config` (format.rs:38) with its `Default` (format.rs:166). */
export class Config {
  ansi = true;
  indent_lines = false;
  indent_amount = 2;
  targets = false;
  render_thread_ids = false;
  render_thread_names = false;
  wraparound = USIZE_MAX;
  verbose_entry = false;
  verbose_exit = false;
  span_retrace = false;
  bracketed_fields = false;
  deferred_spans = false;
  span_modes = false;

  // ref: tracing-tree-0.4.1/src/format.rs:143 prefix
  prefix(): string {
    // PORT: thread ids/names (`RUSTC_LOG_THREAD_IDS=1`) would print `std::thread::current()`'s id and name;
    // rust-ts has no Rust threads to name.
    if (this.render_thread_ids || this.render_thread_names) {
      unported("tracing_tree::format::Config::prefix (thread ids/names, RUSTC_LOG_THREAD_IDS)");
    }
    return "";
  }
}

/** `Buffers` (format.rs:186). */
class Buffers {
  current_buf = "";
  indent_buf = "";

  // ref: tracing-tree-0.4.1/src/format.rs:208 flush_current_buf
  flush_current_buf(writer: Writer): void {
    // `write!(writer, "{}", &self.current_buf).unwrap();`
    const r = writer.write_all(this.current_buf);
    if (r !== undefined) panic(`called \`Result::unwrap()\` on an \`Err\` value: ${r}`);
    this.current_buf = "";
  }

  // ref: tracing-tree-0.4.1/src/format.rs:213 flush_indent_buf
  flush_indent_buf(): void {
    this.current_buf += this.indent_buf;
    this.indent_buf = "";
  }

  // ref: tracing-tree-0.4.1/src/format.rs:218 indent_current
  indent_current(indent: number, config: Config, style: SpanMode): void {
    const prefix = config.prefix();

    // Render something when wraparound occurs so the user is aware of it
    if (config.indent_lines) {
      this.current_buf += "\n";

      switch (style.$) {
        case "Close":
        case "PostClose":
          if (indent > 0 && rem(indent + 1, config.wraparound) === 0) {
            this.indent_buf += prefix;
            for (let i = 0; i < rem(indent, config.wraparound) * config.indent_amount; i++) this.indent_buf += LINE_HORIZ;
            this.indent_buf += LINE_OPEN;
            this.indent_buf += "\n";
          }
          break;
        default:
          break;
      }
    }

    this.indent_buf = indent_block(this.current_buf, this.indent_buf, rem(indent, config.wraparound), config.indent_amount, config.indent_lines, prefix, style);

    this.current_buf = "";
    this.flush_indent_buf();

    // Render something when wraparound occurs so the user is aware of it
    if (config.indent_lines) {
      switch (style.$) {
        case "PreOpen":
        case "Open":
          if (indent > 0 && rem(indent + 1, config.wraparound) === 0) {
            this.current_buf += prefix;
            for (let i = 0; i < rem(indent, config.wraparound) * config.indent_amount; i++) this.current_buf += LINE_HORIZ;
            this.current_buf += LINE_CLOSE;
            this.current_buf += "\n";
          }
          break;
        default:
          break;
      }
    }
  }
}

/** `a % b` on `usize` (panics on a zero divisor, as Rust does: `RUSTC_LOG_WRAPTREE=0`). */
function rem(a: number, b: number): number {
  if (b === 0) panic("attempt to calculate the remainder with a divisor of zero");
  return a % b;
}

/** `FmtEvent` (format.rs:272): the event's fields, appended to `bufs.current_buf`. */
class FmtEvent {
  constructor(
    readonly bufs: Buffers,
    public comma: boolean,
  ) {}

  // ref: tracing-tree-0.4.1/src/format.rs:278 record_debug
  record_debug(field: string, value: () => string): void {
    const comma = this.comma ? "," : "";
    switch (field) {
      case "message":
        this.bufs.current_buf += `${comma} ${value()}`;
        this.comma = true;
        break;
      // Skip fields that are actually log metadata that have already been handled
      // (`#[cfg(feature = "tracing-log")] name if name.starts_with("log.") => {}`)
      default:
        if (field.startsWith("log.")) break;
        this.bufs.current_buf += `${comma} ${field}=${value()}`;
        this.comma = true;
        break;
    }
  }
}

// ref: tracing-tree-0.4.1/src/format.rs:299 fmt (`impl Display for ColorLevel`)
function display_ColorLevel(level: Level): string {
  switch (level) {
    case "TRACE":
      return paint({ is_bold: true, is_dimmed: false, foreground: "35" }, "TRACE"); // Purple
    case "DEBUG":
      return paint({ is_bold: true, is_dimmed: false, foreground: "34" }, "DEBUG"); // Blue
    case "INFO":
      return paint({ is_bold: true, is_dimmed: false, foreground: "32" }, " INFO"); // Green
    case "WARN":
      return paint({ is_bold: true, is_dimmed: false, foreground: "38;2;252;234;160" }, " WARN"); // orange
    case "ERROR":
      return paint({ is_bold: true, is_dimmed: false, foreground: "31" }, "ERROR"); // Red
  }
}

/** `str::lines`: split at `\n`, drop one trailing empty line, strip a `\r` before each `\n`. */
function str_lines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

// ref: tracing-tree-0.4.1/src/format.rs:328 indent_block_with_lines
function indent_block_with_lines(lines: readonly string[], buf: string, indent: number, indent_amount: number, prefix: string, style: SpanMode): string {
  const indent_spaces = indent * indent_amount;

  if (lines.length === 0) {
    return buf;
  } else if (indent_spaces === 0) {
    for (const line of lines) {
      buf += prefix;
      // The first indent is special, we only need to print open/close and nothing else
      if (indent === 0) {
        switch (style.$) {
          case "Open":
            buf += LINE_OPEN;
            break;
          case "Retrace":
            buf += LINE_OPEN;
            break;
          case "Close":
            buf += LINE_CLOSE;
            break;
          case "PreOpen":
          case "PostClose":
            break;
          case "Event":
            break;
        }
      }
      buf += line;
      buf += "\n";
    }
    return buf;
  }

  let s = prefix;

  for (let i = 0; i < indent_spaces - indent_amount; i++) s += " ";

  // draw branch
  buf += s;

  if (style.$ === "PreOpen") {
    buf += LINE_OPEN2;
    for (let i = 1; i < Math.floor(indent_amount / 2); i++) buf += LINE_HORIZ;
    buf += LINE_OPEN;
  } else if ((style.$ === "Open" || style.$ === "Retrace") && !style.verbose) {
    buf += LINE_OPEN2;
    for (let i = 1; i < indent_amount; i++) buf += LINE_HORIZ;
    buf += LINE_OPEN;
  } else if (style.$ === "Open" || style.$ === "Retrace") {
    buf += " ";
    for (let i = 1; i < Math.floor(indent_amount / 2); i++) buf += " ";
    // We don't have the space for fancy rendering at single space indent.
    if (indent_amount > 1) buf += LINE_OPEN2;
    for (let i = Math.floor(indent_amount / 2); i < indent_amount - 1; i++) buf += LINE_HORIZ;
    // We don't have the space for fancy rendering at single space indent.
    if (indent_amount > 1) {
      buf += LINE_OPEN;
    } else {
      buf += " ";
    }
  } else if (style.$ === "Close" && !style.verbose) {
    buf += LINE_CLOSE2;
    for (let i = 1; i < indent_amount; i++) buf += LINE_HORIZ;
    buf += LINE_CLOSE;
  } else if (style.$ === "Close") {
    buf += " ";
    for (let i = 1; i < Math.floor(indent_amount / 2); i++) buf += " ";
    // We don't have the space for fancy rendering at single space indent.
    if (indent_amount > 1) buf += LINE_CLOSE2;
    for (let i = Math.floor(indent_amount / 2); i < indent_amount - 1; i++) buf += LINE_HORIZ;
    // We don't have the space for fancy rendering at single space indent.
    if (indent_amount > 1) {
      buf += LINE_CLOSE;
    } else {
      buf += " ";
    }
  } else if (style.$ === "PostClose") {
    buf += LINE_CLOSE2;
    for (let i = 1; i < Math.floor(indent_amount / 2); i++) buf += LINE_HORIZ;
    buf += LINE_CLOSE;
  } else {
    // SpanMode::Event
    buf += LINE_BRANCH;

    // add `indent_amount - 1` horizontal lines before the span/event
    for (let i = 0; i < indent_amount - 1; i++) buf += LINE_HORIZ;
  }
  buf += lines[0]!;
  buf += "\n";

  // add the rest of the indentation, since we don't want to draw horizontal lines
  // for subsequent lines
  switch (style.$) {
    case "Open":
    case "Retrace":
      s += "  ";
      break;
    case "Close":
      s += " ";
      break;
    default:
      break;
  }
  s += LINE_VERT;
  for (let i = 1; i <= indent_amount; i++) s += " ";

  // add all of the actual content, with each line preceded by the indent string
  for (const line of lines.slice(1)) {
    buf += s;
    buf += line;
    buf += "\n";
  }
  return buf;
}

// ref: tracing-tree-0.4.1/src/format.rs:469 indent_block
/** PORT: `buf: &mut String` is returned (the new contents). */
function indent_block(block: string, buf: string, indent: number, indent_amount: number, indent_lines: boolean, prefix: string, style: SpanMode): string {
  const lines = str_lines(block);
  const indent_spaces = indent * indent_amount;

  // The PreOpen and PostClose need to match up with the indent of the entered child span one more indent
  // deep
  switch (style.$) {
    case "PreOpen":
    case "PostClose":
      indent += 1;
      break;
    default:
      break;
  }

  if (indent_lines) {
    buf = indent_block_with_lines(lines, buf, indent, indent_amount, prefix, style);
  } else {
    let indent_str = " ".repeat(indent_spaces);
    let first_line = true;
    for (const line of lines) {
      buf += prefix;
      buf += " ";
      buf += indent_str;
      if (first_line) {
        first_line = false;
        indent_str += "  ";
      }
      buf += line;
      buf += "\n";
    }
  }
  return buf;
}

// ---- lib.rs ---------------------------------------------------------------------------------------------------------

/**
 * `MakeWriter::make_writer()`'s writer: `write_all` of the UTF-8 bytes; returns an error description (the
 * `io::Error`'s Display) on failure, else `undefined`.
 */
export interface Writer {
  write_all(s: string): string | undefined;
}

/** `io::stderr` as a `MakeWriter` (unbuffered: each `write!` goes straight to fd 2). */
export function stderr_writer(): Writer {
  return fd_writer(2);
}

/** A writer on an open file descriptor (`io::stderr`, or rustc_log's `Mutex<File>` for `RUSTC_LOG_OUTPUT_TARGET`). */
export function fd_writer(fd: number): Writer {
  return {
    write_all(s: string): string | undefined {
      const bytes = Buffer.from(s, "utf8");
      let off = 0;
      try {
        while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
      } catch (e) {
        return String((e as Error).message);
      }
      return undefined;
    },
  };
}

/** `RecursiveGuard`'s thread-local `IS_EMPTY` (lib.rs:411). */
let IS_EMPTY = true;

/** `HierarchicalLayer<W, FT = ()>` (lib.rs:58). The timer is `()`: it writes nothing. */
export class HierarchicalLayer implements Layer {
  constructor(
    public make_writer: () => Writer,
    public config: Config,
  ) {}

  // ref: tracing-tree-0.4.1/src/lib.rs:71 default
  static default(): HierarchicalLayer {
    return HierarchicalLayer.new(2);
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:77 new
  static new(indent_amount: number): HierarchicalLayer {
    const config = new Config();
    // `let ansi = io::stderr().is_terminal();` (overridden by rustc_log's `with_ansi`)
    config.ansi = stderr_is_terminal();
    config.indent_amount = indent_amount;
    return new HierarchicalLayer(stderr_writer, config);
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:99 with_ansi
  with_ansi(ansi: boolean): this {
    this.config.ansi = ansi;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:106 with_writer
  with_writer(make_writer: () => Writer): this {
    this.make_writer = make_writer;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:118 with_indent_amount
  with_indent_amount(indent_amount: number): this {
    this.config.indent_amount = indent_amount;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:127 with_indent_lines
  with_indent_lines(indent_lines: boolean): this {
    this.config.indent_lines = indent_lines;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:146 with_targets
  with_targets(targets: boolean): this {
    this.config.targets = targets;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:155 with_thread_ids
  with_thread_ids(thread_ids: boolean): this {
    this.config.render_thread_ids = thread_ids;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:164 with_thread_names
  with_thread_names(thread_names: boolean): this {
    this.config.render_thread_names = thread_names;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:174 with_wraparound
  with_wraparound(wraparound: number): this {
    this.config.wraparound = wraparound;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:184 with_verbose_entry
  with_verbose_entry(verbose_entry: boolean): this {
    this.config.verbose_entry = verbose_entry;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:194 with_verbose_exit
  with_verbose_exit(verbose_exit: boolean): this {
    this.config.verbose_exit = verbose_exit;
    return this;
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:239 styled
  styled(style: Style, text: string): string {
    return styled(this.config.ansi, style, text);
  }

  // ref: tracing-tree-0.4.1/src/lib.rs:485 on_event
  on_event(event: Event): void {
    // `let Some(_guard) = Self::is_recursive() else { return; };`
    if (!IS_EMPTY) return;
    IS_EMPTY = false;
    try {
      // `ctx.current_span()` is `None` (see the header): no retrace, no span timestamp.
      const bufs = this.bufs;

      // Time. (`()` writes nothing, so no padding space.)

      // printing the indentation: `ctx.event_scope(event)` is `None`.
      const indent = 0;

      const level = this.config.ansi ? display_ColorLevel(event.level) : display_Level(event.level);

      bufs.current_buf += level;

      if (this.config.targets) {
        const target = event.target;
        bufs.current_buf += ` ${this.styled({ is_bold: false, is_dimmed: true, foreground: undefined }, target)}`;
      }

      const visitor = new FmtEvent(bufs, false);
      for (const f of event.fields) visitor.record_debug(f.name, f.debug);
      visitor.bufs.indent_current(indent, this.config, { $: "Event" });
      const writer = this.make_writer();
      bufs.flush_current_buf(writer);
    } finally {
      // `impl Drop for RecursiveGuard` (lib.rs:434)
      IS_EMPTY = true;
    }
  }

  /** `bufs: Mutex<Buffers>` */
  readonly bufs: Buffers = new Buffers();
}

// ref: tracing-tree-0.4.1/src/lib.rs:423 styled
function styled(ansi: boolean, style: Style, text: string): string {
  if (ansi) {
    return paint(style, text);
  } else {
    return text;
  }
}

/** `io::stderr().is_terminal()` */
export function stderr_is_terminal(): boolean {
  // `libc::isatty(2) != 0`
  return isatty(2);
}

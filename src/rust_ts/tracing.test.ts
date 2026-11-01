// The INFO path of rustc's logger as Miri configures it (`MIRI_LOG=info`, src/miri/bin/log/setup.ts): EnvFilter
// static directives, INFO events and the interpreter's "frame" spans through tracing-tree, compared with lines of the
// oracle Miri's `MIRI_LOG=info` trace of std's hello world (harness/corpus/miri/hello.rs; docs/handoff/miri-log.md),
// and the "disabled statically" warning `MIRI_LOG=debug` prints. The CTFE trace of the whole interpreter under
// `RUSTC_LOG=rustc_const_eval::interpret=info` is compared end to end in docs/handoff/miri-log.md.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Directive,
  EnvFilter,
  LayeredSubscriber,
  Level_from_str,
  LevelFilter_current,
  type Span,
  info,
  info_span,
  reset_global_default_for_tests,
  set_global_default,
  warn,
} from "./tracing.ts";
import { HierarchicalLayer, type Writer } from "./tracing_tree.ts";
import { Ok } from "../std/result.ts";

afterEach(() => reset_global_default_for_tests());

/** The filter `MIRI_LOG=<level>` becomes (bin/log/setup.rs `rustc_logger_config`). */
const miri_filter = (level: string): string => `rustc_middle::mir::interpret=${level},rustc_const_eval::interpret=${level},miri=${level}`;

/** rustc_log's layer (`RUSTC_LOG_COLOR` unset, stderr not a tty) over `filter`, writing into the returned array. */
function capture(filter: EnvFilter): string[] {
  const out: string[] = [];
  const writer: Writer = {
    write_all(s: string) {
      out.push(s);
      return undefined;
    },
  };
  const layer = HierarchicalLayer.default().with_writer(() => writer).with_ansi(false).with_targets(true).with_indent_amount(2);
  expect(set_global_default(new LayeredSubscriber([layer], filter))).toEqual(Ok(null));
  return out;
}

/** What the interpreter's `SpanGuard` does on frame push (`enter`) and when the popped frame is dropped. */
function push_frame(instance: string): Span {
  const span = info_span("rustc_const_eval::interpret::stack", "frame", ["frame", () => instance]);
  span.with_subscriber((id, d) => d.enter(id));
  return span;
}
function drop_frame(span: Span): void {
  span.with_subscriber((id, d) => d.exit(id));
  span.drop();
}

test("MIRI_LOG=info: frame spans and INFO events as the oracle Miri prints them", () => {
  const out = capture(EnvFilter.new(miri_filter("info")));
  expect(LevelFilter_current()).toBe("INFO");
  const outer = push_frame("std::rt::lang_start::<()>");
  info("rustc_const_eval::interpret::step", () => "StorageLive(_5)");
  info("rustc_const_eval::interpret::step", () => "_0 = std::rt::lang_start_internal(move _5, move _9, move _10, move _11) -> [return: bb1, unwind continue]");
  const inner = push_frame("std::rt::lang_start_internal");
  info("rustc_const_eval::interpret::step", () => "// executing bb0");
  info("rustc_const_eval::interpret::step", () => "return");
  info("rustc_const_eval::interpret::call", () => "popping stack frame (returning from function)");
  info("miri::machine", () => "Leaving std::rt::lang_start_internal");
  drop_frame(inner);
  info("miri::machine", () => "Continuing in std::rt::lang_start::<()>");
  info("miri::machine", () => "Leaving std::rt::lang_start::<()>");
  drop_frame(outer);
  info("miri::eval", () => "Additional static roots: [alloc43]");
  // Not enabled by Miri's filter: other targets, even at WARN (no directive cares about them).
  warn("rustc_errors::emitter", () => "dropped");
  info("rustc_middle::ty", () => "dropped");
  expect(out.join("")).toBe(
    [
      " rustc_const_eval::interpret::stack::frame frame=std::rt::lang_start::<()>",
      "  INFO rustc_const_eval::interpret::step StorageLive(_5)",
      "  INFO rustc_const_eval::interpret::step _0 = std::rt::lang_start_internal(move _5, move _9, move _10, move _11) -> [return: bb1, unwind continue]",
      "   rustc_const_eval::interpret::stack::frame frame=std::rt::lang_start_internal",
      "    INFO rustc_const_eval::interpret::step // executing bb0",
      "    INFO rustc_const_eval::interpret::step return",
      "    INFO rustc_const_eval::interpret::call popping stack frame (returning from function)",
      "    INFO miri::machine Leaving std::rt::lang_start_internal",
      "  INFO miri::machine Continuing in std::rt::lang_start::<()>",
      "  INFO miri::machine Leaving std::rt::lang_start::<()>",
      " INFO miri::eval Additional static roots: [alloc43]",
      "",
    ].join("\n"),
  );
});

test("the default WARN filter: INFO is one comparison, its closures never run, spans are disabled", () => {
  const out = capture(EnvFilter.default().add_directive(Directive.from("WARN")));
  expect(LevelFilter_current()).toBe("WARN");
  let ran = false;
  info("rustc_const_eval::interpret::step", () => ((ran = true), "m"));
  const span = info_span("rustc_const_eval::interpret::stack", "frame", ["frame", () => ((ran = true), "f")]);
  expect(span.inner).toBeUndefined();
  drop_frame(span);
  expect(ran).toBe(false);
  expect(out).toEqual([]);
});

test("EnvFilter: the most specific directive decides; target matching is a string prefix", () => {
  const f = EnvFilter.new("rustc_const_eval::interpret::step=off,rustc_const_eval::interpret=info,miri");
  expect(f.enabled("INFO", "rustc_const_eval::interpret::step")).toBe(false);
  expect(f.enabled("INFO", "rustc_const_eval::interpret::stack")).toBe(true);
  expect(f.enabled("DEBUG", "rustc_const_eval::interpret::stack")).toBe(false);
  expect(f.enabled("TRACE", "miri_extra::x")).toBe(true); // a bare target enables every level; `miri` prefixes `miri_extra`
  expect(f.enabled("ERROR", "rustc_errors")).toBe(false);
  expect(f.max_level_hint()).toBe("TRACE");
  // No directive at all: the `EnvFilter::new` default directive (ERROR).
  const e = EnvFilter.new("");
  expect([e.enabled("ERROR", "x"), e.enabled("WARN", "x"), e.max_level_hint()]).toEqual([true, false, "ERROR"]);
  // `MIRI_LOG` is a single level iff `tracing::Level::from_str` accepts it.
  expect(["info", "TRACE", "3", "+5", "off", "0", "miri=info"].map((s) => Level_from_str(s).$)).toEqual(["Ok", "Ok", "Ok", "Ok", "Err", "Err", "Err"]);
});

test("MIRI_LOG=debug: the 'disabled statically' warning, byte for byte as the oracle Miri prints it", () => {
  const code = `import { EnvFilter } from ${JSON.stringify(join(import.meta.dir, "tracing.ts"))}; EnvFilter.new(${JSON.stringify(miri_filter("debug"))}); EnvFilter.new("a=x, b=warn");`;
  const p = Bun.spawnSync([process.execPath, "-e", code]);
  const bar = " \x1B[1;38;5;21m|\x1B[0m ";
  const eq = " \x1B[1;38;5;21m=\x1B[0m ";
  expect(p.stderr.toString()).toBe(
    [
      "\x1B[1;33mwarning\x1B[0m\x1B[1m:\x1B[0m \x1B[1msome trace filter directives would enable traces that are disabled statically\x1B[0m",
      `${bar}\`rustc_middle::mir::interpret=debug\` would enable the DEBUG level for the \`rustc_middle::mir::interpret\` target`,
      `${bar}\`rustc_const_eval::interpret=debug\` would enable the DEBUG level for the \`rustc_const_eval::interpret\` target`,
      `${bar}\`miri=debug\` would enable the DEBUG level for the \`miri\` target`,
      `${eq}\x1B[1mnote:\x1B[0m the static max level is \`info\``,
      `${eq}\x1B[1mhelp:\x1B[0m to enable DEBUG logging, remove the \`max_level_info\` feature from the \`tracing\` crate`,
      // `parse_lossy` reports a bad directive and keeps going. ` b=warn` fails too: `Directive::parse` slices the
      // untrimmed string at the trimmed string's offsets (target " ", level "=warn"); the oracle rustc prints the same.
      "ignoring `a=x`: error parsing level filter: expected one of \"off\", \"error\", \"warn\", \"info\", \"debug\", \"trace\", or a number 0-5",
      "ignoring ` b=warn`: error parsing level filter: expected one of \"off\", \"error\", \"warn\", \"info\", \"debug\", \"trace\", or a number 0-5",
      "",
    ].join("\n"),
  );
  expect(p.exitCode).toBe(0);
});

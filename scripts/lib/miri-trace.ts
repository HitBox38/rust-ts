// Normalised `MIRI_LOG=info` traces (plan-m6 D10, A6; lane miri-diff), for scripts/miri-diff.ts. Pure: no process,
// no file, no import of common.ts, so its tests run in-process.
//
// What a trace looks like. Miri's logger (src/tools/miri/src/bin/log/setup.rs `rustc_logger_config`) turns
// `MIRI_LOG=info` into the filter `rustc_middle::mir::interpret=info,rustc_const_eval::interpret=info,miri=info` of
// rustc_log's `init_logger_with_additional_layer` (compiler/rustc_log/src/lib.rs), whose other settings come from the
// `RUSTC_LOG_*` variables. scripts/lib/env.ts scrubs the whole `RUSTC_LOG` prefix, so they are the defaults: a
// `tracing_tree::HierarchicalLayer` (tracing-tree 0.4.1) with targets, indent amount 2, no indent lines, no thread
// ids, no verbose entry/exit, no timer, writing to stderr (where the interpreted program's own stderr and Miri's
// diagnostics also go), ANSI colours only when stderr is a terminal (never under the harness; stripped anyway).
// tracing-tree then writes (lib.rs `on_event` / `write_span_info`, format.rs `indent_block`, without indent lines):
// - an event: `' ' + indent + [' ' when inside a span: the empty timestamp's separator] + LEVEL + ' ' + target`,
//   then the fields: ` <message>` and `, <name>=<value>` (format.rs `FmtEvent`); with colours the level is padded
//   (` INFO`) and wrapped in escapes, the target too;
// - a span opening (`SpanMode::Open`): `' ' + indent + target + '::' + name + ' '` and its fields (`message` bare,
//   others `k=v`, joined by `, `); at INFO that is `rustc_const_eval::interpret::stack::frame frame=<instance>`, one
//   per frame push. Closing a span prints nothing (no verbose exit);
// - a value with newlines: one line per line, the later ones indented two more spaces than the first's indent.
// `indent` is two spaces per open span, modulo the wraparound (25 levels), so it is not the stack depth.
//
// Normalisation (A6: event lines only, not raw indentation): ANSI escapes are removed; a line that starts with one or
// more spaces followed by a level word and a target is an event, kept as `LEVEL target<fields>` (its leading spaces,
// i.e. indentation, timestamp separator and colour padding, dropped); a line of spaces + `<path>::<name>` with an
// optional ` <fields>` is a span opening, kept as `SPAN <path>::<name>[ <fields>]` (spans are kept because the frame
// span is the trace's only record of a frame push); a line right after a record (or its continuation) that is
// indented deeper than the record's first line and is not a record itself is a continuation, appended to the record
// after `\n` with the record's indentation removed. Everything else (the program's stdout/stderr lines, Miri's
// diagnostics, the port's `rust-ts: unported:` line, empty lines) is "other": not part of the trace, counted and
// returned separately. A program line that happens to look like an event or span line is misread as one, on both
// sides alike. There is no timing to strip: rustc_log sets no timer (tracing-tree's `()` timer writes nothing).
// Addresses (lane harness-w36; review miri-diff, decision 2026-11-01; offsets kept by lane harness-w37): a pointer with
// provenance prints as `0x<address>[alloc<id>]<tag>` (machine.rs `Provenance::fmt` / `impl Debug for Provenance`;
// `{:#?}` prints the id as `a<id>`, mir/interpret/mod.rs `impl Display for AllocId`) or `0x<address>[wildcard]`, e.g.
// `retag_ptr_value: ... val=Scalar(0x20150[alloc27]<20>)`. The address is the allocation's base address plus the
// offset (OFFSET_IS_ADDR). The base depends on the environment (allocation sizes of argv, env and paths shift every
// later base address, alloc_addresses `AddressGenerator`), the offset does not. The trace never prints a base, so per
// trace the first address seen with an allocation id stands in for that allocation's base, and every address with
// that id is written relative to it: `0xADDR+0x<n>[alloc<id>]` (`0xADDR-0x<n>` below it), the first one `0xADDR+0x0`.
// So `0x20150[alloc27]` then `0x20158[alloc27]` normalise to `+0x0` and `+0x8`, and a pointer at another offset
// within the allocation than the oracle's differs. Only the record's own and earlier records' addresses matter, so
// records before the first difference stay comparable. What stays hidden: every pointer into one allocation shifted by
// the same amount on one side (the first one included). `[wildcard]` has no allocation to be relative to, so its
// address is masked whole (`0xADDR[wildcard]`). The allocation id and tag stay, so a pointer to another allocation or
// with another tag still differs. A bare `0x...` (an integer scalar) is data and kept.
/** A normalised trace: its records (events and span openings, in order) and the stderr lines that are not trace. */
export interface MiriTrace {
  readonly events: string[];
  readonly other: string[];
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** The address of a pointer with provenance (see the header): hex digits followed by `[alloc<id>]`, `[a<id>]` or
 * `[wildcard]`; group 1 the address, 2 the allocation id (absent for `wildcard`). */
const PTR_ADDR = /\b0x([0-9a-f]+)(?=\[(?:(?:alloc|a)(\d+)|wildcard)\])/g;
/** Per trace: allocation id -> the first address seen with it (see the header). */
export type AllocBases = Map<string, bigint>;
/**
 * A record with its pointer addresses masked (see the header): relative to `bases` (the first address of each
 * allocation seen so far in the trace; addresses of new allocations are added to it).
 */
export function maskAddresses(record: string, bases: AllocBases = new Map()): string {
  return record.replace(PTR_ADDR, (_m, hex: string, id: string | undefined) => {
    if (id === undefined) return "0xADDR";
    const addr = BigInt(`0x${hex}`);
    let base = bases.get(id);
    if (base === undefined) bases.set(id, (base = addr));
    const off = addr - base;
    return off < 0n ? `0xADDR-0x${(-off).toString(16)}` : `0xADDR+0x${off.toString(16)}`;
  });
}
/** tracing-tree's event line (colours removed): indentation, level, target, fields. */
const EVENT = /^( +)(TRACE|DEBUG|INFO|WARN|ERROR) (\S+)(.*)$/;
/** tracing-tree's span-opening line (colours removed): indentation, `<target>::<name>`, optional fields. */
const SPAN = /^( +)([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*::[A-Za-z_]\w*)(?: (.*))?$/;

/** The normalised trace of a `MIRI_LOG=info` stderr (see the header). */
export function normaliseTrace(stderr: string): MiriTrace {
  const events: string[] = [];
  const other: string[] = [];
  const lines = stderr.split("\n");
  // A final newline ends the last line; it does not start an empty one.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  /** Indentation of the last record's first line, while the next line may continue it; -1 otherwise. */
  let recIndent = -1;
  const bases: AllocBases = new Map();
  for (const raw of lines) {
    const line = raw.replace(ANSI, "");
    const e = EVENT.exec(line);
    if (e) {
      events.push(maskAddresses(`${e[2]} ${e[3]}${e[4]}`, bases));
      recIndent = e[1]!.length;
      continue;
    }
    const s = SPAN.exec(line);
    if (s) {
      events.push(maskAddresses(`SPAN ${s[2]}${s[3] ? ` ${s[3]}` : ""}`, bases));
      recIndent = s[1]!.length;
      continue;
    }
    const indent = /^ */.exec(line)![0].length;
    if (recIndent >= 0 && indent > recIndent && indent < line.length) {
      events[events.length - 1] += `\n${maskAddresses(line.slice(recIndent), bases)}`;
      continue;
    }
    other.push(line);
    recIndent = -1;
  }
  return { events, other };
}

/** A record as one line of a trace file: its newlines (continuations) written as `\n`. */
export const traceLine = (event: string): string => event.replaceAll("\n", "\\n");

/** A normalised trace's file text: one record per line. */
export const traceText = (events: readonly string[]): string => events.map((e) => `${traceLine(e)}\n`).join("");

/** The index of the first record where the traces differ (one may end first), or -1 if they are equal. */
export function firstEventDifference(oracle: readonly string[], port: readonly string[]): number {
  const n = Math.min(oracle.length, port.length);
  for (let i = 0; i < n; i++) if (oracle[i] !== port[i]) return i;
  return oracle.length === port.length ? -1 : n;
}

/** How a port trace compares with the oracle's. */
export type TraceVerdict =
  /** Same records. */
  | { kind: "match" }
  /** They differ at `index`, where both have a record. */
  | { kind: "diverges"; index: number }
  /** The port's records are a strict prefix of the oracle's: it stopped (or crashed, or is unported) at `index`. */
  | { kind: "port-stops"; index: number }
  /** The oracle's records are a strict prefix of the port's. */
  | { kind: "port-extra"; index: number };

/** `firstEventDifference` as a verdict. */
export function compareTraces(oracle: readonly string[], port: readonly string[]): TraceVerdict {
  const i = firstEventDifference(oracle, port);
  if (i < 0) return { kind: "match" };
  if (i < oracle.length && i < port.length) return { kind: "diverges", index: i };
  return i === port.length ? { kind: "port-stops", index: i } : { kind: "port-extra", index: i };
}

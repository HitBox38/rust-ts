// Subject side of the `fluent-parse` / `fluent-format` suites; corpus reading, argument matrix and
// output framing must match tools/probes/fluentdump/main.rs (see its header for the format).
//   bun src/rust_ts/fluentdump.ts parse|format <file>...
//
// Wiring:
// - parse: `parse` from src/vendor/fluent_syntax/parser/mod.ts and `debug_Resource` (+ the Debug of
//   `ParserError`) from src/vendor/fluent_syntax/ast/mod.ts once fluent-syntax 0.12.0 is vendored.
//   Replace the body of `parse_and_dump` with the equivalent of
//   `format!("{:#?}", fluent_syntax::parser::parse(source.as_str()))`, i.e.
//     const r = parse(source);
//     return debug_result(r, PRETTY, debug_Resource, (e, f) => debug_tuple(f, "", [debug_Resource(e[0], f), debug_list(f, e[1].map((x) => debug_ParserError(x, f)))]));
//   (`{:#?}` of `Result<Resource<&str>, (Resource<&str>, Vec<ParserError>)>`).
// - format: already calls the ported `rustc_errors::formatting::format_diag_message` with
//   `DiagMessage::Inline`, i.e. the real `format_fluent_str`; it reaches `unported(...)` until
//   fluent-bundle 0.16.0 is vendored and wired into src/rustc_errors/formatting.ts and
//   src/rustc_error_messages/lib.ts (`register_functions`, `fluent_value_from_str_list_sep_by_and`).
//   Nothing changes here then.
import { readFileSync } from "node:fs";
import { debug_DiagArgValue, type DiagArgMap, type DiagArgValue } from "../rustc_error_messages/lib.ts";
import { format_diag_message } from "../rustc_errors/formatting.ts";
import { debug_str, PLAIN } from "../std/fmt.ts";
import { Panic, Unported, unported } from "../std/panic.ts";

interface Record {
  provenance: string[];
  message: string;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(what: string): never {
  throw new Panic(what);
}

function read_records(bytes: Uint8Array): Record[] {
  const out: Record[] = [];
  let provenance: string[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const nl = bytes.indexOf(0x0a, pos);
    const end = nl < 0 ? bytes.length : nl;
    const line = decoder.decode(bytes.subarray(pos, end));
    pos = end + 1;
    if (line === "" || line.startsWith("//")) continue;
    else if (line.startsWith("@ ")) provenance.push(line.slice(2));
    else if (line.startsWith("= ")) {
      const n = Number(line.slice(2));
      if (!Number.isInteger(n) || n < 0 || !/^[0-9]+$/.test(line.slice(2))) fail("bad record length");
      if (provenance.length === 0) fail("record without provenance");
      if (!(pos + n < bytes.length && bytes[pos + n] === 0x0a)) fail("bad record terminator");
      const message = decoder.decode(bytes.subarray(pos, pos + n));
      pos += n + 1;
      out.push({ provenance, message });
      provenance = [];
    } else fail(`bad corpus line ${debug_str(line)}`);
  }
  if (provenance.length !== 0) fail("provenance without record");
  return out;
}

const is_alpha = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const is_alnum = (c: number) => is_alpha(c) || (c >= 0x30 && c <= 0x39);

/** Same scan as `scan_vars` in the probe (ASCII-only, so byte offsets index the UTF-8 bytes). */
function scan_vars(msg: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < msg.length) {
    if (msg[i] === 0x24 && i + 1 < msg.length && is_alpha(msg[i + 1]!)) {
      const start = i + 1;
      let j = start;
      while (j < msg.length && (is_alnum(msg[j]!) || msg[j] === 0x5f || msg[j] === 0x2d)) j++;
      const name = decoder.decode(msg.subarray(start, j));
      if (!out.includes(name)) out.push(name);
      i = j;
    } else i++;
  }
  return out;
}

/** Same scan as `scan_keys` in the probe. */
function scan_keys(msg: Uint8Array): string[] {
  const out: string[] = [];
  const blank = (c: number | undefined) => c === 0x20 || c === 0x09;
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] !== 0x5b) continue;
    let j = i + 1;
    while (j < msg.length && blank(msg[j])) j++;
    const start = j;
    while (j < msg.length && (is_alnum(msg[j]!) || msg[j] === 0x5f || msg[j] === 0x2d || msg[j] === 0x2e)) j++;
    const end = j;
    while (j < msg.length && blank(msg[j])) j++;
    if (end > start && j < msg.length && msg[j] === 0x5d) {
      const key = decoder.decode(msg.subarray(start, end));
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

function value_list(v: string, keys: string[]): DiagArgValue[] {
  return [
    { $: "Str", _0: v },
    { $: "Number", _0: 0 },
    { $: "Number", _0: 1 },
    { $: "Number", _0: 2 },
    { $: "Number", _0: 5 },
    { $: "Number", _0: -1 },
    { $: "Str", _0: "1.5" },
    { $: "StrListSepByAnd", _0: ["a", "b"] },
    { $: "StrListSepByAnd", _0: ["a", "b", "c"] },
    ...keys.map((k): DiagArgValue => ({ $: "Str", _0: k })),
  ];
}

function arg_rows(vars: string[], keys: string[]): DiagArgMap[] {
  const rows: DiagArgMap[] = [new Map()];
  if (vars.length === 0) return rows;
  const lists = vars.map((v) => value_list(v, keys));
  const n = lists[0]!.length;
  for (let row = 0; row < n; row++) {
    const args: DiagArgMap = new Map();
    vars.forEach((v, i) => args.set(v, lists[i]![(row + i) % n]!));
    rows.push(args);
  }
  return rows;
}

const debug_vec_str = (v: string[]): string => `[${v.map(debug_str).join(", ")}]`;

function format_record(msg: string, bytes: Uint8Array): string {
  const vars = scan_vars(bytes);
  const keys = scan_keys(bytes);
  let out = `vars ${debug_vec_str(vars)}\nkeys ${debug_vec_str(keys)}\n`;
  for (const args of arg_rows(vars, keys)) {
    const shown = [...args].map(([k, v]) => `${k}=${debug_DiagArgValue(v, PLAIN)}`);
    out += `args {${shown.join(", ")}}\n`;
    let r: string;
    try {
      r = `=> Ok(${debug_str(format_diag_message({ $: "Inline", _0: msg }, args))})`;
    } catch (e) {
      // A Rust panic inside format_fluent_str is caught and printed by the probe; unported code
      // and JS errors are not panics.
      if (!(e instanceof Panic)) throw e;
      r = `=> panic ${debug_str(e.message)}`;
    }
    out += r + "\n";
  }
  return out;
}

/** `format!("{:#?}", fluent_syntax::parser::parse(source.as_str()))` — see the wiring note above. */
function parse_and_dump(_source: string): string {
  return unported("fluent_syntax::parser::parse");
}

const [mode, ...files] = process.argv.slice(2);
let out = "";
try {
  if (mode !== "parse" && mode !== "format") fail(`unknown mode ${debug_str(String(mode))}`);
  for (const path of files) {
    const bytes = readFileSync(path);
    out += `file: ${path}\n`;
    read_records(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).forEach((rec, i) => {
      out += `msg ${i} ${rec.provenance[0]}\ntext ${debug_str(rec.message)}\n`;
      if (mode === "format") out += format_record(rec.message, new TextEncoder().encode(rec.message));
      else out += parse_and_dump(`generated_msg = ${rec.message}\n`) + "\n";
    });
    if (out.length > 1 << 20) {
      process.stdout.write(out);
      out = "";
    }
  }
  process.stdout.write(out);
} catch (e) {
  // Same exit-code contract as src/rust_ts/main.ts: 70 = reached unported code, 101 = ICE.
  process.stdout.write(out);
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}

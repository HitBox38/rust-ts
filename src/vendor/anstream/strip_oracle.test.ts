// Oracle snapshot for anstream 0.6.21 / anstyle-parse 0.2.7 / utf8parse 0.2.2 (+ anstyle 1.0.13).
//
// `strip_oracle.json` was produced by a scratch Rust program built against the real crates at
// those versions (release build): for each input byte string (`in`, hex; hand-written ESC/CSI/
// OSC/DCS/SOS/PM/APC sequences, C0/C1 controls, DEL, invalid/truncated/multibyte UTF-8, plus
// seeded random compositions of such fragments and biased random bytes) it records
// - `sb`: the items of `adapter::strip_bytes(in)` (hex, `|`-separated)
// - `ss`/`sc`: if `in` is UTF-8, the items of `adapter::strip_str` and the concatenated output of
//   `StripStr::strip_next` fed one char at a time (else null)
// - `ws`/`wb`: the output of `StripStream<Vec<u8>>` after one `write_all(in)` / one `write_all`
//   per byte
// - `split`: every split point `k` where `write_all(in[..k]); write_all(in[k..])` differs from
//   `ws`, as `k:hex`
// - `short`: `StripStream::write` driven to completion over a writer accepting <= 3 bytes per
//   call: the returned counts, then the bytes the writer received
// - `wincon`: the items of `adapter::WinconBytes::extract_next(in)` as `{style}` (hex) `:` text
// - `vte`: the `anstyle_parse::Perform` calls of `Parser::advance` over `in`
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAIN } from "../../std/fmt.ts";
import { Ok } from "../../std/result.ts";
import type { IoResult } from "../../std/io.ts";
import { Style } from "../anstyle/lib.ts";
import { Parser, debug_Params, type Params, type Perform } from "../anstyle_parse/lib.ts";
import { StripStr, WinconBytes, strip_bytes, strip_str } from "./adapter/mod.ts";
import { StripStream } from "./strip.ts";
import { VecU8, Write_default, type AsLockedWrite, type FmtArguments, type RawStream } from "./stream.ts";

interface Case {
  in: string;
  sb: string;
  ss: string | null;
  sc: string | null;
  ws: string;
  wb: string;
  split: string[];
  short: string;
  wincon: string;
  vte: string;
}

const CASES_: Case[] = JSON.parse(readFileSync(join(import.meta.dir, "strip_oracle.json"), "utf8"));

const hex = (b: Uint8Array | readonly number[]): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const enc = new TextEncoder();
const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function strip_stream_whole(input: Uint8Array): Uint8Array {
  const s = StripStream.new(new VecU8());
  s.write_all(input);
  return s.into_inner().bytes();
}

class Short implements RawStream, AsLockedWrite {
  readonly out = new VecU8();
  constructor(readonly cap: number) {}
  write(buf: Uint8Array): IoResult<number> {
    const n = Math.min(this.cap, buf.length);
    this.out.write_all(buf.subarray(0, n));
    return Ok(n);
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
  is_terminal(): boolean {
    return false;
  }
  as_locked_write(): Short {
    return this;
  }
}

class Log implements Perform {
  readonly _0: string[] = [];
  print(c: number): void {
    this._0.push(`p${c.toString(16)}`);
  }
  execute(b: number): void {
    this._0.push(`x${hex([b])}`);
  }
  hook(params: Params, inter: Uint8Array, ignore: boolean, action: number): void {
    this._0.push(`h${debug_Params(params, PLAIN)}/${hex(inter)}/${ignore ? 1 : 0}/${hex([action])}`);
  }
  put(b: number): void {
    this._0.push(`u${hex([b])}`);
  }
  unhook(): void {
    this._0.push("U");
  }
  osc_dispatch(params: readonly Uint8Array[], bell: boolean): void {
    this._0.push(`o${bell ? 1 : 0}/${params.map(hex).join(",")}`);
  }
  csi_dispatch(params: Params, inter: Uint8Array, ignore: boolean, action: number): void {
    this._0.push(`c${debug_Params(params, PLAIN)}/${hex(inter)}/${ignore ? 1 : 0}/${hex([action])}`);
  }
  esc_dispatch(inter: Uint8Array, ignore: boolean, b: number): void {
    this._0.push(`e${hex(inter)}/${ignore ? 1 : 0}/${hex([b])}`);
  }
}

function run(c: Case): Case {
  const input = unhex(c.in);
  const sb = Array.from(strip_bytes(input), hex).join("|");
  let ss: string | null = null;
  let sc: string | null = null;
  let s: string | undefined;
  try {
    s = fatal.decode(input);
  } catch {
    s = undefined;
  }
  if (s !== undefined) {
    ss = Array.from(strip_str(s), (p) => hex(enc.encode(p))).join("|");
    const st = StripStr.new();
    let res = "";
    for (const ch of s) for (const p of st.strip_next(ch)) res += p;
    sc = hex(enc.encode(res));
  }
  const ws = strip_stream_whole(input);
  const wbs = StripStream.new(new VecU8());
  for (const b of input) wbs.write_all(Uint8Array.of(b));
  const wb = wbs.into_inner().bytes();
  const split: string[] = [];
  for (let k = 0; k <= input.length; k++) {
    const st = StripStream.new(new VecU8());
    st.write_all(input.subarray(0, k));
    st.write_all(input.subarray(k));
    const o = st.into_inner().bytes();
    if (hex(o) !== hex(ws)) split.push(`${k}:${hex(o)}`);
  }
  const short = StripStream.new(new Short(3));
  let buf = input;
  const offs: number[] = [];
  let guard = 0;
  while (buf.length !== 0 && guard < 1000) {
    const r = short.write(buf);
    if (r.$ === "Err") throw new Error("short write failed");
    offs.push(r._0);
    buf = buf.subarray(r._0);
    guard++;
  }
  const short_out = `${offs.join(",")}:${hex(short.into_inner().out.bytes())}`;
  const wc = WinconBytes.new();
  const wincon = Array.from(wc.extract_next(input), ([style, text]) => `${hex(enc.encode(Style.fmt(style, PLAIN)))}:${hex(enc.encode(text))}`).join("|");
  const parser = Parser.new();
  const log = new Log();
  for (const b of input) parser.advance(log, b);
  return { in: c.in, sb, ss, sc, ws: hex(ws), wb: hex(wb), split, short: short_out, wincon, vte: log._0.join(" ") };
}

test("strip oracle", () => {
  expect(CASES_.length).toBeGreaterThan(400);
  let matched = 0;
  const mismatches: string[] = [];
  for (const c of CASES_) {
    const actual = run(c);
    if (JSON.stringify(actual) === JSON.stringify(c)) matched++;
    else if (mismatches.length < 5) mismatches.push(`${JSON.stringify(c)}\n${JSON.stringify(actual)}`);
  }
  expect(mismatches).toEqual([]);
  expect(matched).toBe(CASES_.length);
});

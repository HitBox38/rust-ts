// Unit tests for the proc_macro bridge port: buffer growth, the RPC byte format (expected bytes derived from
// library/proc_macro/src/bridge/rpc.rs and the `rpc_encode_decode!` / `with_api!` declarations in mod.rs: enum tags
// are variant indices as `u8`, `u32` / `usize` little-endian with `usize` 8 bytes on the 64-bit hosts, `&str` as
// `usize` length + UTF-8 bytes), handle stores, the client symbol interner, and a full in-process round trip
// (server.rs `run_server` / `Dispatcher::dispatch` <-> client.rs `run_client` / `Methods`).
import "../lib.ts";

import { describe, expect, test } from "bun:test";

import type { MutRef } from "../../std/mut_ref.ts";
import { Panic, panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Buffer, vec_from_slice } from "./buffer.ts";
import {
  Client,
  type CrateTokenStream,
  crate_TokenStream,
  Methods,
  Span as CSpan,
  Symbol as CSymbol,
  type TokenStream as CTokenStream,
} from "./client.ts";
import { InternedStore, OwnedStore } from "./handle.ts";
import {
  ApiTags_variants,
  decode_LitKind,
  decode_Option,
  decode_Result,
  DelimSpan,
  type Diagnostic,
  encode_ApiTags,
  encode_Bound,
  encode_LitKind,
  encode_Option,
  encode_Result,
  encode_TokenTree,
  type ExpnGlobals,
  type Literal,
  type TokenTree,
} from "./mod.ts";
import { decode_PanicMessage, encode_PanicMessage, PanicMessage } from "./panic_message.ts";
import {
  decode_bool,
  decode_str,
  decode_u32,
  decode_u8,
  decode_usize,
  decode_Vec,
  encode_bool,
  encode_str,
  encode_u32,
  encode_u8,
  encode_usize,
  encode_Vec,
} from "./rpc.ts";
import { Dispatcher, HandleStore, MaybeCrossThread, type Range, type Server } from "./server.ts";

const bytes = (b: Buffer): number[] => [...b.deref()];
const reader = (xs: number[]): MutRef<Uint8Array> => ({ value: Uint8Array.from(xs) });

describe("Buffer", () => {
  test("default is empty with capacity 0; push grows like Vec (min 8, then doubling)", () => {
    const b = Buffer.new();
    expect([b.len, b.capacity]).toEqual([0, 0]);
    b.push(1);
    expect([b.len, b.capacity]).toEqual([1, 8]);
    for (let i = 2; i <= 9; i++) b.push(i);
    expect([b.len, b.capacity]).toEqual([9, 16]);
    expect(bytes(b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    b.extend_from_slice(new Uint8Array(40));
    // required = 49 > 2 * 16
    expect([b.len, b.capacity]).toEqual([49, 49]);
  });

  test("take leaves a default buffer; clear keeps capacity", () => {
    const b = Buffer.from(vec_from_slice(Uint8Array.from([7, 8])));
    const t = b.take();
    expect(bytes(t)).toEqual([7, 8]);
    expect([b.len, b.capacity]).toEqual([0, 0]);
    t.clear();
    expect([t.len, t.capacity]).toEqual([0, 2]);
  });

  test("growth goes through the owner's reserve fn; drop_ calls the owner's drop fn", () => {
    const calls: string[] = [];
    const reserve = (b: Buffer, additional: number): Buffer => {
      calls.push(`reserve ${b.len} ${additional}`);
      const data = new Uint8Array(b.capacity + additional);
      data.set(b.deref());
      return new Buffer(data, b.len, data.length, reserve, drop);
    };
    const drop = (b: Buffer): void => void calls.push(`drop ${b.len}`);
    const foreign = new Buffer(new Uint8Array(2), 0, 2, reserve, drop);
    foreign.extend_from_array(Uint8Array.from([1, 2]));
    foreign.extend_from_array(Uint8Array.from([3, 4, 5]));
    expect(bytes(foreign)).toEqual([1, 2, 3, 4, 5]);
    foreign.drop_();
    expect(calls).toEqual(["reserve 2 3", "drop 5"]);
    expect(foreign.len).toBe(0);
  });
});

describe("rpc encoding", () => {
  test("primitives", () => {
    const w = Buffer.new();
    encode_u8(0xab, w, undefined);
    encode_u32(0x01020304, w, undefined);
    encode_usize(0x1_0000_0005, w, undefined);
    encode_bool(true, w, undefined);
    encode_bool(false, w, undefined);
    expect(bytes(w)).toEqual([0xab, 4, 3, 2, 1, 5, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const r = reader(bytes(w).slice(1));
    expect(decode_u32(r, undefined)).toBe(0x01020304);
    expect(decode_usize(r, undefined)).toBe(0x1_0000_0005);
    expect(decode_bool(r, undefined)).toBe(true);
    expect(decode_bool(r, undefined)).toBe(false);
    expect(r.value.length).toBe(0);
  });

  test("&str is a usize byte length then UTF-8", () => {
    const w = Buffer.new();
    encode_str("aé", w, undefined);
    expect(bytes(w)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0x61, 0xc3, 0xa9]);
    expect(decode_str(reader(bytes(w)), undefined)).toBe("aé");
  });

  test("Vec, Option (Some = 0, None = 1), Result (Ok = 0, Err = 1), Bound", () => {
    const w = Buffer.new();
    encode_Vec([1, 2], w, undefined, encode_u8);
    encode_Option(9, w, undefined, encode_u8);
    encode_Option<number, undefined>(undefined, w, undefined, encode_u8);
    encode_Result<boolean, string, undefined>(Ok(true), w, undefined, encode_bool, encode_str);
    encode_Result<boolean, string, undefined>(Err("x"), w, undefined, encode_bool, encode_str);
    encode_Bound({ $: "Excluded", _0: 2 }, w, undefined, encode_usize);
    encode_Bound({ $: "Unbounded" }, w, undefined, encode_usize);
    expect(bytes(w)).toEqual([
      ...[2, 0, 0, 0, 0, 0, 0, 0, 1, 2],
      ...[0, 9],
      ...[1],
      ...[0, 1],
      ...[1, 1, 0, 0, 0, 0, 0, 0, 0, 0x78],
      ...[1, 2, 0, 0, 0, 0, 0, 0, 0],
      ...[2],
    ]);
    const r = reader(bytes(w));
    expect(decode_Vec(r, undefined, decode_u8)).toEqual([1, 2]);
    expect(decode_Option(r, undefined, decode_u8)).toBe(9);
    expect(decode_Option(r, undefined, decode_u8)).toBe(undefined);
    expect(decode_Result(r, undefined, decode_bool, decode_str)).toEqual(Ok(true));
    expect(decode_Result(r, undefined, decode_bool, decode_str)).toEqual(Err("x"));
    expect(r.value.length).toBe(10);
  });

  test("ApiTags are with_api! indices", () => {
    expect(ApiTags_variants.length).toBe(31);
    const w = Buffer.new();
    encode_ApiTags("track_env_var", w, undefined);
    encode_ApiTags("ts_drop", w, undefined);
    encode_ApiTags("ts_into_trees", w, undefined);
    encode_ApiTags("span_debug", w, undefined);
    encode_ApiTags("symbol_normalize_and_validate_ident", w, undefined);
    expect(bytes(w)).toEqual([0, 4, 13, 14, 30]);
  });

  test("LitKind tags and raw-string hash counts", () => {
    const w = Buffer.new();
    encode_LitKind({ $: "Integer" }, w, undefined);
    encode_LitKind({ $: "StrRaw", _0: 3 }, w, undefined);
    encode_LitKind({ $: "CStrRaw", _0: 0 }, w, undefined);
    encode_LitKind({ $: "ErrWithGuar" }, w, undefined);
    expect(bytes(w)).toEqual([2, 5, 3, 9, 0, 10]);
    const r = reader(bytes(w));
    expect(decode_LitKind(r, undefined)).toEqual({ $: "Integer" });
    expect(decode_LitKind(r, undefined)).toEqual({ $: "StrRaw", _0: 3 });
    expect(decode_LitKind(r, undefined)).toEqual({ $: "CStrRaw", _0: 0 });
    expect(decode_LitKind(r, undefined)).toEqual({ $: "ErrWithGuar" });
  });

  test("TokenTree field order: Group(delimiter, stream, DelimSpan), Punct(ch, joint, span), Ident(sym, kind, span), Literal(kind, symbol, suffix, span)", () => {
    const w = Buffer.new();
    const enc_h = (h: number, w2: Buffer, s: undefined) => encode_u32(h, w2, s);
    const trees: TokenTree<number, number, string>[] = [
      { $: "Group", _0: { delimiter: "Bracket", stream: 7, span: new DelimSpan(1, 2, 3) } },
      { $: "Punct", _0: { ch: 0x2b, joint: true, span: 4 } },
      { $: "Ident", _0: { sym: "r", kind: "Raw", span: 5 } },
      { $: "Literal", _0: { kind: { $: "Str" }, symbol: "s", suffix: undefined, span: 6 } },
    ];
    for (const t of trees) encode_TokenTree(t, w, undefined, enc_h, enc_h, encode_str);
    const u32 = (n: number) => [n, 0, 0, 0];
    const str1 = (c: number) => [1, 0, 0, 0, 0, 0, 0, 0, c];
    expect(bytes(w)).toEqual([
      ...[0, 2, 0, ...u32(7), ...u32(1), ...u32(2), ...u32(3)],
      ...[1, 0x2b, 1, ...u32(4)],
      ...[2, ...str1(0x72), 1, ...u32(5)],
      ...[3, 4, ...str1(0x73), 1, ...u32(6)],
    ]);
  });

  test("PanicMessage crosses as Option<&str> and decodes as String / Unknown", () => {
    const w = Buffer.new();
    encode_PanicMessage({ $: "StaticStr", _0: "boom" }, w, undefined);
    encode_PanicMessage(PanicMessage.Unknown, w, undefined);
    expect(bytes(w)).toEqual([0, 4, 0, 0, 0, 0, 0, 0, 0, 0x62, 0x6f, 0x6f, 0x6d, 1]);
    const r = reader(bytes(w));
    expect(decode_PanicMessage(r, undefined)).toEqual({ $: "String", _0: "boom" });
    expect(decode_PanicMessage(r, undefined)).toEqual(PanicMessage.Unknown);
  });
});

describe("handle stores", () => {
  test("OwnedStore allocates from the counter, take removes, use-after-free panics", () => {
    const counter = { value: 5 };
    const st = OwnedStore.new<string>(counter);
    expect(st.alloc("a")).toBe(5);
    expect(st.alloc("b")).toBe(6);
    expect(counter.value).toBe(7);
    expect(st.index(5)).toBe("a");
    expect(st.take(5)).toBe("a");
    expect(() => st.take(5)).toThrow("use-after-free in `proc_macro` handle");
    expect(() => OwnedStore.new({ value: 0 })).toThrow("assertion `left != right` failed");
  });

  test("InternedStore returns one handle per value", () => {
    const st = InternedStore.new<number>({ value: 1 });
    expect(st.alloc(100)).toBe(1);
    expect(st.alloc(200)).toBe(2);
    expect(st.alloc(100)).toBe(1);
    expect(st.copy(2)).toBe(200);
  });
});

describe("client symbol interner", () => {
  test("symbols are invalidated by invalidate_all and never reused", () => {
    CSymbol.invalidate_all();
    const a = CSymbol.new("foo");
    expect(CSymbol.new("foo")).toBe(a);
    const b = CSymbol.new("bar");
    expect(b as number).toBe(a + 1);
    expect(CSymbol.with(b, (s) => s)).toBe("bar");
    CSymbol.invalidate_all();
    expect(() => CSymbol.with(a, (s) => s)).toThrow("use-after-free of `proc_macro` symbol");
    expect(CSymbol.new("foo") as number).toBe(b + 1);
  });

  test("new_ident fast path and raw checks", () => {
    expect(CSymbol.with(CSymbol.new_ident("x_1", false), (s) => s)).toBe("x_1");
    expect(() => CSymbol.new_ident("self", true)).toThrow("`self` cannot be a raw identifier");
    expect(() => CSymbol.new_ident("1x", false)).toThrow('`"1x"` is not a valid identifier');
  });
});

// ---- In-process round trip: a toy server and a TS client ----

type TS = TokenTree<TS_, number, string>[];
interface TS_ {
  trees: TS;
}

class ToyServer implements Server<TS_, number, string> {
  log: string[] = [];
  static intern_symbol(ident: string): string {
    return ident;
  }
  static with_symbol_string(symbol: string, f: (s: string) => void): void {
    f(symbol);
  }
  static default_TokenStream(): TS_ {
    return { trees: [] };
  }
  globals(): ExpnGlobals<number> {
    return { def_site: 1000, call_site: 1001, mixed_site: 1002 };
  }
  track_env_var(var_: string, value: string | undefined): void {
    this.log.push(`env ${var_}=${value}`);
  }
  track_path(path: string): void {
    this.log.push(`path ${path}`);
  }
  literal_from_str(s: string): Result<Literal<number, string>, string> {
    return s === "bad" ? Err("failed to parse to literal") : Ok({ kind: { $: "Integer" }, symbol: s, suffix: "u8", span: 1001 });
  }
  emit_diagnostic(d: Diagnostic<number>): void {
    this.log.push(`diag ${d.level} ${d.message} [${d.spans.join(",")}] ${d.children.length}`);
  }
  ts_drop(_stream: TS_): void {}
  ts_clone(stream: TS_): TS_ {
    return { trees: [...stream.trees] };
  }
  ts_is_empty(stream: TS_): boolean {
    return stream.trees.length === 0;
  }
  ts_expand_expr(_stream: TS_): Result<TS_, undefined> {
    return Err(undefined);
  }
  ts_from_str(src: string): Result<TS_, string> {
    return Ok({ trees: src.split(" ").map((sym) => ({ $: "Ident", _0: { sym, kind: "Normal", span: 1001 } })) });
  }
  ts_to_string(stream: TS_): string {
    return stream.trees.map((t) => (t.$ === "Ident" ? t._0.sym : t.$ === "Punct" ? String.fromCharCode(t._0.ch) : t.$)).join(" ");
  }
  ts_from_token_tree(tree: TokenTree<TS_, number, string>): TS_ {
    return { trees: [tree] };
  }
  ts_concat_trees(base: TS_ | undefined, trees: TokenTree<TS_, number, string>[]): TS_ {
    return { trees: [...(base?.trees ?? []), ...trees] };
  }
  ts_concat_streams(base: TS_ | undefined, streams: TS_[]): TS_ {
    return { trees: [...(base?.trees ?? []), ...streams.flatMap((s) => s.trees)] };
  }
  ts_into_trees(stream: TS_): TokenTree<TS_, number, string>[] {
    return stream.trees;
  }
  span_debug(span: number): string {
    return `#${span}`;
  }
  span_parent(_span: number): number | undefined {
    return undefined;
  }
  span_source(span: number): number {
    return span;
  }
  span_byte_range(span: number): Range {
    return { start: span, end: span + 2 ** 40 };
  }
  span_start(span: number): number {
    return span;
  }
  span_end(span: number): number {
    return span;
  }
  span_line(_span: number): number {
    return 3;
  }
  span_column(_span: number): number {
    return 4;
  }
  span_file(_span: number): string {
    return "t.rs";
  }
  span_local_file(_span: number): string | undefined {
    return undefined;
  }
  span_join(span: number, other: number): number | undefined {
    return span === other ? span : undefined;
  }
  span_subspan(_span: number, _start: unknown, _end: unknown): number | undefined {
    return undefined;
  }
  span_resolved_at(_span: number, at: number): number {
    return at;
  }
  span_source_text(_span: number): string | undefined {
    return "src";
  }
  span_save_span(_span: number): number {
    return 0;
  }
  span_recover_proc_macro_span(_id: number): number {
    return 1001;
  }
  symbol_normalize_and_validate_ident(string: string): Result<string, undefined> {
    return string === "é" ? Ok(string) : Err(undefined);
  }
}

class CrateTS implements CrateTokenStream {
  constructor(public _0: CTokenStream | undefined) {}
}
crate_TokenStream.new_ = (x) => new CrateTS(x);

const ident = (sym: string, span: number): TokenTree<TS_, number, string> => ({ $: "Ident", _0: { sym, kind: "Normal", span } });

describe("server <-> client round trip (same thread)", () => {
  test("a TS client sees the input trees, globals and spans, and its output comes back", () => {
    const server = new ToyServer();
    const input: TS_ = { trees: [ident("a", 7), { $: "Punct", _0: { ch: 0x2c, joint: false, span: 7 } }, ident("b", 8)] };
    const seen: string[] = [];
    const client = Client.expand1((ts) => {
      const trees = Methods.ts_into_trees(ts._0!.clone());
      for (const t of trees) {
        if (t.$ === "Ident") seen.push(`${CSymbol.with(t._0.sym, (s) => s)}@${Methods.span_debug(t._0.span)}`);
      }
      const cs = CSpan.call_site();
      seen.push(`call_site ${Methods.span_debug(cs)} line ${Methods.span_line(cs)} range ${JSON.stringify(Methods.span_byte_range(cs))}`);
      Methods.track_env_var("K", undefined);
      Methods.emit_diagnostic({ level: "Warning", message: "w", spans: [cs, CSpan.def_site()], children: [] });
      const lit = Methods.literal_from_str("12");
      seen.push(lit.$ === "Ok" ? `lit ${CSymbol.with(lit._0.symbol, (s) => s)} ${lit._0.suffix === undefined ? "" : CSymbol.with(lit._0.suffix, (s) => s)}` : "lit err");
      seen.push(`bad ${JSON.stringify(Methods.literal_from_str("bad"))}`);
      seen.push(`expand ${Methods.ts_expand_expr(ts._0!).$}`);
      const nfc = CSymbol.new_ident("é", false);
      seen.push(`ident ${CSymbol.with(nfc, (s) => s)}`);
      const extra = Methods.ts_from_str("x y");
      const out = Methods.ts_concat_streams(Methods.ts_concat_trees(undefined, trees.reverse()), [extra.$ === "Ok" ? extra._0 : panic()]);
      return new CrateTS(out);
    });
    const r = client.run1(new MaybeCrossThread(false), server, input, false);
    expect(seen).toEqual([
      "a@#7",
      "b@#8",
      'call_site #1001 line 3 range {"start":1001,"end":1099511628777}',
      "lit 12 u8",
      'bad {"$":"Err","_0":"failed to parse to literal"}',
      "expand Err",
      "ident é",
    ]);
    expect(server.log).toEqual(["env K=undefined", "diag Warning w [1001,1000] 0"]);
    expect(r.$).toBe("Ok");
    expect(server.ts_to_string((r as { _0: TS_ })._0)).toBe("b , a x y");
  });

  test("an empty client output (None) is the server's default TokenStream", () => {
    const r = Client.expand1(() => new CrateTS(undefined)).run1(new MaybeCrossThread(false), new ToyServer(), { trees: [] }, false);
    expect(r).toEqual(Ok({ trees: [] }));
  });

  test("expand2 gets both inputs", () => {
    const client = Client.expand2((a, b) => new CrateTS(Methods.ts_concat_streams(undefined, [b._0!, a._0!])));
    const r = client.run2(new MaybeCrossThread(false), new ToyServer(), { trees: [ident("a", 1)] }, { trees: [ident("b", 2)] }, false);
    expect(r.$ === "Ok" ? r._0.trees.map((t) => (t.$ === "Ident" ? t._0.sym : "?")) : []).toEqual(["b", "a"]);
  });

  test("a client panic comes back as Err(PanicMessage::String)", () => {
    const r = Client.expand1(() => panic("proc macro failed")).run1(new MaybeCrossThread(false), new ToyServer(), { trees: [] }, false);
    expect(r).toEqual(Err({ $: "String", _0: "proc macro failed" }));
  });

  test("a server panic is resumed in the client and comes back as Err", () => {
    class PanickyServer extends ToyServer {
      override ts_is_empty(_stream: TS_): boolean {
        return panic("server bug");
      }
    }
    const r = Client.expand1((ts) => {
      Methods.ts_is_empty(ts._0!);
      return ts;
    }).run1(new MaybeCrossThread(false), new PanickyServer(), { trees: [] }, false);
    expect(r).toEqual(Err({ $: "String", _0: "server bug" }));
  });

  test("using a moved TokenStream handle is a server-side use-after-free panic", () => {
    const r = Client.expand1((ts) => {
      Methods.ts_drop(ts._0!);
      Methods.ts_is_empty(ts._0!);
      return ts;
    }).run1(new MaybeCrossThread(false), new ToyServer(), { trees: [] }, false);
    expect(r).toEqual(Err({ $: "String", _0: "use-after-free in `proc_macro` handle" }));
  });

  test("the proc_macro API outside of a proc macro panics", () => {
    expect(() => CSpan.call_site()).toThrow("procedural macro API is used outside of a procedural macro");
  });

  test("cross-thread execution is unported", () => {
    expect(() => Client.expand1((ts) => ts).run1(new MaybeCrossThread(true), new ToyServer(), { trees: [] }, false)).toThrow(
      "unported: proc_macro::bridge::server::MaybeCrossThread::run_bridge_and_client",
    );
  });
});

describe("Dispatcher::dispatch request/response bytes", () => {
  test("ts_is_empty(&handle) -> Ok(true); ts_drop(handle) -> Ok(()); then use-after-free -> Err(Some(msg))", () => {
    const hs = HandleStore.new<TS_, number, string>(ToyServer);
    const h = hs.token_stream.alloc({ trees: [] });
    const d = new Dispatcher(hs, new ToyServer());
    const req = (tag: number) => {
      const b = Buffer.new();
      encode_u8(tag, b, undefined);
      encode_u32(h, b, undefined);
      return b;
    };
    expect(bytes(d.dispatch(req(6)))).toEqual([0, 1]);
    expect(hs.token_stream.data.has(h)).toBe(true);
    expect(bytes(d.dispatch(req(4)))).toEqual([0]);
    expect(hs.token_stream.data.has(h)).toBe(false);
    const msg = "use-after-free in `proc_macro` handle";
    expect(bytes(d.dispatch(req(6)))).toEqual([1, 0, msg.length, 0, 0, 0, 0, 0, 0, 0, ...new TextEncoder().encode(msg)]);
  });

  test("span returns are interned handles: the same span gets the same handle", () => {
    const hs = HandleStore.new<TS_, number, string>(ToyServer);
    const d = new Dispatcher(hs, new ToyServer());
    const call = () => {
      const b = Buffer.new();
      encode_u8(29, b, undefined); // span_recover_proc_macro_span
      encode_usize(0, b, undefined);
      return bytes(d.dispatch(b));
    };
    const a = call();
    expect(a[0]).toBe(0);
    expect(call()).toEqual(a);
    expect(hs.span.copy(a[1]! | (a[2]! << 8) | (a[3]! << 16) | (a[4]! << 24))).toBe(1001);
  });

  test("a non-Panic JS error is not caught as a proc-macro panic", () => {
    class BrokenServer extends ToyServer {
      override span_line(_span: number): number {
        throw new TypeError("port bug");
      }
    }
    const hs = HandleStore.new<TS_, number, string>(ToyServer);
    const sp = hs.span.alloc(5);
    const b = Buffer.new();
    encode_u8(20, b, undefined); // span_line
    encode_u32(sp, b, undefined);
    expect(() => new Dispatcher(hs, new BrokenServer()).dispatch(b)).toThrow(TypeError);
    expect(new Panic("x")).toBeInstanceOf(Error);
  });
});

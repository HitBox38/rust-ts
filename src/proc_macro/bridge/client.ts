// Port of library/proc_macro/src/bridge/client.rs
//
//! Client-side types.
//
// PORT: the client half runs in-process for proc macros built into rustc (`quote!`: `Client::expand1(quote)`),
// talking to the TS server through real `Buffer` bytes; a proc-macro dylib (D7) runs its own compiled client.
// The client's `S` (handle-store state) is `()`, here `undefined`.
//
// PORT: `client::Span` (`#[derive(Copy, Clone, PartialEq, Eq, Hash)] struct Span { handle }`) is a branded number
// (the handle), compared with `===`; `client::TokenStream { handle }` is a class. JS has no destructors: the
// implicit `Drop for TokenStream` (an RPC `ts_drop` freeing the server's handle) is not performed; it only frees
// memory in the server's per-expansion handle store. `drop_()` sends it explicitly.
//
// PORT: `crate::TokenStream` (lib.rs, `TokenStream(Option<bridge::client::TokenStream>)`) is not imported here:
// lib.ts imports the bridge. Its codecs (client.rs:48-60) and `run_client` type it structurally
// (`CrateTokenStream`) and build one through `crate_TokenStream.new_`, which lib.ts sets at load.

import { type Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { Buffer } from "./buffer.ts";
import type { Closure } from "./closure.ts";
import type { Handle } from "./handle.ts";
import {
  type BridgeConfig,
  type Diagnostic,
  type ExpnGlobals,
  type Literal,
  type TokenTree,
  type ApiTags,
  decode_ExpnGlobals,
  decode_Literal,
  decode_Option,
  decode_Range,
  decode_Result,
  decode_TokenTree,
  encode_ApiTags,
  encode_Bound,
  encode_Diagnostic,
  encode_Option,
  encode_Result,
  encode_TokenTree,
} from "./mod.ts";
import { catch_unwind, decode_PanicMessage, encode_PanicMessage, PanicMessage, resume_unwind } from "./panic_message.ts";
import {
  type Decode,
  decode_bool,
  decode_NonZero_u32,
  decode_String,
  decode_tuple2,
  decode_unit,
  decode_usize,
  decode_Vec,
  encode_NonZero_u32,
  encode_str,
  encode_usize,
  encode_Vec,
} from "./rpc.ts";
import { reify_to_extern_c_fn_hrt_bridge } from "./selfless_reify.ts";
import { decode_Symbol, encode_Symbol, Symbol } from "./symbol.ts";
import type { Bound, Range } from "./server.ts";

// std-type: library/proc_macro/src/bridge/client.rs:13 TokenStream
export class TokenStream {
  constructor(public handle: Handle) {}

  // Forward `Drop::drop` to the inherent `drop` method.
  // std: library/proc_macro/src/bridge/client.rs:22 drop
  drop_(): void {
    Methods.ts_drop(new TokenStream(this.handle));
  }

  // impl Clone for TokenStream
  // std: library/proc_macro/src/bridge/client.rs:85 clone
  clone(): TokenStream {
    return Methods.ts_clone(this);
  }
}

// impl<S> Encode<S> for TokenStream
// std: library/proc_macro/src/bridge/client.rs:29 encode
export function encode_TokenStream<S>(self: TokenStream, w: Buffer, s: S): void {
  // `mem::ManuallyDrop::new(self).handle.encode(w, s)`
  encode_NonZero_u32(self.handle, w, s);
}

// impl<S> Encode<S> for &TokenStream
// std: library/proc_macro/src/bridge/client.rs:36 encode
export function encode_ref_TokenStream<S>(self: TokenStream, w: Buffer, s: S): void {
  encode_NonZero_u32(self.handle, w, s);
}

// impl<S> Decode<'_, '_, S> for TokenStream
// std: library/proc_macro/src/bridge/client.rs:43 decode
export function decode_TokenStream<S>(r: MutRef<Uint8Array>, s: S): TokenStream {
  return new TokenStream(decode_NonZero_u32(r, s));
}

/** `crate::TokenStream` (lib.rs, lane pm-lib): `pub struct TokenStream(Option<bridge::client::TokenStream>);`. */
export interface CrateTokenStream {
  _0: TokenStream | undefined;
}

/** The tuple-struct constructor `crate::TokenStream(..)`, installed by lib.ts (see the header). */
export const crate_TokenStream: { new_: (_0: TokenStream | undefined) => CrateTokenStream } = {
  new_: () => unported("proc_macro::TokenStream (lib.rs has not installed bridge::client::crate_TokenStream.new_)"),
};

// impl Encode<()> for crate::TokenStream
// std: library/proc_macro/src/bridge/client.rs:50 encode
export function encode_crate_TokenStream(self: CrateTokenStream, w: Buffer, s: undefined): void {
  encode_Option(self._0, w, s, encode_TokenStream);
}

// impl Decode<'_, '_, ()> for crate::TokenStream
// std: library/proc_macro/src/bridge/client.rs:57 decode
export function decode_crate_TokenStream(r: MutRef<Uint8Array>, s: undefined): CrateTokenStream {
  return crate_TokenStream.new_(decode_TokenStream(r, s));
}

// std-type: library/proc_macro/src/bridge/client.rs:63 Span
export type Span = Handle & { readonly __brand: "proc_macro::bridge::client::Span" };

// impl<S> Encode<S> for Span
// std: library/proc_macro/src/bridge/client.rs:72 encode
export function encode_Span<S>(self: Span, w: Buffer, s: S): void {
  encode_NonZero_u32(self, w, s);
}

// impl<S> Decode<'_, '_, S> for Span
// std: library/proc_macro/src/bridge/client.rs:79 decode
export function decode_Span<S>(r: MutRef<Uint8Array>, s: S): Span {
  return decode_NonZero_u32(r, s) as Span;
}

export const Span = {
  // std: library/proc_macro/src/bridge/client.rs:91 def_site
  def_site(): Span {
    return Bridge.with((bridge) => bridge.globals.def_site);
  },

  // std: library/proc_macro/src/bridge/client.rs:95 call_site
  call_site(): Span {
    return Bridge.with((bridge) => bridge.globals.call_site);
  },

  // std: library/proc_macro/src/bridge/client.rs:99 mixed_site
  mixed_site(): Span {
    return Bridge.with((bridge) => bridge.globals.mixed_site);
  },
};

// impl fmt::Debug for Span
// std: library/proc_macro/src/bridge/client.rs:105 fmt
export const debug_Span: Debug<Span> = (v) => Methods.span_debug(v);

// pub(crate) use super::symbol::Symbol;
export { debug_Symbol, display_Symbol, Symbol } from "./symbol.ts";

type S = undefined;
type TS = TokenStream;
type TT = TokenTree<TokenStream, Span, Symbol>;
const enc_tt = (t: TT, w: Buffer, s: S): void => encode_TokenTree(t, w, s, encode_TokenStream, encode_Span, encode_Symbol);
const dec_tt = (r: MutRef<Uint8Array>, s: S): TT => decode_TokenTree(r, s, decode_TokenStream, decode_Span, decode_Symbol);
const dec_opt_span = (r: MutRef<Uint8Array>, s: S): Span | undefined => decode_Option(r, s, decode_Span);
const dec_opt_string = (r: MutRef<Uint8Array>, s: S): string | undefined => decode_Option(r, s, decode_String);

/**
 * The body of every `define_client_side!` method: encode the tag and the arguments into the cached buffer, call
 * the server, decode `Result<R, PanicMessage>` and resume the server's panic on `Err`.
 */
function call_method<R>(method: ApiTags, encode_args: (buf: Buffer) => void, decode_R: Decode<R, S>): R {
  return Bridge.with((bridge) => {
    let buf = bridge.cached_buffer.take();

    buf.clear();
    encode_ApiTags(method, buf, undefined);
    encode_args(buf);

    buf = bridge.dispatch.call_(buf);

    const r = decode_Result({ value: buf.deref() }, undefined, decode_R, decode_PanicMessage);

    bridge.cached_buffer = buf;

    if (r.$ === "Err") return resume_unwind(PanicMessage.into_payload(r._0));
    return r._0;
  });
}

// pub(crate) struct Methods; (bridge/mod.rs:84)
// with_api!(define_client_side, TokenStream, Span, Symbol);
// PORT: each method carries the marker of its `with_api!` line (bridge/mod.rs), the fn `define_client_side!` generates.
export const Methods = {
  // std: library/proc_macro/src/bridge/mod.rs:36 track_env_var
  track_env_var(var_: string, value: string | undefined): void {
    return call_method(
      "track_env_var",
      (buf) => {
        encode_str(var_, buf, undefined);
        encode_Option(value, buf, undefined, encode_str);
      },
      decode_unit,
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:37 track_path
  track_path(path: string): void {
    return call_method("track_path", (buf) => encode_str(path, buf, undefined), decode_unit);
  },
  // std: library/proc_macro/src/bridge/mod.rs:38 literal_from_str
  literal_from_str(s: string): Result<Literal<Span, Symbol>, string> {
    return call_method(
      "literal_from_str",
      (buf) => encode_str(s, buf, undefined),
      (r, s2) =>
        decode_Result(
          r,
          s2,
          (r2: MutRef<Uint8Array>, s3: S) => decode_Literal(r2, s3, decode_Span, decode_Symbol),
          decode_String,
        ),
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:39 emit_diagnostic
  emit_diagnostic(diagnostic: Diagnostic<Span>): void {
    return call_method("emit_diagnostic", (buf) => encode_Diagnostic(diagnostic, buf, undefined, encode_Span), decode_unit);
  },

  // std: library/proc_macro/src/bridge/mod.rs:41 ts_drop
  ts_drop(stream: TS): void {
    return call_method("ts_drop", (buf) => encode_TokenStream(stream, buf, undefined), decode_unit);
  },
  // std: library/proc_macro/src/bridge/mod.rs:42 ts_clone
  ts_clone(stream: TS): TS {
    return call_method("ts_clone", (buf) => encode_ref_TokenStream(stream, buf, undefined), decode_TokenStream);
  },
  // std: library/proc_macro/src/bridge/mod.rs:43 ts_is_empty
  ts_is_empty(stream: TS): boolean {
    return call_method("ts_is_empty", (buf) => encode_ref_TokenStream(stream, buf, undefined), decode_bool);
  },
  // std: library/proc_macro/src/bridge/mod.rs:44 ts_expand_expr
  ts_expand_expr(stream: TS): Result<TS, undefined> {
    return call_method(
      "ts_expand_expr",
      (buf) => encode_ref_TokenStream(stream, buf, undefined),
      (r, s) => decode_Result(r, s, decode_TokenStream, decode_unit),
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:45 ts_from_str
  ts_from_str(src: string): Result<TS, string> {
    return call_method(
      "ts_from_str",
      (buf) => encode_str(src, buf, undefined),
      (r, s) => decode_Result(r, s, decode_TokenStream, decode_String),
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:46 ts_to_string
  ts_to_string(stream: TS): string {
    return call_method("ts_to_string", (buf) => encode_ref_TokenStream(stream, buf, undefined), decode_String);
  },
  // std: library/proc_macro/src/bridge/mod.rs:47 ts_from_token_tree
  ts_from_token_tree(tree: TT): TS {
    return call_method("ts_from_token_tree", (buf) => enc_tt(tree, buf, undefined), decode_TokenStream);
  },
  // std: library/proc_macro/src/bridge/mod.rs:50 ts_concat_trees
  ts_concat_trees(base: TS | undefined, trees: TT[]): TS {
    return call_method(
      "ts_concat_trees",
      (buf) => {
        encode_Option(base, buf, undefined, encode_TokenStream);
        encode_Vec(trees, buf, undefined, enc_tt);
      },
      decode_TokenStream,
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:54 ts_concat_streams
  ts_concat_streams(base: TS | undefined, streams: TS[]): TS {
    return call_method(
      "ts_concat_streams",
      (buf) => {
        encode_Option(base, buf, undefined, encode_TokenStream);
        encode_Vec(streams, buf, undefined, encode_TokenStream);
      },
      decode_TokenStream,
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:58 ts_into_trees
  ts_into_trees(stream: TS): TT[] {
    return call_method(
      "ts_into_trees",
      (buf) => encode_TokenStream(stream, buf, undefined),
      (r, s) => decode_Vec(r, s, dec_tt),
    );
  },

  // std: library/proc_macro/src/bridge/mod.rs:62 span_debug
  span_debug(span: Span): string {
    return call_method("span_debug", (buf) => encode_Span(span, buf, undefined), decode_String);
  },
  // std: library/proc_macro/src/bridge/mod.rs:63 span_parent
  span_parent(span: Span): Span | undefined {
    return call_method("span_parent", (buf) => encode_Span(span, buf, undefined), dec_opt_span);
  },
  // std: library/proc_macro/src/bridge/mod.rs:64 span_source
  span_source(span: Span): Span {
    return call_method("span_source", (buf) => encode_Span(span, buf, undefined), decode_Span);
  },
  // std: library/proc_macro/src/bridge/mod.rs:65 span_byte_range
  span_byte_range(span: Span): Range {
    return call_method(
      "span_byte_range",
      (buf) => encode_Span(span, buf, undefined),
      (r, s) => decode_Range(r, s, decode_usize),
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:66 span_start
  span_start(span: Span): Span {
    return call_method("span_start", (buf) => encode_Span(span, buf, undefined), decode_Span);
  },
  // std: library/proc_macro/src/bridge/mod.rs:67 span_end
  span_end(span: Span): Span {
    return call_method("span_end", (buf) => encode_Span(span, buf, undefined), decode_Span);
  },
  // std: library/proc_macro/src/bridge/mod.rs:68 span_line
  span_line(span: Span): number {
    return call_method("span_line", (buf) => encode_Span(span, buf, undefined), decode_usize);
  },
  // std: library/proc_macro/src/bridge/mod.rs:69 span_column
  span_column(span: Span): number {
    return call_method("span_column", (buf) => encode_Span(span, buf, undefined), decode_usize);
  },
  // std: library/proc_macro/src/bridge/mod.rs:70 span_file
  span_file(span: Span): string {
    return call_method("span_file", (buf) => encode_Span(span, buf, undefined), decode_String);
  },
  // std: library/proc_macro/src/bridge/mod.rs:71 span_local_file
  span_local_file(span: Span): string | undefined {
    return call_method("span_local_file", (buf) => encode_Span(span, buf, undefined), dec_opt_string);
  },
  // std: library/proc_macro/src/bridge/mod.rs:72 span_join
  span_join(span: Span, other: Span): Span | undefined {
    return call_method(
      "span_join",
      (buf) => {
        encode_Span(span, buf, undefined);
        encode_Span(other, buf, undefined);
      },
      dec_opt_span,
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:73 span_subspan
  span_subspan(span: Span, start: Bound, end: Bound): Span | undefined {
    return call_method(
      "span_subspan",
      (buf) => {
        encode_Span(span, buf, undefined);
        encode_Bound(start, buf, undefined, encode_usize);
        encode_Bound(end, buf, undefined, encode_usize);
      },
      dec_opt_span,
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:74 span_resolved_at
  span_resolved_at(span: Span, at: Span): Span {
    return call_method(
      "span_resolved_at",
      (buf) => {
        encode_Span(span, buf, undefined);
        encode_Span(at, buf, undefined);
      },
      decode_Span,
    );
  },
  // std: library/proc_macro/src/bridge/mod.rs:75 span_source_text
  span_source_text(span: Span): string | undefined {
    return call_method("span_source_text", (buf) => encode_Span(span, buf, undefined), dec_opt_string);
  },
  // std: library/proc_macro/src/bridge/mod.rs:76 span_save_span
  span_save_span(span: Span): number {
    return call_method("span_save_span", (buf) => encode_Span(span, buf, undefined), decode_usize);
  },
  // std: library/proc_macro/src/bridge/mod.rs:77 span_recover_proc_macro_span
  span_recover_proc_macro_span(id: number): Span {
    return call_method("span_recover_proc_macro_span", (buf) => encode_usize(id, buf, undefined), decode_Span);
  },

  // std: library/proc_macro/src/bridge/mod.rs:79 symbol_normalize_and_validate_ident
  symbol_normalize_and_validate_ident(string: string): Result<Symbol, undefined> {
    return call_method(
      "symbol_normalize_and_validate_ident",
      (buf) => encode_str(string, buf, undefined),
      (r, s) => decode_Result(r, s, decode_Symbol, decode_unit),
    );
  },
};

// std-type: library/proc_macro/src/bridge/client.rs:140 Bridge
class Bridge {
  constructor(
    /// Reusable buffer (only `clear`-ed, never shrunk), primarily
    /// used for making requests.
    public cached_buffer: Buffer,

    /// Server-side function that the client uses to make requests.
    public dispatch: Closure,

    /// Provided globals for this macro expansion.
    public globals: ExpnGlobals<Span>,
  ) {}

  // std: library/proc_macro/src/bridge/client.rs:198 with
  static with<R>(f: (bridge: Bridge) => R): R {
    return state.with((st) => {
      // `state.expect(..)`
      if (st === undefined) panic("procedural macro API is used outside of a procedural macro");
      const bridge = st;
      // `bridge.try_borrow_mut().expect(..)`
      if (bridge.borrow !== 0) panic("procedural macro API is used while it's already in use: BorrowMutError");
      bridge.borrow = -1;
      try {
        return f(bridge.value);
      } finally {
        bridge.borrow = 0;
      }
    });
  }
}

/** PORT: `RefCell<Bridge>` with its borrow flag (0 free, -1 mutably borrowed). */
interface BridgeCell {
  value: Bridge;
  borrow: number;
}

// mod state
const state = {
  // thread_local! { static BRIDGE_STATE: Cell<*const ()> = const { Cell::new(ptr::null()) }; }
  BRIDGE_STATE: undefined as BridgeCell | undefined,

  // std: library/proc_macro/src/bridge/client.rs:166 set
  set<R>(st: BridgeCell, f: () => R): R {
    class RestoreOnDrop {
      constructor(public _0: BridgeCell | undefined) {}
      // std: library/proc_macro/src/bridge/client.rs:169 drop
      drop(): void {
        state.BRIDGE_STATE = this._0;
      }
    }

    const inner = st;
    // `BRIDGE_STATE.replace(inner)`
    const outer = state.BRIDGE_STATE;
    state.BRIDGE_STATE = inner;
    const _restore = new RestoreOnDrop(outer);

    try {
      return f();
    } finally {
      _restore.drop();
    }
  },

  // std: library/proc_macro/src/bridge/client.rs:181 with
  with<R>(f: (bridge: BridgeCell | undefined) => R): R {
    const st = state.BRIDGE_STATE;
    // SAFETY: the only place where the pointer is set is in `set`. It puts
    // back the previous value after the inner call has returned, so we know
    // that as long as the pointer is not null, it came from a reference to
    // a `RefCell<Bridge>` that outlasts the call to this function. Since `f`
    // works the same for any lifetime of the bridge, including the actual
    // one, we can lie here and say that the lifetime is `'static` without
    // anyone noticing.
    const bridge = st;
    return f(bridge);
  },
};

// std: library/proc_macro/src/bridge/client.rs:209 is_available
export function is_available(): boolean {
  return state.with((s) => s !== undefined);
}

/// A client-side RPC entry-point, which may be using a different `proc_macro`
/// from the one used by the server, but can be invoked compatibly.
///
/// Note that the input and output type parameters are erased. They do not
/// participate in the ABI, so while using the wrong runN method will likely
/// result in a panic, it will not result in UB.
// std-type: library/proc_macro/src/bridge/client.rs:221 Client
// PORT: `run: extern "C" fn(BridgeConfig<'_>) -> Buffer`: a TS function for clients built into rustc
// (`expand1` / `expand2`); for a proc-macro dylib, the FFI edge's wrapper around the dylib's fn pointer (D7).
export class Client {
  constructor(public run: (config: BridgeConfig) => Buffer) {}

  // std: library/proc_macro/src/bridge/client.rs:282 expand1
  static expand1(f: (input: CrateTokenStream) => CrateTokenStream): Client {
    return new Client(reify_to_extern_c_fn_hrt_bridge((bridge) => run_client(bridge, decode_crate_TokenStream, f)));
  }

  // std: library/proc_macro/src/bridge/client.rs:290 expand2
  static expand2(f: (input: CrateTokenStream, input2: CrateTokenStream) => CrateTokenStream): Client {
    return new Client(
      reify_to_extern_c_fn_hrt_bridge((bridge) =>
        run_client(
          bridge,
          (r, s) => decode_tuple2(r, s, decode_crate_TokenStream, decode_crate_TokenStream),
          ([input, input2]) => f(input, input2),
        ),
      ),
    );
  }
}

/**
 * `static HIDE_PANICS_DURING_EXPANSION: Once`, and the `force_show_panics` its hook captured.
 * PORT: TS has no panic hooks. Hidden panic output (the hook installed with `force_show_panics == false`) is the
 * TS behaviour already; output the hook would print (`force_show_panics == true`) stops `run_client` with
 * `unported` when a panic is caught.
 */
let HIDE_PANICS_DURING_EXPANSION: { force_show_panics: boolean } | undefined;

// std: library/proc_macro/src/bridge/client.rs:225 maybe_install_panic_hook
function maybe_install_panic_hook(force_show_panics: boolean): void {
  // Hide the default panic output within `proc_macro` expansions.
  // NB. the server can't do this because it may use a different std.
  if (HIDE_PANICS_DURING_EXPANSION === undefined) {
    // We normally report panics by catching unwinds and passing the payload from the
    // unwind back to the compiler, but if the panic doesn't unwind we'll abort before
    // the compiler has a chance to print an error. So we special-case PanicInfo where
    // can_unwind is false.
    // `if force_show_panics || !is_available() || !info.can_unwind() { prev(info) }`
    HIDE_PANICS_DURING_EXPANSION = { force_show_panics };
  }
}

/// Client-side helper for handling client panics, entering the bridge,
/// deserializing input and serializing output.
// std: library/proc_macro/src/bridge/client.rs:245 run_client
function run_client<A>(config: BridgeConfig, decode_A: Decode<A, S>, f: (input: A) => CrateTokenStream): Buffer {
  const { input, dispatch, force_show_panics } = config;
  let buf = input;

  const res = catch_unwind((): CrateTokenStream => {
    maybe_install_panic_hook(force_show_panics);

    // Make sure the symbol store is empty before decoding inputs.
    Symbol.invalidate_all();

    const reader = { value: buf.deref() };
    const [globals, input] = decode_tuple2(
      reader,
      undefined,
      (r: MutRef<Uint8Array>, s: S) => decode_ExpnGlobals(r, s, decode_Span),
      decode_A,
    );

    // Put the buffer we used for input back in the `Bridge` for requests.
    const st: BridgeCell = { value: new Bridge(buf.take(), dispatch, globals), borrow: 0 };

    let output: CrateTokenStream;
    try {
      output = state.set(st, () => f(input));
    } catch (e) {
      // PORT: unwinding drops `state`, and with it the cached buffer.
      st.value.cached_buffer.drop_();
      throw e;
    }

    // Take the `cached_buffer` back out, for the output value.
    buf = st.value.cached_buffer;

    return output;
  });
  if (res.$ === "Err" && HIDE_PANICS_DURING_EXPANSION?.force_show_panics === true) {
    unported("proc_macro::bridge::client::maybe_install_panic_hook (printing a proc-macro panic: -Zproc-macro-backtrace)");
  }

  // Serialize response of type `Result<R, PanicMessage>`.
  buf.clear();
  const r: Result<CrateTokenStream, PanicMessage> = res.$ === "Ok" ? res : { $: "Err", _0: PanicMessage.from(res._0) };
  encode_Result(r, buf, undefined, encode_crate_TokenStream, encode_PanicMessage);

  // Now that a response has been serialized, invalidate all symbols
  // registered with the interner.
  Symbol.invalidate_all();
  return buf;
}

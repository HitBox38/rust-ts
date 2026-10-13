// Port of compiler/rustc_expand/src/proc_macro.rs
//
// PORT: `rustc_proc_macro as pm` is the `proc_macro` library port in src/proc_macro/. Running a client
// (`Client::run1` / `run2`) executes a user proc-macro dylib through the RPC bridge: M6 (decision D6); those
// calls stop with `unported(..)` (bridge/server.ts). Everything around them (server construction, error
// reporting, re-parsing derive output) is ported.
//
// PORT: `SelfProfilerRef::generic_activity_with_arg_recorder` (rustc_data_structures/profiling.rs) only runs its
// recorder closure when the self-profiler records generic activities, which needs `-Z self-profile`
// (`SelfProfilerRef.new` stops with `unported` on it, rustc_session/stand_ins.ts). The stand-in has no
// `generic_activity_with_arg_recorder`, so `record_expand_proc_macro` / `expand_derive_macro` call
// `generic_activity(name)` (the same `TimingGuard::none()`) and keep the closure bodies as comments.

import type { MetaItem, Safety } from "../rustc_ast/lib.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { AtomicRef } from "../rustc_data_structures/atomic_ref.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { parser as rustc_parse_parser } from "../rustc_parse/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { LocalExpnId } from "../rustc_span/hygiene.ts";
import type { Span } from "../rustc_span/lib.ts";
import { panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { Client } from "../proc_macro/bridge/client.ts";
import { PanicMessage } from "../proc_macro/bridge/panic_message.ts";
import { MaybeCrossThread, type ExecutionStrategy } from "../proc_macro/bridge/server.ts";
import "../proc_macro/lib.ts";
import {
  Annotatable,
  AttrProcMacro_provided,
  type AttrProcMacro as AttrProcMacroT,
  type BangProcMacro as BangProcMacroT,
  type ExpandResult,
  type ExtCtxt,
  type MultiItemModifier,
} from "./base.ts";
import * as diagnostics from "./diagnostics.ts";
import { Rustc } from "./proc_macro_server.ts";

const { AllowConstBlockItems, ForceCollect, Parser } = rustc_parse_parser;

/** `TimingGuard<'a>` (rustc_data_structures/profiling.rs): only dropped here. */
type TimingGuard = ReturnType<Session["prof"]["generic_activity"]>;

// rustc: compiler/rustc_expand/src/proc_macro.rs:16 exec_strategy
function exec_strategy(sess: Session): ExecutionStrategy {
  return new MaybeCrossThread(sess.opts.unstable_opts.proc_macro_execution_strategy === "CrossThread");
}

// rustc: compiler/rustc_expand/src/proc_macro.rs:23 record_expand_proc_macro
function record_expand_proc_macro(ecx: ExtCtxt, name: string, _span: Span): TimingGuard {
  // PORT: see the header; the recorder closure is
  // `|recorder| recorder.record_arg_with_span(ecx.sess.source_map(), ecx.expansion_descr(), span)`.
  return ecx.sess.prof.generic_activity(name);
}

// rustc-type: compiler/rustc_expand/src/proc_macro.rs:33 BangProcMacro
export class BangProcMacro implements BangProcMacroT {
  constructor(public client: Client) {}

  // rustc: compiler/rustc_expand/src/proc_macro.rs:38 expand
  expand(ecx: ExtCtxt, span: Span, input: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    const _timer = record_expand_proc_macro(ecx, "expand_proc_macro", span);

    const proc_macro_backtrace = ecx.ecfg.proc_macro_backtrace;
    const strategy = exec_strategy(ecx.sess);
    const server = Rustc.new(ecx);
    const r = this.client.run1(strategy, server, input, proc_macro_backtrace);
    if (r.$ === "Ok") return r;
    const e = r._0;
    const message = PanicMessage.into_string(e);
    return Err(
      ecx.dcx().emit_err(
        diagnostics.ProcMacroPanicked_diagnostic({
          span,
          message: message === undefined ? undefined : { message },
        }),
      ),
    );
  }
}

// rustc-type: compiler/rustc_expand/src/proc_macro.rs:60 AttrProcMacro
export class AttrProcMacro implements AttrProcMacroT {
  constructor(public client: Client) {}

  // rustc: compiler/rustc_expand/src/proc_macro.rs:65 expand
  expand(ecx: ExtCtxt, span: Span, annotation: TokenStream, annotated: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    const _timer = record_expand_proc_macro(ecx, "expand_proc_macro", span);

    const proc_macro_backtrace = ecx.ecfg.proc_macro_backtrace;
    const strategy = exec_strategy(ecx.sess);
    const server = Rustc.new(ecx);
    const r = this.client.run2(strategy, server, annotation, annotated, proc_macro_backtrace);
    if (r.$ === "Ok") return r;
    const e = r._0;
    const message = PanicMessage.into_string(e);
    return Err(
      ecx.dcx().emit_err(
        diagnostics.CustomAttributePanicked_diagnostic({
          span,
          message: message === undefined ? undefined : { message },
        }),
      ),
    );
  }

  /** (provided) `AttrProcMacro::expand_with_safety`: not overridden by this impl. */
  expand_with_safety(
    ecx: ExtCtxt,
    safety: Safety,
    span: Span,
    annotation: TokenStream,
    annotated: TokenStream,
  ): Result<TokenStream, ErrorGuaranteed> {
    return AttrProcMacro_provided(this).expand_with_safety.call(this, ecx, safety, span, annotation, annotated);
  }
}

// rustc-type: compiler/rustc_expand/src/proc_macro.rs:90 DeriveProcMacro
export class DeriveProcMacro implements MultiItemModifier {
  constructor(public client: DeriveClient) {}

  // rustc: compiler/rustc_expand/src/proc_macro.rs:95 expand
  expand(
    ecx: ExtCtxt,
    span: Span,
    _meta_item: MetaItem,
    item: Annotatable,
    _is_derive_const: boolean,
  ): ExpandResult<Annotatable[], Annotatable> {
    const _timer = record_expand_proc_macro(ecx, "expand_derive_proc_macro_outer", span);

    // We need special handling for statement items
    // (e.g. `fn foo() { #[derive(Debug)] struct Bar; }`)
    const is_stmt = item.$ === "Stmt";

    const input = Annotatable.to_tokens(item);

    const invoc_id = ecx.current_expansion.id;

    let res: Result<TokenStream, undefined>;
    if (ecx.sess.opts.incremental !== undefined && ecx.sess.opts.unstable_opts.cache_proc_macros) {
      res = EXPAND_DERIVE_MACRO_CACHED.deref()(invoc_id, input, ecx, this.client);
    } else {
      res = expand_derive_macro(invoc_id, input, ecx, this.client);
    }

    if (res.$ !== "Ok") {
      // error will already have been emitted
      return { $: "Ready", _0: [] };
    }
    const output = res._0;

    const error_count_before = ecx.dcx().err_count();
    const parser = Parser.new(ecx.sess.psess, output, "proc-macro derive");
    const items: Annotatable[] = [];

    for (;;) {
      const r = parser.parse_item(ForceCollect.No, is_stmt ? AllowConstBlockItems.No : AllowConstBlockItems.Yes);
      if (r.$ === "Ok" && r._0 === undefined) {
        break;
      } else if (r.$ === "Ok") {
        const item = r._0!;
        if (is_stmt) {
          items.push({ $: "Stmt", _0: ecx.stmt_item(span, item) });
        } else {
          items.push({ $: "Item", _0: item });
        }
      } else {
        const err = r._0;
        err.emit();
        break;
      }
    }

    // fail if there have been errors emitted
    if (ecx.dcx().err_count() > error_count_before) {
      ecx.dcx().emit_err(diagnostics.ProcMacroDeriveTokens_diagnostic({ span }));
    }

    return { $: "Ready", _0: items };
  }
}

type DeriveClient = Client;

// rustc: compiler/rustc_expand/src/proc_macro.rs:161 expand_derive_macro
export function expand_derive_macro(
  invoc_id: LocalExpnId,
  input: TokenStream,
  ecx: ExtCtxt,
  client: DeriveClient,
): Result<TokenStream, undefined> {
  // PORT: see the header; the recorder closure is
  // `|recorder| { let invoc_expn_data = invoc_id.expn_data(); let span = invoc_expn_data.call_site;
  //   let event_arg = invoc_expn_data.kind.descr(); recorder.record_arg_with_span(ecx.sess.source_map(), event_arg, span); }`.
  const _timer = ecx.sess.prof.generic_activity("expand_proc_macro");

  const proc_macro_backtrace = ecx.ecfg.proc_macro_backtrace;
  const strategy = exec_strategy(ecx.sess);
  const server = Rustc.new(ecx);

  const r = client.run1(strategy, server, input, proc_macro_backtrace);
  if (r.$ === "Ok") {
    const stream = r._0;
    return Ok(stream);
  } else {
    const e = r._0;
    const invoc_expn_data = LocalExpnId.expn_data(invoc_id);
    const span = invoc_expn_data.call_site;
    const message = PanicMessage.into_string(e);
    ecx.dcx().emit_err(
      diagnostics.ProcMacroDerivePanicked_diagnostic({
        span,
        message: message === undefined ? undefined : { message },
      }),
    );
    return Err(undefined);
  }
}

export const EXPAND_DERIVE_MACRO_CACHED: AtomicRef<
  (invoc_id: LocalExpnId, input: TokenStream, ecx: ExtCtxt, client: DeriveClient) => Result<TokenStream, undefined>
> = AtomicRef.new((_: LocalExpnId, _1: TokenStream, _2: ExtCtxt, _3: DeriveClient): Result<TokenStream, undefined> => {
  return panic(
    "`EXPAND_DERIVE_MACRO_CACHED` callback was not setup; it must be set in `rustc_interface::callbacks`",
  );
});

// Port of compiler/rustc_session/src/parse.rs.
//! Contains `ParseSess` which holds state living beyond what one `Parser` might.
//! It also serves as an input to the parser itself.
//
// PORT: `Lock<T>` / `AppendOnlyVec<T>` are the inner values (PORTING §5); `FxHashMap`/`FxIndexMap`
// are JS `Map`s (insertion-ordered, keyed by the branded `Symbol` / `Span` numbers).
// PORT: rustc_ast is imported through its lib.ts (recorded decision: extension methods load there).
import { ast, attr } from "../rustc_ast/lib.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { EmitterWithNote, stderr_destination } from "../rustc_errors/emitter.ts";
import {
  type BufferedEarlyLint,
  ColorConfig,
  DecorateDiagCompat,
  type Diag,
  type Diagnostic,
  DiagCtxt,
  type DiagCtxtHandle,
  type Level,
  type MultiSpan,
} from "../rustc_errors/lib.ts";
import { into_MultiSpan, type IntoMultiSpan } from "../rustc_error_messages/lib.ts";
import { type Lint, LintId } from "../rustc_lint_defs/lib.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { ExpnId } from "../rustc_span/hygiene.ts";
import type { Span } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { unwrap } from "../std/panic.ts";
import type { Session } from "./lib.ts";

/// Collected spans during parsing for places where a certain feature was
/// used and should be feature gated accordingly in `check_crate` in `rustc_ast_passes`.
export class GatedSpans {
  constructor(public spans: Map<Symbol, Span[]>) {}

  /** `#[derive(Default)]` */
  static default(): GatedSpans {
    return new GatedSpans(new Map());
  }

  /// Feature gate the given `span` under the given `feature`
  /// which is same `Symbol` used in `unstable.rs`.
  // rustc: compiler/rustc_session/src/parse.rs:35 gate
  gate(feature: Symbol, span: Span): void {
    entry_or_default(this.spans, feature).push(span);
  }

  /// Ungate the last span under the given `feature`.
  /// Panics if the given `span` wasn't the last one.
  ///
  /// Using this is discouraged unless you have a really good reason to.
  // rustc: compiler/rustc_session/src/parse.rs:43 ungate_last
  ungate_last(feature: Symbol, span: Span): void {
    const removed_span = unwrap(entry_or_default(this.spans, feature).pop());
    // debug_assert_eq!(span, removed_span);
  }

  /// Prepend the given set of `spans` onto the set in `self`.
  // rustc: compiler/rustc_session/src/parse.rs:49 merge
  merge(spans: Map<Symbol, Span[]>): void {
    const inner = this.spans;
    // The entries will be moved to another map so the drain order does not
    // matter.
    // #[allow(rustc::potential_query_instability)]
    for (const [gate, gate_spans] of inner) {
      // `.append(&mut gate_spans)`
      entry_or_default(spans, gate).push(...gate_spans);
    }
    inner.clear();
    this.spans = spans;
  }
}

/** `map.entry(key).or_default()` for `Vec` values. */
function entry_or_default<K, V>(map: Map<K, V[]>, key: K): V[] {
  let v = map.get(key);
  if (v === undefined) {
    v = [];
    map.set(key, v);
  }
  return v;
}

export class SymbolGallery {
  constructor(
    /// All symbols occurred and their first occurrence span.
    public symbols: Map<Symbol, Span>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): SymbolGallery {
    return new SymbolGallery(new Map());
  }

  /// Insert a symbol and its span into symbol gallery.
  /// If the symbol has occurred before, ignore the new occurrence.
  // rustc: compiler/rustc_session/src/parse.rs:70 insert
  insert(symbol: Symbol, span: Span): void {
    // `self.symbols.lock().entry(symbol).or_insert(span);`
    if (!this.symbols.has(symbol)) this.symbols.set(symbol, span);
  }
}

/// Info about a parsing session.
// PORT: the private fields `dcx` and `source_map` are `dcx_` / `source_map_`: their accessor methods
// `dcx()` / `source_map()` keep the upstream names (every caller uses the methods).
export class ParseSess {
  constructor(
    public dcx_: DiagCtxt,
    public edition: Edition,
    /// Places where raw identifiers were used. This is used to avoid complaining about idents
    /// clashing with keywords in new editions.
    public raw_identifier_spans: Span[],
    /// Places where identifiers that contain invalid Unicode codepoints but that look like they
    /// should be. Useful to avoid bad tokenization when encountering emoji. We group them to
    /// provide a single error per unique incorrect identifier.
    public bad_unicode_identifiers: Map<Symbol, Span[]>,
    public source_map_: SourceMap,
    public buffered_lints: BufferedEarlyLint[],
    /// Places where *complete* stmt exprs are followed by a token that would've been interpreted as
    /// a binary operator instead of the start of a following stmt or pat *if we weren't in a stmt
    /// expr context*.
    ///
    /// **For error recovery and diagnostic purposes only!**
    ///
    /// Maps from the [`start_point`] of the bin op lookalike to the span of the complete stmt expr
    /// (e.g., block) that could be interpreted as its left operand.
    ///
    /// Examples: Given `fn f() { { dbg!(); } *ptr = 0; }` it maps the span of `*` to the span of
    /// `{ dbg!(); }`; given `fn f() { { true } && panic!(); }` it maps the span of the first `&` to
    /// the span of `{ true }`.
    ///
    /// [`start_point`]: SourceMap::start_point
    public complete_stmt_exprs_before_bin_op_lookalike: Map<Span, Span>,
    public gated_spans: GatedSpans,
    public symbol_gallery: SymbolGallery,
    /// Used to generate new `AttrId`s. Every `AttrId` is unique.
    public attr_id_generator: attr.AttrIdGenerator,
  ) {}

  /// Used for testing.
  // rustc: compiler/rustc_session/src/parse.rs:111 new
  static new(): ParseSess {
    const sm = SourceMap.new(FilePathMapping.empty());
    const emitter = AnnotateSnippetEmitter.sm(AnnotateSnippetEmitter.new(stderr_destination(ColorConfig.Auto)), sm);
    const dcx = DiagCtxt.new(emitter);
    return ParseSess.with_dcx(dcx, sm);
  }

  // rustc: compiler/rustc_session/src/parse.rs:121 with_dcx
  static with_dcx(dcx: DiagCtxt, source_map: SourceMap): ParseSess {
    return new ParseSess(
      dcx,
      ExpnId.root().expn_data().edition,
      [],
      new Map(),
      source_map,
      [],
      new Map(),
      GatedSpans.default(),
      SymbolGallery.default(),
      attr.AttrIdGenerator.new(),
    );
  }

  // rustc: compiler/rustc_session/src/parse.rs:136 emitter_with_note
  static emitter_with_note(note: string): ParseSess {
    const sm = SourceMap.new(FilePathMapping.empty());
    const emitter = AnnotateSnippetEmitter.new(stderr_destination(ColorConfig.Auto));
    const dcx = DiagCtxt.new(new EmitterWithNote(emitter, note));
    return ParseSess.with_dcx(dcx, sm);
  }

  // #[inline]
  // rustc: compiler/rustc_session/src/parse.rs:144 source_map
  source_map(): SourceMap {
    return this.source_map_;
  }

  // PORT: `Arc::clone` -> the same `SourceMap` object.
  // rustc: compiler/rustc_session/src/parse.rs:148 clone_source_map
  clone_source_map(): SourceMap {
    return this.source_map_;
  }

  // PORT: `diagnostic: impl Into<DecorateDiagCompat>` accepts a `DecorateDiagCompat` or any
  // `Diagnostic` (`impl<D: Diagnostic> From<D> for DecorateDiagCompat`).
  // rustc: compiler/rustc_session/src/parse.rs:152 buffer_lint
  buffer_lint(lint: Lint, span: IntoMultiSpan, node_id: NodeId, diagnostic: DecorateDiagCompat | Diagnostic): void {
    this.opt_span_buffer_lint(lint, into_MultiSpan(span), node_id, into_DecorateDiagCompat(diagnostic));
  }

  /// Buffer a crate-level lint. This is used for lints that are associated with command-line
  /// arguments and dependency structure.
  // rustc: compiler/rustc_session/src/parse.rs:164 buffer_crate_lint
  buffer_crate_lint(lint: Lint, diagnostic: DecorateDiagCompat | Diagnostic): void {
    this.opt_span_buffer_lint(lint, undefined, ast.CRATE_NODE_ID, into_DecorateDiagCompat(diagnostic));
  }

  // rustc: compiler/rustc_session/src/parse.rs:172 dyn_buffer_lint
  dyn_buffer_lint(lint: Lint, span: IntoMultiSpan, node_id: NodeId, callback: (dcx: DiagCtxtHandle, level: Level) => Diag): void {
    this.opt_span_buffer_lint(
      lint,
      into_MultiSpan(span),
      node_id,
      new DecorateDiagCompat((dcx, level, _) => callback(dcx, level)),
    );
  }

  // rustc: compiler/rustc_session/src/parse.rs:189 dyn_buffer_lint_sess
  dyn_buffer_lint_sess(
    lint: Lint,
    span: IntoMultiSpan,
    node_id: NodeId,
    callback: (dcx: DiagCtxtHandle, level: Level, sess: Session) => Diag,
  ): void {
    this.opt_span_buffer_lint(
      lint,
      into_MultiSpan(span),
      node_id,
      new DecorateDiagCompat((dcx, level, sess) => {
        // PORT: `sess.downcast_ref::<Session>().expect("expected a `Session`")`: the `&dyn Any` is
        // the `Session` the lint is emitted with (src/rustc_session/lib.ts `Session`, pending
        // session.rs); there is no runtime type to check against until session.rs is ported.
        const sess_ = sess as Session;
        return callback(dcx, level, sess_);
      }),
    );
  }

  // rustc: compiler/rustc_session/src/parse.rs:212 opt_span_buffer_lint
  opt_span_buffer_lint(lint: Lint, span: MultiSpan | undefined, node_id: NodeId, diagnostic: DecorateDiagCompat): void {
    // `self.buffered_lints.with_lock(|buffered_lints| { .. })`
    const buffered_lints = this.buffered_lints;
    buffered_lints.push({
      span,
      node_id,
      lint_id: LintId.of(lint),
      diagnostic,
    });
  }

  // rustc: compiler/rustc_session/src/parse.rs:229 dcx
  dcx(): DiagCtxtHandle {
    return this.dcx_.handle();
  }
}

/** `impl Into<DecorateDiagCompat>`: a `DecorateDiagCompat` itself, or `From<D: Diagnostic>`. */
function into_DecorateDiagCompat(d: DecorateDiagCompat | Diagnostic): DecorateDiagCompat {
  return d instanceof DecorateDiagCompat ? d : DecorateDiagCompat.from(d);
}

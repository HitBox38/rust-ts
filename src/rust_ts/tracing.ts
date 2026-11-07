// rust-ts glue (not an upstream mirror): the part of the `tracing` / `tracing-core` / `tracing-subscriber`
// crates (tracing 0.1.44, tracing-core 0.1.36, tracing-subscriber 0.3.23 at the pin's Cargo.lock) that
// rustc's logger reaches, so that its events and spans print what rustc prints.
//
// What rustc does (rustc_driver_impl `init_rustc_env_logger` → rustc_log `init_logger`, ported in
// src/rustc_log/lib.ts): the global subscriber is
// `Registry::default().with(tracing_tree::HierarchicalLayer..).with(filter)`, where `filter` is
// `EnvFilter::default().add_directive(WARN)` with `RUSTC_LOG` unset (only WARN and ERROR events reach the layer,
// src/rust_ts/tracing_tree.ts, which writes them to stderr) and `EnvFilter::new($RUSTC_LOG)` otherwise (Miri's
// `MIRI_LOG` becomes such a filter, src/miri/bin/log/setup.ts). Without a global subscriber (unit tests, probes that
// never call the logger init) events go nowhere, as with tracing's `NoSubscriber`.
//
// Static max level. rustc builds `tracing` with the `max_level_info` feature (STATIC_MAX_LEVEL = INFO), so every
// `debug!` / `trace!` event and every DEBUG/TRACE span (`#[instrument(level = "debug")]`, `debug_span!`, ...) is
// compiled out: in the port they stay comments. INFO-and-above call sites are live.
//
// Call sites. An upstream `info!(..)` / `warn!(..)` / `error!(..)` (target `module_path!()`) is
//   info("<crate>::<module path>", () => `<message>`, ["<field>", () => <its {:?}>], ...)
// with the exact upstream format string. tracing puts the `message` field first, then the named fields in
// macro order (`valueset_all!`), and records each value with `record_debug` (`{:?}`; a `format_args!`
// message's `Debug` is its `Display`; `?x` is `x`'s `Debug`, `%x` its `Display`). The values are closures:
// tracing formats them only once the event is enabled, inside the layer (tracing-tree's recursion guard
// then drops events emitted while formatting). An `info_span!(name, fields..)` is
//   info_span("<crate>::<module path>", "<name>", ["<field>", () => <its {:?}>], ...)
// (a field set to `tracing::field::Empty` records nothing and is left out). A disabled call costs one comparison
// against `LevelFilter::current()` (MAX_LEVEL below), as tracing's `level_enabled!` does. On hot paths (once per
// interpreted statement) the call site hoists that check, `if (tracing.INFO_ENABLED) tracing.info(..)`, so a disabled
// event allocates nothing.
//
// `#[instrument]` at INFO (the default level) is `instrument(target, "<fn>", () => [<args>], () => <body>, <ret>?)`, the
// span entered for the body; its arguments not skipped are fields, each its `{:?}`.
//
// Every upstream INFO site in a ported fn is live, or is `info_unconverted(target, "<upstream site>")`, which stops with
// `unported` when the filter would record it (its output is not ported yet, so rustc would print lines the port cannot).
// `bun src/rust_ts/info_sites_check.ts` checks that no ported fn misses one.
//
// EnvFilter: the static directives (`target=level`, bare `level`, bare `target`) are ported, with the
// "would enable traces that are disabled statically" warning. Directives with a span name or field filters
// (`target[span{field=value}]=level`) are dynamic filters and stop with `unported`.
import { panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { write_stderr } from "../std/io.ts";

// ---- tracing-core: Level, LevelFilter -------------------------------------------------------------------------------

/** `tracing_core::Level` (metadata.rs). */
export type Level = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

/** `tracing_core::LevelFilter` (metadata.rs): a `Level` or `OFF`. */
export type LevelFilter = Level | "OFF";

/**
 * Verbosity of a `Level` / `LevelFilter` (`LevelFilter` orders OFF < ERROR < WARN < INFO < DEBUG < TRACE, and a
 * filter enables a level when `filter >= level`). The numbers are those `LevelFilter::from_str` accepts.
 */
const VERBOSITY: Record<LevelFilter, number> = { OFF: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4, TRACE: 5 };
const V_INFO = 3;

/** `tracing::level_filters::STATIC_MAX_LEVEL`: rustc's `tracing` has the `max_level_info` feature. */
export const STATIC_MAX_LEVEL: LevelFilter = "INFO";

/** `impl Display for Level` (tracing-core-0.1.36/src/metadata.rs:545): `f.pad("WARN")` etc. (no width here). */
export function display_Level(level: Level): string {
  return level;
}

/** `impl Display for LevelFilter` (tracing-core-0.1.36/src/metadata.rs:757): `f.pad("off")`, `f.pad("error")`, ... */
export function display_LevelFilter(level: LevelFilter): string {
  return level.toLowerCase();
}

/** `usize::from_str`: an optional `+`, then ASCII digits; `undefined` on error (overflow is irrelevant for 0-5). */
function parse_usize(s: string): number | undefined {
  if (!/^\+?[0-9]+$/.test(s)) return undefined;
  const n = Number(s.startsWith("+") ? s.slice(1) : s);
  return n;
}

/** `str::eq_ignore_ascii_case` */
function eq_ignore_ascii_case(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x >= 0x41 && x <= 0x5a) x += 0x20;
    if (y >= 0x41 && y <= 0x5a) y += 0x20;
    if (x !== y) return false;
  }
  return true;
}

/** `impl FromStr for Level` (tracing-core-0.1.36/src/metadata.rs:561); `Err` is `ParseLevelError`. */
export function Level_from_str(s: string): Result<Level, null> {
  const num = parse_usize(s);
  const by_num: Level | undefined = num === 1 ? "ERROR" : num === 2 ? "WARN" : num === 3 ? "INFO" : num === 4 ? "DEBUG" : num === 5 ? "TRACE" : undefined;
  if (by_num !== undefined) return Ok(by_num);
  if (eq_ignore_ascii_case(s, "error")) return Ok("ERROR");
  if (eq_ignore_ascii_case(s, "warn")) return Ok("WARN");
  if (eq_ignore_ascii_case(s, "info")) return Ok("INFO");
  if (eq_ignore_ascii_case(s, "debug")) return Ok("DEBUG");
  if (eq_ignore_ascii_case(s, "trace")) return Ok("TRACE");
  return Err(null);
}

/** `impl FromStr for LevelFilter` (tracing-core-0.1.36/src/metadata.rs:783); `Err` is `ParseLevelFilterError`. */
export function LevelFilter_from_str(from: string): Result<LevelFilter, null> {
  const num = parse_usize(from);
  const by_num: LevelFilter | undefined =
    num === 0 ? "OFF" : num === 1 ? "ERROR" : num === 2 ? "WARN" : num === 3 ? "INFO" : num === 4 ? "DEBUG" : num === 5 ? "TRACE" : undefined;
  if (by_num !== undefined) return Ok(by_num);
  if (from === "") return Ok("ERROR");
  if (eq_ignore_ascii_case(from, "error")) return Ok("ERROR");
  if (eq_ignore_ascii_case(from, "warn")) return Ok("WARN");
  if (eq_ignore_ascii_case(from, "info")) return Ok("INFO");
  if (eq_ignore_ascii_case(from, "debug")) return Ok("DEBUG");
  if (eq_ignore_ascii_case(from, "trace")) return Ok("TRACE");
  if (eq_ignore_ascii_case(from, "off")) return Ok("OFF");
  return Err(null);
}

/** `impl Display for ParseLevelFilterError` (tracing-core-0.1.36/src/metadata.rs:826). */
const PARSE_LEVEL_FILTER_ERROR = 'error parsing level filter: expected one of "off", "error", "warn", "info", "debug", "trace", or a number 0-5';

/** `filter >= level` */
function filter_enables(filter: LevelFilter, level: Level): boolean {
  return VERBOSITY[filter] >= VERBOSITY[level];
}

/**
 * `tracing_subscriber::filter::LevelFilter` as `EnvFilter::default().add_directive(Directive::from(level))`
 * applies it: a static directive with no target matches every callsite whose level is at most as verbose.
 */
export function level_filter_enables(max: Level, level: Level): boolean {
  return filter_enables(max, level);
}

// ---- tracing-core: metadata, fields, events -------------------------------------------------------------------------

/** One recorded field: its name and the `{:?}` of its value, computed when the visitor records it. */
export interface FieldValue {
  readonly name: string;
  readonly debug: () => string;
}

/** `tracing::Event` (metadata: level and target; the fields in `ValueSet` order). Always contextual here. */
export interface Event {
  readonly level: Level;
  readonly target: string;
  readonly fields: readonly FieldValue[];
}

/** `span::Attributes` of a contextual span: its metadata (level, target, name) and the recorded fields. */
export interface Attributes {
  readonly level: Level;
  readonly target: string;
  readonly name: string;
  readonly fields: readonly FieldValue[];
}

/** `span::Id` (non-zero). */
export type SpanId = number;

/** The global subscriber (`Subscriber` methods the macros and `Span` reach). */
export interface Subscriber {
  /** `max_level_hint` (`undefined`: no hint, i.e. TRACE). */
  max_level_hint(): LevelFilter | undefined;
  /** `enabled(metadata)` (the filter), from the callsite's level and target. */
  enabled(level: Level, target: string): boolean;
  new_span(attrs: Attributes): SpanId;
  event(event: Event): void;
  enter(id: SpanId): void;
  exit(id: SpanId): void;
  try_close(id: SpanId): boolean;
}

/** `tracing_core::dispatcher::SetGlobalDefaultError` */
export interface SetGlobalDefaultError {
  readonly _private: null;
}

/** `impl Display for SetGlobalDefaultError` (tracing-core-0.1.36/src/dispatcher.rs:357): `f.pad(Self::MESSAGE)`. */
export function display_SetGlobalDefaultError(_e: SetGlobalDefaultError): string {
  return "a global default trace dispatcher has already been set";
}

/** `GLOBAL_DISPATCH` (set once per process). */
let GLOBAL_DISPATCH: Subscriber | undefined;

/**
 * `MAX_LEVEL` (tracing-core metadata.rs:245, `LevelFilter::current()`) as a verbosity: OFF until a dispatcher is
 * set, then `Callsites::rebuild_interest`'s max of the dispatchers' hints (TRACE without a hint).
 */
let MAX_LEVEL = 0;

/**
 * `level_enabled!(Level::INFO)` (`INFO <= STATIC_MAX_LEVEL && INFO <= LevelFilter::current()`), as a live binding for
 * hot call sites: `if (tracing.INFO_ENABLED) tracing.info(..)` allocates nothing (no closures, no field array) while
 * INFO is off. Kept in sync with MAX_LEVEL.
 */
export let INFO_ENABLED = false;

/** `tracing::subscriber::set_global_default` / `dispatcher::set_global_default` (then `rebuild_interest`). */
export function set_global_default(subscriber: Subscriber): Result<null, SetGlobalDefaultError> {
  if (GLOBAL_DISPATCH !== undefined) return Err({ _private: null });
  GLOBAL_DISPATCH = subscriber;
  MAX_LEVEL = VERBOSITY[subscriber.max_level_hint() ?? "TRACE"];
  INFO_ENABLED = MAX_LEVEL >= V_INFO;
  return Ok(null);
}

/** Test hook: forget the global subscriber (a process sets it once; tests install several in turn). */
export function reset_global_default_for_tests(): void {
  GLOBAL_DISPATCH = undefined;
  MAX_LEVEL = 0;
  INFO_ENABLED = false;
}

/** `LevelFilter::current()` */
export function LevelFilter_current(): LevelFilter {
  return MAX_LEVEL === 0 ? "OFF" : MAX_LEVEL === 1 ? "ERROR" : MAX_LEVEL === 2 ? "WARN" : MAX_LEVEL === 3 ? "INFO" : MAX_LEVEL === 4 ? "DEBUG" : "TRACE";
}

/**
 * `event!(target: target, level, { message = format_args!(..), fields.. })`: dispatch to the global subscriber if
 * it enables the callsite. PORT: the callsite interest cache is subsumed by the subscriber's `enabled` (both come
 * from the same static directives, `EnvFilter::register_callsite`).
 */
export function event(level: Level, target: string, message: (() => string) | undefined, fields: readonly (readonly [string, () => string])[]): void {
  // `level_enabled!(level)`: `level <= STATIC_MAX_LEVEL && level <= LevelFilter::current()`
  if (VERBOSITY[level] > MAX_LEVEL) return;
  const dispatch = GLOBAL_DISPATCH;
  if (dispatch === undefined || !dispatch.enabled(level, target)) return;
  // An event without a format string (`event!(level, return = ?x)`) has no `message` field.
  const named = fields.map(([name, debug]) => ({ name, debug }));
  dispatch.event({
    level,
    target,
    fields: message === undefined ? named : [{ name: "message", debug: message }, ...named],
  });
}

/** `info!(..)` with target `target` (the call site's `module_path!()`). */
export function info(target: string, message: () => string, ...fields: (readonly [string, () => string])[]): void {
  if (MAX_LEVEL < V_INFO) return;
  event("INFO", target, message, fields);
}

/** `warn!(..)` with target `target` (the call site's `module_path!()`). */
export function warn(target: string, message: () => string, ...fields: (readonly [string, () => string])[]): void {
  event("WARN", target, message, fields);
}

/** `error!(..)` with target `target` (the call site's `module_path!()`). */
export function error(target: string, message: () => string, ...fields: (readonly [string, () => string])[]): void {
  event("ERROR", target, message, fields);
}

// ---- tracing: Span --------------------------------------------------------------------------------------------------

/**
 * `tracing::Span`: `inner` is `Some(Inner { id, subscriber })` for an enabled span, `None` for a disabled one
 * (`Span::none()` / `Span::new_disabled`). PORT: `impl Drop for Span` is `drop()`, called where upstream drops it.
 */
export class Span {
  constructor(
    public inner: { readonly id: SpanId; readonly subscriber: Subscriber } | undefined,
  ) {}

  /** `Span::none()` (shared: a disabled span is never mutated, `drop` only clears an enabled one). */
  static none(): Span {
    return SPAN_NONE;
  }

  /** `Span::with_subscriber`: `f((id, dispatch))` if the span is enabled. */
  with_subscriber<T>(f: (id: SpanId, dispatch: Subscriber) => T): T | undefined {
    const inner = this.inner;
    return inner === undefined ? undefined : f(inner.id, inner.subscriber);
  }

  /** `impl Drop for Span` (tracing-0.1.44/src/span.rs): `subscriber.try_close(id)` of an enabled span. */
  drop(): void {
    const inner = this.inner;
    if (inner !== undefined) {
      this.inner = undefined;
      inner.subscriber.try_close(inner.id);
    }
  }
}

const SPAN_NONE = new Span(undefined);

/** `span!(target: target, level, name, fields..)` */
export function span(level: Level, target: string, name: string, fields: readonly (readonly [string, () => string])[]): Span {
  // `level_enabled!(level) && interest is not never && CALLSITE.is_enabled(interest)`
  if (VERBOSITY[level] > MAX_LEVEL) return Span.none();
  const dispatch = GLOBAL_DISPATCH;
  if (dispatch === undefined || !dispatch.enabled(level, target)) return Span.none();
  // `Span::new(meta, &valueset)` → `Span::make_with(meta, Attributes::new(meta, values), dispatch)`
  const id = dispatch.new_span({ level, target, name, fields: fields.map(([n, debug]) => ({ name: n, debug })) });
  return new Span({ id, subscriber: dispatch });
}

/** `info_span!(target: target, name, fields..)` */
export function info_span(target: string, name: string, ...fields: (readonly [string, () => string])[]): Span {
  if (MAX_LEVEL < V_INFO) return Span.none();
  return span("INFO", target, name, fields);
}

/**
 * A fn under `#[instrument]` at INFO (tracing-attributes-0.1.31 src/expand.rs `gen_block`, sync, no `err`): when
 * `level_enabled!(INFO)`, `span!(target: module_path!(), INFO, "<fn name>", <arg> = debug(&<arg>), ..)` is made and
 * entered for the whole body; with `ret`, `event!(target: module_path!(), INFO, return = ?x)` follows the body inside
 * the span. The guard's drop exits the span, then the span's drop closes it, on return or unwind.
 * `fields()` gives the arguments not skipped, in parameter order, each as its `{:?}` (a thunk: a disabled call allocates no array) (`RecordType::Value` arguments,
 * integers, `bool`, `str`, ..., need their own care at the call site).
 */
export function instrument<T>(
  target: string,
  name: string,
  fields: () => readonly (readonly [string, () => string])[],
  body: () => T,
  ret?: (x: T) => string,
): T {
  if (MAX_LEVEL < V_INFO) return body();
  const span = info_span(target, name, ...fields());
  span.with_subscriber((id, dispatch) => dispatch.enter(id));
  try {
    const x = body();
    if (ret !== undefined) event("INFO", target, undefined, [["return", () => ret(x)]]);
    return x;
  } finally {
    span.with_subscriber((id, dispatch) => dispatch.exit(id));
    span.drop();
  }
}

/** rust-ts (not upstream): on a `fold_Binder(d)` descriptor (src/rustc_type_ir/binder.ts), the descriptor `d` of `T` it was
 *  made from. A fn under `#[instrument]` that is generic over `T: Debug` finds `T`'s `{:?}` through it
 *  (src/rustc_trait_selection/traits/normalize.ts `debug_of_foldable`). */
export const BINDER_INNER: unique symbol = Symbol("fold_Binder inner descriptor");
/** rust-ts (not upstream): on a `fold_tuple2` / `fold_tuple3` descriptor (src/rustc_type_ir/fold.ts), its parts' descriptors. */
export const TUPLE_PARTS: unique symbol = Symbol("fold_tuple parts");

/** rust-ts (not upstream): `T`'s `{:?}` for a generic fn under `#[instrument]` whose `T` reaches it as a descriptor (a
 *  `TypeFoldable`'s `fold_with`, src/rustc_trait_selection/traits/normalize.ts). Keyed on the function's identity. */
const REGISTERED_DEBUG = new Map<unknown, (v: never, f: { readonly alternate: boolean }) => string>();
export function register_debug<T>(key: unknown, debug: (v: T, f: { readonly alternate: boolean }) => string): void {
  REGISTERED_DEBUG.set(key, debug as (v: never, f: { readonly alternate: boolean }) => string);
}
export function registered_debug<T>(key: unknown): ((v: T, f: { readonly alternate: boolean }) => string) | undefined {
  return REGISTERED_DEBUG.get(key) as ((v: T, f: { readonly alternate: boolean }) => string) | undefined;
}

/** rust-ts (not upstream): `std::any::type_name::<T>()` in the oracle's binary, for `T` reached as a descriptor, keyed as
 *  `register_debug` is. Only names read off upstream's definitions are registered. */
const REGISTERED_TYPE_NAME = new Map<unknown, string>();
export function register_type_name(key: unknown, name: string): void {
  REGISTERED_TYPE_NAME.set(key, name);
}
export function registered_type_name(key: unknown): string | undefined {
  return REGISTERED_TYPE_NAME.get(key);
}

/**
 * rust-ts (not upstream): an upstream INFO-level site (`info!`, `info_span!`, `#[instrument]` at INFO) whose output
 * is not converted yet. If the global subscriber would record an INFO callsite of `target` here, it stops with
 * `unported` rather than print fewer lines than rustc; otherwise it does nothing, as the disabled site does upstream.
 * `site` names the upstream line (`compiler/<crate>/src/<path>.rs:<line>`) and what it lacks.
 */
export function info_unconverted(target: string, site: string): void {
  if (MAX_LEVEL < V_INFO) return;
  const dispatch = GLOBAL_DISPATCH;
  if (dispatch === undefined || !dispatch.enabled("INFO", target)) return;
  unported(`tracing INFO site not converted: ${site} (target \`${target}\`, enabled by RUSTC_LOG/MIRI_LOG)`);
}

// ---- tracing-subscriber: EnvFilter (static directives) --------------------------------------------------------------

/** `filter::directive::ParseError` (its Display). */
export interface ParseError {
  readonly display: string;
}

/**
 * `filter::env::directive::Directive`. `in_span` and `fields` are kept for `is_dynamic` (dynamic directives are
 * unported, see `EnvFilter.from_directives`).
 */
export class Directive {
  constructor(
    public in_span: string | undefined,
    public fields: string[],
    public target: string | undefined,
    public level: LevelFilter,
  ) {}

  /** `impl From<LevelFilter> for Directive` */
  static from(level: LevelFilter): Directive {
    return new Directive(undefined, [], undefined, level);
  }

  /** `Directive::is_dynamic` */
  is_dynamic(): boolean {
    return this.in_span !== undefined || this.fields.length !== 0;
  }

  /** `Directive::to_static` (for a non-dynamic directive). */
  to_static(): StaticDirective {
    return new StaticDirective(this.target, [], this.level);
  }

  /** `Directive::parse(from, regex)` (tracing-subscriber-0.3.23/src/filter/env/directive.rs). */
  static parse(from: string, _regex: boolean): Result<Directive, ParseError> {
    const cur = new Directive(undefined, [], undefined, "TRACE");
    type ParseState =
      | { $: "Start" }
      | { $: "LevelOrTarget"; start: number }
      | { $: "Span"; span_start: number }
      | { $: "Field"; field_start: number }
      | { $: "Fields" }
      | { $: "Target" }
      | { $: "Level"; level_start: number }
      | { $: "Complete" };
    // PORT: byte offsets of `from.trim()`'s chars index `from` itself, as upstream does (`from[start..i]`).
    const bytes = Buffer.from(from, "utf8");
    const slice = (a: number, b?: number): string => bytes.subarray(a, b).toString("utf8");
    const level_from = (s: string): Result<LevelFilter, ParseError> => {
      const r = LevelFilter_from_str(s);
      return r.$ === "Ok" ? r : Err({ display: PARSE_LEVEL_FILTER_ERROR });
    };
    const other = (): Result<Directive, ParseError> => Err({ display: "invalid filter directive" });
    const level_or_target = (start: number): void => {
      const s = slice(start);
      if (s === "") {
        cur.level = "TRACE";
        cur.target = undefined;
      } else {
        const l = LevelFilter_from_str(s);
        if (l.$ === "Ok") {
          cur.level = l._0;
          cur.target = undefined;
        } else {
          // Setting the target without the level enables every level for that target
          cur.level = "TRACE";
          cur.target = s;
        }
      }
    };
    let state = { $: "Start" } as ParseState;
    for (const [i, c] of char_indices(from.trim())) {
      switch (state.$) {
        case "Start":
          if (c === "[") state = { $: "Span", span_start: i + 1 };
          else if (!["-", ":", "_"].includes(c) && !/^[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}]$/u.test(c)) return other();
          else state = { $: "LevelOrTarget", start: i };
          break;
        case "LevelOrTarget":
          if (c === "=") {
            cur.target = slice(state.start, i);
            state = { $: "Level", level_start: i + 1 };
          } else if (c === "[") {
            cur.target = slice(state.start, i);
            state = { $: "Span", span_start: i + 1 };
          } else if (c === ",") {
            level_or_target(state.start);
            state = { $: "Complete" };
          }
          break;
        case "Target":
          if (c === "=") state = { $: "Level", level_start: i + 1 };
          else return other();
          break;
        case "Span":
          if (c === "]") {
            cur.in_span = slice(state.span_start, i);
            state = { $: "Target" };
          } else if (c === "{") {
            const s = slice(state.span_start, i);
            cur.in_span = s === "" ? undefined : s;
            state = { $: "Field", field_start: i + 1 };
          }
          break;
        case "Field":
          if (c === "}" || c === ",") {
            const field = slice(state.field_start, i);
            if (field === "") return other();
            // `field::Match::parse(field, regex)?`
            return unported("tracing_subscriber::filter::env::field::Match::parse (a field filter in RUSTC_LOG / MIRI_LOG)");
          }
          break;
        case "Fields":
          if (c === "]") state = { $: "Target" };
          else return other();
          break;
        case "Level":
          if (c === ",") {
            const s = slice(state.level_start, i);
            if (s === "") cur.level = "TRACE";
            else {
              const l = level_from(s);
              if (l.$ === "Err") return l;
              cur.level = l._0;
            }
            state = { $: "Complete" };
          }
          break;
        case "Complete":
          return other();
      }
    }
    switch (state.$) {
      case "LevelOrTarget":
        level_or_target(state.start);
        break;
      case "Level": {
        const s = slice(state.level_start);
        if (s === "") cur.level = "TRACE";
        else {
          const l = level_from(s);
          if (l.$ === "Err") return l;
          cur.level = l._0;
        }
        break;
      }
      case "Target":
      case "Complete":
        break;
      default:
        return other();
    }
    return Ok(cur);
  }

  /** `impl Display for Directive` (span names and fields: dynamic, unported before display is reached). */
  display(): string {
    let s = "";
    let wrote_any = false;
    if (this.target !== undefined) {
      s += this.target;
      wrote_any = true;
    }
    if (this.in_span !== undefined || this.fields.length !== 0) {
      s += `[${this.in_span ?? ""}`;
      if (this.fields.length !== 0) s += `{${this.fields.join(",")}}`;
      s += "]";
      wrote_any = true;
    }
    if (wrote_any) s += "=";
    return s + display_LevelFilter(this.level);
  }
}

/** `str::char_indices` (byte offset, char). */
function* char_indices(s: string): Generator<[number, string]> {
  let off = 0;
  for (const c of s) {
    yield [off, c];
    const cp = c.codePointAt(0)!;
    off += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
}

/** `filter::directive::StaticDirective` (field names only come with dynamic directives here). */
export class StaticDirective {
  constructor(
    readonly target: string | undefined,
    readonly field_names: readonly string[],
    readonly level: LevelFilter,
  ) {}

  /** `impl Match for StaticDirective`: `cares_about` (no field names, see the class doc). */
  cares_about(target: string): boolean {
    // Does this directive have a target filter, and does it match the
    // metadata's target?
    if (this.target !== undefined) {
      if (!target.startsWith(this.target)) {
        return false;
      }
    }
    return true;
  }

  /** `impl Ord for StaticDirective`: most specific first (longer target, then lexicographic, reversed). */
  static cmp(a: StaticDirective, b: StaticDirective): number {
    const la = a.target === undefined ? -1 : Buffer.byteLength(a.target);
    const lb = b.target === undefined ? -1 : Buffer.byteLength(b.target);
    let ord = la < lb ? -1 : la > lb ? 1 : 0;
    if (ord === 0) {
      // `Option<String>` order: `None` < `Some`, then byte order.
      if (a.target !== b.target) {
        if (a.target === undefined) ord = -1;
        else if (b.target === undefined) ord = 1;
        else ord = Buffer.compare(Buffer.from(a.target), Buffer.from(b.target));
      }
    }
    return -ord;
  }
}

/** `DirectiveSet<StaticDirective>` (`Statics`). */
class Statics {
  readonly directives: StaticDirective[] = [];
  max_level: LevelFilter = "OFF";

  /** `DirectiveSet::add`: keep the directives ordered by specificity; an equal one is replaced. */
  add(directive: StaticDirective): void {
    // does this directive enable a more verbose level than the current
    // max? if so, update the max level.
    if (VERBOSITY[directive.level] > VERBOSITY[this.max_level]) {
      this.max_level = directive.level;
    }
    // `binary_search`
    let lo = 0;
    let hi = this.directives.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = StaticDirective.cmp(this.directives[mid]!, directive);
      if (c === 0) {
        this.directives[mid] = directive;
        return;
      }
      if (c < 0) lo = mid + 1;
      else hi = mid;
    }
    this.directives.splice(lo, 0, directive);
  }

  /** `DirectiveSet<StaticDirective>::enabled`: the most specific directive that cares decides. */
  enabled(level: Level, target: string): boolean {
    for (const d of this.directives) {
      if (d.cares_about(target)) return filter_enables(d.level, level);
    }
    return false;
  }
}

/** `nu_ansi_term` painting for the EnvFilter warning (`ESC [ codes m` .. `ESC [0m`). */
function paint_codes(codes: string, text: string): string {
  return `\x1B[${codes}m${text}\x1B[0m`;
}

/** `eprintln!` (unbuffered stderr; errors are ignored like a closed stderr would panic, which never happens here). */
function eprintln(s: string): void {
  write_stderr(`${s}\n`);
}

/**
 * `tracing_subscriber::filter::EnvFilter` with static directives only. PORT: dynamic directives (span names, field
 * filters) are unported, so `dynamics` is always empty, `has_dynamics` false and the span callbacks
 * (`on_new_span` / `on_enter` / `on_exit` / `on_close` / `on_record`) do nothing; `regex` is irrelevant without
 * field filters.
 */
export class EnvFilter {
  readonly statics = new Statics();

  /** `EnvFilter::new(directives)`: `Builder::default().with_default_directive(ERROR).parse_lossy(directives)` */
  static new(dirs: string): EnvFilter {
    const builder = { regex: true, default_directive: Directive.from("ERROR") as Directive | undefined };
    // `Builder::parse_lossy`
    const directives: Directive[] = [];
    for (const s of dirs.split(",")) {
      if (s === "") continue;
      const d = Directive.parse(s, builder.regex);
      if (d.$ === "Ok") directives.push(d._0);
      else eprintln(`ignoring \`${s}\`: ${d._0.display}`);
    }
    return EnvFilter.from_directives(directives, builder.default_directive);
  }

  /** `impl Default for EnvFilter`: `Builder::default().from_directives(empty())` */
  static default(): EnvFilter {
    return EnvFilter.from_directives([], undefined);
  }

  /** `Builder::from_directives` (tracing-subscriber-0.3.23/src/filter/env/builder.rs). */
  static from_directives(directives: Directive[], default_directive: Directive | undefined): EnvFilter {
    const disabled: Directive[] = [];
    for (const directive of directives) {
      if (VERBOSITY[directive.level] > VERBOSITY[STATIC_MAX_LEVEL]) {
        disabled.push(directive);
      }
      // `if !self.regex { directive.deregexify(); }`: no field filters here.
    }

    if (disabled.length !== 0) {
      // (`nu-ansi-term` is enabled: tracing-subscriber's `ansi` feature.)
      const warn = (msg: string): void => {
        eprintln(`${paint_codes("1;33", "warning")}${paint_codes("1", ":")} ${paint_codes("1", msg)}`);
      };
      const ctx_prefixed = (prefix: string, msg: string): void => {
        eprintln(` ${paint_codes("1;38;5;21", "=")} ${paint_codes("1", prefix)} ${msg}`);
      };
      const ctx_help = (msg: string): void => ctx_prefixed("help:", msg);
      const ctx_note = (msg: string): void => ctx_prefixed("note:", msg);
      const ctx = (msg: string): void => {
        eprintln(` ${paint_codes("1;38;5;21", "|")} ${msg}`);
      };
      warn("some trace filter directives would enable traces that are disabled statically");
      for (const directive of disabled) {
        const target = directive.target !== undefined ? `the \`${directive.target}\` target` : "all targets";
        // `directive.level.into_level().expect(..)`: never OFF here (OFF is not above the static max).
        const level = directive.level as Level;
        ctx(`\`${directive.display()}\` would enable the ${display_Level(level)} level for ${target}`);
      }
      ctx_note(`the static max level is \`${display_LevelFilter(STATIC_MAX_LEVEL)}\``);
      // `help_msg()` for STATIC_MAX_LEVEL = INFO: ("max_level_info", Level::DEBUG)
      const feature = "max_level_info";
      const earlier_level = `${display_Level("DEBUG")} `;
      ctx_help(`to enable ${earlier_level}logging, remove the \`${feature}\` feature from the \`tracing\` crate`);
    }

    // `Directive::make_tables(directives)`
    if (directives.some((d) => d.is_dynamic())) {
      return unported("tracing_subscriber::filter::EnvFilter dynamic directives (a span name or field filter in RUSTC_LOG / MIRI_LOG)");
    }
    let filter = new EnvFilter();
    for (const d of directives) filter.statics.add(d.to_static());
    if (filter.statics.directives.length === 0) {
      if (default_directive !== undefined) {
        filter = filter.add_directive(default_directive);
      }
    }
    return filter;
  }

  /** `EnvFilter::add_directive` (a static directive). */
  add_directive(directive: Directive): this {
    if (directive.is_dynamic()) {
      return unported("tracing_subscriber::filter::EnvFilter::add_directive (a dynamic directive)");
    }
    this.statics.add(directive.to_static());
    return this;
  }

  /** `EnvFilter::enabled` (no dynamics): the static directives. */
  enabled(level: Level, target: string): boolean {
    // is it possible for a static filter directive to enable this event?
    if (filter_enables(this.statics.max_level, level)) {
      // Otherwise, fall back to checking if the callsite is
      // statically enabled.
      return this.statics.enabled(level, target);
    }
    return false;
  }

  /** `EnvFilter::max_level_hint` (no dynamics: `max(statics.max_level, OFF)`). */
  max_level_hint(): LevelFilter {
    return this.statics.max_level;
  }
}

// ---- tracing-subscriber: Registry, Layer, Context -------------------------------------------------------------------

/** `registry::sharded::DataInner`: a span's metadata, parent, ref count and extensions. */
export interface SpanData {
  readonly attrs: Attributes;
  parent: SpanId | undefined;
  ref_count: number;
  /** `Extensions`: one value per type (keyed by the layer's own name for it). */
  readonly extensions: Map<string, unknown>;
}

/** `registry::stack::ContextId` */
interface ContextId {
  readonly id: SpanId;
  readonly duplicate: boolean;
}

/** `registry::stack::SpanStack` (rust-ts is one thread: one stack). */
class SpanStack {
  readonly stack: ContextId[] = [];

  push(id: SpanId): void {
    const duplicate = this.stack.some((i) => i.id === id);
    this.stack.push({ id, duplicate });
  }

  pop(expected_id: SpanId): boolean {
    for (let idx = this.stack.length - 1; idx >= 0; idx--) {
      if (this.stack[idx]!.id === expected_id) {
        const { duplicate } = this.stack.splice(idx, 1)[0]!;
        return !duplicate;
      }
    }
    return false;
  }

  current(): SpanId | undefined {
    for (let idx = this.stack.length - 1; idx >= 0; idx--) {
      const c = this.stack[idx]!;
      if (!c.duplicate) return c.id;
    }
    return undefined;
  }
}

/**
 * `tracing_subscriber::Registry`: span storage and the current-span stack. PORT: ids come from a counter instead of
 * sharded-slab slots (they are never printed; a freed id is never reused, which only differs in the id value).
 */
export class Registry {
  readonly spans = new Map<SpanId, SpanData>();
  next_id = 1;
  readonly current_spans = new SpanStack();
  close_count = 0;

  /** `Registry::new_span` for a contextual span: its parent is the current span (cloned). */
  new_span(attrs: Attributes): SpanId {
    const cur = this.current_spans.current();
    const parent = cur !== undefined && this.spans.has(cur) ? this.clone_span(cur) : undefined;
    const id = this.next_id++;
    this.spans.set(id, { attrs, parent, ref_count: 1, extensions: new Map() });
    return id;
  }

  enter(id: SpanId): void {
    this.current_spans.push(id);
  }

  exit(id: SpanId): void {
    this.current_spans.pop(id);
  }

  clone_span(id: SpanId): SpanId {
    const span = this.spans.get(id);
    if (span === undefined) panic(`tried to clone Id(${id}), but no span exists with that ID`);
    span.ref_count += 1;
    return id;
  }

  current_span(): SpanId | undefined {
    const id = this.current_spans.current();
    return id !== undefined && this.spans.has(id) ? id : undefined;
  }

  /** `Registry::try_close`: drop one ref; `true` if it was the last. */
  try_close(id: SpanId): boolean {
    const span = this.spans.get(id);
    if (span === undefined) panic(`tried to drop a ref to Id(${id}), but no such span exists!`);
    const refs = span.ref_count;
    span.ref_count = refs - 1;
    return !(refs > 1);
  }

  /** `SpanRef` of `id` */
  span(id: SpanId): SpanRef | undefined {
    const data = this.spans.get(id);
    return data === undefined ? undefined : new SpanRef(this, id, data);
  }
}

/** `registry::SpanRef` */
export class SpanRef {
  constructor(
    readonly registry: Registry,
    readonly id: SpanId,
    readonly data: SpanData,
  ) {}

  get extensions(): Map<string, unknown> {
    return this.data.extensions;
  }

  metadata(): Attributes {
    return this.data.attrs;
  }

  parent(): SpanRef | undefined {
    const p = this.data.parent;
    return p === undefined ? undefined : this.registry.span(p);
  }

  /** `SpanRef::scope()`: this span, then its parents, leaf first. */
  scope(): SpanRef[] {
    const out: SpanRef[] = [];
    for (let s: SpanRef | undefined = this; s !== undefined; s = s.parent()) out.push(s);
    return out;
  }

  /** `scope().from_root()` */
  scope_from_root(): SpanRef[] {
    return this.scope().reverse();
  }
}

/** `layer::Context` over the registry (no per-layer filters: every span is enabled for every layer). */
export class Context {
  constructor(readonly registry: Registry) {}

  /** `Context::current_span` + `span(id)` */
  current_span(): SpanRef | undefined {
    const id = this.registry.current_span();
    return id === undefined ? undefined : this.registry.span(id);
  }

  span(id: SpanId): SpanRef | undefined {
    return this.registry.span(id);
  }

  /** `Context::event_scope(event)` for a contextual event: the current span's scope, leaf first. */
  event_scope(_event: Event): SpanRef[] | undefined {
    return this.current_span()?.scope();
  }
}

/** A layer of the subscriber stack. */
export interface Layer {
  on_new_span?(attrs: Attributes, id: SpanId, ctx: Context): void;
  on_event(event: Event, ctx: Context): void;
  on_close?(id: SpanId, ctx: Context): void;
}

/**
 * `Registry::default().with(layer)[.with(backtrace layer)].with(filter)`: `filter` is a global filter (the last
 * layer), so a disabled event or span reaches no layer; enabled ones go to the layers in order (innermost first).
 * PORT: `max_level_hint` is the filter's (`Layered::pick_level_hint`: the layers below give no hint).
 */
export class LayeredSubscriber implements Subscriber {
  readonly registry = new Registry();
  readonly ctx = new Context(this.registry);

  constructor(
    readonly layers: readonly Layer[],
    readonly filter: EnvFilter,
  ) {}

  /** The default rustc filter as a subscriber filter: `EnvFilter::default().add_directive(Directive::from(level))`. */
  static with_level(layers: readonly Layer[], level: LevelFilter): LayeredSubscriber {
    return new LayeredSubscriber(layers, EnvFilter.default().add_directive(Directive.from(level)));
  }

  max_level_hint(): LevelFilter | undefined {
    return this.filter.max_level_hint();
  }

  enabled(level: Level, target: string): boolean {
    return this.filter.enabled(level, target);
  }

  new_span(attrs: Attributes): SpanId {
    const id = this.registry.new_span(attrs);
    for (const layer of this.layers) layer.on_new_span?.(attrs, id, this.ctx);
    return id;
  }

  event(event: Event): void {
    for (const layer of this.layers) layer.on_event(event, this.ctx);
  }

  enter(id: SpanId): void {
    this.registry.enter(id);
  }

  exit(id: SpanId): void {
    this.registry.exit(id);
  }

  /**
   * `Layered::try_close` with the registry's `CloseGuard`: on the last ref the layers' `on_close` run, then (when the
   * outermost guard drops) the span is cleared, which drops its ref on the parent through the global dispatcher.
   */
  try_close(id: SpanId): boolean {
    const registry = this.registry;
    registry.close_count += 1;
    let is_closing = false;
    let closed = false;
    try {
      if (registry.try_close(id)) {
        is_closing = true;
        for (const layer of this.layers) layer.on_close?.(id, this.ctx);
        closed = true;
      }
    } finally {
      // `impl Drop for CloseGuard`
      const c = registry.close_count;
      registry.close_count = c - 1;
      if (c === 1 && is_closing) {
        // `spans.clear(idx)` → `DataInner::clear`
        const data = registry.spans.get(id);
        registry.spans.delete(id);
        const parent = data?.parent;
        if (data !== undefined && parent !== undefined) {
          data.parent = undefined;
          (GLOBAL_DISPATCH ?? this).try_close(parent);
        }
      }
    }
    return closed;
  }
}

// rust-ts glue (not an upstream mirror): the part of the `tracing` / `tracing-core` / `tracing-subscriber`
// crates (tracing 0.1.44, tracing-core 0.1.36, tracing-subscriber 0.3.23 at the pin's Cargo.lock) that
// rustc's default logger reaches, so that `warn!` / `error!` events print what rustc prints.
//
// What rustc does (rustc_driver_impl `init_rustc_env_logger` → rustc_log `init_logger`, ported in
// src/rustc_log/lib.ts): with `RUSTC_LOG` unset the global subscriber is
// `Registry::default().with(tracing_tree::HierarchicalLayer..).with(EnvFilter::default().add_directive(WARN))`,
// so only WARN and ERROR events reach the layer (src/rust_ts/tracing_tree.ts), which writes them to stderr.
// Without a global subscriber (unit tests, probes that never call the logger init) events go nowhere,
// as with tracing's `NoSubscriber`.
//
// Call sites. An upstream `warn!(..)` / `error!(..)` / `tracing::warn!(..)` (target `module_path!()`) is
//   warn("<crate>::<module path>", () => `<message>`, ["<field>", () => <its {:?}>], ...)
// with the exact upstream format string. tracing puts the `message` field first, then the named fields in
// macro order (`valueset_all!`), and records each value with `record_debug` (`{:?}`; a `format_args!`
// message's `Debug` is its `Display`; `?x` is `x`'s `Debug`, `%x` its `Display`). The values are closures:
// tracing formats them only once the event is enabled, inside the layer (tracing-tree's recursion guard
// then drops events emitted while formatting). `debug!` / `trace!` / `info!` and `#[instrument]` spans stay
// comments in the port: the default filter disables them (no span at WARN or above exists upstream, so an
// event never has a span context).
import { Err, Ok, type Result } from "../std/result.ts";

/** `tracing_core::Level` (metadata.rs). */
export type Level = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

/** `Level`'s verbosity order (`LevelInner`: TRACE = 0 .. ERROR = 4; `LevelFilter` compares inverted). */
const LEVEL_RANK: Record<Level, number> = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };

/** `impl Display for Level` (tracing-core-0.1.36/src/metadata.rs:545): `f.pad("WARN")` etc. (no width here). */
export function display_Level(level: Level): string {
  return level;
}

/** One recorded field: its name and the `{:?}` of its value, computed when the visitor records it. */
export interface FieldValue {
  readonly name: string;
  readonly debug: () => string;
}

/** `tracing::Event` (metadata: level and target; the fields in `ValueSet` order). */
export interface Event {
  readonly level: Level;
  readonly target: string;
  readonly fields: readonly FieldValue[];
}

/** The global subscriber: `enabled` (the filter) and `event` (the layers). */
export interface Subscriber {
  enabled(level: Level, target: string): boolean;
  event(event: Event): void;
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

/** `tracing::subscriber::set_global_default` / `dispatcher::set_global_default`. */
export function set_global_default(subscriber: Subscriber): Result<null, SetGlobalDefaultError> {
  if (GLOBAL_DISPATCH !== undefined) return Err({ _private: null });
  GLOBAL_DISPATCH = subscriber;
  return Ok(null);
}

/** Test hook: forget the global subscriber (a process sets it once; tests install several in turn). */
export function reset_global_default_for_tests(): void {
  GLOBAL_DISPATCH = undefined;
}

/**
 * `event!(target: target, level, { message = format_args!(..), fields.. })`: dispatch to the global subscriber if
 * it enables the callsite. PORT: `level_enabled!` (STATIC_MAX_LEVEL; rustc builds with `max_level_info`) and the
 * callsite interest cache are subsumed by the subscriber's `enabled`; both only ever disable DEBUG/TRACE here.
 */
export function event(level: Level, target: string, message: () => string, fields: readonly (readonly [string, () => string])[]): void {
  const dispatch = GLOBAL_DISPATCH;
  if (dispatch === undefined || !dispatch.enabled(level, target)) return;
  dispatch.event({
    level,
    target,
    fields: [{ name: "message", debug: message }, ...fields.map(([name, debug]) => ({ name, debug }))],
  });
}

/** `warn!(..)` with target `target` (the call site's `module_path!()`). */
export function warn(target: string, message: () => string, ...fields: (readonly [string, () => string])[]): void {
  event("WARN", target, message, fields);
}

/** `error!(..)` with target `target` (the call site's `module_path!()`). */
export function error(target: string, message: () => string, ...fields: (readonly [string, () => string])[]): void {
  event("ERROR", target, message, fields);
}

/**
 * `tracing_subscriber::filter::LevelFilter` as `EnvFilter::default().add_directive(Directive::from(level))`
 * applies it: a static directive with no target matches every callsite whose level is at most as verbose.
 */
export function level_filter_enables(max: Level, level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[max];
}

/** A layer of the subscriber stack (`Layer::on_event`). */
export interface Layer {
  on_event(event: Event): void;
}

/**
 * `Registry::default().with(layer)[.with(backtrace layer)].with(filter)`: `filter` is a global filter (the last
 * layer), so a disabled event reaches no layer; enabled ones go to the layers in order.
 */
export class LayeredSubscriber implements Subscriber {
  constructor(
    readonly layers: readonly Layer[],
    readonly max_level: Level,
  ) {}

  enabled(level: Level, _target: string): boolean {
    return level_filter_enables(this.max_level, level);
  }

  event(event: Event): void {
    for (const layer of this.layers) layer.on_event(event);
  }
}

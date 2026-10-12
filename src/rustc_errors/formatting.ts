// Port of compiler/rustc_errors/src/formatting.rs.
//
// PORT: Fluent (`fluent_bundle::FluentResource`, `FluentBundle`, `FluentArgs`) is an external crate
// that is not vendored yet, so formatting a `DiagMessage::Inline` calls `unported(...)`.
// `DiagMessage::Str` messages format exactly.
import {
  type DiagArg,
  type DiagArgMap,
  type DiagArgName,
  type DiagMessage,
  type IntoDiagArg,
} from "../rustc_error_messages/lib.ts";
import { panic as panic_, unported } from "../std/panic.ts";
import { EagerDiagMessageBuilder } from "./formatting.gen.ts";
import type { Style } from "./lib.gen.ts";

export * from "./formatting.gen.ts";

/** PORT: opaque stand-in for `fluent_bundle::FluentArgs<'static>` (crate not vendored). */
export interface FluentArgs {
  readonly __fluent_args: never;
}

/// Convert diagnostic arguments (a rustc internal type that exists to implement
/// `Encodable`/`Decodable`) into `FluentArgs` which is necessary to perform formatting.
// rustc: compiler/rustc_errors/src/formatting.rs:12 to_fluent_args
function to_fluent_args(_iter: Iterable<DiagArg>): FluentArgs {
  // let mut args = if let Some(size) = iter.size_hint().1 { FluentArgs::with_capacity(size) } else { FluentArgs::new() };
  // for (k, v) in iter { args.set(k.clone(), v.clone()); }
  return unported("fluent_bundle::FluentArgs (rustc_errors::formatting::to_fluent_args)");
}

/// Convert `DiagMessage`s to a string
// rustc: compiler/rustc_errors/src/formatting.rs:27 format_diag_messages
export function format_diag_messages(messages: readonly [DiagMessage, Style][], args: DiagArgMap): string {
  return messages.map(([m, _]) => format_diag_message(m, args)).join("");
}

/// Convert a `DiagMessage` to a string
// rustc: compiler/rustc_errors/src/formatting.rs:32 format_diag_message
export function format_diag_message(message: DiagMessage, args: DiagArgMap): string {
  switch (message.$) {
    case "Str":
      return message._0;
    case "Inline":
      return format_fluent_str(message._0, args);
  }
}

// rustc: compiler/rustc_errors/src/formatting.rs:39 format_fluent_str
function format_fluent_str(message: string, args: DiagArgMap): string {
  // trace!(?message, ?args);
  const GENERATED_MSG_ID = "generated_msg";
  // let resource = FluentResource::try_new(format!("{GENERATED_MSG_ID} = {message}\n")).unwrap();
  // let mut bundle = fluent_bundle::FluentBundle::new(vec![langid!("en-US")]);
  // bundle.set_use_isolating(false);
  // bundle.add_resource(resource).unwrap();
  // register_functions(&mut bundle);
  // let message = bundle.get_message(GENERATED_MSG_ID).unwrap();
  // let value = message.value().unwrap();
  void `${GENERATED_MSG_ID} = ${message}\n`;
  to_fluent_args(args.entries());
  // let mut errs = vec![];
  // let formatted = bundle.format_pattern(value, Some(&args), &mut errs).to_string();
  // debug!(?formatted, ?errs);
  // if errs.is_empty() { Cow::Owned(formatted) } else { panic!("Fluent errors while formatting message: {errs:?}") }
  return unported("fluent_bundle::FluentBundle::format_pattern (rustc_errors::formatting::format_fluent_str)");
}

/** `pub trait DiagMessageAddArg` */
export interface DiagMessageAddArg {
  // rustc: compiler/rustc_errors/src/formatting.rs:62 arg
  arg(name: DiagArgName, arg: IntoDiagArg): EagerDiagMessageBuilder;
}

declare module "./formatting.gen.ts" {
  interface EagerDiagMessageBuilder {
    arg(name: DiagArgName, arg: IntoDiagArg): EagerDiagMessageBuilder;
    format(): DiagMessage;
  }
}

/** `impl DiagMessageAddArg for EagerDiagMessageBuilder` */
// rustc: compiler/rustc_errors/src/formatting.rs:71 arg
EagerDiagMessageBuilder.prototype.arg = function (
  this: EagerDiagMessageBuilder,
  name: DiagArgName,
  arg: IntoDiagArg,
): EagerDiagMessageBuilder {
  const value = arg.into_diag_arg({ value: undefined });
  // debug_assert!(!self.args.contains_key(&name) || self.args.get(&name) == Some(&value), "arg {} already exists", name);
  this.args.set(name, value);
  return this;
};

/** `impl DiagMessageAddArg for DiagMessage` */
// rustc: compiler/rustc_errors/src/formatting.rs:89 arg
export function DiagMessage_arg(self: DiagMessage, name: DiagArgName, arg: IntoDiagArg): EagerDiagMessageBuilder {
  if (self.$ !== "Inline") {
    return panic_("Tried to eagerly format an already formatted message");
  }
  const fluent_str = self._0;
  return new EagerDiagMessageBuilder(fluent_str, new Map()).arg(name, arg);
}

// rustc: compiler/rustc_errors/src/formatting.rs:98 format
EagerDiagMessageBuilder.prototype.format = function (this: EagerDiagMessageBuilder): DiagMessage {
  return { $: "Str", _0: format_fluent_str(this.fluent_str, this.args) };
};


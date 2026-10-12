// Port of compiler/rustc_errors/src/formatting.rs.
import {
  type DiagArg,
  type DiagArgMap,
  type DiagArgName,
  DiagArgValue,
  type DiagMessage,
  FluentArgs,
  type IntoDiagArg,
  langid,
  register_functions,
} from "../rustc_error_messages/lib.ts";
import { debug_tuple, debug_vec, PLAIN } from "../std/fmt.ts";
import { panic as panic_ } from "../std/panic.ts";
import { debug_FluentError, FluentResource, debug_FluentResource } from "../vendor/fluent_bundle/lib.ts";
import * as fluent_bundle from "../vendor/fluent_bundle/lib.ts";
import { debug_ParserError } from "../vendor/fluent_syntax/parser/mod.ts";
import { EagerDiagMessageBuilder } from "./formatting.gen.ts";
import type { Style } from "./lib.gen.ts";

export * from "./formatting.gen.ts";

// pub use rustc_error_messages::FluentArgs;
export { FluentArgs } from "../rustc_error_messages/lib.ts";

/// Convert diagnostic arguments (a rustc internal type that exists to implement
/// `Encodable`/`Decodable`) into `FluentArgs` which is necessary to perform formatting.
// PORT: `impl Iterator<Item = DiagArg>` → an array (the caller's `IndexMap::iter()` is an
// `ExactSizeIterator`, so `size_hint().1` is its length).
// rustc: compiler/rustc_errors/src/formatting.rs:12 to_fluent_args
function to_fluent_args(iter: readonly DiagArg[]): FluentArgs {
  const size_hint_upper: number | undefined = iter.length;
  let args: FluentArgs;
  if (size_hint_upper !== undefined) {
    const size = size_hint_upper;
    args = FluentArgs.with_capacity(size);
  } else {
    args = FluentArgs.new();
  }

  for (const [k, v] of iter) {
    args.set(k, DiagArgValue.into_FluentValue(v)); // `args.set(k.clone(), v.clone())`
  }

  return args;
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
  const resource_r = FluentResource.try_new(`${GENERATED_MSG_ID} = ${message}\n`);
  if (resource_r.$ === "Err") {
    const [res, errs] = resource_r._0;
    const e = debug_tuple(PLAIN, "", [debug_FluentResource(res, PLAIN), debug_vec(errs, PLAIN, debug_ParserError)]);
    return panic_(`called \`Result::unwrap()\` on an \`Err\` value: ${e}`);
  }
  const resource = resource_r._0;
  const bundle = fluent_bundle.FluentBundle.new([langid("en-US")]);
  bundle.set_use_isolating(false);
  const added = bundle.add_resource(resource);
  if (added.$ === "Err") {
    return panic_(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_vec(added._0, PLAIN, debug_FluentError)}`);
  }
  register_functions(bundle);
  const message_ = bundle.get_message(GENERATED_MSG_ID);
  if (message_ === undefined) return panic_("called `Option::unwrap()` on a `None` value");
  const value = message_.value();
  if (value === undefined) return panic_("called `Option::unwrap()` on a `None` value");
  const args_ = to_fluent_args([...args.entries()]);

  const errs: fluent_bundle.FluentError[] = [];
  const formatted = bundle.format_pattern(value, args_, errs); // `.to_string()`
  // debug!(?formatted, ?errs);
  if (errs.length === 0) {
    return formatted; // `Cow::Owned(formatted)`
  } else {
    return panic_(`Fluent errors while formatting message: ${debug_vec(errs, PLAIN, debug_FluentError)}`);
  }
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


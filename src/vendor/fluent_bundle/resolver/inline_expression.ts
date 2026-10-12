// Port of fluent-bundle 0.16.0, src/resolver/inline_expression.rs.
import { panic, unreachable } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { InlineExpression } from "../../fluent_syntax/ast/mod.ts";
import { slice_eq } from "../../fluent_syntax/parser/slice.ts";
import {
  StringWriter,
  unescape_unicode,
  unescape_unicode_to_string,
  type FmtError,
  type Write,
} from "../../fluent_syntax/unicode.ts";
import type { MemoizerKind } from "../memoizer.ts";
import { FluentValue } from "../types/mod.ts";
import { ResolverError } from "./errors.ts";
import { WriteValue_for_Expression } from "./expression.ts";
import type { ResolveValue, WriteValue } from "./mod.ts";
import type { Scope } from "./scope.ts";

/** `impl<'bundle> WriteValue<'bundle> for ast::InlineExpression<&'bundle str>` */
export const WriteValue_for_InlineExpression: WriteValue<InlineExpression> = {
  // crate: fluent-bundle-0.16.0/src/resolver/inline_expression.rs:16 write
  write<M extends MemoizerKind>(self: InlineExpression, w: Write, scope: Scope<M>): Result<null, FmtError> {
    switch (self.$) {
      case "StringLiteral": {
        const value = self.value;
        return unescape_unicode(w, value);
      }
      case "MessageReference": {
        const { id, attribute } = self;
        const msg = scope.bundle.get_entry_message(id.name.toString());
        if (msg !== undefined) {
          if (attribute !== undefined) {
            const attr = attribute;
            // `.iter().find_map(..)`: the first attribute with that name is tracked.
            for (const a of msg.attributes) {
              if (slice_eq(a.id.name, attr.name)) {
                return scope.track(w, a.value, self);
              }
            }
            return scope.write_ref_error(w, self);
          } else {
            const value = msg.value;
            if (value !== undefined) {
              return scope.track(w, value, self);
            } else {
              scope.add_error({ $: "NoValue", _0: id.name.toString() });
              const r1 = w.write_char(0x7b /* '{' */);
              if (r1.$ === "Err") return r1;
              const r2 = WriteValue_for_InlineExpression.write_error(self, w);
              if (r2.$ === "Err") return r2;
              return w.write_char(0x7d /* '}' */);
            }
          }
        } else {
          return scope.write_ref_error(w, self);
        }
      }
      case "NumberLiteral": {
        const value = self.value;
        return FluentValue.write(FluentValue.try_number(value.toString()), w, scope);
      }
      case "TermReference": {
        const { id, attribute, arguments: arguments_ } = self;
        const [, resolved_named_args] = scope.get_arguments(arguments_);

        scope.local_args = resolved_named_args;
        let result: Result<null, FmtError> | undefined;
        const term = scope.bundle.get_entry_term(id.name.toString());
        if (term !== undefined) {
          if (attribute !== undefined) {
            const attr = attribute;
            for (const a of term.attributes) {
              if (slice_eq(a.id.name, attr.name)) {
                result = scope.track(w, a.value, self);
                break;
              }
            }
          } else {
            result = scope.track(w, term.value, self);
          }
        }
        if (result === undefined) {
          result = scope.write_ref_error(w, self);
        }
        scope.local_args = undefined;
        return result;
      }
      case "FunctionReference": {
        const { id, arguments: arguments_ } = self;
        const [resolved_positional_args, resolved_named_args] = scope.get_arguments(arguments_);

        const func = scope.bundle.get_entry_function(id.name.toString());

        if (func !== undefined) {
          const result = func(resolved_positional_args, resolved_named_args);
          if (result.$ === "Error") {
            return WriteValue_for_InlineExpression.write_error(self, w);
          } else {
            return w.write_str(FluentValue.into_string(result, scope));
          }
        } else {
          return scope.write_ref_error(w, self);
        }
      }
      case "VariableReference": {
        const { id } = self;
        const args = scope.local_args ?? scope.args;

        const arg = args === undefined ? undefined : args.get(id.name.toString());
        if (arg !== undefined) {
          return FluentValue.write(arg, w, scope);
        } else {
          if (scope.local_args === undefined) {
            scope.add_error(ResolverError.from(self));
          }
          const r1 = w.write_char(0x7b /* '{' */);
          if (r1.$ === "Err") return r1;
          const r2 = WriteValue_for_InlineExpression.write_error(self, w);
          if (r2.$ === "Err") return r2;
          return w.write_char(0x7d /* '}' */);
        }
      }
      case "Placeable": {
        const { expression } = self;
        return WriteValue_for_Expression.write(expression, w, scope);
      }
    }
  },

  // crate: fluent-bundle-0.16.0/src/resolver/inline_expression.rs:120 write_error
  write_error(self: InlineExpression, w: Write): Result<null, FmtError> {
    switch (self.$) {
      case "MessageReference":
        if (self.attribute !== undefined) {
          return w.write_str(`${self.id.name.toString()}.${self.attribute.name.toString()}`);
        } else {
          return w.write_str(self.id.name.toString());
        }
      case "TermReference":
        if (self.attribute !== undefined) {
          return w.write_str(`-${self.id.name.toString()}.${self.attribute.name.toString()}`);
        } else {
          return w.write_str(`-${self.id.name.toString()}`);
        }
      case "FunctionReference":
        return w.write_str(`${self.id.name.toString()}()`);
      case "VariableReference":
        return w.write_str(`$${self.id.name.toString()}`);
      default:
        return unreachable();
    }
  },
};

/** `impl<'bundle> ResolveValue<'bundle> for ast::InlineExpression<&'bundle str>` */
export const ResolveValue_for_InlineExpression: ResolveValue<InlineExpression> = {
  // crate: fluent-bundle-0.16.0/src/resolver/inline_expression.rs:151 resolve
  resolve<M extends MemoizerKind>(self: InlineExpression, scope: Scope<M>): FluentValue {
    switch (self.$) {
      case "StringLiteral": {
        const value = self.value;
        return FluentValue.from_Cow(unescape_unicode_to_string(value));
      }
      case "NumberLiteral": {
        const value = self.value;
        return FluentValue.try_number(value.toString());
      }
      case "VariableReference": {
        const { id } = self;
        const local_args = scope.local_args;
        if (local_args !== undefined) {
          const arg = local_args.get(id.name.toString());
          if (arg !== undefined) {
            return FluentValue.clone(arg);
          }
        } else {
          const arg = scope.args === undefined ? undefined : scope.args.get(id.name.toString());
          if (arg !== undefined) {
            return FluentValue.into_owned(arg);
          }
        }

        if (scope.local_args === undefined) {
          scope.add_error(ResolverError.from(self));
        }
        return FluentValue.Error;
      }
      case "FunctionReference": {
        const { id, arguments: arguments_ } = self;
        const [resolved_positional_args, resolved_named_args] = scope.get_arguments(arguments_);

        const func = scope.bundle.get_entry_function(id.name.toString());

        if (func !== undefined) {
          const result = func(resolved_positional_args, resolved_named_args);
          return result;
        } else {
          return FluentValue.Error;
        }
      }
      default: {
        const result = new StringWriter();
        const r = WriteValue_for_InlineExpression.write(self, result, scope);
        if (r.$ === "Err") return panic(`Failed to write: ${r._0}`); // `.expect(..)`; `{:?}` of `fmt::Error` is `Error`
        return FluentValue.from_String(result.buf);
      }
    }
  },
};

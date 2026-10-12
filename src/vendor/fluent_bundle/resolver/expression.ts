// Port of fluent-bundle 0.16.0, src/resolver/expression.rs.
import { Ok, type Result } from "../../../std/result.ts";
import type { Expression } from "../../fluent_syntax/ast/mod.ts";
import type { FmtError, Write } from "../../fluent_syntax/unicode.ts";
import type { MemoizerKind } from "../memoizer.ts";
import { FluentValue } from "../types/mod.ts";
import { ResolverError } from "./errors.ts";
import { ResolveValue_for_InlineExpression, WriteValue_for_InlineExpression } from "./inline_expression.ts";
import type { WriteValue } from "./mod.ts";
import { WriteValue_for_Pattern } from "./pattern.ts";
import type { Scope } from "./scope.ts";

/** `impl<'bundle> WriteValue<'bundle> for ast::Expression<&'bundle str>` */
export const WriteValue_for_Expression: WriteValue<Expression> = {
  // crate: fluent-bundle-0.16.0/src/resolver/expression.rs:15 write
  write<M extends MemoizerKind>(self: Expression, w: Write, scope: Scope<M>): Result<null, FmtError> {
    switch (self.$) {
      case "Inline": {
        const exp = self._0;
        return WriteValue_for_InlineExpression.write(exp, w, scope);
      }
      case "Select": {
        const { selector: selector_, variants } = self;
        const selector = ResolveValue_for_InlineExpression.resolve(selector_, scope);
        switch (selector.$) {
          case "String":
          case "Number":
            for (const variant of variants) {
              let key: FluentValue;
              switch (variant.key.$) {
                case "Identifier": {
                  const name = variant.key.name;
                  key = FluentValue.from_str(name.toString());
                  break;
                }
                case "NumberLiteral": {
                  const value = variant.key.value;
                  key = FluentValue.try_number(value.toString());
                  break;
                }
              }
              if (FluentValue.matches(key, selector, scope)) {
                return WriteValue_for_Pattern.write(variant.value, w, scope);
              }
            }
            break;
          default:
            break;
        }

        for (const variant of variants) {
          if (variant.default) {
            return WriteValue_for_Pattern.write(variant.value, w, scope);
          }
        }
        scope.add_error(ResolverError.MissingDefault);
        return Ok(null);
      }
    }
  },

  // crate: fluent-bundle-0.16.0/src/resolver/expression.rs:57 write_error
  write_error(self: Expression, w: Write): Result<null, FmtError> {
    switch (self.$) {
      case "Inline": {
        const exp = self._0;
        return WriteValue_for_InlineExpression.write_error(exp, w);
      }
      case "Select": {
        const { selector } = self;
        return WriteValue_for_InlineExpression.write_error(selector, w);
      }
    }
  },
};

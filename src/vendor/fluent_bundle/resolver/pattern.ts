// Port of fluent-bundle 0.16.0, src/resolver/pattern.rs.
import { panic, unreachable } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import type { Pattern } from "../../fluent_syntax/ast/mod.ts";
import { StringWriter, type FmtError, type Write } from "../../fluent_syntax/unicode.ts";
import type { MemoizerKind } from "../memoizer.ts";
import { FluentValue } from "../types/mod.ts";
import { ResolverError } from "./errors.ts";
import type { ResolveValue, WriteValue } from "./mod.ts";
import type { Scope } from "./scope.ts";

const MAX_PLACEABLES = 100;

/** `impl<'bundle> WriteValue<'bundle> for ast::Pattern<&'bundle str>` */
export const WriteValue_for_Pattern: WriteValue<Pattern> = {
  // crate: fluent-bundle-0.16.0/src/resolver/pattern.rs:17 write
  write<M extends MemoizerKind>(self: Pattern, w: Write, scope: Scope<M>): Result<null, FmtError> {
    const len = self.elements.length;

    for (const elem of self.elements) {
      if (scope.dirty) {
        return Ok(null);
      }

      switch (elem.$) {
        case "TextElement": {
          const value = elem.value;
          const transform = scope.bundle.transform;
          if (transform !== undefined) {
            const r = w.write_str(transform(value.toString()));
            if (r.$ === "Err") return r;
          } else {
            const r = w.write_str(value.toString());
            if (r.$ === "Err") return r;
          }
          break;
        }
        case "Placeable": {
          const expression = elem.expression;
          scope.placeables += 1; // u8; at most MAX_PLACEABLES + 1 before `dirty` stops the walk
          if (scope.placeables > MAX_PLACEABLES) {
            scope.dirty = true;
            scope.add_error(ResolverError.TooManyPlaceables);
            return Ok(null);
          }

          const needs_isolation =
            scope.bundle.use_isolating &&
            len > 1 &&
            !(
              expression.$ === "Inline" &&
              (expression._0.$ === "MessageReference" ||
                expression._0.$ === "TermReference" ||
                expression._0.$ === "StringLiteral")
            );
          if (needs_isolation) {
            const r = w.write_char(0x2068);
            if (r.$ === "Err") return r;
          }
          const r = scope.maybe_track(w, self, expression);
          if (r.$ === "Err") return r;
          if (needs_isolation) {
            const r = w.write_char(0x2069);
            if (r.$ === "Err") return r;
          }
          break;
        }
      }
    }
    return Ok(null);
  },

  // crate: fluent-bundle-0.16.0/src/resolver/pattern.rs:75 write_error
  write_error(_self: Pattern, _w: Write): Result<null, FmtError> {
    return unreachable();
  },
};

/** `impl<'bundle> ResolveValue<'bundle> for ast::Pattern<&'bundle str>` */
export const ResolveValue_for_Pattern: ResolveValue<Pattern> = {
  // crate: fluent-bundle-0.16.0/src/resolver/pattern.rs:84 resolve
  resolve<M extends MemoizerKind>(self: Pattern, scope: Scope<M>): FluentValue {
    const len = self.elements.length;

    if (len === 1) {
      const e = self.elements[0]!;
      if (e.$ === "TextElement") {
        const value = e.value;
        const transform = scope.bundle.transform;
        return transform === undefined
          ? FluentValue.from_str(value.toString())
          : FluentValue.from_Cow(transform(value.toString()));
      }
    }

    const result = new StringWriter();
    const r = WriteValue_for_Pattern.write(self, result, scope);
    if (r.$ === "Err") return panic(`Failed to write to a string.: ${r._0}`); // `.expect(..)`; `{:?}` of `fmt::Error` is `Error`
    return FluentValue.from_String(result.buf);
  },
};

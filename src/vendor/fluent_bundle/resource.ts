// Port of fluent-bundle 0.16.0, src/resource.rs.
// (Doc examples are ported as tests in doc_examples.test.ts.)
import { debug_str, debug_struct, debug_tuple, type Fmt } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Str } from "../../std/str.ts";
import { debug_Resource, type Entry, type Resource } from "../fluent_syntax/ast/mod.ts";
import { parse_runtime, type ParserError } from "../fluent_syntax/parser/mod.ts";

/**
 * PORT: `self_cell!(pub struct InnerFluentResource { owner: String, #[covariant] dependent:
 * Resource } impl {Debug})` (self_cell 1.2.1) → a plain object holding both. The owner is the
 * source's UTF-8 bytes (`Str`), which the AST's `Str` slices point into; `new` builds the
 * dependent from the owner like `self_cell`'s `new(owner, dependent_builder)`.
 */
export class InnerFluentResource {
  private constructor(
    private readonly owner: Str,
    private readonly dependent: Resource,
  ) {}

  static new(owner: Str, dependent_builder: (owner: Str) => Resource): InnerFluentResource {
    return new InnerFluentResource(owner, dependent_builder(owner));
  }

  borrow_owner(): Str {
    return this.owner;
  }

  borrow_dependent(): Resource {
    return this.dependent;
  }
}

/** self_cell's `impl {Debug}`: `debug_struct("InnerFluentResource").field("owner", ..).field("dependent", ..)`. */
export function debug_InnerFluentResource(v: InnerFluentResource, f: Fmt): string {
  return debug_struct(f, "InnerFluentResource", [
    ["owner", debug_str(v.borrow_owner().toString())],
    ["dependent", debug_Resource(v.borrow_dependent(), f)],
  ]);
}

/// A resource containing a list of localization messages.
///
/// [`FluentResource`] wraps an [`Abstract Syntax Tree`](../fluent_syntax/ast/index.html) produced by the
/// [`parser`](../fluent_syntax/parser/index.html) and provides an access to a list
/// of its entries.
///
/// A good mental model for a resource is a single FTL file, but in the future
/// there's nothing preventing a resource from being stored in a data base,
/// pre-parsed format or in some other structured form.
///
/// # Ownership
///
/// A resource owns the source string and the AST contains references
/// to the slices of the source.
// #[derive(Debug)]
export class FluentResource {
  constructor(readonly _0: InnerFluentResource) {}

  /// A fallible constructor of a new [`FluentResource`].
  ///
  /// It takes an encoded `Fluent Translation List` string, parses
  /// it and stores both, the input string and the AST view of it,
  /// for runtime use.
  ///
  /// # Errors
  ///
  /// The method will return the resource irrelevant of parse errors
  /// encountered during parsing of the source, but in case of errors,
  /// the `Err` variant will contain both the structure and a vector
  /// of errors.
  // crate: fluent-bundle-0.16.0/src/resource.rs:82 try_new
  static try_new(source: string): Result<FluentResource, [FluentResource, ParserError[]]> {
    let errors: ParserError[] | undefined = undefined;

    const res = InnerFluentResource.new(Str.from(source), (source) => {
      const r = parse_runtime(source);
      switch (r.$) {
        case "Ok": {
          const ast = r._0;
          return ast;
        }
        case "Err": {
          const [ast, err] = r._0;
          errors = err;
          return ast;
        }
      }
    });

    const errs = errors as ParserError[] | undefined;
    if (errs === undefined) {
      return Ok(new FluentResource(res));
    } else {
      const err = errs;
      return Err([new FluentResource(res), err] as [FluentResource, ParserError[]]);
    }
  }

  /// Returns a reference to the source string that was used
  /// to construct the [`FluentResource`].
  // crate: fluent-bundle-0.16.0/src/resource.rs:117 source
  source(): string {
    return this._0.borrow_owner().toString();
  }

  /// Returns an iterator over [`entries`](fluent_syntax::ast::Entry) of the [`FluentResource`].
  // crate: fluent-bundle-0.16.0/src/resource.rs:144 entries
  entries(): readonly Entry[] {
    return this._0.borrow_dependent().body;
  }

  /// Returns an [`Entry`](fluent_syntax::ast::Entry) at the
  /// given index out of the [`FluentResource`].
  // crate: fluent-bundle-0.16.0/src/resource.rs:168 get_entry
  get_entry(idx: number): Entry | undefined {
    return this._0.borrow_dependent().body[idx];
  }
}

/** `#[derive(Debug)]` (`FluentResource(InnerFluentResource { .. })`) */
export function debug_FluentResource(v: FluentResource, f: Fmt): string {
  return debug_tuple(f, "FluentResource", [debug_InnerFluentResource(v._0, f)]);
}

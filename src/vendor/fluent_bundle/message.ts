// Port of fluent-bundle 0.16.0, src/message.rs.
// (Doc examples are ported as tests in doc_examples.test.ts.)
import { debug_struct, type Fmt } from "../../std/fmt.ts";
import { debug_Attribute, debug_Message, type Attribute, type Message, type Pattern } from "../fluent_syntax/ast/mod.ts";

/// [`FluentAttribute`] is a component of a compound [`FluentMessage`].
///
/// It represents a key-value pair providing a translation of a component
/// of a user interface widget localized by the given message.
// #[derive(Debug, PartialEq)]
export class FluentAttribute {
  constructor(readonly node: Attribute) {}

  /// Retrieves an id of an attribute.
  // crate: fluent-bundle-0.16.0/src/message.rs:71 id
  id(): string {
    return this.node.id.name.toString();
  }

  /// Retrieves an value of an attribute.
  // crate: fluent-bundle-0.16.0/src/message.rs:104 value
  value(): Pattern {
    return this.node.value;
  }

  /** `impl<'m> From<&'m ast::Attribute<&'m str>> for FluentAttribute<'m>` */
  // crate: fluent-bundle-0.16.0/src/message.rs:110 from
  static from(attr: Attribute): FluentAttribute {
    return new FluentAttribute(attr);
  }
}

/** `#[derive(Debug)]` */
export function debug_FluentAttribute(v: FluentAttribute, f: Fmt): string {
  return debug_struct(f, "FluentAttribute", [["node", debug_Attribute(v.node, f)]]);
}

/// [`FluentMessage`] is a basic translation unit of the Fluent system.
///
/// The instance of a message is returned from the
/// [`FluentBundle::get_message`](crate::bundle::FluentBundle::get_message)
/// method, for the lifetime of the [`FluentBundle`](crate::bundle::FluentBundle) instance.
///
/// That value can be then passed to
/// [`FluentBundle::format_pattern`](crate::bundle::FluentBundle::format_pattern) to be formatted
/// within the context of a given [`FluentBundle`](crate::bundle::FluentBundle) instance.
///
/// # Compound Message
///
/// A message may contain a `value`, but it can also contain a list of [`FluentAttribute`] elements.
///
/// If a message contains attributes, it is called a "compound" message.
///
/// In such case, the message contains a list of key-value attributes that represent
/// different translation values associated with a single translation unit.
///
/// This is useful for scenarios where a [`FluentMessage`] is associated with a
/// complex User Interface widget which has multiple attributes that need to be translated.
// #[derive(Debug, PartialEq)]
export class FluentMessage {
  constructor(readonly node: Message) {}

  /// Retrieves an option of a [`ast::Pattern`](fluent_syntax::ast::Pattern).
  // crate: fluent-bundle-0.16.0/src/message.rs:198 value
  value(): Pattern | undefined {
    return this.node.value;
  }

  /// An iterator over [`FluentAttribute`] elements.
  // crate: fluent-bundle-0.16.0/src/message.rs:228 attributes
  attributes(): FluentAttribute[] {
    return this.node.attributes.map((a) => FluentAttribute.from(a));
  }

  /// Retrieve a single [`FluentAttribute`] element.
  // crate: fluent-bundle-0.16.0/src/message.rs:261 get_attribute
  get_attribute(key: string): FluentAttribute | undefined {
    const attr = this.node.attributes.find((attr) => attr.id.name.toString() === key);
    return attr === undefined ? undefined : FluentAttribute.from(attr);
  }

  /** `impl<'m> From<&'m ast::Message<&'m str>> for FluentMessage<'m>` */
  // crate: fluent-bundle-0.16.0/src/message.rs:271 from
  static from(msg: Message): FluentMessage {
    return new FluentMessage(msg);
  }
}

/** `#[derive(Debug)]` */
export function debug_FluentMessage(v: FluentMessage, f: Fmt): string {
  return debug_struct(f, "FluentMessage", [["node", debug_Message(v.node, f)]]);
}

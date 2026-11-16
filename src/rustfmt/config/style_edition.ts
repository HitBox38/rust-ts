// Port of src/tools/rustfmt/src/config/style_edition.rs (lane rustfmt-contract-1).
// The `style_edition_default!` macro (style_edition.rs:12) is expanded by tools/codegen/create_config.ts into
// create_config.gen.ts (plan-m8 D5); its two arms carry the `style_edition_default` markers there.
import type { StyleEdition } from "./options.gen.ts";

/// Defines the default value for the given style edition
// PORT: the trait is a table per implementing unit struct (PORTING §5 "Traits"); `type ConfigType` is the type argument.
export interface StyleEditionDefault<ConfigType> {
  // rustc: src/tools/rustfmt/src/config/style_edition.rs:7 style_edition_default
  style_edition_default(style_edition: StyleEdition): ConfigType;
}

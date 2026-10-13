// Port of unicode-security =0.1.2 `src/general_security_profile.rs`.

//! Utilities for working with the [General Security Profile](https://www.unicode.org/reports/tr39/#General_Security_Profile)
//! for identifiers

import { type IdentifierType, identifier_status_allowed, identifier_type } from "./tables.ts";

export { IdentifierType } from "./tables.ts";

/// Methods for determining characters not restricted from use for identifiers.
export interface GeneralSecurityProfile<T> {
  /// Returns whether the character is not restricted from use for identifiers.
  // crate: unicode-security-0.1.2/src/general_security_profile.rs:11 identifier_allowed
  identifier_allowed(self: T): boolean;

  /// Returns the [identifier type](https://www.unicode.org/reports/tr39/#Identifier_Status_and_Type)
  // crate: unicode-security-0.1.2/src/general_security_profile.rs:14 identifier_type
  identifier_type(self: T): IdentifierType | undefined;
}

/** `impl GeneralSecurityProfile for char` */
export const GeneralSecurityProfile_char: GeneralSecurityProfile<number> = {
  // #[inline]
  // crate: unicode-security-0.1.2/src/general_security_profile.rs:19 identifier_allowed
  identifier_allowed(self: number): boolean {
    return identifier_status_allowed(self);
  },
  // #[inline]
  // crate: unicode-security-0.1.2/src/general_security_profile.rs:23 identifier_type
  identifier_type(self: number): IdentifierType | undefined {
    return identifier_type(self);
  },
};

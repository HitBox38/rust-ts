// Port of unicode-security =0.1.2 `src/lib.rs` (vendored for rustc_lint's non_ascii_idents). Table data and
// lookups: `tables.ts` (generated from the crate's tables.rs; see its header).
//
// Copyright 2012-2015 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

//! Detect possible security problems with Unicode usage according to
//! [Unicode Technical Standard #39](http://www.unicode.org/reports/tr39/)
//! rules.

export { UNICODE_VERSION } from "./tables.ts";

export * as confusable_detection from "./confusable_detection.ts";
export * as general_security_profile from "./general_security_profile.ts";
export * as mixed_script from "./mixed_script.ts";
export * as restriction_level from "./restriction_level.ts";

export { skeleton } from "./confusable_detection.ts";
export { GeneralSecurityProfile_char } from "./general_security_profile.ts";
export { is_potential_mixed_script_confusable_char } from "./mixed_script.ts";
export { MixedScript_str } from "./mixed_script.ts";
export { RestrictionLevel, RestrictionLevelDetection_str } from "./restriction_level.ts";

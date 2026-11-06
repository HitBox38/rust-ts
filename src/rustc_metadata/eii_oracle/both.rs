// Two explicit implementations in two other crates, and the default in a third: `check_externally_implementable_items` learns
// of all three only by decoding `EiiMapEncodedKeyValue`, and its error prints what it decoded.
#![no_std]
#![feature(extern_item_impls)]

extern crate impl1;
extern crate impl2;

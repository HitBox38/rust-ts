#!/usr/bin/env run-cargo-script
fn main() { let _ = ("\x80", b"\x80", c"\x80", '\u{D800}', b'\xFF'); }

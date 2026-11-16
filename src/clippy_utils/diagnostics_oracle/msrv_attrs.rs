// Fixture for msrvs.test.ts: `msrvs::check_attrs`'s three errors (run by clippy's pre-expansion `EarlyAttributes`).
#![feature(custom_inner_attributes)]
#![clippy::msrv = "1.40"]

#[clippy::msrv = "abc"]
fn a() {}

#[clippy::msrv]
fn b() {}

#[clippy::msrv = "1.2.3"]
#[clippy::msrv = "1.4"]
#[clippy::msrv = "1.5"]
fn c() {}

#[clippy::msrv = "1.0-nightly"]
fn d() {}

fn main() {}

#![feature(trait_alias)]
trait A = B;
trait B = A;

fn main() {}

//@ edition: 2021
//@ compile-flags: -Copt-level=0 -Zwrite-long-types-to-disk=no
// `type_length` is a `usize` that wraps: the type doubles at each level, so the fatal error's suggested limit is past 2^64
// (tests/ui/recursion/issue-83150.rs, with a lower recursion limit so that the program takes a second instead of minutes).
#![recursion_limit = "66"]

fn main() {
    let mut iter = 0u8..1;
    func(&mut iter)
}

fn func<T: Iterator<Item = u8>>(iter: &mut T) {
    func(&mut iter.map(|x| x + 1))
}

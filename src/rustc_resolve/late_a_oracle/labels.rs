// Labels (late.rs: resolve_label, is_label_valid_from_rib) and their errors.
#![allow(unused)]
fn labels() {
    'outer: loop {
        'inner: loop {
            break 'outer;
        }
    }
    'blk: {
        break 'blk;
    }
}
fn unreachable_label() {
    'a: loop {
        let c = || {
            break 'a;
        };
    }
}
fn undeclared() {
    loop {
        break 'nope;
    }
}

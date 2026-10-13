// Labels: labeled loops and blocks, break/continue to labels, unused labels (UNUSED_LABELS),
// underscore labels, label shadowing.
fn f(c: bool) -> u8 {
    'outer: loop {
        'inner: while c {
            if c {
                continue 'outer;
            }
            break 'inner;
        }
        'unused: loop {
            break;
        }
        '_skipped: loop {
            break;
        }
        break 'outer;
    }
    let v = 'blk: {
        if c {
            break 'blk 1;
        }
        2
    };
    'a: loop {
        'a: loop {
            break 'a;
        }
        break;
    }
    v
}

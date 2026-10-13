fn f() {
    'a: loop {
        'a: loop {
            break 'a;
        }
    }
}

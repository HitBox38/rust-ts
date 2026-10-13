pm_probe::probe!(foo _ _x r#fn r#type self Self crate super 'a 'static '_ b'x' 'c' '\'' '\n');
pm_probe::probe!(1 1u8 1.5 1.5f32 1e3 0x1F 0o7 0b1 1_000 1.0e-5 -1 -1.5 true false 1.);
pm_probe::probe!("s" "with \"quote\" and \\ and \n" r"raw" r#"r#"# b"bs" br"x" br##"y"## c"cs" cr"x" "é ☃" b'\xff');

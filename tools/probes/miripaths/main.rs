// Oracle probe for src/miri/shims/os_str.ts (lane miri-shims-a; tools/probes/miripaths). `windows_to_unix` and
// `unix_to_windows` are src/tools/miri/src/shims/os_str.rs:274-328 at the pin, copied verbatim. Each input runs over
// both `Vec<u8>` (Unix host) and `Vec<u16>` (Windows host), which must agree; one `{:?}\t{:?}\t{:?}` line per input.
#![allow(dead_code)]
fn windows_to_unix<T>(path: &mut Vec<T>)
where
    T: From<u8> + Copy + Eq,
{
    let sep = T::from(b'/');
    // Make sure all path separators are `/`.
    for c in path.iter_mut() {
        if *c == b'\\'.into() {
            *c = sep;
        }
    }
    // If this starts with `//?/`, it was probably produced by `unix_to_windows` and we
    // remove the `//?` that got added to get the Unix path back out.
    if path.get(0..4) == Some(&[sep, sep, b'?'.into(), sep]) {
        // Remove first 3 characters. It still starts with `/` so it is absolute on Unix.
        path.splice(0..3, std::iter::empty());
    }
    // If it starts with a drive letter (`X:/`), convert it to an absolute Unix path.
    else if path.get(1..3) == Some(&[b':'.into(), sep]) {
        // We add a `/` at the beginning, to store the absolute Windows
        // path in something that looks like an absolute Unix path.
        path.insert(0, sep);
    }
}

/// Adjust a Unix path to Windows conventions such that it un-does everything that
/// `windows_to_unix` did, and such that if the Unix input path was absolute, then the
/// Windows output path is absolute.
fn unix_to_windows<T>(path: &mut Vec<T>)
where
    T: From<u8> + Copy + Eq,
{
    let sep = T::from(b'\\');
    // Make sure all path separators are `\`.
    for c in path.iter_mut() {
        if *c == b'/'.into() {
            *c = sep;
        }
    }
    // If the path is `\X:\`, the leading separator was probably added by `windows_to_unix`
    // and we should get rid of it again.
    if path.get(2..4) == Some(&[b':'.into(), sep]) && path[0] == sep {
        // The new path is still absolute on Windows.
        path.remove(0);
    }
    // If this starts with a `\` but not a `\\`, then this was absolute on Unix but is
    // relative on Windows (relative to "the root of the current directory", e.g. the
    // drive letter).
    else if path.first() == Some(&sep) && path.get(1) != Some(&sep) {
        // We add `\\?` so it starts with `\\?\` which is some magic path on Windows
        // that *is* considered absolute. This way we store the absolute Unix path
        // in something that looks like an absolute Windows path.
        path.splice(0..0, [sep, sep, b'?'.into()]);
    }
}
fn show(v: &[u8]) -> String { String::from_utf8(v.to_vec()).unwrap() }
fn main() {
    let cases = ["C:\\foo\\bar", "/C:/foo/bar", "\\\\?\\tmp\\x", "//?/tmp/x", "/tmp/x", "tmp/x", "relative\\p", "\\abs", "\\\\server\\share", "", "/", "\\", "C:", "C:\\", "/C:/", "ä/ö\\ü"];
    for c in cases {
        let mut a: Vec<u8> = c.as_bytes().to_vec(); windows_to_unix(&mut a);
        let mut b: Vec<u8> = c.as_bytes().to_vec(); unix_to_windows(&mut b);
        let mut a16: Vec<u16> = c.encode_utf16().collect(); windows_to_unix(&mut a16);
        let mut b16: Vec<u16> = c.encode_utf16().collect(); unix_to_windows(&mut b16);
        assert_eq!(String::from_utf16(&a16).unwrap(), show(&a));
        assert_eq!(String::from_utf16(&b16).unwrap(), show(&b));
        println!("{:?}\t{:?}\t{:?}", c, show(&a), show(&b));
    }
}

// `send` with a flag Miri does not know: the text names what is left after the known flags.
#![feature(rustc_private)]
extern crate libc;

fn main() {
    let mut s = [-1; 2];
    unsafe {
        assert_eq!(libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, s.as_mut_ptr()), 0);
        libc::send(s[0], b"x".as_ptr().cast(), 1, libc::MSG_NOSIGNAL | libc::MSG_OOB);
    }
}

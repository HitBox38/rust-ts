// `recv` with MSG_PEEK: unsupported on a virtual socket.
#![feature(rustc_private)]
extern crate libc;

fn main() {
    let mut s = [-1; 2];
    unsafe {
        assert_eq!(libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, s.as_mut_ptr()), 0);
        let mut x = [0u8; 2];
        libc::recv(s[1], x.as_mut_ptr().cast(), 2, libc::MSG_PEEK);
    }
}

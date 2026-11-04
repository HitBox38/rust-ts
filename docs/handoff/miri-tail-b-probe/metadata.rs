// `FileDescription::metadata` of the virtual sockets (lane miri-tail-b; run with -Zmiri-disable-isolation).
#![feature(rustc_private)]
extern crate libc;

fn mode(fd: i32) -> u32 {
    let mut s: libc::stat = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::fstat(fd, &mut s) }, 0);
    s.st_mode & libc::S_IFMT
}

fn main() {
    let mut p = [-1; 2];
    assert_eq!(unsafe { libc::pipe(p.as_mut_ptr()) }, 0);
    let mut s = [-1; 2];
    assert_eq!(unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, s.as_mut_ptr()) }, 0);
    println!("pipe r={} w={} socketpair {} {}", mode(p[0]), mode(p[1]), mode(s[0]), mode(s[1]));
}

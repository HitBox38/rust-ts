// miri-flags: -Zmiri-deterministic-concurrency
// `send` and `recv` on virtual sockets, and the paths of unix/virtual_socket.rs the review's mutations reached (review
// miri-tail-b N1, N3). Every line printed depends on the path it names.
#![feature(rustc_private)]
extern crate libc;

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::thread;

fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap()
}
fn pipe_with(flags: i32) -> [i32; 2] {
    let mut p = [-1; 2];
    assert_eq!(unsafe { libc::pipe2(p.as_mut_ptr(), flags) }, 0);
    p
}
fn socket_pair(flags: i32) -> [i32; 2] {
    let mut p = [-1; 2];
    assert_eq!(unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM | flags, 0, p.as_mut_ptr()) }, 0);
    p
}
fn close(fd: i32) {
    assert_eq!(unsafe { libc::close(fd) }, 0);
}
fn rd(fd: i32, n: usize) -> (isize, i32, Vec<u8>) {
    let mut b = vec![0u8; n];
    let r = unsafe { libc::read(fd, b.as_mut_ptr().cast(), n) };
    (r, if r < 0 { errno() } else { 0 }, b[..r.max(0) as usize].to_vec())
}
fn wr(fd: i32, b: &[u8]) -> (isize, i32) {
    let r = unsafe { libc::write(fd, b.as_ptr().cast(), b.len()) };
    (r, if r < 0 { errno() } else { 0 })
}
fn send(fd: i32, b: &[u8], flags: i32) -> (isize, i32) {
    let r = unsafe { libc::send(fd, b.as_ptr().cast(), b.len(), flags) };
    (r, if r < 0 { errno() } else { 0 })
}
fn recv(fd: i32, n: usize, flags: i32) -> (isize, i32, Vec<u8>) {
    let mut b = vec![0u8; n];
    let r = unsafe { libc::recv(fd, b.as_mut_ptr().cast(), n, flags) };
    (r, if r < 0 { errno() } else { 0 }, b[..r.max(0) as usize].to_vec())
}
fn spin(n: usize) {
    for _ in 0..n {
        thread::yield_now();
    }
}

/// The std API on top of `send` and `recv`.
fn unix_stream() {
    let (mut a, mut b) = UnixStream::pair().unwrap();
    a.write_all(b"hi").unwrap();
    let mut x = [0u8; 2];
    b.read_exact(&mut x).unwrap();
    println!("stream {x:?}");
    drop(a);
    let mut rest = String::new();
    b.read_to_string(&mut rest).unwrap();
    println!("stream eof {rest:?}");
}

/// The error paths and flags of the shims.
fn shim_paths() {
    let s = socket_pair(0);
    println!("send {:?}", send(s[0], b"abc", 0));
    println!("recv {:?}", recv(s[1], 2, 0));
    println!("send nosignal {:?}", send(s[0], b"de", libc::MSG_NOSIGNAL));
    println!("recv cloexec {:?}", recv(s[1], 9, libc::MSG_CMSG_CLOEXEC));
    println!("recv zero {:?}", recv(s[1], 0, 0));
    println!("send zero {:?}", send(s[0], b"", 0));
    // `is_non_block` is the call's own: this socket is blocking and nothing is buffered.
    println!("recv dontwait {:?}", recv(s[1], 2, libc::MSG_DONTWAIT));
    println!("flags unchanged {:?}", unsafe { libc::fcntl(s[1], libc::F_GETFL) });
    close(s[1]);
    println!("send nosignal, no peer {:?}", send(s[0], b"x", libc::MSG_NOSIGNAL));
    println!("recv no peer {:?}", recv(s[0], 2, 0));
    close(s[0]);
    println!("send closed {:?}", send(s[0], b"x", 0));
    println!("recv closed {:?}", recv(s[0], 2, 0));
    println!("send bad {:?}", send(99, b"x", 0));
    println!("recv bad {:?}", recv(99, 2, 0));
    // Not a socket.
    let p = pipe_with(0);
    println!("send pipe {:?}", send(p[1], b"x", 0));
    println!("recv pipe {:?}", recv(p[0], 2, 0));
    println!("send stdout {:?}", send(1, b"x", 0));
    println!("recv stdin {:?}", recv(0, 2, 0));
    close(p[0]);
    close(p[1]);
    // `send` with MSG_DONTWAIT on a full buffer of a blocking socket.
    let s = socket_pair(0);
    let big = vec![1u8; 0x34000];
    println!("fill {:?}", send(s[0], &big, 0));
    println!("send dontwait, full {:?}", send(s[0], b"y", libc::MSG_DONTWAIT));
    close(s[0]);
    close(s[1]);
}

/// Small first writes: the buffer's minimum capacity, and the wraps that follow from it.
fn small_first_writes() {
    let p = pipe_with(libc::O_NONBLOCK);
    for first in 1..=7usize {
        let a = [first as u8; 32];
        println!("{:?}", wr(p[1], &a[..first]));
        println!("{:?}", rd(p[0], first.saturating_sub(1).max(1)).0);
        println!("{:?}", wr(p[1], &a[..4]));
        println!("{:?}", rd(p[0], 32).0);
        println!("{:?}", wr(p[1], &a[..7]));
        println!("{:?}", rd(p[0], 32).0);
        println!("{:?}", rd(p[0], 32).0);
        println!("{:?}", rd(p[0], 32).0);
    }
    close(p[0]);
    close(p[1]);
}

/// Non-blocking at end of file is 0, not EAGAIN; a non-blocking write with no peer is EPIPE.
fn non_blocking_eof() {
    let p = pipe_with(libc::O_NONBLOCK);
    println!("{:?}", wr(p[1], b"ab"));
    close(p[1]);
    println!("{:?} {:?} {:?}", rd(p[0], 1), rd(p[0], 9), rd(p[0], 9));
    close(p[0]);
    let s = socket_pair(libc::SOCK_NONBLOCK);
    close(s[1]);
    println!("{:?} {:?}", rd(s[0], 9), wr(s[0], b"x"));
    close(s[0]);
}

/// Two readers blocked at once: the first write wakes both (and must clear the list), and the second finds nobody blocked.
fn two_readers() {
    let p = pipe_with(0);
    let t1 = thread::spawn(move || println!("a {:?}", rd(p[0], 2)));
    let t2 = thread::spawn(move || println!("b {:?}", rd(p[0], 2)));
    spin(5);
    println!("{:?}", wr(p[1], b"xy"));
    spin(5);
    println!("{:?}", wr(p[1], b"zw"));
    t1.join().unwrap();
    t2.join().unwrap();
    close(p[0]);
    close(p[1]);
}

/// Two writers blocked at once, on a full buffer: the same for the writers' list.
fn two_writers() {
    let p = pipe_with(0);
    let big = vec![1u8; 0x34000];
    println!("{:?}", wr(p[1], &big));
    let t1 = thread::spawn(move || println!("a {:?}", wr(p[1], b"aaa")));
    let t2 = thread::spawn(move || println!("b {:?}", wr(p[1], b"bbb")));
    spin(5);
    println!("{:?}", rd(p[0], 2).0);
    spin(5);
    println!("{:?}", rd(p[0], 4).0);
    t1.join().unwrap();
    t2.join().unwrap();
    close(p[0]);
    close(p[1]);
}

fn main() {
    unix_stream();
    shim_paths();
    small_first_writes();
    non_blocking_eof();
    two_readers();
    two_writers();
}

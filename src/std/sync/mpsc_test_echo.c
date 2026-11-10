// Test fixture for mpsc.test.ts (not an upstream mirror): a native thread body that uses the client end of a pair
// of src/std/thread.c channels, as proc_macro_host.c's cross-thread client does. Messages are 2 words.
//
// echo_main: receives messages on `rx` until the sender disconnects, sends each back on `tx` with word 1
// incremented, counts them in `out`, then drops both ends.

typedef unsigned long u64;
void *malloc(unsigned long size);
void free(void *p);

typedef int (*send_fn)(void *chan, const u64 *msg);
typedef int (*recv_fn)(void *chan, u64 *out);
typedef void (*drop_fn)(void *chan);

typedef struct {
  void *tx;
  void *rx;
  send_fn send;
  recv_fn recv;
  drop_fn drop_sender;
  drop_fn drop_receiver;
  u64 out;
  int send_failed;
} Echo;

static void *echo_main(void *arg) {
  Echo *e = (Echo *)arg;
  u64 msg[2];
  while (e->recv(e->rx, msg) == 0) {
    msg[1] += 1;
    if (e->send(e->tx, msg) != 0) {
      e->send_failed = 1;
      break;
    }
    e->out++;
  }
  e->drop_sender(e->tx);
  e->drop_receiver(e->rx);
  return 0;
}

Echo *echo_new(void *tx, void *rx, void **fns) {
  Echo *e = (Echo *)malloc(sizeof(Echo));
  e->tx = tx;
  e->rx = rx;
  e->send = (send_fn)fns[0];
  e->recv = (recv_fn)fns[1];
  e->drop_sender = (drop_fn)fns[2];
  e->drop_receiver = (drop_fn)fns[3];
  e->out = 0;
  e->send_failed = 0;
  return e;
}

void *echo_start(void) {
  return (void *)echo_main;
}

/// After join: the number of messages echoed (negative if a send failed); frees the state.
long echo_finish(Echo *e) {
  long n = e->send_failed ? -(long)e->out - 1 : (long)e->out;
  free(e);
  return n;
}

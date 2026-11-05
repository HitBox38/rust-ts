// jobserver.oracle.test.ts's subject: `initialize` alone, in a fresh process, so the real environment and descriptor
// table are what it reads. Prints what it reports.
import { initialize } from "../jobserver.ts";
initialize(1, (err) => console.log(err));

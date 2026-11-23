// `agentphoto` binary entry.
import { main } from "./cli";
import { routeConsoleToStderr } from "./output";
import { closeEngineSessions } from "./render/session";

// process.exit() drops what stdout / stderr still hold when they are pipes
// (a large --json result read by a script was cut short). Exit once both have
// flushed: a write's callback runs after every write queued before it.
function exitWhenFlushed(code: number): void {
  let pending = 2;
  const done = () => {
    if (--pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
}

// Code loaded in a session (libraries, the engine host) must not write on
// stdout (--json, mcp).
routeConsoleToStderr();
// A command that used the headless engine leaves Chrome running (it is
// reused within the process): close it gracefully so its temp profile is
// removed, then exit.
const finish = (code: number) =>
  void closeEngineSessions()
    .catch(() => undefined)
    .finally(() => exitWhenFlushed(code));
main(process.argv.slice(2)).then(finish, (err) => {
  console.error(err);
  finish(1);
});

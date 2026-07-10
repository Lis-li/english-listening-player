const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const runtime = process.argv[2];
const port = process.argv[3] || "8765";

if (!runtime) {
  console.error("Usage: node start_server.js <python.exe> [port]");
  process.exit(1);
}

const stdout = fs.openSync(path.join(root, "server.stdout.log"), "a");
const stderr = fs.openSync(path.join(root, "server.stderr.log"), "a");
const script = path.join(root, "server.py");

const child = spawn(runtime, [script, "--port", port], {
  cwd: root,
  detached: true,
  stdio: ["ignore", stdout, stderr],
  windowsHide: true
});

child.unref();
console.log(child.pid);

/* global console, process */

import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["run", script], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${script} exited with code ${code ?? "unknown"}`));
    });
  });
}

function start(script) {
  return spawn(command, ["run", script], { stdio: "inherit" });
}

await run("db:migrate:local");
await run("build");

const assetWatcher = start("build:watch");
const worker = start("dev:worker");
const children = [assetWatcher, worker];
let shuttingDown = false;

function stop(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => child.kill(signal));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}

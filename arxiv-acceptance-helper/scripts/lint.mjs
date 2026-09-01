import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return javascriptFiles(path);
    return /\.(?:m?js)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(["src", "scripts", "tests"].map(javascriptFiles))).flat();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

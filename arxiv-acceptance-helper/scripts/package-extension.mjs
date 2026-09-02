import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const dist = new URL("dist/", root);
const stage = new URL(`arxiv-lens-${manifest.version}/`, dist);

await rm(dist, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const path of ["manifest.json", "src", "vendor", "icons"]) {
  await cp(new URL(path, root), new URL(path, stage), { recursive: true });
}
await rm(new URL("icons/icon-master.png", stage), { force: true });

const output = fileURLToPath(new URL(`arxiv-lens-${manifest.version}.zip`, dist));
execFileSync("zip", ["-qr", output, "."], { cwd: fileURLToPath(stage) });
console.log(output);

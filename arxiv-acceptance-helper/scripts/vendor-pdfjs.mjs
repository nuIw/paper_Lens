import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
for (const [source, destination] of [
  ["../node_modules/pdfjs-dist/build/pdf.mjs", "../vendor/pdf.mjs"],
  ["../node_modules/pdfjs-dist/build/pdf.worker.mjs", "../vendor/pdf.worker.mjs"],
  ["../node_modules/pdfjs-dist/LICENSE", "../vendor/LICENSE.pdfjs"],
]) {
  await copyFile(new URL(source, import.meta.url), new URL(destination, import.meta.url));
}

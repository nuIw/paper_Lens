import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (manifest.background?.type !== "module") throw new Error("service worker must be a module");

const required = [
  "manifest.json",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((script) => script.js),
  ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
  ...Object.values(manifest.icons ?? {}),
  "vendor/LICENSE.pdfjs",
];
await Promise.all([...new Set(required)].map((path) => access(new URL(path, root))));

if (manifest.incognito !== "not_allowed") throw new Error("incognito access must remain disabled");

const allowedPermissions = new Set(["storage"]);
if (manifest.permissions.some((permission) => !allowedPermissions.has(permission))) {
  throw new Error("manifest requests an unexpected Chrome permission");
}
if (manifest.optional_permissions?.length !== 1 || manifest.optional_permissions[0] !== "downloads") {
  throw new Error("downloads must be the only optional Chrome permission");
}

const allowedHosts = new Set([
  "https://arxiv.org/*",
  "https://dblp.org/*",
  "https://api.crossref.org/*",
  "https://api.semanticscholar.org/*",
  "https://api2.openreview.net/*",
  "https://api.openreview.net/*",
  "https://openaccess.thecvf.com/*",
  "https://aclanthology.org/*",
  "https://proceedings.mlr.press/*",
  "https://proceedings.neurips.cc/*",
]);
if (manifest.host_permissions.some((host) => !allowedHosts.has(host))) {
  throw new Error("manifest requests an unexpected host permission");
}
if (manifest.optional_host_permissions?.length !== 1
  || manifest.optional_host_permissions[0] !== "https://api.github.com/*") {
  throw new Error("GitHub must be the only optional host permission");
}

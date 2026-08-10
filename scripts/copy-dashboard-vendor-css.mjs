import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const targets = [
  ["node_modules/highlight.js/styles/github-dark.min.css", "dashboard/dist/vendor-hljs.css"],
  ["node_modules/uplot/dist/uPlot.min.css", "dashboard/dist/vendor-uplot.css"],
];

for (const [src, dst] of targets) {
  mkdirSync(dirname(resolve(dst)), { recursive: true });
  copyFileSync(resolve(src), resolve(dst));
  console.log(`copied ${src} → ${dst}`);
}

// Keep enough package metadata for the desktop sidecar to resolve its version
// while also marking the generated CLI bundle as ESM.
const cliMarker = resolve("dist/cli/package.json");
const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
mkdirSync(dirname(cliMarker), { recursive: true });
writeFileSync(
  cliMarker,
  `${JSON.stringify(
    { name: rootPackage.name, version: rootPackage.version, type: "module" },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${cliMarker}`);

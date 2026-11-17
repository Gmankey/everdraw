import fs from "node:fs";

const packageFile = new URL("../node_modules/nextra-theme-docs/package.json", import.meta.url);
const schemaFile = new URL("../node_modules/nextra-theme-docs/dist/schemas.js", import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
if (packageJson.version !== "4.6.1") {
  throw new Error(`Unsupported nextra-theme-docs version ${packageJson.version}; review the Zod compatibility patch`);
}
const source = fs.readFileSync(schemaFile, "utf8");
const original = "  children: reactNode,";
const patched = "  children: reactNode.optional(),";
if (source.includes(patched)) process.exit(0);
if (!source.includes(original)) throw new Error("Nextra Layout children schema no longer matches the reviewed source");
fs.writeFileSync(schemaFile, source.replace(original, patched));

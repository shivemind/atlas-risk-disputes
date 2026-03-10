import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const specPath = resolve("openapi/openapi.yaml");
const spec = readFileSync(specPath, "utf-8");

let errors = 0;

if (!spec.includes("openapi:")) {
  console.error("ERROR: Missing openapi version field.");
  errors++;
}

if (!spec.includes("info:")) {
  console.error("ERROR: Missing info section.");
  errors++;
}

if (!spec.includes("paths:")) {
  console.error("ERROR: Missing paths section.");
  errors++;
}

const securitySchemes = ["MerchantKeyAuth"];
for (const scheme of securitySchemes) {
  if (!spec.includes(scheme)) {
    console.error(`ERROR: Missing security scheme: ${scheme}`);
    errors++;
  }
}

const operationIdRegex = /operationId:\s*(\S+)/g;
const operationIds = new Set();
let match;
while ((match = operationIdRegex.exec(spec)) !== null) {
  const id = match[1];
  if (operationIds.has(id)) {
    console.error(`ERROR: Duplicate operationId: ${id}`);
    errors++;
  }
  operationIds.add(id);
}

if (errors > 0) {
  console.error(`\nValidation failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log(`OpenAPI spec validated: ${operationIds.size} operations, 0 errors.`);
}

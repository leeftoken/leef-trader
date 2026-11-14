import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// package.json has "type": "module", so Vercel runs api/*.ts as native ESM.
// Node ESM needs the file extension on relative imports; without it every
// function crashes with ERR_MODULE_NOT_FOUND (FUNCTION_INVOCATION_FAILED).
describe("api functions", () => {
  const dir = join(process.cwd(), "api");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("finds the api files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s uses .js on relative imports", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    const bad = [...src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)]
      .map((m) => m[1])
      .filter((spec) => !spec.endsWith(".js"));
    expect(bad).toEqual([]);
  });
});

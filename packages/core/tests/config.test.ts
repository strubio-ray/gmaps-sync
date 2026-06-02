import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-config-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default config when no config file exists", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.headless).toBe(true);
    expect(config.sync.maxConsecutiveFailures).toBe(2);
    expect(config.enrichment.reEnrichAfterDays).toBe(30);
  });

  it("does not have profiles", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config).not.toHaveProperty("profiles");
  });

  it("merges partial config with defaults", () => {
    const partial = { headless: false, enrichment: { reEnrichAfterDays: 7 } };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(partial));
    const config = loadConfig(join(tempDir, "config.json"));
    expect(config.headless).toBe(false);
    expect(config.enrichment.reEnrichAfterDays).toBe(7);
    expect(config.sync.maxConsecutiveFailures).toBe(2);
  });
});

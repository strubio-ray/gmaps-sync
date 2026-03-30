import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveProfilePaths, DEFAULT_CONFIG } from "../src/config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-sync-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default config when no config file exists", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", () => {
    const partial = { headless: false };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(partial));
    const config = loadConfig(join(tempDir, "config.json"));
    expect(config.headless).toBe(false);
    expect(config.sync.intervalHours).toBe(DEFAULT_CONFIG.sync.intervalHours);
  });
});

describe("resolveProfilePaths", () => {
  it("resolves default profile paths from base dir", () => {
    const paths = resolveProfilePaths("/home/user/.gmaps-sync", "default");
    expect(paths.browserProfileDir).toBe(
      "/home/user/.gmaps-sync/profiles/default/browser",
    );
    expect(paths.dataDir).toBe(
      "/home/user/.gmaps-sync/profiles/default/data",
    );
  });

  it("uses custom paths from config when present", () => {
    const paths = resolveProfilePaths("/base", "default", {
      browserProfileDir: "/custom/browser",
      dataDir: "/custom/data",
    });
    expect(paths.browserProfileDir).toBe("/custom/browser");
    expect(paths.dataDir).toBe("/custom/data");
  });
});

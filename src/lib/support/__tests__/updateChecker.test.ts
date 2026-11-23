import { describe, it, expect, vi } from "vitest";
import {
  compareVersions,
  parseSemver,
  getPlatformDownloadInfo,
  checkForUpdates,
} from "../updateChecker";

describe("updateChecker - semver parser & comparison", () => {
  it("parses valid semver versions", () => {
    expect(parseSemver("0.1.5")).toEqual({ major: 0, minor: 1, patch: 5, prerelease: undefined });
    expect(parseSemver("v0.1.4")).toEqual({ major: 0, minor: 1, patch: 4, prerelease: undefined });
    expect(parseSemver("v1.0.0-beta.2")).toEqual({ major: 1, minor: 0, patch: 0, prerelease: "beta.2" });
  });

  it("compares semver versions accurately", () => {
    // Greater
    expect(compareVersions("0.1.5", "0.1.4")).toBeGreaterThan(0);
    expect(compareVersions("v0.2.0", "v0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.5", "0.1.5-beta.1")).toBeGreaterThan(0);

    // Lesser
    expect(compareVersions("0.1.4", "0.1.5")).toBeLessThan(0);
    expect(compareVersions("0.1.4", "v0.1.5")).toBeLessThan(0);
    expect(compareVersions("0.1.5-beta.1", "0.1.5")).toBeLessThan(0);

    // Equal
    expect(compareVersions("0.1.5", "0.1.5")).toBe(0);
    expect(compareVersions("v0.1.5", "0.1.5")).toBe(0);
  });

  it("resolves platform download deliverables with valid URLs", () => {
    const info = getPlatformDownloadInfo("v0.1.4");
    expect(info.downloadUrl).toContain("sourceforge.net/projects/teledrive/files/v0.1.4/");
    expect(info.platformName.length).toBeGreaterThan(0);
  });

  it("detects updates when latest GitHub release is newer", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.6",
        name: "TeleDrive v0.1.6 Release",
        body: "### Changes\n- Bug fixes and improvements",
        html_url: "https://github.com/senapati484/teledrive/releases/tag/v0.1.6",
        published_at: "2026-11-23T12:00:00Z",
      }),
    });

    const result = await checkForUpdates("0.1.5", mockFetch as any);
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("0.1.6");
    expect(result.releaseName).toBe("TeleDrive v0.1.6 Release");
    expect(result.platformDownloadUrl).toContain("v0.1.6");
  });

  it("reports up to date when current version is equal or newer", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.4",
        name: "TeleDrive v0.1.4 Release",
        body: "Previous release notes",
        html_url: "https://github.com/senapati484/teledrive/releases/tag/v0.1.4",
      }),
    });

    const result = await checkForUpdates("0.1.5", mockFetch as any);
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(false);
    expect(result.currentVersion).toBe("0.1.5");
    expect(result.latestVersion).toBe("0.1.4");
  });

  it("falls back to SourceForge RSS if GitHub fails", async () => {
    const mockFetch = vi
      .fn()
      // First call (GitHub) fails
      .mockRejectedValueOnce(new Error("GitHub API rate limit exceeded"))
      // Second call (SourceForge) succeeds
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `<rss><channel><item><title>/v0.1.7/teledrive.dmg</title></item></channel></rss>`,
      });

    const result = await checkForUpdates("0.1.5", mockFetch as any);
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("0.1.7");
  });

  it("handles offline state gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network offline"));

    const result = await checkForUpdates("0.1.5", mockFetch as any);
    expect(result.success).toBe(false);
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

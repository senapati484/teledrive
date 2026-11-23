import { logger } from "@/lib/logger";
import { getPlatform } from "@/lib/platform";
import { isMac, isWindows, isLinux } from "@/lib/os";

export const GITHUB_REPO = "senapati484/teledrive";
export const GITHUB_API_LATEST_RELEASE = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const SOURCEFORGE_PROJECT = "teledrive";
export const SOURCEFORGE_BASE_URL = `https://sourceforge.net/projects/${SOURCEFORGE_PROJECT}/files`;
export const SOURCEFORGE_RSS_URL = `https://sourceforge.net/projects/${SOURCEFORGE_PROJECT}/rss?path=/`;

export interface PlatformDownloadInfo {
  platformId: "macos" | "windows" | "linux" | "android" | "ios" | "unknown";
  platformName: string;
  fileName: string;
  downloadUrl: string;
}

export interface UpdateCheckResult {
  success: boolean;
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt?: string;
  githubReleaseUrl: string;
  sourceforgeUrl: string;
  platformDownloadUrl: string;
  platformName: string;
  error?: string;
}

/**
 * Normalizes a semver string (e.g. "v0.1.5", "0.1.5", "v0.1.5-beta.1") into numeric components.
 */
export function parseSemver(version: string): { major: number; minor: number; patch: number; prerelease?: string } {
  const clean = version.trim().replace(/^v/i, "");
  const [core, prerelease] = clean.split("-", 2);
  const parts = core.split(".").map((p) => parseInt(p, 10) || 0);

  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    prerelease,
  };
}

/**
 * Compares two semantic version strings.
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, and 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  // If core numbers match, a version with NO prerelease is higher than one with a prerelease
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }

  return 0;
}

/**
 * Detects client OS and architecture to construct the direct SourceForge and GitHub deliverable URLs.
 */
export function getPlatformDownloadInfo(versionTag: string): PlatformDownloadInfo {
  const tag = versionTag.startsWith("v") ? versionTag : `v${versionTag}`;
  const runtimePlatform = getPlatform();

  if (runtimePlatform === "android") {
    return {
      platformId: "android",
      platformName: "Android (.apk)",
      fileName: "teledrive.apk",
      downloadUrl: `${SOURCEFORGE_BASE_URL}/${tag}/teledrive.apk/download`,
    };
  }

  if (runtimePlatform === "ios") {
    return {
      platformId: "ios",
      platformName: "iOS (.ipa)",
      fileName: "teledrive.ipa",
      downloadUrl: `${SOURCEFORGE_BASE_URL}/${tag}/teledrive.ipa/download`,
    };
  }

  if (isMac()) {
    return {
      platformId: "macos",
      platformName: "macOS (.dmg)",
      fileName: "teledrive.dmg",
      downloadUrl: `${SOURCEFORGE_BASE_URL}/${tag}/teledrive.dmg/download`,
    };
  }

  if (isWindows()) {
    return {
      platformId: "windows",
      platformName: "Windows (.exe)",
      fileName: "teledrive-setup.exe",
      downloadUrl: `${SOURCEFORGE_BASE_URL}/${tag}/teledrive-setup.exe/download`,
    };
  }

  if (isLinux()) {
    return {
      platformId: "linux",
      platformName: "Linux (.AppImage)",
      fileName: "teledrive.AppImage",
      downloadUrl: `${SOURCEFORGE_BASE_URL}/${tag}/teledrive.AppImage/download`,
    };
  }

  // Fallback to SourceForge directory
  return {
    platformId: "unknown",
    platformName: "Direct Download",
    fileName: "",
    downloadUrl: `${SOURCEFORGE_BASE_URL}/${tag}/`,
  };
}

/**
 * Checks for available TeleDrive updates by querying GitHub Releases API
 * with automatic fallback to SourceForge release feeds.
 */
export async function checkForUpdates(
  currentVersion: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<UpdateCheckResult> {
  const cleanCurrent = currentVersion.replace(/^v/i, "").trim();

  // 1. Primary: Attempt GitHub Releases API
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetchFn(GITHUB_API_LATEST_RELEASE, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const rawTag = (data.tag_name || "").trim();
      const cleanLatest = rawTag.replace(/^v/i, "");

      if (cleanLatest) {
        const hasUpdate = compareVersions(cleanLatest, cleanCurrent) > 0;
        const platformInfo = getPlatformDownloadInfo(rawTag);

        return {
          success: true,
          hasUpdate,
          currentVersion: cleanCurrent,
          latestVersion: cleanLatest,
          releaseName: data.name || `TeleDrive ${rawTag}`,
          releaseNotes: data.body || "",
          publishedAt: data.published_at || data.created_at,
          githubReleaseUrl: data.html_url || `${GITHUB_RELEASES_URL}/tag/${rawTag}`,
          sourceforgeUrl: `${SOURCEFORGE_BASE_URL}/${rawTag}/`,
          platformDownloadUrl: platformInfo.downloadUrl,
          platformName: platformInfo.platformName,
        };
      }
    }
  } catch (err: any) {
    logger.warn("[UpdateChecker] GitHub API check failed, falling back to SourceForge RSS:", err?.message || err);
  }

  // 2. Secondary Fallback: Attempt SourceForge RSS feed
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetchFn(SOURCEFORGE_RSS_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const text = await res.text();
      // Match folder pattern like `/v0.1.4/` or `/v0.1.5/`
      const match = text.match(/\/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\//);
      if (match && match[1]) {
        const cleanLatest = match[1];
        const rawTag = `v${cleanLatest}`;
        const hasUpdate = compareVersions(cleanLatest, cleanCurrent) > 0;
        const platformInfo = getPlatformDownloadInfo(rawTag);

        return {
          success: true,
          hasUpdate,
          currentVersion: cleanCurrent,
          latestVersion: cleanLatest,
          releaseName: `TeleDrive ${rawTag}`,
          releaseNotes: `New release ${rawTag} available on SourceForge and GitHub.`,
          githubReleaseUrl: `${GITHUB_RELEASES_URL}/tag/${rawTag}`,
          sourceforgeUrl: `${SOURCEFORGE_BASE_URL}/${rawTag}/`,
          platformDownloadUrl: platformInfo.downloadUrl,
          platformName: platformInfo.platformName,
        };
      }
    }
  } catch (err: any) {
    logger.error("[UpdateChecker] SourceForge fallback check also failed:", err?.message || err);
  }

  // If both failed, return graceful failure
  return {
    success: false,
    hasUpdate: false,
    currentVersion: cleanCurrent,
    latestVersion: cleanCurrent,
    releaseName: "",
    releaseNotes: "",
    githubReleaseUrl: GITHUB_RELEASES_URL,
    sourceforgeUrl: SOURCEFORGE_BASE_URL,
    platformDownloadUrl: GITHUB_RELEASES_URL,
    platformName: "Releases",
    error: "Unable to reach update servers. Please check your internet connection.",
  };
}

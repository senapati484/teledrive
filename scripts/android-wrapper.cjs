const { spawnSync } = require("child_process");
const fs = require("fs");

const env = { ...process.env };

// If JAVA_HOME is not explicitly set to a valid JDK or points to an incompatible version (like Java 26+),
// automatically discover and use installed OpenJDK 21 or 17.
const candidateJdkPaths = [
  "/opt/homebrew/opt/openjdk@21",
  "/opt/homebrew/opt/openjdk@17",
  "/usr/local/opt/openjdk@21",
  "/usr/local/opt/openjdk@17",
  "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
  "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home",
];

if (!env.JAVA_HOME) {
  for (const candidate of candidateJdkPaths) {
    if (fs.existsSync(candidate)) {
      env.JAVA_HOME = candidate;
      env.PATH = `${candidate}/bin:${env.PATH}`;
      break;
    }
  }
}

const args = process.argv.slice(2);
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(cmd, ["tauri", "android", ...args], {
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 0);

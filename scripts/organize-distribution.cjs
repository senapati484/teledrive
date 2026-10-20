#!/usr/bin/env node

/**
 * scripts/organize-distribution.cjs
 *
 * Scans build outputs across platforms, organizes deliverables under `distribution/v<version>/`
 * with standardized canonical names (`teledrive.<ext>` / `teledrive-setup.exe`), prevents
 * duplicates, and generates a SHA256 checksum manifest.
 *
 * Usage:
 *   node scripts/organize-distribution.cjs [version]
 *   npm run dist
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const specifiedVersion = process.argv[2];
const versionTag = specifiedVersion
  ? (specifiedVersion.startsWith('v') ? specifiedVersion : `v${specifiedVersion}`)
  : `v${pkg.version}`;

const distRootDir = path.join(rootDir, 'distribution');
const targetVersionDir = path.join(distRootDir, versionTag);

if (!fs.existsSync(distRootDir)) {
  fs.mkdirSync(distRootDir, { recursive: true });
}
if (!fs.existsSync(targetVersionDir)) {
  fs.mkdirSync(targetVersionDir, { recursive: true });
}

console.log('================================================================');
console.log(`📦 TeleDrive Distribution Organizer — Target: ${versionTag}`);
console.log(`📁 Destination: ${targetVersionDir}`);
console.log('================================================================\n');

/**
 * Clean up legacy or loose duplicate files at the root of `distribution/`
 */
function cleanLooseRootDuplicates() {
  const rootFiles = fs.readdirSync(distRootDir);
  let cleanedCount = 0;

  for (const f of rootFiles) {
    const fullPath = path.join(distRootDir, f);
    if (!fs.statSync(fullPath).isFile()) continue;

    // Delete redundant TeleDrive_0.x.x duplicate files left over at root
    if (f.startsWith('TeleDrive_') || f.startsWith('TeleDrive-')) {
      fs.unlinkSync(fullPath);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} duplicate/legacy file(s) from distribution root.\n`);
  }
}

/**
 * Recursively find files matching filter in directory
 */
function findFiles(dir, filterFn) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (filterFn(entry.name, full)) {
          results.push(full);
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Pick the best (usually most recently modified) file from candidates
 */
function pickBest(files) {
  if (!files || files.length === 0) return null;
  if (files.length === 1) return files[0];

  return files.slice().sort((a, b) => {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    return statB.mtimeMs - statA.mtimeMs;
  })[0];
}

/**
 * Calculate SHA256 of a file
 */
function getSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Search locations for build outputs
 */
const searchDirs = [
  path.join(rootDir, 'src-tauri', 'target'),
  path.join(rootDir, 'release-dist'),
  path.join(rootDir, 'buildfiles')
];

cleanLooseRootDuplicates();

const deliverables = [
  {
    type: 'macOS DMG',
    canonicalName: 'teledrive.dmg',
    matcher: (name, full) => {
      if (!name.endsWith('.dmg')) return false;
      if (name.startsWith('rw.')) return false; // Ignore tmp read-write images
      return true;
    }
  },
  {
    type: 'Windows NSIS Setup',
    canonicalName: 'teledrive-setup.exe',
    matcher: (name, full) => {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.exe')) return false;
      return lower.includes('setup') || lower.endsWith('-setup.exe');
    }
  },
  {
    type: 'Windows MSI',
    canonicalName: 'teledrive.msi',
    matcher: (name, full) => {
      return name.toLowerCase().endsWith('.msi');
    }
  },
  {
    type: 'Linux Debian (.deb)',
    canonicalName: 'teledrive.deb',
    matcher: (name, full) => {
      return name.toLowerCase().endsWith('.deb');
    }
  },
  {
    type: 'Linux RPM (.rpm)',
    canonicalName: 'teledrive.rpm',
    matcher: (name, full) => {
      return name.toLowerCase().endsWith('.rpm');
    }
  },
  {
    type: 'Linux AppImage',
    canonicalName: 'teledrive.AppImage',
    matcher: (name, full) => {
      return name.endsWith('.AppImage');
    }
  },
  {
    type: 'Android APK',
    canonicalName: 'teledrive.apk',
    matcher: (name, full) => {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.apk')) return false;
      // Prefer release over debug
      return lower.includes('release') || !lower.includes('debug');
    }
  },
  {
    type: 'iOS Simulator',
    canonicalName: 'teledrive-ios-simulator.zip',
    matcher: (name, full) => {
      const lower = name.toLowerCase();
      return lower.includes('simulator') && lower.endsWith('.zip');
    }
  },
  {
    type: 'iOS IPA',
    canonicalName: 'teledrive.ipa',
    matcher: (name, full) => {
      return name.toLowerCase().endsWith('.ipa');
    }
  }
];

let copiedCount = 0;
const checksumManifest = [];

for (const item of deliverables) {
  const destPath = path.join(targetVersionDir, item.canonicalName);
  let found = [];

  for (const sDir of searchDirs) {
    found = found.concat(findFiles(sDir, item.matcher));
  }

  // Also check if already present in targetVersionDir
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    const hash = getSha256(destPath);
    checksumManifest.push(`${hash}  ${item.canonicalName}`);
    console.log(`  ✓ ${item.canonicalName.padEnd(20)} [${item.type}] - ${sizeMb} MB (already in ${versionTag})`);
    continue;
  }

  const bestCandidate = pickBest(found);
  if (bestCandidate) {
    fs.copyFileSync(bestCandidate, destPath);
    copiedCount++;
    const stat = fs.statSync(destPath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    const hash = getSha256(destPath);
    checksumManifest.push(`${hash}  ${item.canonicalName}`);
    console.log(`  + ${item.canonicalName.padEnd(20)} [${item.type}] - ${sizeMb} MB (from ${path.relative(rootDir, bestCandidate)})`);
  } else {
    console.log(`  - ${item.canonicalName.padEnd(20)} [${item.type}] - Not found in local build targets`);
  }
}

// Write SHA256SUMS.txt
if (checksumManifest.length > 0) {
  const sumsPath = path.join(targetVersionDir, 'SHA256SUMS.txt');
  fs.writeFileSync(sumsPath, checksumManifest.join('\n') + '\n', 'utf8');
  console.log(`\n📝 Generated SHA256 manifest -> ${path.relative(rootDir, sumsPath)}`);
}

// Print overall status of distribution folder
console.log('\n================================================================');
console.log('📊 Current Distribution Contents:');
console.log('================================================================');

const versions = fs.readdirSync(distRootDir).filter((entry) => {
  return fs.statSync(path.join(distRootDir, entry)).isDirectory() && entry.startsWith('v');
}).sort();

for (const v of versions) {
  const vPath = path.join(distRootDir, v);
  const files = fs.readdirSync(vPath).filter(f => f !== '.DS_Store');
  console.log(`📁 distribution/${v}/ (${files.length} items):`);
  let totalBytes = 0;
  for (const f of files) {
    const fPath = path.join(vPath, f);
    const sz = fs.statSync(fPath).size;
    totalBytes += sz;
    const mb = (sz / (1024 * 1024)).toFixed(2);
    console.log(`     • ${f.padEnd(24)} ${mb.padStart(7)} MB`);
  }
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`     Total: ${totalMb} MB\n`);
}

console.log('================================================================');
console.log('🎉 Done! Files are organized with canonical names and no duplicates.');
console.log('⚠️  Note: `distribution/` is in .gitignore and won\'t be pushed to git.');
console.log('================================================================\n');

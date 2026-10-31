const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const versionTag = `v${pkg.version}`;
const distDir = path.join(rootDir, 'distribution', versionTag);
const isWindows = process.platform === 'win32';

console.log('======================================================');
console.log(`   TeleDrive Windows Executable & Installer Builder   `);
console.log(`   Target Version: ${versionTag}                     `);
console.log('======================================================\n');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Compile frontend
console.log('[1/3] Building frontend bundle (Vite)...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

// 2. Compile Tauri Windows binary & installer
console.log('\n[2/3] Building Windows binaries with Tauri...');

if (isWindows) {
  // On native Windows: build both NSIS and MSI installers
  execSync('npx tauri build --bundles nsis,msi', { cwd: rootDir, stdio: 'inherit' });
} else {
  // On macOS / Linux:
  console.log(`\nℹ️  Detected current OS: ${process.platform}`);
  console.log('ℹ️  Attempting Windows cross-compilation (x86_64-pc-windows-msvc)...');
  
  try {
    execSync('npx tauri build --target x86_64-pc-windows-msvc --bundles nsis', { cwd: rootDir, stdio: 'inherit' });
  } catch {
    console.log('\n------------------------------------------------------');
    console.log('⚠️  Notice on Cross-Compiling Windows .exe from Mac/Linux:');
    console.log('Tauri and Rust native Windows linking require the Windows MSVC SDK or MinGW.');
    console.log('\nRecommended options to get your teledrive-setup.exe:');
    console.log('1. Run `npm run build:exe` directly on any Windows PC.');
    console.log('2. Trigger the GitHub Actions release workflow (.github/workflows/release.yml),');
    console.log('   which automatically builds the Windows .exe on GitHub\'s Windows servers!');
    console.log('------------------------------------------------------\n');
    process.exit(1);
  }
}

// 3. Locate generated exe and msi in target release directories
console.log(`\n[3/3] Locating and packaging Windows executables into distribution/${versionTag}/ ...`);

// Search paths for NSIS installers, MSI installers, and standalone binaries
const searchRoots = [
  path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis'),
  path.join(rootDir, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release', 'bundle', 'nsis'),
  path.join(rootDir, 'src-tauri', 'target', 'x86_64-pc-windows-gnu', 'release', 'bundle', 'nsis'),
  path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'msi'),
  path.join(rootDir, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release', 'bundle', 'msi'),
  path.join(rootDir, 'src-tauri', 'target', 'x86_64-pc-windows-gnu', 'release', 'bundle', 'msi'),
  path.join(rootDir, 'src-tauri', 'target', 'release'),
  path.join(rootDir, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release'),
  path.join(rootDir, 'src-tauri', 'target', 'x86_64-pc-windows-gnu', 'release')
];

let installerCopied = false;
let msiCopied = false;

for (const dir of searchRoots) {
  if (!fs.existsSync(dir)) continue;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (!fs.statSync(fullPath).isFile()) continue;

    if (file.toLowerCase().endsWith('-setup.exe') || (file.toLowerCase().endsWith('.exe') && file.toLowerCase().includes('setup'))) {
      const targetPath = path.join(distDir, 'teledrive-setup.exe');
      fs.copyFileSync(fullPath, targetPath);
      const sizeMb = (fs.statSync(targetPath).size / (1024 * 1024)).toFixed(2);
      console.log(`✅ Copied NSIS installer -> ${targetPath} (${sizeMb} MB)`);
      installerCopied = true;
    } else if (file.toLowerCase().endsWith('.msi')) {
      const targetPath = path.join(distDir, 'teledrive.msi');
      fs.copyFileSync(fullPath, targetPath);
      const sizeMb = (fs.statSync(targetPath).size / (1024 * 1024)).toFixed(2);
      console.log(`✅ Copied MSI installer  -> ${targetPath} (${sizeMb} MB)`);
      msiCopied = true;
    }
  }
}

if (!installerCopied && !msiCopied) {
  console.log('⚠️ Could not find generated .exe or .msi in standard bundle directories.');
} else {
  console.log('\n======================================================');
  console.log('🎉 Windows build packaging complete!');
  console.log(`📁 Check output files in \`distribution/${versionTag}/\``);
  console.log('======================================================');
}

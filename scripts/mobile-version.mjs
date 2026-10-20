// Single source of truth for the app version: package.json "version" + a build number.
// Writes versionName/versionCode into android/app/build.gradle and
// MARKETING_VERSION/CURRENT_PROJECT_VERSION into the Xcode project (all targets).
// Usage: MOBILE_BUILD_NUMBER=7 node scripts/mobile-version.mjs   (or: node scripts/mobile-version.mjs 7)
// Without a build number the existing one is kept.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GRADLE = 'android/app/build.gradle';
const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';

export function parseVersion(v) {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v.trim())) {
    throw new Error(`Invalid version "${v}": expected MAJOR.MINOR.PATCH (e.g. 1.0.0)`);
  }
  return v.trim();
}

export function parseBuildNumber(n) {
  const s = String(n ?? '').trim();
  if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 2100000000) {
    throw new Error(`Invalid build number "${n}": expected an integer between 1 and 2100000000`);
  }
  return Number(s);
}

export function applyGradleVersion(src, version, build) {
  const out = src
    .replace(/^(\s*)versionCode\s+\d+/m, `$1versionCode ${build}`)
    .replace(/^(\s*)versionName\s+"[^"]*"/m, `$1versionName "${version}"`);
  if (!/versionCode\s+\d+/.test(src) || !/versionName\s+"/.test(src)) {
    throw new Error('versionCode/versionName not found in build.gradle');
  }
  return out;
}

export function applyPbxprojVersion(src, version, build) {
  // Only these two settings are touched, in every build configuration (App + extensions).
  return src
    .replace(/(MARKETING_VERSION = )[^;]+;/g, `$1${version};`)
    .replace(/(CURRENT_PROJECT_VERSION = )[^;]+;/g, `$1${build};`);
}

export function readCurrentBuild(gradleSrc) {
  const m = gradleSrc.match(/versionCode\s+(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const version = parseVersion(pkg.version);
  const gradle = readFileSync(GRADLE, 'utf8');
  const raw = process.argv[2] ?? process.env.MOBILE_BUILD_NUMBER;
  const build = raw ? parseBuildNumber(raw) : (readCurrentBuild(gradle) ?? 1);

  writeFileSync(GRADLE, applyGradleVersion(gradle, version, build));
  if (existsSync(PBXPROJ)) {
    writeFileSync(PBXPROJ, applyPbxprojVersion(readFileSync(PBXPROJ, 'utf8'), version, build));
  }
  console.log(`Mobile version ${version} (build ${build})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

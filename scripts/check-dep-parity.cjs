#!/usr/bin/env node
/**
 * Build guard: keep the backend's runtime dependencies in sync between the two installs.
 *
 * The packaged Electron app bundles ONLY the root node_modules (electron-builder's `files`),
 * but `npm run dev` runs the backend against backend/node_modules. These are two independent
 * installs with two lockfiles, so a shared runtime dep can silently drift — which is exactly
 * what caused the ticker-search bug: root shipped yahoo-finance2 3.14.0 (stale JSON schema →
 * "Failed Yahoo Schema validation" → empty results) while dev ran 3.15.2.
 *
 * This runs at the start of `npm run build` (so it covers `npm start`, `npm run dist`, and CI).
 * It compares the *installed* versions of every dependency the backend declares and fails the
 * build on any mismatch, so a drift can never reach a release unnoticed again.
 */
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");

function installedVersion(baseDir, dep) {
  try {
    return require(path.join(baseDir, "node_modules", dep, "package.json")).version;
  } catch {
    return null;
  }
}

const backendPkg = require(path.join(BACKEND, "package.json"));
const shared = Object.keys(backendPkg.dependencies || {});

const problems = [];
for (const dep of shared) {
  const rootVer = installedVersion(ROOT, dep);
  const backendVer = installedVersion(BACKEND, dep);

  if (rootVer === null) {
    // The packaged backend resolves its deps from the root node_modules, so the root MUST
    // carry every backend runtime dep. Missing here = broken (or unbuilt) packaged app.
    problems.push(
      `${dep}: present in backend but MISSING from root node_modules ` +
        `(the packaged app resolves backend deps from root — add it to the root package.json and reinstall)`
    );
  } else if (backendVer !== null && rootVer !== backendVer) {
    problems.push(`${dep}: root ${rootVer} != backend ${backendVer}`);
  }
}

if (problems.length > 0) {
  console.error("\n[dep-parity] Backend runtime deps are out of sync between root and backend installs:");
  for (const p of problems) console.error("  - " + p);
  console.error(
    "\nThe packaged Electron build bundles root/node_modules; `npm run dev` uses backend/node_modules.\n" +
      "Align them (set the same version range in both package.json files and reinstall both),\n" +
      "then rebuild. See CLAUDE.md > Build & package.\n"
  );
  process.exit(1);
}

console.log(`[dep-parity] OK — ${shared.length} backend runtime deps match between root and backend.`);

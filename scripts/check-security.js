#!/usr/bin/env node
// Static security scan: enforces coding constraints required for Power BI certification.
// Blocks forbidden browser APIs and validates the dependency allowlist.

const fs = require("fs");
const path = require("path");

let errors = 0;
function fail(msg) { console.error("  FAIL  " + msg); errors++; }
function pass(msg) { console.log("  PASS  " + msg); }

// ── 1. Forbidden patterns in TypeScript source ────────────────────────────────

const FORBIDDEN = [
    { pattern: /innerHTML\s*=/,           reason: "innerHTML assignment (XSS risk)" },
    { pattern: /outerHTML\s*=/,           reason: "outerHTML assignment (XSS risk)" },
    { pattern: /insertAdjacentHTML\s*\(/, reason: "insertAdjacentHTML (XSS risk)" },
    { pattern: /document\.write\s*\(/,    reason: "document.write" },
    { pattern: /\beval\s*\(/,             reason: "eval()" },
    { pattern: /new\s+Function\s*\(/,     reason: "new Function() (code injection risk)" },
    { pattern: /\bfetch\s*\(/,            reason: "fetch() (no external network access allowed)" },
    { pattern: /new\s+XMLHttpRequest\s*/, reason: "XMLHttpRequest (no external network access allowed)" },
    { pattern: /new\s+WebSocket\s*\(/,    reason: "WebSocket (no external network access allowed)" },
    { pattern: /require\s*\(\s*['"]https?:/, reason: "remote require() (no external network access allowed)" },
];

function scanFile(filePath) {
    const src = fs.readFileSync(filePath, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
        // Skip comment lines
        if (/^\s*(\/\/|\/\*)/.test(line)) return;
        for (const { pattern, reason } of FORBIDDEN) {
            if (pattern.test(line)) {
                fail(path.relative(process.cwd(), filePath) + ":" + (i + 1) + " — " + reason);
            }
        }
    });
}

function walkDir(dir, ext) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !["node_modules", ".tmp", "dist"].includes(entry.name)) {
            results.push(...walkDir(full, ext));
        } else if (entry.isFile() && entry.name.endsWith(ext)) {
            results.push(full);
        }
    }
    return results;
}

const tsFiles = walkDir(path.join(__dirname, "..", "src"), ".ts");
if (tsFiles.length === 0) {
    fail("No TypeScript source files found in src/");
} else {
    tsFiles.forEach(scanFile);
    if (errors === 0) pass("No forbidden API usage in " + tsFiles.length + " source file(s)");
}

// ── 2. Runtime dependency allowlist ──────────────────────────────────────────
// Only Microsoft-published packages are permitted as production (non-dev) dependencies.
// This mirrors the Power BI certification requirement.

const ALLOWED_RUNTIME_SCOPES = ["powerbi-", "@microsoft/", "@types/"];
const ALLOWED_RUNTIME_PACKAGES = new Set([
    "powerbi-visuals-api",
]);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const runtimeDeps = Object.keys(pkg.dependencies || {});

for (const dep of runtimeDeps) {
    const allowed =
        ALLOWED_RUNTIME_PACKAGES.has(dep) ||
        ALLOWED_RUNTIME_SCOPES.some((prefix) => dep.startsWith(prefix));
    if (!allowed) {
        fail("Runtime dependency '" + dep + "' is not from an approved publisher (Microsoft packages only)");
    }
}
if (errors === 0) {
    pass("All " + runtimeDeps.length + " runtime dependency/ies are from approved publishers");
}

// ── 3. pbiviz.json integrity ──────────────────────────────────────────────────

const pbiviz = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "pbiviz.json"), "utf8"));
if (!pbiviz.visual?.guid) fail("pbiviz.json: missing visual.guid");
else if (!/^[a-zA-Z0-9]{16,}$/.test(pbiviz.visual.guid)) fail("pbiviz.json: guid must be alphanumeric and at least 16 chars");
else pass("pbiviz.json: guid is present and well-formed");

if (!pbiviz.author?.name || !pbiviz.author?.email) fail("pbiviz.json: author.name and author.email are required");
else pass("pbiviz.json: author fields are present");

// ─────────────────────────────────────────────────────────────────────────────

console.log("\n" + (errors === 0 ? "Security check passed." : errors + " security issue(s) found."));
process.exit(errors > 0 ? 1 : 0);

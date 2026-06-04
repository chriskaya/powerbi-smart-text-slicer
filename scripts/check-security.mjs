#!/usr/bin/env node
/*
 * Security gate for the Smart Text Slicer Power BI custom visual.
 *
 * Fails (exits 1) if any of the following is detected:
 *   - Forbidden DOM / network / storage / dynamic-code APIs in src/ or style/
 *   - URL string literals in src/ (the visual must not embed any remote URL)
 *   - capabilities.json declaring any privilege (must be `"privileges": []`)
 *   - pbiviz.json declaring externalJS scripts
 *   - A runtime dependency that is not on the Microsoft "powerbi-*" allowlist
 *
 * Run locally with `npm run security-check`. The CI runs this step before
 * building the .pbiviz; a failure stops the workflow and skips the package.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errors = [];
const fail = (msg) => errors.push(msg);

// ---------------------------------------------------------------------------
// 1. Forbidden API patterns in source code.
// ---------------------------------------------------------------------------
// Covers dynamic code execution, unsafe DOM injection, network egress, browser
// storage, cross-frame messaging, clipboard, workers, and other exfiltration
// vectors. Any match stops the build.
const FORBIDDEN = [
    { name: "eval()",               regex: /\beval\s*\(/ },
    { name: "Function constructor", regex: /\bnew\s+Function\s*\(/ },
    { name: "innerHTML",            regex: /\.innerHTML\b/ },
    { name: "outerHTML",            regex: /\.outerHTML\b/ },
    { name: "insertAdjacentHTML",   regex: /\.insertAdjacentHTML\b/ },
    { name: "document.write(ln)",   regex: /\bdocument\s*\.\s*write(?:ln)?\s*\(/ },
    { name: "fetch()",              regex: /\bfetch\s*\(/ },
    { name: "XMLHttpRequest",       regex: /\bXMLHttpRequest\b/ },
    { name: "WebSocket",            regex: /\bWebSocket\b/ },
    { name: "EventSource",          regex: /\bEventSource\b/ },
    { name: "navigator.sendBeacon", regex: /\bsendBeacon\s*\(/ },
    { name: "navigator.clipboard",  regex: /\bnavigator\s*\.\s*clipboard\b/ },
    { name: "localStorage",         regex: /\blocalStorage\b/ },
    { name: "sessionStorage",       regex: /\bsessionStorage\b/ },
    { name: "indexedDB",            regex: /\bindexedDB\b/ },
    { name: ".postMessage()",       regex: /\.postMessage\s*\(/ },
    { name: "dynamic import()",     regex: /(^|[^\w$.])import\s*\(/ },
    { name: "setTimeout(string)",   regex: /\bsetTimeout\s*\(\s*["'`]/ },
    { name: "setInterval(string)",  regex: /\bsetInterval\s*\(\s*["'`]/ },
    { name: "Worker",               regex: /\bnew\s+(?:Shared)?Worker\s*\(/ },
    { name: "createObjectURL",      regex: /\bcreateObjectURL\s*\(/ },
    { name: "Image() loader",       regex: /\bnew\s+Image\s*\(/ },
];

const URL_LITERAL = /["'`](?:https?|wss?|ftp|file|data):\/\/[^\s"'`]+/;
// Power BI filter schema identifier — not a network endpoint, just a format tag
// required by the applyJsonFilter API. Allowlisted explicitly.
const ALLOWED_URL_PATTERNS = [
    /["'`]https?:\/\/powerbi\.com\/product\/schema[^\s"'`]*/,
];

const sourceFiles = [
    ...collectFiles("src",   [".ts", ".tsx", ".js", ".mjs", ".cjs"]),
    ...collectFiles("style", [".less", ".css"]),
];

if (sourceFiles.length === 0) {
    fail(`No source files found under src/ or style/ — refusing to certify an empty visual.`);
}

for (const file of sourceFiles) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);

    lines.forEach((line, i) => {
        const stripped = stripComment(line);
        for (const { name, regex } of FORBIDDEN) {
            if (regex.test(stripped)) {
                fail(`Forbidden API "${name}" found in ${file}:${i + 1}\n      ${line.trim()}`);
            }
        }
        const url = stripped.match(URL_LITERAL);
        if (url && !ALLOWED_URL_PATTERNS.some(p => p.test(stripped))) {
            fail(`URL string literal in ${file}:${i + 1}\n      ${line.trim()}\n      matched: ${url[0]}`);
        }
    });
}

// ---------------------------------------------------------------------------
// 2. capabilities.json — privileges must be exactly the empty list.
// ---------------------------------------------------------------------------
const capabilitiesPath = path.join(ROOT, "capabilities.json");
const capabilities = JSON.parse(fs.readFileSync(capabilitiesPath, "utf8"));
if (!Array.isArray(capabilities.privileges) || capabilities.privileges.length !== 0) {
    fail(
        `capabilities.json must declare "privileges": []. Found: ` +
        JSON.stringify(capabilities.privileges)
    );
}

// ---------------------------------------------------------------------------
// 3. pbiviz.json — no remote externalJS scripts.
// ---------------------------------------------------------------------------
const pbiviz = JSON.parse(fs.readFileSync(path.join(ROOT, "pbiviz.json"), "utf8"));
if (Array.isArray(pbiviz.externalJS) && pbiviz.externalJS.length > 0) {
    fail(
        `pbiviz.json declares externalJS scripts which would load extra code: ` +
        JSON.stringify(pbiviz.externalJS)
    );
}

// ---------------------------------------------------------------------------
// 4. Runtime dependency allowlist — only Microsoft "powerbi-*" packages.
// ---------------------------------------------------------------------------
const ALLOWED_DEP_PREFIXES = ["powerbi-"];
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
for (const dep of Object.keys(pkg.dependencies || {})) {
    if (!ALLOWED_DEP_PREFIXES.some(p => dep.startsWith(p))) {
        fail(
            `Runtime dependency "${dep}" is not on the allowlist ` +
            `(only Microsoft "powerbi-*" packages are permitted at runtime).`
        );
    }
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (errors.length > 0) {
    console.error(`\n[security-check] FAILED — ${errors.length} issue(s):\n`);
    for (const e of errors) {
        console.error(`  • ${e}`);
    }
    console.error(
        `\nThe build workflow will not produce a package while these ` +
        `findings are present.\n`
    );
    process.exit(1);
}

console.log(
    `[security-check] OK — scanned ${sourceFiles.length} source file(s); ` +
    `no malicious patterns, exfiltration channels, ` +
    `non-Microsoft runtime deps, or extra privileges detected.`
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function collectFiles(dir, exts) {
    const abs = path.join(ROOT, dir);
    const out = [];
    if (!fs.existsSync(abs)) return out;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const p = path.join(abs, entry.name);
        if (entry.isDirectory()) out.push(...collectFiles(path.relative(ROOT, p), exts));
        else if (exts.some(e => p.endsWith(e))) out.push(path.relative(ROOT, p));
    }
    return out;
}

function stripComment(line) {
    // Drop trailing line comments (// ...) to avoid false positives on commented-out code.
    const i = line.indexOf("//");
    if (i === -1) return line;
    // Don't strip if the // is inside a string literal on this line.
    const before = line.slice(0, i);
    const dq = (before.match(/"/g) || []).length;
    const sq = (before.match(/'/g) || []).length;
    const bt = (before.match(/`/g) || []).length;
    if (dq % 2 || sq % 2 || bt % 2) return line;
    return before;
}

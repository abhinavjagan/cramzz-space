import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const ignored = new Set([".git", ".astro", ".vendor", "dist", "node_modules", "playwright-report", "test-results", "package-lock.json"]);
const textExtensions = new Set([".astro", ".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".txt", ".yaml", ".yml"]);
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{30,}/],
  ["Razorpay live key", /rzp_live_[A-Za-z0-9]{10,}/],
  ["Stripe live key", /sk_live_[A-Za-z0-9]{16,}/],
];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (ignored.has(entry)) return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const findings = [];
for (const file of walk(root)) {
  if (!textExtensions.has(extname(file))) continue;
  const content = readFileSync(file, "utf8");
  for (const [name, pattern] of rules) {
    if (pattern.test(content)) findings.push(`${relative(root, file)}: possible ${name}`);
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Secret scan passed.");

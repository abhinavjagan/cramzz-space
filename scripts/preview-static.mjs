import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("dist");
const port = 4321;
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".xml", "application/xml; charset=utf-8"],
]);

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^[/\\]+/, "");
  const candidate = resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function existingFile(pathname) {
  const candidate = safePath(pathname);
  if (!candidate) return null;
  const possibilities = pathname.endsWith("/")
    ? [join(candidate, "index.html")]
    : [candidate, join(candidate, "index.html")];
  return possibilities.find((file) => existsSync(file) && statSync(file).isFile()) ?? null;
}

const server = createServer((request, response) => {
  if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(405).end();
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, "http://127.0.0.1").pathname;
  } catch {
    response.writeHead(400).end();
    return;
  }

  let file = existingFile(pathname);
  let status = 200;
  if (!file) {
    file = join(root, "404.html");
    status = 404;
  }

  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": types.get(extname(file)) ?? "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Static preview listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

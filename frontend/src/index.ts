import { serve } from "bun";
import { resolve, sep } from "node:path";
import index from "./index.html";

const port = Number(process.env.PORT ?? 3002);
const isProduction = process.env.NODE_ENV === "production";
const distDir = resolve(import.meta.dir, "../dist");
const indexFile = Bun.file(resolve(distDir, "index.html"));

async function serveIndex() {
  if (!await indexFile.exists()) {
    return new Response("Frontend build output is missing. Run `bun run build` first.", { status: 500 });
  }

  const apiOrigin = JSON.stringify(process.env.TYOX_API_URL ?? "").replace(/</g, "\\u003c");
  const html = (await indexFile.text()).replace('"__TYOX_API_URL__"', apiOrigin);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function serveAsset(request: Request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const assetPath = resolve(distDir, `.${pathname}`);
  if (assetPath !== distDir && !assetPath.startsWith(`${distDir}${sep}`)) {
    return new Response("Not found", { status: 404 });
  }

  const asset = Bun.file(assetPath);
  if (pathname !== "/" && await asset.exists()) return new Response(asset);
  return serveIndex();
}

const server = serve({
  port,
  routes: isProduction
    ? {
      "/health": new Response("ok"),
      "/*": serveAsset,
    }
    : {
      "/health": new Response("ok"),
      "/*": index,
    },
  development: !isProduction && { hmr: true, console: true },
});

console.log(`Frontend listening on ${server.url}`);

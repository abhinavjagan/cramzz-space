import type { APIRoute } from "astro";
import { experiments } from "../lib/registry";

export const GET: APIRoute = () => new Response(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), experiments }, null, 2), {
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
});

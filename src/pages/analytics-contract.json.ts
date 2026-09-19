import type { APIRoute } from "astro";
import contract from "../../analytics-contract.json";

export const GET: APIRoute = () => new Response(JSON.stringify(contract, null, 2), {
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  },
});

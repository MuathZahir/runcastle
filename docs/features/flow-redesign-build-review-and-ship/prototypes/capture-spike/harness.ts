// The "runcastle origin": serves the harness page and writes captured PNGs to
// disk — the end of the waypoint's end-to-end chain.
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const shots = join(import.meta.dir, "shots");
mkdirSync(shots, { recursive: true });

Bun.serve({
  port: 5598,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/capture" && req.method === "POST") {
      const { png, grabMs, sel } = await req.json();
      const file = join(shots, `capture-${Date.now()}.png`);
      writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
      console.log("saved", file, "grabMs", grabMs, "sel", sel);
      return new Response(file);
    }
    return new Response(await Bun.file(join(import.meta.dir, "harness.html")).text(), {
      headers: { "content-type": "text/html" },
    });
  },
});
console.log("harness on http://localhost:5598");

// The "cross-origin dev server" stand-in: a real localhost HTTP server on a
// different port than the harness (5599 vs 5598), which is exactly what makes
// the iframe cross-origin. Route (c) never touches this server's DOM or wire,
// so a Bun static server proves the same thing a Vite server would — the
// capture is of composited pixels, agnostic to what produced them.
const page = `<!doctype html>
<meta charset="utf-8">
<title>fake dev app</title>
<style>
  body { margin: 0; font: 24px system-ui; }
  .band { height: 400px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 48px; }
  #counter { position: fixed; top: 8px; right: 8px; background: #000; color: #0f0; padding: 8px 16px; font-size: 32px; z-index: 9; }
</style>
<div id="counter">clicks: 0</div>
<div class="band" style="background:#c0392b">BAND RED — top</div>
<div class="band" style="background:#27ae60">BAND GREEN — 400</div>
<div class="band" style="background:#2980b9">BAND BLUE — 800</div>
<div class="band" style="background:#8e44ad">BAND PURPLE — 1200</div>
<div class="band" style="background:#f39c12">BAND ORANGE — 1600</div>
<script>
  let n = 0;
  document.addEventListener("click", () => {
    n++;
    document.getElementById("counter").textContent = "clicks: " + n;
  });
</script>`;

Bun.serve({
  port: 5599,
  fetch() {
    return new Response(page, { headers: { "content-type": "text/html" } });
  },
});
console.log("fake dev server on http://localhost:5599");

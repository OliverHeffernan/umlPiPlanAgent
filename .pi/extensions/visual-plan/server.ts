import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

export interface PlanServer {
  url: string;
  close(): Promise<void>;
  notifyChanged(): void;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pi Visual Plan</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1020; --panel:#121a2d; --ink:#e8eefc; --muted:#91a0bd; --accent:#7dd3fc; --line:#26334f; }
    * { box-sizing: border-box; }
    body { margin:0; background:radial-gradient(circle at 15% 0%,#172554 0,transparent 35%),var(--bg); color:var(--ink); font:16px/1.65 ui-sans-serif,system-ui,sans-serif; }
    header { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:.8rem; padding:.8rem max(1rem,calc((100vw - 1100px)/2)); border-bottom:1px solid var(--line); background:rgba(11,16,32,.86); backdrop-filter:blur(12px); }
    .dot { width:.65rem; height:.65rem; border-radius:50%; background:#4ade80; box-shadow:0 0 14px #4ade80; }
    header strong { letter-spacing:.04em; } header span { color:var(--muted); font-size:.85rem; }
    main { width:min(1100px,calc(100% - 2rem)); margin:2rem auto 5rem; padding:2rem clamp(1rem,4vw,4rem); background:rgba(18,26,45,.94); border:1px solid var(--line); border-radius:18px; box-shadow:0 24px 70px #0008; }
    h1,h2,h3 { line-height:1.2; margin-top:1.7em; } h1 { margin-top:0; font-size:clamp(2rem,6vw,3.5rem); } h2 { border-bottom:1px solid var(--line); padding-bottom:.35rem; }
    a { color:var(--accent); } code { color:#f0abfc; background:#090d18; padding:.15em .35em; border-radius:5px; }
    pre:not(.mermaid) { overflow:auto; padding:1rem; border:1px solid var(--line); border-radius:10px; background:#090d18; }
    pre code { padding:0; background:none; } blockquote { margin-left:0; padding-left:1rem; border-left:3px solid var(--accent); color:var(--muted); }
    .mermaid { margin:2rem 0; padding:1.4rem; overflow:auto; text-align:center; border:1px solid #334466; border-radius:14px; background:#f8fafc; }
    .empty,.error { padding:2rem; color:var(--muted); text-align:center; } .error { color:#fca5a5; }
    table { width:100%; border-collapse:collapse; } th,td { border:1px solid var(--line); padding:.5rem .7rem; text-align:left; }
    @media (max-width:600px) { main { width:100%; margin:0; border-width:0; border-radius:0; } header { position:static; } }
  </style>
</head>
<body>
  <header><i class="dot"></i><strong>PI VISUAL PLAN</strong><span id="status">connecting…</span></header>
  <main id="plan"><div class="empty">Waiting for a plan…</div></main>
  <script src="/vendor/markdown-it.min.js"></script>
  <script type="module">
    import mermaid from "/vendor/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad:false, securityLevel:"strict", theme:"neutral", flowchart:{ htmlLabels:false } });
    const target=document.querySelector("#plan"), status=document.querySelector("#status");
    const md=window.markdownit({ html:false, linkify:true, typographer:true });
    const fallback=md.renderer.rules.fence.bind(md.renderer.rules);
    md.renderer.rules.fence=(tokens,idx,options,env,self)=>tokens[idx].info.trim()==="mermaid"
      ? '<pre class="mermaid">'+md.utils.escapeHtml(tokens[idx].content)+'</pre>'
      : fallback(tokens,idx,options,env,self);
    async function render(){
      try {
        const response=await fetch('/api/plan',{cache:'no-store'});
        if(!response.ok) throw new Error(await response.text());
        const text=await response.text();
        target.innerHTML=text.trim()?md.render(text):'<div class="empty">Waiting for a plan…</div>';
        await mermaid.run({nodes:target.querySelectorAll('.mermaid'),suppressErrors:false});
        status.textContent='live · '+new Date().toLocaleTimeString();
      } catch(error) { target.innerHTML='<div class="error"></div>'; target.firstChild.textContent=String(error); status.textContent='render error'; }
    }
    const events=new EventSource('/events'); events.onopen=()=>status.textContent='live'; events.onmessage=render; events.onerror=()=>status.textContent='reconnecting…';
    render();
  </script>
</body>
</html>`;

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

export async function startPlanServer(options: {
  planPath: string;
  extensionDir: string;
  port?: number;
}): Promise<PlanServer> {
  const clients = new Set<ServerResponse>();
  const mermaidPath = join(options.extensionDir, "node_modules/mermaid/dist/mermaid.esm.min.mjs");
  const markdownItPath = join(options.extensionDir, "node_modules/markdown-it/dist/markdown-it.min.js");

  const server: Server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/") {
      res.setHeader("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      send(res, 200, "text/html; charset=utf-8", PAGE);
    } else if (pathname === "/api/plan") {
      try { send(res, 200, "text/markdown; charset=utf-8", await readFile(options.planPath, "utf8")); }
      catch { send(res, 200, "text/markdown; charset=utf-8", ""); }
    } else if (pathname === "/events") {
      res.writeHead(200, { "content-type":"text/event-stream", "cache-control":"no-cache", connection:"keep-alive" });
      res.write("data: ready\\n\\n"); clients.add(res); req.on("close", () => clients.delete(res));
    } else if (pathname === "/vendor/mermaid.esm.min.mjs" || pathname === "/vendor/markdown-it.min.js" || pathname.startsWith("/vendor/chunks/")) {
      let file: string;
      if (pathname === "/vendor/markdown-it.min.js") file = markdownItPath;
      else if (pathname === "/vendor/mermaid.esm.min.mjs") file = mermaidPath;
      else {
        const relative = pathname.slice("/vendor/".length);
        if (!/^chunks\/[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) {
          send(res, 404, "text/plain; charset=utf-8", "Not found"); return;
        }
        file = join(options.extensionDir, "node_modules/mermaid/dist", relative);
      }
      try { await stat(file); res.writeHead(200, { "content-type":"text/javascript; charset=utf-8", "cache-control":"public, max-age=3600", "x-content-type-options":"nosniff" }); createReadStream(file).pipe(res); }
      catch { send(res, 500, "text/plain; charset=utf-8", "Viewer dependency missing. Run npm install in the extension directory."); }
    } else {
      send(res, 404, "text/plain; charset=utf-8", "Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4317, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine viewer address");

  let lastMtime = 0;
  const timer = setInterval(async () => {
    try {
      const current = (await stat(options.planPath)).mtimeMs;
      if (lastMtime && current !== lastMtime) for (const client of clients) client.write("data: changed\\n\\n");
      lastMtime = current;
    } catch { /* Plan may not exist yet. */ }
  }, 700);
  timer.unref();

  return {
    url: `http://127.0.0.1:${address.port}`,
    notifyChanged() { for (const client of clients) client.write("data: changed\\n\\n"); },
    async close() {
      clearInterval(timer);
      for (const client of clients) client.end();
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

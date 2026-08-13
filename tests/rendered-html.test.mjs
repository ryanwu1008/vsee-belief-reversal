import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the VSee product narrative before JavaScript runs", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>VSee \| Persistent Context for AI Agents<\/title>/i);
  assert.match(
    html,
    /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*Persistent context turns a forgotten pass into the right next move)[^>]*>/i,
  );
  assert.match(
    html,
    /<meta(?=[^>]*\bproperty=["']og:image["'])(?=[^>]*vsee-context-loop-og\.png)[^>]*>/i,
  );
  assert.match(
    html,
    /<meta(?=[^>]*\bname=["']twitter:image["'])(?=[^>]*vsee-context-loop-og\.png)[^>]*>/i,
  );

  assert.match(html, /<main\b/i);
  assert.match(html, /The agent that knows when your [“&quot;]+No[”&quot;]+ is outdated\./i);
  assert.match(html, /Then/);
  assert.match(html, /10 Nov 2025/);
  assert.match(html, /78%/);
  assert.match(html, /two quarters above 90%/i);
  assert.match(html, /Now/);
  assert.match(html, /13 Aug 2026/);
  assert.match(html, /confirmed investor update/i);
  assert.match(html, /Q1[^<]*91%/i);
  assert.match(html, /Q2[^<]*92%/i);
  assert.match(html, /Next/);
  assert.match(html, /REVISIT/);
  assert.match(html, /Open a partner meeting/i);

  assert.match(html, /<button[^>]*>[^<]*Run context loop[^<]*<\/button>/i);
  assert.match(html, /<button[^>]*>[^<]*Prove crash recovery[^<]*<\/button>/i);
  assert.match(html, /<button[^>]*>[^<]*Draft cited memo[^<]*<\/button>/i);
  assert.match(html, /Fireworks AI/i);
  assert.match(html, /cannot change the deterministic decision/i);
  assert.match(html, /<button[^>]*>[^<]*Reset demo[^<]*<\/button>/i);
  assert.match(html, /<details\b/i);
  assert.match(html, /<summary[^>]*>[^<]*Retrieval audit[^<]*<\/summary>/i);
  assert.match(html, /demo_fund/);
  assert.match(html, /deal_irregular/);
  assert.match(html, /net retention threshold revisit decision/i);
  assert.match(html, /Credentials and prompts are never exposed\./i);
});

test("does not render starter preview metadata or copy", async () => {
  const html = await (await render()).text();

  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

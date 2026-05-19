import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);

async function fileText(path) {
  return readFile(new URL(path, root), "utf8");
}

test("yunwu route has its own static entry and relative assets", async () => {
  await stat(new URL("yunwu/index.html", root));
  await stat(new URL("yunwu/assets/index-yunwu.js", root));

  const html = await fileText("yunwu/index.html");
  assert.match(html, /src="\.\/yunwu-adapter\.js"/);
  assert.match(html, /src="\.\/assets\/index-yunwu\.js"/);
  assert.match(html, /href="\.\/assets\/index-De69yEZo\.css"/);
  assert.doesNotMatch(html, /src="\/assets\//);
  assert.doesNotMatch(html, /href="\/assets\//);
});

test("yunwu adapter targets Yunwu Gemini API and the approved models", async () => {
  const adapter = await fileText("yunwu/yunwu-adapter.js");

  assert.match(adapter, /https:\/\/yunwu\.ai\/v1beta\/models\//);
  assert.match(adapter, /gemini-3\.1-flash-image-preview/);
  assert.match(adapter, /gemini-3-pro-image-preview/);
  assert.match(adapter, /0\.083/);
  assert.match(adapter, /0\.165/);
  assert.match(adapter, /imageSize:\s*"2K"/);
  assert.match(adapter, /enforceOnly2KResolution/);
  assert.doesNotMatch(adapter, /imageSize:\s*"1K"/);
  assert.doesNotMatch(adapter, /imageSize:\s*"4K"/);
});

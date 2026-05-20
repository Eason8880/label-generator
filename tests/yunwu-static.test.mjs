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

test("yunwu adapter supports Gemini models and gpt-image-2-all Images edits", async () => {
  const adapter = await fileText("yunwu/yunwu-adapter.js");

  assert.match(adapter, /\/yunwu-api\/v1\/images\/edits/);
  assert.match(adapter, /\/yunwu-api\/v1beta\/models\//);
  assert.match(adapter, /gemini-3\.1-flash-image-preview/);
  assert.match(adapter, /gemini-3-pro-image-preview/);
  assert.match(adapter, /gpt-image-2-all/);
  assert.match(adapter, /DEFAULT_LEGACY_MODEL = GPT_IMAGE_MODEL/);
  assert.match(adapter, /MODEL_DEFAULT_MIGRATION_KEY/);
  assert.match(adapter, /insertBefore\(button, modelGrid\.firstElementChild\)/);
  assert.match(adapter, /Nano Banana 2/);
  assert.match(adapter, /Nano Banana Pro/);
  assert.match(adapter, /GPT Image 2/);
  assert.match(adapter, /0\.083/);
  assert.match(adapter, /0\.165/);
  assert.match(adapter, /0\.060 元\/次/);
  assert.match(adapter, /0\.083 元\/次 · 默认/);
  assert.match(adapter, /gridTemplateColumns = "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.match(adapter, /buildImagesEditsForm/);
  assert.match(adapter, /waitForImagesReady/);
  assert.match(adapter, /cacheBustUrl/);
  assert.match(adapter, /syncModelButtonState/);
  assert.match(adapter, /setModelButtonState/);
  assert.match(adapter, /PDF 转换后的页面图片/);
  assert.match(adapter, /image1 到 image/);
  assert.match(adapter, /response_format/);
  assert.match(adapter, /image_size/);
  assert.match(adapter, /2K/);
  assert.match(adapter, /enforceOnly2KResolution/);
});

test("vercel rewrites the same-origin Yunwu proxy to the upstream API", async () => {
  const config = JSON.parse(await fileText("vercel.json"));

  assert.deepEqual(config.rewrites, [
    {
      source: "/yunwu-api/:path*",
      destination: "https://yunwu.ai/:path*"
    }
  ]);
});

test("Yunwu text replacements are idempotent", async () => {
  const adapter = await fileText("yunwu/yunwu-adapter.js");

  assert.doesNotMatch(
    adapter,
    /"Key 仅保存在浏览器本地，不会上传至任何服务器":\s*"[^"]*Key 仅保存在浏览器本地/
  );
  assert.doesNotMatch(
    adapter,
    /"API Key 仅保存在浏览器本地":\s*"[^"]*API Key 仅保存在浏览器本地/
  );
});

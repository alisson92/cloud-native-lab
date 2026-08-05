import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds an English static entry point for GitHub Pages", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="en">/);
  assert.match(html, /Cloud Native Lab/);
  assert.match(html, /\/cloud-native-lab\/assets\//);
});

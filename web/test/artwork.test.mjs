// The artwork naming rules on their own — no filesystem, no server.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ARTWORK_BYTES, artworkContentType, artworkFileFor } from "../src/lib/server/artwork.mjs";

test("every accepted type maps to one file name, and back", () => {
  for (const [type, name] of [
    ["image/png", "source.png"],
    ["image/jpeg", "source.jpg"],
    ["image/webp", "source.webp"],
    ["image/gif", "source.gif"],
    ["image/avif", "source.avif"],
  ]) {
    assert.equal(artworkFileFor(type), name);
    assert.equal(artworkContentType(name), type);
  }
});

test("the browser's own header shapes are accepted", () => {
  // What a `fetch` with a File body actually sends.
  assert.equal(artworkFileFor("image/png; charset=binary"), "source.png");
  assert.equal(artworkFileFor(" IMAGE/PNG "), "source.png");
});

test("anything outside the table is refused rather than guessed at", () => {
  for (const type of [
    "image/svg+xml", // markup, and it executes script in some readers
    "image/x-icon",
    "application/octet-stream",
    "text/html",
    "",
    null,
    undefined,
  ]) {
    assert.equal(artworkFileFor(type), null, `${type} should not be storable`);
  }
});

test("the file name is generated, never taken from the upload", () => {
  // The point of the closed table: none of this can reach join().
  for (const name of [
    "../../../etc/passwd",
    "source.png/../../x",
    "source..png",
    "SOURCE.EXE",
    "source.",
    "evil.png",
    "",
  ]) {
    assert.equal(artworkContentType(name), null, `${name} should not be servable`);
  }
});

test("a record naming an extension outside the table serves nothing", () => {
  // projects.json is meant to be hand-edited, so this value is not trusted.
  assert.equal(artworkContentType("source.svg"), null);
  assert.equal(artworkContentType("source.zip"), null);
});

test("the size cap is a real number of bytes", () => {
  assert.ok(Number.isInteger(MAX_ARTWORK_BYTES) && MAX_ARTWORK_BYTES > 1024 * 1024);
});

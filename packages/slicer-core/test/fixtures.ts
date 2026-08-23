import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode } from "jpeg-js";
import type { RasterImage } from "../src/index";

export function loadFixture(name: string): RasterImage {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const img = decode(readFileSync(path), { useTArray: true });
  return { width: img.width, height: img.height, data: img.data };
}

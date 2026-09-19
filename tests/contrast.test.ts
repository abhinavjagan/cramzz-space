import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

function hexToken(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing CSS colour token --${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("small text contrast", () => {
  it("keeps muted dark-surface text above WCAG AA on both dark surfaces", () => {
    const muted = hexToken("muted-on-dark");
    expect(contrast(muted, hexToken("ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, hexToken("ink-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.preview-readout[^}]+var\(--muted-on-dark\)/);
    expect(css).toMatch(/\.footer-links span:first-child[^}]+var\(--muted-on-dark\)/);
    expect(css).toMatch(/\.footer-bottom[^}]+var\(--muted-on-dark\)/);
  });
});

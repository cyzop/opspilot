import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio } from "../../src/lib/contrast.ts";
import { palettes, traceKinds, type Palette } from "../../src/styles/tokens.ts";

const backgrounds = ["bg", "surface", "surface-raised"] as const;
const textRoles = ["text", "text-muted", "danger", "warning", "success"] as const;
const uiRoles = ["border", "focus", "primary", ...traceKinds.map((kind) => `trace-${kind}` as const)] as const;

test("contrastRatio follows WCAG", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.throws(() => contrastRatio("red", "#ffffff"));
});

for (const [theme, palette] of Object.entries(palettes) as [string, Palette][]) {
  test(`${theme} palette: text pairs reach 4.5:1`, () => {
    for (const background of backgrounds) {
      for (const role of textRoles) {
        const ratio = contrastRatio(palette[role], palette[background]);
        assert.ok(ratio >= 4.5, `${theme}: ${role} on ${background} is ${ratio}`);
      }
    }
    const onPrimary = contrastRatio(palette["primary-text"], palette.primary);
    assert.ok(onPrimary >= 4.5, `${theme}: primary-text on primary is ${onPrimary}`);
  });

  test(`${theme} palette: UI and trace colours reach 3:1`, () => {
    for (const background of backgrounds) {
      for (const role of uiRoles) {
        const ratio = contrastRatio(palette[role], palette[background]);
        assert.ok(ratio >= 3, `${theme}: ${role} on ${background} is ${ratio}`);
      }
    }
  });
}

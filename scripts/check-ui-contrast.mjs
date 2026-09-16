import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const css = readFileSync(new URL('../apps/web/app/ui.css', import.meta.url), 'utf8');
const declarations = block => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
const light = declarations(css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '');
const dark = { ...light, ...declarations(css.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)?.[1] ?? '') };
const pairs = [['text-primary', 'surface-raised'], ['text-secondary', 'surface-raised'], ['text-muted', 'surface-raised'], ['text-muted', 'surface-canvas'], ['accent-contrast', 'accent'], ['status-success', 'success-soft'], ['status-danger', 'danger-soft'], ['status-warning', 'warning-soft'], ['merged', 'merged-soft']];
function luminance(value) {
  if (!/^#[\da-f]{3}([\da-f]{3})?$/i.test(value)) throw new Error(`Expected opaque hex color, received ${value}`);
  const hex = value.slice(1).length === 3 ? [...value.slice(1)].map(part => part + part).join('') : value.slice(1);
  return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => { const channel = parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255; return total + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); }, 0);
}
let failures = 0;
for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
  for (const [foreground, background] of pairs) {
    const a = luminance(tokens[`--ui-${foreground}`]); const b = luminance(tokens[`--ui-${background}`]);
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    if (ratio < 4.5) { failures++; console.error(`${theme}: ${foreground}/${background}: ${ratio.toFixed(2)} < 4.5`); }
  }
}
console.log(`${pairs.length * 2} UI text contrast pairs checked; ${failures} failures.`);
process.exitCode = failures ? 1 : 0;

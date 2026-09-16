import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const findings = [];
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.|fixtures/.test(entry.name)) continue;
    const content = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if ((ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[가-힣]/u.test(node.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        findings.push(`${relative(root, path)}:${line}: ${node.text.trim().replace(/\s+/g, ' ').slice(0, 200)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const directory of ['app', 'components', 'lib']) scan(join(root, directory));
for (const finding of findings) console.error(finding);
console.log(`${findings.length} Korean runtime literals found in web production code (comments and fixtures excluded).`);
process.exitCode = findings.length ? 1 : 0;

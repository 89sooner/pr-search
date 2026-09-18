/** FR-REG-001 / WP-095: run against an explicitly enabled, synthetic-fixture local server. */
/* global document, window, innerWidth, localStorage, scrollTo */
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
import fs from 'node:fs';
import assert from 'node:assert/strict';
const output=fileURLToPath(new URL('../output/playwright/regression-atlas/',import.meta.url));fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{localStorage.setItem('pr-search-theme','dark');});
const page=await context.newPage();const errors=[],apiWrites=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/bisect-sessions'))apiWrites.push(r.url());});
const base=process.env.ATLAS_TEST_URL??'http://127.0.0.1:3188';
const reference=await context.newPage();await reference.goto(new URL('../docs/40_delivery/regression_workbench/UIUX/regression-B-atlas.html',import.meta.url).href);await reference.screenshot({path:output+'/atlas-reference.png'});await reference.close();
await page.goto(base+'/regression');await page.getByText('60',{exact:true}).first().waitFor();
await page.screenshot({path:output+'/atlas-desktop.png',fullPage:true});
await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
for(const theme of ['dark','light']){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
  await page.waitForTimeout(200); // Assess settled colors after the product's 140ms background transition.
  const violations=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('.regression-workbench'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});
  assert.deepEqual(violations,[],theme+' contrast/accessibility');
  if(theme==='light')await page.screenshot({path:output+'/atlas-light.png',fullPage:true});
}
await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.waitForTimeout(200);
const bounds=page.getByTestId('regression-bounds'),next=page.getByTestId('regression-next');
assert.match(await bounds.textContent(),/59 PR \+ 1 direct/);const original=await bounds.textContent();const before=await next.textContent();
await page.getByRole('button',{name:'Direct push',exact:true}).click();assert.equal(await next.textContent(),before);
await page.getByLabel('Search changes').fill('no-such-change');assert.equal(await next.textContent(),before);await page.getByRole('heading',{name:'No matching changes'}).waitFor();
await page.getByRole('button',{name:'Clear filters',exact:true}).click();
await page.getByRole('button',{name:'Start bisect',exact:true}).click();await page.getByRole('button',{name:'Use this PASS and start'}).click();
await page.getByRole('button',{name:'Ⅱ Inconclusive',exact:true}).click();await page.getByLabel('Observation reason').fill('Need more device-hours');await page.getByRole('button',{name:'Record inconclusive'}).click();
await page.getByText('Awaiting evidence.',{exact:false}).waitFor();assert.equal(await next.textContent(),before);assert.equal((await bounds.textContent()).replace('Active suspect interval',''),original.replace('Suggested interval · confirm before bisect',''));
await page.getByRole('button',{name:'↷ Skip',exact:true}).click();await page.getByLabel('Observation reason').fill('Fixture equipment unavailable');await page.getByRole('button',{name:'Record skip'}).click();await page.waitForTimeout(150);assert.notEqual(await next.textContent(),before);
await page.getByRole('button',{name:'✓ PASS',exact:true}).click();await page.waitForTimeout(150);assert.notEqual(await bounds.textContent(),original);
const progressed=await bounds.textContent();await page.getByRole('button',{name:'Pulse',exact:true}).click();await page.getByRole('heading',{name:'Daily Pulse'}).waitFor();assert.equal(await bounds.textContent(),progressed);
await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('heading',{name:'Failure Inbox'}).waitFor();assert.equal(await bounds.textContent(),progressed);
await page.getByRole('button',{name:'Atlas',exact:true}).click();await page.getByRole('heading',{name:'Revision Atlas'}).waitFor();await page.reload();await page.getByRole('button',{name:'✓ PASS',exact:true}).waitFor();assert.equal(await bounds.textContent(),progressed);
await page.getByRole('button',{name:'Review local test request'}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Add to local queue'}).click();await page.getByText('Added to local fixture queue.',{exact:false}).waitFor();
await page.getByLabel('Preview source state').selectOption('epoch_stale');assert.equal(await page.getByRole('button',{name:'✓ PASS',exact:true}).isDisabled(),true);await page.getByText('History epoch changed.',{exact:false}).waitFor();await page.getByLabel('Preview source state').selectOption('ready');
await page.getByRole('button',{name:'Archive session',exact:true}).click();await page.getByRole('button',{name:'Start bisect',exact:true}).waitFor();await page.getByRole('button',{name:'View preserved sessions'}).click();await page.getByRole('heading',{name:/Archived session/}).waitFor();await page.keyboard.press('Escape');
await page.getByLabel('Selected MDVP result').selectOption('MDVP-78376');await page.getByRole('heading',{name:'More evidence is required'}).waitFor();assert.equal(await page.getByRole('button',{name:'Start bisect',exact:true}).count(),0);
await page.getByLabel('Selected MDVP result').selectOption('MDVP-78436');await page.getByRole('heading',{name:'Map this binary to a revision first'}).waitFor();assert.equal(await bounds.count(),0);
await page.getByLabel('Result date',{exact:true}).fill('2026-09-17');await page.getByLabel('Selected MDVP result').selectOption('MDVP-78291');await bounds.waitFor();assert.match(await bounds.textContent(),/S-24012/);
await page.getByLabel('Regression branch').selectOption('release/26A');await page.getByRole('heading',{name:'No evidence in this sequence space'}).waitFor();assert.equal(await bounds.count(),0);
await page.getByRole('button',{name:'Return to sample investigation'}).click();await bounds.waitFor();
const point=page.locator('.rg-row-open').first();await point.click();await page.getByRole('dialog').waitFor();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download fixture manifest'}).click();const d=await download;const chunks=[];for await(const c of await d.createReadStream())chunks.push(c);const manifest=JSON.parse(Buffer.concat(chunks));assert.equal(manifest.commit_sha.length,40);assert.equal(manifest.data_classification,'SYNTHETIC_FIXTURE_ONLY');
await page.keyboard.press('Escape');assert.equal(await point.evaluate(el=>el===document.activeElement),true);
const svgPoint=page.locator('[data-map-point]').first();await svgPoint.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await svgPoint.evaluate(el=>el===document.activeElement),true);
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/atlas-mobile.png',fullPage:true});
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
for(const [view,title] of [['Inbox','Failure Inbox'],['Pulse','Daily Pulse'],['Atlas','Revision Atlas']]){await page.getByRole('button',{name:view,exact:true}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),view+' mobile overflow');}
await page.getByRole('button',{name:'Start bisect',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Use this PASS and start'}).click();await page.getByRole('button',{name:'✓ PASS',exact:true}).waitFor();
await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'✓ PASS',exact:true}).click();
assert.equal(apiWrites.length,0,'fixture must not call real bisect API');
for(const path of ['/search','/ranges']){const response=await page.goto(base+path);assert.equal(response.status(),200);await page.getByRole('main').waitFor();if(path==='/ranges')await page.getByRole('heading',{name:'Range investigation',exact:true}).waitFor();}
assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',viewports:[1440,390],fixtureApiRequests:apiWrites.length,pageErrors:errors,screenshots:output}));
} finally { await browser.close(); }

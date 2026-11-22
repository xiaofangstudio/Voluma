import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const src=path.resolve('tmp-e2e/forms-m3.pdf');
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9333',defaultViewport:null});
const p=(await b.pages()).find(x=>x.url().includes('1420')||x.url().includes('tauri'));
p.on('console',m=>{ if(m.type()==='error') console.log('CONSOLE',m.text()); });
await p.evaluate((pdfPath)=>{localStorage.setItem('voluma.recents.v1',JSON.stringify([{path:pdfPath,name:'forms-m3',size:7094,pages:1,lastPage:1,zoom:100,updatedAt:Date.now()}]))},src);
await p.reload({waitUntil:'networkidle2'}); await sleep(1200);
await p.waitForSelector('.recent-row',{timeout:10000}); await p.click('.recent-row');
await p.waitForFunction(()=>document.querySelectorAll('.page-wrap canvas').length>0,{timeout:20000});
await p.waitForFunction(()=>document.querySelector('.save-chip')?.textContent==='已保存',{timeout:10000});
await p.waitForFunction(()=>document.querySelectorAll('.widgetLayer input').length>0,{timeout:15000});
await sleep(800);
const widgets=await p.evaluate(()=>[...document.querySelectorAll('.widgetLayer input,.widgetLayer select,.widgetLayer textarea')].map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,type:e.type||'',name:e.name,id:e.id,value:e.value,checked:e.checked,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};}));
console.log(JSON.stringify(widgets,null,2));
await p.screenshot({path:'review-m2/51-form-empty.png'});

// 填文本（按出现顺序：name、company）
const texts=await p.$$('.widgetLayer input[type="text"]');
await texts[0].click({clickCount:3}); await p.keyboard.type('方小明');
await texts[1].click({clickCount:3}); await p.keyboard.type('小方工作室');
// 多行备注
const ta=await p.$('.widgetLayer textarea');
await ta.click({clickCount:3}); await p.keyboard.type('第一行备注\n第二行备注');
// 下拉城市
await p.select('.widgetLayer select','Shenzhen');
// 勾选同意
await p.click('.widgetLayer input[type="checkbox"]');
// 单选 Pro
const radios=await p.$$('.widgetLayer input[type="radio"]');
await radios[1].click();
await sleep(1800);
const chip=await p.evaluate(()=>document.querySelector('.save-chip')?.textContent);
console.log('chip after fill',chip);
await p.screenshot({path:'review-m2/52-form-filled.png'});

await p.click('button[aria-label="表单"]'); await p.waitForSelector('.form-panel',{timeout:10000}); await sleep(600);
await p.screenshot({path:'review-m2/53-form-panel.png'});
const rows=await p.evaluate(()=>[...document.querySelectorAll('.form-row')].map(r=>r.textContent));
console.log('rows',rows);
await p.click('button[aria-label="关闭表单"]'); await sleep(300);

await p.reload({waitUntil:'networkidle2'}); await sleep(1200);
await p.waitForSelector('.recent-row',{timeout:10000}); await p.click('.recent-row');
await p.waitForFunction(()=>document.querySelectorAll('.widgetLayer input').length>0,{timeout:20000});
await sleep(1000);
const back=await p.evaluate(()=>[...document.querySelectorAll('.widgetLayer input,.widgetLayer select,.widgetLayer textarea')].map(e=>({tag:e.tagName,type:e.type||'',value:e.value,checked:e.checked})));
console.log('reopen',JSON.stringify(back));
await p.screenshot({path:'review-m2/54-form-reopen.png'});
await b.disconnect();

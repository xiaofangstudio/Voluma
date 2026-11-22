import puppeteer from 'puppeteer-core';
import path from 'node:path';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const target=path.resolve('tmp-e2e/pages-m3.pdf');
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9333',defaultViewport:null});
const p=(await b.pages()).find(x=>x.url().includes('1420') || x.url().includes('tauri'));
p.on('dialog',async d=>{ console.log('dialog',d.message()); await d.accept(); });
await p.evaluate((pdfPath)=>{localStorage.setItem('voluma.recents.v1',JSON.stringify([{path:pdfPath,name:'pages-m3',size:4684,pages:5,lastPage:1,zoom:100,updatedAt:Date.now()}]))},target);
await p.reload({waitUntil:'networkidle2'}); await sleep(1200);
await p.waitForSelector('.recent-row',{timeout:10000}); await p.click('.recent-row');
await p.waitForFunction(()=>document.querySelectorAll('.page-wrap canvas').length>0,{timeout:20000});
await p.waitForFunction(()=>document.querySelector('.save-chip')?.textContent==='已保存',{timeout:10000});
await sleep(600);
await p.click('button[aria-label="页面管理"]');
await p.waitForSelector('.pm',{timeout:10000});
await sleep(900);
await p.screenshot({path:'review-m2/40-page-manager.png'});
const btn=async(txt)=>{ await p.evaluate((t)=>{const b=[...document.querySelectorAll('.pm-tools button')].find(x=>x.textContent.includes(t)); if(!b) throw new Error('no button '+t); b.click();},txt); await sleep(250); };
await btn('右转 90°');
const drag=async(from,to)=>{ await p.evaluate((f,t)=>{
  const src=document.querySelector(`.pm-card[data-page="${f}"]`);
  const dst=document.querySelector(`.pm-card[data-page="${t}"]`);
  if(!src||!dst) throw new Error('card missing');
  const dt=new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
  dst.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
  dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
},from,to); await sleep(400); };
await drag(1,5);
// 取消选第1页，改选第5页并删除
await p.click('.pm-card[data-page="1"]'); await sleep(150);
await p.click('.pm-card[data-page="5"]'); await sleep(150);
await btn('删除');
await p.screenshot({path:'review-m2/41-page-manager-staged.png'});
const before=await p.evaluate(()=>({order:[...document.querySelectorAll('.pm-card[data-page]')].map(c=>c.getAttribute('data-page')),head:document.querySelector('.pm-sub')?.textContent}));
console.log('staged',before);
await p.click('.pm-foot .btn-primary');
await p.waitForFunction(()=>document.querySelector('input[aria-label="页码"]')?.parentElement?.textContent?.includes('/ 4'),{timeout:20000});
await sleep(1200);
await p.screenshot({path:'review-m2/42-pages-applied.png'});
// 跳到第 4 页（原第 1 页，已右转 90°）
const input=await p.$('input[aria-label="页码"]'); await input.evaluate((el)=>el.select()); await input.type('4'); await p.keyboard.press('Enter');
await sleep(1000);
const geom=await p.evaluate(()=>{const r=document.querySelector('.page-wrap')?.getBoundingClientRect();return {w:r?.width,h:r?.height,page:document.querySelector('input[aria-label="页码"]')?.value,chip:document.querySelector('.save-chip')?.textContent};});
console.log('geom',geom);
await p.screenshot({path:'review-m2/43-page-rotated.png'});
await p.click('button[aria-label="页面管理"]'); await p.waitForSelector('.pm',{timeout:5000}); await sleep(700);
await p.screenshot({path:'review-m2/44-page-manager-after.png'});
await p.click('button[aria-label="关闭页面管理"]');
await b.disconnect();



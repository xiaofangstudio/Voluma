import puppeteer from 'puppeteer-core';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9333',defaultViewport:null});
const p=(await b.pages()).find(x=>x.url().includes('1420'));
const hasClose=await p.$('button[aria-label="关闭文档"]');
if(hasClose){await hasClose.click(); await sleep(900);}
await p.waitForSelector('.welcome',{timeout:10000});
const rows=await p.$$('.recent-row'); console.log('recent rows',rows.length);
await rows[0].click();
await p.waitForFunction(()=>document.querySelectorAll('.page-wrap canvas').length>0,{timeout:15000});
await p.waitForFunction(()=>document.querySelector('.save-chip')?.textContent==='已保存',{timeout:10000});
await sleep(500);
const r=await p.evaluate(()=>({chip:document.querySelector('.save-chip')?.textContent,annots:[...document.querySelectorAll('g.annot')].map(a=>a.getAttribute('class')),name:document.querySelector('.docname')?.textContent}));
await p.click('button[aria-label="注释列表"]'); await sleep(300);
const list=await p.evaluate(()=>[...document.querySelectorAll('.annot-row')].map(r=>r.textContent.trim()));
console.log(JSON.stringify({r,list},null,2));
await p.screenshot({path:'review-m2/31-reopen.png'});
await b.disconnect();

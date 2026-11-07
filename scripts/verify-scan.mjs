/**
 * Runs hostile documents through the real sandbox page and compares what
 * `html-scan.ts` reports. Its DOM walk needs a real parser, so `npm test` cannot
 * cover it, and the cases that matter are where a browser's parser disagrees with
 * intuition: declarative shadow roots, SVG, a tab inside `javascript:`.
 *
 * Needs the test browser up (`npm run verify`) and a fresh dist/. It reloads the
 * extension in place and opens and closes one tab of its own, so it does not
 * disturb a window someone is working in. Run: node scripts/verify-scan.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const ROOT=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'')
const v = await (await fetch('http://127.0.0.1:9222/json/version')).json()
const ws = new WebSocket(v.webSocketDebuggerUrl)
await new Promise(r=>ws.onopen=r)
let n=0; const pend=new Map()
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}}
const send=(method,params={},sessionId)=>new Promise(r=>{const id=++n;pend.set(id,r);ws.send(JSON.stringify({id,method,params,sessionId}))})
const load=await send('Extensions.loadUnpacked',{path:ROOT+'/dist'})
console.log('load',JSON.stringify(load.result??load.error))
const extId=load.result.id
await new Promise(r=>setTimeout(r,1500))
const t=(await send('Target.createTarget',{url:'https://drive.google.com/robots.txt',background:true})).result.targetId
const sid=(await send('Target.attachToTarget',{targetId:t,flatten:true})).result.sessionId
await new Promise(r=>setTimeout(r,2000))
const CASES=[
 ['clean prose','<!doctype html><h1>Q3 report</h1><p>Rotate your password yearly.</p><img src="data:image/png;base64,AA" alt="">',[]],
 ['heading about login, no field','<h1>Login flow design</h1><p>text</p>',[]],
 ['checkbox only','<input type=checkbox><select><option>a</select>',[]],
 ['json data script','<script type="application/json">{"a":"eval(atob(x))"}</script>',[]],
 ['commented script','<!-- <script>eval(atob(x))</script> --><p>x</p>',[]],
 ['script as text','<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>',[]],
 ['plain script','<script>let a=1</script>',['scripts']],
 ['onerror handler','<img src=x onerror="a()">',['scripts']],
 ['svg onload','<svg onload="a()"></svg>',['scripts']],
 ['svg script','<svg><script>a()</script></svg>',['scripts']],
 ['tabbed js url','<a href="java\tscript:a()">x</a>',['scripts']],
 ['animate js url','<svg><a><animate attributeName=href to="javascript:a()"/><text>x</text></a></svg>',['scripts']],
 ['password','<input TYPE=PASSWORD>',['password']],
 ['password in DSD','<div><template shadowrootmode=open><input type=password></template></div>',['password']],
 ['password in foreignObject','<svg><foreignObject><input type=password></foreignObject></svg>',['password']],
 ['masked text input','<input style="-webkit-text-security:disc">',['password']],
 ['name hints pass','<input name="user_pass">',['password']],
 ['bypass is no password','<input name="bypass"><h1>x</h1>',['inputs']],
 ['fake google','<title>Sign in</title><input type=email placeholder=Email><button>Next</button>',['login','inputs']],
 ['VN login button','<button>Đăng nhập</button>',['login']],
 ['JP input+heading','<h2>ログイン</h2><textarea></textarea>',['login','inputs']],
 ['contenteditable','<div contenteditable>x</div>',['inputs']],
 ['iframe srcdoc','<iframe srcdoc="<input type=password>"></iframe>',['embedded']],
 ['object data','<object data="data:text/html,x"></object>',['embedded']],
 ['meta refresh','<meta http-equiv=REFRESH content="0;url=data:text/html,x">',['redirect']],
 ['refresh no url','<meta http-equiv=refresh content="30">',[]],
 ['obfuscated','<script>eval(atob("YQ=="))</script>',['obfuscated','scripts']],
 ['obfuscated handler','<img src=x onerror="eval(unescape(\'%61\'))">',['obfuscated','scripts']],
 ['remote img','<img src="https://evil.test/a.png">',['remote']],
 ['protocol relative','<img src="//evil.test/a.png">',['remote']],
 ['remote css','<link rel=stylesheet href="https://x.test/a.css">',['remote']],
 ['css @import','<style>@import "https://x.test/a.css";</style>',['remote']],
 ['css url','<style>body{background:url(https://x.test/a.png)}</style>',['remote']],
 ['remote script','<script src="https://x.test/a.js"></script>',['scripts','remote']],
 ['junk in the tag',"<input type=password <<<>",['password']],
 ['tag never closed, so never rendered','<input type=password <<<',[]],
 ['unclosed','<script>eval(atob(1)',['obfuscated','scripts']],
 ['sample.html',readFileSync(ROOT+'/samples/sample.html','utf8'),null],
 ['sample-cdn.html',readFileSync(ROOT+'/samples/sample-cdn.html','utf8'),null],
]
const expr=`(async()=>{
 const CASES=${JSON.stringify(CASES)};
 const f=document.createElement('iframe');f.src='chrome-extension://${extId}/sandbox.html';
 const q=[];let ready;const rd=new Promise(r=>ready=r);
 addEventListener('message',e=>{if(e.source!==f.contentWindow)return;if(e.data.type==='SANDBOX_READY')ready();if(e.data.type==='HTML_SCAN')q.push(e.data.findings)});
 document.documentElement.append(f);await rd;
 const out=[];
 for(const [n,text,want] of CASES){const l=q.length;
  f.contentWindow.postMessage({type:'RENDER_ATTACHMENT',text,fileName:'x.html',kind:'html',expand:'auto',diagrams:{mermaid:false,plantUml:false,plantUmlServer:''},assets:{enabled:false,hosts:[]},allowScripts:false},'*');
  const t=Date.now();while(q.length===l&&Date.now()-t<4000)await new Promise(r=>setTimeout(r,5));
  out.push([n,q[l]??'NO REPORT',want]);}
 const l=q.length;f.contentWindow.postMessage({type:'RENDER_ATTACHMENT',text:'x',fileName:'x.md',kind:'markdown',expand:'auto',diagrams:{mermaid:false,plantUml:false,plantUmlServer:''},assets:{enabled:false,hosts:[]},allowScripts:false},'*');
 await new Promise(r=>setTimeout(r,500));out.push(['markdown not scanned',q.length===l?[]:q[l],[]]);
 return JSON.stringify(out)})()`
const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},sid)
if(r.result?.exceptionDetails||!r.result?.result?.value){console.log(JSON.stringify(r).slice(0,800))}
else{let bad=0;for(const [n,got,want] of JSON.parse(r.result.result.value)){const ok=want===null||JSON.stringify(got)===JSON.stringify(want);if(!ok)bad++;console.log(ok?'ok  ':'FAIL',n,JSON.stringify(got),ok?'':'want '+JSON.stringify(want))}console.log('failures',bad);process.exitCode=bad?1:0}
await send('Target.closeTarget',{targetId:t});ws.close()

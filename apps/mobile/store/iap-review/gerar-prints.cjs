const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/askout/apps/web/dist';
const types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
const srv = http.createServer((q,r)=>{ let p=path.join(root, decodeURIComponent(q.url.split('?')[0])); if(!fs.existsSync(p)||fs.statSync(p).isDirectory()) p=path.join(root,'index.html'); r.setHeader('content-type', types[path.extname(p)]||'application/octet-stream'); fs.createReadStream(p).pipe(r); }).listen(0, async ()=>{
  const port = srv.address().port;
  const b = await chromium.launch(); 
  const ctx = await b.newContext({ viewport:{width:430,height:932}, deviceScaleFactor:3, isMobile:true, hasTouch:true, locale:'pt-BR' });
  await ctx.addInitScript(()=>{ localStorage.setItem('askout.token','demo'); localStorage.setItem('askout.onboarded.u1','1'); window.Capacitor={getPlatform:()=> 'ios'}; window.AskouTStore={purchase: async()=> 'demo'}; });
  const me = {id:'u1',email:'dono@teste.com',role:'USER',profile:{userId:'u1',username:'dono.teste',displayName:'Dono [TESTE]',avatarUrl:null,isPrivate:false}};
  const venue = {id:'v1',name:'Bar do Zé [TESTE]',address:'Rua Exemplo, 100 - São Paulo',category:'Bar',description:'Local de teste',hours:null,coverUrl:null,logoUrl:null,photoPath:null,photoAuthor:null,lat:-23.55,lng:-46.63,sample:true,claimed:true,isOwner:true,following:false,followerCount:12,rating:{average:4.6,count:8,mine:null},upcomingEvents:[],regulars:[],friendsWent:{count:0,sample:[]}};
  const pricing = {currency:'BRL',enabled:true,pricePerDayCents:1490,packagePricesCents:{'1':1490,'3':3490,'7':6990,'14':12990},dayOptions:[1,3,7,14],store:{available:true,pricePerDayCents:1490,packagePricesCents:{'1':1490,'3':3490,'7':6990,'14':12990},products:{'1':'askout.boost.1d','3':'askout.boost.3d','7':'askout.boost.7d','14':'askout.boost.14d'}},match:{radiusKmOptions:[2,5,10],maxTags:3},sandbox:false};
  await ctx.route('**/api/**', route=>{ const u=route.request().url(); console.log('R',u); let body={};
    if(u.endsWith('/auth/me')) body=me; else if(u.includes('/venues/v1/profile')) body=venue; else if(u.includes('/boosts/pricing')) body=pricing; else if(u.includes('/boosts')) body={items:[]}; else if(u.includes('follow-requests')) body={items:[],nextCursor:null}; else if(u.includes('notifications/unread')) body={unread:0,count:0}; else if(u.endsWith('/me/flash')) body={active:false,startsAt:null,expiresAt:null,note:null}; else if(u.includes('flash/invites')) body={received:[],sent:[],matches:[]}; else if(u.includes('/conversations')) body={items:[]}; else if(u.includes('/me/terms')) body={currentVersion:'1',acceptedVersion:'1',acceptedAt:'2026-10-01T00:00:00Z',upToDate:true}; else if(u.includes('flash/active')) body={userIds:[]};
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)}); });
  const page = await ctx.newPage(); page.on('console',m=>console.log('C',m.type(),m.text().slice(0,200))); page.on('pageerror',e=>console.log('E',String(e).slice(0,300))); page.on('requestfailed',r=>console.log('F',r.url()));
  await page.goto(`http://localhost:${port}/bares/v1/impulsionar`);
  await page.waitForTimeout(2500);
  for (const d of [1,3,7,14]) { await page.getByRole('button',{name:new RegExp('^'+d+' dias?')}).first().click().catch(async()=>{ await page.locator('text=/^'+d+' dias?/').first().click(); }); await page.waitForTimeout(400); await page.screenshot({path: process.argv[2]+'/compra-'+d+'d.png'}); }
  await page.screenshot({path: process.argv[2]+'/boost-full.png', fullPage:true});
  await b.close(); srv.close();
});

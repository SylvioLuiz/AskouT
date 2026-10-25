const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/askout/apps/web/dist';
const types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
const out = process.argv[2];
const srv = http.createServer((q,r)=>{ let p=path.join(root, decodeURIComponent(q.url.split('?')[0])); if(!fs.existsSync(p)||fs.statSync(p).isDirectory()) p=path.join(root,'index.html'); r.setHeader('content-type', types[path.extname(p)]||'application/octet-stream'); fs.createReadStream(p).pipe(r); }).listen(0, async ()=>{
  const port = srv.address().port; const b = await chromium.launch();
  const day = (n,h)=>{const d=new Date(Date.now()+n*864e5); d.setHours(h,0,0,0); return d.toISOString();};
  const me = {id:'u1',email:'dono@teste.com',role:'USER',profile:{userId:'u1',username:'dono.teste',displayName:'Dono [TESTE]',avatarUrl:null,isPrivate:false}};
  const ev=(id,title,kind,n,h,tags,free)=>({id,title,description:'Evento de teste',kind,startsAt:day(n,h),endsAt:day(n,h+4),isFree:free,imageUrl:null,tags,phase:'UPCOMING',sample:true});
  const friend=(i,n)=>({userId:'f'+i,username:n,displayName:n,avatarUrl:null,isPrivate:false});
  const venue = {id:'v1',name:'Bar do Zé [TESTE]',address:'Rua Exemplo, 100 - São Paulo',category:'Bar',description:'Música ao vivo, chope gelado e petiscos. Local de teste.',hours:Array.from({length:7},(_,d)=>d===1?null:{open:'18:00',close:'02:00'}),coverUrl:null,logoUrl:null,photoPath:null,photoAuthor:null,lat:-23.55,lng:-46.63,sample:true,claimed:true,isOwner:false,following:true,followerCount:128,rating:{average:4.6,count:32,mine:null},upcomingEvents:[ev('e1','Roda de samba [TESTE]','SHOW',1,20,['samba','musica'],false),ev('e2','Quiz night [TESTE]','NIGHT',3,19,['quiz'],true),ev('e3','Sexta do rock [TESTE]','SHOW',4,21,['rock'],false)],regulars:[{rank:1,user:friend(1,'ana.teste'),visits:6},{rank:2,user:friend(2,'bruno.teste'),visits:4}],friendsWent:{count:3,sample:[friend(1,'ana.teste'),friend(2,'bruno.teste')]}};
  const pricing = {currency:'BRL',enabled:true,pricePerDayCents:1490,packagePricesCents:{'1':1490,'3':3490,'7':6990,'14':12990},dayOptions:[1,3,7,14],store:{available:true,pricePerDayCents:1490,packagePricesCents:{'1':1490,'3':3490,'7':6990,'14':12990},products:{}},match:{radiusKmOptions:[2,5,10],maxTags:3},sandbox:false};
  let CUR='';
  const mock = (u)=>{
    if(u.endsWith('/auth/me')) return me; if(u.includes('/venues/v1/profile')) return CUR==='own'?{...venue,isOwner:true}:venue; if(u.includes('/boosts/pricing')) return pricing;
    if(u.includes('follow-requests')) return {items:[],nextCursor:null}; if(u.includes('notifications/unread')) return {unread:0,count:0};
    if(u.endsWith('/me/flash')) return {active:false,startsAt:null,expiresAt:null,note:null}; if(u.includes('flash/invites')) return {received:[],sent:[],matches:[]};
    if(u.includes('/me/terms')) return {currentVersion:'1',acceptedVersion:'1',acceptedAt:'2026-10-01T00:00:00Z',upToDate:true}; if(u.includes('flash/active')) return {userIds:[]};
    return {items:[],nextCursor:null};
  };
  async function shot(name, route, guest, w){ CUR=w||'';
    const ctx = await b.newContext({ viewport:{width:430,height:932}, deviceScaleFactor:3, isMobile:true, hasTouch:true, locale:'pt-BR' });
    await ctx.addInitScript((g)=>{ if(!g){ localStorage.setItem('askout.token','demo'); localStorage.setItem('askout.onboarded.u1','1'); } window.Capacitor={getPlatform:()=> 'ios'}; }, guest);
    await ctx.route('**/api/**', r=>{ const u=r.request().url(); if(guest && u.endsWith('/auth/me')) return r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'UNAUTHORIZED',message:'x'}})}); r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mock(u))}); });
    const page = await ctx.newPage(); await page.goto(`http://localhost:${port}${route}`); await page.waitForTimeout(2500);
    await page.screenshot({path: `${out}/${name}.png`}); await ctx.close();
  }
  await shot('s1-entrar','/entrar',true);
  await shot('s2-local','/bares/v1',false);
  await shot('s3-flash','/flash',false);
  await shot('s5-impulsionar','/bares/v1/impulsionar',false,'own');
  await b.close(); srv.close();
});

import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const J=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const priv=(ip:string)=>/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)||/^(::1?$|fc|fd|fe80|::ffff:)/i.test(ip);
async function safe(u:string){const x=new URL(u);if(!/^https?:$/.test(x.protocol))throw new Error("Only http and https URLs are allowed");
 const h=x.hostname.replace(/^\[|\]$/g,"");if(h==="localhost"||/\.(local|internal)$/.test(h))throw new Error("Blocked host");
 const ips=/^[\d.]+$|:/.test(h)?[h]:[...await Deno.resolveDns(h,"A").catch(()=>[]),...await Deno.resolveDns(h,"AAAA").catch(()=>[])];
 if(!ips.length)throw new Error("Host could not be resolved");if(ips.some(priv))throw new Error("Private or internal addresses are blocked");return x}
// Every hop (including redirects) is re-validated; 8s timeout; 1 MB cap.
async function get(u:string,max=1_000_000){let url=u;for(let i=0;i<4;i++){const x=await safe(url);
 const r=await fetch(x,{redirect:"manual",signal:AbortSignal.timeout(8000),headers:{"User-Agent":"SignalScopeBot/0.1"}});
 const loc=r.headers.get("location");if(r.status>=300&&r.status<400&&loc){url=new URL(loc,x).href;continue}
 let t="",n=0;const rd=r.body?.getReader(),dec=new TextDecoder();
 while(rd){const {done,value}=await rd.read();if(done)break;n+=value.length;t+=dec.decode(value,{stream:true});if(n>max){await rd.cancel();break}}
 return{status:r.status,text:t,url}}throw new Error("Too many redirects")}
function blocked(t:string){let star=false;for(const l of t.split(/\r?\n/)){const m=l.split("#")[0].match(/^\s*(user-agent|disallow)\s*:\s*(.*)$/i);if(!m)continue;
 if(m[1].toLowerCase()=="user-agent")star=m[2].trim()=="*";else if(star&&m[2].trim()=="/")return true}return false}
Deno.serve(async req=>{if(req.method=="OPTIONS")return new Response("ok",{headers:cors});
 try{const env=Deno.env,U=env.get("SUPABASE_URL")!;
  const uc=createClient(U,env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});
  const {brand_id,url}=await req.json();
  const {data:brand}=await uc.from("brands").select("id,org_id").eq("id",brand_id).single(); // RLS: members only
  if(!brand)return J({error:"Brand not found"},404);
  const sc=createClient(U,env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since=new Date(Date.now()-864e5).toISOString();
  const {count}=await sc.from("website_audits").select("id",{count:"exact",head:true}).eq("org_id",brand.org_id).gte("created_at",since);
  if((count??0)>=20)return J({error:"Daily audit limit reached"},429);
  const origin=(await safe(url)).origin;
  const rb=await get(origin+"/robots.txt").catch(()=>null);
  if(rb&&rb.status==200&&blocked(rb.text))return J({error:"robots.txt disallows automated access to this site"},422);
  const p=await get(url);const h=p.text;
  const sm=await get(origin+"/sitemap.xml",200_000).catch(()=>null);
  const title=h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const md=h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim();
  const h1=(h.match(/<h1[\s>]/gi)||[]).length;
  const canon=/<link[^>]+rel=["']canonical["']/i.test(h);
  const noindex=/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(h);
  const ld=[...h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  let ldOk=ld.length>0;for(const m of ld){try{JSON.parse(m[1])}catch{ldOk=false}}
  const C=(check:string,passed:boolean,severity:string,detail:string,rec:string)=>({check_name:check,passed,severity,detail,recommendation:rec});
  const checks=[
   C("Page responds successfully",p.status>=200&&p.status<300,"High",`HTTP ${p.status} at ${p.url}`,"Make sure the page returns HTTP 200 to automated visitors."),
   C("Title tag",!!title,"Medium",title?`"${title.slice(0,80)}"`:"No <title> found","Add a descriptive, unique title."),
   C("Meta description",!!md,"Medium",md?`${md.length} characters`:"No meta description found","Write a concise, accurate description of the page."),
   C("Single H1 heading",h1==1,"Low",`${h1} H1 element(s) found`,"Use one clear main heading and a sensible heading hierarchy."),
   C("Canonical URL",canon,"Low",canon?"Declared":"Not declared","Declare a canonical URL if duplicate versions of this page exist."),
   C("No accidental noindex",!noindex,"High",noindex?"noindex robots meta found":"No noindex directive","Remove noindex if the page should be discoverable."),
   C("Structured data (valid JSON-LD)",ldOk,"Medium",`${ld.length} JSON-LD block(s)`,"Add valid Schema.org markup relevant to the page type."),
   C("XML sitemap reachable",!!sm&&sm.status==200,"Low",sm?`HTTP ${sm.status}`:"Could not fetch /sitemap.xml","Publish a sitemap and reference it in robots.txt."),
  ];
  const {data:a}=await sc.from("website_audits").insert({org_id:brand.org_id,brand_id,url:p.url,http_status:p.status}).select("id").single();
  await sc.from("audit_issues").insert(checks.map(c=>({...c,org_id:brand.org_id,audit_id:a!.id})));
  const {data:open}=await sc.from("action_items").select("issue").eq("brand_id",brand_id).neq("status","complete");
  const have=new Set((open||[]).map(o=>o.issue));
  const add=checks.filter(c=>!c.passed&&!have.has(c.check_name)).map(c=>({org_id:brand.org_id,brand_id,issue:c.check_name,evidence:c.detail,why:"Found by the website audit on "+p.url,recommendation:c.recommendation,priority:c.severity,effort:"Low"}));
  if(add.length)await sc.from("action_items").insert(add);
  return J({audit_id:a!.id,failed:checks.filter(c=>!c.passed).length});
 }catch(e){return J({error:String((e as Error).message||e)},400)}});

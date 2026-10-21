import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const J=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async req=>{if(req.method=="OPTIONS")return new Response("ok",{headers:cors});
 try{const env=Deno.env,U=env.get("SUPABASE_URL")!;
  const uc=createClient(U,env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});
  const {prompt_id}=await req.json();
  const {data:pr}=await uc.from("prompts").select("id,org_id,brand_id,question").eq("id",prompt_id).single(); // RLS
  if(!pr)return J({error:"Question not found"},404);
  const sc=createClient(U,env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since=new Date(Date.now()-864e5).toISOString();
  const {count}=await sc.from("monitoring_runs").select("id",{count:"exact",head:true}).eq("org_id",pr.org_id).gte("created_at",since);
  if((count??0)>=Number(env.get("DAILY_RUN_LIMIT")??50))return J({error:"Daily run limit reached"},429);
  const {data:brand}=await sc.from("brands").select("name").eq("id",pr.brand_id).single();
  const {data:comps}=await sc.from("competitors").select("name").eq("brand_id",pr.brand_id);
  const model=env.get("GEMINI_MODEL")??"gemini-2.5-flash";
  const {data:run}=await sc.from("monitoring_runs").insert({org_id:pr.org_id,prompt_id,provider:"gemini-api",model,status:"failed"}).select("id").single();
  try{
   const body:any={contents:[{parts:[{text:pr.question}]}]};
   if(env.get("GROUNDING")=="true")body.tools=[{google_search:{}}]; // may add per-request cost: measure first
   const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",
     headers:{"Content-Type":"application/json","x-goog-api-key":env.get("GEMINI_API_KEY")!},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw new Error("Provider returned HTTP "+r.status);
   const d=await r.json(),cand=d.candidates?.[0];
   const answer=(cand?.content?.parts||[]).map((x:any)=>x.text||"").join("");
   if(!answer)throw new Error("Empty provider response");
   const low=answer.toLowerCase(),has=(n:string)=>low.includes(n.toLowerCase());
   const {data:resp}=await sc.from("ai_responses").insert({org_id:pr.org_id,run_id:run!.id,answer,brand_mentioned:has(brand!.name),
     competitors_mentioned:(comps||[]).filter(c=>has(c.name)).map(c=>c.name)}).select("id").single();
   // Grounding links are provider redirect URLs; "title" usually holds the source domain.
   const ch=(cand?.groundingMetadata?.groundingChunks||[]).filter((c:any)=>c.web);
   if(ch.length)await sc.from("citations").insert(ch.map((c:any)=>({org_id:pr.org_id,response_id:resp!.id,url:c.web.uri,domain:c.web.title})));
   await sc.from("monitoring_runs").update({status:"success"}).eq("id",run!.id);
   return J({ok:true});
  }catch(e){await sc.from("monitoring_runs").update({error:String((e as Error).message)}).eq("id",run!.id);return J({error:"Run failed: "+(e as Error).message},502)}
 }catch(e){return J({error:String((e as Error).message||e)},400)}});

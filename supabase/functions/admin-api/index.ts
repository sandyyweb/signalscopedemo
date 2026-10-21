import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const J=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const PLANS:any={starter:{max_brands:1,max_questions:10,daily_run_limit:10},growth:{max_brands:3,max_questions:50,daily_run_limit:30},agency:{max_brands:20,max_questions:300,daily_run_limit:100}};
Deno.serve(async req=>{if(req.method=="OPTIONS")return new Response("ok",{headers:cors});
 try{const env=Deno.env,U=env.get("SUPABASE_URL")!;
  const uc=createClient(U,env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});
  const {data:adm}=await uc.from("platform_admins").select("user_id").maybeSingle(); // only admins can read their own row
  if(!adm)return J({error:"Admins only"},403);
  const sc=createClient(U,env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b=await req.json();
  const users=async()=>(await sc.auth.admin.listUsers({perPage:1000})).data?.users||[];
  if(b.action=="list"){
   const since=new Date(Date.now()-30*864e5).toISOString();
   const [o,m,br,pr,ru]=await Promise.all([sc.from("organizations").select("*").order("created_at",{ascending:false}),sc.from("memberships").select("org_id,user_id"),
     sc.from("brands").select("org_id"),sc.from("prompts").select("org_id"),sc.from("monitoring_runs").select("org_id").gte("created_at",since)]);
   const em=new Map((await users()).map(u=>[u.id,u.email]));const n=(r:any,id:string)=>(r.data||[]).filter((x:any)=>x.org_id==id).length;
   return J({clients:(o.data||[]).map((g:any)=>({...g,emails:(m.data||[]).filter((x:any)=>x.org_id==g.id).map((x:any)=>em.get(x.user_id)),brands:n(br,g.id),questions:n(pr,g.id),runs30:n(ru,g.id)}))})}
  if(b.action=="create_client"){
   const email=String(b.email||"").trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))return J({error:"A valid email is required"},400);
   if(String(b.password||"").length<8)return J({error:"Password must be at least 8 characters"},400);
   const plan=PLANS[b.plan]?b.plan:"starter";
   const {data:u,error}=await sc.auth.admin.createUser({email,password:b.password,email_confirm:true,user_metadata:{org:String(b.org||"").trim()||email}});
   if(error)return J({error:error.message},400);
   const {data:m}=await sc.from("memberships").select("org_id").eq("user_id",u.user!.id).single(); // created by the signup trigger
   await sc.from("organizations").update({plan,...PLANS[plan]}).eq("id",m!.org_id);
   if(String(b.brand||"").trim())await sc.from("brands").insert({org_id:m!.org_id,name:String(b.brand).trim(),domain:String(b.domain||"").replace(/^https?:\/\//,"").replace(/\/.*$/,"")||null});
   return J({ok:true})}
  if(b.action=="set_status"){if(!["active","suspended"].includes(b.status))return J({error:"Bad status"},400);await sc.from("organizations").update({status:b.status}).eq("id",b.org_id);return J({ok:true})}
  if(b.action=="set_plan"){if(!PLANS[b.plan])return J({error:"Unknown plan"},400);await sc.from("organizations").update({plan:b.plan,...PLANS[b.plan]}).eq("id",b.org_id);return J({ok:true})}
  if(b.action=="reset_password"){if(String(b.password||"").length<8)return J({error:"Password must be at least 8 characters"},400);
   const u=(await users()).find(x=>x.email==String(b.email).toLowerCase());if(!u)return J({error:"User not found"},404);
   const {error}=await sc.auth.admin.updateUserById(u.id,{password:b.password});if(error)return J({error:error.message},400);return J({ok:true})}
  return J({error:"Unknown action"},400);
 }catch(e){return J({error:String((e as Error).message||e)},400)}});

// Disposable PostgreSQL/pgcrypto contract gate; pgmq/auth/storage are local fixtures, not Hosted E2E.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const resolveDependency = createRequire(path.resolve(process.env.S30_PGLITE_ROOT || '/tmp/s30-db', 'package.json'));
const { PGlite } = resolveDependency('@electric-sql/pglite');
const { pgcrypto } = resolveDependency('@electric-sql/pglite/contrib/pgcrypto');
import fs from 'node:fs/promises';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const mode=process.argv[2] || 'upgrade';
if(!['fresh','upgrade'].includes(mode)) throw new Error('expected fresh or upgrade');
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`CREATE ROLE supabase_auth_admin; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,instance_id uuid,aud text,role text,email text,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
 CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA auth,storage,extensions TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
 GRANT SELECT ON storage.buckets TO anon,authenticated,service_role;
 CREATE SCHEMA pgmq;
 CREATE TABLE pgmq.q_ai_card_imports(msg_id bigserial PRIMARY KEY,read_ct integer DEFAULT 0,enqueued_at timestamptz DEFAULT now(),vt timestamptz DEFAULT now(),message jsonb);
 CREATE TABLE pgmq.a_ai_card_imports(LIKE pgmq.q_ai_card_imports);
 CREATE FUNCTION pgmq.create(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
 CREATE FUNCTION pgmq.format_table_name(text,text) RETURNS text LANGUAGE sql AS $$ SELECT 'q_ai_card_imports'::text $$;
 CREATE FUNCTION pgmq.send(text,jsonb,integer) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO pgmq.q_ai_card_imports(message,vt) VALUES($2,now()+make_interval(secs=>$3)) RETURNING msg_id $$;
 CREATE FUNCTION pgmq.send(text,jsonb,jsonb,timestamptz) RETURNS bigint LANGUAGE sql AS $$ SELECT pgmq.send($1,$2,0) $$;
 CREATE FUNCTION pgmq.archive(text,bigint) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN WITH deleted AS (DELETE FROM pgmq.q_ai_card_imports WHERE msg_id=$2 RETURNING *) INSERT INTO pgmq.a_ai_card_imports SELECT * FROM deleted; RETURN true; END; $$;
 CREATE FUNCTION pgmq.read(text,integer,integer,jsonb) RETURNS SETOF pgmq.q_ai_card_imports LANGUAGE sql AS $$ SELECT * FROM pgmq.q_ai_card_imports LIMIT $3 $$;
`);
// PostgreSQL grants refer to both arities, not a DEFAULT-argument alias.
await db.exec(`CREATE FUNCTION pgmq.send(text,jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT pgmq.send($1,$2,0) $$;`);
const excluded=[];
const deferred=[];
for(const file of (await fs.readdir(root+'/supabase/migrations')).sort()){
 if(!file.endsWith('.sql'))continue;
 if(file.startsWith('20261004')){deferred.push(file);continue;}
 let sql=await fs.readFile(root+'/supabase/migrations/'+file,'utf8');
 if(/pg_cron|pg_net|CREATE EXTENSION.*supabase_vault|vault\.|net\./.test(sql)){excluded.push(file);continue;}
 sql=sql.replace('CREATE EXTENSION IF NOT EXISTS pgmq;','-- queue implementation supplied by isolated harness');
 try{await db.exec(sql);console.log('applied',file);}catch(e){console.error('FAILED',file,e.message,e.detail,e.query?.slice(-500));await db.close();process.exit(1);}
}
console.log('excluded',excluded);

try {


const owner='10000000-0000-4000-8000-00000000000a', other='10000000-0000-4000-8000-00000000000b',deck='20000000-0000-4000-8000-00000000000a';
const client='fixture-client',session='fixture-session',secret='fixture-preview-secret-that-is-32-characters';
const slots={kanji:'危ない',isSingleKanji:false,shapeHint:{part:'崖',picture:'手すり'},meaningHint:'注意する',story:'崖の手すりで止まる'};
const explanation={summary:'手すりで止まる',mappings:[{part:'崖',meaning:'危険'},{part:'手すり',meaning:'止まる'}]};
const draft={slots,explanation};

const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
async function actor(kind='owner') {
 await db.exec('RESET ROLE');
 const sub=kind==='legacy'?'10000000-0000-4000-8000-00000000000c':kind==='other'?other:owner;
 const role=kind==='service'?'service_role':kind==='anon'?'anon':'authenticated';
 await db.query(`SELECT set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claim.sub',$3,false)`,[JSON.stringify({role,sub,client_id:client,session_id:session}),role,kind==='service'?'':sub]);
 await db.exec(`SET ROLE ${role}`);
}
async function admin(){await db.exec('RESET ROLE');}
async function rpc(name, args,kind='owner') {await actor(kind);try {const result=await q(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,args);return result[0].value;} finally {await admin();}}
let checks=0;
async function check(name,fn){try{await fn();checks++;console.log('PASS',name);}catch(e){console.error('CHECK FAILED',name,e.message,e.detail);throw e;}finally{await admin();}}
await db.exec(`INSERT INTO auth.users(id) VALUES('${owner}'),('${other}'); INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${owner}','fixture'); INSERT INTO s14_private.remote_mcp_runtime_config(key,value) VALUES('ai_preview_hmac_secret','${secret}');`);
function commitArgs(key,word='危ない',outcomes=null,fixtureOwner=owner,fixtureDeck=deck){
 const request={deck:{id:fixtureDeck},items:[{clientItemId:'r',conceptId:'c',pattern:'R1',front:word,back:'あぶない',tags:['fixture'],image:{mode:'ai'}},{clientItemId:'w',conceptId:'c',pattern:'W1',front:'あぶない',back:word,tags:['fixture'],image:{mode:'ai'}}]};
 const hash=createHash("sha256").update(JSON.stringify(request)).digest("hex");
 const payload={v:2,domain:'kanji-everyday:remote-mcp:preview:v2',userId:fixtureOwner,clientId:client,reservationKey:key,importRequestHash:hash,expiresAt:Math.floor(Date.now()/1000)+600};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');const token=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
 const pieces=['kanji-everyday:remote-mcp:generation:v1',hash,client].map(value=>{const text=Buffer.from(value);const length=Buffer.alloc(4);length.writeInt32BE(text.length);return Buffer.concat([length,text]);});
 return [client,session,key,hash,createHash('sha256').update(Buffer.concat(pieces)).digest('hex'),token,request,key,outcomes];
}
// Upgrade fixture: finalize a pre-S30 generic image, then prove the migration does not redo restoration.
if(mode==='upgrade'){
const legacyOwner='10000000-0000-4000-8000-00000000000c',legacyDeck='20000000-0000-4000-8000-00000000000c';
await db.query('INSERT INTO auth.users(id) VALUES($1)',[legacyOwner]);
await db.query('INSERT INTO public.decks(id,owner_user_id,name) VALUES($1,$2,$3)',[legacyDeck,legacyOwner,'legacy']);
const legacyBatch=(await rpc('s14_remote_commit_import',commitArgs('legacy-before-migration','学校',null,legacyOwner,legacyDeck),'legacy')).batchId;
const [legacyJob]=await q('SELECT * FROM public.ai_import_concept_jobs WHERE batch_id=$1',[legacyBatch]);
const legacyClaim=await rpc('claim_ai_import_concept',[legacyJob.id,legacyJob.queue_message_id,randomUUID()],'service');
await rpc('mark_ai_illustration_uploading',[legacyJob.id,legacyClaim.claimToken,'a'.repeat(64),64,64],'service');
await rpc('finalize_ai_import_concept',[legacyJob.id,legacyJob.queue_message_id,legacyClaim.claimToken,legacyJob.illustration_id,'a'.repeat(64),64,64],'service');
const legacyBefore=await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[legacyOwner]);
const legacyImageBefore=await q('SELECT * FROM public.illustrations WHERE owner_user_id=$1',[legacyOwner]);
await applyDeferred();
await check('upgrade preserves legacy completed cards/images and does not backfill or regenerate',async()=>{
 assert.deepEqual(await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[legacyOwner]),legacyBefore);
 assert.deepEqual(await q('SELECT * FROM public.illustrations WHERE owner_user_id=$1',[legacyOwner]),legacyImageBefore);
 assert.equal((await q('SELECT state FROM public.ai_import_concept_jobs WHERE id=$1',[legacyJob.id]))[0].state,'succeeded');
 assert.equal((await q('SELECT * FROM public.ai_illustration_repair_jobs')).length,0);
});
await check('legacy missing mnemonic repair keeps cards attached through failure and can retry',async()=>{
 const target=legacyBefore[0];
 const pending=await rpc('s14_remote_prepare_illustration_repair',[client,session,target.id,target.updated_at,'legacy-missing-repair'],'legacy');
 assert.equal(pending.mnemonic,null);
 const blocked=await rpc('s14_remote_complete_illustration_repair',[client,session,pending.repairId,pending.token,{conceptId:'c',status:'blocked',code:'MNEMONIC_RESPONSE_INVALID'}],'legacy');
 assert.equal(blocked.status,'blocked_mnemonic');
 assert.deepEqual(await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[legacyOwner]),legacyBefore);
 const resumed=await rpc('s14_remote_prepare_illustration_repair',[client,session,target.id,target.updated_at,'legacy-missing-repair'],'legacy');
 assert.equal(resumed.repairId,pending.repairId);
 const legacyDraft={...draft,slots:{...slots,kanji:'学校'}};
 await rpc('s14_remote_complete_illustration_repair',[client,session,resumed.repairId,resumed.token,{conceptId:'c',status:'approved',mnemonic:legacyDraft}],'legacy');
 const lease=await rpc('claim_ai_illustration_repair',[randomUUID()],'service');assert.equal(lease.repairId,pending.repairId);
 await rpc('mark_ai_repair_generated',[lease.repairId,lease.token,'f'.repeat(64),64,64,'e'.repeat(64)],'service');
 assert.equal((await rpc('finalize_ai_illustration_repair',[lease.repairId,lease.token],'service')).status,'succeeded');
 const after=await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[legacyOwner]);
 for(let i=0;i<after.length;i++) {
  const {illustration_key,updated_at,...kept}=after[i];
  const {illustration_key:oldKey,updated_at:oldAt,...expected}=legacyBefore[i];
  assert.deepEqual(kept,expected);assert.notEqual(illustration_key,oldKey);
 }
});
} else {await applyDeferred();}
async function applyDeferred(){for(const file of deferred){await db.exec(await fs.readFile(root+'/supabase/migrations/'+file,'utf8'));console.log('applied',file);}}
const args=commitArgs('blocked-fixture','危ない',[{conceptId:'c',status:'blocked',code:'MNEMONIC_TIMEOUT'}]);
let batch,job,claim,cards,before,repair;
await check('commit persists blocked reason and never completes',async()=>{
 batch=(await rpc('s14_remote_commit_import',args)).batchId;
 [job]=await q('SELECT * FROM public.ai_import_concept_jobs WHERE batch_id=$1',[batch]);
 assert.equal(job.state,'blocked_mnemonic');assert.equal(job.mnemonic_error_code,'MNEMONIC_TIMEOUT');
 const status=await rpc('s14_remote_get_import_status',[client,session,batch,null]);
 assert.equal(status.status,'blocked_mnemonic');assert.equal(status.counts.succeeded,0);assert.equal(status.items.length,2);
 assert(status.items.every(item=>item.errorCode==='MNEMONIC_TIMEOUT'));
});
await check('same idempotency key cannot overwrite persisted outcome',async()=>{
 const next=[...args];next[8]=[{conceptId:'c',...draft}];await rpc('s14_remote_commit_import',next);
 const [row]=await q('SELECT state,mnemonic_error_code FROM public.ai_import_concept_jobs WHERE id=$1',[job.id]);assert.equal(row.state,'blocked_mnemonic');
});
await check('blocked worker delivery stays blocked',async()=>{
 const result=await rpc('claim_ai_import_concept',[job.id,job.queue_message_id,randomUUID()],'service');assert.equal(result.outcome,'blocked');
});
await check('other owner and anon cannot start retry',async()=>{
 await assert.rejects(rpc('s14_remote_prepare_mnemonic_retry',[client,session,batch,'c'],'other'));
 await assert.rejects(rpc('s14_remote_prepare_mnemonic_retry',[client,session,batch,'c'],'anon'));
});
await check('retry lease fences duplicate callers and resumes same job',async()=>{
 const prepared=await rpc('s14_remote_prepare_mnemonic_retry',[client,session,batch,'c']);
 await assert.rejects(rpc('s14_remote_prepare_mnemonic_retry',[client,session,batch,'c']));
 await assert.rejects(rpc('s14_remote_complete_mnemonic_retry',[client,session,job.id,randomUUID(),{conceptId:'c',status:'approved',mnemonic:draft}]));
 const done=await rpc('s14_remote_complete_mnemonic_retry',[client,session,job.id,prepared.token,{conceptId:'c',status:'approved',mnemonic:draft}]);assert.equal(done.status,'queued');
 [job]=await q('SELECT * FROM public.ai_import_concept_jobs WHERE id=$1',[job.id]);assert.equal(job.batch_id,batch);
});
await check('claim carries approved slots and pins provenance',async()=>{
 claim=await rpc('claim_ai_import_concept',[job.id,job.queue_message_id,randomUUID()],'service');assert.deepEqual(claim.mnemonicSlots,slots);assert.equal(claim.mnemonicRequired,true);
 const [object]=await q('SELECT * FROM public.ai_illustration_objects WHERE job_id=$1',[job.id]);assert.equal(object.prompt_version,'mnemonic-v2');assert.equal(object.mnemonic_slots_hash.length,64);
});
await check('finalize refuses an image without prompt provenance',async()=>{
 await rpc('mark_ai_illustration_uploading',[job.id,claim.claimToken,'b'.repeat(64),64,64,null],'service');
 await assert.rejects(rpc('finalize_ai_import_concept',[job.id,job.queue_message_id,claim.claimToken,job.illustration_id,'b'.repeat(64),64,64],'service'));
 assert.equal((await q('SELECT * FROM public.cards WHERE owner_user_id=$1',[owner])).length,0);
});
await check('valid image creates R1/W1 sharing one object',async()=>{
 await rpc('mark_ai_illustration_uploading',[job.id,claim.claimToken,'b'.repeat(64),64,64,'c'.repeat(64)],'service');
 await rpc('finalize_ai_import_concept',[job.id,job.queue_message_id,claim.claimToken,job.illustration_id,'b'.repeat(64),64,64],'service');
 cards=await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[owner]);assert.equal(cards.length,2);assert.equal(cards[0].illustration_key,cards[1].illustration_key);
 const [object]=await q('SELECT reference_count FROM public.ai_illustration_objects WHERE job_id=$1',[job.id]);assert.equal(Number(object.reference_count),2);
 await db.exec(`INSERT INTO public.review_states(user_id,card_id,level,due_date,last_rating) SELECT '${owner}',id,4,'2026-10-10','good' FROM public.cards WHERE owner_user_id='${owner}'`);
 before=await snapshotCards();
});
async function snapshotCards(){return {cards:await q('SELECT id,front_text,back_text,skill,pattern,card_key FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[owner]),decks:await q('SELECT * FROM public.deck_cards ORDER BY card_id'),tags:await q('SELECT * FROM public.card_tags ORDER BY card_id,tag_id'),reviews:await q('SELECT * FROM public.review_states ORDER BY card_id')};}
await check('repair prepare is owner-scoped and one job per shared image',async()=>{
 await assert.rejects(rpc('s14_remote_prepare_illustration_repair',[client,session,cards[0].id,cards[0].updated_at,'repair-a'],'other'));
 repair=await rpc('s14_remote_prepare_illustration_repair',[client,session,cards[0].id,cards[0].updated_at,'repair-a']);assert.equal(repair.status,'needs_mnemonic');assert.deepEqual(repair.mnemonic,draft);
 await assert.rejects(rpc('s14_remote_prepare_illustration_repair',[client,session,cards[1].id,cards[1].updated_at,'repair-b']));
 await rpc('s14_remote_complete_illustration_repair',[client,session,repair.repairId,repair.token,{conceptId:'c',status:'approved',mnemonic:draft}]);
});
let rclaim;
await check('worker repair claim reserves once and fences another worker',async()=>{
 rclaim=await rpc('claim_ai_illustration_repair',[randomUUID()],'service');assert.equal(rclaim.outcome,'claimed');
 assert.equal((await rpc('claim_ai_illustration_repair',[randomUUID()],'service')).outcome,'empty');
 assert.equal((await q("SELECT * FROM public.ai_quota_reservations WHERE reservation_key=$1",['repair:'+repair.repairId])).length,1);
});
await check('active study postpones swap and retains generated image without another reservation',async()=>{
 await rpc('mark_ai_repair_generated',[repair.repairId,rclaim.token,'d'.repeat(64),64,64,'e'.repeat(64)],'service');
 await db.query('INSERT INTO public.study_sessions(user_id,deck_id,current_card_id) VALUES($1,$2,$3)',[owner,deck,cards[0].id]);
 const result=await rpc('finalize_ai_illustration_repair',[repair.repairId,rclaim.token],'service');assert.equal(result.errorCode,'ACTIVE_SESSION');
 assert.equal((await q('SELECT illustration_key FROM public.cards WHERE id=$1',[cards[0].id]))[0].illustration_key,cards[0].illustration_key);
 assert.equal((await rpc('claim_ai_illustration_repair',[randomUUID()],'service')).outcome,'empty');
 await db.query('UPDATE public.study_sessions SET finished_at=clock_timestamp() WHERE user_id=$1',[owner]);
 await db.query('UPDATE public.ai_illustration_repair_jobs SET next_attempt_at=clock_timestamp() WHERE id=$1',[repair.repairId]);
 rclaim=await rpc('claim_ai_illustration_repair',[randomUUID()],'service');assert.equal(rclaim.digest,'d'.repeat(64));
 assert.equal((await q("SELECT * FROM public.ai_quota_reservations WHERE reservation_key=$1",['repair:'+repair.repairId])).length,1);
});
await check('repair finalization atomically preserves all card/learning data',async()=>{
 await rpc('mark_ai_repair_generated',[repair.repairId,rclaim.token,'d'.repeat(64),64,64,'e'.repeat(64)],'service');
 const result=await rpc('finalize_ai_illustration_repair',[repair.repairId,rclaim.token],'service');assert.equal(result.status,'succeeded');
 assert.deepEqual(await snapshotCards(),before);
 const after=await q('SELECT illustration_key FROM public.cards WHERE owner_user_id=$1',[owner]);assert.equal(after[0].illustration_key,after[1].illustration_key);assert.notEqual(after[0].illustration_key,cards[0].illustration_key);
 const objects=await q('SELECT illustration_id,reference_count,state FROM public.ai_illustration_objects WHERE owner_user_id=$1',[owner]);
 const old=objects.find(o=>o.illustration_id===job.illustration_id);assert.equal(Number(old.reference_count),0);assert.equal(old.state,'delete_pending');
 const newer=objects.find(o=>o.illustration_id===rclaim.illustrationId);assert.equal(Number(newer.reference_count),2);assert.equal(newer.state,'ready');
 assert.equal((await q('SELECT state FROM public.ai_import_concept_jobs WHERE id=$1',[job.id]))[0].state,'succeeded');
});
await check('successful repair idempotency replay returns success without rewriting',async()=>{
 const result=await rpc('s14_remote_prepare_illustration_repair',[client,session,cards[0].id,cards[0].updated_at,'repair-a']);assert.equal(result.status,'succeeded');
});
await check('concurrent card edit rejects replacement and leaves shared references intact',async()=>{
 const current=await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[owner]);
 const next=await rpc('s14_remote_prepare_illustration_repair',[client,session,current[0].id,current[0].updated_at,'repair-edit-conflict']);
 await rpc('s14_remote_complete_illustration_repair',[client,session,next.repairId,next.token,{conceptId:'c',status:'approved',mnemonic:draft}]);
 const lease=await rpc('claim_ai_illustration_repair',[randomUUID()],'service');
 await rpc('mark_ai_repair_generated',[next.repairId,lease.token,'f'.repeat(64),64,64,'e'.repeat(64)],'service');
 await db.query('UPDATE public.cards SET updated_at=clock_timestamp() WHERE id=$1',[current[0].id]);
 assert.equal((await rpc('finalize_ai_illustration_repair',[next.repairId,lease.token],'service')).status,'conflict');
 assert((await q('SELECT illustration_key FROM public.cards WHERE owner_user_id=$1',[owner])).every(c=>c.illustration_key===current[0].illustration_key));
 assert.equal(Number((await q('SELECT reference_count FROM public.ai_illustration_objects WHERE illustration_id=$1',[lease.illustrationId]))[0].reference_count),0);
});
await check('private helpers and worker mutations reject authenticated or anon calls',async()=>{
 await assert.rejects(rpc('claim_ai_illustration_repair',[randomUUID()]));
 await assert.rejects(rpc('ai97_prepare_repair',[owner,cards[0].id,cards[0].updated_at,'forged']));
 await actor(); await assert.rejects(q('SELECT claim_token FROM public.ai_illustration_repair_jobs'));await admin();
 const [violations]=await q(`SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='public' AND (p.proname LIKE 'ai97_%' OR p.proname IN ('claim_ai_illustration_repair','mark_ai_repair_generated','fail_ai_illustration_repair','finalize_ai_illustration_repair'))
  AND (r.rolname<>'s10_migration_owner' OR NOT p.prosecdef AND p.proname NOT IN ('ai97_target_kanji','ai97_requires_mnemonic','ai97_valid_slots','ai97_valid_explanation'))`);assert.equal(Number(violations.n),0);
});
await check('blocked undo is permitted but live mnemonic retry cannot be undone',async()=>{
 const queued=(await rpc('s14_remote_commit_import',commitArgs('blocked-undo','川',[{conceptId:'c',status:'blocked',code:'MNEMONIC_NETWORK'}]))).batchId;
 const lease=await rpc('s14_remote_prepare_mnemonic_retry',[client,session,queued,'c']);
 await assert.rejects(rpc('undo_import',[queued]));
 await rpc('s14_remote_complete_mnemonic_retry',[client,session,lease.jobId,lease.token,{conceptId:'c',status:'blocked',code:'MNEMONIC_NETWORK'}]);
 await rpc('undo_import',[queued]);
 const status=await rpc('s14_remote_get_import_status',[client,session,queued,null]);assert.equal(status.status,'undone');
 assert(status.items.every(item=>item.status==='undone'));
});
await check('ambiguous repair retries are bounded and leave current cards attached',async()=>{
 const current=await q('SELECT * FROM public.cards WHERE owner_user_id=$1 ORDER BY id',[owner]);
 const next=await rpc('s14_remote_prepare_illustration_repair',[client,session,current[0].id,current[0].updated_at,'repair-exhaustion']);
 await rpc('s14_remote_complete_illustration_repair',[client,session,next.repairId,next.token,{conceptId:'c',status:'approved',mnemonic:draft}]);
 for(let attempt=0;attempt<3;attempt++){
  assert.equal((await rpc('claim_ai_illustration_repair',[randomUUID()],'service')).outcome,'claimed');
  await db.query("UPDATE public.ai_illustration_repair_jobs SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[next.repairId]);
 }
 assert.equal((await rpc('claim_ai_illustration_repair',[randomUUID()],'service')).outcome,'empty');
 const replay=await rpc('s14_remote_prepare_illustration_repair',[client,session,current[0].id,current[0].updated_at,'repair-exhaustion']);
 assert.equal(replay.errorCode,'REPAIR_RETRY_EXHAUSTED');
 assert((await q('SELECT illustration_key FROM public.cards WHERE owner_user_id=$1',[owner])).every(c=>c.illustration_key===current[0].illustration_key));
});
console.log('DATABASE CHECKS',mode,checks);

} catch(e) {console.error(e.message,e.detail,e.where);process.exitCode=1;} finally {await db.close();}

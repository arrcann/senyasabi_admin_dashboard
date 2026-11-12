import { createClient } from '@supabase/supabase-js';
import './style.css';

const CFG={url:import.meta.env.VITE_SUPABASE_URL||'',key:import.meta.env.VITE_SUPABASE_ANON_KEY||''};
const DEMO=!CFG.url||!CFG.key||CFG.url.startsWith('YOUR_');
const sb=DEMO?null:createClient(CFG.url,CFG.key);

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'–':Number(v).toLocaleString();
const pct=v=>v==null?'–':Number(v).toFixed(1)+'%';
const dur=s=>{if(s==null)return'–';s=+s;const h=Math.floor(s/3600),m=Math.round(s%3600/60);return h?`${h}h ${m}m`:`${m}m`};
const dt=d=>d?new Date(d).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'–';
const rpc=async(fn,a)=>{if(DEMO)return demo[fn](a);const{data,error}=await sb.rpc(fn,a);if(error)throw error;return data};
const setErr=m=>$('#err').textContent=m||'';

// ---- auth ----
async function boot(){
  if(DEMO){$('#demonote').hidden=$('#demobtn').hidden=false}
  else{const{data:{session}}=await sb.auth.getSession();if(session)return enter(session.user.email)}
  $('#login').hidden=false;
}
$('#lf').onsubmit=async e=>{e.preventDefault();setErr();
  if(DEMO)return setErr('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to sign in, or open the demo.');
  const{data,error}=await sb.auth.signInWithPassword({email:$('#em').value,password:$('#pw').value});
  if(error)return setErr(error.message);enter(data.user.email)};
$('#demobtn').onclick=()=>enter('demo@senyasabi');
$('#out').onclick=async()=>{if(!DEMO)await sb.auth.signOut();location.reload()};
async function enter(email){
  try{if(!DEMO&&!(await rpc('is_admin'))){await sb.auth.signOut();$('#login').hidden=false;return setErr('This account isn’t listed in admin_users.')}}
  catch(e){$('#login').hidden=false;return setErr(e.message)}
  $('#login').hidden=true;$('#app').hidden=false;$('#who').textContent=email;go('overview');
}
document.querySelector('nav').onclick=e=>{if(e.target.dataset.v)go(e.target.dataset.v)};
function go(v,arg){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===(v==='profile'?'users':v)));
  $('#main').innerHTML='<p class="sub">Loading…</p>';
  ({overview,users,profile})[v](arg).catch(e=>$('#main').innerHTML=`<div class="card">Couldn’t load data: ${esc(e.message)}</div>`);
}

// ---- helpers ----
const bar=(label,v,color='var(--accent-green)')=>`<div class="row"><div class="n">${label}</div><div class="track"><i style="width:${Math.min(100,v||0)}%;background:${color}"></i></div><div class="v">${pct(v)}</div></div>`;
function donut(d){const t=d.reduce((a,x)=>a+x[1],0),R=40,C=2*Math.PI*R;let o=0;
  return `<svg viewBox="0 0 100 100" class="donut" role="img" aria-label="Lesson completion distribution">${t?d.map(([,v,c])=>{const l=C*v/t,s=`<circle cx="50" cy="50" r="${R}" fill="none" stroke="${c}" stroke-width="16" stroke-dasharray="${l} ${C-l}" stroke-dashoffset="${-o}" transform="rotate(-90 50 50)"/>`;o+=l;return s}).join(''):`<circle cx="50" cy="50" r="${R}" fill="none" stroke="#ece4d3" stroke-width="16"/>`}<text x="50" y="52" text-anchor="middle" font-family="'Cherry Bomb One', cursive, sans-serif" font-weight="700" font-size="18" fill="var(--ink-secondary)">${t}</text><text x="50" y="65" text-anchor="middle" font-family="'Quicksand', sans-serif" font-weight="600" font-size="8" fill="var(--ink-mute)">learners</text></svg>`}
const stat=(l,v,s,c='')=>`<div class="card stat ${c}"><small>${l}</small><div class="big">${v}</div>${s?`<div class="sub">${s}</div>`:''}</div>`;
const chip=s=>`<span class="chip ${s==='Completed'?'ok':s==='In Progress'?'mid':''}">${esc(s)}</span>`;

// ---- overview ----
async function overview(){
  const d=await rpc('admin_dashboard_summary'),s=d.stats,q=d.quiz,l=d.lesson_distribution;
  $('#main').innerHTML=`
  <div class="welcome-banner">
    <div class="welcome-content">
      <span class="welcome-tag">Admin Control Center</span>
      <h1 class="welcome-heading">Welcome Back!</h1>
      <p class="welcome-sub">Here is what is happening with SenyaSabi learners today.</p>
    </div>
    <img src="/mascot-waving.png" alt="Senya mascot" class="welcome-mascot">
  </div>
  <div class="grid g3">
    ${stat('Registered Learners',num(s.total_users),`${s.pct_one_lesson==null?'–':s.pct_one_lesson}% finished at least one lesson`,'lead')}
    ${stat('Active (Last 7 Days)',num(s.active_7d),`${num(s.active_30d)} in the last 30 days`)}
    ${stat('Lessons Completed',num(s.lessons_completed))}
    ${stat('Average Accuracy',pct(s.avg_accuracy))}
    ${stat('Quizzes Completed',num(s.quizzes_completed))}
    ${stat('Minigames Completed',num(s.minigames_completed))}
    ${stat('Avg Learning Time',dur(s.avg_time_seconds))}
    ${stat('Average Streak',(s.avg_current_streak??'–')+' days')}
  </div>
  <div class="grid g2">
    <div><h2>Lesson Completion</h2><div class="card donutwrap">
      ${donut([['',l.not_started,'#E2D7C0'],['',l.in_progress,'var(--accent-gold)'],['',l.completed,'var(--accent-green)']])}
      <div class="legend">
        <div><i style="background:#E2D7C0"></i>Not started <b>${num(l.not_started)}</b></div>
        <div><i style="background:var(--accent-gold)"></i>Started, not finished <b>${num(l.in_progress)}</b></div>
        <div><i style="background:var(--accent-green)"></i>Completed all lessons <b>${num(l.completed)}</b></div>
      </div></div></div>
    <div><h2>Module Completion</h2><div class="card">
      <p class="sub" style="margin-top:0">Share of learners who finished each module</p>
      ${d.modules.length?d.modules.map(m=>bar(esc(m.title),m.pct_completed)).join(''):'<p class="sub">No modules yet.</p>'}
    </div></div>
  </div>
  <h2>Quiz Performance</h2>
  <div class="card">
    <div class="kpis"><div><small>Average Score</small><b>${pct(q.avg_score)}</b></div><div><small>Passing Rate</small><b>${pct(q.pass_rate)}</b></div>
      <div><small>Camera Accuracy</small><b>${pct(q.camera_accuracy)}</b></div><div><small>Multiple Choice Accuracy</small><b>${pct(q.mc_accuracy)}</b></div></div>
    <div class="grid g2"><div><h3>First vs Latest Attempt</h3>${bar('First attempt',q.first_attempt,'var(--accent-sage)')}${bar('Latest attempt',q.latest_attempt,'var(--accent-green)')}</div>
    <div><h3>Assessment Type</h3>${bar('Camera (signing)',q.camera_accuracy,'var(--accent-clay)')}${bar('Multiple choice',q.mc_accuracy,'var(--accent-gold)')}</div></div>
  </div>`;
}

// ---- learners table ----
let U=[],sort={k:'registered_at',d:-1},page=0,query='';
const COLS=[['name','Learner'],['registered_at','Registered'],['last_login','Last login'],['lessons_completed','Lessons'],['average_accuracy','Accuracy'],['total_time_spent_seconds','Time'],['current_streak','Streak']];
async function users(){if(!U.length)U=await rpc('admin_list_users');page=0;query='';drawUsers(true)}
function drawUsers(first){
  if(first)$('#main').innerHTML=`<h2 style="margin-top:0">Learners</h2><div class="bar"><input type="text" id="q" placeholder="Search by name or email" aria-label="Search learners"></div><div class="card"><div class="scroll" id="tbl"></div></div>`,
    $('#q').oninput=e=>{query=e.target.value.toLowerCase();page=0;drawUsers()};
  const rows=U.filter(u=>(u.name+' '+u.email).toLowerCase().includes(query)).sort((a,b)=>{const x=a[sort.k]??'',y=b[sort.k]??'';return (x>y?1:x<y?-1:0)*sort.d});
  const per=15,pages=Math.max(1,Math.ceil(rows.length/per));page=Math.min(page,pages-1);
  $('#tbl').innerHTML=`<table><thead><tr>${COLS.map(([k,l])=>`<th data-k="${k}">${l}${sort.k===k?(sort.d>0?' ↑':' ↓'):''}</th>`).join('')}</tr></thead><tbody>${
    rows.slice(page*per,page*per+per).map(u=>`<tr class="click" data-id="${u.user_id}"><td><b>${esc(u.name)}</b><br><small class="sub">${esc(u.email)}</small></td><td>${dt(u.registered_at)}</td><td>${dt(u.last_login)}</td><td>${num(u.lessons_completed)}</td><td>${pct(u.average_accuracy)}</td><td>${dur(u.total_time_spent_seconds)}</td><td>${u.current_streak} / ${u.longest_streak}</td></tr>`).join('')||'<tr><td colspan="7">No learners match.</td></tr>'}</tbody></table>
    <div class="pager"><span>${rows.length} learners · streak shows current / longest</span><span><button class="btn alt" id="pp" ${page?'':'disabled'}>Previous</button> Page ${page+1} of ${pages} <button class="btn alt" id="pn" ${page<pages-1?'':'disabled'}>Next</button></span></div>`;
  $('#tbl').querySelectorAll('th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;sort={k,d:sort.k===k?-sort.d:1};drawUsers()});
  $('#tbl').querySelectorAll('tr.click').forEach(tr=>tr.onclick=()=>go('profile',tr.dataset.id));
  $('#pp').onclick=()=>{page--;drawUsers()};$('#pn').onclick=()=>{page++;drawUsers()};
}

// ---- individual profile ----
async function profile(id){
  const p=await rpc('admin_user_profile',{p_user_id:id}),u=p.user;
  if(!u)throw new Error('Learner not found');
  const t=(h,rows)=>`<div class="scroll"><table><thead><tr>${h.map(x=>`<th style="cursor:default">${x}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${h.length}" class="sub">Nothing yet.</td></tr>`}</tbody></table></div>`;
  $('#main').innerHTML=`
  <button class="btn alt" id="back">← All learners</button>
  <h2 style="margin-top:16px">${esc(u.name)}</h2><p class="sub" style="margin-top:-8px">${esc(u.email)}</p>
  <div class="grid g3">
    ${stat('Registered',dt(u.registered_at))}${stat('Last login',dt(u.last_login))}${stat('Lessons completed',num(u.lessons_completed))}
    ${stat('Average accuracy',pct(u.average_accuracy))}${stat('Learning time',dur(u.total_time_spent_seconds))}${stat('Streak',u.current_streak+' days','Longest: '+u.longest_streak+' days')}
  </div>
  <h2>Module progress</h2><div class="card">${p.modules.map(m=>`<div class="row" style="grid-template-columns:170px 1fr 120px"><div class="n">${esc(m.title)}<br><small class="sub">${m.completed_lessons}/${m.total_lessons} lessons</small></div><div class="track"><i style="width:${m.completion_percentage}%"></i></div><div class="v">${chip(m.status)}</div></div>`).join('')||'<p class="sub">No modules.</p>'}</div>
  <h2>Quiz attempts</h2><div class="card">${t(['Quiz','Date','Score','Result','Camera','Multiple choice','Time'],p.quizzes.map(a=>`<tr><td>${esc(a.title)}</td><td>${dt(a.started_at)}</td><td>${pct(a.percentage)}</td><td><span class="chip ${a.passed?'ok':'bad'}">${a.passed?'Passed':'Not passed'}</span></td><td>${pct(a.camera_accuracy)}</td><td>${pct(a.mc_accuracy)}</td><td>${dur(a.duration_seconds)}</td></tr>`).join(''))}</div>
  <h2>Minigames</h2><div class="card">${t(['Game','Date','Score','Accuracy','Time'],p.minigames.map(a=>`<tr><td>${esc(a.title)}</td><td>${dt(a.completed_at)}</td><td>${num(a.score)}</td><td>${pct(a.accuracy)}</td><td>${dur(a.duration_seconds)}</td></tr>`).join(''))}</div>`;
  $('#back').onclick=()=>go('users');
}

// ---- sample data (only used when Supabase isn't configured) ----
const demo=(()=>{let s=7;const r=()=>(s=s*16807%2147483647)/2147483647,ago=d=>new Date(Date.now()-r()*d*864e5).toISOString();
  const N=['Maria Santos','Jose Reyes','Ana Cruz','Miguel Dela Cruz','Liza Mendoza','Paolo Garcia','Carla Ramos','Ben Aquino','Joy Bautista','Rico Villanueva'];
  const M=['Basics & Greetings','Family & People','Numbers','Daily Life','Food & Places'],Q=['Greetings quiz','Numbers quiz','Family quiz'],G=['Sign match','Speed signs'];
  const U=Array.from({length:32},(_,i)=>{const n=N[i%10]+(i>9?' '+(i-8):'');return{user_id:'u'+i,name:n,email:n.toLowerCase().replace(/[^a-z0-9]+/g,'.')+'@mail.com',registered_at:ago(160),last_login:ago(40),lessons_completed:Math.floor(r()*18),quizzes_completed:Math.floor(r()*9),minigames_completed:Math.floor(r()*12),average_accuracy:+(55+r()*42).toFixed(1),total_time_spent_seconds:Math.floor(r()*40000),current_streak:Math.floor(r()*9),longest_streak:9+Math.floor(r()*12)}});
  const sum=k=>U.reduce((a,u)=>a+u[k],0),avg=k=>+(sum(k)/U.length).toFixed(1);
  return{admin_list_users:async()=>U,
    admin_dashboard_summary:async()=>({stats:{total_users:U.length,lessons_completed:sum('lessons_completed'),avg_accuracy:avg('average_accuracy'),quizzes_completed:sum('quizzes_completed'),minigames_completed:sum('minigames_completed'),avg_time_seconds:Math.round(sum('total_time_spent_seconds')/U.length),avg_current_streak:avg('current_streak'),active_7d:14,active_30d:25,pct_one_lesson:84.4},
      lesson_distribution:{not_started:5,in_progress:22,completed:5},
      modules:M.map((title,i)=>({title,pct_completed:+(78-i*14+r()*6).toFixed(1)})),
      quiz:{avg_score:74.2,pass_rate:68.5,camera_accuracy:66.8,mc_accuracy:81.3,first_attempt:62.4,latest_attempt:77.9}}),
    admin_user_profile:async({p_user_id})=>({user:U.find(u=>u.user_id===p_user_id),
      modules:M.map((title,i)=>{const c=Math.max(0,Math.min(100,Math.round(100-i*24+r()*20)));return{title,total_lessons:6,completed_lessons:Math.round(c/100*6),completion_percentage:c,status:c>=100?'Completed':c>0?'In Progress':'Not Started'}}),
      quizzes:Q.concat(Q).map(title=>{const p=+(40+r()*58).toFixed(1);return{title,started_at:ago(60),percentage:p,passed:p>=70,camera_accuracy:+(40+r()*55).toFixed(1),mc_accuracy:+(50+r()*48).toFixed(1),duration_seconds:Math.floor(120+r()*400)}}),
      minigames:G.concat(G).map(title=>({title,completed_at:ago(60),score:Math.floor(r()*900),accuracy:+(50+r()*48).toFixed(1),duration_seconds:Math.floor(60+r()*200)}))})}})();

boot();

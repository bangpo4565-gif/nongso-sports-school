// 학생 앱과 선생님 화면이 같이 쓰는 것들
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
export { SUPABASE_URL, SUPABASE_KEY };
export const configured = () => !!(SUPABASE_URL && SUPABASE_KEY);

/* ---------- 서버 함수 부르기 (학생: 로그인 없이 anon 키로) ---------- */
export async function rpc(fn, args = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) { const e = new Error((d && d.message) || r.statusText); e.code = (d && d.message) || String(r.status); throw e; }
  return d;
}

/* ---------- 작은 도우미 ---------- */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const mmss = s => { s = Math.max(0, Math.ceil(s)); const m = Math.floor(s / 60); return (m ? m + "분 " : "") + (s % 60) + "초"; };
export const clock = s => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
export function levelOf(xp) { let lv = 1, need = 100, acc = 0; while (xp >= acc + need) { acc += need; lv++; need = 100 + 20 * (lv - 1); } return { lv, into: xp - acc, need }; }
/* 상태 글자: DB 값은 그대로 두고 화면에만 한국어로 보여요 */
export const STLAB = { WAITING: "대기", ACTIVE: "운동 중", COMPLETED: "완료", FAILED: "미완료", MANUAL: "선생님 인정" };
export const stTag = (st, t) => `<span class="state st-${st}">${t || STLAB[st] || st}</span>`;
export function tierOf(xp) { const t = [["LEGEND", 4000], ["ELITE", 2500], ["GOLD", 1500], ["SILVER", 700], ["BRONZE", 200], ["ROOKIE", 0]]; for (const [n, v] of t) if (xp >= v) return n; return "ROOKIE"; }
const KST = { timeZone: "Asia/Seoul" };
export const fmtDay = d => new Date(d).toLocaleDateString("ko-KR", { ...KST, month: "2-digit", day: "2-digit" }).replace(/\s/g, "").replace(/\.$/, "");
export const fmtTime = d => new Date(d).toLocaleTimeString("ko-KR", { ...KST, hour: "2-digit", minute: "2-digit", hour12: false });
export const fmtDT = d => d ? fmtDay(d) + " " + fmtTime(d) : "–";
let toastT;
export function toast(t) { const el = document.getElementById("toast"); if (!el) return; el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 2600); }
export function deviceId() {
  try { let d = localStorage.getItem("ns_device"); if (!d) { d = crypto.randomUUID(); localStorage.setItem("ns_device", d); } return d; }
  catch { return null; }
}
export const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};

/* ---------- 오류 문구 ---------- */
export const ERR = {
  login_failed: "학번이나 비밀번호가 맞지 않아요.",
  locked: "5번 틀려서 10분 동안 잠겼어요. 잠시 뒤에 다시 해 주세요.",
  not_signed_up: "아직 가입하지 않은 학번이에요. '처음이에요'에서 비밀번호를 만들어 주세요.",
  no_match: "이름과 학번이 학교 명단과 맞지 않아요. 띄어쓰기 없이 다시 써 보세요.",
  already: "이미 가입된 학번이에요. 내가 가입한 적이 없으면 체육 선생님께 말해 주세요.",
  pw_format: "비밀번호는 8자 이상으로 만들어 주세요.",
  wrong_pw: "지금 비밀번호가 맞지 않아요.",
  session_expired: "로그인이 끝났어요. 다시 로그인해 주세요.",
  bad_qr: "농소스포츠스쿨 QR이 아니에요. TV 화면의 QR을 찍어 주세요.",
  expired: "QR이 만료됐어요. 지금 TV에 떠 있는 QR을 다시 찍어 주세요.",
  session_closed: "이 출석 세션은 이미 닫혔어요.",
  not_target: "이 출석은 다른 학년 대상이에요.",
  need_location: "위치 인증이 필요해요. 위치 권한을 허용하고 다시 찍어 주세요.",
  too_far: "학교 운동장에서 너무 멀어요. 운동하는 곳에서 찍어 주세요.",
  already_in: "이미 운동을 시작했어요. 운동을 마치고 운동 완료 QR을 찍어 주세요.",
  already_done: "오늘 이 프로그램은 이미 끝났어요.",
  device_used: "이 휴대폰으로 이미 다른 학생이 출석했어요. 내 휴대폰으로 찍어 주세요.",
  not_in: "먼저 운동 시작 QR을 찍어야 해요.",
  other_device: "운동을 시작한 휴대폰으로 완료 QR을 찍어 주세요.",
  too_early: "아직 활동 인증 시간이 충족되지 않았습니다.",
  not_found: "미션을 찾지 못했어요.",
  not_open: "아직 미션 시간이 아니에요.",
  closed: "미션 시간이 끝났어요.",
  not_enough: "목표를 다 채우지 못했어요.",
  free_off: "선생님이 자유운동을 잠시 꺼 두었어요.",
  bad_kind: "지금은 고를 수 없는 운동이에요."
};
export const errText = (code, extra) => (ERR[code] || "문제가 생겼어요. 잠시 뒤에 다시 해 주세요.") + (extra ? " " + extra : "");

/* ---------- 아이콘 ---------- */
const IC = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>',
  my:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.4"/><path d="M5.8 16.5c.8-1.6 1.9-2.3 3.2-2.3s2.4.7 3.2 2.3M14.5 10h4M14.5 13.5h3"/></svg>',
  rank:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 20h18M5 20v-6h4v6M10 20V8h4v12M15 20v-9h4v9"/></svg>',
  more:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  back:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>',
  trophy:c=>`<svg viewBox="0 0 40 40" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"><path d="M12 6h16v8a8 8 0 0 1-16 0z"/><path d="M12 9H6v2a6 6 0 0 0 6 6M28 9h6v2a6 6 0 0 1-6 6M20 22v6M14 34h12M16 28h8v6h-8z"/></svg>`
};


/* ---------- 상품 그림 ---------- */
function pizza(){return `<svg class="art" viewBox="0 0 200 140" aria-hidden="true">
  <ellipse cx="100" cy="128" rx="78" ry="8" fill="rgba(0,0,0,.25)"/>
  <circle cx="100" cy="72" r="58" fill="#e8a24a"/><circle cx="100" cy="72" r="50" fill="#f6c453"/>
  <path d="M100 72 L150 50 A50 50 0 0 0 128 30 Z" fill="#0d1430" opacity=".9"/>
  <g fill="#d6452f"><circle cx="78" cy="56" r="8"/><circle cx="116" cy="92" r="8"/><circle cx="76" cy="94" r="7"/><circle cx="104" cy="44" r="6"/><circle cx="130" cy="72" r="7"/></g>
  <g fill="#3f8f4a"><rect x="92" y="66" width="8" height="4" rx="2" transform="rotate(30 96 68)"/><rect x="62" y="74" width="8" height="4" rx="2"/><rect x="100" y="104" width="8" height="4" rx="2" transform="rotate(-20 104 106)"/></g>
  <path d="M158 40 L188 26 A40 40 0 0 1 182 62 Z" fill="#f6c453" stroke="#e8a24a" stroke-width="5" stroke-linejoin="round"/><circle cx="178" cy="44" r="5" fill="#d6452f"/>
</svg>`;}
function burger(){return `<svg class="art" viewBox="0 0 200 140" aria-hidden="true">
  <ellipse cx="100" cy="130" rx="80" ry="7" fill="rgba(0,0,0,.25)"/>
  <path d="M28 70 Q28 30 76 30 Q124 30 124 70 Z" fill="#e9a04a"/>
  <g fill="#fff3d6"><ellipse cx="58" cy="46" rx="3" ry="2"/><ellipse cx="76" cy="40" rx="3" ry="2"/><ellipse cx="94" cy="48" rx="3" ry="2"/><ellipse cx="70" cy="56" rx="3" ry="2"/></g>
  <path d="M24 72 h104 l-8 8 l-8 -6 l-8 6 l-8 -6 l-8 6 l-8 -6 l-8 6 l-8 -6 l-8 6 l-8 -6 l-8 6 l-8 -6 z" fill="#4caf50"/>
  <rect x="26" y="80" width="100" height="10" rx="3" fill="#f2c230"/>
  <rect x="24" y="88" width="104" height="16" rx="8" fill="#7a3e1c"/>
  <path d="M28 106 h96 q0 16 -16 16 h-64 q-16 0 -16 -16z" fill="#e9a04a"/>
  <rect x="134" y="78" width="56" height="30" rx="15" fill="#e9a04a"/>
  <rect x="128" y="84" width="68" height="16" rx="8" fill="#b9472b"/>
  <path d="M136 92 q6 -6 12 0 t12 0 t12 0 t12 0" fill="none" stroke="#f2c230" stroke-width="3" stroke-linecap="round"/>
  <path d="M134 104 h56 q0 12 -14 12 h-28 q-14 0 -14 -12z" fill="#d88c3a"/>
</svg>`;}
function snack(){return `<svg class="art" viewBox="0 0 200 140" aria-hidden="true">
  <ellipse cx="100" cy="130" rx="80" ry="7" fill="rgba(0,0,0,.25)"/>
  <path d="M40 22 l60 0 l-4 10 l6 80 l4 10 l-66 0 l4 -10 l6 -80 z" fill="#45d2c6"/>
  <path d="M40 22 h60 l-4 10 h-52z M38 112 h66 l4 10 h-74z" fill="#2aa79c"/>
  <circle cx="70" cy="68" r="20" fill="#ffd166"/><text x="70" y="74" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="800" font-size="17" fill="#0d1430">CHIP</text>
  <g transform="rotate(-18 150 60)"><rect x="128" y="48" width="44" height="24" rx="12" fill="#ff7a2f"/><path d="M128 60 l-14 -10 v20z M172 60 l14 -10 v20z" fill="#ff9d5c"/><path d="M140 52 v16 M150 52 v16 M160 52 v16" stroke="#ffd2b3" stroke-width="3"/></g>
  <g transform="translate(150 104)"><rect x="-20" y="-12" width="40" height="22" rx="4" fill="#cfd8ea"/><rect x="-20" y="-12" width="40" height="7" rx="3" fill="#8f9cc1"/><circle cx="-8" cy="3" r="3" fill="#7a3e1c"/><circle cx="6" cy="2" r="3" fill="#7a3e1c"/></g>
</svg>`;}


/* ---------- 학급 레이스 ---------- */
const ARTS = [pizza(), burger(), snack()];
export function raceOrder(board) {
  const rows = (board.rows || []).map(r => ({ cls: r.class, n: r.n, p: r.parts, rate: +r.rate }));
  const order = [...rows].sort((a, b) => b.rate - a.rate || a.cls - b.cls);
  order.forEach((x, i) => x.rank = i + 1);
  return { rows: rows.sort((a, b) => a.cls - b.cls), order };
}
export function chaseOf(board, cls) {
  const { order } = raceOrder(board); const i = order.findIndex(x => x.cls === cls);
  if (i <= 0) return null; const m = order[i], up = order[i - 1];
  return { need: Math.max(1, Math.floor(up.rate * m.n * Math.max(board.days, 1) - m.p) + 1), up, me: m };
}
export function raceHTML(board, compact, mine) {
  const g = board.grade, { rows, order } = raceOrder(board), prizes = board.prizes || [];
  if (!rows.length) return `<div class="card muted">아직 ${g}학년 명단이 없어요.</div>`;
  const pod = [1, 2, 3].map(k => { const x = order[k - 1]; if (!x) return ""; return `<div class="prize p${k}">${ARTS[k - 1]}<div class="txt"><div class="rankno">${k}등</div><div class="what">${esc(prizes[k - 1] || "")}</div><div class="holder"><b class="num">${g}-${x.cls}</b><span>참여율 ${Math.round(x.rate * 100)}%</span></div></div></div>`; }).join("");
  const flag = '<svg class="flag" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18" stroke="#eef1ff" stroke-width="2"/><path d="M6 4h12l-3 4 3 4H6z" fill="#ff7a2f"/></svg>';
  const lanes = `<div class="scale"><span>학급</span><div class="ticks">${[0, 25, 50, 75, 100].map(v => `<span style="left:${v}%">${v}%</span>`).join("")}</div><span style="text-align:right">참여율</span></div>` + rows.map(x => {
    const rk = order.find(o => o.cls === x.cls).rank, pct = Math.min(1, x.rate) * 100;
    return `<div class="lane r${rk <= 3 ? rk : 0} ${x.cls === mine ? "mine" : ""}"><div class="cls num">${x.cls}반<small>${x.n}명</small></div><div class="road" role="img" aria-label="${x.cls}반 참여율 ${Math.round(pct)}%"><div class="fill" style="width:${pct}%"></div>${flag}<div class="runner" style="left:clamp(20px, ${pct}%, calc(100% - 20px))">${x.cls}</div></div><div class="res"><b class="num">${Math.round(pct)}%</b>${rk <= 3 ? `<span class="tag">${rk}등</span>` : ""}<small>${rk}위 · 누적 ${x.p}명</small></div></div>`;
  }).join("");
  const ch = [];
  for (const i of [3, 1, 2, 4]) {
    if (i >= order.length) continue; const m = order[i], up = order[i - 1];
    const need = Math.max(1, Math.floor(up.rate * m.n * Math.max(board.days, 1) - m.p) + 1);
    const goal = up.rank <= 3 ? `${up.rank}등 ${esc(prizes[up.rank - 1] || "")}` : `${up.rank}위`;
    ch.push(`<div><b class="num">${g}-${m.cls}</b> 참여 <b class="num">${need}번</b>만 더 모이면<br><span style="color:var(--muted)">${g}-${up.cls}반을 따라잡고 ${goal} 자리에 올라요</span></div>`);
    if (ch.length === (compact ? 2 : 3)) break;
  }
  return `<div class="racewrap ${compact ? "compact" : ""}"><section class="podium">${pod}</section><section class="track"><div class="track-inner">${lanes}</div></section>${ch.length ? `<section class="chase">${ch.join("")}</section>` : ""}</div>`;
}
export const racePeriod = b => b.from || b.to ? `${b.from ? fmtDay(b.from) : "처음"} ~ ${b.to ? fmtDay(b.to) : "지금"}` : "전체 기간";

/* ---------- PAPS 중학교 기준 (2025 공개 기준표) ---------- */
const PAPS={
  items:{
    shuttle:{el:"심폐지구력",name:"왕복오래달리기",unit:"회",hi:true,step:1,cut:{"1M":[64,50,36,20],"2M":[66,52,38,22],"3M":[68,54,40,24],"1F":[35,25,19,14],"2F":[40,29,21,15],"3F":[45,33,23,16]}},
    curl:{el:"근지구력",name:"윗몸말아올리기",unit:"회",hi:true,step:1,cut:{"1M":[90,55,33,14],"2M":[90,55,33,14],"3M":[90,55,33,14],"1F":[58,43,22,7],"2F":[58,39,19,7],"3F":[52,34,17,6]}},
    reach:{el:"유연성",name:"앉아윗몸앞으로굽히기",unit:"cm",hi:true,step:0.1,cut:{"1M":[10,6,2,-4],"2M":[10,7,2,-4],"3M":[10,7,2.6,-3],"1F":[15,11,8,2],"2F":[16,11,8,2],"3F":[16,11,8,2]}},
    run50:{el:"순발력",name:"50m 달리기",unit:"초",hi:false,step:0.01,cut:{"1M":[7.5,8.4,9.3,11.5],"2M":[7.3,8.2,9.0,11.5],"3M":[7.0,7.8,8.5,11.0],"1F":[8.8,9.8,10.5,12.2],"2F":[8.8,9.8,10.5,12.2],"3F":[8.8,9.8,10.5,12.2]}},
    jump:{el:"순발력",name:"제자리멀리뛰기",unit:"cm",hi:true,step:0.1,cut:{"1M":[211.1,177.1,159.1,131.1],"2M":[218.1,187.1,169.1,136.1],"3M":[238.1,201.1,180.1,145.1],"1F":[175.1,144.1,127.1,100.1],"2F":[183.1,145.1,127.1,100.1],"3F":[183.1,145.1,127.1,100.1]}},
    grip:{el:"근력",name:"악력",unit:"kg",hi:true,step:0.1,cut:{"1M":[42,30,22.5,16.5],"2M":[44.5,37,28.5,22],"3M":[48.5,40.5,33,25],"1F":[36,23,19,14],"2F":[36,25.5,19.5,14],"3F":[36,27.5,19.5,16]}},
    bmi:{el:"BMI",name:"체질량지수",unit:"",hi:null}
  },
  // BMI 판정 경계: 마름 이하, 정상 이하, 과체중 이하, 경도비만 이하
  bmi:{"1M":[15.4,22.6,24.7,34.7],"2M":[16.1,23.1,25.6,35.6],"3M":[16.7,23.7,25.9,35.9],"1F":[15.5,22.9,25.7,35.8],"2F":[15.9,23.3,26.2,36.3],"3F":[16.5,23.7,26.6,36.7]},
  bmiNames:["마름","정상","과체중","경도비만","고도비만"],
  // 그래프 점수용 순서: 정상=1, 마름·과체중=2, 경도비만=4, 고도비만=5
  bmiOrder:[2,1,2,4,5]
};
function bmiCat(g,sex,v){const c=PAPS.bmi[g+sex];return v<=c[0]?0:v<=c[1]?1:v<=c[2]?2:v<=c[3]?3:4;}
function papsGrade(key,g,sex,v){
  if(key==="bmi"){const c=PAPS.bmi[g+sex];const i=v<=c[0]?0:v<=c[1]?1:v<=c[2]?2:v<=c[3]?3:4;return PAPS.bmiOrder[i];}
  const it=PAPS.items[key],c=it.cut[g+sex];
  for(let i=0;i<4;i++){ if(it.hi? v>=c[i] : v<=c[i]) return i+1; }
  return 5;
}
function papsRange(it,c,gr){
  const f=x=>+x.toFixed(it.step<1?(it.step===0.01?2:1):0);
  if(it.hi){ if(gr===1) return `${f(c[0])}↑`; if(gr===5) return `${f(c[3]-it.step)}↓`; return `${f(c[gr-1])}~${f(c[gr-2]-it.step)}`; }
  if(gr===1) return `${f(c[0])}↓`; if(gr===5) return `${f(c[3]+it.step)}↑`; return `${f(c[gr-2]+it.step)}~${f(c[gr-1])}`;
}

/* 학생별 PAPS 기록에 쓰는 종목 이름 (기준표에 없는 종목 포함). hi: 클수록 좋은 기록 */
export const PAPS_REC = {
  total: { el: "종합", name: "건강체력 점수", unit: "점", hi: true },
  shuttle: { el: "심폐지구력", name: "왕복오래달리기", unit: "회", hi: true },
  longrun: { el: "심폐지구력", name: "오래달리기걷기", unit: "분.초", hi: false },
  step: { el: "심폐지구력", name: "스텝검사", unit: "점", hi: true },
  reach: { el: "유연성", name: "앉아윗몸앞으로굽히기", unit: "cm", hi: true },
  flex: { el: "유연성", name: "종합유연성", unit: "점", hi: true },
  pushup: { el: "근력·근지구력", name: "(무릎대고)팔굽혀펴기", unit: "회", hi: true },
  curl: { el: "근력·근지구력", name: "윗몸말아올리기", unit: "회", hi: true },
  grip: { el: "근력·근지구력", name: "악력", unit: "kg", hi: true },
  run50: { el: "순발력", name: "50m 달리기", unit: "초", hi: false },
  jump: { el: "순발력", name: "제자리멀리뛰기", unit: "cm", hi: true },
  bmi: { el: "비만", name: "BMI(체질량지수)", unit: "kg/㎡", hi: null }
};
export const PAPS_KEYS = Object.keys(PAPS_REC);
/* 우리 학교가 실제로 측정하는 종목만 화면에 보여요 */
export const PAPS_USE = ["total", "shuttle", "reach", "curl", "jump", "bmi"];
/* 등급 칸 글자: BMI는 마름·정상… 이름, 나머지는 N등급 */
export const papsGradeName = (item, g) => !g ? "" : item === "bmi" ? (PAPS.bmiNames[g - 1] || "") : `${g}등급`;
/* 등급 칸에 쓴 글자를 숫자로: BMI는 마름=1 … 고도비만=5 */
export function papsGradeNum(item, t) {
  const s = String(t || "").replace(/\s/g, "");
  if (item === "bmi") { const i = PAPS.bmiNames.indexOf(s); if (i >= 0) return i + 1; }
  const n = s.replace(/[^0-9]/g, ""); return n && +n >= 1 && +n <= 5 ? +n : null;
}
/* 종목 이름(한글)이나 키를 키로 바꿔요. 못 찾으면 null */
export function papsKey(t) {
  const n = String(t || "").replace(/\s|\(.*?\)|기록/g, "");
  if (PAPS_REC[n]) return n;
  for (const k of PAPS_KEYS) { const nm = PAPS_REC[k].name.replace(/\s|\(.*?\)/g, ""); if (nm === n) return k; }
  if (/총점|종합점수|건강체력점수/.test(n)) return "total";
  if (/팔굽혀펴기/.test(n)) return "pushup";
  if (/^(BMI|bmi|체질량지수|비만)/.test(n)) return "bmi";
  return null;
}

/* ---------- 미션 종류 ---------- */
export const MKIND = {
  walk: { name: "걷기", unit: "보", how: "sensor", tip: "휴대폰을 손에 들거나 주머니에 넣고 걸어요. 다 걸을 때까지 앱 화면은 켜 둬요.", def: 1000 },
  squat: { name: "스쿼트", unit: "회", how: "pose", tip: "정면이나 옆으로 서서 머리부터 발끝까지 보이게 서 주세요.", def: 20 },
  pushup: { name: "팔굽혀펴기", unit: "회", how: "pose", tip: "카메라 옆으로 엎드려 몸 전체가 보이게 해 주세요.", def: 10 },
  lunge: { name: "런지", unit: "회", how: "pose", tip: "정면이나 옆으로 서서 발끝까지 보이게 서 주세요.", def: 20 },
  jack: { name: "팔벌려뛰기", unit: "회", how: "pose", tip: "정면으로 서서 팔이 다 보이게 서 주세요.", def: 30 },
  plank: { name: "플랭크", unit: "초", how: "pose", tip: "카메라 옆으로 엎드려 머리부터 발까지 보이게 해 주세요.", def: 30 }
};
export const HOWLAB = { sensor: "걸음 센서", pose: "자세 인식" };
export const mTitle = m => `${MKIND[m.kind].name} ${Number(m.goal).toLocaleString()}${MKIND[m.kind].unit}`;
export const BELL = n => `<span class="bell" aria-label="남은 미션 ${n}개"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Z" fill="var(--gold)"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" fill="var(--gold)"/></svg><b class="num">${n}</b></span>`;

export { IC, PAPS, papsRange, papsGrade, bmiCat };

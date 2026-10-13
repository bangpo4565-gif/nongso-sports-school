// 선생님 화면. 로그인은 Supabase 계정(이메일), 기록은 모두 admin_* 서버 함수로만 바꿔요.
import { SUPABASE_URL, SUPABASE_KEY, configured, esc, mmss, clock, levelOf, fmtDay, fmtTime, fmtDT, toast,
  raceHTML, racePeriod, MKIND, HOWLAB, mTitle } from "./common.js";

const $app = document.getElementById("app");
const sb = configured() ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const S = {
  view: "loading", authTab: "login", msg: null, busy: false, me: null, page: "dash", tv: false,
  dash: null, sessions: null, sid: null, live: null, liveClass: "", qrMode: "in", qr: null,
  raceGrade: 1, race: {}, classes: null, cls: null, students: null, missions: null, mview: null, mcls: null, msubs: null, cfg: null
};

const AERR = {
  not_staff: "승인된 선생님만 할 수 있어요.", not_owner: "관리교사만 바꿀 수 있어요.", last_owner: "관리교사는 한 명 이상 남아 있어야 해요.",
  session_closed: "이 세션은 닫혔어요. 다시 열거나 새 세션을 열어 주세요.", bad_program: "쓸 수 없는 프로그램이에요.", bad_time: "마감이 시작보다 늦어야 해요.",
  need_reason: "XP를 조정하는 이유를 적어 주세요.", too_big: "한 번에 500 XP까지만 조정할 수 있어요.",
  "Invalid login credentials": "이메일이나 비밀번호가 맞지 않아요.", "Email not confirmed": "메일함에서 가입 확인 링크를 먼저 눌러 주세요.",
  "User already registered": "이미 가입된 이메일이에요. 로그인해 주세요."
};
const aerr = e => { const m = (e && (e.message || e.error_description)) || String(e || ""); for (const k in AERR) if (m.includes(k)) return AERR[k]; return "문제가 생겼어요: " + m; };
async function call(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
const today = () => new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
const tgt = (g, c) => g ? `${g}학년${c ? ` ${c}반` : " 전체"}` : "전교생";
const isOwner = () => S.me && S.me.role === "owner";
const studentUrl = () => new URL("./", location.href).href;

/* ---------- 로그인 ---------- */
function vAuth() {
  const up = S.authTab === "signup";
  return `<div class="login"><div class="loginphoto" style="background-image:url(img/splash.jpg)"><div>TEACHER<br>CONSOLE</div></div>
    ${!configured() ? `<div class="msg bad">js/config.js 에 Supabase 주소와 공개 키가 아직 없어요.</div>` : ""}
    <div class="seg"><button data-act="authtab" data-v="login" class="${up ? "" : "on"}">로그인</button><button data-act="authtab" data-v="signup" class="${up ? "on" : ""}">선생님 가입</button></div>
    ${S.msg ? `<div class="msg ${S.msg.k}" role="alert">${esc(S.msg.t)}</div>` : ""}
    <form id="authForm" class="stack">
      ${up ? `<div class="field"><label for="tname">이름</label><input id="tname" required autocomplete="name"></div>` : ""}
      <div class="field"><label for="temail">이메일</label><input id="temail" type="email" required autocomplete="email"></div>
      <div class="field"><label for="tpw">비밀번호${up ? " (8자 이상)" : ""}</label><input id="tpw" type="password" minlength="${up ? 8 : 1}" required autocomplete="${up ? "new-password" : "current-password"}"></div>
      <button class="btn" type="submit" ${S.busy ? "disabled" : ""}>${up ? "가입 신청" : "로그인"}</button>
      <p class="small muted" style="margin:0">${up ? "맨 처음 가입한 선생님이 관리교사가 되고, 그다음부터는 관리교사가 승인해야 쓸 수 있어요." : "학생은 이 화면이 아니라 학생 앱에서 학번으로 로그인해요."}</p>
    </form><a class="back" href="${studentUrl()}">학생 앱으로 가기 ›</a></div>`;
}
function vPending() {
  return `<div class="phone"><div class="stack" style="margin-top:40px"><div class="pagehead"><span class="eyebrow">WAITING</span><h2>승인을 기다리고 있어요</h2></div>
    <div class="card">관리교사가 설정 화면에서 승인하면 바로 쓸 수 있어요. 승인된 뒤 아래 버튼을 눌러 주세요.</div>
    <button class="btn" data-act="recheck">승인됐는지 다시 확인</button><button class="btn ghost" data-act="logout">로그아웃</button></div></div>`;
}

/* ---------- 화면 틀 ---------- */
const MENU = [["dash", "DASHBOARD"], ["sessions", "QR 출석 열기"], ["live", "LIVE 출석"], ["qr", "QR 화면 (TV)"], ["race", "학급 레이스 (TV)"],
  ["mission", "미션"], ["students", "학생 · 명단"], ["staff", "선생님 참여"], ["programs", "운동 프로그램"], ["settings", "설정"]];
function vAdmin() {
  const p = S.page;
  const body = p === "dash" ? aDash() : p === "sessions" ? aSessions() : p === "live" ? aLive() : p === "qr" ? aQr() : p === "race" ? aRace()
    : p === "mission" ? aMission() : p === "students" ? aStudents() : p === "staff" ? aStaff() : p === "programs" ? aPrograms() : aSettings();
  const pend = S.dash?.pending_teachers || 0;
  return `<div class="admin ${S.tv ? "tv" : ""}"><aside class="side"><div class="brand">NONGSO <em>ADMIN</em></div><div class="grp">${esc(S.me?.name || S.me?.email || "")}</div>
    ${MENU.map(([k, t]) => `<button data-act="page" data-v="${k}" class="${p === k ? "on" : ""}">${t}${k === "settings" && pend && isOwner() ? `<small>승인 ${pend}</small>` : ""}</button>`).join("")}
    <div class="grp">바로가기</div><button data-act="openapp">학생 앱 열기</button><button data-act="logout">로그아웃</button>
    </aside><main class="main">${body}</main></div>`;
}
const head = (eyebrow, title, right = "") => `<div class="ahead"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1></div><div class="row" style="flex-wrap:wrap">${right}</div></div>`;
const loading = `<div class="card muted">불러오는 중이에요…</div>`;

/* ---------- DASHBOARD ---------- */
function aDash() {
  const d = S.dash;
  if (!d) return head(today(), "DASHBOARD") + loading;
  const open = (S.sessions || []).filter(s => !s.closed_at);
  const days = d.week || [], max = Math.max(1, ...days.map(x => x.done));
  return head(today(), "DASHBOARD", `<button class="btn sm" data-act="page" data-v="sessions">QR 출석 열기</button>`) +
    `<div class="kpis"><div class="kpi"><span>지금 열린 세션</span><b class="num">${d.open_sessions}</b><span>${open.map(s => esc(s.program)).join(" · ") || "없음"}</span></div>
      <div class="kpi"><span>오늘 완료</span><b class="num" style="color:var(--good)">${d.today_done}</b><span>COMPLETED + MANUAL</span></div>
      <div class="kpi"><span>지금 활동 중</span><b class="num" style="color:var(--data)">${d.today_active}</b><span>CHECK-OUT 전</span></div>
      <div class="kpi"><span>가입한 학생</span><b class="num">${d.joined}<small style="font-size:16px;color:var(--muted)"> / ${d.students}</small></b><span>명단 기준</span></div></div>
    <div class="grid2" style="margin-top:14px"><div class="card"><span class="eyebrow">최근 7일 완료 인원</span>
      ${days.length ? `<div style="margin-top:10px">${days.map(x => `<div class="hbar"><span class="num">${fmtDay(x.day)}</span><div class="bar teal"><i style="width:${x.done / max * 100}%"></i></div><span class="num" style="text-align:right">${x.done}</span></div>`).join("")}</div>` : '<p class="muted small">아직 기록이 없어요.</p>'}</div>
      <div class="card stack"><span class="eyebrow">처음 쓰는 순서</span>
        <div class="small">1. <b>학생 · 명단</b>에서 명단을 붙여 넣어요 (학년·반·번호·이름).</div>
        <div class="small">2. 학생들은 학생 앱 주소로 들어가 <b>처음이에요</b>에서 비밀번호를 만들어요.</div>
        <div class="small">3. <b>QR 출석 열기</b> → <b>QR 화면 (TV)</b>를 TV에 띄워요.</div>
        <div class="small muted">학생 앱 주소: <b>${esc(studentUrl())}</b></div></div></div>`;
}

/* ---------- 세션 ---------- */
function aSessions() {
  const progs = (S.cfg?.programs || []).filter(p => p.active);
  const rows = S.sessions;
  return head("TV에 띄울 QR 출석을 열고 닫아요", "QR 출석 열기") +
    `<section class="card" style="margin-bottom:14px"><span class="eyebrow">새 출석 열기</span>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px;align-items:flex-end">
        <div class="field" style="min-width:200px;flex:1"><label for="sprog">프로그램</label><select id="sprog">${progs.map(p => `<option value="${p.id}">${esc(p.name)} · 최소 ${mmss(p.min_seconds)} · +${p.xp} XP</option>`).join("")}</select></div>
        <div class="field" style="min-width:140px"><label for="sgrade">대상</label><select id="sgrade"><option value="">전교생</option><option value="1">1학년</option><option value="2">2학년</option><option value="3">3학년</option></select></div>
        <button class="btn" data-act="sopen" style="width:auto">열고 QR 띄우기</button></div></section>
    <div class="card scroll" style="padding:6px 10px">${!rows ? loading : !rows.length ? '<p class="muted">최근 2주 동안 연 출석이 없어요.</p>' :
      `<table class="tbl"><thead><tr><th>날짜</th><th>열린 시각</th><th>프로그램</th><th>대상</th><th class="r">완료</th><th class="r">활동 중</th><th>상태</th><th class="r"></th></tr></thead><tbody>
      ${rows.map(s => `<tr><td class="num">${fmtDay(s.day)}</td><td class="num">${fmtTime(s.opened_at)}</td><td>${esc(s.program)}</td><td>${tgt(s.target_grade)}</td><td class="r num">${s.done}</td><td class="r num">${s.active}</td>
        <td>${s.closed_at ? '<span class="state st-WAITING">닫힘</span>' : '<span class="state st-ACTIVE">열림</span>'}</td>
        <td class="r" style="white-space:nowrap"><button class="btn sm ghost" data-act="golive" data-v="${s.id}">LIVE</button>
        ${s.closed_at ? (s.day === seoulDate() ? `<button class="btn sm ghost" data-act="sreopen" data-v="${s.id}">다시 열기</button>` : "") : `<button class="btn sm ghost" data-act="goqr" data-v="${s.id}">QR</button> <button class="btn sm" data-act="sclose" data-v="${s.id}">닫기</button>`}</td></tr>`).join("")}
      </tbody></table>`}</div>
    <p class="small muted">닫으면 아직 CHECK-OUT 하지 않은 학생은 FAILED가 돼요. 오늘 연 세션은 다시 열 수 있어요.</p>`;
}
const seoulDate = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/* ---------- LIVE ---------- */
function sessionPicker() {
  const list = (S.sessions || []).filter(s => !s.closed_at || s.id === S.sid);
  if (!list.length) return "";
  return `<div class="field" style="min-width:220px"><label for="lsid">세션</label><select id="lsid">${list.map(s => `<option value="${s.id}" ${s.id === S.sid ? "selected" : ""}>${fmtDay(s.day)} ${fmtTime(s.opened_at)} ${esc(s.program)} · ${tgt(s.target_grade)}${s.closed_at ? " (닫힘)" : ""}</option>`).join("")}</select></div>`;
}
function aLive() {
  if (!S.sid) return head("열린 출석이 있어야 볼 수 있어요", "LIVE 출석") + `<div class="card">지금 열린 출석이 없어요. <button class="btn sm" data-act="page" data-v="sessions" style="width:auto;margin-left:8px">QR 출석 열기</button></div>`;
  const L = S.live;
  if (!L) return head("", "LIVE 출석") + loading;
  const s = L.session, rows = L.rows, c = k => rows.filter(x => x.state === k).length, now = new Date(L.now).getTime();
  const classes = [...new Set(rows.map(r => r.grade + "-" + r.class))];
  return head(`${esc(s.program)} · 최소 ${mmss(s.min_seconds)} · ${tgt(s.target_grade)}`, "LIVE 출석",
      s.closed_at ? `<span class="chip">세션 닫힘</span><button class="btn sm teal" data-act="sreopen" data-v="${s.id}">다시 열기</button>`
        : `<button class="btn sm ghost" data-act="goqr" data-v="${s.id}">QR 화면 띄우기</button><button class="btn sm" data-act="sclose" data-v="${s.id}">세션 닫기</button>`) +
    `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-end">${sessionPicker()}
      <div class="field" style="min-width:140px"><label for="lcls">반</label><select id="lcls"><option value="">전체</option>${(S.liveClasses || classes).map(k => `<option value="${k}" ${k === S.liveClass ? "selected" : ""}>${k === "0-0" ? "선생님" : k.replace("-", "학년 ") + "반"}</option>`).join("")}</select></div></div>
    <div class="livehead">${["WAITING", "ACTIVE", "COMPLETED", "FAILED", "MANUAL"].map(k => `<div class="count"><span class="state st-${k}">${k}</span><b class="num">${c(k)}</b></div>`).join("")}</div>
    <div class="card scroll" style="padding:6px 10px"><table class="tbl"><thead><tr><th>학급</th><th>번호</th><th>이름</th><th>상태</th><th class="r">CHECK-IN</th><th class="r">경과</th><th class="r">처리</th></tr></thead><tbody>
    ${rows.map(r => { const el = r.state === "ACTIVE" && r.in_at ? (now - new Date(r.in_at).getTime()) / 1000 : null;
      return `<tr><td class="num">${r.grade ? r.grade + "-" + r.class : "선생님"}</td><td class="num">${r.num}</td><td>${esc(r.name)}</td><td><span class="state st-${r.state}">${r.state}</span></td>
        <td class="r num muted">${r.in_at ? fmtTime(r.in_at) : "–"}</td><td class="r num">${el != null ? (el >= s.min_seconds ? `<span style="color:var(--good)">${clock(el)}</span>` : clock(el)) : "–"}</td>
        <td class="r">${r.state === "COMPLETED" || r.state === "MANUAL" ? "" : `<button class="btn sm ghost" data-act="manual" data-v="${r.id}">직접 인정</button>`}</td></tr>`; }).join("")}
    </tbody></table></div><p class="small muted">5초마다 새로 고쳐요. 휴대폰이 없는 학생은 직접 인정을 누르면 MANUAL로 XP가 들어가요.</p>`;
}

/* ---------- QR (TV) ---------- */
function aQr() {
  if (!S.sid) return head("", "QR 화면") + `<div class="card">열린 출석이 없어요. <button class="btn sm" data-act="page" data-v="sessions" style="width:auto;margin-left:8px">QR 출석 열기</button></div>`;
  const ses = (S.sessions || []).find(x => x.id === S.sid), inMode = S.qrMode === "in", q = S.qr;
  const L = S.live?.rows || [], c = k => L.filter(x => x.state === k).length;
  return `${S.tv ? "" : head(`${esc(ses?.program || "")} · ${tgt(ses?.target_grade)} · TV에 전체화면으로 띄우는 화면`, "QR 화면", `<button class="btn sm" data-act="tv">TV 전체화면</button>`)}
    <div class="qrstage"><div class="qrbig ${S.qrMode}"><div class="mode" style="color:${inMode ? "var(--good)" : "var(--court)"}">${inMode ? "CHECK-IN" : "CHECK-OUT"}</div>
      <div class="qrbox" id="qrbox" aria-label="출석 QR 코드">${q && q.err ? `<div style="color:#0d1430;font-weight:700;text-align:center">${esc(q.err)}</div>` : ""}</div>
      <div class="qrtimer"><div class="row between small"><span class="muted">다음 QR까지</span><b class="num" data-live="qrleft">${q && !q.err ? Math.ceil(q.leftAt ? (q.leftAt - Date.now()) / 1000 : 0) + "초" : "–"}</b></div><div class="bar ${inMode ? "teal" : ""}" style="margin-top:6px"><i data-live="qrbar" style="width:100%;transition:none"></i></div></div>
      <div class="small muted" style="text-align:center">${esc(ses?.program || "")}${S.live ? " · 최소 " + mmss(S.live.session.min_seconds) : ""} · 휴대폰 기본 카메라나 학생 앱 CHECK 탭으로 찍어요</div></div>
    <div class="stack"><div class="toggle"><button data-act="qrmode" data-v="in" class="in ${inMode ? "on" : ""}">CHECK-IN</button><button data-act="qrmode" data-v="out" class="out ${inMode ? "" : "on"}">CHECK-OUT</button></div>
      <div class="livehead" style="margin:0">${["ACTIVE", "COMPLETED", "MANUAL"].map(k => `<div class="count"><span class="state st-${k}">${k}</span><b class="num" data-live="c${k}">${c(k)}</b></div>`).join("")}</div>
      ${S.tv ? `<button class="btn ghost sm" data-act="tvoff">전체화면 끝내기</button>` : `<div class="card stack small" style="gap:8px"><b>대리 출석을 막는 방법</b><span class="muted">QR은 ${S.cfg?.settings?.qr_seconds || 30}초마다 바뀌고, 사진으로 찍어 보내도 곧 만료돼요.</span><span class="muted">한 휴대폰으로는 한 학생만 출석할 수 있고, CHECK-OUT은 CHECK-IN 한 휴대폰으로만 돼요.</span><span class="muted">시간은 학교 서버 시계로 재요.</span></div>`}
    </div></div>`;
}
let qrTimer = 0, qrKey = "";
async function refreshQr() {
  clearTimeout(qrTimer);
  if (S.view !== "admin" || S.page !== "qr" || !S.sid) return;
  try {
    const r = await call("admin_qr", { p_session: S.sid, p_mode: S.qrMode });
    S.qr = { payload: r.payload, seconds: r.seconds, leftAt: Date.now() + r.left * 1000 };
    qrTimer = setTimeout(refreshQr, Math.max(1000, r.left * 1000 + 300));
  } catch (e) { S.qr = { err: aerr(e) }; qrKey = ""; render(); return; }
  drawQr();
}
function drawQr() {
  const box = document.getElementById("qrbox"); if (!box || !S.qr || S.qr.err) return;
  const text = studentUrl() + "#scan=" + S.qr.payload;
  if (qrKey === text && box.childElementCount) return;
  qrKey = text;
  try { const qr = window.qrcode(0, "M"); qr.addData(text); qr.make(); box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true }); const svg = box.querySelector("svg"); if (svg) { svg.style.width = "100%"; svg.style.height = "auto"; } }
  catch { box.textContent = S.qr.payload; }
}

/* ---------- 학급 레이스 ---------- */
function aRace() {
  const g = S.raceGrade, b = S.race[g];
  return `<div class="ahead"><div><span class="eyebrow">${b ? `${g}학년 ${b.rows.length}개 반 · ${racePeriod(b)} · ${esc(b.program || "")}` : ""}</span><h1>${esc(b?.program || "아침 운동")} 학급 레이스</h1></div>
    <div class="row"><div class="gtabs">${[1, 2, 3].map(x => `<button data-act="rgrade" data-v="${x}" class="${x === g ? "on" : ""}">${x}학년</button>`).join("")}</div>${S.tv ? `<button class="btn ghost sm" data-act="tvoff" style="width:auto">끝내기</button>` : `<button class="btn sm" data-act="tv" style="width:auto">TV 전체화면</button>`}</div></div>
    ${b ? raceHTML(b, false, 0) : loading}
    ${S.tv ? "" : `<p class="small muted">참여율 = 기간 안 완료 수 ÷ (반 인원 × 운영한 날 수). 기간·상품·프로그램은 설정에서 바꿔요. 학생 이름은 나오지 않아요.</p>`}`;
}

/* ---------- 학생 · 명단 ---------- */
function aStudents() {
  const cl = S.classes;
  const pick = cl && cl.length ? `<div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px"><div class="field" style="min-width:160px"><label for="scls">학급</label><select id="scls">${cl.map(c => `<option value="${c.grade}-${c.class}" ${S.cls === c.grade + "-" + c.class ? "selected" : ""}>${c.grade}학년 ${c.class}반 · ${c.n}명 (가입 ${c.joined})</option>`).join("")}</select></div></div>` : "";
  const st = S.students;
  const table = !cl ? loading : !cl.length ? '<div class="card muted">아직 명단이 없어요. 아래에 붙여 넣어 주세요.</div>' : !st ? loading :
    `<div class="card scroll" style="padding:6px 10px"><table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>학번</th><th>계정</th><th class="r">레벨 · XP</th><th class="r">출석</th><th class="r">관리</th></tr></thead><tbody>
    ${st.map(s => `<tr style="${s.active ? "" : "opacity:.5"}"><td class="num">${s.num}</td><td>${esc(s.name)}</td><td class="num muted">${s.student_no}</td>
      <td>${s.signed_up_at ? `<span class="state st-COMPLETED">가입</span> <span class="small muted num">${fmtDT(s.signed_up_at)}</span>` : '<span class="state st-WAITING">미가입</span>'}</td>
      <td class="r num">LV ${levelOf(s.xp).lv} · ${s.xp}</td><td class="r num">${s.done}</td>
      <td class="r" style="white-space:nowrap">${s.signed_up_at ? `<button class="btn sm ghost" data-act="spw" data-v="${s.id}" data-n="${esc(s.name)}">비밀번호 초기화</button> ` : ""}<button class="btn sm ghost" data-act="sxp" data-v="${s.id}" data-n="${esc(s.name)}">XP</button> <button class="btn sm ghost" data-act="sact" data-v="${s.id}" data-on="${s.active ? 0 : 1}">${s.active ? "전학·제외" : "되살리기"}</button></td></tr>`).join("")}
    </tbody></table></div>`;
  return head("학년·반·번호·이름 4가지만 받아요", "학생 · 명단") + pick + table +
    `<section class="card stack" style="margin-top:16px"><span class="eyebrow">명단 올리기</span>
      <p class="small muted" style="margin:0">엑셀에서 <b>학년, 반, 번호, 이름</b> 4칸만 골라 복사해 아래에 붙여 넣으세요. 생년월일·성별 같은 다른 정보는 넣지 마세요. 같은 학번이 이미 있으면 이름만 고쳐져요.</p>
      <textarea id="roster" rows="6" style="width:100%;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;color:var(--fg);font:14px/1.5 var(--body)" placeholder="2	3	12	홍길동&#10;2	3	13	김철수">${esc(S.rtext || "")}</textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn sm ghost" style="width:auto">CSV 파일 고르기<input id="rosterfile" type="file" accept=".csv,.txt,text/csv" hidden></label><button class="btn sm" data-act="rcheck" style="width:auto">확인하기</button>${S.rpreview ? `<button class="btn sm teal" data-act="rup" style="width:auto">${S.rpreview.length}명 올리기</button>` : ""}</div>
      ${S.rpreview ? `<div class="small">${S.rbad ? `<span style="color:var(--warn)">읽지 못한 줄 ${S.rbad}개는 빼고 올려요.</span> ` : ""}처음 몇 명: ${S.rpreview.slice(0, 3).map(r => `${r.grade}-${r.class}-${r.num} ${esc(r.name)}`).join(", ")}</div>` : ""}
    </section>`;
}
function parseRoster(text) {
  const out = [], seen = new Set(); let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const parts = line.split(/\t|,|\s+/).map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
    const nums = parts.slice(0, 3).map(x => parseInt(x.replace(/[^0-9]/g, ""), 10));
    const name = parts.slice(3).join("").replace(/\s/g, "");
    if (parts.length < 4 || nums.some(n => !Number.isFinite(n)) || !name) { if (!/학년|이름|grade/i.test(line)) bad++; continue; }
    const [grade, cls, num] = nums;
    if (grade < 1 || grade > 3 || cls < 1 || cls > 20 || num < 1 || num > 60) { bad++; continue; }
    const k = `${grade}-${cls}-${num}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ grade, class: cls, num, name });
  }
  return { rows: out, bad };
}

/* ---------- 함께 운동하는 선생님 ---------- */
function aStaff() {
  const b = S.staff;
  const rows = b ? b.rows : null;
  return head("선생님도 학생 앱에서 교사번호로 출석해요. 참여 순위로 상품을 드려요", "선생님 참여") +
    `<div class="card scroll" style="padding:6px 10px">${!rows ? loading : !rows.length ? '<p class="muted">아직 등록한 선생님이 없어요. 아래에 이름을 붙여 넣어 주세요.</p>' :
      `<div class="small muted" style="padding:10px 4px">${esc(b.program || "")} 기준 · ${racePeriod(b)} · 참여 횟수가 같으면 XP가 많은 순서예요</div>
      <table class="tbl"><thead><tr><th class="r">순위</th><th>교사번호</th><th>이름</th><th>계정</th><th class="r">기간 참여</th><th class="r">전체 참여</th><th class="r">XP</th><th class="r">관리</th></tr></thead><tbody>
      ${rows.map((t, i) => `<tr style="${t.active ? "" : "opacity:.5"}"><td class="r num">${i + 1}</td><td class="num"><b>${t.student_no}</b></td><td>${esc(t.name)}</td>
        <td>${t.signed_up_at ? '<span class="state st-COMPLETED">가입</span>' : '<span class="state st-WAITING">미가입</span>'}</td><td class="r num"><b>${t.done}</b></td><td class="r num">${t.all_done}</td><td class="r num">${t.xp}</td>
        <td class="r" style="white-space:nowrap">${t.signed_up_at ? `<button class="btn sm ghost" data-act="spw" data-v="${t.id}" data-n="${esc(t.name)}" data-staff="1">비밀번호 초기화</button> ` : ""}<button class="btn sm ghost" data-act="sact" data-v="${t.id}" data-on="${t.active ? 0 : 1}" data-staff="1">${t.active ? "제외" : "되살리기"}</button></td></tr>`).join("")}
      </tbody></table>`}</div>
    <section class="card stack" style="margin-top:16px"><span class="eyebrow">선생님 등록</span>
      <p class="small muted" style="margin:0">한 줄에 한 분씩 <b>이름</b>만 붙여 넣으면 교사번호(90001, 90002…)가 차례로 붙어요. 이미 등록된 이름은 건너뛰어요. 선생님께는 <b>학생 앱 주소</b>와 <b>교사번호</b>를 알려 드리고, '처음이에요'에서 교사번호 + 이름으로 비밀번호를 만들게 해 주세요.</p>
      <textarea id="staffin" rows="6" style="width:100%;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;color:var(--fg);font:14px/1.5 var(--body)" placeholder="홍길동&#10;김철수">${esc(S.stext || "")}</textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn sm ghost" style="width:auto">CSV 파일 고르기<input id="stafffile" type="file" accept=".csv,.txt,text/csv" hidden></label><button class="btn sm teal" data-act="staffup" style="width:auto">등록하기</button></div>
    </section>`;
}
function parseStaff(text) {
  const out = [], seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/\t|,/).map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
    if (!parts.length) continue;
    // 한글 이름처럼 보이는 칸을 이름으로 써요 (부서, 담당 같은 칸은 무시)
    const name = parts.map(x => x.replace(/\s/g, "")).find(x => /^[가-힣]{2,5}$/.test(x) && !/^(이름|성명|교사|부서|담당|교과|직위|비고|학년|학급|담임)$/.test(x));
    if (!name || seen.has(name)) continue; seen.add(name); out.push({ name });
  }
  return out;
}

/* ---------- 미션 ---------- */
const localInput = d => { const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return t.toISOString().slice(0, 16); };
function aMission() {
  const ms = S.missions, kinds = Object.entries(MKIND).map(([k, v]) => `<option value="${k}">${v.name} · ${HOWLAB[v.how]}</option>`).join("");
  const end = new Date(); end.setDate(end.getDate() + 7); end.setHours(23, 59, 0, 0);
  const sel = ms && ms.find(m => m.id === S.mview), now = Date.now();
  let detail = "";
  if (sel) {
    const walk = sel.kind === "walk", subs = S.msubs, opts = (S.classes || []).filter(c => (!sel.target_grade || c.grade === sel.target_grade) && (!sel.target_class || c.class === sel.target_class));
    detail = `<div class="card scroll" style="padding:6px 10px;margin-top:14px"><div class="row between" style="padding:10px 4px;flex-wrap:wrap;gap:10px"><b>${mTitle(sel)} · 제출 현황</b>
      <select id="mcls" style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;color:var(--fg)">${opts.map(c => `<option value="${c.grade}-${c.class}" ${S.mcls === c.grade + "-" + c.class ? "selected" : ""}>${c.grade}학년 ${c.class}반</option>`).join("")}</select></div>
      ${walk ? '<p class="small muted" style="margin:0 4px 8px">1분에 150보가 넘으면 휴대폰을 흔든 것일 수 있어서 확인 필요로 표시해요.</p>' : ""}
      ${!subs ? loading : `<table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>상태</th><th class="r">기록</th>${walk ? '<th class="r">걸린 시간</th><th class="r">분당 걸음</th>' : ""}<th>제출 시각</th><th></th></tr></thead><tbody>
      ${subs.map(s => { const done = s.value != null, cad = walk && done && s.secs ? Math.round(s.value / (s.secs / 60)) : 0;
        return `<tr><td class="num">${s.num}</td><td>${esc(s.name)}</td><td>${done ? '<span class="state st-COMPLETED">제출</span>' : '<span class="state st-WAITING">안 함</span>'}</td>
        <td class="r num">${done ? Number(s.value).toLocaleString() + MKIND[sel.kind].unit : "–"}</td>${walk ? `<td class="r num">${done && s.secs ? mmss(s.secs) : "–"}</td><td class="r num" style="${s.flagged ? "color:var(--bad);font-weight:700" : ""}">${cad || "–"}</td>` : ""}
        <td class="num muted">${done ? fmtDT(s.submitted_at) : "–"}</td><td>${s.flagged ? '<span class="state st-FAILED">확인 필요</span>' : ""}</td></tr>`; }).join("")}</tbody></table>`}</div>`;
  }
  return head("미션을 내면 대상 학생의 홈 화면에 오늘의 미션으로 떠요", "미션") +
    `<section class="card" style="margin-bottom:14px"><span class="eyebrow">새 미션 내기</span>
      <div class="mform" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="field"><label for="mk">종류</label><select id="mk">${kinds}</select></div>
        <div class="field"><label for="mg">목표</label><input id="mg" type="number" min="1" value="${MKIND.walk.def}"></div>
        <div class="field"><label for="mtg">대상 학년</label><select id="mtg"><option value="">전교생</option><option value="1">1학년</option><option value="2">2학년</option><option value="3">3학년</option></select></div>
        <div class="field"><label for="mtc">반</label><select id="mtc"><option value="">학년 전체</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join("")}</select></div>
        <div class="field"><label for="mo">시작</label><input id="mo" type="datetime-local" value="${localInput(new Date())}"></div>
        <div class="field"><label for="mc">마감</label><input id="mc" type="datetime-local" value="${localInput(end)}"></div>
        <div class="field"><label for="mx">XP</label><input id="mx" type="number" min="0" max="200" value="20"></div>
        <button class="btn" data-act="madd" style="align-self:end">미션 내기</button></div>
      <p class="small muted" style="margin:10px 0 0">걷기는 학생 휴대폰의 움직임 센서로(앱을 켠 채로 걸어요), 나머지는 카메라 자세 인식으로 세요. 시작~마감 사이에 목표를 채워야 인정되고 XP가 들어가요.</p></section>
    <div class="card scroll" style="padding:6px 10px">${!ms ? loading : !ms.length ? '<p class="muted">아직 낸 미션이 없어요.</p>' :
      `<table class="tbl"><thead><tr><th>미션</th><th>대상</th><th>시작</th><th>마감</th><th>상태</th><th class="r">제출</th><th class="r">XP</th><th></th></tr></thead><tbody>
      ${ms.map(m => { const st = now < new Date(m.opens_at).getTime() ? ["WAITING", "예정"] : now > new Date(m.closes_at).getTime() ? ["FAILED", "마감"] : ["ACTIVE", "진행 중"];
        return `<tr><td><b>${mTitle(m)}</b></td><td>${tgt(m.target_grade, m.target_class)}</td><td class="num">${fmtDT(m.opens_at)}</td><td class="num">${fmtDT(m.closes_at)}</td><td><span class="state st-${st[0]}">${st[1]}</span></td>
        <td class="r num">${m.subs} / ${m.targets}</td><td class="r num">+${m.xp}</td><td class="r" style="white-space:nowrap"><button class="btn sm ghost" data-act="mview" data-v="${m.id}">${S.mview === m.id ? "닫기" : "제출 보기"}</button> <button class="btn sm ghost" data-act="mdel" data-v="${m.id}">삭제</button></td></tr>`; }).join("")}
      </tbody></table>`}</div>${detail}`;
}

/* ---------- 프로그램 ---------- */
function aPrograms() {
  const ps = S.cfg?.programs;
  const row = p => `<tr data-pid="${p ? p.id : ""}"><td><input class="pin" data-f="name" value="${esc(p ? p.name : "")}" placeholder="새 프로그램 이름" aria-label="이름"></td>
    <td class="r"><input class="pin num" data-f="min" type="number" min="0" step="0.5" value="${p ? +(p.min_seconds / 60).toFixed(2) : 10}" aria-label="최소 분" style="width:80px"> 분</td>
    <td class="r"><input class="pin num" data-f="xp" type="number" min="0" max="200" value="${p ? p.xp : 20}" aria-label="XP" style="width:70px"></td>
    <td><label class="small"><input type="checkbox" data-f="geo" ${p && p.geo ? "checked" : ""}> 위치 인증</label></td>
    <td>${p ? `<label class="small"><input type="checkbox" data-f="active" ${p.active ? "checked" : ""}> 사용</label>` : ""}</td>
    <td class="r"><button class="btn sm ${p ? "ghost" : ""}" data-act="psave" style="width:auto">${p ? "저장" : "추가"}</button></td></tr>`;
  return head("CHECK-IN 뒤 최소 시간이 지나야 CHECK-OUT 할 수 있어요", "운동 프로그램") +
    `<div class="card scroll" style="padding:6px 10px">${!ps ? loading : `<table class="tbl ptbl"><thead><tr><th>프로그램</th><th class="r">최소 시간</th><th class="r">XP</th><th>위치</th><th>사용</th><th></th></tr></thead><tbody>${ps.map(row).join("")}${row(null)}</tbody></table>`}</div>
    <p class="small muted">위치 인증을 켜면 설정에서 정한 기준점 반경 안에서만 출석돼요. 기준점이 비어 있으면 위치는 확인하지 않아요. 최소 시간은 10초(0.17분)부터 돼요.</p>`;
}

/* ---------- 설정 ---------- */
function aSettings() {
  const c = S.cfg; if (!c) return head("", "설정") + loading;
  const st = c.settings, own = isOwner(), dis = own ? "" : "disabled", pz = st.prizes || [];
  const fld = (id, label, val, type = "text", extra = "") => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val ?? "")}" ${dis} ${extra}></div>`;
  return head(own ? "관리교사만 바꿀 수 있어요" : "관리교사만 바꿀 수 있어요. 지금은 보기만 돼요", "설정") +
    `<div class="grid2"><section class="card stack"><span class="eyebrow">QR 출석</span>
      ${fld("cqr", "QR이 바뀌는 주기 (초, 10~120)", st.qr_seconds, "number", 'min="10" max="120"')}
      <div class="field"><label>위치 인증 기준점</label><div class="small">${st.geo_lat != null ? `<b class="num">${(+st.geo_lat).toFixed(5)}, ${(+st.geo_lng).toFixed(5)}</b> <a href="https://maps.google.com/?q=${st.geo_lat},${st.geo_lng}" target="_blank" rel="noopener" class="back">지도 ›</a>` : '<span class="muted">비어 있음 (위치를 확인하지 않아요)</span>'}</div>
        ${own ? `<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm ghost" data-act="geohere" style="width:auto">지금 내 위치를 기준점으로</button>${st.geo_lat != null ? '<button class="btn sm ghost" data-act="geoclear" style="width:auto">기준점 지우기</button>' : ""}</div><span class="small muted">운동장 한가운데에서 이 버튼을 누르세요.</span>` : ""}</div>
      ${fld("crad", "허용 반경 (m)", st.geo_radius_m, "number", 'min="20" max="2000"')}
    </section>
    <section class="card stack"><span class="eyebrow">학급 레이스</span>
      <div class="field"><label for="crp">세는 프로그램</label><select id="crp" ${dis}>${c.programs.map(p => `<option value="${p.id}" ${p.id === st.race_program_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="row" style="gap:10px">${fld("crf", "시작일", st.race_from, "date")}${fld("crt", "마지막 날", st.race_to, "date")}</div>
      <div class="row" style="gap:10px">${fld("cp1", "1등 상품", pz[0])}${fld("cp2", "2등 상품", pz[1])}${fld("cp3", "3등 상품", pz[2])}</div>
      <span class="small muted">날짜를 비워 두면 처음부터 / 지금까지 모두 세요.</span></section></div>
    ${own ? `<button class="btn" data-act="csave" style="margin-top:14px;max-width:320px">설정 저장</button>` : ""}
    ${own ? `<section class="card" style="margin-top:18px"><span class="eyebrow">선생님 계정</span><div class="scroll"><table class="tbl" style="margin-top:8px"><thead><tr><th>이름</th><th>이메일</th><th>권한</th><th>가입</th><th class="r"></th></tr></thead><tbody>
      ${c.teachers.map(t => `<tr><td>${esc(t.name || "–")}</td><td>${esc(t.email || "")}</td><td>${t.role === "owner" ? '<span class="state st-COMPLETED">관리교사</span>' : t.role === "teacher" ? '<span class="state st-ACTIVE">선생님</span>' : '<span class="state st-WAITING">승인 대기</span>'}</td><td class="num muted">${fmtDT(t.created_at)}</td>
        <td class="r" style="white-space:nowrap">${t.id === S.me.id ? '<span class="small muted">나</span>' : `${t.role === "pending" ? `<button class="btn sm" data-act="trole" data-v="${t.id}" data-r="teacher" style="width:auto">승인</button> ` : ""}${t.role === "teacher" ? `<button class="btn sm ghost" data-act="trole" data-v="${t.id}" data-r="owner" style="width:auto">관리교사로</button> ` : ""}<button class="btn sm ghost" data-act="trole" data-v="${t.id}" data-r="remove" style="width:auto">${t.role === "pending" ? "거절" : "삭제"}</button>`}</td></tr>`).join("")}
      </tbody></table></div><p class="small muted">다른 선생님은 이 화면 주소에서 가입 신청을 하면 여기에 승인 대기로 떠요.</p></section>` : ""}
    <section class="card stack" style="margin-top:18px"><span class="eyebrow">주소</span><div class="small">학생 앱: <b>${esc(studentUrl())}</b></div><div class="small">선생님 화면: <b>${esc(location.href.split("#")[0])}</b></div></section>`;
}

/* ---------- 불러오기 ---------- */
async function load(page = S.page) {
  try {
    if (page === "dash") { [S.dash, S.sessions] = await Promise.all([call("admin_dashboard"), call("admin_sessions", { p_days: 14 })]); }
    if (page === "sessions") { S.sessions = await call("admin_sessions", { p_days: 14 }); }
    if (page === "live" || page === "qr") {
      if (!S.sessions) S.sessions = await call("admin_sessions", { p_days: 14 });
      if (!S.sid || !S.sessions.find(s => s.id === S.sid)) S.sid = (S.sessions.find(s => !s.closed_at) || {}).id || null;
      if (S.sid) await loadLive();
    }
    if (page === "race") S.race[S.raceGrade] = await call("race_board", { p_grade: S.raceGrade });
    if (page === "students") {
      S.classes = await call("admin_classes");
      if (S.classes.length) { if (!S.cls || !S.classes.find(c => c.grade + "-" + c.class === S.cls)) S.cls = S.classes[0].grade + "-" + S.classes[0].class; await loadStudents(); }
    }
    if (page === "staff") S.staff = await call("admin_staff_board");
    if (page === "mission") { [S.missions, S.classes] = await Promise.all([call("admin_missions"), call("admin_classes")]); if (S.mview) await loadSubs(); }
    if (page === "programs" || page === "settings" || page === "sessions") S.cfg = await call("admin_settings");
  } catch (e) { toast(aerr(e)); }
  // 선생님이 입력하는 중이면 화면을 다시 그리지 않아요 (쓰던 내용이 지워지지 않게)
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.closest(".main");
  if (S.page === page && !typing) render();
  if (page === "qr") refreshQr();
}
async function loadLive() {
  const [g, c] = S.liveClass ? S.liveClass.split("-").map(Number) : [null, null];
  const L = await call("admin_live", { p_session: S.sid, p_class: c });
  if (g) L.rows = L.rows.filter(r => r.grade === g);
  if (!S.liveClass) S.liveClasses = [...new Set(L.rows.map(r => r.grade + "-" + r.class))];
  S.live = L;
}
async function loadStudents() { const [g, c] = S.cls.split("-").map(Number); S.students = null; render(); S.students = await call("admin_students", { p_grade: g, p_class: c }); }
async function loadSubs() {
  const m = S.missions.find(x => x.id === S.mview); if (!m) return;
  const opts = (S.classes || []).filter(c => (!m.target_grade || c.grade === m.target_grade) && (!m.target_class || c.class === m.target_class));
  if (!S.mcls || !opts.find(c => c.grade + "-" + c.class === S.mcls)) S.mcls = opts[0] ? opts[0].grade + "-" + opts[0].class : null;
  if (!S.mcls) { S.msubs = []; return; }
  const [g, c] = S.mcls.split("-").map(Number);
  S.msubs = await call("admin_mission_subs", { p_mission: m.id, p_grade: g, p_class: c });
}

/* ---------- 그리기 ---------- */
function render() {
  let html;
  if (S.view === "loading") html = `<div class="phone"><div class="card muted" style="margin-top:40px">불러오는 중이에요…</div></div>`;
  else if (S.view === "auth") html = vAuth();
  else if (S.view === "pending") html = vPending();
  else html = vAdmin();
  $app.innerHTML = html;
  if (S.view === "admin" && S.page === "qr") { qrKey = ""; drawQr(); }
}
function go(page) { S.page = page; S.tv = false; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); render(); window.scrollTo(0, 0); load(page); }

async function enter() {
  if (!sb) { S.view = "auth"; return render(); }
  const { data } = await sb.auth.getSession();
  if (!data.session) { S.view = "auth"; return render(); }
  let role = null;
  try { role = await call("my_role"); } catch (e) { toast(aerr(e)); }
  if (role !== "owner" && role !== "teacher") { S.view = "pending"; return render(); }
  try { S.cfg = await call("admin_settings"); S.me = S.cfg.me; } catch (e) { toast(aerr(e)); }
  S.view = "admin"; render(); load(S.page);
}

/* 1초마다: QR 남은 시간, LIVE 경과 */
setInterval(() => {
  if (S.view !== "admin") return;
  if (S.page === "qr" && S.qr && S.qr.leftAt) {
    const left = Math.max(0, (S.qr.leftAt - Date.now()) / 1000), L = document.querySelector('[data-live="qrleft"]'), B = document.querySelector('[data-live="qrbar"]');
    if (L) L.textContent = Math.ceil(left) + "초"; if (B) B.style.width = (left / S.qr.seconds * 100) + "%";
  }
}, 250);
setInterval(async () => {
  if (S.view !== "admin" || document.hidden || !S.sid || (S.page !== "live" && S.page !== "qr")) return;
  try {
    await loadLive();
    if (S.page === "live") { const y = window.scrollY; render(); window.scrollTo(0, y); }
    else for (const k of ["ACTIVE", "COMPLETED", "MANUAL"]) { const el = document.querySelector(`[data-live="c${k}"]`); if (el) el.textContent = S.live.rows.filter(x => x.state === k).length; }
  } catch {}
}, 5000);
// 레이스 TV 화면은 1분마다 새로 고쳐요
setInterval(() => { if (S.view === "admin" && S.page === "race" && !document.hidden) load("race"); }, 60000);
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && S.tv) { S.tv = false; render(); } });

/* ---------- 이벤트 ---------- */
document.addEventListener("submit", async e => {
  if (e.target.id !== "authForm") return;
  e.preventDefault(); if (!sb) return;
  const email = document.getElementById("temail").value.trim(), pw = document.getElementById("tpw").value;
  S.busy = true; S.msg = null; render();
  try {
    if (S.authTab === "signup") {
      const name = document.getElementById("tname").value.trim();
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { name }, emailRedirectTo: location.href.split("#")[0] } });
      if (error) throw error;
      S.busy = false;
      if (!data.session) { S.authTab = "login"; S.msg = { k: "ok", t: "가입 신청했어요. 메일함의 확인 링크를 누른 뒤 로그인해 주세요." }; return render(); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
    }
    S.busy = false; enter();
  } catch (err) { S.busy = false; S.msg = { k: "bad", t: aerr(err) }; render(); }
});
document.addEventListener("change", async e => {
  const id = e.target.id;
  if (id === "lsid") { S.sid = e.target.value; S.live = null; S.liveClass = ""; S.liveClasses = null; render(); try { await loadLive(); } catch (er) { toast(aerr(er)); } render(); }
  if (id === "lcls") { S.liveClass = e.target.value; try { await loadLive(); } catch (er) { toast(aerr(er)); } render(); }
  if (id === "scls") { S.cls = e.target.value; try { await loadStudents(); } catch (er) { toast(aerr(er)); } render(); }
  if (id === "mcls") { S.mcls = e.target.value; S.msubs = null; render(); try { await loadSubs(); } catch (er) { toast(aerr(er)); } render(); }
  if (id === "mk") { const g = document.getElementById("mg"); if (g) g.value = MKIND[e.target.value].def; }
  if (id === "stafffile" && e.target.files[0]) {
    const buf = await e.target.files[0].arrayBuffer();
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("\ufffd")) { try { t = new TextDecoder("euc-kr").decode(buf); } catch {} }
    S.stext = t; render();
  }
  if (id === "rosterfile" && e.target.files[0]) {
    const buf = await e.target.files[0].arrayBuffer();
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) { try { t = new TextDecoder("euc-kr").decode(buf); } catch {} }
    document.getElementById("roster").value = t; rcheck();
  }
});
function rcheck() {
  const r = parseRoster(document.getElementById("roster").value);
  S.rpreview = r.rows.length ? r.rows : null; S.rbad = r.bad; S.rtext = document.getElementById("roster").value;
  if (!r.rows.length) toast("읽을 수 있는 줄이 없어요. 학년, 반, 번호, 이름 순서인지 확인해 주세요.");
  render();
}
document.addEventListener("input", e => { if (e.target.id === "roster") S.rtext = e.target.value; if (e.target.id === "staffin") S.stext = e.target.value; });
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  const busy = async (fn, ok) => { b.disabled = true; try { await fn(); if (ok) toast(ok); } catch (er) { toast(aerr(er)); } b.disabled = false; };
  switch (act) {
    case "authtab": S.authTab = v; S.msg = null; render(); break;
    case "logout": await sb.auth.signOut(); S.view = "auth"; S.me = null; render(); break;
    case "recheck": enter(); break;
    case "page": go(v); break;
    case "openapp": window.open(studentUrl(), "_blank"); break;
    case "sopen": await busy(async () => {
      const p = +document.getElementById("sprog").value, g = document.getElementById("sgrade").value;
      S.sid = await call("admin_open_session", { p_program: p, p_grade: g ? +g : null }); S.sessions = null; S.qrMode = "in"; go("qr");
    }, "출석을 열었어요. 이 화면을 TV에 띄워 주세요."); break;
    case "sclose": if (!confirm("이 출석을 닫을까요? 아직 CHECK-OUT 안 한 학생은 FAILED가 돼요.")) break;
      await busy(async () => { const n = await call("admin_close_session", { p_session: v }); toast(`닫았어요${n ? ` (FAILED ${n}명)` : ""}`); S.sessions = await call("admin_sessions", { p_days: 14 }); if (S.page === "live") await loadLive(); render(); }); break;
    case "sreopen": await busy(async () => { await call("admin_reopen_session", { p_session: v }); S.sessions = await call("admin_sessions", { p_days: 14 }); if (S.page === "live") await loadLive(); render(); }, "다시 열었어요"); break;
    case "golive": S.sid = v; S.live = null; S.liveClass = ""; S.liveClasses = null; go("live"); break;
    case "goqr": S.sid = v; go("qr"); break;
    case "manual": await busy(async () => { await call("admin_manual", { p_session: S.sid, p_student: v }); await loadLive(); render(); }, "직접 인정했어요"); break;
    case "qrmode": S.qrMode = v; S.qr = null; render(); refreshQr(); break;
    case "tv": S.tv = true; document.documentElement.requestFullscreen?.().catch(() => {}); render(); break;
    case "tvoff": S.tv = false; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); render(); break;
    case "rgrade": S.raceGrade = +v; render(); load("race"); break;
    case "spw": if (!confirm(`${b.dataset.n} 학생의 비밀번호를 초기화할까요? 학생이 '처음이에요'에서 새로 만들어요.`)) break;
      await busy(async () => { await call("admin_reset_password", { p_student: v }); if (b.dataset.staff) S.staff = await call("admin_staff_board"); else await loadStudents(); render(); }, "초기화했어요"); break;
    case "sxp": {
      const amt = prompt(`${b.dataset.n} 학생 XP를 몇 점 더할까요? 뺄 때는 -10처럼 써요.`); if (!amt) break;
      const reason = prompt("이유를 적어 주세요 (학생 기록에 남아요)"); if (!reason) break;
      await busy(async () => { await call("admin_adjust_xp", { p_student: v, p_amount: parseInt(amt, 10) || 0, p_reason: reason }); await loadStudents(); render(); }, "XP를 조정했어요"); break;
    }
    case "sact": await busy(async () => { await call("admin_set_active", { p_student: v, p_active: b.dataset.on === "1" }); if (b.dataset.staff) S.staff = await call("admin_staff_board"); else await loadStudents(); render(); }); break;
    case "staffup": await busy(async () => {
      const rows = parseStaff(S.stext || document.getElementById("staffin").value);
      if (!rows.length) throw new Error("이름을 찾지 못했어요. 한 줄에 한 분씩 이름을 써 주세요.");
      const r = await call("admin_import_staff", { p_rows: rows });
      S.stext = ""; toast(`새로 ${r.added}분 등록${r.same ? `, 이미 있던 ${r.same}분은 그대로` : ""}`); await load("staff");
    }); break;
    case "rcheck": rcheck(); break;
    case "rup": await busy(async () => {
      const rows = S.rpreview; let added = 0, updated = 0;
      for (let i = 0; i < rows.length; i += 300) { const r = await call("admin_import_roster", { p_rows: rows.slice(i, i + 300) }); added += r.added; updated += r.updated; }
      S.rpreview = null; S.rtext = ""; toast(`새로 ${added}명, 고침 ${updated}명`); await load("students");
    }); break;
    case "madd": await busy(async () => {
      const kind = document.getElementById("mk").value, goal = Math.round(+document.getElementById("mg").value), xp = Math.round(+document.getElementById("mx").value);
      const g = document.getElementById("mtg").value, c = document.getElementById("mtc").value, o = document.getElementById("mo").value, cl = document.getElementById("mc").value;
      if (!(goal > 0)) throw new Error("목표를 1 이상으로 써 주세요.");
      if (c && !g) throw new Error("반을 고르려면 학년도 골라 주세요.");
      if (!cl) throw new Error("마감 시각을 정해 주세요.");
      const id = await call("admin_create_mission", { p_kind: kind, p_goal: goal, p_xp: xp || 0, p_grade: g ? +g : null, p_class: c ? +c : null, p_opens: o ? new Date(o).toISOString() : null, p_closes: new Date(cl).toISOString() });
      S.mview = id; S.msubs = null; await load("mission");
    }, "미션을 냈어요. 대상 학생 홈 화면에 떠요."); break;
    case "mview": S.mview = S.mview === v ? null : v; S.msubs = null; render(); if (S.mview) { try { await loadSubs(); } catch (er) { toast(aerr(er)); } render(); } break;
    case "mdel": if (!confirm("이 미션을 지울까요? 이미 받은 XP도 되돌려져요.")) break;
      await busy(async () => { await call("admin_delete_mission", { p_mission: v }); if (S.mview === v) S.mview = null; await load("mission"); }, "지웠어요"); break;
    case "psave": {
      const tr = b.closest("tr"), f = k => tr.querySelector(`[data-f="${k}"]`);
      const p = { name: f("name").value.trim(), min_seconds: Math.round(+f("min").value * 60), xp: Math.round(+f("xp").value), geo: f("geo").checked };
      if (tr.dataset.pid) { p.id = +tr.dataset.pid; p.active = f("active").checked; }
      if (!p.name) { toast("이름을 써 주세요."); break; }
      if (p.min_seconds < 10 || p.min_seconds > 7200) { toast("최소 시간은 10초에서 120분 사이로 써 주세요."); break; }
      await busy(async () => { await call("admin_save_program", { p }); S.cfg = await call("admin_settings"); render(); }, "저장했어요"); break;
    }
    case "geohere":
      if (!navigator.geolocation) { toast("이 기기는 위치를 쓸 수 없어요."); break; }
      toast("위치를 찾는 중이에요…");
      navigator.geolocation.getCurrentPosition(async pos => {
        try { await call("admin_save_settings", { p: { geo_lat: pos.coords.latitude, geo_lng: pos.coords.longitude } }); S.cfg = await call("admin_settings"); render(); toast(`기준점을 저장했어요 (오차 약 ${Math.round(pos.coords.accuracy)}m)`); }
        catch (er) { toast(aerr(er)); }
      }, () => toast("위치 권한을 허용해 주세요."), { enableHighAccuracy: true, timeout: 15000 });
      break;
    case "geoclear": if (!confirm("기준점을 지우면 위치 인증을 하지 않아요. 지울까요?")) break;
      await busy(async () => { await call("admin_save_settings", { p: { geo_lat: null, geo_lng: null } }); S.cfg = await call("admin_settings"); render(); }, "지웠어요"); break;
    case "csave": await busy(async () => {
      const val = id => document.getElementById(id).value.trim();
      const qr = +val("cqr"), rad = +val("crad");
      if (!(qr >= 10 && qr <= 120)) throw new Error("QR 주기는 10~120초로 써 주세요.");
      await call("admin_save_settings", { p: { qr_seconds: qr, geo_radius_m: rad > 0 ? Math.round(rad) : 80, race_program_id: +val("crp"), race_from: val("crf"), race_to: val("crt"), prizes: [val("cp1"), val("cp2"), val("cp3")] } });
      S.cfg = await call("admin_settings"); S.race = {}; render();
    }, "설정을 저장했어요"); break;
    case "trole": {
      const r = b.dataset.r, msg = r === "remove" ? "이 선생님 계정을 지울까요?" : r === "owner" ? "이 선생님도 관리교사로 만들까요?" : null;
      if (msg && !confirm(msg)) break;
      await busy(async () => { await call("admin_set_teacher", { p_id: v, p_role: r }); S.cfg = await call("admin_settings"); render(); }, r === "teacher" ? "승인했어요" : "바꿨어요"); break;
    }
  }
});

if (sb) sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { S.view = "auth"; render(); } });
enter();

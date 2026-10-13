// 학생 앱. 모든 기록은 서버 함수(student_*)로만 주고받아요.
import { rpc, configured, esc, mmss, clock, levelOf, tierOf, fmtDay, fmtTime, fmtDT, toast, deviceId, store, errText,
  IC, raceHTML, chaseOf, racePeriod, PAPS, papsRange, MKIND, HOWLAB, mTitle, BELL } from "./common.js";
import { createPoseRunner, createWalker, say } from "./motion.js";

const $app = document.getElementById("app");
const PHOTO = "img/splash.jpg";
const S = {
  token: store.get("ns_token"), view: "splash", loginTab: "", tab: "home", sub: null,
  home: null, offset: 0, rank: null, rankMode: "class", raceGrade: null, races: {}, hist: null,
  msg: null, done: null, scanning: false, pick: null, mid: null, mcur: 0, papsG: null, papsS: "M", busy: false
};
const serverNow = () => Date.now() + S.offset;
const openMissions = () => (S.home?.missions || []).filter(m => !m.done && new Date(m.closes_at) > serverNow());
let pendingScan = null;

/* ---------- 서버 ---------- */
async function call(fn, args = {}) {
  try { return await rpc(fn, { p_token: S.token, ...args }); }
  catch (e) {
    if (e.code === "session_expired") { logout(true); throw e; }
    throw e;
  }
}
async function loadHome() {
  const h = await call("student_home");
  S.home = h; S.offset = new Date(h.now).getTime() - Date.now();
  if (S.raceGrade == null) S.raceGrade = h.me.grade || 1;
  return h;
}
async function loadRace(g) { S.races[g] = await call("student_race", { p_grade: g }); return S.races[g]; }
function logout(expired) {
  if (S.token && !expired) rpc("student_logout", { p_token: S.token }).catch(() => {});
  S.token = null; store.set("ns_token", null); S.home = null; S.view = "login"; S.tab = "home"; S.sub = null;
  stopAll(); render();
  if (expired) toast(errText("session_expired"));
}

/* ---------- 화면 조각 ---------- */
function topline() {
  const m = S.home?.me;
  return `<div class="topline"><div class="brand">NONGSO <em>SPORTS</em></div><div class="who">${m ? (m.grade ? `${m.grade}학년 ${m.class}반 ${m.num}번 ${esc(m.name)}` : `${esc(m.name)} 선생님`) : ""}</div></div>`;
}
function vSplash() {
  return `<div class="splash" id="splash" role="button" tabindex="0" aria-label="시작하기" style="background-image:url(${PHOTO})">
    <div class="sp-tag">농소중학교 체육</div><div class="sp-name">NONGSO<br>SPORTS SCHOOL</div><div class="sp-ko">농소스포츠스쿨</div>
    <div class="sp-loop"><b>MOVE</b>›<b>CHECK</b>›<b>RECORD</b>›<b>GROW</b></div><div class="sp-bar"><i></i></div></div>`;
}
function vLogin() {
  const first = S.loginTab === "first";
  return `<div class="login">
    <div class="loginphoto" style="background-image:url(${PHOTO})"><div>NONGSO<br>SPORTS SCHOOL</div></div>
    <div class="seg"><button data-act="login-tab" data-v="" class="${first ? "" : "on"}">로그인</button><button data-act="login-tab" data-v="first" class="${first ? "on" : ""}">처음이에요</button></div>
    ${!configured() ? `<div class="msg bad">아직 서버 연결 설정이 안 됐어요. 체육 선생님께 알려 주세요.</div>` : ""}
    ${S.msg ? `<div class="msg ${S.msg.k}" role="alert">${esc(S.msg.t)}</div>` : ""}
    <form id="loginForm" class="stack" autocomplete="on">
      <div class="field"><label for="sid">학번 5자리 (예: 2학년 3반 12번 → 20312 · 선생님은 9로 시작하는 교사번호)</label><input id="sid" name="username" inputmode="numeric" maxlength="5" pattern="[1-39][0-9]{4}" required autocomplete="username"></div>
      ${first ? `<div class="field"><label for="sname">이름</label><input id="sname" required autocomplete="name"></div>
      <div class="field"><label for="spw1">처음 비밀번호 만들기 (8자 이상)</label><input id="spw1" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label for="spw2">비밀번호 한 번 더</label><input id="spw2" type="password" minlength="8" required autocomplete="new-password"></div>`
      : `<div class="field"><label for="spw">비밀번호</label><input id="spw" type="password" required autocomplete="current-password"></div>`}
      <button class="btn" type="submit" ${S.busy ? "disabled" : ""}>${first ? "계정 만들고 시작하기" : "로그인"}</button>
      <p class="small muted" style="margin:0">${first ? "이름과 학번이 학교 명단과 맞아야 만들 수 있어요. '이미 가입된 학번'이라고 나오면 체육 선생님께 말해요." : "비밀번호를 잊었으면 체육 선생님께 초기화를 부탁해요."}</p>
    </form></div>`;
}
function hero() {
  const h = S.home, L = levelOf(h.me.xp);
  return `<section class="hero stack">
    <div class="row between" style="position:relative;z-index:1"><span class="eyebrow">MY LEVEL</span><span class="tier">${tierOf(h.me.xp)}</span></div>
    <div class="lv"><div class="lv-num num"><small>LV</small>${L.lv}</div><div style="flex:1;padding-bottom:4px"><div class="row between small"><span class="muted">다음 레벨까지</span><span class="num">${L.need - L.into} XP</span></div><div class="bar" style="margin-top:6px"><i style="width:${L.into / L.need * 100}%"></i></div></div></div>
    <div class="stat3"><div><b class="num">${h.me.xp.toLocaleString()}</b><span>누적 XP</span></div><div><b class="num">${h.week_count}</b><span>이번 주 참여</span></div><div><b class="num">${h.total_count}</b><span>전체 참여</span></div></div>
  </section>`;
}
function activeOf() { return (S.home?.open || []).find(o => o.mine && o.mine.state === "ACTIVE"); }
function leftOf(o) { return o.min_seconds - (serverNow() - new Date(o.mine.in_at).getTime()) / 1000; }
function vHome() {
  const h = S.home, act = activeOf(), g = h.me.grade, b = S.races[g];
  const race = b ? (() => {
    const me = chaseOf(b, h.me.class), order = [...b.rows].sort((x, y) => y.rate - x.rate || x.class - y.class), rk = order.findIndex(x => x.class === h.me.class) + 1, row = order[rk - 1];
    if (!row) return "";
    const pr = rk >= 1 && rk <= 3 ? (b.prizes || [])[rk - 1] : "";
    return `<button class="card" data-act="tab" data-v="rank" style="text-align:left;width:100%"><div class="row between"><span class="eyebrow">${esc(b.program || "아침 운동")} 학급 레이스</span><span class="back">보기 ›</span></div>
      <div class="row" style="margin-top:8px;align-items:flex-end"><div class="num" style="font:800 46px/1 var(--display);color:var(--court)">${rk}<span style="font-size:18px">위</span></div><div class="small muted" style="padding-bottom:6px">${g}학년 ${b.rows.length}개 반 중 · 참여율 ${Math.round(row.rate * 100)}%${pr ? ` · 지금 상품 <b style="color:var(--fg)">${esc(pr)}</b>` : ""}<br>${me ? `참여 ${me.need}번만 더 모이면 ${me.up.rank}위로 올라가요` : "1등을 지키고 있어요"}</div></div></button>`;
  })() : "";
  const om = openMissions();
  return `<div class="stack">${topline()}
    ${act ? `<button class="sess" data-act="tab" data-v="check" style="border-color:var(--data)"><div class="tm num" data-live="homeLeft">${leftOf(act) > 0 ? clock(leftOf(act)) : "OK"}<small>${leftOf(act) > 0 ? "남음" : "완료 가능"}</small></div>
      <div class="meta"><span class="state st-ACTIVE">ACTIVE</span><b style="margin-top:6px">${esc(act.program)} 활동 중</b><span class="small muted">${leftOf(act) > 0 ? "시간이 다 되면 CHECK-OUT QR을 찍어요" : "이제 CHECK-OUT QR을 찍어요"}</span></div></button>` : ""}
    ${hero()}
    <section class="stack"><div class="row between"><h3 style="font-size:17px">오늘 열린 운동</h3>${h.open.length ? '<span class="open">● LIVE</span>' : ""}</div>
      ${h.open.length ? h.open.map(o => `<button class="sess" data-act="pick" data-v="${o.id}"><div class="tm num">${o.min_seconds >= 60 ? Math.round(o.min_seconds / 60) : o.min_seconds}<small>${o.min_seconds >= 60 ? "분" : "초"}</small></div>
        <div class="meta"><b>${esc(o.program)}</b><span class="small muted">최소 ${mmss(o.min_seconds)} · +${o.xp} XP${o.geo ? " · 위치 인증" : ""}</span></div>
        ${o.mine ? `<span class="state st-${o.mine.state}">${o.mine.state}</span>` : '<span class="chip">CHECK ›</span>'}</button>`).join("")
        : '<div class="card small muted">지금 열린 출석이 없어요. 선생님이 TV에 QR을 띄우면 여기에 떠요.</div>'}</section>
    ${om.length ? `<section class="stack"><div class="row between"><h3 class="row" style="font-size:17px;gap:10px">오늘의 미션 ${BELL(om.length)}</h3><button class="back" data-act="sub" data-v="mission">전체 보기 ›</button></div>
      ${om.slice(0, 2).map(m => `<button class="sess" data-act="mstart" data-v="${m.id}"><div class="tm num">${m.goal >= 1000 ? (m.goal / 1000) + "k" : m.goal}<small>${MKIND[m.kind].unit}</small></div>
        <div class="meta"><b>${mTitle(m)}</b><span class="small muted">${HOWLAB[MKIND[m.kind].how]} · ${fmtDT(m.closes_at)}까지 · +${m.xp} XP</span></div><span class="chip">시작 ›</span></button>`).join("")}</section>` : ""}
    ${race}
  </div>`;
}

/* ---------- CHECK ---------- */
function vCheck() {
  const h = S.home, open = h.open;
  if (!open.length) return `<div class="stack">${topline()}<div class="pagehead"><span class="eyebrow">CHECK</span><h2>QR 출석</h2></div><div class="card muted">지금 열린 출석이 없어요.</div></div>`;
  const o = open.find(x => x.id === S.pick) || activeOf() || open[0];
  S.pick = o.id;
  const st = o.mine ? o.mine.state : "WAITING";
  let body = "";
  if (S.done && S.done.id === o.id) {
    const d = S.done;
    body = `<div class="card xpburst"><span class="state st-COMPLETED">COMPLETED</span><b class="num">+${d.xp}</b><div class="eyebrow" style="color:var(--fg)">XP 획득</div>
      ${d.up ? `<div class="msg ok" style="margin-top:14px">레벨 업! 이제 LV ${d.lv}이에요.</div>` : ""}<p class="small muted">${esc(o.program)} · ${mmss(d.secs)} 활동</p>
      <button class="btn ghost" data-act="tab" data-v="my">SPORTS ID 보기</button></div>`;
  } else if (st === "ACTIVE") {
    const left = leftOf(o), pct = Math.min(1, 1 - left / o.min_seconds), C = 2 * Math.PI * 96;
    body = `<div class="card stack" style="align-items:center;text-align:center"><span class="state st-ACTIVE">ACTIVE · 활동 중</span>
      <div class="ring"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="96" stroke="var(--panel2)" stroke-width="14" fill="none"/><circle data-live="ring" cx="110" cy="110" r="96" stroke="${left > 0 ? "var(--data)" : "var(--good)"}" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
        <div class="in"><b class="num" data-live="left">${left > 0 ? clock(left) : "00:00"}</b><span class="small muted">${left > 0 ? "최소 활동시간 남음" : "CHECK-OUT 할 수 있어요"}</span></div></div>
      <p class="small muted" style="margin:0">시간은 학교 서버 시계로 재요. 앱을 닫아도 계속 흘러가요.</p>
      ${scannerHTML("TV의 CHECK-OUT QR 찍기")}</div>`;
  } else if (st === "WAITING") {
    body = scannerHTML("TV의 CHECK-IN QR 찍기");
  } else {
    body = `<div class="card"><span class="state st-${st}">${st}</span><p class="small muted" style="margin:10px 0 0">${st === "FAILED" ? "CHECK-OUT을 하지 않고 세션이 끝났어요." : "오늘 이 프로그램은 끝났어요."}</p></div>`;
  }
  return `<div class="stack">${topline()}
    <div class="pagehead"><span class="eyebrow">CHECK</span><h2>${esc(o.program)}</h2>
      <div class="row small muted" style="flex-wrap:wrap;gap:8px"><span class="chip">최소 ${mmss(o.min_seconds)}</span><span class="chip">+${o.xp} XP</span>${o.geo ? '<span class="chip">위치 인증</span>' : ""}<span class="state st-${st}">${st}</span></div></div>
    ${open.length > 1 ? `<div class="seg" style="grid-template-columns:repeat(${open.length},1fr)">${open.map(x => `<button data-act="pickstay" data-v="${x.id}" class="${x.id === o.id ? "on" : ""}">${esc(x.program)}</button>`).join("")}</div>` : ""}
    ${S.msg ? `<div class="msg ${S.msg.k}" role="alert">${esc(S.msg.t)}</div>` : ""}
    ${body}</div>`;
}
function scannerHTML(label) {
  return S.scanning
    ? `<div class="scanner live"><video id="qrcam" playsinline muted></video><div class="frame"><i></i><i></i><i></i><i></i></div><div class="laser"></div><div class="cap">TV의 QR을 네모 안에 맞춰 주세요</div></div>
       <button class="btn ghost" data-act="scanstop">그만 찍기</button>`
    : `<button class="btn teal" data-act="scanstart">${label}</button>
       <p class="small muted" style="margin:0">휴대폰 기본 카메라로 QR을 찍어도 이 앱이 열리면서 출석돼요.</p>`;
}

/* QR 카메라 */
let qrStream = null, qrRaf = 0, qrDetector = null;
async function startScan() {
  S.scanning = true; S.msg = null; render();
  const v = document.getElementById("qrcam");
  try { qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); }
  catch { S.scanning = false; S.msg = { k: "bad", t: "카메라를 쓸 수 없어요. 카메라 권한을 허용해 주세요. 휴대폰 기본 카메라로 찍어도 돼요." }; return render(); }
  v.srcObject = qrStream; await v.play().catch(() => {});
  if ("BarcodeDetector" in window) { try { qrDetector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { qrDetector = null; } }
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
  let busy = false;
  const tick = async () => {
    if (!S.scanning) return;
    if (v.readyState >= 2 && !busy) {
      busy = true;
      try {
        let txt = null;
        if (qrDetector) { const r = await qrDetector.detect(v); if (r[0]) txt = r[0].rawValue; }
        else if (window.jsQR) {
          const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
          cv.width = w; cv.height = h; ctx.drawImage(v, 0, 0, w, h);
          const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" }); if (r) txt = r.data;
        }
        if (txt) { const p = extractPayload(txt); stopScan(); if (navigator.vibrate) navigator.vibrate(60); await doScan(p || txt); return; }
      } catch {}
      busy = false;
    }
    qrRaf = requestAnimationFrame(tick);
  };
  tick();
}
function stopScan() { S.scanning = false; cancelAnimationFrame(qrRaf); if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; } }
function extractPayload(t) { const m = String(t).match(/NS1\.[0-9a-f-]{36}\.(in|out)\.[0-9a-f]{16}/); return m ? m[0] : null; }
function getPos() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  });
}
async function doScan(payload) {
  S.msg = { k: "info", t: "확인하는 중이에요…" }; render();
  try {
    const sid = (payload.split(".")[1] || ""), o = (S.home?.open || []).find(x => x.id === sid);
    const pos = !o || o.geo ? await getPos() : null;
    const before = levelOf(S.home.me.xp).lv;
    const r = await call("student_scan", { p_payload: payload, p_device: deviceId(), p_lat: pos ? pos.latitude : null, p_lng: pos ? pos.longitude : null });
    await loadHome();
    if (sid) S.pick = sid;
    S.tab = "check"; S.sub = null;
    if (r.error) {
      S.msg = { k: r.error === "already_in" || r.error === "already_done" ? "info" : "bad", t: errText(r.error, r.error === "too_early" ? `${mmss(r.left)} 남았어요.` : r.error === "too_far" ? `(약 ${r.meters}m)` : "") };
    } else if (r.state === "ACTIVE") {
      S.msg = { k: "ok", t: "CHECK-IN 완료. 지금부터 시간을 잴게요." }; S.done = null;
    } else {
      const lv = levelOf(r.total_xp).lv;
      S.msg = null; S.done = { id: sid, xp: r.xp, secs: r.secs, up: lv > before, lv };
      say("완료");
    }
  } catch (e) { S.msg = { k: "bad", t: errText(e.code) }; }
  render(); window.scrollTo(0, 0);
}

/* ---------- MY ---------- */
function vMy() {
  const h = S.home, L = levelOf(h.me.xp);
  return `<div class="stack">${topline()}
    <div class="pagehead"><span class="eyebrow">MY SPORTS</span><h2>SPORTS ID</h2></div>
    <section class="idcard">
      <div class="row between"><span class="idno">NS-${esc(h.me.no)}</span><span class="tier">${tierOf(h.me.xp)}</span></div>
      <div class="idname">${esc(h.me.name)}</div><div class="small muted">농소중학교 · ${h.me.grade ? `${h.me.grade}학년 ${h.me.class}반 ${h.me.num}번` : `함께 운동하는 선생님 · 교사번호 ${esc(h.me.no)}`}</div>
      <div style="margin-top:14px"><div class="row between small"><span class="num" style="font:800 20px var(--display)">LV ${L.lv}</span><span class="muted num">${L.into} / ${L.need} XP</span></div><div class="bar" style="margin-top:6px"><i style="width:${L.into / L.need * 100}%"></i></div></div>
      <div class="idgrid"><div><b class="num">${h.me.xp.toLocaleString()}</b><span>누적 XP</span></div><div><b class="num">${h.total_count}</b><span>참여 횟수</span></div><div><b class="num">${h.week_count}</b><span>이번 주 참여</span></div><div><b class="num">${(h.missions || []).filter(m => m.done).length}</b><span>완료 미션</span></div></div>
    </section>
    <button class="card" data-act="sub" data-v="history" style="text-align:left;width:100%"><div class="row between"><span class="eyebrow">활동 기록</span><span class="back">보기 ›</span></div><p class="small muted" style="margin:6px 0 0">출석과 XP가 언제 들어왔는지 볼 수 있어요.</p></button>
  </div>`;
}

/* ---------- RANKING ---------- */
function vRank() {
  const cls = S.rankMode === "class", h = S.home, g = S.raceGrade || h.me.grade, b = S.races[g];
  let body = "";
  if (cls) {
    const c = b && g === h.me.grade ? chaseOf(b, h.me.class) : null;
    body = `<div class="gtabs" role="tablist">${[1, 2, 3].map(x => `<button role="tab" aria-selected="${x === g}" data-act="rgrade" data-v="${x}" class="${x === g ? "on" : ""}">${x}학년${x === h.me.grade ? " (우리)" : ""}</button>`).join("")}</div>
      ${!b ? '<div class="card muted">불러오는 중이에요…</div>' : `${g === h.me.grade && b.rows.length ? (c ? `<div class="msg info">우리 반(${g}-${h.me.class})은 참여 <b>${c.need}번</b>만 더 모이면 ${g}-${c.up.cls}반을 따라잡아요.</div>` : `<div class="msg ok">우리 반이 ${g}학년 1등이에요!</div>`) : ""}
      ${raceHTML(b, false, g === h.me.grade ? h.me.class : 0)}
      <p class="small muted" style="margin:0">점수는 참여율이에요. ${esc(b.program || "아침 운동")}에서 CHECK-IN과 CHECK-OUT을 모두 마친 학생만 세요. 기간: ${racePeriod(b)}</p>`}`;
  } else {
    const r = S.rank;
    body = !r ? '<div class="card muted">불러오는 중이에요…</div>' : `<div class="msg info small" style="font-weight:500">${h.me.grade ? `다른 친구 이름은 가운데 글자를 가려요. 나는 ${h.me.grade}학년 ${r.total}명 중` : `함께 운동하는 선생님 ${r.total}명 중`} <b>${r.my_rank}위</b>예요.</div>
      <div class="stack" style="gap:8px">${r.top.map(p => `<div class="rk ${p.me ? "me" : ""}"><div class="pos num p${p.rank}">${p.rank}</div><div><b>${p.me ? esc(h.me.name) + " (나)" : esc(p.name)}</b><div class="mini"><span>${h.me.grade ? `${h.me.grade}학년 ${p.class}반` : "선생님"}</span></div></div><div class="sc num">${p.xp.toLocaleString()}<small>XP</small></div></div>`).join("")}</div>`;
  }
  return `<div class="stack">${topline()}
    <div class="pagehead"><span class="eyebrow">RANKING${cls && b ? ` · ${g}학년 · ${racePeriod(b)}` : ""}</span><h2>${cls ? "학급 레이스" : "개인 랭킹"}</h2></div>
    <div class="seg"><button data-act="rank" data-v="class" class="${cls ? "on" : ""}">학급 레이스</button><button data-act="rank" data-v="person" class="${cls ? "" : "on"}">개인</button></div>
    ${body}</div>`;
}

/* ---------- MORE ---------- */
function subHead(eb, title) { return `${topline()}<button class="back" data-act="sub" data-v="">${IC.back} 더보기</button><div class="pagehead"><span class="eyebrow">${eb}</span><h2>${title}</h2></div>`; }
function vMore() {
  const n = openMissions().length;
  const items = [["mission", "오늘의 미션", n ? `남은 미션 ${n}개` : "선생님이 낸 미션 하기"], ["pops", "POPS 기준표", "중학교 PAPS 등급 기준"], ["history", "활동 기록", "내 출석과 XP 내역"], ["install", "휴대폰에 설치", "홈 화면에 앱 아이콘 만들기"], ["settings", "설정", "비밀번호 바꾸기, 로그아웃"]];
  return `<div class="stack">${topline()}<div class="pagehead"><span class="eyebrow">MORE</span><h2>더보기</h2></div>
    <div class="menu">${items.map(i => `<button data-act="sub" data-v="${i[0]}"><span class="k">${i[1]}${i[0] === "mission" && n ? " " + BELL(n) : ""}</span><span class="d">${i[2]}</span><span class="muted">›</span></button>`).join("")}</div></div>`;
}
function vSub() {
  const k = S.sub;
  if (k === "mission") return vMissions();
  if (k === "mrun") return vMissionRun();
  if (k === "pops") return vPops();
  if (k === "history") {
    const h = S.hist;
    return `<div class="stack">${subHead("HISTORY", "활동 기록")}${!h ? '<div class="card muted">불러오는 중이에요…</div>' : `
      <div class="card scroll"><table class="tbl"><thead><tr><th>날짜</th><th>프로그램</th><th>상태</th><th class="r">XP</th></tr></thead><tbody>
      ${h.attendance.length ? h.attendance.map(a => `<tr><td class="num">${fmtDay(a.day)}</td><td>${esc(a.program)}</td><td><span class="state st-${a.state}">${a.state}</span></td><td class="r num">${a.xp ? "+" + a.xp : "0"}</td></tr>`).join("") : '<tr><td colspan="4" class="muted">아직 출석 기록이 없어요.</td></tr>'}</tbody></table></div>
      <div class="card scroll"><span class="eyebrow">XP 내역</span><table class="tbl" style="margin-top:8px"><tbody>
      ${h.xp.length ? h.xp.map(x => `<tr><td class="num muted">${fmtDT(x.created_at)}</td><td>${esc(x.reason)}</td><td class="r num">${x.amount > 0 ? "+" : ""}${x.amount}</td></tr>`).join("") : '<tr><td class="muted">아직 없어요.</td></tr>'}</tbody></table></div>
      <p class="small muted" style="margin:0">FAILED는 CHECK-OUT을 하지 않고 세션이 끝난 기록이에요. MANUAL은 선생님이 직접 인정한 기록이에요.</p>`}</div>`;
  }
  if (k === "install") {
    return `<div class="stack">${subHead("INSTALL", "휴대폰에 설치")}
      <div class="card stack" style="gap:10px"><b>안드로이드 (크롬)</b><p class="small muted" style="margin:0">오른쪽 위 ⋮ 메뉴 → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요.</p>
      ${window.__installEvt ? '<button class="btn" data-act="install">지금 설치하기</button>' : ""}</div>
      <div class="card stack" style="gap:10px"><b>아이폰 (사파리)</b><p class="small muted" style="margin:0">아래 가운데 공유 버튼(□↑) → <b>홈 화면에 추가</b>를 눌러요. 사파리에서만 돼요.</p></div>
      <p class="small muted" style="margin:0">설치하면 바탕화면에 농소스포츠 아이콘이 생기고, 누르면 앱처럼 전체 화면으로 열려요.</p></div>`;
  }
  if (k === "settings") {
    return `<div class="stack">${subHead("SETTINGS", "설정")}
      <form id="pwForm" class="card stack"><span class="eyebrow">비밀번호 바꾸기</span>
        <div class="field"><label for="opw">지금 비밀번호</label><input id="opw" type="password" required autocomplete="current-password"></div>
        <div class="field"><label for="npw">새 비밀번호 (8자 이상)</label><input id="npw" type="password" minlength="8" required autocomplete="new-password"></div>
        <button class="btn" type="submit">바꾸기</button></form>
      <button class="btn ghost" data-act="logout">로그아웃</button></div>`;
  }
  return vMore();
}
function vPops() {
  const g = S.papsG || S.home.me.grade || 1, sx = S.papsS;
  const keys = ["shuttle", "curl", "reach", "run50", "jump", "grip"];
  const rows = keys.map(key => { const it = PAPS.items[key], cut = it.cut[g + sx]; return `<tr><td><b>${it.el}</b><br><span class="muted small">${it.name}${it.unit ? " (" + it.unit + ")" : ""}</span></td>${[1, 2, 3, 4, 5].map(gr => `<td class="r num">${papsRange(it, cut, gr)}</td>`).join("")}</tr>`; }).join("");
  const c = PAPS.bmi[g + sx], f = x => (+x).toFixed(1);
  return `<div class="stack">${subHead("POPS · 학생건강체력평가", "PAPS 등급 기준표")}
    <div class="msg info small" style="font-weight:500">내 체력 기록은 선생님이 입력하면 여기에서 볼 수 있게 준비하고 있어요.</div>
    <section class="card stack" style="gap:12px">
      <div class="gtabs">${[1, 2, 3].map(x => `<button data-act="papsg" data-v="${x}" class="${x === g ? "on" : ""}">중${x}</button>`).join("")}</div>
      <div class="seg"><button data-act="papss" data-v="M" class="${sx === "M" ? "on" : ""}">남</button><button data-act="papss" data-v="F" class="${sx === "F" ? "on" : ""}">여</button></div>
      <div class="scroll"><table class="tbl papstbl"><thead><tr><th>종목</th>${[1, 2, 3, 4, 5].map(n => `<th class="r">${n}등급</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="scroll"><table class="tbl papstbl"><thead><tr><th>BMI (kg/m²)</th>${PAPS.bmiNames.map(n => `<th class="r">${n}</th>`).join("")}</tr></thead><tbody>
        <tr><td><b>체질량지수</b></td>${[1, 2, 3, 4, 5].map(i => `<td class="r num">${i === 1 ? `${f(c[0])}↓` : i === 5 ? `${f(c[3] + 0.1)}↑` : `${f(c[i - 2] + 0.1)}~${f(c[i - 1])}`}</td>`).join("")}</tr></tbody></table></div>
      <p class="small muted" style="margin:0">↑는 이상, ↓는 이하예요. 2025년 공개 기준표를 옮긴 것이라 학교 나이스 기준표와 다를 수 있어요.</p>
    </section></div>`;
}

/* ---------- 미션 ---------- */
function mCard(m) {
  const k = MKIND[m.kind], open = new Date(m.opens_at) <= serverNow(), closed = new Date(m.closes_at) <= serverNow();
  return `<div class="card stack" style="gap:10px">
    <div class="row between"><b style="font-size:16px">${mTitle(m)}</b><span class="chip">${HOWLAB[k.how]}</span></div>
    ${m.done ? `<div class="msg ok small">제출했어요 · ${Number(m.done.value).toLocaleString()}${k.unit} · ${fmtDT(m.done.at)} · +${m.xp} XP</div>`
      : `<div class="small muted">${fmtDT(m.opens_at)} ~ ${fmtDT(m.closes_at)} · +${m.xp} XP</div>
      ${closed ? '<div class="msg bad small">미션 시간이 끝났어요.</div>' : open ? `<button class="btn ${k.how === "sensor" ? "teal" : ""}" data-act="mstart" data-v="${m.id}">미션 시작</button>` : `<div class="msg info small">${fmtDT(m.opens_at)}에 열려요.</div>`}`}
  </div>`;
}
function vMissions() {
  const all = S.home.missions || [], open = all.filter(m => !m.done && new Date(m.closes_at) > serverNow()), rest = all.filter(m => !open.includes(m));
  return `<div class="stack">${subHead("MISSION", "오늘의 미션")}
    <div class="msg info small" style="font-weight:500">걷기는 휴대폰 움직임 센서로, 맨몸 운동은 카메라 자세 인식으로 세요. 목표를 채우면 자동으로 제출돼요.</div>
    ${open.map(mCard).join("") || '<div class="card muted">지금 할 미션이 없어요.</div>'}
    ${rest.length ? `<span class="eyebrow" style="margin-top:6px">지난 미션</span>${rest.map(mCard).join("")}` : ""}</div>`;
}
let runner = null, walker = null;
const mById = id => (S.home.missions || []).find(m => m.id === id);
function vMissionRun() {
  const m = mById(S.mid); if (!m) return vMissions();
  const k = MKIND[m.kind];
  const head = `${topline()}<button class="back" data-act="sub" data-v="mission">${IC.back} 오늘의 미션</button><div class="pagehead"><span class="eyebrow">MISSION · ${HOWLAB[k.how]}</span><h2>${mTitle(m)}</h2><p class="small muted" style="margin:0">${k.tip}</p></div>`;
  if (m.done) return `<div class="stack">${head}<div class="card xpburst"><span class="state st-COMPLETED">제출 완료</span><b class="num">+${m.xp}</b><div class="eyebrow" style="color:var(--fg)">XP 획득</div>
    <p class="small muted">${Number(m.done.value).toLocaleString()}${k.unit} · ${fmtDT(m.done.at)}${m.done.secs ? " · " + mmss(m.done.secs) : ""}</p><button class="btn ghost" data-act="sub" data-v="mission">다른 미션 보기</button></div></div>`;
  const C = 2 * Math.PI * 96, pct = Math.min(1, S.mcur / m.goal);
  if (k.how === "sensor") return `<div class="stack">${head}
    <div class="card stack" style="align-items:center;text-align:center">
      <div class="ring"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="96" stroke="var(--panel2)" stroke-width="14" fill="none"/><circle data-m="ring" cx="110" cy="110" r="96" stroke="var(--data)" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
        <div class="in"><b class="num" data-m="cur">${S.mcur.toLocaleString()}</b><span class="small muted">/ ${m.goal.toLocaleString()}보</span></div></div>
      <div class="row" style="width:100%"><button class="btn teal" data-act="wgo" data-m="go">${S.mcur ? "이어서 걷기" : "걷기 시작"}</button><button class="btn ghost" data-act="wstop" data-m="stop" disabled>멈춤</button></div>
      <div class="msg info small" data-m="status" style="width:100%;font-weight:500">걷기 시작을 누르고 휴대폰을 들고 걸어요. 화면이 꺼지거나 다른 앱으로 넘어가면 세지 않아요.</div></div>
    <p class="small muted" style="margin:0">걸음은 이 휴대폰 안에서만 세고, 걸음 수와 걸린 시간만 선생님께 보내요. 너무 빠르게 흔들면 걸음으로 세지 않아요. 이 화면을 나가면 센 걸음이 사라져요.</p></div>`;
  return `<div class="stack">${head}
    <div class="stage"><video id="mcam" playsinline muted></video><canvas id="mov"></canvas>
      <div class="ph" id="mph">카메라를 켜면 자세를 인식해서 횟수를 세요.<br>${k.tip}</div>
      <div class="hud"><b class="num" data-m="cur">${S.mcur}</b><small>/ ${m.goal}${k.unit}</small></div><div class="cue" id="mcue" hidden></div></div>
    <div class="row"><button class="btn" data-act="mcam">카메라 켜기</button><label class="btn ghost" for="mvid">영상으로 하기</label><input id="mvid" type="file" accept="video/*" hidden></div>
    <div class="msg info small" data-m="status" style="font-weight:500">AI 모델은 이 기기 안에서만 돌아가요. 영상은 어디에도 올라가지 않아요.</div></div>`;
}
const $m = s => document.querySelector(`[data-m="${s}"]`);
function mStatus(t, k) { const el = $m("status"); if (el) { el.textContent = t; el.className = "msg small " + (k || "info"); el.style.fontWeight = "500"; } }
function mSet(total) {
  const m = mById(S.mid); if (!m || m.done) return;
  S.mcur = Math.min(m.goal, total);
  const c = $m("cur"); if (c) c.textContent = S.mcur.toLocaleString();
  const r = $m("ring"); if (r) { const C = 2 * Math.PI * 96; r.setAttribute("stroke-dashoffset", C * (1 - S.mcur / m.goal)); }
  if (S.mcur >= m.goal) mFinish(m);
}
let finishing = false;
async function mFinish(m) {
  if (finishing) return; finishing = true;
  const secs = walker ? walker.secs() : null;
  stopAll();
  try {
    const r = await call("student_mission_submit", { p_mission: m.id, p_value: S.mcur, p_secs: secs, p_method: MKIND[m.kind].how });
    if (r.error) { toast(errText(r.error)); }
    else { say("미션 완료! 잘했어요"); toast("미션을 제출했어요 +" + r.xp + " XP"); }
    await loadHome();
  } catch (e) { toast(errText(e.code)); }
  finishing = false; render(); window.scrollTo(0, 0);
}
function stopAll() { stopScan(); if (runner) { runner.stop(); runner = null; } if (walker) { walker.stop(); walker = null; } }

/* ---------- 탭과 그리기 ---------- */
function tabsBar() {
  const act = !!activeOf(), n = openMissions().length;
  const t = [["home", "HOME", IC.home], ["check", "CHECK", IC.check], ["my", "MY SPORTS", IC.my], ["rank", "RANKING", IC.rank], ["more", "MORE", IC.more]];
  return `<div class="tabs"><nav>${t.map(x => `<button data-act="tab" data-v="${x[0]}" class="${S.tab === x[0] ? "on" : ""}" aria-label="${x[1]}"><span class="check-dot ${x[0] === "check" && act ? "live" : ""}">${x[2]}${x[0] === "more" && n ? `<i class="tbadge num">${n}</i>` : ""}</span>${x[1]}</button>`).join("")}</nav></div>`;
}
function render() {
  if (!(S.view === "app" && S.sub === "mrun")) { if (runner) { runner.stop(); runner = null; } if (walker) { walker.stop(); walker = null; } }
  let html;
  if (S.view === "splash") html = vSplash();
  else if (S.view === "login") html = vLogin();
  else if (!S.home) html = `<div class="phone"><div class="card muted" style="margin-top:40px">불러오는 중이에요…</div></div>`;
  else {
    const v = S.tab === "home" ? vHome() : S.tab === "check" ? vCheck() : S.tab === "my" ? vMy() : S.tab === "rank" ? vRank() : S.sub ? vSub() : vMore();
    html = `<div class="phone ${S.tab === "rank" && S.rankMode === "class" ? "wide" : ""}">${v}</div>${tabsBar()}`;
  }
  $app.innerHTML = html;
  if (S.view === "splash") { const sp = document.getElementById("splash"); sp.addEventListener("click", go); sp.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") go(); }); clearTimeout(window.__spT); window.__spT = setTimeout(go, 1800); }
}
function go() { if (S.view !== "splash") return; S.view = S.token ? "app" : "login"; render(); if (S.token) enterApp(); }
async function enterApp() {
  S.view = "app"; render();
  try { await loadHome(); render(); loadRace(S.home.me.grade || 1).then(render).catch(() => {}); }
  catch (e) { if (e.code !== "session_expired") { S.home = null; $app.innerHTML = `<div class="phone"><div class="msg bad" style="margin-top:40px">${esc(errText(e.code))}</div><button class="btn" style="margin-top:12px" onclick="location.reload()">다시 시도</button></div>`; } return; }
  if (pendingScan) { const p = pendingScan; pendingScan = null; history.replaceState(null, "", location.pathname); doScan(p); }
}

/* 1초마다 남은 시간만 고쳐요 */
setInterval(() => {
  if (S.view !== "app" || !S.home) return;
  const a = activeOf(); if (!a) return;
  const left = leftOf(a);
  const L = document.querySelector('[data-live="left"]');
  if (L) { if (left <= 0 && !L.dataset.ready) { L.dataset.ready = "1"; if (!S.scanning) return render(); } L.textContent = left > 0 ? clock(left) : "00:00"; const ring = document.querySelector('[data-live="ring"]'); if (ring) { const C = 2 * Math.PI * 96; ring.setAttribute("stroke-dashoffset", C * Math.max(0, left / a.min_seconds)); } }
  const H = document.querySelector('[data-live="homeLeft"]'); if (H && left > 0) H.firstChild.textContent = clock(left);
}, 1000);
// 다시 앱으로 돌아오면 새로 불러와요
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.view === "app" && S.home && S.sub !== "mrun" && !S.scanning) loadHome().then(render).catch(() => {}); });

/* ---------- 이벤트 ---------- */
document.addEventListener("submit", async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "loginForm") {
    if (!configured()) return;
    const no = document.getElementById("sid").value.trim();
    S.busy = true; S.msg = null;
    try {
      let r;
      if (S.loginTab === "first") {
        const name = document.getElementById("sname").value, p1 = document.getElementById("spw1").value, p2 = document.getElementById("spw2").value;
        if (p1 !== p2) { S.busy = false; S.msg = { k: "bad", t: "두 비밀번호가 달라요." }; return render(); }
        r = await rpc("student_signup", { p_no: no, p_name: name, p_pw: p1 });
      } else r = await rpc("student_login", { p_no: no, p_pw: document.getElementById("spw").value });
      S.busy = false;
      if (r.error) { S.msg = { k: "bad", t: errText(r.error) }; return render(); }
      S.token = r.token; store.set("ns_token", r.token); S.msg = null;
      toast(S.loginTab === "first" ? "명단과 확인됐어요. 계정을 만들었어요." : "로그인했어요");
      S.loginTab = ""; S.tab = "home"; enterApp();
    } catch (err) { S.busy = false; S.msg = { k: "bad", t: errText(err.code) }; render(); }
  }
  if (id === "pwForm") {
    try {
      const r = await call("student_change_pw", { p_old: document.getElementById("opw").value, p_new: document.getElementById("npw").value });
      toast(r.error ? errText(r.error) : "비밀번호를 바꿨어요"); if (!r.error) e.target.reset();
    } catch (err) { toast(errText(err.code)); }
  }
});
document.addEventListener("change", e => { if (e.target.id === "mvid" && e.target.files[0]) { if (!runner) runner = makeRunner(); runner.file(e.target.files[0]); } });
function makeRunner() {
  const m = mById(S.mid), base = S.mcur;
  return createPoseRunner(m.kind, { video: document.getElementById("mcam"), canvas: document.getElementById("mov"), cue: document.getElementById("mcue"), ph: document.getElementById("mph") }, reps => mSet(base + reps), mStatus);
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  switch (act) {
    case "login-tab": S.loginTab = v; S.msg = null; render(); break;
    case "tab":
      stopScan(); S.tab = v; S.sub = null; S.msg = v === "check" ? S.msg : null; if (v !== "check") S.done = null; render(); window.scrollTo(0, 0);
      if (v === "rank") { loadRace(S.raceGrade).then(render).catch(() => {}); if (!S.rank) call("student_rank").then(r => { S.rank = r; render(); }).catch(() => {}); }
      if (v === "home" || v === "check") loadHome().then(render).catch(() => {});
      break;
    case "pick": S.pick = v; S.tab = "check"; S.msg = null; S.done = null; render(); window.scrollTo(0, 0); break;
    case "pickstay": S.pick = v; S.msg = null; S.done = null; stopScan(); render(); break;
    case "scanstart": startScan(); break;
    case "scanstop": stopScan(); render(); break;
    case "rank": S.rankMode = v; render(); if (v === "person") call("student_rank").then(r => { S.rank = r; render(); }).catch(() => {}); break;
    case "rgrade": S.raceGrade = +v; render(); loadRace(+v).then(render).catch(() => {}); break;
    case "sub":
      S.tab = "more"; S.sub = v || null; render(); window.scrollTo(0, 0);
      if (v === "history") call("student_history").then(h => { S.hist = h; render(); }).catch(() => {});
      if (v === "mission") loadHome().then(render).catch(() => {});
      break;
    case "papsg": S.papsG = +v; render(); break;
    case "papss": S.papsS = v; render(); break;
    case "logout": logout(); break;
    case "install": if (window.__installEvt) { window.__installEvt.prompt(); window.__installEvt = null; } break;
    case "mstart": S.tab = "more"; S.sub = "mrun"; S.mid = v; S.mcur = 0; render(); window.scrollTo(0, 0); break;
    case "wgo": {
      if (!walker) walker = createWalker(n => mSet(S.mcur + n), mStatus);
      if (await walker.start()) { const g = $m("go"), s = $m("stop"); if (g) g.disabled = true; if (s) s.disabled = false; }
      break;
    }
    case "wstop": if (walker) { walker.stop("멈췄어요. 이어서 걷기를 누르면 다시 세요."); const g = $m("go"), s = $m("stop"); if (g) { g.disabled = false; g.textContent = "이어서 걷기"; } if (s) s.disabled = true; } break;
    case "mcam": if (!runner) runner = makeRunner(); runner.camera(); break;
  }
});
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); window.__installEvt = e; });

// 휴대폰 기본 카메라로 찍으면 주소 뒤에 #scan=… 이 붙어서 열려요
const hs = location.hash.match(/scan=([^&]+)/);
if (hs) pendingScan = extractPayload(decodeURIComponent(hs[1]));
// 앱이 이미 열려 있을 때 QR 주소로 다시 들어온 경우
addEventListener("hashchange", () => {
  const m = location.hash.match(/scan=([^&]+)/), p = m && extractPayload(decodeURIComponent(m[1]));
  if (!p) return;
  history.replaceState(null, "", location.pathname);
  if (S.view === "app" && S.home) doScan(p); else { pendingScan = p; if (S.token && S.view !== "app") { S.view = "app"; enterApp(); } }
});
if (pendingScan && S.token) { S.view = "app"; enterApp(); }
else render();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

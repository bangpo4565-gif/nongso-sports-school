// 학생 앱. 모든 기록은 서버 함수(student_*)로만 주고받아요.
import { rpc, configured, esc, mmss, clock, levelOf, tierOf, fmtDay, fmtTime, fmtDT, toast, deviceId, stTag, store, errText,
  IC, raceHTML, chaseOf, racePeriod, PAPS, papsRange, PAPS_REC, PAPS_USE, papsGradeName, MKIND, HOWLAB, mTitle, BELL } from "./common.js";
import { createPoseRunner, createWalker, say } from "./motion.js";

const $app = document.getElementById("app");
const PHOTO = "img/splash.jpg";
const S = {
  token: store.get("ns_token"), view: "splash", loginTab: "", tab: "home", sub: null,
  home: null, offset: 0, rank: null, rankMode: "class", raceGrade: null, races: {}, hist: null, paps: null,
  msg: null, done: null, scanning: false, pick: null, mid: null, mcur: 0, papsG: null, papsS: "M", busy: false,
  checkMode: null, free: null, fw: null, fwDone: null, prog: null, cal: null, calM: null, calDay: null, rep: null, repM: null, chal: null, freeRank: null
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
async function loadFreeRank() { try { S.freeRank = await call("student_free_rank"); render(); } catch {} }
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
  return `<div class="topline"><div class="brand">농소<em>스포츠스쿨</em></div><div class="who">${m ? (m.grade ? `${m.grade}학년 ${m.class}반 ${m.num}번 ${esc(m.name)}` : `${esc(m.name)} 선생님`) : ""}</div></div>`;
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
    <div class="row between" style="position:relative;z-index:1"><span class="eyebrow">나의 스포츠</span><span class="tier">${tierOf(h.me.xp)}</span></div>
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
      <div class="row" style="margin-top:8px;align-items:flex-end"><div class="num" style="font:800 46px/1 var(--display);color:var(--court);white-space:nowrap;flex:none">${rk}<span style="font-size:18px">위</span></div><div class="small muted" style="padding-bottom:6px">${g}학년 ${b.rows.length}개 반 중 · 참여율 ${Math.round(row.rate * 100)}%${pr ? ` · 지금 상품 <b style="color:var(--fg)">${esc(pr)}</b>` : ""}<br>${me ? `참여 ${me.need}번만 더 모이면 ${me.up.rank}위로 올라가요` : "1등을 지키고 있어요"}</div></div></button>`;
  })() : "";
  const om = openMissions();
  return `<div class="stack">${topline()}
    ${act ? `<button class="sess" data-act="tab" data-v="check" style="border-color:var(--data)"><div class="tm num" data-live="homeLeft">${leftOf(act) > 0 ? clock(leftOf(act)) : "OK"}<small>${leftOf(act) > 0 ? "남음" : "완료 가능"}</small></div>
      <div class="meta">${stTag("ACTIVE")}<b style="margin-top:6px">${esc(act.program)} 운동 중</b><span class="small muted">${leftOf(act) > 0 ? "시간이 다 되면 운동 완료 QR을 찍어요" : "이제 운동 완료 QR을 찍어요"}</span></div></button>` : ""}
    ${hero()}
    <section class="stack"><div class="row between"><h3 class="row" style="font-size:17px;gap:10px">오늘의 미션 ${om.length ? BELL(om.length) : ""}</h3><button class="back" data-act="sub" data-v="mission">전체 보기 ›</button></div>
      ${om.length ? om.slice(0, 3).map(m => `<button class="sess" data-act="mstart" data-v="${m.id}"><div class="tm num">${m.goal >= 1000 ? (m.goal / 1000) + "k" : m.goal}<small>${MKIND[m.kind].unit}</small></div>
        <div class="meta"><b>${mTitle(m)}</b><span class="small muted">${HOWLAB[MKIND[m.kind].how]} · ${fmtDT(m.closes_at)}까지 · +${m.xp} XP</span></div><span class="chip">시작 ›</span></button>`).join("")
        : `<div class="card small muted">${(h.missions || []).some(m => m.done && new Date(m.done.at).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) === new Date(serverNow()).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })) ? "오늘 미션을 모두 끝냈어요! 잘했어요." : "아직 오늘의 미션이 없어요. 선생님이 미션을 내면 여기에 바로 떠요."}</div>`}</section>
    <button class="gcard ghome" data-act="guide"><span class="gico" aria-hidden="true">🏃</span><span class="gtx"><b>농소스포츠스쿨 주요 기능</b><span>여기서 할 수 있는 것을 한눈에 봐요</span></span><span class="back">보기 ›</span></button>
    <section class="stack"><div class="row between"><h3 style="font-size:17px">오늘 열린 운동</h3>${h.open.length ? '<span class="open">● 지금 열림</span>' : ""}</div>
      ${h.open.length ? h.open.map(o => `<button class="sess" data-act="pick" data-v="${o.id}"><div class="tm num">${o.min_seconds >= 60 ? Math.round(o.min_seconds / 60) : o.min_seconds}<small>${o.min_seconds >= 60 ? "분" : "초"}</small></div>
        <div class="meta"><b>${esc(o.program)}</b><span class="small muted">${o.one_scan ? "QR 한 번이면 인정" : "최소 " + mmss(o.min_seconds)} · +${o.xp} XP${o.geo ? " · 위치 인증" : ""}</span></div>
        ${o.mine ? stTag(o.mine.state) : '<span class="chip">인증하기 ›</span>'}</button>`).join("")
        : '<div class="card small muted">지금 열린 출석이 없어요. 선생님이 TV에 QR을 띄우면 여기에 떠요.</div>'}</section>
    ${homeFree()}
    ${homeChal()}
    ${race}
  </div>`;
}
function homeFree() {
  if (S.fw) return `<button class="sess" data-act="free" style="border-color:var(--data)"><div class="tm num" data-live="homeFw">${clock(fwElapsed())}<small>측정 중</small></div>
    <div class="meta"><b>${FKIND[S.fw.kind].icon} 자유운동 ${FKIND[S.fw.kind].name}</b><span class="small muted">끝나면 길게 눌러 운동 종료를 눌러요</span></div><span class="chip">보기 ›</span></button>`;
  if (activeOf() || (S.home.open || []).some(o => !o.mine)) return "";
  return `<section class="card freecard"><div><span class="eyebrow">🏃 자유운동</span><b>학교 밖에서도 운동을 기록해 보세요!</b><span class="small muted">걷기 · 달리기 · 줄넘기 · 홈트레이닝</span></div><button class="btn teal" data-act="free" style="width:auto">자유운동 시작</button></section>`;
}
function homeChal() {
  const t = todayStr(), c = (S.chal || []).find(x => !x.done && x.starts_on <= t && x.ends_on >= t);
  if (!c) return "";
  const m = CMET[c.metric], pct = Math.min(100, Math.round(c.progress / c.goal * 100));
  return `<button class="card" data-act="sub" data-v="chal" style="text-align:left;width:100%"><div class="row between"><span class="eyebrow">🎯 ${CSCOPE[c.scope]}</span><span class="back">보기 ›</span></div>
    <b style="display:block;margin-top:6px">${esc(c.title)}</b><div class="pbar big" style="margin-top:10px"><i style="width:${pct}%"></i></div>
    <div class="small muted num" style="margin-top:6px">${Number(Math.min(c.progress, c.goal)).toLocaleString()} / ${Number(c.goal).toLocaleString()}${m[1]} · +${c.xp} XP${c.progress >= c.goal ? " · 보상 받기 가능!" : ""}</div></button>`;
}

/* ---------- CHECK ---------- */
function vCheck() {
  const h = S.home, open = h.open;
  if (!open.length) return `<div class="stack">${topline()}<div class="pagehead"><span class="eyebrow">운동인증</span><h2>QR 운동인증</h2></div><div class="card muted">지금 열린 출석이 없어요.</div></div>`;
  const o = open.find(x => x.id === S.pick) || activeOf() || open[0];
  S.pick = o.id;
  const st = o.mine ? o.mine.state : "WAITING";
  let body = "";
  if (S.done && S.done.id === o.id) {
    const d = S.done;
    body = `<div class="card xpburst">${stTag("COMPLETED", "운동 인증 완료")}<b class="num">+${d.xp}</b><div class="eyebrow" style="color:var(--fg)">XP 획득</div>
      ${d.up ? `<div class="msg ok" style="margin-top:14px">레벨 업! 이제 LV ${d.lv}이에요.</div>` : ""}<p class="small muted">${esc(o.program)} · ${d.secs ? mmss(d.secs) + " 활동" : "출석 인정"}</p>
      <button class="btn ghost" data-act="tab" data-v="my">나의 스포츠 카드 보기</button></div>`;
  } else if (st === "ACTIVE") {
    const left = leftOf(o), pct = Math.min(1, 1 - left / o.min_seconds), C = 2 * Math.PI * 96;
    body = `<div class="card stack" style="align-items:center;text-align:center">${stTag("ACTIVE")}
      <div class="ring"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="96" stroke="var(--panel2)" stroke-width="14" fill="none"/><circle data-live="ring" cx="110" cy="110" r="96" stroke="${left > 0 ? "var(--data)" : "var(--good)"}" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
        <div class="in"><b class="num" data-live="left">${left > 0 ? clock(left) : "00:00"}</b><span class="small muted">${left > 0 ? "조금만 더 운동하면 인증할 수 있어요!" : "이제 운동 완료 QR을 찍어요"}</span></div></div>
      <p class="small muted" style="margin:0">시간은 학교 서버 시계로 재요. 앱을 닫아도 계속 흘러가요.</p>
      ${scannerHTML("TV의 운동 완료 QR 찍기")}</div>`;
  } else if (st === "WAITING") {
    body = scannerHTML(o.one_scan ? "TV의 출석 QR 찍기" : "TV의 운동 시작 QR 찍기");
  } else {
    body = `<div class="card">${stTag(st)}<p class="small muted" style="margin:10px 0 0">${st === "FAILED" ? "운동 완료 QR을 찍기 전에 운동 시간이 끝났어요. 다음에 다시 해 봐요." : "오늘 이 프로그램은 끝났어요."}</p></div>`;
  }
  return `<div class="stack">${topline()}
    <div class="pagehead"><span class="eyebrow">운동인증</span><h2>${esc(o.program)}</h2>
      <div class="row small muted" style="flex-wrap:wrap;gap:8px"><span class="chip">${o.one_scan ? "QR 한 번이면 인정" : "최소 " + mmss(o.min_seconds)}</span><span class="chip">+${o.xp} XP</span>${o.geo ? '<span class="chip">위치 인증</span>' : ""}${stTag(st)}</div></div>
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
    S.tab = "check"; S.sub = null; S.checkMode = "school";
    if (r.error) {
      S.msg = { k: r.error === "already_in" || r.error === "already_done" ? "info" : "bad", t: errText(r.error, r.error === "too_early" ? `${mmss(r.left)} 남았어요.` : r.error === "too_far" ? `(약 ${r.meters}m)` : "") };
    } else if (r.state === "ACTIVE") {
      S.msg = { k: "ok", t: "운동 시작 인증 완료! 지금부터 시간을 잴게요." }; S.done = null;
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
    <div class="pagehead"><span class="eyebrow">내 기록</span><h2>나의 스포츠 카드</h2></div>
    <section class="idcard">
      <div class="row between"><span class="idno">NS-${esc(h.me.no)}</span><span class="tier">${tierOf(h.me.xp)}</span></div>
      <div class="idname">${esc(h.me.name)}</div><div class="small muted">농소중학교 · ${h.me.grade ? `${h.me.grade}학년 ${h.me.class}반 ${h.me.num}번` : `함께 운동하는 선생님 · 교사번호 ${esc(h.me.no)}`}</div>
      <div style="margin-top:14px"><div class="row between small"><span class="num" style="font:800 20px var(--display)">LV ${L.lv}</span><span class="muted num">${L.into} / ${L.need} XP</span></div><div class="bar" style="margin-top:6px"><i style="width:${L.into / L.need * 100}%"></i></div></div>
      <div class="idgrid"><div><b class="num">${h.me.xp.toLocaleString()}</b><span>누적 XP</span></div><div><b class="num">${h.total_count}</b><span>참여 횟수</span></div><div><b class="num">${h.week_count}</b><span>이번 주 참여</span></div><div><b class="num">${(h.missions || []).filter(m => m.done).length}</b><span>완료 미션</span></div></div>
    </section>
    ${streakCard()}${growLinks()}
    <button class="card" data-act="sub" data-v="history" style="text-align:left;width:100%"><div class="row between"><span class="eyebrow">활동 기록</span><span class="back">보기 ›</span></div><p class="small muted" style="margin:6px 0 0">출석과 XP가 언제 들어왔는지 볼 수 있어요.</p></button>
  </div>`;
}

/* ---------- RANKING ---------- */
function vRank() {
  const h = S.home, tch = !h.me.grade, fr = S.rankMode === "free", cls = !tch && !fr && S.rankMode === "class", g = S.raceGrade || h.me.grade, b = S.races[g];
  let body = "";
  if (cls) {
    const c = b && g === h.me.grade ? chaseOf(b, h.me.class) : null;
    body = `<div class="gtabs" role="tablist">${[1, 2, 3].map(x => `<button role="tab" aria-selected="${x === g}" data-act="rgrade" data-v="${x}" class="${x === g ? "on" : ""}">${x}학년${x === h.me.grade ? " (우리)" : ""}</button>`).join("")}</div>
      ${!b ? '<div class="card muted">불러오는 중이에요…</div>' : `${g === h.me.grade && b.rows.length ? (c ? `<div class="msg info">우리 반(${g}-${h.me.class})은 참여 <b>${c.need}번</b>만 더 모이면 ${g}-${c.up.cls}반을 따라잡아요.</div>` : `<div class="msg ok">우리 반이 ${g}학년 1등이에요!</div>`) : ""}
      ${raceHTML(b, false, g === h.me.grade ? h.me.class : 0)}
      <p class="small muted" style="margin:0">점수는 참여율이에요. ${esc(b.program || "아침 운동")}에서 출석 인증을 마친 학생을 세요. 한 사람은 하루 1번만 세요. 기간: ${racePeriod(b)}</p>`}`;
  } else {
    const r = S.rank;
    body = !r ? '<div class="card muted">불러오는 중이에요…</div>' : `<div class="msg info small" style="font-weight:500">${h.me.grade ? `다른 친구 이름은 가운데 글자를 가려요. 나는 ${h.me.grade}학년 ${r.total}명 중` : `함께 운동하는 선생님 ${r.total}명 중`} <b>${r.my_rank}위</b>예요.</div>
      <div class="stack" style="gap:8px">${r.top.map(p => `<div class="rk ${p.me ? "me" : ""}"><div class="pos num p${p.rank}">${p.rank}</div><div><b>${p.me ? esc(h.me.name) + " (나)" : esc(p.name)}</b><div class="mini"><span>${h.me.grade ? `${h.me.grade}학년 ${p.class}반` : "선생님"}</span></div></div><div class="sc num">${p.xp.toLocaleString()}<small>XP</small></div></div>`).join("")}</div>`;
  }
  return `<div class="stack">${topline()}
    <div class="pagehead"><span class="eyebrow">순위${cls && b ? ` · ${g}학년 · ${racePeriod(b)}` : ""}</span><h2>${fr ? "자유운동 순위" : tch ? "선생님 참여 순위" : cls ? "학급 레이스" : "개인 랭킹"}</h2></div>
    <div class="seg" style="grid-template-columns:repeat(${tch ? 2 : 3},1fr)">${(tch ? [["person", "참여 순위"], ["free", "자유운동"]] : [["class", "학급 레이스"], ["person", "개인"], ["free", "자유운동"]]).map(x => `<button data-act="rank" data-v="${x[0]}" class="${x[0] === (fr ? "free" : cls ? "class" : "person") ? "on" : ""}">${x[1]}</button>`).join("")}</div>
    ${fr ? freeRankHTML() : body}</div>`;
}

/* 카카오톡·네이버·인스타그램 같은 앱 안 브라우저에서는 설치가 안 돼서 알려 줘요 */
function inAppBrowser() {
  const u = navigator.userAgent;
  return /KAKAOTALK/i.test(u) ? "카카오톡" : /NAVER\(inapp/i.test(u) ? "네이버 앱" : /Instagram/i.test(u) ? "인스타그램" : /FBAN|FBAV/i.test(u) ? "페이스북" : /\bLine\//i.test(u) ? "라인" : /; wv\)/.test(u) ? "앱" : "";
}
function externalUrl(ia) {
  const here = location.origin + "/";
  if (ia === "카카오톡") return "kakaotalk://web/openExternal?url=" + encodeURIComponent(here);
  if (/Android/i.test(navigator.userAgent)) return `intent://${location.host}/#Intent;scheme=https;package=com.android.chrome;end`;
  return "";
}
/* ---------- MORE ---------- */
function subHead(eb, title) { return `${topline()}<button class="back" data-act="sub" data-v="">${IC.back} 더보기</button><div class="pagehead"><span class="eyebrow">${eb}</span><h2>${title}</h2></div>`; }
function vMore() {
  const n = openMissions().length;
  const items = [["mission", "오늘의 미션", n ? `남은 미션 ${n}개` : "선생님이 낸 미션 하기"], ["chal", "도전", "도전과 우리 반 공동목표"], ["cal", "운동 달력", "언제 어떤 운동을 했는지"], ["report", "월간 리포트", "지난달의 나와 비교"], ["badges", "배지", "모은 배지와 다음 목표"], ["dex", "운동 도감", "경험한 종목 모으기"], ["pops", "POPS", "내 체력 기록과 등급 기준"], ["history", "활동 기록", "내 출석과 XP 내역"], ["install", "휴대폰에 설치", "홈 화면에 앱 아이콘 만들기"], ["settings", "설정", "비밀번호 바꾸기, 로그아웃"]];
  return `<div class="stack">${topline()}<div class="pagehead"><span class="eyebrow">농소스포츠스쿨</span><h2>더보기</h2></div>
    <div class="menu">${items.map(i => `<button data-act="sub" data-v="${i[0]}"><span class="k">${i[1]}${i[0] === "mission" && n ? " " + BELL(n) : ""}</span><span class="d">${i[2]}</span><span class="muted">›</span></button>`).join("")}</div></div>`;
}
/* 주요 기능 안내: 아직 만들지 않은 기능은 링크 없이 '준비 중'으로만 보여요 */
const GUIDE = [
  ["✅", "운동인증", "학교에서 진행되는 운동에 참여하고 QR로 운동을 인증해요.", ["tab", "check"]],
  ["🏃", "자유운동", "하교 후나 주말에도 걷기·달리기 등 스스로 한 운동을 기록해요.", ["free", ""]],
  ["🌅", "아침미션", "선생님이 제시하는 아침 운동 미션에 도전해요.", ["sub", "mission"]],
  ["⭐", "경험치(XP) & 레벨", "운동하고 도전하면 경험치가 쌓이고 나의 레벨이 성장해요.", ["tab", "my"]],
  ["🎯", "도전", "오늘의 도전, 주간 도전 등 다양한 운동 목표에 도전해요.", ["sub", "chal"]],
  ["🔥", "꾸준한 운동", "연속 참여, 운동 횟수, 운동시간 등 나의 꾸준한 활동을 확인해요.", ["tab", "my"]],
  ["📅", "운동 달력", "내가 언제, 어떤 운동을 했는지 달력으로 한눈에 확인해요.", ["sub", "cal"]],
  ["🏅", "배지", "다양한 운동 목표를 달성하고 특별한 배지를 모아요.", ["sub", "badges"]],
  ["🧭", "운동 도감", "내가 직접 경험한 다양한 스포츠 종목을 하나씩 모아가요.", ["sub", "dex"]],
  ["💪", "POPS", "나의 체력 기록을 확인하고 이전의 나보다 얼마나 성장했는지 확인해요.", ["sub", "pops"]],
  ["🏆", "최고 기록", "나의 이전 기록을 넘어 새로운 개인 최고 기록에 도전해요.", ["sub", "pops"]],
  ["👥", "우리 반 공동목표", "친구들과 함께 운동하며 우리 반의 공동 목표를 달성해요.", ["sub", "chal"]],
  ["📊", "월간 리포트", "한 달 동안의 운동 횟수, 운동시간, 걸음 수, 경험치 등 나의 성장을 확인해요.", ["sub", "report"]]
];
function vGuide() {
  const card = ([ic, name, desc, go]) => {
    const inner = `<span class="gico" aria-hidden="true">${ic}</span><span class="gtx"><b>${esc(name)}</b><span>${esc(desc)}</span></span>${go ? '<span class="gchip on">바로가기 ›</span>' : '<span class="gchip">준비 중</span>'}`;
    return go ? `<button class="gcard" data-act="${go[0]}" data-v="${go[1]}">${inner}</button>` : `<div class="gcard off">${inner}</div>`;
  };
  return `<div class="stack">${topline()}<button class="back" data-act="tab" data-v="home">${IC.back} 홈</button><div class="pagehead"><span class="eyebrow">홈</span><h2>주요 기능 안내</h2></div>
    <section class="ghero"><div class="gemo" aria-hidden="true">🏃</div><h3>농소스포츠스쿨 주요 기능</h3><p class="gq">“움직이고, 기록하고, 성장하자!”</p>
      <p class="small muted" style="margin:0">농소스포츠스쿨은 학교 안팎에서 운동하고, 나의 활동을 기록하며 성장하는 스포츠 활동 공간입니다.</p></section>
    <div class="glist">${GUIDE.map(card).join("")}</div>
    <section class="gflow"><div class="gsteps"><span>🏃<b>움직이고</b></span><i>→</i><span>✅<b>인증하고</b></span><i>→</i><span>📊<b>기록하고</b></span><i>→</i><span>🌱<b>성장하고</b></span></div>
      <p class="gmotto">“오늘의 움직임이<br>내일의 나를 만듭니다.”</p></section></div>`;
}
function vSub() {
  const k = S.sub;
  if (k === "mission") return vMissions();
  if (k === "mrun") return vMissionRun();
  if (k === "pops") return vPops();
  if (k === "cal") return vCal();
  if (k === "report") return vReport();
  if (k === "badges") return vBadges();
  if (k === "dex") return vDex();
  if (k === "chal") return vChal();
  if (k === "history") {
    const h = S.hist;
    return `<div class="stack">${subHead("내 기록", "활동 기록")}${!h ? '<div class="card muted">불러오는 중이에요…</div>' : `
      <div class="card scroll"><table class="tbl"><thead><tr><th>날짜</th><th>프로그램</th><th>상태</th><th class="r">XP</th></tr></thead><tbody>
      ${h.attendance.length ? h.attendance.map(a => `<tr><td class="num">${fmtDay(a.day)}</td><td>${esc(a.program)}</td><td>${stTag(a.state)}</td><td class="r num">${a.xp ? "+" + a.xp : "0"}</td></tr>`).join("") : '<tr><td colspan="4" class="muted">아직 출석 기록이 없어요.</td></tr>'}</tbody></table></div>
      <div class="card scroll"><span class="eyebrow">XP 내역</span><table class="tbl" style="margin-top:8px"><tbody>
      ${h.xp.length ? h.xp.map(x => `<tr><td class="num muted">${fmtDT(x.created_at)}</td><td>${esc(x.reason)}</td><td class="r num">${x.amount > 0 ? "+" : ""}${x.amount}</td></tr>`).join("") : '<tr><td class="muted">아직 없어요.</td></tr>'}</tbody></table></div>
      <p class="small muted" style="margin:0">미완료는 운동 완료 QR을 찍기 전에 운동 시간이 끝난 기록이에요. 선생님 인정은 선생님이 직접 인정한 기록이에요.</p>`}</div>`;
  }
  if (k === "install") {
    const ia = inAppBrowser();
    return `<div class="stack">${subHead("더보기", "휴대폰에 설치")}
      ${ia ? `<div class="card stack" style="gap:10px;outline:1.5px solid var(--court)"><b>지금은 ${ia} 안에서 열려 있어요</b><p class="small muted" style="margin:0">${ia} 안에서는 홈 화면에 추가할 수 없어요. ${/iPhone|iPad/.test(navigator.userAgent) ? "사파리" : "크롬이나 삼성 인터넷"}으로 연 다음 아래 방법대로 설치해 주세요.</p>
        ${externalUrl(ia) ? `<a class="btn" href="${esc(externalUrl(ia))}">${/iPhone|iPad/.test(navigator.userAgent) ? "사파리" : "크롬"}으로 열기</a>` : ""}<p class="small muted" style="margin:0">버튼이 안 되면 화면의 ⋮ 또는 ··· 메뉴에서 <b>다른 브라우저로 열기</b>를 눌러요.</p></div>` : ""}
      <div class="card stack" style="gap:10px"><b>갤럭시 (삼성 인터넷)</b><p class="small muted" style="margin:0">주소창 오른쪽의 <b>⬇ 아이콘</b>을 누르고 <b>설치</b>를 눌러요. 아이콘이 없으면 아래 ≡ 메뉴 → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 눌러요.</p></div>
      <div class="card stack" style="gap:10px"><b>안드로이드 (크롬)</b><p class="small muted" style="margin:0">오른쪽 위 ⋮ 메뉴 → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요.</p>
      ${window.__installEvt ? '<button class="btn" data-act="install">지금 설치하기</button>' : ""}</div>
      <div class="card stack" style="gap:10px"><b>아이폰 (사파리)</b><p class="small muted" style="margin:0">아래 가운데 공유 버튼(□↑) → <b>홈 화면에 추가</b>를 눌러요. 사파리에서만 돼요.</p></div>
      <p class="small muted" style="margin:0">설치하면 바탕화면에 농소스포츠 아이콘이 생기고, 누르면 앱처럼 전체 화면으로 열려요.</p></div>`;
  }
  if (k === "settings") {
    return `<div class="stack">${subHead("더보기", "설정")}
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
  const keys = ["shuttle", "reach", "curl", "jump"];
  const rows = keys.map(key => { const it = PAPS.items[key], cut = it.cut[g + sx]; return `<tr><td><b>${it.el}</b><br><span class="muted small">${it.name}${it.unit ? " (" + it.unit + ")" : ""}</span></td>${[1, 2, 3, 4, 5].map(gr => `<td class="r num">${papsRange(it, cut, gr)}</td>`).join("")}</tr>`; }).join("");
  const c = PAPS.bmi[g + sx], f = x => (+x).toFixed(1);
  return `<div class="stack">${subHead("POPS · 학생건강체력평가", "내 체력 기록")}
    ${myPaps()}
    <h3 style="font-size:17px;margin-top:6px">PAPS 등급 기준표</h3>
    <section class="card stack" style="gap:12px">
      <div class="gtabs">${[1, 2, 3].map(x => `<button data-act="papsg" data-v="${x}" class="${x === g ? "on" : ""}">중${x}</button>`).join("")}</div>
      <div class="seg"><button data-act="papss" data-v="M" class="${sx === "M" ? "on" : ""}">남</button><button data-act="papss" data-v="F" class="${sx === "F" ? "on" : ""}">여</button></div>
      <div class="scroll"><table class="tbl papstbl"><thead><tr><th>종목</th>${[1, 2, 3, 4, 5].map(n => `<th class="r">${n}등급</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="scroll"><table class="tbl papstbl"><thead><tr><th>BMI (kg/m²)</th>${PAPS.bmiNames.map(n => `<th class="r">${n}</th>`).join("")}</tr></thead><tbody>
        <tr><td><b>체질량지수</b></td>${[1, 2, 3, 4, 5].map(i => `<td class="r num">${i === 1 ? `${f(c[0])}↓` : i === 5 ? `${f(c[3] + 0.1)}↑` : `${f(c[i - 2] + 0.1)}~${f(c[i - 1])}`}</td>`).join("")}</tr></tbody></table></div>
      <p class="small muted" style="margin:0">↑는 이상, ↓는 이하예요. 2025년 공개 기준표를 옮긴 것이라 학교 나이스 기준표와 다를 수 있어요.</p>
    </section></div>`;
}

/* 내 PAPS 기록: 종목마다 최근 기록, 등급, 지난번과 비교, 내 최고 기록. 다른 학생과는 비교하지 않아요 */
const pkey = r => r.year * 10 + r.round, plab = r => `${r.year} ${r.round}차`;
function papsSpark(recs, hi) {
  if (recs.length < 2) return "";
  const W = 120, H = 34, vs = recs.map(r => +r.value), lo = Math.min(...vs), up = Math.max(...vs), sp = up - lo || 1;
  const pts = vs.map((v, i) => [4 + i * (W - 8) / (vs.length - 1), H - 4 - (hi ? v - lo : up - v) / sp * (H - 8)]);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none" stroke="var(--data)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 3.5 : 2.5}" fill="${i === pts.length - 1 ? "var(--data)" : "var(--ink)"}" stroke="var(--data)" stroke-width="1.5"/>`).join("")}</svg>`;
}
function myPaps() {
  const P = S.paps;
  if (!P) return '<div class="card muted">불러오는 중이에요…</div>';
  if (!P.length) return '<div class="msg info small" style="font-weight:500">아직 내 체력 기록이 없어요. 선생님이 기록을 올리면 여기에서 볼 수 있어요.</div>';
  const by = k => P.filter(r => r.item === k).sort((a, b) => pkey(a) - pkey(b));
  const tot = by("total"), last = tot[tot.length - 1];
  const fmt = v => (+v).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const head = last ? `<section class="card"><div class="row between"><span class="eyebrow">${plab(last)} · 건강체력평가</span>${last.grade_level ? `<span class="chip">종합 ${last.grade_level}등급</span>` : ""}</div>
    <div class="row" style="align-items:flex-end;gap:8px;margin-top:8px"><b class="num" style="font:800 44px/1 var(--display);color:var(--court)">${fmt(last.value)}</b><span class="muted" style="padding-bottom:6px">점</span>
    ${tot.length > 1 ? (() => { const d = +last.value - +tot[tot.length - 2].value; return d ? `<span class="small" style="padding-bottom:8px;color:${d > 0 ? "var(--good)" : "var(--muted)"}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}점 (${plab(tot[tot.length - 2])}보다)</span>` : ""; })() : ""}</div></section>` : "";
  const items = PAPS_USE.filter(k => k !== "total").map(k => {
    const rs = by(k); if (!rs.length) return "";
    const it = PAPS_REC[k], L = rs[rs.length - 1], prev = rs[rs.length - 2], neutral = it.hi == null;
    const best = rs.reduce((b, r) => (it.hi ? +r.value > +b.value : +r.value < +b.value) ? r : b, rs[0]);
    const d = prev ? +L.value - +prev.value : 0, good = !neutral && (it.hi ? d > 0 : d < 0);
    const pb = !neutral && prev && best === L && d !== 0;
    return `<div class="card" style="padding:14px 16px"><div class="row between" style="gap:12px">
      <div style="min-width:0"><span class="eyebrow">${it.el}</span><div style="font-weight:700;margin-top:4px">${it.name}</div>
        <div class="row" style="gap:8px;margin-top:6px;align-items:baseline;flex-wrap:wrap"><b class="num" style="font-size:24px">${fmt(L.value)}</b><span class="small muted">${it.unit}</span>${L.grade_level ? `<span class="chip">${papsGradeName(k, L.grade_level)}</span>` : ""}${pb ? '<span class="chip" style="color:var(--gold);border-color:rgba(255,209,102,.4)">최고 기록 <small style="opacity:.7">PB</small></span>' : ""}</div>
        <div class="small muted" style="margin-top:4px">${prev ? (d ? `<span style="color:${good ? "var(--good)" : "var(--muted)"}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}${it.unit}</span> · ${plab(prev)} ${fmt(prev.value)} → ${plab(L)}` : `${plab(prev)}과 같아요`) : `${plab(L)} 기록`}${!neutral && prev && best !== L ? ` · 내 최고 ${fmt(best.value)}` : ""}</div></div>
      ${papsSpark(rs, it.hi !== false)}</div></div>`;
  }).join("");
  return `${head}<div class="stack" style="gap:10px">${items}</div>
    <p class="small muted" style="margin:0">내 기록은 나와 선생님만 볼 수 있어요. 친구와 비교하지 않고, 지난번의 나와 비교해요.</p>`;
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
  return `<div class="stack">${subHead("더보기", "오늘의 미션")}
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

/* ---------- 자유운동 ---------- */
const FKIND = {
  walk: { name: "걷기", icon: "🚶", steps: true, tip: "휴대폰을 손에 들거나 주머니에 넣고 걸어요." },
  run: { name: "달리기", icon: "🏃", steps: true, tip: "휴대폰을 손에 들거나 주머니에 넣고 달려요." },
  jumprope: { name: "줄넘기", icon: "🤸", steps: false, tip: "휴대폰을 주머니에 넣고 줄넘기를 해요. 횟수는 세지 않고 운동시간을 기록해요." },
  hometrain: { name: "홈트레이닝", icon: "💪", steps: false, tip: "휴대폰을 주머니에 넣거나 몸 가까이 두고 운동해요. 운동시간을 기록해요." }
};
const FSTAT = { OK: ["COMPLETED", "인정"], APPROVED: ["MANUAL", "선생님 인정"], SHORT: ["WAITING", "시간 부족"], REVIEW: ["ACTIVE", "선생님 확인 중"], REJECTED: ["FAILED", "인정 안 됨"] };
const fTag = st => `<span class="state st-${(FSTAT[st] || ["WAITING"])[0]}">${(FSTAT[st] || [, st])[1]}</span>`;
const mins = s => Math.floor((s || 0) / 60);
const FW_KEY = "ns_fw";
let fwWalker = null;
async function loadFree() { S.free = await call("student_free_state"); S.offset = new Date(S.free.now).getTime() - Date.now(); syncFw(); return S.free; }
/* 이 휴대폰에서 센 걸음은 서버에 보내기 전까지 휴대폰에 잠깐 저장해요 (앱을 다시 열어도 이어서 셀 수 있게) */
function syncFw() {
  const a = S.free?.active;
  if (!a) { S.fw = null; store.set(FW_KEY, null); return; }
  if (S.fw && S.fw.id === a.id) return;
  let saved = null; try { saved = JSON.parse(store.get(FW_KEY) || "null"); } catch {}
  const fw = { id: a.id, kind: a.kind, start: new Date(a.started_at).getTime(), steps: 0, moves: 0, minutes: [], off: 0, hiddenAt: 0, seen: Date.now(), on: false };
  if (saved && saved.id === a.id) {
    Object.assign(fw, { steps: saved.steps || 0, moves: saved.moves || 0, minutes: saved.minutes || [], off: saved.off || 0 });
    if (saved.seen) fw.off += Math.max(0, (Date.now() - saved.seen) / 1000 - 5);   // 앱을 닫아 둔 동안은 화면이 꺼진 시간으로 쳐요
  }
  S.fw = fw; saveFw();
}
function saveFw() { const f = S.fw; if (!f) return; f.seen = Date.now(); store.set(FW_KEY, JSON.stringify({ id: f.id, steps: f.steps, moves: f.moves, minutes: f.minutes, off: f.off, seen: f.seen })); }
const fwElapsed = () => S.fw ? Math.max(0, (serverNow() - S.fw.start) / 1000 - S.fw.off - (S.fw.hiddenAt ? (Date.now() - S.fw.hiddenAt) / 1000 : 0)) : 0;
function fwStatus(t, k) { const el = document.querySelector('[data-f="status"]'); if (el) { el.textContent = t; el.className = "msg small " + (k || "info"); el.style.fontWeight = "500"; } }
function fwStep(n) {
  const f = S.fw; if (!f) return;
  if (FKIND[f.kind].steps) {
    f.steps += n; const i = Math.max(0, Math.floor((serverNow() - f.start) / 60000));
    while (f.minutes.length <= i) f.minutes.push(0);
    f.minutes[i] += n;
    const el = document.querySelector('[data-f="steps"]'); if (el) el.textContent = f.steps.toLocaleString();
  } else {
    f.moves += n;
    const el = document.querySelector('[data-f="moves"]'); if (el && f.moves === 1) el.textContent = "움직임 감지됨";
  }
  if ((f.steps + f.moves) % 10 === 0) saveFw();
}
async function fwSense() {
  if (!S.fw) return;
  if (!fwWalker) fwWalker = createWalker(fwStep, fwStatus);
  const ok = await fwWalker.start();
  S.fw.on = ok;
  const b = document.querySelector('[data-act="fwsense"]'); if (b) b.hidden = ok;
}
function fwStopSense() { if (fwWalker) { fwWalker.stop(); fwWalker = null; } if (S.fw) S.fw.on = false; }
document.addEventListener("visibilitychange", () => {
  const f = S.fw; if (!f) return;
  if (document.hidden) { if (!f.hiddenAt) f.hiddenAt = Date.now(); saveFw(); }
  else if (f.hiddenAt) {
    f.off += (Date.now() - f.hiddenAt) / 1000; f.hiddenAt = 0; saveFw();
    if (S.tab === "check" && S.checkMode === "free") { render(); if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission !== "function") fwSense(); }
  }
});
setInterval(saveFw, 5000);

function checkSeg() {
  const m = S.checkMode;
  return `<div class="seg"><button data-act="cmode" data-v="school" class="${m === "school" ? "on" : ""}">학교 운동인증</button><button data-act="cmode" data-v="free" class="${m === "free" ? "on" : ""}">자유운동${S.fw ? " ●" : ""}</button></div>`;
}
function vFree() {
  const F = S.free;
  const top = `${topline()}${checkSeg()}`;
  if (!F) return `<div class="stack">${top}<div class="card muted">불러오는 중이에요…</div></div>`;
  const cfg = F.cfg || {}, basis = cfg.basis || "time";
  const rule = basis === "steps" ? `걷기·달리기는 ${Number(cfg.min_steps).toLocaleString()}걸음, 줄넘기·홈트레이닝은 ${mins(cfg.min_secs)}분`
    : basis === "both" ? `${mins(cfg.min_secs)}분 이상 (걷기·달리기는 ${Number(cfg.min_steps).toLocaleString()}걸음도)` : `${mins(cfg.min_secs)}분 이상`;
  if (S.fwDone) {
    const d = S.fwDone, k = FKIND[d.kind];
    const msg = d.status === "OK" ? (d.xp ? "운동이 인정됐어요!" : "기록은 저장됐어요. 오늘 받을 수 있는 XP는 다 받았어요.")
      : d.status === "REVIEW" ? "기록은 저장됐어요. 선생님이 한 번 확인하고 있어요." : d.flags?.includes("nomove") ? "휴대폰 움직임이 없어서 인정되지 않았어요. 기록은 저장됐어요." : `기록은 저장됐어요. ${rule}을 채우면 XP를 받아요.`;
    return `<div class="stack">${top}<div class="card xpburst">${fTag(d.status)}<b class="num">${d.xp ? "+" + d.xp : k.icon}</b>${d.xp ? '<div class="eyebrow" style="color:var(--fg)">XP 획득</div>' : ""}
      <p style="margin:10px 0 4px;font-weight:700">${msg}</p><p class="small muted" style="margin:0">${k.name} · ${mmss(d.active_secs)}${k.steps ? ` · 추정 ${Number(d.steps).toLocaleString()}걸음` : ""}</p>
      <button class="btn ghost" data-act="fwnew" style="margin-top:14px">확인</button></div></div>`;
  }
  if (S.fw) {
    const f = S.fw, k = FKIND[f.kind], el = fwElapsed();
    return `<div class="stack">${top}
      <div class="pagehead"><span class="eyebrow">자유운동 · 측정 중</span><h2>${k.icon} ${k.name}</h2></div>
      <div class="card stack fwrun" style="align-items:center;text-align:center">
        <div class="fwbig num" data-live="fwtime">${clock(el)}</div><span class="small muted">운동시간</span>
        ${k.steps ? `<div class="fwsteps"><b class="num" data-f="steps">${f.steps.toLocaleString()}</b><span>추정 걸음</span></div>` : `<div class="fwsteps"><b data-f="moves" style="font-size:16px">${f.moves ? "움직임 감지됨" : "움직임을 기다리는 중"}</b></div>`}
        <button class="btn teal" data-act="fwsense" ${f.on ? "hidden" : ""}>${f.steps || f.moves ? "이어서 측정" : "측정 시작"}</button>
        <div class="msg info small" data-f="status" style="width:100%;font-weight:500">${f.on ? "측정 중이에요. 화면을 켜 둔 채로 운동해요." : "측정 시작을 누르면 휴대폰 센서로 움직임을 세요."}</div>
        <button class="hold" data-hold="fwend" aria-label="길게 눌러 운동 종료"><i></i><span>길게 눌러 운동 종료</span></button>
        <button class="back" data-act="fwcancel" style="margin:0 auto">기록하지 않고 취소</button></div>
      <p class="small muted" style="margin:0">${k.tip} 화면이 꺼지거나 다른 앱을 보는 동안은 시간과 걸음을 세지 않아요. 인정 기준: ${rule}. 걸음 수는 추정값이라 삼성 헬스와 다를 수 있어요.</p></div>`;
  }
  const kinds = (cfg.kinds || Object.keys(FKIND)).filter(k => FKIND[k]);
  const left = Math.max(0, (cfg.daily_count ?? 2) - F.today.count);
  return `<div class="stack">${top}
    <div class="pagehead"><span class="eyebrow">자유운동</span><h2>학교 밖에서도 운동을 기록해요</h2>
      <p class="small muted" style="margin:0">하교 후나 주말에 한 운동을 골라서 시작해요. ${rule}이면 인정돼요.</p></div>
    ${cfg.on === false ? `<div class="msg info">${errText("free_off")}</div>` : `<div class="fkinds">${kinds.map(k => `<button class="fkind" data-act="fwstart" data-v="${k}"><span>${FKIND[k].icon}</span><b>${FKIND[k].name}</b><small>+${(cfg.xp || {})[k] ?? 20} XP</small></button>`).join("")}</div>`}
    <div class="msg ${left ? "info" : "ok"} small" style="font-weight:500">${left ? `오늘 XP를 받을 수 있는 자유운동이 ${left}번 남았어요.` : "오늘 받을 수 있는 자유운동 XP는 다 받았어요. 운동 기록은 계속 남길 수 있어요."}</div>
    <div class="row between"><h3 style="font-size:17px">내 자유운동 기록</h3><button class="back" data-act="tab" data-v="rank" data-rank="free">자유운동 순위 ›</button></div>
    ${F.recent.length ? `<div class="stack" style="gap:8px">${F.recent.map(w => `<div class="card fwrow"><span class="fico">${FKIND[w.kind]?.icon || "🏅"}</span><div style="flex:1;min-width:0"><b>${FKIND[w.kind]?.name || w.kind}</b><div class="small muted">${fmtDT(w.started_at)} · ${mmss(w.active_secs)}${w.steps ? ` · ${Number(w.steps).toLocaleString()}걸음` : ""}</div></div><div style="text-align:right">${fTag(w.status)}${w.xp ? `<div class="small num" style="margin-top:4px;color:var(--court-deep);font-weight:700">+${w.xp} XP</div>` : ""}</div></div>`).join("")}</div>`
      : '<div class="card small muted">아직 자유운동 기록이 없어요. 위에서 운동을 골라 시작해 보세요.</div>'}
    <p class="small muted" style="margin:0">위치, 이동 경로, 심박수 같은 정보는 받지 않아요. 운동 종류, 시간, 걸음 수만 저장해요.</p></div>`;
}
async function fwStart(kind) {
  try {
    const r = await call("student_free_start", { p_kind: kind });
    if (r.error) return toast(errText(r.error));
    S.fwDone = null; store.set(FW_KEY, null); S.fw = null;
    await loadFree(); render(); window.scrollTo(0, 0);
    fwSense();
  } catch (e) { toast(errText(e.code)); }
}
let fwEnding = false;
async function fwEnd() {
  const f = S.fw; if (!f || fwEnding) return; fwEnding = true;
  fwStopSense();
  if (f.hiddenAt) { f.off += (Date.now() - f.hiddenAt) / 1000; f.hiddenAt = 0; }
  const before = levelOf(S.home.me.xp).lv;
  try {
    const r = await call("student_free_finish", { p_id: f.id, p_steps: FKIND[f.kind].steps ? f.steps : f.moves, p_minutes: f.minutes, p_off: Math.round(f.off) });
    if (r.error && r.error !== "already") toast(errText(r.error));
    else if (!r.error) {
      S.fwDone = { ...r, kind: f.kind };
      if (r.xp) { say("운동 완료"); if (levelOf(r.total_xp).lv > before) toast(`레벨 업! 이제 LV ${levelOf(r.total_xp).lv}이에요.`); }
    }
    store.set(FW_KEY, null); S.fw = null;
    await Promise.all([loadFree(), loadHome()]); loadProgress();
  } catch (e) { toast(errText(e.code)); }
  fwEnding = false; render(); window.scrollTo(0, 0);
}
/* 길게 눌러야 끝나요 (주머니 속에서 잘못 눌리지 않게) */
let holdT = 0;
document.addEventListener("pointerdown", e => { const h = e.target.closest("[data-hold]"); if (!h) return; h.classList.add("holding"); clearTimeout(holdT); holdT = setTimeout(() => { h.classList.remove("holding"); if (h.dataset.hold === "fwend") fwEnd(); }, 1200); });
["pointerup", "pointercancel", "pointerleave"].forEach(ev => document.addEventListener(ev, e => { const h = e.target.closest && e.target.closest("[data-hold]"); if (h || ev !== "pointerleave") { clearTimeout(holdT); document.querySelectorAll(".hold.holding").forEach(x => x.classList.remove("holding")); } }, true));

/* ---------- 성장: 꾸준한 운동 · 배지 · 운동 도감 ---------- */
async function loadProgress() {
  try {
    S.prog = await call("student_progress");
    const nb = S.prog.new_badges || [];
    if (nb.length) toast(`새 배지! ${nb.map(b => b.icon + " " + b.name).join(", ")}`);
    if (S.view === "app") render();
  } catch {}
}
function streakCard() {
  const P = S.prog; if (!P) return "";
  const s = P.streak, w = P.week;
  return `<section class="card stack" style="gap:12px">
    <div class="row between"><span class="eyebrow">꾸준한 운동</span><button class="back" data-act="sub" data-v="cal">운동 달력 ›</button></div>
    <div class="row" style="gap:12px;align-items:center"><div class="streakfire">🔥</div><div><b style="font-size:20px">${s.cur ? `${s.cur}회 연속 참여 중` : "다음 운동부터 연속 기록을 시작해요"}</b>
      <div class="small muted">최고 ${s.best}회 · 이번 달 최고 ${s.month_best}회 · 학교 운동이 열린 날만 세요</div></div></div>
    <div class="stat3 light"><div><b class="num">${w.count}</b><span>이번 주 운동</span></div><div><b class="num">${w.minutes}<small>분</small></b><span>이번 주 운동시간</span></div><div><b class="num">+${w.xp}</b><span>이번 주 XP</span></div></div></section>`;
}
function growLinks() {
  const P = S.prog, nb = P ? P.badges.filter(b => b.earned_at).length : 0, ns = P ? P.sports.filter(x => x.times).length : 0;
  const L = [["cal", "📅", "운동 달력", "언제 운동했는지"], ["report", "📊", "월간 리포트", "지난달의 나와 비교"], ["badges", "🏅", "배지", P ? `${nb} / ${P.badges.length}개 모음` : "모은 배지"], ["dex", "🧭", "운동 도감", P ? `${ns} / ${P.sports.length}종목 경험` : "경험한 종목"], ["chal", "🎯", "도전", "목표에 도전하기"], ["free", "🏃", "자유운동", "학교 밖 운동 기록"]];
  return `<div class="glinks">${L.map(l => `<button class="glink" ${l[0] === "free" ? 'data-act="free"' : `data-act="sub" data-v="${l[0]}"`}><span>${l[1]}</span><b>${l[2]}</b><small>${l[3]}</small></button>`).join("")}</div>`;
}
function vBadges() {
  const P = S.prog;
  return `<div class="stack">${subHead("내 기록", "배지")}${!P ? '<div class="card muted">불러오는 중이에요…</div>' : `
    <p class="small muted" style="margin:0">운동 목표를 채우면 배지가 자동으로 생겨요. 아직 못 받은 배지는 조건과 지금 기록을 보여줘요.</p>
    <div class="bgrid">${P.badges.map(b => { const got = !!b.earned_at, pct = Math.min(100, Math.round(b.value / b.goal * 100));
      return `<div class="badge ${got ? "got" : ""}"><div class="bico">${got ? b.icon : "🔒"}</div><b>${esc(b.name)}</b>
        ${got ? `<small>${fmtDay(b.earned_at)} 받음</small>` : `<small class="num">${Number(Math.min(b.value, b.goal)).toLocaleString()} / ${Number(b.goal).toLocaleString()}</small><div class="pbar"><i style="width:${pct}%"></i></div>`}</div>`; }).join("")}</div>`}</div>`;
}
function vDex() {
  const P = S.prog;
  if (!P) return `<div class="stack">${subHead("내 기록", "운동 도감")}<div class="card muted">불러오는 중이에요…</div></div>`;
  const n = P.sports.filter(x => x.times).length;
  return `<div class="stack">${subHead("내 기록", "운동 도감")}
    <div class="card row between"><div><span class="eyebrow">경험한 종목</span><div style="font:800 34px/1.1 var(--display);margin-top:6px"><span style="color:var(--court)">${n}</span><small class="muted" style="font-size:18px"> / ${P.sports.length}</small></div></div><span style="font-size:40px">🧭</span></div>
    <div class="dex">${P.sports.map(x => `<div class="dexc ${x.times ? "got" : ""}"><span>${x.times ? x.icon : "❔"}</span><b>${esc(x.name)}</b><small>${x.times ? `${x.times}번 · 처음 ${fmtDay(x.first)}` : "아직 안 해 봤어요"}</small></div>`).join("")}</div>
    <p class="small muted" style="margin:0">학교 운동에서 선생님이 정한 종목, 미션, 자유운동 종류가 모여요. 새로운 운동에 도전해 보세요!</p></div>`;
}

/* ---------- 운동 달력 ---------- */
const SRC = { school: ["학교 운동", "var(--court)"], mission: ["미션", "var(--gold)"], free: ["자유운동", "var(--data)"] };
const itemName = it => it.src === "school" ? it.label + (it.sport ? ` · ${it.sport}` : "") : it.src === "mission" ? `미션 · ${MKIND[it.label]?.name || ""}` : `자유운동 · ${FKIND[it.label]?.name || ""}`;
const ym = d => d.slice(0, 7), addMonth = (m, n) => { const [y, mo] = m.split("-").map(Number), t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; };
async function loadCal(m) { S.calM = m; S.cal = null; render(); S.cal = await call("student_calendar", { p_month: m + "-01" }); if (!S.calM) S.calM = ym(S.cal.month); if (!S.calDay || ym(S.calDay) !== S.calM) S.calDay = ym(S.cal.today) === S.calM ? S.cal.today : null; render(); }
function vCal() {
  const C = S.cal, m = S.calM;
  if (!C) return `<div class="stack">${subHead("내 기록", "운동 달력")}<div class="card muted">불러오는 중이에요…</div></div>`;
  const [y, mo] = m.split("-").map(Number), first = new Date(y, mo - 1, 1).getDay(), days = new Date(y, mo, 0).getDate();
  const by = {}; C.items.forEach(it => (by[it.day] ||= []).push(it));
  const cells = [];
  for (let i = 0; i < first; i++) cells.push("<div></div>");
  for (let d = 1; d <= days; d++) {
    const key = `${m}-${String(d).padStart(2, "0")}`, its = by[key] || [], srcs = [...new Set(its.map(x => x.src))];
    cells.push(`<button class="cday ${its.length ? "has" : ""} ${key === C.today ? "today" : ""} ${key === S.calDay ? "sel" : ""}" data-act="calday" data-v="${key}"><span class="num">${d}</span><i>${srcs.map(s => `<em style="background:${SRC[s][1]}"></em>`).join("")}</i></button>`);
  }
  const sel = S.calDay ? by[S.calDay] || [] : [];
  const monthCount = C.items.length, monthDays = Object.keys(by).length, monthMin = Math.floor(C.items.reduce((a, x) => a + x.secs, 0) / 60);
  return `<div class="stack">${subHead("내 기록", "운동 달력")}
    <section class="card stack" style="gap:12px">
      <div class="row between"><button class="calnav" data-act="calm" data-v="${addMonth(m, -1)}" aria-label="지난달">‹</button><b style="font-size:18px">${y}년 ${mo}월</b><button class="calnav" data-act="calm" data-v="${addMonth(m, 1)}" aria-label="다음 달" ${m >= ym(C.today) ? "disabled" : ""}>›</button></div>
      <div class="cal">${["일", "월", "화", "수", "목", "금", "토"].map(w => `<div class="cw">${w}</div>`).join("")}${cells.join("")}</div>
      <div class="row small muted" style="gap:14px;flex-wrap:wrap">${Object.values(SRC).map(s => `<span class="row" style="gap:6px"><em class="dot" style="background:${s[1]}"></em>${s[0]}</span>`).join("")}</div></section>
    <div class="stat3 light"><div><b class="num">${monthDays}</b><span>운동한 날</span></div><div><b class="num">${monthCount}</b><span>운동 횟수</span></div><div><b class="num">${monthMin}<small>분</small></b><span>운동시간</span></div></div>
    ${S.calDay ? `<h3 style="font-size:17px">${fmtDay(S.calDay)}</h3>${sel.length ? `<div class="stack" style="gap:8px">${sel.map(it => `<div class="card fwrow"><em class="dot" style="background:${SRC[it.src][1]};width:10px;height:10px"></em><div style="flex:1"><b>${esc(itemName(it))}</b><div class="small muted">${fmtTime(it.at)} · ${mmss(it.secs)}${it.steps ? ` · ${Number(it.steps).toLocaleString()}걸음` : ""}</div></div></div>`).join("")}</div>` : '<div class="card small muted">이날은 운동 기록이 없어요.</div>'}` : ""}
  </div>`;
}

/* ---------- 월간 리포트 ---------- */
async function loadRep(m) { S.repM = m; S.rep = null; render(); S.rep = await call("student_report", { p_month: m ? m + "-01" : null }); if (!S.repM) S.repM = ym(S.rep.this.month); render(); }
function vReport() {
  const R = S.rep;
  if (!R) return `<div class="stack">${subHead("내 기록", "월간 리포트")}<div class="card muted">불러오는 중이에요…</div></div>`;
  const t = R.this, p = R.prev, [y, mo] = S.repM.split("-").map(Number), now = todayStr().slice(0, 7);
  const row = (k, label, unit, icon) => { const d = t[k] - p[k];
    return `<div class="rcard"><span class="rico">${icon}</span><div style="flex:1"><span class="small muted">${label}</span><div><b class="num" style="font-size:24px">${Number(t[k]).toLocaleString()}</b><small class="muted"> ${unit}</small></div></div>
      <div class="small" style="text-align:right;color:${d > 0 ? "var(--good)" : "var(--muted)"}">${d > 0 ? `▲ ${Number(d).toLocaleString()}` : d < 0 ? `지난달 ${Number(p[k]).toLocaleString()}` : "지난달과 같아요"}</div></div>`; };
  const better = ["days", "minutes", "school", "mission", "free", "steps", "xp"].filter(k => t[k] > p[k]).length;
  return `<div class="stack">${subHead("내 기록", "월간 리포트")}
    <div class="row between"><button class="calnav" data-act="repm" data-v="${addMonth(S.repM, -1)}" aria-label="지난달">‹</button><b style="font-size:18px">${y}년 ${mo}월</b><button class="calnav" data-act="repm" data-v="${addMonth(S.repM, 1)}" aria-label="다음 달" ${S.repM >= now ? "disabled" : ""}>›</button></div>
    <section class="card rhero"><span class="eyebrow">이번 달의 나</span><b>${t.days ? `${t.days}일 동안 ${t.minutes}분 운동했어요` : "이번 달 첫 운동을 기다리고 있어요"}</b>
      <p class="small muted" style="margin:6px 0 0">${better ? `지난달보다 ${better}가지 기록이 늘었어요!` : t.days ? "지난달의 나와 비교해 보세요." : "운동하면 여기에 이번 달 기록이 모여요."}</p></section>
    <div class="stack" style="gap:8px">${row("days", "운동한 날", "일", "📅")}${row("minutes", "총 운동시간", "분", "⏱️")}${row("school", "학교 운동인증", "회", "🏫")}${row("mission", "미션", "회", "🌅")}${row("free", "자유운동", "회", "🏃")}${row("steps", "걸음 수 (추정)", "걸음", "👟")}${row("xp", "획득 경험치", "XP", "⭐")}</div>
    <p class="small muted" style="margin:0">친구와 비교하지 않고, 지난달의 나와 비교해요. 최고 연속 참여 ${R.streak.best}회.</p></div>`;
}

/* ---------- 도전 · 우리 반 공동목표 ---------- */
const CSCOPE = { day: "오늘의 도전", week: "주간 도전", period: "기간 도전", class: "우리 반 공동목표" };
const CMET = { count: ["운동 참여", "회"], minutes: ["운동시간", "분"], days: ["운동한 날", "일"], steps: ["걸음 수", "걸음"], free: ["자유운동", "회"], school: ["학교 운동인증", "회"] };
const CERR = { not_enough: "아직 목표를 다 채우지 못했어요.", already: "이미 보상을 받았어요.", closed: "보상을 받을 수 있는 기간이 끝났어요.", not_open: "아직 시작하지 않은 도전이에요.", not_found: "도전을 찾지 못했어요." };
async function loadChal() { try { S.chal = await call("student_challenges"); if (S.view === "app") render(); } catch {} }
const todayStr = () => new Date(serverNow() + 9 * 3600e3).toISOString().slice(0, 10);
function cCard(c) {
  const t = todayStr(), m = CMET[c.metric], pct = Math.min(100, Math.round(c.progress / c.goal * 100)), full = c.progress >= c.goal;
  const ended = c.ends_on < t, soon = c.starts_on > t, canClaim = full && !c.done && !soon && t <= addDays(c.ends_on, 3);
  return `<div class="card stack chal ${c.scope === "class" ? "cls" : ""}" style="gap:10px">
    <div class="row between" style="gap:8px"><span class="chip">${CSCOPE[c.scope]}</span><span class="small muted num">${c.starts_on === c.ends_on ? fmtDay(c.starts_on) : `${fmtDay(c.starts_on)} ~ ${fmtDay(c.ends_on)}`}</span></div>
    <b style="font-size:17px">${esc(c.title)}</b>
    <div class="small muted">${c.scope === "class" ? "우리 반 모두의 " : ""}${m[0]} ${Number(c.goal).toLocaleString()}${m[1]} · 보상 +${c.xp} XP</div>
    ${soon ? '<div class="msg info small">곧 시작해요.</div>' : `<div><div class="row between small"><span class="num"><b>${Number(Math.min(c.progress, c.goal)).toLocaleString()}</b> / ${Number(c.goal).toLocaleString()}${m[1]}</span><span class="num muted">${pct}%</span></div><div class="pbar big"><i style="width:${pct}%"></i></div></div>`}
    ${c.done ? `<div class="msg ok small">달성했어요! +${c.done.xp} XP 받음</div>` : canClaim ? `<button class="btn" data-act="cclaim" data-v="${c.id}">🎉 보상 받기 +${c.xp} XP</button>` : ended ? '<div class="small muted">기간이 끝났어요.</div>' : full ? "" : `<div class="small muted">${c.scope === "class" ? "반 친구들과 함께 채워요" : "조금씩 채워 봐요"}. ${Number(c.goal - c.progress).toLocaleString()}${m[1]} 남았어요.</div>`}
    ${c.scope === "class" && c.class_done ? `<div class="small muted">반 친구 ${c.class_done}명이 보상을 받았어요.</div>` : ""}</div>`;
}
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function vChal() {
  const L = S.chal;
  if (!L) return `<div class="stack">${subHead("더보기", "도전")}<div class="card muted">불러오는 중이에요…</div></div>`;
  const t = todayStr(), cls = L.filter(c => c.scope === "class"), mine = L.filter(c => c.scope !== "class");
  const now = x => x.filter(c => c.starts_on <= t && c.ends_on >= t), later = x => x.filter(c => c.starts_on > t), past = x => x.filter(c => c.ends_on < t);
  const sec = (title, arr) => arr.length ? `<span class="eyebrow" style="margin-top:6px">${title}</span>${arr.map(cCard).join("")}` : "";
  return `<div class="stack">${subHead("더보기", "도전")}
    <p class="small muted" style="margin:0">학교 운동, 미션, 자유운동 기록이 모두 도전에 쌓여요. 목표를 채우면 보상 받기를 눌러요.</p>
    ${S.home.me.grade ? `<h3 style="font-size:17px">👥 우리 반 공동목표</h3>${now(cls).map(cCard).join("") || '<div class="card small muted">지금 진행 중인 우리 반 공동목표가 없어요.</div>'}${sec("곧 시작", later(cls))}` : ""}
    <h3 style="font-size:17px;margin-top:6px">🎯 나의 도전</h3>${now(mine).map(cCard).join("") || '<div class="card small muted">지금 진행 중인 도전이 없어요. 선생님이 도전을 열면 여기에 떠요.</div>'}${sec("곧 시작", later(mine))}
    ${sec("지난 도전", past(L))}</div>`;
}

/* ---------- 자유운동 순위 ---------- */
function freeRankHTML() {
  const r = S.freeRank, h = S.home;
  if (!r) return '<div class="card muted">불러오는 중이에요…</div>';
  return `<div class="msg info small" style="font-weight:500">이번 주(${fmtDay(r.from)}부터) 인정된 자유운동 시간 순위예요. ${r.me ? `나는 ${r.total}명 중 <b>${r.me.rank}위</b>예요.` : "자유운동을 하면 순위에 들어가요."}</div>
    ${r.top.length ? `<div class="stack" style="gap:8px">${r.top.map(p => `<div class="rk ${p.me ? "me" : ""}"><div class="pos num p${p.rank}">${p.rank}</div><div><b>${p.me ? esc(h.me.name) + " (나)" : esc(p.name)}</b><div class="mini"><span>${h.me.grade ? `${h.me.grade}학년 ${p.class}반` : "선생님"}</span>${p.steps ? `<span>${Number(p.steps).toLocaleString()}걸음</span>` : ""}</div></div><div class="sc num">${p.minutes}<small>분</small></div></div>`).join("")}</div>`
      : '<div class="card small muted">이번 주에는 아직 자유운동 기록이 없어요. 첫 번째가 되어 보세요!</div>'}
    <p class="small muted" style="margin:0">선생님 확인 중이거나 인정되지 않은 기록은 넣지 않아요. 날짜별 기록은 나와 선생님만 볼 수 있어요.</p>`;
}

/* ---------- 탭과 그리기 ---------- */
function tabsBar() {
  const act = !!activeOf(), n = openMissions().length;
  const t = [["home", "홈", IC.home], ["check", "운동인증", IC.check], ["my", "내 기록", IC.my], ["rank", "순위", IC.rank], ["more", "더보기", IC.more]];
  return `<div class="tabs"><nav>${t.map(x => `<button data-act="tab" data-v="${x[0]}" class="${S.tab === x[0] ? "on" : ""}" aria-label="${x[1]}"><span class="check-dot ${x[0] === "check" && act ? "live" : ""}">${x[2]}${x[0] === "more" && n ? `<i class="tbadge num">${n}</i>` : ""}</span>${x[1]}</button>`).join("")}</nav></div>`;
}
function render() {
  if (!(S.view === "app" && S.sub === "mrun")) { if (runner) { runner.stop(); runner = null; } if (walker) { walker.stop(); walker = null; } }
  let html;
  if (S.view === "splash") html = vSplash();
  else if (S.view === "login") html = vLogin();
  else if (!S.home) html = `<div class="phone"><div class="card muted" style="margin-top:40px">불러오는 중이에요…</div></div>`;
  else {
    const v = S.tab === "home" ? (S.sub === "guide" ? vGuide() : vHome()) : S.tab === "check" ? (S.checkMode === "free" ? vFree() : vCheck().replace(topline(), topline() + checkSeg())) : S.tab === "my" ? vMy() : S.tab === "rank" ? vRank() : S.sub ? vSub() : vMore();
    const gb = S.fromGuide && !(S.tab === "home" && S.sub === "guide") ? `<button class="gback" data-act="guide">${IC.back} 주요 기능으로 돌아가기</button>` : "";
    html = `<div class="phone ${S.tab === "rank" && S.rankMode === "class" && S.home?.me?.grade ? "wide" : ""}">${gb && v.includes(topline()) ? v.replace(topline(), topline() + gb) : gb + v}</div>${tabsBar()}`;
  }
  $app.innerHTML = html;
  if (S.view === "splash") { const sp = document.getElementById("splash"); sp.addEventListener("click", go); sp.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") go(); }); clearTimeout(window.__spT); window.__spT = setTimeout(go, 1800); }
}
function go() { if (S.view !== "splash") return; S.view = S.token ? "app" : "login"; render(); if (S.token) enterApp(); }
async function enterApp() {
  S.view = "app"; render();
  try { await loadHome(); render(); if (S.home.me.grade) loadRace(S.home.me.grade).then(render).catch(() => {}); loadFree().then(render).catch(() => {}); loadProgress(); loadChal(); }
  catch (e) { if (e.code !== "session_expired") { S.home = null; $app.innerHTML = `<div class="phone"><div class="msg bad" style="margin-top:40px">${esc(errText(e.code))}</div><button class="btn" style="margin-top:12px" onclick="location.reload()">다시 시도</button></div>`; } return; }
  if (pendingScan) { const p = pendingScan; pendingScan = null; history.replaceState(null, "", location.pathname); doScan(p); }
}

/* 1초마다 남은 시간만 고쳐요 */
setInterval(() => {
  if (S.view !== "app" || !S.home) return;
  if (S.fw) { const el = clock(fwElapsed()); const T = document.querySelector('[data-live="fwtime"]'); if (T) T.textContent = el; const H2 = document.querySelector('[data-live="homeFw"]'); if (H2) H2.firstChild.textContent = el; }
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
  if (act === "tab" || act === "sub" || act === "guide" || act === "free") S.fromGuide = !!b.closest(".glist");
  if (S.fromGuide) S.gScroll = window.scrollY;
  switch (act) {
    case "login-tab": S.loginTab = v; S.msg = null; render(); break;
    case "tab":
      if (v === "check" && (!S.checkMode || b.closest(".glist"))) S.checkMode = S.fw && !b.closest(".glist") ? "free" : "school";
      stopScan(); S.tab = v; S.sub = null; S.msg = v === "check" ? S.msg : null; if (v !== "check") S.done = null; render(); window.scrollTo(0, 0);
      if (v === "rank") { if (S.home.me.grade) loadRace(S.raceGrade).then(render).catch(() => {}); if (!S.rank) call("student_rank").then(r => { S.rank = r; render(); }).catch(() => {}); }
      if (v === "home" || v === "check") loadHome().then(render).catch(() => {});
      if (v === "check") loadFree().then(render).catch(() => {});
      if (v === "my") loadProgress();
      if (v === "home") loadChal();
      if (v === "rank" && b.dataset.rank) { S.rankMode = b.dataset.rank; loadFreeRank(); }
      break;
    case "free": stopScan(); S.tab = "check"; S.sub = null; S.checkMode = "free"; render(); window.scrollTo(0, 0); loadFree().then(render).catch(() => {}); break;
    case "cmode": S.checkMode = v; stopScan(); S.msg = null; render(); if (v === "free") loadFree().then(render).catch(() => {}); break;
    case "fwstart": fwStart(v); break;
    case "fwsense": fwSense(); break;
    case "fwcancel": if (!S.fw || !confirm("이번 운동을 기록하지 않고 취소할까요?")) break;
      fwStopSense(); try { await call("student_free_cancel", { p_id: S.fw.id }); } catch {} store.set(FW_KEY, null); S.fw = null; await loadFree().catch(() => {}); render(); break;
    case "fwnew": S.fwDone = null; render(); window.scrollTo(0, 0); break;
    case "calday": S.calDay = v; render(); break;
    case "calm": loadCal(v).catch(() => {}); break;
    case "repm": loadRep(v).catch(() => {}); break;
    case "cclaim": {
      b.disabled = true;
      try {
        const r = await call("student_challenge_claim", { p_id: v });
        if (r.error) toast(CERR[r.error] || errText(r.error)); else { say("도전 성공"); toast(`도전 달성! +${r.xp} XP`); }
        await Promise.all([loadChal(), loadHome()]); loadProgress();
      } catch (e) { toast(errText(e.code)); }
      render(); break;
    }
    case "guide": stopScan(); S.tab = "home"; S.sub = "guide"; render(); window.scrollTo(0, b.classList.contains("gback") ? S.gScroll || 0 : 0); break;
    case "pick": S.pick = v; S.tab = "check"; S.msg = null; S.done = null; render(); window.scrollTo(0, 0); break;
    case "pickstay": S.pick = v; S.msg = null; S.done = null; stopScan(); render(); break;
    case "scanstart": startScan(); break;
    case "scanstop": stopScan(); render(); break;
    case "rank": S.rankMode = v; render(); if (v === "person") call("student_rank").then(r => { S.rank = r; render(); }).catch(() => {}); if (v === "free") loadFreeRank(); break;
    case "rgrade": S.raceGrade = +v; render(); loadRace(+v).then(render).catch(() => {}); break;
    case "sub":
      S.tab = "more"; S.sub = v || null; render(); window.scrollTo(0, 0);
      if (v === "history") call("student_history").then(h => { S.hist = h; render(); }).catch(() => {});
      if (v === "mission") loadHome().then(render).catch(() => {});
      if (v === "pops") call("student_paps").then(r => { S.paps = r; render(); }).catch(() => {});
      if (v === "cal") loadCal(S.calM || todayStr().slice(0, 7)).catch(() => {});
      if (v === "report") loadRep(S.repM || null).catch(() => {});
      if (v === "badges" || v === "dex") loadProgress();
      if (v === "chal") loadChal();
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

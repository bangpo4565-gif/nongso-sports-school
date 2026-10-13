// 미션 실행: 자세 인식 카운터와 걸음 센서
const ang=(a,b,c)=>{const r=Math.atan2(c.y-b.y,c.x-b.x)-Math.atan2(a.y-b.y,a.x-b.x);const d=Math.abs(r*180/Math.PI);return d>180?360-d:d;};
const clamp01=x=>Math.max(0,Math.min(1,x));
const LS={sh:11,el:13,wr:15,hip:23,kn:25,an:27}, RS={sh:12,el:14,wr:16,hip:24,kn:26,an:28}, VIS=.5;
function makeCounter(kind){
  const c={kind,reps:0,secs:0,phase:"up",depth:0,cue:"준비 자세를 잡아 주세요",good:true,last:0,top:0,hintUntil:0,minSeen:1};
  const hint=(t,msg)=>{c.cue=msg;c.good=false;c.hintUntil=t+1500;};
  c.step=(lm,t,aspect=1)=>{
    const P=i=>({x:lm[i].x*aspect,y:lm[i].y});
    const seen=ids=>ids.every(i=>(lm[i].visibility??1)>VIS);
    const sideOk=Q=>seen([Q.hip,Q.kn,Q.an]);
    const keepHint=t<c.hintUntil;
    if(kind==="squat"||kind==="lunge"){
      const legs=[LS,RS].filter(sideOk);
      if(!legs.length){c.cue="다리까지 다 보이게 카메라에서 조금 멀어져 주세요";c.good=false;return;}
      const per=legs.map(Q=>{const h=P(Q.hip),k=P(Q.kn),a=P(Q.an);return {r:(k.y-h.y)/Math.max(.02,a.y-k.y),knee:ang(h,k,a)};});
      const r=Math.min(...per.map(x=>x.r)),knee=Math.min(...per.map(x=>x.knee));
      const downR=kind==="squat"?.45:.5,upR=.75;
      c.depth=clamp01((1-r)/(1-downR));
      if(c.phase==="up"){c.minSeen=Math.min(c.minSeen,r);
        if(r<downR||knee<105){c.phase="down";c.minSeen=1;}
        else if(r>.9&&c.minSeen<.8){hint(t,kind==="squat"?"조금 더 깊이 앉아요 (허벅지가 바닥과 나란히)":"무릎을 90도까지 굽혀요");c.minSeen=1;}
      } else if(r>upR&&knee>150){c.phase="up";c.reps++;}
      if(keepHint) return;
      c.cue=c.phase==="down"?"좋아요! 이제 일어나요":kind==="squat"?"천천히 앉아요":"한 발 앞으로, 무릎을 굽혀요";c.good=true;
    } else if(kind==="pushup"){
      const arms=[LS,RS].filter(Q=>seen([Q.sh,Q.wr]));
      if(!arms.length){c.cue="어깨와 손이 화면에 보이게 해 주세요";c.good=false;return;}
      const h=arms.reduce((s,Q)=>s+(P(Q.wr).y-P(Q.sh).y),0)/arms.length;
      const els=arms.filter(Q=>seen([Q.el])).map(Q=>ang(P(Q.sh),P(Q.el),P(Q.wr)));
      const elbow=els.length?Math.min(...els):180;
      if(c.phase==="up") c.top=Math.max(c.top*.997,h);
      const ratio=c.top>.02?h/c.top:1;
      c.depth=clamp01((1-ratio)/.4);
      const side=!seen([11,12])||Math.abs(P(11).x-P(12).x)<.08;
      if(c.phase==="up"&&c.top>.05&&(ratio<.6||side&&elbow<95)) c.phase="down";
      else if(c.phase==="down"&&ratio>.85&&(!side||elbow>140)){c.phase="up";c.reps++;}
      if(keepHint) return;
      const Q=arms[0];
      const lineOk=!seen([Q.hip,Q.an])||Math.abs(P(Q.sh).x-P(Q.an).x)<.3||ang(P(Q.sh),P(Q.hip),P(Q.an))>150;
      c.cue=!lineOk?"허리가 처지거나 솟았어요. 몸을 일자로!":c.phase==="down"?"좋아요! 밀어 올려요":"가슴을 바닥 가까이 내려요"; c.good=lineOk;
    } else if(kind==="jack"){
      if(!seen([11,12,15,16])){c.cue="팔이 다 보이게 카메라에서 조금 멀어져 주세요";c.good=false;return;}
      const torso=seen([23,24])?Math.abs((P(23).y+P(24).y)/2-(P(11).y+P(12).y)/2):.25;
      const up=P(15).y<P(11).y&&P(16).y<P(12).y, down=P(15).y>P(11).y+torso*.4&&P(16).y>P(12).y+torso*.4;
      if(c.phase==="up"&&up) c.phase="down"; else if(c.phase==="down"&&down){c.phase="up";c.reps++;}
      c.cue="리듬 좋아요! 팔을 머리 위까지!";c.good=true;
    } else if(kind==="plank"){
      const Q=[LS,RS].filter(X=>seen([X.sh,X.hip,X.an])).sort((a,b)=>lm[b.hip].visibility-lm[a.hip].visibility)[0];
      if(!Q){c.cue="옆으로 엎드려 머리부터 발끝까지 보이게 해 주세요";c.good=false;c.last=0;return;}
      const sh=P(Q.sh),hip=P(Q.hip),an=P(Q.an),line=ang(sh,hip,an);
      const flat=Math.abs(sh.y-an.y)<.6*Math.abs(sh.x-an.x), ok=flat&&line>150;
      if(ok&&c.last) c.secs+=Math.min(.5,(t-c.last)/1000);
      c.last=t; c.reps=Math.floor(c.secs);
      c.cue=!flat?"엎드려서 팔꿈치로 버텨요. 카메라는 옆에서 찍어요":line<=150?(hip.y<(sh.y+an.y)/2?"엉덩이를 조금 내려요":"엉덩이가 처졌어요. 배에 힘!"):"완벽해요! 그대로 버텨요";
      c.good=ok;
    }
  };
  return c;
}

/* ---------- 자세 인식 실행 (MediaPipe Pose, 기기 안에서만 돌아가요) ---------- */
let LM = null, LOADING = null;
async function loadPose(onStatus) {
  if (LM) return LM; if (LOADING) return LOADING;
  onStatus && onStatus("AI 모델을 불러오는 중이에요. 처음 한 번은 10초쯤 걸려요.");
  LOADING = (async () => {
    const base = new URL("./", location.href).href;
    const { PoseLandmarker } = await import(base + "vendor/mediapipe/vision_bundle.mjs");
    const fileset = { wasmLoaderPath: base + "vendor/mediapipe/vision_wasm_internal.js", wasmBinaryPath: base + "models/vision_wasm_internal.wasm" };
    const b64 = await (await fetch(base + "models/pose_landmarker_lite.b64.txt")).text();
    const bin = atob(b64.trim()), model = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) model[i] = bin.charCodeAt(i);
    const o = d => ({ baseOptions: { modelAssetBuffer: model, delegate: d }, runningMode: "VIDEO", numPoses: 1 });
    try { LM = await PoseLandmarker.createFromOptions(fileset, o("GPU")); } catch { LM = await PoseLandmarker.createFromOptions(fileset, o("CPU")); }
    return LM;
  })();
  try { return await LOADING; } catch (e) { LOADING = null; throw e; }
}
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
function drawPose(lm, ctx, w, h, good) {
  ctx.clearRect(0, 0, w, h); if (!lm) return;
  ctx.lineWidth = Math.max(3, w / 120); ctx.strokeStyle = good ? "#4ade80" : "#ff7a2f"; ctx.lineCap = "round";
  for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); }
  ctx.fillStyle = "#fff"; for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { ctx.beginPath(); ctx.arc(lm[i].x * w, lm[i].y * h, ctx.lineWidth, 0, 7); ctx.fill(); }
}
const KO = ["", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
export function say(n) { if (!window.speechSynthesis) return; try { const u = new SpeechSynthesisUtterance(typeof n === "string" ? n : n <= 10 ? KO[n] : String(n)); u.lang = "ko-KR"; u.rate = 1.2; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {} }

// kind: squat|pushup|lunge|jack|plank, els: {video, canvas, cue, ph}, onReps(total), onStatus(text, kind)
export function createPoseRunner(kind, els, onReps, onStatus) {
  let raf = 0, stream = null, counter = null, alive = true;
  async function begin(mirror) {
    const video = els.video;
    try { await loadPose(onStatus); } catch (e) { onStatus("AI 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.", "bad"); console.error(e); return; }
    if (!alive) return;
    onStatus(MKIND_TIP[kind]);
    counter = makeCounter(kind);
    const cv = els.canvas, ctx = cv.getContext("2d");
    video.classList.toggle("mirror", mirror); cv.classList.toggle("mirror", mirror);
    els.ph.hidden = true; els.cue.hidden = false;
    let shown = 0, lastT = -1;
    const loop = () => {
      if (!counter || !alive) return;
      if (video.readyState >= 2 && video.currentTime !== lastT) {
        lastT = video.currentTime; cv.width = video.videoWidth; cv.height = video.videoHeight;
        const t = performance.now(), res = LM.detectForVideo(video, t), lm = res.landmarks && res.landmarks[0];
        if (lm) counter.step(lm, t, video.videoWidth / video.videoHeight); else { counter.cue = "몸이 화면에 다 보이게 해 주세요"; counter.good = false; counter.last = 0; }
        drawPose(lm, ctx, cv.width, cv.height, counter.good);
        els.cue.textContent = counter.cue; els.cue.className = "cue " + (counter.good ? "good" : "fix");
        if (counter.reps !== shown) { shown = counter.reps; if (kind !== "plank" || shown % 10 === 0) say(shown); onReps(shown); }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  }
  return {
    async camera() {
      this.stop(true);
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false }); }
      catch { onStatus("카메라를 쓸 수 없어요. 카메라 권한을 허용했는지 확인하거나, '영상으로 하기'로 찍어 둔 영상을 골라 주세요.", "bad"); return; }
      els.video.srcObject = stream; await els.video.play().catch(() => {}); begin(true);
    },
    async file(f) { this.stop(true); els.video.srcObject = null; els.video.src = URL.createObjectURL(f); await els.video.play().catch(() => {}); begin(false); },
    stop(keep) { cancelAnimationFrame(raf); counter = null; if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } try { els.video.pause(); } catch {} if (!keep) alive = false; }
  };
}
const MKIND_TIP = { squat: "정면이나 옆으로 서서 머리부터 발끝까지 보이게 서 주세요.", pushup: "카메라 옆으로 엎드려 몸 전체가 보이게 해 주세요.", lunge: "정면이나 옆으로 서서 발끝까지 보이게 서 주세요.", jack: "정면으로 서서 팔이 다 보이게 서 주세요.", plank: "카메라 옆으로 엎드려 머리부터 발까지 보이게 해 주세요." };

/* ---------- 걸음 센서: 가속도 크기에서 걸음 리듬의 봉우리를 세요 ---------- */
// onStep(n) 걸음마다, onStatus(text, kind)
export function createWalker(onStep, onStatus) {
  const W = { on: false, got: false, ema: 9.8, f: null, above: false, last: 0, recent: [], wake: null, start: 0, elapsed: 0, shakeT: 0 };
  function onMotion(e) {
    const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
    W.got = true;
    const mag = Math.hypot(a.x, a.y, a.z), t = performance.now();
    W.f = W.f == null ? mag : W.f * 0.6 + mag * 0.4;
    W.ema += (W.f - W.ema) * 0.04;
    const d = W.f - W.ema;
    if (!W.above && d > 1.2) {
      W.above = true;
      if (t - W.last > 280) {
        W.recent = W.recent.filter(x => t - x < 3000);
        if (W.recent.length < 11) { W.last = t; W.recent.push(t); onStep(1); }
        else if (t - W.shakeT > 2500) { W.shakeT = t; onStatus("너무 빨라요. 흔든 건 걸음으로 세지 않아요.", "bad"); setTimeout(() => { if (W.on) onStatus("걸음을 세는 중이에요. 화면을 켜 둔 채로 걸어요.", "ok"); }, 2500); }
      }
    } else if (W.above && d < 0.3) W.above = false;
  }
  function onHide() { if (document.hidden && W.on) api.stop("화면이 꺼져서 멈췄어요. 이어서 걷기를 누르면 다시 세요."); }
  const api = {
    get on() { return W.on; },
    secs() { return Math.round(W.elapsed + (W.on ? (performance.now() - W.start) / 1000 : 0)); },
    async start() {
      if (W.on) return true;
      if (typeof DeviceMotionEvent === "undefined") { onStatus("이 기기에서는 움직임 센서를 쓸 수 없어요. 휴대폰으로 열어 주세요.", "bad"); return false; }
      if (typeof DeviceMotionEvent.requestPermission === "function") {
        try { const r = await DeviceMotionEvent.requestPermission(); if (r !== "granted") { onStatus("동작 센서 사용을 허용해야 걸음을 셀 수 있어요.", "bad"); return false; } }
        catch { onStatus("동작 센서 권한을 받지 못했어요. 설정에서 동작 및 방향 접근을 켜 주세요.", "bad"); return false; }
      }
      W.on = true; W.got = false; W.f = null; W.above = false; W.recent = []; W.start = performance.now();
      window.addEventListener("devicemotion", onMotion); document.addEventListener("visibilitychange", onHide);
      try { if (navigator.wakeLock) W.wake = await navigator.wakeLock.request("screen"); } catch {}
      onStatus("걸음을 세는 중이에요. 화면을 켜 둔 채로 걸어요.", "ok");
      setTimeout(() => { if (W.on && !W.got) onStatus("센서 신호가 들어오지 않아요. 휴대폰 브라우저(크롬·사파리)에서 열었는지 확인해 주세요.", "bad"); }, 3000);
      return true;
    },
    stop(msg) {
      if (!W.on) return;
      window.removeEventListener("devicemotion", onMotion); document.removeEventListener("visibilitychange", onHide);
      W.elapsed += (performance.now() - W.start) / 1000; W.on = false;
      try { W.wake && W.wake.release(); } catch {} W.wake = null;
      if (msg) onStatus(msg, "info");
    }
  };
  return api;
}

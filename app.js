
(() => {
"use strict";

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const API = String(window.COVA_API_BASE || window.location.origin).replace(/\/$/, "");
const PROFILE = {name:"Divine Gabriel", id:"COVA-8291"};

let requests = [
 {id:1,name:"David Okafor",amount:15000,note:"November contribution",ref:"COVA-REQ-2841",status:"pending",time:"Received 12 minutes ago"},
 {id:2,name:"Ada Nwosu",amount:12500,note:"Shared expenses",ref:"COVA-REQ-1938",status:"pending",time:"Received yesterday"}
];

let filter="all";
let selectedRequest=null;
let selectedBank=null;
let stream=null;
let frame=null;
let detector=null;
let busy=false;
let lastScan=0;

const video=$("#cameraVideo");
const canvas=$("#scanCanvas");
const ctx=canvas.getContext("2d",{willReadFrequently:true});

function esc(v){
 return String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
 }[c]));
}

function money(v){
 return new Intl.NumberFormat("en-NG",{
  style:"currency",
  currency:"NGN",
  maximumFractionDigits:2
 }).format(Number(v)||0);
}

function initials(v){
 return String(v||"?").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
}

function toast(msg){
 const el=$("#toast");
 el.textContent=msg;
 el.classList.add("show");
 clearTimeout(toast.timer);
 toast.timer=setTimeout(()=>el.classList.remove("show"),3000);
}

function scanMessage(msg,type="info"){
 const el=$("#scanResult");
 el.textContent=msg;
 el.className=`scan-result ${type}`;
 el.classList.remove("hidden");
}

function showView(view){
 const target=$(`#view-${view}`);
 if(!target)return;

 if(view!=="scan")stopCamera();

 $$(".view").forEach(x=>x.classList.toggle("active",x===target));
 $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.view===view));

 $("#pageName").textContent=({
  home:"Overview",
  requests:"Expected payments",
  scan:"Scan & pay",
  myqr:"My Cova QR",
  activity:"Activity",
  settings:"Settings"
 })[view]||"Overview";

 if(view==="home")renderHome();
 if(view==="requests")renderRequests();

 window.scrollTo({top:0,behavior:"smooth"});
}

function close(id){$(id).classList.add("hidden");}
function open(id){$(id).classList.remove("hidden");}

function card(r){
 return `<article class="request-item">
 <div class="request-avatar">${esc(initials(r.name))}</div>
 <div class="request-info">
  <strong>${esc(r.name)}</strong>
  <small>${esc(r.note||"Payment request")} · ${esc(r.ref)}</small>
 </div>
 <div class="request-amount">
  <strong>${money(r.amount)}</strong>
  <small>${esc(r.time)}</small>
 </div>
 <span class="status-tag ${r.status==="paid"?"paid":""}">
  ${r.status==="paid"?"Paid":"Awaiting"}
 </span>
 <button class="pay-btn" data-pay="${esc(r.id)}" ${r.status==="paid"?"disabled":""}>
  ${r.status==="paid"?"Completed":"Review & pay"}
 </button>
 </article>`;
}

function bindPay(){
 $$("[data-pay]").forEach(b=>b.addEventListener("click",()=>openRequest(b.dataset.pay)));
}

function renderHome(){
 const pending=requests.filter(x=>x.status==="pending");

 $("#homeRequests").innerHTML=pending.slice(0,2).map(card).join("")||
 '<div class="empty-state"><div>✓</div><h3>You are all caught up</h3><p>No payment requests are waiting for you.</p></div>';

 $("#pendingTotal").textContent=money(pending.reduce((s,x)=>s+Number(x.amount),0));
 $("#pendingCount").textContent=`${pending.length} request${pending.length===1?"":"s"}`;
 $("#navRequestCount").textContent=pending.length;
 $("#navRequestCount").style.display=pending.length?"":"none";

 bindPay();
}

function renderRequests(){
 const q=($("#requestSearch").value||"").toLowerCase().trim();

 const rows=requests.filter(x=>
  (filter==="all"||x.status===filter)&&
  `${x.name} ${x.note} ${x.ref}`.toLowerCase().includes(q)
 );

 $("#allRequests").innerHTML=rows.map(card).join("");
 $("#emptyRequests").classList.toggle("hidden",rows.length>0);

 $("#allCount").textContent=requests.length;
 $("#waitingCount").textContent=requests.filter(x=>x.status==="pending").length;

 bindPay();
}

function openRequest(id){
 selectedRequest=requests.find(x=>String(x.id)===String(id));
 if(!selectedRequest||selectedRequest.status!=="pending")return;

 selectedBank=null;
 $("#bankTransferDetails").classList.add("hidden");

 $("#payAvatar").textContent=initials(selectedRequest.name);
 $("#payName").textContent=selectedRequest.name;
 $("#payRef").textContent=selectedRequest.ref;
 $("#payAmount").textContent=money(selectedRequest.amount);
 $("#payNote").textContent=selectedRequest.note||"Payment request";

 $(".warning-box").textContent="Demo payment only. No money moves until Cova is connected to a licensed transfer partner.";
 $("#confirmPay").textContent="Record demo payment";

 open("#payModal");
}

function parseBankQr(raw){
 let d=null;
 const s=String(raw||"").trim();

 try{
  if(s.startsWith("COVA-BANK:")){
   d=JSON.parse(s.slice(10));
  }else if(s.startsWith("{")){
   const j=JSON.parse(s);
   if(["cova_bank_transfer","bank_transfer"].includes(j.type))d=j;
  }else{
   const u=new URL(s);
   if(u.protocol==="cova:"&&u.hostname==="bank-transfer"){
    d=Object.fromEntries(u.searchParams.entries());
   }
  }
 }catch(_){
  return null;
 }

 if(!d)return null;

 const account=String(d.account_number||d.accountNumber||"").replace(/\D/g,"");
 const code=String(d.bank_code||d.bankCode||"").trim();
 const bank=String(d.bank_name||d.bankName||"").trim();
 const name=String(d.account_name||d.accountName||"").trim();

 const amount=d.amount===undefined||d.amount===null||d.amount===""
  ?null:Number(d.amount);

 if(!/^\d{10}$/.test(account)||!code||!bank||!name||
   (amount!==null&&(!Number.isFinite(amount)||amount<=0)))return null;

 return {
  accountNumber:account,
  bankCode:code,
  bankName:bank,
  accountName:name,
  amount,
  reference:String(d.reference||"Cova QR bank transfer")
 };
}

function openBankReview(d){
 selectedBank=d;
 selectedRequest=null;

 $("#payAvatar").textContent=initials(d.accountName);
 $("#payName").textContent=d.accountName;
 $("#payRef").textContent="Bank recipient · confirm details";
 $("#payAmount").textContent=d.amount?money(d.amount):"Enter amount";
 $("#payNote").textContent=d.reference;

 $("#transferBank").textContent=d.bankName;
 $("#transferAccount").textContent=d.accountNumber;
 $("#transferAccountName").textContent=d.accountName;
 $("#transferAmount").value=d.amount||"";
 $("#transferAmount").readOnly=d.amount!==null;

 $("#bankTransferDetails").classList.remove("hidden");

 $(".warning-box").textContent=
  "QR details are not proof of account ownership. The backend must verify this account with the transfer provider before a real transfer.";

 $("#confirmPay").textContent="Continue to bank transfer";
 open("#payModal");
}

function tokenFromQr(raw){
 const s=String(raw||"").trim();

 try{
  const u=new URL(s);
  const p=u.pathname.split("/").filter(Boolean);
  const i=p.indexOf("pay");
  const j=p.indexOf("resolve");

  if(i>=0&&p[i+1])return p[i+1];
  if(j>=0&&p[j+1])return p[j+1];
 }catch(_){}

 const m=s.match(/^COVA:([A-Za-z0-9_-]{12,})$/i);
 return m?m[1]:null;
}

async function handleQr(raw){
 const bank=parseBankQr(raw);

 if(bank){
  stopCamera();
  scanMessage("Bank-transfer QR recognized. Confirm the recipient details.","success");
  openBankReview(bank);
  return;
 }

 if(String(raw||"").trim().startsWith("COVA-ID:")){
  const id=String(raw).trim().slice(8);
  scanMessage(
   `Cova profile QR recognized (${id}). This identifies a Cova profile; it is not a bank-payment instruction. Ask the person to send a payment request QR to pay them.`,
   "info"
  );
  return;
 }

 const token=tokenFromQr(raw);

 if(!token){
  scanMessage("This QR is not a supported Cova QR. Try a Cova request QR or Cova bank-transfer QR.","error");
  return;
 }

 scanMessage("Cova request found. Verifying it securely…");

 try{
  const res=await fetch(`${API}/api/resolve/${encodeURIComponent(token)}`);
  const data=await res.json();

  if(!res.ok||!data.success||!data.request){
   throw new Error(data.detail||"Could not verify this request.");
  }

  const r=data.request;

  if(r.status!=="pending")throw new Error(`This request is ${r.status}.`);

  selectedRequest={
   id:r.id,
   token:r.token,
   name:r.sender_name,
   amount:Number(r.amount),
   note:r.note||"Cova payment request",
   ref:r.id,
   status:r.status,
   remote:true
  };

  selectedBank=null;
  $("#bankTransferDetails").classList.add("hidden");

  $("#payAvatar").textContent=initials(r.sender_name);
  $("#payName").textContent=r.sender_name;
  $("#payRef").textContent=`Verified Cova request · ${String(r.id).slice(0,8)}`;
  $("#payAmount").textContent=money(r.amount);
  $("#payNote").textContent=r.note||"Cova payment request";

  $(".warning-box").textContent=
   "Verified Cova request. This preview can record demo status only; it cannot move real money.";

  $("#confirmPay").textContent="Record demo payment";
  open("#payModal");

  scanMessage("Payment request verified. Review the recipient and amount.","success");

 }catch(e){
  scanMessage(e.message||"Could not verify this request.","error");
 }
}

async function submitPayment(){
 const b=$("#confirmPay");
 b.disabled=true;

 try{
  if(selectedBank){
   const amount=Number($("#transferAmount").value);

   if(!Number.isFinite(amount)||amount<=0){
    toast("Enter a valid amount.");
    $("#transferAmount").focus();
    return;
   }

   b.textContent="Connecting securely…";

   const res=await fetch(`${API}/api/transfers`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
     bank_code:selectedBank.bankCode,
     bank_name:selectedBank.bankName,
     account_number:selectedBank.accountNumber,
     account_name:selectedBank.accountName,
     amount,
     currency:"NGN",
     reference:selectedBank.reference,
     source:"cova_qr_scan"
    })
   });

   const data=await res.json().catch(()=>({}));

   if(!res.ok||!data.success){
    throw new Error(data.detail||"Transfer provider is not connected. No money was sent.");
   }

   if(!["successful","pending"].includes(data.status)){
    throw new Error("Provider has not confirmed this transfer.");
   }

   close("#payModal");

   scanMessage(
    data.status==="successful"
     ?"Transfer confirmed by provider."
     :"Transfer submitted and awaiting confirmation.",
    "success"
   );

   toast(data.status==="successful"?"Transfer confirmed.":"Transfer submitted.");
   selectedBank=null;
   return;
  }

  if(!selectedRequest)return;

  b.textContent="Saving…";

  if(selectedRequest.remote){
   const res=await fetch(
    `${API}/api/requests/${encodeURIComponent(selectedRequest.id)}/simulate-payment`,
    {
     method:"POST",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({confirmation:true})
    }
   );

   const data=await res.json();

   if(!res.ok||!data.success){
    throw new Error(data.detail||"Unable to update request.");
   }

  }else{
   selectedRequest.status="paid";
   selectedRequest.time="Paid just now";
  }

  close("#payModal");
  renderHome();
  renderRequests();
  toast("Demo status recorded. No real money moved.");
  selectedRequest=null;

 }catch(e){
  $(".warning-box").textContent=e.message||"Could not complete this action.";
  toast(e.message||"Action failed.");

 }finally{
  b.disabled=false;
  b.textContent=selectedBank?"Continue to bank transfer":"Record demo payment";
 }
}

function stopCamera(){
 if(frame)cancelAnimationFrame(frame);
 frame=null;

 if(stream)stream.getTracks().forEach(t=>t.stop());
 stream=null;

 if(video){
  video.pause();
  video.srcObject=null;
  video.classList.add("hidden");
 }

 $("#scanPlaceholder").classList.remove("hidden");
 $("#startCamera").classList.remove("hidden");
 $("#stopCamera").classList.add("hidden");
 busy=false;
}

async function scanLoop(){
 if(!stream||busy)return;

 frame=requestAnimationFrame(scanLoop);

 const now=performance.now();
 if(now-lastScan<140||video.readyState<2)return;

 lastScan=now;

 const sw=video.videoWidth;
 const sh=video.videoHeight;

 if(!sw||!sh)return;

 const scale=Math.min(1,800/sw);
 const w=Math.round(sw*scale);
 const h=Math.round(sh*scale);

 canvas.width=w;
 canvas.height=h;

 ctx.drawImage(video,0,0,w,h);

 try{
  let raw=null;

  if(detector){
   const codes=await detector.detect(canvas);
   if(codes.length)raw=codes[0].rawValue;
  }

  if(!raw&&window.jsQR){
   const pixels=ctx.getImageData(0,0,w,h);
   const code=window.jsQR(
    pixels.data,w,h,
    {inversionAttempts:"attemptBoth"}
   );
   if(code)raw=code.data;
  }

  if(raw){
   busy=true;
   stopCamera();
   await handleQr(raw);
  }

 }catch(_){}
}

async function startCamera(){
 $("#scanResult").classList.add("hidden");

 if(!navigator.mediaDevices?.getUserMedia){
  scanMessage("Camera requires HTTPS or localhost. Import a QR image instead.","error");
  return;
 }

 stopCamera();

 try{
  stream=await navigator.mediaDevices.getUserMedia({
   audio:false,
   video:{
    facingMode:{ideal:"environment"},
    width:{ideal:1280},
    height:{ideal:720}
   }
  });

  video.srcObject=stream;
  video.classList.remove("hidden");
  $("#scanPlaceholder").classList.add("hidden");
  $("#startCamera").classList.add("hidden");
  $("#stopCamera").classList.remove("hidden");

  await video.play();

  detector=null;

  if("BarcodeDetector"in window){
   try{
    detector=new BarcodeDetector({formats:["qr_code"]});
   }catch(_){}
  }

  lastScan=0;
  scanLoop();

 }catch(e){
  stopCamera();

  scanMessage(
   e.name==="NotAllowedError"
    ?"Camera permission denied. Allow camera access or import a QR image."
    :"Unable to open camera. Check camera permissions or import a QR image.",
   "error"
  );
 }
}

async function decodeImage(file){
 if(!file||!file.type.startsWith("image/")){
  scanMessage("Choose an image containing a QR code.","error");
  return;
 }

 scanMessage("Reading QR image…");

 const url=URL.createObjectURL(file);
 const img=new Image();

 img.onload=async()=>{
  try{
   let raw=null;

   if("BarcodeDetector"in window){
    try{
     const d=new BarcodeDetector({formats:["qr_code"]});
     const c=await d.detect(img);
     if(c.length)raw=c[0].rawValue;
    }catch(_){}
   }

   if(!raw&&window.jsQR){
    const scale=Math.min(1,1800/img.naturalWidth);
    canvas.width=Math.round(img.naturalWidth*scale);
    canvas.height=Math.round(img.naturalHeight*scale);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);

    const p=ctx.getImageData(0,0,canvas.width,canvas.height);
    const c=window.jsQR(
     p.data,canvas.width,canvas.height,
     {inversionAttempts:"attemptBoth"}
    );

    if(c)raw=c.data;
   }

   URL.revokeObjectURL(url);

   if(!raw){
    scanMessage("No QR found. Use a clear, uncropped image with the full code visible.","error");
    return;
   }

   await handleQr(raw);

  }catch(_){
   URL.revokeObjectURL(url);
   scanMessage("Couldn't read this image. Try a sharper screenshot.","error");
  }
 };

 img.onerror=()=>{
  URL.revokeObjectURL(url);
  scanMessage("Unable to open this image.","error");
 };

 img.src=url;
}

async function checkApi(){
 const el=$("#backendStatus");

 try{
  const r=await fetch(`${API}/api/health`);
  const d=await r.json();

  if(!r.ok||!d.ok)throw Error();

  el.innerHTML='<span class="status-pulse online"></span><span>Cova API and database connected</span>';
  el.classList.add("connected");

 }catch(_){
  el.innerHTML='<span class="status-pulse offline"></span><span>API offline · QR image reading remains available</span>';
  el.classList.remove("connected");
 }
}

async function drawProfileQr(){
 if(!window.QRCode)return;

 const target=$("#myQrGraphic");
 target.innerHTML="";

 const c=document.createElement("canvas");

 await QRCode.toCanvas(
  c,
  `COVA-ID:${PROFILE.id}`,
  {
   width:205,
   margin:1,
   color:{dark:"#2f1c87",light:"#ffffff"},
   errorCorrectionLevel:"H"
  }
 );

 target.appendChild(c);

 const badge=document.createElement("div");
 badge.className="qr-center";
 badge.textContent="C";
 target.appendChild(badge);
}

async function shareQr(){
 const text=`My Cova ID is ${PROFILE.id}.`;

 try{
  if(navigator.share){
   await navigator.share({title:"My Cova ID",text});
  }else if(navigator.clipboard?.writeText){
   await navigator.clipboard.writeText(text);
   toast("Cova ID copied.");
  }else{
   toast(text);
  }
 }catch(e){
  if(e.name!=="AbortError")toast("Sharing is unavailable on this device.");
 }
}

function downloadQr(){
 const c=$("#myQrGraphic canvas");

 if(!c){
  toast("QR is still loading.");
  return;
 }

 const a=document.createElement("a");
 a.download="cova-profile-qr.png";
 a.href=c.toDataURL("image/png");
 a.click();
}

function bind(){
 document.addEventListener("click",e=>{
  const button=e.target.closest("[data-view]");
  if(!button)return;

  showView(button.dataset.view);

  if(button.dataset.openBankTransfer==="true"){
   scanMessage("Open the camera or choose a bank-transfer QR image to begin.","info");
  }
 });

 $("#addRequestBtn").addEventListener("click",()=>open("#requestModal"));
 $("#closeModal").addEventListener("click",()=>close("#requestModal"));
 $("#closePay").addEventListener("click",()=>close("#payModal"));

 ["#requestModal","#payModal"].forEach(s=>
  $(s).addEventListener("click",e=>{
   if(e.target===$(s))close(s);
  })
 );

 document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
   close("#requestModal");
   close("#payModal");
   stopCamera();
  }
 });

 $("#requestForm").addEventListener("submit",e=>{
  e.preventDefault();

  const name=$("#senderName").value.trim();
  const amount=Number($("#senderAmount").value);

  if(!name||!Number.isFinite(amount)||amount<=0){
   toast("Enter a valid name and amount.");
   return;
  }

  requests.unshift({
   id:Date.now(),
   name,
   amount,
   note:$("#senderNote").value.trim()||"Payment request",
   ref:$("#senderRef").value.trim()||`COVA-REQ-${Math.floor(1000+Math.random()*9000)}`,
   status:"pending",
   time:"Just added"
  });

  e.target.reset();
  close("#requestModal");
  renderHome();
  renderRequests();
  toast("Demo request added.");
 });

 $("#confirmPay").addEventListener("click",submitPayment);
 $("#requestSearch").addEventListener("input",renderRequests);

 $$(".filter").forEach(b=>
  b.addEventListener("click",()=>{
   $$(".filter").forEach(x=>x.classList.remove("active"));
   b.classList.add("active");
   filter=b.dataset.filter;
   renderRequests();
  })
 );

 $("#startCamera").addEventListener("click",startCamera);
 $("#stopCamera").addEventListener("click",stopCamera);

 $("#qrUpload").addEventListener("change",async e=>{
  const f=e.target.files?.[0];
  if(f)await decodeImage(f);
  e.target.value="";
 });

 $("#shareQr").addEventListener("click",shareQr);
 $("#downloadQr").addEventListener("click",downloadQr);
 $("#notificationBtn").addEventListener("click",()=>toast("You're all caught up."));

 document.addEventListener("visibilitychange",()=>{
  if(document.hidden)stopCamera();
 });
}

bind();
renderHome();
renderRequests();
drawProfileQr().catch(()=>{});
checkApi();

})();

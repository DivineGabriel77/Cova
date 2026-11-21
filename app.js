const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

let requests = [
  {id:1,name:"David Okafor",amount:15000,note:"November contribution",ref:"COVA-REQ-2841",source:"WhatsApp",status:"pending",time:"Received 12 minutes ago"},
  {id:2,name:"Ada Nwosu",amount:12500,note:"Shared expenses",ref:"COVA-REQ-1938",source:"Cova",status:"pending",time:"Received yesterday"}
];
let activeFilter = "all";
let selectedRequest = null;

function money(value){return "₦"+Number(value).toLocaleString("en-NG");}
function initials(name){return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();}
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600);}
function switchView(view){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${view}`));
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("#pageName").textContent=({home:"Overview",requests:"Expected payments",scan:"Scan & pay",myqr:"My Cova QR",activity:"Activity",settings:"Settings"})[view]||"Overview";
  if(view==="requests") renderRequests();
  if(view==="home") renderHome();
  window.scrollTo({top:0,behavior:"smooth"});
}
$$("[data-view]").forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));

function requestCard(r){
  return `<article class="request-item">
    <div class="request-avatar">${initials(r.name)}</div>
    <div class="request-info"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.note||"Payment request")} · ${escapeHtml(r.ref)}</small></div>
    <div class="request-amount"><strong>${money(r.amount)}</strong><small>${escapeHtml(r.time)}</small></div>
    <span class="status-tag ${r.status==="paid"?"paid":""}">${r.status==="paid"?"Paid":"Awaiting"}</span>
    <button class="pay-btn" data-pay="${r.id}" ${r.status==="paid"?"disabled":""}>${r.status==="paid"?"Completed":"Review & pay"}</button>
  </article>`;
}
function escapeHtml(str){return String(str).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderHome(){
  const pending=requests.filter(r=>r.status==="pending");
  $("#homeRequests").innerHTML=pending.slice(0,2).map(requestCard).join("")||'<div class="empty-state"><div>✓</div><h3>You are all caught up</h3><p>No payment requests are waiting for you.</p></div>';
  $("#pendingTotal").textContent=money(pending.reduce((s,r)=>s+r.amount,0));
  $("#pendingCount").textContent=`${pending.length} request${pending.length===1?"":"s"}`;
  $("#navRequestCount").textContent=pending.length;
  $("#navRequestCount").style.display=pending.length?"":"none";
  bindPayButtons();
}
function renderRequests(){
  const query=($("#requestSearch")?.value||"").toLowerCase();
  let filtered=requests.filter(r=>(activeFilter==="all"||r.status===activeFilter)&&(`${r.name} ${r.note} ${r.ref}`).toLowerCase().includes(query));
  $("#allRequests").innerHTML=filtered.map(requestCard).join("");
  $("#emptyRequests").classList.toggle("hidden",filtered.length>0);
  $("#allCount").textContent=requests.length;
  $("#waitingCount").textContent=requests.filter(r=>r.status==="pending").length;
  bindPayButtons();
}
function bindPayButtons(){$$("[data-pay]").forEach(btn=>btn.addEventListener("click",()=>openPay(Number(btn.dataset.pay))));}
function openPay(id){
  selectedRequest=requests.find(r=>r.id===id);if(!selectedRequest||selectedRequest.status!=="pending")return;
  selectedRequest.remote = false;
  $("#confirmPay").textContent = "Simulate payment";
  $(".warning-box").textContent = "Confirm the recipient and amount carefully. This prototype does not connect to a bank or move real money.";
  $("#payAvatar").textContent=initials(selectedRequest.name);
  $("#payName").textContent=selectedRequest.name;
  $("#payRef").textContent=selectedRequest.ref;
  $("#payAmount").textContent=money(selectedRequest.amount);
  $("#payNote").textContent=selectedRequest.note||"Payment request";
  $("#payModal").classList.remove("hidden");
}
function closeModal(id){$(id).classList.add("hidden");}
$("#addRequestBtn").addEventListener("click",()=>$("#requestModal").classList.remove("hidden"));
$("#closeModal").addEventListener("click",()=>closeModal("#requestModal"));
$("#closePay").addEventListener("click",()=>closeModal("#payModal"));
$("#requestModal").addEventListener("click",e=>{if(e.target.id==="requestModal")closeModal("#requestModal");});
$("#payModal").addEventListener("click",e=>{if(e.target.id==="payModal")closeModal("#payModal");});
$("#requestForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("#senderName").value.trim(),amount=Number($("#senderAmount").value);
  if(!name||!Number.isFinite(amount)||amount<=0){toast("Enter a valid name and amount.");return;}
  requests.unshift({id:Date.now(),name,amount,note:$("#senderNote").value.trim()||"Payment request",ref:$("#senderRef").value.trim()||`COVA-REQ-${Math.floor(1000+Math.random()*9000)}`,source:"Manually added",status:"pending",time:"Just added"});
  e.target.reset();closeModal("#requestModal");renderHome();renderRequests();toast("Request saved to Expected Payments.");
});
$("#confirmPay").addEventListener("click", async ()=>{
  if(!selectedRequest)return;

  // QR requests are verified against the backend. This endpoint is still demo-only:
  // it changes request status but does not transfer real money.
  if(selectedRequest.remote){
    const button = $("#confirmPay");
    button.disabled = true;
    button.textContent = "Checking…";

    try {
      const response = await fetch(
        `${COVA_API_BASE}/api/requests/${encodeURIComponent(selectedRequest.id)}/simulate-payment`,
        {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({confirmation:true})
        }
      );
      const result = await response.json();
      if(!response.ok || !result.success) {
        throw new Error(result.detail || "Unable to update this request.");
      }
      closeModal("#payModal");
      setScanMessage("Demo request marked as paid. No real money was transferred.", "success");
      toast("Demo payment recorded. No real money was moved.");
      selectedRequest = null;
    } catch(error) {
      toast(error.message || "Unable to process request.");
    } finally {
      button.disabled = false;
      button.textContent = "Continue to payment";
    }
    return;
  }

  selectedRequest.status="paid";
  selectedRequest.time="Paid just now";
  closeModal("#payModal");
  renderHome();
  renderRequests();
  toast("Demo payment completed. No real money was moved.");
});
$("#requestSearch").addEventListener("input",renderRequests);
$$(".filter").forEach(btn=>btn.addEventListener("click",()=>{$$(".filter").forEach(b=>b.classList.remove("active"));btn.classList.add("active");activeFilter=btn.dataset.filter;renderRequests();}));

$("#startCamera").addEventListener("click",()=>{
  toast("Camera scanning needs a QR scanner library and secure camera permission integration.");
});
$("#qrUpload").addEventListener("change",e=>{
  const file=e.target.files[0];if(!file)return;
  toast(`"${file.name}" selected. QR decoding will be connected in the next build.`);
  e.target.value="";
});
$("#shareQr").addEventListener("click",async()=>{
  const shareData={title:"My Cova payment identity",text:"Send me a payment request on Cova. My Cova ID is COVA-8291."};
  try{if(navigator.share)await navigator.share(shareData);else{await navigator.clipboard.writeText(shareData.text);toast("Cova ID copied to clipboard.");}}catch(err){if(err.name!=="AbortError")toast("Sharing is not available on this device.");}
});
$("#downloadQr").addEventListener("click",()=>toast("A real downloadable QR will be generated when Cova IDs are connected to the backend."));
$("#notificationBtn").addEventListener("click",()=>toast("You're all caught up."));
renderHome();


// ==========================================
// COVA QR SCANNER: CAMERA + IMAGE IMPORT
// ==========================================
// If the frontend and API are hosted on different domains, set:
// window.COVA_API_BASE = "https://your-cova-api.onrender.com";
// before loading app.js.

const COVA_API_BASE = (window.COVA_API_BASE || window.location.origin).replace(/\/$/, "");
let covaCameraStream = null;
let covaScanFrame = null;
let covaBarcodeDetector = null;
let covaScannerBusy = false;

const covaVideo = $("#cameraVideo");
const covaCanvas = $("#scanCanvas");
const covaCanvasContext = covaCanvas.getContext("2d", {willReadFrequently:true});

function covaScanMessage(message, type="info") {
  const result = $("#scanResult");
  result.textContent = message;
  result.className = `scan-result ${type}`;
}

function covaStopCamera() {
  if(covaScanFrame) cancelAnimationFrame(covaScanFrame);
  covaScanFrame = null;

  if(covaCameraStream) {
    covaCameraStream.getTracks().forEach(track => track.stop());
    covaCameraStream = null;
  }

  covaVideo.pause();
  covaVideo.srcObject = null;
  covaVideo.classList.add("hidden");
  $("#scanPlaceholder").classList.remove("hidden");
  $("#startCamera").classList.remove("hidden");
  $("#stopCamera").classList.add("hidden");
}

async function covaStartCamera() {
  $("#scanResult").classList.add("hidden");

  if(!navigator.mediaDevices?.getUserMedia) {
    covaScanMessage("Camera access needs HTTPS or localhost. You can still import a QR image from WhatsApp or your gallery.", "error");
    return;
  }

  try {
    covaCameraStream = await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:{ideal:"environment"}, width:{ideal:1280}, height:{ideal:720}}
    });

    covaVideo.srcObject = covaCameraStream;
    covaVideo.classList.remove("hidden");
    $("#scanPlaceholder").classList.add("hidden");
    $("#startCamera").classList.add("hidden");
    $("#stopCamera").classList.remove("hidden");
    await covaVideo.play();

    if("BarcodeDetector" in window) {
      try {
        covaBarcodeDetector = new BarcodeDetector({formats:["qr_code"]});
      } catch(error) {
        covaBarcodeDetector = null;
      }
    }
    covaScanCameraFrame();
  } catch(error) {
    covaStopCamera();
    covaScanMessage(
      error.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access or import the QR image instead."
        : "Could not open the camera. Try importing the QR image from your gallery.",
      "error"
    );
  }
}

async function covaScanCameraFrame() {
  if(!covaCameraStream || covaVideo.readyState < 2 || covaScannerBusy) {
    covaScanFrame = requestAnimationFrame(covaScanCameraFrame);
    return;
  }

  const width = covaVideo.videoWidth;
  const height = covaVideo.videoHeight;

  if(width && height) {
    covaCanvas.width = width;
    covaCanvas.height = height;
    covaCanvasContext.drawImage(covaVideo, 0, 0, width, height);

    try {
      let value = null;

      if(covaBarcodeDetector) {
        const codes = await covaBarcodeDetector.detect(covaVideo);
        if(codes.length) value = codes[0].rawValue;
      } else if(window.jsQR) {
        const pixels = covaCanvasContext.getImageData(0, 0, width, height);
        const code = window.jsQR(pixels.data, width, height, {inversionAttempts:"attemptBoth"});
        if(code) value = code.data;
      }

      if(value) {
        covaScannerBusy = true;
        covaStopCamera();
        await covaHandleDecodedQR(value);
        covaScannerBusy = false;
        return;
      }
    } catch(error) {
      // Keep scanning after a frame that could not be decoded.
    }
  }

  covaScanFrame = requestAnimationFrame(covaScanCameraFrame);
}

async function covaDecodeImage(file) {
  if(!file || !file.type.startsWith("image/")) {
    covaScanMessage("Choose an image file containing a QR code.", "error");
    return;
  }

  covaScanMessage("Reading QR code from image…");
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = async () => {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", {willReadFrequently:true});
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);

      let value = null;

      if("BarcodeDetector" in window) {
        try {
          const detector = new BarcodeDetector({formats:["qr_code"]});
          const codes = await detector.detect(image);
          if(codes.length) value = codes[0].rawValue;
        } catch(error) {}
      }

      if(!value && window.jsQR) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(pixels.data, canvas.width, canvas.height, {inversionAttempts:"attemptBoth"});
        if(code) value = code.data;
      }

      URL.revokeObjectURL(imageUrl);

      if(!value) {
        covaScanMessage("No QR code found. Try a clearer, uncropped QR image.", "error");
        return;
      }

      await covaHandleDecodedQR(value);
    } catch(error) {
      URL.revokeObjectURL(imageUrl);
      covaScanMessage("Cova couldn't read this image. Try another image.", "error");
    }
  };

  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    covaScanMessage("Unable to open this image.", "error");
  };
  image.src = imageUrl;
}

function covaExtractToken(raw) {
  const value = String(raw || "").trim();

  try {
    const url = new URL(value);
    const path = url.pathname.split("/").filter(Boolean);
    const payIndex = path.indexOf("pay");
    const resolveIndex = path.indexOf("resolve");

    if(payIndex >= 0 && path[payIndex+1]) return path[payIndex+1];
    if(resolveIndex >= 0 && path[resolveIndex+1]) return path[resolveIndex+1];
  } catch(error) {}

  const match = value.match(/^COVA:([A-Za-z0-9_-]{12,})$/i);
  return match ? match[1] : null;
}

async function covaHandleDecodedQR(raw) {
  const token = covaExtractToken(raw);

  if(!token) {
    covaScanMessage("This isn't a recognized Cova payment QR. Ask the sender to share their Cova request QR.", "error");
    return;
  }

  covaScanMessage("QR found. Verifying recipient and payment details…");

  try {
    const response = await fetch(`${COVA_API_BASE}/api/resolve/${encodeURIComponent(token)}`);
    const data = await response.json();

    if(!response.ok || !data.success || !data.request) {
      throw new Error(data.detail || "Could not verify this payment request.");
    }

    const request = data.request;

    if(request.status !== "pending") {
      throw new Error(`This request is ${request.status} and cannot be paid.`);
    }

    selectedRequest = {
      id:request.id,
      token:request.token,
      name:request.sender_name,
      amount:request.amount,
      note:request.note || "Cova payment request",
      status:request.status,
      remote:true
    };

    $("#payAvatar").textContent = initials(request.sender_name);
    $("#payName").textContent = request.sender_name;
    $("#payRef").textContent = `Verified Cova request · ${request.id.slice(0,8)}`;
    $("#payAmount").textContent = money(request.amount);
    $("#payNote").textContent = request.note || "Cova payment request";
    $(".warning-box").textContent = "The recipient and amount were retrieved from Cova's server. Review them carefully. Real bank transfer authorization is not connected yet.";
    $("#confirmPay").textContent = "Continue to payment";
    $("#payModal").classList.remove("hidden");

    covaScanMessage("Cova QR verified. Review the recipient and amount before continuing.", "success");
  } catch(error) {
    covaScanMessage(error.message || "Could not verify this request. Check your connection and try again.", "error");
  }
}

$("#startCamera").addEventListener("click", covaStartCamera);
$("#stopCamera").addEventListener("click", covaStopCamera);

$("#qrUpload").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if(file) await covaDecodeImage(file);
  event.target.value = "";
});

document.addEventListener("visibilitychange", () => {
  if(document.hidden) covaStopCamera();
});

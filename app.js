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
$("#confirmPay").addEventListener("click",()=>{
  if(!selectedRequest)return;
  selectedRequest.status="paid";selectedRequest.time="Paid just now";
  closeModal("#payModal");renderHome();renderRequests();toast("Demo payment completed. No real money was moved.");
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

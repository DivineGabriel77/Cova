import os, sqlite3, secrets, uuid
from datetime import datetime, timezone
from pathlib import Path
from io import BytesIO
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
import qrcode

ROOT=Path(__file__).resolve().parent
DB_PATH=Path(os.getenv("COVA_DB_PATH", ROOT/"cova.db"))
PUBLIC_BASE_URL=os.getenv("PUBLIC_BASE_URL","http://localhost:8000").rstrip("/")
ORIGINS=[x.strip() for x in os.getenv("COVA_ALLOWED_ORIGINS","*").split(",") if x.strip()]
app=FastAPI(title="Cova API",version="0.2.0")
app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_credentials=False,allow_methods=["GET","POST","OPTIONS"],allow_headers=["*"])

def now(): return datetime.now(timezone.utc).isoformat()
def connect():
    c=sqlite3.connect(DB_PATH); c.row_factory=sqlite3.Row; return c
def init():
    with connect() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS payment_requests(
        id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, sender_name TEXT NOT NULL,
        sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, amount REAL NOT NULL,
        currency TEXT NOT NULL, note TEXT DEFAULT '', status TEXT NOT NULL,
        created_at TEXT NOT NULL, paid_at TEXT)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_token ON payment_requests(token)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_recipient ON payment_requests(recipient_id,status)")
init()

class NewRequest(BaseModel):
    model_config=ConfigDict(str_strip_whitespace=True)
    sender_name:str=Field(min_length=1,max_length=100)
    sender_id:str=Field(min_length=1,max_length=100)
    recipient_id:str=Field(min_length=1,max_length=100)
    amount:float=Field(gt=0,le=100000000)
    currency:str=Field(default="NGN",min_length=3,max_length=3)
    note:str=Field(default="",max_length=240)
class ConfirmDemo(BaseModel):
    confirmation:bool=True
class TransferInput(BaseModel):
    bank_code:str=Field(min_length=1,max_length=40)
    bank_name:str=Field(min_length=1,max_length=100)
    account_number:str=Field(pattern=r"^\d{10}$")
    account_name:str=Field(min_length=1,max_length=120)
    amount:float=Field(gt=0,le=100000000)
    currency:str=Field(default="NGN",min_length=3,max_length=3)
    reference:str=Field(default="Cova QR bank transfer",max_length=160)
    source:str=Field(default="cova_qr_scan",max_length=40)

def pack(r):
    return {k:r[k] for k in ("id","token","sender_name","sender_id","recipient_id","amount","currency","note","status","created_at","paid_at")}

@app.get("/")
def root(): return {"service":"Cova API","health":"/api/health","docs":"/docs"}
@app.get("/api/health")
def health():
    try:
        with connect() as c: c.execute("SELECT 1")
        return {"ok":True,"service":"cova-api","database":"connected","transfers_enabled":False}
    except sqlite3.Error: raise HTTPException(503,"Database unavailable")

@app.post("/api/requests")
def create_request(p:NewRequest):
    rid=str(uuid.uuid4()); token=secrets.token_urlsafe(24); created=now()
    with connect() as c:
        c.execute("""INSERT INTO payment_requests
        (id,token,sender_name,sender_id,recipient_id,amount,currency,note,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,'pending',?)""",
        (rid,token,p.sender_name,p.sender_id,p.recipient_id,p.amount,p.currency.upper(),p.note,created))
    return {"success":True,"request":{"id":rid,"token":token,"sender_name":p.sender_name,"sender_id":p.sender_id,
    "recipient_id":p.recipient_id,"amount":p.amount,"currency":p.currency.upper(),"note":p.note,"status":"pending",
    "created_at":created,"qr_url":f"{PUBLIC_BASE_URL}/pay/{token}","resolve_url":f"{PUBLIC_BASE_URL}/api/resolve/{token}",
    "qr_image_url":f"{PUBLIC_BASE_URL}/api/qr/{token}"}}

@app.get("/api/requests")
def list_requests(recipient_id:str=Query(min_length=1,max_length=100),status:str=Query("all",pattern="^(all|pending|paid|expired|cancelled)$")):
    sql="SELECT * FROM payment_requests WHERE recipient_id=?"; args=[recipient_id]
    if status!="all": sql+=" AND status=?"; args.append(status)
    sql+=" ORDER BY created_at DESC LIMIT 200"
    with connect() as c: rows=c.execute(sql,args).fetchall()
    return {"success":True,"requests":[pack(r) for r in rows]}

@app.get("/api/requests/{rid}")
def get_request(rid:str):
    with connect() as c: r=c.execute("SELECT * FROM payment_requests WHERE id=?",(rid,)).fetchone()
    if not r: raise HTTPException(404,"Request not found")
    return {"success":True,"request":pack(r)}

@app.get("/api/resolve/{token}")
def resolve(token:str):
    with connect() as c: r=c.execute("SELECT * FROM payment_requests WHERE token=?",(token,)).fetchone()
    if not r: raise HTTPException(404,"Cova payment request not found")
    return {"success":True,"request":pack(r)}

@app.get("/api/qr/{token}")
def qr_image(token:str):
    with connect() as c: r=c.execute("SELECT token FROM payment_requests WHERE token=?",(token,)).fetchone()
    if not r: raise HTTPException(404,"Cova payment request not found")
    image=qrcode.make(f"{PUBLIC_BASE_URL}/pay/{token}"); buffer=BytesIO(); image.save(buffer,format="PNG"); buffer.seek(0)
    return StreamingResponse(buffer,media_type="image/png")

@app.post("/api/requests/{rid}/cancel")
def cancel(rid:str):
    with connect() as c:
        result=c.execute("UPDATE payment_requests SET status='cancelled' WHERE id=? AND status='pending'",(rid,))
        if result.rowcount==0:
            if not c.execute("SELECT id FROM payment_requests WHERE id=?",(rid,)).fetchone(): raise HTTPException(404,"Request not found")
            raise HTTPException(409,"Only pending requests can be cancelled")
    return {"success":True,"status":"cancelled"}

@app.post("/api/requests/{rid}/simulate-payment")
def simulate(rid:str,p:ConfirmDemo):
    if not p.confirmation: raise HTTPException(400,"Confirmation is required")
    with connect() as c:
        result=c.execute("UPDATE payment_requests SET status='paid',paid_at=? WHERE id=? AND status='pending'",(now(),rid))
        if result.rowcount==0:
            if not c.execute("SELECT id FROM payment_requests WHERE id=?",(rid,)).fetchone(): raise HTTPException(404,"Request not found")
            raise HTTPException(409,"Request is no longer pending")
    return {"success":True,"status":"paid","real_money_moved":False}

@app.post("/api/transfers")
def transfer(p:TransferInput):
    raise HTTPException(503,"Bank transfers are not enabled. Connect a licensed bank/PSP transfer provider first. No money was sent.")


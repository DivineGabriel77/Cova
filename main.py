
import os
import io
import uuid
import sqlite3
import secrets
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager

import qrcode
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ==========================================
# COVA CONFIGURATION
# ==========================================

APP_NAME = "Cova"
DATABASE = os.getenv("COVA_DATABASE", "cova.db")
PUBLIC_BASE_URL = os.getenv(
    "COVA_PUBLIC_URL",
    "http://localhost:8000"
).rstrip("/")

REQUEST_EXPIRY_DAYS = 7

app = FastAPI(
    title="Cova API",
    description="Cova QR payment request infrastructure",
    version="1.0.0"
)

# Development configuration.
# Restrict this to your actual frontend domain in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# DATABASE
# ==========================================

@contextmanager
def database():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with database() as db:

        db.execute("""
            CREATE TABLE IF NOT EXISTS payment_requests (
                id TEXT PRIMARY KEY,
                token TEXT UNIQUE NOT NULL,
                sender_name TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                recipient_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'NGN',
                note TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                paid_at TEXT
            )
        """)

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_request_token
            ON payment_requests(token)
        """)

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_recipient
            ON payment_requests(recipient_id)
        """)


initialize_database()


# ==========================================
# REQUEST MODELS
# ==========================================

class CreateRequest(BaseModel):
    sender_name: str = Field(min_length=2, max_length=100)
    sender_id: str = Field(min_length=3, max_length=100)
    recipient_id: str = Field(min_length=3, max_length=100)
    amount: int = Field(gt=0, le=1000000000)
    currency: str = "NGN"
    note: str = Field(default="", max_length=250)


class DemoPayment(BaseModel):
    confirmation: bool


# ==========================================
# HELPERS
# ==========================================

def current_time():
    return datetime.now(timezone.utc)


def serialize_request(row):
    return {
        "id": row["id"],
        "token": row["token"],
        "sender_name": row["sender_name"],
        "sender_id": row["sender_id"],
        "recipient_id": row["recipient_id"],
        "amount": row["amount"],
        "currency": row["currency"],
        "note": row["note"],
        "status": row["status"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "paid_at": row["paid_at"],
        "qr_url": f"{PUBLIC_BASE_URL}/api/qr/{row['token']}",
        "share_url": f"{PUBLIC_BASE_URL}/pay/{row['token']}"
    }


def find_request(request_id):
    with database() as db:
        row = db.execute(
            "SELECT * FROM payment_requests WHERE id = ?",
            (request_id,)
        ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Payment request not found"
        )

    return row


def update_expiration(row):
    if row["status"] != "pending":
        return row

    expires = datetime.fromisoformat(row["expires_at"])

    if current_time() >= expires:
        with database() as db:
            db.execute(
                """
                UPDATE payment_requests
                SET status = 'expired'
                WHERE id = ? AND status = 'pending'
                """,
                (row["id"],)
            )

        return find_request(row["id"])

    return row


# ==========================================
# HOME / HEALTH
# ==========================================

@app.get("/")
def home():
    return {
        "app": APP_NAME,
        "message": "Welcome to the Cova API",
        "status": "online",
        "version": "1.0.0"
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "Cova Backend"
    }


# ==========================================
# CREATE PAYMENT REQUEST
# ==========================================

@app.post("/api/requests")
def create_request(data: CreateRequest):

    request_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)

    created = current_time()
    expires = created + timedelta(days=REQUEST_EXPIRY_DAYS)

    with database() as db:

        db.execute("""
            INSERT INTO payment_requests (
                id,
                token,
                sender_name,
                sender_id,
                recipient_id,
                amount,
                currency,
                note,
                status,
                created_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            request_id,
            token,
            data.sender_name,
            data.sender_id,
            data.recipient_id,
            data.amount,
            data.currency.upper(),
            data.note,
            "pending",
            created.isoformat(),
            expires.isoformat()
        ))

        row = db.execute(
            "SELECT * FROM payment_requests WHERE id = ?",
            (request_id,)
        ).fetchone()

    return {
        "success": True,
        "message": "Cova payment request created",
        "request": serialize_request(row)
    }


# ==========================================
# GET ALL EXPECTED PAYMENTS
# ==========================================

@app.get("/api/requests")
def get_requests(
    recipient_id: str,
    status: str = "all"
):

    allowed_statuses = {
        "all",
        "pending",
        "paid",
        "expired",
        "cancelled"
    }

    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid request status"
        )

    with database() as db:

        rows = db.execute("""
            SELECT * FROM payment_requests
            WHERE recipient_id = ?
            ORDER BY created_at DESC
        """, (recipient_id,)).fetchall()

    results = []

    for row in rows:
        row = update_expiration(row)

        if status == "all" or row["status"] == status:
            results.append(serialize_request(row))

    return {
        "success": True,
        "count": len(results),
        "requests": results
    }


# ==========================================
# GET SINGLE REQUEST
# ==========================================

@app.get("/api/requests/{request_id}")
def get_single_request(request_id: str):

    row = find_request(request_id)
    row = update_expiration(row)

    return {
        "success": True,
        "request": serialize_request(row)
    }


# ==========================================
# RESOLVE SHARED QR TOKEN
# ==========================================

@app.get("/api/resolve/{token}")
def resolve_qr(token: str):

    with database() as db:

        row = db.execute("""
            SELECT * FROM payment_requests
            WHERE token = ?
        """, (token,)).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Invalid Cova payment QR"
        )

    row = update_expiration(row)

    return {
        "success": True,
        "request": serialize_request(row)
    }


# ==========================================
# GENERATE QR IMAGE
# ==========================================

@app.get("/api/qr/{token}")
def generate_qr(token: str):

    with database() as db:

        row = db.execute("""
            SELECT * FROM payment_requests
            WHERE token = ?
        """, (token,)).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="QR payment request not found"
        )

    row = update_expiration(row)

    if row["status"] != "pending":
        raise HTTPException(
            status_code=410,
            detail="This payment request is no longer active"
        )

    # QR contains a shareable payment URL.
    # It does not contain bank credentials.

    qr_data = f"{PUBLIC_BASE_URL}/pay/{token}"

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4
    )

    qr.add_data(qr_data)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="#101b2d",
        back_color="white"
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={
            "Cache-Control": "no-store"
        }
    )


# ==========================================
# CANCEL PAYMENT REQUEST
# ==========================================

@app.post("/api/requests/{request_id}/cancel")
def cancel_request(request_id: str):

    row = find_request(request_id)
    row = update_expiration(row)

    if row["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending requests can be cancelled"
        )

    with database() as db:
        db.execute("""
            UPDATE payment_requests
            SET status = 'cancelled'
            WHERE id = ?
        """, (request_id,))

    return {
        "success": True,
        "message": "Payment request cancelled"
    }


# ==========================================
# DEMO PAYMENT CONFIRMATION
# ==========================================

@app.post("/api/requests/{request_id}/simulate-payment")
def simulate_payment(
    request_id: str,
    data: DemoPayment
):

    if not data.confirmation:
        raise HTTPException(
            status_code=400,
            detail="Payment confirmation required"
        )

    row = find_request(request_id)
    row = update_expiration(row)

    if row["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail="This request is not payable"
        )

    paid_at = current_time().isoformat()

    with database() as db:

        result = db.execute("""
            UPDATE payment_requests
            SET status = 'paid',
                paid_at = ?
            WHERE id = ?
            AND status = 'pending'
        """, (paid_at, request_id))

        if result.rowcount != 1:
            raise HTTPException(
                status_code=409,
                detail="Request has already been processed"
            )

    return {
        "success": True,
        "message": "DEMO ONLY: Payment marked as paid",
        "real_money_moved": False,
        "request_id": request_id,
        "paid_at": paid_at
    }


# ==========================================
# APPLICATION STARTUP
# ==========================================

@app.on_event("startup")
def startup_event():
    initialize_database()
    print("Cova backend started successfully.")

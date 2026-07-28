"""Login only -- brief §10's locked auth path is explicit that there is no
public signup route: admin accounts are created out-of-band (see
app/create_admin.py). If this router grows a second route, it should be
"logout"/"whoami" territory, never "register".
"""
from app.auth.security import create_access_token, verify_password
from app.db import get_connection
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends()):
    """`OAuth2PasswordRequestForm` expects `username`+`password` fields
    (form-encoded, not JSON) -- `username` carries the account's email here,
    there's no separate username concept in auth.users."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, email, password_hash, role FROM auth.users WHERE email = %s",
                (form.username,),
            )
            user = cur.fetchone()
    finally:
        conn.close()

    # Same 401 for "no such user" and "wrong password" -- distinguishing
    # them lets an attacker enumerate valid emails for free.
    if user is None or not verify_password(form.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = create_access_token(str(user["id"]), user["email"], user["role"])
    return {"access_token": token, "token_type": "bearer", "role": user["role"]}

"""Login only -- brief §10's locked auth path is explicit that there is no
public signup route: admin accounts are created out-of-band (see
app/create_admin.py). If this router grows a second route, it should be
"logout"/"whoami" territory, never "register".
"""
from app.auth.security import create_access_token, verify_password
from app.db import get_connection
from app.rate_limit import limiter
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
# 10/minute per source IP -- generous enough that a legitimate admin
# mistyping their password a few times never gets locked out, tight enough
# that brute-forcing a password of any real length is infeasible. `request`
# is required by slowapi's decorator (it reads the caller's IP off it via
# get_remote_address, see app/rate_limit.py) even though the route body
# never touches it directly.
@limiter.limit("10/minute")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
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

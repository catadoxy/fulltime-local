#!/usr/bin/env python3
"""
Decrypt a legacy tournament manager (legacy) database export.

The legacy Android app (legacy.app) exports the Room/SQLite
database as:
    plaintext = <1 version byte> + <raw SQLite file bytes>
encrypted with AES-256 in ECB mode and PKCS5/PKCS7 padding.

Key derivation (from the app's sn.a / sn.d classes):
    keyString = Android Base64.encodeToString(
                    (packageName + ".1124090819881992").getBytes(UTF-8),
                    Base64.DEFAULT)
    aesKey    = SHA-256(keyString encoded as UTF-8)      # 32 bytes

NOTE: Android's Base64.DEFAULT appends a trailing newline, which is part
of the key string. Keep it.

Usage:
    python decrypt_export.py <encrypted_export.db> [output.sqlite]
"""
import base64
import hashlib
import os
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PACKAGE = "legacy.app"
KEY_SUFFIX = ".1124090819881992"
SQLITE_MAGIC = b"SQLite format 3\x00"


def derive_key() -> bytes:
    raw = (PACKAGE + KEY_SUFFIX).encode("utf-8")
    # Android Base64.encodeToString(raw, Base64.DEFAULT) -> standard base64 + trailing '\n'
    key_string = base64.b64encode(raw).decode("ascii") + "\n"
    return hashlib.sha256(key_string.encode("utf-8")).digest()


def decrypt(data: bytes) -> bytes:
    key = derive_key()
    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    plaintext = decryptor.update(data) + decryptor.finalize()

    # Strip PKCS7 padding.
    pad = plaintext[-1]
    if 1 <= pad <= 16 and plaintext[-pad:] == bytes([pad]) * pad:
        plaintext = plaintext[:-pad]

    version_byte, db = plaintext[0], plaintext[1:]
    if not db.startswith(SQLITE_MAGIC):
        raise ValueError("Decryption failed: output is not a SQLite database.")
    return version_byte, db


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + "_decrypted.sqlite"

    with open(src, "rb") as f:
        data = f.read()

    version, db = decrypt(data)
    with open(dst, "wb") as f:
        f.write(db)

    print(f"Decrypted '{src}' (database version byte: {version})")
    print(f"Wrote SQLite database: {dst} ({len(db)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

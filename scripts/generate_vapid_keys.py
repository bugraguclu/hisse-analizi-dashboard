"""Print a new VAPID key pair for Web Push as .env lines.

    python scripts/generate_vapid_keys.py >> .env

The private key is the raw 32-byte P-256 scalar, the public key the uncompressed
65-byte point, both base64url without padding (the format browsers and pywebpush
expect). deploy/setup-oracle.sh produces the same format with openssl. Rotating
the pair invalidates every existing browser subscription (users re-enable alerts).
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def generate() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64url(public), b64url(private)


if __name__ == "__main__":
    public_key, private_key = generate()
    print(f"VAPID_PUBLIC_KEY={public_key}")
    print(f"VAPID_PRIVATE_KEY={private_key}")

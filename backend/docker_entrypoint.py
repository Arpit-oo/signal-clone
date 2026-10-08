"""Keep the container signing key in its data volume, then exec the server."""

import os
import secrets
import sys
import tempfile
from collections.abc import Sequence
from contextlib import suppress
from pathlib import Path

DATA_DIR = Path("/app/data")


def _read_secret(secret_path: Path) -> str:
    secret_path.chmod(0o600)
    try:
        secret = secret_path.read_text(encoding="utf-8").strip()
    except UnicodeError:
        raise RuntimeError("Persisted JWT secret must contain UTF-8 text.") from None
    if not secret:
        raise RuntimeError("Persisted JWT secret is empty; restore it or set JWT_SECRET.")
    return secret


def load_or_create_secret(data_dir: Path) -> str:
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    secret_path = data_dir / ".jwt-secret"
    try:
        return _read_secret(secret_path)
    except FileNotFoundError:
        pass

    descriptor, temporary_name = tempfile.mkstemp(prefix=".jwt-secret-", dir=data_dir)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(secrets.token_urlsafe(48))
            temporary.flush()
            os.fsync(temporary.fileno())
        with suppress(FileExistsError):
            # Publish only a complete file, without replacing another starter's key.
            os.link(temporary_path, secret_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return _read_secret(secret_path)


def configure_jwt_secret(data_dir: Path | None = None) -> str:
    explicit = os.environ.get("JWT_SECRET", "")
    if explicit.strip():
        return explicit
    secret = load_or_create_secret(data_dir if data_dir is not None else DATA_DIR)
    os.environ["JWT_SECRET"] = secret
    return secret


def main(argv: Sequence[str] | None = None) -> None:
    command = list(sys.argv[1:] if argv is None else argv)
    if not command:
        raise SystemExit("No container command supplied.")
    configure_jwt_secret()
    os.execvp(command[0], command)


if __name__ == "__main__":
    main()

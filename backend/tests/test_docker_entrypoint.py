import hashlib
import os
import re
import stat
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import docker_entrypoint


@pytest.mark.parametrize("configured", [None, "", " \t\n "])
def test_blank_environment_generates_private_persisted_secret(
    tmp_path: Path, monkeypatch, capsys, configured: str | None
) -> None:
    if configured is None:
        monkeypatch.delenv("JWT_SECRET", raising=False)
    else:
        monkeypatch.setenv("JWT_SECRET", configured)
    data_dir = tmp_path / "data"

    secret = docker_entrypoint.configure_jwt_secret(data_dir)

    assert re.fullmatch(r"[A-Za-z0-9_-]{64}", secret)
    assert (data_dir / ".jwt-secret").read_text(encoding="utf-8") == secret
    assert os.environ["JWT_SECRET"] == secret
    assert list(data_dir.iterdir()) == [data_dir / ".jwt-secret"]
    assert capsys.readouterr() == ("", "")


def test_generated_secret_is_reused_without_regeneration(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    first = docker_entrypoint.configure_jwt_secret(tmp_path)
    monkeypatch.delenv("JWT_SECRET")

    def unexpected_generation(_: int) -> str:
        raise AssertionError("A persisted key must never be regenerated")

    monkeypatch.setattr(docker_entrypoint.secrets, "token_urlsafe", unexpected_generation)
    assert docker_entrypoint.configure_jwt_secret(tmp_path) == first
    assert os.environ["JWT_SECRET"] == first


def test_separate_processes_reuse_volume_secret(tmp_path: Path) -> None:
    environment = dict(os.environ)
    environment.pop("JWT_SECRET", None)
    script = (
        "import hashlib, sys; from pathlib import Path; import docker_entrypoint; "
        "secret = docker_entrypoint.configure_jwt_secret(Path(sys.argv[1])); "
        "print(hashlib.sha256(secret.encode()).hexdigest())"
    )

    def start_process() -> str:
        process = subprocess.run(
            [sys.executable, "-c", script, str(tmp_path)],
            cwd=Path(__file__).resolve().parents[1],
            env=environment,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert process.stderr == ""
        return process.stdout.strip()

    first = start_process()
    assert start_process() == first
    assert first == hashlib.sha256((tmp_path / ".jwt-secret").read_bytes()).hexdigest()


def test_explicit_environment_overrides_without_touching_persisted_key(
    tmp_path: Path, monkeypatch
) -> None:
    persisted = docker_entrypoint.load_or_create_secret(tmp_path)
    monkeypatch.setenv("JWT_SECRET", " explicit-override ")

    assert docker_entrypoint.configure_jwt_secret(tmp_path) == " explicit-override "
    assert (tmp_path / ".jwt-secret").read_text(encoding="utf-8") == persisted
    absent_directory = tmp_path / "not-needed"
    assert docker_entrypoint.configure_jwt_secret(absent_directory) == " explicit-override "
    assert not absent_directory.exists()


def test_concurrent_starters_publish_one_complete_key(tmp_path: Path, monkeypatch) -> None:
    starters = 8
    publication = threading.Barrier(starters)
    real_link = os.link

    def publish_together(source, destination) -> None:
        publication.wait(timeout=10)
        real_link(source, destination)

    monkeypatch.setattr(docker_entrypoint.os, "link", publish_together)
    with ThreadPoolExecutor(max_workers=starters) as pool:
        values = list(
            pool.map(lambda _: docker_entrypoint.load_or_create_secret(tmp_path), range(starters))
        )

    assert len(set(values)) == 1
    assert re.fullmatch(r"[A-Za-z0-9_-]{64}", values[0])
    assert (tmp_path / ".jwt-secret").read_text(encoding="utf-8") == values[0]
    assert list(tmp_path.iterdir()) == [tmp_path / ".jwt-secret"]


@pytest.mark.skipif(os.name != "posix", reason="POSIX file modes are enforced in the Linux image")
def test_secret_has_owner_only_permissions_and_repairs_existing_mode(tmp_path: Path) -> None:
    secret = docker_entrypoint.load_or_create_secret(tmp_path)
    secret_path = tmp_path / ".jwt-secret"
    assert stat.S_IMODE(secret_path.stat().st_mode) == 0o600
    secret_path.chmod(0o644)
    assert docker_entrypoint.load_or_create_secret(tmp_path) == secret
    assert stat.S_IMODE(secret_path.stat().st_mode) == 0o600


@pytest.mark.parametrize("content", [b" \n", b"\xff"])
def test_invalid_persisted_key_fails_without_rotation(
    tmp_path: Path, monkeypatch, content: bytes
) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    secret_path = tmp_path / ".jwt-secret"
    secret_path.write_bytes(content)
    with pytest.raises(RuntimeError, match="Persisted JWT secret"):
        docker_entrypoint.configure_jwt_secret(tmp_path)
    assert secret_path.read_bytes() == content
    assert "JWT_SECRET" not in os.environ


def test_failed_publication_cleans_temporary_key(tmp_path: Path, monkeypatch) -> None:
    def unavailable_link(*_) -> None:
        raise OSError("Volume does not support atomic publication")

    monkeypatch.setattr(docker_entrypoint.os, "link", unavailable_link)
    with pytest.raises(OSError, match="atomic publication"):
        docker_entrypoint.load_or_create_secret(tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_entrypoint_executes_exact_arguments_with_configured_secret(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setattr(docker_entrypoint, "DATA_DIR", tmp_path)
    command = ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
    calls = []

    class Executed(Exception):
        pass

    def exec_command(executable, arguments) -> None:
        calls.append((executable, arguments, os.environ["JWT_SECRET"]))
        raise Executed

    monkeypatch.setattr(docker_entrypoint.os, "execvp", exec_command)
    with pytest.raises(Executed):
        docker_entrypoint.main(command)
    assert calls == [("uvicorn", command, (tmp_path / ".jwt-secret").read_text(encoding="utf-8"))]


def test_entrypoint_requires_command_before_creating_secret(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(docker_entrypoint, "DATA_DIR", tmp_path / "unused")
    with pytest.raises(SystemExit, match="No container command supplied"):
        docker_entrypoint.main([])
    assert not (tmp_path / "unused").exists()

"""TLS keys must never be committable: ./certs is mounted into the container (docs/HTTPS.md)."""

import shutil
import subprocess

import pytest

from server.app.config import REPO_ROOT

pytestmark = pytest.mark.skipif(
    shutil.which("git") is None or not (REPO_ROOT / ".git").exists(),
    reason="needs git and a checkout",
)

KEY_MATERIAL = [
    "certs/privkey.pem",
    "certs/fullchain.pem",
    "certs/origin.key",
    "certs/anything-at-all.txt",
    "privkey.pem",
    "deploy/server.key",
    "cloudflare-origin.crt",
    "site.p12",
    "site.pfx",
    ".env",
]


@pytest.mark.parametrize("path", KEY_MATERIAL)
def test_key_material_is_gitignored(path):
    result = subprocess.run(
        ["git", "check-ignore", "-q", "--no-index", path], cwd=REPO_ROOT, capture_output=True
    )
    assert result.returncode == 0, f"{path} is not gitignored"


def test_certs_dir_placeholder_is_tracked():
    result = subprocess.run(
        ["git", "check-ignore", "-q", "--no-index", "certs/.gitkeep"],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    assert result.returncode == 1, "certs/.gitkeep must stay committable"

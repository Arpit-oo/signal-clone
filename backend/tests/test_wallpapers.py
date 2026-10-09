import io

from PIL import Image

from tests.conftest import direct_chat


def image_bytes():
    stream = io.BytesIO()
    Image.new("RGB", (640, 360), "#abcdef").save(stream, "PNG")
    return stream.getvalue()


def test_wallpaper_is_private_persistent_and_resettable(alice, bob, carol):
    cid = direct_chat(alice, bob)
    url = f"/api/conversations/{cid}"
    assert alice.patch(f"{url}/settings", json={"wallpaper": "blue"}).json()["wallpaper"] == "blue"
    assert alice.get(url).json()["wallpaper"] == "blue"
    assert bob.get(url).json()["wallpaper"] is None
    assert carol.patch(f"{url}/settings", json={"wallpaper": "mint"}).status_code == 404
    assert (
        alice.patch(f"{url}/settings", json={"wallpaper": "https://evil.test"}).status_code == 422
    )
    result = alice.post(
        f"{url}/wallpaper", files={"file": ("landscape.png", image_bytes(), "image/png")}
    )
    assert result.status_code == 200
    assert result.json()["wallpaper"].startswith("wallpapers/")
    loaded = alice.get(f"{url}/wallpaper")
    assert loaded.status_code == 200 and loaded.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(loaded.content)).size == (640, 360)
    assert bob.get(f"{url}/wallpaper").status_code == 404
    assert carol.get(f"{url}/wallpaper").status_code == 404
    assert alice.patch(f"{url}/settings", json={"wallpaper": None}).json()["wallpaper"] is None
    assert alice.get(f"{url}/wallpaper").status_code == 404


def test_wallpaper_upload_validates_images_and_membership(alice, bob, carol):
    cid = direct_chat(alice, bob)
    url = f"/api/conversations/{cid}/wallpaper"
    assert (
        carol.post(url, files={"file": ("bg.png", image_bytes(), "image/png")}).status_code == 404
    )
    for filename, content, mime in [
        ("bg.svg", b"<svg></svg>", "image/svg+xml"),
        ("bg.jpg", b"bad image", "image/jpeg"),
        ("bg.png", b"", "image/png"),
    ]:
        assert alice.post(url, files={"file": (filename, content, mime)}).status_code == 400
    assert alice.get(f"/api/conversations/{cid}").json()["wallpaper"] is None

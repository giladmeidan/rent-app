"""`services/photos.py` `encode` (spec 0010d), unit: no database, no store. AC2, AC3's pixel cap,
format detection by the bytes, alpha, animated input, no upscaling."""

from io import BytesIO
from typing import Any, Literal, cast

import pytest
from PIL import Image, ImageCms, ImageFile, ImageStat

from app.services.photos import (
    LARGE_EDGE,
    SMALL_EDGE,
    PhotoTooLargeError,
    UnsupportedImageError,
    encode,
)
from tests.conftest import jpeg

_XMP = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/'
    b'22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/'
    b'1.0/" exif:GPSLatitude="32,4.8N"/></rdf:RDF></x:xmpmeta>'
)


def _open(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    image.load()
    return image


def _save(image: Image.Image, image_format: str, **params: Any) -> bytes:
    out = BytesIO()
    image.save(out, format=image_format, **params)
    return out.getvalue()


def _assert_no_metadata(data: bytes) -> None:
    image = _open(data)
    assert image.format == "WEBP"
    assert dict(image.getexif()) == {}
    assert not {"exif", "xmp", "icc_profile"} & set(image.info), image.info
    for marker in (b"EXIF", b"XMP ", b"ICCP", b"FakeCam", b"GPS"):
        assert marker not in data, marker


def test_ac2_strips_metadata_and_applies_orientation() -> None:
    # A landscape JPEG with GPS EXIF and Orientation 6 (rotate 90 degrees clockwise to view), plus
    # an ICC profile and XMP: all four must be gone, the rotation applied.
    source = _open(jpeg(800, 600, exif_gps=True, orientation=6))
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    data = _save(source, "JPEG", exif=source.getexif(), icc_profile=icc, xmp=_XMP)
    uploaded = _open(data)
    assert uploaded.getexif()[0x0112] == 6
    assert uploaded.getexif().get_ifd(0x8825)[1] == "N"
    assert {"icc_profile", "xmp"} <= set(uploaded.info)

    encoded = encode(data)

    for out in (encoded.small, encoded.large):
        _assert_no_metadata(out)
    large, small = _open(encoded.large), _open(encoded.small)
    assert large.size == (600, 800)  # portrait now; 800 is under 1600, so not upscaled
    assert small.size == (360, SMALL_EDGE)
    assert (encoded.width, encoded.height) == (600, 800)
    # Orientation 6 turns the top-left corner of the stored pixels into the top-right one: the
    # gradient's dark first row (the top) is now the right-hand column.
    gray = large.convert("L")
    assert cast(int, gray.getpixel((599, 400))) < cast(int, gray.getpixel((0, 400)))


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_ac3_pixel_cap_before_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    loads: list[object] = []
    real_load = ImageFile.ImageFile.load

    def spy(self: ImageFile.ImageFile) -> Any:
        loads.append(self)
        return real_load(self)

    # 50 MP (over the 40 MP cap, under Pillow's own 2x bomb limit) and 100 MP: small files.
    fifty = _save(Image.new("1", (10_000, 5_000)), "PNG")
    hundred = _save(Image.new("1", (10_000, 10_000)), "PNG")
    assert len(fifty) < 100_000
    monkeypatch.setattr(ImageFile.ImageFile, "load", spy)

    for data in (fifty, hundred):
        with pytest.raises(PhotoTooLargeError):
            encode(data)
    assert loads == []

    # Exactly at the cap is accepted (and only then decoded).
    encode(_save(Image.new("1", (8_000, 5_000)), "PNG"))
    assert loads


def test_format_is_detected_from_the_bytes_only() -> None:
    rgb = Image.new("RGB", (64, 48), (200, 30, 30))
    for image_format in ("PNG", "WEBP", "JPEG"):
        assert _open(encode(_save(rgb, image_format)).large).size == (64, 48)
    # Formats Pillow can read but the allow-list refuses, and things that are not images.
    refused = [_save(rgb, "GIF"), _save(rgb, "BMP"), _save(rgb, "TIFF"), _save(rgb, "PDF")]
    refused += [b"", b"\x89PNG\r\n\x1a\n", b"not an image at all", bytes(range(256)) * 8]
    full = jpeg()
    refused.append(full[: len(full) // 2])  # truncated JPEG
    for data in refused:
        with pytest.raises(UnsupportedImageError):
            encode(data)


@pytest.mark.filterwarnings("ignore:Corrupt EXIF data")
def test_corrupt_exif_is_never_a_crash() -> None:
    data = _save(_open(jpeg(64, 48)), "JPEG", exif=b"Exif\x00\x00MM\x00*\xff\xff\xff\xff")
    try:
        encoded = encode(data)
    except UnsupportedImageError:
        return
    _assert_no_metadata(encoded.large)


def test_rgba_png_keeps_alpha() -> None:
    image = Image.new("RGBA", (100, 50), (0, 128, 255, 0))
    image.paste((255, 0, 0, 255), (0, 0, 50, 50))
    # A palette PNG with a transparent index keeps alpha too.
    palette = image.convert("P", palette=Image.Palette.ADAPTIVE)
    palette.info["transparency"] = palette.getpixel((99, 0))
    for data in (_save(image, "PNG"), _save(palette, "PNG")):
        large = _open(encode(data).large)
        assert large.mode == "RGBA"
        assert large.getpixel((99, 0))[3] == 0  # type: ignore[index]
        assert large.getpixel((0, 0))[3] == 255  # type: ignore[index]
    opaque = _open(encode(_save(Image.new("RGB", (10, 10)), "PNG")).large)
    assert opaque.mode == "RGB"


def test_animated_webp_keeps_frame_zero() -> None:
    red = Image.new("RGB", (40, 30), (255, 0, 0))
    blue = Image.new("RGB", (40, 30), (0, 0, 255))
    data = _save(red, "WEBP", save_all=True, append_images=[blue], duration=100, lossless=True)
    assert getattr(_open(data), "n_frames", 1) == 2

    large = _open(encode(data).large)

    assert getattr(large, "n_frames", 1) == 1
    r, g, b = large.convert("RGB").getpixel((20, 15))  # type: ignore[misc]
    assert r > 200 and b < 60


def test_small_images_are_not_upscaled_and_large_ones_fit() -> None:
    small = encode(_save(Image.new("RGB", (300, 200)), "PNG"))
    assert _open(small.large).size == (300, 200)
    assert _open(small.small).size == (300, 200)
    assert (small.width, small.height) == (300, 200)

    big = encode(jpeg(2000, 3000))
    assert _open(big.large).size == (1067, LARGE_EDGE)
    assert _open(big.small).size == (320, SMALL_EDGE)
    assert (big.width, big.height) == (1067, LARGE_EDGE)


def test_only_the_three_plugins_open_uploads(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[list[str] | None] = []
    real_open = Image.open

    def spy(fp: Any, mode: Literal["r"] = "r", formats: list[str] | None = None) -> Image.Image:
        seen.append(formats)
        return real_open(fp, mode, formats)

    monkeypatch.setattr(Image, "open", spy)
    encode(jpeg(32, 32))
    assert seen == [["JPEG", "PNG", "WEBP"]]


def test_sixteen_bit_grayscale_is_scaled_not_clipped() -> None:
    data = _save(Image.new("I;16", (100, 100), 40000), "PNG")
    assert _open(data).mode == "I;16"

    large = _open(encode(data).large)

    mean = ImageStat.Stat(large.convert("L")).mean[0]
    assert abs(mean - 152) <= 20, mean  # 40000 / 256 = 156, not clipped to 255

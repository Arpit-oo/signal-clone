import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (
            '["https://frontend.example", "http://localhost:3000"]',
            ["https://frontend.example", "http://localhost:3000"],
        ),
        (
            " https://frontend.example/, http://localhost:3000, ",
            ["https://frontend.example", "http://localhost:3000"],
        ),
        (["https://frontend.example"], ["https://frontend.example"]),
    ],
)
def test_cors_configuration_accepts_json_csv_and_typed_values(monkeypatch, configured, expected):
    if isinstance(configured, str):
        monkeypatch.setenv("CORS_ORIGINS", configured)
        settings = Settings(_env_file=None)
    else:
        settings = Settings(_env_file=None, cors_origins=configured)
    assert settings.cors_origins == expected

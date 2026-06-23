import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from fastapi.security import HTTPBasicCredentials
from starlette.requests import Request

from app.auth import require_basic_auth
from app.config import get_settings


def request_for(path: str) -> Request:
    return Request({"type": "http", "method": "GET", "path": path, "headers": []})


class AuthTests(unittest.TestCase):
    def setUp(self):
        get_settings.cache_clear()
        self.env = patch.dict(
            os.environ,
            {
                "INKY_AUTH_USERNAME": "reader",
                "INKY_AUTH_PASSWORD": "secret",
            },
            clear=False,
        )
        self.env.start()
        get_settings.cache_clear()

    def tearDown(self):
        self.env.stop()
        get_settings.cache_clear()

    def test_unauthenticated_request_does_not_trigger_browser_basic_auth_prompt(self):
        with self.assertRaises(HTTPException) as caught:
            require_basic_auth(request_for("/api/library"), None)

        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(caught.exception.headers, None)

    def test_valid_credentials_pass(self):
        require_basic_auth(
            request_for("/api/library"),
            HTTPBasicCredentials(username="reader", password="secret"),
        )


if __name__ == "__main__":
    unittest.main()

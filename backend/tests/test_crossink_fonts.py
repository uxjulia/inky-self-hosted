import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.crossink_fonts import FONT_CATALOGS, CrossInkFontsError, parse_fonts


class CrossInkFontTests(unittest.TestCase):
    def test_parses_trusted_zip_packages(self):
        fonts = parse_fonts(
            [
                {
                    "type": "file",
                    "name": "Lexend Deca.zip",
                    "size": 1_782_064,
                    "download_url": "https://raw.githubusercontent.com/uxjulia/crossink-fonts/main/cpfonts/Lexend%20Deca.zip",
                },
                {"type": "dir", "name": "Lexend Deca"},
            ]
        )

        self.assertEqual(fonts[0].filename, "Lexend Deca.zip")
        self.assertEqual(fonts[0].size, 1_782_064)

    def test_rejects_untrusted_or_empty_package_lists(self):
        with self.assertRaises(CrossInkFontsError):
            parse_fonts(
                [
                    {
                        "type": "file",
                        "name": "Inter.zip",
                        "size": 10,
                        "download_url": "https://example.com/Inter.zip",
                    }
                ]
            )

    def test_parses_dictionary_font_packages_from_their_own_catalog(self):
        fonts = parse_fonts(
            [
                {
                    "type": "file",
                    "name": "Inter.zip",
                    "size": 2_645_440,
                    "download_url": "https://raw.githubusercontent.com/uxjulia/crossink-fonts/main/dictionary-fonts/Inter.zip",
                }
            ],
            FONT_CATALOGS["dictionary"],
        )

        self.assertEqual(fonts[0].filename, "Inter.zip")


if __name__ == "__main__":
    unittest.main()

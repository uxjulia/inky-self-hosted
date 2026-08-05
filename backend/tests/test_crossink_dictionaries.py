import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.crossink_dictionaries import CrossInkDictionariesError, parse_dictionaries


class CrossInkDictionaryTests(unittest.TestCase):
    def test_parses_manifest_metadata(self):
        dictionaries = parse_dictionaries(
            {
                "dictionaries": [
                    {
                        "filename": "Cambridge.zip",
                        "size": 16_684_207,
                        "description": "Learner-focused dictionary.",
                    }
                ]
            }
        )

        self.assertEqual(dictionaries[0].filename, "Cambridge.zip")
        self.assertEqual(dictionaries[0].size, 16_684_207)
        self.assertEqual(dictionaries[0].description, "Learner-focused dictionary.")
        self.assertEqual(
            dictionaries[0].download_url,
            "https://raw.githubusercontent.com/uxjulia/crossink-dictionaries/main/English/Cambridge.zip",
        )

    def test_parses_trusted_zip_packages(self):
        dictionaries = parse_dictionaries(
            [
                {
                    "type": "file",
                    "name": "Oxford English.zip",
                    "size": 11_602_309,
                    "download_url": "https://raw.githubusercontent.com/uxjulia/crossink-dictionaries/main/English/Oxford%20English.zip",
                },
                {"type": "dir", "name": "sources"},
            ]
        )

        self.assertEqual(dictionaries[0].filename, "Oxford English.zip")
        self.assertEqual(dictionaries[0].size, 11_602_309)

    def test_rejects_untrusted_or_empty_package_lists(self):
        with self.assertRaises(CrossInkDictionariesError):
            parse_dictionaries(
                [
                    {
                        "type": "file",
                        "name": "Oxford English.zip",
                        "size": 10,
                        "download_url": "https://example.com/Oxford%20English.zip",
                    }
                ]
            )


if __name__ == "__main__":
    unittest.main()

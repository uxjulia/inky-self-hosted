import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.optimizer.epubkit_pipeline.metadata_handler import format_filename
from app.utils import safe_filename


class FilenameSanitizingTests(unittest.TestCase):
    def test_safe_filename_preserves_apostrophes_like_browser(self):
        self.assertEqual(safe_filename("O'Brian.epub"), "O'Brian.epub")

    def test_safe_filename_replaces_only_browser_invalid_characters(self):
        self.assertEqual(safe_filename('A/B:C*D?E"F<G>H|I.epub'), "A B C D E F G H I.epub")

    def test_optimizer_filename_preserves_apostrophes(self):
        self.assertEqual(format_filename("The Book", "O'Brian", "title-author"), "The Book - O'Brian.epub")


if __name__ == "__main__":
    unittest.main()

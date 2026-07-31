from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.connectors import browse_feed
from app.models import Source


class FeedBrowseTests(unittest.IsolatedAsyncioTestCase):
    async def test_epub_enclosure_is_a_book_and_prefers_compatible_variant(self):
        source = Source(id=1, type="feed", name="Standard Ebooks", url="https://example.com/feed")
        feed = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Books</title>
  <entry>
    <title>The Example Book</title>
    <author><name>Example Author</name></author>
    <link href="https://example.com/books/example" rel="alternate" type="application/xhtml+xml"/>
    <link href="https://example.com/books/example_advanced.epub" rel="enclosure" title="Advanced epub" type="application/epub+zip" length="900"/>
    <link href="https://example.com/books/example.epub" rel="enclosure" title="Recommended compatible epub" type="application/epub+zip" length="700"/>
  </entry>
</feed>"""

        with patch("app.connectors._fetch_text", new=AsyncMock(return_value=feed)):
            result = await browse_feed(source)

        self.assertEqual(len(result.items), 1)
        item = result.items[0]
        self.assertEqual(item.type, "book")
        self.assertEqual(item.url, "https://example.com/books/example.epub")
        self.assertEqual(item.author, "Example Author")
        self.assertEqual(item.media_type, "application/epub+zip")
        self.assertEqual(item.size, 700)

    async def test_regular_feed_entry_remains_an_article(self):
        source = Source(id=1, type="feed", name="News", url="https://example.com/feed")
        feed = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>News</title>
  <entry>
    <title>An Article</title>
    <link href="https://example.com/article" rel="alternate" type="text/html"/>
  </entry>
</feed>"""

        with patch("app.connectors._fetch_text", new=AsyncMock(return_value=feed)):
            result = await browse_feed(source)

        self.assertEqual(result.items[0].type, "article")
        self.assertEqual(result.items[0].url, "https://example.com/article")


if __name__ == "__main__":
    unittest.main()

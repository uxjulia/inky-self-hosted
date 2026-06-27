import json
import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parents[1] / 'app' / 'optimizer' / 'epubkit_pipeline'
sys.path.insert(0, str(PIPELINE_DIR))

from epub_structure import write_x_location_manifest  # noqa: E402
from section_splitter import _split_xhtml_file  # noqa: E402


class SectionSplitterTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix='inky_split_test_'))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_chapter_heading_image_stays_with_first_text_part(self):
        chapter_path = self.tmpdir / 'chapter.xhtml'
        paragraphs = '\n'.join(
            f'<p>{" ".join(f"word{i}_{j}" for j in range(10))}</p>'
            for i in range(6)
        )
        chapter_path.write_text(
            textwrap.dedent(
                f"""
                <html xmlns="http://www.w3.org/1999/xhtml">
                  <head><title>Chapter</title></head>
                  <body>
                    <div id="filepos2977"/>
                    <h2 id="chapter-start"><span>&#160;</span></h2>
                    <p><img alt="" src="../Images/chapter-heading.jpg"/></p>
                    <div class="chapter">
                      {paragraphs}
                    </div>
                  </body>
                </html>
                """
            ).strip(),
            encoding='utf-8',
        )

        result = _split_xhtml_file(chapter_path, 20)

        self.assertGreater(len(result.parts), 1)
        first_part = result.parts[0].read_text(encoding='utf-8')
        second_part = result.parts[1].read_text(encoding='utf-8')
        self.assertIn('../Images/chapter-heading.jpg', first_part)
        self.assertIn('word0_0', first_part)
        self.assertNotIn('../Images/chapter-heading.jpg', second_part)

    def test_location_manifest_uses_custom_words_per_reference_page(self):
        opf_dir = self.tmpdir / 'OEBPS'
        opf_dir.mkdir()
        opf_path = opf_dir / 'content.opf'
        chapter_path = opf_dir / 'chapter.xhtml'
        chapter_path.write_text(
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            f'<p>{" ".join(f"word{i}" for i in range(275))}</p>'
            '</body></html>',
            encoding='utf-8',
        )
        opf_path.write_text(
            textwrap.dedent(
                """
                <?xml version="1.0" encoding="utf-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
                  <manifest>
                    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
                  </manifest>
                  <spine>
                    <itemref idref="chapter"/>
                  </spine>
                </package>
                """
            ).strip(),
            encoding='utf-8',
        )

        locations, reference_pages = write_x_location_manifest(str(self.tmpdir), str(opf_path), 100)

        manifest = json.loads((self.tmpdir / 'META-INF' / 'x-locations.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['wordsPerReferencePage'], 100)
        self.assertEqual(reference_pages, 3)
        self.assertEqual(locations, manifest['totalLocations'])


if __name__ == '__main__':
    unittest.main()

import json
import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parents[1] / 'app' / 'optimizer' / 'epubkit_pipeline'
sys.path.insert(0, str(PIPELINE_DIR))

from epub_structure import split_long_sections, write_x_location_manifest  # noqa: E402


class XLocationManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix='inky_split_test_'))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_location_manifest_uses_custom_characters_per_reference_page(self):
        opf_dir = self.tmpdir / 'OEBPS'
        opf_dir.mkdir()
        opf_path = opf_dir / 'content.opf'
        chapter_path = opf_dir / 'chapter.xhtml'
        chapter_path.write_text(
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            f'<p>{"a" * 250}</p>'
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
        self.assertEqual(manifest['charactersPerReferencePage'], 100)
        self.assertEqual(manifest['totalCharacters'], 250)
        self.assertEqual(reference_pages, 3)
        self.assertEqual(locations, manifest['totalLocations'])

    def test_large_spine_section_is_split_by_uncompressed_size(self):
        opf_dir = self.tmpdir / 'OEBPS'
        opf_dir.mkdir()
        opf_path = opf_dir / 'content.opf'
        chapter_path = opf_dir / 'chapter.xhtml'
        chapter_path.write_text(
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            '<p>one two three four</p>'
            '<p>five six seven eight</p>'
            '<p>nine ten eleven twelve</p>'
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

        sections_split, split_parts = split_long_sections(
            str(opf_path),
            word_threshold=50000,
            byte_threshold=40,
            hard_byte_limit=1024 * 1024,
        )

        self.assertEqual(sections_split, 1)
        self.assertEqual(split_parts, 3)
        self.assertTrue((opf_dir / 'chapter__ci_section_002.xhtml').exists())
        self.assertTrue((opf_dir / 'chapter__ci_section_003.xhtml').exists())
        updated_opf = opf_path.read_text(encoding='utf-8')
        self.assertIn('href="chapter__ci_section_002.xhtml"', updated_opf)
        self.assertIn('href="chapter__ci_section_003.xhtml"', updated_opf)
        self.assertEqual(updated_opf.count('<itemref'), 3)


if __name__ == '__main__':
    unittest.main()

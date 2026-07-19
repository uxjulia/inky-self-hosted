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
            '<div class="chapter">'
            f'<p>{"a" * 12000}</p>'
            f'<div class="table"><table><tr><td>{"b" * 12000}</td></tr></table></div>'
            f'<p>{"c" * 12000}</p>'
            '</div>'
            '</body></html>',
            encoding='utf-8',
        )
        (opf_dir / 'cover.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding='utf-8')
        opf_path.write_text(
            textwrap.dedent(
                """
                <?xml version="1.0" encoding="utf-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
                  <manifest>
                    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
                    <item id="cover" href="cover.svg" media-type="image/svg+xml"/>
                  </manifest>
                  <spine>
                    <itemref idref="chapter"/>
                    <itemref idref="cover"/>
                  </spine>
                </package>
                """
            ).strip(),
            encoding='utf-8',
        )

        source_spine_map = {}
        sections_split, split_parts = split_long_sections(str(opf_path), source_spine_map=source_spine_map)

        self.assertEqual(sections_split, 1)
        self.assertEqual(split_parts, 2)
        self.assertTrue((opf_dir / 'chapter__ci_section_002.xhtml').exists())
        self.assertFalse((opf_dir / 'chapter__ci_section_003.xhtml').exists())
        for name in ('chapter.xhtml', 'chapter__ci_section_002.xhtml'):
            part_path = opf_dir / name
            self.assertIn('class="chapter"', part_path.read_text(encoding='utf-8'))
            self.assertLessEqual(part_path.stat().st_size, 32768)
        self.assertIn('<table>', chapter_path.read_text(encoding='utf-8'))
        self.assertNotIn('<table>', (opf_dir / 'chapter__ci_section_002.xhtml').read_text(encoding='utf-8'))
        updated_opf = opf_path.read_text(encoding='utf-8')
        self.assertIn('href="chapter__ci_section_002.xhtml"', updated_opf)
        self.assertNotIn('href="chapter__ci_section_003.xhtml"', updated_opf)
        self.assertEqual(updated_opf.count('<itemref'), 3)
        write_x_location_manifest(str(self.tmpdir), str(opf_path), source_spine_map=source_spine_map)
        manifest = json.loads((self.tmpdir / 'META-INF' / 'x-locations.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['sourceSpineMap']['spineCount'], 2)
        self.assertEqual([entry['sourceSpineIndex'] for entry in manifest['sourceSpineMap']['spine']], [0, 0, 1])
        self.assertEqual(manifest['sourceSpineMap']['spine'][1]['containerDepth'], 1)


if __name__ == '__main__':
    unittest.main()

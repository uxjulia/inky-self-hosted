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


if __name__ == '__main__':
    unittest.main()

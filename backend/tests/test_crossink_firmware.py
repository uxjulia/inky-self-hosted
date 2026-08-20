import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.crossink_firmware import (
    CrossInkFirmwareError,
    DEV_FIRMWARE_DIR_ENV,
    LOCAL_DEVELOPMENT_TAG,
    get_local_development_release,
    parse_prerelease_releases,
    parse_stable_release,
    parse_stable_releases,
)


class CrossInkFirmwareTests(unittest.TestCase):
    def test_exposes_local_x4_pro_image_only_when_opted_in(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            firmware_path = Path(temporary_dir) / "firmware-x4-pro.bin"
            firmware_path.write_bytes(b"test firmware")

            with patch.dict("os.environ", {DEV_FIRMWARE_DIR_ENV: temporary_dir}, clear=False):
                local_release = get_local_development_release()

        self.assertIsNotNone(local_release)
        release, path = local_release
        self.assertEqual(release.tag, LOCAL_DEVELOPMENT_TAG)
        self.assertEqual(set(release.assets), {"x4-pro"})
        self.assertEqual(path, firmware_path)
        self.assertEqual(release.assets["x4-pro"].size, len(b"test firmware"))

    def test_hides_local_x4_pro_image_without_development_directory(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertIsNone(get_local_development_release())

    def test_parses_supported_stable_variants(self):
        release = parse_stable_release(
            {
                "tag_name": "v1.4.0",
                "published_at": "2026-07-10T13:40:02Z",
                "html_url": "https://github.com/uxjulia/CrossInk/releases/tag/v1.4.0",
                "assets": [
                    {
                        "name": "firmware-tiny-v1.4.0.bin",
                        "size": 5_491_200,
                        "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/firmware-tiny-v1.4.0.bin",
                    },
                    {
                        "name": "firmware-xlarge-v1.4.0.bin",
                        "size": 5_354_096,
                        "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/firmware-xlarge-v1.4.0.bin",
                    },
                    {
                        "name": "firmware-sticky-v1.4.0.bin",
                        "size": 5_200_000,
                        "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/firmware-sticky-v1.4.0.bin",
                    },
                    {
                        "name": "firmware-x4-pro-v1.4.0.bin",
                        "size": 5_466_576,
                        "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/firmware-x4-pro-v1.4.0.bin",
                    },
                    {
                        "name": "Bitter.zip",
                        "size": 100,
                        "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/Bitter.zip",
                    },
                ],
            }
        )

        self.assertEqual(release.tag, "v1.4.0")
        self.assertEqual(set(release.assets), {"tiny", "xlarge", "x4-pro", "sticky"})
        self.assertEqual(release.assets["xlarge"].filename, "firmware-xlarge-v1.4.0.bin")
        self.assertEqual(release.assets["x4-pro"].filename, "firmware-x4-pro-v1.4.0.bin")

    def test_rejects_untrusted_asset_urls(self):
        with self.assertRaises(CrossInkFirmwareError):
            parse_stable_release(
                {
                    "tag_name": "v1.4.0",
                    "assets": [
                        {
                            "name": "firmware-tiny-v1.4.0.bin",
                            "size": 10,
                            "browser_download_url": "https://example.com/firmware-tiny-v1.4.0.bin",
                        }
                    ],
                }
            )

    def test_ignores_similarly_named_non_firmware_assets(self):
        with self.assertRaises(CrossInkFirmwareError):
            parse_stable_release(
                {
                    "tag_name": "v1.4.0",
                    "assets": [
                        {
                            "name": "firmware-tiny-v1.4.0.bin.old",
                            "size": 10,
                            "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/firmware-tiny-v1.4.0.bin.old",
                        }
                    ],
                }
            )

    def test_returns_only_the_three_latest_usable_stable_releases(self):
        def release(tag: str, *, draft: bool = False, prerelease: bool = False, valid: bool = True) -> dict:
            filename = f"firmware-tiny-{tag}.bin" if valid else "notes.txt"
            return {
                "tag_name": tag,
                "draft": draft,
                "prerelease": prerelease,
                "assets": [
                    {
                        "name": filename,
                        "size": 10,
                        "browser_download_url": f"https://github.com/uxjulia/CrossInk/releases/download/{tag}/{filename}",
                    }
                ],
            }

        releases = parse_stable_releases(
            [
                release("v2.0.0", draft=True),
                release("v1.5.0", prerelease=True),
                release("v1.4.0"),
                release("v1.3.5", valid=False),
                release("v1.3.4"),
                release("v1.3.3"),
                release("v1.3.2"),
            ]
        )

        self.assertEqual([item.tag for item in releases], ["v1.4.0", "v1.3.4", "v1.3.3"])

    def test_returns_prereleases_with_release_candidate_filenames(self):
        def release(tag: str, *, draft: bool = False, prerelease: bool = True) -> dict:
            filenames = [
                "firmware-sticky-v1.5.0-c1e63f8-RC.bin",
                "firmware-x3-x4-v1.5.0-c1e63f8-RC.bin",
                "firmware-x4-pro-v1.5.0-c1e63f8-RC.bin",
            ]
            return {
                "tag_name": tag,
                "draft": draft,
                "prerelease": prerelease,
                "assets": [
                    {
                        "name": filename,
                        "size": 10,
                        "browser_download_url": f"https://github.com/uxjulia/CrossInk/releases/download/{tag}/{filename}",
                    }
                    for filename in filenames
                ],
            }

        releases = parse_prerelease_releases(
            [
                release("rc-development-deadbee", draft=True),
                release("rc-development-a1b2c3d"),
                release("v1.4.0", prerelease=False),
            ]
        )

        self.assertEqual([item.tag for item in releases], ["rc-development-a1b2c3d"])
        self.assertEqual(set(releases[0].assets), {"sticky", "x3-x4", "x4-pro"})
        self.assertEqual(
            releases[0].assets["sticky"].filename,
            "firmware-sticky-v1.5.0-c1e63f8-RC.bin",
        )
        self.assertEqual(
            releases[0].assets["x3-x4"].filename,
            "firmware-x3-x4-v1.5.0-c1e63f8-RC.bin",
        )
        self.assertEqual(
            releases[0].assets["x4-pro"].filename,
            "firmware-x4-pro-v1.5.0-c1e63f8-RC.bin",
        )

    def test_ignores_non_release_candidate_filenames_in_prereleases(self):
        releases = parse_prerelease_releases(
            [
                {
                    "tag_name": "rc-development-a1b2c3d",
                    "prerelease": True,
                    "assets": [
                        {
                            "name": "firmware-sticky-development-a1b2c3d.bin",
                            "size": 10,
                            "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/rc-development-a1b2c3d/firmware-sticky-development-a1b2c3d.bin",
                        }
                    ],
                }
            ]
        )

        self.assertEqual(releases, ())

if __name__ == "__main__":
    unittest.main()

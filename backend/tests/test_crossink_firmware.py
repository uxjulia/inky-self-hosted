import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.crossink_firmware import (
    CrossInkFirmwareError,
    build_sticky_beta_release,
    parse_prerelease_releases,
    parse_stable_release,
    parse_stable_releases,
)


class CrossInkFirmwareTests(unittest.TestCase):
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
                        "name": "Bitter.zip",
                        "size": 100,
                        "browser_download_url": "https://github.com/uxjulia/CrossInk/releases/download/v1.4.0/Bitter.zip",
                    },
                ],
            }
        )

        self.assertEqual(release.tag, "v1.4.0")
        self.assertEqual(set(release.assets), {"tiny", "xlarge", "sticky"})
        self.assertEqual(release.assets["xlarge"].filename, "firmware-xlarge-v1.4.0.bin")

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
            filename = f"firmware-tiny-{tag.removeprefix('rc-')}-RC.bin"
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

        releases = parse_prerelease_releases(
            [
                release("rc-development-deadbee", draft=True),
                release("rc-development-a1b2c3d"),
                release("v1.4.0", prerelease=False),
            ]
        )

        self.assertEqual([item.tag for item in releases], ["rc-development-a1b2c3d"])
        self.assertIn("tiny", releases[0].assets)

    def test_builds_sticky_beta_release_from_trusted_r2_url(self):
        release = build_sticky_beta_release(
            "https://downloads.crossink.dev/firmwares/sticky/firmware-sticky.bin",
            "Sticky Beta",
            5_785_312,
        )

        self.assertEqual(release.tag, "Sticky Beta")
        self.assertEqual(release.assets["sticky"].filename, "firmware-sticky.bin")
        self.assertEqual(release.assets["sticky"].size, 5_785_312)

    def test_rejects_untrusted_sticky_beta_url(self):
        with self.assertRaises(CrossInkFirmwareError):
            build_sticky_beta_release(
                "https://example.com/firmware-sticky.bin",
                "Sticky Beta",
                5_785_312,
            )


if __name__ == "__main__":
    unittest.main()

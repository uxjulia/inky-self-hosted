import io
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.optimizer.epubkit_pipeline.image_processor import ImageOptions, process_image


def write_color_jpeg() -> bytes:
    image = Image.new("RGB", (64, 64), (230, 20, 20))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=10, progressive=False, optimize=True)
    return buffer.getvalue()


class ImageProcessorTests(unittest.TestCase):
    def test_grayscale_request_does_not_keep_smaller_color_jpeg(self):
        original = write_color_jpeg()

        result = process_image(
            original,
            "cover.jpg",
            ImageOptions(
                grayscale=True,
                contrast_boost=True,
                contrast_factor=1.2,
                quality=70,
                max_width=1000,
                max_height=1000,
                eink_quantize=True,
            ),
        )[0]

        self.assertTrue(result.was_converted)
        self.assertNotEqual(result.output_bytes, original)
        output = Image.open(io.BytesIO(result.output_bytes)).convert("RGB")
        red, green, blue = output.getpixel((0, 0))
        self.assertLessEqual(max(red, green, blue) - min(red, green, blue), 2)

    def test_safe_jpeg_size_shortcut_still_applies_without_visual_transforms(self):
        original = write_color_jpeg()

        result = process_image(
            original,
            "cover.jpg",
            ImageOptions(
                grayscale=False,
                contrast_boost=False,
                quality=70,
                max_width=1000,
                max_height=1000,
                eink_quantize=False,
            ),
        )[0]

        self.assertFalse(result.was_converted)
        self.assertEqual(result.output_bytes, original)

    def test_color_cover_is_resized_as_a_baseline_jpeg_without_grayscale(self):
        image = Image.new("RGB", (1800, 2400), (230, 20, 20))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")

        result = process_image(
            buffer.getvalue(),
            "cover.png",
            ImageOptions(
                grayscale=False,
                contrast_boost=False,
                quality=70,
                max_width=600,
                max_height=800,
                eink_quantize=False,
            ),
        )[0]

        output = Image.open(io.BytesIO(result.output_bytes))
        self.assertEqual(output.format, "JPEG")
        self.assertFalse(output.info.get("progressive", False))
        self.assertLessEqual(output.width, 600)
        self.assertLessEqual(output.height, 800)
        red, green, blue = output.convert("RGB").getpixel((0, 0))
        self.assertGreater(red - max(green, blue), 100)


if __name__ == "__main__":
    unittest.main()

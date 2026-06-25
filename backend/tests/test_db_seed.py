import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings


class DbSeedTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory(prefix="inky_db_seed_")
        db_path = Path(self.tmpdir.name) / "inky.db"
        self.env = patch.dict(
            os.environ,
            {
                "INKY_DATABASE_URL": f"sqlite:///{db_path}",
                "INKY_DATA_DIR": self.tmpdir.name,
            },
            clear=False,
        )
        self.env.start()
        get_settings.cache_clear()

    def tearDown(self):
        import app.db as db_module

        db_module.engine.dispose()
        self.env.stop()
        get_settings.cache_clear()
        self.tmpdir.cleanup()

    def reload_db_module(self):
        import app.db as db_module

        db_module.engine.dispose()
        return importlib.reload(db_module)

    def test_seeds_default_sources_on_empty_db(self):
        db_module = self.reload_db_module()
        db_module.init_db()

        with db_module.Session(db_module.engine) as db:
            sources = db.query(db_module.Source).order_by(db_module.Source.display_order.asc()).all()

        self.assertEqual([source.name for source in sources], ["Mayberry", "Standard Ebooks", "Project Gutenberg"])

    def test_adds_missing_defaults_to_existing_db_without_removing_user_sources(self):
        db_module = self.reload_db_module()
        db_module.Base.metadata.create_all(bind=db_module.engine)
        with db_module.Session(db_module.engine) as db:
            db.add(db_module.Source(type="opds", name="Custom", url="https://example.com/opds", display_order=0))
            db.commit()

        db_module.init_db()

        with db_module.Session(db_module.engine) as db:
            sources = db.query(db_module.Source).order_by(db_module.Source.display_order.asc()).all()

        self.assertEqual([source.name for source in sources], ["Custom", "Mayberry", "Standard Ebooks", "Project Gutenberg"])

    def test_does_not_duplicate_existing_default_sources(self):
        db_module = self.reload_db_module()
        db_module.init_db()
        db_module.init_db()

        with db_module.Session(db_module.engine) as db:
            sources = db.query(db_module.Source).order_by(db_module.Source.display_order.asc()).all()

        self.assertEqual([source.name for source in sources], ["Mayberry", "Standard Ebooks", "Project Gutenberg"])


if __name__ == "__main__":
    unittest.main()

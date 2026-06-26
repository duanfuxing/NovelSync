import os
import sys
import tempfile
import unittest

from sqlalchemy import create_engine, text


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class DatabaseMigrationTest(unittest.TestCase):
    def test_legacy_client_with_watch_path_enables_novel_sync_when_column_is_added(self):
        import storage.database as database
        import storage.models  # noqa: F401 - register SQLModel metadata

        original_engine = database.engine
        with tempfile.TemporaryDirectory() as tmpdir:
            test_engine = create_engine(f"sqlite:///{os.path.join(tmpdir, 'legacy.db')}")
            database.engine = test_engine
            try:
                with test_engine.connect() as conn:
                    conn.execute(text("""
                        CREATE TABLE client_config (
                            id INTEGER PRIMARY KEY,
                            uid TEXT,
                            token TEXT NOT NULL,
                            client_id TEXT NOT NULL,
                            watch_path TEXT
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO client_config (id, uid, token, client_id, watch_path)
                        VALUES
                            (1, 'u1', 'token-1', 'client-1', '/legacy/watch'),
                            (2, 'u2', 'token-2', 'client-2', NULL)
                    """))
                    conn.commit()

                database._auto_migrate()

                with test_engine.connect() as conn:
                    rows = conn.execute(text("""
                        SELECT client_id, novel_sync_enabled
                        FROM client_config
                        ORDER BY id
                    """)).fetchall()

                self.assertEqual(rows[0], ("client-1", 1))
                self.assertEqual(rows[1], ("client-2", 0))
            finally:
                database.engine = original_engine

    def test_existing_legacy_client_with_watch_path_is_enabled_once(self):
        import storage.database as database
        import storage.models  # noqa: F401 - register SQLModel metadata

        original_engine = database.engine
        with tempfile.TemporaryDirectory() as tmpdir:
            test_engine = create_engine(f"sqlite:///{os.path.join(tmpdir, 'legacy.db')}")
            database.engine = test_engine
            try:
                with test_engine.connect() as conn:
                    conn.execute(text("""
                        CREATE TABLE client_config (
                            id INTEGER PRIMARY KEY,
                            uid TEXT,
                            token TEXT NOT NULL,
                            client_id TEXT NOT NULL,
                            watch_path TEXT,
                            novel_sync_enabled INTEGER DEFAULT 0
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO client_config (id, uid, token, client_id, watch_path, novel_sync_enabled)
                        VALUES (1, 'u1', 'token-1', 'client-1', '/legacy/watch', 0)
                    """))
                    conn.commit()

                database._auto_migrate()
                database._run_data_migrations()

                with test_engine.connect() as conn:
                    enabled = conn.execute(text("""
                        SELECT novel_sync_enabled
                        FROM client_config
                        WHERE client_id = 'client-1'
                    """)).scalar_one()
                    self.assertEqual(enabled, 1)

                    conn.execute(text("""
                        UPDATE client_config
                        SET novel_sync_enabled = 0
                        WHERE client_id = 'client-1'
                    """))
                    conn.commit()

                database._run_data_migrations()

                with test_engine.connect() as conn:
                    enabled = conn.execute(text("""
                        SELECT novel_sync_enabled
                        FROM client_config
                        WHERE client_id = 'client-1'
                    """)).scalar_one()
                    self.assertEqual(enabled, 0)
            finally:
                database.engine = original_engine


if __name__ == "__main__":
    unittest.main()

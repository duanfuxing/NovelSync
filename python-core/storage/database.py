import os
import sys
from sqlmodel import SQLModel, create_engine


def _get_data_dir() -> str:
    """
    确定数据库文件存储目录。
    - 打包后（frozen）：用户持久化目录（macOS: ~/Library/Application Support/NovelSync）
    - 开发环境：python-core/data/
    """
    if getattr(sys, 'frozen', False):
        # 打包后：用系统标准的应用数据目录
        if sys.platform == 'darwin':
            base = os.path.expanduser("~/Library/Application Support/NovelSync")
        elif sys.platform == 'win32':
            base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "NovelSync")
        else:
            base = os.path.join(os.path.expanduser("~"), ".novelsync")
    else:
        # 开发环境：python-core/data/
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

    os.makedirs(base, exist_ok=True)
    return base


_DATA_DIR = _get_data_dir()
DB_FILENAME = os.path.join(_DATA_DIR, "novelsync.db")

# 开启 check_same_thread=False 并在连接后执行 PRAGMA journal_mode=WAL 满足并发。
engine = create_engine(
    f"sqlite:///{DB_FILENAME}",
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 5}
)

def _get_sqlite_type(sa_type) -> str:
    """将 SQLAlchemy 列类型映射为 SQLite 类型字符串"""
    type_name = type(sa_type).__name__.upper()
    mapping = {
        "INTEGER": "INTEGER",
        "VARCHAR": "TEXT",
        "TEXT": "TEXT",
        "FLOAT": "REAL",
        "BOOLEAN": "INTEGER",
        "DATETIME": "TIMESTAMP",
        "DATE": "DATE",
        "NUMERIC": "NUMERIC",
    }
    return mapping.get(type_name, "TEXT")


def _auto_migrate():
    """
    自动迁移：对比 models 定义和实际 SQLite 表结构，
    用 ALTER TABLE ADD COLUMN 补齐缺失字段。
    已有数据不受影响，用户无感知。
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    for table_name, table in SQLModel.metadata.tables.items():
        if table_name not in existing_tables:
            # 新表，create_all 会处理
            continue

        # 检测主键是否变更（如单主键→联合主键）
        model_pk_cols = sorted([col.name for col in table.primary_key.columns])
        db_pk_cols = sorted(inspector.get_pk_constraint(table_name).get("constrained_columns", []))
        if model_pk_cols != db_pk_cols:
            print(f"[DB Migration] 表 {table_name} 主键变更: {db_pk_cols} → {model_pk_cols}，重建表")
            with engine.connect() as conn:
                conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}"'))
                conn.commit()
            # create_all 会在后面重建
            continue

        # 获取已有列名集合
        existing_columns = {col["name"] for col in inspector.get_columns(table_name)}

        # 对比 model 定义的列
        for column in table.columns:
            if column.name in existing_columns:
                continue

            # 构造 ALTER TABLE ADD COLUMN
            col_type = _get_sqlite_type(column.type)
            nullable = column.nullable
            default = column.default

            ddl = f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {col_type}'

            if default is not None and default.arg is not None:
                default_val = default.arg
                if callable(default_val):
                    # default_factory 类型，无法直接用在 DDL 里，设 NULL
                    pass
                elif isinstance(default_val, str):
                    ddl += f" DEFAULT '{default_val}'"
                else:
                    ddl += f" DEFAULT {default_val}"
            elif not nullable:
                # NOT NULL 但没有 default，SQLite 要求必须有 default
                if col_type == "INTEGER":
                    ddl += " DEFAULT 0"
                else:
                    ddl += " DEFAULT ''"

            with engine.connect() as conn:
                conn.execute(text(ddl))
                conn.commit()
            print(f"[DB Migration] 表 {table_name} 新增字段: {column.name} ({col_type})")

    print("[DB Migration] Schema 检查完成")


def init_db():
    from .models import ClientConfig, UserProfile, ClientBjhCookie, ClientArticle, ClientOrder, ClientBooksSyncTask, WorkerStatus
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
        conn.exec_driver_sql("PRAGMA synchronous=NORMAL;")
        conn.exec_driver_sql("PRAGMA busy_timeout=5000;")

    # 1. 先创建不存在的新表
    SQLModel.metadata.create_all(engine)

    # 2. 检测主键变更（可能 DROP 旧表）+ 补齐缺失字段
    _auto_migrate()

    # 3. 再次 create_all，重建被 DROP 的表
    SQLModel.metadata.create_all(engine)

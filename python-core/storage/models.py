from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime

class ClientConfig(SQLModel, table=True):
    __tablename__ = "client_config"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: Optional[str] = Field(default=None, unique=True)
    token: str
    client_id: str
    watch_path: Optional[str] = None
    novel_sync_enabled: int = Field(default=0)
    material_output_dir: Optional[str] = None
    nick_name: Optional[str] = None
    avatar: Optional[str] = None
    phone: Optional[str] = None
    vip_level: int = Field(default=0)

class UserProfile(SQLModel, table=True):
    """登录用户信息表，以 phone 为主键，支持多用户切换时保留历史数据"""
    __tablename__ = "user_profiles"
    phone: str = Field(primary_key=True)
    uid: Optional[str] = None
    nick_name: Optional[str] = None
    avatar: Optional[str] = None
    vip_level: int = Field(default=0)
    last_login_at: Optional[datetime] = None
    is_active: int = Field(default=1)

class ClientBjhCookie(SQLModel, table=True):
    __tablename__ = "client_bjh_cookies"
    user_phone: str = Field(primary_key=True)
    bjh_id: str = Field(primary_key=True)
    bjh_name: str
    bjh_avatar: Optional[str] = None
    cookie_str: str
    status: int = Field(default=1)
    last_used: Optional[datetime] = None

class ClientArticle(SQLModel, table=True):
    __tablename__ = "client_articles"
    article_id: str = Field(primary_key=True)
    user_phone: str = Field(default="")
    nid: Optional[str] = None
    title: Optional[str] = None
    abstract: Optional[str] = None
    feed_id: Optional[str] = None
    app_id: Optional[str] = None
    story_type: Optional[str] = None
    url: Optional[str] = None
    vertical_cover: Optional[str] = None
    status: Optional[str] = None
    type: Optional[str] = None
    is_published: int = Field(default=0)
    is_pay_subscribe: int = Field(default=0)
    publish_time: Optional[datetime] = None
    sync_status: int = Field(default=0)
    last_update: Optional[datetime] = None

class ClientOrder(SQLModel, table=True):
    __tablename__ = "client_orders"
    nid: str = Field(primary_key=True)
    user_phone: str = Field(default="")
    title: Optional[str] = None
    status: Optional[str] = None
    order_amount: int = Field(default=0)
    read_amount: int = Field(default=0)
    rec_count: int = Field(default=0)
    comment_amount: int = Field(default=0)
    like_amount: int = Field(default=0)
    collection_amount: int = Field(default=0)
    share_amount: int = Field(default=0)
    is_hot: int = Field(default=0)
    is_pay_subscribe: int = Field(default=1)
    sync_status: int = Field(default=0)
    last_update: Optional[datetime] = None

class ClientBooksSyncTask(SQLModel, table=True):
    __tablename__ = "client_books_sync_tasks"
    file_hash: str = Field(primary_key=True)
    user_phone: str = Field(default="")
    nid: Optional[str] = None
    novel_id: Optional[str] = None
    title: Optional[str] = None
    local_path: Optional[str] = None
    file_size: Optional[int] = None
    word_count: int = Field(default=0)
    sync_status: Optional[str] = None
    error_msg: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class WorkerStatus(SQLModel, table=True):
    __tablename__ = "worker_status"
    worker_name: str = Field(primary_key=True)
    status: str = Field(default="idle")
    last_run_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    message: Optional[str] = None
    updated_at: Optional[datetime] = None

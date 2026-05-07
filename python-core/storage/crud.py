from sqlmodel import Session, select, func, col
from storage.database import engine
from storage.models import ClientConfig, UserProfile, ClientBjhCookie, ClientArticle, ClientOrder, ClientBooksSyncTask, WorkerStatus
from datetime import datetime


def upsert_client_config(
    client_id: str,
    token: str,
    uid: str = None,
    nick_name: str = None,
    avatar: str = None,
    phone: str = None,
    vip_level: int = 0,
):
    """
    持久化应用授权状态 + 用户 Profile
    登录成功时由代理层调用，将妙笔返回的完整信息写盘锁入。
    """
    with Session(engine) as session:
        statement = select(ClientConfig).where(ClientConfig.client_id == client_id)
        config = session.exec(statement).first()

        if config:
            config.token = token
            config.uid = uid
            config.nick_name = nick_name
            config.avatar = avatar
            config.phone = phone
            config.vip_level = vip_level
            session.add(config)
        else:
            new_config = ClientConfig(
                client_id=client_id,
                token=token,
                uid=uid,
                nick_name=nick_name,
                avatar=avatar,
                phone=phone,
                vip_level=vip_level,
            )
            session.add(new_config)

        session.commit()
        print(f"[Storage] 客户端配置已写入 (Client={client_id}, UID={uid})")


def get_client_config(client_id: str) -> dict | None:
    """
    读取本地已持久化的登录态，用于启动时自动恢复会话。
    """
    with Session(engine) as session:
        statement = select(ClientConfig).where(ClientConfig.client_id == client_id)
        config = session.exec(statement).first()

        if config and config.token:
            return {
                "uid": config.uid,
                "token": config.token,
                "nickName": config.nick_name,
                "avatar": config.avatar,
                "phone": config.phone,
                "vipLevel": config.vip_level,
                "watchPath": config.watch_path,
            }
        return None


def get_watch_path(client_id: str) -> str | None:
    """读取本地监控目录路径"""
    with Session(engine) as session:
        statement = select(ClientConfig).where(ClientConfig.client_id == client_id)
        config = session.exec(statement).first()
        return config.watch_path if config else None


def set_watch_path(client_id: str, watch_path: str):
    """保存本地监控目录路径到 client_config"""
    with Session(engine) as session:
        statement = select(ClientConfig).where(ClientConfig.client_id == client_id)
        config = session.exec(statement).first()
        if config:
            config.watch_path = watch_path
            session.add(config)
            session.commit()
            print(f"[Storage] 监控目录已更新: {watch_path}")
        else:
            raise ValueError(f"客户端 {client_id} 不存在，请先登录")


def clear_client_config(client_id: str):
    """
    清除本地登录态（登出时调用）。
    """
    with Session(engine) as session:
        statement = select(ClientConfig).where(ClientConfig.client_id == client_id)
        config = session.exec(statement).first()

        if config:
            config.token = ""
            config.uid = None
            config.nick_name = None
            config.avatar = None
            config.phone = None
            config.vip_level = 0
            session.add(config)
            session.commit()
            print(f"[Storage] 已清除客户端配置 (Client={client_id})")

def upsert_bjh_cookies(cookies_list: list[dict], user_phone: str = "", cleanup_orphans: bool = False):
    """
    同步批量更新百家号 Cookie 列表到本地。
    支持自动插入与更新（以 user_phone + bjh_id 匹配）。
    cleanup_orphans=True 时，将本地有但云端没有的记录 status 重置为0（仅在完整同步时使用）。
    """
    if not cookies_list:
        return

    def _safe_bjh_id(raw) -> str | None:
        """提取有效的 bjh_id，None/空字符串/纯空白均返回 None"""
        if raw is None:
            return None
        s = str(raw).strip()
        return s if s else None

    bjh_ids_in_cloud = [_safe_bjh_id(c.get("bjh_id")) for c in cookies_list]
    bjh_ids_in_cloud = [bid for bid in bjh_ids_in_cloud if bid]
    
    with Session(engine) as session:
        # 1. 批量遍历数据进行插入更新
        for item in cookies_list:
            bjh_id = _safe_bjh_id(item.get("bjh_id"))
            if not bjh_id:
                continue
                
            statement = select(ClientBjhCookie).where(
                ClientBjhCookie.user_phone == user_phone,
                ClientBjhCookie.bjh_id == bjh_id
            )
            existing_cookie = session.exec(statement).first()
            
            if existing_cookie:
                existing_cookie.bjh_name = item.get("bjh_name", existing_cookie.bjh_name)
                existing_cookie.bjh_avatar = item.get("bjh_avatar", existing_cookie.bjh_avatar)
                existing_cookie.cookie_str = item.get("cookie_str", existing_cookie.cookie_str)
                # 只在 API 明确返回 status 字段时才更新，避免覆盖手动禁用的记录
                if "status" in item:
                    existing_cookie.status = int(item["status"])
                session.add(existing_cookie)
            else:
                new_cookie = ClientBjhCookie(
                    user_phone=user_phone,
                    bjh_id=bjh_id,
                    bjh_name=item.get("bjh_name", bjh_id),
                    bjh_avatar=item.get("bjh_avatar", ""),
                    cookie_str=item.get("cookie_str", ""),
                    status=int(item.get("status", 1))
                )
                session.add(new_cookie)
                
        # 2. 完整同步时，将云端不存在的记录 status 设为 0（仅当前用户范围内）
        if cleanup_orphans and bjh_ids_in_cloud:
            statement = select(ClientBjhCookie).where(
                ClientBjhCookie.user_phone == user_phone,
                ClientBjhCookie.bjh_id.notin_(bjh_ids_in_cloud)
            )
            orphaned_cookies = session.exec(statement).all()
            for oc in orphaned_cookies:
                oc.status = 0
                session.add(oc)
                
        session.commit()
        print(f"[Storage] 已写入/更新 {len(cookies_list)} 条百家号 Cookie")

def get_all_bjh_cookies(user_phone: str = "") -> list[dict]:
    """
    获取当前用户的百家号 Cookie 列表
    """
    with Session(engine) as session:
        statement = select(ClientBjhCookie).where(
            ClientBjhCookie.user_phone == user_phone,
            ClientBjhCookie.status == 1
        )
        cookies = session.exec(statement).all()
        return [
            {
                "bjh_id": c.bjh_id,
                "bjh_name": c.bjh_name,
                "bjh_avatar": c.bjh_avatar,
                "cookie_str": c.cookie_str,
                "status": c.status,
                "last_used": c.last_used.isoformat() if c.last_used else None,
            }
            for c in cookies
        ]

def _parse_publish_time(value) -> datetime | None:
    """将 publish_time 安全转为 datetime 对象（兼容字符串和时间戳）"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value)
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
    return None


def _extract_cover(item: dict) -> str | None:
    """提取封面图：优先 vertical_cover，fallback 到 cover_images[0].src"""
    cover = item.get("vertical_cover")
    if cover:
        return cover
    cover_images_raw = item.get("cover_images")
    if not cover_images_raw:
        return None
    try:
        import json
        images = json.loads(cover_images_raw) if isinstance(cover_images_raw, str) else cover_images_raw
        if isinstance(images, list) and images:
            return images[0].get("src")
    except (json.JSONDecodeError, TypeError, AttributeError):
        pass
    return None


def upsert_articles(articles_list: list[dict], user_phone: str = ""):
    """
    持久化或更新文章元数据记录
    """
    if not articles_list:
        return

    with Session(engine) as session:
        for item in articles_list:
            article_id = str(item.get("article_id", item.get("id", "")))
            if not article_id:
                continue

            statement = select(ClientArticle).where(ClientArticle.article_id == article_id)
            existing = session.exec(statement).first()
            parsed_time = _parse_publish_time(item.get("publish_time"))
            cover = _extract_cover(item)

            if existing:
                existing.user_phone = user_phone  # 补写旧数据的用户归属
                existing.nid = str(item.get("nid", existing.nid))
                existing.title = item.get("title", existing.title)
                existing.abstract = item.get("abstract", existing.abstract)
                existing.feed_id = str(item.get("feed_id", existing.feed_id or ""))
                existing.app_id = str(item.get("app_id", existing.app_id or ""))
                existing.story_type = item.get("story_type", existing.story_type)
                existing.url = item.get("url", existing.url)
                existing.vertical_cover = cover or existing.vertical_cover
                existing.status = item.get("status", existing.status)
                existing.type = item.get("type", existing.type)
                existing.is_published = int(item.get("is_published") or existing.is_published or 0)
                existing.is_pay_subscribe = int(item.get("is_pay_subscribe") or existing.is_pay_subscribe or 0)
                existing.publish_time = parsed_time if parsed_time else existing.publish_time
                existing.last_update = datetime.utcnow()
                session.add(existing)
            else:
                new_article = ClientArticle(
                    article_id=article_id,
                    user_phone=user_phone,
                    nid=str(item.get("nid", "")),
                    title=item.get("title"),
                    abstract=item.get("abstract"),
                    feed_id=str(item.get("feed_id", "")),
                    app_id=str(item.get("app_id", "")),
                    story_type=item.get("story_type"),
                    url=item.get("url"),
                    vertical_cover=cover,
                    status=item.get("status"),
                    type=item.get("type"),
                    is_published=int(item.get("is_published") or 0),
                    is_pay_subscribe=int(item.get("is_pay_subscribe") or 0),
                    publish_time=parsed_time,
                    last_update=datetime.utcnow()
                )
                session.add(new_article)

        session.commit()
        print(f"[Storage] 已写入/更新 {len(articles_list)} 篇文章")

def upsert_orders(orders_list: list[dict], user_phone: str = ""):
    """
    持久化或更新抓取的分页订单记录
    """
    if not orders_list:
        return
        
    with Session(engine) as session:
        for item in orders_list:
            nid = str(item.get("nid", ""))
            if not nid:
                continue
                
            statement = select(ClientOrder).where(ClientOrder.nid == nid)
            existing = session.exec(statement).first()
            
            if existing:
                existing.user_phone = user_phone  # 补写旧数据的用户归属
                existing.title = item.get("title", existing.title)
                existing.status = item.get("status", existing.status)
                existing.order_amount = int(item.get("order_amount") or existing.order_amount or 0)
                existing.read_amount = int(item.get("read_amount") or existing.read_amount or 0)
                existing.rec_count = int(item.get("rec_count") or existing.rec_count or 0)
                existing.comment_amount = int(item.get("comment_amount") or existing.comment_amount or 0)
                existing.like_amount = int(item.get("like_amount") or existing.like_amount or 0)
                existing.collection_amount = int(item.get("collection_amount") or existing.collection_amount or 0)
                existing.share_amount = int(item.get("share_amount") or existing.share_amount or 0)
                existing.is_hot = int(item.get("is_hot") or existing.is_hot or 0)
                existing.is_pay_subscribe = int(item.get("is_pay_subscribe") or existing.is_pay_subscribe or 0)
                existing.last_update = datetime.utcnow()
                session.add(existing)
            else:
                new_order = ClientOrder(
                    nid=nid,
                    user_phone=user_phone,
                    title=item.get("title"),
                    status=item.get("status"),
                    order_amount=int(item.get("order_amount") or 0),
                    read_amount=int(item.get("read_amount") or 0),
                    rec_count=int(item.get("rec_count") or 0),
                    comment_amount=int(item.get("comment_amount") or 0),
                    like_amount=int(item.get("like_amount") or 0),
                    collection_amount=int(item.get("collection_amount") or 0),
                    share_amount=int(item.get("share_amount") or 0),
                    is_hot=int(item.get("is_hot") or 0),
                    is_pay_subscribe=int(item.get("is_pay_subscribe") or 0),
                    last_update=datetime.utcnow()
                )
                session.add(new_order)
        session.commit()
        print(f"[Storage] 已写入/更新 {len(orders_list)} 条订单")

def get_unsynced_articles(user_phone: str = "") -> list[ClientArticle]:
    """获取已发布但尚未同步的文章 (is_published=1 & sync_status=0)"""
    with Session(engine) as session:
        statement = select(ClientArticle).where(
            ClientArticle.user_phone == user_phone,
            ClientArticle.is_published == 1,
            ClientArticle.sync_status == 0
        )
        return session.exec(statement).all()

def mark_article_synced(article_id: str):
    """将文章标记为已同步 sync_status=1"""
    with Session(engine) as session:
        statement = select(ClientArticle).where(ClientArticle.article_id == article_id)
        existing = session.exec(statement).first()
        if existing:
            existing.sync_status = 1
            session.add(existing)
            session.commit()

def mark_articles_synced(article_ids: list[str]):
    """批量标记文章为已同步"""
    if not article_ids:
        return
    with Session(engine) as session:
        for aid in article_ids:
            statement = select(ClientArticle).where(ClientArticle.article_id == aid)
            existing = session.exec(statement).first()
            if existing:
                existing.sync_status = 1
                session.add(existing)
        session.commit()

def get_all_unsynced_orders(user_phone: str = "") -> list[ClientOrder]:
    """查询当前用户未同步的订单 (sync_status=0)"""
    with Session(engine) as session:
        statement = select(ClientOrder).where(
            ClientOrder.user_phone == user_phone,
            ClientOrder.sync_status == 0
        )
        return session.exec(statement).all()

def get_nid_novel_id_map(nids: list[str], user_phone: str = "") -> dict[str, str]:
    """通过 nid 列表查文章表，返回 {nid: article_id} 映射，article_id 即 novel_id"""
    if not nids:
        return {}
    with Session(engine) as session:
        statement = select(ClientArticle.nid, ClientArticle.article_id).where(
            ClientArticle.user_phone == user_phone,
            ClientArticle.nid.in_(nids),
            ClientArticle.sync_status == 1,  # 只关联已同步的文章
        )
        rows = session.exec(statement).all()
        return {nid: article_id for nid, article_id in rows if nid and article_id}


def mark_orders_synced(nids: list[str]):
    """批量标记订单为已同步"""
    if not nids:
        return
    with Session(engine) as session:
        for nid in nids:
            statement = select(ClientOrder).where(ClientOrder.nid == nid)
            existing = session.exec(statement).first()
            if existing:
                existing.sync_status = 1
                session.add(existing)
        session.commit()

def get_latest_article_date(app_id: str = "", user_phone: str = "") -> str | None:
    """获取本地最新文章的 publish_time 日期，用于增量请求时间范围（按 app_id + user_phone 隔离）"""
    with Session(engine) as session:
        statement = select(func.max(ClientArticle.publish_time)).where(
            ClientArticle.user_phone == user_phone
        )
        if app_id:
            statement = statement.where(ClientArticle.app_id == app_id)
        result = session.exec(statement).first()
        if result:
            if isinstance(result, datetime):
                return result.strftime("%Y-%m-%d")
            return str(result)[:10]
        return None
            
def get_active_watch_path() -> str | None:
    """获取当前活动用户的本地监控目录(忽略 client_id 适用单机版)"""
    with Session(engine) as session:
        config = session.exec(select(ClientConfig)).first()
        return config.watch_path if config else None

def get_active_token() -> str | None:
    """获取单机版配置的 token 用于上报"""
    with Session(engine) as session:
        config = session.exec(select(ClientConfig)).first()
        return config.token if config else None

def get_active_user_phone() -> str | None:
    """获取当前登录用户的 phone（用于数据隔离）"""
    with Session(engine) as session:
        config = session.exec(select(ClientConfig)).first()
        return config.phone if config else None

def upsert_user_profile(
    phone: str,
    uid: str = None,
    nick_name: str = None,
    avatar: str = None,
    vip_level: int = 0,
):
    """登录成功后写入/更新用户信息到 UserProfile 表"""
    if not phone:
        print("[Storage] phone 为空，跳过 UserProfile 写入")
        return
    with Session(engine) as session:
        existing = session.exec(select(UserProfile).where(UserProfile.phone == phone)).first()
        if existing:
            existing.uid = uid
            existing.nick_name = nick_name
            existing.avatar = avatar
            existing.vip_level = vip_level
            existing.last_login_at = datetime.utcnow()
            existing.is_active = 1
            session.add(existing)
        else:
            profile = UserProfile(
                phone=phone,
                uid=uid,
                nick_name=nick_name,
                avatar=avatar,
                vip_level=vip_level,
                last_login_at=datetime.utcnow(),
                is_active=1,
            )
            session.add(profile)
        session.commit()
        print(f"[Storage] 用户信息已写入 (phone={phone})")

def get_user_profile(phone: str) -> dict | None:
    """读取用户信息"""
    with Session(engine) as session:
        profile = session.exec(select(UserProfile).where(UserProfile.phone == phone)).first()
        if profile:
            return {
                "phone": profile.phone,
                "uid": profile.uid,
                "nickName": profile.nick_name,
                "avatar": profile.avatar,
                "vipLevel": profile.vip_level,
                "lastLoginAt": profile.last_login_at.isoformat() if profile.last_login_at else None,
            }
        return None

def upsert_book_sync_task(task_data: dict, user_phone: str = ""):
    """保存小说文件状态至数据库"""
    file_hash = task_data.get("file_hash")
    if not file_hash:
        return
        
    with Session(engine) as session:
        statement = select(ClientBooksSyncTask).where(ClientBooksSyncTask.file_hash == file_hash)
        existing = session.exec(statement).first()
        
        if existing:
            existing.user_phone = user_phone  # 补写旧数据的用户归属
            existing.nid = task_data.get("nid", existing.nid)
            existing.novel_id = task_data.get("novel_id", existing.novel_id)
            existing.title = task_data.get("title", existing.title)
            existing.local_path = task_data.get("local_path", existing.local_path)
            existing.file_size = task_data.get("file_size", existing.file_size)
            existing.word_count = task_data.get("word_count", existing.word_count)
            existing.sync_status = task_data.get("sync_status", existing.sync_status)
            existing.error_msg = task_data.get("error_msg", existing.error_msg)
            session.add(existing)
        else:
            new_task = ClientBooksSyncTask(
                file_hash=file_hash,
                user_phone=user_phone,
                nid=task_data.get("nid"),
                novel_id=task_data.get("novel_id"),
                title=task_data.get("title"),
                local_path=task_data.get("local_path"),
                file_size=task_data.get("file_size"),
                word_count=task_data.get("word_count", 0),
                sync_status=task_data.get("sync_status"),
                error_msg=task_data.get("error_msg")
            )
            session.add(new_task)
            
        session.commit()
        print(f"[Storage] 文件同步任务已更新 (Hash: {file_hash})")


def update_worker_status(worker_name: str, status: str, message: str = ""):
    """Worker 上报自身运行状态"""
    # init_sleeping：首次启动进入待命，记录为 sleeping 但不覆盖已有的 last_success_at
    is_init = status == "init_sleeping"
    actual_status = "sleeping" if is_init else status

    with Session(engine) as session:
        statement = select(WorkerStatus).where(WorkerStatus.worker_name == worker_name)
        record = session.exec(statement).first()
        now = datetime.utcnow()

        if record:
            record.status = actual_status
            record.message = message
            record.updated_at = now
            if actual_status == "running":
                record.last_run_at = now
            elif actual_status == "sleeping" and not is_init:
                record.last_success_at = now
            session.add(record)
        else:
            record = WorkerStatus(
                worker_name=worker_name,
                status=actual_status,
                message=message,
                updated_at=now,
                last_run_at=now if actual_status == "running" else None,
                last_success_at=now if (actual_status == "sleeping" and not is_init) else None,
            )
            session.add(record)

        session.commit()


def get_all_worker_status() -> list[dict]:
    """读取所有 Worker 的运行状态"""
    with Session(engine) as session:
        records = session.exec(select(WorkerStatus)).all()
        return [
            {
                "workerName": r.worker_name,
                "status": r.status,
                "lastRunAt": r.last_run_at.isoformat() if r.last_run_at else None,
                "lastSuccessAt": r.last_success_at.isoformat() if r.last_success_at else None,
                "message": r.message,
                "updatedAt": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in records
        ]


def reset_all_worker_status():
    """重置所有 Worker 状态为 idle（启动时清除旧数据）"""
    with Session(engine) as session:
        records = session.exec(select(WorkerStatus)).all()
        for r in records:
            r.status = "idle"
            r.message = ""
            r.last_success_at = None
            r.last_run_at = None
            session.add(r)
        session.commit()


def get_novel_list(
    page: int = 1,
    page_size: int = 10,
    keyword: str = "",
    app_id: str = "",
    start_date: str = "",
    end_date: str = "",
    sort_field: str = "publish_time",
    sort_order: str = "desc",
    sync_status: str = "",
    user_phone: str = "",
) -> dict:
    """
    小说列表分页查询，关联 client_articles + client_orders + client_bjh_cookies
    """
    with Session(engine) as session:
        # 基础查询：articles LEFT JOIN orders(nid) LEFT JOIN bjh_cookies(user_phone + app_id=bjh_id)
        base_query = (
            select(ClientArticle, ClientOrder, ClientBjhCookie)
            .outerjoin(ClientOrder, ClientArticle.nid == ClientOrder.nid)
            .outerjoin(ClientBjhCookie, (
                (ClientArticle.app_id == ClientBjhCookie.bjh_id) &
                (ClientBjhCookie.user_phone == user_phone)
            ))
        )

        # 筛选条件：仅展示付费订阅小说 + 当前用户
        base_query = base_query.where(
            ClientArticle.is_pay_subscribe == 1,
            ClientArticle.user_phone == user_phone,
        )
        if keyword:
            from sqlalchemy import or_
            base_query = base_query.where(or_(
                ClientArticle.article_id == keyword,
                ClientArticle.nid == keyword,
                col(ClientArticle.title).contains(keyword),
            ))
        if app_id:
            base_query = base_query.where(ClientArticle.app_id == app_id)
        if sync_status != "":
            base_query = base_query.where(ClientArticle.sync_status == int(sync_status))
        if start_date:
            base_query = base_query.where(ClientArticle.publish_time >= start_date)
        if end_date:
            base_query = base_query.where(ClientArticle.publish_time <= end_date + " 23:59:59")

        # 总数
        count_query = select(func.count()).select_from(base_query.subquery())
        total = session.exec(count_query).one()

        # 排序字段映射
        sort_map = {
            "publish_time": ClientArticle.publish_time,
            "read_amount": ClientOrder.read_amount,
            "order_amount": ClientOrder.order_amount,
            "like_amount": ClientOrder.like_amount,
            "collection_amount": ClientOrder.collection_amount,
            "share_amount": ClientOrder.share_amount,
            "rec_count": ClientOrder.rec_count,
        }
        order_col = sort_map.get(sort_field, ClientArticle.publish_time)
        order_expr = order_col.asc() if sort_order == "asc" else order_col.desc()

        # 分页 + 排序
        offset = (page - 1) * page_size
        data_query = base_query.order_by(order_expr).offset(offset).limit(page_size)
        results = session.exec(data_query).all()

        items = []
        for article, order, bjh in results:
            items.append({
                "articleId": article.article_id,
                "nid": article.nid or "",
                "title": article.title or "",
                "abstract": article.abstract or "",
                "verticalCover": article.vertical_cover or "",
                "url": article.url or "",
                "bjhName": bjh.bjh_name if bjh else "",
                "bjhAvatar": bjh.bjh_avatar if bjh else "",
                "orderAmount": order.order_amount if order else 0,
                "readAmount": order.read_amount if order else 0,
                "recCount": order.rec_count if order else 0,
                "likeAmount": order.like_amount if order else 0,
                "collectionAmount": order.collection_amount if order else 0,
                "shareAmount": order.share_amount if order else 0,
                "isHot": order.is_hot if order else 0,
                "isPaySubscribe": article.is_pay_subscribe,
                "syncStatus": article.sync_status,
                "publishTime": str(article.publish_time or ""),
            })

        return {
            "list": items,
            "pagination": {
                "currentPage": page,
                "pageSize": page_size,
                "total": total,
            },
        }


def get_dashboard_stats(user_phone: str = "") -> dict:
    """首页统计：当前用户的百家号总数、已发布文章总数、订单总金额"""
    with Session(engine) as session:
        bjh_count = session.exec(
            select(func.count()).select_from(ClientBjhCookie).where(
                ClientBjhCookie.user_phone == user_phone,
                ClientBjhCookie.status == 1
            )
        ).one()

        article_count = session.exec(
            select(func.count()).select_from(ClientArticle).where(
                ClientArticle.user_phone == user_phone,
                ClientArticle.is_published == 1
            )
        ).one()

        total_order_amount = session.exec(
            select(func.coalesce(func.sum(ClientOrder.order_amount), 0))
            .select_from(ClientOrder)
            .where(ClientOrder.user_phone == user_phone)
        ).one()

        return {
            "bjhCount": bjh_count,
            "articleCount": article_count,
            "totalOrderAmount": total_order_amount,
        }

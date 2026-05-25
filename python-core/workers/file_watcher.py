import os
import time
import hashlib
import config
from core.miaobi_client import MiaobiClient
from workers.base_worker import BaseWorker
from storage.crud import (
    get_active_watch_path, upsert_book_sync_task,
    get_unsynced_articles, mark_article_synced,
    get_all_unsynced_orders, get_nid_novel_id_map, mark_orders_synced,
    get_active_user_phone,
)

try:
    import docx
except ImportError:
    docx = None

def find_novel_file(directory: str, title: str) -> str | None:
    """递归搜索同名小说文件，优先找 .docx，然后 .doc，最后 .txt"""
    target_names = [f"{title}.docx", f"{title}.doc", f"{title}.txt"]
    for ext_name in target_names:
        for root, _, files in os.walk(directory):
            if ext_name in files:
                return os.path.join(root, ext_name)
    return None

def _clean_text(text: str) -> str:
    """过滤媒体占位符（图片/视频/音频），保留所有文字和符号"""
    return text.replace('\ufffc', '')

def extract_text(file_path: str) -> str:
    """读取文档纯文本（支持.txt 和 .docx），自动过滤图片等非文字内容"""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.docx' and docx is not None:
        try:
            doc = docx.Document(file_path)
            paragraphs = [_clean_text(p.text) for p in doc.paragraphs]
            paragraphs = [p for p in paragraphs if p]
            return "\n".join(paragraphs)
        except Exception as e:
            print(f"[FileWatcher] 读取 docx 失败 {file_path}: {e}")
            return ""
    elif ext == '.txt':
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return _clean_text(f.read())
        except UnicodeDecodeError:
            try:
                with open(file_path, 'r', encoding='gbk') as f:
                    return _clean_text(f.read())
            except Exception:
                return ""
    else:
        print(f"[FileWatcher] 暂不支持直接读取此格式 ({ext}) 的正文文本，将上报为空: {file_path}")
        return ""


class FileWatcherWorker(BaseWorker):
    """
    文件扫描与推送进程。
    读取 sqlite 中 is_published=1 且 sync_status=0 的文章，
    拿 title 去本地目录匹配原稿 doc/docx/txt，
    匹配成功后组装完整数据（元数据 + content）推送给妙笔，
    推送成功后标记 sync_status=1。
    同时查询关联的订单数据，补充 novel_id 后一并推送。
    """
    interval = config.WORKER_INTERVAL_FILE_WATCHER

    def process(self):
        print("[FileWatcher] 开启本地文件扫描匹配任务...")

        user_phone = get_active_user_phone()
        if not user_phone:
            print("[FileWatcher] 未获取到当前用户 phone，跳过。")
            return
        
        watch_path = get_active_watch_path()
        if not watch_path or not os.path.exists(watch_path):
            print("[FileWatcher] 本地监控路径未配置或不存在，跳过。")
            return

        unsync_articles = get_unsynced_articles(user_phone=user_phone)
        if not unsync_articles:
            print("[FileWatcher] 当前没有待匹配的文章，跳过。")
            return
            
        print(f"[FileWatcher] 发现 {len(unsync_articles)} 篇待匹配文章...")
        
        miaobi = MiaobiClient()
        if not miaobi.token:
            print("[FileWatcher] Token 不存在，中止上传。")
            return


        for art in unsync_articles:
            title = art.title
            if not title:
                continue
                
            local_path = find_novel_file(watch_path, title)
            if not local_path:
                continue
                
            print(f"[FileWatcher] 匹配到源文件: {local_path}")
            file_size = os.path.getsize(local_path)
            content = extract_text(local_path)
            word_count = len(content.strip())
            
            if content:
                file_hash = hashlib.md5(content.encode('utf-8')).hexdigest()
            else:
                with open(local_path, "rb") as f:
                    file_hash = hashlib.md5(f.read()).hexdigest()


            task_record = {
                "file_hash": file_hash,
                "nid": art.nid,
                "novel_id": art.article_id,
                "title": title,
                "local_path": local_path,
                "file_size": file_size,
                "word_count": word_count,
                "sync_status": "uploading",
                "error_msg": ""
            }
            
            try:
                novel_id = art.article_id or ""
                nid = art.nid or ""
                print(f"[FileWatcher] 正在推送: {title} (novel_id={novel_id}, 字数: {word_count})")

                # 必填字段校验：novel_id、content、nid 任一为空则跳过
                missing = []
                if not novel_id:
                    missing.append("novel_id")
                if not content.strip():
                    missing.append("content")
                if not nid:
                    missing.append("nid")

                if missing:
                    err_msg = f"必填字段为空: {', '.join(missing)}"
                    print(f"[FileWatcher] 跳过: {err_msg}")
                    task_record["sync_status"] = "failed"
                    task_record["error_msg"] = err_msg
                    upsert_book_sync_task(task_record, user_phone=user_phone)
                    continue
                
                res = miaobi.sync_novel({
                    "novel_id": novel_id,
                    "title": title,
                    "content": content,
                    "word_count": word_count,
                    "nid": nid,
                    "app_id": art.app_id or "",
                    "feed_id": art.feed_id or "",
                    "abstract": art.abstract or "",
                    "vertical_cover": art.vertical_cover or "",
                    "type": art.type or "",
                    "publish_time": str(art.publish_time or ""),
                    "status": art.status or "",
                    "url": art.url or "",
                })
                
                if res.get("code") == 10000:
                    task_record["sync_status"] = "success"
                    mark_article_synced(art.article_id)
                    print(f"[FileWatcher] 推送成功: {title}")
                else:
                    task_record["sync_status"] = "failed"
                    task_record["error_msg"] = res.get("message", "Unknown Error")
                    print(f"[FileWatcher] 推送被拒: {task_record['error_msg']}")
                    
            except Exception as e:
                task_record["sync_status"] = "failed"
                task_record["error_msg"] = str(e)
                print(f"[FileWatcher] 推送异常 {title}: {e}")
                
            upsert_book_sync_task(task_record, user_phone=user_phone)
            time.sleep(2)

        # ========== 推送关联订单数据 ==========
        self._push_orders(miaobi, user_phone)
            
        print("[FileWatcher] 本轮扫描结束。")

    def _push_orders(self, miaobi: MiaobiClient, user_phone: str = ""):
        """
        查询所有未同步订单，通过 nid 关联文章表获取 novel_id 后推送给妙笔。
        只推送能关联到已同步文章（有 novel_id）的订单。
        """
        orders = get_all_unsynced_orders(user_phone=user_phone)
        if not orders:
            return

        # 用订单的 nid 批量查文章表，获取 nid→article_id(novel_id) 映射
        nids = [o.nid for o in orders if o.nid]
        nid_map = get_nid_novel_id_map(nids, user_phone=user_phone)
        if not nid_map:
            return

        # 只推送能关联到 novel_id 的订单
        order_payload = []
        for order in orders:
            novel_id = nid_map.get(order.nid)
            if not novel_id:
                continue
            order_payload.append({
                "nid": order.nid,
                "novel_id": novel_id,
                "title": order.title or "",
                "status": order.status or "",
                "order_amount": order.order_amount,
                "read_amount": order.read_amount,
                "rec_count": order.rec_count,
                "comment_amount": order.comment_amount,
                "like_amount": order.like_amount,
                "collection_amount": order.collection_amount,
                "share_amount": order.share_amount,
                "is_hot": order.is_hot,
                "is_pay_subscribe": order.is_pay_subscribe,
            })

        if not order_payload:
            return

        print(f"[FileWatcher] 发现 {len(order_payload)} 条待推送订单...")

        try:
            res = miaobi.sync_novel_orders(order_payload)
            print(f"[FileWatcher] 订单推送完成 ({len(order_payload)} 条)")
            synced_nids = [o["nid"] for o in order_payload]
            mark_orders_synced(synced_nids)
        except Exception as e:
            print(f"[FileWatcher] 订单推送异常: {e}")

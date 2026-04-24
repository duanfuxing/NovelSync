from datetime import datetime
import config
from workers.base_worker import BaseWorker
from core.baijiahao_client import BaijiahaoClient
from storage.crud import get_all_bjh_cookies, upsert_articles, get_latest_article_date, get_active_user_phone

class ArticleSyncWorker(BaseWorker):
    """百家号文章数据抓取入库（仅入库，推送由 FileWatcherWorker 负责）"""
    interval = config.WORKER_INTERVAL_ARTICLE_SYNC

    def process(self):
        print("[ArticleSync] 开启定时文章同步任务...")

        user_phone = get_active_user_phone()
        if not user_phone:
            print("[ArticleSync] 未获取到当前用户 phone，跳过同步。")
            return

        cookies = get_all_bjh_cookies(user_phone=user_phone)
        if not cookies:
            print("[ArticleSync] 未发现有效的百家号账号，跳过。")
            return

        for cookie_record in cookies:
            cookie_str = cookie_record.get("cookie_str")
            bjh_name = cookie_record.get('bjh_name', '未知')
            bjh_id = cookie_record.get('bjh_id', '')

            if not cookie_str:
                continue

            try:
                start_date, end_date = self._calc_date_range(bjh_id, user_phone)
                client = BaijiahaoClient(cookie_str)
                print(f"[ArticleSync] 正在抓取百家号文章: {bjh_name} (范围: {start_date or '全量'} ~ {end_date or '至今'})")
                
                page_count = 0
                for page_items in client.fetch_articles(start_date=start_date, end_date=end_date):
                    if not page_items:
                        continue
                    page_count += 1
                    upsert_articles(page_items, user_phone=user_phone)
                    
                print(f"[ArticleSync] {bjh_name} 共抓取 {page_count} 页数据入库完成。")
            except Exception as e:
                print(f"[ArticleSync] {bjh_name} 同步异常，跳过: {e}")

        print("[ArticleSync] 本轮同步完成。")

    @staticmethod
    def _calc_date_range(app_id: str = "", user_phone: str = "") -> tuple[str, str]:
        latest_date = get_latest_article_date(app_id, user_phone=user_phone)
        if latest_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
            return latest_date, end_date
        return "", ""


import config
from workers.base_worker import BaseWorker
from core.baijiahao_client import BaijiahaoClient
from storage.crud import get_all_bjh_cookies, upsert_orders, get_active_user_phone, get_active_novel_sync_state

class OrderSyncWorker(BaseWorker):
    """小说订阅订单数据（全量同步，仅入库不推送；推送由 FileWatcherWorker 负责）"""
    interval = config.WORKER_INTERVAL_ORDER_SYNC
    requires_novel_sync = True

    def process(self):
        print("[OrderSync] 开启定时订单同步任务...")
        sync_state = get_active_novel_sync_state()
        if not sync_state["ready"]:
            print(f"[OrderSync] 小说同步门禁未通过，跳过: {sync_state['reason']}")
            return

        user_phone = get_active_user_phone()
        if not user_phone:
            print("[OrderSync] 未获取到当前用户 phone，跳过同步。")
            return

        cookies = get_all_bjh_cookies(user_phone=user_phone)
        if not cookies:
            print("[OrderSync] 未发现有效的百家号账号，跳过。")
            return

        for cookie_record in cookies:
            cookie_str = cookie_record.get("cookie_str")
            bjh_name = cookie_record.get('bjh_name', '未知')

            if not cookie_str:
                continue

            try:
                client = BaijiahaoClient(cookie_str)
                print(f"[OrderSync] 正在抓取百家号订单: {bjh_name}")
                
                page_count = 0
                for page_items in client.fetch_orders():
                    if not page_items:
                        continue

                    page_count += 1
                    upsert_orders(page_items, user_phone=user_phone)

                print(f"[OrderSync] {bjh_name} 共处理 {page_count} 页订单数据。")
            except Exception as e:
                print(f"[OrderSync] {bjh_name} 同步异常，跳过: {e}")

        print("[OrderSync] 本轮同步完成。")

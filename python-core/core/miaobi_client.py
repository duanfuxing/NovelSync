"""
妙笔系统 API 客户端封装
统一封装对妙笔云端接口的调用，所有请求携带 Authorization header。
"""
import requests
import urllib3
import config

# 已明确使用 verify=False，关闭重复的 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class MiaobiClient:
    """妙笔系统 HTTP 接口客户端"""

    def __init__(self, token: str = None):
        # 未传 token 时自动从本地 SQLite 获取
        if token is None:
            from storage.crud import get_active_token
            token = get_active_token()
        self.token = token
        self.base_url = config.CLOUD_API_BASE_URL.rstrip('/') + '/'
        self.headers = {
            "Content-Type": "application/json",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
            self.headers["token"] = token
        self.timeout = 60

        # 使用独立 Session，trust_env=False 彻底绕过所有代理（环境变量 + macOS 系统代理）
        self._session = requests.Session()
        self._session.trust_env = False
        self._session.verify = False
        self._session.headers.update(self.headers)

    def _post(self, path: str, payload: dict = None) -> dict:
        """统一 POST 请求，返回响应 JSON"""
        url = f"{self.base_url}{path.lstrip('/')}"
        resp = self._session.post(url, json=payload, timeout=self.timeout)
        return resp.json()

    def _get(self, path: str, params: dict = None) -> dict:
        """统一 GET 请求，返回响应 JSON"""
        url = f"{self.base_url}{path.lstrip('/')}"
        resp = self._session.get(url, params=params, timeout=self.timeout)
        return resp.json()

    # ========== 0. 全局认证与用户接口 ==========

    def send_verify_message(self, account: str, channel: str = "sms", action: str = "login") -> dict:
        """发送短信验证码"""
        payload = {
            "account": account,
            "channel": channel,
            "action": action,
        }
        return self._post("api/v1/message/sendVerifyMessage", payload)

    def login(self, account: str, verify_code: str, channel: str = "sms") -> dict:
        """短信验证码登录"""
        payload = {
            "channel": channel,
            "account": account,
            "verifyCode": verify_code,
        }
        return self._post("api/v1/oauth/login", payload)

    def get_user_info(self) -> dict:
        """获取用户信息"""
        return self._get("api/v1/user/info")

    def get_user_cookies(self, page: int = 1, page_size: int = 200) -> dict:
        """获取百家号用户 Cookies 列表"""
        return self._get("baijiahao-sync/v1/cookie/userCookies", params={"currentPage": page, "pageSize": page_size})

    # ========== 1. 上报小说原文 ==========

    def sync_novel(self, payload: dict) -> dict:
        """
        POST /baijiahao-sync/v1/sync/novels
        上报小说数据到妙笔系统。

        必填: novel_id, title, content
        可选: app_id, nid, feed_id, abstract, vertical_cover,
              type, publish_time, status, url, word_count
        """
        return self._post("baijiahao-sync/v1/sync/novels", payload)

    # ========== 3. 上报小说订阅订单数据 ==========

    def sync_novel_orders(self, orders: list[dict]) -> dict:
        """
        POST /baijiahao-sync/v1/sync/novelOrders
        批量上报小说订阅订单与宏观业绩数据。

        :param orders: 订单列表，每项包含 nid, title, order_amount, read_amount 等
        :return: {"code": 200, "data": {"total_received": N, "success_count": N, "failed_ids": []}}
        """
        return self._post("baijiahao-sync/v1/sync/novelOrders", orders)

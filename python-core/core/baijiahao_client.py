import time
import json
import random
import requests


class BaijiahaoClient:
    """百家号外部 HTTP 客户端"""

    SYNC_INTERVAL = 7200  # 定时循环时间周期 (2小时)

    ARTICLE_URL = "https://baijiahao.baidu.com/pcui/article/lists"
    ORDER_URL = "https://baijiahao.baidu.com/pcui/paysubscribe/articlelist"

    def __init__(self, cookie_str: str):
        self.cookie_str = self._parse_cookie(cookie_str)
        self.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN",
            "Connection": "keep-alive",
            "Cookie": self.cookie_str,
            "Host": "baijiahao.baidu.com",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "sec-ch-ua": '"Not?A_Brand";v="8", "Chromium";v="108"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        }
        self.timeout = 15
        self.max_consecutive_errors = 2
        # 绕过系统代理直连（避免 VPN/代理导致 SSL 握手失败）
        self._no_proxy = {"http": "", "https": ""}

    @staticmethod
    def _parse_cookie(cookie_str: str) -> str:
        """将 cookie 字符串解析为标准 HTTP Cookie 格式 (name=value; ...)"""
        METADATA_KEYS = {"domain", "path", "expires", "httpOnly", "secure", "sameSite", "expirationDate", "hostOnly", "session", "storeId"}

        cookie_str = cookie_str.strip()
        if not cookie_str.startswith("{"):
            return cookie_str

        try:
            data = json.loads(cookie_str)
            cookies = data.get("cookies", [])
            if not isinstance(cookies, list) or not cookies:
                return cookie_str

            pairs = []
            for c in cookies:
                if not isinstance(c, dict):
                    continue
                if "name" in c and "value" in c:
                    pairs.append(f"{c['name']}={c['value']}")
                else:
                    for k, v in c.items():
                        if k not in METADATA_KEYS and isinstance(v, str):
                            pairs.append(f"{k}={v}")
                            break

            parsed = "; ".join(pairs)
            print(f"[BaijiahaoClient] Cookie 解析完成 ({len(pairs)} 个字段, {len(parsed)} 字符)")
            return parsed

        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"[BaijiahaoClient] Cookie 解析失败: {e}")
            return cookie_str

    def _sleep_randomly(self):
        """随机睡眠2-5秒以防止封控"""
        time.sleep(random.uniform(2.0, 5.0))

    def fetch_articles(self, start_date: str = "", end_date: str = ""):
        """抓取文章记录(生成器形式产出每一页列表)"""
        current_page = 1
        total_page = 1
        consecutive_errors = 0

        while current_page <= total_page:
            params = {
                "currentPage": current_page,
                "pageSize": 10,
                "search": "",
                "type": "",
                "collection": "",
                "startDate": start_date,
                "endDate": end_date,
                "clearBeforeFetch": "false",
                "dynamic": 1,
            }
            headers = {
                **self.headers,
                "Referer": f"https://baijiahao.baidu.com/builder/rc/content?currentPage={current_page}&pageSize=10&search=&type=&collection=&startDate={start_date}&endDate={end_date}",
            }

            print(f"[BaijiahaoClient] 请求文章列表 第 {current_page}/{total_page} 页")

            try:
                response = requests.get(self.ARTICLE_URL, params=params, headers=headers, timeout=self.timeout, proxies=self._no_proxy)

                if response.status_code != 200:
                    print(f"[BaijiahaoClient] HTTP {response.status_code}: {response.text[:300]}")
                    break

                data = response.json()

                if data.get("errno") != 0:
                    consecutive_errors += 1
                    print(f"[BaijiahaoClient] API 错误 (errno={data.get('errno')}): {data.get('errmsg')}, 连续 {consecutive_errors}/{self.max_consecutive_errors}")
                    if consecutive_errors >= self.max_consecutive_errors:
                        break
                    time.sleep(5)
                    continue

                consecutive_errors = 0
                data_block = data.get("data") or {}
                items = data_block.get("list") or []
                page_info = data_block.get("page") or {}

                print(f"[BaijiahaoClient] 文章 第 {current_page} 页: {len(items)} 条, totalPage={page_info.get('totalPage')}")

                if not items:
                    break

                yield items

                try:
                    total_page = int(page_info.get("totalPage", 1))
                except (ValueError, TypeError):
                    total_page = 1

            except requests.exceptions.Timeout:
                consecutive_errors += 1
                print(f"[BaijiahaoClient] 请求超时, 连续 {consecutive_errors}/{self.max_consecutive_errors}")
                if consecutive_errors >= self.max_consecutive_errors:
                    break
                time.sleep(5)
                continue
            except Exception as e:
                consecutive_errors += 1
                print(f"[BaijiahaoClient] 文章抓取异常: {e}, 连续 {consecutive_errors}/{self.max_consecutive_errors}")
                if consecutive_errors >= self.max_consecutive_errors:
                    break
                time.sleep(5)
                continue

            current_page += 1
            if current_page <= total_page:
                self._sleep_randomly()

    def fetch_orders(self):
        """抓取订单记录(生成器形式产出每一页列表)"""
        current_page = 1
        total_page = 1
        consecutive_errors = 0

        while current_page <= total_page:
            params = {
                "currentPage": current_page,
                "pageSize": 20,
                "orderType": 1,
            }
            headers = {
                **self.headers,
                "Referer": "https://baijiahao.baidu.com/builder/rc/subscription",
            }

            print(f"[BaijiahaoClient] 请求订单列表 第 {current_page}/{total_page} 页")

            try:
                response = requests.get(self.ORDER_URL, params=params, headers=headers, timeout=self.timeout, proxies=self._no_proxy)

                if response.status_code != 200:
                    print(f"[BaijiahaoClient] HTTP {response.status_code}: {response.text[:300]}")
                    break

                data = response.json()

                if data.get("errno") != 0:
                    consecutive_errors += 1
                    print(f"[BaijiahaoClient] API 错误 (errno={data.get('errno')}): {data.get('errmsg')}, 连续 {consecutive_errors}/{self.max_consecutive_errors}")
                    if consecutive_errors >= self.max_consecutive_errors:
                        break
                    time.sleep(5)
                    continue

                consecutive_errors = 0
                data_block = data.get("data") or {}
                items = data_block.get("list") or []
                page_info = data_block.get("page") or {}

                print(f"[BaijiahaoClient] 订单 第 {current_page} 页: {len(items)} 条, totalPage={page_info.get('totalPage')}")

                if not items:
                    break

                yield items

                try:
                    total_page = int(page_info.get("totalPage", 1))
                except (ValueError, TypeError):
                    total_page = 1

            except requests.exceptions.Timeout:
                consecutive_errors += 1
                print(f"[BaijiahaoClient] 请求超时, 连续 {consecutive_errors}/{self.max_consecutive_errors}")
                if consecutive_errors >= self.max_consecutive_errors:
                    break
                time.sleep(5)
                continue
            except Exception as e:
                consecutive_errors += 1
                print(f"[BaijiahaoClient] 订单抓取异常: {e}, 连续 {consecutive_errors}/{self.max_consecutive_errors}")
                if consecutive_errors >= self.max_consecutive_errors:
                    break
                time.sleep(5)
                continue

            current_page += 1
            if current_page <= total_page:
                self._sleep_randomly()

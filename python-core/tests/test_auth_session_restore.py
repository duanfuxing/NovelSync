import os
import sys
import unittest
from fastapi import BackgroundTasks
from unittest.mock import Mock, patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class AuthSessionRestoreTest(unittest.TestCase):
    def test_auth_check_reports_transient_user_info_failure(self):
        import api.main as api_main

        client = Mock()
        client.get_user_info.side_effect = RuntimeError("timeout")

        with patch.object(api_main, "MiaobiClient", return_value=client):
            result = api_main._check_user_info("token-1")

        self.assertEqual(result.status, "unavailable")
        self.assertIn("timeout", result.message)

    def test_restore_session_keeps_local_config_when_cloud_check_unavailable(self):
        import api.main as api_main

        clear_client_config = Mock()

        with patch.object(api_main, "get_client_config", return_value={
            "uid": "uid-1",
            "token": "token-1",
            "nickName": "用户",
            "avatar": "",
            "phone": "13800000000",
            "vipLevel": 1,
        }), patch.object(
            api_main,
            "_check_user_info",
            return_value=api_main.AuthCheckResult(
                status="unavailable",
                message="timeout",
            ),
        ), patch.object(api_main, "clear_client_config", clear_client_config):
            result = api_main.restore_session("client-1", BackgroundTasks())

        self.assertEqual(result["code"], 503)
        self.assertIn("暂时不可用", result["message"])
        clear_client_config.assert_not_called()

    def test_restore_session_clears_local_config_when_cloud_reports_expired(self):
        import api.main as api_main

        clear_client_config = Mock()

        with patch.object(api_main, "get_client_config", return_value={
            "uid": "uid-1",
            "token": "token-1",
            "nickName": "用户",
            "avatar": "",
            "phone": "13800000000",
            "vipLevel": 1,
        }), patch.object(
            api_main,
            "_check_user_info",
            return_value=api_main.AuthCheckResult(
                status="expired",
                message="鉴权已过期",
                code=90003,
            ),
        ), patch.object(api_main, "clear_client_config", clear_client_config):
            result = api_main.restore_session("client-1", BackgroundTasks())

        self.assertEqual(result["code"], 401)
        clear_client_config.assert_called_once_with("client-1")


if __name__ == "__main__":
    unittest.main()

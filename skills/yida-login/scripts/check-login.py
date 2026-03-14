"""
check-login.py: 轻量级本地登录状态检查脚本

只读取本地 Cookie 缓存文件，检查是否存在有效的登录态。
不启动浏览器，不发起任何网络请求。

用法：
  python3 check-login.py

输出（JSON）：
  有效登录态：{"status": "ok", "csrf_token": "...", "corp_id": "...", "user_id": "...", "base_url": "..."}
  无有效登录态：{"status": "not_logged_in", "message": "..."}
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def find_project_root(start_dir):
    """从 start_dir 向上查找含 README.md 或 .git 的项目根目录。"""
    current = start_dir
    while True:
        if os.path.exists(os.path.join(current, "README.md")) or os.path.isdir(
            os.path.join(current, ".git")
        ):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return start_dir
        current = parent


PROJECT_ROOT = find_project_root(SCRIPT_DIR)
COOKIE_FILE = os.path.join(PROJECT_ROOT, ".cache", "cookies.json")


def load_login_cache():
    """从本地文件加载缓存，返回 (cookies, base_url)。"""
    if not os.path.exists(COOKIE_FILE):
        return None, None
    with open(COOKIE_FILE, "r", encoding="utf-8") as file:
        content = file.read().strip()
    if not content:
        return None, None
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return None, None

    # 新格式：{"cookies": [...], "base_url": "..."}
    if isinstance(data, dict) and "cookies" in data:
        cookies = data["cookies"] if data["cookies"] else None
        base_url = data.get("base_url")
        return cookies, base_url

    # 旧格式兼容：纯 Cookie 数组
    if isinstance(data, list) and data:
        return data, None

    return None, None


def extract_info_from_cookies(cookies):
    """
    从 Cookie 列表中提取 csrf_token、corp_id、user_id。

    提取规则：
    - csrf_token：name="tianshu_csrf_token" 的 cookie value
    - corp_id + user_id：name="tianshu_corp_user" 的 cookie value，
      格式为 "{corpId}_{userId}"，按最后一个 "_" 分隔
    """
    csrf_token = None
    corp_id = None
    user_id = None

    for cookie in cookies:
        if cookie.get("name") == "tianshu_csrf_token":
            csrf_token = cookie.get("value")
        elif cookie.get("name") == "tianshu_corp_user":
            value = cookie.get("value", "")
            last_underscore = value.rfind("_")
            if last_underscore > 0:
                corp_id = value[:last_underscore]
                user_id = value[last_underscore + 1:]

    return csrf_token, corp_id, user_id


def main():
    cookies, base_url = load_login_cache()

    if not cookies:
        print(json.dumps({
            "status": "not_logged_in",
            "message": "本地无 Cookie 缓存，需要扫码登录"
        }, ensure_ascii=False))
        return

    csrf_token, corp_id, user_id = extract_info_from_cookies(cookies)

    if not csrf_token:
        print(json.dumps({
            "status": "not_logged_in",
            "message": "Cookie 中无 tianshu_csrf_token，需要重新登录"
        }, ensure_ascii=False))
        return

    print(json.dumps({
        "status": "ok",
        "csrf_token": csrf_token,
        "corp_id": corp_id,
        "user_id": user_id,
        "base_url": base_url,
        "message": (
            f"✅ 已有有效登录态\n"
            f"  组织: {corp_id}\n"
            f"  用户: {user_id}\n"
            f"  域名: {base_url}"
        )
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

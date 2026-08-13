#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import socket
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8081
BIND = "0.0.0.0"


def get_default_route_ip():
    """通过 UDP 探测获取当前默认路由接口的本地 IPv4（通常是真实 WiFi/有线 IP）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # 连到一个公网 DNS 端口，不真正发包，只取本端地址
        s.connect(("223.5.5.5", 53))
        ip = s.getsockname()[0]
    except Exception:
        ip = None
    finally:
        s.close()
    return ip


def get_ipconfig_ips():
    """从 ipconfig 中抓取所有 IPv4 地址，按非虚拟/非回环优先排序。"""
    try:
        result = subprocess.run(
            ["ipconfig"], capture_output=True, text=True, encoding="gbk", errors="ignore"
        )
        lines = result.stdout.splitlines()
    except Exception:
        return []

    ips = []
    for line in lines:
        low = line.lower()
        if "ipv4" in low and ":" in line:
            ip = line.split(":", 1)[1].strip()
            if not ip or ip.startswith("127.") or ip.startswith("169.254."):
                continue
            # 常见虚拟网卡厂商前缀靠后排
            is_virtual = any(
                v in line.lower() or v in result.stdout.lower()
                for v in ["vmware", "virtualbox", "hyper-v", "vbox"]
            )
            ips.append((ip, is_virtual))
    # 真实网卡在前
    ips.sort(key=lambda x: x[1])
    return [ip for ip, _ in ips]


def get_recommended_ip():
    default = get_default_route_ip()
    all_ips = get_ipconfig_ips()
    if default and default in all_ips:
        # 把默认路由 IP 放到第一位
        all_ips.remove(default)
        return [default] + all_ips
    if default:
        return [default] + all_ips
    return all_ips


def main():
    print()
    print("=== 彩虹 PWA 本地服务器 ===")
    print()
    ips = get_recommended_ip()
    if ips:
        print("本机局域网 IP（手机请用第一个）：")
        for ip in ips:
            print(f"    {ip}")
        recommended = ips[0]
    else:
        print("未找到 IPv4 地址，请手动运行 ipconfig 查看")
        recommended = None

    print()
    print(f"电脑浏览器打开 : http://localhost:{PORT}")
    if recommended:
        print(f"手机浏览器打开 : http://{recommended}:{PORT}")
    else:
        print("手机浏览器打开 : http://<上面局域网IP>:" + str(PORT))
    print("（关闭窗口或按 Ctrl+C 停止）")
    print()

    server = HTTPServer((BIND, PORT), SimpleHTTPRequestHandler)
    print(f"Serving HTTP on {BIND} port {PORT} (http://0.0.0.0:{PORT}/) ...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        sys.exit(0)


if __name__ == "__main__":
    main()

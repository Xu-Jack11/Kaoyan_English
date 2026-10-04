# 考研英语（一）真题机考系统

仿雅思机考（IELTS on computer）界面的考研英语一在线做题系统：计时、高亮笔记、按大题提交、自动批改、逐题解析。

## 运行

纯静态网站，无需构建：

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

（直接双击 `index.html` 时浏览器会阻止读取 `data/` 下的 JSON，请使用任意静态服务器，或部署到 GitHub Pages。）

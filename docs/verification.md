# 验证报告

验证日期：2026-09-20。环境：macOS arm64，Rust 1.98.1，Node 22.23.1，Chrome 153；浏览器直接连接真实 Rust API，使用构建后的生产前端与 Service Worker。

## 结果

| 检查 | 结果 |
|---|---|
| Rust 编译 / cargo test | 通过，10 个测试 |
| Rust Clippy（all-targets，warnings as errors） | 通过 |
| Rustfmt | 通过 |
| TypeScript + Vite 生产构建 | 通过 |
| Playwright 浏览器集成测试 | 通过，10 个场景，14.5 秒 |
| npm audit | 0 个已报告漏洞 |
| SQLite 在线备份 | integrity_check = ok，引用 blob 全部存在，会话已移除 |
| 备份恢复启动 | 新端口启动、重新认证、8 个测试 KB 可读取 |
| SIGTERM 优雅关闭 | 退出码 0 |
| Docker / Ubuntu 22.04 实机 | 未执行；当前机器没有 Docker 引擎 |
| 远程部署 | 未执行，遵循用户范围 |

## 后端场景

1. 相对路径校验与路径穿越拒绝。
2. 未认证拒绝、写请求校验、登出后会话撤销。
3. 原文件读取、Range 部分读取、正确版本替换、过期版本拒绝。
4. 两个同时写入者只有一个提交成功。
5. 删除后同名新文件不能被旧 UUID 的草稿覆盖。
6. 文件夹移动/递归删除，`%` 和 `_` 按字面路径处理。
7. 上传扩展名/签名/父目录校验和失败临时文件清理。
8. PDF 位置/版本批注校验，ZIP 内容与批注导出。
9. HTML 原文件以 attachment/octet-stream/nosniff 返回。
10. KB 删除范围隔离。

## 浏览器场景

1. 桌面 Markdown 阅读、分屏编辑、真实保存、文件下载、下方/左右面板停靠及拖拽。
2. PDF Canvas、位置批注持久化、DOCX 页面、HTML 脚本运行与主站隔离。
3. KaTeX、Shiki、Mermaid、Alerts、脚本净化。
4. 远端版本已更新时保留本地草稿，不覆盖远端。
5. 断网刷新应用、重新打开文档、编辑、刷新后恢复 IndexedDB 草稿、恢复网络手动同步。
6. UI 新建目录、Markdown、重命名/移动、删除。
7. 834×1112 平板布局与抽屉，无页面横向溢出。
8. 390×844 手机布局、底部导航、抽屉与源码编辑，无页面横向溢出。
9. 整库预缓存后，在断网情况下首次打开四种格式，HTML 交互仍可用。
10. 实际文件上传、导入更新、路径搜索和深色主题。

测试中发现并修复了 PDF.js 6 的资源销毁接口变化、HTML 初始空 iframe 导航竞态、DOCX 样式净化导致样式丢失，以及同名重建的草稿版本碰撞。PDF.js 已升级至 6.3.289。

## 视觉检查

实际截图见 `screenshots/desktop.png`、`tablet.png`、`mobile.png`、`library.png`、`pdf.png`、`docx.png`、`dark.png`。桌面/平板/手机阅读区已逐一查看，DOCX 页面的样式也经修复后复核。

应用首次预缓存为 10 个资源，约 864 KiB（未压缩合计）；生产输出含所有可延迟加载阅读器约 14 MiB。没有进行公网延迟、多人压力、大规模目录、超大扫描 PDF、iOS 真机或复杂 Office 文档兼容性测试，不能从本机验证推导其表现。

CI 配置提供 Rust / 前端 / 浏览器测试及 Docker image build，不包含部署步骤。将本项目作为独立仓库根目录时可启用；当前父工作区中的 `.github` 不会自动运行该子目录工作流。

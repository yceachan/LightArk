# HTTP API

统一前缀 `/api`，JSON 错误 `{ "error": "..." }`。除登录外均要求 `folio_session` cookie。所有写操作附带 `X-Folio-Request: 1`。

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/login` | JSON `{password}`，设置会话 cookie |
| GET | `/session` | 检查当前会话 |
| POST | `/logout` | 撤销当前会话 |
| GET / POST | `/kbs` | 列出 / 创建 KB（`{name}`） |
| PUT / DELETE | `/kbs/:id` | 重命名 KB（`{name}`） / 删除 KB |
| GET | `/kbs/:id/entries` | 路径、UUID、kind、format、size、version、updated |
| POST | `/kbs/:id/folders` | 创建文件夹 `{path}` |
| PUT | `/kbs/:id/files?path=…` | 请求体为原始文件字节；不是 multipart |
| GET | `/entries/:id/content?v=N` | 下载指定当前版本，支持 Range / ETag |
| PUT | `/entries/:id` | 移动/重命名 `{path}`，需要版本头 |
| DELETE | `/entries/:id` | 删除文件或文件夹子树，需要版本头 |
| GET / POST | `/entries/:id/comments` | 获取 / 新增 PDF 批注 |
| DELETE | `/comments/:id` | 删除批注 |
| GET | `/kbs/:id/export` | ZIP，`files/` + `folio-comments.json` |

首次创建文件附带 `If-Match: *`（本 API 表示目标必须不存在）。更新原文件附带 `If-Match: "N"` 与 `X-Folio-Entry: uuid`。PUT/DELETE 条目以 UUID 定位，只需要 `If-Match: "N"`。版本不匹配返回 409，客户端不得盲重试覆盖。

PDF 批注请求：

```json
{"page":1,"x":0.25,"y":0.4,"text":"需要再读这一段","version":1}
```

页号从 1 开始；x/y 为归一化页面坐标；text 非空且不超过 10000 字节。批注版本必须等于当前文件版本。更新时间为 Unix 秒。

上传路径必须是相对路径，禁止空段、`..`、控制字符、反斜杠与绝对路径，父目录必须先创建。URI 中的中文和特殊字符必须进行 URL 编码。

文件接口始终返回 `application/octet-stream`、`Content-Disposition: attachment` 与 `nosniff`，HTML 只由前端在沙箱里预览，不能作为同源可执行页面打开。

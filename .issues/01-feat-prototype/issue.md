## Background

飞书Lack太偏向企业应用。

我想要做一个自部署，轻量化，pdf+md+doc+html 四态预览，markdown可编辑源码的pwa site轻量知识库。主打个人多模态文档资产的跨设备管理协同。

- 他是一个轻量的，云段存储layout面向的知识库，不是lark,notion 那样的富文档格式的多级内嵌。
- 提供pdf comments,md source edit 等轻量功能，而非富文档那样的丰富表达能力和GUI编辑辅助。

## ADR

### Token

部署在vps上，`userid-serectkey`访问，全站httpsTLS加密流量，cookie记录登录信息。

不做注册，server shell 来中心管理令牌，

对一个user id，支持只读访客令牌和管理员令牌，时效性可由服务器cli脚本配置。

令牌使用阿里云同款风格，本地基于serectkey加密计算`signature`, post{userid,signature}.云端基于`userid`查询serectkey,校验签名。

### UI

pwa app，pc+pad+mobile 三套ui。

视觉风格和md渲染库参照现有EA.KB.IO,

https://github.com/yceachan/yceachan.github.io

但 **App Shell**交互逻辑要,用ChatGPT,Vscode 这样的现代的面板化**Workbench** UI,由种种bar 作为**App Shell Parts**提供交互功能 ，可以吸附停靠Pannels,面板布局可拖拽和隐藏，在PC端可以根据窗口分辨率变动自动调整最合适的面板布局。

移动端则是种种menu呼出菜单来实现功能。

### KB

支持多知识库，文件树式管理。不要用lark notion 那种傻逼顶层文档嵌子文档，就是最轻量对的路径/文件导航。文件夹页可以自动生成文件树预览



原形版本提供pdf,docx,md,html（自包含css,js） 四格式的预览能力，md可实时在线编辑源码（最轻量txt式），或“通过导入更新”。

支持导出文件，KB离线可访问性使用渐进式加载的缓存管线，io上都有现成设计。

### Lang

期望比较好的网络IO性能，后端使用rs+sqlite.

### CD

docker ce部署，虚拟机 Ubuntu22LTS
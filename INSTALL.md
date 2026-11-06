# 安装

> 请安装 `@petercjl/product-scene-replacement` 提供的 Skill。

当前 Agent 先识别自己的 Skill 目录，从 npm 获取指定版本并通过标准管理 CLI 的 skill source 读取当前来源和合同。以明确的 Agent 名称和完整目标目录执行 skill install，实体安装包含完整 Skill 和目标自有运行时。已有未受管副本先核对来源、保留备份。安装后核对 skill status 的版本、哈希与 current 状态，并按当前宿主的机制注册和刷新加载。版本一致只是身份检查，实际资源由 SHA-256 校验。npm 脚本被禁用时，同样完成上述交接。

目标参数 --target 表示精确 Skill 目录，由当前 Agent 解析。任何满足所需能力的 Agent 均可安装。管理 CLI 与本地资产工具需要 Node.js 22+。媒体服务权限由任务入口单独核实。

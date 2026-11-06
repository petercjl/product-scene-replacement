# 更新

> 请检查并更新 `@petercjl/product-scene-replacement` 提供的 Skill。

当前 Agent 先定位自己的明确目标，读取 skill source 中的管理合同并检查 skill status。普通任务 prepare 自动检测稳定版更新，缓存最长一天，离线回退五分钟；AGENT_PACKAGE_UPDATE_CHECK=0 可停用检测。update check 和 update status 提供只读检查，update policy --mode off|notify --yes 配置所选安装的通知模式。默认通知，有明确更新授权后才替换。

update install --agent NAME --target EXACT_DIRECTORY --yes 获取候选，保留替换前的副本，核对身份后同步该目标的 Skill 与自有运行时。相同版本也修复缺失文件，已完整同步时返回 verified no-op。保留本地编辑与宿主界面元数据。更新回执提供新入口，当前 Agent 随后加载该入口和 Skill，按宿主机制确认发现状态。

失败或结果未知时，先读取 update operation，恢复已获取的候选用 update resume，需回退时用 update rollback；两者均要求所选目标和明确的 --yes。恢复保持原事务及备份，避免重复 npm 获取。父集合管理安装显示 owner，由所属集合进行更新。0.1.0、0.1.1 只有实体复制安装，没有历史管理 CLI；迁移时核对旧副本并先保留可恢复备份。

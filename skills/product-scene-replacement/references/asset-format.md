# 产品资产图组交接协议 v2

版本目录包含 `资产说明.txt` 和其列出的独立 PNG。每张有稳定编号、相对文件名、角色、用途、选用条件、局限、实际像素尺寸及 SHA-256。图组至少包含全貌与尺度。每张图按内容选择自己的画幅并记录实际比例，同一图组可混用横、竖、方图。格式 v2 在每张图的说明中记录比例；读取工具同时支持格式 v1 的整套统一比例。使用新图组的 Agent 需使用支持格式 v2 的读取工具，旧读取工具遇到 v2 时应先更新。

用 Node.js 22+ 执行 `node scripts/asset-guide.mjs check PATH/资产说明.txt`。命令返回经过文件校验的 JSON，其中包含绝对路径、编号、用途和哈希。

制作端执行 `node scripts/asset-guide.mjs write SET_DIR PLAN.json`，对目录中已备好的 PNG 生成说明。命令拒绝覆盖现有说明，修订写到新版本目录。计划示例：

```json
{
  "product": "黄白月亮抱枕",
  "version": "v1",
  "images": [
    {"id":"A01","file":"01-overall.png","role":"overall","ratio":"16:9","use":"完整轮廓","when":"整体替换","limits":"仅展示可见面"},
    {"id":"A02","file":"02-scale.png","role":"scale","ratio":"3:4","use":"人物相对尺度","when":"抱持场景","limits":"仅相对尺度"}
  ]
}
```

角色为 overall、scale、structure、texture、marking、use。文件名使用单段英文 ASCII 名称。校验检查尺寸及文件身份，图像内容和用途由执行者实际看图验收。

计划中每张图可填写 ratio，填写时工具核对实际像素比例；省略时从实际图片尺寸约分得到比例。顶层 ratio 作为旧计划的统一默认值继续兼容，逐图 ratio 优先。检查输出包含每图 ratio，整套 ratio 在所有图片比例一致时返回该值，混合比例时返回 null。

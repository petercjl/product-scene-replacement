# 产品资产图组交接协议 v1

版本目录包含 `资产说明.txt` 和其列出的独立 PNG。每张有稳定编号、相对文件名、角色、用途、选用条件、局限、实际像素尺寸及 SHA-256。图组至少包含全貌与尺度，默认 9:16，显式指定的其他比例记录在清单中。

用 Node.js 22+ 执行 `node scripts/asset-guide.mjs check PATH/资产说明.txt`。命令返回经过文件校验的 JSON，其中包含绝对路径、编号、用途和哈希。

制作端执行 `node scripts/asset-guide.mjs write SET_DIR PLAN.json`，对目录中已备好的 PNG 生成说明。命令拒绝覆盖现有说明，修订写到新版本目录。计划示例：

```json
{
  "product": "黄白月亮抱枕",
  "version": "v1",
  "ratio": "9:16",
  "images": [
    {"id":"A01","file":"01-overall.png","role":"overall","use":"完整轮廓","when":"整体替换","limits":"仅展示可见面"},
    {"id":"A02","file":"02-scale.png","role":"scale","use":"人物相对尺度","when":"抱持场景","limits":"仅相对尺度"}
  ]
}
```

角色为 overall、scale、structure、texture、marking、use。文件名使用单段英文 ASCII 名称。校验检查尺寸及文件身份，图像内容和用途由执行者实际看图验收。

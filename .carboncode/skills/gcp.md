---
name: gcp
description: Git Commit & Push — collect changes, classify, generate Chinese commit message, commit, and push. Use when asked for gcp, git commit and push, 提交推送, or 自动提交.
---

# gcp — Git Commit & Push

执行以下步骤，全程不需要用户额外确认，除非遇到冲突、认证失败、敏感文件风险或远端拒绝后 rebase 产生冲突。

## 1. 收集变更

并行执行：

- `git status --short --branch`
- `git diff`
- `git diff --cached`
- `git log --oneline -3`
- 当前分支名：`git branch --show-current`
- 如果有远端：`git fetch origin <当前分支名>`，然后查看 `git log origin/<分支>..HEAD --oneline`

关键判断：工作区干净不等于没事可做。必须同时确认远端同步状态。

- 工作区有改动：走分析、commit、push 全流程。
- 工作区干净但本地领先 origin：跳过 commit，直接 push。
- 工作区干净且本地不领先 origin：告知没有需要提交的变更，远端也已同步。

## 2. 分析与分类

阅读所有变更内容，将改动归入以下分类；只列出实际存在的分类：

- 新功能：全新的页面、组件、API 对接、功能模块
- Bug修复：修复已有功能的错误行为
- 优化：改善已有功能的体验、性能、UI 细节
- 重构：代码结构调整，不改变外部行为
- 配置：构建配置、路由、依赖、环境变量等
- 文档：README、AGENTS.md、注释等

## 3. 生成 Commit Message

格式要求：

- 第一行：一句话总结所有改动，不超过 50 个中文字符。
- 空一行。
- 按分类列出具体事项，每项一行，用 `- ` 前缀。
- 全部使用中文。
- 末尾加 Carbon Code co-author 行。

示例：

```text
添加团队编排脚本，优化 Carbon Code 全局配置

新功能:
- 新增 carboncode-team tmux 多代理启动脚本
- 新增 gcp 全局提交推送 skill

优化:
- 调整 Carbon Code 输出格式偏好，避免终端表格错位

Co-Authored-By: Carbon Code <carboncode@code.ai6666.com>
```

## 4. 暂存并提交

- 用 `git add` 添加相关文件。
- 不要默认用 `git add -A`；尽量逐个添加属于本次改动的文件。
- 排除 `.env`、credentials、密钥、证书、`node_modules/`、`.claude/` 设置文件等敏感或生成内容。
- 用临时文件或多 `-m` 参数传递 commit message，避免 shell quoting 问题。
- 如果没有工作区改动但本地领先 origin，跳过 commit，直接 push。

## 5. 推送到远程

- 执行 `git push origin <当前分支名>`。
- 如果推送被拒绝且是 non-fast-forward，执行 `git pull --rebase origin <分支>` 后重试。
- 如果 rebase 冲突，停止并报告冲突文件，不要自行乱解。
- 推送成功后输出最终 commit hash 和远程 URL。

## 注意事项

- 不要提交 `.claude/` 目录下的 settings、sessions、history 和 skills，除非用户明确要求。
- 不要提交 `.codex/` 中的 auth、sessions、sqlite、logs、history 等运行状态文件。
- 不要提交 `.carboncode/` 中的 sessions、semantic、semantic-skip 等运行状态文件。
- 不要提交 `.env`、`*.p12`、`*.mobileprovision`、私钥、token 或 credentials。
- 如果有未跟踪的新文件，先判断是否属于本次改动；属于才添加。

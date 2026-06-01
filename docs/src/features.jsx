// Feature grid — compact developer-tool capabilities.

const FEATURES = [
  {
    title: { zh: '终端原生 TUI', en: 'Terminal-native TUI' },
    en: 'TypeScript + Ink TUI',
    desc: {
      zh: '不是又一个 IDE 插件。diff 留给 git diff，文件树留给 ls —— 终端就是工作面板。',
      en: 'Not another IDE plugin. `git diff` handles diffs, `ls` handles file trees — your terminal is the workspace.',
    },
  },
  {
    title: { zh: 'V4 双档位', en: 'V4 two-tier' },
    en: 'Flash by default · /pro on demand',
    desc: {
      zh: '默认 DeepSeek V4 Flash 跑日常迭代控成本，/pro 单回合切到 DeepSeek V4 Pro，/preset pro 整个 session 走 Pro。',
      en: 'DeepSeek V4 Flash by default for cheap iteration; `/pro` lifts a single turn to DeepSeek V4 Pro; `/preset pro` makes the whole session run on Pro.',
    },
  },
  {
    title: { zh: 'MCP first-class', en: 'MCP first-class' },
    en: 'stdio · SSE · Streamable HTTP',
    desc: {
      zh: '一行 --mcp "name=cmd args" 接入外部服务器，工具以前缀合并进同一个 registry。',
      en: 'One line — `--mcp "name=cmd args"` — and an external server is wired in; its tools merge into the same registry under a prefix.',
    },
  },
  {
    title: { zh: '沙箱与计划门', en: 'Sandbox + plan gate' },
    en: 'Sandbox + /plan gate',
    desc: {
      zh: '所有原生工具沙箱化到启动目录；/plan 进入只读审计门，未批准前不允许写入。',
      en: 'Every built-in tool is sandboxed to the launch dir; `/plan` puts the session behind a read-only audit gate — no writes until the plan is approved.',
    },
  },
  {
    title: { zh: 'Skills 可编排', en: 'Composable skills' },
    en: 'Markdown skill scripts',
    desc: {
      zh: '.carboncode/skills/<name>.md，frontmatter 支持 runAs: subagent + allowed-tools 隔离运行。',
      en: 'Drop a Markdown file in `.carboncode/skills/<name>.md`; frontmatter supports `runAs: subagent` and `allowed-tools` for isolated execution.',
    },
  },
  {
    title: { zh: 'Replay & Events', en: 'Replay & events' },
    en: 'carboncode replay / events / stats',
    desc: {
      zh: '完整事件流落盘，可回放任意一次会话，可统计 token / cache / 成本，便于审计。',
      en: 'Every event hits disk — replay any past session, run stats on token / cache / cost, audit your loop\'s behaviour.',
    },
  },
];

function Features() {
  const { lang } = useLang();
  return (
    <section className="section" id="features">
      <SecHead
        num="03"
        label="Features"
        title={t({
          zh: '日常写代码需要的核心能力。',
          en: 'Core capabilities for daily coding work.',
        }, lang)}
        sub={t({
          zh: 'Carbon Code 的界面保持简单，把重点放在读仓库、改文件、审批命令、验证结果这条主路径上。',
          en: 'Carbon Code keeps the interface quiet and centers the path that matters: read the repo, edit files, approve commands, and verify the result.',
        }, lang)}
      />

      <div className="feat-grid">
        {FEATURES.map((f, i) => (
          <div key={f.en} className="feat">
            <div className="feat-num">F-{String(i + 1).padStart(2, '0')}</div>
            <h3>{t(f.title, lang)}</h3>
            <p>{t(f.desc, lang)}</p>
            <span className="feat-en">{f.en}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

window.Features = Features;

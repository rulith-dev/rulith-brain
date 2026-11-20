// The desktop shell's own page (index.html): how the agent's start goes, asked of the shell twice a second, said in
// the user's language; after the agent ended, what it said last and a button for another start. The launcher's lines
// are English (start.mjs, memory-transport.mjs PLAIN): the ones this page knows are said in its own words.
(() => {
  const zh = /^zh\b/i.test(navigator.language || '');
  const T = zh ? {
    lang: 'zh-CN', tagline: 'Rulith Brain 的配套智能体',
    starting: '正在启动智能体…', startingHelp: '通常只要几秒钟。',
    down: 'Rulith Brain 还没有运行', downHelp: '请打开 Rulith Brain，点击“加载模型并启动”。Brain 准备好后，智能体会自动继续；使用期间请保持 Brain 应用打开。',
    loading: 'Rulith Brain 正在加载模型', loadingHelp: '需要几分钟，准备好后智能体会自动继续。',
    opening: '已连接 Rulith Brain，正在打开页面…', openingHelp: '',
    ended: '智能体已停止', endedHelp: '下面是它最后说的话。可以再启动一次。',
    again: '重新启动',
    aboutTitle: '和 Rulith Brain 共用一份记忆',
    aboutText: '这个智能体没有自己的模型，也没有自己的记忆：它用的是 Rulith Brain 在这台电脑上运行的模型和记忆。你在这里交代和完成的事会被记住，Rulith Brain 应用里的对话也知道。',
    version: (v) => `版本 ${v}`,
  } : {
    lang: 'en', tagline: 'The companion agent of Rulith Brain',
    starting: 'Starting the agent…', startingHelp: 'This usually takes a few seconds.',
    down: 'Rulith Brain is not running yet', downHelp: 'Open Rulith Brain and press "Load the model and start". The agent goes on by itself when Brain is ready; keep the Brain app open while you use it.',
    loading: 'Rulith Brain is loading the model', loadingHelp: 'This takes a few minutes; the agent goes on by itself when it is ready.',
    opening: 'Connected to Rulith Brain: opening the page…', openingHelp: '',
    ended: 'The agent stopped', endedHelp: 'Below is what it said last. You can start it again.',
    again: 'Start again',
    aboutTitle: 'One memory, shared with Rulith Brain',
    aboutText: 'This agent has no model and no memory of its own: it works with the model and the memory that Rulith Brain runs on this PC. What you ask and do here is remembered, and the chat in the Rulith Brain app knows it too.',
    version: (v) => `Version ${v}`,
  };
  const $ = (id) => document.getElementById(id);
  document.documentElement.lang = T.lang;
  $('tagline').textContent = T.tagline;
  $('about-title').textContent = T.aboutTitle;
  $('about-text').textContent = T.aboutText;
  $('again').textContent = T.again;

  const invoke = (command) => window.__TAURI_INTERNALS__.invoke(command);

  /** What the launcher's lines say of the start: 'starting' | 'down' | 'loading' | 'opening' (the last line that tells). */
  function phaseOf(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.startsWith('Rulith Brain is not running')) return 'down';
      if (line.startsWith('Rulith Brain is loading the model')) return 'loading';
      if (line.startsWith('Rulith Brain is ready') || line.startsWith('Connected to Rulith Brain')) return 'opening';
    }
    return 'starting';
  }

  function show(state) {
    const ended = state.ended !== null && state.ended !== undefined && !state.running;
    const phase = ended ? 'ended' : state.up ? 'opening' : phaseOf(state.lines);
    $('state-title').textContent = T[phase];
    $('state-help').textContent = T[`${phase}Help`];
    $('mark').className = ended || phase === 'down' ? 'mark still' : 'mark';
    $('lines').hidden = !ended || !state.lines.length;
    if (ended) $('lines').textContent = state.lines.slice(-12).join('\n');
    $('again').hidden = !ended;
    $('version').textContent = state.version ? T.version(state.version) : '';
  }

  async function read() {
    try { show(await invoke('agent_state')); } catch { /* the next read says */ }
  }
  $('again').addEventListener('click', async () => {
    $('again').hidden = true;
    try { await invoke('agent_start'); } catch { /* the next read says */ }
    read();
  });
  show({ lines: [], running: true, up: false, ended: null, version: '' });
  read();
  setInterval(read, 500);
})();

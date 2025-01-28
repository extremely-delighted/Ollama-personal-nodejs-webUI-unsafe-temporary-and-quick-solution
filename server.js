/**
 * server.js
 *
 * 使用 LocalStorage 替代 Cookie，纯前端存储多会话数据。
 * 保持对话气泡左右分开排列：
 *   - User 气泡始终靠右
 *   - AI 氣泡始终靠左
 * 增加功能：
 *   - 自定义会话名称 (Rename)
 *   - 导出当前会话 (Export)
 *   - 导入会话 (Import)
 *   - 删除特定的提问或回答 (气泡右方“🗑”图标)
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Ollama API 地址（请根据你本地实际情况修改）
const OLLAMA_GENERATE_URL = 'http://localhost:11434/api/generate'; // 调用 Ollama 生成
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';        // 获取模型列表

// -------------- 1. 返回内嵌 HTML 页面 --------------
app.get('/', async (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Ollama - Multi Conversation (LocalStorage)</title>
  <style>
    body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f3f3f3; display: flex; flex-direction: column; height: 100vh;
    }
    header {
      background: #202123; color: #fff; padding: 10px 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    header h1 { font-size: 18px; margin: 0; }
    .bar { display: flex; align-items: center; gap: 10px; }
    select {
      background: #343541; color: #fff; border: none; outline: none;
      padding: 5px 8px; border-radius: 4px;
    }
    .container {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column;
    }
    .chat-bubble {
      margin: 10px 0;
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 6px;
      line-height: 1.4;
      white-space: pre-wrap;
      display: inline-flex;
      align-items: center;
      position: relative;
    }
    .user-bubble {
      background-color: #2b313e; color: #fff;
      align-self: flex-end;
      margin-left: auto;
    }
    .ai-bubble {
      background-color: #fff; color: #000;
      align-self: flex-start;
      margin-right: auto;
    }
    .think-box {
      display: none;
      margin-top: 5px; font-size: 90%;
      background: #eee; padding: 5px; border-radius: 4px; color: #666;
    }
    .think-toggle {
      font-size: 12px; color: #666; text-decoration: underline; cursor: pointer;
      margin-left: 8px;
    }
    .trash-btn {
      cursor: pointer;
      font-size: 14px;
      margin-left: 8px;
      opacity: 0.6;
    }
    .trash-btn:hover {
      opacity: 1;
    }
    .input-area {
      display: flex; gap: 8px; padding: 10px; background: #40414F;
    }
    .input-area input[type="text"] {
      flex: 1; padding: 8px; border: none; border-radius: 4px; outline: none;
      font-size: 14px;
    }
    .input-area button {
      background: #19C37D; color: #fff; border: none; border-radius: 4px;
      padding: 0 16px; cursor: pointer; font-size: 14px;
    }
    .input-area button:hover {
      background: #17ae72;
    }
    .voice-btn { background: #555; }
    .voice-btn:hover { background: #777; }
    .tts-btn { background: #555; }
    .tts-btn:hover { background: #777; }
    .clear-btn { background: #888; }
    .clear-btn:hover { background: #aaa; }
    .rename-btn, .export-btn, .import-btn { background: #666; }
    .rename-btn:hover, .export-btn:hover, .import-btn:hover { background: #555; }
    /* 隐藏文件输入 */
    #importFileInput {
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <h1>Ollama (Multi-chat, LocalStorage)</h1>
    <div class="bar">
      <label style="font-size:14px;">Sessions:</label>
      <select id="sessionSelect"></select>
      <button id="renameBtn" class="rename-btn">Rename</button>
      <button id="exportBtn" class="export-btn">Export</button>
      <button id="importBtn" class="import-btn">Import</button>
      <input type="file" id="importFileInput" accept=".json" />
      <label style="font-size:14px;">Model:</label>
      <select id="modelSelect"></select>
      <button id="clearBtn" class="clear-btn">Clear Chat</button>
    </div>
  </header>
  <div class="container" id="chatContainer"></div>
  <div class="input-area">
    <button id="voiceBtn" class="voice-btn">🎤</button>
    <input type="text" id="userInput" placeholder="Type a message, press Enter" />
    <button id="sendBtn">Send</button>
    <button id="ttsBtn" class="tts-btn">🔊</button>
  </div>

  <script>
    // ========== [1] LocalStorage 数据结构 ==========
    // 结构：{
    //   sessions: [
    //     { id, name, model, conversation: [{role, content/visibleContent, thinkContent}, ...] },
    //     ...
    //   ],
    //   currentSessionId: "xxxx-xxxx"
    // }
    const STORAGE_KEY = "ollama_sessions";

    // 读取本地存储
    function loadSessions() {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { sessions: [], currentSessionId: "" };
      try {
        const data = JSON.parse(stored);
        if (!Array.isArray(data.sessions)) data.sessions = [];
        if (!data.currentSessionId) data.currentSessionId = "";
        return data;
      } catch (e) {
        return { sessions: [], currentSessionId: "" };
      }
    }

    // 保存到本地存储
    function saveSessions(sessions, currentSessionId) {
      const data = { sessions, currentSessionId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    // 工具函数
    function findSessionById(sessions, id) {
      return sessions.find(s => s.id === id);
    }

    // ========== [2] 初始化数据 ==========

    let { sessions, currentSessionId } = loadSessions();

    // 若没有任何会话，创建一个
    if (sessions.length === 0) {
      const newId = crypto.randomUUID();
      sessions.push({
        id: newId,
        name: "Conversation #1",
        model: "",  // 等后面获取模型列表再默认赋值
        conversation: []
      });
      currentSessionId = newId;
      saveSessions(sessions, currentSessionId);
    }

    // 找到当前会话
    let currentSession = findSessionById(sessions, currentSessionId);
    if (!currentSession) {
      // 如果找不到，就切到第一个
      currentSessionId = sessions[0].id;
      currentSession = sessions[0];
      saveSessions(sessions, currentSessionId);
    }

    // ========== [3] 动态获取 Ollama 模型列表 ==========

    let modelList = [];
    fetch('/api/tags')
      .then(resp => resp.json())
      .then(data => {
        modelList = data.models || [];
        renderModelOptions(); // 渲染模型下拉

        // 若当前会话尚未设置模型，则默认选第一个
        if (!currentSession.model && modelList.length > 0) {
          currentSession.model = modelList[0].name;
          saveSessions(sessions, currentSessionId);
        }

        // 最后渲染一次下拉和对话
        renderSessionSelect();
        renderConversation();
      })
      .catch(err => {
        console.error("Failed to fetch Ollama model tags:", err);
      });

    // ========== [4] 前端 DOM 交互 ==========

    const sessionSelect = document.getElementById('sessionSelect');
    const modelSelect = document.getElementById('modelSelect');
    const chatContainer = document.getElementById('chatContainer');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const ttsBtn = document.getElementById('ttsBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const clearBtn = document.getElementById('clearBtn');
    const renameBtn = document.getElementById('renameBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');

    // ----(4.1) 会话下拉 ----
    function renderSessionSelect() {
      let html = '<option value="NEW_SESSION">+ New Chat</option>';
      sessions.forEach(s => {
        const selected = (s.id === currentSessionId) ? 'selected' : '';
        html += \`<option value="\${s.id}" \${selected}>\${s.name}</option>\`;
      });
      sessionSelect.innerHTML = html;
    }

    sessionSelect.addEventListener('change', () => {
      const chosen = sessionSelect.value;
      if (chosen === 'NEW_SESSION') {
        // 新建会话
        const newId = crypto.randomUUID();
        const newName = "Conversation #" + (sessions.length + 1);
        const newSession = {
          id: newId,
          name: newName,
          model: (modelList.length > 0) ? modelList[0].name : "",
          conversation: []
        };
        sessions.push(newSession);
        currentSessionId = newId;
        currentSession = newSession;
        saveSessions(sessions, currentSessionId);
      } else {
        // 切换已有会话
        currentSessionId = chosen;
        currentSession = findSessionById(sessions, currentSessionId) || sessions[0];
        saveSessions(sessions, currentSessionId);
      }
      renderSessionSelect();
      renderModelOptions();
      renderConversation();
    });

    // ----(4.2) 模型下拉 ----
    function renderModelOptions() {
      let html = "";
      modelList.forEach(m => {
        const selected = (m.name === currentSession.model) ? 'selected' : '';
        html += \`<option value="\${m.name}" \${selected}>\${m.name}</option>\`;
      });
      modelSelect.innerHTML = html;
    }

    modelSelect.addEventListener('change', () => {
      currentSession.model = modelSelect.value;
      saveSessions(sessions, currentSessionId);
    });

    // ----(4.3) 清空当前会话 ----
    clearBtn.addEventListener('click', () => {
      currentSession.conversation = [];
      saveSessions(sessions, currentSessionId);
      renderConversation();
    });

    // ----(4.4) 渲染对话气泡 + 删除功能----
    function renderConversation() {
      chatContainer.innerHTML = "";
      (currentSession.conversation || []).forEach((msg, index) => {
        const bubble = document.createElement('div');
        bubble.classList.add('chat-bubble');

        if (msg.role === 'user') {
          bubble.classList.add('user-bubble');
          bubble.textContent = msg.content;
        } else {
          bubble.classList.add('ai-bubble');
          bubble.textContent = msg.visibleContent || "";
        }

        // 如果有隐藏思考 <think>...</think>
        if (msg.thinkContent && msg.role === 'assistant') {
          const toggleLink = document.createElement('span');
          toggleLink.classList.add('think-toggle');
          toggleLink.textContent = '[View Thoughts]';

          const thinkBox = document.createElement('div');
          thinkBox.classList.add('think-box');
          thinkBox.textContent = msg.thinkContent;

          toggleLink.addEventListener('click', () => {
            thinkBox.style.display = (thinkBox.style.display === 'none' || !thinkBox.style.display) ? 'block' : 'none';
          });

          // AI 气泡内容和思考显示
          bubble.appendChild(toggleLink);
          bubble.appendChild(thinkBox);
        }

        // 垃圾桶按钮
        const trashBtn = document.createElement('span');
        trashBtn.classList.add('trash-btn');
        trashBtn.textContent = '🗑';
        trashBtn.title = 'Delete this message';
        trashBtn.addEventListener('click', () => {
          // 删除该条消息
          currentSession.conversation.splice(index, 1);
          saveSessions(sessions, currentSessionId);
          renderConversation();
        });
        bubble.appendChild(trashBtn);

        chatContainer.appendChild(bubble);
      });
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // ========== [5] 发送消息(前端->后端) ==========
    async function sendMessage(text) {
      if (!text) return;
      userInput.value = "";

      // 1. 前端先加一条用户消息
      currentSession.conversation.push({ role: 'user', content: text });
      saveSessions(sessions, currentSessionId);
      renderConversation();

      // 2. 调后端 /api/chat
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation: currentSession.conversation,
          userMessage: text,
          model: currentSession.model || "mistral"
        })
      });
      const data = await resp.json();

      // 3. 后端返回 AI 消息
      currentSession.conversation.push(data.aiMessage);
      saveSessions(sessions, currentSessionId);
      renderConversation();
    }

    // 按钮 / 回车发送
    sendBtn.addEventListener('click', () => {
      const text = userInput.value.trim();
      sendMessage(text);
    });
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = userInput.value.trim();
        sendMessage(text);
      }
    });

    // ========== [6] 语音输入 (en-US) ==========
    let recognition;
    if ('webkitSpeechRecognition' in window) {
      recognition = new webkitSpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        sendMessage(transcript);
      };
    } else {
      voiceBtn.disabled = true;
      voiceBtn.title = "Your browser doesn't support SpeechRecognition.";
    }
    voiceBtn.addEventListener('click', () => {
      if (recognition) {
        recognition.start();
      }
    });

    // ========== [7] TTS 朗读 (en-US) ==========
    function speakText(text) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      speechSynthesis.speak(utterance);
    }
    ttsBtn.addEventListener('click', () => {
      let lastAiMsg = null;
      for (let i = currentSession.conversation.length - 1; i >= 0; i--) {
        if (currentSession.conversation[i].role === 'assistant') {
          lastAiMsg = currentSession.conversation[i].visibleContent;
          break;
        }
      }
      if (lastAiMsg) speakText(lastAiMsg);
    });

    // ========== [8] Rename 当前会话名称 ==========
    renameBtn.addEventListener('click', () => {
      const newName = prompt("Enter new session name:", currentSession.name);
      if (newName !== null && newName.trim() !== "") {
        currentSession.name = newName.trim();
        saveSessions(sessions, currentSessionId);
        renderSessionSelect();
      }
    });

    // ========== [9] Export 当前会话 ==========
    exportBtn.addEventListener('click', () => {
      // 导出当前会话数据为 JSON
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentSession, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      // 以会话名作为文件名（去掉空格）
      downloadAnchorNode.setAttribute("download", currentSession.name.replace(/\s+/g, "_") + ".json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });

    // ========== [10] Import 会话 ==========
    importBtn.addEventListener('click', () => {
      importFileInput.click();
    });
    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const importedSession = JSON.parse(evt.target.result);
          // 简单校验
          if (!importedSession || !importedSession.id) {
            alert("Invalid session JSON");
            return;
          }
          // 创建一个新会话 id，避免与现有冲突
          const newId = crypto.randomUUID();
          const newSession = {
            id: newId,
            name: importedSession.name || "Imported Session",
            model: importedSession.model || (modelList[0]?.name || "mistral"),
            conversation: Array.isArray(importedSession.conversation) ? importedSession.conversation : []
          };
          sessions.push(newSession);
          currentSessionId = newId;
          currentSession = newSession;

          saveSessions(sessions, currentSessionId);
          renderSessionSelect();
          renderModelOptions();
          renderConversation();
          alert("Import success!");
        } catch (err) {
          alert("Failed to parse JSON file: " + err.message);
        }
      };
      reader.readAsText(file);
      // 重置 input，以便下次可重复导入
      e.target.value = "";
    });
  </script>
</body>
</html>`);
});

// -------------- 2. 获取模型列表 --------------
app.get('/api/tags', async (req, res) => {
  try {
    const tagsResp = await axios.get(OLLAMA_TAGS_URL);
    // 返回形如 { models: [ { name: 'llama2', size: 'xx' }, ... ] }
    res.json(tagsResp.data);
  } catch (error) {
    console.error("获取 Ollama 模型列表失败：", error.message);
    res.json({ models: [] });
  }
});

// -------------- 3. 接收聊天请求，调用 Ollama --------------
app.post('/api/chat', async (req, res) => {
  const { conversation = [], userMessage = "", model = "mistral" } = req.body;

  // 拼接完整 Prompt (忽略 <think>... )
  const promptParts = [];
  conversation.forEach(msg => {
    if (msg.role === 'user') {
      promptParts.push("User: " + msg.content);
    } else if (msg.role === 'assistant') {
      promptParts.push("AI: " + (msg.visibleContent || ""));
    }
  });
  promptParts.push("User: " + userMessage);
  promptParts.push("AI: "); // 期待回答

  const fullPrompt = promptParts.join("\n");

  try {
    // 调 Ollama
    const response = await axios.post(OLLAMA_GENERATE_URL, {
      model,
      prompt: fullPrompt,
      stream: false
    });

    const aiRaw = response.data.response || "";

    // 解析 <think>...</think>
    let visibleContent = aiRaw;
    let thinkContent = "";

    const startTag = "<think>";
    const endTag = "</think>";

    const startIdx = aiRaw.indexOf(startTag);
    const endIdx = aiRaw.indexOf(endTag);

    if (startIdx !== -1 && endIdx === -1) {
      // 只有 <think> 没有 </think>
      visibleContent = "";
      thinkContent = aiRaw.replace(startTag, "").trim();
    } else if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const beforeThink = aiRaw.substring(0, startIdx);
      const insideThink = aiRaw.substring(startIdx + startTag.length, endIdx);
      const afterThink = aiRaw.substring(endIdx + endTag.length);

      visibleContent = (beforeThink + afterThink).trim();
      thinkContent = insideThink.trim();
    }

    const aiMessage = {
      role: 'assistant',
      visibleContent,
      thinkContent
    };

    res.json({ aiMessage });
  } catch (err) {
    console.error("调用 Ollama 出错：", err.message);
    const aiMessage = {
      role: 'assistant',
      visibleContent: "Error: Could not connect to Ollama."
    };
    res.json({ aiMessage });
  }
});

// -------------- 4. 启动服务器 --------------
const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server listening on http://localhost:" + PORT);
});

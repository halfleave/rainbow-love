// 聊天（第4步）：实时收发 / 在线点 / 输入中 / 已读 / 图片
import { sendMessage, loadMessages, markRead, uploadChatImage, getChatImageUrl, subscribeChat, unsubscribeChat } from '../supabase.js';
import { toast, escapeHtml, fmtDateTime } from '../ui.js';

let channel = null;     // 当前订阅频道
let typingTimer = null; // 对方「输入中」自动隐藏计时

// 离开聊天页清理（由 app.js 的 route 在进入其他页前调用）
export function cleanup() {
  if (channel) { unsubscribeChat(channel); channel = null; }
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
}

export async function render(root, ctx) {
  const partner = ctx.partner;
  const me = ctx.me;

  // 个人模式：未配对引导
  if (!partner) {
    root.innerHTML = `
      <div class="page-head fade-in">
        <h1 class="page-title">聊天</h1>
        <p class="page-sub">实时连接彼此</p>
      </div>
      <div class="placeholder">
        <div class="big">🔒</div>
        <p>配对后即可和 TA 实时聊天<br>
        <button class="btn ghost" id="goPair">去配对</button></p>
      </div>`;
    root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));
    return;
  }

  const coupleId = ctx.coupleId;
  const myId = me.id;

  root.innerHTML = `
    <div class="chat-page fade-in">
      <header class="chat-head">
        <div class="avatar sm" style="background:${escapeHtml(partner.color || '#999')}">${(escapeHtml(partner.nickname || '?'))[0]}</div>
        <div class="chat-peer">
          <div class="name">${escapeHtml(partner.nickname || 'TA')}</div>
          <div class="status" id="peerStatus"><span class="dot off"></span> 离线</div>
        </div>
      </header>
      <div class="chat-list" id="list"></div>
      <div class="typing" id="typing" hidden>${escapeHtml(partner.nickname || 'TA')} 正在输入…</div>
      <div class="chat-input">
        <button class="icon-btn" id="imgBtn" aria-label="发送图片">📷</button>
        <input id="msg" class="text-input" placeholder="和 TA 说点什么…" maxlength="2000" autocomplete="off">
        <button class="btn primary sm" id="send">发送</button>
      </div>
      <input type="file" id="file" accept="image/*" hidden>
    </div>`;

  const list = root.querySelector('#list');
  const input = root.querySelector('#msg');
  const typingEl = root.querySelector('#typing');
  const statusEl = root.querySelector('#peerStatus');

  const renderMsg = (m) => {
    const mine = m.sender_id === myId;
    const who = mine ? me : partner;
    const imgHtml = m.kind === 'image'
      ? `<img class="msg-img" src="${escapeHtml(getChatImageUrl(m.image_url))}" alt="图片" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'msg-img-fallback',textContent:'图片加载失败'}))">`
      : '';
    const textHtml = m.body ? `<div class="bubble">${escapeHtml(m.body)}</div>` : '';
    const readMark = mine
      ? (m.read_at ? '<span class="read">已读</span>' : '<span class="unread">送达</span>')
      : '';
    const avatar = mine ? '' :
      `<div class="avatar xs" style="background:${escapeHtml(who.color || '#999')}">${(escapeHtml(who.nickname || '?'))[0]}</div>`;
    return `
      <div class="msg ${mine ? 'mine' : 'theirs'}">
        ${avatar}
        <div class="msg-col">
          ${imgHtml}${textHtml}
          <div class="msg-meta">${fmtDateTime(m.created_at)} ${readMark}</div>
        </div>
      </div>`;
  };

  const appendMsg = (m) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderMsg(m);
    list.appendChild(tmp.firstElementChild);
    list.scrollTop = list.scrollHeight;
  };

  // 1) 加载历史
  try {
    const history = await loadMessages(coupleId, 50);
    history.forEach((m) => list.insertAdjacentHTML('beforeend', renderMsg(m)));
  } catch (e) {
    console.warn('加载聊天历史失败', e);
  }
  list.scrollTop = list.scrollHeight;

  // 2) 打开会话即把对方消息标记已读
  markRead(coupleId, myId).catch((e) => console.warn(e));

  // 3) 订阅实时增量 / 在线 / 输入中
  channel = subscribeChat({
    coupleId,
    myId,
    onInsert: (m) => {
      appendMsg(m);
      if (m.sender_id !== myId) markRead(coupleId, myId).catch(() => {});
    },
    onPresence: (online) => {
      statusEl.innerHTML = online
        ? '<span class="dot on"></span> 在线'
        : '<span class="dot off"></span> 离线';
    },
    onTyping: () => {
      typingEl.hidden = false;
      list.scrollTop = list.scrollHeight;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { typingEl.hidden = true; }, 2500);
    }
  });

  // 4) 发送文字
  const doSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await sendMessage({ coupleId, body: text });
    } catch (e) {
      console.error(e);
      toast('发送失败：' + (e.message || e));
      input.value = text; // 回滚，方便重发
    }
  };
  root.querySelector('#send').addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  // 5) 输入时广播「正在输入」
  input.addEventListener('input', () => {
    if (channel) channel.send({ type: 'broadcast', event: 'typing', payload: {} }).catch(() => {});
  });

  // 6) 发送图片
  const fileInput = root.querySelector('#file');
  root.querySelector('#imgBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    try {
      toast('图片上传中…', 1500);
      const path = await uploadChatImage(coupleId, file);
      await sendMessage({ coupleId, imageUrl: path });
    } catch (e) {
      console.error(e);
      toast('图片发送失败：' + (e.message || e));
    }
  });
}

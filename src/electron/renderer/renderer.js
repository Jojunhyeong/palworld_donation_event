const api = window.desktopApi;
const connectButton = document.querySelector('#connect-button');
const statusText = document.querySelector('#chzzk-status');
const globalStatus = document.querySelector('#global-status');
const activityList = document.querySelector('#activity-list');
const palworldStatus = document.querySelector('#palworld-status');
const partyPanel = document.querySelector('#party-panel');
const partyToggleButton = document.querySelector('#party-toggle-button');
const partyLinkBox = document.querySelector('#party-link-box');
const partyMemberList = document.querySelector('#party-member-list');
const palworldPlayerList = document.querySelector('#palworld-player-list');
let isConnected = false;
let appMode = 'personal';
let partyRunning = false;
const partyMembers = new Map();

function updateGlobalStatus() {
  const online = isConnected || partyRunning;
  globalStatus.className = `status-pill ${online ? 'online' : 'offline'}`;
  globalStatus.innerHTML = `<span></span>${partyRunning ? '파티 수신 중' : isConnected ? '치지직 연결됨' : '연결 안 됨'}`;
}

function setChzzkStatus(status) {
  const labels = {
    authorizing: '브라우저 인증 중',
    connecting: '세션 연결 중',
    connected: '연결됨',
    disconnected: '연결 안 됨',
    error: '연결 오류',
  };
  statusText.textContent = labels[status] ?? status;
  isConnected = status === 'connected';
  connectButton.textContent = isConnected ? '연결 끊기' : '치지직 연결';
  connectButton.disabled = ['authorizing', 'connecting'].includes(status);
  updateGlobalStatus();
}

function renderMode(mode) {
  appMode = mode;
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  document.querySelector('#mode-badge').textContent = mode === 'personal' ? '개인 모드' : '파티 방장 모드';
  partyPanel.classList.toggle('hidden', mode !== 'party-host');
}

function setPartyStatus(status) {
  partyRunning = status === 'running';
  const badge = document.querySelector('#party-status-badge');
  badge.textContent = partyRunning ? '수신 중' : status === 'error' ? '오류' : '중지됨';
  badge.className = `badge ${partyRunning ? 'saved' : 'waiting'}`;
  partyToggleButton.textContent = partyRunning ? '파티 종료' : '파티 시작';
  partyLinkBox.classList.toggle('hidden', !partyRunning);
  updateGlobalStatus();
}

function renderPartyMembers() {
  partyMemberList.replaceChildren();
  if (partyMembers.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-inline';
    empty.textContent = '아직 연결된 친구가 없습니다.';
    partyMemberList.append(empty);
    return;
  }
  for (const member of partyMembers.values()) {
    const item = document.createElement('div');
    item.className = 'member-item';
    const info = document.createElement('div');
    const name = document.createElement('strong');
    const state = document.createElement('small');
    const actions = document.createElement('span');
    const test = document.createElement('button');
    const remove = document.createElement('button');
    name.textContent = member.playerName;
    state.textContent = member.status === 'connected' ? '치지직 연결됨' : member.status === 'error' ? '재인증 필요' : '연결 중';
    state.className = `member-state ${member.status ?? ''}`;
    test.textContent = '고기 테스트';
    test.addEventListener('click', async () => {
      const result = await api.testPartyTarget(member.playerName);
      if (!result.ok) addActivity('error', `${member.playerName} 대상 테스트 실패`, result.message);
    });
    remove.textContent = '연결 해제';
    remove.addEventListener('click', async () => {
      await api.removePartyMember(member.memberId);
      partyMembers.delete(member.memberId);
      renderPartyMembers();
    });
    actions.className = 'member-actions';
    actions.append(test, remove);
    info.append(name, state);
    item.append(info, actions);
    partyMemberList.append(item);
  }
}

function renderPalworldPlayers(players) {
  palworldPlayerList.replaceChildren();
  if (!players.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-inline';
    empty.textContent = '현재 확인된 접속자가 없습니다.';
    palworldPlayerList.append(empty);
    return;
  }
  for (const playerName of players) {
    const item = document.createElement('div');
    item.className = 'player-item';
    const name = document.createElement('strong');
    const linked = document.createElement('span');
    name.textContent = playerName;
    linked.textContent = [...partyMembers.values()].some((member) => member.playerName === playerName) ? '방송 연결됨' : '미연결';
    linked.className = 'member-state';
    item.append(name, linked);
    palworldPlayerList.append(item);
  }
}

function setPalworldStatus(status) {
  const labels = {
    connected: '연결됨',
    preparing: '모드 설치 중',
    ready: '모드 설치 완료',
    error: '연결 오류',
  };
  palworldStatus.textContent = labels[status] ?? '연결 안 됨';
}

function addActivity(kind, title, message) {
  activityList.querySelector('.empty-state')?.remove();
  const item = document.createElement('div');
  item.className = `activity-item ${kind}`;
  const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  const heading = document.createElement('strong');
  const body = document.createElement('p');
  const stamp = document.createElement('time');
  heading.textContent = title;
  body.textContent = message;
  stamp.textContent = time;
  item.append(heading, body, stamp);
  activityList.prepend(item);
}

async function loadConfig() {
  const config = await api.getConfig();
  if (config.clientModInstalled) setPalworldStatus('ready');
  renderMode(config.appMode ?? 'personal');
  for (const member of config.partyMembers ?? []) partyMembers.set(member.memberId, { ...member, status: 'disconnected' });
  renderPartyMembers();
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', async () => {
    const mode = button.dataset.mode;
    const result = await api.setMode(mode);
    if (result.ok) {
      renderMode(mode);
      if (mode === 'personal') setPartyStatus('stopped');
    }
  });
});

partyToggleButton.addEventListener('click', async () => {
  partyToggleButton.disabled = true;
  try {
    if (partyRunning) {
      await api.stopParty();
      setPartyStatus('stopped');
      return;
    }
    const result = await api.startParty();
    if (!result.ok) throw new Error(result.message);
    document.querySelector('#party-code').value = result.partyCode;
    document.querySelector('#party-join-url').value = result.joinUrl;
    setPartyStatus('running');
    addActivity('success', '파티 시작', '친구 방송인에게 참여 링크를 보내 주세요.');
  } catch (error) {
    setPartyStatus('error');
    addActivity('error', '파티 시작 실패', error.message ?? String(error));
  } finally {
    partyToggleButton.disabled = false;
  }
});

document.querySelector('#copy-party-link').addEventListener('click', async () => {
  const value = document.querySelector('#party-join-url').value;
  if (!value) return;
  await api.copyText(value);
  addActivity('success', '참여 링크 복사', '친구 방송인에게 이 링크를 보내면 됩니다.');
});

document.querySelector('#refresh-player-list').addEventListener('click', async () => {
  const result = await api.listPalworldPlayers();
  if (!result.ok) {
    addActivity('error', '접속자 확인 실패', result.message);
    return;
  }
  renderPalworldPlayers(result.players ?? []);
});

connectButton.addEventListener('click', async () => {
  if (isConnected) {
    await api.disconnectChzzk();
    return;
  }
  const result = await api.connectChzzk();
  if (!result.ok) addActivity('error', '치지직 연결 실패', result.message);
});

document.querySelector('#palworld-test-button').addEventListener('click', async () => {
  try {
    palworldStatus.textContent = '연결 확인 중';
    const result = await api.testPalworld();
    if (!result.ok) throw new Error(result.message);
    addActivity('success', '팰월드 연결 성공', '일반 초대방에서 방장 모드가 실행 중입니다.');
  } catch (error) {
    setPalworldStatus('error');
    addActivity('error', '팰월드 연결 실패', error.message ?? String(error));
  }
});

document.querySelector('#palworld-setup-button').addEventListener('click', async () => {
  const button = document.querySelector('#palworld-setup-button');
  button.disabled = true;
  button.textContent = '모드 설치 중';
  try {
    const result = await api.preparePalworld();
    addActivity(result.ok ? 'success' : 'error', '방장 모드 설치', result.message);
  } catch (error) {
    addActivity('error', '방장 모드 설치', error.message ?? String(error));
  } finally {
    button.disabled = false;
    button.textContent = '방장 모드 설치';
  }
});

document.querySelectorAll('[data-test-amount]').forEach((button) => {
  button.addEventListener('click', async () => {
    const amount = Number(button.dataset.testAmount);
    const result = await api.testEffect(amount);
    if (!result.ok) addActivity('error', '효과 테스트 실패', result.message);
  });
});

document.querySelector('#clear-log').addEventListener('click', () => {
  activityList.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = '활동 기록을 비웠습니다.';
  activityList.append(empty);
});

api.onEvent((event) => {
  if (event.type === 'status' && event.payload.chzzk) setChzzkStatus(event.payload.chzzk);
  if (event.type === 'status' && event.payload.palworld) setPalworldStatus(event.payload.palworld);
  if (event.type === 'log') addActivity(event.payload.level === 'error' ? 'error' : 'system', '시스템', event.payload.message);
  if (event.type === 'chat') addActivity('chat', event.payload.profile?.nickname ?? '알 수 없음', event.payload.content ?? '-');
  if (event.type === 'donation') {
    addActivity('donation', `${event.payload.donatorNickname ?? '익명'} · ${event.payload.payAmount ?? 0}원`, event.payload.donationText ?? '-');
  }
  if (event.type === 'effect') {
    const mode = event.payload.mode === 'live' ? '실제 실행' : '테스트';
    const target = event.payload.targetPlayerName ? ` · ${event.payload.targetPlayerName}` : '';
    addActivity('effect', `${Number(event.payload.amount).toLocaleString('ko-KR')}원 · ${event.payload.label}${target}`, `${event.payload.detail} (${mode})`);
  }
  if (event.type === 'mode') renderMode(event.payload.mode);
  if (event.type === 'party') {
    setPartyStatus(event.payload.status);
    if (event.payload.joinUrl) {
      document.querySelector('#party-code').value = event.payload.partyCode;
      document.querySelector('#party-join-url').value = event.payload.joinUrl;
    }
  }
  if (event.type === 'party-member') {
    if (event.payload.removed) partyMembers.delete(event.payload.memberId);
    else partyMembers.set(event.payload.memberId, { ...partyMembers.get(event.payload.memberId), ...event.payload });
    renderPartyMembers();
  }
  if (event.type === 'party-donation') {
    const donation = event.payload.donation;
    addActivity('donation', `${event.payload.playerName} 방송 · ${donation.donatorNickname ?? '익명'} · ${donation.payAmount ?? 0}원`, donation.donationText ?? '-');
  }
});

loadConfig().catch((error) => addActivity('error', '설정 불러오기 실패', error.message ?? String(error)));

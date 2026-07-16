const api = window.desktopApi;
const connectButton = document.querySelector('#connect-button');
const statusText = document.querySelector('#chzzk-status');
const globalStatus = document.querySelector('#global-status');
const activityList = document.querySelector('#activity-list');
const palworldStatus = document.querySelector('#palworld-status');
let isConnected = false;

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
  globalStatus.className = `status-pill ${isConnected ? 'online' : 'offline'}`;
  globalStatus.innerHTML = `<span></span>${isConnected ? '치지직 연결됨' : '연결 안 됨'}`;
}

function setPalworldStatus(status) {
  const labels = {
    connected: '연결됨',
    preparing: '설치·설정 중',
    ready: '설정 완료',
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
  if (config.serverInstalled) setPalworldStatus('ready');
}

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
    addActivity('success', 'PalDefender 연결 성공', `${result.players.length}명의 캐릭터를 확인했습니다.`);
  } catch (error) {
    setPalworldStatus('error');
    addActivity('error', 'PalDefender 연결 실패', error.message ?? String(error));
  }
});

document.querySelector('#palworld-setup-button').addEventListener('click', async () => {
  const button = document.querySelector('#palworld-setup-button');
  button.disabled = true;
  button.textContent = '설치·설정 중';
  try {
    const result = await api.preparePalworld();
    addActivity(result.ok ? 'success' : 'error', '팰월드 서버 준비', result.message);
  } catch (error) {
    addActivity('error', '팰월드 서버 준비', error.message ?? String(error));
  } finally {
    button.disabled = false;
    button.textContent = '서버 자동 설정';
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
    addActivity('effect', `${Number(event.payload.amount).toLocaleString('ko-KR')}원 · ${event.payload.label}`, `${event.payload.detail} (${mode})`);
  }
});

loadConfig().catch((error) => addActivity('error', '설정 불러오기 실패', error.message ?? String(error)));

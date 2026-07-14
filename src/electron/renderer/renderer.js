const api = window.desktopApi;
const form = document.querySelector('#config-form');
const connectButton = document.querySelector('#connect-button');
const statusText = document.querySelector('#chzzk-status');
const globalStatus = document.querySelector('#global-status');
const activityList = document.querySelector('#activity-list');
const savedBadge = document.querySelector('#saved-badge');
const palworldForm = document.querySelector('#palworld-form');
const palworldStatus = document.querySelector('#palworld-status');
const palworldSavedBadge = document.querySelector('#palworld-saved-badge');
const playerSelect = document.querySelector('#palworld-player');
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
  palworldStatus.textContent = status === 'connected' ? '연결됨' : status === 'error' ? '연결 오류' : '연결 안 됨';
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
  document.querySelector('#client-id').value = config.clientId;
  document.querySelector('#redirect-uri').value = config.redirectUri;
  savedBadge.textContent = config.hasClientSecret ? '저장됨' : '미저장';
  savedBadge.classList.toggle('saved', config.hasClientSecret);
  document.querySelector('#paldefender-url').value = config.palDefenderUrl;
  document.querySelector('#test-mode').checked = config.testMode;
  palworldSavedBadge.textContent = config.hasPalDefenderToken ? '저장됨' : '미저장';
  palworldSavedBadge.classList.toggle('saved', config.hasPalDefenderToken);
  if (config.palworldPlayerId) {
    playerSelect.replaceChildren(new Option(config.palworldPlayerId, config.palworldPlayerId, true, true));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api.saveConfig({
      clientId: document.querySelector('#client-id').value,
      clientSecret: document.querySelector('#client-secret').value,
      redirectUri: document.querySelector('#redirect-uri').value,
    });
    document.querySelector('#client-secret').value = '';
    savedBadge.textContent = '저장됨';
    savedBadge.classList.add('saved');
    addActivity('success', '설정 저장', '보안 저장소에 암호화해 저장했습니다.');
  } catch (error) {
    addActivity('error', '설정 저장 실패', error.message ?? String(error));
  }
});

connectButton.addEventListener('click', async () => {
  if (isConnected) {
    await api.disconnectChzzk();
    return;
  }
  const result = await api.connectChzzk();
  if (!result.ok) addActivity('error', '치지직 연결 실패', result.message);
});

async function savePalworldConfig() {
  const config = await api.savePalworldConfig({
    baseUrl: document.querySelector('#paldefender-url').value,
    token: document.querySelector('#paldefender-token').value,
    playerId: playerSelect.value,
    testMode: document.querySelector('#test-mode').checked,
  });
  document.querySelector('#paldefender-token').value = '';
  palworldSavedBadge.textContent = config.hasPalDefenderToken ? '저장됨' : '설정 저장됨';
  palworldSavedBadge.classList.add('saved');
}

palworldForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await savePalworldConfig();
    addActivity('success', '서버 설정 저장', 'PalDefender 연결 정보를 암호화해 저장했습니다.');
  } catch (error) {
    addActivity('error', '서버 설정 실패', error.message ?? String(error));
  }
});

document.querySelector('#palworld-test-button').addEventListener('click', async () => {
  try {
    await savePalworldConfig();
    palworldStatus.textContent = '연결 확인 중';
    const result = await api.testPalworld();
    if (!result.ok) throw new Error(result.message);
    const previous = playerSelect.value;
    playerSelect.replaceChildren(new Option('캐릭터를 선택하세요', ''));
    result.players.forEach((player) => {
      const id = player.UserId || player.PlayerUID;
      playerSelect.add(new Option(`${player.Name} · ${player.Status}`, id, false, id === previous));
    });
    addActivity('success', 'PalDefender 연결 성공', `${result.players.length}명의 캐릭터를 확인했습니다.`);
  } catch (error) {
    setPalworldStatus('error');
    addActivity('error', 'PalDefender 연결 실패', error.message ?? String(error));
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
    addActivity('effect', `${Number(event.payload.amount).toLocaleString('ko-KR')}원 · ${event.payload.label}`, `${event.payload.detail} (테스트 모드)`);
  }
});

loadConfig().catch((error) => addActivity('error', '설정 불러오기 실패', error.message ?? String(error)));

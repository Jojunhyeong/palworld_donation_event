# Pal Donation Bridge

치지직 채팅·후원 이벤트를 팰월드 일반 멀티플레이 초대방의 방장 캐릭터에게 연결하는 Windows 데스크톱 애플리케이션입니다.

## 현재 구현 범위

- 치지직 OAuth 인증
- Socket.IO v2 세션 연결
- 일반 채팅과 후원 이벤트 수신
- Electron 데스크톱 UI
- 사용자에게 Client ID·Secret·리디렉션 URL을 요구하지 않는 간편 로그인
- Cloudflare Worker Secret 저장소를 이용한 OAuth 토큰 교환
- AES-GCM 암호화 및 1회 수령 후 삭제되는 인증 티켓
- 운영체제 보안 저장소를 이용한 사용자 토큰 암호화
- Steam에 설치된 팰월드 자동 탐색
- SHA-256 검증 후 팰월드 1.0용 UE4SS와 방장용 모드 자동 설치
- IP·포트포워딩 없이 팰월드의 일반 초대 코드 사용
- 방장 PC 내부 명령 파일을 이용한 앱↔게임 통신
- 1천원 후원 시 방장 캐릭터에게 닭고기 5개 지급하는 시험 기능
- GitHub Actions를 이용한 Windows `Setup.exe` 자동 빌드

> 일반 초대방 모드는 현재 Windows 실전 검증 단계입니다. 1천원 효과와 모드 없는 친구의 참가가 확인된 뒤 나머지 금액 효과를 활성화합니다.

## 개발 실행

```bash
npm install
npm run desktop:dev
```

CLI 수신기는 다음으로 실행합니다.

```bash
npm run dev
```

## 빌드

```bash
npm run build
npm run package
```

Windows 설치 파일은 GitHub Actions의 `Build Windows installer` 워크플로를 수동 실행하면 생성됩니다.

## 인증 서비스

최종 사용자는 치지직 인증 정보를 입력하지 않습니다. `worker/`의 Cloudflare Worker가 Client Secret을 암호화된 Secret으로 보관하고 OAuth 토큰 교환을 대행합니다. 운영자의 최초 배포 절차는 [docs/OPERATOR_SETUP.md](docs/OPERATOR_SETUP.md)를 참고하세요.

## 보안

- `.env`는 Git에 포함되지 않습니다.
- Client Secret, Access Token, Refresh Token을 이슈·로그·커밋에 올리지 마세요.
- 게임 명령은 외부 네트워크 포트를 열지 않고 방장 PC 내부의 명령 파일로만 전달합니다.
- UE4SS는 앱에 재배포하지 않고 팰월드용 원본 GitHub 릴리스에서 실행 시 내려받아 SHA-256으로 검증합니다.
- 기존 UE4SS가 발견되면 사용자 파일을 덮어쓰지 않고 설치를 중단합니다.

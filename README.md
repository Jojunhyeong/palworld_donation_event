# Pal Donation Bridge

치지직 채팅·후원 이벤트를 수신해 Palworld Dedicated Server 이벤트로 연결하는 Windows 데스크톱 애플리케이션입니다.

## 현재 구현 범위

- 치지직 OAuth 인증
- Socket.IO v2 세션 연결
- 일반 채팅과 후원 이벤트 수신
- Electron 데스크톱 UI
- 사용자에게 Client ID·Secret·리디렉션 URL을 요구하지 않는 간편 로그인
- Cloudflare Worker Secret 저장소를 이용한 OAuth 토큰 교환
- AES-GCM 암호화 및 1회 수령 후 삭제되는 인증 티켓
- 운영체제 보안 저장소를 이용한 사용자 토큰 암호화
- PalDefender 연결 확인과 스트리머 캐릭터 선택
- 금액별 후원 효과 테스트 모드
- GitHub Actions를 이용한 Windows `Setup.exe` 자동 빌드

> 실제 팰월드 아이템 지급·이동·사망 실행기는 개발 중입니다. 현재 후원 효과는 테스트 모드로만 표시됩니다.

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
- Client Secret, Access Token, Refresh Token, PalDefender Token을 이슈·로그·커밋에 올리지 마세요.
- PalDefender API는 `127.0.0.1`에서만 접속하도록 설계했습니다.

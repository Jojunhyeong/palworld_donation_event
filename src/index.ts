import dotenv from 'dotenv';
import { authorizeWithLocalCallback } from './chzzk/auth';
import { createChzzkSession } from './chzzk/session';
import { connectDonationListener } from './chzzk/donation-listener';
import { getSafeErrorMessage } from './chzzk/api-error';

dotenv.config();

async function main() {
  try {
    let accessToken = process.env.CHZZK_ACCESS_TOKEN?.trim();

    if (!accessToken) {
      const tokens = await authorizeWithLocalCallback();
      accessToken = tokens.accessToken;
      console.log('치지직 인증 완료. 세션을 연결합니다.');
    }

    const sessionUrl = await createChzzkSession(accessToken);
    console.log('치지직 세션 URL을 받았습니다.');

    const socket = connectDonationListener(sessionUrl, accessToken, {
      onLog: console.log,
      onError: console.error,
    });

    socket.on('connect', () => {
      console.log('치지직 세션에 연결되었습니다.');
    });

    socket.on('disconnect', () => {
      console.log('치지직 세션 연결이 종료되었습니다.');
    });
  } catch (error) {
    console.error(getSafeErrorMessage(error, '초기화 중 오류가 발생했습니다.'));
    process.exitCode = 1;
  }
}

main();

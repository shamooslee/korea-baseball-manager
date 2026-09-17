#!/bin/bash
# 광훈이 야구게임 배포 스크립트
# 1) GitHub에 올리기(게임 화면) 2) Cloudflare에 올리기(실시간 대결 서버)

cd "$(dirname "$0")" || exit 1

echo "======================================"
echo "  ⚾ 야구게임 배포 시작"
echo "======================================"
echo ""

echo "▶ [1/2] GitHub에 게임 올리는 중..."
echo "  (안 올라간 커밋 $(git rev-list --count origin/main..HEAD 2>/dev/null)개)"
git push origin main
PUSH_OK=$?
if [ $PUSH_OK -eq 0 ]; then
  echo "  ✅ GitHub 올리기 성공"
  echo "     https://shamooslee.github.io/korea-baseball-manager/"
else
  echo "  ❌ GitHub 올리기 실패 (위 메시지를 클로드에게 보여주세요)"
fi
echo ""

echo "▶ [2/2] 실시간 대결 서버 올리는 중..."
cd cf-server || exit 1
npx --yes wrangler deploy
DEPLOY_OK=$?
if [ $DEPLOY_OK -eq 0 ]; then
  echo "  ✅ 서버 올리기 성공"
  echo "     https://yagu-pvp.hunastay.workers.dev"
else
  echo "  ❌ 서버 올리기 실패 (위 메시지를 클로드에게 보여주세요)"
fi
echo ""

echo "======================================"
echo "  끝났습니다. 결과를 클로드에게 알려주세요."
echo "  창은 그냥 닫으시면 됩니다."
echo "======================================"

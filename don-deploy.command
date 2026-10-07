#!/bin/bash
# 우리집 돈 배포 스크립트 — 더블클릭하면 실행돼요
cd "$(dirname "$0")" || exit 1
echo "======================================"
echo "  💰 우리집 돈 배포 시작"
echo "======================================"
echo ""
echo "▶ [1/2] 최신 코드 받는 중..."
git pull --rebase origin main || { echo "  ❌ 받기 실패 (위 메시지를 클로드에게 보여주세요)"; read -n 1; exit 1; }
echo ""
echo "▶ [2/2] Cloudflare에 올리는 중..."
cd don-worker || exit 1
npx --yes wrangler deploy
if [ $? -eq 0 ]; then
  echo ""
  echo "  ✅ 성공! 주소: https://don.hunastay.workers.dev"
else
  echo "  ❌ 실패 (위 메시지를 클로드에게 보여주세요)"
fi
echo ""
echo "아무 키나 누르면 창이 닫혀요."
read -n 1

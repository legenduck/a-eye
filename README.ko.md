<div align="center">

<img src="assets/poster.png" alt="A-EYE 메인 피겨" width="720"/>

# A-EYE: Can Large Language Models be an Effective Blind Helper?

**김덕용 · 박준형 · 이준성**

대상 (정보통신기획평가원장상) — 2025 SW중심대학 디지털 경진대회  
1등 — SK AI Summit *AI's Got Talent* (2025년 11월)

[English](README.md) · **한국어** · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## 개요

시각장애인을 위한 실시간 시각 보조 웹 서비스로, 대규모 언어 모델이 효과적인 시각 보조 도우미가 될 수 있는지를 탐구합니다. 휴대폰 카메라로 촬영한 장면이 Flask 백엔드로 전송되고, Google Gemini(시각-언어 추론), Depth Anything V2(근접 경고용 metric depth), 네이버 클라우드 지도(턴바이턴 길안내)를 결합해 앞에 무엇이 있는지 간결한 음성 안내로 전달합니다.

## 주요 기능

- **장면 내레이션.** 카메라에서 프레임을 캡처해 보행 안전(장애물, 표지판, 대중교통 정보)에 맞춰 조정된 프롬프트와 함께 Gemini로 보내고, 응답을 브라우저 TTS로 읽어줍니다.
- **파이프라이닝 추론.** 최대 3개의 Gemini API 키를 병렬로 순환 호출해, 직전 TTS가 끝날 즈음엔 보통 새로운 설명이 대기 중입니다.
- **근접 경고.** Depth Anything V2(metric, ViT-S/Hypersim)가 같은 프레임에서 동작하며, 약 50cm 이내에 무언가 감지되면 경고음이 울립니다. 1회성 보정 단계로 사용자 키를 디바이스별 스케일 팩터로 변환합니다.
- **턴바이턴 길안내.** 목적지 키워드를 입력하면 서버가 네이버 검색 + 네이버 클라우드 지도 지오코딩으로 좌표를 찾고, 도보 경로를 가져온 뒤 브라우저 GPS가 새 위치를 보고할 때마다 웨이포인트를 진행합니다.

## 아키텍처

```
브라우저 (templates/index.html, static/script.js)
  │  카메라 프레임, GPS, TTS/STT
  ▼
Flask 서버 (server.py) ──► Gemini (시각)              장면 설명
                       ├► Depth Anything V2          근접 경고
                       └► 네이버 검색 + NCP 지도     지오코딩 + 길안내
```

| 레이어 | 파일 / 모듈 |
| --- | --- |
| HTTP + 오케스트레이션 | `server.py` |
| Depth 모델 | `depth_anything_v2/` (DINOv2 백본 + DPT 헤드) |
| 프론트엔드 UI | `templates/index.html`, `static/script.js`, `static/style.css` |
| 경고음 | `static/1.wav` |
| 모델 체크포인트 | `checkpoints/depth_anything_v2_metric_hypersim_vits.pth` |

## 사전 요구사항

- Python 3.10 (conda 권장)
- CUDA 지원 GPU 권장. 보정(`/calibrate`)은 GPU 환경에서만 동작하며, depth 추론은 CPU에서도 동작하지만 느립니다.
- API 키:
  - **Google Gemini** — 최소 1개 (`API_KEY_1`); `API_KEY_2`, `API_KEY_3` 추가 시 병렬 순환 활성화.
  - **네이버 클라우드 지도** — Static Map, Geocoding, Reverse Geocoding, Directions 5/15.
  - **네이버 검색** — 지오코딩 전에 장소명을 주소로 변환하는 데 사용.

## 설치

```bash
cp .env.template .env
# API_KEY_1..3, NAVER_CLIENT_ID/SECRET, NCP_CLIENT_ID/SECRET 입력

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
```

## Depth 모델 체크포인트

`checkpoints/` 아래에 Depth Anything V2 metric depth 가중치를 배치합니다. 기본은 small Hypersim(실내) 모델입니다:

```bash
mkdir -p checkpoints
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth \
  https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
```

다른 사이즈(Base / Large)와 야외용 VKITTI 모델은 [Depth Anything V2 컬렉션](https://huggingface.co/depth-anything)에서 받을 수 있습니다. 모델 변경 시 현재는 `server.py`의 `MODEL_CONFIGS`와 체크포인트 파일명을 직접 수정해야 합니다.

## 실행

```bash
python server.py            # 0.0.0.0:8081 에서 수신 대기
python server.py --debug    # Flask 디버그 모드
```

휴대폰 브라우저에서 `http://<host>:8081` 접속 (카메라/마이크 권한 필요).

### 키보드 단축키 (데스크톱)

- `Space` — 장면 자동 분석 시작 / 정지
- `Esc` — 길안내 중지(활성 시) 또는 설정 패널 닫기

## 엔드포인트

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| GET  | `/`                          | 웹 UI |
| GET  | `/get_models`                | 사용 가능한 Gemini 모델 목록 |
| POST | `/describe`                  | 프레임 제출, 설명 응답 (파이프라이닝 자동 시작) |
| POST | `/upload_image`              | 파이프라이닝 워커용 최신 프레임 등록 |
| POST | `/start_auto_processing`    | 백그라운드 파이프라이닝 워커 시작 |
| POST | `/stop_auto_processing`     | 워커, 큐, 최신 응답 정지 및 정리 |
| GET  | `/get_response`              | 최신 파이프라이닝 설명 가져오기 |
| POST | `/set_tts_status`           | TTS 발화 중인지 서버에 알림 |
| GET  | `/get_tts_status`           | TTS 상태 조회 |
| GET  | `/get_queue_status`         | 진단용: 파이프라인 / API / TTS 상태 |
| POST | `/calibrate`                 | 키 + 중앙 프레임 depth로 1회성 보정 |
| POST | `/analyze_depth`             | 보정 계수로 ~50cm 이내 물체 감지 |
| POST | `/start_navigation`         | 목적지 해석, 경로 조회, 세션 생성 |
| POST | `/update_location`          | 현재 GPS로 웨이포인트 진행 |
| POST | `/navigation_describe`      | 활성 경로 컨텍스트로 프레임 설명 |
| GET  | `/get_current_instruction`  | 현재 웨이포인트 안내 조회 |
| POST | `/end_navigation`           | 길안내 세션 비활성화 |
| GET  | `/directions`                | 1회성 길안내 조회 (세션 없음) |
| GET  | `/logs`, `/logs/clear`       | `server.log` 보기 / 비우기 |

## 보정 동작 방식

사용자가 키(cm)를 입력합니다. 서버는 팔 길이를 `키 * 0.26 / 100` 미터로 추정(예: 175cm → 약 0.45m)하고, 팔 길이 거리에서 잡힌 프레임의 중앙 depth를 측정한 뒤, `팔 길이 / 측정 depth`를 사용자별 스케일 팩터로 저장합니다. 이후 depth map은 이 계수를 곱한 다음 0.5m 근접 임계값과 비교됩니다.

## 비고

- 파이프라이닝 설계는 *발화까지의 시간*을 최적화합니다: 새 요청은 큐에 있는 직전 설명을 즉시 반환하면서, 다음 설명은 이미 다른 API 키에서 추론 중입니다.
- TTS 발화 중이거나 정지 신호가 발사된 상태라면 Gemini 응답을 폐기해, 사용자에게 오래된 프레임 설명이 읽히지 않습니다.
- 현재는 V1(key-id / key) 네이버 클라우드 지도 길안내 엔드포인트만 연결되어 있습니다. API Gateway v2 인증 스킴으로의 마이그레이션은 향후 작업입니다.

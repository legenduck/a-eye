# 실시간 웹캠 거리 측정 (Depth Anything V2) 서버

단일 카메라(웹캠) 이미지를 사용하여 실시간으로 절대 거리를 측정하고, 웹 인터페이스를 통해 결과를 시각화하는 서버입니다. [Depth Anything V2](https://github.com/LiheYoung/Depth-Anything)의 Metric Depth 모델을 기반으로 하며, 실내/실외 환경 및 모델 크기(Small, Base, Large)에 따라 총 6가지 모델을 선택하여 사용할 수 있습니다.

## 주요 기능

- **실시간 거리 측정**: 웹캠 영상을 실시간으로 받아 깊이를 분석하고 거리를 m(미터) 단위로 반환합니다.
- **다중 모델 지원**: 실내(Hypersim) 및 실외(VKITTI) 데이터셋으로 사전 훈련된 6가지 모델을 동적으로 로드하여 사용합니다.
- **상세 정보 시각화**:
  - 화면을 3x3 격자로 나누어 각 구역의 평균/최소 거리 표시
  - 화면 정중앙 지점의 거리 표시
  - 전체 화면에서 가장 가까운 물체의 거리 표시
- **웹 기반 인터페이스**: 사용자가 웹 브라우저를 통해 쉽게 모델을 선택하고 실시간 분석 결과를 확인할 수 있습니다.

## 설치 안내

### 1. 프로젝트 복제 및 이동

```bash
# 이 프로젝트 폴더(depthanything_v2_test)를 새로운 서버에 복제하거나 전송합니다.
cd depthanything_v2_test
```

### 2. 필요 라이브러리 설치

새로운 서버에 `requirements.txt` 파일을 사용하여 필요한 모든 파이썬 라이브러리를 한 번에 설치합니다.

```bash
pip install -r requirements.txt
```

> **참고**: PyTorch의 경우, CUDA 버전에 맞는 버전을 설치하는 것이 좋습니다. [PyTorch 공식 홈페이지](https://pytorch.org/get-started/locally/)에서 GPU 환경에 맞는 설치 명령어를 확인하세요.

### 3. 모델 다운로드

**중요**: 이 저장소에는 모델 파일이 포함되어 있지 않습니다. 사용하기 전에 아래 모델들을 다운로드해야 합니다.

미리 훈련된 6개의 모델 가중치 파일을 `checkpoints/` 디렉토리에 다운로드하세요:

| Model Size | Params | Indoor (Hypersim)          | Outdoor (Virtual KITTI 2) |
| ---------- | ------ | -------------------------- | ------------------------- |
| **Small**  | 24.8M  | [다운로드][hypersim-small] | [다운로드][vkitti-small]  |
| **Base**   | 97.5M  | [다운로드][hypersim-base]  | [다운로드][vkitti-base]   |
| **Large**  | 335.3M | [다운로드][hypersim-large] | [다운로드][vkitti-large]  |

[hypersim-small]: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
[hypersim-base]: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Base/resolve/main/depth_anything_v2_metric_hypersim_vitb.pth?download=true
[hypersim-large]: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Large/resolve/main/depth_anything_v2_metric_hypersim_vitl.pth?download=true
[vkitti-small]: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small/resolve/main/depth_anything_v2_metric_vkitti_vits.pth?download=true
[vkitti-base]: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Base/resolve/main/depth_anything_v2_metric_vkitti_vitb.pth?download=true
[vkitti-large]: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Large/resolve/main/depth_anything_v2_metric_vkitti_vitl.pth?download=true

**다운로드 스크립트**:

```bash
# checkpoints 폴더 생성
mkdir -p checkpoints

# 모델 파일들 다운로드
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-VITS/resolve/main/depth_anything_v2_metric_hypersim_vits.pth
wget -O checkpoints/depth_anything_v2_metric_hypersim_vitb.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-VITB/resolve/main/depth_anything_v2_metric_hypersim_vitb.pth
wget -O checkpoints/depth_anything_v2_metric_hypersim_vitl.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-VITL/resolve/main/depth_anything_v2_metric_hypersim_vitl.pth
wget -O checkpoints/depth_anything_v2_metric_vkitti_vits.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-VITS/resolve/main/depth_anything_v2_metric_vkitti_vits.pth
wget -O checkpoints/depth_anything_v2_metric_vkitti_vitb.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-VITB/resolve/main/depth_anything_v2_metric_vkitti_vitb.pth
wget -O checkpoints/depth_anything_v2_metric_vkitti_vitl.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-VITL/resolve/main/depth_anything_v2_metric_vkitti_vitl.pth
```

## 실행 방법

### 개발 환경 (간단한 테스트용)

간단한 테스트를 위해 Flask에 내장된 개발 서버를 사용할 수 있습니다.

```bash
python3 true_metric_server.py
```

### 프로덕션 환경 (안정적인 서비스용)

실제 서비스를 위해서는 WSGI 서버인 `gunicorn`을 사용하는 것을 강력히 권장합니다. 4개의 워커(프로세스)를 사용하여 9099 포트로 서버를 실행하는 예시입니다.

```bash
gunicorn --workers 4 --bind 0.0.0.0:9099 true_metric_server:app
```

서버 실행 후, 웹 브라우저에서 `http://<서버_IP>:9099` 주소로 접속하면 실시간 거리 측정 페이지를 사용할 수 있습니다.

## 프로젝트 구조

```
depthanything_v2_test/
├── true_metric_server.py      # 메인 서버 파일
├── requirements.txt           # 필요한 라이브러리 목록
├── README.md                 # 이 파일
├── .gitignore               # Git 제외 파일 목록
├── checkpoints/             # 모델 파일 저장소 (다운로드 필요)
├── depth_anything_v2/       # 모델 구현 코드
│   ├── dinov2.py           # DINOv2 백본
│   ├── dpt.py              # DPT (Dense Prediction Transformer)
│   ├── dinov2_layers/      # DINOv2 레이어 구현
│   └── util/               # 유틸리티 함수들
└── templates/              # 웹 인터페이스 템플릿
```

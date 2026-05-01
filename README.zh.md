<div align="center">

<img src="assets/poster.png" alt="A-EYE 主图" width="720"/>

# A-EYE: Can Large Language Models be an Effective Blind Helper?

**Deogyong Kim · Junhyeong Park · Jun Seong Lee**

大奖（IITP 院长奖）— 2025 SW中心大学数字竞赛  
一等奖 — SK AI Summit *AI's Got Talent*（2025 年 11 月）

[English](README.md) · [한국어](README.ko.md) · **中文** · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## 概述

为视障用户打造的实时视觉辅助 Web 服务，探索大语言模型能否成为有效的盲人助手。手机摄像头将场景流式传至 Flask 后端，结合 Google Gemini（视觉语言推理）、Depth Anything V2（用于近距离预警的度量深度）和 Naver 云地图（逐向导航），以简洁的语音说明前方的情况。

## 功能

- **场景解说。** 从摄像头采集帧并发送至 Gemini（提示词针对行人安全调优：障碍物、标识、交通信息），并通过浏览器 TTS 朗读结果。
- **流水线推理。** 最多并行轮换三个 Gemini API 密钥，前一段 TTS 结束时通常已有新的描述待读。
- **近距离预警。** Depth Anything V2（度量、ViT-S/Hypersim）同帧运行；若检测到约 50 厘米内有物体即触发警示音。一次性校准步骤将用户身高换算为每设备比例因子。
- **逐向导航。** 给出目的地短语后，服务器经 Naver 搜索 + Naver 云地图地理编码解析为坐标，获取步行路线，并在浏览器 GPS 上报新位置时推进路径点。

## 架构

```
浏览器 (templates/index.html, static/script.js)
  │  摄像头帧、GPS、TTS/STT
  ▼
Flask 服务器 (server.py) ──► Gemini (视觉)              场景描述
                          ├► Depth Anything V2         近距离预警
                          └► Naver 搜索 + NCP 地图      地理编码 + 路线
```

| 层级 | 文件 / 模块 |
| --- | --- |
| HTTP + 编排 | `server.py` |
| 深度模型 | `depth_anything_v2/`（DINOv2 主干 + DPT 头） |
| 前端 UI | `templates/index.html`, `static/script.js`, `static/style.css` |
| 警示音 | `static/1.wav` |
| 模型权重 | `checkpoints/depth_anything_v2_metric_hypersim_vits.pth` |

## 前置要求

- Python 3.10（推荐 conda）
- 推荐支持 CUDA 的 GPU。校准（`/calibrate`）仅在 GPU 环境下可用；深度推理可回退至 CPU，但速度较慢。
- API 密钥：
  - **Google Gemini** — 至少 1 个（`API_KEY_1`）；添加 `API_KEY_2`、`API_KEY_3` 可启用并行轮换。
  - **Naver 云地图** — Static Map、Geocoding、Reverse Geocoding、Directions 5/15。
  - **Naver 搜索** — 在地理编码前将地名转换为地址。

## 安装

```bash
cp .env.template .env
# 填写 API_KEY_1..3、NAVER_CLIENT_ID/SECRET、NCP_CLIENT_ID/SECRET

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
```

## 深度模型权重

将 Depth Anything V2 度量深度权重放在 `checkpoints/` 下。默认为 small Hypersim（室内）变体：

```bash
mkdir -p checkpoints
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth \
  https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
```

其他尺寸（Base / Large）与户外 VKITTI 变体可在 [Depth Anything V2 集合](https://huggingface.co/depth-anything)中获取。当前切换变体需修改 `server.py` 中的 `MODEL_CONFIGS` 与权重文件名。

## 运行

```bash
python server.py            # 监听 0.0.0.0:8081
python server.py --debug    # 启用 Flask 调试模式
```

在手机浏览器打开 `http://<host>:8081`（需要摄像头与麦克风权限）。

### 键盘快捷键（桌面）

- `Space` — 启动 / 停止场景自动分析
- `Esc` — 停止导航（如启用）或关闭设置面板

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET  | `/`                          | Web UI |
| GET  | `/get_models`                | 列出可用的 Gemini 模型 |
| POST | `/describe`                  | 提交一帧并获取描述（自动启动流水线） |
| POST | `/upload_image`              | 为流水线工作线程注册最新帧 |
| POST | `/start_auto_processing`    | 启动后台流水线工作线程 |
| POST | `/stop_auto_processing`     | 停止并清空工作线程、队列与最新响应 |
| GET  | `/get_response`              | 取出最新流水线描述 |
| POST | `/set_tts_status`           | 通知服务器当前 TTS 是否在朗读 |
| GET  | `/get_tts_status`           | 读取 TTS 状态 |
| GET  | `/get_queue_status`         | 诊断：流水线 / API / TTS 状态 |
| POST | `/calibrate`                 | 基于身高 + 中心帧深度的一次性校准 |
| POST | `/analyze_depth`             | 使用校准因子检测 ~50 cm 内物体 |
| POST | `/start_navigation`         | 解析目的地、获取路线、创建导航会话 |
| POST | `/update_location`          | 基于当前 GPS 推进路径点 |
| POST | `/navigation_describe`      | 在活动路线上下文中描述帧 |
| GET  | `/get_current_instruction`  | 读取当前路径点指示 |
| POST | `/end_navigation`           | 将导航会话标记为非活动 |
| GET  | `/directions`                | 一次性路线查询（无会话） |
| GET  | `/logs`, `/logs/clear`       | 查看 / 清空 `server.log` |

## 校准原理

用户输入身高（cm）。服务器以 `身高 * 0.26 / 100` 米估算手臂长度（如 175 cm → 约 0.45 m），在举臂距离的画面中心读取深度，并将 `手臂长度 / 测量深度` 作为该用户的比例因子保存。后续深度图先乘以该因子，再与 0.5 m 近距离阈值比较。

## 备注

- 流水线设计针对 *出声时间* 进行优化：新请求可立即返回队列中的现有描述，同时下一段已在另一个 API 密钥上推理。
- 若 TTS 正在朗读或已发出停止信号，Gemini 响应将被丢弃，避免向用户朗读过期的画面描述。
- 目前仅接入 V1（key-id / key）Naver 云地图 Directions 端点。迁移至 API Gateway v2 鉴权方案为后续工作。

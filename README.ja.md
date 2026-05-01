<div align="center">

<img src="assets/poster.png" alt="A-EYE メインフィギュア" width="720"/>

# A-EYE: Can Large Language Models be an Effective Blind Helper?

**Deogyong Kim · Junhyeong Park · Jun Seong Lee**

大賞（IITP院長賞）— 2025 SW中心大学デジタル競技大会  
1位 — SK AI Summit *AI's Got Talent*（2025 年 11 月）

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · **日本語** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## 概要

視覚障害者向けのリアルタイム視覚補助 Web サービスで、大規模言語モデルが効果的なブラインドヘルパーになりうるかを検証します。スマートフォンのカメラ映像を Flask バックエンドにストリーミングし、Google Gemini（視覚言語推論）、Depth Anything V2（近接警告用のメトリック深度）、Naver Cloud Maps（ターン・バイ・ターン案内）を組み合わせて、目の前の状況を簡潔な音声ガイダンスで伝えます。

## 機能

- **シーンナレーション。** カメラからフレームを取得し、歩行者の安全（障害物、標識、交通情報）に最適化されたプロンプトとともに Gemini へ送信、ブラウザの TTS で読み上げます。
- **パイプライン推論。** 最大 3 つの Gemini API キーを並列にローテーションし、前回の TTS が終わる頃には新しい説明が用意されているのが通常です。
- **近接警告。** Depth Anything V2（メトリック、ViT-S/Hypersim）が同じフレームで動作し、約 50 cm 以内に物体を検出すると警告音を鳴らします。1 回限りのキャリブレーションでユーザーの身長をデバイス毎のスケール係数に変換します。
- **ターン・バイ・ターン案内。** 目的地のフレーズを与えると、サーバーが Naver 検索 + Naver Cloud Maps ジオコーディングで座標を解決し、徒歩ルートを取得、ブラウザの GPS が新しい位置を報告するたびにウェイポイントを進めます。

## アーキテクチャ

```
ブラウザ (templates/index.html, static/script.js)
  │  カメラフレーム、GPS、TTS/STT
  ▼
Flask サーバー (server.py) ──► Gemini (視覚)             シーン説明
                            ├► Depth Anything V2        近接警告
                            └► Naver 検索 + NCP マップ  ジオコーディング + 経路
```

| レイヤ | ファイル / モジュール |
| --- | --- |
| HTTP + オーケストレーション | `server.py` |
| 深度モデル | `depth_anything_v2/`（DINOv2 バックボーン + DPT ヘッド） |
| フロントエンド UI | `templates/index.html`, `static/script.js`, `static/style.css` |
| 警告音 | `static/1.wav` |
| モデル重み | `checkpoints/depth_anything_v2_metric_hypersim_vits.pth` |

## 前提条件

- Python 3.10（conda 推奨）
- CUDA 対応 GPU 推奨。キャリブレーション（`/calibrate`）は GPU 限定、深度推論は CPU でも動作しますが低速です。
- API キー：
  - **Google Gemini** — 最低 1 つ（`API_KEY_1`）。`API_KEY_2`、`API_KEY_3` を追加すると並列ローテーション。
  - **Naver Cloud Maps** — Static Map、Geocoding、Reverse Geocoding、Directions 5/15。
  - **Naver 検索** — ジオコーディング前に地名を住所へ変換するために使用。

## セットアップ

```bash
cp .env.template .env
# API_KEY_1..3、NAVER_CLIENT_ID/SECRET、NCP_CLIENT_ID/SECRET を記入

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
```

## 深度モデル重み

`checkpoints/` 配下に Depth Anything V2 メトリック深度の重みを配置します。デフォルトは small Hypersim（屋内）モデルです：

```bash
mkdir -p checkpoints
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth \
  https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
```

他のサイズ（Base / Large）や屋外向け VKITTI モデルは [Depth Anything V2 コレクション](https://huggingface.co/depth-anything)から取得できます。モデル切替には現状 `server.py` の `MODEL_CONFIGS` と重みファイル名を編集する必要があります。

## 実行

```bash
python server.py            # 0.0.0.0:8081 で待機
python server.py --debug    # Flask デバッグモード
```

スマートフォンのブラウザで `http://<host>:8081` を開きます（カメラとマイクの権限が必要）。

### キーボードショートカット（デスクトップ）

- `Space` — シーン自動解析の開始 / 停止
- `Esc` — 案内停止（実行中の場合）または設定パネルを閉じる

## エンドポイント

| メソッド | パス | 用途 |
| --- | --- | --- |
| GET  | `/`                          | Web UI |
| GET  | `/get_models`                | 利用可能な Gemini モデル一覧 |
| POST | `/describe`                  | フレーム送信、説明取得（パイプライン自動開始） |
| POST | `/upload_image`              | パイプラインワーカーへ最新フレームを登録 |
| POST | `/start_auto_processing`    | バックグラウンドのパイプラインワーカー開始 |
| POST | `/stop_auto_processing`     | ワーカー、キュー、最新応答を停止しクリア |
| GET  | `/get_response`              | 最新のパイプライン説明を取得 |
| POST | `/set_tts_status`           | TTS が発話中かどうかをサーバーへ通知 |
| GET  | `/get_tts_status`           | TTS 状態の読取 |
| GET  | `/get_queue_status`         | 診断: パイプライン / API / TTS 状態 |
| POST | `/calibrate`                 | 身長 + 中央フレーム深度による 1 回限りのキャリブレーション |
| POST | `/analyze_depth`             | キャリブレーション係数で ~50 cm 以内の物体を検出 |
| POST | `/start_navigation`         | 目的地解決、経路取得、ナビゲーションセッション作成 |
| POST | `/update_location`          | 現在 GPS に基づきウェイポイントを進める |
| POST | `/navigation_describe`      | 有効な経路の文脈でフレームを説明 |
| GET  | `/get_current_instruction`  | 現在のウェイポイント案内を読取 |
| POST | `/end_navigation`           | ナビゲーションセッションを非アクティブ化 |
| GET  | `/directions`                | 一回限りの経路取得（セッションなし） |
| GET  | `/logs`, `/logs/clear`       | `server.log` の閲覧 / クリア |

## キャリブレーションの仕組み

ユーザーが身長（cm）を入力します。サーバーは腕の長さを `身長 * 0.26 / 100` メートル（例: 175 cm → 約 0.45 m）と推定し、腕を伸ばした距離で得たフレーム中央の深度を測定し、`腕の長さ / 測定深度` をユーザー固有のスケール係数として保存します。以降の深度マップはこの係数を乗じてから 0.5 m の近接しきい値と比較されます。

## 備考

- パイプライン設計は *音声出力までの時間* を最適化します: 新しい要求はキュー内の既存説明を即座に返しつつ、次の説明は別の API キーで推論中です。
- TTS が発話中、または停止シグナルが発火した場合、Gemini 応答は破棄されるため、古いフレームの説明が読み上げられることはありません。
- 現状は V1（key-id / key）の Naver Cloud Maps Directions エンドポイントのみ統合されています。API Gateway v2 認証方式への移行は今後の課題です。

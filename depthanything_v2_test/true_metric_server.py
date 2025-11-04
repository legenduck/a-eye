import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import io
import base64
import time
import logging
from flask import Flask, render_template, request, jsonify
import cv2
import os

from depth_anything_v2.dpt import DepthAnythingV2

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_CACHE = {}

MODEL_CONFIGS = {
    'vits': {'encoder': 'vits', 'features': 64, 'out_channels': [48, 96, 192, 384]},
    'vitb': {'encoder': 'vitb', 'features': 128, 'out_channels': [96, 192, 384, 768]},
    'vitl': {'encoder': 'vitl', 'features': 256, 'out_channels': [256, 512, 1024, 1024]},
}

def get_font(size=20):
    """결과 표시에 사용할 폰트를 가져옵니다."""
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except IOError:
        return ImageFont.load_default()

def load_model(model_name='metric_hypersim_vits'):
    """
    사용자가 선택한 Depth Anything V2 Metric Depth 모델을 동적으로 로드합니다.
    model_name 형식: metric_{dataset}_{encoder} 예: metric_hypersim_vits
    """
    if model_name in MODEL_CACHE:
        logger.info(f"캐시에서 '{model_name}' 모델을 사용합니다.")
        return MODEL_CACHE[model_name]

    logger.info(f"'{model_name}' 모델 로딩을 시작합니다...")
    try:
        parts = model_name.split('_')
        dataset = parts[1]  # 'hypersim' or 'vkitti'
        encoder = parts[2]  # 'vits', 'vitb', 'vitl'
        
        # 데이터셋에 따라 max_depth 설정
        max_depth = 20 if dataset == 'hypersim' else 80
        
        # 모델 아키텍처 생성
        model = DepthAnythingV2(**{**MODEL_CONFIGS[encoder], 'max_depth': max_depth})
        
        # 로컬 체크포인트 경로 설정 (단순화)
        checkpoint_filename = f'depth_anything_v2_{model_name}.pth'
        checkpoint_path = os.path.join('checkpoints', checkpoint_filename)
        logger.info(f"로컬 체크포인트에서 가중치를 로드합니다: {checkpoint_path}")
        
        if not os.path.exists(checkpoint_path):
            raise FileNotFoundError(f"체크포인트 파일을 찾을 수 없습니다: {checkpoint_path}")
            
        state_dict = torch.load(checkpoint_path, map_location="cpu")
        model.load_state_dict(state_dict)
        
        model.to(DEVICE)
        model.eval()
        
        MODEL_CACHE[model_name] = model
        logger.info(f"✅ '{model_name}' (max_depth: {max_depth}m) 모델 로딩 및 GPU 이동 완료!")
        return model
    except Exception as e:
        logger.error(f"❌ 모델 로딩 중 심각한 오류 발생: {e}", exc_info=True)
        return None

def analyze_true_metric_depth(depth_map_meters):
    """
    실제 미터 단위 깊이 맵을 9개 구역으로 나누어 분석합니다.
    """
    h, w = depth_map_meters.shape
    grid_h, grid_w = h // 3, w // 3
    
    analysis = {"zones": [], "min_total": float('inf'), "avg_total": 0}
    total_distance = 0
    
    for i in range(3):
        for j in range(3):
            zone_y, zone_x = i * grid_h, j * grid_w
            zone = depth_map_meters[zone_y:zone_y+grid_h, zone_x:zone_x+grid_w]
            
            avg_dist = round(float(np.mean(zone)), 2)
            min_dist = round(float(np.min(zone)), 2)
            
            analysis["zones"].append({
                "id": i * 3 + j,
                "avg_dist_m": avg_dist,
                "min_dist_m": min_dist,
            })
            total_distance += avg_dist
            if min_dist < analysis["min_total"]:
                analysis["min_total"] = min_dist

    analysis["avg_total"] = round(total_distance / 9, 2)
    return analysis

def create_visualization(original_image, depth_map_meters, analysis_result):
    """
    원본 이미지 위에 실제 거리 값과 컬러맵을 시각화합니다.
    """
    img_array = np.array(original_image.convert("RGB"))
    h, w, _ = img_array.shape

    VISUALIZATION_MAX_METERS = 10.0
    depth_normalized = np.clip(depth_map_meters, 0, VISUALIZATION_MAX_METERS) / VISUALIZATION_MAX_METERS
    
    import matplotlib.cm as cm
    colormap = cm.get_cmap('jet_r') 
    depth_colored = colormap(depth_normalized)[:, :, :3]
    depth_colored = (depth_colored * 255).astype(np.uint8)
    
    blended = (img_array * 0.5 + depth_colored * 0.5).astype(np.uint8)
    
    result_image = Image.fromarray(blended).convert("RGBA")
    draw = ImageDraw.Draw(result_image)
    font_large = get_font(24)
    grid_h, grid_w = h // 3, w // 3

    for i in range(3):
        for j in range(3):
            zone_info = analysis_result["zones"][i * 3 + j]
            avg_dist_m = zone_info['avg_dist_m']
            
            y1, x1 = i * grid_h, j * grid_w
            y2, x2 = y1 + grid_h, x1 + grid_w
            draw.rectangle([x1, y1, x2, y2], outline="white", width=2)
            
            text = f"{avg_dist_m:.2f} m"
            text_bbox = draw.textbbox((0, 0), text, font=font_large)
            text_w, text_h = text_bbox[2] - text_bbox[0], text_bbox[3] - text_bbox[1]
            text_pos = (x1 + (grid_w - text_w) // 2, y1 + (grid_h - text_h) // 2)
            
            draw.rectangle(
                [text_pos[0]-5, text_pos[1]-5, text_pos[0]+text_w+5, text_pos[1]+text_h+5], 
                fill=(0, 0, 0, 153)
            )
            draw.text(text_pos, text, font=font_large, fill="white")
            
    return result_image


def create_depth_map_visualization(depth_map_meters):
    """
    미터 단위 깊이 맵을 시각화용 컬러 이미지로 변환합니다.
    """
    VISUALIZATION_MAX_METERS = 10.0
    depth_normalized = np.clip(depth_map_meters, 0, VISUALIZATION_MAX_METERS) / VISUALIZATION_MAX_METERS
    
    import matplotlib.cm as cm
    colormap = cm.get_cmap('jet_r') 
    depth_colored = colormap(depth_normalized)[:, :, :3]
    depth_colored = (depth_colored * 255).astype(np.uint8)
    
    return Image.fromarray(depth_colored).convert("RGB")


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/analyze', methods=['POST'])
def analyze():
    start_time = time.time()
    
    try:
        data = request.get_json()
        image_data = base64.b64decode(data['image'])
        model_name = data.get('model', 'metric_hypersim_vits') 
        calibration_factor = float(data.get('calibrationFactor', 1.0)) # 보정 계수
        
        pil_image = Image.open(io.BytesIO(image_data)).convert("RGB")
        
        cv_image = np.array(pil_image)
        cv_image = cv_image[:, :, ::-1].copy()
        
        da_model = load_model(model_name)
        if da_model is None:
            return jsonify({"error": f"모델({model_name})을 로드할 수 없습니다."}), 500
        
        depth_map_meters = da_model.infer_image(cv_image)
        
        # --- 거리 보정 적용 ---
        depth_map_meters *= calibration_factor
        
        analysis_result = analyze_true_metric_depth(depth_map_meters)
        
        h, w = depth_map_meters.shape
        center_depth = depth_map_meters[h // 2, w // 2].item()
        analysis_result['center_depth'] = center_depth

        visualized_image = create_visualization(pil_image, depth_map_meters, analysis_result)
        depth_map_image = create_depth_map_visualization(depth_map_meters)

        # 시각화된 이미지 Base64 인코딩
        buffered_viz = io.BytesIO()
        visualized_image.convert("RGB").save(buffered_viz, format="JPEG")
        viz_img_str = base64.b64encode(buffered_viz.getvalue()).decode()
        
        # 뎁스맵 이미지 Base64 인코딩
        buffered_depth = io.BytesIO()
        depth_map_image.save(buffered_depth, format="JPEG")
        depth_map_str = base64.b64encode(buffered_depth.getvalue()).decode()
        
        end_time = time.time()
        processing_time = round((end_time - start_time) * 1000)
        
        logger.info(f"모델: {model_name}, 보정계수: {calibration_factor:.3f}, 처리 시간: {processing_time}ms")
        
        return jsonify({
            "visualizedImage": "data:image/jpeg;base64," + viz_img_str,
            "depthMapImage": "data:image/jpeg;base64," + depth_map_str,
            "analysis": analysis_result,
            "processingTime": processing_time
        })

    except Exception as e:
        logger.error(f"❌ 분석 중 오류 발생: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/calibrate', methods=['POST'])
def calibrate():
    """
    사용자의 키와 손바닥 이미지를 기반으로 거리 보정 계수를 계산합니다.
    """
    try:
        data = request.get_json()
        height_cm = float(data['height'])
        image_data = base64.b64decode(data['image'])
        model_name = data.get('model', 'metric_hypersim_vits')

        # 1. 예상 팔 길이 계산 (키의 40%)
        estimated_arm_length_m = (height_cm * 0.4) / 100

        # 2. AI로 손까지의 거리 측정
        pil_image = Image.open(io.BytesIO(image_data)).convert("RGB")
        cv_image = np.array(pil_image)[:, :, ::-1].copy()
        
        da_model = load_model(model_name)
        if da_model is None:
            return jsonify({"error": f"모델({model_name})을 로드할 수 없습니다."}), 500
            
        depth_map = da_model.infer_image(cv_image)
        
        # 화면 중앙점의 거리를 측정값으로 사용
        h, w = depth_map.shape
        measured_dist_m = depth_map[h//2, w//2].item()

        if measured_dist_m <= 0:
            return jsonify({"error": "측정된 거리가 0 이하입니다. 다시 시도해주세요."}), 400

        # 3. 보정 계수 계산
        calibration_factor = estimated_arm_length_m / measured_dist_m
        
        logger.info(f"✅ 보정 완료: 키({height_cm}cm), 팔길이({estimated_arm_length_m:.2f}m), 측정거리({measured_dist_m:.2f}m) -> 보정계수({calibration_factor:.3f})")
        
        return jsonify({"calibrationFactor": calibration_factor})

    except Exception as e:
        logger.error(f"❌ 보정 중 오류 발생: {e}", exc_info=True)
        return jsonify({"error": "보정 중 서버에서 오류가 발생했습니다."}), 500


if __name__ == '__main__':
    logger.info("=====================================================")
    logger.info("    🎯 Depth Anything V2 다중 모델 테스트 서버 (Clean Ver.) 시작됨")
    logger.info(f"    - 디바이스: {DEVICE}")
    logger.info("    - http://0.0.0.0:9099 에서 접속하세요.")
    logger.info("=====================================================")
    # 서버 시작 시 기본 모델을 미리 로드하여 첫 요청 속도 향상 (선택 사항)
    load_model() 
    app.run(host='0.0.0.0', port=9099, debug=False) 